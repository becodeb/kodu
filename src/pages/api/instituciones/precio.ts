import type { APIRoute } from 'astro';
import { fail, ok } from '../../../lib/http.ts';
import { requireUser } from '../../../lib/auth/guards.ts';
import { prisma } from '../../../lib/db.ts';
import { bandForStudents } from '../../../lib/billing/bandas.ts';

/**
 * GET /api/instituciones/precio?alumnos=N (odd/tasks/planes-y-cobros.md T5):
 * calculadora en vivo para el formulario de alta — banda + precio mensual y
 * de ciclo lectivo, siempre leídos del catálogo (`InstitutionalBand`,
 * editable desde el superadmin), nunca hardcodeados en el cliente. Sólo
 * lectura: `requireUser` alcanza (no `requireFreshUser` — no muta nada).
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const user = requireUser(locals);
  if (user instanceof Response) return user;

  const crudo = url.searchParams.get('alumnos');
  const alumnos = Number(crudo);
  if (!crudo || !Number.isFinite(alumnos)) return fail('Falta la matrícula.', 422);

  const settings = await prisma.billingSettings.findUniqueOrThrow({ where: { id: 1 } });
  const banda = bandForStudents(alumnos, settings.hablemosThresholdStudents);

  if (banda.kind === 'invalid') return fail(banda.reason, 422);
  if (banda.kind === 'hablemos') return ok({ kind: 'hablemos' as const });

  const fila = await prisma.institutionalBand.findUniqueOrThrow({ where: { key: banda.key } });
  return ok({
    kind: 'band' as const,
    bandKey: banda.key,
    bandName: fila.name,
    monthlyPriceArs: fila.monthlyPriceArs.toNumber(),
    cyclePriceArs: fila.cyclePriceArs.toNumber(),
  });
};
