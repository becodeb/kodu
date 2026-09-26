import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { findProjectForActor } from '../../../lib/projects.ts';
import { cancelarTurnoEnCurso } from '../../../lib/ai/turnos-en-curso.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';

/**
 * POST /api/chat/cancel — el botón "Detener".
 *
 * T4 (odd/tasks/generacion-simple-y-reanudable.md): ahora SÍ cancela algo del
 * lado del proveedor — antes de esto, sólo dejaba constancia en el hilo,
 * porque lo único que frenaba la llamada de verdad era el `AbortController`
 * del navegador (`request.signal`, cerrado cuando el docente abortaba el
 * fetch). Como T4 saca esa atadura (cerrar la pestaña ya no debe frenar la
 * generación), acá es donde tiene que cortarse de verdad: se busca el
 * `AbortController` del turno registrado para este hilo
 * (`turnos-en-curso.ts`) y se lo aborta.
 *
 * `stream.ts` reconoce ese abort puntual (motivo `'stop'`) y, en su
 * `finally`, se ABSTIENE de crear su propio mensaje "assistant" — el que
 * deja constancia acá abajo ("Frenaste este pedido") es el único que se
 * crea, así que un "Detener" nunca deja dos mensajes.
 *
 * Sin la constancia de acá abajo se entra en un bucle: el editor reanuda un
 * turno cuando ve que el último mensaje del hilo es del docente, así que un
 * turno que nunca contestó deja al docente esperando de nuevo en CADA
 * recarga, para siempre.
 */

const schema = z.object({
  projectId: z.string().min(1),
  threadId: z.string().min(1),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail('Datos inválidos', 422);

  const project = await findProjectForActor(parsed.data.projectId, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  const thread = await prisma.chatThread.findFirst({
    where: { id: parsed.data.threadId, projectId: project.id },
    select: { id: true },
  });
  if (!thread) return fail('El hilo de conversación no existe.', 404);

  // T4: recién acá, después de confirmar que el hilo es del actor —
  // "owner-checked", como pide la tarea. `false` (nada registrado, turno ya
  // terminado o nunca llegó a arrancar del lado del servidor) es un no-op
  // seguro: el resto de la ruta sigue exactamente igual que antes de T4.
  cancelarTurnoEnCurso(thread.id);

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
