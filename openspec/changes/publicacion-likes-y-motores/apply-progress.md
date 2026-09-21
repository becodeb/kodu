# Apply Progress: Publicación, likes y motores

**Status: all 43/43 tasks complete (12/12 phases).** Single batch — no prior
apply-progress existed. `size:exception` delivery strategy, single PR, per
the cached preflight.

## Summary

All 12 phases from `tasks.md` are implemented, checked, and verified with
Playwright against a real dev server + dev DB. `npm run check` is clean.
`npm run build` succeeds. Every one of the 10 e2e scripts (`m1`–`m9` plus
`unidad.ts`) passes in a final clean sequential run, including the two
pre-existing scripts this change was known to break (`m7-demo.ts`,
`m4-costos.ts`) and a **third** pre-existing script the design/tasks audit
missed (`m2-catalogo.ts` — see Deviations).

## Phase-by-phase

### Phase 1 — Schema + Migration (5/5)
- `prisma/schema.prisma`: `Project.screenshotAt DateTime?`, `Project.likes`,
  new `ProjectLike` model, `User.likes` back-relation.
- `prisma/migrations/20260925000000_publicacion_likes_y_motores/migration.sql`
  and `migration_down.sql` hand-written exactly per design §2.1/§2.2.
- `npm run db:generate` run; `npm run db:deploy` applied the migration to the
  working dev DB (`koduedu` on `kodu_db_dev`). Both partial unique indexes
  (`AiModel_un_solo_default`, `User_un_solo_demo`) confirmed intact after
  deploy.

### Phase 2 — Migration Rehearsal (4/4)
Run against a **disposable clone** (`koduedu_rehearsal`, `CREATE DATABASE …
TEMPLATE koduedu`), never against the working dev DB directly. Scripts and
real output are kept under `openspec/changes/publicacion-likes-y-motores/rehearsal/`:
- `01_seed.sql` — the three pre-migration row shapes.
- `02_apply_output.txt` — first apply (`UPDATE 2`) + replay (`UPDATE 0`, all
  statements "already exists, skipping").
- `03_down_output.txt` — rollback: `ProjectLike` dropped, `screenshotAt`
  dropped, seed rows' `screenshotUrl`/`isInGallery` untouched.
- `04_reapply_output.txt` — up → down → up cycle, clean (`UPDATE 2` again).
- `README.md` — narrates the whole rehearsal and its result.

Result: backfill exact (`screenshotAt = updatedAt`), idempotency holds,
rollback loses only `ProjectLike`, up→down→up is clean. The scratch DB was
dropped after the rehearsal; the real `koduedu` dev DB was migrated
separately via `npm run db:deploy`.

### Phase 3 — The Publish Invariant (6/6)
- `src/pages/api/projects/[id].ts`: 422 guard on `isInGallery:true` + null
  `screenshotUrl`, exact message.
- `src/pages/api/projects/[id]/screenshot.ts`: POST writes `screenshotAt`;
  DELETE clears both columns and un-publishes in the same update, returns
  `despublicado`.
- `src/components/workspace/PreviewPanel.tsx`: reworked props
  (`onDespublicar`, `onAntesDePublicar`, `onScreenshot(dataUrl, opciones)`,
  `portadaVieja`); `listo` state from the iframe's `onLoad`; the 15s timeout
  now raises `captureError` instead of silently resetting; the switch is
  `disabled`/`aria-busy` with "Publicando…" during the sequence and never
  moves optimistically.
- `src/components/workspace/Workspace.tsx`: `handleScreenshot` is the single
  writer of the capture→POST→PATCH sequence; `handleDespublicar` added;
  `FichaDialog`'s `onGuardar` no longer carries `isInGallery`.
- `src/components/workspace/FichaDialog.tsx`: publish toggle removed
  entirely — **no second control was added anywhere.**
- Verified by reading, no change: `src/pages/app/index.astro:88-97`.

### Phase 4 — Likes (4/4)
- `src/pages/api/projects/[id]/like.ts` (new): POST/DELETE, `upsert`/
  `deleteMany`, 404 (not 403) on an unpublished project.
- `src/pages/gallery.astro`: `orderBy [{likes:{_count:'desc'}}, {updatedAt:'desc'}]`
  + `_count` + the `likeados` set query.
- `src/components/BotonLike.tsx` (new): heart + count, optimistic with
  rollback, no `aria-pressed` for anonymous visitors.
- Wired into the gallery card's action row, `flex-wrap` + `ml-auto` added.

### Phase 5 — Stale-Cover Affordance (4/4)
- `src/lib/projects.ts`: `TOLERANCIA_PORTADA_MS = 5_000`,
  `portadaDesactualizada()`.
- `src/lib/workspace-types.ts` + `[id].astro`: `portadaVieja` computed and
  passed through.
- `Workspace.tsx`: `portadaVieja` state, flipped by the AI `code` event and
  by manual `onHtmlChange` (both guarded on `screenshotUrl` truthy — a
  deliberate addition beyond the literal design text, see Deviations),
  cleared inside `handleScreenshot`.
- `PreviewPanel.tsx`: button label switches `Sacar`/`Cambiar`/`Actualizar
  portada`; 6px `bg-brand-600` dot + `sr-only` text when stale.

### Phase 6 — Admin Engine Toggles (3/3)
- `ModelosPanel.tsx`: `alternarVisible()` on the existing prominent
  `Interruptor` now writes `selectableByTeacher`; the old `enabled` toggle
  replaced by the quiet `En servicio`/`Fuera de servicio` chip;
  `respaldadosPor()` + `pedirFueraDeServicio()` + the inline confirmation
  strip for the fallback warning.
- Verified by reading: `/api/admin/models/[id].ts` needed no change.

### Phase 7 — Teacher Engine Selector (2/2)
- `src/components/workspace/SelectorDeMotor.tsx` (new): listbox with
  always-visible-on-open descriptions, full keyboard support, outside
  `pointerdown` dismiss.
- `ChatPanel.tsx`: `<fieldset>` segmented group replaced.

### Phase 8 — Price Visibility (2/2)
- `IndicadorConsumo.tsx`: `costUsd` and `formatearCostoUsd` removed; the
  popover collapses to one static line; the "sin precios"/"motor sin costo"
  branches are gone.
- `[id].astro` stops passing `costUsd`.

### Phase 9 — Early-Turn Questioning (2/2)
- `src/lib/ai/prompt.ts`: `PromptContext` gains `turnosPrevios` +
  `herramientaForzada`; `TURNOS_TEMPRANOS`, `PREGUNTAS_TEMPRANAS`,
  `renderPreguntas()`; inserted second in the concatenation, right after
  `BASE_PROMPT`.
- `src/pages/api/chat/stream.ts`: `forzar = pideCambio(message)` hoisted
  above the `buildSystemPrompt` call and reused at the original call site.

### Phase 10 — e2e New Coverage (2/2)
- `e2e/m9-publicacion-y-likes.ts` (new, ~490 lines): all 11 item groups from
  design §14 — API-level 422, UI publish sequencing (network order +
  disabled/busy state), forced capture failure (real `route.abort()` on the
  `html-to-image` CDN request, not a mock), cover-delete un-publish, the
  creation-dialog absence check, like round trip + double-click race,
  most-liked ordering + tiebreak, anonymous behavior, the stale-cover
  marker including the tolerance regression test, the no-`$` popover check,
  and items 6/8/9 repeated in dark theme.
- `e2e/m3-motores.ts` modified with items 12–16: the split
  `selectableByTeacher`/`enabled` controls (with a reload-persistence
  check), the fallback-warning strip (`Cancelar`/`Sacarlo igual`), and the
  new listbox selector driven fully by keyboard and by `page.tap`.

### Phase 11 — e2e Audit (5/5)
- `e2e/m7-demo.ts` fixed: sets `screenshotUrl` via direct `prisma.project.update`
  before the publish PATCH (this fixture never exercises the real capture
  UI).
- `e2e/m4-costos.ts` fixed: 7.b/7.e assert the static line and the absence of
  `US$`/`$`; 7.g re-expressed as "same static line regardless of pricing
  status."
- `e2e/unidad.ts`, the rest of `m4-costos.ts`, `m5-usuarios.ts`,
  `m6-acceso.ts`, `m8-proyectos-ajenos.ts` confirmed unaffected by reading.
- **`e2e/m2-catalogo.ts` was ALSO broken and NOT named in the design/tasks
  audit** — see Deviations. Fixed in this batch.
- All 9 scripts + `unidad.ts` run for real, green, in a final clean
  sequential pass (see Work Unit Evidence below).

### Phase 12 — Cleanup / Final Gates (4/4)
- `npm run check` clean (post `db:generate`).
- `npm run build` succeeds (one pre-existing, unrelated chunk-size warning).
- `rg -n 'bg-white|bg-slate-'` on every touched path: no output.
- Out-of-scope confirmed untouched by reading: no `likeCount` column, no
  like notifications, no "mis favoritos" view, `/api/projects` still
  requires a session (no anonymous likes), no Playwright-based server-side
  capture, `IndicadorConsumo` still exists (token count kept),
  `src/lib/ai/catalogo.ts` byte-identical (`git diff --stat` empty),
  `formatearCostoUsd`/`costoPorProyecto`/`usage.ts`/`/api/admin/models/[id].ts`
  byte-identical.

## npm run check (final, real output)

```
> koduedu@0.1.0 check
> tsc --noEmit
```
(clean, no output — ran repeatedly throughout the batch, always clean after
each phase)

## npm run build (final, real output)

```
> koduedu@0.1.0 build
> prisma generate && astro build
✔ Generated Prisma Client (7.9.1) to ./src/generated/prisma in 283ms
[build] Server built in 2.06s
[build] Complete!
```
(one pre-existing `chunks larger than 500kB` warning, unrelated to this
change)

## Migration rehearsal — result

PASS on all four fronts (backfill, replay/idempotency, rollback, up→down→up).
Full evidence and real command output under `rehearsal/`. Real dev DB
(`koduedu`) migrated separately via `npm run db:deploy`; both partial unique
indexes (`AiModel_un_solo_default`, `User_un_solo_demo`) confirmed intact.

## Playwright — final clean sequential run (real output, all green)

Run in this order, one process each, against `http://localhost:3000` +
the dev DB, after restarting the dev server to pick up the regenerated
Prisma client (see Gotchas):

| Script | Result |
|---|---|
| `e2e/m1-admin-shell.ts` | ✔ all scenarios pass |
| `e2e/m2-catalogo.ts` | ✔ all scenarios pass (incl. the fix — see Deviations) |
| `e2e/m3-motores.ts` | ✔ all scenarios pass, incl. new items 12–16 |
| `e2e/m4-costos.ts` | ✔ all scenarios pass, incl. the rewritten 7.b/7.e/7.g |
| `e2e/m5-usuarios.ts` | ✔ all scenarios pass (unaffected, confirmed) |
| `e2e/m6-acceso.ts` | ✔ all scenarios pass (unaffected, confirmed) |
| `e2e/m7-demo.ts` | ✔ all scenarios pass, incl. the fix — see Deviations |
| `e2e/m8-proyectos-ajenos.ts` | ✔ all scenarios pass (unaffected, confirmed) |
| `e2e/m9-publicacion-y-likes.ts` (new) | ✔ all 11 item groups pass, both themes |
| `e2e/unidad.ts` | ✔ all pure-function tests pass |

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command | `npm run check` — clean, run after every phase |
| Runtime harness | `npx tsx e2e/{m1..m9,unidad}.ts` against the real dev server + dev DB — all 10 green in the final sequential run above |
| Rollback boundary | Every file is additive/modified in isolation; the migration has its own `migration_down.sql` + `prisma migrate resolve --rolled-back`; no destructive change to any file outside this change's file list |

## Deviations from Design (and why)

1. **`FichaDialog.tsx`'s `descripcion` prop and closing paragraph both
   needed rewriting, not just the closing paragraph.** Design/tasks named
   only the closing paragraph (`:111-115`) for the "pestaña Ficha" rewrite.
   Reading the file showed the Modal's `descripcion` prop (line ~35, "Lo
   podés cambiar cuando quieras desde la pestaña Ficha") ALSO used that
   phrase — a leftover from a workspace layout that predates this repo's
   current tab structure (`PreviewPanel` only has "Vista previa"/"Código"
   tabs; there has never been a "Ficha" tab in the code I read). Left as
   originally worded, the new `e2e/m9-publicacion-y-likes.ts` item 5
   assertion (`pestaña Ficha` must be absent from the whole dialog) would
   fail. Fixed both spots to point at "el visor" instead.

2. **`e2e/m2-catalogo.ts` was a third pre-existing script broken by this
   change, undeclared by the design/tasks e2e audit (Phase 11).** Its line
   87 asserted `button[aria-pressed="true"]:has-text("MiniMax M3")` — the
   OLD segmented-button selector shape that Phase 7 replaces with a listbox.
   This is exactly the "undeclared 7th script" class of defect the
   instructions warned about, and the design's own audit (which explicitly
   listed `m2-catalogo.ts` as "only references `selectableByTeacher` as
   fixture data... never touches the cost UI") missed that it ALSO asserts
   the old selector's DOM shape. Fixed: the assertion now checks
   `#selector-motor:has-text("MiniMax M3")` (the new trigger). Re-verified
   green.

3. **`portadaVieja` triggers guarded on `screenshotUrl` truthy, not
   unconditional.** Design §6.1's trigger table says `setPortadaVieja(true)`
   on the AI `code` event and on manual `onHtmlChange`, without an explicit
   guard. Implemented as written, a project with NO cover yet that receives
   an AI edit would flip `portadaVieja` to `true`, and the button-label
   priority (`portadaVieja ? 'Actualizar portada' : screenshotUrl ?
   'Cambiar portada' : 'Sacar portada'`) would then show "Actualizar
   portada" for a resource that was never captured — contradicting the
   spec's own scenario "No cover shows the capture label." Added `if
   (screenshotUrl)` around both `setPortadaVieja(true)` calls in
   `Workspace.tsx` to keep the invariant "stale implies a cover already
   exists" — matching `portadaDesactualizada()`'s own null-is-fresh rule.

4. **`e2e/m3-motores.ts`'s new item-14 (fallback-warning) test corrupted
   shared seed data on first draft — caught and fixed before this batch
   finished, not left in the delivered file.** The test temporarily points
   MiniMax M3's `fallbackModelId` at the test-created engine to trigger the
   warning, then must restore it. My first draft restored it to `null`
   instead of to the ORIGINAL seeded value (MiniMax M2.7's id,
   `…000002`, set by `20260919000000_catalogo_de_motores/migration.sql`).
   This silently broke `e2e/m2-catalogo.ts`'s fallback-chain assertion on
   the very next script run (a real regression, caught only by running the
   full suite in order — a script-level analogue of the "undeclared 7th
   script" class of bug, this time in a script I was actively writing
   rather than a pre-existing one). Fixed: the test now restores the exact
   seeded value, and `limpiarEstado()` also carries the same restoration as
   a safety net in case an assertion throws mid-test. Re-verified: a full
   sequential run of all 10 scripts (including `m2` right after `m3`) is
   green with the fix in place. **This is the strongest argument in this
   batch for why Phase 11.5 ("run all nine scripts for real") cannot be
   skipped even when each script passes in isolation.**

5. **`onAntesDePublicar` prop added to `PreviewPanel`, not named in the
   design's prop list (§3.3).** Design's client sequence (§3.2) requires
   `flushSave()` to run BEFORE the capture request, but `flushSave` is a
   `Workspace`-owned closure and the capture trigger (the publish switch's
   `onChange`) lives inside `PreviewPanel`. The design's file-changes table
   lists only `isInGallery`, `onDespublicar`, `onScreenshot`, `portadaVieja`
   as the new props. Added one more (`onAntesDePublicar: () => Promise<void>`,
   wired to `flushSave` from `Workspace`) as the only way to honor the
   documented sequencing without either duplicating `flushSave` inside
   `PreviewPanel` or moving the switch's markup into `Workspace`.

## Issues Found (informational, not blocking)

- Playwright runs on this machine (Raspberry Pi, per env) show occasional
  transient flakiness under load — a few individual assertions in
  `e2e/m9-publicacion-y-likes.ts` (the anonymous-click redirect, one forced
  capture failure) needed a polling-based URL check instead of
  `waitForURL`, and a couple of timeouts were bumped from 20s to 30–45s.
  These are resource-contention artifacts of running many concurrent
  Chromium contexts on constrained hardware, not application bugs — each
  flake was investigated and, where it pointed to an actual bug (items 3
  above), fixed; the rest reproduced cleanly on retry with no code change.
  The final sequential run recorded in this document is a clean pass of
  all 10 scripts with no retries needed.
- The dev server had to be restarted once mid-batch: it was running since
  before this session with the pre-change Prisma Client loaded in memory,
  and `npm run db:generate` regenerating the client did not get picked up
  by the already-running `astro dev` process (Vite doesn't reload the
  generated Prisma client module on a schema/generate change), causing a
  transient `PrismaClientValidationError` on the new `screenshotAt` field.
  Restarting `npm run dev` resolved it.

## Remaining Tasks

None. 43/43 complete.

## Status

**43/43 tasks complete. Ready for verify.**
