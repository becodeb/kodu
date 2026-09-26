# Simple generation (no prime) and generation that survives a closed tab

## Objective

1. Remove prime mode and every quality toggle that the trials showed does not help. Keep
   the measured best configuration fixed in code. Turn "3 versions" into an opt-in per
   project, allowed by one admin switch.
2. Closing the tab no longer kills a generation. The server finishes it, and the
   browser-side checks run when the teacher comes back.

## Why

- **Trials (`exp/medicion-arnes`, `experimentos/razonamiento/RESULTADOS*.md`):**
  - With the harness, `high` reasoning scores the same as `low`: 6.2 vs 6.3 of 8, over 12
    samples each.
  - `max` doubles cost and time with no gain.
  - Every round ran with `autoReviewForAll`, `deepModeForAll` and `primeEnabled` off
    (`correr-ui.ts` warns when they are on). So the measured best configuration is
    DeepSeek V4.1 Flash `low` plus checklist, self-test, correction and verifier, and none
    of the prime extras.
  - Visual review and versions were never measured.
- **Owner decision (2026-09-26):**
  - Remove prime, "A fondo" and `max`. Prime may come back later with a premium model
    (gpt-6-sol).
  - Versions become opt-in per teacher project, off by default, allowed only when the admin
    switch `versionsForAll` is on.
  - The verifier stays as is (2 merged passes).
- **Tab closed:** `request.signal` is threaded into the provider fetch (`stream.ts` →
   `provider.ts`), so closing the tab aborts the model call. If the tool call had not
  finished, the turn is saved as a silent turn and the resource is lost. The self-test,
  correction and verifier are browser-only and never re-run on reload.

## Scope

### A. Remove prime and the unmeasured toggles

- **Removed code paths:**
  - `AppSettings.primeEnabled`, `autoReviewForAll` and `deepModeForAll`.
  - `User.primeAccess` and `AiModel.primeOnly`.
  - The teacher-facing speed choice ("Rápido"/"A fondo").
  - The in-turn auto-review (T7 `revisarYCorregir`).
  - Visual review (T8, `/api/chat/visual-review`, only reachable through "A fondo").
  - The prime-only engine filtering, and the prime marking in `/admin/usuarios` and
    `/admin/generacion`.
- **Reasoning levels:** `max` is removed from the engine reasoning options. The allowed
  values are none, low and high. Internal fixed overrides stay: checklist none,
  correction low, verifier medium.
- **Migration** (destructive, ordered):
  - Engines with `primeOnly = true` are disabled BEFORE the column is dropped. Otherwise
    they would become visible to everyone.
  - `reasoningEffort = 'max'` becomes `'high'`.
  - Then the columns are dropped.
- **Versions:**
  - `AppSettings.versionsForAll` stays as the only toggle in `/admin/generacion`, meaning
    "teachers may turn on 3 versions in their projects".
  - A per-project opt-in (`Project.versionsEnabled`, default false) is shown to the teacher
    only when the admin switch is on.
- **Demo account:** it keeps its own token cap; it no longer gets anything extra.

### B. Generation survives a closed tab

- The model call is not tied to the client connection. It is cancelled only by an explicit
  stop (`/api/chat/cancel` or the stop button).
- On reload, the existing poll (last message is the teacher's) shows the in-progress turn,
  and then the result.
- A resource that was saved but never went through the browser checks (self-test →
  correction → verifier) gets them when a browser opens the project again. This needs a
  per-turn marker.

## Constraints

- Prisma does not check deleted columns: `tsc` compiles clean and it fails at runtime.
  After dropping columns, grep for every name.
- The engine catalog is cached for 30 s. In e2e, change flags through the admin API.
- Never put a backtick in a comment inside `SCRIPT_CENTINELA`/`SCRIPT_KODU`.
- Migrations must sort after `20261005000000_verificador_motor`. Use `20261006000000_*`
  onwards. Another session may add migrations named `20261010000000_*` or later.
- A deploy restarts the server and kills in-flight generations. That is out of scope;
  document it.

## Configuration

- TDD off (no configuration, no runner). Checks: `npx tsc --noEmit`, `npx tsx
  e2e/<file>.ts`.
- RDD off (global, user decision).
- Branch `feat/generacion-simple-y-reanudable` from local `main` (7903a2d = de45eb0 plus
  a doc commit). Part A gets merged to `main` and pushed as soon as it is green, which
  deploys it, because another session builds on its schema.

## Tasks

- [x] T1: remove prime, speed, auto-review, visual review, `max`, `primeOnly` and
  `primeAccess` (code, UI, admin, migration, tests). Route: delegated writer (many files).
- [x] T2: versions as a per-project opt-in gated by `versionsForAll`. Route: same writer as
  T1 (same files).
- [ ] T3: merge A to `main`, push, verify the deploy. Route: inline.
- [ ] T4: generation not tied to the client connection, explicit cancel, and reload shows
  the turn. Route: delegated writer.
- [ ] T5: browser checks resume on reload for turns that missed them. Route: same writer as
  T4.

## Acceptance criteria

- No "prime", "A fondo", speed selector or visual review is left anywhere in the UI.
  `/admin/generacion` only has the versions switch.
- With the versions switch off, nobody sees versions. With it on, a teacher sees an opt-in
  in their project, off by default.
- Closing the tab mid-generation and reopening it later shows the finished resource. Its
  self-test and verifier then run once.
- The stop button still stops the generation.

## Progress

### T1

Commit `19241be` (`refactor(ai): remove prime mode, speed selector, and unmeasured review features`).

Removed: `AppSettings.primeEnabled`/`autoReviewForAll`/`deepModeForAll`, `User.primeAccess`,
`AiModel.primeOnly`; the teacher-facing speed choice ("Rápido"/"A fondo") and `Speed`
type/`razonamientoEfectivo` in `provider.ts`; T7 in-turn auto-review (`revisarYCorregir` in
`stream.ts`); T8 visual review (`api/chat/visual-review.ts`, the `capturar()` imperative
handle + `PreviewPanelHandle` in `PreviewPanel.tsx`, `AccesoPrimeSwitch.tsx`); `max` from the
reasoning enum (zod schemas + `NIVELES_RAZONAMIENTO`); `catalogo.ts`'s `prime` parameter on
every resolver (`motoresParaDocente`, `normalizarMotor`, `cadenaDeMotores`, `motorPorDefecto`).
`resolverCapacidades` now takes only `settings` and returns `{ puedePedirVersiones }`.
`fingerprintHtml` moved from the deleted `revision-visual.ts` to a new neutral
`src/lib/ai/fingerprint.ts` (still needed by `verificar.ts`/`autocorreccion.ts`/`Workspace.tsx`).
Also deleted `src/lib/ai/revision.ts` (the lint used only by T7's auto-review and T9's
per-version correction, both gone) and `src/lib/client/velocidad.ts`.

Migration `20261006000000_quitar_prime` (hand-written): disables any `primeOnly` engine
before dropping the column, bumps `reasoningEffort = 'max'` to `'high'`, then drops the five
columns. Applied to dev via psql + `prisma migrate resolve --applied` + `prisma generate`.

Deleted test files (only tested removed features): `e2e/t5-modo-prime.ts`,
`e2e/t6-velocidad.ts`, `e2e/t7-revision-automatica.ts`, `e2e/t8-revision-visual.ts`,
`e2e/t10-docente-comun.ts` (its whole premise was "same behavior with prime on vs off"),
`e2e/unidad-revision.ts`, `e2e/unidad-revision-visual.ts` (its `fingerprintHtml` tests were
folded into the module's new home; the policy/validator tests it also held were
visual-review-only and are gone with the feature). Adapted: `e2e/unidad.ts` (dropped the
`resolverVelocidadEfectiva`/`razonamientoEfectivo`/prime-catalog tests, added
`razonamientoNulo` tests), `e2e/m2-catalogo.ts`/`m3-motores.ts`/`selector-y-verificador-opcional.ts`
(catalog resolver signatures), `e2e/t11-autoprueba.ts`/`t12-checklist-pruebas.ts`/
`verificador-editor.ts`/`verificador-endpoint.ts`/`arnes-robustez.ts`/`html-fuera-del-system.ts`
(`fijarSettings` bodies simplified to `{ versionsForAll }`, stale comments/imports fixed).

Evidence: `npx tsc --noEmit` OK. All 9 `unidad*.ts` suites green. Browser suites (dev +
mock, one at a time): `m2-catalogo.ts` — everything up to and including the catalog/selector
checks passed; the later "send a message" step fails on `locator.click()` because
`.fill()` doesn't fire this editor's React `onChange` (documented gotcha; a pre-existing bug
unrelated to this change — confirmed via `git log`, the only prior edit to that file was an
unrelated `hide engine selector` commit, and this test's own signature-fix diff here is two
lines). `m3-motores.ts`, `selector-y-verificador-opcional.ts`, `t11-autoprueba.ts`,
`t12-checklist-pruebas.ts`, `verificador-editor.ts`, `verificador-endpoint.ts`,
`arnes-robustez.ts`, `html-fuera-del-system.ts`, `m1-admin-shell.ts`, `m5-usuarios.ts`: all
green. `npx prisma migrate status`: in sync; the three hand-declared partial indexes
(`AiModel_un_solo_default`, `AiModel_un_solo_verificador`, `User_un_solo_demo`) confirmed
present via `psql \di` both right after the migration and again after the final `prisma
generate`.

Full-text sweep of `src/`: no `prime` (word boundary), no `A fondo`, no `Rápido`, no
"revisión visual" — including a pass through `src/generated/prisma/*` after regenerating
from the cleaned `schema.prisma` doc comments (those historical `odd/tasks/modo-prime.md`
citations lived on schema comments, not just app code).

Decisions taken without asking back: kept `AiPhase`'s `revisando`/`mirando` states removed
(dead once T7/T8 are gone) rather than leaving unreachable UI states; `NIVEL_RESPONSES`'s
`max → high` entry in `provider.ts` left in place as a defensive mapping for any historical
DB value, even though the admin form can no longer produce `max`.

### T2

Commit `dd95d7d` (`feat(projects): versions as a per-project opt-in gated by the admin switch`).

Added `Project.versionsEnabled` (default `false`), migration `20261006100000_versiones_por_proyecto`
(additive, hand-written for the same partial-index reason as every other migration here).
`variantesEfectivas` (unchanged) is now fed `capacidades.puedePedirVersiones && project.versionsEnabled`
in `stream.ts` instead of the old `prime || versionsForAll`. `PATCH /api/projects/:id` accepts
`versionsEnabled` (zod, owner-checked via the existing `findProjectForActor`). The composer's
versions toggle in `Workspace.tsx` now initializes from `props.project.versionsEnabled` and
persists through the same `patchProject` PATCH as everything else in the editor, replacing the
old per-browser `localStorage` toggle (`src/lib/client/versiones.ts` lost
`leerVersionesGuardado`/`guardarVersiones`). The button copy became "Generar 3 versiones por
pedido: cuesta el triple; elegís la que más te guste" (`ChatPanel.tsx`).

Design decision (not explicitly specced, made in-flow): the composer control keeps the
existing `puedePedirVersiones && esRecursoInicial` gate — i.e. it's still hidden once the
project stops being blank, same as before T2. The task text didn't say whether the
now-persistent per-project switch should stay visible after the first turn (so a teacher
could pre-arm it for later); I kept the pre-existing "only while blank" gate rather than
introduce a new always-visible-but-often-inert control, since turning it on after the first
turn would silently do nothing (`variantesEfectivas` still requires `esRecursoInicial`).
`/admin/generacion` copy: "Permitir que los docentes activen 3 versiones en sus proyectos"
with the cost hint, per the task's suggested wording.

Adapted `e2e/t9-varias-versiones.ts`: dropped the two-account (prime/común) split for a
single teacher account; versions are now enabled per-project via a new
`habilitarVersionesEnProyecto` helper (calls the real PATCH) instead of marking the account;
deleted its escena C (A fondo + per-version auto-correction — that capability is gone, not
adapted, since versions no longer run any correction pass); renamed/reworked escena D/E to
test the project-level gate instead of the account-level one. Added
`e2e/t2-versiones-por-proyecto.ts` per the task's required coverage: admin switch off → no
control in the composer and a raw `variants:3` API request still yields exactly 1 model call;
admin switch on → control visible and off by default, turning it on persists
`Project.versionsEnabled` (checked against the DB, not just the DOM) and a normal request then
produces 3 real versions via the mock.

Evidence: `npx tsc --noEmit` OK. `npx tsx e2e/unidad-versiones.ts` OK (unchanged assertions,
only doc-comment citations to the retired `modo-prime.md` doc removed).
`npx tsx e2e/t9-varias-versiones.ts` — all scenes (A, B, D, E, F, G, H, I) green, including
the real-browser scene I (toggle → concurrent 3-way generation → chip selection → survives
reload). `npx tsx e2e/t2-versiones-por-proyecto.ts` — both scenes green. `npx prisma migrate
status` in sync; the three partial indexes confirmed present after this migration too.

Commit split note: T1 and T2 share several files at the line level (`stream.ts`,
`Workspace.tsx`, `workspace-types.ts`, `project/[id].astro`, `projects/[id].ts`,
`schema.prisma`) because removing prime's `puedePedirVersiones` path required immediately
deciding what replaces it. Split by temporarily reverting each file's T2-only hunk, staging
the T1-only state, verifying it compiles and passes `unidad.ts` standalone (via `git stash
push --keep-index`), committing, then restoring the T2 hunks for the second commit — verified
compiling/green both as the T1-only intermediate and as the final combined state.

### Open items

- T3 (merge to `main`, push, verify deploy), T4 (generation survives a closed tab), T5
  (browser checks resume on reload) are not started — out of this writer's scope (T1/T2
  only).
- `m2-catalogo.ts`'s send-a-message step still fails on the pre-existing `.fill()` gotcha;
  not fixed here (out of scope, unrelated to T1/T2, and the catalog logic it's meant to
  exercise already passed earlier in the same run).
- Deploy killing in-flight generations (documented as out of scope in Constraints) still
  applies unchanged.
