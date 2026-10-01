-- odd/tasks/planes-y-cobros.md (T5): el default de OrganizationDomain.status
-- pasa de PENDING a VERIFIED. Sólo cambia el DEFAULT para los próximos
-- INSERT sin `status` explícito -- las filas que ya existen no se tocan
-- (ninguna necesita tocarse: T1 ya las migró todas a VERIFIED).
--
-- Por qué: src/lib/orgs/resolucion.ts (T5) empezó a ignorar los dominios
-- PENDING al resolver a qué organización pertenece un email (para que un
-- dominio EXTRA sin confirmar de un alta propia no una a nadie). Con el
-- default viejo (PENDING), cualquier INSERT que no pase `status` -- el alta a
-- mano del superadmin (gestion.ts#agregarDominio) y todos los fixtures de los
-- e2e preexistentes -- quedaba PENDING y dejaba de resolver. Sólo
-- src/lib/billing/alta.ts (el alta propia, T5) pasa `status` EXPLÍCITO
-- (VERIFIED para el dominio del creador, PENDING para los extras); para
-- cualquier otro llamador, "sin especificar" tiene que seguir significando
-- "confiale", no "pendiente".

BEGIN;

ALTER TABLE "OrganizationDomain" ALTER COLUMN "status" SET DEFAULT 'VERIFIED';

COMMIT;
