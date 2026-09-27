import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../../../lib/http.ts';
import { requireUser } from '../../../../../../lib/auth/guards.ts';
import { quitarMiembro, moverMiembro, GestionError } from '../../../../../../lib/orgs/gestion.ts';

/**
 * `/api/admin/organizaciones/:id/miembros/:userId` — baja (DELETE) y mover
 * de sede (PATCH). Mismo criterio que `revocarInvitacion` (invitaciones.ts):
 * el `:id` de la URL es sólo contexto — `quitarMiembro`/`moverMiembro`
 * autorizan siempre contra la organización REAL del docente, releída de la
 * base, nunca contra lo que diga la URL.
 */

const moverSchema = z.object({
  destinoCampusId: z.string().trim().min(1, 'Falta la sede de destino'),
});

/** DELETE — baja: pasa a ser cuenta personal y queda excluida de volver por dominio. */
export const DELETE: APIRoute = async ({ params, locals }) => {
  const actor = requireUser(locals);
  if (actor instanceof Response) return actor;

  try {
    await quitarMiembro(actor, params.userId!);
    return ok({});
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};

/** PATCH — mueve al docente a otra sede (misma red, si el actor no es superadmin). */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const actor = requireUser(locals);
  if (actor instanceof Response) return actor;

  const parsed = moverSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  try {
    await moverMiembro(actor, params.userId!, parsed.data.destinoCampusId);
    return ok({});
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};
