-- odd/tasks/planes-y-cobros.md (T11, decisiones del dueño):
--
-- 1. La prueba institucional pasa a ser un interruptor del superadmin
--    ("todavía tenemos 0 clientes") — arranca APAGADO. `PENDING_PAYMENT` es
--    el estado nuevo de una licencia dada de alta con la prueba apagada: no
--    tuvo prueba, bloquea la IA con un motivo explícito, nunca una prueba
--    fingida ya vencida.
-- 2. Precios reales de lanzamiento, reemplazando los PLACEHOLDER de
--    20261012000000_planes_y_cobros / prisma/seed.ts — mismo criterio que
--    20261017000000_valor_credito: SÓLO pisa una fila que todavía tiene el
--    valor VIEJO placeholder exacto (si el superadmin ya la cambió desde
--    /admin/precios, no se toca).

-- AlterEnum
ALTER TYPE "LicenseStatus" ADD VALUE 'PENDING_PAYMENT';

-- AlterTable
ALTER TABLE "BillingSettings" ADD COLUMN "trialEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Bandas institucionales: Pequeña 90.000/900.000 → 95.000/950.000; Mediana
-- 180.000/1.800.000 → 155.000/1.550.000; Grande 350.000/3.500.000 →
-- 280.000/2.800.000.
UPDATE "InstitutionalBand"
SET "monthlyPriceArs" = 95000, "cyclePriceArs" = 950000
WHERE "key" = 'PEQUENA' AND "monthlyPriceArs" = 90000 AND "cyclePriceArs" = 900000;

UPDATE "InstitutionalBand"
SET "monthlyPriceArs" = 155000, "cyclePriceArs" = 1550000
WHERE "key" = 'MEDIANA' AND "monthlyPriceArs" = 180000 AND "cyclePriceArs" = 1800000;

UPDATE "InstitutionalBand"
SET "monthlyPriceArs" = 280000, "cyclePriceArs" = 2800000
WHERE "key" = 'GRANDE' AND "monthlyPriceArs" = 350000 AND "cyclePriceArs" = 3500000;

-- Plan Individual: 9.000/mes, 90.000/año → 7.900/mes, 79.000/año.
UPDATE "IndividualPlan"
SET "monthlyPriceArs" = 7900
WHERE "key" = 'INDIVIDUAL' AND "monthlyPriceArs" = 9000;

UPDATE "IndividualPlan"
SET "annualPriceArs" = 79000
WHERE "key" = 'INDIVIDUAL' AND "annualPriceArs" = 90000;
