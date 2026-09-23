-- POR QUE esta migracion esta escrita a mano (misma disciplina que el resto
-- de las migraciones de este cambio, ver odd/tasks/modo-prime.md): produccion
-- corre `prisma migrate deploy` sin tsx (docker/prod-entrypoint.sh), asi que
-- cualquier migracion tiene que ser SQL puro, generada o no.
--
-- T5, "Modo prime y funciones para todos": el interruptor general de modo
-- prime y los tres interruptores "para todos" (revision automatica, "A
-- fondo", varias versiones), todos en AppSettings; la marca individual de
-- una cuenta (User.primeAccess); y el motor exclusivo de prime
-- (AiModel.primeOnly). Los cinco booleanos nacen en `false`: prender modo
-- prime es un acto explicito del admin, nunca algo que una migracion decida
-- por el.

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "primeEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AppSettings" ADD COLUMN "autoReviewForAll" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AppSettings" ADD COLUMN "deepModeForAll" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AppSettings" ADD COLUMN "versionsForAll" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "primeAccess" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AiModel" ADD COLUMN "primeOnly" BOOLEAN NOT NULL DEFAULT false;
