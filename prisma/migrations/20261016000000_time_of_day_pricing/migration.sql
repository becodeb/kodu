-- odd/tasks/ahorro-tokens.md (T1): time-of-day pricing.
--
-- DeepSeek bills half price off-peak and the app always used the flat peak
-- price, so recorded cost overstated reality by about 2x for DeepSeek turns.
-- This migration:
--   1. Adds an optional schedule to AiModel (no schedule = today's behavior).
--   2. Sets the official DeepSeek schedule (peak 01:00-04:00 and 06:00-10:00
--      UTC, Mon-Fri, factor 0.5) on every AiModel whose provider's baseUrl
--      points at api.deepseek.com.
--   3. Backfills existing TokenUsage rows of those models that fall
--      off-peak: costUsd and the three price snapshots scale by the same
--      factor (they were all computed from the same flat peak price, so
--      scaling every component by `factor` is exactly equivalent to having
--      applied the off-peak price from the start).
--   4. Where that recomputed cost was already debited from a personal
--      account's credit ledger (append-only, never mutated), refunds the
--      difference as a new ADJUSTMENT entry instead of touching the old
--      USAGE row.
--
-- Idempotent: every UPDATE/INSERT below is guarded so running this twice
-- (e.g. a manual re-run against a database that already has it applied)
-- changes nothing the second time.

-- 1. Schema ----------------------------------------------------------------

ALTER TABLE "AiModel" ADD COLUMN IF NOT EXISTS "priceOffPeakFactor" DECIMAL(4,3);
ALTER TABLE "AiModel" ADD COLUMN IF NOT EXISTS "peakWindowsUtc" JSONB;
ALTER TABLE "AiModel" ADD COLUMN IF NOT EXISTS "offPeakDatesUtc" JSONB;

-- Helper: is `en` (a naive UTC timestamp, same convention as the rest of the
-- app — see src/lib/ai/usage.ts using getUTCHours/getUTCDay) OFF-PEAK given
-- `ventanas` (peak windows) and `feriados` (extra off-peak dates)? Mirrors
-- src/lib/ai/pricing.ts#isOffPeak exactly, so the backfill below and the
-- application code agree on every row.
CREATE OR REPLACE FUNCTION ahorro_tokens_es_fuera_de_pico(
  en TIMESTAMP(3),
  ventanas JSONB,
  feriados JSONB
) RETURNS BOOLEAN AS $$
DECLARE
  fecha TEXT := to_char(en, 'YYYY-MM-DD');
  dia_semana INT := EXTRACT(DOW FROM en)::INT; -- 0 = Sunday .. 6 = Saturday
  hora INT := EXTRACT(HOUR FROM en)::INT;
  ventana JSONB;
BEGIN
  IF feriados IS NOT NULL AND feriados @> to_jsonb(fecha) THEN
    RETURN TRUE;
  END IF;

  IF ventanas IS NOT NULL THEN
    FOR ventana IN SELECT * FROM jsonb_array_elements(ventanas)
    LOOP
      IF (ventana->>'weekday')::INT = dia_semana
         AND hora >= (ventana->>'startHour')::INT
         AND hora < (ventana->>'endHour')::INT THEN
        RETURN FALSE; -- falls inside a peak window
      END IF;
    END LOOP;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Official DeepSeek schedule ---------------------------------------------
-- Identified by the account's baseUrl, not the model name: robust against
-- whatever providerModel/displayName a given deploy used for DeepSeek.
UPDATE "AiModel" m
SET "priceOffPeakFactor" = 0.5,
    "peakWindowsUtc" = '[
      {"weekday":1,"startHour":1,"endHour":4},{"weekday":1,"startHour":6,"endHour":10},
      {"weekday":2,"startHour":1,"endHour":4},{"weekday":2,"startHour":6,"endHour":10},
      {"weekday":3,"startHour":1,"endHour":4},{"weekday":3,"startHour":6,"endHour":10},
      {"weekday":4,"startHour":1,"endHour":4},{"weekday":4,"startHour":6,"endHour":10},
      {"weekday":5,"startHour":1,"endHour":4},{"weekday":5,"startHour":6,"endHour":10}
    ]'::jsonb,
    "offPeakDatesUtc" = '[]'::jsonb
FROM "AiProvider" p
WHERE m."providerId" = p."id"
  AND p."baseUrl" ILIKE '%api.deepseek.com%'
  AND m."priceOffPeakFactor" IS NULL; -- idempotent: already-scheduled rows are left alone

-- 3. Backfill TokenUsage -----------------------------------------------------
-- Guard `t."priceInputSnapshot" = m."priceInputPerMToken"` is the idempotency
-- check: a row already discounted by a previous run of this migration has a
-- snapshot that no longer equals the model's flat price, so it is skipped.
UPDATE "TokenUsage" t
SET "costUsd" = t."costUsd" * m."priceOffPeakFactor",
    "priceInputSnapshot" = t."priceInputSnapshot" * m."priceOffPeakFactor",
    "priceOutputSnapshot" = t."priceOutputSnapshot" * m."priceOffPeakFactor",
    "priceCachedInputSnapshot" = CASE
      WHEN t."priceCachedInputSnapshot" IS NOT NULL THEN t."priceCachedInputSnapshot" * m."priceOffPeakFactor"
      ELSE NULL
    END
FROM "AiModel" m
WHERE t."aiModelId" = m."id"
  AND m."priceOffPeakFactor" IS NOT NULL
  AND t."costUsd" IS NOT NULL
  AND t."priceInputSnapshot" = m."priceInputPerMToken"
  AND ahorro_tokens_es_fuera_de_pico(t."createdAt", m."peakWindowsUtc", m."offPeakDatesUtc");

-- 4. Reconcile the personal-account credit ledger ----------------------------
-- Only personal accounts (organizationId NULL) debit credits (see
-- src/lib/ai/usage.ts#recordUsage). The ledger is append-only: never mutate
-- the original USAGE entry, refund the difference as a new ADJUSTMENT row
-- instead. Guard on the USAGE entry not yet having a matching refund keeps
-- this idempotent.
INSERT INTO "CreditLedgerEntry" (id, "userId", delta, kind, "tokenUsageId", "periodKey", "createdAt")
SELECT
  gen_random_uuid(),
  entry."userId",
  -- entry.delta is negative (a debit); the new, smaller debit is
  -- GREATEST(1, CEIL(newCost / creditUsdValue)) — same rule as
  -- creditsForCost() in src/lib/billing/creditos.ts. The refund is the
  -- (positive) difference between what was charged and what should have
  -- been charged.
  (-entry.delta) - GREATEST(1, CEIL(t."costUsd" / settings."creditUsdValue"))::INT,
  'ADJUSTMENT',
  t."id",
  NULL,
  CURRENT_TIMESTAMP
FROM "TokenUsage" t
JOIN "AiModel" m ON m."id" = t."aiModelId"
JOIN "CreditLedgerEntry" entry ON entry."tokenUsageId" = t."id" AND entry."kind" = 'USAGE'
CROSS JOIN (SELECT "creditUsdValue" FROM "BillingSettings" WHERE id = 1) AS settings
WHERE t."organizationId" IS NULL
  AND m."priceOffPeakFactor" IS NOT NULL
  AND t."costUsd" IS NOT NULL
  -- Only rows this very migration just discounted (same guard as step 3,
  -- now checking the POST-update snapshot: it is already scaled, so compare
  -- against priceInputPerMToken * factor instead of the raw flat price).
  AND t."priceInputSnapshot" = m."priceInputPerMToken" * m."priceOffPeakFactor"
  AND NOT EXISTS (
    SELECT 1 FROM "CreditLedgerEntry" refund
    WHERE refund."tokenUsageId" = t."id" AND refund."kind" = 'ADJUSTMENT'
  )
  AND (-entry.delta) - GREATEST(1, CEIL(t."costUsd" / settings."creditUsdValue"))::INT > 0;
