-- Los modelos dejan de ser "rapido/razonador" y pasan a ser el proveedor que se
-- usa. Se mapea lo viejo: FLASH era el de uso diario -> ALPHA; PRO era el caro
-- -> DEEPSEEK.
ALTER TYPE "ModelChoice" RENAME TO "ModelChoice_old";
CREATE TYPE "ModelChoice" AS ENUM ('ALPHA', 'DEEPSEEK');

ALTER TABLE "Project" ALTER COLUMN "selectedModel" DROP DEFAULT;
ALTER TABLE "Project"
  ALTER COLUMN "selectedModel" TYPE "ModelChoice"
  USING (CASE "selectedModel"::text WHEN 'PRO' THEN 'DEEPSEEK' ELSE 'ALPHA' END)::"ModelChoice";
ALTER TABLE "Project" ALTER COLUMN "selectedModel" SET DEFAULT 'ALPHA';

DROP TYPE "ModelChoice_old";

-- Consumo por turno: sostiene el tope por usuario del proveedor pago y deja ver
-- quien gasta cuanto.
CREATE TABLE "TokenUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "ModelChoice" NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TokenUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TokenUsage_userId_provider_idx" ON "TokenUsage"("userId", "provider");
CREATE INDEX "TokenUsage_createdAt_idx" ON "TokenUsage"("createdAt");

ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
