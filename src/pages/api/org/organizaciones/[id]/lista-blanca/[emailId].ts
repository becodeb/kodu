import type { APIRoute } from 'astro';
import { fail, ok } from '../../../../../../lib/http.ts';
import { requireFreshOrgAdmin } from '../../../../../../lib/orgs/alcance.ts';
import { quitarEmailListaBlanca, GestionError } from '../../../../../../lib/orgs/gestion.ts';

/** DELETE /api/org/organizaciones/:id/lista-blanca/:emailId (odd/tasks/organizaciones.md T8). */
export const DELETE: APIRoute = async ({ params, locals }) => {
  const organizationId = params.id!;
  const resultado = await requireFreshOrgAdmin(locals, organizationId);
  if (resultado instanceof Response) return resultado;

  try {
    await quitarEmailListaBlanca(resultado, organizationId, params.emailId!);
    return ok({});
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};
