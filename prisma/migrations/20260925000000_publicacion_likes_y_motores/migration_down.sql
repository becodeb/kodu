-- Rollback manual de 20260925000000_publicacion_likes_y_motores. Se corre por
-- fuera de `prisma migrate`:
--   docker exec -i kodu_db_dev psql -U kodu -d koduedu -f - < migration_down.sql
-- y despues:
--   npx prisma migrate resolve --rolled-back 20260925000000_publicacion_likes_y_motores
--
-- PERDIDA ACEPTADA, y es la unica: LOS LIKES. Se van con la tabla y no hay
-- forma de reconstruirlos. Ningun recurso, portada, consumo ni clave se toca:
-- las portadas sacadas despues del cambio sobreviven enteras, porque son
-- `screenshotUrl` comun y corriente y esa columna no se creo acá.

ALTER TABLE "ProjectLike" DROP CONSTRAINT IF EXISTS "ProjectLike_projectId_fkey";
ALTER TABLE "ProjectLike" DROP CONSTRAINT IF EXISTS "ProjectLike_userId_fkey";
DROP INDEX IF EXISTS "ProjectLike_projectId_idx";
DROP INDEX IF EXISTS "ProjectLike_userId_projectId_key";
DROP TABLE IF EXISTS "ProjectLike";

ALTER TABLE "Project" DROP COLUMN IF EXISTS "screenshotAt";
