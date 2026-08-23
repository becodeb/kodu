import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { findOwnedProject } from '../../../lib/projects.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';

/**
 * POST /api/chat/cancel — cierra un turno que quedó colgado.
 *
 * No cancela nada del lado del proveedor: para eso ya está el AbortController
 * del navegador. Lo que hace es dejar constancia en el hilo de que ese turno
 * terminó.
 *
 * Sin esto se entra en un bucle: el editor reanuda un turno cuando ve que el
 * último mensaje del hilo es del docente, así que un turno que nunca contestó
 * deja al docente esperando de nuevo en CADA recarga, para siempre.
 */

const schema = z.object({
  projectId: z.string().min(1),
  threadId: z.string().min(1),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail('Datos inválidos', 422);

  const project = await findOwnedProject(parsed.data.projectId, user.id);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  const thread = await prisma.chatThread.findFirst({
    where: { id: parsed.data.threadId, projectId: project.id },
    select: { id: true },
  });
  if (!thread) return fail('El hilo de conversación no existe.', 404);

  const ultimo = await prisma.chatMessage.findFirst({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'desc' },
    select: { role: true },
  });

  // Si el turno ya había terminado, no se agrega ruido al hilo.
  if (ultimo?.role !== 'user') return ok({ yaTerminado: true });

  const content = 'Frenaste este pedido. Tu recurso quedó como estaba.';
  const saved = await prisma.chatMessage.create({
    data: { threadId: thread.id, role: 'assistant', content },
    select: { id: true },
  });

  return ok({ messageId: saved.id, content });
};
