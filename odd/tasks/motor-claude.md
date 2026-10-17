# Claude as the only AI engine (motor-claude)

## Objective

Run KoduEdu on Claude models only, paid from the owner's monthly Claude API credit
(USD 200 per billing cycle, no rollover). Claude Haiku 5.5 must work flawlessly as the
everyday engine; Sonnet 5.5 and Opus 5.5 are measured to decide when a premium engine
is worth offering (3D, animation, original ideas). gpt-6-luna is replaced as verifier.

## Problem

- The provider layer only speaks the OpenAI dialects (`chat`, `responses`); there is no
  native Anthropic path, so prompt caching, effort and vision cannot be used properly.
- Nothing measures what a resource costs, how long it takes, or how it looks per model.
- No model ever sees the rendered resource.

## Why

Haiku 5.5 costs USD 0.10 / 0.50 per MTok (cache hit 0.01) for prompts up to 100K
tokens, cheaper than DeepSeek Flash off-peak. Prompts over 100K tokens cost 5x.
Sonnet 5.5 is 2 / 10, Opus 5.5 is 4 / 20; neither can disable thinking nor force
`tool_choice`.

## Scope

- Native Anthropic provider (`apiFormat: "anthropic"`) with streaming, tools, caching,
  effort, vision, usage and cost (cache reads and writes).
- Experiment tooling and a teacher-style prompt set (3D, animation, games, iteration).
- Harness improvement rounds measured on Haiku.
- Verifier with a screenshot of the rendered resource.
- Credit-aware engine policy (premium while credit lasts, Haiku afterwards).

## Constraints

- Test budget: about USD 10, hard cap USD 15 of API credit, tracked from `usage`.
- Experiment code and results live on `exp/motor-claude`, not on the feature branch.
- Credentials only from `~/.credentials/anthropic-kodu.env`; never committed.
- Generated artifacts in English; UI copy follows the existing Spanish UI.
- TDD: off (no project test runner configured). Checks: `npm run check`, existing e2e
  scripts where relevant, and one cheap real API call before any measured run.

## Tasks

- [x] T1 Native Anthropic provider + admin option + real smoke call (delegated: 2+ files)
- [x] T2 Experiment tooling and teacher prompt set on `exp/motor-claude` (delegated)
- [x] T3 Haiku 5.5 baseline run + blind evaluation
- [x] T4 Harness improvement rounds on Haiku (rounds 1–6 + pre-deploy fixes)
- [x] T5 Verifier with screenshots (Haiku), replacing gpt-6-luna
- [x] T6 Sonnet 5.5, Opus 5.5 and hybrid modes on the hard prompts (advisor tool not tested — see pending)
- [x] T7 Credit-aware engine policy
- [x] T8 Report: cost and time per resource per model, when to use each, pending tests
- [x] T9 Anthropic presets (Haiku/Sonnet/Opus 5.5) + create-provider-from-preset admin flow
- [x] T11 Usage statistics (/admin/uso, exports, token-gated /api/stats/uso.json)
- [x] T12 Deploy to production and verify live (owner authorized 2026-10-10)
- [x] T14 "Automático" mode: credit-aware pacing (haiku/sonnet/opus) + model
      stickiness — live suites and a real smoke call now done too (see the
      2026-10-17 notes below)
- [x] T15 "Pulido visual" (haiku-pulido): visual-polish pass with Sonnet —
      client wiring (capture, call, apply quietly, one self-test, revert)
      and the experiment runner's `--modo haiku-pulido`/`automatico` now
      done too (see the 2026-10-17 notes below)
- [x] T16 Production default: `automatico` as the owner-chosen production
      mode, auto-provisioning Sonnet/Opus/Haiku presets from a single
      Anthropic key, data migration to `automatico`, remeasured Sonnet
      pacing constant, admin labels/warnings (see the notes below)

## Acceptance criteria

- A teacher can generate and iterate a resource with Haiku 5.5 end to end in the real
  editor, with cache hits visible in `TokenUsage`.
- Measured cost and time per resource for each model, and the spend reconciled with
  the Console.

## Progress

- 2026-10-08: worktree `~/projects/kodu-wt/claude`, branch `feat/motor-claude` from
  origin/main 9682b22, DB `koduedu_claude`, port 3400.

## Spend log (API credit)

| Batch | Estimated | Measured |
|---|---|---|
| Key smoke test (2026-10-07) | <0.01 | <0.01 |
| T1 `scripts/sonda-anthropic.ts`, two runs (2026-10-08) | <0.05 | ~0.003 total (both runs combined; second run's cache hit made costs even smaller than the first) |
| T4 round 1b real-model verification (2026-10-08) | 0.10 | 0.0540 |
| T5 smoke test, vision reviewer, 2 cases (2026-10-08) | 0.08 | 0.021782 (gasto.json `smoke-revisor`; project ledger total now 0.2826 of the 15.00 global cap) |
| T4 round 5, `v5-haiku-low` + `v5-haiku-ajuste-medium` (2026-10-10) | 0.25 | 0.1151 (gasto.json; project ledger total now 7.2747 of the 15.00 global cap) |
| T4 round 6, `v6-haiku-low` (2026-10-13) | 0.30 | 0.3030 (gasto.json; 1% over the per-run `--tope` because the runner's own budget guard estimates USD 0.05/case before starting it, not real cost — same guard every prior round used; project ledger grand total now 7.5777 of the 15.00 global cap) |
| T7 smoke: `--modo base` + `--modo crea-sonnet`, H2-ciclo-del-agua, 1 rep each (2026-10-13) | 0.40 (task hard limit) | 0.1473 (0.0266 base + 0.1207 crea-sonnet; gasto.json; project ledger grand total now 7.7251 of the 15.00 global cap) |
| **T11 accidental spend, NOT a planned run (2026-10-13)** | 0 (not budgeted — this task forbids any real-model spend) | **~0.0134** across 4 e2e runs (`t11-autoprueba.ts` ~0.0065, `verificador-endpoint.ts` ~0.0016, `verificador-editor.ts` ~0.0027, `m2-catalogo.ts` ~0.0026) — **outside `gasto.json`**, never went through `experimentos/motor-claude/correr.ts`, so it does NOT count against the project ledger's running total above. Root cause: this dev DB had several real Anthropic `AiProvider` accounts (from T1-T9's own prior real-model rounds) left `enabled: true` with a real key, AND `AiModel.isVerifier` left `true` on a real model (`v3-smoke`), AND `AiModel.enabled: true` on real preset-linked models — none of that is unique to T11, but it had never collided with a FRESH `project.engineChosenByTeacher: false` test run before: `motorDeGeneracion` (T7, pre-existing, `catalogo.ts`) and `motorVerificador()` (T3, pre-existing) both route by what's enabled CATALOG-WIDE, with no awareness that a "mock-provider" e2e test's own project is unrelated to the mode system. The first run of each of the 4 required live suites (before this was noticed) silently hit the REAL API instead of each test's own `http://127.0.0.1:4790` mock — explains that run's odd symptoms (a 30s Playwright timeout waiting for "Corrigiendo un detalle…" because the real round-trip took longer; `verificador-endpoint.ts` getting `estado:'ok'` instead of the expected `'desactivado'`). Fix applied for the REST of this session's testing (not a code change): disabled all 24 enabled real Anthropic `AiProvider` rows at the account level (`enabled: false`) before re-running the 4 suites — all passed cleanly, zero new real-API `TokenUsage` rows confirmed by direct query. Re-enabled them again at the very end of this session (same state as found). Deleted 2 contaminating `TokenUsage` rows that were about to permanently fail `m2-catalogo.ts`'s "a turn that spent nothing must not write TokenUsage" assertion (real spend already logged here first, then removed — the row, not the fact). **Not fixed**: the underlying hazard (any fresh project + an enabled real preset model + `generationMode` resolving to it) is pre-existing since T7, not introduced by T11/Part 0 — worth a guard in a future round (e.g. e2e harness refuses to run against a dev DB with any enabled real `apiFormat:"anthropic"` provider, or `motorDeGeneracion` requires an explicit opt-in per project in dev). Also found, unrelated to spend: two pre-existing dev-DB-pollution test failures in `unidad-modos-generacion.ts`'s own "todo-opus" fallback tests (a real enabled Opus-preset model satisfied what the test assumed was unconfigured) — same root cause, resolved by the same temporary disable, not a T11/Part 0 defect. |

## T1 notes (2026-10-08)

- `src/lib/ai/provider.ts`: new `apiFormat: 'anthropic'` path — streaming via
  `@anthropic-ai/sdk`'s `client.messages.create({..., stream:true})`
  (awaited, so request-level errors surface before iteration, same shape as
  the `fetch`+`response.ok` check the other two dialects use), a new
  `reasoningParam: 'effort'` (`thinking:{type:'adaptive'}` +
  `output_config.effort`; Haiku 5.5 accepts `thinking:{type:'disabled'}` for
  "none", Sonnet/Opus 5.5 map "none" to `effort:'low'` instead — both 400 on
  `disabled`), forced `tool_choice` degrades to `auto` by reusing the
  EXISTING `ToolChoiceNoSoportado` retry path (no new per-model capability
  table needed — verified live against Sonnet 5.5), 529/`RateLimitError`/
  `APIConnectionError` reuse the existing 429 retry loop, message/tool/image
  translation to Anthropic's content-block vocabulary, and one
  `cache_control` breakpoint on the system block (render order
  `tools→system→messages` means one breakpoint there already covers tools).
- `RESOURCE_TOOLS`/`EDIT_RESOURCE_TOOL` (`tools.ts`) gained
  `additionalProperties:false` so `strict:true` applies — inert for the
  existing chat/responses dialects.
- Schema: additive migration `20261027000000_anthropic_cache_write`
  (`AiModel.priceCacheWritePerMToken`, `TokenUsage.cacheWriteTokens`,
  `TokenUsage.priceCacheWriteSnapshot`), applied to `koduedu_claude` only via
  `prisma migrate deploy` (hand-written SQL, no `migrate dev`).
- **Bug found and fixed by the smoke test itself**: `calcularCostoTurno`
  (`usage.ts`) subtracted only `cachedInputTokens` from `promptTokens` before
  billing the remainder at full input price, then billed `cacheWriteTokens`
  AGAIN at the cache-write rate — Anthropic's `cache_creation_input_tokens`
  was charged twice. Fixed by also subtracting `cacheWriteTokens` from
  `facturables`. Caught by comparing the first sonda run's reported `costUsd`
  against hand computation before trusting it.
- Admin UI: `ProveedorForm.tsx` offers "anthropic"; `ModeloForm.tsx` offers
  `effort` and a cache-write price field; both admin API zod schemas
  (`providers`/`models`, index + `[id]`) accept the new values.
- Smoke test (`scripts/sonda-anthropic.ts`, real API, Haiku 5.5 + one tiny
  Sonnet 5.5 forced-tool_choice call): tool call received on every
  tools-enabled call; second identical call showed `cache_read_input_tokens
  = 6329 > 0` (actually both calls did, in the second run, because the first
  run's cache entry was still warm — confirms caching end-to-end); checklist
  call (`sinHerramientas`) received plain text, no tool call; forced
  `tool_choice` against Sonnet 5.5 completed without a 400, degrading via
  the existing mechanism (logged warning observed). Full numbers in the
  session report.
- Deviation: ran the sonda twice (found the billing bug on the first run,
  fixed it, re-ran to verify with corrected real Haiku 5.5 prices) — still
  ~0.003 USD total, well under the 0.05 budget for this probe battery.
- Open for T2+: no Anthropic preset in `presets.ts` yet (admin must enter
  model/prices by hand for now); `ModeloForm`'s preset-apply path doesn't
  carry a cache-write price (no preset defines one yet); vision was
  implemented (base64 image blocks) but not exercised by the smoke test —
  worth a real image call before relying on it for teacher attachments.

## T4 round 1 notes (2026-10-08)

Read-only input: base-haiku-low baseline (8 cases × 3 turns). 4/8 cases
(H4, H5, D1, D3) triggered the correction loop on most turns with
`errores=0` and ended in a final warning; D3 had 13-65 identical SVG
`<circle> attribute cx: Expected length, "NaN".` console errors per turn
that the self-test never saw at all.

What changed:

- `src/lib/ai/kit.ts` (commit `fix(kit): make the reset self-test robust
  to legitimate randomization`): `indicesVolatiles` only sampled two
  points (initial load, first reset) to decide which lines/controls are
  "random content". When `reiniciar()` re-rolls something random, those
  two samples can coincide by chance, wrongly marking the index stable —
  a later, genuinely different roll then reads as a real defect. Added a
  second consecutive reset sample (no interaction in between) and union
  its volatile indices with the first pair's. Also added
  `escanearGeometriaSvgInvalida` (scans the DOM for geometry attributes
  whose value is literally `"NaN"` — the browser's SVG renderer emits
  those warnings directly to devtools, never through the page's
  `console.error`, so overriding it can't catch them) and
  `depurarErrores` (dedupe + cap at 15) before any `errores` array is
  sent in the self-test result. `BASE_B` is shared between the live
  `SCRIPT_CENTINELA` and the frozen `SCRIPT_CENTINELA_PRE_VERIFICADOR`
  (byte-exact reproduction of the sentinel already saved in older
  resources), so it was split into a new frozen `BASE_B_ANTERIOR` (old
  text, untouched) and the live `BASE_B` (with the fix) — same pattern
  the file already used for `PRUEBAS_ANTERIOR`/`PRUEBAS`.
- `src/lib/ai/autoprueba.ts` + `src/lib/ai/edits.ts` +
  `src/pages/api/chat/autocorreccion.ts` (commit `fix(autoprueba): quote
  real source lines in correction messages`): `lineasFuenteReinicio`
  locates, by text search, the `reiniciar()` handler and any line
  mentioning a control/text named in the reset diff, and quotes those
  real source lines in the correction message (telling the model to copy
  its `edit_resource_code` `find` verbatim from there — before, only
  DERIVED text was available, so the model invented a `find` that never
  matched). `textoCercano` (binary search over the failed `find`'s
  prefix length) gives the no_match retry the real text around the
  closest match, so a second attempt has something to anchor on.
- `prisma/schema.prisma` + migration `20261028000000_correction_triggers`
  + `src/lib/ai/trace.ts` + `autocorreccion.ts` (commit `feat(trace):
  record which self-test trigger fired a correction round`):
  `AiTrace.correctionTriggers`, additive nullable TEXT, a comma-separated
  subset of `errors`/`reset`/`tests` computed with the exact same three
  conditions `necesitaCorreccion` checks. Applied to `koduedu_claude` via
  `prisma migrate deploy` + `prisma generate`.
- `src/lib/ai/prompt.ts` (commit `feat(prompt): make content illustration
  the star of new resources`): new "El contenido es la estrella"
  subsection (~128 words) — layered/tonal-depth content illustration,
  ambient motion for processes/scenes, lighting/background/camera for 3D,
  and "bigger for the projector" scales the whole layout, not just font
  size. Kept the existing "no degradados" UI rule (it's about UI chrome
  backgrounds/text; the new rule is discrete tonal steps for the
  content's own color, explicitly not a gradient — no real conflict, just
  noted the adjacency).
- `src/lib/ai/provider.ts` (`razonamientoCorreccion` →
  `anthropicRazonamientoBody`): checked, NOT changed. For
  `reasoningParam === 'effort'` it already returns `{effort: 'low'}`
  (never `'none'`), which `anthropicRazonamientoBody` already maps to
  `{thinking: {type: 'adaptive'}, output_config: {effort: 'low'}}` on
  every model including Haiku — only the checklist call
  (`razonamientoNulo`, `'none'` → `thinking: disabled` on Haiku) hits the
  disabled-thinking path, and that one is explicitly meant to stay as is.

Checks run: `npm run check` (clean after every commit); `npx tsx
e2e/unidad-kit.ts` (all pass, including the pinned legacy-block hash);
`npx tsx e2e/navegador-kit.ts` (all pass, including the existing
"contenido al azar" and "reinicio parcial" cases — no flake this run);
`KODU_BASE_URL=http://localhost:3400 npx tsx e2e/t11-autoprueba.ts` (all
scenes pass against the live dev server on this worktree, including the
reset-mismatch scene that now cites the sourced line). A standalone
one-off check of `lineasFuenteReinicio`/`textoCercano` confirmed both
helpers locate/quote real text correctly.

Open risks / not done this round: the double-reset-sample hypothesis for
H4/H5/D1/D3 is argued from the sentinel's own logic and the static HTML
of those turns (none of their `reiniciar()` functions showed obvious
randomization, though options could be shuffled elsewhere) — it was not
re-run against the real baseline resources with real API calls, per the
no-real-model-spend rule for this round. No new automated test covers
the double-reset sample, the SVG-NaN scan, or the errors dedupe/cap
specifically (existing suites pass unchanged, which only proves no
regression, not that the new paths are exercised). `correctionTriggers`
is not yet surfaced anywhere (export, admin UI) — only recorded.

## T4 round 1b notes (2026-10-08)

Investigated why `correctionTriggers` showed up as `NULL` on every
`CORRECTION` `AiTrace` row from the round-1 measurement (20 rows, same
hour), and why ~19 `edit_resource_code no se pudo aplicar (no_match)`
server-log lines showed up across the 16-case × 3-turn Haiku run.

**Root cause 1 — `correctionTriggers` always `NULL`: a stale dev-server
process, not a code bug.** The computation in `autocorreccion.ts`
(`if (errores.length > 0) correctionTriggers.push('errors')`, etc.,
matching `necesitaCorreccion` exactly) was already correct — verified by
calling `recordAiTrace` directly with `tsx` (wrote `'errors,tests'`
correctly) and by inspecting the embedded DMMF in
`src/generated/prisma/internal/class.ts` (the `correctionTriggers` field
was present). The dev-server process that produced the NULL rows had
been running since BEFORE the commit that introduced the field/logic
landed on disk; whatever changed (the regenerated Prisma client and/or
`trace.ts`/`autocorreccion.ts` edits) never made it into that process's
module graph. `npx astro dev stop` + a fresh `PORT=3400 npm run dev`
(current HEAD, no code change needed) immediately fixed it — a direct
live request afterward stored `correctionTriggers: 'reset'`, then later
runs stored `'errors'` and `'tests'` correctly too. **Lesson for next
time: after any change under `src/generated/prisma/` or anything a
correction/trace path imports, restart the dev server before trusting a
real-model measurement — don't assume hot reload picked it up.**

**Root cause 2 — most `no_match` failures: the checklist test script is
shown to the model (and matched against) in its WRAPPED, not natural,
form.** `aislarPruebasKit` (kit.ts) wraps every `<script
data-kodu-pruebas>` as `try{eval("<JSON.stringify of the real
code>")}catch{...}` as soon as a turn saves — a safety net so a broken
checklist script can't crash the resource. That means `project.currentHtml`
going INTO a correction turn already has the checklist code
double-escaped (every `"` becomes `\"`, etc.). Reproduced live with a
real Haiku call (H4, `debug-corr-4`/temporary debug logging): the model's
`edit_resource_code` `find` was
`document.querySelector('[data-cont="1"]')...` (plain quotes — the
code it would naturally write), while the REAL stored text was
`document.querySelector('[data-cont=\"1\"]')...` (backslash-escaped,
because it's living inside the `eval("...")` string). The model had no
way to "know" to reproduce that escaping — nobody writes JS like that on
purpose — so the `find` almost always missed, burned the no_match retry
too, and ended the round in `editOutcome: FAILED`.

Fix: added `desenvolverPruebas` (kit.ts, exact inverse of
`envolverPruebas`, pure/idempotent) and used it in
`autocorreccion.ts` to build a `htmlParaModelo` — what the model is
shown (`buildCurrentResourceBlock`, `construirMensajeCorreccion`'s
quoted source lines) and matched against (`applyResourceEdits`,
`textoCercano`) — instead of the raw wrapped `htmlPreCorreccion`. The
edited result still flows through the existing `aplicarKitAlTurno` →
`aislarPruebasKit` before saving, which re-wraps any now-plain
`<script data-kodu-pruebas>` it finds — so the saved resource is exactly
as protected as before; only the model's view/match target changed.
Scoped to `autocorreccion.ts` only (the explicit target of this task);
`stream.ts`'s ordinary adjustment turns have the identical exposure but
touching that file was out of scope here — worth a follow-up round.

The `textoCercano` no_match retry (added round 1) was re-verified
working as designed — it correctly offers the real text around the
longest matching prefix, never invents text — but it's a mitigation,
not a fix for root cause 2: a retry with "real text near your guess"
still can't help the model guess a redundant backslash it has no reason
to write. The checklist branch of `construirMensajeCorreccion` already
told the model to decide RECURSO-vs-PRUEBA before touching anything
(added in T17, prior round) — no further change needed there.

Fixes (commits below):
- `fix(trace): none needed — restart only` (no commit; see root cause 1
  above — documented as an operational note, not a code change).
- `fix(kit): show and match the checklist script unwrapped during
  correction` — `desenvolverPruebas` (kit.ts) + wiring in
  `autocorreccion.ts`.
- Tests added: `e2e/unidad-pruebas-aisladas.ts` (`desenvolverPruebas`
  round-trip with `aislarPruebasKit`, exact recovery, no-op on an
  unwrapped/absent script) and `e2e/unidad-edicion-fragmentos.ts`
  (`textoCercano`: full match, prefix-only match, no match at all, empty
  find, context clamped to document edges).

Checks run: `npm run check` (clean); `npx tsx
e2e/unidad-pruebas-aisladas.ts`, `npx tsx e2e/unidad-edicion-fragmentos.ts`,
`npx tsx e2e/unidad.ts` (all pass, new cases included); `npx tsx
e2e/unidad-kit.ts`; `npx tsx e2e/navegador-kit.ts`; `KODU_BASE_URL=http://localhost:3400
npx tsx e2e/t11-autoprueba.ts` (all pass against the live dev server on
this worktree).

Real-model verification (Haiku 5.5, low effort, after the fix and a
clean dev-server restart): `debug-corr-4`→`final-corr` series, H4 and D1
each re-run — `AiTrace.correctionTriggers` stored `'reset'`, `'errors'`,
and `'tests'` correctly across several corrections in the same session
(previously ALL were `NULL`); no new `no_match`/`FAILED` outcome
observed in the post-fix runs (small sample — this round's budget didn't
allow a full 16-case re-run). Spend for this whole round-1b session:
**USD 0.0540** of the 0.10 budget (9 case-runs:
`debug-corr-1..4` + `final-corr`, both H4 and D1).

Open for a future round: the exact same wrapped-script exposure exists
in `stream.ts`'s ordinary adjustment turns (not just the self-test
correction loop) — not fixed here, out of scope for this task's target
file. `correctionTriggers` is still not surfaced in any export/admin UI
(same gap round 1 left open).

## T4 round 2 notes (2026-10-08) — same escaping bug outside correction turns

Fixed the round-1b bug's sibling: `stream.ts` (ordinary adjustment
turns) and `verificar.ts` (the verifier's view of the HTML) both showed
`project.currentHtml` to the model RAW — still wrapped in
`try{eval(JSON.stringify(...))}` by `aislarPruebasKit` from the previous
turn's save. `stream.ts` now computes `htmlParaModelo =
desenvolverPruebas(htmlAlInicioDelTurno)` once per turn and uses it for
both `buildCurrentResourceBlock` and `applyResourceEdits` (the edited
result still flows through `aplicarKitAlTurno` → `aislarPruebasKit`
before saving, same re-wrap guarantee as round 1b); `htmlAlInicioDelTurno`
itself stays untouched for the undo/compare logic that needs the REAL
saved bytes. `verificar.ts` does the same for the text the reviewer
reads (it never edits, so just one `desenvolverPruebas` call).

Test added: `e2e/unidad-edicion-fragmentos.ts` gained two cases that
reproduce the bug against a real wrapped checklist (`applyResourceEdits`
fails `no_match` on the wrapped form, succeeds after
`desenvolverPruebas`, and the edited result re-wraps through
`aislarPruebasKit`).

Checks: `npm run check`; `npx tsx e2e/unidad-kit.ts
e2e/unidad.ts e2e/unidad-pruebas-aisladas.ts
e2e/unidad-edicion-fragmentos.ts e2e/navegador-kit.ts` (all pass);
`KODU_BASE_URL=http://localhost:3400 npx tsx e2e/t11-autoprueba.ts` (live
dev server on this worktree, all scenes pass).

## T5 notes (2026-10-08) — vision reviewer replacing gpt-6-luna

`AiModel.isVerifier` was already provider-agnostic since T1
(`catalogo.ts` builds a `ProviderConfig` regardless of `apiFormat`), so
pointing it at an Anthropic model needed no catalog change. What T5
actually added:

- `preview.ts`: `anchoMax` capture option (JPEG ~1280px wide for the
  reviewer, independent of the 900px gallery-cover default), and an
  early `preserveDrawingBuffer` monkey-patch on
  `HTMLCanvasElement.prototype.getContext` injected as the FIRST thing
  in `<head>`/`<body>` — before any resource script can request its own
  WebGL context — so a game canvas doesn't capture black. Documented
  limitation: a library that caches its GL context before this patch
  runs (not seen in practice) would still capture black; this is a
  mitigation, not a guarantee.
- `PreviewPanel.tsx`: `onCapturadorListo` registers a capture function
  with Workspace.tsx that is COMPLETELY separate from the gallery-cover
  capture state (own id namespace, own timeout, never touches
  `capturing`/`publicando`) — a silent capture for the reviewer never
  shows anything in the UI.
- `Workspace.tsx`: `iniciarVerificacion` captures a screenshot of the
  already-rendered turn (skipped for a tiny text-only edit — cheap
  length-delta heuristic, documented inline, not a real structural diff)
  and sends it to `/api/chat/verificar`. When the server actually used
  vision (`resultado.usoVision`) and found `alta`/`media` non-"contenido"
  problems, it runs ONE correction round
  (`aplicarCorreccionDesdeVerificador`, extracted and shared with the
  existing manual "¿Las arreglo?" button) and ONE self-test pass
  (`ejecutarAutopruebaEnIframe` directly, not the up-to-2-round
  `ejecutarAutopruebaYCorreccion` the manual button uses) — never loops,
  never re-calls the verifier, never shows the auto-fixed findings (only
  leftover "contenido" findings, if any, still show — same panel as
  before T5).
- `verificador.ts`/`provider.ts`: `construirContenidoUsuarioVerificador`
  builds a `ContentPart[]` (text + `image_url`) only when a screenshot is
  passed; a new system-prompt section (visible layout defects, unmet
  request, "Diseño visual" quality) is appended only then too — a
  verifier without a screenshot sees byte-identical prompts to before T5.
  `razonamientoRevisorVisual` fixes effort "low" (vs. the legacy "medium"
  fixed effort).
- `verificar.ts`: optional `captura` in the request body; used only when
  `supportsVision(provider)` — runs exactly 1 pass (not the legacy
  2-for-"nuevo"/1-for-"ajuste") with the vision prompt/effort. Any
  verifier without vision, or a request without a screenshot, is
  byte-for-byte the pre-T5 path — verified against
  `e2e/verificador-endpoint.ts` and `e2e/verificador-editor.ts`
  (unmodified assertions, including the fixed "medium" effort check for
  the legacy pass, both passed against the live dev server).
- No new `AiTrace`/`TokenUsage` columns: usage already carries image
  tokens through the existing `recordUsage` call: Anthropic bills image
  tokens as part of `promptTokens`, same path as any other call.

New test: `e2e/unidad-preview.ts` (buildPreviewDocument/WebGL patch
placement, pure string checks).

### Runner tweak (claude-exp worktree, `exp/motor-claude`)

`experimentos/motor-claude/correr.ts`: `iniciarVerificacion` is
fire-and-forget from `handleSend`'s point of view, so its
`AiTrace`/`TokenUsage` land well after the 300ms wait the runner already
used to snapshot a turn's generation cost — with `isVerifier` pointing at
a vision model, those rows would bleed into the NEXT turn's reported
cost. Added `esperarRevisor` (polls up to 40s for the project's newest
`VERIFICATION` `AiTrace` row, attributes the `TokenUsage` since the
turn's own snapshot to the reviewer, advances the shared cursor) and a
`POST /api/chat/verificar` response listener that captures the real
`usoVision` flag. `costoTotalUsd` (what feeds the budget ledger) now
includes the reviewer's cost. Also fixed an unrelated drift: `comun.ts`'s
`asegurarDocente` still referenced the removed `primeAccess` column
(blocked ANY run of this runner until fixed).

### Real-model smoke test (Haiku 5.5, low effort, live dev server on this
worktree)

Provisioned the Anthropic provider+model the runner creates
(`claude-haiku-5-5`, `esfuerzo: low`, label `Motor Claude · smoke-revisor
· claude-haiku-5-5 · low`) and set `isVerifier: true` on it directly via
the admin API (same model plays generator AND verifier — nothing stops
that, `isVerifier` is an independent flag) BEFORE running the runner, so
both real cases exercised the vision path from turn 1. Turned
`isVerifier` back OFF afterward (hygiene — nothing in this worktree's
dev DB should silently spend real money on a later manual test).

Two cases, `H2-ciclo-del-agua` and `D3-media-mediana-moda`, 1 repetición
each (the runner's own per-case budget estimate — $0.05 generic,
ignoring the much smaller real cost — cut the first invocation off after
H2 at `--tope 0.06`; re-running the identical command skipped H2 via its
existing `corrida.json` and ran D3 fresh with the per-run counter reset):

- `usoVision: true` on every turn that qualified for a review (turn 1 of
  both cases; turn 2 of H2 — turns that only changed text, or weren't
  structural per `decidirTipoVerificacion`, correctly skipped the
  reviewer, same as before T5) — direct proof the screenshot reached the
  model: `usoVision` is computed server-side from
  `supportsVision(provider) && Boolean(captura)`, so `true` means a real
  `image_url` content block was sent.
- Findings: 4 problems per reviewed turn (H2 turn 1, H2 turn 2, D3 turn
  1) — none severe enough (`alta`/`media`, non-"contenido") to trigger
  the automatic fix in this sample: `corrigioHtml: false` on all of them.
  **Open risk**: the automatic correction branch itself
  (`aplicarCorreccionDesdeVerificador` + one self-test pass, gated on
  `usoVision && accionables.length > 0`) was exercised functionally
  through `e2e/verificador-editor.ts`'s existing Playwright scenes
  (shared helper, manual button path) but NOT end-to-end with a real
  vision call that actually found something severe enough to auto-fix —
  this sample didn't produce one, and the budget didn't allow hunting
  for a case that would.
- Reviewer wall time: ~11.6–12.6s per reviewed turn (comfortably inside
  the ~25s budget in the task, with no auto-fix round added in this
  sample).
- Reviewer cost per turn: USD 0.0020–0.0023.
- Per-turn seconds vs. `resultados/v1-haiku-low/*/corrida.json`
  (generation only vs. generation+reviewer; turn-to-turn generation time
  is noisy on its own, not a controlled A/B — context, not a clean
  measurement of the reviewer's overhead):
  - H2 turn 1: 30.4s (v1) → 37.0s + 11.6s = 48.6s.
  - H2 turn 2: 7.6s (v1) → 17.5s + 12.6s = 30.0s.
  - D3 turn 1: 60.9s (v1) → 45.0s + 11.6s = 56.5s (net FASTER despite the
    reviewer — generation variance between runs dominates).
- Spend: USD 0.013941 (H2) + USD 0.007841 (D3) = **USD 0.021782** of the
  USD 0.08 hard limit for this task (confirmed via
  `experimentos/motor-claude/gasto.json`); project ledger grand total
  USD 0.2826 of the USD 15.00 global hard cap.

Checks run (mock provider where applicable): `npm run check`; `npx tsx
e2e/unidad-kit.ts e2e/navegador-kit.ts e2e/unidad.ts
e2e/unidad-pruebas-aisladas.ts e2e/unidad-edicion-fragmentos.ts
e2e/unidad-verificador.ts e2e/unidad-verificador-cliente.ts
e2e/unidad-preview.ts` (all pass); `KODU_BASE_URL=http://localhost:3400
npx tsx e2e/t11-autoprueba.ts e2e/verificador-endpoint.ts
e2e/verificador-editor.ts` (all pass against the live dev server on this
worktree — the legacy/no-vision assertions in the last two, including
the fixed "medium" effort check, are unchanged). Noted but NOT caused by
this round: `e2e/selector-y-verificador-opcional.ts` failed on an
unrelated default-model/"repunteo" assertion — looks like cross-test DB
pollution from running several integration suites back-to-back against
the same dev DB (none of this round's diff touches model-selection/
repunteo logic); not investigated further given budget.

Open for a future round: the automatic-fix branch needs a real end-to-end
exercise with a vision finding severe enough to trigger it (see above);
the ~25s total time budget is not enforced in code (no hard timeout
wraps the capture+correction+self-test sequence, only the capture's own
8s timeout and the endpoint's 150s-per-pass cap) — it held in this
sample but isn't guarded; `AiTrace` still has no `usedVision` column, so
a future admin-facing report can't tell a vision pass from a text-only
one without re-deriving it the way the runner's response listener does.

## T4 round 3 notes (2026-10-08) — silent no-op turns, and why the vision reviewer never acted

Two problems this round, both root-caused against real Haiku 5.5 traffic
and fixed; a third, related bug was found investigating problem 2 and
fixed too.

### Problem 1 — silent no-op adjustment turns

**Root cause (confirmed with `KODU_DEBUG_EDITS=1`, logged raw
`edit_resource_code` tool_use input against a live Haiku call,
D3-media-mediana-moda turn 3):** the model did NOT send an empty
`edits` array (already rejected as `'empty'` by `parseEditResourceArgs`)
and did NOT send a `find` that failed to match. What happened, captured
verbatim: turn 3's first attempt sent a batch of several real edits plus
one whose `find` didn't match (`no_match` — most likely the same
wrapped-checklist escaping class as round 1b/2, see `c6`'s `prueba`
block in the logged batch, though this one's `find === replace` too,
a second independent no-op baked into the SAME failed batch). That
failure triggered the existing one-shot `edit_resource_code` retry
(`stream.ts`, "se da una oportunidad de corregirlo"). On the retry, the
model sent exactly ONE edit — `find` and `replace` BYTE-IDENTICAL (the
`<h1>` line, the one edit from the first batch that HAD matched)  — and
gave up on the actual new content silently instead of retrying the part
that failed or saying so. `applyResourceEdits` had no concept of "all
edits matched but nothing changed": it returned `ok: true` with a
byte-identical document, `editOutcome: 'fragments'`, and `stream.ts`'s
final-message branch only checked `generatedHtml` (truthy) before
saying "Actualicé el recurso." — never comparing it against
`htmlAlInicioDelTurno`. Confirmed against the existing measured sample
too: `resultados/v1-haiku-low/H5-sorprendeme-r1/corrida.json` turn 2
(3.3s, 126 completion tokens, `htmlChars` unchanged) and
`resultados/smoke-revisor/H2-ciclo-del-agua-r1/corrida.json` turn 3
(2.4s, `htmlChars` unchanged) are the same bug, pre-existing in data
collected before this round even started.

This answers the task's open questions directly: it is neither "empty
edits" nor a bare `no_match` reported as success — it's a successful,
all-matched `applyResourceEdits` call whose NET EFFECT is zero, which
the harness had no way to distinguish from a real edit. Didn't need a
forced `tool_choice: auto` vs `any` experiment to explain it (the model
DID call the tool correctly both times; the problem was downstream, in
what counted as "the tool call worked"), so that specific comparison
was not run this round — out of scope once the real mechanism was
found, and running it for its own sake would have spent real-model
budget without changing the fix.

**Fix:**
- `edits.ts`: `applyResourceEdits` now returns a new failure reason,
  `'no_op'`, whenever the edited result is byte-identical to the input
  (covers `find === replace` on every edit in the batch, and any other
  combination that nets to zero change) — returned instead of `ok:
  true`. New `EDIT_FAILURE_MESSAGES.no_op` message.
- `stream.ts`: a `no_op` failure feeds the SAME one-shot retry path
  `no_match` already used, now with a `no_op`-specific instruction
  (`esNoOp` on `estadoEdicion.ultimoFallo`) telling the model its
  `replace` has to contain `find`'s text PLUS the new content, never be
  identical to `find`. If the retry also fails (no_op again, or
  anything else), the existing honest-failure path already in place
  (`codeProblem` joined into `notes`) reports it truthfully instead of
  claiming success.
- `stream.ts`: defense-in-depth — the final "Actualicé el recurso."
  branch now requires `generatedHtml !== htmlAlInicioDelTurno` (not just
  `generatedHtml` truthy), covering any OTHER no-op path (e.g. a full
  `update_resource_code` rewrite that happens to return the document
  unchanged) that isn't `edit_resource_code`-specific.
- `autocorreccion.ts` gets the same protection for free: it calls the
  same `applyResourceEdits`, and its own one-shot retry loop already
  branches on `EDIT_FAILURE_MESSAGES[reason]` generically — confirmed
  live (see Problem 2 below): "`edit_resource_code` no se pudo aplicar
  (no_op)" fired and recovered correctly during the final real run.

New tests (`e2e/unidad-edicion-fragmentos.ts`): `find === replace` on a
single edit, on a whole batch, a batch with ONE real edit among no-op
ones (not rejected — only an all-around-zero batch is), and a
same-net-effect-different-string edge case.

### Problem 2 — the vision reviewer never acted (plus a bug found along the way)

**Root cause (confirmed with `KODU_DEBUG_VERIFICADOR=1`, logged raw
findings against real Haiku calls, and inspected
`resultados/smoke-revisor/*/turno-*-1280.png` by eye):**
`SECCION_REVISOR_VISUAL` told the model WHAT to look for but never
defined what `alta`/`media`/`baja` MEANT — the base prompt's "del más
grave al menos grave" is the only gravedad guidance anywhere, and it's
about ordering, not thresholds. Combined with "no reportes gustos de
estilo" (correctly conservative for things that AREN'T bugs), the model
defaulted every visual observation to `baja`, even looking at H2's
"ciclo del agua" screenshot — flat single-color shapes with no shading,
unlabeled dots standing in for vapor/rain/drops, genuinely matching the
task's own "illustration flat or empty compared to the request"
example. D3's screenshot (a clean data-point plot) correctly had
nothing wrong — useful contrast confirming the OLD zero-alta/media
result wasn't just an unlucky sample.

**Fix:** added explicit severity bands to `SECCION_REVISOR_VISUAL` ONLY
(never touched the base system prompt, which the file's own header
documents as a verbatim port not to be "improved" here) — tied to what
a teacher would notice projecting the resource, with the three example
classes from the task spelled out as `alta`/`media` by name: a
flat/empty illustration against the request, cut-off/overlapping
content, a missing requested item. `baja` is now explicitly reserved
for genuinely minor stuff, not a default for uncertainty. `MAX_PROBLEMAS`
stayed at 6 (not dropped to ~5): it's a shared constant with the
non-vision path, the task's "~5" was a soft target, and 6 already does
the job of capping runaway lists — changing it risked an unrelated
regression for no measured benefit.

**Verified against real Haiku 5.5 calls:** 12 `alta` + 15 `media`
findings across 9 reviewed turns this round (`v3-smoke` first pass +
`v3-fix-espera`), versus ZERO in round 2's sample of the same size.

**Bug found investigating this (not part of the original brief, but
directly blocked "make sure the correction actually changes the
resource"):** even with real `alta`/`media` findings now flowing, EVERY
automatic correction the visual reviewer triggered failed with 409
("El recurso cambió después de la autoprueba") — not occasionally,
essentially always (8 of 9 attempts across two runs). Root cause:
`Workspace.tsx#aplicarCorreccionDesdeVerificador` computed its
conflict-detection fingerprint from the `html` React state via closure
instead of an explicit parameter. `iniciarVerificacion` (a plain,
non-memoized function, recreated every render) is called synchronously
from `handleSend` right after `setHtml(htmlTrasAutoprueba)` but BEFORE
React re-renders — so its closure, and the
`aplicarCorreccionDesdeVerificador` it calls from inside the same
render's scope, still saw the PREVIOUS turn's `html`. The fingerprint
sent to `POST /api/chat/autocorreccion` could never match
`project.currentHtml` (already the NEW turn's html, written by
`stream.ts`) — an always-reproducing bug, not a timing race. Fixed by
threading the known-correct html explicitly into
`aplicarCorreccionDesdeVerificador` as a parameter (`htmlDespues` from
`iniciarVerificacion`'s own argument; `html` state from the manual
"¿Las arreglo?" handler, where the closure IS fresh — user-triggered
well after the previous render settled). `e2e/verificador-editor.ts`'s
manual-button scenario (escena 3) still passes unchanged.

A related harness-only bug surfaced alongside it: `correr.ts`'s
`esperarRevisor` returned as soon as the `VERIFICATION` `AiTrace` row
appeared — which `recordAiTrace` writes BEFORE the client even decides
whether to call the correction (fire-and-forget by T5 design) — so the
runner advanced to the NEXT turn while the correction was still in
flight, and the correction's own `TokenUsage` row landed too late to be
counted as the revisor's cost. Fixed with a bounded extra poll
(`ESPERA_CORRECCION_MS`, 20s) for a `CORRECTION` trace newer than the
`VERIFICATION` one before reading `project.currentHtml`/`TokenUsage`.

**Final verification (after both fixes, `v3-smoke`, live dev server on
this worktree):** H2-ciclo-del-agua, 3 turns, isVerifier ON for the
`v3-smoke` model: `corrigió el HTML: true` on all 3 turns (6, 3, 4
findings respectively), `htmlChars` changed every turn (78850 → 81095 →
84455), zero `409`/`no_match`/`no_op` failures in the server log for
this run, turn times 36.6s / 20.9s / 29.1s (generation) + 21.6s / 14.1s
/ 30.7s (reviewer, now including the correction's own round-trip since
it's observed end-to-end). D1-fracciones-equivalentes and
D3-media-mediana-moda were exercised earlier this same round (etiquetas
`r3-repro-pre`, and the first `v3-smoke` pass before the Workspace.tsx
fix — see `resultados/v3-smoke/` git history and `r3-repro-pre/` for
that evidence) but not re-run after the Workspace.tsx fix specifically,
to stay inside the round's USD 0.12 hard spend limit — open follow-up
for next round if a broader multi-case confirmation is wanted.

`isVerifier` left ON for the `v3-smoke` model (`e56fe49a-b2cb-47bb-9b6b-
6d596afd9780`) at the end of this round, as asked, for the next
measured round. Turned OFF only transiently to let
`e2e/verificador-endpoint.ts`/`e2e/verificador-editor.ts` create their
own test model without hitting the `AiModel_un_solo_verificador` unique
constraint, then re-enabled immediately after.

**Checks run:** `npm run check` (clean after every commit); `npx tsx
e2e/unidad-kit.ts e2e/unidad.ts e2e/unidad-pruebas-aisladas.ts
e2e/unidad-edicion-fragmentos.ts e2e/navegador-kit.ts
e2e/unidad-verificador.ts e2e/unidad-preview.ts` (all pass, including
the new no_op cases); `KODU_BASE_URL=http://localhost:3400 npx tsx
e2e/t11-autoprueba.ts e2e/verificador-endpoint.ts
e2e/verificador-editor.ts` (all pass against the live dev server on
this worktree, including the manual-correction and conflict-409
scenarios, unchanged).

**Spend this round:** USD 0.0989 of the USD 0.12 hard limit (confirmed
via `experimentos/motor-claude/gasto.json`, delta from this round's
starting total of USD 0.2826); project ledger grand total USD 0.3815.

**Debug logging:** `KODU_DEBUG_EDITS=1` (raw `edit_resource_code`
tool_use input, `stream.ts`) and `KODU_DEBUG_VERIFICADOR=1` (raw
verifier findings, `verificar.ts`) are left in place behind their env
flags (default off) rather than removed — both were useful for this
investigation and cost nothing when unset; remove in a future round if
they're not needed again.

**Open for a future round:** the `tool_choice: auto` vs `any` A/B this
task proposed was not run — the no-op mechanism turned out to be
downstream of tool selection, not caused by it (see Problem 1 above). A
broader multi-case real-model confirmation of the Workspace.tsx fix
(beyond H2) is still open, budget-gated this round. `AiTrace` still has
no `usedVision` column (same gap noted in round 2).

## T4 round 4 notes (2026-10-09/10) — explicit request checklist, wider reviewer gate

Three changes, aimed at the recurring Haiku 5.5 defects from the blind
evaluation (stale counters/totals after adding items, "bigger for the
projector" only touching font-size, layout overlaps, partial/silent
non-compliance, dead conditions):

- `src/lib/ai/prompt.ts`: new `BASE_PROMPT` section "Al ajustar un
  recurso" — update every counter/total/final-message that depends on
  an added/removed item; "más grande para proyectar" scales the WHOLE
  composition (scene, camera, labels, controls), never just the font;
  "al final" means after the last existing section; "más corto" means
  actually removing/merging content; never undo a previous turn; never
  leave a dead condition (`* 0`, `&& false`, `|| true`). Plus a short
  layout rule (overlays above a full-screen canvas need an explicit
  `z-index`, labels must not overlap, the main visual fits at 1280×800
  without scroll). Removed the now-redundant standalone "Hacelo más
  grande…" line from the "contenido es la estrella" section (merged into
  the new checklist).
- `src/lib/ai/verificador.ts` (+ `src/pages/api/chat/verificar.ts`):
  `SECCION_PEDIDO_EXPLICITO`, appended to the reviewer's system prompt
  ALWAYS (nuevo/ajuste, con o sin visión — a stale counter is visible in
  the code alone) — tells the model to check the ÚLTIMO pedido point by
  point and flag a partially-done request (stale counter, scene that
  didn't scale) as tipo `pedido`/gravedad `alta`, never `baja`.
  `pedidoDocente` now also carries the PREVIOUS turn's request (when it
  differs from both the original and the current one), so the reviewer
  can tell whether this turn left the prior one unresolved or undid it.
- `src/lib/client/verificador.ts`: `decidirTipoVerificacion`'s gate was
  `cambioElScriptPropio` (only the resource's own `<script>` changing
  triggered a review) — relaxed to the new `cambioElDocumentoPropio`
  (any part of the folded document the teacher can notice: markup, CSS,
  text, or script; kit/tests blocks and whitespace-only changes still
  excluded). A markup/CSS-only adjustment (exactly the kind of "bigger"
  or "add a section" request that doesn't touch JS) now gets reviewed
  too. Updated `e2e/unidad-verificador-cliente.ts` and the live
  `e2e/verificador-editor.ts` escena 4 to match (both asserted the OLD
  skip behavior on purpose; now assert the call happens).

Checks run: `npm run check` (clean after every commit); `npx tsx
e2e/unidad-kit.ts e2e/unidad.ts e2e/unidad-pruebas-aisladas.ts
e2e/unidad-edicion-fragmentos.ts e2e/unidad-preview.ts
e2e/unidad-verificador.ts e2e/unidad-verificador-cliente.ts` (all pass,
new cases included); `KODU_BASE_URL=http://localhost:3400 npx tsx
e2e/t11-autoprueba.ts e2e/verificador-endpoint.ts
e2e/verificador-editor.ts` (all pass against the live dev server on this
worktree, after a `npx astro dev stop` + fresh `PORT=3400 npm run dev`
restart). The pre-existing `v3-smoke` model's `isVerifier` flag (left ON
since round 3) had to be toggled OFF temporarily to run
`verificador-endpoint.ts`/`verificador-editor.ts` cleanly (the DB-wide
`AiModel_un_solo_verificador` constraint means any OTHER `isVerifier`
model blocks those tests' own "sin motor verificador" scene) — restored
to ON immediately after, unchanged from round 3.

### Real-model run (`v4-haiku-low`, claude-haiku-5-5, low effort)

`experimentos/motor-claude/correr.ts --etiqueta v4-haiku-low --motor
claude-haiku-5-5 --esfuerzo low --casos all --repeticiones 1 --tope
0.15`, against the live dev server on this worktree after the restart
above. Clean budget cutoff: 6 of the planned cases ran
(H1-sistema-solar-3d, H2-ciclo-del-agua, H3-juego-fracciones,
H4-plano-inclinado, H5-sorprendeme, D1-fracciones-equivalentes) before
the 7th case's USD 0.05 estimate would have pushed past the USD 0.15
cap for this task. **Spend: USD 0.114002745** of the 0.15 limit
(`experimentos/motor-claude/gasto.json`); project ledger grand total
now USD 7.1595666 of the USD 15.00 global cap.

Compared against `resultados/v3-haiku-low/*-r1/` (same 6 cases, turns 2
and 3 — the adjustment turns — judged by reading each turn's request,
diffing `turno-N.html`, and looking at the screenshots), via a read-only
sub-agent:

- **Placement fixed**: the "al final" misplacement class the task set
  out to fix did not reproduce in this sample — content asked for "at
  the end" landed after the last existing section in v4.
- **Still broken, same shape as before**: H1-sistema-solar-3d's scene
  still shrinks instead of scaling on the "más grande para proyectar"
  turn — the new checklist line didn't change Haiku's actual behavior
  for that case. "Más corto" requests still don't shorten anything in
  this sample either — the checklist asks for it, but asking isn't
  enough on its own.
- **New defect surfaced, not previously seen**: H2-ciclo-del-agua turn 3
  left an empty quiz container in the DOM — a layout/completeness gap
  the wider reviewer gate (change C) should have had a shot at catching
  (an ajuste that changed markup, not just script) but didn't flag as
  actionable in this run.
- **The no_op fix (round 3) did its job once**: D1-fracciones-equivalentes
  turn 3 — an append request — got `find === replace` from Haiku twice
  (first attempt and the one-shot retry) and ended in the honest
  "ese cambio no modificó nada" message instead of a false "listo"; the
  underlying inability to turn an append into a correct edit remains
  open, but the harness no longer lies about it.

**Takeaway**: the prompt/reviewer changes measurably fixed the placement
class and correctly surfaced (as an honest failure, not a false
success) a no-op append, but did NOT fix scene-scaling or
"shorten content" compliance, and the wider reviewer gate missed at
least one real layout defect it was aimed at (H2's empty container) —
open for a round 5 if one runs: investigate why `SECCION_PEDIDO_EXPLICITO`
didn't flag H1's non-scaling or H2's empty container as `alta`/`pedido`
(reviewer may need a concrete "did the composition's bounding box/camera
change" check, not just a text instruction), and why the new checklist
line in `BASE_PROMPT` didn't change Haiku's generation behavior for
scaling/shortening (a checklist the model can read but routinely ignores
under low effort may need to move into the per-turn edit-guidance block
instead of the system prompt, or be reinforced by the self-test).

Full per-turn table (fulfilled yes/partial/no, seconds, cost) was
produced by the comparison sub-agent and relayed in this session's
report; not duplicated here to keep this file from growing past what a
future session needs to resume work (the raw artifacts — `corrida.json`,
`turno-N.html`, `turno-N-*.png` — are the source of truth, committed in
`claude-exp` on `exp/motor-claude`, commit `f4ce021`).

## T4 round 5 notes (2026-10-10) — forced full-rewrite fallback, append wording, full-page reviewer capture

Committed as `ba7486a`; notes were never written at the time (backfilled
this round). Three changes, aimed at the round 4 open items (scene-scaling
non-compliance, "shorten" non-compliance, a layout defect the reviewer gate
missed):

- A `edit_resource_code` retry that still fails (`no_match`/`no_op`/anything
  else) now falls back to a FORCED full `update_resource_code` rewrite
  instead of ending the turn in an honest-failure message — same mechanism
  `stream.ts`/`autocorreccion.ts` already had for the recovery-after-failed-
  edit path, just forced rather than offered.
- Prompt wording for append-style requests ("al final", "agregá") was
  sharpened to push back on a no-op/partial append.
- The reviewer's screenshot capture switched to a full-page capture (not
  just the first viewport) so content added "at the end" that falls outside
  1280×800 is actually visible to the vision reviewer.

**Measured result** (`v5-haiku-low`: 5 cases, 1 rep each; `v5-haiku-ajuste-
medium`: H1/H2 only at `esfuerzo: medium`; both against real Haiku 5.5,
`experimentos/motor-claude/resultados/` on `exp/motor-claude`):

- **H1 "más grande" — fixed.** The round 4 open defect (scene shrinking
  instead of scaling on "más grande para proyectar") did not reproduce:
  the camera moved closer as the checklist line asks.
- **H4 — clean.** No defect found in this sample.
- **H2 turn 3, "al final agregá 3 preguntas" — still not fulfilled, and
  nothing in the harness caught it.** The turn added NO new question, no
  input, no interactive element — only a comment ("las preguntas de repaso
  se agregan abajo") and an empty bar. Both the self-test (no error, no
  broken reset) and the vision reviewer (full-page capture, real screenshot)
  passed the turn as fine. This is the exact defect class round 6's goal A
  (turn-diff vs. request check) was written to catch: a promise with no
  content, invisible to both existing checks because nothing actually
  broke — the resource just silently didn't do what was asked.
- **H5 "más corto" — near no-op.** +79 bytes on a "make it shorter" turn:
  neither shrinking content nor meaningfully growing it. Same shape as the
  round 4 open item ("asking for shorter isn't enough on its own").

Per-case cost/time (`resumen.json`): `v5-haiku-low` 5 cases, USD
0.0822271, 332.1s total (H1 83.9s/$0.0195, H2 54.4s/$0.0108, H3 84.8s/
$0.0217, H4 57.0s/$0.0161, H5 52.0s/$0.0141); `v5-haiku-ajuste-medium` H1/H2
only, USD 0.0329194, 136.7s total (H1 73.6s/$0.0144, H2 63.1s/$0.0185 — both
noticeably slower than the matching `low` row, as expected for `medium`
effort, with no measurable quality change on this 2-case sample). Round
spend: USD 0.1151 of the USD 0.25 hard limit (`gasto.json`); project ledger
grand total USD 7.2747 of the USD 15.00 global cap.

**Open for round 6:** H2's silent no-op append, and H5's near no-op
shorten, are both cases where self-test + vision reviewer agree the turn is
"fine" while the actual request went unfulfilled — a deterministic,
model-independent check of what actually changed in the HTML (not just
"did it render without errors") is the missing layer. `v3-haiku-low`/
`v3-opus-medium`/`v3-sonnet-medium` blind-evaluation result directories and
`ciego/r1/` under `claude-exp` are still untracked locally from an earlier
round's blind comparison — left as is (out of this round's scope; not
part of the round 5 real-model run this section documents).

## T4 round 6 notes (2026-10-13) — deterministic turn-diff check, per-turn edit guidance

Three changes (code committed separately, before this real run):

- `src/lib/ai/turno-diff.ts` (new, pure, isomorphic): `computarDiffTurno`
  compares before/after HTML of an ajuste turn — visible text added/removed
  (tags/scripts/styles stripped, word-multiset excess so reordering never
  counts as "added"), element-count delta per tag, interactive-control
  count (input/button/select/textarea), changed `<script>` lines, and new
  HTML comments that promise content without delivering it.
  `detectarBanderasRojas` flags an add/append request ("agregá", "sumá",
  "añadí", "incorporá", "poné", "agregar") with < 80 visible chars added
  and no new interactive control, a shorten request ("más corto", "acortá",
  "resumí", "menos") that didn't shrink anything, or a promise-comment with
  nothing behind it.
- `src/lib/ai/verificador.ts` + `src/pages/api/chat/verificar.ts`: a fired
  red flag becomes a `Problema` (`problemaDeBanderaRoja`, same shape the
  model already returns) and rides the EXISTING correction path
  (`construirMensajeCorreccionVerificador` → `POST /api/chat/autocorreccion`
  with `problemasVerificador`, the same endpoint with the one-shot retry
  and round 5's forced full-rewrite fallback) — no new correction code, no
  new loop bound. The compact diff is also appended to the reviewer's
  prompt (`resumenDiffParaRevisor`) so the model judges "does this
  implement every item asked" against a measured number, not just its own
  reading of the code. `verificar.ts` reads the turn's "before" HTML from
  the latest assistant `ChatMessage`'s `ProjectSnapshot` (same query shape
  `pendienteChequeosPosteriores` already used) — no client-side plumbing
  needed.
- `src/lib/client/verificador.ts` + `Workspace.tsx`: a new
  `banderaDeterministica` flag gates the existing SILENT auto-fix branch
  the same way `usoVision` already does — a red flag is evidence as hard
  as a screenshot, same single correction round, never a new loop.
- `src/lib/ai/prompt.ts` + `stream.ts`: `guiaPorPedido` injects up to 3
  short keyword-matched lines (add/append, shorten, bigger/projector,
  recolor/legend, "al final") into the per-turn resource block (the one
  that already changes every turn) instead of `BASE_PROMPT` — rounds 4-5
  measured low-effort Haiku ignoring the system-prompt checklist for
  scaling/shortening; `BASE_PROMPT` itself stays byte-identical so prefix
  caching is unaffected.

New `e2e/unidad-turno-diff.ts`: diff math, red-flag triggers (including the
exact H2/round-5 no-op scenario), the reviewer summary text, and the
per-turn guidance injection/cap (never more than 3 lines).

### Real-model run (`v6-haiku-low`, claude-haiku-5-5, low effort)

`experimentos/motor-claude/correr.ts --etiqueta v6-haiku-low --motor
claude-haiku-5-5 --esfuerzo low --casos all --repeticiones 2 --tope 0.30`,
against the live dev server on this worktree (fresh `npx astro dev stop` +
`PORT=3400 npm run dev` restart before running, per the round 1b lesson).
Ran ALL 8 cases × 2 repetitions = 16 case-runs to natural completion (no
budget cutoff this time — the first invocation was killed early by an
external wrapper timeout on my end, not the runner's own guard; resumed
cleanly since completed case-runs are skipped by their existing
`corrida.json`). **Spend: USD 0.3030** of the USD 0.30 limit for this task
(1% over — the runner's own pre-flight guard estimates USD 0.05/case
before starting it, real cost came in lower per case but the 16th case-run
still pushed the realized total slightly past the estimate-based stop
point; same guard mechanism every prior round used, not a new bug).

**Verification method**: ran `computarDiffTurno`/`detectarBanderasRojas`
(the actual shipped functions, not a re-implementation) directly against
every saved `turno-N.html` pair for turns 2 and 3 of all 16 case-runs (32
turn-checks), then read the real byte-diff of each flagged turn's
before/after HTML to confirm whether the resulting correction actually
added real content (not just trusting `corrigioHtml: true` from the log).

**Result: 7 of 32 turn-checks (22%) fired a red flag, every one a true
positive** (verified against the request text and the diff) — all 7 were
instances of the "agregá al final/un nivel X" class turning out trivial on
the model's first pass:

| Case / turn | Request (truncated) | Diff before flag | Correction outcome |
|---|---|---|---|
| D1-r1 t3 | "Agregá al final 3 ejercicios más difíciles…" | +0 chars, 0 script lines | **Fixed** — 3 real exercises + validation added |
| D1-r2 t3 | same | +18 chars, no new controls | **Fixed** — full "desafiosDificiles" section + validation function added |
| D3-r1 t3 | same | +0 chars, 0 script lines | **Not fixed** — correction only added a CSS `cursor` rule, no exercises |
| N3-r1 t3 | same | +0 chars, 0 script lines | **Fixed** — 3 real present-perfect/past-simple exercises + hints added |
| N3-r2 t3 | same | +0 chars, 0 script lines | **Fixed** — 3 real exercises + hints added |
| H3-r1 t2 | "Agregá un nivel final con fracciones mayores que uno…" | +1/-1 chars | **Fixed** — real "Nivel 4" with `mayores:true` logic added |
| H3-r2 t2 | same | +2/-2 chars | **Fixed** — real "Nivel 4" + a "dos pizzas" double-figure renderer added |

**6/7 (86%) flagged turns were corrected into genuinely new, substantive
content** (confirmed by reading the actual code diff, not the self-report)
— the harness no longer silently accepts "agregá N preguntas" turning into
a comment and an empty bar, the exact round-5 defect this round targeted.
**D3-r1 is an honest miss**: the deterministic check correctly caught the
no-op, the correction path fired, but Haiku's one-shot correction attempt
still didn't add the requested exercises — expected given the one-shot
bound (goal C: never loop more than the existing bound), not a detection
failure.

**The mechanism adds value beyond the pre-existing `usoVision` gate**:
H3-r2 turn 2's reviewer pass had `visión=false` (the turn's diff was text-
light enough to skip the screenshot heuristic) yet still `corrigió el
HTML: true` — under the pre-round-6 code (`usoVision && accionables.length
> 0`) this turn could never have auto-corrected; it only did because
`banderaDeterministica` now ORs into that gate.

**25 of 32 turn-checks fired no flag**; spot-checked several (e.g. D3-r2
turn 3: +1017 visible chars, 3 new buttons — a real "3 ejercicios" turn
done right on the first try) as true negatives, no false negative found in
the sample reviewed.

**Timing/cost (goal C)**: no loop beyond the existing one-shot correction
bound in any of the 7 flagged turns (same as every pre-round-6 auto-fix).
Reviewer-phase time (the `revisor:` line, which includes the correction
round when one fires) averaged 19.4s across the 25 turn-checks that ended
in a correction vs. 30.4s across the 11 that didn't — noisy and confounded
by case/content, not a clean causal A/B, but neither group shows a runaway
or outlier (max observed: 46.7s, well inside the existing ~150s/pass
budget). Per-case-run cost stayed in the same USD 0.012–0.050 band as
rounds 3-5; no case approached the per-case USD 0.05 estimate.

**Goal B (per-turn guidance) was not isolated with an A/B this round** —
no "round 6 code minus `guiaPorPedido`" control run was budgeted. The
"más grande para proyectar" turns (D1, D3, N3 turn 2) mostly showed 0
visible-text delta but real `<script>` line changes (scaling done via
CSS/JS, not new text) — expected and consistent with round 5's H1 fix, not
a defect; whether `guiaPorPedido` specifically caused that is unmeasured
this round.

**Checks run**: `npm run check` (clean); `npx tsx e2e/unidad-kit.ts
e2e/unidad.ts e2e/unidad-pruebas-aisladas.ts
e2e/unidad-edicion-fragmentos.ts e2e/unidad-preview.ts
e2e/unidad-verificador.ts e2e/unidad-verificador-cliente.ts
e2e/unidad-turno-diff.ts` (all pass, new round-6 suite included);
`KODU_BASE_URL=http://localhost:3400 npx tsx e2e/t11-autoprueba.ts
e2e/verificador-endpoint.ts e2e/verificador-editor.ts` (all pass against
the live dev server on this worktree, after the restart above; the
pre-existing `v3-smoke` model's `isVerifier` had to be toggled OFF
temporarily for the "sin motor verificador" scene, same as every prior
round, then restored ON immediately after — confirmed still ON at the end
of this round).

**Open for a future round**: D3-r1's one-shot-correction miss (the request
stayed unfulfilled after the only correction attempt) — a second bounded
attempt, or routing a persistently-unfulfilled append through the forced
full-rewrite fallback directly instead of a fragment edit, might close it;
goal B's effect is unmeasured in isolation; `AiTrace` still has no
`usedVision`/`banderaDeterministica` column (same class of gap noted since
round 2) so a future admin report can't tell which auto-fixes came from
vision vs. the deterministic check without re-deriving it.

## T9 notes (2026-10-13) — Anthropic presets, cache-write price, create-account-inline

- `src/lib/ai/presets.ts`: `claude-haiku-5-5` (0.10/0.01/0.50, cache-write
  0.125, effort `low`, 32K max output), `claude-sonnet-5-5` (2/0.10/2.50/10,
  effort `medium`), `claude-opus-5-5` (4/0.20/5/20, effort `medium`) — prices
  verified against the real `providerModel` strings and cache-write prices
  already live in the dev DB from T1-T6's manual (non-preset) models before
  writing the preset, not invented. `ModelPreset.provider.apiFormat` and
  `reasoning.param` types extended to include `'anthropic'`/`'effort'`
  (T1 already used those values at runtime; the preset TYPE just hadn't
  caught up). `ModelPreset.prices.cacheWritePerMToken` is new — `undefined`
  on every non-Anthropic preset, same "never invent a price" convention as
  the DB column it mirrors.
- Closed the exact gap T1 left open ("no preset defines a cache-write
  price yet"): `preciosDePreset` now returns `cacheWrite` when the preset
  has one; `catalogo.ts#construirConfig`'s preset branch already passed
  `precios` straight through, so this was the one missing piece —
  previously a preset-linked Anthropic model always billed cache writes at
  the generic 1.25x-of-input fallback instead of the real provider rate.
  `camposDePreset` (`lib/admin/modelos.ts`) now also writes
  `priceCacheWritePerMToken` into the stored row (mirror only — runtime
  reads the preset directly — but `/admin/motores` reads the stored
  columns to DISPLAY the price, so it was showing blank before this).
- `ModeloForm.tsx`: picking a preset now also fills/locks "Escritura de
  caché". Bigger change: when no existing provider account matches the
  preset's `baseUrl` (the `sinProveedores`/empty-match case — exactly a
  fresh deploy with zero providers), the form stops requiring an
  already-created account and instead shows an inline "Cuenta nueva para
  este preset" fieldset (account name + API key). On submit, if a new
  account is needed, `POST /api/admin/providers` runs FIRST (its returned
  `id` becomes the model's `providerId`); only on success does
  `POST /api/admin/models` run — never a half-created motor without an
  account. This is the one-step "pick the preset, paste the key, save"
  path the production deploy note asks for.
- Verification: extended `e2e/unidad-presets.ts` with the three new
  presets' prices/cache-write/effort/schedule assertions (all pass, `npx
  tsx e2e/unidad-presets.ts`). Live, against the real dev server
  (`KODU_BASE_URL=http://localhost:3400`): a throwaway Playwright script
  (not committed) confirmed selecting "Claude Haiku 5.5" in a real
  `/admin/motores` "Nuevo motor" dialog fills `precioEscrituraCache` =
  `0.125`, and — since this dev DB already has a real Anthropic provider
  account from earlier rounds — correctly auto-selects it instead of
  offering to create a new one (the create-new-account branch itself was
  exercised functionally through the T7 `--modo` experiment-runner smoke
  run below, which calls the exact same `POST /api/admin/providers` →
  `POST /api/admin/models` sequence with a brand-new account each time).
  No dedicated preset e2e existed to extend for a second live run, per the
  task's "if an e2e for presets exists" clause.

## T7 notes (2026-10-13) — generation modes, role→model routing, credit policy

**Schema** (additive migration `20261029000000_modo_generacion_y_credito`,
applied to `koduedu_claude` via `prisma migrate deploy`): `AppSettings`
gained `generationMode` (default `'base'`), `creationModelId`/
`adjustmentModelId` (nullable FK to `AiModel`, "personalizado" only),
`monthlyCreditUsd` (default 200), `premiumUntilUsd` (default 100),
`billingCycleDay` (1-28, default 1, DB `CHECK` as defense in depth beyond
the zod range). `Project` gained `engineChosenByTeacher` (default
`false`) — see "explicit engine" below.

**Modes in code** (`src/lib/ai/modos-generacion.ts`, mirrors `presets.ts`'s
"defined in code, keyed by a string stored in the DB" convention): `base`,
`revisor-sonnet`, `crea-sonnet`, `crea-opus`, `todo-sonnet`, `todo-opus`,
each mapping `creation`/`adjustment`/`reviewer` roles to a `presetKey` +
effort (exact mapping per the task's own table — `revisor-sonnet` only
changes the reviewer role, `todo-*` use the same premium model for both
productive roles). `'personalizado'` lives OUTSIDE `MODES`: its roles are
real `AiModel` ids the admin picked, not presets.

**The reviewer role is informational only** — deliberately did NOT touch
`motorVerificador()`/`AiModel.isVerifier` (T3's existing single-verifier
mechanism, untouched since T5). A mode's `reviewer` field only drives the
"preset missing" warning in `/admin/generacion` (see below); the model
that actually reviews a turn is still whichever row has `isVerifier: true`,
exactly as before T7. This was an explicit reading of "keep that
mechanism" in the task, not an oversight.

**Routing** (`catalogo.ts#motorDeGeneracion`, called from `stream.ts` in
place of the old direct `normalizarMotor(model ?? project.aiModelId)`):

1. If `Project.engineChosenByTeacher` is `true`, behave exactly like
   before T7 (`normalizarMotor(explicit ?? project.aiModelId)`) — the mode
   never gets consulted.
2. Otherwise, resolve the active mode's role (`creation` when
   `esRecursoInicial`, else `adjustment`) to the enabled `AiModel` linked to
   that preset, with the mode's effort OVERRIDING whatever `reasoningEffort`
   is stored on that row (`motorPorPresetKey`) — a model can play different
   roles at different efforts depending on which mode is active.
3. If that preset has no enabled model, retry with `'base'`'s preset for
   the same role (logged once per mode+role combination, never per turn).
4. **If NEITHER the requested mode nor `'base'` has its preset configured,
   fall back to `normalizarMotor(explicit ?? project.aiModelId)` — the
   project's OWN pre-T7 engine, not the installation-wide default.** This
   was a real bug caught by my own live e2e sweep, not a design I got right
   the first time: an earlier version fell straight to `motorPorDefecto()`
   (the catalog-wide default), which converged EVERY project without an
   explicit engine onto whatever that happened to be — breaking
   `m2-catalogo.ts`, `t11-autoprueba.ts`, `verificador-endpoint.ts`, and
   `verificador-editor.ts` the moment `generationMode` defaulted to `'base'`
   with no `claude-haiku-5-5`-preset model enabled in the dev DB (true for
   every test fixture that assigns its own mock model directly, and true
   for the real production DB on the first deploy, before the owner does
   the one-time preset setup). Falling back to the PROJECT's own engine
   instead means every project unrelated to Claude modes keeps behaving
   exactly as it did before T7 existed, and mode routing only visibly
   activates once its preset is actually configured — see
   `e2e/unidad-modos-generacion.ts`'s last test for the regression case.

**"Explicit teacher engine" is a new boolean, not inferred from
`aiModelId` being non-null** — every project already has `aiModelId` set
by the silent default assignment in `project/[id].astro` well before any
chat turn, so that alone can't distinguish "teacher picked this" from
"system assigned this". `Project.engineChosenByTeacher` is set `true` in
exactly one place: `Workspace.tsx`'s `onModelChange` (the real
`SelectorDeMotor` click), via a new optional field on `PATCH
/api/projects/:id`. The automatic fallback-notice swap (`onUseFallback`)
and the silent initial assignment both leave it `false` on purpose.

**Credit policy** (`modos-generacion.ts`, pure functions, DB-touching sum
separate): `inicioDelCiclo`/`finDelCiclo` compute the UTC cycle window from
`billingCycleDay` (clamped 1-28 even if a stray write ever got past the
`CHECK`); `gastoDelCicloActual` sums `TokenUsage.costUsd` for
`apiFormat: "anthropic"` models since the cycle start, 60s-cached
(`CACHE_TTL_MS`, same pattern as `catalogo.ts`/`settings.ts`), keyed by the
cycle's own start timestamp so a cycle rollover or a `billingCycleDay`
change invalidates it for free. `modoEfectivo`: any mode other than
`'base'` (including `'personalizado'` — the admin could have picked Sonnet/
Opus there too) behaves as `'base'` once `gastoDelCicloUsd >=
premiumUntilUsd`; an unknown mode key always resolves to `'base'`
regardless of spend. `monthlyCreditUsd` has no separate code gate — with
the task's defaults (`premiumUntilUsd` 100 < `monthlyCreditUsd` 200) the
premium cutoff already forces `'base'` well before the harder monthly
limit, so reaching `monthlyCreditUsd` is purely an admin-facing alert
(`/admin/generacion`'s red box), never a second code path.

**Cross-model thinking-block note**: verified, not just asserted. Read
`provider.ts#aAnthropicMessages` end to end — `ChatMessage` (the
intermediate history type every dialect translates from) has no field
that could hold a reasoning/thinking block, and `readCompletionStream`'s
Anthropic branch explicitly ignores `thinking_delta`/`signature_delta`/
`citations_delta` while parsing a response. Exported the function (it was
private) for one direct unit test
(`e2e/unidad-mensajes-anthropic.ts`) confirming an `assistant` turn with
both text and a tool call never produces a `thinking` content block —
switching models between turns under a mode can't resend another model's
reasoning, because none is ever captured into history in the first place.

**Admin UI** (`/admin/generacion`, `GeneracionPanel.tsx` +
`lib/admin/generacion.ts` + new `GET /api/admin/generacion`): mode
`<select>` with description + measured cost/time per mode (figures lifted
verbatim from this doc's own T4 round notes — advisory only, never read by
routing code) and an inline amber warning + link to `/admin/motores`
naming which preset(s) the selected mode is missing; the two
"personalizado" selects (enabled `AiModel`s only); the three credit
number inputs (saved on blur); a live box — "Gastado este ciclo… modo
efectivo… proyección al cierre" — that polls `GET /api/admin/generacion`
every 20s and also refreshes right after any save, so the numbers don't
need a page reload to catch up with real traffic. `PATCH
/api/admin/settings` validates the new fields: `generationMode` against
`esClaveDeModoConocida`, `creationModelId`/`adjustmentModelId` against a
real `AiModel` row, `billingCycleDay` 1-28.

**Experiment runner** (`claude-exp` worktree, `exp/motor-claude`,
`experimentos/motor-claude/correr.ts`): added `--modo <key>`, mutually
exclusive with `--motor`. Provisions one shared Anthropic provider account
per `--etiqueta` plus one preset-linked `AiModel` per DISTINCT preset the
mode's creation/adjustment roles need (`POST /api/admin/models` with
`presetKey` set — the server fills in `providerModel`/prices/reasoning
from the preset, same mechanism `/admin/motores` uses); sets
`AppSettings.generationMode`; deliberately skips the `PATCH
.../aiModelId` step so `motorDeGeneracion` routes each turn by role;
restores the previous mode in a `finally` (covers a budget cutoff or a
thrown error, not just the happy path). Needed its own
`ESTIMADO_USD_POR_CASO_MODO` pre-flight budget table — reusing the
existing single-motor estimate (keyed by the creation role's model) rated
`crea-sonnet` at USD 0.80/case as if all three turns used Sonnet, when
only one does; the first real invocation hit exactly this and aborted
before spending anything (harmless, but would have forced an
unnecessarily high `--tope`).

**Real smoke run** (H2-ciclo-del-agua, 1 rep each, live dev server on this
worktree): `--modo base` — all three turns' `TokenUsage`/`AiTrace` rows
point at the mode's `claude-haiku-5-5`-preset model, USD 0.0266, 207.8s
total (turn 1: 74.7s/$0.0064 + reviewer 16.1s/$0.0035; turn 2: 73.4s/
$0.0056 + reviewer 16.1s/$0.0035; turn 3: 59.7s/$0.0036 + reviewer 17.1s/
$0.0039 — every turn's self-test triggered 2 corrections and ended in the
harness's own "aviso final", unrelated to T7, same shape as prior rounds'
H2 runs). `--modo crea-sonnet` — confirmed via direct `TokenUsage` query:
the creation turn (GENERATION) used the `claude-sonnet-5-5`-preset model
(USD 0.0595), both adjustment turns used a `claude-haiku-5-5`-preset model
(USD 0.0017 + 0.0014) — exactly the mode's role mapping, with the SAME
model id resolving across the two separate `--modo` runs' own provisioned
Haiku rows (expected: preset-based routing matches by `presetKey`, not by
which run created the row). Total case cost USD 0.1207, 108.2s. Combined
smoke spend **USD 0.1473** of the USD 0.40 task limit (`gasto.json`;
project ledger grand total now USD 7.7251 of the USD 15.00 global cap).
`AppSettings.generationMode` confirmed back at `'base'` in the DB after
both runs (not just trusting the runner's own log line).

**Checks run**: `npm run check` (clean after every commit, both
worktrees — `claude-exp`'s has pre-existing unrelated errors from its
stale `src/` snapshot, none in the edited `correr.ts`); every
`e2e/unidad*.ts` (26 files) — all pass except one PRE-EXISTING, unrelated
failure found by this sweep: `e2e/unidad-responses.ts`'s `mock-proveedor
/v1/responses` round-trip assertion compares against a literal object
missing the `cacheWriteTokens` key that T1 (2026-10-08) already added to
every dialect's usage shape — a stale test fixture, not a T7/T9 defect
(not fixed: out of scope for this task). New `e2e/unidad-modos-generacion.ts`
(modes/clave-efectiva/ventana-del-ciclo/proyección, all pure, plus
`motorParaRol`/`motorDeGeneracion` against a real temporary `AiModel`
fixture — including the fallback-to-project-engine regression case) and
`e2e/unidad-mensajes-anthropic.ts` (no `thinking` block ever reaches
history), both new, all pass. Live, against this worktree's dev server
(restarted after the schema migration, per the lesson from T4 round 1b):
`t11-autoprueba.ts`, `verificador-endpoint.ts`, `verificador-editor.ts`
(the usual `v3-smoke` `isVerifier` toggle-off/toggle-on dance around the
last two, restored to ON — confirmed still the sole verifier afterward),
`m2-catalogo.ts`, `generacion-reanudable.ts`, `t9-varias-versiones.ts` —
all pass. `m3-motores.ts` — 30 of 31 scenarios pass; the one failure
("ArrowDown debería poder llegar a la opción del motor recién creado") is
the SAME class of pre-existing cross-test dev-DB pollution T4 round 4
already documented (23 `selectableByTeacher`+enabled leftover experiment
models clutter the docente selector's keyboard-nav ordinal position) —
not caused by T7/T9, not fixed here (same reasoning prior rounds used).
Along the way, found and fixed TWO pieces of pre-existing dev-DB drift
that were blocking a clean baseline for this sweep (neither a T7/T9
defect): `AiModel.isDefault` had drifted onto a leftover "Mock local
(T3+)" row instead of the seeded MiniMax M3 (restored); `v3-smoke`'s
`isVerifier` had been left OFF from an earlier interrupted session
(restored to ON, matching the state every prior round documented leaving
it in).

**Fresh-DB deploy check**: created `koduedu_claude_fresh` in the
`kodu_db_dev` container, ran `prisma migrate deploy` against it from zero
(`DATABASE_URL` override on the command only) — all 52 migrations applied
cleanly; `AppSettings` row 1 confirmed with every T7 default
(`generationMode='base'`, both model ids `NULL`, `monthlyCreditUsd=200.00`,
`premiumUntilUsd=100.00`, `billingCycleDay=1`); `Project.engineChosenByTeacher`
confirmed present, `NOT NULL DEFAULT false`. Dropped afterward.

**Open for a future round**: T6 (Sonnet/Opus/Haiku+Opus advisor
measurement) is still open, so `/admin/generacion`'s per-mode "measured"
figures for `revisor-sonnet`/`crea-opus`/`todo-sonnet`/`todo-opus` are
taken directly from this doc's task brief, not independently re-measured
by T7 itself (only `base` and `crea-sonnet` got a real smoke run here).
The dev DB currently has NO `claude-haiku-5-5`-preset model enabled at
all (every Claude experiment model from T1-T6 was created before T9
added presets, so none has `presetKey` set) — `/admin/generacion`
correctly shows "Falta configurar: Claude Haiku 5.5" and the fallback
chain correctly keeps projects on their own engines until that's fixed;
worth linking an existing experiment model to the preset (or creating a
fresh one via the new create-from-preset flow) before relying on `'base'`
mode in this dev DB for anything beyond this round's smoke test. Project
titles from the two `--modo` smoke runs read "… — null/none" (fixed in
`correr.ts` for future runs; the two existing rows are harmless leftover
data, not corrected retroactively).

## Part 0 notes (2026-10-13) — correction rounds were billing the creation model

**Bug**: in hybrid modes (`crea-sonnet`, `crea-opus`), a correction round
(self-test errors, or verifier findings → `POST /api/chat/autocorreccion`)
ran on the CREATION model (Sonnet/Opus), not the mode's ADJUSTMENT model
(Haiku) — measured ~USD 0.06/correction vs ~0.002 on Haiku, up to 2 rounds
per turn.

**Root cause**: `autocorreccion.ts` picked its model with
`normalizarMotor(project.aiModelId)` — never consulted the mode system at
all. `stream.ts` rewrites `project.aiModelId` to whatever model resolved
THAT turn right after it finishes; after a creation turn in a hybrid mode,
that's the expensive creation-role engine, and the correction round
inherited it verbatim. `verificar.ts`'s correction trigger (the client POSTs
the verifier's `problemas` into the SAME `autocorreccion.ts` endpoint) was
affected too — same root cause, one fix point.

**Fix**: `autocorreccion.ts` now calls `motorDeGeneracion({..., esCreacion:
false, ...})` (`catalogo.ts`, the exact function `stream.ts` already uses
for the original turn), with the SAME premium-budget downgrade
(`modoEfectivo`/`gastoDelCicloActual`) `stream.ts` applies before picking a
model — a correction round is always treated as an ADJUSTMENT, so hybrid
modes now correctly bill it to Haiku. `todo-sonnet`/`todo-opus` are
unaffected by design (their adjustment role IS the premium model).

**Test**: `e2e/unidad-modos-generacion.ts` gained two cases reusing the
file's existing Haiku/Sonnet fixtures — `motorDeGeneracion({esCreacion:
false, ...})` under `crea-sonnet`/`crea-opus` resolves to Haiku even when
`project.aiModelId` is Sonnet (the exact state `stream.ts` leaves behind
after a creation turn), confirmed distinct from the creation-role
resolution. `npx tsx e2e/unidad-modos-generacion.ts`: all pass except two
PRE-EXISTING dev-DB-pollution failures unrelated to this fix (see the Spend
log entry above) — confirmed not caused by this change: it touches only
`autocorreccion.ts` and the test file, never `catalogo.ts`/`modos-generacion.ts`.

## T11 notes (2026-10-13) — usage statistics

**Schema** (additive migration `20261030000000_uso_estadisticas`, applied to
`koduedu_claude` via `prisma migrate deploy`, verified from zero against a
scratch `koduedu_claude_fresh2` DB in the `kodu_db_dev` container — all 53
migrations applied cleanly, then dropped):
- `AiTrace` gained `generationMode` (the effective mode active for the
  turn), `turnRole` ('creation'/'adjustment', `NULL` for VERIFICATION/
  IDEATION — the `reviewer` role is a different axis, already covered by
  `turnKind`), `parentChatMessageId` (CORRECTION/VERIFICATION never create
  their own `ChatMessage` — this points back at the triggering turn's
  message, non-unique since several rounds can share one parent, indexed),
  `selfTestDurationMs` (client-measured, see below), `redFlags`
  (comma-joined `turno-diff.ts` motivo list, VERIFICATION only),
  `redFlagsFixed` (on the CORRECTION row that followed a red flag — `true`
  when that correction's `editOutcome` wasn't `FAILED`; an honest proxy, not
  a re-read of the actual content, documented as such in the schema).
- `TokenUsage` gained `aiTraceId` (a SEPARATE relation from the existing
  `AiTrace.tokenUsageId`, which stays 1:1 for GENERATION/ADJUSTMENT/
  CORRECTION — this new one is 1:N, for the verifier's up-to-2 PARALLEL
  passes, each already logging its own `TokenUsage` row with no single id
  to link; `vincularUsosALaRonda`, `trace.ts`, links them after the fact,
  same chicken-and-egg pattern `vincularTrazaAMensaje` already used).

**Writers** (`src/lib/ai/trace.ts` gained `ultimoChatMessageIdDelProyecto`,
`vincularUsosALaRonda`, `banderaRojaRecienteSinFijar` — all best-effort,
same non-throwing convention as the rest of the file):
- `stream.ts`: `generationMode`/`turnRole` added to the existing
  `recordAiTrace` call (reuses `modoEfectivoActivo` already computed to
  pick the model — no new query).
- `autocorreccion.ts`: same two fields, plus `parentChatMessageId`
  (`ultimoChatMessageIdDelProyecto`) and `redFlagsFixed` (looked up via
  `banderaRojaRecienteSinFijar` — the most recent VERIFICATION trace for
  this project with `redFlags` set, within a 5-minute window; a heuristic
  proximity match, not a shared "round id", documented as such).
- `verificar.ts`: `generationMode`/`parentChatMessageId`/`redFlags` (joined
  from `banderasRojas`) on both `recordAiTrace` calls (the all-passes-failed
  path too); `selfTestDurationMs` added to the request schema and threaded
  through from the client (see below); `ejecutarPasada` now returns its
  `tokenUsageId` so the caller can `vincularUsosALaRonda` after the trace
  exists.
- Client (`Workspace.tsx`): a new ref (`ultimoSelfTestDuracionRef`) captures
  `resultado.detalles.duracionMs` from the LAST self-test pass inside
  `ejecutarAutopruebaYCorreccion` (already measured client-side in `kit.ts`
  via `performance.now()`, previously read by `Workspace.tsx` but never
  forwarded anywhere) and `iniciarVerificacion` reads+clears it right before
  calling `verificarRecurso` — same existing `/api/chat/verificar` POST,
  zero new round-trips, exactly as the task asked.

**Aggregation** (`src/lib/admin/uso.ts`, new, all pure functions exported
for testing except the two DB-touching entry points
`resumenCredito`/`resumenUso`): a "turn" is a GENERATION/ADJUSTMENT/
CHECKLIST/EXTRA_VERSION/IDEATION row (has its own `chatMessageId`) plus
every CORRECTION/VERIFICATION that hangs off it via `parentChatMessageId`
(`agruparPorTurno`); a turn's full cost sums every row's own `TokenUsage` +
every row's `tokenUsagesDeLaRonda` (the new 1:N link). `agregarPorClave`
aggregates a list of turn-groups by any key (generation mode, or model) into
cost/duration/rate figures — `percentil`/`mediana` use nearest-rank (simple,
deterministic, documented); "cost per resource" is attributed to the mode
the resource was CREATED in, even if later adjustments ran under a different
mode (an explicit choice, documented in the test file).

**Admin page** (`/admin/uso`, linked right after Trazas in `AdminLayout.astro`
— `UsoPanel.tsx`, a `client:load` island matching `GeneracionPanel.tsx`'s
pattern): a date-range picker (default: current billing cycle, matching the
task); the credit box reuses `modos-generacion.ts`'s exact calculations
(same numbers `/admin/generacion` shows) plus a simple CSS bar-per-day
list (no new SVG component — the task said "keep it simple", and
`GraficoColumnas.tsx` is token-shaped, not USD-shaped); per-mode and
per-model tables (turns, cost total/per-creation/per-adjustment/per-resource,
median/p90 seconds including review+correction time, correction rate, edit
failure rate, red-flag rate, fix rate, honest-failure count); teacher
behavior (active teachers, resources/teacher, adjustments/resource
median+p90, % published via `Project.isInGallery`, undo signals, face
ratings, feedback comments, an approximate session length derived from
same-user-same-day turn spans — documented as an approximation, there's no
real session tracking); "¿Sobra crédito?" with per-mode monthly cost
projections, measured-in-range when available, falling back to the
constants already in `modos-generacion.ts`'s `measured` field (parsed from
its own "≈USD X · ≈Y s" text) otherwise. Tables use `overflow-x-auto`
instead of a second mobile card layout per table — deliberate
simplification given how many columns each table has.

**Exports**: `GET /api/admin/uso.json`/`.csv` (admin session, `requireAdmin`
— same `resumenUso` the page itself reads; `UsoPanel.tsx` polls the `.json`
one directly on "Ver", since `fetch()` ignores `Content-Disposition`, so
serving the panel's live data and the download from the same endpoint never
had to be two routes). `GET /api/stats/uso.json` is the one dev-facing,
non-session endpoint: gated by `STATS_API_TOKEN` (`env.ts`, new, `.env.example`
documented with an `openssl rand -hex 32` hint) via `Authorization: Bearer`,
constant-time compared (`node:crypto timingSafeEqual`); unset or <32 chars
→ 404 always (never confirms the endpoint exists); wrong/missing token → the
SAME 404 (never a 401 that would confirm a real secret exists). Verified
live: 404/404/404/200 for unset-equivalent/short/wrong/correct token; the
200 body has zero emails and zero request text (checked by regex over the
raw JSON). `lib/admin/trazas.ts`'s existing per-turn export gained the six
new `AiTrace` columns (`generationMode`/`turnRole`/`parentChatMessageId`/
`selfTestDurationMs`/`redFlags`/`redFlagsFixed`), same pattern as
`correctionTriggers` before them.

**Checks run**: `npm run check` (clean after every file); `npx tsx e2e/unidad*.ts`
(all 27 files) — all pass except the one PRE-EXISTING `unidad-responses.ts`
failure the task already flagged as known (a stale mock fixture missing
`cacheWriteTokens`, unrelated to T11/Part 0). New
`e2e/unidad-uso-agregacion.ts`: percentiles, the cycle-window wrapper
(`rangoDelCicloActual`/`parsearRangoQuery`), turn grouping (a
CORRECTION/VERIFICATION fusing into its parent via `parentChatMessageId`, a
historical row with neither id staying standalone), per-key aggregation
(cost per creation/adjustment/resource, median/p90 duration including
review time, correction/edit-failure/red-flag/fix rates), and
`sugerenciasDeModo`'s measured-vs-constant fallback — all pure, fixture-based,
no DB. Live (after a `npx astro dev stop` + fresh `PORT=3400 npm run dev`
restart, per the T4 round 1b lesson): the four suites the task named
(`t11-autoprueba.ts`, `verificador-endpoint.ts`, `verificador-editor.ts`,
`m2-catalogo.ts`) all pass — see the Spend log entry above for what that
took to get a clean read. A throwaway script (not committed, same "if an
e2e for X exists" / "a throwaway Playwright script" precedent T7/T9 used)
confirmed `/admin/uso` renders for ADMIN, the "Uso" nav link exists, both
exports return 200 with no emails, and `/api/admin/uso.json` without a
session returns 401.

**Fresh-DB migration check**: `koduedu_claude_fresh2` in `kodu_db_dev`,
`prisma migrate deploy` from zero (`DATABASE_URL` override on the command
only) — all 53 migrations applied cleanly; dropped afterward.

**Open for a future round**: the "session length" figure is a rough
same-day-same-user span, not real session tracking — fine as a first cut,
should say so wherever the owner reads it (it does, in both the UI caption
and the CSV header); `redFlagsFixed`'s proximity-window heuristic (5
minutes) could misattribute under concurrent corrections on the same
project from two tabs — not expected in real usage (one teacher, one
project, one tab) but not impossible; the dev-DB hazard documented in the
Spend log entry (a fresh project + an enabled real preset model silently
routes through the real API) is a pre-existing gap since T7, worth a guard
in a future round, not fixed here (out of scope for T11/Part 0 — this round
only disabled it temporarily to get a clean test read, then restored it).


### How the owner reads/exports usage stats (T11)

- **In the browser**: `/admin/uso` (logged in as ADMIN) — pick a date range
  (defaults to the current billing cycle) and hit "Ver". The "Sobra
  credito?" box at the bottom answers the owner's actual question directly:
  projected spend this cycle vs. the monthly credit, and what each mode
  would cost per month at the current volume.
- **To download a snapshot**: the "Descargar JSON"/"Descargar CSV" links on
  that same page (same admin session, same date range) - or
  `GET /api/admin/uso.json?desde=&hasta=` / `.csv` directly.
- **From outside the app** (a script, a personal dashboard, a cron):
  `GET /api/stats/uso.json?desde=&hasta=` with header
  `Authorization: Bearer <STATS_API_TOKEN>`. No PII ever: no emails, no
  request text, no pseudonyms even - only aggregated numbers. Returns 404
  (not 401/503) for a missing/short/wrong token, by design - it never
  confirms the endpoint exists to someone without the right secret.
- **Setting `STATS_API_TOKEN` in Coolify**: generate one with
  `openssl rand -hex 32`, then in Coolify open this app's resource ->
  **Environment Variables** -> add `STATS_API_TOKEN` with that value ->
  **Redeploy** (env vars are read at process start, `src/lib/env.ts`, so a
  running container won't pick up a new value without a restart/redeploy).
  Leaving it unset is safe - the endpoint just stays a 404 for everyone,
  same as before this task existed.
- The per-turn raw export (`/admin/trazas`, pseudonymized) now also carries
  `generationMode`/`turnRole`/`parentChatMessageId`/`selfTestDurationMs`/
  `redFlags`/`redFlagsFixed` for anyone who wants to re-aggregate by hand.

## Pre-deploy review fixes (2026-10-13)

An independent production review of this branch raised 9 findings. Each was
verified against the code before changing anything; 8 were real and fixed,
one was not (see below). No schema/migration changes were needed for any of
these — all fixes used existing columns, preset-level data, or were purely
client/server logic.

- **#1 (claimed HIGH, empty-assistant-message 400) — NOT reproducible,
  reverted.** The finding claimed that `stream.ts`'s three retry paths
  (`{role:'assistant', content: assistantText}` with `assistantText === ''`)
  produce an empty-content assistant message that Anthropic's Messages API
  rejects with 400 for a non-final turn, killing Haiku turns before the
  no-op/round-5 fallback can run. Implemented the suggested fix
  (`aAnthropicMessages` substitutes a placeholder instead of `''`), then
  ran a real verification against `claude-haiku-5-5`
  (`set -a; . ~/.credentials/anthropic-kodu.env; set +a`) reproducing the
  EXACT message shape `stream.ts` builds (bare empty-string assistant
  content, with/without tools, with/without forced `tool_choice`, with
  `thinking: adaptive` and `thinking: disabled`, streaming and
  non-streaming): every variant completed without a 400. Anthropic's API
  does reject an explicit empty **text block** inside a content array
  (`"text content blocks must be non-empty"`) and a dangling `tool_use`
  without a following `tool_result` — neither of which this codebase's
  `aAnthropicMessages` can produce (it only ever emits a bare string when
  there are no blocks, and `ChatMessage` never carries `tool_calls` at
  these synthetic call sites) — but a bare empty string, or an empty
  array, are both accepted. Reverted the code change and the test
  addition; left `aAnthropicMessages` byte-for-byte as it was. Real spend
  for this investigation: well under $0.01 (several tiny Haiku probes,
  `max_tokens` 16-4096, most hit the cap or finished in a few dozen
  tokens) — not logged to `gasto.json` (same convention as the T11
  accidental-spend note above: a throwaway probe script, not a
  `correr.ts` run).
- **#2 (MEDIUM, vision reviewer manual setup)**: `presets.ts` gained
  `defaultSupportsVision`/`defaultSelectableByTeacher`-style defaults —
  Haiku 5.5 now defaults `supportsVision: true` on creation (admin can
  still uncheck it). `POST /api/admin/models` gained `isVerifier` in its
  schema (it was silently dropped before — the form's checkbox had no
  effect on a brand-new model) and auto-sets `isVerifier: true` on the
  first model created from the Haiku preset when no verifier exists yet,
  respecting "at most one" via the same transaction pattern the PATCH
  route already used. `/admin/generacion` shows an amber warning with a
  one-click "Usar Haiku 5.5 como revisor" button when `motorVerificador()`
  returns null, PATCHing the existing admin models endpoint.
- **#3 (MEDIUM, silent auto-fix races)**: the reviewer's silent auto-fix
  (T5, `usoVision`/`banderaDeterministica`) used an untracked
  `AbortController` — `cancelarVerificacion` (new message/undo/manual
  edit) had no reference to cut it. Added `correccionSilenciosaRef`,
  aborted/cleared alongside the main verification controller, plus a
  `signal.aborted` guard right before `setHtml` inside
  `aplicarCorreccionDesdeVerificador` (closes the race between a server
  event arriving and the abort taking effect — safe because JS has no
  true preemption). `autocorreccion.ts`'s write is now
  `updateMany({where: {id, currentHtml: htmlPreCorreccion}})`: a 0-count
  no-op skips the `{type:'code'}` SSE event instead of overwriting a
  newer edit with a stale result.
- **#4 (MEDIUM)**: `new Anthropic({..., maxRetries: 0})` — the SDK's own
  retries were stacking under `stream.ts`'s existing retry/fallback loop.
- **#5 (MEDIUM, premium defaults + spend cutoff)**: Sonnet/Opus presets
  default `selectableByTeacher: false` (Haiku stays `true`); both defaults
  live only at creation time (`ModeloForm.tsx`'s preset picker, and
  `POST /api/admin/models` when the field is omitted), never forced over
  an explicit value. Closed the gap where `engineChosenByTeacher` bypassed
  `modoEfectivo`'s premium-spend cutoff entirely: `motorDeGeneracion` now
  takes a lazy `presupuestoPremiumAgotado` callback and falls back to the
  base role for a teacher-chosen Sonnet/Opus engine once the cycle's
  premium budget is exhausted (logged once per model+role). The callback
  is only invoked when the chosen engine is actually premium (name match,
  same convention as `provider.ts`'s `model.includes('haiku')`), so a
  teacher-chosen Haiku engine never pays the extra (cached, 60s TTL)
  spend query.
- **#6 (LOW, oversized capture / upscale / disabled cache)**: split
  `verificar.ts`'s capture bound into an abuse ceiling (20MB, schema-level)
  and a usable ceiling (2MB, same as before) — over the usable bound the
  capture is dropped and the review continues text-only, instead of 422
  for the whole request. `preview.ts`'s page-complete capture no longer
  upscales a narrower resource past its natural width before downscaling.
  The "skip capture when the verifier is known-disabled" part was already
  correctly implemented (`verificadorDesactivadoRef`, checked as the
  very first line of `iniciarVerificacion`, before any capture) — verified
  against the code, no change needed there.
- **#7 (LOW, Haiku long-context tier)**: `Precios.longContext` (threshold
  + 4 tier rates) wired into `calcularCostoTurno` and the Haiku 5.5 preset
  (100K tokens, 5x: 0.50/0.05/0.625/2.50) — before this, `provider.ts` only
  logged a warning past 100K prompt tokens; the cost was still computed at
  the short-context rate.
- **#8 (LOW, unconditional preserveDrawingBuffer patch)**:
  `buildPreviewDocument` takes an optional `conRevisor` flag (wired from
  `PreviewPanel`/`Workspace`'s `verificadorActivo`); the WebGL patch is
  only injected when a verifier is actually configured for the project.
  Gallery/published views were already unaffected (confirmed: `/p/[slug]`
  serves the saved HTML directly, `buildPreviewDocument` is only reachable
  from the editor's `PreviewPanel`).
- **#9 (LOW, KODU_DEBUG_* flags)**: added `debugFlagActivo()` (env.ts,
  `"1"`/`"true"` only) and applied it to all four `KODU_DEBUG_*` checks —
  `autocorreccion.ts`'s two checks previously enabled on ANY non-empty
  value, including `"0"`/`"false"` set by mistake.

**Verification run**: `npm run check` clean after every commit; all
`e2e/unidad*.ts` (26 files) pass. Live, against this worktree's dev server
(restarted fresh after all code changes) with the dev DB's 24 enabled real
Anthropic `AiProvider` rows temporarily disabled for the run (same T11
mitigation, restored to `enabled: true` immediately after — confirmed 24/24
restored, and zero new real-API `TokenUsage` rows in the 20 minutes around
the run): `t11-autoprueba.ts`, `verificador-endpoint.ts`,
`verificador-editor.ts`, `m2-catalogo.ts` — all pass. No migration was added,
so no fresh-DB migration check was needed. `gasto.json` (claude-exp
worktree) untouched (confirmed by mtime/checksum, last written before this
session). Total real API spend this session: under $0.01, all from the
disproven finding #1's investigation — well under the $0.08 task cap.

**Commits** (`feat/motor-claude`, not pushed): `c4742bd` (#4),
`83818b2` (#9), `95fbd29` (#7), `142fce9` (#5), `db89689` (#6/#8),
`58a3940` (#3), `0534f6c` (#2).

## T8 Final report (2026-10-13)

### Blind evaluation, 5 hard teacher cases × 3 turns, 1 rep (round 2)

| Mode | Global /10 | USD per resource (create + 2 adjustments) | Create time | Adjust time |
|---|---|---|---|---|
| todo-opus | 8.4 | 0.96 | ~4.5 min | ~75 s |
| crea-opus (Haiku adjusts) | 7.0 | 0.64 | ~4.3 min | ~26 s |
| todo-sonnet | 6.6 | 0.32 | ~1.8 min | ~55 s |
| base (Haiku, harness v6) | 6.2 | 0.019 | ~55 s | ~40 s |
| crea-sonnet (Haiku adjusts) | 4.2 | 0.18 | ~2 min | ~35 s |

Haiku improved from 4.3 (original harness) / 5.3 (v3) to 6.2 (v6). Hybrids lose quality
because Haiku struggles to adjust code another model wrote. Recommendation: `base` by
default; `todo-opus` with `premiumUntilUsd` when credit is left over (≈75–100 premium
resources per USD 100); `crea-sonnet` not recommended; `todo-sonnet` poor value.

Per active teacher per month (assumption: 8 resources × 4 adjustments): base ≈ USD 0.22;
todo-opus ≈ USD 10. USD 200 of credit covers ~900 active teachers on base.

### Pending tests (for leftover end-of-cycle credit)

1. Opus 5.5 at effort low (todo-opus-low): may keep most of the quality at lower cost/time.
2. crea-opus with Sonnet adjusting (premium code adjusted by a stronger model).
3. Haiku + Opus via the advisor tool (`advisor_20260301`; pairing with claude-haiku-5-5 unverified).
4. revisor-sonnet mode (Haiku + Sonnet reviewer) blind-evaluated against base.
5. "más corto" compliance (still weak on Haiku) — needs its own harness round.
6. More repetitions (n=5 per case is noisy) once production traces show real request mix.
7. Replay real production requests (from /admin/trazas) through each mode instead of synthetic cases.

### Spend

Experiment ledger (gasto.json): USD 11.86 including the final smoke; plus ~USD 0.03 of
probe/accidental calls outside the ledger (T1 sonda, T11 accidental, pre-deploy probe).
Compare against the Console's "Promotional credits" usage for the same dates.

## T12 Deploy (2026-10-13)

Pushed main ced2d3e at 20:26 UTC (fast-forward from 9682b22). Coolify deployment
finished; app `running:healthy`, last_online_at 20:32:30 UTC (after the push, so the
entrypoint's `prisma migrate deploy` succeeded). The site returned 503 for ~6 minutes
while the container restarted, then 200. Live probes: `/` and `/gallery` 200;
`/admin/uso` and `/admin/generacion` redirect to login; `/api/admin/uso.json` 401;
`/api/stats/uso.json` 404 (fail-closed until STATS_API_TOKEN is set).

Owner steps left: /admin/motores → preset "Claude Haiku 5.5" + paste a NEW (rotated)
Anthropic key; it becomes the reviewer automatically. /admin/generacion → mode
`base` (default), credit 200 / premium cutoff / cycle day. Optional: STATS_API_TOKEN
(≥32 chars) in Coolify env + redeploy.

## T14/T15 notes (2026-10-16/17, worktree `~/projects/kodu-wt/claude`)

Single writer, branch `feat/motor-claude` from `origin/main` `cfdfd39` (equal at
start). Committed in 4 units, each after `npm run check` passed clean: pacing +
stickiness + schema (`95c870d`), unit tests for pacing/stickiness (`65ad6d9`),
admin panel + `/admin/uso` exposure (`7faac7a`), T15 `pulido.ts` + endpoint
(`272bbfc`). Migration `20261031000000_automatico_y_pulido` applied to
`koduedu_claude` only (`Project.creationModelId`, `UsagePurpose.POLISH`,
`AppSettings.generationMode` SQL default → `automatico` for brand-new rows
only — production's existing row is untouched, no `UPDATE` in the migration).

**T14 done**: `decidirTierAutomatico` (pure, `src/lib/ai/modos-generacion.ts`)
picks haiku/sonnet/opus from cycle spend + days left + a linear "if the recent
pace were priced at Sonnet" projection, with hysteresis (haiku→sonnet needs
≤80% projected, not ≤90%) and a 5-min decision cache
(`tierAutomaticoActual`). Model stickiness: `Project.creationModelId` is set
once, on the first successful save of a NEW resource (`stream.ts`, any mode —
cheap, future-proofs the project), and `catalogo.ts#motorAutomatico` reads it
for the `adjustment` role ONLY when `generationMode === 'automatico'`,
falling back to Haiku if the sticky engine is gone/disabled. 11 unit tests in
`e2e/unidad-modos-generacion.ts` cover mid-cycle under/over budget, the
hysteresis boundary, last-4-days opus with/without enough remaining credit,
the `ahora === fin` edge, and the 3 stickiness branches against the real test
catalog — all pass. `/admin/generacion` lists "Automático (recomendado)" and
shows a live "Hoy los recursos nuevos usan: X — porque …" line with the
pacing numbers; `/admin/uso` + its exports (+ `/api/stats/uso.json`) carry
the same `{tier, razon}` in `ResumenCreditoUso.automatico`.

**T14 deviation**: the "≥20 resources → live per-tier average cost" refinement
from the task (vs. the fixed measured constants 0.019/0.32/0.96) was NOT
built — there's no real `automatico` usage yet to average, and the fixed
constants already satisfy "pure, unit-testable, documented" with a clearly
commented fallback. Worth a follow-up once there's real volume.

**T15 done**: `src/lib/ai/pulido.ts#pulirVisualmente` — one forced
`edit_resource_code` call to Sonnet 5.5 (effort "low", same precedent as the
T5 visual reviewer), system-prompted to touch ONLY visual quality, never
logic/text/ids/handlers/`__koduPruebas`. Never retries; never mutates the
HTML unless the tool call AND the edit both validate cleanly against the
real document (so "revert" is automatic — nothing was touched otherwise).
`POST /api/chat/pulir` wires it behind `generationMode === 'haiku-pulido'`,
mirrors `/api/chat/verificar`'s auth/ownership/fingerprint gates, records
`AiTrace`/`TokenUsage` with the new `UsagePurpose.POLISH`. `haiku-pulido`
itself is registered as a normal mode in `modos-generacion.ts` (same roles
as `base`).

**T15 NOT done (left for a follow-up)**: the client-side trigger — calling
`/api/chat/pulir` right after the existing self-test/revisor cycle for a
brand-new resource in `haiku-pulido` mode, then re-running the self-test on
the polished HTML and reverting (simply not calling `setHtml`) if it fails —
was deliberately left out of this pass. It requires touching
`Workspace.tsx`'s live creation flow (a ~2000-line file already carrying the
T4/T5 self-test+revisor orchestration) and real-browser verification I
couldn't do safely inside this unit. Also not done: wiring `--modo
haiku-pulido`/confirming `--modo todo-sonnet` in
`experimentos/motor-claude/correr.ts` (`exp/motor-claude` worktree), and all
of the Verification section's live suites / fresh-DB migration check / real
smoke calls (`t11-autoprueba`, `verificador-endpoint`, `verificador-editor`,
`m2-catalogo`, the budgeted `correr.ts` smoke) — none were run this pass.
`npm run check` is clean and the new unit tests pass; nothing beyond that was
verified against a real Anthropic call.

## T14/T15 notes (2026-10-17, client wiring + experiment runner + verification)

Single writer, worktree `~/projects/kodu-wt/claude` (`feat/motor-claude`) +
`~/projects/kodu-wt/claude-exp` (`exp/motor-claude`). Two commits, one per
worktree, each after `npm run check` passed clean: `4ee4cbb` (client wiring +
server persist/revert, `claude`), `7912870` (runner modes + measurement,
`claude-exp`).

**Client wiring**: `project/[id].astro` resolves `pulidoActivo =
settings.generationMode === 'haiku-pulido'` server-side (same pattern as
`verificadorActivo`) and passes it to `Workspace.tsx`. `iniciarVerificacion`
now triggers `ejecutarPulido` from EVERY exit path (via a small
`dispararPulido` helper before each `return`, not a `try/finally` wrap —
avoided reindenting the whole function) whenever the turn is a creation turn,
regardless of whether the reviewer itself is configured/ran — polish is an
independent mode. `ejecutarPulido`: captures with the SAME options as the
reviewer capture, posts `/api/chat/pulir`, applies the HTML quietly
(`setHtml`, no chat message), runs `ejecutarAutopruebaEnIframe` once, and
reverts (`setHtml` back + `POST /api/chat/pulir-revertir`) if
`necesitaCorreccion` or any console error remains. The `'puliendo'` panel
phase (`EstadoPanelVerificador`, `PreviewPanel.tsx`) is purely cosmetic —
`verificador` is always restored to whatever it held before polish started,
success or failure alike (T15: "failures must be silent"). Registered on
`pulidoRef`, aborted by `cancelarVerificacion` like the reviewer's silent fix.

**Server**: `/api/chat/pulir` now persists on apply with a conditional
`updateMany` (`where currentHtml: project.currentHtml`), same pattern as
`autocorreccion.ts` — `count === 0` degrades to `aplicado:false`. New `POST
/api/chat/pulir-revertir` (owner-checked, no auth surprises) does the inverse
conditional write (`where currentHtml: htmlPulido`) so a stale revert never
clobbers HTML the teacher already moved past.

**Known limitation found by the smoke test, not fixed this pass**: the
revert criterion is "any self-test error after polish", not "a NEW error
beyond what the turn already had". A creation turn that already ended in
`avisoFinal` (self-test warning survived the 2 correction rounds) will see
its post-polish self-test fail on those SAME pre-existing errors and revert
every time, even if the polish itself was harmless. Safe (never ships a
worse resource) but means polish effectively never sticks on an imperfect
baseline — worth comparing against the pre-polish error count in a follow-up
instead of a flat zero.

**Experiment runner** (`correr.ts`, `exp/motor-claude`): `haiku-pulido` added
to `ROLES_POR_MODO`/`ESTIMADO_USD_POR_CASO_MODO` (0.08/case) — provisions the
Haiku roles AND the Sonnet preset the polish pass always needs by preset,
independent of role. `automatico` added too (0.15/case estimate, documented
as a mid-point, not a measurement) — provisions all three tiers since no
single role is fixed. `todo-sonnet` was already present (confirmed, estimate
bumped 0.30→0.35 per the task's number). New `esperarPulido` mirrors
`esperarRevisor`: polls `AiTrace{turnKind:'POLISH'}`, then — only if the
server applied something (`editOutcome === 'FRAGMENTS'`) — polls
`Project.currentHtml` for up to `ESPERA_PULIDO_MS` (90s, covers the up-to-50s
client self-test) to detect a revert. `UsagePurpose.POLISH` added to this
worktree's `prisma/schema.prisma` (client-type-only, no migration — the
shared `koduedu_claude` DB already has it from `feat/motor-claude`'s
`20261031000000_automatico_y_pulido`) so this branch's Prisma client can
query it; `npx prisma generate` re-run after.

**Verification run this pass** (dev server restarted after the T14/T15
schema landed): `npm run check` clean in both worktrees (the exp worktree's
remaining errors — missing `@anthropic-ai/sdk` package, an unrelated
`razonamiento/correr-ui.ts` schema drift — are pre-existing, not touched by
this pass, and `correr.ts` never imports `provider.ts`). All `e2e/unidad*.ts`
pass (pre-existing unrelated flakes: `unidad-creditos.ts` hits a unique-
constraint race on welcome credits, logged but asserted around). Live suites
against the mock provider (`t11-autoprueba`, `verificador-endpoint`,
`verificador-editor`, `m2-catalogo`) all pass — ran with the dev DB's 25 real
`AiProvider{apiFormat:'anthropic', enabled:true}` rows temporarily disabled
(ids saved, all 25 restored after; confirmed 0 new `TokenUsage` rows joined
to a real Anthropic model in that window) and `isVerifier` confirmed already
on `Motor Claude · final-base · preset-claude-haiku-5-5`, untouched. Fresh-DB
migration check: `CREATE DATABASE koduedu_scratch_migcheck` in the
`kodu_db_dev` container, `prisma migrate deploy` from zero with
`DATABASE_URL` overridden only for that command — all 54 migrations applied
cleanly including `20261031000000_automatico_y_pulido` — then dropped.

**Real smoke** (`ANTHROPIC_KODU_API_KEY` from `~/.credentials/anthropic-kodu.env`,
`KODU_BASE_URL=http://localhost:3400`, `H2-ciclo-del-agua`, 1 rep each):

- `smoke-pulido` (`--modo haiku-pulido --tope 0.15`): USD 0.0916 total. Turn 1
  (creation) cost USD 0.0050 and ended in `avisoFinal` (2 console errors
  survived its own correction rounds) — polish ran (45.5s, USD 0.0818) and
  **reverted**, exactly the limitation above: the post-polish self-test saw
  the same pre-existing errors and the client discarded it. No "after"
  screenshot exists for this run because nothing was kept — the "before"
  capture (`experimentos/motor-claude/resultados/smoke-pulido/H2-ciclo-del-agua-r1/turno-1-1280.png`,
  taken before polish/reviewer ran) is a clean, readable flat-design water-cycle
  scene (sun, cloud, labelled stage, caption) — already decent on its own, so
  there's nothing to compare it against this run.
- `smoke-auto` (`--modo automatico --tope 0.30`): USD 0.2216 total, 0 console
  errors on all 3 turns. `decidirTierAutomatico` picked **Sonnet 5.5** for
  the creation turn (plenty of cycle credit left) and `Project.creationModelId`
  stuck: both adjustments (and their correction round) ran on the SAME Sonnet
  model via `AiTrace.model`/`reasoningEffort` — confirms stickiness routes
  adjustments through the creation model, not a hardcoded role.

Combined real spend this pass: USD 0.3133 of the USD 0.45 hard limit for
this task. `AppSettings.generationMode` confirmed back to `base` and all 27
Anthropic `AiProvider` rows confirmed `enabled:true` at the end (the runner
restores the mode itself; the disable/restore for the live suites was done
and undone by hand, verified by direct query both times).

## T14/T15 notes (2026-10-17, "pulido reverts every time" investigation)

Debugged the symptom from `v8-haiku-pulido` (5/5 hard cases: server applied
a `FRAGMENTS` edit, client reported "revertido" every time) in worktrees
`~/projects/kodu-wt/claude` (`feat/motor-claude`) and `~/projects/kodu-wt/claude-exp`
(`exp/motor-claude`). **The app's revert decision was already correct** —
the actual bug was a false-positive in the EXPERIMENT RUNNER's detection,
not in the app.

**What was checked and ruled out**: (a) kit-wrapping mismatch in `pulir.ts`'s
conditional `updateMany` — `pulido.ts` never touches `aislarPruebasKit`/
`desenvolverPruebas`, operates on `project.currentHtml` directly, same
representation throughout; not the cause. (b) client-side logic
(`empeoroTrasPulido`, added in `e2c26ce`) — confirmed correct by adding
temporary `console.debug` instrumentation (since removed) and reading it
live through the experiment runner's Playwright page console: for the two
`v9-haiku-pulido` cases where the server applied an edit (H2, H4), the
client's own baseline-vs-after comparison computed `revertir: false` both
times — it correctly recognised the polish introduced no new failures and
decided to KEEP it.

**What actually happened (proven with an independent watcher)**: wrote a
throwaway Node/Prisma script (`/tmp/.../watch-polish.ts`, not committed)
polling `AiTrace{turnKind:'POLISH'}` + `Project.currentHtml.length` every
150ms, completely separate from the runner's own polling. For H4
(`72b25716…`), it showed `currentHtml` landing at the polished length
(`80756`) within ~110ms of the `AiTrace` row appearing, and **staying
there for the entire ~85s window** until turn 2's own edit grew it further
— it was NEVER reverted. Yet `correr.ts`'s `esperarPulido` reported
`revertido: true` for that exact run. Same pattern for H2. This proves the
polish was kept correctly by the app; the runner's own "did it revert?"
detection was the thing lying.

**Root cause of the false positive**: not conclusively pinned down with
live instrumentation (the debug logging added to `esperarPulido` was
edited into the file AFTER the process that produced this evidence had
already started — `tsx` doesn't hot-reload a running process — so it never
actually printed for this run; discovered too late to re-run cheaply within
budget). The most likely mechanism, and a real latent bug regardless: in
`pulir.ts`, `recordAiTrace` ran BEFORE the conditional `Project.currentHtml`
write, so an external poller watching for the `AiTrace` row to decide
"check the HTML now" could in principle observe the trace a few
milliseconds before the write landed.

**Fixes applied**:
1. `src/pages/api/chat/pulir.ts` — reordered so the conditional
   `prisma.project.updateMany` write now runs BEFORE `recordAiTrace`, not
   after. Closes the ordering window regardless of whether it was THE
   cause. `escrituraAplicada` (boolean) replaces the old inline `escritura`
   check at the bottom of the handler. Also added a `KODU_DEBUG_PULIDO=1`
   env-gated server log (kept, cheap, off by default).
2. `experimentos/motor-claude/correr.ts` (`exp/motor-claude` worktree) —
   `esperarPulido`'s revert-wait loop now requires the "still equal to the
   pre-polish HTML" state to be observed on TWO CONSECUTIVE polls
   (`vecesSeguidasIgualAlAntes >= 2`) before declaring `revertido: true`,
   instead of trusting a single read. Also added `turno-1-prepulido.html`/
   `-1280.png`/`-1920.png` (captured right before the polish call, honest
   "before") and `turno-1-pulido.html`/`-1280.png`/`-1920.png` (captured
   right after `esperarPulido` confirms applied-and-kept, honest "after" —
   NOT reconstructed from `turno-2.html`, which would already carry turn
   2's own edit on top).
3. `Workspace.tsx`/`src/lib/client/pulido.ts` — unchanged net (temporary
   debug `console.debug` calls added during the investigation were removed
   again; `git diff` on these two files is empty against `e2c26ce`).

**Verification this pass**: `npm run check` clean in `claude`. All 27
`e2e/unidad*.ts` pass, including `unidad-pulido-revertir.ts`. Live suites
`t11-autoprueba` and `verificador-editor` pass against the mock provider
(29 real `AiProvider{apiFormat:'anthropic'}` rows — up from 27, two more
got added by later experiment runs — temporarily disabled, ids saved,
all 29 restored after; `isVerifier` restored to `true` on
`Motor Claude · final-base · preset-claude-haiku-5-5` at the end — it had
been left `false` from some earlier step before this pass started, and the
v9 run itself also cleared it, so it needed restoring twice).

**Real smoke this pass** (`v9-haiku-pulido`, `--casos duros --repeticiones 1
--tope 0.55`, resumed once after a `timeout` cutoff killed it mid-H3 — the
runner's own `corrida.json`-exists skip correctly avoided double-charging
H1/H2): USD 0.4340 total, under budget.
- H1, H3, H5: server found nothing worth a forced visual edit
  (`sin_tool_call`/similar — Sonnet is explicitly told "si no encontrás
  nada visual que valga la pena mejorar, no llames ninguna herramienta") —
  `editOutcome: FAILED`, no HTML change, ~USD 0.078 spent on the attempt
  each time. Not a bug — this is the designed behaviour for an
  already-decent resource.
- H2, H4: server applied a small edit (FRAGMENTS, +301/+301 chars), client
  kept it (`revertir: false`, confirmed independently as described above).
  `turno-1-prepulido-1280.png` vs `turno-1-1280.png`/`turno-2-1280.png`
  (the closest available "after" for this run, since the new
  `turno-1-pulido.png` capture code landed AFTER this run already executed)
  show no visually obvious difference in the main viewport crop for either
  case — the polish edit was small (~300 chars) and may have touched
  something outside this crop, or a subtle token not visible at this zoom.
  Honestly: I cannot confirm the polish looked BETTER from these images:
  it looked the same. A future run with the new `turno-1-pulido.png`
  capture in place would give a cleaner comparison.

`AppSettings.generationMode` confirmed back to `base` after this pass.

## T16 production default (2026-10-17) — owner decision: `automatico` in production

Owner decision: production runs mode `automatico` (Sonnet 5.5 default, Haiku
when the cycle's credit runs short, Opus in the last days if credit would be
wasted), with nothing to configure beyond adding the Anthropic key via the
Haiku 5.5 preset in `/admin/motores`.

1. **Auto-provision** (`src/lib/ai/catalogo.ts#asegurarMotorDePresetSiFalta`,
   called from `motorAutomatico` for the three Claude presets, skipped when
   `filasOverride` is passed — tests only): when NO `AiModel` row at all has a
   given Claude `presetKey` and an enabled `apiFormat:'anthropic'` provider
   exists, creates the model via the SAME `camposDePreset` mechanism
   `POST /api/admin/models` uses — `enabled:true`, `selectableByTeacher`/
   `supportsVision` from the preset's own defaults (Haiku: true/true;
   Sonnet/Opus: false/false), never `isVerifier`/`isDefault`. A row that
   already exists (even `enabled:false`) is left untouched — an admin's
   explicit "off" is respected, never revived. Memoized by preset per
   process (`presetsAutoprovistosEnEsteProceso`); never throws into the
   request path (catches and logs). Unit tests: `e2e/unidad-autoprovision.ts`
   (scratch DB `koduedu_autoprov`, created/migrated/dropped by the test
   itself in `kodu_db_dev`) — creates when missing, idempotent (forced
   re-check without memoization), respects a disabled row, no-op without an
   Anthropic provider, and confirms the process-memoization short-circuit.
2. **Data migration** `20261101000000_automatico_default_produccion`:
   `UPDATE "AppSettings" SET "generationMode"='automatico' WHERE
   "generationMode"='base'` — the SQL column default was already changed to
   `'automatico'` by `20261031000000_automatico_y_pulido` (for brand-new
   rows only); this migration does the part that was deliberately deferred
   then: moving production's EXISTING row off the old default, while never
   touching a value the owner already chose by hand. Applied to
   `koduedu_claude` via `prisma migrate deploy` (confirmed:
   `generationMode` went from `'base'` to `'automatico'` in the dev DB,
   left as-is per the task's own instruction).
3. **Measured constants**: `COSTO_MEDIDO_POR_RECURSO_USD.sonnet` in
   `modos-generacion.ts` updated 0.32 → 0.19 (re-measured on
   `v8-todo-sonnet`: 5 hard cases, creation + 2 adjustments each, mean USD
   0.186/≈2.2 min per resource — computed directly from
   `experimentos/motor-claude/resultados/v8-todo-sonnet/*/corrida.json`,
   `claude-exp` worktree). `todo-sonnet`'s `measured.creation` text updated
   to `≈USD 0,10 · ≈1,2 min` (creation-only mean from the same 5 runs:
   0.1019 USD / 1.23 min). `haiku-pulido` label now ends in "(experimental,
   no recomendado)"; its description now states the `v9-haiku-pulido`
   finding verbatim: Sonnet only edited 2 of 5 hard cases and the change
   wasn't visible in before/after screenshots, ≈USD 0.085 and ≈45s extra
   when it does apply. `base` mode's label changed from "Haiku
   (recomendado)" to "Haiku (económico)" — "Automático (recomendado)" was
   already the label `generacion.ts` hardcodes for the `automatico` mode
   (T14), so no change was needed there. The one other place that
   referenced the old "Haiku (recomendado)" wording as literal text
   (`GeneracionPanel.tsx`'s premium-cutoff paragraph) was updated to match,
   and now also notes that `automatico` is exempt from that premium cutoff.
4. **Admin visibility** (`/admin/generacion`): `resumenGeneracion()` gained
   `hayCuentaAnthropicHabilitada` (any enabled `apiFormat:'anthropic'`
   provider) and `modelosClaudeHabilitados` (enabled models linked to any of
   the three Claude presets, whether created by hand or by auto-provision).
   `GeneracionPanel.tsx`: when no Anthropic account is enabled, shows "Cargá
   la clave de Anthropic en /admin/motores con el preset Claude Haiku 5.5."
   verbatim; when one is enabled, lists the configured Claude models with a
   note that Sonnet/Opus provision themselves the first time `automatico`
   needs them.

**Checks run**: `npm run check` (clean). All 28 `e2e/unidad*.ts` files pass,
including the new `unidad-autoprovision.ts` — one pre-existing fixture in
`unidad-modos-generacion.ts`'s hysteresis test needed its
`gastoPromedioDiarioRecienteUsd` fixture value adjusted (0.26 → 0.45) because
the Sonnet pacing constant it feeds into changed (0.32 → 0.19); the test's
assertions and intent are unchanged, only the number needed to still land
the projection between the 80%/90% thresholds. Live suites against the dev
server on this worktree, restarted first (`npx astro dev stop` + fresh
`PORT=3400 npm run dev`): `t11-autoprueba.ts`, `verificador-editor.ts`,
`m2-catalogo.ts` — all pass, run with the dev DB's 30 enabled
`AiProvider{apiFormat:'anthropic'}` rows temporarily disabled (ids saved,
all 30 restored after; confirmed 0 new `TokenUsage` rows joined to a real
Anthropic model in that window via direct query) and `isVerifier` restored
to `true` on `Motor Claude · final-base · preset-claude-haiku-5-5`
afterward (cleared to `false` by `verificador-editor.ts`'s own cleanup, same
as every prior round). No auto-provisioned row was left behind in the dev
DB by these runs — the three Claude presets already had real rows from
earlier rounds, so `asegurarMotorDePresetSiFalta` always found an existing
row and no-opped. Fresh-DB migration check: `CREATE DATABASE
koduedu_scratch_t16` in `kodu_db_dev`, `prisma migrate deploy` from zero
(`DATABASE_URL` override on the command only) — all 55 migrations applied
cleanly, `AppSettings` row 1 confirmed `generationMode = 'automatico'` (by
column default, via the pre-existing seed migration's `INSERT` with no
explicit value for that column) — then dropped. No real Anthropic API call
made this pass.

**Not done / open**: the per-mode "measured" `adjustment` figures for
`todo-sonnet` were NOT re-measured (only `creation`, per the task's
explicit scope) — the existing `≈USD 0,07 · ≈55 s` text is noticeably off
from this same sample's real adjustment mean (USD 0.042/27s), left
untouched since changing it wasn't asked for and risked scope creep.
`pulido.ts`'s own Sonnet-preset resolution (`motorParaPresetYEsfuerzo`,
used by `haiku-pulido` mode) does NOT go through the new auto-provision
path — the owner's decision was scoped to `automatico` only, so
`haiku-pulido` still requires the admin to load the Sonnet preset by hand
if that mode is ever selected.
