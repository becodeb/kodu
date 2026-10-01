-- AlterTable
ALTER TABLE "OrganizationLicense" ADD COLUMN     "externalPlanId" TEXT;

-- AlterTable
ALTER TABLE "IndividualSubscription" ADD COLUMN     "externalPlanId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "pendingPlanId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationLicense_externalPlanId_key" ON "OrganizationLicense"("externalPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "IndividualSubscription_externalPlanId_key" ON "IndividualSubscription"("externalPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_pendingPlanId_key" ON "Payment"("pendingPlanId");
