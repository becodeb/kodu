-- odd/tasks/taller-de-ideas.md: el Taller de ideas, un lugar para pensar la
-- herramienta con la IA ANTES de crearla. Tres tablas nuevas y un valor nuevo
-- en UsagePurpose:
--
--  - IdeaSession: una charla del Taller. Cuelga del docente y no de Project
--    porque existe antes que el recurso; `projectId` se llena recién al tocar
--    "Crear mi recurso" (unico: una charla da a lo sumo un recurso). SET NULL
--    al borrar el recurso: la charla no se pierde, vuelve a quedar en curso.
--  - IdeaMessage: los mensajes de esa charla. Las preguntas con respuestas
--    sugeridas y las ideas propuestas van en columnas de texto JSON aparte del
--    `content`, mismo criterio que ChatMessage.attachments/checklist.
--  - IdeaAsset: lo que el docente adjunta en el Taller. Al crear el recurso se
--    copia como ProjectAsset con la misma URL (el archivo no se duplica).
--  - UsagePurpose.IDEATION: cada respuesta del Taller se registra en
--    TokenUsage con este proposito, sin projectId, para que /admin/metricas
--    muestre cuanto cuesta pensar una idea aparte de generarla.
--
-- Escrita a mano (mismo criterio que 20261010000000_organizaciones: la base
-- tiene indices unicos PARCIALES que `prisma migrate dev` no reconoce y
-- dropearia). El DDL salio de `prisma migrate diff --from-schema <schema
-- anterior> --to-schema prisma/schema.prisma --script`, sin base de datos.
--
-- ALTER TYPE ... ADD VALUE dentro de una transaccion es valido desde
-- PostgreSQL 12 mientras el valor nuevo no se USE en la misma transaccion, y
-- esta migracion no lo usa.
--
-- Sin backfill: no existia nada parecido antes de estas tablas.

BEGIN;

-- CreateEnum
CREATE TYPE "IdeaMode" AS ENUM ('TOPIC', 'IDEA');

-- AlterEnum
ALTER TYPE "UsagePurpose" ADD VALUE 'IDEATION';

-- CreateTable
CREATE TABLE "IdeaSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "IdeaMode" NOT NULL,
    "title" TEXT,
    "brief" TEXT NOT NULL DEFAULT '{}',
    "finalPrompt" TEXT,
    "finalPromptEditedByTeacher" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdeaSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdeaMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "questions" TEXT,
    "proposals" TEXT,
    "attachments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdeaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdeaAsset" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "extractedText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdeaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdeaSession_projectId_key" ON "IdeaSession"("projectId");

-- CreateIndex
CREATE INDEX "IdeaSession_userId_updatedAt_idx" ON "IdeaSession"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "IdeaMessage_sessionId_createdAt_idx" ON "IdeaMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "IdeaAsset_sessionId_idx" ON "IdeaAsset"("sessionId");

-- AddForeignKey
ALTER TABLE "IdeaSession" ADD CONSTRAINT "IdeaSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaSession" ADD CONSTRAINT "IdeaSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaMessage" ADD CONSTRAINT "IdeaMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "IdeaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaAsset" ADD CONSTRAINT "IdeaAsset_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "IdeaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
