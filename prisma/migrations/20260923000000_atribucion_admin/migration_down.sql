-- Rollback manual de 20260923000000_atribucion_admin. Ningún dato de
-- verdad se pierde salvo la atribución misma (quién tocó qué como admin):
-- el recurso, su código, sus hilos y sus mensajes quedan intactos.

ALTER TABLE "ChatMessage" DROP CONSTRAINT IF EXISTS "ChatMessage_authorUserId_fkey";
ALTER TABLE "ChatMessage" DROP COLUMN IF EXISTS "authorUserId";

ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_lastAdminActorId_fkey";
ALTER TABLE "Project" DROP COLUMN IF EXISTS "lastAdminActorId";
ALTER TABLE "Project" DROP COLUMN IF EXISTS "lastAdminActionAt";
