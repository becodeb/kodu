-- odd/tasks/planes-y-cobros.md (T5): tabla suelta para el contacto de
-- "Hablemos" (matrícula por encima del umbral configurado, o el formulario de
-- contacto simple de /instituciones/alta) — ver el comentario de
-- InstitutionLead en schema.prisma. DDL generado con
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`.

BEGIN;

CREATE TABLE "InstitutionLead" (
    "id" TEXT NOT NULL,
    "institutionName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "phone" TEXT,
    "declaredStudents" INTEGER,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "InstitutionLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstitutionLead_reviewedAt_idx" ON "InstitutionLead"("reviewedAt");

COMMIT;
