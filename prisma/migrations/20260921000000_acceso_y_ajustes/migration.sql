-- POR QUE esta migracion esta escrita a mano y no generada por
-- `prisma migrate dev` (misma razon que 20260919000000_catalogo_de_motores):
--
-- 1) `AppSettings` necesita "una sola fila, siempre" — eso es un
--    CHECK (id = 1), y Prisma no tiene forma de declarar un CHECK constraint
--    en el schema. Si esta migracion se hubiera generado con
--    `prisma migrate dev`, el diff automatico la habria omitido, y encima
--    `prisma migrate dev` DROPEA los indices unicos parciales que
--    20260919000000 ya agrego a mano (`AiModel_un_solo_default`) porque no
--    los reconoce como parte del schema declarado. Por eso esta tambien se
--    escribe a mano y se marca aplicada con `prisma migrate resolve
--    --applied` en vez de dejar que el CLI la genere o la corra.
--
-- 2) `User.deepseekEnabled` se RENOMBRA a `aiAccessOverride`, no se agrega
--    una columna nueva y se borra la vieja. Design.md #10 es explicito:
--    grep confirma que `deepseekEnabled` no lo lee nadie (el catalogo de
--    motores de M2 la dejo inerte desde 20260826000000_deepseek_por_docente),
--    asi que la columna esta vacante para una pregunta nueva. Pero sus
--    valores `true` contestaban una pregunta DISTINTA ("¿puede este docente
--    usar DeepSeek?"), no "¿tiene este docente un permiso individual de IA?".
--    Reinterpretar un `true` viejo como un permiso nuevo otorgaria acceso sin
--    que ningun admin lo haya decidido — por eso el UPDATE de abajo limpia
--    TODA la columna a NULL despues del rename, sin excepcion.
--
-- 3) Los dominios autorizados salen de `ALLOWED_EMAIL_DOMAINS` (env var) y
--    pasan a vivir en `AuthorizedDomain`, una tabla de filas: el env var solo
--    sirve como semilla inicial (`prisma/seed.ts`, porque un .sql no puede
--    leer el .env), nunca mas como fuente de verdad en tiempo de ejecucion.

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "demoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "demoTokenLimit" INTEGER NOT NULL DEFAULT 200000,
    "demoCycleStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AppSettings_singleton" CHECK ("id" = 1)
);

-- Semilla: la fila unica que va a existir siempre. Sin esto, la primera
-- lectura de `leerAppSettings()` en produccion encontraria la tabla vacia.
INSERT INTO "AppSettings" ("id", "demoEnabled", "demoTokenLimit", "demoCycleStartedAt", "updatedAt")
VALUES (1, false, 200000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- CreateTable
CREATE TABLE "AuthorizedDomain" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthorizedDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthorizedDomain_pattern_key" ON "AuthorizedDomain"("pattern");

-- RenameColumn + relajar constraints: el permiso individual reemplaza al
-- toggle de DeepSeek muerto, con tres estados en vez de dos (ver el punto 2
-- de arriba).
ALTER TABLE "User" RENAME COLUMN "deepseekEnabled" TO "aiAccessOverride";
ALTER TABLE "User" ALTER COLUMN "aiAccessOverride" DROP NOT NULL,
                   ALTER COLUMN "aiAccessOverride" DROP DEFAULT;

-- Trampa a propósito evitada: NO reinterpretar los `true` existentes como
-- grants. Ver el punto 2 de arriba.
UPDATE "User" SET "aiAccessOverride" = NULL;
