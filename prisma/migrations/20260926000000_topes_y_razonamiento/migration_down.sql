-- Rollback de 20260926000000_topes_y_razonamiento.
--
-- NO lo ejecuta Prisma. Se corre a mano:
--   psql "$DATABASE_URL" -f prisma/migrations/20260926000000_topes_y_razonamiento/migration_down.sql
--   npx prisma migrate resolve --rolled-back 20260926000000_topes_y_razonamiento

BEGIN;

DO $$
BEGIN
  RAISE NOTICE 'Se pierde el esfuerzo de razonamiento configurado por motor.';
  RAISE NOTICE 'Los topes de DeepSeek NO se restauran a 8192/24000: eran valores';
  RAISE NOTICE 'de respaldo de emergencia y volver a ponerlos corta recursos.';
  RAISE NOTICE 'Si los queres de vuelta, cambialos desde /admin/motores.';
END $$;

ALTER TABLE "AiModel" DROP COLUMN IF EXISTS "reasoningEffort";
ALTER TABLE "AiModel" ALTER COLUMN "maxOutputTokens" SET DEFAULT 65536;

COMMIT;
