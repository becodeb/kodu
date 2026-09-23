-- POR QUE esta migracion esta escrita a mano (misma disciplina que el resto
-- de las migraciones de este cambio, ver odd/tasks/modo-prime.md): produccion
-- corre `prisma migrate deploy` sin tsx (docker/prod-entrypoint.sh), asi que
-- cualquier migracion tiene que ser SQL puro, generada o no.
--
-- T4, "Deshacer cambios de la IA": una instantanea del HTML de ANTES de cada
-- turno que cambio el recurso, colgada del mensaje "assistant" que cierra ese
-- turno (a lo sumo una por turno: unique en "chatMessageId"). `stream.ts` la
-- crea y la poda a las 20 mas nuevas por proyecto; POST /api/projects/:id/undo
-- la consume (restaura el HTML) y la borra.
--
-- "ChatMessage.undoneAt" marca, a la vez, el mensaje de la IA y el pedido del
-- docente que disparo ese turno: el modelo deja de ver el turno ENTERO, no
-- solo la mitad (ver el filtro de historial agregado en stream.ts).

-- CreateTable
CREATE TABLE "ProjectSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "chatMessageId" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSnapshot_chatMessageId_key" ON "ProjectSnapshot"("chatMessageId");

-- CreateIndex
CREATE INDEX "ProjectSnapshot_projectId_createdAt_idx" ON "ProjectSnapshot"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN "undoneAt" TIMESTAMP(3);
