-- POR QUE esta migracion esta escrita a mano y no generada por
-- `prisma migrate dev` (misma razon que 20260919000000_catalogo_de_motores y
-- 20260921000000_acceso_y_ajustes):
--
-- `User.isDemo` necesita "a lo sumo una cuenta demo, siempre" — eso es un
-- indice unico PARCIAL (WHERE "isDemo" = true), y Prisma no tiene forma de
-- declararlo en el schema. `prisma migrate dev` no solo lo omitiria del
-- diff automatico: ademas DROPEA los indices parciales que ya existen
-- (`AiModel_un_solo_default`, agregado a mano en 20260919000000) porque no
-- los reconoce como parte del schema declarado. Por eso esta migracion
-- tambien se escribe a mano y se marca aplicada con
-- `prisma migrate resolve --applied` en vez de dejar que el CLI la genere
-- o la corra.
--
-- La cuenta de demo en si NO se siembra aca (design.md #8): se crea recien
-- la primera vez que un admin prende el interruptor de `AppSettings.demoEnabled`
-- (`src/lib/demo.ts#asegurarCuentaDemo`), para que su `createdAt` signifique
-- algo real — cuando arranco la demo, no la fecha en que corrio esta
-- migracion. Esta migracion solo abre la puerta (la columna + el indice);
-- no inserta ninguna fila en "User".

-- AlterTable
ALTER TABLE "User" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- A lo sumo una fila con isDemo = true, mismo patron que
-- "AiModel_un_solo_default" (20260919000000_catalogo_de_motores).
CREATE UNIQUE INDEX "User_un_solo_demo" ON "User" ("isDemo") WHERE "isDemo" = true;

-- AlterTable
-- Marca los recursos creados por la cuenta de demo, para el purgado masivo
-- desde /admin/demo (DELETE /api/admin/demo/recursos). Los hilos y adjuntos
-- de esos recursos caen en cascada (Project -> ChatThread/ProjectAsset ya son
-- onDelete: Cascade); TokenUsage.projectId es onDelete: SetNull, asi que el
-- consumo historico de esos turnos no desaparece con el recurso.
ALTER TABLE "Project" ADD COLUMN "createdByDemo" BOOLEAN NOT NULL DEFAULT false;
