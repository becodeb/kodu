-- odd/tasks/planes-y-cobros.md (T1): planes, precios y cobros.
--
-- Escrita a mano, mismo criterio que las migraciones anteriores del repo
-- (ver 20261010000000_organizaciones): esta migracion agrega un BACKFILL de
-- datos (licencia MANUAL para cada organizacion de tope existente, y
-- OrganizationDomain.status = VERIFIED para todo lo que ya existia) que
-- ningun generador automatico sabria escribir, mas dos CHECK constraints que
-- `schema.prisma` no puede expresar (mismo patron que el CHECK de
-- `AppSettings.id = 1`, agregado a mano fuera del schema):
--   - BillingSettings: CHECK (id = 1) — singleton, igual que AppSettings.
--   - Payment: CHECK de "exactamente un dueno" — o una organizacion, o un
--     usuario, nunca los dos ni ninguno.
--
-- El DDL de tablas/columnas/indices SI se genero con
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
-- (comando de solo lectura) para calzar exacto con los nombres que Prisma
-- espera de FKs/indices; se copia tal cual y se le agregan los CHECK y el
-- backfill alrededor.
--
-- Todo en una sola transaccion: o se aplica entero, o nada.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- DDL — enums, tablas, columnas e indices nuevos (generado por
-- prisma migrate diff, ver el comentario de arriba).
-- ─────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "DomainVerificationStatus" AS ENUM ('VERIFIED', 'PENDING');

-- CreateEnum
CREATE TYPE "BandKey" AS ENUM ('PEQUENA', 'MEDIANA', 'GRANDE');

-- CreateEnum
CREATE TYPE "IndividualPlanKey" AS ENUM ('FREE', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'READ_ONLY', 'CANCELED', 'MANUAL');

-- CreateEnum
CREATE TYPE "OrgBillingInterval" AS ENUM ('MONTHLY', 'CYCLE');

-- CreateEnum
CREATE TYPE "LicenseCreatedVia" AS ENUM ('SELF_SERVE', 'MANUAL');

-- CreateEnum
CREATE TYPE "IndividualSubStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'READ_ONLY', 'CANCELED');

-- CreateEnum
CREATE TYPE "IndividualInterval" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('SIMULADO', 'MERCADOPAGO');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'ISSUED', 'FAILED');

-- CreateEnum
CREATE TYPE "CreditKind" AS ENUM ('WELCOME', 'MONTHLY_GRANT', 'PLAN_GRANT', 'USAGE', 'ADJUSTMENT', 'EXPIRY');

-- AlterTable — el dominio del creador de una org existente ya "verifico su
-- mail" mucho antes de que esta columna existiera: no fue un alta propia sin
-- revisar, lo cargo el superadmin a mano. DEFAULT 'PENDING' rige sólo para
-- las filas nuevas que se inserten después de esta migración (T5).
ALTER TABLE "OrganizationDomain" ADD COLUMN     "status" "DomainVerificationStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "InstitutionalBand" (
    "id" TEXT NOT NULL,
    "key" "BandKey" NOT NULL,
    "name" TEXT NOT NULL,
    "minStudents" INTEGER NOT NULL,
    "maxStudents" INTEGER,
    "monthlyPriceArs" DECIMAL(12,2) NOT NULL,
    "cyclePriceArs" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstitutionalBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndividualPlan" (
    "id" TEXT NOT NULL,
    "key" "IndividualPlanKey" NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyPriceArs" DECIMAL(12,2) NOT NULL,
    "annualPriceArs" DECIMAL(12,2),
    "monthlyCredits" INTEGER NOT NULL,
    "welcomeCredits" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndividualPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable — singleton, mismo patron que "AppSettings": el CHECK que
-- impide una segunda fila va despues del backfill, junto a los demas CHECK
-- de esta migracion.
CREATE TABLE "BillingSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "creditUsdValue" DECIMAL(12,6) NOT NULL,
    "trialDays" INTEGER NOT NULL,
    "graceDays" INTEGER NOT NULL,
    "monotributoAnnualCapArs" DECIMAL(14,2),
    "hablemosThresholdStudents" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationLicense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'TRIAL',
    "interval" "OrgBillingInterval" NOT NULL DEFAULT 'MONTHLY',
    "declaredStudents" INTEGER NOT NULL,
    "bandKey" "BandKey",
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "legalName" TEXT,
    "cuit" TEXT,
    "externalSubscriptionId" TEXT,
    "externalCustomerId" TEXT,
    "createdVia" "LicenseCreatedVia" NOT NULL DEFAULT 'SELF_SERVE',
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndividualSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "IndividualSubStatus" NOT NULL DEFAULT 'ACTIVE',
    "interval" "IndividualInterval" NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "externalSubscriptionId" TEXT,
    "externalCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndividualSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "organizationLicenseId" TEXT,
    "userId" TEXT,
    "individualSubscriptionId" TEXT,
    "amountArs" DECIMAL(12,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "PaymentProvider" NOT NULL,
    "providerPaymentId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "rawStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'C',
    "pointOfSale" INTEGER NOT NULL,
    "number" INTEGER,
    "cae" TEXT,
    "caeDueDate" TIMESTAMP(3),
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "recipientDocType" TEXT NOT NULL,
    "recipientDocNumber" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "kind" "CreditKind" NOT NULL,
    "tokenUsageId" TEXT,
    "periodKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstitutionalBand_key_key" ON "InstitutionalBand"("key");

-- CreateIndex
CREATE UNIQUE INDEX "IndividualPlan_key_key" ON "IndividualPlan"("key");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationLicense_organizationId_key" ON "OrganizationLicense"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "IndividualSubscription_userId_key" ON "IndividualSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE INDEX "Payment_providerPaymentId_idx" ON "Payment"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_paymentId_key" ON "Invoice"("paymentId");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_userId_createdAt_idx" ON "CreditLedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedgerEntry_userId_kind_periodKey_key" ON "CreditLedgerEntry"("userId", "kind", "periodKey");

-- AddForeignKey
ALTER TABLE "OrganizationLicense" ADD CONSTRAINT "OrganizationLicense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndividualSubscription" ADD CONSTRAINT "IndividualSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationLicenseId_fkey" FOREIGN KEY ("organizationLicenseId") REFERENCES "OrganizationLicense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_individualSubscriptionId_fkey" FOREIGN KEY ("individualSubscriptionId") REFERENCES "IndividualSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_tokenUsageId_fkey" FOREIGN KEY ("tokenUsageId") REFERENCES "TokenUsage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- CHECK constraints que Prisma no puede expresar en schema.prisma (mismo
-- criterio que "CHECK (id = 1)" de AppSettings, agregado a mano fuera del
-- schema desde esa migracion).
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "BillingSettings" ADD CONSTRAINT "BillingSettings_singleton" CHECK ("id" = 1);

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_un_solo_dueno" CHECK (
    (("organizationId" IS NOT NULL)::int + ("userId" IS NOT NULL)::int) = 1
);

-- ─────────────────────────────────────────────────────────────
-- Backfill.
-- ─────────────────────────────────────────────────────────────

-- Todo lo que ya existia (dominios cargados por el superadmin, nunca por un
-- alta propia sin revisar) queda VERIFIED.
UPDATE "OrganizationDomain" SET "status" = 'VERIFIED';

-- Fila unica de configuracion de cobro, con los valores del documento de la
-- feature (odd/tasks/planes-y-cobros.md: 1 credito = USD 0,0025; 30 dias de
-- prueba; 7 dias de gracia; umbral "Hablemos" en 1.500 alumnos). El tope del
-- monotributo queda NULL: no hay un numero todavia, lo carga el dueno desde
-- el superadmin (T7).
INSERT INTO "BillingSettings" ("id", "creditUsdValue", "trialDays", "graceDays", "monotributoAnnualCapArs", "hablemosThresholdStudents", "updatedAt")
VALUES (1, 0.0025, 30, 7, NULL, 1500, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Cada organizacion de TOPE (parentId IS NULL: un colegio standalone o una
-- red) que ya existia recibe una licencia MANUAL activa (decision del dueno:
-- "organizaciones existentes quedan como licencia MANUAL activa: nada
-- cambia"). Una sede de una red (parentId NOT NULL) NO recibe licencia
-- propia: usa la de su red (ver el comentario de OrganizationLicense en
-- schema.prisma). declaredStudents se deja en 0 -- es un dato que no existia
-- antes de esta migracion y nadie lo inventa; el superadmin lo carga desde
-- la cola de revision (T7) el dia que haga falta, sin que licenseAllowsAi
-- dependa de el para MANUAL.
INSERT INTO "OrganizationLicense" ("id", "organizationId", "status", "interval", "declaredStudents", "createdVia", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'MANUAL', 'MONTHLY', 0, 'MANUAL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization"
WHERE "parentId" IS NULL;

COMMIT;
