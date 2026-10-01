import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../../lib/db.ts';
import { findProjectForActor } from '../../../../lib/projects.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';

/**
 * POST /api/projects/:id/feedback — odd/tasks/ahorro-tokens.md (T5): la
 * carita bajo una respuesta de la IA, el texto corto de "¿Qué falló?", la
 * respuesta a la pregunta inline del chat (o su descarte), y "No preguntar
 * más". Las cuatro cosas comparten un endpoint chico: todas son feedback
 * del MISMO turno (o, para `disablePrompts`, una preferencia de la cuenta
 * entera, sin `messageId`).
 *
 * Nunca falla "fuerte" si la traza no existe (un turno viejo de antes de T4,
 * o uno donde `recordAiTrace` no se pudo escribir): se contesta 200 sin
 * tocar nada — el feedback es opcional, perderlo en silencio es preferible
 * a mostrarle un error al docente por algo que no puede arreglar.
 */

const schema = z
  .object({
    messageId: z.string().min(1).optional(),
    faceRating: z.enum(['GOOD', 'NEUTRAL', 'BAD']).optional(),
    comment: z.string().trim().max(500).optional(),
    questionAnswer: z.enum(['SI', 'MAS_O_MENOS', 'NO']).optional(),
    dismissQuestion: z.boolean().optional(),
    disablePrompts: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.disablePrompts !== undefined ||
      (data.messageId &&
        (data.faceRating !== undefined ||
          data.comment !== undefined ||
          data.questionAnswer !== undefined ||
          data.dismissQuestion !== undefined)),
    { message: 'No hay nada para guardar.' },
  );

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user!;
  const project = await findProjectForActor(params.id!, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  const { messageId, faceRating, comment, questionAnswer, dismissQuestion, disablePrompts } = parsed.data;

  if (disablePrompts) {
    await prisma.user.update({ where: { id: user.id }, data: { feedbackPromptsDisabled: true } });
  }

  if (messageId) {
    const traza = await prisma.aiTrace.findUnique({
      where: { chatMessageId: messageId },
      select: { id: true, projectId: true, faceRating: true },
    });

    // Turno viejo sin traza, o traza de otro proyecto (no debería pasar
    // nunca, pero nunca se confía en el `messageId` solo): se contesta OK
    // sin tocar nada — ver el comentario de arriba.
    if (traza && traza.projectId === project.id) {
      await prisma.aiTrace.update({
        where: { id: traza.id },
        data: {
          ...(faceRating !== undefined
            ? {
                // Un segundo tap sobre la MISMA carita la borra; una
                // distinta la cambia (texto de la tarea: "a second tap
                // changes or clears it").
                faceRating: traza.faceRating === faceRating ? null : faceRating,
                faceRatingAt: new Date(),
              }
            : {}),
          ...(comment !== undefined ? { faceRatingComment: comment || null } : {}),
          ...(questionAnswer !== undefined || dismissQuestion
            ? { inlineQuestionAnswer: questionAnswer ?? 'DESCARTADA', inlineQuestionAt: new Date() }
            : {}),
        },
      });
    }
  }

  return ok({});
};
