-- Rollback A MANO de 20260919000000_catalogo_de_motores. No lo corre Prisma:
-- se ejecuta a proposito, con un operador mirando.
--
-- QUE SE PIERDE, honestamente: todo turno de TokenUsage escrito ENTRE el
-- deploy de esta migracion y el rollback tiene "provider" = NULL (esta
-- migracion dejo de escribirlo a proposito). Las tres UPDATE de abajo
-- reconstruyen el valor del enum para los tres motores que YA existian antes
-- de esta migracion. La ultima UPDATE es la perdida aceptada: un motor que un
-- admin haya agregado DESPUES de este deploy no tiene valor de enum al que
-- volver, asi que esas filas quedan archivadas bajo MINIMAX (el default de la
-- columna) y el costo (costUsd, si M4 ya corrio) se pierde con la columna.
-- Por eso el bloque imprime cuantas filas cayeron en ese caso: quien corre
-- este script tiene que verlo antes de seguir.

DO $$
DECLARE
  filas_sin_mapeo INTEGER;
BEGIN
  UPDATE "TokenUsage" SET "provider" = 'MINIMAX'
    WHERE "provider" IS NULL AND "aiModelId" IN ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002');

  UPDATE "TokenUsage" SET "provider" = 'DEEPSEEK'
    WHERE "provider" IS NULL AND "aiModelId" = '10000000-0000-0000-0000-000000000003';

  UPDATE "TokenUsage" SET "provider" = 'ALPHA'
    WHERE "provider" IS NULL AND "aiModelId" = '10000000-0000-0000-0000-000000000004';

  -- Perdida aceptada: motores agregados despues del deploy no tienen enum.
  UPDATE "TokenUsage" SET "provider" = 'MINIMAX' WHERE "provider" IS NULL;
  GET DIAGNOSTICS filas_sin_mapeo = ROW_COUNT;

  RAISE NOTICE 'migration_down: % fila(s) de TokenUsage no tenian un motor semilla y se archivaron como MINIMAX (perdida aceptada)', filas_sin_mapeo;
END $$;

ALTER TABLE "TokenUsage" ALTER COLUMN "provider" SET NOT NULL;

ALTER TABLE "TokenUsage" DROP CONSTRAINT "TokenUsage_aiModelId_fkey";
ALTER TABLE "TokenUsage" DROP COLUMN "aiModelId";

ALTER TABLE "Project" DROP CONSTRAINT "Project_aiModelId_fkey";
ALTER TABLE "Project" DROP COLUMN "aiModelId";

DROP TABLE "AiModel";
