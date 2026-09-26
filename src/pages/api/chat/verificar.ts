import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { findProjectForActor, marcarSiActuaAdmin } from '../../../lib/projects.ts';
import { fingerprintHtml } from '../../../lib/ai/revision-visual.ts';
import { motorVerificador } from '../../../lib/ai/catalogo.ts';
import {
  razonamientoVerificador,
  readCompletionStream,
  requestCompletionStream,
  type ChatMessage,
  type ProviderConfig,
  type TokenUsage as MotorTokenUsage,
} from '../../../lib/ai/provider.ts';
import {
  construirSistemaVerificador,
  construirUsuarioVerificador,
  pedidoDocente,
  parsearVerificacion,
  reglasDelArnes,
  unirPasadas,
  type Problema,
} from '../../../lib/ai/verificador.ts';
import { consumedTokens, recordUsage } from '../../../lib/ai/usage.ts';
import { puedeUsarLaIa } from '../../../lib/auth/domains.ts';
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
      razonamientoOverride: razonamientoVerificador(args.provider),
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
        completionTokens: usage.completionTokens,
        precios: args.provider.precios,
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
  if (!(await puedeUsarLaIa(user))) {
    return fail('Tu cuenta todavía no tiene habilitado el uso de la IA. Escribinos y lo vemos.', 403);
  }

  const settings = await leerAppSettings();
  if (user.isDemo && !settings.demoEnabled) {
    return fail('La demo está cerrada por el momento.', 403);
  }

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }
  const { projectId, fingerprint, tipo } = parsed.data;

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
  // sólo para un ajuste— el ÚLTIMO, si es distinto del primero.
  const primerMensaje = await prisma.chatMessage.findFirst({
    where: { thread: { projectId: project.id }, role: 'user', undoneAt: null },
    orderBy: { createdAt: 'asc' },
    select: { content: true },
  });

  let mensajeDeAjuste: string | null = null;
  if (tipo === 'ajuste') {
    const ultimoMensaje = await prisma.chatMessage.findFirst({
      where: { thread: { projectId: project.id }, role: 'user', undoneAt: null },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
    if (ultimoMensaje && ultimoMensaje.content !== primerMensaje?.content) {
      mensajeDeAjuste = ultimoMensaje.content;
    }
  }

  const pedido = pedidoDocente(primerMensaje?.content ?? '', mensajeDeAjuste);
  const sistema = construirSistemaVerificador(reglasDelArnes());
  const mensajeUsuario = construirUsuarioVerificador(pedido, project.currentHtml);

  const messages: ChatMessage[] = [
    { role: 'system', content: sistema },
    { role: 'user', content: mensajeUsuario },
  ];

  // Un recurso NUEVO corre 2 pasadas en paralelo (se combinan con
  // `unirPasadas`); un ajuste, 1 sola.
  const cantidadPasadas = tipo === 'nuevo' ? 2 : 1;
  const resultados = await Promise.all(
    Array.from({ length: cantidadPasadas }, () =>
      ejecutarPasada({ messages, provider, userId: user.id, projectId: project.id, signalExterno: request.signal }),
    ),
  );

  const listasOk = resultados.filter((r): r is { problemas: Problema[] } => r.problemas !== null);
  const fallidas = resultados.length - listasOk.length;

  if (listasOk.length === 0) {
    // Cada pasada ya logueó su propio motivo (arriba, en `ejecutarPasada`)
    // — acá no hay nada más que reportar, y NUNCA se loguea la clave.
    return ok({ estado: 'error' });
  }

  const problemas = unirPasadas(listasOk.map((r) => r.problemas));
  return ok({ estado: 'ok', problemas, pasadas: cantidadPasadas, fallidas });
};
