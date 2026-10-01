-- CreateEnum
CREATE TYPE "TraceEditOutcome" AS ENUM ('FULL', 'FRAGMENTS', 'FRAGMENTS_FALLBACK', 'FAILED');

-- CreateEnum
CREATE TYPE "FaceRating" AS ENUM ('GOOD', 'NEUTRAL', 'BAD');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "feedbackTurnsSinceAsk" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastFeedbackPromptKind" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "feedbackPromptsDisabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AiTrace" (
    "id" TEXT NOT NULL,
    "tokenUsageId" TEXT,
    "projectId" TEXT,
    "chatMessageId" TEXT,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "planAtCall" TEXT NOT NULL,
    "turnKind" "UsagePurpose" NOT NULL,
    "model" TEXT NOT NULL,
    "reasoningEffort" TEXT,
    "requestText" TEXT NOT NULL,
    "editOutcome" "TraceEditOutcome",
    "retries" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "htmlCharsBefore" INTEGER,
    "htmlCharsAfter" INTEGER,
    "durationMs" INTEGER,
    "selfTestPassed" INTEGER,
    "selfTestFailed" INTEGER,
    "correctionRounds" INTEGER,
    "verifierFindings" INTEGER,
    "faceRating" "FaceRating",
    "faceRatingComment" TEXT,
    "faceRatingAt" TIMESTAMP(3),
    "inlineQuestionKind" TEXT,
    "inlineQuestionAnswer" TEXT,
    "inlineQuestionAt" TIMESTAMP(3),
    "suspectedDefect" BOOLEAN NOT NULL DEFAULT false,
    "suspectedDefectPhrase" TEXT,
    "undoneSignal" BOOLEAN NOT NULL DEFAULT false,
    "codeEditedByTeacherSignal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTrace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiTrace_tokenUsageId_key" ON "AiTrace"("tokenUsageId");

-- CreateIndex
CREATE UNIQUE INDEX "AiTrace_chatMessageId_key" ON "AiTrace"("chatMessageId");

-- CreateIndex
CREATE INDEX "AiTrace_createdAt_idx" ON "AiTrace"("createdAt");

-- CreateIndex
CREATE INDEX "AiTrace_projectId_idx" ON "AiTrace"("projectId");

-- CreateIndex
CREATE INDEX "AiTrace_userId_createdAt_idx" ON "AiTrace"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiTrace_organizationId_createdAt_idx" ON "AiTrace"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiTrace" ADD CONSTRAINT "AiTrace_tokenUsageId_fkey" FOREIGN KEY ("tokenUsageId") REFERENCES "TokenUsage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTrace" ADD CONSTRAINT "AiTrace_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTrace" ADD CONSTRAINT "AiTrace_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTrace" ADD CONSTRAINT "AiTrace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTrace" ADD CONSTRAINT "AiTrace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
