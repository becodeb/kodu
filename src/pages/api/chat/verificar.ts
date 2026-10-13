import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { findProjectForActor, marcarSiActuaAdmin } from '../../../lib/projects.ts';
import { fingerprintHtml } from '../../../lib/ai/fingerprint.ts';
import { desenvolverPruebas } from '../../../lib/ai/kit.ts';
import { motorVerificador } from '../../../lib/ai/catalogo.ts';
import {
  razonamientoVerificador,
  razonamientoRevisorVisual,
  readCompletionStream,
  requestCompletionStream,
  supportsVision,
  type ChatMessage,
  type ProviderConfig,
  type TokenUsage as MotorTokenUsage,
} from '../../../lib/ai/provider.ts';
import {
  construirContenidoUsuarioVerificador,
  construirSistemaVerificador,
  pedidoDocente,
  parsearVerificacion,
  problemaDeBanderaRoja,
  reglasDelArnes,
  unirPasadas,
  MAX_PROBLEMAS,
  type Problema,
} from '../../../lib/ai/verificador.ts';
import { computarDiffTurno, detectarBanderasRojas, resumenDiffParaRevisor } from '../../../lib/ai/turno-diff.ts';
import { consumedTokens, recordUsage } from '../../../lib/ai/usage.ts';
import { recordAiTrace } from '../../../lib/ai/trace.ts';
import { resolverAccesoIa, mensajeAccesoIa } from '../../../lib/orgs/acceso.ts';
import { consumoDeLaDemo } from '../../../lib/demo.ts';
import { leerAppSettings } from '../../../lib/settings.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';

/**
 * POST /api/chat/verificar — T3 (`odd/tasks/verificador.md`): un motor MÁS
 * INTELIGENTE (el marcado `AiModel.isVerifier`, `motorVerificador` en
 * `catalogo.ts`) revisa un recurso DESPUÉS de la autoprueba y devuelve
 * problemas concretos, sin bloquear el chat — el docente decide si los
 * corrige (T4, "¿Las arreglo?", fuera de esta tarea).
 *
 * Mismas puertas que `/api/chat/autocorreccion`, en el mismo orden (ver los
 * comentarios allá para el detalle de cada una): acceso a la IA, demo
 * cerrada, el body, la propiedad del proyecto, la huella contra staleness.
 * A partir de ahí se aparta a propósito de esa plantilla: sin motor
 * verificador, sin cupo (de la demo o del propio motor), la respuesta es
 * `200 {estado:...}` — nunca un error — porque esto corre SOLO, sin que el
 * docente lo haya pedido; un `fail()` ahí sería una alarma sobre algo que
 * el docente ni sabe que se está intentando. DECISIÓN (el texto de la tarea
 * sólo dice esto para el tope por usuario): el tope de la demo se trata
 * igual, mismo motivo — las dos son "sin cupo", no un error del pedido.
 *
 * JSON de una sola respuesta, no SSE: no hay nada que mostrar progresivo acá
 * (T4 pide el resultado completo o nada). Nunca crea `ChatMessage` ni
 * `ProjectSnapshot`, nunca toca `Project.currentHtml` — sólo lee y registra
 * consumo, igual que la autoprueba/autocorrección discretas de T12.
 */

const schema = z.object({
  projectId: z.string().min(1),
  /** `fingerprintHtml` del HTML que se va a verificar — mismo criterio que
   *  `/api/chat/autocorreccion`. */
  fingerprint: z.string().min(1).max(32),
  tipo: z.enum(['nuevo', 'ajuste']),
  /**
   * T5 (motor-claude, revisor visual): data URL JPEG opcional de la vista
   * previa renderizada, mandada best-effort por el cliente
   * (`PreviewPanel`/`Workspace.tsx`). El servidor la usa SÓLO si el motor
   * `isVerifier` configurado soporta visión (`supportsVision`) — con
   * cualquier otro motor, o sin esto, el comportamiento es EXACTAMENTE el
   * de antes de T5. Tope generoso (~1.5MB en base64): nunca un vector de
   * tamaño libre, pero de sobra para un JPEG de 1280px de ancho a calidad
   * 0.8.
   */
  /**
   * T4 round 5 (motor-claude): también acepta un array (hasta 2 — página
   * larga partida "arriba"/"abajo", ver `OpcionesCaptura.paginaCompleta` en
   * `preview.ts`) para no perder contenido agregado "al final" que cae
   * fuera del primer viewport. Un string único sigue andando igual.
   */
  captura: z.union([z.string().max(2_000_000), z.array(z.string().max(2_000_000)).max(2)]).nullish(),
});

/** 150 s por pasada (la tarea lo fija así): un revisor que relee el HTML
 *  entero con razonamiento "medium" puede tardar bastante más que un turno
 *  normal — no hay vista previa progresiva que lo haga sentir más corto. */
const TIMEOUT_PASADA_MS = 150_000;

/** 16.000 tokens de salida alcanzan de sobra para 6 problemas en el JSON
 *  pedido; nunca por encima de lo que el motor puede escribir. */
const MAX_TOKENS_PASADA = 16_000;

interface ResultadoPasada {
  /** `null` = la pasada falló (red, timeout, abort) o no dio un JSON
   *  parseable — las dos cuentan como "pasada fallida" para el llamador. */
  problemas: Problema[] | null;
}

/**
 * Una pasada del verificador: sin herramientas, razonamiento "medium" (o el
 * mapeo del proveedor si es `thinking`), 150 s de tope, y abortada si el
 * cliente se desconecta (`signalExterno`, el `request.signal` del endpoint).
 * Nunca tira: cualquier falla se loguea acá (con el detalle de la pasada,
 * NUNCA la clave) y se devuelve como pasada fallida.
 */
async function ejecutarPasada(args: {
  messages: ChatMessage[];
  provider: ProviderConfig;
  userId: string;
  projectId: string;
  signalExterno: AbortSignal;
  /** T5: "low" para la pasada del revisor VISUAL en vez del "medium" fijo
   *  de siempre — ver `razonamientoRevisorVisual` en `provider.ts`. Sin
   *  esto (como todas las pasadas de antes de T5), el "medium" de
   *  `razonamientoVerificador` sigue siendo el default. */
  razonamiento?: Record<string, unknown>;
}): Promise<ResultadoPasada> {
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), TIMEOUT_PASADA_MS);
  const onAbortExterno = () => controlador.abort();
  args.signalExterno.addEventListener('abort', onAbortExterno, { once: true });

  try {
    const respuesta = await requestCompletionStream({
      messages: args.messages,
      provider: args.provider,
      signal: controlador.signal,
      sinHerramientas: true,
      razonamientoOverride: args.razonamiento ?? razonamientoVerificador(args.provider),
      maxTokensOverride: Math.min(MAX_TOKENS_PASADA, args.provider.maxTokens),
    });

    let texto = '';
    let usage: MotorTokenUsage | null = null;
    for await (const event of readCompletionStream(respuesta, args.provider.apiFormat)) {
      if (event.type === 'text') texto += event.delta;
      else if (event.type === 'usage') usage = event.usage;
    }

    if (usage) {
      await recordUsage({
        userId: args.userId,
        projectId: args.projectId,
        aiModelId: args.provider.id,
        model: args.provider.model,
        promptTokens: usage.promptTokens,
        cachedInputTokens: usage.cachedTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        completionTokens: usage.completionTokens,
        precios: args.provider.precios,
        schedule: args.provider.schedule,
        purpose: 'VERIFICATION',
      }).catch((error) => console.error('[chat/verificar] no se pudo registrar el consumo de una pasada:', error));
    }

    const parseado = parsearVerificacion(texto);
    if (!parseado) {
      console.warn(
        `[chat/verificar] proyecto=${args.projectId}: pasada sin JSON parseable (${texto.length} caracteres recibidos)`,
      );
      return { problemas: null };
    }
    return { problemas: parseado.problemas };
  } catch (error) {
    console.error(`[chat/verificar] proyecto=${args.projectId}: pasada falló:`, error);
    return { problemas: null };
  } finally {
    clearTimeout(timeout);
    args.signalExterno.removeEventListener('abort', onAbortExterno);
  }
}

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;

  // Mismas dos primeras puertas que /api/chat/autocorreccion, mismo orden.
  const accesoIa = await resolverAccesoIa(user);
  if (!accesoIa.allowed) {
    // odd/tasks/planes-y-cobros.md (T2/T3): mensaje concreto por razón
    // (sin créditos / licencia institucional no activa / etc.), un solo
    // lugar lo traduce (mensajeAccesoIa, acceso.ts).
    return fail(mensajeAccesoIa(accesoIa), 403, { reason: accesoIa.reason });
  }

  const settings = await leerAppSettings();
  if (user.isDemo && !settings.demoEnabled) {
    return fail('La demo está cerrada por el momento.', 403);
  }

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }
  const { projectId, fingerprint, tipo, captura } = parsed.data;

  const project = await findProjectForActor(projectId, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  if (fingerprintHtml(project.currentHtml) !== fingerprint) {
    return fail('El recurso cambió después de la autoprueba. Volvé a intentarlo.', 409);
  }

  const provider = await motorVerificador();
  if (!provider) return ok({ estado: 'desactivado' });

  // Sin cupo (de la demo, o del propio motor por usuario): 200 discreto, sin
  // llamar a nada — ver la nota de diseño de arriba del archivo.
  if (user.isDemo) {
    const consumidos = await consumoDeLaDemo();
    if (consumidos >= settings.demoTokenLimit) return ok({ estado: 'sin-cupo' });
  }
  if (provider.userTokenLimit > 0) {
    const usados = await consumedTokens(user.id, provider.id, provider.userTokenWindowHours);
    if (usados >= provider.userTokenLimit) return ok({ estado: 'sin-cupo' });
  }

  // M8 (design.md §7): mismo criterio que stream.ts/autocorreccion.ts.
  await marcarSiActuaAdmin(project, user);

  // El pedido del docente: el primer mensaje "user" no deshecho del
  // proyecto (en cualquier hilo, mismo alcance que `checklistActual`), y —
  // sólo para un ajuste— el ÚLTIMO y, si lo hay, el ANTERIOR a ese (T4
  // round 4: para que el revisor pueda juzgar si ESTE turno dejó sin
  // resolver, o deshizo, lo que el docente pidió en el turno previo).
  const primerMensaje = await prisma.chatMessage.findFirst({
    where: { thread: { projectId: project.id }, role: 'user', undoneAt: null },
    orderBy: { createdAt: 'asc' },
    select: { content: true },
  });

  let mensajeActual: string | null = null;
  let mensajeAnterior: string | null = null;
  if (tipo === 'ajuste') {
    const ultimosDos = await prisma.chatMessage.findMany({
      where: { thread: { projectId: project.id }, role: 'user', undoneAt: null },
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: { content: true },
    });
    const [ultimoMensaje, penultimoMensaje] = ultimosDos;
    if (ultimoMensaje && ultimoMensaje.content !== primerMensaje?.content) {
      mensajeActual = ultimoMensaje.content;
    }
    if (penultimoMensaje && penultimoMensaje.content !== primerMensaje?.content) {
      mensajeAnterior = penultimoMensaje.content;
    }
  }

  const pedido = pedidoDocente(primerMensaje?.content ?? '', mensajeActual, mensajeAnterior);
  // T4 (round 2, motor-claude): mismo fix que `autocorreccion.ts`/`stream.ts`
  // — `project.currentHtml` ya llega con el checklist envuelto en
  // `try{eval("...")}`; el revisor sólo LEE el HTML (no edita nada acá), pero
  // mostrarle el texto escapado igual lo confunde sobre qué es código real.
  const htmlParaRevisor = desenvolverPruebas(project.currentHtml);

  /**
   * T4 round 6 (motor-claude): el HTML de ANTES de este turno
   * (`ProjectSnapshot.html` del último mensaje "assistant" no deshecho —
   * MISMA fila/consulta que `pendienteChequeosPosteriores`,
   * `post-checks-db.ts`) para el chequeo determinístico "¿este ajuste hizo
   * lo que pidieron?" (`turno-diff.ts`). Sólo tiene sentido para un AJUSTE
   * (un recurso nuevo no tiene "antes" que comparar); `null` cuando no hay
   * snapshot (recurso recién creado, o turno sin cambio registrado) — el
   * chequeo entero se salta en silencio, nunca bloquea la verificación de
   * siempre.
   */
  let htmlAntes: string | null = null;
  if (tipo === 'ajuste') {
    const ultimoAsistente = await prisma.chatMessage.findFirst({
      where: { thread: { projectId: project.id }, role: 'assistant', undoneAt: null, snapshot: { isNot: null } },
      orderBy: { createdAt: 'desc' },
      select: { snapshot: { select: { html: true } } },
    });
    htmlAntes = ultimoAsistente?.snapshot?.html ?? null;
  }

  const diffTurno = htmlAntes !== null ? computarDiffTurno(desenvolverPruebas(htmlAntes), htmlParaRevisor) : null;
  // El ÚLTIMO pedido puntual (nunca el histórico combinado): matchear contra
  // pedidos de turnos anteriores ya resueltos dispararía banderas falsas.
  const pedidoParaBanderas = mensajeActual ?? primerMensaje?.content ?? '';
  const banderasRojas = diffTurno ? detectarBanderasRojas(pedidoParaBanderas, diffTurno) : [];
  const resumenDiff = diffTurno ? resumenDiffParaRevisor(diffTurno) : null;

  /**
   * T5 (motor-claude, revisor visual): el único motor que corre acá es el
   * `isVerifier` del catálogo — ya puede ser cualquier `apiFormat`,
   * incluido `'anthropic'` (T1 lo dejó genérico, ver `catalogo.ts`). Con
   * `captura` presente Y el motor soportando visión, se corre UNA sola
   * pasada (nunca 2, aunque sea un recurso nuevo: cuesta el doble de
   * tokens de imagen y el presupuesto de esta pasada es chico) con
   * `razonamientoRevisorVisual` ("low") y el `image_url` de la captura. Sin
   * eso — CUALQUIER motor de antes de T5, o un motor con visión al que el
   * cliente no le mandó captura — el camino es EXACTAMENTE el de siempre:
   * 2 pasadas en paralelo para "nuevo", 1 para "ajuste", "medium" fijo, sin
   * imagen.
   */
  // T4 round 5: `captura` puede ser un array (página larga partida); un
  // array vacío es truthy en JS, así que `Boolean` solo no alcanza.
  const hayCaptura = Array.isArray(captura) ? captura.length > 0 : Boolean(captura);
  const usaVision = hayCaptura && supportsVision(provider);
  const sistema = construirSistemaVerificador(reglasDelArnes(), { conCaptura: usaVision });
  const contenidoUsuario = construirContenidoUsuarioVerificador(
    pedido,
    htmlParaRevisor,
    usaVision ? captura : null,
    resumenDiff,
  );

  const messages: ChatMessage[] = [
    { role: 'system', content: sistema },
    { role: 'user', content: contenidoUsuario },
  ];

  const cantidadPasadas = usaVision ? 1 : tipo === 'nuevo' ? 2 : 1;
  const arranque = Date.now();
  const resultados = await Promise.all(
    Array.from({ length: cantidadPasadas }, () =>
      ejecutarPasada({
        messages,
        provider,
        userId: user.id,
        projectId: project.id,
        signalExterno: request.signal,
        razonamiento: usaVision ? razonamientoRevisorVisual(provider) : undefined,
      }),
    ),
  );

  const listasOk = resultados.filter((r): r is { problemas: Problema[] } => r.problemas !== null);
  const fallidas = resultados.length - listasOk.length;

  // T4 round 6: los problemas sintéticos de las banderas rojas determinísticas
  // van PRIMERO (son evidencia medida, no una opinión del modelo) — así
  // sobreviven el `.slice(0, MAX_PROBLEMAS)` aunque el modelo haya llenado la
  // lista con otros hallazgos.
  const problemasDeterministicos = banderasRojas.map((bandera) => problemaDeBanderaRoja(bandera, pedidoParaBanderas));

  if (listasOk.length === 0) {
    // odd/tasks/ahorro-tokens.md (T4): se registra igual, sin hallazgos —
    // "cuando corre" incluye el caso en que ninguna pasada dio un JSON
    // parseable. Cada pasada ya registró su propia fila de `TokenUsage`
    // (dentro de `ejecutarPasada`) — acá no hay un `tokenUsageId` único que
    // vincular, se deja sin vincular (ver el comentario de `trace.ts`).
    await recordAiTrace({
      userId: user.id,
      projectId: project.id,
      turnKind: 'VERIFICATION',
      model: provider.model,
      reasoningEffort: provider.reasoningEffort,
      requestText: pedido,
      durationMs: Date.now() - arranque,
      verifierFindings: problemasDeterministicos.length > 0 ? problemasDeterministicos.length : null,
    });
    // T4 round 6: aunque las pasadas del modelo fallaron todas, la bandera
    // determinística no depende del modelo — si disparó, sigue siendo
    // evidencia accionable; sin eso, nada que reportar (como siempre).
    if (problemasDeterministicos.length > 0) {
      return ok({ estado: 'ok', problemas: problemasDeterministicos, pasadas: cantidadPasadas, fallidas, usoVision: usaVision, banderaDeterministica: true });
    }
    // Cada pasada ya logueó su propio motivo (arriba, en `ejecutarPasada`)
    // — acá no hay nada más que reportar, y NUNCA se loguea la clave.
    return ok({ estado: 'error' });
  }

  const problemas = [...problemasDeterministicos, ...unirPasadas(listasOk.map((r) => r.problemas))].slice(0, MAX_PROBLEMAS);

  // odd/tasks/motor-claude.md (T4 round 3): temporal, detrás de un env flag
  // — para calibrar la gravedad del revisor visual (¿por qué nunca sale
  // "alta"/"media" con un defecto visual a simple vista?). Quitar o
  // mantener apagado (default) fuera de esta investigación.
  if (process.env.KODU_DEBUG_VERIFICADOR === '1') {
    console.log(
      `[chat/verificar] KODU_DEBUG_VERIFICADOR usoVision=${usaVision} problemas=${problemas.length}:`,
      JSON.stringify(problemas, null, 1),
    );
  }

  await recordAiTrace({
    userId: user.id,
    projectId: project.id,
    turnKind: 'VERIFICATION',
    model: provider.model,
    reasoningEffort: provider.reasoningEffort,
    requestText: pedido,
    durationMs: Date.now() - arranque,
    verifierFindings: problemas.length,
  });

  return ok({
    estado: 'ok',
    problemas,
    pasadas: cantidadPasadas,
    fallidas,
    usoVision: usaVision,
    // T4 round 6: `true` cuando el chequeo determinístico (`turno-diff.ts`)
    // disparó al menos una bandera roja — el cliente lo trata igual que
    // `usoVision` para decidir si corrige en silencio (ver Workspace.tsx):
    // es evidencia tan dura como una captura, no depende de que el modelo
    // haya reportado nada.
    banderaDeterministica: banderasRojas.length > 0,
  });
};
