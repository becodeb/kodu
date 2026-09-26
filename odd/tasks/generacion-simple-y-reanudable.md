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
- [x] T4: generation not tied to the client connection, explicit cancel, and reload shows
  the turn. Route: delegated writer.
- [x] T5: browser checks resume on reload for turns that missed them. Route: same writer as
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

### T4

Commit `829080f` (`feat(chat): decouple generation from the client connection`).

**Design.** `stream.ts` no longer threads `request.signal` into `pedirA`, the forced
retry, `generarChecklist`, or `generarVersionSecundaria`. Instead, right at the top of the
`ReadableStream`'s `start()`, it creates its own `turnoAbort` (`AbortController`) and
registers it in a new in-memory, per-thread map (`src/lib/ai/turnos-en-curso.ts`,
`registrarTurnoEnCurso`/`cancelarTurnoEnCurso`), keyed by `thread.id` — nothing else in the
app reads or writes that map. `turnoAbort` is fired by exactly two things: `abortarTurno
('timeout')` from a `setTimeout(TURNO_TIMEOUT_MS)` (30 minutes, same window as the client's
existing resume-poll ceiling — documented next to the constant), or `abortarTurno('stop')`
from `/api/chat/cancel` via `cancelarTurnoEnCurso(thread.id)`. `motivoAbortTurno` (set once,
`??=`) is a local flag, not part of the map: it's how the big `finally` (and the
motor-selection catch, for the case nothing had connected yet) tells an explicit stop apart
from every other way a turn can end. On `motivoAbortTurno === 'stop'` both exit points skip
creating their own "assistant" message (still persisting `generatedHtml` if any had already
arrived) and return early — `/api/chat/cancel`'s own "Frenaste este pedido" message is the
only one created, so a stop never leaves two messages. Closing the tab now only stops SSE
delivery (`send()`'s existing `closed` guard); the upstream fetch to the model keeps running
in the same Node process and the `finally` persists exactly like it already did for "docente
cerró la pestaña" before this change (nothing about that persistence logic changed).

`cancel.ts` calls `cancelarTurnoEnCurso(thread.id)` right after resolving `thread` — i.e.
after the existing ownership check (`findProjectForActor` + the thread lookup scoped to that
project), which is what "owner-checked" means here. A `false` return (nothing registered:
turn already finished, or never got far enough to register) is a silent no-op; the route's
existing "Frenaste" bookkeeping is untouched.

**Limits documented, not fixed.** Single-process assumption (design.md, one Coolify
container): the registry is in-memory, so a deploy/restart during a turn loses the
registration *and* kills the in-flight fetch to the model — the client's existing 30-minute
resume-poll then times out on its own and the teacher can resend. Concurrency: `stream.ts`
still has no guard against two turns starting on the same thread near-simultaneously (`grep`
confirms no `hayTurnoEnCurso` call there); a second registration for the same `threadId`
simply replaces the first in the map. Not something this task added or was asked to fix —
reported as-is, per the task's own "just report" instruction.

**Mock harness change (for the e2e below).** `e2e/mock-proveedor.ts`'s `LlamadaRegistrada`
gained a `cortadoTemprano` boolean, so a test can assert the SERVER's connection to the
provider was actually cut (not just the browser's connection to kodu). Found and fixed a
real gotcha while wiring it up: attaching `req.on('close', …)` *after* `leerCuerpo(req)` has
already drained the request body silently never fires — Node doesn't reliably re-emit it to
a listener registered that late. The fix attaches the close/finish listeners at the very top
of each handler, before reading the body, and only reads the resulting flag via a getter once
the `LlamadaRegistrada` is pushed.

**Evidence.** `npx tsc --noEmit` OK, both for this commit's own diff and verified standalone
(temporarily reverted the T5-only hunks in `stream.ts`/`Workspace.tsx` and the T5-only files,
regenerated the Prisma client against the pre-T5 schema, compiled clean, ran `unidad.ts`
green, then restored everything — same split technique as T1/T2's note above, using `/tmp`
copies instead of `git stash`). Full combined-state evidence (this task also exercises T4)
is under T5's evidence below, since the only realistic way to prove "cerrar la pestaña no
frena, y Detener sí" end-to-end needs a real browser closing a real tab.

### T5

Commit `dc9eb40` (`feat(chat): resume browser post-turn checks on reload`).

**Design.** Three new `ChatMessage` columns, additive migration
`20261007000000_chequeos_posteriores` (hand-written, same partial-index reason as every
other migration here): `resultHtmlFingerprint` (the `fingerprintHtml` of what the turn left
as `Project.currentHtml`, set at persist time and refreshed whenever the turn is marked),
`postChecksAt` (when the browser pipeline finished, or was skipped by design — `NULL` only
ever means "still pending"), and `postChecksClaimedAt` (an in-progress claim, for the
two-tabs case). Existing rows are backfilled to a fixed `2026-10-07T00:00:00Z` instant in
`postChecksAt` — a real timestamp, not `NULL` — specifically so they read as "already
resolved" forever; only a row created after this migration can ever be "pending". This one
field flag (`postChecksAt IS NULL` vs. not) deliberately does double duty for both "legacy"
and "done": they behave identically (never touch it again), so there was no need for a
separate legacy marker.

The decision itself is one pure function, `decidirResumenChequeosPosteriores`
(`src/lib/ai/post-checks.ts`, isomorphic, no Prisma/fetch/DOM — same pattern as
`versiones.ts`): given a candidate message's three fields, the current HTML's fingerprint,
and an injected "now", it returns `correr` or `saltar` with a reason. Order matters: a set
`postChecksAt` wins over everything (skip, unconditionally); then a fingerprint mismatch
(the docente hand-edited the code, or a newer turn already replaced it) also skips; only
then does the claim's age matter (`POST_CHECKS_CLAIM_STALE_MS` = 5 minutes — comfortably
above what the real pipeline can take, well under the 30-minute turn timeout from T4, so
another tab can take over a crashed one's claim without waiting anywhere near that long).

`src/lib/ai/post-checks-db.ts` (server-only) wraps that decision with Prisma:
`pendienteChequeosPosteriores(projectId)` finds the newest non-undone assistant message with
a snapshot (same "changed the HTML" signal `canUndo` already uses) across any thread of the
project, evaluates the pure function against `Project.currentHtml`'s live fingerprint, and
returns `{messageId, fingerprint, htmlAntes}` (the `ProjectSnapshot.html` before that turn,
so the client can decide the verifier's `tipo` the same way a live turn does) or `null`.
`reclamarChequeosPosteriores` re-derives that same pendiente candidate from scratch (never
trusts a client-supplied messageId's own eligibility) and only then issues one conditional
`updateMany` (`postChecksAt: null AND (postChecksClaimedAt: null OR < staleness limit)`) —
Postgres serializes two concurrent claims on the same row, so the second one's `WHERE`
re-evaluates against the just-committed claim and affects 0 rows: no explicit transaction
needed. `marcarChequeosPosteriores` is the completion half, gated by the same
staleness-against-current-html check every other discreet endpoint here already uses
(`autocorreccion.ts`/`verificar.ts`).

One small owner-checked endpoint, `POST /api/chat/post-checks` (`{action: 'claim'|'complete'}`),
is the only new HTTP surface. `stream.ts` calls `marcarChequeosPosteriores` directly (in
process) for a versions turn, right after its snapshot, because T2/T9 skip the self-test
pipeline for that turn *by design* — without this, a "3 versions" turn's HTML-changing
message would sit "pending" forever and get offered to the very next tab that opens the
project. Every other HTML-changing message gets its `resultHtmlFingerprint` set at create
time regardless of whether it turns out to need checks.

Client side: `pendienteChequeosPosteriores` is computed by `project/[id].astro` (initial
load) and by `GET /api/projects/:id/threads` (the same endpoint the existing "retomar un
turno" poll already calls — a turn that just finished resuming can *also* be the one that
needs this). `Workspace.tsx` keeps it in one small piece of state (`pendingPostChecks`),
gated to fire only once the last message in `messages` is no longer the docente's — reading
`messages` instead of `isStreaming` avoids a same-render ordering race against the resume
effect that also runs on mount. It claims via the endpoint, and only on `claimed: true` runs
`ejecutarAutopruebaYCorreccion` then `iniciarVerificacion` — the *exact* two functions a
normal turn already calls, not a reimplementation — then calls `complete`. A normal turn now
also calls `complete` right after its own `ejecutarAutopruebaYCorreccion` (for the
non-versions branch), so a freshly-generated-and-checked turn never shows up as "pending"
again on the next load.

**Decision taken without asking back:** if the docente starts a brand-new turn while a
resumed pipeline is still running in the background (composer stays enabled throughout,
mirroring how `iniciarVerificacion` already runs non-blocking after a normal turn), the new
`handleSend` aborts whatever `abortador.current` was already holding before creating its own
— one line, added at the very top of `handleSend`. This mirrors "cancel it exactly as
today's post-turn pipeline gets cancelled" for the *self-test* half of the resumed pipeline
(the verifier half was already covered by the existing `cancelarVerificacion()` calls).
Scope was kept to exactly that one call site; `handleUndo` and thread-switching don't touch
`abortador.current` today either, so extending this further would be new behavior the task
didn't ask for.

**Old resources aren't retested:** covered by the migration backfill above, not by extra
application logic — the eligibility check is the same one regardless of a row's age.

**Evidence.** `npx tsc --noEmit` OK on the full combined T4+T5 state. All 10
`e2e/unidad*.ts` suites green, including the new `unidad-post-checks.ts` (8 cases: the 6
the task named, plus two boundary cases — the claim-staleness comparison is `<`, so an edge
exactly at `POST_CHECKS_CLAIM_STALE_MS` counts as stale/runnable, documented in the test).
`npx prisma migrate status` in sync; the three partial indexes
(`AiModel_un_solo_default`/`AiModel_un_solo_verificador`/`User_un_solo_demo`) confirmed
present via `psql \di` after this migration.

New browser suite `e2e/generacion-reanudable.ts` (dev server + mock, one at a time), all
green:
- **A** — start a generation, close the page once `tool_start` fires (mid-stream, chunked
  slow on purpose), wait: exactly one assistant message, `currentHtml` is the mock's full
  HTML (not a partial), at least one `TokenUsage` row — proving the server finished the turn
  with nobody's tab open.
- **B** — reopen a project with a turn still in flight (closed the same way as A): the
  reopened tab shows "Pensando cómo resolverlo" first, then the finished resource; the
  resumed self-test/checklist then runs on its own ("Esto es lo que probé" appears,
  `postChecksAt` gets set); reopening a *third* time issues zero `claim` requests.
- **C** — "Detener" mid-stream: exactly one assistant message with the unchanged "Frenaste
  este pedido" text, and the mock's own `cortadoTemprano` flag confirms the server-to-provider
  connection was actually cut, not just the browser-to-server one.
- **D** — a turn generated without ever opening the editor (so it's missed its checks), then
  two tabs opened on that project near-simultaneously: exactly one of the two `claim`
  responses across both tabs comes back `claimed: true`.

Re-ran the full list the task named plus the ones that touch `/api/chat/cancel` or the
resume poll: `t11-autoprueba`, `t12-checklist-pruebas`, `t9-varias-versiones` (twice),
`t2-versiones-por-proyecto`, `verificador-editor`, `verificador-endpoint`,
`selector-y-verificador-opcional`, `m8-proyectos-ajenos` (the only other suite that calls
`/api/chat/cancel`) — all green.

**Known flake, investigated, not attributable to this change:** `t2-versiones-por-proyecto.ts`
failed intermittently across repeated runs (~1 in 3–4), always on an assertion about a
versions turn's chip count or `currentHtml` right after the turn. Traced with temporary debug
logging: the server-side write to `Project.currentHtml` was confirmed correct via an
immediate same-process re-read every time, including on runs where the *test's own*,
separate-process read moments later saw a stale/blank value — with no other logged request
touching that project in between. Reproduced the same intermittent failure after temporarily
reverting `stream.ts`/`cancel.ts` to their pre-T4 state (6/6 passed on one batch, then it
failed again on the very next), so it isn't cleanly bisectable to this change. The Pi was
under real load during this investigation (`uptime` showed load average 3–5, several GB
swapped) while this specific test's mock scripts race on chunk delays as low as 5ms — the
most likely explanation is environmental timing sensitivity, not a regression, but it's
called out honestly rather than swept under "flaky, ignore."

### Open items

- T3 (merge to `main`, push, verify deploy) is not started — out of this writer's scope
  (T4/T5 only).
- `m2-catalogo.ts`'s send-a-message step still fails on the pre-existing `.fill()` gotcha
  (T1's note); still not fixed here, still unrelated to T4/T5.
- `t2-versiones-por-proyecto.ts`'s intermittent flake under load (see T5 evidence above) is
  unresolved — worth a dedicated investigation with the Pi otherwise idle, but inconclusive
  evidence didn't justify guessing at a fix.
- Deploy killing in-flight generations is now explicitly documented (T4's Limits) rather
  than just "out of scope" — still unfixed, by design (single-process assumption, per the
  task).
- No guard was added against two turns starting on the same thread concurrently (T4's
  Limits) — confirmed nothing stopped it before this task either; reported, not changed.
