-- AlterTable
ALTER TABLE "AiTrace" ADD COLUMN     "generationMode" TEXT,
ADD COLUMN     "parentChatMessageId" TEXT,
ADD COLUMN     "redFlags" TEXT,
ADD COLUMN     "redFlagsFixed" BOOLEAN,
ADD COLUMN     "selfTestDurationMs" INTEGER,
ADD COLUMN     "turnRole" TEXT;

-- AlterTable
ALTER TABLE "TokenUsage" ADD COLUMN     "aiTraceId" TEXT;

-- CreateIndex
CREATE INDEX "AiTrace_parentChatMessageId_idx" ON "AiTrace"("parentChatMessageId");

-- CreateIndex
CREATE INDEX "TokenUsage_aiTraceId_idx" ON "TokenUsage"("aiTraceId");

-- AddForeignKey
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_aiTraceId_fkey" FOREIGN KEY ("aiTraceId") REFERENCES "AiTrace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

