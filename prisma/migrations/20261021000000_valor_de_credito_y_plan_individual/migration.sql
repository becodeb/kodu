-- odd/tasks/ahorro-tokens.md (T8): lower the real value of a credit, raise
-- the INDIVIDUAL plan's monthly allotment to match.
--
-- The owner's final decision (credits were never used in production, so no
-- ledger conversion is needed — see the task text):
--   - FREE stays at 100 welcome / 50 monthly credits. UNCHANGED.
--   - BillingSettings.creditUsdValue: USD 0.0025 -> USD 0.001 per credit.
--   - IndividualPlan(INDIVIDUAL).monthlyCredits: 1,000 -> 2,500, so it still
--     covers USD 2.50 of usage a month (2500 * 0.001 = 1000 * 0.0025 = 2.50).
--
-- This migration also plugs a gap found while investigating T8: the
-- production entrypoint (docker/prod-entrypoint.sh) runs ONLY
-- `prisma migrate deploy`, never `prisma/seed.ts` — unlike BillingSettings
-- (inserted by 20261012000000_planes_y_cobros, step further down in this
-- same file's lineage), NO migration ever inserted the FREE/INDIVIDUAL
-- IndividualPlan rows. A genuinely fresh production deploy of this branch
-- would boot with an EMPTY IndividualPlan table. Step 1 below fixes that,
-- idempotently (ON CONFLICT DO NOTHING, same pattern as BillingSettings).
--
-- Idempotent throughout: every statement is guarded so a second run changes
-- nothing. The two UPDATEs only touch rows still at the OLD default, so a
-- value an admin already edited by hand is never overwritten — same
-- "transitional/guarded update" pattern used for AppSettings/AiModel
-- elsewhere in this branch (T1, T6).

-- 1. Guarantee the two plan rows exist (fresh-deploy safety net) -----------
-- Values here are the CURRENT (post-T8) defaults directly — a brand-new row
-- has no "old default" to migrate away from.
INSERT INTO "IndividualPlan" (id, key, name, "monthlyPriceArs", "annualPriceArs", "monthlyCredits", "welcomeCredits", active, "sortOrder", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'FREE', 'Gratis', 0, NULL, 50, 100, true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "IndividualPlan" (id, key, name, "monthlyPriceArs", "annualPriceArs", "monthlyCredits", "welcomeCredits", active, "sortOrder", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'INDIVIDUAL', 'Individual', 9000, 90000, 2500, 0, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- 2. Lower the credit's real USD value, guarded on the old default ---------
UPDATE "BillingSettings"
SET "creditUsdValue" = 0.001, "updatedAt" = CURRENT_TIMESTAMP
WHERE id = 1 AND "creditUsdValue" = 0.0025;

-- 3. Raise INDIVIDUAL's monthly allotment, guarded on the old default ------
-- FREE is explicitly UNCHANGED (100 welcome / 50 monthly) — the owner's
-- decision text draws that line clearly; this migration never touches it.
UPDATE "IndividualPlan"
SET "monthlyCredits" = 2500, "updatedAt" = CURRENT_TIMESTAMP
WHERE key = 'INDIVIDUAL' AND "monthlyCredits" = 1000;
