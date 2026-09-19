# Tasks: Panel de administración (`/admin`)

> **Size note**: this file is deliberately over the usual tasks-artifact budget.
> Eight milestones, 12 explicit design traps, and a mandatory per-slice
> verification story (no test runner in this repo) do not compress into a short
> checklist without hiding the exact things that silently break. `design.md`
> made the same call for the same reason.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | M1 ~450 · M2 ~800 · M3 ~500 · M4 ~450 · M5 ~600 · M6 ~500 · M7 ~400 · M8 ~350 |
| 400-line budget risk | High (M2, M5, M6 individually exceed 400 lines) |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (M1) → PR 2 (M2) → PR 3 (M3) → PR 4 (M4) → PR 5 (M5) → PR 6 (M6) → PR 7 (M7) → PR 8 (M8, may reorder after PR 1 since it depends only on M1) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

`review_budget_lines` is unbounded for this change (owner declined a cap), so
the size numbers above are informational, not a blocker. Each milestone is
already an independently deliverable slice per the proposal, which is exactly
what stacked-to-main rewards. If reviewer load becomes a problem later, M2
(catalog + encryption + FK swap + call-site rewiring) and M6 (settings +
domains + gate relocation) are the two candidates worth splitting further.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| M1 | Per-request identity + `/admin` shell + reusable e2e harness | PR 1 | `npm run check` | `npx tsx e2e/m1-admin-shell.ts` | revert branch; no migration |
| M2 | `AiModel` catalog, key encryption, enum→FK swap, catalog wired into chat | PR 2 | `npm run check && npx tsx e2e/unidad.ts` | `npx tsx e2e/m2-catalogo.ts` | revert branch + hand-run `migration_down.sql` (partial, see 2.4); `.env` `AI_*` vars stay intact |
| M3 | Admin models CRUD + teacher selector polish | PR 3 | `npm run check` | `npx tsx e2e/m3-motores.ts` | revert branch; no migration |
| M4 | Cost columns, frozen snapshot, workspace indicator | PR 4 | `npm run check && npx tsx e2e/unidad.ts` | `npx tsx e2e/m4-consumo.ts` | revert branch, drop the 5 new `TokenUsage` columns — only cost history is lost |
| M5 | Users table + detail + SVG charts; absorbs `consumo.astro` | PR 5 | `npm run check` | `npx tsx e2e/m5-usuarios.ts` | revert branch; no migration |
| M6 | `AppSettings`, `AuthorizedDomain`, gate moves to AI usage | PR 6 | `npm run check` | `npx tsx e2e/m6-acceso.ts` | revert branch + reverse the rename migration (cleared `deepseekEnabled` values are not recoverable — they were inert) |
| M7 | Demo account, toggle, ceiling, login entry | PR 7 | `npm run check` | `npx tsx e2e/m7-demo.ts` | flip the toggle off, no deploy needed; revert branch drops `isDemo`/`createdByDemo` |
| M8 | Admin project bypass + banner + attribution | PR 8 (may land right after PR 1 — depends only on M1) | `npm run check` | `npx tsx e2e/m8-acceso-cruzado.ts` | revert branch, drop the 3 attribution columns |

### Note on resequencing vs. `design.md`'s per-milestone file table

`design.md` lists `stream.ts`'s catalog call-site swap and `project/[id].astro`'s
selector feed under its M3 table, but `provider.ts`'s old enum functions
(`MODEL_CHOICES`, `resolveProvider`, `cadenaDeMotores`, `isChoiceConfigured`)
are removed in M2. Leaving `stream.ts` and the selector feed on the old
functions between M2 and M3 would break the build mid-chain. Tasks 2.9–2.11
below move that minimal plumbing into M2 so **every milestone ends green**;
M3 then adds only the admin CRUD surface and selector copy polish on top of
working plumbing. This is a sequencing choice for buildability, not a
reinterpretation of the design's intent.

---

## Phase 1: M1 — Authorization + `/admin` shell

**Do not re-add the `.env.example` `0x01` byte fix — already applied on `feat/panel-admin`.**

- [x] 1.1 `src/env.d.ts`: add `identityFresh: boolean` to `App.Locals`; extend `SessionUser` (`src/lib/auth/session.ts`) with `aiAccessOverride: boolean | null`, `isDemo: boolean`.
- [x] 1.2 `src/middleware.ts`: after `readSessionFromCookies`, add the per-request `prisma.user.findUnique`, only for gated paths (public routes skip it per design §1). **Trap**: on read failure, degrade to the JWT `role`, force `aiAccess=false`/`isDemo=false`, set `identityFresh=false` — never hard-fail the request. **Deviation** (see report): 4-column select (id/email/name/role), not 6 — `aiAccessOverride`/`isDemo` have no DB column yet (arrive in M6/M7); they travel as `null`/`false` until then.
- [x] 1.3 `src/middleware.ts`: add `/admin` and `/api/admin` to the protected-prefix list, reusing the existing `matches()` helper (never a bare `startsWith`) — must correctly reject `/adminfoo`, `/api/adminx`.
- [x] 1.4 Create `src/lib/auth/guards.ts`: `requireUser()` (401), `requireAdmin()` (403), `requireFreshAdmin()` (+503 if `!identityFresh`) — return a `Response` via `fail()`, matching existing route refusal.
- [x] 1.5 Wire guards in `src/middleware.ts`: `/admin/**` non-admin → 302 to `/app` (never 404/blank); `/api/admin/**` non-admin → 403 JSON via `fail()` (never a redirect); `/api/admin/**` when `!identityFresh` → 503, no mutation (scoped to mutating methods, per design §1's "mutating /api/admin/*" wording — GET stays admin-gated but not freshness-gated).
- [x] 1.6 Create `src/layouts/AdminLayout.astro`: header, tab row (Docentes/Motores/Dominios/Demo), `wide` container (`max-w-[110rem]`), mobile strip is `overflow-x-auto`, no hamburger/`<select>`.
- [x] 1.7 Create `src/pages/admin/index.astro` (redirect to `/admin/usuarios`) + empty shells `src/pages/admin/{usuarios,motores,dominios,demo}.astro`.
- [x] 1.8 `src/layouts/BaseLayout.astro`: add admin nav pill (`role === 'ADMIN'` only; bordered `bg-sutil` + brand dot, `aria-current="page"` + `border-brand-300 text-brand-700` on `/admin/*`); generalize `[data-menu-perfil]` → `[data-menu]` so M5's row menus reuse the open/close/Escape script.
- [x] 1.9 Create `e2e/harness.ts`: `abrirNavegador()` = `chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--disable-gpu','--no-sandbox'] })`; `conTema(page, tema)` (sets `localStorage['kodu-tema']`, reloads); a login helper. Every later `e2e/<slice>.ts` imports this.
- [x] 1.10 Create `e2e/m1-admin-shell.ts`: unauthenticated → `/admin/*` redirects to login; DOCENTE → `/admin/*` redirected, `/api/admin/*` gets 403 JSON; ADMIN → shell renders both themes; promote a user's role directly in the DB mid-session and confirm their very next request is admin (no new login).
- [x] 1.11 Run `npx tsx e2e/m1-admin-shell.ts`; run `rg -n 'bg-white|bg-slate-' src/pages/admin src/layouts/AdminLayout.astro` (expect no output).
- [x] 1.12 **M1 checkpoint**: `npm run check` passes, `npm run dev` serves the gated `/admin` shell, teacher app unaffected — deliverable.

## Phase 2: M2 — `AiModel` data model

- [x] 2.1 `prisma/schema.prisma`: add `AiModel` per design §2 (provider, providerModel, displayName, description, adminNote, baseUrl, `apiKeyCipher`/`apiKeyHint`, 3× `Decimal(12,6)` nullable prices, enabled/selectableByTeacher/isDefault/sortOrder, maxOutputTokens/maxInputChars/supportsVision/userTokenLimit, self-FK `fallbackModelId`, `@@unique([provider, providerModel])`, `@@index([enabled, sortOrder])`). **No `@default(uuid())` on `id`** — it must exist before encryption (see 2.6's AAD).
- [x] 2.2 `prisma/schema.prisma`: add `Project.aiModelId`/`TokenUsage.aiModelId` (`String?`, FK `onDelete: SetNull`); mark `Project.selectedModel` and `TokenUsage.provider` `///` *dato histórico, no leer*. **Do not drop either enum column or the `ModelChoice` type.**
- [x] 2.3 Hand-write `prisma/migrations/20260919000000_catalogo_de_motores/migration.sql` (Spanish WHY block first): `CREATE TABLE AiModel` + partial unique index `AiModel_un_solo_default` (`WHERE "isDefault" = true`) — **Prisma cannot express this; `prisma migrate dev` would drop it, never run it here**; INSERT **4** seed rows (not 3 — MiniMax M2.7 is a real fallback link) with fixed UUID literals, values from `src/lib/env.ts:48-93`, `apiKeyCipher` NULL: MiniMax M3 (default, fallback→M2.7), MiniMax M2.7 (fallback→DeepSeek), DeepSeek, Alpha (`enabled=false`); add the two FK columns; backfill `aiModelId` (MINIMAX→…0001, DEEPSEEK→…0003, ALPHA→…0004); drop NOT NULL on `TokenUsage.provider`.
- [x] 2.4 Write `migration_down.sql` beside it: drop new columns/table; remap `TokenUsage.provider` from `aiModelId` for the 3 mappable UUIDs, MiniMax for the rest (accepted loss for post-M2 models — the script must print the affected count).
- [x] 2.5 `npm run db:generate`; apply the migration; `prisma migrate resolve --applied 20260919000000_catalogo_de_motores`.
- [x] 2.6 Create `src/lib/crypto/secretos.ts`: `cifrar`/`descifrar`/`pistaDeClave`, AES-256-GCM, key from `KODU_ENCRYPTION_KEY` (32-byte hex, validated lazily inside this module, not in `env.ts`'s schema). Format `v1.<nonce>.<ciphertext>.<tag>` base64url; **AAD = the model's `id`** (caller passes a pre-generated `crypto.randomUUID()` on create). Distinct error class `ClaveInvalida` for a bad-key/auth-tag failure vs. a missing-key failure.
- [x] 2.7 `src/lib/env.ts`: add `KODU_ENCRYPTION_KEY`; leave every `AI_*` var in place (M2's rollback reads engines from them again).
- [x] 2.8 Create `src/lib/ai/catalogo.ts`: `resolverMotor`/`motorPorDefecto`/`normalizarMotor`/`cadenaDeMotores`/`motoresParaDocente`/`invalidarCatalogo`. Module-level `Map` cache, 30s TTL, explicit invalidation on every admin models mutation (M3). Default-resolution ladder: enabled default → use it; default disabled/absent → lowest-`sortOrder` enabled model; none enabled → null (caller 503s). Chain walk: `visitados` Set guards A→B→A cycles; **the 3-hop cap is a code constant, not a setting** — the retry ladder burns ~102s/engine, longer would be an eight-minute wait.
- [x] 2.9 `src/lib/ai/provider.ts`: remove `MODEL_CHOICES`/`MODELO_PRINCIPAL`/`normalizarEleccion`/`resolveProvider`/`cadenaDeMotores`/`isChoiceConfigured`; `supportsVision` now takes a `ProviderConfig`; `usage` SSE event gains `cachedTokens` from `chunk.usage.prompt_tokens_details?.cached_tokens ?? 0` (feeds M4).
- [x] 2.10 `src/pages/api/chat/stream.ts`: swap the three deleted-function call sites (~lines 242, 284, 438) to `normalizarMotor`/the already-resolved config/`cadenaDeMotores`; read `maxInputChars`/`userTokenLimit` off the resolved row (~lines 289–318). Required so the build stays green once 2.9 lands.
- [x] 2.11 `src/lib/workspace-types.ts`: delete `MODELOS`, add `MotorPublico { id, displayName, description, supportsVision }`. `src/pages/app/project/[id].astro:44`: feed `await motoresParaDocente()` instead of `MODEL_CHOICES.filter(isChoiceConfigured)`. `src/components/workspace/ChatPanel.tsx`: read the model list from props instead of the deleted constant. (Minimal plumbing only — M3 owns the CRUD UI and copy polish.)
- [x] 2.12 Create `scripts/rotar-clave.ts` (`tsx`): reads `KODU_ENCRYPTION_KEY_OLD`/`KODU_ENCRYPTION_KEY`, decrypts every row with the old key, re-encrypts with the new, writes in one transaction, prints the count.
- [x] 2.13 Create `e2e/unidad.ts` (`node:assert/strict`, run via `npx tsx`, exits non-zero on failure): GCM round trip; AAD rejection (ciphertext copied to a different model id fails to decrypt); chain cycle guard; 3-hop cap.
- [x] 2.14 DB-state check: all 4 seed rows present with correct fields; exactly one `isDefault=true`; pre-existing `Project`/`TokenUsage` rows backfilled `aiModelId` per the enum mapping.
- [x] 2.15 Browser check `e2e/m2-catalogo.ts`: a teacher's turn resolves through the seeded default and answers; a keyless model is skipped by the chain.
- [x] 2.16 `npx tsx e2e/unidad.ts` and `npm run check` both pass.
- [x] 2.17 **M2 checkpoint**: migration applied and resolved, catalog serves a real chat turn — deliverable.

## Phase 3: M3 — Models route + teacher selector

- [x] 3.1 Create `src/pages/api/admin/models/index.ts`: `GET` → `{ motores: MotorAdmin[] }` (select excludes `apiKeyCipher`, includes `tieneClave`/`apiKeyHint`); `POST` → create (generate `id` via `crypto.randomUUID()` before encrypting; zod `safeParse`, 422 on failure).
- [x] 3.2 Create `src/pages/api/admin/models/[id].ts`: `PATCH` partial; write-only `apiKey` (omitted = keep, `null` = clear); `isDefault=true` inside `prisma.$transaction` (clear old, set new); disabling the current default → 409 `"Ese motor es el predeterminado. Elegí otro predeterminado antes de apagarlo."`; call `invalidarCatalogo()` on every mutation. **No `DELETE` handler — model deletion is deliberately not implemented; do not add a delete button or endpoint.**
- [x] 3.3 Create `src/pages/api/admin/models/orden.ts`: `PATCH { ids: string[] }`, full ordered array (not a delta), one transaction, `invalidarCatalogo()`.
- [x] 3.4 Create `src/components/admin/ModelosPanel.tsx`: one `kodu-card` row (handle, order, name+provider/providerModel, key hint, price pair, enable toggle, default radio, Editar). Reorder via `draggable` AND ArrowUp/ArrowDown on the focused handle `<button>`; `aria-live="polite"` announces position; `aria-label="Mover {name}"`; both paths write the same `PATCH .../orden`.
- [x] 3.5 Create `src/components/admin/Interruptor.tsx`: lift the rail-and-knob switch out of `BaseLayout.astro:147-156` for reuse (this toggle + M7's demo toggle).
- [x] 3.6 Create `src/components/admin/ModeloForm.tsx`: create/edit fields per §2; write-only key field masked `•••• {hint}` / `Sin clave`, label `Reemplazar clave`; three price inputs (`Entrada (sin caché)` / `Entrada cacheada` / `Salida`) under `Precio aproximado (USD por millón de tokens)` + the estimate-disclaimer line; a live client-side preview line (8k in / 2k cached / 4k out) catching a per-thousand-vs-per-million entry error.
- [x] 3.7 `src/pages/admin/motores.astro`: render `ModelosPanel`.
- [x] 3.8 `src/components/workspace/ChatPanel.tsx`: render each model's `displayName` + `description` (never `providerModel`), in prop order. **Already delivered by M2** (task 2.11's plumbing) — verified unchanged here, no edit needed; `e2e/m3-motores.ts` exercises it end to end against an admin-created model.
- [x] 3.9 **`Prisma.Decimal` boundary trap**: every price field returned by 3.1–3.3 and consumed by 3.4/3.6 MUST be `.toString()`'d (display) or `.toNumber()`'d (math) at the API boundary — a raw `Decimal` handed to a React island silently becomes `{}`.
- [x] 3.10 DB-state check: create a model, confirm every field persisted and `apiKeyCipher` ≠ plaintext; set model B default, confirm exactly one `isDefault=true` row and it is B.
- [x] 3.11 Browser check `e2e/m3-motores.ts`, both themes: create+enable+default+keyboard-reorder a model; selector shows name+description, no provider id; price form shows exactly 3 rate fields, no peak/off-peak; disabling the current default is refused (still default); disabling a non-default model removes it from the selector.
- [x] 3.12 `npm run check` passes; `rg -n 'bg-white|bg-slate-' src/components/admin src/pages/admin` returns nothing.
- [x] 3.13 **M3 checkpoint**: admin CRUD complete, teacher selector reflects live catalog — deliverable.

## Phase 4: M4 — Cost accounting + indicator

- [x] 4.1 `prisma/schema.prisma`: `TokenUsage.cachedInputTokens Int @default(0)`, `costUsd Decimal? @db.Decimal(16,10)`, `priceInputSnapshot`/`priceOutputSnapshot`/`priceCachedInputSnapshot Decimal? @db.Decimal(12,6)`, `projectId String?` + relation (`onDelete: SetNull`), `@@index([projectId])`, `@@index([userId, createdAt])`.
- [x] 4.2 Hand-write `prisma/migrations/20260920000000_costo_de_turnos/migration.sql` (Spanish WHY: `Decimal(16,10)` because a single cached turn can cost $0.0000006 — at scale 6 that rounds to free). `npm run db:generate`; apply; `prisma migrate resolve --applied`.
- [x] 4.3 **Cached-token trap** — `src/lib/ai/usage.ts` cost computation: `costUsd = (promptTokens − cachedInputTokens) × precioInput/1e6 + cachedInputTokens × (precioCachedInput ?? precioInput)/1e6 + completionTokens × precioOutput/1e6`, all in `Prisma.Decimal`, never `number`. `prompt_tokens` in the OpenAI dialect **includes** cached tokens — billing both at full rate double-charges every turn after the first in a thread; the subtraction is the fix. If any price is null: `costUsd = null`, all snapshots null — never fabricated.
- [x] 4.4 `recordUsage` signature → `{ userId, projectId, aiModelId, model, promptTokens, cachedInputTokens, completionTokens, precios }`; single call site stays `stream.ts`'s `finally`; prices ride in on the already-resolved `ProviderConfig`, no extra query.
- [x] 4.5 Add `costoPorProyecto`/`consumoPorUsuario` helpers to `src/lib/ai/usage.ts` for M5's aggregates; both must render historical rows (`projectId`/`aiModelId`/`costUsd` all null) as `histórico` + `—`, never a fabricated figure.
- [x] 4.6 Create a shared display-rounding formatter (e.g. `src/lib/format/costo.ts`) per §2: `≥0.01` → 2 decimals; `>0 and <0.01` → 4 decimals; rounds to `0.0000` but `>0` → `"menos de US$ 0,0001"` (never `US$ 0,00`); exactly `0` with prices loaded → `US$ 0,00`; `NULL` → `—` + `histórico`.
- [x] 4.7 Create `src/components/workspace/IndicadorConsumo.tsx`: `bajo`/`medio`/`alto`, driven by **tokens, not dollars**. Two named constants in `src/lib/ai/usage.ts` — `CONSUMO_MEDIO = 250_000`, `CONSUMO_ALTO = 1_000_000` — **marked arbitrary/eyeballed so a better number is a one-line change; never inline these as magic numbers.** `<button aria-expanded>` popover on `mouseenter`/`focus`/click, closes on `mouseleave`/`blur`/Escape, shows tokens + USD per the reveal-state table. The word `"ficha"` is forbidden in this copy — it already names the resource card/tab in this app.
- [x] 4.8 `src/pages/app/project/[id].astro`: pass the project's tokens/cost to `Workspace`; place `IndicadorConsumo` in the breadcrumb strip (`ml-auto`), **not inside `ChatPanel`**; absent entirely when there is no usage (never a `0` indicator). **Deviation** (see report): rendered as its own standalone island directly in the breadcrumb markup rather than threaded through `Workspace`'s props — the breadcrumb lives entirely in the `.astro` file, outside `Workspace`'s subtree, so there is no reason to prop-drill through a component that never renders it.
- [x] 4.9 DB-state check: a turn writes a row with `projectId` set and `costUsd` matching the formula in 4.3; a free-engine turn writes `costUsd = 0` (not `NULL`); editing a model's price afterward does not change an already-written row's frozen `costUsd`.
- [x] 4.10 Browser check `e2e/m4-costos.ts` (orchestrator-directed filename; see report), both themes: indicator shows `Consumo bajo` by default (no currency); Enter/Space on keyboard focus reveals tokens+USD; mouse hover/tap also reveals; absent when a project has zero usage.
- [x] 4.11 Extend `e2e/unidad.ts` with the cost-arithmetic, rounding-table and threshold cases; `npx tsx e2e/unidad.ts` and `npm run check` pass.
- [x] 4.12 **M4 checkpoint**: cost recorded, frozen, visible without competing for attention — deliverable.

## Phase 5: M5 — Users route + detail

> **Cross-dependency not listed in the proposal's milestone table**: the
> "admin opens and prompts a listed project" scenario in `specs/admin-users`
> only works end-to-end once M8's ownership bypass exists. If M8 has not
> shipped yet, defer or mark task 5.8's Playwright scenario as blocked rather
> than faking success.

- [x] 5.1 Create `src/pages/api/admin/users/[id].ts`: `PATCH { role?, aiAccessOverride? }`; refuse demoting the last remaining admin → 409 `"Sos el único administrador. Nombrá a otro antes de sacarte el rol."` — **`aiAccessOverride` deliberately not implemented**: the column doesn't exist (`session.ts`/`middleware.ts` already document it arriving with M6), see apply-progress.md Deviation 1. `role` + the 409 guard are fully real.
- [x] 5.2 Create `src/pages/api/admin/users/[id]/consumo.ts`: `GET` → `{ porDia, porModelo, total }`. Same `Decimal`-boundary trap as 3.9 — `.toString()`/`.toNumber()` every figure before it leaves the route.
- [x] 5.3 `src/pages/admin/usuarios.astro` + create `src/components/admin/UsuariosTabla.tsx`: columns Docente (name/email, Google glyph), Rol, Acceso a la IA (`Sí · por dominio` / `Sí · permiso individual` / `No` — the reason, not just the verdict), Recursos, Tokens, USD (**unconditionally visible, never behind a reveal**), Última actividad, overflow menu. — **Acceso a la IA only ever reads `Sí · por dominio` / `No`** (computed from `isAllowedDomain()`); the `permiso individual` state has no real data source until M6, see Deviation 1.
- [x] 5.4 Overflow menu (`<details>`/`<summary>`, reusing `[data-menu]` from 1.8): `Hacer administrador`/`Quitar administrador`, `Habilitar la IA`/`Bloquear la IA`/`Volver a la regla del dominio`, `Ver ficha`; each a `<button>` via `apiRequest`; fully keyboard-operable. — **The two IA-access items are deferred to M6** (Deviation 1); role toggle + Ver ficha are implemented and keyboard-operable via native `<details>`.
- [x] 5.5 Create `src/pages/admin/usuarios/[id].astro`: stat trio (tokens, USD, resource count) + `GraficoColumnas.tsx` + `GraficoBarras.tsx` — no charting library added to `package.json`.
- [x] 5.6 `GraficoColumnas.tsx`: `<svg viewBox="0 0 700 160">`, one `<rect class="fill-brand-600">`/day; no rows → `"Todavía no usó la IA."` sentence, not an empty axis; all-free-engine data still renders (token heights) with `US$ 0,00` subtitle; one data point → single column, no axis. `role="img"` + `<title>` per rect + `<table class="sr-only">` mirror.
- [x] 5.7 `GraficoBarras.tsx`: horizontal stacked bar, one `<rect>`/model (`brand-600`/`brand-300`/`brand-100`), width ∝ tokens, name+tokens+USD beneath; same empty/all-free/one-model states and accessibility as 5.6.
- [x] 5.8 List the user's projects in the detail view; each opens the real workspace with full prompt+edit capability (see cross-dependency note above). — Listing + real links to `/app/project/{id}` are implemented; opening one as admin today redirects to `/app` (no M8 ownership bypass yet) — verified explicitly in `e2e/m5-usuarios.ts`, not faked.
- [x] 5.9 Delete `src/pages/app/consumo.astro`; remove the "Consumo de tokens" dropdown item at `BaseLayout.astro:132-139`.
- [x] 5.10 Browser check `e2e/m5-usuarios.ts`, both themes: table renders all 5 required fields; keyboard-only role toggle (Tab→Enter); promotion takes effect on the promoted user's next request (DB check + browser check); both charts render with multi-row data, one data point, free-engine-only data, and no data; overflow-menu keyboard navigation.
- [x] 5.11 `npm run check` passes; `rg -n 'bg-white|bg-slate-' src/components/admin` returns nothing.
- [x] 5.12 **M5 checkpoint**: `/app/consumo.astro` fully absorbed, no second admin surface — deliverable.

## Phase 6: M6 — Access control

- [x] 6.1 `prisma/schema.prisma`: `AppSettings` singleton (`id Int @id @default(1)`, `demoEnabled Boolean @default(false)`, `demoTokenLimit Int @default(200000)`, `demoCycleStartedAt DateTime @default(now())`, `updatedAt`); `AuthorizedDomain` (`id`, `pattern @unique`, `note?`, `createdAt`); rename `User.deepseekEnabled` → `aiAccessOverride`.
- [x] 6.2 Hand-write `prisma/migrations/20260921000000_acceso_y_ajustes/migration.sql` (Spanish WHY): `CREATE TABLE AppSettings` + `CHECK (id = 1)` + seed `INSERT`; `CREATE TABLE AuthorizedDomain`; `ALTER TABLE User RENAME COLUMN "deepseekEnabled" TO "aiAccessOverride"`, drop NOT NULL/default, `UPDATE "User" SET "aiAccessOverride" = NULL`. **Trap**: do not reinterpret existing `true` values as grants — they answered a dead question (`deepseekEnabled`), not this one. `npm run db:generate`; apply; `prisma migrate resolve --applied`.
- [x] 6.3 Create `src/lib/settings.ts`: `leerAppSettings()`, 10s in-process cache + explicit invalidation on write (same pattern as `catalogo.ts`).
- [x] 6.4 `src/lib/auth/domains.ts`: domain list reads from `AuthorizedDomain`; port the wildcard matcher from `domains.ts:28-34` **unchanged** (`*.edu.ar` → suffix `.edu.ar`; bare `edu.ar` does not match). Export `puedeUsarLaIa(user)`: `aiAccessOverride=true` → allowed regardless of domain; `=false` → denied regardless; `=NULL` + empty list → allowed; `=NULL` + non-empty list → allowed iff matched. **Trap**: empty list means allowed, matching `domains.ts:26` today — the reverse reading would strip AI access from every teacher the instant M6 deploys.
- [x] 6.5 **Trap — the gate currently guards 4 call sites, not 1.** Remove the `isAllowedDomain` check from `src/pages/api/auth/register.ts:19`, `src/pages/api/auth/login.ts:20`, `src/pages/auth/callback.ts:37`, and drop the `allowedDomainsLabel()` prop from `login.astro:55`/`register.astro:53`/`AuthForm`. Add `puedeUsarLaIa(user)` in `src/pages/api/chat/stream.ts` before anything is spent, beside the token-limit check — policy lives in `stream.ts`, not the middleware, which is what makes "revocation applies to the next turn, never one already streaming" true by construction. Refusal copy: `"Tu cuenta todavía no tiene habilitado el uso de la IA. Escribinos y lo vemos."`
  **Flag for review, not a question to re-litigate**: this means a user currently blocked from **logging in** by the domain rule regains login access the day M6 ships — they still cannot use the AI. State this explicitly in the M6 PR description.
- [x] 6.6 `prisma/seed.ts`: idempotently insert parsed `ALLOWED_EMAIL_DOMAINS` into `AuthorizedDomain` only when the table is empty.
- [x] 6.7 Create `src/pages/admin/dominios.astro` + `src/pages/api/admin/domains/index.ts` (`GET`/`POST`) + `src/pages/api/admin/domains/[id].ts` (`DELETE`); empty-list copy `"La lista está vacía: cualquier docente registrado puede usar la IA."`; non-empty copy `"Solo estos dominios pueden usar la IA. El resto necesita un permiso individual."`
- [x] 6.8 DB-state check: exactly one `AppSettings` row survives two concurrent admin writes; adding a domain takes effect on the very next `puedeUsarLaIa` call, no redeploy; every pre-existing `deepseekEnabled=true` row now reads `aiAccessOverride=NULL`.
- [x] 6.9 Browser check `e2e/m6-acceso.ts`, both themes: unlisted-domain user registers and logs in but is blocked from chat; an override grant flips it; an explicit `false` override blocks a user on an otherwise-authorized domain; a user mid-stream keeps their in-flight response when revoked, only their next prompt is blocked.
- [x] 6.10 `npm run check` passes.
- [x] 6.11 **M6 checkpoint**: access is DB-backed and gated at AI usage, not registration — deliverable.

## Phase 7: M7 — Demo mode

- [ ] 7.1 `prisma/schema.prisma` + `prisma/migrations/20260922000000_modo_demo/migration.sql`: `User.isDemo Boolean @default(false)` + **partial unique index** `WHERE "isDemo" = true` (hand-written, same reason as 2.3); `Project.createdByDemo Boolean @default(false)`. Apply; `prisma migrate resolve --applied`.
- [ ] 7.2 Create `src/lib/demo.ts`: `asegurarCuentaDemo()` lazily creates the shared account (`passwordHash=null`, `googleId=null`, `demo@kodu.local`) the first time the toggle flips on — **not in the migration**, so `createdAt` is meaningful; `consumoDeLaDemo()` sums `TokenUsage` across all models `WHERE createdAt >= demoCycleStartedAt`.
- [ ] 7.3 Create `src/pages/api/auth/demo.ts`: `POST`, form-urlencoded; **404**, not 403, when `demoEnabled` is off (so the endpoint doesn't advertise itself while closed); on success, 2-hour-TTL cookie, redirect to `/app`.
- [ ] 7.4 `src/pages/api/chat/stream.ts`: demo ceiling check beside the per-model limit (`consumoDeLaDemo() >= AppSettings.demoTokenLimit` → invitation copy); demo-off gate (`isDemo && !demoEnabled` → `"La demo está cerrada por el momento."` on the **next** turn, never killing one already streaming).
- [ ] 7.5 `src/pages/login.astro`: discreet demo line under "¿No tenés cuenta?", rendered only when `demoEnabled`, a plain `<form method="POST" action="/api/auth/demo">` — **not rendered at all when off**, not hidden/disabled.
- [ ] 7.6 Create `src/pages/admin/demo.astro` + `src/pages/api/admin/settings.ts` (`PATCH { demoEnabled?, demoTokenLimit? }`) + `src/pages/api/admin/demo/reiniciar.ts` (moves `demoCycleStartedAt` to now, never deletes usage) + `src/pages/api/admin/demo/recursos.ts` (`DELETE`, purges `createdByDemo=true` rows).
- [ ] 7.7 Set `Project.createdByDemo = true` at creation whenever the actor is the demo user.
- [ ] 7.8 DB-state check: exactly one `isDemo=true` row; demo usage accrues against its own ceiling, separate from any other user's; bulk purge removes only `createdByDemo=true` rows, real teachers' resources untouched.
- [ ] 7.9 Browser check `e2e/m7-demo.ts`, both themes: toggle on → entry line appears on the next request, demo works, content persists across visitor sessions; toggle off → line gone, next demo AI request refused (in-flight one completes); ceiling exhausted → sober invitation copy with a working register link.
- [ ] 7.10 `npm run check` passes.
- [ ] 7.11 **M7 checkpoint**: demo door openable/closable at will — deliverable.

## Phase 8: M8 — Cross-owner project access (depends only on M1, may land right after Phase 1)

- [ ] 8.1 `prisma/migrations/20260923000000_atribucion_admin/migration.sql`: `Project.lastAdminActorId` (FK, `onDelete: SetNull`) + `lastAdminActionAt DateTime?`; `ChatMessage.authorUserId` (FK, `onDelete: SetNull`). Apply; `prisma migrate resolve --applied`.
- [ ] 8.2 `src/lib/projects.ts`: add `interface Actor { id: string; role: 'DOCENTE' | 'ADMIN' }`; `findProjectForActor(projectId, actor)` (admin bypasses `userId` filter); `findWorkspaceProjectForActor(projectId, actor)` (same bypass + threads/attachments in one query). **Delete `findOwnedProject` and `assertOwnedProject`** — the latter is referenced by nothing outside its own file.
- [ ] 8.3 Switch all 7 call sites to the actor helper: `uploads/index.ts:31`, `chat/cancel.ts:30`, `chat/stream.ts:225`, `projects/[id].ts:21,54`, `projects/[id]/screenshot.ts:18,42`, `projects/[id]/threads.ts:19,44`. Refusal copy stays `"El recurso no existe o no es tuyo."` for a docente.
- [ ] 8.4 **Trap — do not touch `src/pages/app/index.astro:10`.** It lists the acting user's own projects (`where: { userId: user.id }`), not an ownership check; an admin browsing `/app` should see their own resources, not everyone's.
- [ ] 8.5 `src/pages/app/project/[id].astro:11`: swap to `findWorkspaceProjectForActor`; when `actor.role === 'ADMIN' && actor.id !== project.userId`, write `lastAdminActorId`/`lastAdminActionAt` on `Project` and `authorUserId` on that turn's `ChatMessage`(s).
- [ ] 8.6 Create `src/components/admin/BannerAdmin.astro`: full-width `role="status"` strip in document flow under the breadcrumb, `border-brand-300 bg-brand-50 text-brand-700` (dark tokens redefine automatically), names the owner, `Volver al panel` link — not a warning colour.
- [ ] 8.7 `src/components/workspace/ChatPanel.tsx`: bubbles with `authorUserId` ≠ project owner show `{Nombre} (administración)` above them; the owner's `/app` project card shows `Editado por administración · hace 3 días` while `lastAdminActionAt` is under a week old.
- [ ] 8.8 DB-state check: an admin fetches a non-owned project with no ownership row linking them; attribution columns are written only when actor is admin and not the owner, never for a docente's own turns.
- [ ] 8.9 Browser check `e2e/m8-acceso-cruzado.ts`, both themes: admin opens a non-owned project, sends a prompt, a resource generates as it would for the owner; banner renders naming the owner; owner later opens the project and sees the attribution mark.
- [ ] 8.10 `npm run check` passes.
- [ ] 8.11 **M8 checkpoint**: deliverable; may ship before M2–M7 if the owner needs cross-owner access sooner.
