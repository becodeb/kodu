import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../../../lib/http.ts';
import { requireFreshOrgAdmin } from '../../../../../../lib/orgs/alcance.ts';
import { degradarAdmin, fijarFacturacionAdmin, GestionError } from '../../../../../../lib/orgs/gestion.ts';

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

const facturacionSchema = z.object({
  canManageBilling: z.boolean({ message: 'Falta indicar si tiene facturación' }),
});

/**
 * PATCH /api/org/organizaciones/:id/admins/:userId (odd/tasks/org-admin-facturacion.md)
 * — `{ canManageBilling }` da o quita la facturación a un admin de la
 * organización RAÍZ `:id`. Las reglas (sólo titulares/superadmin, el destino
 * tiene que ser admin, la raíz no se queda sin titular) viven en
 * `fijarFacturacionAdmin`.
 */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const organizationId = params.id!;
  const parsed = facturacionSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const resultado = await requireFreshOrgAdmin(locals, organizationId);
  if (resultado instanceof Response) return resultado;

  try {
    await fijarFacturacionAdmin(resultado, organizationId, params.userId!, parsed.data.canManageBilling);
    return ok({ canManageBilling: parsed.data.canManageBilling });
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};
