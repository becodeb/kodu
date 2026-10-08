-- T1 (motor-claude): additive, nullable/defaulted columns for Anthropic cache-write
-- accounting. No existing column is touched.

ALTER TABLE "AiModel" ADD COLUMN "priceCacheWritePerMToken" DECIMAL(12,6);

ALTER TABLE "TokenUsage" ADD COLUMN "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TokenUsage" ADD COLUMN "priceCacheWriteSnapshot" DECIMAL(12,6);
