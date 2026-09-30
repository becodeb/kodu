-- odd/tasks/planes-y-cobros.md (T4): tabla del adaptador SIMULADO de
-- PaymentGateway. Solo existe para BILLING_PROVIDER=simulado (local y e2e);
-- el adaptador de Mercado Pago no la usa.
--
-- DDL generado con `prisma migrate diff --from-config-datasource --to-schema
-- prisma/schema.prisma --script` (mismo criterio que las migraciones
-- anteriores del repo) y copiado tal cual, sin backfill ni CHECK adicional.

BEGIN;

-- CreateTable
CREATE TABLE "PagoSimulado" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "amountArs" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payerEmail" TEXT NOT NULL,
    "backUrl" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PagoSimulado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PagoSimulado_externalReference_idx" ON "PagoSimulado"("externalReference");

-- AddForeignKey
ALTER TABLE "PagoSimulado" ADD CONSTRAINT "PagoSimulado_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PagoSimulado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
