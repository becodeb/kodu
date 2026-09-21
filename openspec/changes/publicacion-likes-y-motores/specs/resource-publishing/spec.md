# Resource Publishing Specification

## Purpose

Governs the publish lifecycle for a teacher's resource: where the publish
control lives, the server-enforced guarantee that no resource is published
without a cover, un-publishing, and the cover-freshness affordance that tells
a teacher their cover no longer matches the resource.

## Requirements

### Requirement: Publishing lives in the workspace, not the creation dialog

The publish/un-publish control MUST be reachable from the workspace, next to
the cover action, and MUST NOT appear in the resource-creation dialog.
Publishing MUST remain reversible from the same surface that shows the
published state.

#### Scenario: Creation dialog no longer offers publishing

- GIVEN a teacher creates a new resource
- WHEN the "¿Qué vas a armar?" dialog opens
- THEN no publish toggle is present
- Verification: Playwright browser check, both themes

#### Scenario: Workspace still shows and controls published state

- GIVEN a teacher has a project open in the workspace
- WHEN they use the publish control next to the cover action
- THEN the project's published state toggles and the resource list reflects it
- Verification: Playwright browser check

### Requirement: No published resource without a cover, enforced server-side

The endpoint that sets a project's `isInGallery` to `true` MUST reject the
request when that project's `screenshotUrl` is null, regardless of which
client or client sequence issued the request. The client MUST capture the
cover before requesting publication, but the server rejection is the
invariant that holds even if the client sequence is bypassed or raced.

#### Scenario: Capture succeeds, then publish succeeds

- GIVEN a teacher's preview iframe has rendered
- WHEN they publish: the client captures the cover, stores `screenshotUrl`,
  then requests `isInGallery: true`
- THEN the request succeeds and the project appears in the gallery with its
  cover
- Verification: Playwright browser check

#### Scenario: Capture fails or the preview has not rendered

- GIVEN the preview iframe has not finished rendering, or the capture request
  fails
- WHEN the teacher attempts to publish
- THEN the resource stays unpublished, and the teacher sees a retriable
  error, never a silent success
- Verification: Playwright browser check (simulated capture failure)

#### Scenario: Direct API call with no stored cover is rejected

- GIVEN a project with `screenshotUrl: null`
- WHEN a request sets `isInGallery: true` on that project directly against
  the API
- THEN the request is rejected and `isInGallery` remains unchanged
- Verification: API-level integration check

#### Scenario: Pre-existing published-but-coverless rows are not retroactively affected

- GIVEN a project persisted before this change with `isInGallery: true` and
  `screenshotUrl: null`
- WHEN the gallery renders after deploy
- THEN that project keeps showing — the invariant is enforced on the write
  path, not by a retroactive scan
- AND the next explicit publish/un-publish action on that project is subject
  to the invariant like any other
- Verification: DB state inspection

### Requirement: Cover freshness is visible and its marker is subtle

`Project.screenshotAt` MUST record when the currently-stored cover was
taken. A cover is stale when `screenshotAt < updatedAt`. The cover-action
button MUST read "Actualizar portada" when stale, "Cambiar portada" when a
cover is present and fresh, and "Sacar portada" when no cover is present. A
stale cover MUST carry a marker that is noticeable on inspection but not
attention-grabbing — no banner, no modal.

#### Scenario: Stale cover after an AI edit

- GIVEN a published project whose `updatedAt` advances past its
  `screenshotAt` because the AI changed the code
- WHEN the teacher views the cover action
- THEN it reads "Actualizar portada" and shows the subtle stale marker
- Verification: Playwright browser check, both themes

#### Scenario: Fresh cover shows the ordinary label

- GIVEN a project whose `screenshotAt` is at or after its `updatedAt`
- WHEN the teacher views the cover action
- THEN it reads "Cambiar portada" with no stale marker
- Verification: Playwright browser check

#### Scenario: No cover shows the capture label

- GIVEN a project with `screenshotUrl: null`
- WHEN the teacher views the cover action
- THEN it reads "Sacar portada" and no staleness marker applies
- Verification: Playwright browser check

#### Scenario: Pre-existing covers are not flagged stale on deploy day

- GIVEN a project persisted before this change with a non-null
  `screenshotUrl`
- WHEN the migration backfills `screenshotAt = updatedAt` for that row
- THEN the cover reads as fresh immediately after deploy, not stale
- Verification: DB state inspection

### Requirement: Cover schema changes are additive and unattended

The `screenshotAt` column MUST be introduced via a purely additive `ALTER
TABLE … ADD COLUMN` plus its backfill `UPDATE`, applied by `prisma migrate
deploy` with no manual post-deploy step.

#### Scenario: Migration and backfill run unattended on deploy

- GIVEN a push-to-main deploy triggers the production migration step
- WHEN `prisma migrate deploy` runs
- THEN `screenshotAt` exists and every pre-existing project with a cover has
  it backfilled, with no manual intervention
- Verification: deploy log inspection / migration dry-run
