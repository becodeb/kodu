-- POR QUE esta migracion esta escrita a mano (misma disciplina que el resto
-- de las migraciones de este cambio, ver odd/tasks/modo-prime.md): produccion
-- corre `prisma migrate deploy` sin tsx, asi que cualquier migracion tiene
-- que ser SQL puro, generada o no.
--
-- T9, "Varias versiones al crear un recurso": hasta 3 generaciones en
-- paralelo cuando el docente puede pedir versiones Y el recurso todavia es
-- el de arranque (turno de creacion). Tabla aparte y NO una columna en
-- ChatMessage: las consultas de historial de stream.ts leen ChatMessage en
-- cada turno para armar el contexto del modelo, y no tienen por que
-- arrastrar hasta 3 documentos HTML completos que ademas nunca viajan de
-- vuelta como contexto (T9: son solo para que elija el docente).
--
-- "chatMessageId" + "index" unico: a lo sumo una fila por version por turno.
-- Cascada con ChatMessage: borrar el mensaje borra sus versiones solas.
-- stream.ts ademas las borra a mano al empezar cualquier turno POSTERIOR del
-- mismo proyecto (nunca se acumulan turno a turno) — ver la tarea.

-- CreateTable
CREATE TABLE "ResourceVariant" (
    "id" TEXT NOT NULL,
    "chatMessageId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "html" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResourceVariant_chatMessageId_index_key" ON "ResourceVariant"("chatMessageId", "index");

-- AddForeignKey
ALTER TABLE "ResourceVariant" ADD CONSTRAINT "ResourceVariant_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN "chosenVariantIndex" INTEGER;
