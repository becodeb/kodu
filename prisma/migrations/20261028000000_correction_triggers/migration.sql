-- T4 (round 1, motor-claude): additive, nullable column. No existing column
-- is touched.

ALTER TABLE "AiTrace" ADD COLUMN "correctionTriggers" TEXT;
