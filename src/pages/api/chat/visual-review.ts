import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { findProjectForActor, marcarSiActuaAdmin } from '../../../lib/projects.ts';
import { buildSystemPrompt, TURNOS_TEMPRANOS } from '../../../lib/ai/prompt.ts';
import { aplicarKitAlTurno } from './stream.ts';
import { temaDe } from '../../../lib/ai/kit.ts';
import { revisarHtml } from '../../../lib/ai/revision.ts';
import {
  readCompletionStream,
  requestCompletionStream,
  supportsVision,
  type ChatMessage,
  type ContentPart,
  type TokenUsage as MotorTokenUsage,
} from '../../../lib/ai/provider.ts';
import { normalizarMotor } from '../../../lib/ai/catalogo.ts';
import { resolverCapacidades } from '../../../lib/ai/capacidades.ts';
import {
  INSTRUCCION_REVISION_VISUAL,
  fingerprintHtml,
  validarImagenRevisionVisual,
} from '../../../lib/ai/revision-visual.ts';
import { consumedTokens, recordUsage } from '../../../lib/ai/usage.ts';
import { puedeUsarLaIa } from '../../../lib/auth/domains.ts';
import { consumoDeLaDemo } from '../../../lib/demo.ts';
import { leerAppSettings } from '../../../lib/settings.ts';
import { UPDATE_RESOURCE_CODE, parseUpdateResourceArgs } from '../../../lib/ai/tools.ts';
import { fail, readBody } from '../../../lib/http.ts';

/**
 * POST /api/chat/visual-review — revisión visual con una captura (T8,
 * odd/tasks/modo-prime.md — "el modelo mira una captura de su propio
 * resultado"). El cliente la pide DESPUÉS de un turno normal cuyo "done" en
 * /api/chat/stream trajo `revisionVisualDisponible: true` — ese flag ya lo
 * decidió el servidor con `aplicaRevisionVisual` (revision-visual.ts); acá
 * se vuelve a chequear la política entera server-side, porque nunca se
 * confía en que el cliente la pidió de buena fe (el permiso, o el motor del
 * recurso, pueden haber cambiado en el medio).
 *
 * Discreto (decisiones del dueño, "Discreto" — nadie sin prime lo nota): no
 * crea `ChatMessage`, no crea `ProjectSnapshot` (deshacer sigue revirtiendo
 * el turno COMPLETO — la instantánea es PRE-turno, ver T4), la imagen
 * capturada nunca se guarda (ni upload, ni fila de asset).
 *
 * SSE con un vocabulario reducido, a propósito más chico que el de
 * /api/chat/stream (sin `text`, sin `notice`, sin `error`):
 *   {type:"code", html}          el resultado reemplaza la vista previa
 *   {type:"done", codeUpdated}   fin del pedido — SIEMPRE se manda, sea
 *                                 cual sea el resultado
 * Nunca se manda un evento de error: una revisión visual que falla (el
 * proveedor no contesta, el HTML no se pudo aplicar, la corrección
 * introdujo hallazgos nuevos) no puede tapar un turno que ya había
 * terminado bien — se loguea del lado del servidor y el cliente simplemente
 * deja de ver la fase "Mirando cómo quedó" (mismo criterio que la
 * corrección de T7, revisarYCorregir en stream.ts).
 */

const schema = z.object({
  projectId: z.string().min(1),
  /** Data URL de la captura (png/jpeg/webp), nunca se guarda en disco. */
  dataUrl: z.string().min(32).max(20_000_000),
  /** `fingerprintHtml` del HTML que el cliente capturó. */
  fingerprint: z.string().min(1).max(32),
});

const encoder = new TextEncoder();

function sseFrame(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Mismo intervalo que /api/chat/stream (ver el comentario ahí: sin esto,
 *  un proxy intermedio da la conexión por muerta mientras se espera al
 *  modelo). */
const HEARTBEAT_MS = 10_000;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;

  // Mismas puertas que /api/chat/stream, en el mismo orden (ver los
  // comentarios allá: acceso a la IA y apagado de demo van ACÁ, no en el
  // middleware, para que una revocación aplique al PRÓXIMO pedido).
  if (!(await puedeUsarLaIa(user))) {
    return fail('Tu cuenta todavía no tiene habilitado el uso de la IA. Escribinos y lo vemos.', 403);
  }

  const settings = await leerAppSettings();
  if (user.isDemo && !settings.demoEnabled) {
    return fail('La demo está cerrada por el momento.', 403);
  }

  const capacidades = resolverCapacidades(user, settings);

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }
  const { projectId, dataUrl, fingerprint } = parsed.data;

  const project = await findProjectForActor(projectId, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  // Re-chequeo de política (T8: "re-checks the policy server-side"): la
  // capacidad de elegir A fondo es la misma que hizo posible que ESTA
  // cuenta llegara a ver la oferta de revisión visual en primer lugar
  // (`aplicaRevisionVisual` en stream.ts exige `velocidadEfectiva ===
  // 'deep'`, que a su vez exige `puedeElegirVelocidad`). Puede haber
  // cambiado desde entonces (un admin apagó prime en el medio).
  if (!capacidades.puedeElegirVelocidad) {
    return fail('Esta cuenta no puede pedir una revisión visual.', 403);
  }

  const provider = await normalizarMotor(project.aiModelId, capacidades.prime);
  if (!provider) return fail('No hay ningún motor de IA habilitado.', 503);
  if (!supportsVision(provider)) {
    return fail('El motor de este recurso no puede ver imágenes.', 403);
  }

  const imagen = validarImagenRevisionVisual(dataUrl);
  if (!imagen) {
    return fail('La captura debe ser PNG, JPEG o WebP y no superar el tamaño máximo.', 422);
  }

  // El docente pudo haber editado el código (u otra pestaña terminó un
  // turno) entre que el cliente capturó la imagen y que este pedido llegó:
  // si `currentHtml` ya no es el HTML capturado, la imagen ya no retrata el
  // recurso actual y no tiene sentido pedirle al modelo que lo corrija.
  if (fingerprintHtml(project.currentHtml) !== fingerprint) {
    return fail('El recurso cambió después de esta captura. Pedí la revisión de nuevo.', 409);
  }

  if (user.isDemo) {
    const consumidos = await consumoDeLaDemo();
    if (consumidos >= settings.demoTokenLimit) {
      return fail('La demo ya usó todo el crédito de esta ronda.', 429);
    }
  }

  if (provider.userTokenLimit > 0) {
    const usados = await consumedTokens(user.id, provider.id, provider.userTokenWindowHours);
    if (usados >= provider.userTokenLimit) {
      return fail(
        `Alcanzaste tu tope de ${provider.userTokenLimit.toLocaleString('es-AR')} tokens en ${provider.label}.`,
        429,
      );
    }
  }

  // M8 (design.md §7): mismo criterio que stream.ts/undo.ts — un admin
  // pidiendo la revisión visual sobre un recurso ajeno deja la marca.
  await marcarSiActuaAdmin(project, user);

  const temaProyecto = temaDe(project.currentHtml);
  const htmlPreRevision = project.currentHtml;

  const [globalRules, userRules, assets] = await Promise.all([
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
    prisma.projectAsset.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'asc' } }),
  ]);

  const assetContexts = assets.map((asset) => ({
    filename: asset.filename,
    url: asset.url,
    fileType: asset.fileType,
    extractedText: asset.extractedText,
  }));

  // El prompt de sistema "de siempre" (T8: "usual system prompt"), con el
  // HTML actual plegado. `turnosPrevios` se pisa a un valor grande a
  // propósito: esto es un pedido mecánico de una sola llamada, sin hilo al
  // que volver con preguntas — la guía de "preguntas tempranas"
  // (prompt.ts) no tiene sentido acá (no hay dónde contestarlas).
  const systemPrompt = buildSystemPrompt({
    globalRules,
    userRules,
    assets: assetContexts,
    currentHtml: project.currentHtml,
    projectTitle: project.title,
    canSeeImages: true, // ya confirmado arriba con supportsVision(provider)
    htmlEditedByTeacher: false,
    turnosPrevios: TURNOS_TEMPRANOS + 1,
    herramientaForzada: false,
  });

  const userContent: ContentPart[] = [
    { type: 'text', text: INSTRUCCION_REVISION_VISUAL },
    { type: 'image_url', image_url: { url: dataUrl } },
  ];

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (payload: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(sseFrame(payload));
        } catch {
          closed = true;
        }
      };

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

      let codeUpdated = false;

      try {
        // Una sola llamada al MISMO motor (T8: "calls the SAME engine
        // once") — sin la cadena de respaldo de stream.ts: si este motor
        // puntual no contesta, no hay "otro motor" al que valga la pena
        // pasarle la MISMA captura (la vista que tiene del recurso podría
        // ser otra). Razonamiento apagado (`velocidad: 'fast'`): es una
        // corrección mecánica sobre problemas ya visibles en la imagen, no
        // creativa — mismo criterio que la corrección de T7.
        const respuesta = await requestCompletionStream({
          messages,
          provider,
          signal: request.signal,
          forzarHerramienta: false,
          velocidad: 'fast',
        });

        let htmlFinal: string | null = null;
        const totales: { usage: MotorTokenUsage | null } = { usage: null };

        for await (const event of readCompletionStream(respuesta)) {
          if (event.type === 'usage') {
            totales.usage = event.usage;
            continue;
          }
          if (event.type === 'tool' && event.name === UPDATE_RESOURCE_CODE) {
            const resultado = parseUpdateResourceArgs(event.arguments, event.truncated);
            if (resultado.ok) htmlFinal = aplicarKitAlTurno(resultado.html, temaProyecto);
            // truncado/inválido/vacío: se trata igual que "no llamó la
            // herramienta" — silencioso, no hay nada que aplicar.
          }
        }

        if (totales.usage) {
          await recordUsage({
            userId: user.id,
            projectId: project.id,
            aiModelId: provider.id,
            model: provider.model,
            promptTokens: totales.usage.promptTokens,
            cachedInputTokens: totales.usage.cachedTokens,
            completionTokens: totales.usage.completionTokens,
            precios: provider.precios,
          }).catch((error) => console.error('[chat/visual-review] no se pudo registrar el consumo:', error));
        }

        if (htmlFinal) {
          // Mismo lint que T7, contra el HTML de ANTES de esta llamada: si
          // la "corrección" introdujo hallazgos que no había (un emoji
          // nuevo, un degradado nuevo), se descarta entera — más vale
          // dejar el recurso como estaba que aplicar un cambio que empeora
          // lo que la revisión automática ya había dejado limpio.
          const hallazgosNuevos = revisarHtml(htmlFinal, { anterior: htmlPreRevision });

          if (hallazgosNuevos.length > 0) {
            console.warn(
              `[chat/visual-review] descartada: introdujo ${hallazgosNuevos.length} hallazgo(s) nuevo(s) (${hallazgosNuevos
                .map((h) => h.codigo)
                .join(', ')}) — se deja el recurso como estaba`,
            );
          } else {
            await prisma.project.update({ where: { id: project.id }, data: { currentHtml: htmlFinal } });
            codeUpdated = true;
            send({ type: 'code', html: htmlFinal });
          }
        }
      } catch (error) {
        // Nunca se surface un error visible: el turno que trajo esta
        // oferta ya había terminado bien. Un abort ("Detener") pasa por
        // acá igual, y es exactamente lo que tiene que pasar: no se
        // persiste nada, no se manda "code", el HTML del turno queda tal
        // cual estaba.
        console.error('[chat/visual-review] no se pudo completar la revisión visual:', error);
      } finally {
        send({ type: 'done', codeUpdated });
        clearInterval(heartbeat);
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
      'X-Accel-Buffering': 'no',
    },
  });
};
