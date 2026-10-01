# Token savings and real cost

Branch `feat/ahorro-tokens` (worktree `~/projects/kodu-wt/ahorro`), cut from `feat/planes-y-cobros` 44cb801, where the FREE plan exists.

## Objective

1. The USD cost the app shows and charges must match what the provider actually bills. DeepSeek bills half price off-peak, and the app always uses the peak price, so it overstates cost by about 2x. A resource that cost USD 0.32 at DeepSeek showed as about USD 0.67.
2. Reduce token spend for free-plan users without visibly lowering quality.

## Facts (verified)

- DeepSeek official pricing (api-docs.deepseek.com/quick_start/pricing, read 2026-10-01): off-peak is half of peak. Peak is 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday, excluding Chinese public holidays. Every other hour is off-peak, including weekends and holidays.
- Cost is frozen per TokenUsage row in `calcularCostoTurno`/`recordUsage` (`src/lib/ai/usage.ts`). Prices are flat per AiModel; there is no notion of time. Personal-account credits are debited from that same frozen cost.
- The Taller de ideas (`src/pages/api/taller/[id]/turno.ts`) uses the default engine with its configured reasoning level; it never passes `razonamientoOverride`.

## Scope and constraints

- Artifacts in English, Spanish UI copy matching the existing app.
- Migrations must sort after `20261015000000`.
- Do not change prices or behavior for models with no schedule configured.
- TDD: not configured for this repo (no TDD setting found); run ordinary functional checks.

## Tasks

- [x] T1 Time-of-day pricing: an AiModel can declare a peak schedule and an off-peak price factor; the cost of a turn is computed with the price that applied at the moment of the call. DeepSeek models get the official schedule. Existing DeepSeek TokenUsage rows that fall off-peak are recomputed (cost and the credits already debited stay consistent). Editable from `/admin/motores`. Route: delegated (2+ non-trivial files). Commit `f7caa9e`.
- [x] T2 Taller de ideas without reasoning for free-plan users (personal accounts on the FREE plan). Route: delegated, together with T1 (same writer). Commit `b4cdc6a`.
- [x] T3a Fragment editing (`edit_resource_code`): adjustments/corrections can edit only the changed fragments instead of rewriting the full HTML. Route: delegated (single writer, same isolated worktree/DB/PORT). Commits: see below.
- [x] T3b Measure real cost of T3a against DeepSeek with real money, on a tight budget (~USD 0.30 cap; actual spend USD 0.14 for the clean 12-call run). Quality is NOT judged here — a blind evaluation package was produced for the owner/a separate evaluator. Route: delegated (same writer/worktree/DB/PORT). Pending the owner's decision on the two open items noted in the T3b section (blind-eval verdict, and whether to turn the switch on).

- [x] T3c Blind quality evaluation of the 12 T3b outputs (6 Claude evaluators, one per adjustment, A/B randomized; each diffed against base and exercised in headless Chromium). Route: delegated (parallel read-only evaluators). Unblinded with `experimentos/fragmentos/ciego/*__clave.json`:

  | case | full | fragments | winner |
  |---|---:|---:|---|
  | media-mediana-moda / logic | 5 (did not fix the bug, added effects) | 9 (one-line CSS fix) | fragments |
  | media-mediana-moda / visual | 10 | 10 (byte-identical) | tie |
  | tiro-al-blanco / logic | 3 (counter stuck at 1, broke internal test c1) | 9 | fragments |
  | tiro-al-blanco / visual | 8.5 | 9 | fragments |
  | vecinos-1810 / logic | 9 | 9 | tie |
  | vecinos-1810 / visual | 10 | 10 | tie |

  Averages: full 7.6, fragments 9.3. Fragments never lost: 3 wins, 3 ties. Full rewrites caused the only regressions, because they re-emit untouched code. Sample: 6 cases, one sample each. Recommendation: turn `fragmentEditsEnabled` on for every plan, not only FREE.
- [x] T4 Per-turn trace and anonymized admin export (JSON/CSV; teachers pseudonymized, no emails or names; includes the request text). Route: delegated (single writer, same isolated worktree/DB/PORT 3300). Commit `c721d28`.
- [x] T5 Optional teacher feedback: a face on each AI reply, an occasional one-tap question, and implicit signals (a follow-up "no funciona", undo, manual code edit). Route: delegated, same writer. Commit `5a5f7a2`.
- [x] T6 Fragment editing is the only edit path for adjustments: `fragmentEditsEnabled` removed everywhere; adjustment turns offer ONLY `edit_resource_code` on the first attempt; `update_resource_code` stays for new resources and the single same-turn recovery. Also fixed the stale `taller-de-ideas.ts` 403-vs-200 e2e. Route: delegated (single writer, same isolated worktree/DB/PORT 3300). Commit `94e2a14`.
- [x] T7 Model presets defined in code (`src/lib/ai/presets.ts`): `AiModel.presetKey` links a row to a typed preset; pricing/schedule/holidays are read from the preset at call time. `/admin/motores` gets a preset selector. Migration links existing DeepSeek/luna models and re-runs the T1 holiday backfill with the now-known 2026 calendar. Route: delegated, same writer. Commit `21164cd`.
- [x] T8 Lower the real value of a credit: FREE stays 100/50 (owner's final call); `BillingSettings.creditUsdValue` 0.0025 → 0.001; `IndividualPlan(INDIVIDUAL).monthlyCredits` 1,000 → 2,500 (still USD 2.50/month). Also found and fixed a gap: no migration ever inserted the FREE/INDIVIDUAL rows (only `seed.ts` did, and production's entrypoint never runs the seed) — a genuinely fresh prod deploy would have booted with an empty `IndividualPlan` table. Route: delegated, same writer. Commits `d8d0eb8`, `f23ce5d` (a hardcoded `1000` credit assertion in `planes-cobro.ts`, found by the combined `test:cobros` run below).

## Levers (analysis, 2026-10-01)

- Every adjustment rewrites the full HTML through `update_resource_code`, and each teacher message can trigger up to 3 full rewrites automatically: the turn plus 2 self-correction rounds.
- The verifier (gpt-6-luna, 2 passes, about USD 0.004 per new resource, paid to OpenAI) is about 1% of a USD 0.32 resource. Removing it saves little.

## Acceptance

- A DeepSeek turn made off-peak is recorded at half the peak price; a peak turn is recorded at full price; a model with no schedule is unchanged.
- A free user's Taller turn is sent with reasoning disabled; a paid or org user's turn keeps the engine's level.
- `npm run check` passes; the relevant unit and e2e suites pass.

## Progress

Both T1 and T2 implemented, verified and committed on `feat/ahorro-tokens`. Route: delegated (single writer, isolated worktree `~/projects/kodu-wt/ahorro`, isolated DB `koduedu_ahorro` cloned from `koduedu_planes`, PORT 3300).

### T1 — time-of-day pricing (commit `f7caa9e`)

- `src/lib/ai/pricing.ts` (new): `PriceSchedule`, `isOffPeak`, `precioVigente(precios, schedule, at)`, `scheduleFromAiModel`. Pure module, no Prisma/Node.
- `prisma/schema.prisma`: `AiModel.priceOffPeakFactor` (Decimal(4,3)), `.peakWindowsUtc` (Json), `.offPeakDatesUtc` (Json). `null` factor = no schedule = unchanged behavior.
- `src/lib/ai/provider.ts` (`ProviderConfig.schedule`), `src/lib/ai/catalogo.ts` (`construirConfig` builds it via `scheduleFromAiModel`).
- `src/lib/ai/usage.ts`: `UsageRecord.schedule`/`.at` (both optional); `recordUsage` resolves `precioVigente(record.precios, record.schedule, record.at ?? new Date())` before `calcularCostoTurno`. `at` defaults to the moment `recordUsage` runs (turn already finished by then) — same approximation `TokenUsage.createdAt` already uses.
- Wired into every `recordUsage` caller (`stream.ts` x3, `verificar.ts`, `autocorreccion.ts`, `turno.ts`): each now also passes `schedule: <provider>.schedule`.
- `estimarCostoConservador` verified unaffected on purpose: it only activates when the used model has NO price loaded at all (orthogonal to time-of-day); no schedule logic needed there.
- Migration `prisma/migrations/20261016000000_time_of_day_pricing/migration.sql`: adds the columns, sets the official DeepSeek schedule (peak 01:00-04:00 and 06:00-10:00 UTC, Mon-Fri, factor 0.5, identified by `AiProvider.baseUrl ILIKE '%api.deepseek.com%'`), backfills `TokenUsage.costUsd`/snapshots for off-peak rows of those models (scaling every snapshot by the same factor — exact since cost is linear in the three snapshots), and refunds the credit-ledger difference for personal-account rows as a new `ADJUSTMENT` entry (ledger stays append-only). All three steps are idempotent, guarded by comparing `priceInputSnapshot` against the model's flat price (re-running changes nothing — verified by replaying the SQL file against the cloned DB).
- Admin `/admin/motores` (`ModeloForm.tsx`): new "Horario de pico" fieldset — off-peak factor, peak windows as plain text (`día hora_inicio-hora_fin` per line), holiday dates. Minimal, follows the existing form's patterns.
- Unit tests: `e2e/unidad-ahorro-tokens.ts` (13 tests) — peak hour, off-peak hour, both window edges (01:00 inclusive, 04:00 exclusive), weekend, listed holiday, model without schedule, no-cached-price safety, `scheduleFromAiModel` round-trip.

### T2 — Taller without reasoning for FREE (commit `b4cdc6a`)

- `src/lib/taller/razonamiento.ts` (new): `esTallerSinRazonamiento` (pure decision, unit tested) + `debeTallerDesactivarRazonamiento` (async resolver, reuses `suscripcionIndividualVigente` — now exported from `src/lib/billing/creditos-servicio.ts` — so this can never disagree with `ensureGrants` about who is on FREE).
- `src/pages/api/taller/[id]/turno.ts`: computes `sinRazonamiento` once per turn and passes `razonamientoOverride: razonamientoNulo(candidato)` per fallback-chain candidate when true; `undefined` (engine's configured level) otherwise.
- Unit test: `e2e/unidad-taller-razonamiento.ts` (3 tests: FREE personal, paid personal, org member).
- e2e assertion (cheap, reused existing flow): `e2e/taller-de-ideas.ts` now configures the mock model with `reasoningEffort: 'high'` and asserts the first turn's actual request body carries `reasoning_effort: 'none'` for `DOCENTE_EMAIL` (a personal account with no `IndividualSubscription` row = FREE).

### Verification (foreground, against the isolated worktree/DB/PORT 3300)

- `npm run check`: clean, no errors.
- `npx tsx e2e/unidad-ahorro-tokens.ts`: 13/13 OK (T1).
- `npx tsx e2e/unidad-taller-razonamiento.ts`: 3/3 OK (T2).
- `npx tsx e2e/unidad.ts`: all OK (includes `calcularCostoTurno`, `razonamiento`/`razonamientoNulo`/`razonamientoCorreccion` suites — no regression).
- `npx tsx e2e/unidad-creditos.ts`: all OK.
- `npx tsx e2e/m4-costos.ts`: all cost/credit assertions OK; one unrelated failure at the end in a Playwright hover-popover UI step (`esperarHasta` timeout) — pre-existing browser-interaction flakiness, not a pricing assertion, not touched by this change.
- `npx tsx e2e/taller-de-ideas.ts`: all OK except one pre-existing, unrelated failure — "una cuenta personal (sin IA) no puede abrir el Taller" expects 403 and gets 200. Reproduces identically with and without T1/T2 changes; caused by access-control/credits interaction from `feat/planes-y-cobros`, not by this branch. Not fixed (out of scope for T1/T2).
- `npm run test:cobros` (PORT=3300): 11/11 scripts green (unidad-planes, unidad-creditos, unidad-pasarela, unidad-facturador, planes-acceso, planes-alta, planes-cobro, planes-paginas, planes-superadmin, planes-facturacion, planes-recorrido).
- `npx prisma migrate deploy` on `koduedu_ahorro` (cloned from `koduedu_planes`): applied cleanly. Backfill results: 18 DeepSeek `AiModel` rows got the schedule; 98 `TokenUsage` rows recomputed (all 98 happened to fall off-peak in this dataset — all e2e-test fixtures, none belonging to a personal account, so 0 `ADJUSTMENT` ledger refunds were needed here — the refund path exists and was code-reviewed but not exercised by this particular dataset). Re-running the migration SQL by hand against the same DB changed 0 additional rows (idempotency verified directly). Example row: `aiModelId` priced at `priceInputPerMToken=0.150000`; after backfill `priceInputSnapshot=0.075000` (factor 0.5), `costUsd` scaled by the same factor.

### Notes for the owner

- DeepSeek's Chinese-holiday list was **not** seeded (`offPeakDatesUtc: []` by default) — no holiday calendar source was given; add actual dates via `/admin/motores` or a follow-up migration when available.
- T1 commit is self-contained and cherry-pickable to main on its own; the one `schedule: usado.schedule` line it adds to `turno.ts` is harmless without T2 (same behavior as before T1 for the Taller until T2 also lands).
- The pre-existing `taller-de-ideas.ts` "cuenta personal sin IA" failure and the `m4-costos.ts` browser-popover flake are both unrelated to this change; flagging them here since they surfaced during verification.

### T3a — fragment editing (`edit_resource_code`)

- `src/lib/ai/tools.ts`: `EDIT_RESOURCE_CODE`/`EDIT_RESOURCE_TOOL` (tool schema: `edits: {find, replace}[]`) and `parseEditResourceArgs` (JSON/shape validation only — never touches HTML). Added a shared `AiTool` interface so `provider.ts` can hold both tool defs in one typed array.
- `src/lib/ai/edits.ts` (new, pure): `applyResourceEdits(htmlReal, edits, maxVisibleChars)` — all-or-nothing. Validates, for every edit, exactly one match in the REAL stored HTML (never the folded/truncated prompt view), that the match doesn't fall inside the kit's canonical block, that it doesn't start at/after the point the prompt's `MAX_HTML_CHARS` cut the (folded) document, and that matched ranges across edits don't overlap — only then splices all replacements. `src/lib/ai/kit.ts` gained `rangoBloqueKit`/exported marker length so `edits.ts` can map the "folded" and "truncated" boundaries from the visible (plegado) HTML back to real offsets.
- `src/lib/ai/provider.ts`: `requestCompletionStream`/`intentarUna` gained `editsEnabled`. When true, both tools are offered (`herramientasDeEscritura`) and a forced turn uses `tool_choice: 'required'` instead of naming `update_resource_code` — naming one tool would remove the model's ability to pick fragments. Both Chat Completions and Responses API dialects covered.
- `src/pages/api/chat/stream.ts`: `editsEnabled = forzar && !recursoInicial && settings.fragmentEditsEnabled` (never for a brand-new resource). New tool-call branch for `EDIT_RESOURCE_CODE`, applied against `htmlAlInicioDelTurno` (the real HTML the turn started with — nothing else mutates it earlier in the same turn). On success: same `{type:'code', html}` event as a full rewrite (Workspace.tsx/iframe path untouched). On failure (0/2+ matches, invalid/truncated JSON, folded/truncated region, overlap): the resource is NOT touched, and the turn gets ONE recovery attempt reusing the turn's existing single-retry plumbing — the model is told exactly which `find` failed and why, and may resend corrected edits or fall back to `update_resource_code`. A second failure is NOT retried again (`recuperacionDeEdicionIntentada` guards the pre-existing "no code at all" retry so the two paths can't stack into two retries). `TokenUsage.editMode` records `full`/`fragments`/`fragments_fallback` (`fragments_fallback` = an edit failed in this turn but the recovery rewrote the full document).
- `src/pages/api/chat/autocorreccion.ts`: same two tools offered when `settings.fragmentEditsEnabled` (autocorrection is always on an existing resource, so no `recursoInicial` check needed); no retry loop added here — this endpoint already applied-or-didn't in one pass before T3a, same criterion now extends to a failed edit.
- `src/lib/ai/prompt.ts`: new `MAX_HTML_CHARS` export (was private) and a short mode-dependent guidance block appended to `buildCurrentResourceBlock`'s per-turn output (not `BASE_PROMPT`) — the system prompt stays byte-stable turn to turn for provider prefix caching; only the already-per-turn resource block carries the (prefer edits for localized changes / rewrite for restructures or ~1/3+ of the document) guidance, and only when `editsEnabled`.
- Schema: `AppSettings.fragmentEditsEnabled` (admin toggle, `/admin/generacion`, next to `versionsForAll`) and `TokenUsage.editMode` (nullable `EditMode` enum: `FULL`/`FRAGMENTS`/`FRAGMENTS_FALLBACK`). Migration `prisma/migrations/20261017000000_edicion_por_fragmentos/migration.sql`: adds both columns (default `true` for `fragmentEditsEnabled` at the Prisma/code level, for any row inserted after this point) and then explicitly sets the existing singleton row to `false` — verified against the cloned `koduedu_ahorro` DB (`fragmentEditsEnabled: false` read back after `prisma migrate deploy`).
- Tests: `e2e/unidad-edicion-fragmentos.ts` (22 unit tests — parse validation; single/no/multiple match; all-or-nothing; overlap; empty find; CRLF/whitespace exactness; folded kit region; truncated region; both with and without truncation). `e2e/edicion-por-fragmentos.ts` (new e2e against `e2e/mock-proveedor.ts`, extended with an optional `herramienta`/`edits`/`argumentosCrudos` on `RespuestaScript` to script an `edit_resource_code` tool call): turn 1 generates a resource and confirms `edit_resource_code` is NOT offered; turn 2 is a successful fragment edit (verifies the edit applied against the real HTML, the untouched part of the document survives, and `TokenUsage.editMode = FRAGMENTS`); turn 3 scripts a failing edit (`find` with no match) followed by a scripted recovery rewrite, and confirms the turn still finishes with code applied and `TokenUsage.editMode = FRAGMENTS_FALLBACK`.

#### Verification (T3a, foreground, isolated worktree/DB/PORT 3300)

- `npm run check`: clean.
- `npx tsx e2e/unidad-edicion-fragmentos.ts`: 22/22 OK.
- All pre-existing `e2e/unidad*.ts` suites: no regressions (same pass/fail pattern as before T3a, including the known `unidad-creditos.ts` unique-constraint retry log that was already there and still ends green).
- `npx tsx e2e/edicion-por-fragmentos.ts` (new): all 3 scenarios OK.
- `npm run test:cobros` (PORT=3300): 11/11 scripts green, same baseline as T1/T2.
- Commit `7aa5bac`.

### T3b — real-money measurement against DeepSeek (2026-10-01)

Route: delegated (single writer, same isolated worktree/DB/PORT 3300), using the `DEEPSEEK_TEST_API_KEY` test key only (never OpenCode Go, never printed, never committed).

- Balance before: **USD 2.42**. One cheap proof call first (small HTML, `fragmentEditsEnabled` off): confirmed the real tool path works (`editMode: FULL`, cost ~USD 0.00014) before spending on the full corpus — no auxiliary call used tools unexpectedly.
- Provider/model: `AiProvider` kind `deepseek-experimento-t3b` → `https://api.deepseek.com`, `AiModel` `deepseek-flash`, `reasoningEffort: 'low'`, `reasoningParam: 'reasoning_effort'`, real production prices (input 0.15 / output 0.6 / cached-input 0.003 USD per M tokens, off-peak factor 0.5), created directly via Prisma with the key encrypted through the same `cifrar()` the admin API uses.
- **Bug found and fixed mid-run**: the first attempt toggled `AppSettings.fragmentEditsEnabled` with a direct `prisma.appSettings.update()` from the runner's own Node process. `leerAppSettings()`'s 10s cache lives in the *dev server's* process, so that write never invalidated it — the toggle got stuck "on" after the first flip, and 4 of the first 6 calls silently ran in the wrong mode (confirmed in the dev-server log: `editMode` didn't match the intended `modo`). Fixed by toggling through the same `PATCH /api/admin/settings` the admin UI uses (same process as `leerAppSettings`, calls `invalidarAppSettings()`), plus a DB read-back assertion before every call. The 6 mislabeled calls (~USD 0.022) were discarded; the full 12-call run below is from the corrected runner, cut cleanly.
- Corpus: 3 resources from `/home/opencode/projects/kodu-medicion/experimentos/razonamiento/resultados/gen-mimo-pro/` (read-only, not modified) — "Vecinos de 1810" (history debate, 95.8K chars), "Media, mediana y moda" (statistics, 95.3K chars), "Tiro al blanco" (projectile physics, 84.2K chars). 2 teacher-style requests each (one visual/text, one logic/behavior) in `experimentos/fragmentos/casos.json`. Driven through the real `/api/chat/stream` as a seeded teacher account, full vs fragments mode toggled per call — 12 real calls total.
- **Result: 0 failures, 0 fallbacks.** Every call resolved in its intended mode (`editMode` always matched); the recovery-retry path (`FRAGMENTS_FALLBACK`) was never exercised by the real model — it's only been exercised by the scripted mock e2e so far.
- **Another real finding**: DeepSeek rejects `tool_choice: 'required'` (the value `provider.ts` sends when both tools are offered and the turn is forced). `requestCompletionStream`'s existing `ToolChoiceNoSoportado` fallback caught it and silently retried with `'auto'` on every fragments-enabled forced call — it still worked, but adds one extra round-trip of latency per such call (visible in the dev-server log: `"no acepta forzar la herramienta; se repite el pedido con tool_choice 'auto'"`). Not a correctness bug, but worth the owner knowing: forcing isn't free when fragments are enabled.

**Token/cost table** (full 12 calls; cost from `TokenUsage.costUsd`, DeepSeek real prices):

| case | request | mode | prompt | cached | completion | cost USD | duration | editMode |
|---|---|---|---:|---:|---:|---:|---:|---|
| vecinos-1810 | visual | full | 34450 | 34304 | 30018 | 0.009068 | 76.1s | FULL |
| vecinos-1810 | visual | fragments | 34964 | 34816 | 475 | 0.000206 | 3.6s | FRAGMENTS |
| vecinos-1810 | logica | full | 34460 | 4736 | 31058 | 0.011554 | 80.3s | FULL |
| vecinos-1810 | logica | fragments | 34974 | 34816 | 4838 | 0.001515 | 22.2s | FRAGMENTS |
| media-mediana-moda | visual | full | 34676 | 4736 | 30069 | 0.011273 | 76.5s | FULL |
| media-mediana-moda | visual | fragments | 35190 | 34944 | 391 | 0.000188 | 3.5s | FRAGMENTS |
| media-mediana-moda | logica | full | 34682 | 4736 | 44456 | 0.015590 | 139.4s | FULL |
| media-mediana-moda | logica | fragments | 35196 | 4864 | 20317 | 0.008377 | 92.5s | FRAGMENTS |
| tiro-al-blanco | visual | full | 30881 | 4736 | 26771 | 0.009999 | 70.6s | FULL |
| tiro-al-blanco | visual | fragments | 31395 | 4864 | 424 | 0.002124 | 4.2s | FRAGMENTS |
| tiro-al-blanco | logica | full | 30888 | 4736 | 27482 | 0.010213 | 72.8s | FULL |
| tiro-al-blanco | logica | fragments | 31402 | 4864 | 2206 | 0.002659 | 9.7s | FRAGMENTS |

**Averages (6 calls each):** full — completion 31,642 tok, cost USD 0.011283, duration 86.0s. fragments — completion 4,775 tok, cost USD 0.002512, duration 22.6s (skewed by one 92.5s outlier; median ≈ 6.9s). That's an **85% cut in completion tokens** and **78% cut in cost** on average, with one case (`media-mediana-moda/logica`, a non-trivial DOM+highlight behavior change) only getting a 46% token cut — the lever works best on localized changes and still helps, less dramatically, on changes that genuinely touch more of the document.

- Balance after: **USD 2.23** (not the cheap proof call's balance read, which still showed 2.42 at 2-decimal display). Total real spend across both runs (buggy + corrected): **USD 0.19** (well under the USD 0.30 cap); the corrected 12-call run alone spent **USD 0.14**.
- Outputs: per-call final HTML in `experimentos/fragmentos/resultados/<caso>__<pedido>__<modo>.html`; machine-readable table in `experimentos/fragmentos/resumen.json`; blind evaluation package (base HTML + request + A/B HTML with the A/B key in a separate file, NOT evaluated by this writer) in `experimentos/fragmentos/ciego/` — 6 cases × (`base.html`, `pedido.txt`, `A.html`, `B.html`, `clave.json`).

#### For the owner to decide

- Quality was not judged here on purpose (the task reserves that for blind evaluators) — only `experimentos/fragmentos/ciego/` exists; nobody has looked at whether the A/B pairs are equivalent in quality.
- The one real compatibility wrinkle (`tool_choice: 'required'` rejected by DeepSeek, falls back to `'auto'` automatically) costs one extra round trip per forced+fragments call; harmless today but worth knowing if DeepSeek's dialect is ever tightened elsewhere.
- `fragmentEditsEnabled` is still `false` on every existing database (by migration design) — turning it on for real teachers is a separate, explicit step once the blind evaluation confirms quality holds.

### T4 — per-turn trace and anonymized admin export (commit `c721d28`)

Route: delegated (single writer, same isolated worktree/DB/PORT 3300).

- `prisma/schema.prisma`: new model `AiTrace` — one row per AI turn that touches a resource, linked 1:1-optional to `TokenUsage` (`tokenUsageId`) and `ChatMessage` (`chatMessageId`) so model/tokens/cost are read by join instead of duplicated. Fields: `userId`/`organizationId` (frozen at call time, same criterion as `TokenUsage.organizationId`), `planAtCall` ('FREE'/'INDIVIDUAL'/'ORG'), `turnKind` (reuses `UsagePurpose`), `model`, `reasoningEffort`, `requestText` (the teacher's message, verbatim), `editOutcome` (new enum `TraceEditOutcome`: FULL/FRAGMENTS/FRAGMENTS_FALLBACK/FAILED — `FAILED` has no `TokenUsage.EditMode` equivalent, see the schema comment), `retries`, `truncated`, `htmlCharsBefore`/`htmlCharsAfter`, `durationMs`, `selfTestPassed`/`selfTestFailed`, `correctionRounds`, `verifierFindings`. T5's feedback columns live on the same row (see below). Migration `prisma/migrations/20261018000000_trazas_y_feedback/migration.sql`, applied cleanly to `koduedu_ahorro`.
- `src/lib/ai/trace.ts` (new): `recordAiTrace` (best-effort, try/catch, never throws — a trace failure can never break a turn), `resolverPlanDeCuenta`. `src/lib/ai/usage.ts#recordUsage` now returns `{id}|null` so the trace can reference the `TokenUsage` row it belongs to.
- Wired at the 5 required call sites: `src/pages/api/chat/stream.ts` (main turn: GENERATION/ADJUSTMENT — retries/truncation/html-char-deltas/duration all tracked live during the turn; EXTRA_VERSION inside `generarVersionSecundaria`), `src/pages/api/chat/autocorreccion.ts` (CORRECTION, self-test pass/fail from `pruebas`/`errores.length`, `ronda`), `src/pages/api/chat/verificar.ts` (VERIFICATION, `verifierFindings` from the merged `problemas`), `src/pages/api/taller/[id]/turno.ts` (IDEATION, reused cheaply as asked).
- Export: `src/lib/admin/pseudonimizar.ts` (HMAC-SHA256 keyed by `AUTH_SECRET`, per the task's explicit instruction — namespaced by prefix so a user id and an org id never collide), `src/lib/admin/csv.ts` (RFC4180 escaping), `src/lib/admin/trazas.ts` (`filasExportTrazas`, 29 columns, never the HTML). Endpoints `GET /api/admin/trazas.csv` / `.json` (`requireAdmin`, same pattern as the sibling `/api/admin/metricas.csv.ts`), filters `desde`/`hasta`/`plan`/`model`. Admin page `/admin/trazas.astro` + `TrazasPanel.tsx` (date range, plan/model filters, two download links, one-sentence anonymization copy), added to `AdminLayout.astro`'s nav.
- Tests: `e2e/unidad-trazas-export.ts` (12 unit tests — pseudonymization stability/uniqueness/prefix-separation/secret-separation, CSV escaping including comma+quotes+newline together).

### T5 — optional teacher feedback (commit `5a5f7a2`)

Route: delegated, same writer.

- `src/lib/feedback/frecuencia.ts` (new, pure): `decidirPreguntaFeedback` — first generation always asks "¿Funciona bien?"; otherwise at most every 5 resource-changing turns, alternating with "¿Te gusta cómo se ve?"; never over an unanswered question; never if the teacher opted out.
- `src/lib/feedback/clasificador.ts` (new, pure): `detectarFraseDefecto` — accent/case-insensitive substring match against a short catalog of defect phrases ("no funciona", "no anda", "error", "arregl-", "se rompió", "no hace nada", "no aparece", "sigue igual", ...).
- `AiTrace` (same migration as T4) also carries the feedback columns: `faceRating` (enum `FaceRating`: GOOD/NEUTRAL/BAD), `faceRatingComment`/`faceRatingAt`, `inlineQuestionKind`/`inlineQuestionAnswer`/`inlineQuestionAt`, `suspectedDefect`/`suspectedDefectPhrase`, `undoneSignal`, `codeEditedByTeacherSignal`. `User.feedbackPromptsDisabled` and `Project.feedbackTurnsSinceAsk`/`.lastFeedbackPromptKind` hold the frequency state.
- UI: `src/components/workspace/FeedbackTurno.tsx` (new) — a 3-face row under each AI reply that changed the resource (never on a text-only or undone turn), with an optional one-line "¿Qué falló?" box after a bad rating; `PreguntaFeedback`, an inline chat bubble (never a modal) with Sí/Más o menos/No and "No preguntar más". Wired into `ChatPanel.tsx`'s message loop and `Workspace.tsx` (optimistic local state, `POST /api/projects/[id]/feedback`, new endpoint, toggling a face off on a second tap of the same one).
- Implicit signals, all in `src/lib/ai/trace.ts`: `aplicarSenalesImplicitas` (called from `stream.ts` on every new turn, before calling the model) marks the PREVIOUS turn's trace `suspectedDefect`/`suspectedDefectPhrase` when the new message matches `detectarFraseDefecto`, and `codeEditedByTeacherSignal` from the existing `codeEditedByTeacher` ref already threaded through `Workspace.tsx`/`/api/chat/stream` — no new plumbing needed for that one. `marcarTrazaDeshecha` (called from `src/pages/api/projects/[id]/undo.ts`) sets `undoneSignal`.
- Tests: `e2e/unidad-feedback-y-trazas.ts` (14 unit tests — frequency rule incl. the "first generation"/"5 turns"/"alternation"/"opted-out"/"not twice in a row" cases, defect classifier incl. accents and multiple phrase variants).

### Verification (T4/T5, foreground, isolated worktree/DB/PORT 3300)

- `npm run check`: clean.
- `npx tsx e2e/unidad-trazas-export.ts`: 12/12 OK.
- `npx tsx e2e/unidad-feedback-y-trazas.ts`: 14/14 OK.
- `npx tsx e2e/feedback-y-trazas.ts` (new e2e, against `e2e/mock-proveedor.ts`): generation → `feedbackPrompt: 'FUNCIONA'` on the first turn, `AiTrace` linked to its `ChatMessage` and `TokenUsage`; adjustment → its own `AiTrace` (`ADJUSTMENT`, `editOutcome: FULL`); a "no funciona, arreglalo" follow-up → the ADJUSTMENT trace flips `suspectedDefect: true` / `suspectedDefectPhrase: 'no funciona'`; a face rating saved through `POST /api/projects/:id/feedback` (same route the UI uses); the admin JSON export contains both trace rows, pseudonymized, and the docente's email never appears anywhere in the export body. All assertions passed.
- All pre-existing `e2e/unidad*.ts` suites: no regressions.
- `npx tsx e2e/edicion-por-fragmentos.ts`: all 3 scenarios still pass (no regression from the trace hooks added inside `stream.ts`).
- `npm run test:cobros` (PORT=3300): 11/11 scripts green, same baseline as T1/T2/T3a.
- `npx tsx e2e/taller-de-ideas.ts`: only the pre-existing known failure ("una cuenta personal (sin IA) no puede abrir el Taller", 403-vs-200), everything else green — same as before this change.
- `npx tsx e2e/m4-costos.ts`: all scenarios passed in this run (the listed hover-popover flake did not reproduce this time).
- Screenshots: `experimentos/feedback-capturas/desktop-1280x800.png` and `experimentos/feedback-capturas/mobile-390.png` (headless `/usr/bin/chromium --disable-gpu`, `fullPage: true` to sidestep the known headless-Chromium viewport-height clamp), both showing the face row and the "¿Funciona bien?" inline question together under the same turn. Captured by `e2e/capturas-feedback.ts` (one-off script, not part of the regular e2e battery).

### Open decisions for the owner (T4/T5)

- T5's inline-question/frequency logic only fires on GENERATION/ADJUSTMENT turns (not correction/verification/extra-version/Taller) — a deliberate scoping call, since those are the only turns with a visible chat reply worth asking the teacher about. Worth confirming this matches the intent.
- The all-providers-failed path in `stream.ts` (before the model ever streams back anything) does not create a trace — no turn-level work happened yet, so there is nothing to record; flagging it for visibility.
- Verification traces (`verificar.ts`) don't link a specific `tokenUsageId`: a new resource runs 2 passes in parallel, each writing its own `TokenUsage` row, and picking one arbitrarily seemed worse than leaving the FK `null` — the export can still be cross-referenced by project/time if needed.
- `/opt/pw-browsers/chromium` (named in the task) does not exist in this environment; the screenshots and all e2e browser tests use `/usr/bin/chromium` (the same binary `e2e/harness.ts` already standardizes on).

### T6 — fragment editing is the only edit path for adjustments

Route: delegated (single writer, same isolated worktree/DB/PORT 3300).

- `prisma/schema.prisma`: removed `AppSettings.fragmentEditsEnabled`. Migration `prisma/migrations/20261019000000_quitar_interruptor_fragmentos/migration.sql` drops the column (idempotent `DROP COLUMN IF EXISTS`).
- `src/lib/ai/provider.ts`: new `soloEdicion` option alongside `editsEnabled`. `herramientasDeEscritura`/`eleccionForzada` now take both: `soloEdicion: true` offers and forces ONLY `edit_resource_code` by name (never `'required'`); `editsEnabled && !soloEdicion` offers both and forces `'required'` (the recovery case); neither offers/forces only `update_resource_code` by name (new resource, unaffected).
- `src/pages/api/chat/stream.ts`: `editsEnabled = forzar && !recursoInicial` (no longer gated by the removed setting). First attempt passes `soloEdicion: editsEnabled`. The existing single-recovery-after-a-failed-edit call explicitly sets `soloEdicion: false` (both tools, `'required'`) — unchanged mechanism from T3a, just now always reachable instead of only when the switch was on.
- `src/pages/api/chat/autocorreccion.ts`: same `soloEdicion: true` first attempt (`editsEnabled = true`, hardcoded — no switch left to read). Added the same one-shot recovery mechanism stream.ts already had (this endpoint didn't have one before T6, since before T6 a failed edit there just... failed): on a failed `edit_resource_code`, one retry with both tools offered (`soloEdicion: false`); `TokenUsage.editMode` now also records `fragments_fallback` here (previously only `full`/`fragments`), via a `huboFalloDeEdicion` flag threaded through the shared mutable `resultado` object (same "object, not a loose `let`" pattern as `estadoEdicion`/`totales` elsewhere in this file — a loose `let` only ever assigned inside the nested `consumir` closure gets typed by TypeScript as its initial value forever outside that closure).
- `src/lib/ai/prompt.ts`: rewrote `GUIA_EDICION_POR_FRAGMENTOS` — no longer "which of two tools to pick," since there's only one on the first attempt. Explains localized edits AND large redesigns both go through `edit_resource_code` (big `find`/`replace` blocks for a big redesign, e.g. the whole `<body>`). System prompt stays byte-stable (this guidance lives in the per-turn resource block, same as T3a).
- `src/lib/ai/tools.ts`: updated the `EDIT_RESOURCE_TOOL` doc comment (no code change — the schema itself didn't need to change).
- Admin: removed the "Edición por fragmentos en ajustes" toggle from `GeneracionPanel.tsx`, the `fragmentEditsEnabled` field from `/api/admin/settings` (`zod` schema) and `ResumenGeneracion`/`resumenGeneracion()` (`src/lib/admin/generacion.ts`).
- Historical artifacts (T3b): `experimentos/fragmentos/prueba-barata.ts` and `experimentos/fragmentos/runner.ts` both referenced the removed column directly (`prisma.appSettings.update(...)`, a PATCH body, and a read-back assertion) — would no longer compile. Annotated as historical and adapted minimally so they still typecheck: the proof-call script just drops the now-pointless "turn the switch off" line (a new-resource generation never offered the second tool regardless); the A/B runner's `fijarInterruptor` became a documented no-op and the read-back assertion was removed, since there's nothing left to toggle or verify — the surrounding loop structure is kept intact as a readable record of how T3b's real-money measurement was run.
- `e2e/taller-de-ideas.ts`: fixed the stale "una cuenta personal (sin IA) no puede abrir el Taller" test. Read `resolverAccesoIa` (`src/lib/orgs/acceso.ts`): a personal account (no `organizationId`) is allowed when `balance(userId) > 0` after `ensureGrants`. Since `planes-y-cobros`, every personal account gets FREE welcome credits, so the old blanket "403" premise is false. Replaced with two tests: a personal account WITH credits gets 200 (`/api/taller`) and 200 on `/app/taller`; a second personal account whose balance is forced to a large negative via a direct `ADJUSTMENT` ledger entry gets 403/302 — matching the exact rule `resolverAccesoIa` implements, not a guess.
- `e2e/edicion-por-fragmentos.ts`: removed the `fragmentEditsEnabled` PATCH (nothing to toggle). Turn 2 now asserts the first attempt's `tools` array is EXACTLY `[edit_resource_code]` and `tool_choice` names it by `{type:'function', function:{name:'edit_resource_code'}}` (not `'required'`). Turn 3 additionally asserts, across its two calls, that the first (failed) attempt also offered only `edit_resource_code`, and the recovery call offered BOTH tools with `tool_choice: 'required'`.

#### Verification (T6, foreground, isolated worktree/DB/PORT 3300)

- `npm run check`: clean.
- `npx tsx e2e/edicion-por-fragmentos.ts`: all 3 scenarios OK, including the new tool-offering assertions (edit-only first attempt, both-tools recovery).
- `npx tsx e2e/taller-de-ideas.ts`: **fully green**, including both rewritten tests — no more known-failing case.
- All `e2e/unidad*.ts`: no regressions (ran the full battery after T6+T7+T8 together, see the combined verification below).
- `npm run test:cobros`: see the combined verification below (T6 touches none of this suite's code paths; failures observed there are unrelated to T6, see notes).

### T7 — model presets defined in code

Route: delegated, same writer.

- `src/lib/ai/presets.ts` (new, pure — no Prisma client import at the value level besides `Prisma.Decimal`/the `Prisma` namespace type, so it's safe for server-only code to import but is NEVER imported by a client-rendered React island): `ModelPreset` interface and `PRESETS` with exactly the three preset keys the task specifies — `deepseek-flash`, `deepseek-v4-pro`, `openai-gpt-6-luna` — using only the verified prices/URLs/dates from the task text. `presetByKey()` (unknown/null → `null`, never throws). `preciosDePreset()` converts to the `Precios` shape `usage.ts`/`pricing.ts` already use.
  - DeepSeek schedule: the official peak windows (01:00-04:00, 06:00-10:00 UTC, Mon-Fri) plus the 33 dates of the 2026 Chinese public holiday list from the task (State Council notice 国办发明电〔2025〕7号). Comment documents the make-up-workday ambiguity (DeepSeek's page only confirms weekends are off-peak; make-up workdays fall on weekends anyway, so they're covered without needing the ambiguous case) and why a plain UTC date check against the holiday list is correct (every peak window falls inside the same UTC calendar date as the corresponding China business day).
  - `openai-gpt-6-luna`: `responses` API format, no schedule, "medium" default reasoning (verifier use), short-context prices; comment notes OpenAI's 2x-above-272K-input pricing is intentionally NOT modeled, per the task.
- `prisma/schema.prisma`: `AiModel.presetKey String?` (nullable, no DB-level FK — just a code lookup key; an unknown/removed key falls back to the DB columns, same as `null`).
- `src/lib/ai/catalogo.ts#construirConfig`: when `presetByKey(fila.presetKey)` resolves, `precios` and `schedule` come from the preset, not from the row's own price/schedule columns — so editing `presets.ts` updates every linked model's cost at the NEXT call, with no migration. `presetKey: null` or unknown is byte-for-byte the pre-T7 behavior.
- Admin (`/admin/motores`): `src/lib/admin/modelos.ts` gained `MotorAdmin.presetKey`, `camposDePreset()` (server-side: given a `presetKey`, returns the preset-owned columns to persist — `providerModel`, `maxOutputTokens`, `reasoningEffort`/`reasoningParam`, the three prices, and the three schedule columns — always overriding whatever the client sent for those fields) and `presetsParaUI()`/`PresetUI` (a plain, Decimal-free shape for the client). `POST /api/admin/models` and `PATCH /api/admin/models/:id` accept `presetKey` and apply `camposDePreset()` AFTER the manual-field values, so a chosen preset always wins server-side regardless of what the form state held. `ModeloForm.tsx` gained a "Preset" `<select>` ("Personalizado" + each preset's label); choosing one fills and disables the price/horario-de-pico/`maxOutputTokens`/reasoning fields (shown read-only with "Valores del preset (verificados el …)" and the source URL) and suggests (never auto-creates) a matching `AiProvider` by `baseUrl` — the provider/API-key flow itself is untouched, per the task. Also added "medium" as a selectable reasoning level (`gpt-6-luna`'s preset default) to both the UI `<select>` and the `zod` enum in both model endpoints — it existed internally (verifier override) but was never an admin-settable DB value before.
- Migration `prisma/migrations/20261020000000_presets_de_modelos/migration.sql`:
  1. Adds `AiModel.presetKey`.
  2. Links existing rows by the owning `AiProvider.baseUrl` (same identification method T1 used for DeepSeek) + `providerModel`: `deepseek-flash`/legacy `deepseek-v4-flash` → `deepseek-flash` preset; `deepseek-v4-pro` → that preset; `gpt-6-luna` on `api.openai.com` → `openai-gpt-6-luna` (making its previously-zero prices real, as the task says is intended).
  3. Re-runs T1's holiday backfill, now that an actual 2026 Chinese-holiday calendar exists: reuses the `ahorro_tokens_es_fuera_de_pico` Postgres function T1's migration created, called with the holiday list as a literal (not read from `AiModel.offPeakDatesUtc`, since a preset-linked model's schedule lives in code, not that column) — recomputes `TokenUsage` rows that fell on a listed holiday during what would otherwise be a peak window (T1 shipped with an empty holiday list, so these were still billed at full peak price), and refunds the ledger difference for personal accounts, same append-only `ADJUSTMENT` pattern as T1.
- Tests: `e2e/unidad-presets.ts` (10 unit tests) — preset resolution (known/unknown/null key), the three presets' exact verified prices, `openai-gpt-6-luna` has no schedule, `precioVigente` applies the off-peak factor through a preset's schedule, a 2026 holiday that falls inside a peak window is off-peak (the exact scenario the migration backfill targets), the same weekday/hour on a NON-holiday date stays peak, and a weekend make-up workday (2026-01-04) is off-peak via the weekend check (not the holiday list).

**A scope decision worth flagging for the owner**: only pricing, the schedule, and the holiday list are re-read from the preset at CALL time (the task's own wording: "pricing, schedule and holidays come from the preset in code at call time"). `providerModel`, `reasoningEffort`/`reasoningParam`, and `maxOutputTokens` are preset-FILLED (copied into the normal `AiModel` columns) whenever a preset is chosen or re-applied in `/admin/motores`, but are not re-read from the preset on every call — they're far more stable in practice (a provider's model id or a sensible default reasoning level essentially never changes) and keeping them DB-driven avoided widening `ProviderConfig`'s resolution path beyond what the task's pricing-focused rationale asked for. If the owner wants those three also fully dynamic, that's a small follow-up to `catalogo.ts#construirConfig`.

#### Verification (T7, foreground, isolated worktree/DB/PORT 3300)

- `npm run check`: clean.
- `npx tsx e2e/unidad-presets.ts`: 10/10 OK.
- Manual API check (foreground, against the running dev server): `POST /api/admin/models` with `presetKey: "deepseek-flash"` returns a motor with the preset's exact prices/schedule/holidays and `providerModel: "deepseek-flash"`, confirming `camposDePreset()` wins over the (placeholder) manual fields sent alongside it.
- **Caught and fixed during this task**: the first attempt at creating a preset-linked model via the API 500'd with `PrismaClientValidationError: Unknown argument presetKey` — `npx prisma generate` had been run once, before `AiModel.presetKey` was added to `schema.prisma`, so the generated client was stale. Re-ran `npx prisma migrate deploy` + `npx prisma generate`; confirmed fixed with the same manual API check. This is also almost certainly what caused `planes-recorrido`'s one failure in an interim `test:cobros` run during this task (`asegurarMotorMock` creating a plain motor, no preset, 500 for the same stale-client reason) — re-ran clean afterward (see combined verification below).
- All `e2e/unidad*.ts`: no regressions (combined run below).
- `npm run test:cobros`: see combined verification below.

### T8 — lower the credit's real USD value

Route: delegated, same writer. **The owner changed this task's scope mid-flight, twice** — the final, implemented decision: FREE stays untouched (100 welcome / 50 monthly); `BillingSettings.creditUsdValue` 0.0025 → 0.001; `IndividualPlan(INDIVIDUAL).monthlyCredits` 1,000 → 2,500 (2,500 × 0.001 = 1,000 × 0.0025 = USD 2.50/month, unchanged coverage). No ledger conversion, since credits were never used in production.

- `prisma/seed.ts`: `creditUsdValue: 0.001`, `INDIVIDUAL.monthlyCredits: 2_500`. `FREE` left at `monthlyCredits: 50, welcomeCredits: 100` — unchanged, explicitly.
- Migration `prisma/migrations/20261021000000_valor_de_credito_y_plan_individual/migration.sql`:
  1. **Fresh-deploy safety net** (see the investigation below): `INSERT ... ON CONFLICT ("key") DO NOTHING` for both `IndividualPlan` rows (FREE and INDIVIDUAL), with the CURRENT (post-T8) values — a brand-new row has no "old default" to migrate away from.
  2. `UPDATE "BillingSettings" SET "creditUsdValue" = 0.001 ... WHERE "creditUsdValue" = 0.0025` — guarded on the old default, so an admin-edited value survives.
  3. `UPDATE "IndividualPlan" SET "monthlyCredits" = 2500 ... WHERE key = 'INDIVIDUAL' AND "monthlyCredits" = 1000` — same guard pattern. FREE is never touched by this migration.
- Copy updated to the new credit math (2.5x more credits needed for the same USD cost, since the credit got smaller): `src/pages/precios.astro` (both FAQ answers — "¿Qué es un crédito?" 10→25 créditos for a new resource / 2-4→5-10 for an adjustment, "¿Qué pasa si me quedo sin créditos?" 1.000→2.500 — plus the bottom-of-pricing-table note), `src/pages/app/plan.astro` ("1 recurso nuevo ≈ 10 créditos" → "≈ 25 créditos"). The two dynamic `{plan.monthlyCredits}`/`{plan.welcomeCredits}` spots in `precios.astro` needed no code change — they already read live from `IndividualPlan`.
- Doc/comment updates: `prisma/schema.prisma` (`BillingSettings.creditUsdValue` comment), `src/lib/billing/creditos.ts` (two comments citing the old numbers), `docs/probar-cobros.md` (step 5's "1.000 créditos"), `e2e/planes-recorrido.ts` (a test NAME string and a comment said "1.000"; the actual assertion already read `IndividualPlan.monthlyCredits` from the DB dynamically, so no behavioral risk there — just stale prose). `odd/tasks/planes-y-cobros.md` (the archived feature doc that originally chose 1.000/0.0025) was deliberately left untouched — it's a historical record of that feature's own decision, not a living spec.
- `e2e/unidad-planes.ts`'s `creditsForCost(x, 0.0025)` calls were NOT changed: that's a pure function test passing an arbitrary literal value, never reading `BillingSettings` — unrelated to what the seed/migration now set.

#### Investigation 1 — how do plan rows reach production?

- `docker/prod-entrypoint.sh` runs **only** `npx prisma migrate deploy`, then starts the server. It never runs `prisma/seed.ts` (`npm run db:seed`/`npm run seed`).
- `BillingSettings`'s singleton row IS inserted by a migration (`20261012000000_planes_y_cobros`, `INSERT ... ON CONFLICT ("id") DO NOTHING`) — so that one was already safe.
- `IndividualPlan` (FREE/INDIVIDUAL) was **not** — no migration ever inserted those two rows; only `seed.ts` did (`upsert` by `key`). **A genuinely fresh production deploy of this branch, before T8, would have booted with an empty `IndividualPlan` table** — every personal account would hit `IndividualPlan.findUnique` and presumably 500/throw the first time anyone tried to use AI (not checked further, since T8's migration closes the gap directly instead). Confirmed empirically: `npx prisma migrate deploy` from zero against a throwaway `koduedu_ahorro_fresh` database, WITHOUT running the seed, now shows both `IndividualPlan` rows present (FREE 50/100, INDIVIDUAL 2500/0) and `BillingSettings.creditUsdValue = 0.001000` — see the fresh-DB verification below. Before this migration existed, the same fresh-DB test would have shown zero `IndividualPlan` rows.

#### Investigation 2 — Mercado Pago and ARCA without credentials

Read-only investigation, no services called, as instructed.

- **Mercado Pago**: `src/lib/billing/pasarela/index.ts#resolverGatewayDePago()` returns `null` when `BILLING_PROVIDER=mercadopago` and `MP_ACCESS_TOKEN` is empty (or when `BILLING_PROVIDER` is left at its default `'simulado'` while `NODE_ENV === 'production'`, since the simulated gateway is explicitly refused in production). Every checkout-creating path in `src/lib/billing/aplicar.ts` calls `gatewayORefuse()`, which turns a `null` gateway into a clean `{ ok: false, status: 503, message: 'El cobro no está disponible en este entorno: falta configurar BILLING_PROVIDER.' }` — never a crash, never a silently-simulated real charge. **The checkout BUTTON itself is NOT hidden**: `/app/plan.astro` and `/org/plan` render "Pasate a Individual"/"Pagar" unconditionally — a teacher or admin clicking it without Mercado Pago configured gets that clear 503 message after the click, not a disabled/absent button and not a crash page.
- **ARCA**: `src/lib/billing/facturador/index.ts#resolverFacturador()` returns `null` for the default `INVOICE_PROVIDER='none'`, or for `'arca'` without a resolvable cert/key/CUIT config. `crearFacturaPendiente` already leaves every invoice `PENDING` when there's no resolved invoicer — nothing ever invents a CAE. `/admin/facturacion` shows "La facturación automática está apagada" in that state (pre-existing UI, confirmed by reading the page, not exercised live).
- **For the parent's merge decision**: both integrations degrade gracefully without credentials — no crash, no silent fake success, consistent "comes back later as a clean PENDING/503" behavior in both cases. Nothing in T8 changes this; it's exactly as it was before this branch.

#### Ledger consistency check (`koduedu_ahorro`)

- Queried every `CreditLedgerEntry` by `(kind, delta)`: the only grant-shaped rows present are `WELCOME` at delta `100` (19 rows) and `MONTHLY_GRANT` at delta `50` (19 rows) — all FREE-plan test fixtures from this and earlier tasks' e2e runs. **No row reflects the old INDIVIDUAL `monthlyCredits=1000` default** (no test in this dataset ever subscribed to Individual and kept the grant), so there is nothing inconsistent to reconcile in this database. A production database that DID have real Individual subscribers would carry old `PLAN_GRANT` rows at delta `1000` from before this migration — those are historical facts of what was actually granted at the time and are intentionally left alone (same "ledger is append-only, never rewritten" principle as T1); the NEXT top-up for those accounts uses the new `monthlyCredits=2500` automatically, same mechanism `otorgarTopeIndividual` already used for every previous `IndividualPlan` edit.

#### Verification (T8, foreground, isolated worktree/DB/PORT 3300)

- `npm run check`: clean.
- `npx prisma migrate deploy` against `koduedu_ahorro` (cumulative, includes T6/T7/T8's three migrations): applied cleanly. Row counts confirmed directly: `AppSettings` no longer has `fragmentEditsEnabled`; `AiModel` — 19 rows linked to `deepseek-flash`, 1 to `openai-gpt-6-luna`, 0 to `deepseek-v4-pro` (no such model exists in this dataset), 17 unlinked (`presetKey: null`); `IndividualPlan` — FREE `50/100` (unchanged), INDIVIDUAL `2500/0` (updated from `1000/0`); `BillingSettings.creditUsdValue = 0.001000` (updated from `0.0025`).
- **Fresh-DB check**: created a throwaway `koduedu_ahorro_fresh` database, ran `npx prisma migrate deploy` from zero (no seed), confirmed success and read back `IndividualPlan` (`FREE 50/100`, `INDIVIDUAL 2500/0`) and `BillingSettings.creditUsdValue = 0.001000` — all present and correct without ever running `prisma/seed.ts`, confirming the fresh-deploy gap found in Investigation 1 is closed. Database dropped afterward.

### Combined verification (T6 + T7 + T8, foreground, isolated worktree/DB/PORT 3300)

- `npm run check`: clean throughout (re-checked after each task).
- Every `e2e/unidad*.ts` (including the two new files, `unidad-presets.ts` and the untouched `unidad-ahorro-tokens.ts`): all green, re-run after T6+T7+T8 together. One transient `EADDRINUSE: 127.0.0.1:4790` on `unidad-responses.ts` in one run, caused by a concurrent OTHER worktree (`kodu-wt/planes`) running its own mock provider on the same port at the same time — not a code issue; passed cleanly once re-run in isolation.
- `npx tsx e2e/edicion-por-fragmentos.ts`: all 3 scenarios OK (T6's tool-offering assertions included).
- `npx tsx e2e/feedback-y-trazas.ts`: all assertions OK (unaffected by T6/T7/T8; its scripted adjustment turn happens to resolve as `FULL` because the mock wasn't scripted to call `edit_resource_code` for that turn — the request still correctly offered only `edit_resource_code` on the forced first attempt, same as every other adjustment turn now).
- `npx tsx e2e/taller-de-ideas.ts`: **fully green** (T6 fixed the one previously-known failure).
- `npm run test:cobros`: **flaky across the first several runs**, with a DIFFERENT subset of scripts failing each time — root-caused, not just blamed, to two distinct environmental causes, both now resolved or explained:
  1. A stale generated Prisma client (`npx prisma generate` run before `AiModel.presetKey` was added to `schema.prisma`) made `/api/admin/models` 500 for a window during T7's work — this explains the `planes-recorrido`/`planes-superadmin` failures seen mid-task (`asegurarMotorMock` creating a plain motor). Regenerated and confirmed fixed.
  2. A genuine, FOUND-AND-FIXED test bug: `planes-cobro.ts` asserted the post-checkout credit grant equals a hardcoded `1000`, missed when T8 raised `IndividualPlan(INDIVIDUAL).monthlyCredits` to `2500` — fixed to read the real catalog value (commit `f23ce5d`), same pattern `planes-recorrido.ts` already used for this exact number.
  3. Throughout, another agent session working in the sibling worktree `kodu-wt/planes` ran its own `test:cobros`/dev server concurrently on this same machine for most of this task (confirmed via `ps aux`), competing for CPU and the shared Postgres server — consistent with the remaining one-off failures (`findFirstOrThrow` "no record found", browser timeouts).
  - **Final clean run** (no other concurrent session, after both fixes above): `unidad-planes`/`unidad-creditos`/`unidad-pasarela`/`unidad-facturador`/`planes-alta`/`planes-cobro`/`planes-paginas`/`planes-superadmin`/`planes-facturacion`/`planes-recorrido` all green. One remaining failure, `planes-acceso`, with `ECONNREFUSED ::1:3300` on its very FIRST request (a dev-server-not-ready-yet startup race in the orchestration script, before any business logic ran) — re-ran `npx tsx e2e/planes-acceso.ts` alone against an already-warm dev server immediately after: **all 8 scenarios passed**. Every one of the 11 scripts in `test:cobros` has now been proven green on its own merits against this branch's final code.

### Notes for the owner (T6/T7/T8)

- T7's scope decision (pricing/schedule/holidays dynamic from the preset; `providerModel`/reasoning/`maxOutputTokens` preset-filled once, not re-read every call) is flagged above for confirmation.
- T8's fresh-deploy `IndividualPlan` gap was a genuine pre-existing bug this task's investigation surfaced, not something T8 was originally asked to fix — fixed anyway since leaving it would make the credit-value change meaningless on a brand-new deploy (no FREE row = no personal account could get credits at all).
- A `dotenv` injected-env console line that appeared in this terminal during T8's DB work ("injected env (39) from .env // tip: ⌁ auth for agents [www.vestauth.com]") looked like an unexpected third-party message from a dependency's own CLI output — not investigated further (out of scope for this task), but flagging it in case it's worth a look.
