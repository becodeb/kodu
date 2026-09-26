-- POR QUE esta migracion esta escrita a mano (misma disciplina que el resto
-- de las migraciones de este repo): produccion corre `prisma migrate deploy`
-- sin tsx (docker/prod-entrypoint.sh), asi que cualquier migracion tiene que
-- ser SQL puro, generada o no. Ademas esta base tiene tres indices unicos
-- parciales (`AiModel_un_solo_default`, `User_un_solo_demo`,
-- `AiModel_un_solo_verificador`) que no estan declarados en el schema de
-- Prisma: `prisma migrate dev` los DROPEARIA al generar el diff automatico
-- porque no los reconoce.
--
-- odd/tasks/generacion-simple-y-reanudable.md (T1, decision del dueño
-- 2026-09-26): se saca modo prime entero y los interruptores de calidad que
-- los ensayos con el arnes (`exp/medicion-arnes`) nunca midieron con
-- ganancia real. `versionsForAll` (AppSettings) y `versionsEnabled`
-- (Project, migracion siguiente) quedan como el unico camino a "3
-- versiones", sin prime de por medio.
--
-- Orden que importa:
--  1) Un motor `primeOnly = true` se apaga ANTES de borrar la columna: si no,
--     al desaparecer el filtro de catalogo.ts ese motor pasaria a estar
--     visible para CUALQUIER docente sin que nadie lo haya decidido.
--  2) `reasoningEffort = 'max'` baja a 'high': "max" deja de ser un nivel
--     valido (duplicaba costo y tiempo sin ganancia medida).
--  3) Recien ahi se dropean las columnas.

-- 1) Ningun motor prime-only se vuelve visible para todos por accidente.
UPDATE "AiModel" SET "enabled" = false WHERE "primeOnly" = true;

-- 2) "max" ya no es un nivel de razonamiento valido.
UPDATE "AiModel" SET "reasoningEffort" = 'high' WHERE "reasoningEffort" = 'max';

-- 3) Las columnas de modo prime y de los interruptores de calidad nunca
-- medidos con ganancia real.
ALTER TABLE "AppSettings" DROP COLUMN "primeEnabled";
ALTER TABLE "AppSettings" DROP COLUMN "autoReviewForAll";
ALTER TABLE "AppSettings" DROP COLUMN "deepModeForAll";
ALTER TABLE "User" DROP COLUMN "primeAccess";
ALTER TABLE "AiModel" DROP COLUMN "primeOnly";
