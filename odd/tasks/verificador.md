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
- [x] T2: Responses API in provider.ts + API-format field + admin + unit tests. Route: delegated writer.
- [x] T3: verifier backend (flag + module + endpoint + TokenUsage + correction input). Route: delegated writer.
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

### T2 — Responses API support in provider.ts (2026-09-26)

- `prisma/schema.prisma` + `prisma/migrations/20260926003251_api_format_proveedor`:
  additive `AiProvider.apiFormat String @default("chat")`. Verified with
  `npx prisma migrate status` (applied, in sync) and by re-running
  `e2e/m3-motores.ts` (the full admin providers/models browser suite)
  end to end afterwards — every existing scenario still passes untouched,
  confirming the default keeps every pre-existing provider on the old path.
- `src/lib/ai/catalogo.ts`: `construirConfig` maps `fila.provider.apiFormat`
  into `ProviderConfig.apiFormat`, defensively normalizing anything that
  isn't literally `"responses"` to `"chat"` (same "never throw on an
  unexpected row" style as the rest of that file).
- `src/lib/ai/provider.ts` (the actual port of
  `experimentos/razonamiento/proxy-responses.mjs`):
  - `ProviderConfig.apiFormat: 'chat' | 'responses'` (required field — every
    literal `ProviderConfig` in the repo, real or test, now states it).
  - `ChatMessage` gained `role: 'tool'` and an optional `tool_calls`/
    `tool_call_id` (mirrors a real Chat Completions tool round-trip); no
    current caller in this app produces that shape (every turn calls the
    tool once and ends), it exists so the Responses mapping has something
    faithful to translate if that ever changes.
  - `aResponsesBody`/`aResponsesInput` (not exported, internal to
    `intentarUna`): `messages` → `input` (system/user parts incl. images,
    assistant text + `tool_calls` → `function_call`, `tool` →
    `function_call_output`), `tools` flattened to
    `{type,name,description,parameters}`, `tool_choice` honoring
    `forzarHerramienta`/`sinHerramientas` exactly like Chat Completions,
    `reasoning: {effort}` (mapped from the SAME object
    `razonamiento()`/`razonamientoEfectivo()`/`razonamientoOverride` already
    produce — `none`/`low`/`high` pass through, `max`→`high`, and the
    "medium" `razonamientoOverride` T3 will send for the verifier maps to
    `medium` too), `max_output_tokens`, `store:false`, `stream:true`, never
    `temperature`. `intentarUna` picks the endpoint
    (`/v1/responses` vs `/v1/chat/completions`) and the body shape off
    `provider.apiFormat`; the 429/`ToolChoiceNoSoportado` retry logic in
    `requestCompletionStream` is untouched and applies to both formats
    (same HTTP-status-based detection, format-agnostic).
  - `readResponsesStream` (new generator): parses the Responses SSE dialect
    into the exact same `StreamEvent` union as Chat Completions —
    `item_id`/`call_id` remapped to the numeric `index` the rest of the app
    expects, usage read out of `response.completed`/`incomplete`/`failed`,
    `response.incomplete` → `finish reason "length"` (so `tool.truncated`
    still works), reasoning-summary events ignored. A `type: 'error'` event
    or `response.failed` THROWS a `ProviderError` (after yielding any usage
    already on the failed response) instead of completing silently — Chat
    Completions never lets an error reach this deep (it's caught earlier by
    HTTP status in `intentarUna`), so this is genuinely new behavior for
    every caller's `for await` loop, not a preserved invariant.
  - `readCompletionStream(response, apiFormat = 'chat')`: new optional
    second parameter, defaulting to `'chat'` so every untouched caller (and
    every existing test) keeps reading Chat Completions byte for byte; when
    `'responses'`, it delegates to `readResponsesStream`.
  - Every real call site of `readCompletionStream` now passes the resolved
    provider's `apiFormat`: `stream.ts` (`generarVersionSecundaria`,
    `generarChecklist`, the `consumir` closure used for both the main
    upstream and the forced retry, and the visual auto-review pass — all via
    the already-resolved `args.provider`/`proveedorUsado` in scope, no new
    plumbing), `autocorreccion.ts` and `visual-review.ts` (their top-level
    `provider`). No caller outside `provider.ts` builds its own request or
    parses SSE directly, so this covers every "any other place that calls
    the provider" path in the task (checked with
    `rg "chat/completions|baseUrl|/v1/"` across `src/`).
  - `resolverMotor`/`normalizarMotor`/`cadenaDeMotores`/`motorPorDefecto` in
    `catalogo.ts` — the only place `ProviderConfig` is normally constructed
    — flow through `construirConfig`, so no other file had to change.
- Admin (`catalogo-de-proveedores` pattern): `ProveedorAdmin.apiFormat`,
  `crearProveedorSchema`/`actualizarProveedorSchema` (zod
  `z.enum(['chat','responses']).optional()`, omitted on create → the
  column's own `"chat"` default), and `ProveedorForm.tsx` got a "Formato de
  API" `<select>` ("Chat Completions (la mayoría)" / "Responses (OpenAI)")
  with a one-line Spanish hint that OpenAI reasoning models need Responses
  for tools — always sent in the payload like `kind`/`label`/`baseUrl`.
- `e2e/mock-proveedor.ts`: a `/v1/responses` route (`manejarPedidoResponses`,
  `RespuestaResponsesScript`, `programarRespuestaResponses` on the returned
  `MockProveedor`) — a single-shot text reply by default, and a
  `function_call` only when the request actually offers `tools` with a
  forced `tool_choice` (mirrors, but doesn't inherit, the eager-by-default
  behavior of the `/v1/chat/completions` route — a verifier calling with
  `sinHerramientas` must never get an unsolicited tool call). Every existing
  route/behavior on that file is untouched; the new route is dispatched
  before the existing 404 fallthrough, on its own request queue.
- Tests: `e2e/unidad-responses.ts` (new, 20 cases) — request mapping via a
  disposable HTTP server (URL, full message mapping incl. tool round-trip
  and an image part, tools/tool_choice forced/auto/omitted, all 4 reasoning
  levels plus the "medium" override plus "no level configured", max tokens
  incl. override, no temperature, store/stream/model), stream parsing via
  hand-built `Response`/`ReadableStream` objects (text, two interleaved
  tool calls with correct per-index deltas, `incomplete`→truncated, usage
  mapping, `error` event, `response.failed` after usage, and one regression
  case proving the default `readCompletionStream(response)` — no second
  arg — still reads Chat Completions untouched), and two round trips
  against the new mock route through the real
  `requestCompletionStream`+`readCompletionStream` pair. `e2e/unidad.ts`'s
  `config()` test helper got the new required `apiFormat: 'chat'` field.
- Checks: `npx tsc --noEmit` clean. `npx tsx e2e/unidad-responses.ts` 20/20.
  `npx tsx e2e/unidad.ts`, `npx tsx e2e/unidad-kit.ts`,
  `npx tsx e2e/unidad-pruebas-aisladas.ts` all pass unchanged. `npx prisma
  migrate status`: applied, database in sync. `npm run dev` on :3000 +
  `npx tsx e2e/m3-motores.ts` (the admin providers/models browser suite,
  the closest existing e2e to "the provider form"): all 38 scenarios pass
  — the new `apiFormat` field doesn't disturb any existing provider CRUD
  invariant. Dev server stopped afterwards with `npx astro dev stop`
  (confirmed no leftover `astro` process).
- Left open: no real OpenAI call was made (T5's job, and the task
  constrains "only spend cents" with the echo test key) — everything above
  is verified against the mock and hand-built SSE fixtures, not against
  the real Responses API. `ProveedoresPanel.tsx` (the list view) doesn't
  show `apiFormat` — only the edit form does, matching what the task asked
  for ("editable in the admin provider form"); nothing currently needs it
  visible in the list.
- Commits: `2bae170` (`feat(ai): add Responses API support for OpenAI
  reasoning models`), `65659e2` (`test(ai): cover Responses API request
  mapping and stream parsing`).

### T3 — verifier backend (2026-09-26)

- `prisma/schema.prisma` + `prisma/migrations/20261005000000_verificador_motor`:
  additive `AiModel.isVerifier Boolean @default(false)`, enforced with a
  partial unique index (`AiModel_un_solo_verificador`, `WHERE "isVerifier" =
  true`) — same pattern as `AiModel_un_solo_default`, applied by hand (`psql`
  + `prisma migrate resolve --applied`, never `prisma migrate dev`, which
  would try to drop both partial indexes since neither is expressible in
  `schema.prisma`). `motorVerificador()` (`src/lib/ai/catalogo.ts`) resolves
  the flagged row and returns `null` unless the motor AND its provider are
  both `enabled` and it has a usable key — exactly "the verifier is off" for
  the endpoint. `/admin/motores` (`ModeloForm.tsx`) got a "Usar como
  verificador" checkbox with the requested hint line, `PATCH
  /api/admin/models/:id` clears any previous `isVerifier: true` in the same
  transaction as the new one (mirrors the existing `isDefault` transaction),
  and — unlike `isDefault` — a direct `isVerifier: false` PATCH is honored
  (the verifier has a legitimate "off entirely" state; `isDefault` never
  did). `e2e/m3-motores.ts` (38 scenarios) still passes untouched.
- `src/lib/ai/prompt.ts`: new `reglasDelArnes()`, exported — slices
  `BASE_PROMPT` between `## Que funcione de verdad` and `## Calidad
  pedagógica` and drops the tests example. Simpler than the experiment's
  version (`experimentos/razonamiento/verificar.ts`): that one read
  `prompt.ts` off disk and had to un-escape backticks from the raw `.ts`
  source; this one slices the already-evaluated `BASE_PROMPT` string, so
  there's nothing to un-escape. The drop-the-example regex also had to
  change from T1: the example is now wrapped in its own `<script
  data-kodu-pruebas>…</script>` line, so the old
  `/window\.__koduPruebas=\[.*\];\n/` no longer matches (`];` isn't followed
  by `\n` anymore, `</script>` is) — replaced with a regex that drops the
  whole `<script data-kodu-pruebas>` line.
- `src/lib/ai/verificador.ts` (new, isomorphic): `construirSistemaVerificador`/
  `construirUsuarioVerificador` port the experiment's `sistema`/`usuario`
  verbatim in wording; `htmlParaVerificador` plegs the canonical kit block
  (`plegarKit`, same as the prompt already did) AND replaces every `<script
  data-kodu-pruebas>…</script>` with `<!-- pruebas automáticas plegadas -->`
  so the verifier never reads the `eval("...")`-wrapped JSON string T1 left
  there. `parsearVerificacion` ports `parsear` (plain JSON / fenced ```json```
  / text-around-JSON, `null` on no parseable `{"problemas":[...]}`) and adds
  per-item `normalizarProblema`: `gravedad`/`tipo` checked against the closed
  vocabulary, the three text fields trimmed and capped at 400 chars
  (truncated, never rejected for length), invalid entries dropped without
  invalidating the rest of the pass. `unirPasadas` merges passes by union,
  treats two problems of the **same `tipo`** whose `que` word-overlap (of
  words >2 chars, Jaccard against the smaller set) is ≥0.6 as the same
  finding (keeps the more severe), sorts by severity, caps at 6.
  `pedidoDocente(original, ajuste)` builds the teacher-request text.
  `problemasAccionables`/`construirMensajeCorreccionVerificador` filter out
  `tipo: 'contenido'` (content issues are informational only, never
  auto-fixed) and build the short Spanish correction message.
  `razonamientoVerificador` (`provider.ts`): fixed `reasoning_effort:
  'medium'` (or `{thinking:{type:'enabled'}}` for a `thinking` dialect motor),
  never the model's own configured level — same "unknown dialect sends
  nothing" gate as `razonamiento`/`razonamientoCorreccion`.
- `POST /api/chat/verificar` (`src/pages/api/chat/verificar.ts`): same gate
  order as `autocorreccion.ts` (access → demo-closed → body → project
  ownership → fingerprint) up through project resolution; from there it
  deliberately diverges — `motorVerificador() === null`, the demo quota, and
  the per-user token cap all answer `200 {estado:'desactivado'|'sin-cupo'}`
  instead of a `fail()`, since this runs silently and a hard error would be
  an alarm about something the teacher never asked for. The teacher-request
  text is the first non-undone `role:'user'` message of the project's chat
  (any thread, same scope as `checklistActual`) plus, for `tipo:'ajuste'`,
  the latest non-undone user message when it differs from the first. `nuevo`
  runs 2 passes in parallel (`Promise.all`), `ajuste` runs 1; each pass is
  `sinHerramientas`, `razonamientoOverride: razonamientoVerificador(...)`,
  `maxTokensOverride: min(16000, provider.maxOutputTokens)`, its own
  `AbortController` (150 s timeout, bridged to `request.signal` so a client
  disconnect aborts it too), and records its own `TokenUsage` row when it
  returns usage — regardless of whether the text parsed. All passes failing
  or unparseable → `200 {estado:'error'}` (each pass already logged its own
  reason, with the pass detail but never the key). No `ChatMessage`, no
  `ProjectSnapshot`, no `Project.currentHtml` write anywhere in this
  endpoint.
- `POST /api/chat/autocorreccion` (`src/pages/api/chat/autocorreccion.ts`):
  new optional `problemasVerificador` (1..6, loose zod shape at the
  boundary, then run through the SAME `normalizarProblema` the verifier uses
  on the model's own output — "validated like above" is exactly not
  duplicating that criterion). With at least one ACTIONABLE problem (never
  `contenido`, filtered by `construirMensajeCorreccionVerificador` itself),
  that's the correction input instead of the self-test informe; everything
  else (engine = the project's own generator, `razonamientoCorreccion`
  "low", `TokenUsage`, no `ChatMessage`) is unchanged. The existing request
  shape (the self-test fields, no `problemasVerificador`) still produces
  exactly the same behavior as before.
- Tests: `e2e/unidad-verificador.ts` (new, 27 cases) — `reglasDelArnes`
  non-empty/without the example, `htmlParaVerificador` folding, the two
  prompt builders, `pedidoDocente`, `parsearVerificacion` (all 3 JSON shapes,
  invalid-JSON → null, invalid entries dropped without sinking the pass, the
  6-item cap), `normalizarProblema` (trim+cap, reject on missing/invalid
  fields), `unirPasadas` (dedupe by tipo+overlap keeping the more severe,
  distinct tipo/text NOT fused, severity order, 6-item cap after merging,
  empty input), `problemasAccionables`/`construirMensajeCorreccionVerificador`
  filtering `contenido`. `e2e/verificador-endpoint.ts` (new, browser-driven
  via `page.request`, real Chromium + `npm run dev` + the mock): a
  Responses-format provider/model pair (`kodu-mock-verificador-t3`, reusing
  the shared `kodu-mock-t3` Chat-Completions pair for the project's own
  generator) exercises, in order: `desactivado` before `isVerifier` is set;
  `ok` for `tipo:'nuevo'` with 2 real parallel `/v1/responses` requests,
  asserting each has no `tools`/`tool_choice`, `reasoning.effort:'medium'`,
  and a folded HTML with no `__koduPruebas` in the clear; 2 `TokenUsage`
  rows; `ok` for `tipo:'ajuste'` with exactly 1 request whose user message
  carries both the original request and the labelled last one; a stale
  fingerprint → 409 with zero calls; a garbage mock response → `{estado:
  'error'}`, still 200; and `autocorreccion` with `problemasVerificador`
  producing a correction that cites the actionable problem and never the
  `contenido` one. Also ran, unchanged, to prove the old shapes: `npx tsx
  e2e/m3-motores.ts` (38/38), `npx tsx e2e/t11-autoprueba.ts` (self-test →
  autocorrection through the real editor UI, 4 scenes), `npx tsx
  e2e/t12-checklist-pruebas.ts` (checklist → autocorrection, 5 scenes) — the
  closest things this repo has to "an existing autocorreccion e2e", since no
  file calls that endpoint directly by URL string.
- Checks: `npx tsc --noEmit` clean. `npx tsx e2e/unidad-verificador.ts`
  27/27, `npx tsx e2e/unidad.ts`, `npx tsx e2e/unidad-responses.ts` (already
  had a T2-authored case asserting the "medium" reasoning override maps to
  `reasoning.effort:"medium"` in the Responses dialect — still passes),
  `npx tsx e2e/unidad-kit.ts`, `npx tsx e2e/unidad-pruebas-aisladas.ts` all
  pass unchanged. `npx prisma migrate status`: applied, database in sync (25
  migrations). With `npm run dev` on :3000 + the mock on :4790: `npx tsx
  e2e/verificador-endpoint.ts` all scenes pass, `npx tsx e2e/m3-motores.ts`
  38/38, `npx tsx e2e/t11-autoprueba.ts` and `npx tsx
  e2e/t12-checklist-pruebas.ts` all scenes pass. Dev server stopped with
  `npx astro dev stop` afterward (confirmed no leftover `astro` process,
  only `kodu_db_dev` still running).
- Left open (T4/T5, out of scope for T3): no real gpt-6-luna call was made
  (T5's job); the editor never calls `/api/chat/verificar` yet — nothing in
  the app triggers it until T4 wires the post-autoprueba panel and the
  "¿Las arreglo?" button. `problemasVerificador` is a working, tested INPUT
  shape for `/api/chat/autocorreccion`, but nothing produces it yet outside
  this task's own e2e.
- Design decisions the task text didn't fully settle:
  - The task only said "per-user token cap reached → 200
    `{estado:'sin-cupo'}`". I made the DEMO-wide quota check answer the same
    `sin-cupo` (instead of `autocorreccion`'s `fail(...,429)`), since both
    are "out of quota" for a feature that's supposed to run silently in the
    background — a hard 429 here would be an error about a request the
    teacher never made.
  - `isVerifier` can be PATCHed directly to `false` (added to the normal
    `cambios` builder, not routed through the `isDefault`-style
    "only-ever-set-to-true" transaction branch): unlike the default engine,
    "no verifier at all" is a legitimate, intended state that the admin
    checkbox needs to be able to reach by unchecking it.
  - The three verifier problem text fields (`que`/`como_reproducir`/
    `arreglo`) are capped at 400 characters each (truncated, not rejected) —
    a value picked by analogy to this file's existing per-field caps
    (`ErrorAutoprueba.mensaje` 300, `ResultadoPrueba.detalle` 200), sized up
    because a verifier finding is a fuller description than a one-line
    checklist item, not a number stated anywhere in the task.
  - `unirPasadas`'s duplicate threshold (same `tipo`, ≥60% word-overlap of
    `que` against the smaller word set) is a calibrated-by-hand constant —
    the task said "high normalized-word overlap" without a number.
