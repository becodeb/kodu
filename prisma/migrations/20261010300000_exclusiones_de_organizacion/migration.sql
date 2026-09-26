-- odd/tasks/organizaciones.md (T6, "decision tecnica para T6/T8"): la baja de
-- un docente de una CAMPUS necesita dejar un rastro que bloquee volver a
-- unirse por DOMINIO a esa misma sede -- sin esto la baja de alguien que
-- habia entrado por dominio se deshacia sola en el siguiente login (lo que
-- T5 encontro al probar recordUsage).
--
-- Escrita a mano y aplicada con psql + `prisma migrate resolve --applied`
-- (mismo criterio que 20261010000000_organizaciones): esta base tiene tres
-- indices unicos PARCIALES que `prisma migrate dev` no reconoce y dropearia
-- (AiModel_un_solo_default, AiModel_un_solo_verificador, User_un_solo_demo).
--
-- El DDL de la tabla nueva SI salio de
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
-- (solo lectura); se descarto de esa salida el DROP COLUMN de ChatMessage que
-- aparece porque este clon (koduedu_orgs) ya tiene aplicada la migracion
-- 20261007000000_chequeos_posteriores de la otra rama (feat/generacion-simple-y-reanudable)
-- -- sus columnas de mas no le pertenecen a este cambio y no hay que tocarlas
-- (ver "Entorno aislado" en odd/tasks/organizaciones.md).
--
-- Sin backfill: no existia ninguna nocion de "exclusion" antes de esta tabla,
-- asi que no hay filas historicas que reconstruir.

BEGIN;

-- CreateTable
CREATE TABLE "OrganizationExclusion" (
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "OrganizationExclusion_pkey" PRIMARY KEY ("organizationId","email")
);

-- AddForeignKey
ALTER TABLE "OrganizationExclusion" ADD CONSTRAINT "OrganizationExclusion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationExclusion" ADD CONSTRAINT "OrganizationExclusion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
