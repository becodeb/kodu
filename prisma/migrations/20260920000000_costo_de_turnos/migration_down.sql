-- Rollback a mano de 20260920000000_costo_de_turnos. Se corre por fuera de
-- `prisma migrate` (`docker exec -i kodu_db_dev psql -U kodu -d koduedu -f -`
-- con este archivo), y despues:
--   npx prisma migrate resolve --rolled-back 20260920000000_costo_de_turnos
--
-- Perdida aceptada: el registro de costo de los turnos escritos entre este
-- deploy y el rollback se pierde con las columnas. Los tokens en si NO se
-- pierden: `promptTokens`/`completionTokens` son de la migracion anterior
-- (M2) y no los toca esta.

ALTER TABLE "TokenUsage" DROP CONSTRAINT IF EXISTS "TokenUsage_projectId_fkey";
DROP INDEX IF EXISTS "TokenUsage_projectId_idx";
DROP INDEX IF EXISTS "TokenUsage_userId_createdAt_idx";

ALTER TABLE "TokenUsage"
  DROP COLUMN IF EXISTS "cachedInputTokens",
  DROP COLUMN IF EXISTS "projectId",
  DROP COLUMN IF EXISTS "costUsd",
  DROP COLUMN IF EXISTS "priceInputSnapshot",
  DROP COLUMN IF EXISTS "priceOutputSnapshot",
  DROP COLUMN IF EXISTS "priceCachedInputSnapshot";
