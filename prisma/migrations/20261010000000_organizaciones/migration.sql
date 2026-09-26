-- POR QUE esta migracion esta escrita a mano y no generada por
-- `prisma migrate dev` (misma razon que todas las anteriores de este repo,
-- ver 20260919000000_catalogo_de_motores, 20260921000000_acceso_y_ajustes,
-- 20260922000000_modo_demo, 20260923000000_atribucion_admin): esta base ya
-- tiene tres indices unicos PARCIALES que Prisma no puede expresar en el
-- schema (`AiModel_un_solo_default`, `AiModel_un_solo_verificador`,
-- `User_un_solo_demo`), y `prisma migrate dev` los dropea al generar un diff
-- que no los reconoce. Se escribe a mano y se marca aplicada con
-- `prisma migrate resolve --applied` en vez de dejar que el CLI la genere o
-- la corra.
--
-- Ademas esta migracion en particular hace un BACKFILL de datos (no solo
-- DDL) que ningun generador automatico sabria escribir: crea la organizacion
-- Reditinere y le asigna todo lo que existe hoy (dominios y usuarios no-demo),
-- ver odd/tasks/organizaciones.md — "Decisiones del dueño: No hay dominios
-- globales".
--
-- El DDL de las tablas/columnas nuevas SI se genero con
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
-- (comando de solo lectura, no toca la base) para calzar exacto con los
-- nombres que Prisma espera de FKs/indices; se lo copio tal cual acá y se le
-- agrega el backfill alrededor.
--
-- Todo en una sola transaccion: o se aplica entero, o nada.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- DDL — tablas, columnas e indices nuevos (generado por prisma migrate diff,
-- ver el comentario de arriba). El DROP TABLE "AuthorizedDomain" va al final,
-- despues del backfill que todavia necesita leerla.
-- ─────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "OrganizationKind" AS ENUM ('CAMPUS', 'NETWORK');

-- CreateEnum
CREATE TYPE "EmailVerificationSource" AS ENUM ('GOOGLE', 'EMAIL', 'NO_PROVIDER');

-- CreateEnum
CREATE TYPE "UsagePurpose" AS ENUM ('GENERATION', 'ADJUSTMENT', 'CHECKLIST', 'CORRECTION', 'VERIFICATION', 'EXTRA_VERSION');

-- AlterTable
ALTER TABLE "TokenUsage" ADD COLUMN     "forNewResource" BOOLEAN,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "purpose" "UsagePurpose";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerificationSource" "EmailVerificationSource",
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "organizationId" TEXT;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "OrganizationKind" NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationDomain" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationAllowedEmail" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "OrganizationAllowedEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationAdmin" (
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "OrganizationAdmin_pkey" PRIMARY KEY ("userId","organizationId")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Organization_parentId_idx" ON "Organization"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationDomain_pattern_key" ON "OrganizationDomain"("pattern");

-- CreateIndex
CREATE INDEX "OrganizationDomain_organizationId_idx" ON "OrganizationDomain"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationAllowedEmail_email_key" ON "OrganizationAllowedEmail"("email");

-- CreateIndex
CREATE INDEX "OrganizationAllowedEmail_organizationId_idx" ON "OrganizationAllowedEmail"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationInvite_tokenHash_key" ON "OrganizationInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "OrganizationInvite_organizationId_idx" ON "OrganizationInvite"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizationAdmin_organizationId_idx" ON "OrganizationAdmin"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "TokenUsage_organizationId_createdAt_idx" ON "TokenUsage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationDomain" ADD CONSTRAINT "OrganizationDomain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationAllowedEmail" ADD CONSTRAINT "OrganizationAllowedEmail_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationAllowedEmail" ADD CONSTRAINT "OrganizationAllowedEmail_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationInvite" ADD CONSTRAINT "OrganizationInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationInvite" ADD CONSTRAINT "OrganizationInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationAdmin" ADD CONSTRAINT "OrganizationAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationAdmin" ADD CONSTRAINT "OrganizationAdmin_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationAdmin" ADD CONSTRAINT "OrganizationAdmin_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- BACKFILL — Reditinere se lleva puesto todo lo que existe hoy (decisión del
-- dueño: "No hay dominios globales. Los dominios pertenecen a una
-- organización. Migración: se crea la organización Reditinere y se le asigna
-- todo lo que existe hoy"). UUID fijo y literal para poder referenciarlo
-- desde `prisma/seed.ts` sin volver a leer esta migración.
-- ─────────────────────────────────────────────────────────────

INSERT INTO "Organization" ("id", "name", "kind", "parentId", "createdAt", "updatedAt", "archivedAt")
VALUES ('7e00bcaa-9eab-4849-852e-8fc2806d1cbb', 'Reditinere', 'CAMPUS', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);

-- Todo dominio autorizado que existía hoy pasa a ser un dominio de
-- Reditinere — se lee ANTES de dropear la tabla vieja, más abajo.
INSERT INTO "OrganizationDomain" ("id", "organizationId", "pattern", "note", "createdAt")
SELECT gen_random_uuid(), '7e00bcaa-9eab-4849-852e-8fc2806d1cbb', "pattern", "note", "createdAt"
FROM "AuthorizedDomain";

-- Todo usuario NO-demo pasa a ser miembro de Reditinere (decisión del dueño:
-- "todos los usuarios no demo" se migran; la demo queda fuera de toda
-- organización a propósito — sigue usando `aiAccessOverride = true`).
UPDATE "User"
SET "organizationId" = '7e00bcaa-9eab-4849-852e-8fc2806d1cbb'
WHERE "isDemo" = false;

-- Backfill de `TokenUsage.organizationId` histórico: la sede del usuario
-- QUE ACABA de quedar seteada arriba. Las filas de la demo (organizationId
-- de su User es NULL) quedan NULL, tal como pide el dueño.
UPDATE "TokenUsage" tu
SET "organizationId" = u."organizationId"
FROM "User" u
WHERE tu."userId" = u.id
  AND u."organizationId" IS NOT NULL;

-- Quien ya entró con Google tiene el email verificado por construcción
-- (google.ts rechaza un perfil sin `email_verified`) — se le pone
-- `emailVerifiedAt` en su `createdAt` (no HOY: cuando de verdad se verificó)
-- y `emailVerificationSource = 'GOOGLE'`. El resto queda NULL/NULL: ni se
-- inventa que un registro con contraseña viejo estaba verificado.
UPDATE "User"
SET "emailVerifiedAt" = "createdAt",
    "emailVerificationSource" = 'GOOGLE'
WHERE "googleId" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- Se dropea AuthorizedDomain recién ahora, después de haber copiado todo su
-- contenido arriba.
-- ─────────────────────────────────────────────────────────────

-- DropTable
DROP TABLE "AuthorizedDomain";

COMMIT;
