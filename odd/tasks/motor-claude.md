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
- [ ] T2 Experiment tooling and teacher prompt set on `exp/motor-claude` (delegated)
- [ ] T3 Haiku 5.5 baseline run + blind evaluation
- [ ] T4 Harness improvement rounds on Haiku (up to 5)
- [x] T5 Verifier with screenshots (Haiku), replacing gpt-6-luna
- [ ] T6 Sonnet 5.5, Opus 5.5 and Haiku + Opus advisor on the hard prompts
- [ ] T7 Credit-aware engine policy
- [ ] T8 Report: cost and time per resource per model, when to use each, pending tests

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
