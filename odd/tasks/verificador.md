# Verifier (gpt-6-luna) and isolated `__koduPruebas`

## Objective

Implement steps 4 (verifier) and 5 (isolate `window.__koduPruebas`) of
`experimentos/razonamiento/PLAN-produccion.md` (branch `exp/medicion-arnes`, commit 10d17d4).

## Problem

- Round 8: a badly written `window.__koduPruebas` test broke a whole resource, because the
  tests live inside the resource's own `<script>`. A syntax error there kills the resource,
  and the correction did not fix it. This affects every model.
- The trials (`RESULTADOS-modelos.md`) showed that gpt-6-luna (OpenAI, reasoning `medium`)
  finds real defects that neither the harness nor the blind evaluators saw, with zero false
  findings in 16 runs, at about USD 0.002 and 30 s per pass. The app cannot call it: there is
  no OpenAI dialect (`max_completion_tokens`, no `temperature`) and no Responses API. OpenAI
  needs the Responses API to combine function tools with reasoning.

## Why

The verifier helps the teacher; it is not a silent filter (PLAN §2). It runs in the
background after the self-test, adds no wait, and it never fixes anything on its own: the
teacher decides with a button.

## Scope

- **T1, kit:** the tests move to their own `<script>` block. A server-side normalizer
  extracts the tests when the model still inlines them in its script, and leaves the HTML
  unchanged when it is unsure. The sentinel reports broken tests as their own failure. The
  prompt asks for the separate block.
- **T2, provider:** Responses API support in `src/lib/ai/provider.ts`, ported from
  `experimentos/razonamiento/proxy-responses.mjs`. It covers the request mapping, SSE parsing
  into the same `StreamEvent` union, and usage mapping. A new per-provider API format field
  (additive migration) is editable in `/admin/proveedores`. OpenAI rules: no `temperature`,
  and `max_output_tokens` instead of `max_tokens`.
- **T3, verifier backend:**
  - The verifier engine is an `AiModel` flag with at most one true, editable in
    `/admin/motores`. No flag means the verifier is off.
  - A `src/lib/ai/verificador.ts` module carries the prompt from `verificar.ts` and parses the
    result.
  - `POST /api/chat/verificar` follows the same gates as `/api/chat/autocorreccion`. It sends
    the request plus the folded HTML, with no tools and reasoning `medium`. A new resource gets
    2 parallel passes, which are merged; an adjustment gets 1.
  - Each pass writes one `TokenUsage` row.
  - `/api/chat/autocorreccion` also accepts verifier problems as correction input.
- **T4, editor:** after the self-test, and in the background, the editor verifies new
  resources and any adjustment that changed the `<script>`.
  - Logic, request and usage problems of high or medium severity are shown as "Revisé el
    recurso y encontré N cosas para mejorar", with an "¿Las arreglo?" button that goes through
    the existing correction.
  - Content problems are shown as "Revisá este dato" and are never auto-fixed.
  - A stale result (the HTML fingerprint changed) is dropped.
- **T5, real check:** one real verification of a resource, plus one Responses probe with tools,
  both with gpt-6-luna and the OpenAI test key.

## Constraints

- The OpenAI test key (`~/.credentials/openai-echo.env`, `OPENAI_TEST_API_KEY`) is echo's
  production key, so only spend cents. It is never stored in the repo or in the dev DB seed.
- Mock-based e2e tests pick providers filtered by `enabled`.
- Never put a backtick inside a comment within `SCRIPT_CENTINELA`/`SCRIPT_KODU`.
- The `.env` gets no new variables. Configuration goes in the DB through /admin.

## Configuration

- TDD: off. Nothing is configured for it, and the repo has no test runner. Checks are
  ordinary functional checks: `npx tsx e2e/<file>.ts` (node:assert), `npx astro check`,
  and `npx tsc --noEmit`.
- RDD: off (global, decided by the user). No native review.
- Delivery: this branch is `feat/verificador`, cut from `feat/arnes-robustez` with
  `origin/main` merged in. `feat/arnes-robustez` was **not** merged into `main` as of
  2026-09-26. Forecast: about 1,500 authored lines, above the 400 heuristic. The PR strategy
  is left to the user; nothing is pushed.

## Tasks

- [ ] T1: isolate `window.__koduPruebas` (prompt + normalizer + sentinel + unit tests). Route: delegated writer (4+ files).
- [ ] T2: Responses API in provider.ts + API-format field + admin + unit tests. Route: delegated writer.
- [ ] T3: verifier backend (flag + module + endpoint + TokenUsage + correction input). Route: delegated writer.
- [ ] T4: verifier panel in the editor + e2e with the mock. Route: delegated writer.
- [ ] T5: real gpt-6-luna check (cents). Route: inline, bounded.

## Acceptance criteria

- A syntax error inside the tests leaves the resource working, and the self-test reports it
  as broken tests.
- A Responses provider streams text, tool calls and usage through the same `StreamEvent`s.
- With no verifier engine, the editor behaves exactly as before.
- With a verifier engine, a new resource shows the panel after the self-test, without blocking
  the chat. "¿Las arreglo?" applies a correction, and content findings are informational.

## Progress

(none yet)
