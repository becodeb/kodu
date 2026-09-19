-- POR QUE esta migracion esta escrita a mano (igual que 20260919000000):
--
-- 1) `AiModel` conserva el indice unico PARCIAL `AiModel_un_solo_default`
--    (WHERE "isDefault" = true), que Prisma no sabe expresar. Si esta
--    migracion la generara `prisma migrate dev`, el diff lo dropearia por no
--    encontrarlo en el schema. Se escribe a mano y se marca aplicada con
--    `prisma migrate resolve --applied`.
--
-- 2) El backfill tiene que ser SQL PURO. El deploy es un webhook de Coolify:
--    `docker/prod-entrypoint.sh` corre `npx prisma migrate deploy` y arranca el
--    server. La imagen de runtime no puede correr un script TypeScript
--    (`Dockerfile:51` = `npm ci --omit=dev`, sin tsx; `Dockerfile:53-56` no
--    copia `scripts/`). Nadie va a entrar a mano a terminar esto.
--
-- 3) NO SE DESCIFRA NI SE VUELVE A CIFRAR NADA. El AAD del cifrado es el `id`
--    de la fila duena de la clave. Cada `AiProvider` se queda con el `id` de
--    la fila `AiModel` de la que hereda la clave, asi que el ciphertext sigue
--    autenticando tal cual. Esta migracion no toca una sola primitiva de
--    cripto: mueve bytes y conserva el id.

CREATE TABLE IF NOT EXISTS "AiProvider" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyCipher" TEXT,
    "apiKeyHint" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProvider_pkey" PRIMARY KEY ("id")
);

-- Nullable por ahora: el backfill la llena antes de que se le exija NOT NULL.
ALTER TABLE "AiModel" ADD COLUMN IF NOT EXISTS "providerId" TEXT;

-- EL REPARTO. Una sola pasada sobre (provider, baseUrl).
WITH grupos AS (
    SELECT
        "provider",
        "baseUrl",
        COUNT(*)  FILTER (WHERE "apiKeyCipher" IS NOT NULL) AS cifradas,
        MIN("id") FILTER (WHERE "apiKeyCipher" IS NOT NULL) AS ancla_con_clave,
        MIN("id") FILTER (WHERE "apiKeyCipher" IS NULL)     AS ancla_sin_clave
      FROM "AiModel"
     GROUP BY "provider", "baseUrl"
)
UPDATE "AiModel" m
   SET "providerId" = CASE
       -- 2+ claves distintas en el grupo: NO se fusiona. Cada fila con clave
       -- se queda con su propio id y con su propia clave. GCM usa un nonce
       -- aleatorio, asi que comparar ciphertexts NO puede distinguir "la misma
       -- clave dos veces" de "dos claves distintas": fusionar seria perder una
       -- clave en silencio, y el modelo perdedor terminaria autenticando
       -- contra una cuenta que no es la suya.
       WHEN g.cifradas >= 2 AND m."apiKeyCipher" IS NOT NULL THEN m."id"
       -- Las filas SIN clave de un grupo partido no se cuelgan de ninguna de
       -- las cuentas partidas: elegir una al azar les REGALARIA una clave que
       -- nunca tuvieron (y le mandaria trafico y factura a esa cuenta). Van a
       -- una cuenta propia, sin clave, que es exactamente lo que eran.
       WHEN g.cifradas >= 2                                  THEN g.ancla_sin_clave
       -- 1 clave: esa fila es el ancla y el grupo entero se cuelga de ella.
       -- 0 claves: no hay clave que atar, el AAD es irrelevante, y se usa la
       -- fila de menor id del grupo como ancla. Es un id que ya existe, que ya
       -- es unico, y que es deterministico entre corridas.
       ELSE COALESCE(g.ancla_con_clave, g.ancla_sin_clave)
   END
  FROM grupos g
 WHERE g."provider" = m."provider"
   AND g."baseUrl"  = m."baseUrl"
   AND m."providerId" IS NULL;

-- Una fila de AiProvider por cada id que quedo elegido como ancla. El id, el
-- cipher y la pista se copian TAL CUAL: eso es lo que mantiene valido el AAD.
INSERT INTO "AiProvider" ("id", "kind", "label", "baseUrl", "apiKeyCipher", "apiKeyHint", "enabled", "createdAt", "updatedAt")
SELECT
    a."id",
    a.kind,
    -- Etiqueta inicial: el texto que el admin ya tipeo. Si una sola cuenta
    -- salio de ese kind, va tal cual. Si salieron varias, se numeran y se les
    -- cuelga la pista de la clave: dos cuentas partidas del MISMO proveedor
    -- pueden tener la misma pista (la misma clave tipeada dos veces da la
    -- misma pista), por eso el numero de cuenta es el que garantiza que se
    -- distingan y la pista es solo ayuda.
    CASE WHEN a.hermanas = 1 THEN a."provider"
         ELSE a."provider" || ' · cuenta ' || a.orden
              || COALESCE(' (••••' || a."apiKeyHint" || ')', ' (sin clave)')
    END,
    a."baseUrl",
    a."apiKeyCipher",
    a."apiKeyHint",
    true,
    a."createdAt",
    CURRENT_TIMESTAMP
FROM (
    SELECT m."id", m."provider", m."baseUrl", m."apiKeyCipher", m."apiKeyHint", m."createdAt",
           lower(btrim(m."provider")) AS kind,
           COUNT(*)     OVER (PARTITION BY lower(btrim(m."provider"))) AS hermanas,
           ROW_NUMBER() OVER (PARTITION BY lower(btrim(m."provider"))
                              ORDER BY m."baseUrl", m."id")            AS orden
      FROM "AiModel" m
     WHERE EXISTS (SELECT 1 FROM "AiModel" h WHERE h."providerId" = m."id")
) a
ON CONFLICT ("id") DO NOTHING;

-- Nadie puede quedar sin cuenta. Si el CASE dejo algo en NULL, el deploy tiene
-- que gritar ACA, con un numero, y no tres statements mas abajo con un error
-- de constraint que no explica nada.
DO $$
DECLARE huerfanos BIGINT;
BEGIN
    SELECT COUNT(*) INTO huerfanos FROM "AiModel" WHERE "providerId" IS NULL;
    IF huerfanos > 0 THEN
        RAISE EXCEPTION 'Quedaron % motores sin cuenta de proveedor: el reparto no cubrio todos los grupos.', huerfanos;
    END IF;
END $$;

ALTER TABLE "AiModel" ALTER COLUMN "providerId" SET NOT NULL;

-- Postgres no admite ADD CONSTRAINT IF NOT EXISTS: se guarda a mano.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiModel_providerId_fkey') THEN
        ALTER TABLE "AiModel"
          ADD CONSTRAINT "AiModel_providerId_fkey"
          FOREIGN KEY ("providerId") REFERENCES "AiProvider"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- EL CAMBIO QUE ES LA FUNCION: la identidad de un motor pasa a ser unica POR
-- CUENTA, no por etiqueta de proveedor. Es lo que habilita el mismo modelo
-- cargado dos veces, una por cuenta.
DROP INDEX IF EXISTS "AiModel_provider_providerModel_key";
CREATE UNIQUE INDEX IF NOT EXISTS "AiModel_providerId_providerModel_key"
    ON "AiModel"("providerId", "providerModel");

-- NO SE TOCAN: `AiModel_un_solo_default` (el parcial que Prisma no expresa) ni
-- `AiModel_enabled_sortOrder_idx`. Ninguno depende de las columnas que se van.

-- Recien ahora se van las cuatro columnas. De aca en adelante el archivo ya no
-- se puede replayear: ver el design.md §2.4 de este cambio.
ALTER TABLE "AiModel"
  DROP COLUMN IF EXISTS "provider",
  DROP COLUMN IF EXISTS "baseUrl",
  DROP COLUMN IF EXISTS "apiKeyCipher",
  DROP COLUMN IF EXISTS "apiKeyHint";
