-- odd/tasks/planes-y-cobros.md (T10, decisión del dueño): nuevos valores de
-- crédito — 1 crédito pasa de USD 0,0025 a USD 0,001 de costo real, y el
-- plan Individual pasa de 1.000 a 2.500 créditos por mes. El dueño edita
-- estos valores desde /admin/precios (T7): esta migración SÓLO toca una fila
-- que todavía tiene el valor VIEJO placeholder, igual que `prisma/seed.ts`
-- (mismo criterio documentado ahí) — si ya los cambió a mano, esto no les
-- pisa nada.

ALTER TABLE "BillingSettings" ALTER COLUMN "creditUsdValue" SET DEFAULT 0.001;

UPDATE "BillingSettings"
SET "creditUsdValue" = 0.001
WHERE "creditUsdValue" = 0.0025;

UPDATE "IndividualPlan"
SET "monthlyCredits" = 2500
WHERE "key" = 'INDIVIDUAL' AND "monthlyCredits" = 1000;
