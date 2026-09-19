-- POR QUE esta migracion esta escrita a mano y no generada por
-- `prisma migrate dev` (misma convencion que el resto de las migraciones de
-- este cambio, ver context.md): esta base ya tiene dos indices unicos
-- parciales que Prisma no puede expresar en el schema
-- (`AiModel_un_solo_default`, `User_un_solo_demo`), y `prisma migrate dev`
-- los dropea al generar un diff que no los reconoce. No hace falta que ESTA
-- migracion los toque para que el riesgo exista: se escribe a mano junto con
-- el resto por la misma disciplina, no porque haga falta un indice parcial
-- nuevo.
--
-- M8 (design.md #7 — "Admin bypass of project ownership"): la marca durable
-- de que un admin actuo sobre el recurso de otro docente. Tres columnas,
-- ninguna tabla de auditoria nueva:
--
--   - Project.lastAdminActorId / lastAdminActionAt: el ULTIMO admin que
--     tocó el recurso, y cuándo. Es un puntero simple, no un historial — lo
--     que el dueño necesita saber es "¿alguien más tocó esto, y hace
--     cuánto?", no un log completo de cada accion.
--   - ChatMessage.authorUserId: quién escribió ESTE turno cuando no fue el
--     dueño del recurso. NULL en el caso normal (el dueño escribiendo su
--     propio recurso), así que ninguna fila existente cambia de sentido.
--
-- Las dos relaciones son ON DELETE SET NULL: si se borra la cuenta del
-- admin que actuó (poco frecuente, pero posible), el recurso del docente no
-- se rompe ni pierde código — sólo pierde la atribución de quién lo tocó,
-- que es exactamente lo que ON DELETE CASCADE haría mal (borraría el
-- recurso de un docente por la baja de la cuenta de OTRA persona).

-- AlterTable
ALTER TABLE "Project"
  ADD COLUMN "lastAdminActorId" TEXT,
  ADD COLUMN "lastAdminActionAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_lastAdminActorId_fkey" FOREIGN KEY ("lastAdminActorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN "authorUserId" TEXT;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
