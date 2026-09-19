# Tasks: Catálogo de proveedores (`AiProvider`)

> **Size note**: over the usual tasks-artifact budget, following the precedent of
> `archive/2026-09-19-panel-admin/tasks.md` and this change's own `design.md`. The
> migration runs unattended on production and cannot be retried by hand; the five
> `serializarMotor()` call sites and the split-group keyless case have no spec
> scenario, so they need explicit checklists, not a compressed summary.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1600–1800 (migration.sql + migration_down.sql ~390 · catalogo.ts ~60 · DTOs + API routes ~450 · admin UI ~450 · e2e rewrite ~250 · cleanup ~20) |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR (`size:exception`) |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

The honest estimate is High. Per the cached session preflight, `delivery_strategy`
is `exception-ok` and the review budget is unbounded — the maintainer already
accepted `size:exception` for this change, so this does **not** recommend chained
PRs and no decision is needed before `sdd-apply`. The migration, the DTO/API
surface and the admin UI are one causal chain (schema shape → serializer shape →
route shape → form shape); splitting them across PR boundaries would leave
intermediate PRs failing `npm run check`.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Schema + hand-written migration (up + down) | single PR | `npm run db:generate && npm run check` | Dev-DB rehearsal (Phase 2) — no automated harness exists | revert branch + hand-run `migration_down.sql` + `prisma migrate resolve --rolled-back` |
| 2 | Migration rehearsal proof (all group shapes) | single PR | N/A — no unit runner | dev-DB seed + `migrate deploy` + decrypt check (Phase 2) | discard scratch dev-DB data; no prod effect |
| 3 | `catalogo.ts` runtime read path | single PR | `npm run check` | `npx tsx e2e/m3-motores.ts` (teacher-selector step) | revert branch; no migration |
| 4 | Admin DTOs + `/api/admin/providers` + `/api/admin/models` rewiring | single PR | `npm run check` | `npx tsx e2e/m3-motores.ts` | revert branch; no migration |
| 5 | Admin UI (`/admin/proveedores`, `ModeloForm.tsx`, `ModelosPanel.tsx`) | single PR | `npm run check` | Manual/Playwright, both themes | revert branch; no migration |
| 6 | `e2e/m3-motores.ts` rewrite + `scripts/rotar-clave.ts` repoint | single PR | `npm run check` | `npx tsx e2e/m3-motores.ts` full run, both themes | revert branch; no migration |

---

## Phase 1: Schema + Migration

- [x] 1.1 `prisma/schema.prisma`: add `AiProvider` per design §1; `AiModel` loses `provider`/`baseUrl`/`apiKeyCipher`/`apiKeyHint`, gains `providerId` + `provider` relation (`onDelete: Restrict`); swap `@@unique([provider, providerModel])` → `@@unique([providerId, providerModel])`. No `@@index([providerId])` (the unique already leads with it). *Ref: design §1, §3; spec `ai-provider-catalog` "AiProvider data model"; spec `ai-model-catalog` "AiModel data model", "Model identity is unique per provider account".*
- [x] 1.2 Hand-write `prisma/migrations/20260924000000_catalogo_de_proveedores/migration.sql` exactly per design §2.1–§2.3, in order: `CREATE TABLE AiProvider` + nullable `AiModel.providerId` (§2.1) → the grouping CTE + `UPDATE` with the `cifradas`/`ancla_con_clave`/`ancla_sin_clave` CASE (§2.2) → the `INSERT … SELECT` with account numbering + hint (§2.2) → orphan check `DO $$ … RAISE EXCEPTION` (§2.2) → `SET NOT NULL` + FK guarded by `pg_constraint` lookup (§2.2) → `DROP INDEX`/`CREATE UNIQUE INDEX` swap, **then** the four `DROP COLUMN`s last (§2.3). Open with the Spanish WHY comment block from §2.1. *Ref: design §2; spec "Zero manual post-deploy steps", "Migration preserves the encryption AAD", "Conservative grouping prevents silent key loss".*
- [x] 1.3 Write `migration_down.sql` beside it per design §2.5: `BEGIN`/`COMMIT` wrap (not bare psql autocommit — it has an abort path), the `choques` abort check, column restore, the `enabled` cascade-off `UPDATE` with `RAISE NOTICE`, `provider`/`baseUrl` `SET NOT NULL`, index swap back, drop FK/column/table. *Ref: design §2.5; spec "Down migration fails loudly, never destructively".*
- [x] 1.4 `npm run db:generate` — confirm `src/generated/prisma` reflects the new shape. Not itself a green build (Phases 3–6 depend on it), but a required checkpoint before `npm run check` can mean anything. *(npm run check precondition)*
- [x] 1.5 Register on the working dev DB per design "Dev sequence": `npm run db:deploy` on a fresh DB, or `npx prisma migrate resolve --applied 20260924000000_catalogo_de_proveedores` where already applied by hand. **Never `prisma migrate dev`** — it cannot express the partial index `AiModel_un_solo_default` and would drop it. *Ref: design "Migration / Rollout".* — DONE: `npm run db:deploy` applied cleanly against the real working dev DB after the rehearsal (below) proved safe.

## Phase 2: Migration Rehearsal (dev-DB proof — no automated harness)

**This is the change's only proof that production keys survive.** Do this against
a disposable dev DB, before treating Phase 1 as done. Do not commit scratch
fixture rows.

- [x] 2.1 Reset a scratch dev DB to the pre-migration schema (migrations up to but not including `20260924000000_…`). Seed four `AiModel` groups sharing (`provider`, `baseUrl`) per group, using the app's own `cifrar()` (`src/lib/crypto/secretos.ts`) so ciphertexts are real: **(a)** all-NULL group, 2+ rows, no cipher; **(b)** single-cipher group, 1 keyed row + N keyless rows; **(c)** multi-cipher group, 2+ rows with distinct real ciphers; **(d)** split-group keyless case — a multi-cipher group (like (c)) that *also* contains NULL-cipher rows, exercising the `ancla_sin_clave` branch (design §2.2, `WHEN g.cifradas >= 2 THEN g.ancla_sin_clave`). *Ref: design §2.2; spec "All-NULL group folds into one provider", "Single-cipher group merges around its anchor", "Multi-cipher group never merges" — case (d) has no spec scenario, hence this explicit task.* — DONE: cloned `koduedu` → `koduedu_migration_test` (`CREATE DATABASE … WITH TEMPLATE`) while it was still pre-migration (13/14 migrations applied); this gave case (a) for free from the real seed (`gmi` group, 2 NULL-cipher rows) plus deepseek/openrouter singletons; seeded groups b/c/d by hand via a throwaway `scratch-rehearsal-seed.ts` (raw SQL insert, since the generated Prisma client already matched the post-migration shape) calling real `cifrar()`. Script deleted after use, scratch DB dropped after use.
- [x] 2.2 Apply `20260924000000_catalogo_de_proveedores` against the seeded DB (`npm run db:deploy` or `psql -f migration.sql`). — DONE via `docker exec -i kodu_db_dev psql -U kodu -d koduedu_migration_test -f - < migration.sql`; exit clean, no errors.
- [x] 2.3 Assert every `AiModel` row has a non-null `providerId` and the migration did not raise the orphan exception. — DONE: `SELECT COUNT(*) FROM "AiModel" WHERE "providerId" IS NULL` → 0. No `RAISE EXCEPTION` printed.
- [x] 2.4 Assert case (a): exactly one `AiProvider` created, `id` = `MIN(id)` of the group, `apiKeyCipher IS NULL`. — DONE: `gmi` group (ids …0001, …0002) both point to providerId …0001 (`MIN(id)`), `AiProvider …0001.apiKeyCipher` is NULL.
- [x] 2.5 Assert case (b): exactly one `AiProvider` created at the anchor's `id`, cipher/hint copied verbatim, and it still **decrypts** with `descifrar()` using the provider's own `id` as AAD. — DONE: `b…0001/0002/0003` all point to providerId `b…0001` (the keyed anchor); `descifrar()` recovered the exact plaintext `clave-B-anchor-0001`.
- [x] 2.6 Assert case (c): one `AiProvider` per ciphered row, each keeping its own `id`/cipher, each still decrypting; no cipher discarded or moved. — DONE: `c…0001` and `c…0002` each became their own `AiProvider`, both decrypted correctly to their original distinct plaintexts.
- [x] 2.7 Assert case (d) specifically: the NULL-cipher rows land on a **separate keyless `AiProvider`** distinct from every keyed account split out of the same group — not folded into any of them. *Ref: design §3 architecture decision "Keyless rows inside a split group"; finding 4 — no spec scenario covers this.* — DONE: `d…0001` and `d…0002` (keyed) each got their own provider and decrypted correctly; `d…0003` and `d…0004` (keyless) both landed on a third, separate keyless provider `d…0003` (`ancla_sin_clave` = MIN(id) among the keyless rows) — never folded into either keyed account.
- [x] 2.8 Run the down-migration abort scenario per design §10: apply up, create two models with the same `providerModel` on two `AiProvider`s of one `kind`, run `migration_down.sql`, assert it raises and `AiProvider` still exists (no destructive change on abort). *Ref: design §2.5, §10; spec "Down migration aborts on a post-migration duplicate".* — DONE: inserted two `AiModel` rows with `providerModel = 'mismo-modelo-x'` on `c…0001` and `c…0002` (both `kind = 'grupo-c'`); ran `migration_down.sql`; it printed the exact `choques` error naming `grupo-c / mismo-modelo-x (2 motores)`, `ROLLBACK`'d, and `AiProvider` still had all 9 rows afterward.

**Rehearsal verdict: PASS.** All 4 group shapes behaved exactly per design; all 5 pre-existing ciphertexts (1 from case b, 2 from case c, 2 from case d) still decrypt with `descifrar()` using each provider's own id as AAD; the down-migration abort path is proven non-destructive. The real working dev DB was then migrated for real with `npm run db:deploy` (task 1.5) — 3 providers created (`gmi`, `deepseek`, `openrouter`), all 4 seeded `AiModel` rows correctly repointed, zero orphans.

## Phase 3: Catalog / Runtime Read Path

- [x] 3.1 `src/lib/ai/catalogo.ts`: add `include: { provider: true }` to the `findMany`; add `FilaConProveedor` type and `utilizable(fila)` = `fila.enabled && fila.provider.enabled`. *Ref: design §4.*
- [x] 3.2 Fold `utilizable()` into each predicate per the design's function table, **traversal untouched**: `motoresParaDocente()` filter, `motorPorDefecto()`'s both branches, `normalizarMotor()`'s check, `cadenaDeMotores()`'s push guard only (`visitados`, `TOPE_CADENA`, the fallback hop, the empty-chain fallback all stay verbatim). `resolverMotor()` stays unchanged (no caller in `src/`). *Ref: design §4 table; spec `ai-provider-catalog` "Account-level cascade disable"; spec `ai-model-catalog` "Model-level fallback chain may span providers".*
- [x] 3.3 Update the decrypt call site to read `fila.provider.apiKeyCipher`, decrypt with AAD `fila.provider.id`; `construirConfig()` takes `baseUrl` from `fila.provider.baseUrl`; error logs name the model id **and** the provider id. `src/lib/ai/provider.ts` and `ProviderConfig`'s shape are untouched. *Ref: design §4.*
- [x] 3.4 `src/lib/crypto/secretos.ts` (lines ~5, ~99–114): docstring-only update — the AAD is "the id of the row that owns the cipher," no functional change. *Ref: design §9.*

*(npm run check, after Phase 1's `npm run db:generate`)*

## Phase 4: Admin DTOs + API

- [x] 4.1 Create `src/lib/admin/proveedores.ts`: `ProveedorAdmin` interface + `serializarProveedor()`, never emits `apiKeyCipher`. *Ref: design §5; spec "API key ciphertext never crosses the network".*
- [x] 4.2 `src/lib/admin/modelos.ts:11–60`: `MotorAdmin.provider` becomes `ProveedorAdmin` (was a string), add `providerId`; `serializarMotor(fila: AiModel & { provider: AiProvider })` new signature. *Ref: design §5.*
- [x] 4.3 Fix all **five** `serializarMotor` call sites — every one needs `include: { provider: true }` or `npm run check` fails:
  - [x] 4.3.1 `src/pages/admin/motores.astro:8` → feeds the call at `:9`.
  - [x] 4.3.2 `src/pages/api/admin/models/index.ts` GET, `findMany` at `:44` → feeds the call at `:45`.
  - [x] 4.3.3 `src/pages/api/admin/models/index.ts` POST/create, query at `:104` → feeds the call at `:106`.
  - [x] 4.3.4 `src/pages/api/admin/models/orden.ts:40` → feeds the call at `:41`. **The proposal wrongly says this file is untouched; the design corrects it.**
  - [x] 4.3.5 `src/pages/api/admin/models/[id].ts`: **two** distinct branches feed the **one** `serializarMotor` call at `:130` — the `$transaction` update at `:122–125` and the plain update at `:127`. Add the include to both.
  *Ref: design §9 File Changes table + design §4 note "the relation field is named `provider`".*
- [x] 4.4 Create `src/pages/api/admin/providers/index.ts`: `crearProveedorSchema` (zod, per design §6); `GET` → `findMany({ orderBy: [{kind:'asc'},{label:'asc'}], include: {_count:{select:{modelos:true}}} })` returning `{ proveedores }`; `POST` follows `models/index.ts:64-75`'s order verbatim — `id = randomUUID()` **before** `cifrar()`, catch `ClaveNoConfigurada` → 503. *Ref: design §6; spec "Two accounts of the same kind coexist".*
- [x] 4.5 Create `src/pages/api/admin/providers/[id].ts`: `PATCH` only, no `DELETE` (FK is `Restrict`); leading `findUnique` → 404 `"Esa cuenta no existe."`; every field optional; `apiKey` semantics `undefined`=leave / `null`=clear / string=replace, encrypted with `existente.id` (never a new id). *Ref: design §6; spec "No delete lifecycle".*
- [x] 4.6 Update `src/pages/api/admin/models/index.ts` + `[id].ts` schemas: drop `provider`/`baseUrl`/`apiKey`, add `providerId` (required on POST, optional on PATCH); add explicit `findUnique(providerId)` pre-check → 422 `"La cuenta de proveedor elegida no existe."`; change P2002 copy to `"Ya existe un motor con ese identificador en esa cuenta."`; P2003/P2025 copy `"El motor de respaldo elegido no existe."` now only reachable for `fallbackModelId`. *Ref: design §6 error mapping table; spec "Model identity is unique per provider account".*
- [x] 4.7 Wire `invalidarCatalogo()` into every `/api/admin/providers/*` mutation (POST, PATCH), matching the models routes' existing pattern. *Ref: design §4 table, `invalidarCatalogo` row.*
- [x] 4.8 Verify (no code change expected): `ADMIN_API_PREFIXES`/`matches()` in `src/middleware.ts:19-24,130-134` already covers `/api/admin/providers` and `/api/admin/providers/<id>` — `requireAdmin` on GET, `requireFreshAdmin` on POST/PATCH; CSRF origin check applies before route matching. *Ref: design §6 middleware note.* — VERIFIED by reading `src/middleware.ts`: `ADMIN_API_PREFIXES = ['/api/admin']` and `matches()` does a `/`-boundary prefix match, so the new routes are covered with zero code change.

*(npm run check)*

## Phase 5: Admin UI

- [x] 5.1 `src/layouts/AdminLayout.astro:20-25`: add `{ href: '/admin/proveedores', etiqueta: 'Proveedores' }` **before** `Motores`. *Ref: design §7.*
- [x] 5.2 Create `src/pages/admin/proveedores.astro`: mirrors `motores.astro` — SSR `findMany` + `_count`, `serializarProveedor`, one `client:load` island. *Ref: design §7.*
- [x] 5.3 Create `src/components/admin/ProveedoresPanel.tsx`: row list (not cards) — `label` over `kind · baseUrl`, key hint, `N motores`, `Interruptor` (optimistic toggle + rollback, copied from `ModelosPanel.toggleEnabled`), `Editar`; disabled-account inline strip `Esta cuenta está apagada: sus N motores no se ofrecen.` (no confirmation modal); empty state `kodu-card p-10 text-center`; header `+ Nueva cuenta`. No drag handle, no order column, no default radio. *Ref: design §7.*
- [x] 5.4 Create `src/components/admin/ProveedorForm.tsx`: `Modal` + `kind`/`label`/`baseUrl`, write-only `Reemplazar clave` (`type="password"`, `autoComplete="new-password"`, placeholder `•••• 2345` / `Sin clave`), `Interruptor` for `enabled` when editing. *Ref: design §7.*
- [x] 5.5 `src/components/admin/ModeloForm.tsx`: delete the `provider`/`baseUrl`/`apiKey` inputs and their state — **the provider `<div>` starts at `:138`, not `:140` as the design's cited range says**; add one `<select id="…-provider">` labelled `Cuenta de proveedor` (options `label` + ` (apagada)` when disabled, plus a placeholder); new prop `proveedores: ProveedorAdmin[]`; **the validation string that changes is at `:81`, outside the design's cited `54-59,140-239` range** — update it to `'Completá la cuenta, el identificador y el nombre.'`; add the zero-provider empty state (`kodu-card`, link to `/admin/proveedores`, `Guardar` disabled, `+ Nuevo motor` stays enabled). *Ref: design §7; proposal risk "Model form becomes unusable with zero providers"; spec `ai-model-catalog` "Model form requires selecting an existing provider".*
- [x] 5.6 Thread `proveedores: ProveedorAdmin[]` prop: `proveedores.astro`/`motores.astro` → `ModelosPanel` → `ModeloForm`. *Ref: design §7.*
- [x] 5.7 `src/components/admin/ModelosPanel.tsx:189-198`: row line 2 becomes `{motor.provider.label} · {motor.providerModel}`; key column reads `motor.provider.tieneClave`/`apiKeyHint`; add a muted `Cuenta apagada` chip when `!motor.provider.enabled`. *Ref: design §7 — "this is the proposal's mitigation for 'a model quietly stops working'".*
- [ ] 5.8 **Manual/Playwright browser check** (both themes): the zero-provider empty state in `ModeloForm.tsx` from 5.5 is not automatable without emptying the table (design §10.9) — verify by hand: empty the dev `AiProvider` table, open `/admin/motores`, confirm the empty-state card renders and `Guardar` is disabled while `+ Nuevo motor` stays clickable. **NOT DONE** — requires a live browser session; `npm run check` and the code review both confirm the `sinProveedores` branch and `disabled={pending || sinProveedores}` are wired correctly, but this is a genuine manual/Playwright gap, honestly left open.
- [x] 5.9 `rg -n 'bg-white|bg-slate-' src/components/admin src/pages/admin/proveedores.astro` — expect no output. — DONE: no output.

*(npm run check for types; 5.8–5.9 are manual)*

## Phase 6: e2e Rewrite

Rewrite `e2e/m3-motores.ts` per design §10 exactly:

- [x] 6.1 `limpiarEstado()`: delete test **models first, then test providers** (FK is `Restrict`); must not touch seeded accounts. — DONE and verified post-run: `AiProvider` table back to exactly the 3 seeded accounts (`gmi`, `deepseek`, `openrouter`), `AiModel` back to the 4 seeded rows with the original `sortOrder`/`isDefault`.
- [x] 6.2 Create a provider through the real UI at `/admin/proveedores` (dark theme): `kind` `test-e2e`, `label` `Cuenta E2E`, a base URL, key `CLAVE_DE_PRUEBA`; assert `POST` 200 and the body contains neither the plaintext nor `apiKeyCipher`.
- [x] 6.3 Assert the row renders `•••• 2345`; DB check `aiProvider.apiKeyCipher` starts with `v1.` and is not the plaintext.
- [x] 6.4 **Ciphertext-leak assertion**: `GET /api/admin/providers` response text contains none of `CLAVE_DE_PRUEBA`, `apiKeyCipher`, `'v1.'`. *Ref: spec "List response omits ciphertext".*
- [x] 6.5 Create the model at `/admin/motores` by choosing `Cuenta E2E` in the `<select>`; assert the labels `Proveedor`, `URL base`, `Reemplazar clave` are **absent** from the model dialog. — **Real bug caught by the harness**: `page.getByLabel('Proveedor')` does a case-insensitive SUBSTRING match by default, and the new select's label "Cuenta de proveedor" contains the substring "proveedor" — the first run false-failed on this. Fixed by adding `{ exact: true }` to the three absence checks.
- [x] 6.6 Carry over steps 2–10 of the current script (enable/disable, default, the 409, keyboard reorder, masked `GET /api/admin/models`, teacher selector, repoint notice, both themes) with updated selector text for the new shape.
- [x] 6.7 **New — the cascade**: `PATCH /api/admin/providers/<id>` with `enabled: false`; assert the model leaves the teacher selector while `aiModel.enabled` stays `true` in the DB; re-enable, assert it returns. *Ref: spec "Disabling an account hides its models without touching their flags", "Re-enabling restores prior per-model state".*
- [x] 6.8 **New — the feature itself**: a second provider of kind `test-e2e` plus a second model with the **same** `providerModel` returns 200 — impossible before this change. *Ref: spec "Same provider-model string on two accounts of the same kind".*
- [x] 6.9 Note (no new task): the zero-provider empty state stays a manual check, covered by 5.8 — do not duplicate it here.
- [x] 6.10 Run `npx tsx e2e/m3-motores.ts`, both themes; must pass. — DONE: full green run against the real dev server + dev DB (see apply-progress.md for the complete console transcript). Both themes exercised (light baseline + dark for creation/reorder + light/dark for the repoint scenarios).

**Deviation not in tasks.md**: `npm run check` also failed on 6 OTHER e2e scripts (`m4-costos.ts`, `m5-usuarios.ts`, `m6-acceso.ts`, `m7-demo.ts`, `m8-proyectos-ajenos.ts`, `unidad.ts`) that create `AiModel` test fixtures directly via Prisma or through `POST /api/admin/models` with the old `provider`/`baseUrl`/`apiKey` shape. Neither design.md nor this tasks.md scoped them (only `e2e/m3-motores.ts` is listed), but they are compile-time casualties of the schema change and block the "npm run check clean across the whole change" gate (7.2). Fixed all six by adding a fixed-id test `AiProvider` fixture per file (or, for m6/m7/m8, a real `POST /api/admin/providers` call before creating the model). See apply-progress.md "Deviations" for the full list.

**Correction (remediation batch)**: "6 OTHER e2e scripts" was wrong — it was 7. `e2e/m2-catalogo.ts` also writes to a dropped column (`AiModel.apiKeyCipher`) and was missed here and in apply-progress.md. Also, the "fixed" claim for the six above was only ever a compile-time claim (`npm run check` green) — it was never runtime-verified in the first batch, and five of those "fixed" call sites (`m4-costos.ts:73,94`, `m5-usuarios.ts:105,123,141`) still had a *different* stale dropped-column write (`baseUrl` on `AiModel`) that `tsc` cannot see inside a `prisma.aiModel.create()` data literal. See the "Remediation Batch" tasks below and apply-progress.md's "Remediation Batch" section for the full fix and real per-script transcripts.

## Remediation Batch (2026-09-19) — fixes for `sdd-verify` FAIL + fresh-context contract validator FAIL

- [x] R.1 Remove the 5 stale `baseUrl` writes from `e2e/m4-costos.ts:73,94` and `e2e/m5-usuarios.ts:105,123,141`'s `prisma.aiModel.create()` calls. Audit every `prisma.aiModel.*` call site in `src/`, `e2e/`, `scripts/` for writes to any of the four dropped columns (`baseUrl`, `apiKeyCipher`, `apiKeyHint`, old scalar `provider`) — result: only `e2e/m2-catalogo.ts` (R.2) had another instance; nothing else.
- [x] R.2 Fix `e2e/m2-catalogo.ts:125,135` (the undeclared 7th affected script) and re-express its "keyless engine gets skipped" scenario under the account-level key model: a second, temporary `AiProvider` with a real key, MiniMax M2.7 temporarily re-pointed to it, MiniMax M3 left on the shared keyless `gmi` account, restored in a `finally` block.
- [x] R.3 Re-run the migration rehearsal (all 4 group shapes + 5 decrypt verifications + down-migration abort path) against a fresh scratch clone; make it durable under `openspec/changes/catalogo-de-proveedores/rehearsal/` (`README.md`, `seed.ts`, `verify.ts`, `down-abort-setup.sql`, `rehearsal-output.log`). Add a new migration-rerun-idempotency check (same `migrate deploy` a second time, before/after checksum, confirmed no-op).
- [x] R.4 Add the 6 missing runtime assertions: cascade-selector visibility both directions and masked-key UI rendering and same-account duplicate-`providerModel` rejection (all 3 in `e2e/m3-motores.ts`), the cross-provider fallback chain (`e2e/unidad.ts`), and migration-rerun idempotency (R.3). Task 5.8 stays open — correctly, it needs an interactive browser.
- [x] R.5 Run all 7 affected e2e scripts (`m2`, `m3`, `m4`, `m5`, `m6`, `m7`, `m8`, plus `unidad.ts`) for real against the dev server + dev DB. All green (see apply-progress.md for full transcripts; `m5-usuarios.ts` had one unrelated pre-existing flake on its 1st run, clean on the 2nd).
- [x] R.6 Correct the 5 false/inaccurate statements identified in `verify-report.md`'s review of apply-progress.md (the "now schema-correct" claim, the "six" vs. seven script count in two places, the `proveedores.astro`/`ModelosPanel` prop-threading claim, and the diff-stat arithmetic) directly in apply-progress.md, and append a full "Remediation Batch" section there.
- [x] R.7 `npm run check` clean across the whole repo, including the new `openspec/.../rehearsal/*.ts` files (picked up by `tsconfig.json`'s `"include": ["**/*"]`).

## Phase 7: Cleanup

- [x] 7.1 `scripts/rotar-clave.ts`: `prisma.aiModel` → `prisma.aiProvider`; `select: { id, label, apiKeyCipher }`; **the `displayName` in the log line that becomes `label` is at `:60`, outside the design's cited `36-57` range** — update it there too. Still an operator tool, still outside the runtime image. *Ref: design §9.*
- [x] 7.2 Run `npm run check` clean across the whole change (post `db:generate`). — DONE: `tsc --noEmit` exits clean, zero errors, across the entire repo (not just touched files).
- [x] 7.3 Final sweep: `rg -n 'bg-white|bg-slate-' src/` on every touched path — expect no output. — DONE: only pre-existing, untouched comment lines in `src/styles/global.css` mention the strings (documenting the design-token convention itself); zero actual usages anywhere, touched or not.
- [x] 7.4 Confirm out-of-scope items untouched: `src/lib/env.ts` dead per-engine vars, provider deletion, key-rotation UI, provider-level fallback, `TokenUsage`/`Project` FKs, `cadenaDeMotores()` traversal logic. *Ref: proposal "Out of Scope".* — VERIFIED: `src/lib/env.ts` not touched; no DELETE route added anywhere; no key-rotation UI added; no provider-level fallback; `TokenUsage`/`Project` FK definitions in `schema.prisma` untouched; `cadenaDeMotores()`'s traversal (`visitados`, `TOPE_CADENA`, the fallback hop, the empty-chain fallback) is byte-for-byte the same as before, only the push guard's condition changed (`fila.enabled` → `utilizable(fila)`).
