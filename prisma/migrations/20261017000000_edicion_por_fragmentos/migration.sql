-- odd/tasks/ahorro-tokens.md (T3a): fragment editing (edit_resource_code).
--
-- Adds:
--   1. AppSettings.fragmentEditsEnabled — global on/off switch, editable from
--      /admin/generacion. Defaults to true at the Prisma/code level (a brand
--      new row would get true), but this migration explicitly sets it to
--      false on the existing singleton row: the feature ships off until the
--      owner turns it on after measuring real cost/quality (T3b).
--   2. TokenUsage.editMode — nullable enum (EditMode: FULL / FRAGMENTS /
--      FRAGMENTS_FALLBACK) recording how a given turn wrote its code. NULL
--      on every historical row and on turns that never write code.
--
-- Idempotent: guarded so re-running this file changes nothing the second time.

-- 1. Schema ----------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "EditMode" AS ENUM ('FULL', 'FRAGMENTS', 'FRAGMENTS_FALLBACK');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "fragmentEditsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TokenUsage" ADD COLUMN IF NOT EXISTS "editMode" "EditMode";

-- 2. Existing databases ship with the switch OFF ----------------------------
--
-- The column default (true) only applies to rows inserted AFTER this
-- migration runs. The singleton AppSettings row (id = 1) already exists in
-- every database this migration targets, so ADD COLUMN ... DEFAULT true
-- would otherwise turn the feature on everywhere silently. Force it off
-- explicitly; the owner opts in by hand once T3b's measurement looks good.
UPDATE "AppSettings" SET "fragmentEditsEnabled" = false WHERE id = 1;
