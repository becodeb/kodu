import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../../lib/db.ts';
import { findProjectForActor, marcarSiActuaAdmin } from '../../../../lib/projects.ts';
import { checklistActual } from '../../../../lib/ai/checklist-db.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';

const schema = z.object({
  /** El mensaje "assistant" cuyo cambio se quiere deshacer. */
  messageId: z.string().min(1),
});

/**
 * POST /api/projects/:id/undo — deshace el último cambio de la IA (T4,
 * "Deshacer cambios de la IA": al menos el último cambio, barato, para
 * todos y con varios niveles).
 *
 * Sólo se puede deshacer el turno MÁS NUEVO que todavía tiene instantánea: no
 * hay forma de saltear uno del medio. Si `messageId` no es exactamente ese
 * (ya se deshizo, ya se podó, o hay uno más nuevo con cambios) se contesta 409
 * en vez de adivinar qué quiso decir el cliente.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user!;
  const project = await findProjectForActor(params.id!, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail('Datos inválidos.', 422);

  /**
   * Un turno en curso puede estar por escribir `currentHtml` en su propio
   * `finally` (stream.ts) en cualquier momento: deshacer al mismo tiempo
   * pisaría esa escritura, o restauraría un "antes" que ya dejó de serlo.
   *
   * Mismo criterio que ya usan el cliente para decidir si hay que retomar un
   * turno (Workspace.tsx, el efecto "Retoma un turno que quedó corriendo en
   * el servidor") y /api/chat/cancel para lo mismo: el ÚLTIMO mensaje de un
   * hilo es del docente ⇒ la IA todavía no le contestó ese turno. Se mira
   * TODOS los hilos del proyecto (no sólo uno) porque `currentHtml` es del
   * proyecto entero, y cualquier hilo puede estar a mitad de un turno.
   */
  const hilos = await prisma.chatThread.findMany({
    where: { projectId: project.id },
    select: { id: true },
  });
  const ultimosPorHilo = await Promise.all(
    hilos.map((hilo) =>
      prisma.chatMessage.findFirst({
        where: { threadId: hilo.id },
        orderBy: { createdAt: 'desc' },
        select: { role: true },
      }),
    ),
  );
  if (ultimosPorHilo.some((mensaje) => mensaje?.role === 'user')) {
    return fail('Hay un pedido de la IA en curso. Esperá a que termine para deshacer.', 409);
  }

  /**
   * La instantánea deshacible es la MÁS NUEVA del proyecto cuyo mensaje
   * todavía no se deshizo — se consulta desde `ProjectSnapshot` (no desde
   * `ChatMessage`) porque la FK vive ahí, así el filtro por relación
   * (`chatMessage: { undoneAt: null }`) es el lado fácil de expresar. El
   * `createdAt` de la instantánea ya refleja el orden de los turnos: se crea
   * en el mismo `finally` que el mensaje "assistant", apenas después.
   */
  const snapshot = await prisma.projectSnapshot.findFirst({
    where: { projectId: project.id, chatMessage: { undoneAt: null } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      html: true,
      chatMessage: { select: { id: true, threadId: true, createdAt: true } },
    },
  });

  if (!snapshot || snapshot.chatMessage.id !== parsed.data.messageId) {
    return fail(
      'Ese cambio ya no se puede deshacer: puede que ya lo hayas deshecho, o que haya uno más nuevo primero.',
      409,
    );
  }

  // El pedido del docente que disparó este turno: el mensaje "user" anterior
  // más cercano, en el mismo hilo. `stream.ts` siempre crea ese mensaje ANTES
  // de llamar a la IA, así que en el camino normal siempre existe.
  const mensajeDocente = await prisma.chatMessage.findFirst({
    where: {
      threadId: snapshot.chatMessage.threadId,
      role: 'user',
      createdAt: { lt: snapshot.chatMessage.createdAt },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  // M8 (design.md §7): un admin deshaciendo el cambio de un recurso ajeno
  // deja la marca, igual que cualquier otra escritura suya sobre ese
  // recurso. Justo antes de la transacción (como en el PATCH de este mismo
  // recurso): si algo de abajo fallara, no queda una marca sin cambio real
  // detrás.
  await marcarSiActuaAdmin(project, user);

  const ahora = new Date();
  const undoneMessageIds = mensajeDocente
    ? [snapshot.chatMessage.id, mensajeDocente.id]
    : [snapshot.chatMessage.id];

  await prisma.$transaction([
    prisma.project.update({ where: { id: project.id }, data: { currentHtml: snapshot.html } }),
    prisma.chatMessage.updateMany({
      where: { id: { in: undoneMessageIds } },
      data: { undoneAt: ahora },
    }),
    prisma.projectSnapshot.delete({ where: { id: snapshot.id } }),
  ]);

  // T18 (round 4, "checklist del docente"): deshacer puede haber dejado
  // atrás el checklist que ESTABA vigente (si el turno deshecho fue el que
  // lo creó) — se lee de nuevo DESPUÉS de la transacción de arriba
  // (`undoneAt` ya quedó puesto) para que el cliente actualice la UI de "Esto
  // es lo que probé" sin tener que adivinar si corresponde o pedirlo aparte.
  const checklist = await checklistActual(project.id);

  return ok({ currentHtml: snapshot.html, undoneMessageIds, checklist });
};
