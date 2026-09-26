-- Escrita a mano, mismo criterio que el resto de las migraciones de este
-- cambio (ver odd/tasks/arnes-robustez.md): produccion corre
-- `prisma migrate deploy` sin tsx, asi que tiene que ser SQL puro.
--
-- T16 (round 4, "checklist del docente"): el checklist de comportamientos
-- que arma un paso barato ANTES de generar un recurso NUEVO
-- (src/lib/ai/checklist.ts), guardado en el mensaje "assistant" que cierra
-- ese turno. Columna nullable en ChatMessage, mismo criterio que
-- "attachments" (JSON crudo en texto) y NO una tabla aparte: a diferencia de
-- ResourceVariant (que arrastra hasta 3 documentos HTML completos), esto es
-- un puñado de líneas cortas que SI hace falta releer en cada turno de
-- ajuste (checklistActual, src/lib/ai/checklist-db.ts).

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN "checklist" TEXT;
