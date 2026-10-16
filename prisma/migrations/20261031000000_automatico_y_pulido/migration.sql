-- T14 (motor-claude, modo "automatico"): additive only. "creationModelId" is
-- nullable with no data backfill — every existing Project keeps NULL (no
-- sticky engine yet) and behaves exactly as before; the column only matters
-- once a project runs its FIRST turn under "automatico".
ALTER TABLE "Project" ADD COLUMN "creationModelId" TEXT;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_creationModelId_fkey" FOREIGN KEY ("creationModelId") REFERENCES "AiModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- T14: the SQL default only governs a FUTURE AppSettings row (a brand new
-- install that has never written one yet) — production's single existing
-- row (id = 1) already has a value the owner chose, and this migration
-- never UPDATEs it, only changes the DEFAULT for rows that don't exist yet.
ALTER TABLE "AppSettings" ALTER COLUMN "generationMode" SET DEFAULT 'automatico';

-- T15 (motor-claude, modo "haiku-pulido"): new UsagePurpose value for the
-- extra visual-polish pass. Nothing historical gets this value — it only
-- appears on TokenUsage/AiTrace rows written by the polish step itself.
-- AlterEnum
ALTER TYPE "UsagePurpose" ADD VALUE 'POLISH';
