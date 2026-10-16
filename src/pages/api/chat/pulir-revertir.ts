import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { findProjectForActor } from '../../../lib/projects.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';

/**
 * POST /api/chat/pulir-revertir — T15 (motor-claude, "haiku-pulido"): el
 * cliente llama esto cuando el self-test que corre UNA vez después de
 * `/api/chat/pulir` falla (o aparece algún error nuevo) sobre el HTML
 * pulido — mismo `updateMany` condicionado que `autocorreccion.ts`/
 * `pulir.ts` usan para persistir, acá al revés: sólo pisa `currentHtml` si
 * TODAVÍA es el HTML pulido que este revert espera deshacer (`htmlPulido`
 * en el `where`); si el docente ya escribió un mensaje nuevo, deshizo, o
 * tocó el código a mano mientras el self-test corría, `count` sale 0 y esto
 * es un no-op silencioso — ese HTML más nuevo nunca se pisa con el
 * original pre-pulido.
 *
 * Nunca un error visible: el turno de creación que disparó el pulido ya
 * había terminado bien antes de que esto corriera (mismo criterio que T5
 * para el arreglo silencioso del revisor) — cualquier "no corresponde" acá
 * es un `200` discreto.
 */

const schema = z.object({
  projectId: z.string().min(1),
  htmlPulido: z.string().min(1),
  htmlOriginal: z.string().min(1),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail('Datos inválidos', 422);
  const { projectId, htmlPulido, htmlOriginal } = parsed.data;

  const project = await findProjectForActor(projectId, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  const escritura = await prisma.project.updateMany({
    where: { id: project.id, currentHtml: htmlPulido },
    data: { currentHtml: htmlOriginal },
  });

  return ok({ revertido: escritura.count > 0 });
};
