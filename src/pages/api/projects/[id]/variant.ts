import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../../lib/db.ts';
import { findProjectForActor, hayTurnoEnCurso, marcarSiActuaAdmin } from '../../../../lib/projects.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';

const schema = z.object({
  /** El mensaje "assistant" del turno de versiones cuya elección se pide cambiar. */
  messageId: z.string().min(1),
  /** 1, 2 o 3 — el chip que tocó el docente. */
  index: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

/**
 * POST /api/projects/:id/variant — cambia cuál de las versiones generadas
 * por un turno de versiones está activa (T9, "Varias versiones al crear un
 * recurso"). Mismas guardas que
 * POST /api/projects/:id/undo (T4): proyecto del actor, marca de admin, 409
 * con un turno en curso, 409 si el mensaje no es el más nuevo con versiones,
 * 404/422 por un índice ausente.
 *
 * El instantáneo de T4 (`ProjectSnapshot`) no se toca acá: sigue siendo el
 * HTML de ANTES del turno de versiones, así que un "Deshacer" después de
 * elegir una versión vuelve al recurso de arranque, sin importar cuál se
 * haya elegido — nunca "a la versión 1", que dejaría de existir después de
 * deshacer.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user!;
  const project = await findProjectForActor(params.id!, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail('Datos inválidos.', 422);

  // Mismo criterio que /undo (T4): el último mensaje de CUALQUIER hilo del
  // proyecto es del docente ⇒ la IA todavía no le contestó ese turno.
  if (await hayTurnoEnCurso(project.id)) {
    return fail('Hay un pedido de la IA en curso. Esperá a que termine para elegir una versión.', 409);
  }

  // La versión sólo se puede cambiar en el turno de versiones MÁS NUEVO del
  // proyecto: stream.ts borra las de cualquier turno anterior apenas
  // arranca el siguiente (ver la tarea, "the next turn removes ... the
  // stored versions"), así que en la práctica nunca hay más de un mensaje
  // con versiones vivas a la vez — pero se busca por relación, sin
  // asumirlo, igual que /undo busca la instantánea más nueva en vez de
  // confiar en que sólo puede haber una.
  const masNuevoConVersiones = await prisma.chatMessage.findFirst({
    where: { thread: { projectId: project.id }, variants: { some: {} } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (!masNuevoConVersiones || masNuevoConVersiones.id !== parsed.data.messageId) {
    return fail(
      'Esas versiones ya no están disponibles: puede que ya hayas mandado otro pedido.',
      409,
    );
  }

  const variante = await prisma.resourceVariant.findUnique({
    where: { chatMessageId_index: { chatMessageId: parsed.data.messageId, index: parsed.data.index } },
  });
  if (!variante) return fail('Esa versión no existe.', 404);

  // M8 (design.md §7): mismo criterio que stream.ts/undo.ts — un admin
  // eligiendo la versión de un recurso ajeno deja la marca.
  await marcarSiActuaAdmin(project, user);

  await prisma.$transaction([
    prisma.project.update({ where: { id: project.id }, data: { currentHtml: variante.html } }),
    prisma.chatMessage.update({
      where: { id: parsed.data.messageId },
      data: { chosenVariantIndex: parsed.data.index },
    }),
  ]);

  return ok({ html: variante.html });
};
