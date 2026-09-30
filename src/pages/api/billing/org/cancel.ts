import type { APIRoute } from 'astro';
import { fail, ok } from '../../../../lib/http.ts';
import { requireFreshUser } from '../../../../lib/auth/guards.ts';
import { requireFreshOrgAdmin } from '../../../../lib/orgs/alcance.ts';
import { prisma } from '../../../../lib/db.ts';
import { cancelarOrg } from '../../../../lib/billing/aplicar.ts';

/** POST /api/billing/org/cancel (odd/tasks/planes-y-cobros.md T4) — cancela
 *  al fin del período, sólo el admin de la organización RAÍZ. */
export const POST: APIRoute = async ({ locals }) => {
  const user = requireFreshUser(locals);
  if (user instanceof Response) return user;

  const fila = await prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } });
  if (!fila?.organizationId) return fail('Tu cuenta no pertenece a ninguna organización.', 403);

  const org = await prisma.organization.findUnique({ where: { id: fila.organizationId }, select: { parentId: true } });
  const rootId = org?.parentId ?? fila.organizationId;

  const autorizado = await requireFreshOrgAdmin(locals, rootId);
  if (autorizado instanceof Response) return autorizado;

  const resultado = await cancelarOrg(rootId);
  if (!resultado.ok) return fail(resultado.message, resultado.status);
  return ok(resultado.data);
};
