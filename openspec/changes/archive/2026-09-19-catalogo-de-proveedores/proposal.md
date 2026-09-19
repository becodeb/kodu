# Proposal: Catálogo de proveedores (`AiProvider`)

**Impact flags (per `config.yaml` rules.proposal):** this change affects the **Prisma schema** (new `AiProvider` table, four columns leave `AiModel`, the unique constraint changes) and the **AI resource-generation flow** (key and base URL now resolve through a join in `src/lib/ai/catalogo.ts`). It does **not** affect auth — `src/middleware.ts` already protects the `/api/admin` prefix that the new routes live under.

## Intent

Today the provider account and the model are the same row. An admin who wants three GMI models types the same API key three times, into three encrypted columns, and rotates it in three places. Worse, `@@unique([provider, providerModel])` makes the thing the owner actually asked for impossible: the same provider kind, the same provider-side model id, configured twice against two different accounts — one key for the school, another for personal use — and chosen per model.

Splitting the account into `AiProvider` stores the key once, makes the duplicate-account case legal instead of forbidden, and gives the admin one place to disable a whole account.

## Scope

### In Scope

- **`AiProvider` table**: `kind` (stable slug), `label` (human), `baseUrl`, `apiKeyCipher`, `apiKeyHint`, `enabled`, timestamps. `AiModel` loses those four columns and gains `providerId` (FK, `onDelete: Restrict`).
- **The constraint change is the feature**: `@@unique([provider, providerModel])` → `@@unique([providerId, providerModel])`.
- **Pure-SQL data migration** (up + `migration_down.sql`), idempotent under `prisma migrate deploy`, run unattended.
- **`AiProvider.enabled`** as account-level cascade disable; `catalogo.ts` folds `provider.enabled` into every predicate that reads `fila.enabled` today.
- `/admin/proveedores` page + nav item, `ProveedoresPanel.tsx`, `ProveedorForm.tsx`, `src/lib/admin/proveedores.ts` (`ProveedorAdmin` DTO, never serializes `apiKeyCipher`).
- `GET`/`POST /api/admin/providers`, `PATCH /api/admin/providers/[id]`. No DELETE.
- `ModeloForm.tsx`: provider/baseUrl/key fields collapse into a provider `<select>` with an empty state pointing at `/admin/proveedores`.
- `scripts/rotar-clave.ts` repointed to `prisma.aiProvider`; `secretos.ts` docstrings updated (AAD semantics only, no functional change).
- **`e2e/m3-motores.ts` rewrite** — first-class work, not cleanup. It drives a model-creation flow whose fields are moving, so it must create a provider first, and must assert `GET /api/admin/providers` never leaks ciphertext.

### Out of Scope

- **Removing the dead per-engine env vars** in `src/lib/env.ts:48-93`. Confirmed unread anywhere in `src/`, but deleting them is unrelated cleanup that only grows the diff. **Follow-up.**
- Provider-level fallback (see Approach), provider deletion, key rotation UI, per-provider rate limits or quotas, consolidating providers the migration split apart (a manual one-minute panel task).
- Any change to `TokenUsage` / `Project` FKs, to `cadenaDeMotores()`'s traversal logic, or to model-level orchestration fields.

## Capabilities

### New Capabilities

- `ai-provider-catalog`: the provider account as its own entity — `kind` vs `label`, base URL, key encryption and masking, account-level enable/disable and its cascade onto models, no-delete lifecycle, and the admin surface that manages it.

**Why a sibling and not just a delta:** the provider now has its own lifecycle, its own CRUD surface and its own enable semantics. Folding that into `ai-model-catalog`, whose Purpose is "models as data", would leave one spec describing two entities and would make the eventual archive merge unreadable.

### Modified Capabilities

- `ai-model-catalog`: *Requirement: AiModel data model* (provider, key and base URL leave the model; `providerId` arrives), *Requirement: Key encryption at rest* (the encrypted key now lives on the provider row; the "never reaches the browser" guarantee is unchanged and moves with it), plus a new requirement that model identity is unique per provider account rather than per provider label.

## Approach

| # | Decision | Rationale |
|---|---|---|
| 1 | `AiProvider.id` = the `id` of the anchor `AiModel` it inherits the key from | The AAD for AES-256-GCM is the owning row's id. Keeping the value identical means the copied ciphertext still authenticates and **no crypto runs during the migration at all** — which is what makes pure SQL possible |
| 2 | Provider keeps both `kind` and `label` | `kind` ("gmi", "deepseek", "openrouter") is what makes "the same provider twice" legible to code and to the admin; `label` ("GMI — cuenta escuela") is what disambiguates two accounts of the same kind in the model form's dropdown. The existing free-text `AiModel.provider` column becomes `kind`, so this is a rename plus one new column, not two new concepts |
| 3 | Separate `/admin/proveedores` screen, own nav item | Mirrors `/admin/motores`. Tabs would entangle `ModelosPanel`'s existing optimistic-update logic for no gain |
| 4 | `AiProvider.enabled` ships now | Disabling an account makes every model on it behave as disabled without flipping each model's own bit, so re-enabling restores prior per-model state. `cadenaDeMotores()` already skips configs without a usable key while continuing to traverse — this extends an existing predicate rather than adding a mechanism |
| 5 | No DELETE route; FK is `Restrict` | Matches the existing `AiModel` precedent. `SetNull` would orphan models (no key, no base URL); `Cascade` would delete models whose ids `TokenUsage` and `Project` still reference |
| 6 | Model-level fallback stays exactly as it is | "Same model, two accounts, primary and fallback" is inherently model-to-model: row A on provider 1 falls back to row A′ on provider 2. A provider-level fallback would still have to re-derive *which* model to use on the fallback account — model-level fallback with an extra hop — and it would break the existing cross-model chain (M3 → M2.7 → DeepSeek) |

### Hard requirement: zero manual post-deploy steps

Production deploys via a Coolify webhook on push. `docker/prod-entrypoint.sh:11` runs `npx prisma migrate deploy` before starting the server, but the runner image cannot run a TypeScript backfill: `Dockerfile:51` is `npm ci --omit=dev` (no `tsx`) and `Dockerfile:53-56` copies only `dist`, `prisma`, `prisma.config.ts` and the entrypoint — **`scripts/` is not in the image**.

**Acceptance condition, first-class:** push → webhook → `migrate deploy` → working app, with every existing API key still decrypting, and nobody logging into anything. The migration must be pure SQL and must not depend on anything outside `prisma/`.

### Non-negotiable safety invariant: conservative grouping

Group existing rows by (`provider`, `baseUrl`). Within each group:

- Rows with a NULL cipher carry no secret and always fold into the group's provider.
- **At most one** non-null cipher in the group → that row is the anchor; the `AiProvider` takes its `id`, cipher and hint verbatim.
- **Two or more** non-null ciphers → **do not merge.** Emit one `AiProvider` per such row, each keeping its own id and its own cipher.
- Zero non-null ciphers → a deterministic id reused from the group's own rows (`MIN(id)`); no cipher is bound to it, so the AAD is irrelevant. Not `gen_random_uuid()`, which would not be deterministic.

GCM uses a random nonce, so two encryptions of the same plaintext always differ: ciphertext comparison **cannot** tell "same key stored twice" from "two different keys". Relaxing this into "always merge by provider+baseUrl" therefore introduces silent key loss — a model authenticating against an account that is not its own. The worst case of the conservative rule is cosmetic: two provider entries the admin consolidates by hand in a minute.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `prisma/schema.prisma:161-213` | Modified | New `AiProvider`; `AiModel` loses four columns, gains `providerId`; unique constraint swap |
| `prisma/migrations/<ts>_catalogo_de_proveedores/` | New | Pure-SQL `migration.sql` + `migration_down.sql` |
| `src/lib/ai/catalogo.ts:34-93` | Modified | `include: { provider: true }`; decrypt with AAD `fila.provider.id`; base URL from the join; enabled predicates fold in `provider.enabled` |
| `src/lib/admin/modelos.ts:11-60` | Modified | `MotorAdmin` gains `providerId`, sources provider fields from the join |
| `src/lib/admin/proveedores.ts` | New | `ProveedorAdmin` DTO + `serializarProveedor()` |
| `src/pages/api/admin/providers/index.ts`, `[id].ts` | New | GET/POST, PATCH. No DELETE |
| `src/pages/api/admin/models/index.ts`, `[id].ts` | Modified | Schemas drop `provider`/`baseUrl`/`apiKey`, gain `providerId`. `orden.ts` untouched |
| `src/pages/admin/proveedores.astro`, `src/components/admin/Proveedores*.tsx` | New | Panel screen mirroring `/admin/motores` |
| `src/components/admin/ModeloForm.tsx:54-59,140-239` | Modified | Provider `<select>` + empty state |
| `src/components/admin/ModelosPanel.tsx:190-198` | Modified | Row shows provider label and key hint from the join |
| `src/lib/crypto/secretos.ts:99-114` | Modified | Docstrings only — AAD is "the id of the row that owns the cipher" |
| `scripts/rotar-clave.ts` | Modified | `prisma.aiModel` → `prisma.aiProvider` |
| `e2e/m3-motores.ts:99-131` | Modified | Provider-creation step; ciphertext-leak assertion |
| `src/middleware.ts:130-134` | Verify | `/api/admin` prefix should already cover the new routes — confirm, do not assume |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Migration runs unattended and irreversibly on prod | High | Pure SQL, idempotent, no dependency outside `prisma/`; paired `migration_down.sql`; conservative grouping never discards a cipher |
| Grouping rule relaxed during implementation "to be tidier" | Med | Stated here as a non-negotiable invariant and carried into the spec as a MUST; the failure mode is silent |
| Migration emits duplicate providers for one real account | Med | Accepted and documented as the safe side of the trade; the admin re-points models and disables the extra in the panel |
| Model form becomes unusable with zero providers | High | Explicit empty state linking to `/admin/proveedores`; the model POST schema rejects a missing `providerId` |
| No unit tests; `npm run check` is the only automated gate | High | `e2e/m3-motores.ts` rewrite is in scope; Playwright verification of both admin screens in both themes |
| A model is left pointing at a disabled provider and quietly stops working | Med | Provider disabled state is visible on the model row, not only on the provider screen |

## Rollback Plan

Revert the branch and run `migration_down.sql`, which recreates `provider`, `baseUrl`, `apiKeyCipher` and `apiKeyHint` on `AiModel` and copies each provider's values back into every model that points at it. Because the AAD never changed, restored ciphertext decrypts against the anchor model's id exactly as it did before — but a model that was re-pointed to a *different* provider after the migration will come back carrying that provider's key, which is the correct current state, not a regression. `AiProvider` is dropped last. Models created after the migration on a second account of the same kind would violate the restored `@@unique([provider, providerModel])`; the down migration must fail loudly in that case rather than delete rows.

## Dependencies

- No new npm dependencies, no new env vars.
- `KODU_ENCRYPTION_KEY` must be the same value in prod as when the existing keys were encrypted — already true, and unchanged by this proposal.

## Success Criteria

- [ ] An admin creates one provider with one API key, then three models on it, without ever re-typing the key.
- [ ] The same provider kind is configured twice with two different keys, and two model rows with the same `providerModel` coexist, one on each account.
- [ ] Deploy is push-only: the webhook fires, `migrate deploy` applies the SQL, the app starts, and every pre-existing API key still decrypts. No script is run by hand.
- [ ] No group with two or more distinct non-null ciphers is merged; no ciphertext is deleted or moved between accounts.
- [ ] Disabling a provider makes its models unavailable to teachers; re-enabling restores each model's own prior enabled state.
- [ ] `GET /api/admin/providers` never returns `apiKeyCipher` in any shape.
- [ ] Model-level fallback chains still resolve, including across two different providers.
- [ ] `npm run check` and `npm run build` pass; `e2e/m3-motores.ts` passes against the new flow; no `bg-white` / `bg-slate-*`; both themes verified.
