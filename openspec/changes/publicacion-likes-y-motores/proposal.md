# Proposal: Publicación, likes y motores

**Impact flags (per `config.yaml` rules.proposal):** this change affects the **Prisma schema** (new `ProjectLike` table, new `Project.screenshotAt` column — both purely additive) and the **AI resource-generation flow** (a turn signal reaches `buildSystemPrompt`, and the teacher's engine selector changes shape). It does **not** change **auth**: liking reuses the existing session guard and CSRF token; the gallery stays publicly readable.

**Already on this branch, not work to do:** the DeepSeek `400 … Thinking mode does not support this tool_choice` bug is fixed (`ToolChoiceNoSoportado` → one forced-choice-free retry in `requestCompletionStream`). It is provider-agnostic and claims no new spec-level behavior, so it carries no capability delta — it is recorded here as branch context only.

## Intent

Seven owner requests that share one theme: **the teacher's finished work should look finished, and the controls around it should mean what they say.** Today a resource can be published with no cover and no way to tell the cover is stale; the publish toggle is offered at minute zero, before there is anything to publish; the gallery has no signal of what anyone valued; the AI guesses instead of asking; the admin's engine toggle writes a different column than its label implies; and the teacher sees a dollar figure they cannot act on.

## Scope

### In Scope

1. **Cover is captured on publish.** Publishing runs the existing client-side iframe capture first and only publishes on a stored cover. **Failure is not silent**: if the capture fails or the preview has not rendered, the resource stays unpublished and the teacher gets a retriable error. A server-side invariant backs it — the endpoint that sets `isInGallery: true` rejects a project with a null `screenshotUrl`, so no path can produce a cover-less published resource.
2. **Publishing moves to the workspace**, next to the cover button — that is where "ya lo terminé" happens. `src/pages/app/index.astro:91-95` keeps showing published state and keeps allowing un-publish. The toggle is removed from `FichaDialog.tsx:85-92` only.
3. **Likes**: `ProjectLike` (`userId`, `projectId`, `createdAt`, `@@unique([userId, projectId])`), a toggle API route, heart + counter at the **bottom-left of the gallery card**, red/filled when the current teacher has liked it, and the gallery sorted most-liked first (`updatedAt desc` as tiebreak).
4. **Logged-in teachers only.** Anonymous visitors **see the heart and the count**; the heart renders unfilled and a click sends them to login. A count with no heart reads as broken UI.
5. **AI asks before guessing**: `PromptContext` gains a turn signal (the thread message count, available at `stream.ts:415`), and early turns instruct the model to ask about what it does not know rather than invent it.
6. **Stale-cover affordance**: new `Project.screenshotAt DateTime?`; stale when `screenshotAt < updatedAt`. The button reads "Actualizar portada" and carries a **subtle** marker — no banner, no modal ("tampoco que llame tanto la atención").
7. **Admin engine toggles**: the prominent row toggle becomes `selectableByTeacher` ("lo ven los docentes"); `enabled` ("en servicio") stays as a separate, quieter control, plus a warning when disabling an engine that another engine names as its `fallbackModelId`.
8. **Teacher engine selector** becomes a dropdown with the description on hover, replacing the segmented button group at `ChatPanel.tsx:212-236`.
9. **Price visibility**: the teacher keeps `nivelDeConsumo` (computed on tokens, never dollars) and loses the USD figure. Exact USD stays admin-only.

### Out of Scope

- Denormalized `likeCount` column, like notifications, a "mis favoritos" view, unliking history, or any anti-abuse beyond the unique pair.
- Anonymous likes — cookie/IP dedup is weak and would make "most liked first" inflatable by anyone.
- A no-self-like rule — one more rule to explain, little gain at this scale.
- Server-side (Playwright) cover capture; the existing client capture stays.
- Removing `IndicadorConsumo` entirely, reworking pricing, or touching `TokenUsage`.
- Any change to `cadenaDeMotores()` traversal logic, or to the `enabled`/`selectableByTeacher` semantics themselves — only how they are surfaced.

## Capabilities

### New Capabilities

- `resource-publishing`: the publish lifecycle — where publishing lives, the cover-on-publish invariant and its failure path, un-publishing, cover freshness (`screenshotAt` vs `updatedAt`) and its subtle affordance. Nothing under `openspec/specs/` owns publishing or covers today.
- `gallery-likes`: the like entity and its one-per-teacher rule, the anonymous read-only view, the card affordance, and most-liked-first gallery ordering.
- `ai-authoring-dialogue`: when the model asks instead of building, how far into a conversation that applies, and its relationship to the forced tool choice. `openspec/specs/` has no capability covering prompt construction.

### Modified Capabilities

- `ai-model-catalog`: *Requirement: Ordering, enable/disable, single default* (two distinct admin controls with distinct meanings, plus the fallback-chain guard) and *Requirement: Teacher-facing selector copy* (dropdown with hover description instead of a segmented group).
- `ai-cost-accounting`: *Requirement: Teacher-facing cost indicator* — the hover/tap/keyboard USD reveal is removed for teachers; the qualitative level remains. *Requirement: Admin cost visibility is unconditional* is unchanged and becomes the only place exact USD appears.

## Approach

| # | Decision | Rationale |
|---|---|---|
| 1 | Publish = capture-then-publish, enforced server-side | The client sequence can be bypassed or can race the iframe; the API-level null-cover rejection is the only thing that actually makes "no published resource without a cover" true |
| 2 | Both engine booleans stay, both are surfaced | DeepSeek's real config (`selectableByTeacher: false`, `enabled: true` — never pickable, always reachable by fallback) must remain expressible. Collapsing them would let an admin silently break the fallback chain while believing they only hid a button |
| 3 | No `likeCount` column; count via Prisma `_count` and `orderBy: { likes: { _count: 'desc' } }` | The gallery takes 60 rows. A denormalized counter buys nothing here and can drift out of sync, which is worse than a join |
| 4 | Clarifying-question guidance is **omitted** from the system prompt whenever `forzarHerramienta` is set | `stream.ts:518` forces the code tool when `pideCambio(message)` is true. Two instructions telling the model opposite things in one request is the collision; this invariant removes it instead of arbitrating it at runtime |
| 5 | The teacher keeps a non-monetary consumption signal | `ChatPanel.tsx:209-211` records a deliberate earlier decision to warn teachers about spend. `nivelDeConsumo` keeps that warning function without showing a price — the decision is reversed in its money dimension only |
| 6 | Backfill `screenshotAt = "updatedAt"` for rows that already have a cover | Leaving it null on every existing project would flag them all stale on deploy day. `NULL` then means only "cover taken before this change was possible" and is treated as fresh |

### Migration: pure SQL, unattended, zero post-deploy steps

Production deploys on a Coolify webhook; `docker/prod-entrypoint.sh:11` runs `prisma migrate deploy` before the server starts, and the runner image has neither `scripts/` nor `tsx` (`Dockerfile:51,53-56`). Both schema pieces here are **purely additive** — one `CREATE TABLE`, one `ALTER TABLE … ADD COLUMN`, one `UPDATE` backfill. Nothing is dropped, nothing is re-keyed, **no ciphertext moves and no AAD is at stake**. That is what makes this migration far less delicate than the provider split: its worst failure mode is a table that does not exist yet, not a key that no longer decrypts.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `prisma/schema.prisma` | Modified | `ProjectLike` model; `Project.screenshotAt DateTime?`; `Project.likes` relation |
| `prisma/migrations/<ts>_publicacion_likes_y_motores/` | New | Pure-SQL `migration.sql` (+ down), Spanish WHY comment |
| `src/components/workspace/FichaDialog.tsx:85-92` | Removed | Publish toggle leaves the creation dialog |
| `src/components/workspace/Workspace.tsx:464-482,607-610` | Modified | Publish action lives here; capture-then-publish sequence |
| `src/components/workspace/PreviewPanel.tsx:117` | Modified | "Actualizar portada" + subtle stale marker |
| `src/pages/api/projects/[id]/screenshot.ts` | Modified | Writes `screenshotAt`; DELETE must not leave a published project cover-less |
| `src/pages/api/projects/[id]/*` (gallery PATCH) | Modified | Rejects `isInGallery: true` with a null `screenshotUrl` |
| `src/pages/api/projects/[id]/like.ts` | New | Toggle like; session-guarded, CSRF via the existing wrapper |
| `src/pages/gallery.astro:8-21` | Modified | `_count` include, most-liked-first ordering, per-user liked flag |
| Gallery card component | Modified | Heart + counter bottom-left; anonymous click → login |
| `src/pages/app/index.astro:91-95` | Verify | Still shows published state and still un-publishes |
| `src/lib/ai/prompt.ts:47,172` | Modified | `PromptContext` turn signal; early-turn question guidance |
| `src/pages/api/chat/stream.ts:415,518` | Modified | Passes the turn count; omits guidance when forcing the tool |
| `src/components/admin/ModelosPanel.tsx:93-99,209-213` | Modified | Row toggle → `selectableByTeacher`; quieter `enabled`; fallback warning |
| `src/components/workspace/ChatPanel.tsx:209-236` | Modified | Dropdown with hover description; cost comment updated |
| `src/components/workspace/IndicadorConsumo.tsx` | Modified | Qualitative level only for teachers; no USD reveal |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Capture fails and a cover-less resource is published anyway | High | Server-side rejection of `isInGallery: true` with null `screenshotUrl`; publish disabled until the preview has rendered; retriable error, never a silent success |
| Repointing the admin toggle breaks the fallback chain | Med | Both booleans stay controllable; explicit warning when `enabled` is turned off on another engine's `fallbackModelId` |
| Question guidance fights the forced tool choice and the model refuses to build | Med | Guidance is omitted whenever `forzarHerramienta` is set — stated here as an invariant and carried into the spec as a MUST |
| Early-turn questions become an interrogation | Med | Bounded window and bounded question count, decided in design; the model must build once it has enough |
| Demo mode's shared account can hold only one like per resource | Low | Accepted; the shared demo user is one identity by design |
| Gallery ordering cost at scale | Low | 60-row take with `_count`; revisit with a denormalized counter only if measured |
| `npm run check` is the only automated gate | High | Playwright verification of gallery (logged-in and anonymous), publish flow, admin toggles and the selector, in both themes |

## Rollback Plan

Revert the branch and run the down migration: `DROP TABLE "ProjectLike"` and `ALTER TABLE "Project" DROP COLUMN "screenshotAt"`. Because both are additive and nothing else reads them, the pre-change code runs unmodified against the reverted schema. **The only data loss is the likes themselves** — no project, cover, usage or key data is touched. Covers captured after the change survive the rollback; they are ordinary `screenshotUrl` values. Rolling back re-exposes the publish toggle in the creation dialog and the USD figure to teachers, which is the prior behavior, not a regression.

## Dependencies

- No new npm dependencies, no new env vars, no change to `prisma.config.ts` or the generated client's datasource wiring.
- Playwright (already a devDependency) for browser verification; no harness exists yet.

## Success Criteria

- [ ] Publishing a resource always yields a cover; a failed capture leaves the resource unpublished with a retriable error, and the API refuses to publish a project with a null `screenshotUrl`.
- [ ] Publishing is reachable from the workspace; the resource list still shows published state and still un-publishes.
- [ ] The creation dialog no longer offers a publish toggle.
- [ ] A logged-in teacher likes a resource once; a second like removes it; a second teacher's like increases the count; the unique pair holds under a double-click.
- [ ] An anonymous visitor sees the heart and the count, and clicking sends them to login.
- [ ] The gallery lists most-liked first.
- [ ] After AI edits, the cover button reads "Actualizar portada" with a marker noticeable on inspection but not attention-grabbing; pre-existing projects are not all flagged stale on deploy day.
- [ ] On early turns the AI asks about what it does not know; when the teacher explicitly requests a change, it still builds without interrogating.
- [ ] Turning off the admin row toggle hides the engine from teachers while the fallback chain still resolves through it; turning off `enabled` on a fallback target warns first.
- [ ] The teacher's engine selector is a dropdown showing each description on hover.
- [ ] No teacher-facing surface shows a USD figure; `nivelDeConsumo` remains; `/admin` still shows exact USD.
- [ ] Deploy is push-only: webhook → `migrate deploy` → working app, no manual step.
- [ ] `npm run check` and `npm run build` pass; no `bg-white` / `bg-slate-*`; both themes verified.
