import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { requireFreshUser } from '../../../../lib/auth/guards.ts';
import { requireFreshOrgAdmin } from '../../../../lib/orgs/alcance.ts';
import { prisma } from '../../../../lib/db.ts';
import { crearCheckoutOrg } from '../../../../lib/billing/aplicar.ts';

/**
 * POST /api/billing/org/checkout (odd/tasks/planes-y-cobros.md T4): contrata
 * la licencia institucional de la organización RAÍZ de quien llama —
 * SOLO un admin de esa raíz (`requireFreshOrgAdmin`), nunca de un
 * `organizationId` que mande el cliente (evita que un docente cualquiera
 * arranque un cobro de una institución ajena).
 */
const schema = z.object({
  interval: z.enum(['MONTHLY', 'CYCLE']),
  legalName: z.string().trim().min(1),
  cuit: z.string().trim().min(1),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const user = requireFreshUser(locals);
  if (user instanceof Response) return user;

  const fila = await prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true, email: true } });
  if (!fila?.organizationId) return fail('Tu cuenta no pertenece a ninguna organización.', 403);

  const org = await prisma.organization.findUnique({ where: { id: fila.organizationId }, select: { parentId: true } });
  const rootId = org?.parentId ?? fila.organizationId;

  const autorizado = await requireFreshOrgAdmin(locals, rootId);
  if (autorizado instanceof Response) return autorizado;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const resultado = await crearCheckoutOrg({ id: user.id, email: fila.email }, rootId, parsed.data);
  if (!resultado.ok) return fail(resultado.message, resultado.status, resultado.reason ? { reason: resultado.reason } : {});
  return ok({ url: resultado.data.url });
};
