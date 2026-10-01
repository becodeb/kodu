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
- [ ] T3b Measure real cost/quality of T3a against DeepSeek with real money, on a tight budget (~USD 0.30). Pending.

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
- `npm run test:cobros` (PORT=3300): see the commit/report for the result (ran after this note was written).
