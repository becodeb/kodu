-- "Admin con facturación" (odd/tasks/org-admin-facturacion.md).
-- Un admin de organización puede ser un coordinador que NO debe ver la
-- facturación; sólo quien tiene este permiso entra a /org/plan y a
-- /api/billing/org/**.
ALTER TABLE "OrganizationAdmin" ADD COLUMN "canManageBilling" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: el permiso lo recibe SOLO el creador de cada organización = su
-- admin más antiguo (menor createdAt; si empatan, menor userId). No se le da
-- a todos los admins existentes. Las filas de sedes de una red también tienen
-- "su" admin más antiguo, pero el permiso sólo se lee en la fila de la RAÍZ,
-- así que no tiene efecto fuera de ella.
UPDATE "OrganizationAdmin" AS a
SET "canManageBilling" = true
WHERE (a."userId", a."organizationId") IN (
  SELECT DISTINCT ON ("organizationId") "userId", "organizationId"
  FROM "OrganizationAdmin"
  ORDER BY "organizationId", "createdAt" ASC, "userId" ASC
);
