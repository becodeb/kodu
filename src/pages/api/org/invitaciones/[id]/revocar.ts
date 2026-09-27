import type { APIRoute } from 'astro';
import { fail, ok } from '../../../../../lib/http.ts';
import { requireFreshOrgAdmin } from '../../../../../lib/orgs/alcance.ts';
import { invitacionPorId, revocarInvitacion } from '../../../../../lib/orgs/invitaciones.ts';

/**
 * POST /api/org/invitaciones/[id]/revocar (odd/tasks/organizaciones.md T4).
 *
 * NUNCA se confía en un `organizationId` que mande el body o la URL para
 * autorizar esto: se carga la invitación primero y se autoriza contra SU
 * organización real — así un admin de la sede A no puede revocar una
 * invitación de la sede B con sólo mandar el id de la suya en otro campo.
 */
export const POST: APIRoute = async ({ params, locals }) => {
  const id = params.id;
  if (!id) return fail('Falta la invitación.', 422);

  const invitacion = await invitacionPorId(id);
  if (!invitacion) return fail('No encontramos esa invitación.', 404);

  const resultado = await requireFreshOrgAdmin(locals, invitacion.organizationId);
  if (resultado instanceof Response) return resultado;

  await revocarInvitacion(id);
  return ok({});
};
