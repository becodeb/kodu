import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { requireFreshAdmin } from '../../../../lib/auth/guards.ts';
import { prisma } from '../../../../lib/db.ts';

/**
 * PATCH /api/admin/billing/precios (odd/tasks/planes-y-cobros.md T7): editor
 * de precios del superadmin. El middleware ya garantiza ADMIN fresco en
 * `/api/admin/**` para una mutación (ver `src/middleware.ts`).
 *
 * Los límites de matrícula de cada banda (`minStudents`/`maxStudents`) NO
 * se editan acá a propósito, aunque `InstitutionalBand` tenga esas columnas:
 * son una regla del negocio FIJA (odd/tasks/planes-y-cobros.md, "Decisiones
 * del dueño — no reabrir": "Pequeña hasta 300, Mediana 301–800, Grande
 * 801–1.500") que vive hardcodeada en `src/lib/billing/bandas.ts`
 * (`LIMITES_DE_BANDA`), no en esta tabla — esa tabla sólo guarda el PRECIO.
 * Dejar que el superadmin edite esas columnas sin tocar `bandas.ts` crearía
 * una UI que miente (el límite que ve no sería el que de verdad se aplica al
 * contratar). Lo único configurable de "dónde empieza Hablemos" es
 * `BillingSettings.hablemosThresholdStudents`, que sí se edita acá.
 */

const bandaSchema = z.object({
  key: z.enum(['PEQUENA', 'MEDIANA', 'GRANDE']),
  name: z.string().trim().min(1),
  monthlyPriceArs: z.coerce.number().positive(),
  cyclePriceArs: z.coerce.number().positive(),
  active: z.boolean(),
});

const planSchema = z.object({
  key: z.enum(['FREE', 'INDIVIDUAL']),
  name: z.string().trim().min(1),
  monthlyPriceArs: z.coerce.number().min(0),
  annualPriceArs: z.coerce.number().positive().nullable(),
  monthlyCredits: z.coerce.number().int().min(0),
  welcomeCredits: z.coerce.number().int().min(0),
  active: z.boolean(),
});

const settingsSchema = z.object({
  creditUsdValue: z.coerce.number().positive(),
  trialDays: z.coerce.number().int().min(0),
  graceDays: z.coerce.number().int().min(0),
  hablemosThresholdStudents: z.coerce.number().int().min(1),
  monotributoAnnualCapArs: z.coerce.number().positive().nullable(),
});

const schema = z.object({
  bands: z.array(bandaSchema).min(1),
  plans: z.array(planSchema).min(1),
  settings: settingsSchema,
});

export const PATCH: APIRoute = async ({ request, locals }) => {
  const user = requireFreshAdmin(locals);
  if (user instanceof Response) return user;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const { bands, plans, settings } = parsed.data;

  const [bandasActuales, planesActuales, settingsActuales] = await Promise.all([
    prisma.institutionalBand.findMany(),
    prisma.individualPlan.findMany(),
    prisma.billingSettings.findUniqueOrThrow({ where: { id: 1 } }),
  ]);

  const resumen: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const banda of bands) {
      const actual = bandasActuales.find((b) => b.key === banda.key);
      if (!actual) continue;
      await tx.institutionalBand.update({
        where: { key: banda.key },
        data: {
          name: banda.name,
          monthlyPriceArs: banda.monthlyPriceArs,
          cyclePriceArs: banda.cyclePriceArs,
          active: banda.active,
        },
      });
      if (actual.monthlyPriceArs.toNumber() !== banda.monthlyPriceArs || actual.cyclePriceArs.toNumber() !== banda.cyclePriceArs) {
        resumen.push(
          `banda ${banda.key}: mensual ${actual.monthlyPriceArs}→${banda.monthlyPriceArs}, ciclo ${actual.cyclePriceArs}→${banda.cyclePriceArs}`,
        );
      }
    }

    for (const plan of plans) {
      const actual = planesActuales.find((p) => p.key === plan.key);
      if (!actual) continue;
      await tx.individualPlan.update({
        where: { key: plan.key },
        data: {
          name: plan.name,
          monthlyPriceArs: plan.monthlyPriceArs,
          annualPriceArs: plan.annualPriceArs,
          monthlyCredits: plan.monthlyCredits,
          welcomeCredits: plan.welcomeCredits,
          active: plan.active,
        },
      });
      if (actual.monthlyPriceArs.toNumber() !== plan.monthlyPriceArs) {
        resumen.push(`plan ${plan.key}: mensual ${actual.monthlyPriceArs}→${plan.monthlyPriceArs}`);
      }
    }

    await tx.billingSettings.update({
      where: { id: 1 },
      data: {
        creditUsdValue: settings.creditUsdValue,
        trialDays: settings.trialDays,
        graceDays: settings.graceDays,
        hablemosThresholdStudents: settings.hablemosThresholdStudents,
        monotributoAnnualCapArs: settings.monotributoAnnualCapArs,
      },
    });
    if (settingsActuales.hablemosThresholdStudents !== settings.hablemosThresholdStudents) {
      resumen.push(`umbral Hablemos: ${settingsActuales.hablemosThresholdStudents}→${settings.hablemosThresholdStudents}`);
    }

    await tx.billingAuditLog.create({
      data: {
        actorId: user.id,
        actorEmail: user.email,
        entityType: 'precios',
        entityId: 'catalogo',
        summary: resumen.length > 0 ? resumen.join('; ') : 'sin cambios de precio (guardado igual)',
      },
    });
  });

  return ok({});
};
