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
- [ ] T5 Verifier with screenshots (Haiku), replacing gpt-6-luna
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
