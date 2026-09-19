-- POR QUE esta migracion esta escrita a mano y no generada por
-- `prisma migrate dev`:
--
-- 1) `AiModel` necesita "a lo sumo un default" (isDefault = true en una sola
--    fila, o en ninguna). Eso es un INDICE UNICO PARCIAL
--    (`WHERE "isDefault" = true`), y Prisma no tiene forma de declarar un
--    indice parcial en el schema. Si esta migracion se hubiera generado con
--    `prisma migrate dev`, el diff automatico la habria omitido por completo
--    (o peor: la habria dropeado en una corrida futura al no encontrarla en
--    el schema). Por eso se escribe a mano y se marca aplicada con
--    `prisma migrate resolve --applied` en vez de dejar que el CLI la genere.
--
-- 2) El enum `ModelChoice` (ALPHA/DEEPSEEK/MINIMAX) deja de ser la fuente de
--    verdad en tiempo de ejecucion, pero NO se borra: hay consumo historico
--    (`TokenUsage`) y proyectos existentes (`Project`) que lo usan, y esas
--    filas siguen significando exactamente lo que significaban antes. Esta
--    migracion agrega la tabla nueva y las columnas `aiModelId`, backfillea
--    cada fila existente contra la semilla de abajo, y recien despues afloja
--    el NOT NULL de `TokenUsage.provider` (la unica relajacion de constraint
--    que hace: relajar es siempre seguro, nunca se pierde informacion).
--
-- 3) La semilla son CUATRO filas, no tres: MiniMax M2.7 es un eslabon real de
--    la cadena de respaldo de hoy (`provider.ts:120-124`) y si no entra como
--    fila queda fuera de la cadena para siempre. Los valores vienen de los
--    defaults ya escritos en `src/lib/env.ts:48-93`, que es donde vive la
--    configuracion real hoy; un .sql no puede leer el .env. `apiKeyCipher`
--    queda NULL: las claves se cargan por el panel despues del deploy, y
--    hasta entonces la cadena de motores salta los que no tengan clave, igual
--    que hace `provider.ts:126-128` hoy.

-- CreateTable
CREATE TABLE "AiModel" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerModel" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "adminNote" TEXT,
    "baseUrl" TEXT NOT NULL,
    "apiKeyCipher" TEXT,
    "apiKeyHint" TEXT,
    "priceInputPerMToken" DECIMAL(12,6),
    "priceCachedInputPerMToken" DECIMAL(12,6),
    "priceOutputPerMToken" DECIMAL(12,6),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "selectableByTeacher" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "maxOutputTokens" INTEGER NOT NULL DEFAULT 65536,
    "maxInputChars" INTEGER NOT NULL DEFAULT 400000,
    "supportsVision" BOOLEAN NOT NULL DEFAULT false,
    "userTokenLimit" INTEGER NOT NULL DEFAULT 0,
    "fallbackModelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiModel_provider_providerModel_key" ON "AiModel"("provider", "providerModel");

-- CreateIndex
CREATE INDEX "AiModel_enabled_sortOrder_idx" ON "AiModel"("enabled", "sortOrder");

-- CreateIndex
-- El indice que Prisma no puede expresar: como mucho una fila con
-- isDefault = true. Permite CERO (el catalogo puede quedar sin default), lo
-- que fuerza al resolver de la app a tener un plan B — ver catalogo.ts.
CREATE UNIQUE INDEX "AiModel_un_solo_default" ON "AiModel"("isDefault") WHERE "isDefault" = true;

-- AddForeignKey
ALTER TABLE "AiModel" ADD CONSTRAINT "AiModel_fallbackModelId_fkey" FOREIGN KEY ("fallbackModelId") REFERENCES "AiModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: 4 filas fijas, UUIDs literales para que el backfill de abajo (y
-- migration_down.sql) puedan referenciarlas sin depender de gen_random_uuid().
INSERT INTO "AiModel" (
    "id", "provider", "providerModel", "displayName", "description", "adminNote", "baseUrl",
    "priceInputPerMToken", "priceCachedInputPerMToken", "priceOutputPerMToken",
    "enabled", "selectableByTeacher", "isDefault", "sortOrder",
    "maxOutputTokens", "maxInputChars", "supportsVision", "userTokenLimit",
    "fallbackModelId", "updatedAt"
) VALUES
    (
        '10000000-0000-0000-0000-000000000001', 'gmi', 'MiniMaxAI/MiniMax-M3', 'MiniMax M3',
        'Contexto largo, entiende las imágenes que subas y trabaja sobre tu código.',
        'Motor de trabajo principal, gratuito via GMI Cloud.', 'https://api.gmi-serving.com',
        NULL, NULL, NULL,
        true, true, true, 0,
        65536, 400000, true, 0,
        '10000000-0000-0000-0000-000000000002', CURRENT_TIMESTAMP
    ),
    (
        '10000000-0000-0000-0000-000000000002', 'gmi', 'MiniMaxAI/MiniMax-M2.7', 'MiniMax M2.7',
        NULL,
        'Respaldo automático de MiniMax M3, mismo proveedor. No se ofrece en el selector.',
        'https://api.gmi-serving.com',
        NULL, NULL, NULL,
        true, false, false, 1,
        65536, 400000, true, 0,
        '10000000-0000-0000-0000-000000000003', CURRENT_TIMESTAMP
    ),
    (
        '10000000-0000-0000-0000-000000000003', 'deepseek', 'deepseek-v4-flash', 'DeepSeek',
        NULL,
        'Único motor pago; entra sólo como último respaldo cuando MiniMax agota sus reintentos.',
        'https://api.deepseek.com',
        NULL, NULL, NULL,
        true, false, false, 2,
        8192, 24000, false, 300000,
        NULL, CURRENT_TIMESTAMP
    ),
    (
        '10000000-0000-0000-0000-000000000004', 'openrouter', 'stealth/ox-alpha', 'Alpha',
        NULL,
        'Fuera de servicio desde 2026-08-27 (dejó de ser gratuito). Se conserva por el histórico.',
        'https://openrouter.ai/api',
        NULL, NULL, NULL,
        false, false, false, 3,
        65536, 400000, true, 0,
        NULL, CURRENT_TIMESTAMP
    );

-- AlterTable: FK nuevas en Project y TokenUsage
ALTER TABLE "Project" ADD COLUMN "aiModelId" TEXT;
ALTER TABLE "Project" ADD CONSTRAINT "Project_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "AiModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TokenUsage" ADD COLUMN "aiModelId" TEXT;
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "AiModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: cada fila historica apunta a la fila nueva que dice lo mismo que
-- ya decia. Ningun consumo ni proyecto pierde su significado.
UPDATE "Project" SET "aiModelId" = '10000000-0000-0000-0000-000000000001' WHERE "selectedModel" = 'MINIMAX';
UPDATE "Project" SET "aiModelId" = '10000000-0000-0000-0000-000000000003' WHERE "selectedModel" = 'DEEPSEEK';
UPDATE "Project" SET "aiModelId" = '10000000-0000-0000-0000-000000000004' WHERE "selectedModel" = 'ALPHA';

-- PRIMERA PASADA, la precisa. `TokenUsage.model` guarda el identificador exacto
-- del modelo que respondio ese turno, que es mas especifico que el enum: el enum
-- solo dice "MINIMAX", pero la cadena de respaldo (provider.ts:120-124) sirve
-- turnos con MiniMax M2.7 cuando M3 falla, y esos turnos se graban igual como
-- provider='MINIMAX'. Mapear solo por enum se los atribuiria a M3 y arruinaria
-- justo la atribucion por modelo que el panel viene a mostrar. Cuando el nombre
-- crudo coincide con un motor del catalogo, esa es la respuesta correcta.
UPDATE "TokenUsage" t
   SET "aiModelId" = m."id"
  FROM "AiModel" m
 WHERE m."providerModel" = t."model"
   AND t."aiModelId" IS NULL;

-- SEGUNDA PASADA, la de red. Lo que no matcheo por nombre exacto (un modelo que
-- ya no esta en el catalogo, o un identificador viejo que cambio de nombre) cae
-- al motor que representa su enum. Es una aproximacion, pero conserva el dato:
-- mejor atribuido al proveedor correcto que huerfano.
UPDATE "TokenUsage" SET "aiModelId" = '10000000-0000-0000-0000-000000000001' WHERE "provider" = 'MINIMAX' AND "aiModelId" IS NULL;
UPDATE "TokenUsage" SET "aiModelId" = '10000000-0000-0000-0000-000000000003' WHERE "provider" = 'DEEPSEEK' AND "aiModelId" IS NULL;
UPDATE "TokenUsage" SET "aiModelId" = '10000000-0000-0000-0000-000000000004' WHERE "provider" = 'ALPHA' AND "aiModelId" IS NULL;

-- La unica relajacion de constraint de esta migracion: las filas nuevas ya no
-- escriben en `provider` (queda como dato historico, ver schema.prisma), asi
-- que la columna tiene que admitir NULL.
ALTER TABLE "TokenUsage" ALTER COLUMN "provider" DROP NOT NULL;
