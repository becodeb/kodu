import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { DEFAULT_HTML, findProjectForActor, marcarSiActuaAdmin } from '../../../lib/projects.ts';
import { buildSystemPrompt, type AssetContext, type RuleContext } from '../../../lib/ai/prompt.ts';
import { aplicarKit, temaDe, type TemaId } from '../../../lib/ai/kit.ts';
import { revisarHtml } from '../../../lib/ai/revision.ts';
import {
  ProviderError,
  readCompletionStream,
  requestCompletionStream,
  supportsVision,
  type ChatMessage,
  type ContentPart,
  type ProviderConfig,
  type Speed,
  type TokenUsage as MotorTokenUsage,
} from '../../../lib/ai/provider.ts';
import { cadenaDeMotores, normalizarMotor } from '../../../lib/ai/catalogo.ts';
import { resolverCapacidades, resolverVelocidadEfectiva } from '../../../lib/ai/capacidades.ts';
import { aplicaRevisionVisual } from '../../../lib/ai/revision-visual.ts';
import {
  contenidoMensajeDeVersiones,
  directivaDeVersion,
  esRecursoInicial,
  variantesEfectivas,
} from '../../../lib/ai/versiones.ts';
import { consumedTokens, recordUsage } from '../../../lib/ai/usage.ts';
import { puedeUsarLaIa } from '../../../lib/auth/domains.ts';
import { consumoDeLaDemo } from '../../../lib/demo.ts';
import { leerAppSettings } from '../../../lib/settings.ts';
import {
  UPDATE_RESOURCE_CODE,
  parseUpdateResourceArgs,
  rescatarHtmlDelTexto,
} from '../../../lib/ai/tools.ts';
import { readImageAsDataUrl } from '../../../lib/uploads.ts';
import { fail, readBody } from '../../../lib/http.ts';

/**
 * POST /api/chat/stream — proxy de streaming contra DeepSeek (SPEC §2 y §4).
 *
 * Devuelve SSE con eventos ya digeridos para el navegador:
 *   {type:"text",  delta}   fragmento de la explicación (va al chat)
 *   {type:"code",  html}    resultado del tool call (va al iframe, NO al chat)
 *   {type:"done",  ...}     fin del turno
 *   {type:"error", message} algo falló
 *
 * El HTML nunca aparece en el flujo de texto: viaja por `update_resource_code`.
 */

/**
 * Techo absoluto del mensaje, sólo para que un body descomunal no tumbe al
 * servidor. El límite que le importa al docente es el del proveedor.
 */
const MAX_MESSAGE_CHARS = 500_000;

const schema = z.object({
  projectId: z.string().min(1),
  threadId: z.string().min(1),
  // El tope real depende del proveedor y se chequea abajo, cuando ya se sabe
  // cuál eligió el docente. Este es sólo el techo que protege al servidor de un
  // body absurdo, no una decisión de producto.
  message: z
    .string()
    .trim()
    .min(1, 'Escribí un mensaje')
    .max(MAX_MESSAGE_CHARS, 'El mensaje es demasiado largo para procesarlo.'),
  attachmentUrls: z.array(z.string().max(500)).max(10).optional(),
  /** El `id` de un `AiModel`. Cualquier valor que no resuelva a uno habilitado
   *  cae al default — ver `normalizarMotor` en `lib/ai/catalogo.ts`. */
  model: z.string().min(1).optional(),
  /** El docente tocó el código a mano desde la última respuesta de la IA. */
  codeEditedByTeacher: z.boolean().optional(),
  /**
   * T6 ("Velocidad Rápido / A fondo"): lo que eligió el docente en el
   * compositor. Server-side, `resolverVelocidadEfectiva` (`lib/ai/capacidades.ts`)
   * lo IGNORA por completo sin `puedeElegirVelocidad` — mandarlo desde acá no
   * alcanza para forzar nada sin el permiso.
   */
  speed: z.enum(['fast', 'deep']).optional(),
  /**
   * T9 ("Varias versiones al crear un recurso"): lo que pidió el docente en
   * el interruptor del compositor. Server-side, `variantesEfectivas`
   * (`lib/ai/versiones.ts`) lo cruza con `puedePedirVersiones` Y con si el
   * recurso sigue siendo el de arranque — mandarlo desde acá no alcanza
   * para forzar nada sin las otras dos condiciones.
   */
  variants: z.union([z.literal(1), z.literal(3)]).optional(),
});

/** Cuántos mensajes del hilo se reenvían como historial. */
const HISTORY_LIMIT = 40;

/**
 * Qué se le dice al docente cuando el tool call no se pudo aplicar. Reemplazan
 * al viejo "No pude generar una respuesta.", que no explicaba nada y dejaba la
 * sensación de que la plataforma estaba rota.
 */
const CODE_PROBLEMS: Record<'truncated' | 'invalid' | 'empty', string> = {
  truncated:
    'El recurso quedó a medio escribir porque superó el largo máximo que el modelo puede devolver de una vez, así que no lo apliqué (tu versión anterior sigue intacta). Pedime el cambio por partes: primero una sección, después la otra.',
  invalid:
    'El modelo devolvió el código con un formato que no pude leer, así que no toqué tu recurso. Volvé a mandarme el pedido.',
  empty: 'El modelo devolvió un recurso vacío, así que no apliqué el cambio. Probá de nuevo.',
};

const SILENT_TURN =
  'El motor de IA cortó el turno sin devolver nada. Tu recurso quedó como estaba. Probá de nuevo y, si vuelve a pasar, mandá el pedido en partes más chicas.';

/**
 * Cuántas imágenes del proyecto se reenvían cuando el mensaje no trae adjuntos.
 *
 * Es 1 y no más: medido, cada imagen cuesta ~850 tokens de prompt aun pesando
 * 15 KB, y el modelo gratuito estrangula los pedidos con imagen mucho antes que
 * los de texto. Reenviar cuatro en cada turno convertía una conversación normal
 * en una fila de 429.
 */
const MAX_CONTEXT_IMAGES = 1;

/**
 * Cada cuánto se manda una señal de vida por el SSE.
 *
 * Mientras la IA escribe el recurso, el servidor recibe datos del proveedor pero
 * no le manda NADA al navegador: el HTML recién sale cuando el tool call está
 * completo, y eso puede tardar minutos. Para el proxy que hay en el medio esa
 * conexión parece muerta y la corta, y se pierde el turno entero (AbortError
 * del lado del servidor, "El servidor rechazó el pedido" del lado del docente).
 * El comentario SSE `:` la mantiene viva sin ensuciar el flujo: el cliente lo
 * ignora solo.
 */
const HEARTBEAT_MS = 10_000;

/** Cuántos intentos se le anuncian al docente (primer intento + reintentos). */
const REINTENTOS_VISIBLES = 10;

/**
 * ¿Este mensaje pide tocar el recurso?
 *
 * Importa porque de eso depende si se le OBLIGA al modelo a llamar
 * `update_resource_code`. Medido contra el proveedor: con `tool_choice: auto`,
 * MiniMax M3 casi nunca la llama —ni con un pedido explícito— y termina
 * anunciando el cambio en el chat sin hacerlo. Forzada por nombre, la llama
 * siempre. Así que la elección no se le deja al modelo.
 *
 * La decisión se toma sobre el pedido del DOCENTE y no sobre la respuesta: lo
 * que determina si hace falta código es lo que se pidió, no cómo el modelo
 * decidió redactar.
 *
 * Ante la duda se fuerza, porque en Kodu casi todo mensaje es un pedido de
 * cambio: sólo se deja elegir cuando es claramente una consulta.
 */
/**
 * Una consulta de verdad: empieza con palabra interrogativa Y lleva signo.
 * Las dos condiciones importan. "¿de qué color es?" pregunta; "podés hacerlo
 * rojo?" tiene signo pero es un pedido, y "cambiá el color" no lleva signo pero
 * también lo es.
 */
/*
 * POR QUE estos dos patrones NO usan `\b`:
 *
 * `\b` de JavaScript define "palabra" como [A-Za-z0-9_], y ahi no entran las
 * vocales con tilde ni la ñ. Entonces, en "¿Qué hace este recurso?", despues
 * de la "é" viene un espacio: dos caracteres que para `\b` son "no palabra",
 * o sea SIN frontera, y la alternativa `qu[eé]` no cerraba. La consulta caia
 * al default de `pideCambio` ("es un pedido") y la IA reescribia el recurso
 * entero cuando la docente solo habia preguntado. Rompia justo con "qué",
 * "por qué" y "para qué" — los tres arranques de pregunta mas comunes — y
 * andaba si el mensaje venia SIN tilde, que es exactamente al reves de lo
 * deseable en una app en castellano.
 *
 * El reemplazo es una frontera de palabra Unicode: "no puede seguir una letra,
 * un numero ni un guion bajo", con \p{L} que si abarca acentos y ñ. Necesita
 * la bandera `u`.
 */
const INTERROGATIVA =
  /^\s*[¿]?\s*(de |a |en |con |para |por |sobre )?(qu[eé]|c[oó]mo|cu[aá]l(es)?|cu[aá]nt[oa]s?|d[oó]nde|qui[eé]n(es)?|por qu[eé]|para qu[eé]|cu[aá]ndo|se puede|hay|existe|sirve|anda|funciona)(?![\p{L}\p{N}_])/iu;

/** Ordenes claras. Se aceptan con y sin tilde, que es como se escribe al apuro. */
const IMPERATIVO =
  /(?<![\p{L}\p{N}_])(hac[eé]|hacelo|hacela|pon[eé]|ponele|ponelo|agreg[aá]|agregale|añad[ií]|sac[aá]|sacale|quit[aá]|borr[aá]|elimin[aá]|cambi[aá]|cambiale|cambialo|modific[aá]|correg[ií]|corregilo|arregl[aá]|arreglalo|mejor[aá]|mejoralo|rehac[eé]|rehacelo|actualiz[aá]|mov[eé]|ajust[aá]|convert[ií]|transform[aá]|sum[aá]|us[aá]|aplic[aá]|arm[aá]|cre[aá]|gener[aá]|escrib[ií]|dej[aá]|quiero|necesito|dale|segu[ií]|continu[aá])(?![\p{L}\p{N}_])/iu;

/** Exportada sólo para `e2e/unidad.ts`: nadie más fuera de este módulo la usa. */
export function pideCambio(mensaje: string): boolean {
  const texto = mensaje.trim();

  // El orden no es casual: se descarta la consulta ANTES de buscar ordenes.
  // "que hace este recurso?" contiene "hace", pero es una pregunta, no un pedido.
  if (/[?¿]/.test(texto) && INTERROGATIVA.test(texto)) return false;
  if (IMPERATIVO.test(texto)) return true;

  // Ante la duda, se fuerza: en Kodu casi todo mensaje pide un cambio, y el
  // costo de equivocarse para este lado es mucho menor que el de no aplicarlo.
  return true;
}

const encoder = new TextEncoder();

function sseFrame(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Aplica el kit de diseño (T2, "Kit aplicado por el servidor") a un HTML que
 * acaba de llegar del modelo, ANTES de mandarlo al cliente (`send({ type:
 * 'code', ... })`) y de persistirlo. Un solo paso por acá para las tres
 * fuentes de HTML de un turno (el resultado de `update_resource_code` y las
 * dos rutas de `rescatarHtmlDelTexto`), así T3 (vista previa en vivo) y T9
 * (varias versiones) reusan la misma función en vez de repetir la llamada a
 * `aplicarKit` con su propio criterio de tema previo.
 *
 * `temaPrevio` es el tema que YA tenía el recurso ANTES de este turno (no el
 * del HTML nuevo): si el modelo no declaró `<meta name="kodu-tema">` en esta
 * respuesta, el recurso no se queda sin kit, hereda el que ya tenía.
 *
 * Exportada para `e2e/unidad.ts` (mismo criterio que `pideCambio` más abajo)
 * y, desde T8, para `visual-review.ts` — mismo paso, misma razón: el HTML
 * que devuelve esa llamada también pasa por acá antes de persistirse.
 */
export function aplicarKitAlTurno(html: string, temaPrevio: TemaId | null): string {
  return aplicarKit(html, { temaPrevio });
}

/**
 * Arma el contenido del mensaje del docente.
 *
 * Con `AI_VISION` prendido las imágenes viajan como partes `image_url` en
 * base64. Detalle que importa: si este mensaje no trae adjuntos, igual se le
 * mandan las imágenes del proyecto. Sin eso, la imagen sólo existía para el
 * modelo en el turno exacto en que se subía, y al pedirle "leé la imagen" en el
 * mensaje siguiente contestaba, con razón, que no la veía.
 *
 * Apagado (default), sólo se nombran: el system prompt ya le aclara que no las
 * ve y que tiene que preguntar.
 */
async function buildUserContent(
  message: string,
  attachmentUrls: string[],
  projectImageUrls: string[],
  motor: ProviderConfig,
): Promise<string | ContentPart[]> {
  const own = attachmentUrls.length > 0;
  // Las del mensaje mandan; si no hay, las del proyecto (las últimas, acotadas
  // para no inflar el pedido sin necesidad).
  const candidates = own ? attachmentUrls : projectImageUrls.slice(-MAX_CONTEXT_IMAGES);

  if (candidates.length === 0) return message;

  const names = candidates.map((url) => url.split('/').pop() ?? url).join(', ');

  if (!supportsVision(motor)) {
    return own
      ? `${message}

[El docente adjuntó a este mensaje: ${names}. No podés ver su contenido.]`
      : message;
  }

  const images = (
    await Promise.all(candidates.map((url) => readImageAsDataUrl(url)))
  ).filter((dataUrl): dataUrl is string => dataUrl !== null);

  if (images.length === 0) {
    return own ? `${message}

[El docente adjuntó: ${names}, pero no se pudieron leer.]` : message;
  }

  const preface = own
    ? message
    : `${message}

[Adjunto de nuevo las imágenes que el docente ya había subido a este recurso: ${names}.]`;

  return [
    { type: 'text', text: preface },
    ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ];
}

/**
 * Busca, en la cadena de respaldo de `actual`, el primer motor con lugar para
 * `largoMensaje` — para sugerirlo en el 413 de "mensaje demasiado largo".
 *
 * Usa la cadena (no la lista completa del catálogo) a propósito: es la misma
 * lista de motores que ya sabemos que están habilitados y con clave, así que
 * la sugerencia nunca apunta a algo que después no puede contestar.
 *
 * `prime` (T5) viaja igual que en el resto del catálogo: sin ella, la
 * sugerencia podría ofrecerle a un docente sin prime un motor que nunca
 * podría usar.
 */
async function motorConCapacidad(
  actual: ProviderConfig,
  largoMensaje: number,
  prime: boolean,
): Promise<ProviderConfig | null> {
  const cadena = await cadenaDeMotores(actual.id, prime);
  return cadena.find((motor) => motor.id !== actual.id && motor.maxInputChars >= largoMensaje) ?? null;
}

/**
 * T9 ("Varias versiones al crear un recurso"): genera UNA versión
 * secundaria (2 o 3) de un turno de versiones — una llamada sola al motor
 * pedido (SIN cadena de respaldo, sin rescate de HTML del texto, sin
 * re-pedido forzado: si algo sale mal, se descarta entera, nunca tumba el
 * turno — mismo criterio que T8 ya sienta para la revisión visual: "no hay
 * 'otro motor' al que valga la pena pasarle lo mismo") y, si corresponde, su
 * propia pasada de corrección de T7 (en `POST`, `revisarYCorregir` hace lo
 * mismo para la versión 1; esto es el equivalente para cualquier otra, con
 * el mismo criterio de "usar lo corregido si algo salió, sin reintentar una
 * segunda vez"). `anterior` para el lint SIEMPRE es `null`: una versión
 * sólo existe cuando el recurso todavía era el de arranque (T9,
 * "eligibility"), así que nunca hay nada previo con qué comparar.
 *
 * Nunca tira: cualquier falla (red, JSON inválido, truncado, el docente
 * cancelando el turno) se loguea y devuelve `null` — el llamador la trata
 * como "esta versión no existe", nunca como un error del turno.
 */
async function generarVersionSecundaria(args: {
  indice: 2 | 3;
  mensajes: ChatMessage[];
  provider: ProviderConfig;
  temaProyecto: TemaId | null;
  velocidadEfectiva: Speed | null;
  autoReviewForAll: boolean;
  promptBase: {
    globalRules: RuleContext[];
    userRules: RuleContext[];
    assets: AssetContext[];
    projectTitle: string;
    turnosPrevios: number;
  };
  userId: string;
  projectId: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const registrarConsumo = (usage: MotorTokenUsage | null) => {
    if (!usage) return;
    recordUsage({
      userId: args.userId,
      projectId: args.projectId,
      aiModelId: args.provider.id,
      model: args.provider.model,
      promptTokens: usage.promptTokens,
      cachedInputTokens: usage.cachedTokens,
      completionTokens: usage.completionTokens,
      precios: args.provider.precios,
    }).catch((error) =>
      console.error(`[chat/stream] versión ${args.indice}: no se pudo registrar el consumo:`, error),
    );
  };

  let primeraPasada: string | null = null;

  try {
    const respuesta = await requestCompletionStream({
      messages: args.mensajes,
      provider: args.provider,
      signal: args.signal,
      forzarHerramienta: true,
      velocidad: args.velocidadEfectiva,
    });

    let usage: MotorTokenUsage | null = null;
    for await (const event of readCompletionStream(respuesta)) {
      if (event.type === 'usage') {
        usage = event.usage;
      } else if (event.type === 'tool' && event.name === UPDATE_RESOURCE_CODE) {
        const resultado = parseUpdateResourceArgs(event.arguments, event.truncated);
        if (resultado.ok) primeraPasada = aplicarKitAlTurno(resultado.html, args.temaProyecto);
      }
    }
    registrarConsumo(usage);
  } catch (error) {
    console.warn(
      `[chat/stream] versión ${args.indice}: no se pudo generar, se descarta:`,
      (error as Error).message,
    );
    return null;
  }

  if (!primeraPasada) return null;

  // T7 ("Revisión automática"), misma puerta que la versión 1 en `POST`
  // (A fondo, o `autoReviewForAll` para quien lo tiene "para todos").
  if (args.velocidadEfectiva !== 'deep' && !args.autoReviewForAll) return primeraPasada;

  const hallazgos = revisarHtml(primeraPasada, { anterior: null });
  if (hallazgos.length === 0) return primeraPasada;

  try {
    const mensajeHallazgos = [
      'Revisión automática antes de entregarle el recurso al docente. Corregí SÓLO esto, sin cambiar nada más del recurso:',
      ...hallazgos.map((hallazgo, indice) => {
        const ejemplos =
          hallazgo.ejemplos && hallazgo.ejemplos.length > 0
            ? ` Ejemplos: ${hallazgo.ejemplos.join(', ')}.`
            : '';
        return `${indice + 1}. ${hallazgo.instruccion}${ejemplos}`;
      }),
    ].join('\n');

    // Mismo criterio que `revisarYCorregir`: el system prompt "de siempre",
    // pero con la primera pasada como "el recurso actual" — la REGLA MÁS
    // IMPORTANTE ("se EDITA lo que ya existe") sigue rigiendo, así el
    // modelo no reescribe de cero para corregir un par de hallazgos. Sin
    // historial: es un pedido mecánico y autocontenido.
    const systemPromptRevision = buildSystemPrompt({
      ...args.promptBase,
      currentHtml: primeraPasada,
      canSeeImages: supportsVision(args.provider),
      htmlEditedByTeacher: false,
      herramientaForzada: true,
    });

    const respuestaRevision = await requestCompletionStream({
      messages: [
        { role: 'system', content: systemPromptRevision },
        { role: 'user', content: mensajeHallazgos },
      ],
      provider: args.provider,
      signal: args.signal,
      forzarHerramienta: true,
      // Mecánico, no creativo: razonamiento OFF, sin importar la velocidad
      // efectiva del turno — mismo criterio que la corrección de T7.
      velocidad: 'fast',
    });

    let htmlCorregido: string | null = null;
    let usageRevision: MotorTokenUsage | null = null;
    for await (const event of readCompletionStream(respuestaRevision)) {
      if (event.type === 'usage') {
        usageRevision = event.usage;
      } else if (event.type === 'tool' && event.name === UPDATE_RESOURCE_CODE) {
        const resultado = parseUpdateResourceArgs(event.arguments, event.truncated);
        if (resultado.ok) htmlCorregido = aplicarKitAlTurno(resultado.html, args.temaProyecto);
      }
    }
    registrarConsumo(usageRevision);

    if (!htmlCorregido) return primeraPasada;

    // Sólo se loguea si quedan hallazgos: no se reintenta una segunda vez,
    // mismo límite que `revisarYCorregir` — "una sola corrección por turno".
    const hallazgosRestantes = revisarHtml(htmlCorregido, { anterior: null });
    if (hallazgosRestantes.length > 0) {
      console.warn(
        `[chat/stream] versión ${args.indice}: tras la corrección quedan ${hallazgosRestantes.length} hallazgo(s); no se reintenta una segunda vez`,
      );
    }

    return htmlCorregido;
  } catch (error) {
    console.warn(
      `[chat/stream] versión ${args.indice}: la corrección automática falló, queda la primera pasada:`,
      (error as Error).message,
    );
    return primeraPasada;
  }
}

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;

  /**
   * El gate de acceso a la IA vive ACÁ, no en el middleware ni en el login
   * (design.md §10): la política de "quién puede usar la IA" decide en el
   * punto donde se va a gastar, junto al tope por usuario más abajo. Por
   * construcción — no por cuidado — esto también es lo que hace que revocar
   * el acceso aplique al PRÓXIMO turno y nunca corte uno que ya está
   * transmitiendo: el middleware relee `aiAccessOverride` en cada request
   * nueva a esta ruta, y un turno en curso no hace una request nueva.
   */
  if (!(await puedeUsarLaIa(user))) {
    return fail('Tu cuenta todavía no tiene habilitado el uso de la IA. Escribinos y lo vemos.', 403);
  }

  /**
   * El apagado de la demo (design.md §8; specs/demo-mode/spec.md — "Turning
   * demo mode off disables the demo account immediately") va ACÁ, no en el
   * middleware: la cuenta de demo tiene `aiAccessOverride=true` fijo (ver
   * `lib/demo.ts`), así que `puedeUsarLaIa` de arriba siempre la deja pasar.
   * El interruptor real es este chequeo aparte. Igual que la revocación de
   * M6, esto es lo que hace que apagar la demo aplique al PRÓXIMO turno y
   * nunca corte uno que ya está transmitiendo — el middleware relee
   * `AppSettings` en cada request nueva, un turno en curso no hace una.
   *
   * `settings` se lee ACÁ, sin importar si es la demo o no (antes sólo se
   * leía para la demo): T5 (odd/tasks/modo-prime.md) necesita las mismas
   * `AppSettings` para `resolverCapacidades`, y las dos lecturas comparten
   * la misma caché de 10s (`lib/settings.ts`) — una sola lectura por turno
   * alcanza para las dos cosas.
   */
  const settings = await leerAppSettings();
  if (user.isDemo && !settings.demoEnabled) {
    return fail('La demo está cerrada por el momento.', 403);
  }

  // T5: qué puede este turno — entre otras cosas, si el catálogo de abajo
  // puede resolver, listar o usar como respaldo un motor `primeOnly` para
  // esta cuenta. Server-only: nunca viaja al cliente.
  const capacidades = resolverCapacidades(user, settings);

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }

  const { projectId, threadId, message, attachmentUrls, model, codeEditedByTeacher, speed, variants } = parsed.data;

  /**
   * T6: la velocidad efectiva de ESTE turno — capacidad × pedido × default
   * (ver `resolverVelocidadEfectiva`). `null` = sin pisar nada, el
   * razonamiento configurado de siempre; se lo pasamos tal cual a cada
   * llamada al proveedor más abajo, cadena de respaldo y re-pedido forzado
   * incluidos, para que la misma velocidad rija todo el turno.
   *
   * T7/T8 leen esta misma variable para decidir si corren: la revisión
   * automática (combinada con `capacidades.autoReviewForAll`, ver
   * `revisarYCorregir` más abajo) y `aplicaRevisionVisual` (T8, en el
   * `finally`, para el flag `revisionVisualDisponible` del evento "done") —
   * "A fondo suma razonamiento, revisión automática y revisión visual".
   */
  const velocidadEfectiva = resolverVelocidadEfectiva(
    capacidades.puedeElegirVelocidad,
    speed,
    capacidades.velocidadPorDefecto,
  );

  const project = await findProjectForActor(projectId, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  // El tema QUE YA TENÍA el recurso antes de este turno (T2): se lee UNA
  // sola vez, acá, sobre el HTML con el que arrancó el turno. `project` es
  // una copia local — nada más abajo reasigna `project.currentHtml` — así
  // que esta lectura sigue representando "el tema previo" durante todo el
  // turno, aunque el modelo no repita el meta en su respuesta.
  const temaProyecto = temaDe(project.currentHtml);

  // T4 ("Deshacer cambios de la IA"): el HTML con el que arrancó ESTE turno,
  // para poder comparar al final contra lo que terminó persistido y decidir
  // si hace falta una instantánea. Mismo fundamento que `temaProyecto` de
  // arriba: `project` es una copia local que nadie reasigna, así que esta
  // lectura sigue siendo válida durante todo el turno.
  const htmlAlInicioDelTurno = project.currentHtml;

  /**
   * T9 (odd/tasks/modo-prime.md, "Varias versiones al crear un recurso"):
   * capacidad × recurso todavía en blanco × lo pedido, en ese orden — mismo
   * patrón que `velocidadEfectiva` de arriba resuelve `speed`. Nunca se
   * confía en `variants` a solas: sin `puedePedirVersiones`, o con un
   * recurso que ya no es el de arranque, esto da `false` sin importar lo
   * que haya mandado el cliente.
   */
  const solicitaVersiones =
    variantesEfectivas({
      puedePedirVersiones: capacidades.puedePedirVersiones,
      esRecursoInicial: esRecursoInicial(htmlAlInicioDelTurno),
      variantsPedidas: variants,
    }) === 3;

  // M8 (design.md §7): un admin mandando un turno en un recurso ajeno deja
  // la marca en el Project ANTES de gastar nada, y `actuaComoAdmin` decide
  // si el mensaje del docente que se crea más abajo lleva `authorUserId`
  // (nunca la respuesta de la IA — esa no la "escribió" nadie).
  const actuaComoAdmin = await marcarSiActuaAdmin(project, user);

  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, projectId: project.id },
    select: { id: true },
  });
  if (!thread) return fail('El hilo de conversación no existe.', 404);

  /**
   * El motor lo decide el catálogo, no el pedido a ciegas.
   *
   * Lo que llega en el body —o lo que quedó guardado en el proyecto— se
   * normaliza contra `AiModel`: si el id no existe o el motor está apagado,
   * cae al default vigente. Async porque el catálogo vive en la base, con
   * caché de 30s (ver `lib/ai/catalogo.ts`).
   */
  const provider = await normalizarMotor(model ?? project.aiModelId, capacidades.prime);
  if (!provider) {
    return fail('No hay ningún motor de IA habilitado. Avisale a un administrador.', 503);
  }

  if (provider.id !== project.aiModelId) {
    await prisma.project.update({
      where: { id: project.id },
      data: { aiModelId: provider.id },
    });
  }

  const [globalRules, userRules, assets, history] = await Promise.all([
    prisma.customRule.findMany({
      where: { isGlobal: true, isActive: true },
      select: { title: true, content: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.customRule.findMany({
      where: { userId: user.id, isActive: true },
      select: { title: true, content: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.projectAsset.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'asc' },
    }),
    // Los ÚLTIMOS N mensajes: se piden en orden descendente y se dan vuelta.
    // Con `asc` + `take` se mandarían los primeros, que es justo lo contrario de
    // lo que necesita el contexto en una conversación larga.
    //
    // `undoneAt: null` (T4): un turno deshecho no existió para el modelo —se
    // excluye ACÁ, en el origen, y no con un filtro más abajo— así que tanto
    // los mensajes que arma `messages` como `turnosPrevios` (que cuenta sobre
    // este mismo array) quedan consistentes solos, sin ningún criterio
    // duplicado.
    prisma.chatMessage.findMany({
      where: { threadId: thread.id, undoneAt: null },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { role: true, content: true },
    }),
  ]);

  const assetContexts = assets.map((asset) => ({
    filename: asset.filename,
    url: asset.url,
    fileType: asset.fileType,
    extractedText: asset.extractedText,
  }));

  // Un pedido larguísimo no entra en la ventana de contexto del modelo junto con
  // el HTML del recurso y el historial. Se avisa acá, con el número y con la
  // salida concreta, en vez de dejar que la API lo rechace con su propio error.
  if (message.length > provider.maxInputChars) {
    const otro = await motorConCapacidad(provider, message.length, capacidades.prime);

    return fail(
      `Tu mensaje tiene ${message.length.toLocaleString('es-AR')} caracteres y ${provider.label} ` +
        `admite hasta ${provider.maxInputChars.toLocaleString('es-AR')}. ` +
        (otro
          ? `Con ${otro.label} entra: cambiá el modelo y volvé a mandarlo.`
          : 'Mandalo en dos partes: primero el contexto, después el pedido.'),
      413,
      otro ? { fallbackModel: otro.id, fallbackLabel: otro.label } : {},
    );
  }

  /**
   * El tope de la demo (design.md §8; specs/demo-mode/spec.md — "Token
   * ceiling is the only cap"). Es GLOBAL a la cuenta compartida, no por
   * motor como el tope de abajo — una tarde abusiva en un solo motor no
   * debería poder esquivarlo cambiando de proveedor.
   *
   * No hay rate limiting en ningún lugar de este repo (ni en
   * `/api/auth/login`, ni acá, ni en `/api/uploads`): este tope de tokens es
   * el único techo real para la demo. Un visitante puede llamar
   * `/api/auth/demo` mil veces y cada llamada abre una cookie de la MISMA
   * cuenta, así que el tope de abajo sigue rigiendo el gasto — pero nada
   * acota cuántos uploads o recursos de galería puede generar antes de
   * llegar a él. Eso se acota después, a mano, con el purgado de
   * `/admin/demo`, no acá.
   */
  if (user.isDemo) {
    const consumidos = await consumoDeLaDemo();
    if (consumidos >= settings.demoTokenLimit) {
      return fail(
        'La demo ya usó todo el crédito de esta ronda. Si querés seguir armando recursos, creá tu cuenta: es gratis y tus recursos quedan guardados.',
        429,
        { registerUrl: '/register' },
      );
    }
  }

  // El tope por usuario se chequea ANTES de gastar: avisar después de consumir
  // no sirve de nada. Se ofrece el otro motor, que es la salida real.
  if (provider.userTokenLimit > 0) {
    const usados = await consumedTokens(user.id, provider.id, provider.userTokenWindowHours);
    if (usados >= provider.userTokenLimit) {
      const otro = await motorConCapacidad(provider, 0, capacidades.prime);
      return fail(
        `Alcanzaste tu tope de ${provider.userTokenLimit.toLocaleString('es-AR')} tokens en ${provider.label}` +
          // Con ventana el tope se repone solo, así que decirlo cambia por
          // completo el mensaje: no es "andá a pedir permiso", es "esperá".
          (provider.userTokenWindowHours > 0
            ? ` (se mide sobre las últimas ${provider.userTokenWindowHours} horas y se va reponiendo solo). `
            : '. ') +
          (otro
            ? `Podés seguir ahora mismo cambiando el modelo a ${otro.label}.`
            : provider.userTokenWindowHours > 0
              ? 'Probá de nuevo más tarde, o pedile más cupo a la administración.'
              : 'Pedile más cupo a la administración.'),
        429,
      );
    }
  }

  // Hoisted desde más abajo (era `const forzar = pideCambio(message)` dentro
  // del `ReadableStream.start`, design §10.3): es pura, así que subirla acá
  // no cambia el comportamiento, y `buildSystemPrompt` la necesita para la
  // regla de colisión con la guía de preguntas tempranas.
  const forzar = pideCambio(message);

  const systemPrompt = buildSystemPrompt({
    globalRules,
    userRules,
    assets: assetContexts,
    currentHtml: project.currentHtml,
    projectTitle: project.title,
    canSeeImages: supportsVision(provider),
    htmlEditedByTeacher: codeEditedByTeacher ?? false,
    // Sólo turnos del DOCENTE, sin contar el mensaje actual (no está en
    // `history`) y sin contar respuestas de la IA: un turno fallido que dejó
    // una disculpa (`role: 'assistant'`) no debe envejecer el hilo para algo
    // que el docente nunca dijo.
    turnosPrevios: history.filter((entry) => entry.role === 'user').length,
    herramientaForzada: forzar,
  });

  const userContent = await buildUserContent(
    message,
    attachmentUrls ?? [],
    assets.filter((asset) => asset.fileType === 'image').map((asset) => asset.url),
    provider,
  );

  // T9: cualquier turno nuevo del proyecto invalida las versiones guardadas
  // de turnos anteriores (ver la tarea: "the next turn removes ... the
  // stored versions") — se hace para TODO turno, sea o no de versiones:
  // `currentHtml` está por cambiar de cualquier manera, así que cualquier
  // versión vieja guardada deja de tener sentido apenas este turno arranca.
  // Por proyecto entero y no por hilo, mismo alcance que `hayTurnoEnCurso`:
  // `currentHtml` es del proyecto, no de un hilo puntual.
  await prisma.resourceVariant.deleteMany({
    where: { chatMessage: { thread: { projectId: project.id } } },
  });

  // Se persiste ANTES de llamar a la IA: si el turno se corta, el docente no
  // pierde lo que escribió.
  //
  // Se guarda el `id` (T4): el cliente agrega este mensaje a su estado de
  // forma optimista, ANTES de que exista la fila (con un id local que no
  // significa nada para el servidor). Sin mandar acá el id real, el cliente
  // nunca podría reconocer más tarde a ESTE mensaje puntual si el docente
  // deshace el turno — el id que compara `undoneMessageIds` no sería el
  // mismo que el que quedó en pantalla.
  const mensajeDocenteGuardado = await prisma.chatMessage.create({
    data: {
      threadId: thread.id,
      role: 'user',
      content: message,
      attachments: attachmentUrls?.length ? JSON.stringify(attachmentUrls) : null,
      authorUserId: actuaComoAdmin ? user.id : null,
    },
    select: { id: true },
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...[...history].reverse().map((entry) => ({
      role: entry.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: entry.content,
    })),
    { role: 'user', content: userContent },
  ];

  /**
   * T9: versiones 2 y 3 son llamadas APARTE, con el MISMO contexto que
   * `messages` (historial + turno actual, sin tocar) pero con la directiva
   * de esa versión sumada al system prompt. La versión 1 sigue el camino de
   * siempre (`messages`, de acá para abajo) salvo que también suma la
   * suya — pedirle al modelo una frase de presentación para el chat, que
   * igual se descarta al persistir (ver `contenidoMensajeDeVersiones`, más
   * abajo).
   */
  let messagesV2: ChatMessage[] | null = null;
  let messagesV3: ChatMessage[] | null = null;
  if (solicitaVersiones) {
    const historialYUsuario = messages.slice(1);
    messages[0] = { role: 'system', content: `${systemPrompt}\n\n## Versión 1 de 3\n${directivaDeVersion(1)}` };
    messagesV2 = [
      { role: 'system', content: `${systemPrompt}\n\n## Versión 2 de 3\n${directivaDeVersion(2)}` },
      ...historialYUsuario,
    ];
    messagesV3 = [
      { role: 'system', content: `${systemPrompt}\n\n## Versión 3 de 3\n${directivaDeVersion(3)}` },
      ...historialYUsuario,
    ];
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Una vez que el navegador se va, el controller queda cerrado y cualquier
      // enqueue tira ERR_INVALID_STATE. Envolverlo evita que un cliente que se
      // desconecta rompa el guardado del turno.
      let closed = false;
      const send = (payload: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(sseFrame(payload));
        } catch {
          closed = true;
        }
      };

      /**
       * Vista previa progresiva (T3, "Progresivo" en Decisiones del dueño):
       * los deltas crudos de `update_resource_code` se acumulan y se mandan
       * agrupados, no uno por delta — un delta de red puede ser de unos
       * pocos bytes, y un frame SSE por cada uno multiplicaría el tráfico
       * sin agregarle nada al docente (que igual no puede seguir un HTML que
       * cambia más rápido que una vez por segundo, ver PreviewPanel). Se
       * manda cuando pasan ~200ms desde el último envío O cuando el buffer
       * junta unos pocos KB, lo que llegue primero.
       */
      const CODE_DELTA_BATCH_MS = 200;
      const CODE_DELTA_BATCH_BYTES = 4_096;

      let codeDeltaBuffer = '';
      let codeDeltaTimer: ReturnType<typeof setTimeout> | null = null;

      function limpiarTimerCodeDelta() {
        if (codeDeltaTimer) {
          clearTimeout(codeDeltaTimer);
          codeDeltaTimer = null;
        }
      }

      function flushCodeDelta() {
        limpiarTimerCodeDelta();
        if (!codeDeltaBuffer) return;
        send({ type: 'code_delta', delta: codeDeltaBuffer });
        codeDeltaBuffer = '';
      }

      /** Tira el buffer sin mandarlo: para cuando lo que sigue YA lo
       *  reemplaza (el `code` final, con el documento entero). */
      function descartarCodeDelta() {
        limpiarTimerCodeDelta();
        codeDeltaBuffer = '';
      }

      /**
       * El parcial que el cliente venía armando dejó de valer: un reintento
       * por saturación, el salto al siguiente motor de la cadena, o el
       * re-pedido forzado arrancan un tool call NUEVO que no tiene nada que
       * ver con lo que se venía mostrando. Sin este aviso el iframe de vista
       * previa seguiría mezclando el HTML viejo con el que llega ahora.
       */
      function reiniciarCodeDelta() {
        descartarCodeDelta();
        send({ type: 'code_reset' });
      }

      function encolarCodeDelta(delta: string) {
        codeDeltaBuffer += delta;
        if (codeDeltaBuffer.length >= CODE_DELTA_BATCH_BYTES) {
          flushCodeDelta();
          return;
        }
        if (!codeDeltaTimer) {
          codeDeltaTimer = setTimeout(flushCodeDelta, CODE_DELTA_BATCH_MS);
        }
      }

      // Un byte apenas arranca: a partir de acá la conexión ya tiene tráfico y
      // ningún intermediario la puede dar por muerta.
      try {
        controller.enqueue(encoder.encode(': abierto\n\n'));
      } catch {
        closed = true;
      }

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      /**
       * El pedido al proveedor va ACÁ ADENTRO, no antes de devolver la Response.
       *
       * Hecho afuera, el servidor se quedaba sin mandar un solo byte durante
       * todo el tiempo que el proveedor tardaba en contestar las cabeceras —y
       * con una imagen en base64 encima, ese rato es largo—. Para el proxy del
       * medio esa conexión nunca arrancó, la corta con un 502, y como el corte
       * no pasa por nuestro código no queda ni una línea en los logs: justo el
       * 502 sin rastro que veíamos. Adentro del stream, el keepalive ya está
       * corriendo mientras se espera.
       */
      // Trazas con tiempos: cuando un turno se cae, lo primero que hace falta
      // saber es si tardó el proveedor en contestar o si se cortó a mitad del
      // stream. Sin esto, un 502 no dejaba ni una línea.
      const arranque = Date.now();
      const transcurrido = () => `${((Date.now() - arranque) / 1000).toFixed(1)}s`;
      console.log(
        `[chat/stream] inicio proyecto=${project.id} motor=${provider.id} (${provider.label}) mensaje=${message.length}c imagenes=${Array.isArray(userContent) ? userContent.length - 1 : 0}`,
      );

      /**
       * Pide el turno, y si el principal no da más cae solo al respaldo.
       *
       * El docente no tiene por qué enterarse de que un proveedor está caído ni
       * tener que elegir otro a mano: se avisa qué pasó y se sigue trabajando.
       * `forzar` ya se calculó más arriba, antes de armar el system prompt.
       */
      const pedirA = (usado: ProviderConfig, intentos: number) =>
        requestCompletionStream({
          messages,
          provider: usado,
          signal: request.signal,
          forzarHerramienta: forzar,
          velocidad: velocidadEfectiva,
          onReintento: (intento, esperaMs) => {
            console.warn(`[chat/stream] ${usado.label} saturado, reintento ${intento} en ${esperaMs}ms`);
            // T3: un reintento arranca un pedido nuevo — cualquier parcial
            // que el cliente tuviera del intento anterior queda obsoleto.
            reiniciarCodeDelta();
            send({
              type: 'notice',
              message: `${usado.label} está saturado. Reintentando (${intento} de ${intentos})…`,
            });
          },
        });

      /**
       * Se recorre la cadena de respaldo del motor elegido, en el orden que
       * marca `fallbackModelId` (ver catalogo.ts). El docente no tiene que
       * enterarse de que un proveedor está caído ni elegir otro a mano; se le
       * avisa qué pasó y se sigue trabajando.
       */
      const motores = await cadenaDeMotores(provider.id, capacidades.prime);
      let upstream: Response | null = null;
      let proveedorUsado = provider;
      let ultimaFalla: unknown = null;
      // T9: promesas de las versiones 2 y 3 — `Promise.resolve(null)` por
      // default (turno sin versiones, o cadena de respaldo que nunca llegó
      // a conectar), reasignadas más abajo apenas la 1 tiene `upstream`.
      let promesaV2: Promise<string | null> = Promise.resolve(null);
      let promesaV3: Promise<string | null> = Promise.resolve(null);

      try {
        for (const [indice, motor] of motores.entries()) {
          try {
            if (indice > 0) {
              console.warn(
                `[chat/stream] ${motores[indice - 1]!.label} no respondió a los ${transcurrido()}; se pasa a ${motor.label}`,
              );
              // T3: se va a pedir de nuevo desde cero con otro motor.
              reiniciarCodeDelta();
              send({
                type: 'notice',
                message: `${motores[indice - 1]!.label} no respondió después de varios intentos. Sigo con ${motor.label}.`,
              });
            }

            upstream = await pedirA(motor, REINTENTOS_VISIBLES);
            proveedorUsado = motor;
            break;
          } catch (falla) {
            // Un abort es el docente tocando "Detener": no se busca otro motor.
            if (falla instanceof ProviderError && falla.status === 499) throw falla;
            ultimaFalla = falla;
          }
        }

        if (!upstream) throw ultimaFalla ?? new ProviderError('Ningún motor de IA respondió.');

        console.log(
          `[chat/stream] ${proveedorUsado.label} respondió cabeceras en ${transcurrido()}`,
        );

        /**
         * T9: acá arrancan (si corresponde) las versiones 2 y 3 — recién
         * ahora, con la 1 ya conectada (headers recibidos). Si la cadena de
         * respaldo entera hubiera fallado, el `catch` de abajo corta el
         * turno antes de llegar hasta acá, así que no se gasta en dos
         * llamadas más para un turno que ya se sabe que no va a andar. De
         * acá en más SÍ corren en paralelo con el cuerpo de la 1
         * (`consumir(upstream)`, más abajo): son pedidos HTTP aparte, que no
         * esperan a que la 1 termine de escribir.
         */
        if (solicitaVersiones && messagesV2 && messagesV3) {
          // Anuncio: las tres van a existir (T9, "Progresivo") — el cliente
          // arma la fila de chips con las tres en estado pendiente, antes de
          // que ninguna termine.
          send({ type: 'variant', index: 1, ready: false });
          send({ type: 'variant', index: 2, ready: false });
          send({ type: 'variant', index: 3, ready: false });

          const promptBaseVersiones = {
            globalRules,
            userRules,
            assets: assetContexts,
            projectTitle: project.title,
            turnosPrevios: history.filter((entry) => entry.role === 'user').length,
          };

          const generar = (indice: 2 | 3, mensajesDeEsaVersion: ChatMessage[]) =>
            generarVersionSecundaria({
              indice,
              mensajes: mensajesDeEsaVersion,
              provider,
              temaProyecto,
              velocidadEfectiva,
              autoReviewForAll: capacidades.autoReviewForAll,
              promptBase: promptBaseVersiones,
              userId: user.id,
              projectId: project.id,
              signal: request.signal,
            })
              .then((html) => {
                // `ready: true` SÓLO si de verdad generó algo: una que
                // falla se queda pendiente para siempre desde el punto de
                // vista del cliente, y el "done" (más abajo) es quien la da
                // por descartada — nunca se anuncia lista una versión que
                // no existe.
                if (html) send({ type: 'variant', index: indice, ready: true });
                return html;
              })
              .catch((error) => {
                console.error(`[chat/stream] versión ${indice}: falla inesperada, se descarta:`, error);
                return null;
              });

          promesaV2 = generar(2, messagesV2);
          promesaV3 = generar(3, messagesV3);
        }
      } catch (error) {
        console.error(`[chat/stream] fallaron todos los motores a los ${transcurrido()}:`, (error as Error).message);
        const detalle = (error as Error).message;

        // Sin botón de "probar con otro": la cadena entera ya se recorrió, así
        // que ofrecerlo sería mandarlo a repetir lo que acaba de fallar.
        send({ type: 'error', message: detalle });

        // Se deja constancia en el hilo: si no, el último mensaje sigue siendo
        // el del docente y al recargar la página el editor se queda esperando
        // una respuesta que nunca va a llegar.
        try {
          const saved = await prisma.chatMessage.create({
            data: { threadId: thread.id, role: 'assistant', content: `No pude completar el pedido. ${detalle}` },
            select: { id: true },
          });
          send({
            type: 'done',
            messageId: saved.id,
            userMessageId: mensajeDocenteGuardado.id,
            codeUpdated: false,
            content: `No pude completar el pedido. ${detalle}`,
          });
        } catch (dbError) {
          console.error('[chat/stream] no se pudo registrar el fallo del proveedor:', dbError);
        }

        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* el navegador ya se había ido */
          }
        }
        return;
      }

      let assistantText = '';
      let generatedHtml: string | null = null;
      // Diagnóstico legible cuando el código no se pudo aplicar. Se guarda en el
      // hilo junto con la explicación de la IA: si no, el modelo dice "listo,
      // cambié el fondo", el recurso no cambia y el docente no entiende por qué.
      let codeProblem: string | null = null;
      let finishReason = '';
      /**
       * Va en un objeto y no en un `let` suelto porque lo completa `consumir`,
       * que es una función anidada: con una variable suelta, el análisis de
       * flujo de TypeScript la da por null para siempre y termina tipando el
       * consumo como `never`.
       */
      const totales: { usage: MotorTokenUsage | null } = {
        usage: null,
      };

      /** Consume un pase completo del proveedor, acumulando en las variables. */
      async function consumir(respuesta: Response) {
        for await (const event of readCompletionStream(respuesta)) {
          if (event.type === 'text') {
            assistantText += event.delta;
            send({ type: 'text', delta: event.delta });
            continue;
          }

          if (event.type === 'tool_start') {
            // El tool call puede tardar un rato largo en completarse; avisamos
            // apenas arranca para que el chat deje de decir que está escribiendo.
            send({ type: 'code_start' });
            continue;
          }

          if (event.type === 'tool_delta') {
            // Sólo interesa el tool call que escribe el recurso (T3): otra
            // herramienta que algún día se agregue no tiene por qué
            // alimentar la vista previa en vivo.
            if (event.name === UPDATE_RESOURCE_CODE) encolarCodeDelta(event.delta);
            continue;
          }

          if (event.type === 'usage') {
            totales.usage = event.usage;
            continue;
          }

          if (event.type === 'finish') {
            finishReason = event.reason;
            continue;
          }

          if (event.type === 'tool' && event.name === UPDATE_RESOURCE_CODE) {
            const result = parseUpdateResourceArgs(event.arguments, event.truncated);

            // El código final reemplaza al parcial: se descarta el buffer sin
            // mandarlo (mandarlo primero sería un frame de más justo antes
            // del documento entero).
            descartarCodeDelta();

            if (result.ok) {
              const html = aplicarKitAlTurno(result.html, temaProyecto);
              generatedHtml = html;
              codeProblem = null;
              send({ type: 'code', html });
            } else {
              codeProblem = CODE_PROBLEMS[result.reason];
              send({ type: 'error', message: codeProblem });
            }
          }
        }
      }

      /**
       * T7 ("Revisión automática (lint + una corrección) y turnos
       * progresivos", odd/tasks/modo-prime.md). Se llama sólo cuando el
       * primer pase dejó HTML y la política del turno la pide (A fondo o
       * `autoReviewForAll` — ver el llamador, más abajo).
       *
       * El primer pase YA se mandó por SSE (`send({type:'code'...})`, dentro
       * de `consumir`/los rescates de arriba) — acá además se PERSISTE de
       * una, sin esperar al `finally` del turno: si el docente recarga
       * mientras esto corre, tiene que encontrar el primer pase, no una
       * pantalla esperando algo que puede tardar (decisión del dueño,
       * "Progresivo"). El snapshot de deshacer (T4) no se toca acá: sigue
       * viviendo en el `finally`, comparado contra `htmlAlInicioDelTurno` —
       * esta función sólo decide qué HTML termina en `generatedHtml` (y por
       * lo tanto en `Project.currentHtml`) al final del turno, nunca cuántas
       * instantáneas se crean.
       *
       * Nunca vuelve a tirar: cualquier problema de la corrección (error de
       * red, JSON inválido, truncado, el docente cancelando el turno) se
       * loguea y se sale en silencio, dejando el primer pase tal cual llegó
       * — nunca un error visible que tape un resultado que ya estaba bien.
       *
       * `const` con función flecha y NO `function` con nombre a propósito:
       * TypeScript no arrastra el chequeo `if (!project) return fail(...)`
       * de más arriba adentro de una función declarada con `function` (el
       * hoisting le impide asumir que ese chequeo ya corrió), pero sí lo
       * hace para una función flecha asignada a un `const` — que es
       * exactamente lo que esta función necesita para usar `project.id` sin
       * un chequeo redundante.
       */
      const revisarYCorregir = async (): Promise<void> => {
        if (!generatedHtml) return;
        const primeraPasada = generatedHtml;

        try {
          // El HTML de arranque de un proyecto (`DEFAULT_HTML`, sin tema ni
          // contenido real) no cuenta como "el docente ya tenía algo": se
          // normaliza a `null` para que `revisarHtml` trate este turno como
          // un recurso NUEVO (informa todo, no sólo el diff) — mismo
          // criterio que describe la tarea.
          const anteriorParaRevision =
            htmlAlInicioDelTurno === DEFAULT_HTML || htmlAlInicioDelTurno.trim().length === 0
              ? null
              : htmlAlInicioDelTurno;

          const hallazgos = revisarHtml(primeraPasada, { anterior: anteriorParaRevision });
          if (hallazgos.length === 0) return;

          console.log(
            `[chat/stream] revisión automática: ${hallazgos.length} hallazgo(s) (${hallazgos
              .map((h) => h.codigo)
              .join(', ')}) a los ${transcurrido()}`,
          );

          try {
            await prisma.project.update({ where: { id: project.id }, data: { currentHtml: primeraPasada } });
          } catch (error) {
            console.error('[chat/stream] no se pudo persistir el primer pase antes de revisar:', error);
          }

          send({ type: 'phase', phase: 'revisando' });

          const mensajeHallazgos = [
            'Revisión automática antes de entregarle el recurso al docente. Corregí SÓLO esto, sin cambiar nada más del recurso:',
            ...hallazgos.map((hallazgo, indice) => {
              const ejemplos =
                hallazgo.ejemplos && hallazgo.ejemplos.length > 0
                  ? ` Ejemplos: ${hallazgo.ejemplos.join(', ')}.`
                  : '';
              return `${indice + 1}. ${hallazgo.instruccion}${ejemplos}`;
            }),
          ].join('\n');

          // El prompt de sistema se arma EXACTAMENTE como siempre
          // (`buildSystemPrompt`), pero con el primer pase como "el recurso
          // actual": la REGLA MÁS IMPORTANTE ("se EDITA lo que ya existe")
          // sigue rigiendo también para esta llamada, así que el modelo no
          // reescribe de cero para corregir dos degradados. Sin historial:
          // es un pedido mecánico y autocontenido, no una conversación.
          const systemPromptRevision = buildSystemPrompt({
            globalRules,
            userRules,
            assets: assetContexts,
            currentHtml: primeraPasada,
            projectTitle: project.title,
            canSeeImages: supportsVision(proveedorUsado),
            htmlEditedByTeacher: false,
            turnosPrevios: history.filter((entry) => entry.role === 'user').length,
            herramientaForzada: true,
          });

          let htmlCorregido: string | null = null;
          let motivoFalla: string | null = null;
          const totalesRevision: { usage: MotorTokenUsage | null } = { usage: null };

          try {
            const respuestaRevision = await requestCompletionStream({
              messages: [
                { role: 'system', content: systemPromptRevision },
                { role: 'user', content: mensajeHallazgos },
              ],
              provider: proveedorUsado,
              signal: request.signal,
              forzarHerramienta: true,
              // Mecánico, no creativo: razonamiento OFF para esta llamada
              // puntual, sin importar la velocidad efectiva del turno —
              // misma vía que usa T6 (`razonamientoEfectivo(proveedor,
              // 'fast')` ya da "reasoning_effort: none"/"thinking:
              // disabled" según el dialecto del motor, o nada si no tiene
              // uno configurado).
              velocidad: 'fast',
            });

            for await (const event of readCompletionStream(respuestaRevision)) {
              // A propósito NUNCA se reenvían `code_start`/`code_delta` de
              // esta llamada: la vista previa tiene que seguir mostrando el
              // primer pase completo hasta que la corrección termine — de
              // otro modo, reconstruir el documento desde cero se vería
              // como un retroceso, no como una corrección (ver la tarea).
              if (event.type === 'usage') {
                totalesRevision.usage = event.usage;
                continue;
              }
              if (event.type === 'tool' && event.name === UPDATE_RESOURCE_CODE) {
                const resultado = parseUpdateResourceArgs(event.arguments, event.truncated);
                if (resultado.ok) {
                  htmlCorregido = aplicarKitAlTurno(resultado.html, temaProyecto);
                } else {
                  motivoFalla = resultado.reason;
                }
              }
            }
          } catch (error) {
            motivoFalla = (error as Error).message;
          }

          // Se registra como una llamada aparte (mismo motor, mismos
          // precios): sumarlo a `totales.usage` del turno principal
          // pisaría/perdería el consumo del primer pase, porque más abajo
          // sólo se graba UNA vez con el último valor recibido.
          if (totalesRevision.usage) {
            await recordUsage({
              userId: user.id,
              projectId: project.id,
              aiModelId: proveedorUsado.id,
              model: proveedorUsado.model,
              promptTokens: totalesRevision.usage.promptTokens,
              cachedInputTokens: totalesRevision.usage.cachedTokens,
              completionTokens: totalesRevision.usage.completionTokens,
              precios: proveedorUsado.precios,
            }).catch((error) =>
              console.error('[chat/stream] no se pudo registrar el consumo de la corrección:', error),
            );
          }

          if (!htmlCorregido) {
            console.warn(
              `[chat/stream] la corrección automática no se aplicó (${motivoFalla ?? 'sin HTML'}); queda el primer pase`,
            );
            return;
          }

          const hallazgosRestantes = revisarHtml(htmlCorregido, { anterior: anteriorParaRevision });
          if (hallazgosRestantes.length > 0) {
            console.warn(
              `[chat/stream] tras la corrección quedan ${hallazgosRestantes.length} hallazgo(s) (${hallazgosRestantes
                .map((h) => h.codigo)
                .join(', ')}); no se reintenta una segunda vez`,
            );
          }

          generatedHtml = htmlCorregido;
          descartarCodeDelta();
          send({ type: 'code', html: htmlCorregido });

          try {
            await prisma.project.update({ where: { id: project.id }, data: { currentHtml: htmlCorregido } });
          } catch (error) {
            console.error('[chat/stream] no se pudo persistir la corrección automática:', error);
          }
        } catch (error) {
          // Red de seguridad: nada de acá tiene que poder tirar abajo un
          // turno cuyo primer pase ya está bien.
          console.error('[chat/stream] revisión automática: falla inesperada, se deja el primer pase:', error);
        }
      };

      try {
        await consumir(upstream);

        /**
         * Se pidió un cambio y no llegó código. Antes de darlo por perdido:
         *
         * 1) Puede que el modelo haya escrito el HTML en el texto en vez de
         *    llamar la herramienta. Ese trabajo se rescata en vez de tirarlo.
         * 2) Si no, se le vuelve a pedir una sola vez. Un reintento y no más:
         *    si tampoco así lo hace, es mejor decirlo que quedar en un bucle.
         */
        if (forzar && !generatedHtml && !codeProblem) {
          const rescatado = rescatarHtmlDelTexto(assistantText);

          if (rescatado) {
            console.warn(`[chat/stream] el HTML vino en el texto; se rescata a los ${transcurrido()}`);
            const html = aplicarKitAlTurno(rescatado.html, temaProyecto);
            generatedHtml = html;
            assistantText = rescatado.resto;
            descartarCodeDelta();
            send({ type: 'code', html });
          }
        }

        if (forzar && !generatedHtml && !codeProblem) {
          console.warn(`[chat/stream] no aplicó el cambio; se re-pide a los ${transcurrido()}`);
          // T3: el re-pedido forzado es un tool call nuevo de cero.
          reiniciarCodeDelta();
          send({ type: 'notice', message: 'Se quedó a mitad de camino. Se lo vuelvo a pedir…' });

          const reintento = await requestCompletionStream({
            messages: [
              ...messages,
              { role: 'assistant', content: assistantText },
              {
                role: 'user',
                content:
                  'Dijiste que ibas a hacerlo pero no llamaste a update_resource_code, así que el recurso quedó igual. Hacelo AHORA: devolvé el documento HTML completo con el cambio aplicado, partiendo del código actual y respetando todo lo demás.',
              },
            ],
            provider: proveedorUsado,
            signal: request.signal,
            forzarHerramienta: true,
            velocidad: velocidadEfectiva,
          });

          await consumir(reintento);

          if (!generatedHtml && !codeProblem) {
            const rescatado = rescatarHtmlDelTexto(assistantText);
            if (rescatado) {
              const html = aplicarKitAlTurno(rescatado.html, temaProyecto);
              generatedHtml = html;
              assistantText = rescatado.resto;
              descartarCodeDelta();
              send({ type: 'code', html });
            }
          }
        }

        /**
         * T9: la versión 1 ya tiene lo que va a tener en el caso normal
         * (tool call directo, rescate del texto, o el re-pedido forzado —
         * las tres rutas de arriba ya corrieron) — se anuncia ACÁ, antes de
         * la corrección de T7 de abajo, para que su chip pase a "lista" tan
         * pronto como exista, sin esperar a que la 2 y la 3 (que corren en
         * paralelo desde mucho antes) también terminen. Si A fondo o
         * `autoReviewForAll` todavía la mejoran, no hace falta un segundo
         * aviso: el chip ya está listo, y elegirla siempre relee el HTML
         * vigente del servidor recién en ese momento (ver
         * `POST /api/projects/[id]/variant`), nunca el de este evento.
         */
        if (solicitaVersiones && generatedHtml) {
          send({ type: 'variant', index: 1, ready: true });
        }

        // T7: A fondo suma revisión automática, y lo mismo vale para
        // cualquiera a quien el admin se la prendió "para todos" — misma
        // combinación que ya anticipaba el comentario de `autoReviewForAll`
        // en `capacidades.ts`. `velocidadEfectiva` ya es `null` (nunca
        // 'deep') para quien no tiene permiso de elegir velocidad, así que
        // esto nunca se dispara por accidente para un docente común sin la
        // bandera "para todos".
        if (generatedHtml && (velocidadEfectiva === 'deep' || capacidades.autoReviewForAll)) {
          await revisarYCorregir();
        }
      } catch (error) {
        console.error('[chat/stream]', error);
        send({ type: 'error', message: 'Se cortó la conexión con el motor de IA.' });
      } finally {
        // T3: no debe quedar un timer de batching de code_delta corriendo
        // después de este punto.
        limpiarTimerCodeDelta();

        // El consumo se registra aunque el turno se haya cortado: los tokens ya
        // se gastaron igual.
        // Campo por campo y sin spread: `usage` se completa dentro de `consumir`,
        // así que el análisis de flujo de TypeScript lo da por null en este
        // punto y un spread de ahí no compila.
        if (totales.usage) {
          await recordUsage({
            userId: user.id,
            projectId: project.id,
            aiModelId: proveedorUsado.id,
            model: proveedorUsado.model,
            promptTokens: totales.usage.promptTokens,
            cachedInputTokens: totales.usage.cachedTokens,
            completionTokens: totales.usage.completionTokens,
            precios: proveedorUsado.precios,
          }).catch((error) => console.error('[chat/stream] no se pudo registrar el consumo:', error));
        }

        /**
         * T9: se espera a que la 2 y la 3 terminen (o se descarten solas)
         * ANTES de cerrar el turno — el "done" tiene que llegar recién
         * cuando las tres cosas ya se sabe qué pasó, así el cliente arma la
         * fila de chips completa de una, sin un aviso más después del
         * "done". Con `solicitaVersiones` en `false` las dos promesas ya
         * son `Promise.resolve(null)` (ver su declaración más arriba), así
         * que este `await` es inmediato y no cambia en nada el turno de
         * siempre.
         */
        const [resultadoV2, resultadoV3] = solicitaVersiones
          ? await Promise.all([promesaV2, promesaV3])
          : [null, null];

        // Persistir pase lo que pase: si el docente cierra la pestaña a mitad de
        // camino, lo generado hasta ahí queda guardado.
        try {
          if (generatedHtml) {
            await prisma.project.update({
              where: { id: project.id },
              data: { currentHtml: generatedHtml },
            });
          }

          // Un turno que se corta por tope de tokens con texto a medias también
          // merece explicación, aunque el código haya entrado bien.
          const cutNote =
            finishReason === 'length' && !codeProblem
              ? 'La respuesta quedó cortada porque llegué al límite de largo. Pedime lo que falte y sigo.'
              : null;

          const notes = [assistantText.trim(), codeProblem, cutNote].filter(
            (part): part is string => Boolean(part),
          );

          // T9: el texto fijo manda por encima de lo que haya escrito la
          // versión 1 en el chat — pero sólo si de verdad hubo versión 1
          // (`contenidoMensajeDeVersiones` da `null` si `generatedHtml`
          // quedó vacío): sin ella, este turno de versiones falló como
          // cualquier otro y cae al texto de siempre, sin mencionar
          // versiones que no llegaron a existir.
          const finalText =
            contenidoMensajeDeVersiones(solicitaVersiones && Boolean(generatedHtml)) ??
            (notes.length > 0
              ? notes.join('\n\n')
              : generatedHtml
                ? 'Actualicé el recurso.'
                : SILENT_TURN);

          // T9: si esto era un turno de versiones Y la 1 generó algo, se
          // guardan las que hayan salido bien (siempre al menos la 1; la 2
          // y/o la 3 sólo si `generarVersionSecundaria` no las descartó) —
          // mismo `create` anidado de Prisma, misma escritura.
          const versionesParaGuardar =
            solicitaVersiones && generatedHtml
              ? [
                  { index: 1, html: generatedHtml },
                  ...(resultadoV2 ? [{ index: 2, html: resultadoV2 }] : []),
                  ...(resultadoV3 ? [{ index: 3, html: resultadoV3 }] : []),
                ]
              : [];

          const saved = await prisma.chatMessage.create({
            data: {
              threadId: thread.id,
              role: 'assistant',
              content: finalText,
              ...(versionesParaGuardar.length > 0
                ? { chosenVariantIndex: 1, variants: { create: versionesParaGuardar } }
                : {}),
            },
            select: { id: true },
          });

          // T4 ("Deshacer cambios de la IA"): sólo si el turno de verdad
          // cambió el recurso — comparado contra el HTML con el que arrancó,
          // no contra si el modelo llamó o no a la herramienta (podría haber
          // devuelto el documento igual, letra por letra). Una falla acá
          // nunca puede tirar abajo el turno: ya está guardado y respondido,
          // esto es sólo la posibilidad de deshacerlo después.
          //
          // T8 ("Revisión visual con captura"): el mismo booleano es una de
          // las condiciones de `aplicaRevisionVisual` de acá abajo — sin
          // cambio en el recurso no hay nada nuevo que mirar.
          const cambioElHtml = Boolean(generatedHtml && generatedHtml !== htmlAlInicioDelTurno);

          if (cambioElHtml) {
            try {
              await prisma.projectSnapshot.create({
                data: {
                  projectId: project.id,
                  chatMessageId: saved.id,
                  html: htmlAlInicioDelTurno,
                },
              });

              // Poda a las 20 más nuevas (design del dueño: "varios niveles",
              // no infinitos). Se poda DESPUÉS de crear, así la recién creada
              // ya cuenta en el orden.
              const viejas = await prisma.projectSnapshot.findMany({
                where: { projectId: project.id },
                orderBy: { createdAt: 'desc' },
                skip: 20,
                select: { id: true },
              });
              if (viejas.length > 0) {
                await prisma.projectSnapshot.deleteMany({
                  where: { id: { in: viejas.map((vieja) => vieja.id) } },
                });
              }
            } catch (error) {
              console.error('[chat/stream] no se pudo guardar la instantánea para deshacer:', error);
            }
          }

          // T8 ("Revisión visual con captura"): el SERVIDOR decide si
          // corresponde ofrecerla — nunca el cliente por su cuenta (ver la
          // tarea). Se calcula acá, al final del turno, con lo que ya se
          // sabe de esta vuelta completa: la velocidad efectiva, si el
          // motor USADO ve imágenes, y si el turno cambió el recurso. El
          // cliente recién arranca el segundo pedido
          // (`/api/chat/visual-review`) después de leer este "done".
          const revisionVisualDisponible = aplicaRevisionVisual({
            velocidadEfectiva,
            motorVeImagenes: supportsVision(proveedorUsado),
            cambioElRecurso: cambioElHtml,
            // T9 ("Varias versiones"): decisión de diseño "Revisión visual y
            // versiones son excluyentes" — con varias versiones no corre la
            // revisión visual (triplicaría costo y tiempo). Se usa
            // `solicitaVersiones` (lo que este turno PIDIÓ), no cuántas
            // salieron bien: un turno de versiones sigue siendo eso aunque
            // la 2 y la 3 hayan fallado las dos.
            huboVariasVersiones: solicitaVersiones,
          });

          send({
            type: 'done',
            messageId: saved.id,
            userMessageId: mensajeDocenteGuardado.id,
            codeUpdated: Boolean(generatedHtml),
            content: finalText,
            revisionVisualDisponible,
          });
        } catch (error) {
          console.error('[chat/stream] no se pudo persistir el turno:', error);
        }

        clearInterval(heartbeat);
        console.log(
          `[chat/stream] fin en ${transcurrido()} texto=${assistantText.length}c codigo=${Boolean(generatedHtml)} corte=${finishReason || 'ninguno'}`,
        );
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* el navegador ya se había ido */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Evita que Nginx bufferee el stream en producción.
      'X-Accel-Buffering': 'no',
    },
  });
};
