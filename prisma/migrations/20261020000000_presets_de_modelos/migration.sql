-- odd/tasks/ahorro-tokens.md (T7): model presets defined in code
-- (src/lib/ai/presets.ts).
--
-- This migration:
--   1. Adds AiModel.presetKey (nullable TEXT — a key into the `PRESETS`
--      record in code, never a DB-validated foreign key).
--   2. Links existing rows to their matching preset, identified the same
--      way T1 (20261016000000_time_of_day_pricing) identified DeepSeek:
--      by the owning AiProvider's baseUrl, plus providerModel.
--   3. Re-runs T1's holiday backfill for DeepSeek TokenUsage rows: T1 shipped
--      with an EMPTY offPeakDatesUtc (no holiday calendar was available at
--      the time — see its "Notes for the owner"), so any call that landed on
--      a 2026 Chinese holiday DURING what would otherwise be a peak window
--      was still billed (and recorded) at the full peak price. Those rows,
--      and only those, are recomputed here to the off-peak price, with the
--      same credit-ledger refund approach T1 used.
--
-- Idempotent: every UPDATE below is guarded so re-running this file changes
-- nothing the second time.

-- 1. Schema ----------------------------------------------------------------

ALTER TABLE "AiModel" ADD COLUMN IF NOT EXISTS "presetKey" TEXT;

-- 2. Link existing rows to a preset ------------------------------------------
--
-- `deepseek-v4-flash` is the LEGACY providerModel name (see the `.env`
-- default `AI_DEEPSEEK_MODEL="deepseek-v4-flash"` and T7's own task text) —
-- any row still using it maps to the same `deepseek-flash` preset as the
-- current name.
UPDATE "AiModel" m
SET "presetKey" = 'deepseek-flash'
FROM "AiProvider" p
WHERE m."providerId" = p."id"
  AND p."baseUrl" ILIKE '%api.deepseek.com%'
  AND m."providerModel" IN ('deepseek-flash', 'deepseek-v4-flash')
  AND m."presetKey" IS NULL;

UPDATE "AiModel" m
SET "presetKey" = 'deepseek-v4-pro'
FROM "AiProvider" p
WHERE m."providerId" = p."id"
  AND p."baseUrl" ILIKE '%api.deepseek.com%'
  AND m."providerModel" = 'deepseek-v4-pro'
  AND m."presetKey" IS NULL;

-- In production the luna model has priceInputPerMToken/etc loaded as 0 (no
-- real price was ever entered) — linking it here makes its recorded cost
-- real for the first time. Intended (T7 task text: "that is intended").
UPDATE "AiModel" m
SET "presetKey" = 'openai-gpt-6-luna'
FROM "AiProvider" p
WHERE m."providerId" = p."id"
  AND p."baseUrl" ILIKE '%api.openai.com%'
  AND m."providerModel" = 'gpt-6-luna'
  AND m."presetKey" IS NULL;

-- 3. Re-run T1's holiday backfill, now WITH a holiday calendar ---------------
--
-- Reuses `ahorro_tokens_es_fuera_de_pico` (created by T1,
-- 20261016000000_time_of_day_pricing) with the official DeepSeek peak
-- windows and the 2026 Chinese public holiday list from
-- src/lib/ai/presets.ts (FERIADOS_DEEPSEEK_2026) passed as literals — NOT
-- read from AiModel.offPeakDatesUtc, because a preset-linked model's
-- schedule now lives in code, not in that column (see the AiModel.presetKey
-- comment in schema.prisma).
--
-- Guard `t."priceInputSnapshot" = m."priceInputPerMToken"`: a row T1 already
-- discounted (weekend, or a date that WAS already in offPeakDatesUtc) has a
-- snapshot that no longer equals the flat price, so it is correctly skipped
-- here — this only catches rows T1 left at full price because, at the time,
-- it didn't know about the holiday.
UPDATE "TokenUsage" t
SET "costUsd" = t."costUsd" * 0.5,
    "priceInputSnapshot" = t."priceInputSnapshot" * 0.5,
    "priceOutputSnapshot" = t."priceOutputSnapshot" * 0.5,
    "priceCachedInputSnapshot" = CASE
      WHEN t."priceCachedInputSnapshot" IS NOT NULL THEN t."priceCachedInputSnapshot" * 0.5
      ELSE NULL
    END
FROM "AiModel" m
WHERE t."aiModelId" = m."id"
  AND m."presetKey" IN ('deepseek-flash', 'deepseek-v4-pro')
  AND t."costUsd" IS NOT NULL
  AND t."priceInputSnapshot" = m."priceInputPerMToken"
  AND ahorro_tokens_es_fuera_de_pico(
    t."createdAt",
    '[
      {"weekday":1,"startHour":1,"endHour":4},{"weekday":1,"startHour":6,"endHour":10},
      {"weekday":2,"startHour":1,"endHour":4},{"weekday":2,"startHour":6,"endHour":10},
      {"weekday":3,"startHour":1,"endHour":4},{"weekday":3,"startHour":6,"endHour":10},
      {"weekday":4,"startHour":1,"endHour":4},{"weekday":4,"startHour":6,"endHour":10},
      {"weekday":5,"startHour":1,"endHour":4},{"weekday":5,"startHour":6,"endHour":10}
    ]'::jsonb,
    '[
      "2026-01-01","2026-01-02","2026-01-03",
      "2026-02-15","2026-02-16","2026-02-17","2026-02-18","2026-02-19","2026-02-20","2026-02-21","2026-02-22","2026-02-23",
      "2026-04-04","2026-04-05","2026-04-06",
      "2026-05-01","2026-05-02","2026-05-03","2026-05-04","2026-05-05",
      "2026-06-19","2026-06-20","2026-06-21",
      "2026-09-25","2026-09-26","2026-09-27",
      "2026-10-01","2026-10-02","2026-10-03","2026-10-04","2026-10-05","2026-10-06","2026-10-07"
    ]'::jsonb
  );

-- 4. Reconcile the personal-account credit ledger for those same rows -------
-- Same approach as T1 step 4: append a refund ADJUSTMENT, never mutate the
-- original USAGE row.
INSERT INTO "CreditLedgerEntry" (id, "userId", delta, kind, "tokenUsageId", "periodKey", "createdAt")
SELECT
  gen_random_uuid(),
  entry."userId",
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
  AND m."presetKey" IN ('deepseek-flash', 'deepseek-v4-pro')
  AND t."costUsd" IS NOT NULL
  -- Post-update snapshot is already halved — same "already discounted by
  -- THIS pass" guard as T1 step 4.
  AND t."priceInputSnapshot" = m."priceInputPerMToken" * 0.5
  AND NOT EXISTS (
    SELECT 1 FROM "CreditLedgerEntry" refund
    WHERE refund."tokenUsageId" = t."id" AND refund."kind" = 'ADJUSTMENT'
  )
  AND (-entry.delta) - GREATEST(1, CEIL(t."costUsd" / settings."creditUsdValue"))::INT > 0;
