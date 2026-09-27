import type { APIRoute } from 'astro';
import { fail, ok } from '../../../../../lib/http.ts';
import { requireOrgAdmin } from '../../../../../lib/orgs/alcance.ts';
import { listarMiembros, GestionError } from '../../../../../lib/orgs/gestion.ts';

/**
 * GET /api/org/organizaciones/:id/miembros (odd/tasks/organizaciones.md T8)
 * — sólo lectura, para refrescar la lista del lado del cliente después de
 * agregar un email a la lista blanca (puede haber unido a una cuenta
 * personal existente, mismo criterio que `recargarMiembros` en
 * `OrganizacionDetalle.tsx`).
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const organizationId = params.id!;
  const resultado = await requireOrgAdmin(locals, organizationId);
  if (resultado instanceof Response) return resultado;

  try {
    const miembros = await listarMiembros(resultado, organizationId);
    return ok({ miembros });
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};
