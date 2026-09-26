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

- [ ] T1: remove prime, speed, auto-review, visual review, `max`, `primeOnly` and
  `primeAccess` (code, UI, admin, migration, tests). Route: delegated writer (many files).
- [ ] T2: versions as a per-project opt-in gated by `versionsForAll`. Route: same writer as
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

(none yet)
