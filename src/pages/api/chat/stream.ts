import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { findOwnedProject } from '../../../lib/projects.ts';
import { buildSystemPrompt } from '../../../lib/ai/prompt.ts';
import {
  DeepSeekError,
  readCompletionStream,
  requestCompletionStream,
  type ChatMessage,
} from '../../../lib/ai/deepseek.ts';
import { UPDATE_RESOURCE_CODE, parseUpdateResourceArgs } from '../../../lib/ai/tools.ts';
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
});

/** Cuántos mensajes del hilo se reenvían como historial. */
const HISTORY_LIMIT = 40;

const encoder = new TextEncoder();

function sseFrame(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }

  const { projectId, threadId, message, attachmentUrls, model } = parsed.data;

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
  });

  const attachmentNote =
    attachmentUrls && attachmentUrls.length > 0
      ? `\n\n[Archivos adjuntos de este mensaje: ${attachmentUrls.join(', ')}]`
      : '';

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
    { role: 'user', content: message + attachmentNote },
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

      try {
        for await (const event of readCompletionStream(upstream)) {
          if (event.type === 'text') {
            assistantText += event.delta;
            controller.enqueue(sseFrame({ type: 'text', delta: event.delta }));
            continue;
          }

          if (event.type === 'tool' && event.name === UPDATE_RESOURCE_CODE) {
            const html = parseUpdateResourceArgs(event.arguments);
            if (html) {
              generatedHtml = html;
              controller.enqueue(sseFrame({ type: 'code', html }));
            } else {
              controller.enqueue(
                sseFrame({
                  type: 'error',
                  message: 'La IA devolvió código con formato inválido; no se aplicó el cambio.',
                }),
              );
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

          const finalText =
            assistantText.trim() ||
            (generatedHtml ? 'Actualicé el recurso.' : 'No pude generar una respuesta.');

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
