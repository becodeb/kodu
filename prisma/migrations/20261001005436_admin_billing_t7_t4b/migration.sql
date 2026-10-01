-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('OPEN', 'CONTACTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RenewalReminderSubject" AS ENUM ('ORG_LICENSE', 'INDIVIDUAL_SUB');

-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'MANUAL';

-- AlterTable
ALTER TABLE "InstitutionLead" ADD COLUMN     "note" TEXT,
ADD COLUMN     "status" "LeadStatus" NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "refundedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BillingAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenewalReminder" (
    "id" TEXT NOT NULL,
    "subject" "RenewalReminderSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "daysBefore" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenewalReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingAuditLog_entityType_entityId_idx" ON "BillingAuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "BillingAuditLog_createdAt_idx" ON "BillingAuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RenewalReminder_subject_subjectId_periodEnd_daysBefore_key" ON "RenewalReminder"("subject", "subjectId", "periodEnd", "daysBefore");
