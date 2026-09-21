# Tasks: Publicación, likes y motores

> **Size note**: over the usual tasks-artifact budget, following the precedent of
> `archive/2026-09-19-catalogo-de-proveedores/tasks.md` and this change's own `design.md`.
> Nine independent surfaces share one migration; `npm run check` cannot see almost any of
> this change's behavior; and two pre-existing e2e scripts break under the new invariant
> unless they are explicitly fixed here. Compressing that into a short checklist would
> reproduce the exact "undeclared 7th script" failure the precedent change already paid for.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1500–1700 (migration.sql + down ~180 · schema ~35 · publish/cover API+UI ~305 · likes API+gallery+card ~190 · admin toggles ~70 · selector ~140 · price ~35 · prompt+stream ~60 · e2e new m9 ~350 · e2e m3/m4/m7 fixes ~130) |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR (`size:exception`) |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

Per the cached preflight, `delivery_strategy` is `exception-ok` and the review budget is
unbounded — the maintainer already accepted `size:exception`. Schema, the publish
invariant, likes, and the two e2e fixes are one causal chain (a project without a cover
must be un-publishable from the very same PATCH endpoint `m7-demo.ts` already exercises);
splitting across PR boundaries would leave intermediate PRs failing either `npm run check`
or a real e2e script.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Schema + hand-written migration (up + down) + rehearsal | single PR | `npm run db:generate && npm run check` | Dev-DB rehearsal (Phase 2) — no automated harness | revert branch + hand-run `migration_down.sql` + `prisma migrate resolve --rolled-back` |
| 2 | Publish/cover: server guard, client sequence, control consolidation, stale marker | single PR | `npm run check` | `npx tsx e2e/m9-publicacion-y-likes.ts` (publish scenarios) | revert branch; no migration |
| 3 | Likes: API route, gallery query, `BotonLike` card | single PR | `npm run check` | `npx tsx e2e/m9-publicacion-y-likes.ts` (like scenarios) | revert branch; no migration |
| 4 | Admin engine toggles + fallback warning | single PR | `npm run check` | `npx tsx e2e/m3-motores.ts` | revert branch; no migration |
| 5 | Teacher engine selector (listbox) | single PR | `npm run check` | `npx tsx e2e/m3-motores.ts` (selector step) | revert branch; no migration |
| 6 | Price visibility (`IndicadorConsumo`) | single PR | `npm run check` | `npx tsx e2e/m4-costos.ts` | revert branch; no migration |
| 7 | AI prompt: turn signal + collision rule | single PR | `npm run check` | Manual chat transcript check (no harness for `stream.ts`) | revert branch; no migration |
| 8 | e2e audit: fix `m7-demo.ts`, `m4-costos.ts`; confirm `m2/m5/m6/m8/unidad.ts` unaffected | single PR | N/A — the scripts are the test command | `npx tsx e2e/{m2,m3,m4,m5,m6,m7,m8}.ts && npx tsx e2e/unidad.ts` | revert branch; no migration |

---

## Phase 1: Schema + Migration

- [x] 1.1 `prisma/schema.prisma`: add `Project.screenshotAt DateTime?` and `Project.likes ProjectLike[]`; new `ProjectLike` model (`id`, `userId`→`User` `onDelete: Cascade`, `projectId`→`Project` `onDelete: Cascade`, `createdAt`, `@@unique([userId, projectId])`, `@@index([projectId])`); `User` gains `likes ProjectLike[]`. *Ref: design §1; spec `resource-publishing` "Cover schema changes are additive and unattended"; spec `gallery-likes` "One like per teacher per resource", "Likes schema migration is additive and unattended".*
- [x] 1.2 Hand-write `prisma/migrations/20260925000000_publicacion_likes_y_motores/migration.sql` exactly per design §2.1, in order: `CREATE TABLE IF NOT EXISTS "ProjectLike"` → unique index on `(userId, projectId)` → index on `projectId` → guarded `DO $$ … pg_constraint` FK block (both `Cascade`) → `ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "screenshotAt"` → the backfill `UPDATE … WHERE "screenshotUrl" IS NOT NULL AND "screenshotAt" IS NULL`. Open with the Spanish WHY comment block from §2.1, including the explicit note that no row is ever un-published by this migration. *Ref: design §2.1; spec `resource-publishing` "Pre-existing published-but-coverless rows are not retroactively affected".*
- [x] 1.3 Write `migration_down.sql` per design §2.2: drop FKs, drop both indexes, `DROP TABLE IF EXISTS "ProjectLike"`, `DROP COLUMN IF EXISTS "screenshotAt"`. No `BEGIN/COMMIT` wrapper — nothing here can abort mid-way. *Ref: design §2.2.*
- [x] 1.4 `npm run db:generate` — confirm `src/generated/prisma` exposes `ProjectLike` and `Project.screenshotAt`. Required checkpoint before `npm run check` can compile any later phase.
- [x] 1.5 Register on the working dev DB: `npm run db:deploy` on a fresh DB, or `npx prisma migrate resolve --applied 20260925000000_publicacion_likes_y_motores` where already applied by hand. **Never `prisma migrate dev`** — it would drop the partial indexes `AiModel_un_solo_default` / `User_un_solo_demo`, which it cannot express. *Ref: design "Prisma wiring", "Migration / Rollout".*

## Phase 2: Migration Rehearsal (dev-DB proof — no automated harness)

**This is the change's only proof the backfill and idempotency hold.** Do this against a
disposable/scratch dev DB before treating Phase 1 as done.

- [x] 2.1 Seed three `Project` row shapes pre-migration: (a) `screenshotUrl` set + `isInGallery: true`, (b) `screenshotUrl` set + `isInGallery: false`, (c) `screenshotUrl: null` + `isInGallery: true` (the pre-existing coverless-published case). *Ref: design §2.1 backfill comment; spec `resource-publishing` "Pre-existing published-but-coverless rows are not retroactively affected".*
- [x] 2.2 Apply `20260925000000_publicacion_likes_y_motores` (`npm run db:deploy` or `psql -f migration.sql`) and assert: every row with `screenshotUrl IS NOT NULL` now has `screenshotAt = updatedAt` exactly; row (c)'s `isInGallery` is unchanged (`true`); `ProjectLike` exists with both indexes and both FKs. *Ref: design §2.3; spec `resource-publishing` "Migration and backfill run unattended on deploy", "Pre-existing covers are not flagged stale on deploy day".*
- [x] 2.3 Replay proof: run `migration.sql` a second time by hand against the already-migrated DB — must complete with no error (every statement is guarded). Then run `migration_down.sql`, then `migration.sql` again — must also complete cleanly. *Ref: design §2.3 idempotency table.*
- [x] 2.4 Rollback proof: with rows from 2.1 present, run `migration_down.sql`; assert `ProjectLike` is gone and `screenshotAt` column is gone, and every `Project.screenshotUrl`/`isInGallery` value from 2.1 is untouched. *Ref: design §2.2; proposal "Rollback Plan".*

## Phase 3: The Publish Invariant

- [x] 3.1 `src/pages/api/projects/[id].ts`: add the 422 guard — `isInGallery: true` with a null `project.screenshotUrl` returns `fail('Para publicar hace falta una portada. Sacá una captura del recurso y volvé a intentar.', 422)`; `isInGallery: false` is never blocked. *Ref: design §3.1; spec `resource-publishing` "No published resource without a cover, enforced server-side" — scenario "Direct API call with no stored cover is rejected".*
- [x] 3.2 `src/pages/api/projects/[id]/screenshot.ts`: POST writes `data: { screenshotUrl: stored.url, screenshotAt: new Date() }`. DELETE becomes the mirror rule — `data: { screenshotUrl: null, screenshotAt: null, isInGallery: false }`, response `ok({ screenshotUrl: null, despublicado: project.isInGallery })`. *Ref: design §3.1 — the second door to the same broken state.*
- [x] 3.3 `src/components/workspace/PreviewPanel.tsx`: props become `isInGallery`, `onDespublicar`, `onScreenshot(dataUrl, { publicar? })`, `portadaVieja`; add the `listo` state from the iframe's `onLoad`; publish button `disabled` until `listo`; the 15 s capture timeout (`:73`) now raises a retriable `captureError` instead of failing silently; the switch is `disabled`/`aria-busy="true"` with text `Publicando…` while the sequence runs and never moves optimistically. *Ref: design §3.2, §3.3; spec `resource-publishing` "Capture fails or the preview has not rendered".*
- [x] 3.4 `src/components/workspace/Workspace.tsx`: `handleScreenshot` becomes the single writer of the capture-then-publish sequence per design §3.3 (`flushSave()` → capture → POST screenshot → PATCH `isInGallery: true` only when `opciones?.publicar`); add `onDespublicar` (one PATCH, no capture, unchanged from today); drop `setIsInGallery(datos.isInGallery)` and `isInGallery` from the `FichaDialog` PATCH body. *Ref: design §3.2, §3.3.*
- [x] 3.5 `src/components/workspace/FichaDialog.tsx`: remove the publish toggle (`:85-92`), the `isInGallery` state (`:27`), the field from the `onGuardar` payload type (`:18`) and its value (`:45`); rewrite the closing paragraph (`:111-115`) to point at the workspace instead of a "pestaña Ficha" that no longer exists. **Do not add a second publish control anywhere** — the only control is the one from 3.3. *Ref: design §3.3; spec `resource-publishing` "Publishing lives in the workspace, not the creation dialog".*
- [x] 3.6 Verify by reading, no code change: `src/pages/app/index.astro:88-97` still reads `project.isInGallery` and its un-publish action is never blocked by 3.1. *Ref: design §3.3.*

## Phase 4: Likes

- [x] 4.1 Create `src/pages/api/projects/[id]/like.ts`: `recursoPublicado()` gate (authz is `isInGallery: true`, not project ownership); `POST` = `upsert` on `userId_projectId` (idempotent, no error on a second click); `DELETE` = `deleteMany` (idempotent, no P2025); both return `{ liked, likes: count }`; both 404 (not 403) when the project isn't published. No CSRF token needed — the global origin check already covers `/api/projects`. *Ref: design §4.1; spec `gallery-likes` "One like per teacher per resource", "Teacher likes a resource", "Teacher unlikes a resource", "Double-like from a double-click is not double-counted".*
- [x] 4.2 `src/pages/gallery.astro`: query becomes `orderBy: [{ likes: { _count: 'desc' } }, { updatedAt: 'desc' }]`, `select` gains `_count: { select: { likes: true } }`; add the second named query for `likeados` (`projectId IN (…)` for the current user, skipped entirely when anonymous). *Ref: design §4.2; spec `gallery-likes` "Gallery lists most-liked first".*
- [x] 4.3 Create `src/components/BotonLike.tsx` per design §5: heart + count, filled/red when liked, `aria-pressed` only when logged in, anonymous click → `/login?next=%2Fgallery`, optimistic update with rollback and an inline error span on failure. *Ref: design §5; spec `gallery-likes` "Anonymous visitors see the count but cannot like".*
- [x] 4.4 Wire `<BotonLike>` into `gallery.astro`'s action row at the start (bottom-left); add `flex-wrap` to the row and `ml-auto` on the CTA so three controls don't overflow at `lg:grid-cols-3`. *Ref: design §5.*

## Phase 5: Stale-Cover Affordance

- [x] 5.1 `src/lib/projects.ts`: add `TOLERANCIA_PORTADA_MS = 5_000` and `portadaDesactualizada(screenshotAt, updatedAt)` — `null` screenshotAt is always fresh; stale only when `updatedAt - screenshotAt > 5000ms`. *Ref: design §6.1; spec `resource-publishing` "Cover freshness is visible and its marker is subtle".*
- [x] 5.2 `src/lib/workspace-types.ts`: `WorkspaceProject` gains `portadaVieja: boolean`. `src/pages/app/project/[id].astro`: compute it via 5.1 and pass it through to `Workspace`.
- [x] 5.3 `src/components/workspace/Workspace.tsx`: `portadaVieja` `useState` seeded from the SSR value; `setPortadaVieja(true)` on an AI code event and on a manual HTML edit; `setPortadaVieja(false)` inside `handleScreenshot` once a cover is stored. *Ref: design §6.1 trigger table.*
- [x] 5.4 `src/components/workspace/PreviewPanel.tsx`: button label `Sacar portada` / `Cambiar portada` / `Actualizar portada` per `screenshotUrl`/`portadaVieja`; the 6px `bg-brand-600` dot + `sr-only` text only when stale; no banner, no modal, no color change on the button itself. *Ref: design §6.2; spec `resource-publishing` scenarios "Stale cover after an AI edit", "Fresh cover shows the ordinary label", "No cover shows the capture label".*

## Phase 6: Admin Engine Toggles

- [x] 6.1 `src/components/admin/ModelosPanel.tsx`: add `alternarVisible()` writing `selectableByTeacher` on the existing prominent `Interruptor` (same optimistic pattern as `toggleEnabled`); replace the `enabled` control with a quiet chip (`En servicio` / `Fuera de servicio`), filled only when **off**. *Ref: design §7; spec `ai-model-catalog` "Ordering, enable/disable, and teacher visibility are distinct controls".*
- [x] 6.2 Add `respaldadosPor(id)` — a filter over the already-loaded `motores` state, no new query. `pedirFueraDeServicio` fires the PATCH directly unless turning `enabled` off strands a fallback target, in which case it sets `confirmando` and renders the inline warning strip (`Sacarlo igual` / `Cancelar`), no modal. *Ref: design §7.1; spec `ai-model-catalog` "Disabling a fallback target warns first".*
- [x] 6.3 Verify by reading, no code change: `/api/admin/models/[id].ts:33,83` already accepts and applies `selectableByTeacher`; `selectableByTeacher` toggling needs no warning because `cadenaDeMotores()` never reads it. *Ref: design §7, §7.1.*

## Phase 7: Teacher Engine Selector

- [x] 7.1 Create `src/components/workspace/SelectorDeMotor.tsx` per design §8: `<button aria-haspopup="listbox">` trigger showing the selected `displayName` + description underneath (closed state, unchanged from today); `<ul role="listbox">` with `<li role="option">` showing description as always-visible text, never a `title` attribute; full keyboard support (`Enter`/`Space`/`ArrowUp`/`ArrowDown`/`Home`/`End`/`Escape`/`Tab`); dismiss on outside `pointerdown`. *Ref: design §8; spec `ai-model-catalog` "Teacher-facing selector is a dropdown with hover description".*
- [x] 7.2 `src/components/workspace/ChatPanel.tsx`: replace the `<fieldset>` segmented group (`:212-236`) with `<SelectorDeMotor>`, same `onModelChange` contract; rewrite the comment at `:209-211` (it currently justifies the cost warning that Phase 8 removes). *Ref: design §8.*

## Phase 8: Price Visibility

- [x] 8.1 `src/components/workspace/IndicadorConsumo.tsx`: remove `costUsd` from `IndicadorConsumoProps` and the `import { formatearCostoUsd }`; collapse the `detalle` IIFE to one static line (`Es cuánto texto procesó la IA en este recurso.`); the "sin precios registrados" and "motor sin costo" popover branches are deleted entirely — there is no price-conditional copy left for teachers. *Ref: design §9; spec `ai-cost-accounting` "Teacher-facing cost indicator", "No interaction reveals a dollar amount to a teacher".*
- [x] 8.2 `src/pages/app/project/[id].astro`: stop passing `costUsd` to `IndicadorConsumo`. Verify by reading, no code change: `formatearCostoUsd` stays exported (admin's `formatearCostoAdminUsd` still calls it); `costoPorProyecto`/`costoTotalDeUsuario`/`consumoPorUsuario`/`consumoDiarioDeUsuario` are unchanged. *Ref: design §9.*

## Phase 9: Early-Turn Questioning

- [x] 9.1 `src/lib/ai/prompt.ts`: `PromptContext` gains `turnosPrevios: number` and `herramientaForzada: boolean`; add `TURNOS_TEMPRANOS = 1`, `PREGUNTAS_TEMPRANAS`, and `renderPreguntas(turnosPrevios, herramientaForzada)` returning `''` when `herramientaForzada` or `turnosPrevios > 1`; insert its output **second in the concatenation**, right after `BASE_PROMPT`; update the header comment (`:2-11`) to the new six-step order. *Ref: design §10.1-10.3; spec `ai-authoring-dialogue` "Early turns favor asking over guessing", "Question guidance is omitted when a tool call is forced".*
- [x] 9.2 `src/pages/api/chat/stream.ts`: hoist `forzar = pideCambio(message)` from `:511` to above the `buildSystemPrompt` call at `:415` (pure function, behaviour-preserving); pass `turnosPrevios: history.filter(e => e.role === 'user').length` and `herramientaForzada: forzar` into `buildSystemPrompt`; reuse the hoisted `forzar` at `:518`. `history` is loaded at `:341-346` and excludes the current message. *Ref: design §10.1, §10.3.*

## Phase 10: e2e — New Coverage

- [x] 10.1 Create `e2e/m9-publicacion-y-likes.ts` covering, per design §14, each as its own assertion block: (1) direct `PATCH isInGallery:true` on a coverless project → 422 with the exact message, asserted **at the API, not the UI**; (2) publish through the UI observes `POST /screenshot` before `PATCH`, switch off during, on after; (3) a forced capture failure leaves the switch off and `isInGallery: false` in the DB — the silent-success regression test; (4) deleting the cover un-publishes with the correct notice; (5) the creation dialog has neither `Publicar en la galería institucional` nor `pestaña Ficha`; (6) like round trip incl. double-click race holding the `@@unique`; (7) most-liked-first ordering incl. the `updatedAt` tiebreak; (8) anonymous sees heart+count, unfilled, no `aria-pressed`, click → `/login?next=%2Fgallery`; (9) stale-cover marker appears after an AI edit, clears after a new capture, and — the tolerance regression test — a reload immediately after a fresh capture is **not** flagged stale; (10) the consumption popover contains `tokens` and matches neither `US$` nor `$`; (11) items 6, 8, 9 repeated in dark theme. *Ref: design §14; spec files `resource-publishing`, `gallery-likes`, `ai-cost-accounting`.*
- [x] 10.2 Modify `e2e/m3-motores.ts` adding, per design §14: (12) the row toggle writes `selectableByTeacher` while `aiModel.enabled` stays `true` in the DB; (13) the `En servicio` chip PATCHes `{ enabled: false }`; (14) the fallback warning names the dependent engine, `Cancelar` sends no PATCH, `Sacarlo igual` does; (15) `selectableByTeacher: false` + `enabled: true` survives a reload; (16) the selector is `role="listbox"` with descriptions as text, driven fully by keyboard (`ArrowDown`/`Enter`/`Escape`) and repeated with `page.tap`. *Ref: design §14; spec `ai-model-catalog`.*

## Phase 11: e2e Audit — Existing Scripts

Every script under `e2e/` was checked against every surface this change touches
(`isInGallery`, `screenshotUrl`, `costUsd`/`IndicadorConsumo`, `selectableByTeacher`,
`ChatPanel`, `gallery`). Findings:

- [x] 11.1 **Fix `e2e/m7-demo.ts` — confirmed broken by this change.** Its step 5 (`:405-415`) PATCHes `isInGallery: true` on a project created at `:361` and never given a `screenshotUrl`. Under the new 422 guard (Phase 3.1) this PATCH now fails. Fix: set `screenshotUrl` (direct `prisma.project.update`, since this fixture never exercises the real capture UI) before the publish PATCH, and assert 200 as it does today. *This is the "undeclared 7th script" class of defect the previous change paid for — do not skip it.*
- [x] 11.2 **Fix `e2e/m4-costos.ts` — confirmed broken by this change.** Steps 7.b (`:299-305`), 7.e (`:324-331`), and 7.g (`:340-352`) assert the popover contains `US$` and/or the "sin precios"/free-engine copy. Phase 8.1 deletes all of that copy. Rewrite: 7.b/7.e assert the popover's static line instead (no `US$`, no `$`); 7.g's "motor sin precio" scenario is re-expressed as "the popover reads the same static line regardless of pricing status" — the price-conditional message no longer exists to test.
- [x] 11.3 Confirm, no code change needed: `e2e/unidad.ts` and the rest of `e2e/m4-costos.ts` test `costUsd` at the `TokenUsage`/`costoPorProyecto` data layer, which Phase 8 leaves untouched — these assertions stay green. `e2e/m5-usuarios.ts:179` writes `costUsd` as a fixture value at the same unaffected layer.
- [x] 11.4 Confirm, no code change needed: `e2e/m2-catalogo.ts`, `e2e/m6-acceso.ts`, `e2e/m8-proyectos-ajenos.ts` only reference `selectableByTeacher` as pre-existing fixture data (unchanged field, unchanged meaning-at-the-schema-level) and never touch `isInGallery`, `screenshotUrl`, or the cost UI.
- [x] 11.5 Run all nine scripts for real against the dev server + dev DB: `npx tsx e2e/{m1-admin-shell,m2-catalogo,m3-motores,m4-costos,m5-usuarios,m6-acceso,m7-demo,m8-proyectos-ajenos}.ts` and `npx tsx e2e/unidad.ts`. All green, both themes where the script already covers both.

## Phase 12: Cleanup / Final Gates

- [x] 12.1 `npm run check` clean across the whole repo (post `db:generate`).
- [x] 12.2 `npm run build` succeeds.
- [x] 12.3 `rg -n 'bg-white|bg-slate-' src/` on every touched path — expect no output (only pre-existing doc comments in `global.css`, if any).
- [x] 12.4 Confirm out-of-scope items untouched: no `likeCount` column, no like notifications, no "mis favoritos" view, no anonymous likes, no server-side (Playwright) cover capture, `IndicadorConsumo` not removed entirely, `cadenaDeMotores()` traversal logic byte-identical, `enabled`/`selectableByTeacher` *semantics* unchanged (only their surfacing). *Ref: proposal "Out of Scope".*
