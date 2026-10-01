import type { APIRoute } from 'astro';
import { fail, ok } from '../../../../lib/http.ts';
import { requireFreshUser } from '../../../../lib/auth/guards.ts';
import { requireFreshOrgAdmin } from '../../../../lib/orgs/alcance.ts';
import { prisma } from '../../../../lib/db.ts';
import { crearCheckoutRenovacionOrg } from '../../../../lib/billing/aplicar.ts';

/**
 * POST /api/billing/org/renovar (odd/tasks/planes-y-cobros.md T4b): renueva
 * el ciclo lectivo de la organización RAÍZ de quien llama, antes o después
 * de que venza — mismo criterio de autorización que `org/checkout.ts` (sólo
 * un admin de la raíz). Sin body: el monto y el período los calcula el
 * servidor a partir de la licencia ya contratada.
 */
export const POST: APIRoute = async ({ locals }) => {
  const user = requireFreshUser(locals);
  if (user instanceof Response) return user;

  const fila = await prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true, email: true } });
  if (!fila?.organizationId) return fail('Tu cuenta no pertenece a ninguna organización.', 403);

  const org = await prisma.organization.findUnique({ where: { id: fila.organizationId }, select: { parentId: true } });
  const rootId = org?.parentId ?? fila.organizationId;

  const autorizado = await requireFreshOrgAdmin(locals, rootId);
  if (autorizado instanceof Response) return autorizado;

  const resultado = await crearCheckoutRenovacionOrg({ id: user.id, email: fila.email }, rootId);
  if (!resultado.ok) return fail(resultado.message, resultado.status, resultado.reason ? { reason: resultado.reason } : {});
  return ok({ url: resultado.data.url });
};
