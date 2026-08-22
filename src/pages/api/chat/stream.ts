import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { findOwnedProject } from '../../../lib/projects.ts';
import { buildSystemPrompt } from '../../../lib/ai/prompt.ts';
import {
  DeepSeekError,
  readCompletionStream,
  requestCompletionStream,
  supportsVision,
  type ChatMessage,
  type ContentPart,
} from '../../../lib/ai/deepseek.ts';
import { UPDATE_RESOURCE_CODE, parseUpdateResourceArgs } from '../../../lib/ai/tools.ts';
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

const schema = z.object({
  projectId: z.string().min(1),
  threadId: z.string().min(1),
  message: z.string().trim().min(1, 'Escribí un mensaje').max(8_000),
  attachmentUrls: z.array(z.string().max(500)).max(10).optional(),
  model: z.enum(['FLASH', 'PRO']).optional(),
  /** El docente tocó el código a mano desde la última respuesta de la IA. */
  codeEditedByTeacher: z.boolean().optional(),
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

const encoder = new TextEncoder();

function sseFrame(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Arma el contenido del mensaje del docente.
 *
 * Con `AI_VISION` prendido las imágenes de ESTE mensaje viajan como partes
 * `image_url` en base64. Apagado (default), sólo se nombran: el system prompt
 * ya le aclara al modelo que no las ve y que tiene que preguntar.
 */
async function buildUserContent(
  message: string,
  attachmentUrls: string[],
): Promise<string | ContentPart[]> {
  if (attachmentUrls.length === 0) return message;

  const names = attachmentUrls.map((url) => url.split('/').pop() ?? url).join(', ');

  if (!supportsVision()) {
    return `${message}\n\n[El docente adjuntó a este mensaje: ${names}. No podés ver su contenido.]`;
  }

  const images = (
    await Promise.all(attachmentUrls.map((url) => readImageAsDataUrl(url)))
  ).filter((dataUrl): dataUrl is string => dataUrl !== null);

  if (images.length === 0) {
    return `${message}\n\n[El docente adjuntó: ${names}, pero no se pudieron leer.]`;
  }

  return [
    { type: 'text', text: message },
    ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ];
}

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }

  const { projectId, threadId, message, attachmentUrls, model, codeEditedByTeacher } = parsed.data;

  const project = await findOwnedProject(projectId, user.id);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, projectId: project.id },
    select: { id: true },
  });
  if (!thread) return fail('El hilo de conversación no existe.', 404);

  // El selector Flash/Pro del panel izquierdo se persiste en el proyecto.
  const chosenModel = model ?? project.selectedModel;
  if (model && model !== project.selectedModel) {
    await prisma.project.update({ where: { id: project.id }, data: { selectedModel: model } });
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
    prisma.chatMessage.findMany({
      where: { threadId: thread.id },
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

  const systemPrompt = buildSystemPrompt({
    globalRules,
    userRules,
    assets: assetContexts,
    currentHtml: project.currentHtml,
    projectTitle: project.title,
    canSeeImages: supportsVision(),
    htmlEditedByTeacher: codeEditedByTeacher ?? false,
  });

  const userContent = await buildUserContent(message, attachmentUrls ?? []);

  // Se persiste ANTES de llamar a la IA: si el turno se corta, el docente no
  // pierde lo que escribió.
  await prisma.chatMessage.create({
    data: {
      threadId: thread.id,
      role: 'user',
      content: message,
      attachments: attachmentUrls?.length ? JSON.stringify(attachmentUrls) : null,
    },
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...[...history].reverse().map((entry) => ({
      role: entry.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: entry.content,
    })),
    { role: 'user', content: userContent },
  ];

  let upstream: Response;
  try {
    upstream = await requestCompletionStream({
      messages,
      model: chosenModel,
      signal: request.signal,
    });
  } catch (error) {
    const status = error instanceof DeepSeekError ? error.status : 502;
    return fail((error as Error).message, status);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = '';
      let generatedHtml: string | null = null;
      // Diagnóstico legible cuando el código no se pudo aplicar. Se guarda en el
      // hilo junto con la explicación de la IA: si no, el modelo dice "listo,
      // cambié el fondo", el recurso no cambia y el docente no entiende por qué.
      let codeProblem: string | null = null;
      let finishReason = '';

      try {
        for await (const event of readCompletionStream(upstream)) {
          if (event.type === 'text') {
            assistantText += event.delta;
            controller.enqueue(sseFrame({ type: 'text', delta: event.delta }));
            continue;
          }

          if (event.type === 'finish') {
            finishReason = event.reason;
            continue;
          }

          if (event.type === 'tool' && event.name === UPDATE_RESOURCE_CODE) {
            const result = parseUpdateResourceArgs(event.arguments, event.truncated);

            if (result.ok) {
              generatedHtml = result.html;
              codeProblem = null;
              controller.enqueue(sseFrame({ type: 'code', html: result.html }));
            } else {
              codeProblem = CODE_PROBLEMS[result.reason];
              controller.enqueue(sseFrame({ type: 'error', message: codeProblem }));
            }
          }
        }
      } catch (error) {
        console.error('[chat/stream]', error);
        controller.enqueue(
          sseFrame({ type: 'error', message: 'Se cortó la conexión con el motor de IA.' }),
        );
      } finally {
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

          const finalText =
            notes.length > 0
              ? notes.join('\n\n')
              : generatedHtml
                ? 'Actualicé el recurso.'
                : SILENT_TURN;

          const saved = await prisma.chatMessage.create({
            data: { threadId: thread.id, role: 'assistant', content: finalText },
            select: { id: true },
          });

          controller.enqueue(
            sseFrame({
              type: 'done',
              messageId: saved.id,
              codeUpdated: Boolean(generatedHtml),
              content: finalText,
            }),
          );
        } catch (error) {
          console.error('[chat/stream] no se pudo persistir el turno:', error);
        }

        controller.close();
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
