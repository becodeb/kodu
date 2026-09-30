-- odd/tasks/planes-y-cobros.md (T4): tres columnas nuevas en Payment para el
-- flujo de checkout — ver los comentarios de cada una en schema.prisma
-- (intervalSnapshot, pendingExternalSubscriptionId, refundRequested).
--
-- DDL generado con `prisma migrate diff --from-config-datasource --to-schema
-- prisma/schema.prisma --script`, sin backfill (las tres son nuevas para
-- filas que todavia no existen: T4 es la primera vez que se crea un Payment
-- de verdad).

BEGIN;

ALTER TABLE "Payment" ADD COLUMN     "intervalSnapshot" TEXT,
ADD COLUMN     "pendingExternalSubscriptionId" TEXT,
ADD COLUMN     "refundRequested" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
