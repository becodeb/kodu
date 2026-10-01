import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../../lib/db.ts';
import { fail, readBody } from '../../../../lib/http.ts';
import { cadenaDeMotores, motorPorDefecto } from '../../../../lib/ai/catalogo.ts';
import {
  ProviderError,
  razonamientoNulo,
  readCompletionStream,
  requestCompletionStream,
  supportsVision,
  type ProviderConfig,
  type TokenUsage,
} from '../../../../lib/ai/provider.ts';
import { recordUsage } from '../../../../lib/ai/usage.ts';
import { recordAiTrace } from '../../../../lib/ai/trace.ts';
import { debeTallerDesactivarRazonamiento } from '../../../../lib/taller/razonamiento.ts';
import { readImageAsDataUrl } from '../../../../lib/uploads.ts';
import {
  fusionarFicha,
  leerFichaGuardada,
  leerIdeasGuardadas,
  leerPreguntasGuardadas,
  prefijoVisible,
  separarRespuesta,
} from '../../../../lib/taller/ficha.ts';
import { HISTORIAL_TALLER, construirMensajesTaller } from '../../../../lib/taller/prompt.ts';
import {
  buscarSesionPropia,
  chequearAccesoTaller,
  chequearTopes,
  liberarTurno,
  mensajeParaCliente,
  reclamarTurno,
} from '../../../../lib/taller/sesiones.ts';
import type { EventoTaller } from '../../../../lib/taller/tipos.ts';

/**
 * POST /api/taller/:id/turno — el docente contesta y la IA del Taller
 * responde (odd/tasks/taller-de-ideas.md).
 *
 * SSE con el mismo transporte que `/api/chat/stream` (`data: <json>\n\n`):
 *   {type:"text", delta}    lo que se ve en la burbuja, en vivo
 *   {type:"notice", message} el motor está saturado y se reintenta
 *   {type:"done", …}        los dos mensajes guardados y la ficha nueva
 *   {type:"error", message} no se guardó nada; el docente puede reenviar
 *
 * El bloque `<taller>` del final de la respuesta NUNCA llega al navegador
 * como texto: se corta acá (`prefijoVisible`) y lo estructurado viaja en
 * "done".
 *
 * Se guarda todo junto al final (el mensaje del docente y el de la IA, en
 * una transacción): un turno que falla no deja un mensaje del docente
 * colgado sin respuesta. El turno NO se corta si el docente cierra la
 * pestaña (mismo criterio que el editor): termina, se guarda, y al volver
 * está. Sólo lo corta el tope de tiempo.
 */

const schema = z.object({
  message: z.string().trim().min(1, 'Escribí o elegí una respuesta.').max(20_000, 'El mensaje es demasiado largo.'),
  attachmentUrls: z.array(z.string().max(500)).max(10).optional(),
});

/** Una respuesta del Taller es texto corto (salvo el pedido final): con esto sobra. */
const MAX_TOKENS_TURNO = 8_000;
/** Tope de un turno entero, reintentos por saturación incluidos. */
const TOPE_TURNO_MS = 4 * 60_000;
const HEARTBEAT_MS = 10_000;
/** Imágenes de ESTE mensaje que se le muestran al modelo, si las puede ver. */
const MAX_IMAGENES = 2;

const encoder = new TextEncoder();

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user!;

  const sinAcceso = await chequearAccesoTaller(user);
  if (sinAcceso) return sinAcceso;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  const { message } = parsed.data;

  const sesion = await buscarSesionPropia(params.id!, user.id);
  if (!sesion) return fail('Esa idea no existe o no es tuya.', 404);
  if (sesion.projectId) return fail('Esta idea ya se convirtió en un recurso.', 409);

  // "La misma IA": el motor predeterminado del catálogo, con su cadena de
  // respaldo. El Taller no tiene selector de motor.
  const motor = await motorPorDefecto();
  if (!motor) return fail('No hay ningún motor de IA habilitado. Avisale a un administrador.', 503);

  const topes = await chequearTopes(user, motor);
  if (topes) return topes;

  if (message.length > motor.maxInputChars) {
    return fail('Tu mensaje es demasiado largo. Probá contármelo en partes.', 413);
  }

  // odd/tasks/ahorro-tokens.md (T2): una cuenta personal en el plan FREE no
  // paga razonamiento en el Taller — ni paga ni organización lo pierden.
  const sinRazonamiento = await debeTallerDesactivarRazonamiento(user);

  if (!reclamarTurno(sesion.id)) {
    return fail('Todavía estoy contestando tu mensaje anterior. Esperá un momento.', 409);
  }

  // Desde acá, cualquier salida tiene que liberar el turno.
  let entregadoAlStream = false;
  try {
    const [historial, adjuntos] = await Promise.all([
      prisma.ideaMessage.findMany({
        where: { sessionId: sesion.id },
        orderBy: { createdAt: 'desc' },
        take: HISTORIAL_TALLER,
      }),
      prisma.ideaAsset.findMany({ where: { sessionId: sesion.id }, orderBy: { createdAt: 'asc' } }),
    ]);

    // Sólo adjuntos de ESTA charla: una URL que no subió el docente acá no se
    // guarda ni se le muestra al modelo.
    const urlsPropias = new Set(adjuntos.map((adjunto) => adjunto.url));
    const attachmentUrls = (parsed.data.attachmentUrls ?? []).filter((url) => urlsPropias.has(url));

    const puedeVerImagenes = supportsVision(motor);
    const imagenes: string[] = [];
    if (puedeVerImagenes) {
      const urlsImagen = attachmentUrls.filter((url) =>
        adjuntos.some((adjunto) => adjunto.url === url && adjunto.fileType === 'image'),
      );
      for (const url of urlsImagen.slice(0, MAX_IMAGENES)) {
        const dataUrl = await readImageAsDataUrl(url);
        if (dataUrl) imagenes.push(dataUrl);
      }
    }

    const fichaAnterior = leerFichaGuardada(sesion.brief);
    const mensajes = construirMensajesTaller({
      modo: sesion.mode,
      ficha: fichaAnterior,
      pedido: sesion.finalPrompt,
      pedidoEditadoAMano: sesion.finalPromptEditedByTeacher,
      historial: historial.reverse().map((fila) => ({
        role: fila.role,
        content: fila.content,
        questions: leerPreguntasGuardadas(fila.questions),
        proposals: leerIdeasGuardadas(fila.proposals),
      })),
      mensaje: message,
      adjuntos: adjuntos.map((adjunto) => ({
        filename: adjunto.filename,
        fileType: adjunto.fileType,
        extractedText: adjunto.extractedText,
      })),
      puedeVerImagenes,
      imagenes,
    });

    const abortador = new AbortController();
    const tope = setTimeout(() => abortador.abort(), TOPE_TURNO_MS);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let cerrado = false;
        const enviar = (evento: EventoTaller) => {
          if (cerrado) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(evento)}\n\n`));
          } catch {
            // El docente cerró la pestaña: el turno sigue y se guarda igual.
            cerrado = true;
          }
        };

        try {
          controller.enqueue(encoder.encode(': abierto\n\n'));
        } catch {
          cerrado = true;
        }
        const latido = setInterval(() => {
          if (cerrado) return;
          try {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
          } catch {
            cerrado = true;
          }
        }, HEARTBEAT_MS);

        try {
          const arranque = Date.now();
          const { acumulado, usado, usage } = await pedirRespuesta(
            mensajes,
            motor,
            abortador.signal,
            enviar,
            sinRazonamiento,
          );

          if (usage) {
            const registroDeUso = await recordUsage({
              userId: user.id,
              projectId: null,
              aiModelId: usado.id,
              model: usado.model,
              promptTokens: usage.promptTokens,
              cachedInputTokens: usage.cachedTokens,
              completionTokens: usage.completionTokens,
              precios: usado.precios,
              schedule: usado.schedule,
              purpose: 'IDEATION',
            }).catch((error) => {
              console.error('[taller/turno] no se pudo registrar el consumo:', error);
              return null;
            });

            // odd/tasks/ahorro-tokens.md (T4): "Taller turns too if cheap" —
            // reusa exactamente lo que ya se calculó arriba (sin HTML, sin
            // self-test: el Taller no escribe código).
            await recordAiTrace({
              userId: user.id,
              projectId: null,
              tokenUsageId: registroDeUso?.id ?? null,
              turnKind: 'IDEATION',
              model: usado.model,
              reasoningEffort: usado.reasoningEffort,
              requestText: message,
              durationMs: Date.now() - arranque,
            });
          }

          const { visible, datos, bloqueValido } = separarRespuesta(acumulado);
          if (!bloqueValido) {
            console.warn(`[taller/turno] sesión ${sesion.id}: la respuesta vino sin bloque <taller> legible`);
          }

          const contenido =
            visible ||
            (datos.pedido
              ? 'Listo, armé el pedido: lo tenés a la derecha. Leelo con calma y cambiá lo que quieras.'
              : datos.preguntas.length > 0
                ? 'Sigamos:'
                : '');

          if (!contenido && datos.ideas.length === 0) {
            enviar({
              type: 'error',
              message: 'No me llegó la respuesta completa. Volvé a mandar tu mensaje.',
            });
            return;
          }

          const fichaNueva = fusionarFicha(fichaAnterior, datos.ficha);

          // Fechas explícitas: dentro de una transacción el default de la
          // base (CURRENT_TIMESTAMP) es el MISMO instante para las dos filas,
          // y el orden por fecha tiene que dejar al docente antes que la IA.
          const ahora = Date.now();

          const [mensajeDocente, mensajeIa, actualizada] = await prisma.$transaction([
            prisma.ideaMessage.create({
              data: {
                sessionId: sesion.id,
                role: 'user',
                content: message,
                createdAt: new Date(ahora),
                attachments: attachmentUrls.length > 0 ? JSON.stringify(attachmentUrls) : null,
              },
            }),
            prisma.ideaMessage.create({
              data: {
                sessionId: sesion.id,
                role: 'assistant',
                content: contenido,
                createdAt: new Date(ahora + 1),
                questions: datos.preguntas.length > 0 ? JSON.stringify(datos.preguntas) : null,
                proposals: datos.ideas.length > 0 ? JSON.stringify(datos.ideas) : null,
              },
            }),
            prisma.ideaSession.update({
              where: { id: sesion.id },
              data: {
                brief: JSON.stringify(fichaNueva),
                ...(datos.titulo ? { title: datos.titulo } : {}),
                ...(datos.descripcion ? { description: datos.descripcion } : {}),
                ...(datos.pedido ? { finalPrompt: datos.pedido } : {}),
                // La IA ya vio la versión editada a mano en este turno: la
                // marca cumplió su función.
                finalPromptEditedByTeacher: false,
              },
            }),
          ]);

          enviar({
            type: 'done',
            userMessage: mensajeParaCliente(mensajeDocente),
            message: mensajeParaCliente(mensajeIa),
            brief: fichaNueva,
            title: actualizada.title,
            description: actualizada.description,
            finalPrompt: actualizada.finalPrompt,
          });
        } catch (error) {
          console.error(`[taller/turno] sesión ${sesion.id}:`, error);
          enviar({
            type: 'error',
            message: abortador.signal.aborted
              ? 'La respuesta tardó demasiado. Volvé a mandar tu mensaje.'
              : 'No pude contestarte ahora. Volvé a mandar tu mensaje en un momento.',
          });
        } finally {
          clearTimeout(tope);
          clearInterval(latido);
          liberarTurno(sesion.id);
          if (!cerrado) {
            try {
              controller.close();
            } catch {
              // ya estaba cerrado
            }
          }
        }
      },
    });

    entregadoAlStream = true;
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } finally {
    if (!entregadoAlStream) liberarTurno(sesion.id);
  }
};

/**
 * Pide la respuesta recorriendo la cadena de respaldo del motor (mismo
 * criterio que el editor) y reenvía al navegador sólo la parte visible.
 */
async function pedirRespuesta(
  mensajes: ReturnType<typeof construirMensajesTaller>,
  motor: ProviderConfig,
  signal: AbortSignal,
  enviar: (evento: EventoTaller) => void,
  sinRazonamiento: boolean,
): Promise<{ acumulado: string; usado: ProviderConfig; usage: TokenUsage | null }> {
  const cadena = await cadenaDeMotores(motor.id);
  let ultimaFalla: unknown = null;

  for (const candidato of cadena) {
    let respuesta: Response;
    try {
      respuesta = await requestCompletionStream({
        messages: mensajes,
        provider: candidato,
        signal,
        // Sin herramientas: la respuesta es texto con el bloque <taller> al
        // final (ver `lib/taller/ficha.ts`, "Por qué un bloque").
        sinHerramientas: true,
        maxTokensOverride: Math.min(MAX_TOKENS_TURNO, candidato.maxTokens),
        // odd/tasks/ahorro-tokens.md (T2): cuenta personal en FREE → "none"
        // fijo, sin importar el nivel configurado en el motor. Paga u
        // organización: `undefined`, el nivel configurado de siempre.
        razonamientoOverride: sinRazonamiento ? razonamientoNulo(candidato) : undefined,
        onReintento: () => enviar({ type: 'notice', message: 'Hay mucha gente usando Kodu ahora. Sigo intentando…' }),
      });
    } catch (error) {
      ultimaFalla = error;
      if (signal.aborted) throw error;
      if (error instanceof ProviderError && error.canFallback) continue;
      throw error;
    }

    let acumulado = '';
    let emitido = '';
    let usage: TokenUsage | null = null;

    for await (const evento of readCompletionStream(respuesta, candidato.apiFormat)) {
      if (evento.type === 'text') {
        acumulado += evento.delta;
        const visible = prefijoVisible(acumulado);
        if (visible.length > emitido.length && visible.startsWith(emitido)) {
          enviar({ type: 'text', delta: visible.slice(emitido.length) });
          emitido = visible;
        }
      } else if (evento.type === 'usage') {
        usage = evento.usage;
      }
    }

    return { acumulado, usado: candidato, usage };
  }

  throw ultimaFalla ?? new Error('No hay ningún motor disponible.');
}
