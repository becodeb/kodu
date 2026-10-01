import type { APIRoute } from 'astro';
import { fail, ok } from '../../../../lib/http.ts';
import { requireFreshUser } from '../../../../lib/auth/guards.ts';
import { requireFreshOrgAdmin } from '../../../../lib/orgs/alcance.ts';
import { prisma } from '../../../../lib/db.ts';
import { billingNow } from '../../../../lib/env.ts';
import { bandForStudents } from '../../../../lib/billing/bandas.ts';
import { firstCharge } from '../../../../lib/billing/ciclo.ts';

/**
 * GET /api/billing/org/preview?interval=MONTHLY|CYCLE (odd/tasks/planes-y-cobros.md
 * T6): la vista previa de "lo que pagás hoy y qué período cubre" ANTES de
 * tocar "Pagar" — exactamente lo que calcula `firstCharge` (ciclo.ts), para
 * que `/org/plan` lo muestre sin crear ningún `Payment`. Sólo lectura (no usa
 * `crearCheckoutOrg`, que sí escribe) — admin de la organización RAÍZ.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const user = requireFreshUser(locals);
  if (user instanceof Response) return user;

  const interval = url.searchParams.get('interval');
  if (interval !== 'MONTHLY' && interval !== 'CYCLE') return fail('Falta el intervalo (MONTHLY o CYCLE).', 422);

  const fila = await prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } });
  if (!fila?.organizationId) return fail('Tu cuenta no pertenece a ninguna organización.', 403);

  const org = await prisma.organization.findUnique({ where: { id: fila.organizationId }, select: { parentId: true } });
  const rootId = org?.parentId ?? fila.organizationId;

  const autorizado = await requireFreshOrgAdmin(locals, rootId);
  if (autorizado instanceof Response) return autorizado;

  const license = await prisma.organizationLicense.findUnique({ where: { organizationId: rootId } });
  if (!license) return fail('No encontramos la licencia de tu institución.', 404);

  const settings = await prisma.billingSettings.findUniqueOrThrow({ where: { id: 1 } });
  const banda = bandForStudents(license.declaredStudents, settings.hablemosThresholdStudents);
  if (banda.kind !== 'band') {
    return fail('Tu matrícula no tiene un precio fijo — escribinos y lo vemos.', 422, { reason: 'HABLEMOS' });
  }

  const filaBanda = await prisma.institutionalBand.findUniqueOrThrow({ where: { key: banda.key } });
  const resultado = firstCharge({
    date: billingNow(),
    interval,
    banda: {
      monthlyPriceArs: filaBanda.monthlyPriceArs.toNumber(),
      cyclePriceArs: filaBanda.cyclePriceArs.toNumber(),
    },
  });

  return ok({
    amountArs: resultado.amountArs,
    periodStart: resultado.periodStart.toISOString(),
    periodEnd: resultado.periodEnd.toISOString(),
    note: resultado.note,
    bandName: filaBanda.name,
  });
};
