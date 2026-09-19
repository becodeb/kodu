-- Rollback manual de 20260922000000_modo_demo. Se corre a mano
-- (docker exec ... psql -f -), nunca automatico — mismo patron que
-- 20260919000000 y 20260920000000.
--
-- Perdida aceptada: si la cuenta de demo llego a existir, esta baja no la
-- borra (podria tener recursos reales que un docente decidio conservar tras
-- desactivar la demo); el operador la borra a mano si corresponde. Los
-- recursos con "createdByDemo" = true dejan de estar marcados, pero no se
-- borran.

DROP INDEX IF EXISTS "User_un_solo_demo";
ALTER TABLE "User" DROP COLUMN IF EXISTS "isDemo";
ALTER TABLE "Project" DROP COLUMN IF EXISTS "createdByDemo";
