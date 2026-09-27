import type { APIRoute } from 'astro';
import { fail, ok } from '../../../../../../lib/http.ts';
import { requireFreshOrgAdmin } from '../../../../../../lib/orgs/alcance.ts';
import { degradarAdmin, GestionError } from '../../../../../../lib/orgs/gestion.ts';

/**
 * DELETE /api/org/organizaciones/:id/admins/:userId (odd/tasks/organizaciones.md
 * T8) — degrada. `degradarAdmin` en gestion.ts es donde vive la regla del
 * "último admin no puede sacarse a sí mismo" (409); acá no se reimplementa.
 */
export const DELETE: APIRoute = async ({ params, locals }) => {
  const organizationId = params.id!;
  const resultado = await requireFreshOrgAdmin(locals, organizationId);
  if (resultado instanceof Response) return resultado;

  try {
    await degradarAdmin(resultado, organizationId, params.userId!);
    return ok({});
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};
