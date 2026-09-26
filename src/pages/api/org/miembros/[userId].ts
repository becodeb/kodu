import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { prisma } from '../../../../lib/db.ts';
import { requireFreshOrgAdmin } from '../../../../lib/orgs/alcance.ts';
import { quitarMiembro, moverMiembro, GestionError } from '../../../../lib/orgs/gestion.ts';

/**
 * `/api/org/miembros/:userId` (odd/tasks/organizaciones.md T8) — baja
 * (DELETE) y mover de sede (PATCH), mismo par que
 * `/api/admin/organizaciones/:id/miembros/:userId` (T6) pero SIN un
 * `:id` de organización en la URL (acá no hace falta ni siquiera como
 * contexto): se relee la sede ACTUAL real del docente antes de autorizar,
 * nunca se confía en nada que mande el cliente — mismo criterio que
 * `quitarMiembro`/`moverMiembro` en `gestion.ts`, que vuelven a autorizar
 * solas de todos modos.
 */

async function organizacionActualDelMiembro(userId: string): Promise<string | null> {
  const miembro = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
  return miembro?.organizationId ?? null;
}

const moverSchema = z.object({
  destinoCampusId: z.string().trim().min(1, 'Falta la sede de destino'),
});

/** DELETE — baja: pasa a ser cuenta personal y queda excluida de volver por dominio. */
export const DELETE: APIRoute = async ({ params, locals }) => {
  const userId = params.userId!;
  const organizationId = await organizacionActualDelMiembro(userId);
  if (!organizationId) return fail('No encontramos ese docente.', 404);

  const resultado = await requireFreshOrgAdmin(locals, organizationId);
  if (resultado instanceof Response) return resultado;

  try {
    await quitarMiembro(resultado, userId);
    return ok({});
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};

/** PATCH — mueve al docente a otra sede (misma red, si el actor no es superadmin). */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const userId = params.userId!;
  const parsed = moverSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const organizationId = await organizacionActualDelMiembro(userId);
  if (!organizationId) return fail('No encontramos ese docente.', 404);

  // `requireFreshOrgAdmin` sólo confirma acá la sede de ORIGEN + identidad
  // fresca — `moverMiembro` (gestion.ts) vuelve a autorizar TAMBIÉN contra el
  // destino, así que un admin de una sola sede nunca puede mover a un
  // docente hacia una sede ajena aunque administre el origen.
  const resultado = await requireFreshOrgAdmin(locals, organizationId);
  if (resultado instanceof Response) return resultado;

  try {
    await moverMiembro(resultado, userId, parsed.data.destinoCampusId);
    return ok({});
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};
