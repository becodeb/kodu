# Migration rehearsal — `20260925000000_publicacion_likes_y_motores`

Run against `koduedu_rehearsal`, a disposable clone of the dev DB
(`CREATE DATABASE koduedu_rehearsal TEMPLATE koduedu;`), never against the
working dev DB. The scratch DB was dropped after the rehearsal finished; the
real dev DB (`koduedu`) was migrated separately afterward via
`npm run db:deploy` (see apply-progress.md).

## Steps and evidence

1. `01_seed.sql` — seeds the three pre-migration row shapes named in
   tasks.md 2.1: (a) cover + published, (b) cover + private, (c) no cover +
   published (the pre-existing coverless-published case).
2. `02_apply_output.txt` — `migration.sql` run twice back to back against the
   seeded scratch DB. First run: `UPDATE 2` (rows a and b get backfilled, row
   c has no `screenshotUrl` so it is skipped). Second run (replay): every
   statement reports "already exists, skipping" and `UPDATE 0` — full
   idempotency, no error.
3. Backfill assertion (captured in this session, reproduced below): every row
   with `screenshotUrl IS NOT NULL` has `screenshotAt = updatedAt` exactly;
   row (c)'s `isInGallery` stays `true` and its `screenshotAt` stays NULL;
   `ProjectLike` exists with both indexes (`ProjectLike_userId_projectId_key`
   unique, `ProjectLike_projectId_idx`) and both FKs
   (`ProjectLike_userId_fkey`, `ProjectLike_projectId_fkey`, both CASCADE).
4. `03_down_output.txt` — `migration_down.sql` run against the migrated
   scratch DB: `ProjectLike` dropped, `screenshotAt` column dropped,
   `screenshotUrl`/`isInGallery` values from the seed are byte-identical to
   before the up migration.
5. `04_reapply_output.txt` — `migration.sql` run a third time, after the down,
   to prove the up → down → up cycle is clean: `UPDATE 2` again (screenshotAt
   was dropped, so the backfill has work to do again), same correct result.

## Result

Backfill: PASS. Idempotency (replay with no error): PASS. Rollback
(no data loss outside `ProjectLike`, no row untouched by the invariant):
PASS. Up → down → up cycle: PASS.
