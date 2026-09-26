-- POR QUE esta migracion esta escrita a mano y no generada por
-- `prisma migrate dev` (misma razon que 20260919000000_catalogo_de_motores,
-- 20260921000000_acceso_y_ajustes y 20260922000000_modo_demo):
--
-- T3 (verificador, odd/tasks/verificador.md): `AiModel.isVerifier` necesita
-- "a lo sumo un motor marcado como el verificador" — eso es un INDICE UNICO
-- PARCIAL (WHERE "isVerifier" = true), y Prisma no tiene forma de declararlo
-- en el schema. Dejar que `prisma migrate dev` genere el diff automatico no
-- solo lo omitiria: ademas DROPEARIA los indices parciales que ya existen
-- (`AiModel_un_solo_default`, `User_un_solo_demo`) porque no los reconoce
-- como parte del schema declarado. Por eso esta migracion tambien se aplica
-- a mano contra la base y se marca aplicada con
-- `prisma migrate resolve --applied` en vez de dejar que el CLI la genere o
-- la corra.
--
-- `false` en TODAS las filas (el default de la columna) = el verificador
-- esta apagado del todo: `motorVerificador()` (catalogo.ts) devuelve `null`
-- y `POST /api/chat/verificar` contesta `{estado:'desactivado'}` sin llamar
-- a nada. No se siembra ninguna fila en `true` acá: un admin lo prende a
-- mano desde /admin/motores cuando quiera.

-- AlterTable
ALTER TABLE "AiModel" ADD COLUMN "isVerifier" BOOLEAN NOT NULL DEFAULT false;

-- A lo sumo una fila con isVerifier = true, mismo patron que
-- "AiModel_un_solo_default" (20260919000000_catalogo_de_motores).
CREATE UNIQUE INDEX "AiModel_un_solo_verificador" ON "AiModel"("isVerifier") WHERE "isVerifier" = true;
