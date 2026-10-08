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
