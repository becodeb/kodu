-- Rollback de 20260927000000_tope_por_ventana.
--
-- NO lo ejecuta Prisma. Se corre a mano:
--   psql "$DATABASE_URL" -f prisma/migrations/20260927000000_tope_por_ventana/migration_down.sql
--   npx prisma migrate resolve --rolled-back 20260927000000_tope_por_ventana

BEGIN;

DO $$
BEGIN
  RAISE NOTICE 'Se pierde la ventana configurada por motor: todos los topes';
  RAISE NOTICE 'vuelven a ser acumulados de por vida.';
  RAISE NOTICE 'El tope de DeepSeek NO vuelve a 300.000: ese numero quedo corto';
  RAISE NOTICE 'y sin ventana dejaria a un docente sin el motor para siempre.';
  RAISE NOTICE 'Si lo queres distinto, cambialo desde /admin/motores.';
END $$;

ALTER TABLE "AiModel" DROP COLUMN IF EXISTS "userTokenWindowHours";

COMMIT;
