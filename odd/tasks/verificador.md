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

- [x] T1: isolate `window.__koduPruebas` (prompt + normalizer + sentinel + unit tests). Route: delegated writer (4+ files).
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

### T1 — isolate `window.__koduPruebas` (2026-09-26)

- Prompt (`src/lib/ai/prompt.ts`): now asks for `window.__koduPruebas` inside
  its own `<script data-kodu-pruebas>`, placed after the resource's script;
  the short example is updated to the same shape. Minimal diff (wraps the
  existing example, no new instructions added).
- Server normalizer `aislarPruebasKit` (`src/lib/ai/kit.ts`, exported, pure):
  scans every non-kit `<script>` with a hand-written string/template
  (`${}`-aware)/comment/regex-aware scanner for a single top-level
  `window.__koduPruebas = [ ... ];`. Extracts it into a new
  `<script data-kodu-pruebas>` right after the script it came from, and
  wraps ANY `<script data-kodu-pruebas>` (extracted or already written by
  the model) in `try{eval(<JSON-encoded source>)}catch(e){window.__koduPruebasError=...}`
  — this is what actually stops a syntax error in the tests from ever
  reaching the page's global `onerror` (a direct `eval` compiles the string
  at call time, so even a `SyntaxError` is a catchable exception there).
  Ambiguous cases (unbalanced brackets, more than one candidate assignment
  in the document, a nested/non-array assignment, an unresolved
  regex-vs-division) leave the HTML byte-for-byte unchanged; a plain READ of
  `window.__koduPruebas` (no `=`) is never treated as a candidate or an
  ambiguity. Idempotent (a wrapped script no longer matches the raw-assignment
  pattern, so a second pass is a no-op). Wired into `aplicarKitAlTurno`
  (`stream.ts`), the single choke point already used by generation,
  adjustments and corrections.
- Sentinel (`SCRIPT_CENTINELA`'s `correrPruebas`, `kit.ts`): if
  `window.__koduPruebas` isn't an array but a `script[data-kodu-pruebas]`
  exists, it reports one synthetic failing test
  (`id: ID_PRUEBA_CARGA = '_kodu_pruebas_no_cargaron'`, exported) with the
  caught error's `String(e)` (or a generic fallback) as `detalle`, instead of
  silently treating it like "no checklist" (`pruebas: null`).
  `construirMensajeCorreccion` (`autoprueba.ts`) special-cases that id with
  its own directive line ("reescribí SOLO ese script"), before the normal
  per-item checklist-failure loop.
- `SCRIPT_CENTINELA` split into `SCRIPT_CENTINELA_BASE_A` / `_PRUEBAS` /
  `_BASE_B` (concatenated back into the same `SCRIPT_CENTINELA`), plus a
  frozen `SCRIPT_CENTINELA_PRUEBAS_ANTERIOR` (byte-exact copy of the
  pre-T1 `correrPruebas` section) so `SCRIPT_CENTINELA_PRE_VERIFICADOR` =
  `BASE_A + PRUEBAS_ANTERIOR + BASE_B` reconstructs, byte for byte, the
  centinela `feat/arnes-robustez` was already shipping. `construirBloque`
  gained a `centinelaAnterior` option (independent of `legado`), a new
  `BLOQUES_PRE_VERIFICADOR_POR_ID`/`bloqueKitPreVerificador` pair mirrors
  `BLOQUES_LEGADO_POR_ID`, and `bloqueEsCanonico` now accepts either legacy
  block — verified by diffing `bloqueKitPreVerificador(tema)` against the
  actual `bloqueKit(tema)` output captured from the pre-edit commit for all
  4 themes (exact match) before touching anything, and by re-diffing
  `SCRIPT_CENTINELA` before/after (the only textual change is the new
  `if (!Array.isArray(lista))` branch, nothing else moved).
- Tests: `e2e/unidad-pruebas-aisladas.ts` (new, 16 cases) covers inline
  extraction, an already-separate script getting wrapped, multiple separate
  scripts, mentions inside comments/strings/templates (ignored), a bare read
  (ignored), every ambiguity class (multiple assignments, nested assignment,
  unbalanced brackets, non-array RHS, regex-vs-division doubt), idempotence
  (both shapes), and that the canonical kit block is untouched. Two new
  cases in `e2e/navegador-kit.ts`'s `mainAutoprueba`: a real Chromium run of
  a resource whose `<script data-kodu-pruebas>` has a genuine syntax error
  (missing brackets) proves `erroresReenviados`/`resultado.errores` stay
  empty, `reinicioOk` stays `true` (the main script never noticed), and
  `pruebas` reports exactly the synthetic `ID_PRUEBA_CARGA` failure with a
  detail mentioning "syntax"; a second case does the same for a `ReferenceError`
  thrown before the array assignment finishes evaluating.
- Checks: `npx tsc --noEmit` clean. `npx tsx e2e/unidad-kit.ts` 36/36 pass
  (pinned legacy-hash test unaffected). `npx tsx e2e/unidad.ts` all pass
  (including the `BASE_PROMPT` example-text assertion, which still matches
  since only the surrounding `<script data-kodu-pruebas>` wrapper was added).
  `npx tsx e2e/unidad-checklist.ts` all pass. `npx tsx e2e/unidad-pruebas-aisladas.ts`
  16/16 pass. `npx tsx e2e/navegador-kit.ts` all pass (real Chromium,
  `/usr/bin/chromium`), including both new cases.
  `npx astro check` is **not** this repo's convention: it isn't a
  `package.json` script, `@astrojs/check` isn't installed, and running it
  prompts an interactive install — skipped, relying on `npx tsc --noEmit`
  (the repo's actual `check` script) instead.
- Left open: `e2e/t12-checklist-pruebas.ts` (full-stack, requires
  `docker compose up -d db` + `npm run dev` + the mock provider) was not run
  — out of scope for this task's Verification list, and a static read of it
  shows its assertions match by checklist id / a `data-marca` attribute, not
  by the raw shape of `window.__koduPruebas`, so it's expected to still pass,
  but that is not yet confirmed by actually running it.
- Commit: `b6af07e` (`feat(kit): isolate window.__koduPruebas from the
  resource's own script`).
