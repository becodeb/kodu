-- Rollback de 20260928000000_techo_minimax.
--
-- NO lo ejecuta Prisma. Se corre a mano:
--   psql "$DATABASE_URL" -f prisma/migrations/20260928000000_techo_minimax/migration_down.sql
--   npx prisma migrate resolve --rolled-back 20260928000000_techo_minimax

BEGIN;

DO $$
BEGIN
  RAISE NOTICE 'Se pierde el nombre del parametro de razonamiento por motor.';
  RAISE NOTICE 'Los motores que lo tengan configurado van a volver a mandar';
  RAISE NOTICE 'reasoning_effort, que MiniMax rechaza con 400.';
  RAISE NOTICE 'El techo de MiniMax NO vuelve a 65.536: era la causa de que se';
  RAISE NOTICE 'cortaran los recursos. Si lo queres distinto, /admin/motores.';
END $$;

ALTER TABLE "AiModel" DROP COLUMN IF EXISTS "reasoningParam";

COMMIT;
