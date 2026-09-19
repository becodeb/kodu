-- Rollback a mano de 20260924000000_catalogo_de_proveedores. Se corre por
-- fuera de `prisma migrate`:
--   docker exec -i kodu_db_dev psql -U kodu -d koduedu -f - < migration_down.sql
-- y despues:
--   npx prisma migrate resolve --rolled-back 20260924000000_catalogo_de_proveedores
--
-- A DIFERENCIA de los otros migration_down.sql del repo, este va envuelto en
-- BEGIN/COMMIT: tiene una comprobacion que puede ABORTAR, y con el autocommit
-- de psql un aborto a mitad dejaria media reversion puesta.
--
-- PERDIDA ACEPTADA:
--  * El `label` de cada cuenta. `AiModel.provider` vuelve con el `kind` (en
--    minusculas), no con el texto original. Si antes convivian 'GMI' y 'gmi'
--    con el mismo providerModel, el freno de abajo va a abortar: la
--    normalizacion a slug no tiene vuelta exacta. Se arregla renombrando uno
--    de los dos motores a mano y volviendo a correr.
--  * Las cuentas creadas DESPUES de la migracion que no tengan ningun motor
--    colgando: se van con la tabla, y su clave cifrada con ellas.
--  * `AiProvider.enabled`: ver el UPDATE de mas abajo.

BEGIN;

-- EL FRENO. Restaurar @@unique([provider, providerModel]) es IMPOSIBLE si
-- despues de la migracion se cargaron modelos con el mismo providerModel en
-- dos cuentas del mismo kind — que es EXACTAMENTE lo que esta migracion vino a
-- habilitar. Este script ABORTA y no borra nada: cual de los dos motores sobra
-- es una decision de una persona, no de un .sql.
DO $$
DECLARE choques TEXT;
BEGIN
    SELECT string_agg(format('  %s / %s (%s motores)', d.kind, d."providerModel", d.n), E'\n')
      INTO choques
      FROM (
          SELECT p."kind" AS kind, m."providerModel", COUNT(*) AS n
            FROM "AiModel" m
            JOIN "AiProvider" p ON p."id" = m."providerId"
           GROUP BY p."kind", m."providerModel"
          HAVING COUNT(*) > 1
      ) d;

    IF choques IS NOT NULL THEN
        RAISE EXCEPTION E'No se puede revertir: hay motores repetidos que el indice unico viejo no admite.\n%\nBorralos o repuntalos a mano desde /admin/motores y volve a correr este archivo. NO se borro nada.', choques;
    END IF;
END $$;

ALTER TABLE "AiModel"
  ADD COLUMN IF NOT EXISTS "provider" TEXT,
  ADD COLUMN IF NOT EXISTS "baseUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "apiKeyCipher" TEXT,
  ADD COLUMN IF NOT EXISTS "apiKeyHint" TEXT;

-- Cada motor se lleva de vuelta los datos de SU cuenta actual. Un motor
-- repunteado a otra cuenta despues de la migracion vuelve con la clave de esa
-- cuenta, que es su estado correcto de hoy y no una regresion. El AAD nunca
-- cambio, asi que el ciphertext restaurado descifra igual que antes.
UPDATE "AiModel" m
   SET "provider"     = p."kind",
       "baseUrl"      = p."baseUrl",
       "apiKeyCipher" = p."apiKeyCipher",
       "apiKeyHint"   = p."apiKeyHint"
  FROM "AiProvider" p
 WHERE p."id" = m."providerId";

-- El modelo viejo no tiene donde decir "la cuenta esta apagada", asi que la
-- cascada se traduce a apagar esos motores: conservar "no tienen que servir"
-- vale mas, en un rollback, que conservar el enabled propio de cada uno.
DO $$
DECLARE apagados BIGINT;
BEGIN
    UPDATE "AiModel" m SET "enabled" = false
      FROM "AiProvider" p
     WHERE p."id" = m."providerId" AND p."enabled" = false AND m."enabled";
    GET DIAGNOSTICS apagados = ROW_COUNT;
    RAISE NOTICE 'Se apagaron % motores que colgaban de una cuenta apagada (su enabled propio se pierde).', apagados;
END $$;

ALTER TABLE "AiModel" ALTER COLUMN "provider" SET NOT NULL;
ALTER TABLE "AiModel" ALTER COLUMN "baseUrl"  SET NOT NULL;

DROP INDEX IF EXISTS "AiModel_providerId_providerModel_key";
CREATE UNIQUE INDEX IF NOT EXISTS "AiModel_provider_providerModel_key"
    ON "AiModel"("provider", "providerModel");

ALTER TABLE "AiModel" DROP CONSTRAINT IF EXISTS "AiModel_providerId_fkey";
ALTER TABLE "AiModel" DROP COLUMN IF EXISTS "providerId";
DROP TABLE IF EXISTS "AiProvider";

COMMIT;
