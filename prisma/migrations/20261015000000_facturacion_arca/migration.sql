-- CreateEnum
CREATE TYPE "OrgIvaCondition" AS ENUM ('RESPONSABLE_INSCRIPTO', 'EXENTO', 'MONOTRIBUTO', 'CONSUMIDOR_FINAL');

-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'ISSUING';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "condicionIvaReceptorId" INTEGER,
ADD COLUMN     "emailedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrganizationLicense" ADD COLUMN     "ivaCondition" "OrgIvaCondition";
