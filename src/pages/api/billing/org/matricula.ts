import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { requireFreshUser } from '../../../../lib/auth/guards.ts';
import { requireFreshOrgAdmin } from '../../../../lib/orgs/alcance.ts';
import { prisma } from '../../../../lib/db.ts';
import { bandForStudents } from '../../../../lib/billing/bandas.ts';

/**
 * POST /api/billing/org/matricula (odd/tasks/planes-y-cobros.md T6):
 * actualiza la matrícula DECLARADA de la licencia de la organización RAÍZ.
 * Sólo cambia `declaredStudents` — `bandKey` queda CONGELADA (comentario de
 * `OrganizationLicense` en schema.prisma) hasta el próximo cobro, que es
 * donde `aplicar.ts` recalcula la banda; acá sólo se avisa cuál sería la
 * banda nueva, para que la página explique "el precio nuevo aplica desde el
 * próximo cobro" sin tocar nada más.
 */
const schema = z.object({ declaredStudents: z.coerce.number().int().min(1) });

export const POST: APIRoute = async ({ request, locals }) => {
  const user = requireFreshUser(locals);
  if (user instanceof Response) return user;

  const fila = await prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } });
  if (!fila?.organizationId) return fail('Tu cuenta no pertenece a ninguna organización.', 403);

  const org = await prisma.organization.findUnique({ where: { id: fila.organizationId }, select: { parentId: true } });
  const rootId = org?.parentId ?? fila.organizationId;

  const autorizado = await requireFreshOrgAdmin(locals, rootId);
  if (autorizado instanceof Response) return autorizado;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const license = await prisma.organizationLicense.findUnique({ where: { organizationId: rootId } });
  if (!license) return fail('No encontramos la licencia de tu institución.', 404);

  await prisma.organizationLicense.update({
    where: { id: license.id },
    data: { declaredStudents: parsed.data.declaredStudents },
  });

  const settings = await prisma.billingSettings.findUniqueOrThrow({ where: { id: 1 } });
  const banda = bandForStudents(parsed.data.declaredStudents, settings.hablemosThresholdStudents);
  if (banda.kind !== 'band') return ok({ declaredStudents: parsed.data.declaredStudents, reason: 'HABLEMOS' as const });

  const filaBanda = await prisma.institutionalBand.findUniqueOrThrow({ where: { key: banda.key } });
  return ok({
    declaredStudents: parsed.data.declaredStudents,
    bandName: filaBanda.name,
    monthlyPriceArs: filaBanda.monthlyPriceArs.toNumber(),
    cyclePriceArs: filaBanda.cyclePriceArs.toNumber(),
  });
};
