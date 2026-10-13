-- T7 (motor-claude): additive columns only. Every new AppSettings column has
-- a default, so the single existing row (id = 1) keeps working untouched
-- (generationMode = 'base', the engine every project already uses today).
-- No existing column is touched.

ALTER TABLE "AppSettings" ADD COLUMN "generationMode" TEXT NOT NULL DEFAULT 'base';
ALTER TABLE "AppSettings" ADD COLUMN "creationModelId" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "adjustmentModelId" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "monthlyCreditUsd" DECIMAL(10,2) NOT NULL DEFAULT 200;
ALTER TABLE "AppSettings" ADD COLUMN "premiumUntilUsd" DECIMAL(10,2) NOT NULL DEFAULT 100;
ALTER TABLE "AppSettings" ADD COLUMN "billingCycleDay" INTEGER NOT NULL DEFAULT 1;

-- Defense in depth: the admin API's zod schema already rejects anything
-- outside 1-28, this CHECK just means a stray direct SQL write can't break
-- ventanaDelCiclo's "every month has at least 28 days" assumption either.
ALTER TABLE "AppSettings" ADD CONSTRAINT "AppSettings_billingCycleDay_check" CHECK ("billingCycleDay" BETWEEN 1 AND 28);

-- AddForeignKey
ALTER TABLE "AppSettings" ADD CONSTRAINT "AppSettings_creationModelId_fkey" FOREIGN KEY ("creationModelId") REFERENCES "AiModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSettings" ADD CONSTRAINT "AppSettings_adjustmentModelId_fkey" FOREIGN KEY ("adjustmentModelId") REFERENCES "AiModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- T7 (motor-claude): Project — whether THIS row's aiModelId was set by a
-- teacher explicitly touching the engine selector (vs. the silent initial
-- assignment or the automatic fallback swap). Every existing project keeps
-- false: none of today's rows went through that explicit path differently
-- from any other, and `false` is exactly "let the active generation mode
-- route this project" — the correct default for 100% of existing data.
ALTER TABLE "Project" ADD COLUMN "engineChosenByTeacher" BOOLEAN NOT NULL DEFAULT false;
