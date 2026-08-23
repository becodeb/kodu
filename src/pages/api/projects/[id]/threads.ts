import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../../lib/db.ts';
import { findOwnedProject } from '../../../../lib/projects.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';

const schema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
});

/**
 * POST /api/projects/:id/threads — abre un hilo nuevo.
 *
 * Sirve para arrancar una conversación limpia sin perder el código: el HTML
 * vive en el proyecto, no en el hilo (SPEC §5.1).
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user!;
  const project = await findOwnedProject(params.id!, user.id);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail('Título de hilo inválido.', 422);

  const count = await prisma.chatThread.count({ where: { projectId: project.id } });

  const thread = await prisma.chatThread.create({
    data: {
      projectId: project.id,
      title: parsed.data.title ?? `Conversación ${count + 1}`,
    },
    select: { id: true, title: true, createdAt: true },
  });

  return ok({ thread });
};

/**
 * GET /api/projects/:id/threads          → lista de hilos
 * GET /api/projects/:id/threads?threadId= → mensajes de ese hilo
 */
export const GET: APIRoute = async ({ params, url, locals }) => {
  const user = locals.user!;
  const project = await findOwnedProject(params.id!, user.id);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  const threadId = url.searchParams.get('threadId');

  if (!threadId) {
    const threads = await prisma.chatThread.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true },
    });
    return ok({ threads });
  }

  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, projectId: project.id },
    select: { id: true },
  });
  if (!thread) return fail('El hilo de conversación no existe.', 404);

  const messages = await prisma.chatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, attachments: true, createdAt: true },
  });

  // Se devuelve tambien el HTML porque el editor usa este endpoint para
  // retomar un turno que quedo corriendo en el servidor: sin el codigo, el
  // docente veria la respuesta nueva pero el visor seguiria con la version
  // vieja hasta recargar de nuevo.
  return ok({
    currentHtml: project.currentHtml,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      attachments: message.attachments ? (JSON.parse(message.attachments) as string[]) : [],
      createdAt: message.createdAt.getTime(),
    })),
  });
};
