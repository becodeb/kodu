# Apply progress: `panel-admin`

## Phase 1: M1 — Authorization + `/admin` shell

**Status**: complete. 12/12 tasks done (1.1–1.12).

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npm run check` → exit 0, no output (clean `tsc --noEmit`) |
| Runtime harness command/scenario and exact result | `npx tsx e2e/m1-admin-shell.ts` → all 11 scenario assertions passed (anonymous redirect, `/adminfoo` / `/api/adminx` non-capture, DOCENTE page redirect + API 403 GET/POST, `/app` unaffected, ADMIN shell in light + dark theme, ADMIN pass-through on `/api/admin/*`, mid-session promotion without re-login) |
| Rollback boundary | `git revert` the two commits on `feat/panel-admin` (`feat(admin): ...` and the preceding docs commit if desired). No migration ran — `prisma/schema.prisma` is untouched. Rollback removes `/admin/**`, `guards.ts`, `AdminLayout.astro`, the nav pill and the e2e harness cleanly; `/app` and public routes are unaffected since M1 only adds new protected prefixes, it never rewrites the pre-existing ones |

### Completed tasks

- [x] 1.1 `src/env.d.ts` + `SessionUser` extended with `aiAccessOverride`, `isDemo`
- [x] 1.2 Per-request identity read in `src/middleware.ts`, gated-paths-only, with read-failure degrade
- [x] 1.3 `/admin` + `/api/admin` added to protected prefixes via `matches()`
- [x] 1.4 `src/lib/auth/guards.ts`: `requireUser` / `requireAdmin` / `requireFreshAdmin`
- [x] 1.5 Guards wired in middleware: 302 for pages, 403 JSON for APIs, 503 for stale mutations
- [x] 1.6 `src/layouts/AdminLayout.astro`
- [x] 1.7 `src/pages/admin/index.astro` + 4 empty shells
- [x] 1.8 Admin nav pill in `BaseLayout.astro` + `[data-menu-perfil]` → `[data-menu]` generalization
- [x] 1.9 `e2e/harness.ts`
- [x] 1.10 `e2e/m1-admin-shell.ts`
- [x] 1.11 Harness run + `rg` grep gate, both clean
- [x] 1.12 M1 checkpoint: `npm run check` green, `/admin` served under `npm run dev`, teacher app unaffected

### Files changed

| File | Action | What |
|---|---|---|
| `src/env.d.ts` | Modify | `identityFresh: boolean` on `App.Locals` |
| `src/lib/auth/session.ts` | Modify | `SessionUser` gains `aiAccessOverride`, `isDemo`; both constructors (`verifySessionToken`) default them |
| `src/lib/auth/guards.ts` | Create | `requireUser` / `requireAdmin` / `requireFreshAdmin`, `Response`-returning |
| `src/middleware.ts` | Modify | Per-request identity read (gated paths only), `/admin` + `/api/admin` protection, guard wiring |
| `src/layouts/AdminLayout.astro` | Create | Header + 4-tab row, `wide`, mobile `overflow-x-auto` strip |
| `src/pages/admin/index.astro` | Create | Redirect to `/admin/usuarios` |
| `src/pages/admin/{usuarios,motores,dominios,demo}.astro` | Create | Empty shells (M3/M5/M6/M7 fill these in) |
| `src/layouts/BaseLayout.astro` | Modify | Admin nav pill (ADMIN-only); `[data-menu-perfil]` → generic `[data-menu]`, script now closes every open `[data-menu]` |
| `e2e/harness.ts` | Create | `abrirNavegador`, `conTema`, `iniciarSesion` — imported by every later slice |
| `e2e/m1-admin-shell.ts` | Create | M1 scenario verification |
| `src/pages/api/auth/login.ts` | Modify | Session object gains `aiAccessOverride: null, isDemo: false` |
| `src/pages/api/auth/register.ts` | Modify | Same |
| `src/pages/auth/callback.ts` | Modify | Same |

### Deviations from design

1. **Identity-read column count.** Task 1.2 and design §1 describe a 6-column
   `select` (`id/email/name/role/aiAccessOverride/isDemo`). Neither
   `aiAccessOverride` nor `isDemo` has a database column yet — the design's
   own §1 snippet and §10/§8 sections are written against the *post-M6/M7*
   schema, but M6 (the `deepseekEnabled` → `aiAccessOverride` rename) and M7
   (`isDemo` addition) are later milestones, and M1's own work-unit rollback
   boundary in `tasks.md` says "no migration." Running a 6-column select
   today would not compile against the generated Prisma client. I selected
   the 4 columns that actually exist (`id/email/name/role`) and set
   `aiAccessOverride: null` / `isDemo: false` unconditionally until M6/M7
   land. This keeps `npm run check` green without touching the schema, and
   is a no-op change once those migrations exist (the fresh read already
   only fills fields that are meaningful today).
2. **Three extra files not in design's M1 file table.** Extending the shared
   `SessionUser` type (task 1.1) forced `src/pages/api/auth/login.ts`,
   `register.ts`, and `src/pages/auth/callback.ts` to construct the two new
   required fields when building the session object passed to
   `createSessionToken`. Design's M1 file table doesn't list these three,
   but the type extension makes the change unavoidable for `npm run check`
   to pass. Each edit is a two-line addition (`aiAccessOverride: null,
   isDemo: false`), no behavioral change to login/register/Google callback.
3. **`identityFresh` + mutating vs. read `/api/admin/*`.** Task 1.5's prose
   ("`/api/admin/**` when `!identityFresh` → 503") reads as blanket, but
   design §1's table specifically scopes the 503 to *mutating*
   `/api/admin/*` and treats read-only admin surfaces as tolerating a stale
   read. I implemented the narrower, design-consistent rule: `GET`/`HEAD` on
   `/api/admin/*` only requires `requireAdmin` (role check); non-GET/HEAD
   requires `requireFreshAdmin` (role + freshness, 503 on stale). No admin
   API routes exist yet in M1 to observe this directly — it's exercised by
   guard unit logic and will matter once M3 ships mutating endpoints.
4. **`[data-menu]` script generalized to `querySelectorAll`, not just a
   renamed `querySelector`.** Task 1.8 says to generalize the selector "so
   M5's row menus reuse the open/close/Escape script." A single
   `querySelector` would only ever manage the first matching element once
   M5 adds more `[data-menu]` instances. I changed the outside-click and
   Escape handlers to iterate `querySelectorAll('[data-menu]')`, so M5 can
   add row-menu `<details data-menu>` elements without touching this script
   again. Behavior for M1 (a single `[data-menu]`, the profile dropdown) is
   unchanged.
5. **Read-failure "possibly stale" banner (design §1's read-only-page row)
   not implemented.** M1's admin pages are empty shells with no real data
   yet, so there is nothing on them that could read as stale. Deferred to
   whichever milestone first renders real admin data (M3 onward) rather
   than building UI for a state M1 cannot produce.

None of these change the spec's observable Requirement scenarios in
`specs/request-authorization/spec.md` — all four are still true and are
what `e2e/m1-admin-shell.ts` verifies directly.

### Issues found

None blocking. Noted for a future milestone: the JWT-degraded path
(`resolverIdentidadFresca` catch branch) has no automated fault-injection
test, matching `specs/request-authorization/spec.md`'s own verification note
("direct inspection of the fallback code path — no test runner exists for
fault injection in this repo"). I did read the code path by hand: on a
`prisma.user.findUnique` throw, the function returns the original JWT-derived
`sesion` unchanged and `fresh: false`, which the middleware then uses to set
`identityFresh = false` — matching design's table row exactly.

### Verification output (actual)

```
$ npm run check
> koduedu@0.1.0 check
> tsc --noEmit
(exit 0, no output)

$ rg -n 'bg-white|bg-slate-' src/pages/admin src/layouts/AdminLayout.astro
(exit 1, no matches — expected)

$ npx tsx e2e/m1-admin-shell.ts
✔ anónimo: /admin redirige a /login
✔ anónimo: /adminfoo no queda capturado por el prefijo /admin
✔ anónimo: /api/adminx no queda capturado por el prefijo /api/admin
✔ DOCENTE: /admin redirige a /app (nunca 404, nunca blanco)
✔ DOCENTE: GET /api/admin/* → 403 JSON
✔ DOCENTE: POST /api/admin/* → 403 JSON (nunca una redirección)
✔ DOCENTE: /app no cambió de comportamiento
✔ ADMIN: cascarón de /admin renderiza en tema light
✔ ADMIN: cascarón de /admin renderiza en tema dark
✔ ADMIN: /api/admin/* pasa el middleware sin 401/403/503
✔ promoción en la base: la request siguiente ya entra como ADMIN, sin login nuevo

✔ e2e/m1-admin-shell.ts: todos los escenarios pasaron
```

### Remaining tasks

None for Phase 1. See the Phase 2 section below for M2; Phases 3–8 (M3–M8)
remain out of scope for this apply batch.

### Workload / PR boundary

- Mode: stacked-to-main, chained PR slice
- Current work unit: M1
- Boundary: starts from `main`-equivalent branch point (`feat/panel-admin` off
  `main`), ends at the M1 checkpoint (task 1.12). Delivered as two commits:
  a docs commit for the SDD planning artifacts, and a `feat(admin)` commit
  for the M1 implementation itself.
- Estimated review budget impact: forecast estimated ~450 changed lines for
  M1; actual authored diff for the `feat(admin)` commit is ~350 lines
  (excluding the docs commit). `review_budget_lines` is unbounded for this
  change per the owner, so this is informational only.

## Phase 2: M2 — `AiModel` data model

**Status**: complete. 17/17 tasks done (2.1–2.17).

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npm run check` → exit 0, no output. `npx tsx e2e/unidad.ts` → 4/4 assertions passed (GCM round trip, AAD-mismatch rejection, chain cycle guard, 3-hop cap) |
| Runtime harness command/scenario and exact result | `npx tsx e2e/m2-catalogo.ts` → 7/7 scenarios passed (new project repoints to the seeded default; chat selector shows "MiniMax M3"; a turn with no keys loaded anywhere fails gracefully and is persisted; no bogus `TokenUsage` row on a zero-token turn; a keyless motor is skipped by `cadenaDeMotores` once a sibling has a usable key). Re-ran `npx tsx e2e/m1-admin-shell.ts` as a regression check — still 11/11 green |
| Rollback boundary | `git revert` this work unit's commit(s) on `feat/panel-admin`, then hand-run `prisma/migrations/20260919000000_catalogo_de_motores/migration_down.sql` against the DB (`docker exec -i kodu_db_dev psql -U kodu -d koduedu -f -`), then `npx prisma migrate resolve --rolled-back 20260919000000_catalogo_de_motores`. `.env`'s `AI_*` vars are untouched and still readable by a reverted `provider.ts`. Usage rows written between this deploy and a rollback lose their `provider` enum value except the 3 seed-mapped UUIDs — see the down script's own comment and its printed count |

### Completed tasks

- [x] 2.1–2.2 `AiModel` model added to `prisma/schema.prisma` (id with no default — it's the AES-GCM AAD, generated by the app before insert); `Project.aiModelId`/`TokenUsage.aiModelId` FKs added; `Project.selectedModel`/`TokenUsage.provider` marked `dato histórico, no leer`; neither enum column nor `ModelChoice` (the DB enum) dropped.
- [x] 2.3–2.5 Hand-written `prisma/migrations/20260919000000_catalogo_de_motores/migration.sql`: table + partial unique index `AiModel_un_solo_default` + 4 seed rows (fixed UUIDs `10000000-…0001`–`…0004`) + FK columns + backfill + `provider` NOT NULL dropped. Applied directly against the running dev DB via `docker exec kodu_db_dev psql` (never `prisma migrate dev`), then marked with `prisma migrate resolve --applied`. `prisma migrate status` confirms "Database schema is up to date!" afterward.
- [x] 2.6–2.7 `src/lib/crypto/secretos.ts`: AES-256-GCM, `v1.<nonce>.<ct>.<tag>` base64url, AAD = the row's `id`. Two distinct error classes: `ClaveNoConfigurada` (missing/malformed key) vs `ClaveInvalida` (wrong key / auth-tag failure / tampered value). `KODU_ENCRYPTION_KEY` added to `env.ts`, validated lazily inside `secretos.ts`, not in the zod schema.
- [x] 2.8 `src/lib/ai/catalogo.ts`: all 6 functions from design §5 (`resolverMotor`, `motorPorDefecto`, `normalizarMotor`, `cadenaDeMotores`, `motoresParaDocente`, `invalidarCatalogo`), no more. 30s TTL module-level cache, explicit invalidation exported for M3. Default ladder and 3-hop chain-walk with cycle guard match design's pseudocode exactly.
- [x] 2.9–2.11 `provider.ts` reduced to HTTP/SSE plumbing; `ProviderConfig` moved to the shape design §5 specifies (`id/label/apiKey/baseUrl/model/maxTokens/userTokenLimit/maxInputChars/supportsVision/precios`); `stream.ts` rewired to the catalog end to end; `workspace-types.ts`/`ChatPanel.tsx`/`Workspace.tsx`/`client/api.ts`/`project/[id].astro` all moved from the old 3-value `ModelChoice` union to a plain `AiModel.id` string plus the new `MotorPublico` shape.
- [x] 2.12 `scripts/rotar-clave.ts`: reads `KODU_ENCRYPTION_KEY_OLD`/`KODU_ENCRYPTION_KEY`, decrypts+re-encrypts every keyed row in one `prisma.$transaction`, prints the count. Required a small refactor of `secretos.ts` (see Deviation 1).
- [x] 2.13 `e2e/unidad.ts`: 4/4 assertions green (see table above).
- [x] 2.14 DB-state check done via `docker exec ... psql` (see Verification output below).
- [x] 2.15 `e2e/m2-catalogo.ts`: 7/7 scenarios green, with the "answers" scenario adapted to this environment's missing credentials (see Deviation 2).
- [x] 2.16–2.17 Both commands pass; migration applied+resolved; catalog serves a real (if keyless) chat turn end to end.

### Files changed

| File | Action | What |
|---|---|---|
| `prisma/schema.prisma` | Modify | `AiModel` model; `Project.aiModelId`/`TokenUsage.aiModelId`; historical `///` comments; `TokenUsage.provider` now nullable |
| `prisma/migrations/20260919000000_catalogo_de_motores/migration.sql` | Create | Table, partial unique index, 4 seed rows, FK columns, backfill, NOT NULL drop |
| `prisma/migrations/20260919000000_catalogo_de_motores/migration_down.sql` | Create | Hand-run rollback with an affected-row-count `RAISE NOTICE` |
| `src/lib/crypto/secretos.ts` | Create | `cifrar`/`descifrar`/`pistaDeClave` + explicit-key variants for rotation |
| `src/lib/ai/catalogo.ts` | Create | The 6-function catalog surface from design §5 |
| `src/lib/ai/provider.ts` | Modify | Dropped enum-era exports; `ProviderConfig` redefined; `supportsVision(config)`; `usage` event gains `cachedTokens` |
| `src/lib/ai/usage.ts` | Modify | `recordUsage`/`consumedTokens` keyed on `aiModelId` instead of the enum; `UsageByUser.provider` now `ModelChoice \| null` |
| `src/lib/env.ts` | Modify | `KODU_ENCRYPTION_KEY` added |
| `.env.example` / `.env` | Modify | `KODU_ENCRYPTION_KEY` documented and set locally (real random 32-byte hex, generated for this environment) |
| `src/pages/api/chat/stream.ts` | Modify | Full rewire to `normalizarMotor`/`cadenaDeMotores`; 413/429 "try another engine" suggestions now driven by the live chain instead of a hardcoded alternate |
| `src/pages/api/projects/[id].ts` | Modify | `PATCH` accepts `aiModelId` instead of `selectedModel` |
| `src/lib/workspace-types.ts` | Modify | `MODELOS`/`ModelChoice` deleted; `MotorPublico` added; `WorkspaceProject.selectedModel` → `aiModelId: string` |
| `src/lib/client/api.ts` | Modify | `model`/`fallbackModel` typed `string` instead of `ModelChoice` |
| `src/components/workspace/ChatPanel.tsx` | Modify | Selector renders from `motoresDisponibles: MotorPublico[]` prop, not the deleted `MODELOS` constant |
| `src/components/workspace/Workspace.tsx` | Modify | `model`/`fallback.model` state now `string`; `patchProject` writes `aiModelId` |
| `src/pages/app/project/[id].astro` | Modify | Feeds `motoresParaDocente()`; resolves/repoints `aiModelId` via `normalizarMotor()` on load |
| `src/pages/app/consumo.astro` | Modify | Decoupled from the deleted `MODELOS` constant (small local historical label map) — see Deviation 3 |
| `scripts/rotar-clave.ts` | Create | Key-rotation script |
| `e2e/unidad.ts` | Create | GCM round trip, AAD rejection, cycle guard, 3-hop cap |
| `e2e/m2-catalogo.ts` | Create | Browser/API check for the whole M2 request path |

### Deviations from design

1. **`secretos.ts` split into explicit-key and env-key variants, not in the
   original file list.** Task 2.6 describes `cifrar`/`descifrar`/`pistaDeClave`
   reading the key from `env.ts` internally. Task 2.12's `rotar-clave.ts`
   needs to decrypt with an OLD key and encrypt with a NEW key in the SAME
   process, which a single env-sourced key can't do. Refactored into
   `cifrarConClave`/`descifrarConClave` (private, take a `Buffer`) with
   `cifrar`/`descifrar` (env-sourced) and `cifrarConClaveHex`/
   `descifrarConClaveHex` (explicit hex, exported for the rotation script) as
   thin wrappers. No change to the on-disk format or the public `cifrar`/
   `descifrar` signatures task 2.6 specifies.
2. **Removed `MODELO_RESPALDO` and `alternateChoice` from `provider.ts`**,
   in addition to task 2.9's explicit removal list. Both assumed a fixed
   binary "principal vs. respaldo" world that the catalog replaces; once
   `stream.ts` stopped calling `alternateChoice` (2.10), it became dead code
   that still referenced the retired 2-model mental model. The `ModelChoice`
   *type* itself was kept (it's the historical DB enum's TS mirror, still used
   by `usage.ts`'s `UsageByUser.provider` and `TokenUsage.provider`).
3. **`src/pages/app/consumo.astro` touched, not in design's M2 file table.**
   Deleting `MODELOS` (task 2.11) breaks this pre-existing page, which isn't
   deleted until M5 (task 5.9). Same "every milestone ends green" reasoning
   the tasks.md resequencing note already applies to `stream.ts`/
   `project/[id].astro`: gave it a small local `NOMBRES_HISTORICOS` map
   instead of importing the deleted constant. The page is explicitly a
   historical-only view now (commented as such): rows written after M2 have
   `provider = NULL` (design's own stated consequence of the enum→FK swap)
   and render as "Motor nuevo (ver /admin/motores)" instead of a wrong name.
   `/admin/usuarios` (M5) is the intended replacement and will read the
   catalog directly.
4. **413/429 "try a different engine" suggestions rebuilt on the live chain,
   not ported 1:1.** The old code hardcoded a single alternate
   (`alternateChoice`: MiniMax↔DeepSeek). With N catalog rows there's no
   fixed alternate, so `stream.ts` now searches `cadenaDeMotores(motor.id)`
   for the first sibling with enough `maxInputChars` (413) or any sibling at
   all (429), using ONLY the 6 functions design §5 lists for `catalogo.ts` (no
   7th export invented for this). The `fallbackModel`/`fallbackLabel` wire
   format is unchanged (now carries an `AiModel.id` string instead of an enum
   value), so the existing "Probar con X" client UI keeps working unmodified.
5. **The M2/M3 split on the "disabled model repoint" notice.** Design §5
   describes the repoint-and-persist happening at page load (implemented,
   task-equivalent to 2.10/2.11's scope) AND a quiet "cambiamos el motor…"
   notice bubble threaded through to the workspace UI. The notice bubble
   itself is deferred to M3: there's no admin UI yet to disable a model an
   real teacher project is using, so the scenario isn't meaningfully
   exercisable end-to-end before M3's `ModelosPanel` exists, and building UI
   for an unreachable state isn't "minimal plumbing." The repoint-and-persist
   half (the part M2's own migration can actually trigger, since Alpha ships
   `enabled=false`) is implemented and covered by `e2e/m2-catalogo.ts`.
6. **`normalizarMotor`'s "disabled" gate doesn't also check
   `selectableByTeacher`.** Design's repoint-notice prose (§5) lists "missing,
   disabled or not selectable" as the three repoint triggers, but that's
   describing the page-load UX decision (deferred per #5), not the resolver
   ladder in §2, which only ever gates on `enabled`. `normalizarMotor` matches
   §2's ladder: a project pointed at a non-selectable-but-enabled model (which
   never happens today, since only enabled+selectable rows are ever written to
   `Project.aiModelId`) keeps working rather than being force-repointed.

### Issues found

1. **No real AI provider credentials exist in this environment.**
   `AI_MINIMAX_API_KEY` and `AI_DEEPSEEK_API_KEY` are both `""` in `.env`, and
   there's no `AI_ALPHA_API_KEY` line at all — this predates M2 and is not
   something M2's migration could fix (the migration deliberately seeds
   `apiKeyCipher = NULL`; keys are meant to be entered via the M3 admin panel,
   which doesn't exist yet). This means task 2.15's "a teacher's turn
   resolves through the seeded default **and answers**" cannot be proven with
   a real model reply in this sandbox. `e2e/m2-catalogo.ts` instead proves the
   maximum truthful thing available: the request resolves the correct seeded
   model, walks the fallback chain, and fails gracefully with a specific,
   persisted, well-formed error (`"El servidor no tiene configurada la clave
   de MiniMax M3."`) rather than hanging or throwing unhandled. The "keyless
   model skipped" half of 2.15 IS proven with a real pass/fail comparison (see
   the script's third scenario), by temporarily giving MiniMax M2.7 a fake
   test key and confirming the chain selects it over the still-keyless
   default. Not a code defect; flagged for whoever loads real keys via M3 to
   confirm the "answers" half for real.
2. **`/app/consumo.astro` stops accumulating new data as of this migration.**
   Documented in Deviation 3. Not a regression this milestone introduced by
   choice — design explicitly relaxes `TokenUsage.provider` to nullable and
   stops writing it — but it does mean the admin-facing token-usage view is
   effectively frozen at its pre-M2 state until M5 replaces it. Flagged so
   nobody is surprised when `/app/consumo.astro`'s numbers stop moving.

### Verification output (actual)

```
$ npm run check
> koduedu@0.1.0 check
> tsc --noEmit
(exit 0, no output)

$ npx tsx e2e/unidad.ts
✔ cifrar/descifrar: ida y vuelta con el mismo AAD
✔ descifrar: un AAD distinto (ciphertext copiado a otra fila) rechaza
✔ cadenaDeMotores: un ciclo A→B→A no cuelga y corta en 2
✔ cadenaDeMotores: el tope de 3 eslabones se respeta aunque la cadena siga

✔ e2e/unidad.ts: todas las pruebas pasaron

$ npx tsx e2e/m2-catalogo.ts
✔ el recurso nuevo abre en el editor sin errores
✔ el recurso se asigna al motor por defecto sembrado (MiniMax M3) al abrirse
✔ el selector del chat muestra "MiniMax M3" como motor activo
✔ sin ninguna clave cargada, el turno falla de forma prolija (no un cuelgue)
✔ el turno fallido queda persistido en el hilo (no se pierde silenciosamente)
✔ un turno sin tokens gastados no ensucia TokenUsage
✔ un motor sin clave utilizable queda afuera de la cadena; el siguiente con clave entra

✔ e2e/m2-catalogo.ts: todos los escenarios pasaron

$ npx tsx e2e/m1-admin-shell.ts   # regresión, no forma parte de M2
✔ e2e/m1-admin-shell.ts: todos los escenarios pasaron (11/11)

$ docker exec -i kodu_db_dev psql -U kodu -d koduedu -c '... AiModel ...'
  4 filas: MiniMax M3 (default, enabled, selectable), MiniMax M2.7
  (enabled, not selectable), DeepSeek (enabled, not selectable),
  Alpha (disabled) — exactamente 1 fila con isDefault=true.

$ docker exec -i kodu_db_dev psql -U kodu -d koduedu -c '... counts ...'
  TokenUsage históricas sin backfill: 0 (no había filas previas al migrar)
  Project sin motor asignado: 0
```

### Remaining tasks

None for Phase 2. Phases 3–8 (M3–M8) remain out of scope for this apply batch.

### Workload / PR boundary

- Mode: stacked-to-main, chained PR slice
- Current work unit: M2
- Boundary: starts where M1 left off on `feat/panel-admin`, ends at the M2
  checkpoint (task 2.17).
- Estimated review budget impact: forecast estimated ~800 changed lines for
  M2 (the largest of the eight milestones along with M5/M6).
  `review_budget_lines` is unbounded for this change per the owner, so this
  is informational only; `design.md`'s own note already flagged M2 as one of
  the two candidates worth a further split if reviewer load becomes a
  problem.

## Phase 3: M3 — Models route + teacher selector

**Status**: complete. 13/13 tasks done (3.1–3.13).

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npm run check` → exit 0, no output (clean `tsc --noEmit`) |
| Runtime harness command/scenario and exact result | `npx tsx e2e/m3-motores.ts` → 14/14 scenario assertions passed across both themes (list renders light+dark; create+enable+default+keyboard-reorder from the real form; the enabled-default 409 refusal; the masked-key invariant on both the creation response and `GET /api/admin/models`; the teacher selector showing name+description and never `providerModel`; disabling a non-default model removing it from the selector). Regressions re-run clean: `npx tsx e2e/unidad.ts` (4/4) and `npx tsx e2e/m1-admin-shell.ts` (11/11) and `npx tsx e2e/m2-catalogo.ts` (7/7) |
| Rollback boundary | `git revert` this work unit's commit(s) on `feat/panel-admin`. No migration — `AiModel`'s schema from M2 already carries every M3 field. Rollback removes the 3 `/api/admin/models*` routes, the 3 `src/components/admin/*` files, and reverts `src/pages/admin/motores.astro` to its M1 empty shell; `ChatPanel.tsx` is untouched by M3 (already wired in M2) so nothing there needs reverting |

### Completed tasks

- [x] 3.1 `src/pages/api/admin/models/index.ts`: `GET` → `{ motores: MotorAdmin[] }`; `POST` → create, `id` generated via `crypto.randomUUID()` before encrypting (the AAD), `sortOrder` computed server-side as `max+1`.
- [x] 3.2 `src/pages/api/admin/models/[id].ts`: `PATCH` partial; write-only `apiKey` (`undefined` = keep, `null` = clear, string = replace, encrypted with the row's own existing `id` as AAD); `isDefault: true` runs inside `prisma.$transaction` (clear every other default, then set this one) so the partial unique index never sees two `true` rows; disabling the current default → 409 with the exact copy from design.md §2.
- [x] 3.3 `src/pages/api/admin/models/orden.ts`: `PATCH { ids: string[] }`; rejects unless the array is exactly the full existing id set (no delta, no partial); one `prisma.$transaction` writing `sortOrder = index`.
- [x] 3.4 `src/components/admin/ModelosPanel.tsx`: one `kodu-card` row per motor in an `<ol>` (order is data, not decoration); handle button (`⠿`, matching the design mock's own glyph) supports `draggable` AND `ArrowUp`/`ArrowDown` while focused, both paths write the same `PATCH .../orden` with the full ordered array; `aria-live="polite"` region announces `"{name}, posición N de M"`; enable toggle and default radio act directly on the row (optimistic update, revert + inline error banner on failure).
- [x] 3.5 `src/components/admin/Interruptor.tsx`: the rail-and-knob lifted out of `BaseLayout.astro`'s dark-mode toggle as a controlled `<input type="checkbox" className="sr-only">` + painted rail, reused for both the row's enable toggle and (later, M7) the demo toggle.
- [x] 3.6 `src/components/admin/ModeloForm.tsx`: create/edit dialog (built on the existing `workspace/Modal.tsx`) with every field not already covered by row-level controls — provider identity, description/adminNote, base URL, write-only key field labelled `Reemplazar clave` with the `•••• {hint}` / `Sin clave` placeholder, the three price fields under `Precio aproximado (USD por millón de tokens)` with the estimate-disclaimer line, a live per-turn cost preview (8k/2k/4k) that catches a per-thousand-vs-per-million typo, teacher-selectable + vision toggles, token/char ceilings, and a fallback-model `<select>` excluding itself.
- [x] 3.7 `src/pages/admin/motores.astro`: fetches the catalog server-side (`prisma.aiModel.findMany` ordered by `sortOrder`) through the same `serializarMotor()` the API routes use, and renders `<ModelosPanel client:load>`.
- [x] 3.8 `ChatPanel.tsx` — **no change needed**. M2's task 2.11 already wired the selector to read `displayName`/`description` off the `motoresDisponibles` prop; verified unchanged and exercised end-to-end by `e2e/m3-motores.ts` against a model created live through the M3 admin UI.
- [x] 3.9 Centralized the `Prisma.Decimal` boundary conversion in one place — `src/lib/admin/modelos.ts`'s `serializarMotor()` calls `.toString()` on all three price fields — so every route (3.1–3.3) and the two admin components (3.4/3.6) go through the same conversion instead of repeating the trap three times.
- [x] 3.10 DB-state checks embedded in `e2e/m3-motores.ts` (direct `prisma.aiModel` reads, not just UI assertions): created row's `apiKeyCipher` starts with `v1.` and never equals the plaintext key; after marking a second model default, exactly one row has `isDefault = true` and it is the new one.
- [x] 3.11 `e2e/m3-motores.ts` — both themes (creation flow runs in dark, persistence-after-reload check runs in light): create+enable+default+keyboard-reorder a model through the real form; teacher selector shows name+description and never `providerModel`; disabling the current default is refused with 409 and the row visibly stays enabled; disabling a non-default model removes it from the teacher's selector on next load.
- [x] 3.12 `npm run check` → exit 0. `rg -n 'bg-white|bg-slate-' src/components/admin src/pages/admin` → exit 1, no matches.
- [x] 3.13 M3 checkpoint: admin CRUD (create/edit/reorder/toggle/default, no delete) is live at `/admin/motores`, and the teacher-facing selector in `ChatPanel.tsx` reflects the live catalog end to end — deliverable.

### Files changed

| File | Action | What |
|---|---|---|
| `src/lib/admin/modelos.ts` | Create | `MotorAdmin` type, `serializarMotor()` (the single `Prisma.Decimal`→string boundary), `precioADecimal()` |
| `src/pages/api/admin/models/index.ts` | Create | `GET` list, `POST` create |
| `src/pages/api/admin/models/[id].ts` | Create | `PATCH` partial update, incl. the default transaction and the disable-current-default 409 |
| `src/pages/api/admin/models/orden.ts` | Create | `PATCH` full ordered array reorder |
| `src/components/admin/Interruptor.tsx` | Create | Reusable rail-and-knob toggle |
| `src/components/admin/ModeloForm.tsx` | Create | Create/edit dialog |
| `src/components/admin/ModelosPanel.tsx` | Create | The row list: reorder, toggle, default, opens the form |
| `src/pages/admin/motores.astro` | Modify | Empty M1 shell → renders `ModelosPanel` with server-fetched initial data |
| `e2e/m3-motores.ts` | Create | Slice verification, both themes |

### Deviations from design

1. **Field split between the row and the form wasn't explicit in design.md, so it was inferred.** Design's row mock (`⠿ 1 MiniMax M3 … [●—] ( ) default Editar`) only shows handle/order/name/key-hint/price/enable/default/Editar; it doesn't show `selectableByTeacher`, `supportsVision`, `maxOutputTokens`, `maxInputChars`, `userTokenLimit`, or `fallbackModelId` anywhere in the UI section. Since the top-level field list (design.md's "AiModel data model" requirement and the orchestrator's task brief) requires all of these to be admin-editable somewhere, and design explicitly assigns enable/default/order to the row, everything else not on the row went into `ModeloForm.tsx`. This is the only reading that covers every field exactly once with no duplication.
2. **`enabled` and `isDefault` are deliberately NOT in `ModeloForm`'s payload**, even though they're real `AiModel` columns. They're exclusively row-level (toggle, radio) per design's mock. Keeping them out of the form means editing "everything else" about a model can never accidentally flip its enabled/default state as a side effect of an unrelated save.
3. **The masked-key placeholder text (`•••• {hint}` / `Sin clave`) is a `placeholder`, not pre-filled `value`, on the `Reemplazar clave` input.** Design says "permanently empty on load" for that field — a `placeholder` satisfies that literally (the field is empty; the hint is greyed-out guidance text), while showing the hint as a `value` would mean the admin has to manually clear it before typing a new key, which contradicts "empty on load."
4. **The handle glyph is the literal `⠿` character from design.md's own mock**, not a hand-drawn SVG grip icon. The project has no icon library (`design-taste-frontend` skill's guidance to avoid hand-rolled SVG icons), and design.md already committed to this exact character in its own ASCII mock — reusing it is the most literal reading, not a new decorative choice.
5. **`e2e/m3-motores.ts` needed a click-and-verify retry around the teacher-selector click**, not a plain `.click()`. First runs showed real (if rare) flakiness: the Astro island (`client:load`) can have its HTML in the DOM slightly before React hydration attaches the `onClick`, so a click in that narrow window is silently swallowed by the browser (native click event fires, no React handler yet). The fix retries the click until `aria-pressed` actually flips, which is the same category of hydration-timing trap noted in this project's own `chromium-headless-ui-testing` lesson, applied to a new symptom (swallowed click, not layout clamp).
6. **The E2E script mutates and restores `sortOrder` for all 4 seed rows, not just the ones it directly touches.** The keyboard-reorder scenario legitimately renumbers the whole table (`PATCH orden` always writes a full ordered array), so without an explicit restore, repeated test runs would leave a permanent gap in the seed rows' `sortOrder` sequence (harmless for catalog resolution, which only cares about relative order, but untidy and worth avoiding). `limpiarEstado()` resets all 4 fixed UUIDs back to `sortOrder` 0–3 in both the success and failure paths.

### Issues found

None blocking. Two things worth flagging for whoever picks up M4+:

1. **The `ModeloForm` price-preview line duplicates (in miniature) the display-rounding logic M4's `src/lib/format/costo.ts` will formalize.** It's intentionally NOT the same function — M4's formatter handles the full 5-case table (≥0.01, <0.01, rounds-to-zero, exactly-zero, NULL) for *stored, already-computed* costs, while this preview is a client-side, always-4-decimal estimate of a hypothetical turn from whatever the admin is currently typing (which can be blank/invalid mid-edit). Trying to share one function would have forced the preview to handle NULL/`—`/`histórico` states that make no sense for a live form field. If M4 wants to unify them later, that's a legitimate small refactor, not something skipped here.
2. **No confirmation dialog before disabling a model or changing the default**, even though both are consequential (a disabled model disappears from the teacher selector immediately, per M2's `normalizarMotor`/repoint logic; a new default becomes what every *new* project starts on). Design.md doesn't ask for one, and the disable-current-default guard (409) already catches the one truly destructive case (an admin accidentally orphaning the platform's only default). Flagging in case product wants a confirm step later — not implemented here since nothing in `design.md` or `specs/ai-model-catalog/spec.md` calls for it.

### Verification output (actual)

```
$ npm run check
> koduedu@0.1.0 check
> tsc --noEmit
(exit 0, no output)

$ npx tsx e2e/m3-motores.ts
✔ ADMIN: /admin/motores renderiza el listado sembrado (tema light)
✔ ADMIN: el listado sigue andando en tema dark
✔ crear+enable+default+reorden: el motor nuevo se crea desde el formulario (tema dark)
✔ la fila nueva muestra la pista de la clave (últimos 4 caracteres), nunca la clave completa
✔ la fila guardada en la base tiene la clave cifrada, no en texto plano
✔ el toggle de habilitado persiste en los dos sentidos
✔ setear un nuevo default desmarca el anterior (invariante de un solo default)
✔ deshabilitar el motor por defecto se rechaza (409) y el motor sigue habilitado
✔ ArrowUp en el handle sube una posición y lo anuncia en la región aria-live
✔ ADMIN: /admin/motores sigue funcional en tema light (persistencia tras recargar)
✔ GET /api/admin/models nunca expone clave en texto plano ni el campo cifrado
✔ el selector del docente muestra nombre + descripción del motor recién creado
✔ el selector nunca expone el providerModel
✔ deshabilitar un motor no-default lo saca del selector del docente

✔ e2e/m3-motores.ts: todos los escenarios pasaron

$ npx tsx e2e/unidad.ts       # regresión, no forma parte de M3
✔ e2e/unidad.ts: todas las pruebas pasaron (4/4)

$ npx tsx e2e/m1-admin-shell.ts   # regresión, no forma parte de M3
✔ e2e/m1-admin-shell.ts: todos los escenarios pasaron (11/11)

$ npx tsx e2e/m2-catalogo.ts   # regresión, no forma parte de M3
✔ e2e/m2-catalogo.ts: todos los escenarios pasaron (7/7)

$ rg -n 'bg-white|bg-slate-' src/components/admin src/pages/admin
(exit 1, no matches — expected)

$ docker exec -i kodu_db_dev psql -U kodu -d koduedu -c '... AiModel ...'
  4 filas (estado sembrado restaurado tras la corrida de e2e/m3-motores.ts):
  MiniMax M3 (default, sortOrder 0), MiniMax M2.7 (sortOrder 1),
  DeepSeek (sortOrder 2), Alpha (disabled, sortOrder 3) — exactamente
  1 fila con isDefault=true, sin ningún rastro del motor de prueba.
```

### Remaining tasks

None for Phase 3. Phases 4–8 (M4–M8) remain out of scope for this apply batch.

### Workload / PR boundary

- Mode: stacked-to-main, chained PR slice
- Current work unit: M3
- Boundary: starts where M2 left off on `feat/panel-admin`, ends at the M3
  checkpoint (task 3.13).
- Estimated review budget impact: forecast estimated ~500 changed lines for
  M3. `review_budget_lines` is unbounded for this change per the owner, so
  this is informational only.

## Phase 4: M4 — Cost accounting + indicator

**Status**: complete. 12/12 tasks done (4.1–4.12).

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npm run check` → exit 0, no output (clean `tsc --noEmit`). `npx tsx e2e/unidad.ts` → 11/11 assertions passed (4 pre-existing + 7 new: cached-token double-charge, null-price never fabricates, free turn costs exactly 0, missing cached rate falls back to input rate and records that fallback in the snapshot, `Decimal(16,10)` retains a sub-cent cost that `Decimal(12,6)` would round to zero, the full 5-case display-rounding table, the `bajo/medio/alto` threshold boundaries) |
| Runtime harness command/scenario and exact result | `npx tsx e2e/m4-costos.ts` → 17/17 scenarios passed, both themes (see filename note below). Ran twice in a row to confirm the script's own cleanup is idempotent — same 17/17 both times. Regressions re-run clean: `npx tsx e2e/unidad.ts` (11/11), `npx tsx e2e/m1-admin-shell.ts` (11/11), `npx tsx e2e/m2-catalogo.ts` (7/7), `npx tsx e2e/m3-motores.ts` (14/14) |
| Rollback boundary | `git revert` this work unit's commit(s) on `feat/panel-admin`, then hand-run `prisma/migrations/20260920000000_costo_de_turnos/migration_down.sql` against the DB (`docker exec -i kodu_db_dev psql -U kodu -d koduedu -f -`), then `npx prisma migrate resolve --rolled-back 20260920000000_costo_de_turnos`. Accepted loss: cost history written between this deploy and a rollback is dropped with the columns; `promptTokens`/`completionTokens` (M2 columns) are untouched. No seed data or M1–M3 surfaces are touched by this rollback |

### Completed tasks

- [x] 4.1 `prisma/schema.prisma`: `TokenUsage` gains `cachedInputTokens`, `costUsd Decimal? @db.Decimal(16,10)`, the three `Decimal(12,6)` snapshot columns, `projectId` + `project` relation (`onDelete: SetNull`), `@@index([projectId])`, `@@index([userId, createdAt])` (kept the two pre-existing indexes too). `Project` gains the `tokenUsage TokenUsage[]` back-relation the new FK requires.
- [x] 4.2 Hand-written `prisma/migrations/20260920000000_costo_de_turnos/migration.sql` with the Spanish WHY block (the `Decimal(16,10)` floor, the `cachedInputTokens` subset relationship, why `projectId` is `SetNull`, why no historical row is ever touched). Applied directly via `docker exec kodu_db_dev psql`, then `prisma migrate resolve --applied`. `prisma migrate status` confirms "Database schema is up to date!" A `migration_down.sql` sits beside it, same convention as M2.
- [x] 4.3 `calcularCostoTurno()` in `src/lib/ai/usage.ts` implements the exact formula, entirely in `Prisma.Decimal`: `facturables = max(promptTokens − cachedInputTokens, 0)`, `tarifaCache = precios.cachedInput ?? precios.input`, `costUsd = facturables×input/1e6 + cachedInputTokens×tarifaCache/1e6 + completionTokens×output/1e6`. `precios === null` short-circuits to an all-null result before any arithmetic runs. `src/lib/ai/provider.ts` already emitted `cachedTokens` since M2 (task 2.9) — no change needed there.
- [x] 4.4 `UsageRecord` gained `projectId`, `cachedInputTokens`, `precios`; `recordUsage()` calls `calcularCostoTurno()` and writes all five new columns in the same `prisma.tokenUsage.create`. `stream.ts`'s single call site (the `finally` block) now passes `projectId: project.id`, `cachedInputTokens: totales.usage.cachedTokens`, `precios: proveedorUsado.precios` — no extra query, the prices ride in on the already-resolved `ProviderConfig`.
- [x] 4.5 `costoPorProyecto(projectId)` and `consumoPorUsuario(userId)` added to `usage.ts` for M5. `costoPorProyecto` treats ANY row with `costUsd = null` inside the project as making the whole aggregate `null` (never a partial total that looks complete) — see Deviation 1. `consumoPorUsuario` groups by `aiModelId` (⇒ historical bucket when `null`) with model display names joined in; documented limitation for M5 in a code comment (see Deviation 2).
- [x] 4.6 `src/lib/format/costo.ts` created: `formatearCostoUsd(valor: string | number | null)` implements the exact 5-case table. Deliberately takes NO `Prisma.Decimal` parameter — see Deviation 3 (bundle-safety reasoning).
- [x] 4.7 `src/components/workspace/IndicadorConsumo.tsx` created: `<button aria-expanded>` with `onMouseEnter`/`onFocus`/`onClick` opening a `role="status"` popover, `onMouseLeave`/`onBlur`/`Escape` closing it. Reads `nivel` as a prop (computed server-side, see 4.8) rather than importing the `CONSUMO_MEDIO`/`CONSUMO_ALTO` constants itself — see Deviation 3. No occurrence of "ficha" anywhere in its copy (verified by `rg -i ficha` on the file — no matches).
- [x] 4.8 `src/pages/app/project/[id].astro`: computes `costoPorProyecto(project.id)` and `nivelDeConsumo(...)` in the frontmatter, renders `<IndicadorConsumo client:load>` directly inside the existing breadcrumb `<div class="mb-3 flex items-center gap-3">`, after the `<h1>`, only when `consumoDelRecurso.tokens > 0`. `ml-auto` lives on the component's own root `<div>`. See Deviation 4 for why this is NOT threaded through `Workspace`'s props.
- [x] 4.9 DB-state checks embedded in `e2e/m4-costos.ts` (direct `prisma.tokenUsage`/`prisma.aiModel` reads): a turn's `costUsd` hand-verified against the formula (`0.0019` for a specific token/price combination); editing the model's price afterward re-fetches the same row and confirms `costUsd`/`priceInputSnapshot` unchanged; a zero-priced motor writes `costUsd = 0` (`isZero()`, not `null`).
- [x] 4.10 `e2e/m4-costos.ts` — both themes: default reading is exactly `"Consumo bajo"` with no `$` and no "ficha"; hover reveals tokens+USD and mouse-away closes it; click/tap reveals; keyboard `.focus()` reveals (Enter doesn't break it, Escape closes it); the identical keyboard-focus round trip repeated after `conTema(page, 'dark')`; a heavier resource reads `"Consumo medio"`; a resource on a price-unloaded motor shows the "sin precios" copy and never `US$ 0,00`; a resource with zero `TokenUsage` rows shows no indicator at all.
- [x] 4.11 `e2e/unidad.ts` extended with 7 new cases (see Work Unit Evidence). `npx tsx e2e/unidad.ts` and `npm run check` both pass.
- [x] 4.12 M4 checkpoint: cost is recorded per turn, frozen against later price edits, and visible in the workspace as a quiet level with an on-demand exact figure — deliverable.

### Files changed

| File | Action | What |
|---|---|---|
| `prisma/schema.prisma` | Modify | `TokenUsage`: `cachedInputTokens`, `costUsd`, 3 snapshot columns, `projectId`+`project` relation, 2 new indexes (kept the 2 old ones). `Project`: `tokenUsage TokenUsage[]` back-relation. |
| `prisma/migrations/20260920000000_costo_de_turnos/migration.sql` | Create | The 6 new columns, the FK, the 2 indexes, Spanish WHY block |
| `prisma/migrations/20260920000000_costo_de_turnos/migration_down.sql` | Create | Hand-run rollback |
| `src/lib/ai/usage.ts` | Modify | `Precios`/`CostoCalculado` types, `calcularCostoTurno()`, `UsageRecord` grown, `recordUsage()` now writes cost + snapshots, `CONSUMO_MEDIO`/`CONSUMO_ALTO`/`nivelDeConsumo()`, `costoPorProyecto()`, `consumoPorUsuario()` |
| `src/lib/format/costo.ts` | Create | `formatearCostoUsd()`, the 5-case display-rounding table |
| `src/components/workspace/IndicadorConsumo.tsx` | Create | The workspace indicator: level button + reveal popover |
| `src/pages/app/project/[id].astro` | Modify | Computes consumption in the frontmatter; renders `IndicadorConsumo` in the breadcrumb strip |
| `src/pages/api/chat/stream.ts` | Modify | `recordUsage()` call site passes `projectId`, `cachedInputTokens`, `precios` |
| `e2e/unidad.ts` | Modify | +7 pure-logic cases for cost arithmetic, display rounding, thresholds |
| `e2e/m4-costos.ts` | Create | Slice verification, both themes (see Deviation 5 for the filename) |

### Deviations from design

1. **`costoPorProyecto` nullifies the WHOLE aggregate if ANY row inside the project lacks a known cost**, rather than summing the known ones and silently treating the unknown ones as zero. Design's own three-state table (§6) describes "no usage" / "usage, cost genuinely zero" / "usage, price unknown" as states of an entire row set, but doesn't explicitly resolve what a MIXED project (some rows priced, some not) should show. Showing a partial sum that LOOKS complete is exactly the kind of fabrication design.md repeatedly rules out elsewhere ("nunca se inventa un costo"), so I extended that principle to the aggregate: one unpriced row makes the whole figure unknown rather than quietly wrong. Flagged here because it's a real interpretive choice, not something the spec states in so many words.
2. **`consumoPorUsuario` (for M5) does NOT get the same all-or-nothing null treatment** — it's documented as a known limitation in a code comment instead. Postgres's `_sum` inside a `groupBy` ignores `NULL`s within a group rather than nullifying the group, and matching `costoPorProyecto`'s stricter behavior there would require pulling every raw row and summing by hand (the same technique `costoPorProyecto` uses). Since M4's own verification doesn't exercise `consumoPorUsuario` (M5 does), and building that extra plumbing for a function nothing calls yet would be scope creep ahead of the milestone that needs it, I left a comment pointing at the exact discrepancy and the fix, for whoever picks up M5.
3. **`src/lib/format/costo.ts` takes `string | number`, never `Prisma.Decimal`, and does the final rounding with plain JS `Number`, not `Prisma.Decimal` arithmetic.** This file is imported by `IndicadorConsumo.tsx`, a `client:load` React island — importing the generated Prisma client (even just for the `Decimal` class) into that file would drag Prisma's runtime module into the browser bundle, which is unsafe/wrong regardless of whether it happens to build. Every caller already has to `.toString()` a `Decimal` before it crosses the server→client boundary anyway (the exact trap called out in the brief), so the string-only signature costs nothing. `Number()` for a single already-computed value's DISPLAY rounding is safe (float64 precision is far beyond the 2–4 decimals ever shown); `Decimal` still owns every CALCULATION and every SUM, which is where its exactness actually matters. Same reasoning is why `IndicadorConsumo.tsx` receives a pre-computed `nivel: 'bajo'|'medio'|'alto'` prop from the Astro frontmatter instead of importing `CONSUMO_MEDIO`/`CONSUMO_ALTO`/`nivelDeConsumo` from `usage.ts` itself — `usage.ts` imports `src/lib/db.ts` (the Prisma singleton), which must never reach a client bundle.
4. **`IndicadorConsumo` is rendered directly in `project/[id].astro`'s breadcrumb markup as its own island, not threaded through `Workspace`'s props**, despite task 4.8's phrasing ("pass the project's tokens/cost to `Workspace`"). The breadcrumb `<div>` is entirely inside the `.astro` template, above and outside the `<Workspace client:load>` call — `Workspace` never renders the breadcrumb at all, so routing the data through it would mean an extra prop threaded through a component tree for no consumer, purely to satisfy a phrase. Design.md's own placement section is unambiguous and literal ("the breadcrumb strip... **Not** inside `ChatPanel`"), and the "minimal plumbing" principle the M2 sequencing note already established in this same tasks.md applies here too.
5. **The runtime harness file is `e2e/m4-costos.ts`, not `e2e/m4-consumo.ts`** (the name both `tasks.md`'s Suggested Work Units table and `design.md`'s Testing Strategy table use). The orchestrator's launch prompt explicitly named `e2e/m4-costos.ts` as a required artifact; I followed that explicit, more specific instruction rather than the tasks/design filename. No behavioral difference — same scenarios, same location, same `npx tsx` invocation style as every other slice script.
6. **`priceCachedInputSnapshot` stores the EFFECTIVE rate actually applied to cached tokens (`tarifaCache = precios.cachedInput ?? precios.input`), not the raw `AiModel.priceCachedInputPerMToken` column value.** When a motor has no dedicated cache rate, cached tokens are billed at the input rate — if the snapshot stored the raw (`null`) value instead, nobody could recompute `costUsd` from the three stored snapshots and get the same answer, defeating the audit-trail purpose design.md states for these columns ("recompute it after finding a typo... without guessing what was in effect that day"). Covered by the `e2e/unidad.ts` case "sin tarifa de caché propia, cae a la de entrada (y lo registra así)".

### Issues found

None blocking. One environment gotcha hit and resolved during this batch, worth recording for whoever runs the next milestone: after `npm run db:generate` regenerates the Prisma client on disk, the ALREADY-RUNNING `npm run dev` process keeps using the schema/DMMF it loaded at startup — Vite's HMR does not reload the generated Prisma client's runtime validation schema, so every route touching a newly-added column threw `PrismaClientValidationError: Unknown argument`. Fixed with `npx astro dev stop` + `npm run dev` (never `pkill -f 'astro dev'` per the standing instruction — that pattern matches the shell running the command itself). **Any milestone that adds a Prisma schema column should restart the dev server before running its browser checks.**

### Verification output (actual)

```
$ npm run check
> koduedu@0.1.0 check
> tsc --noEmit
(exit 0, no output)

$ npx tsx e2e/unidad.ts
✔ cifrar/descifrar: ida y vuelta con el mismo AAD
✔ descifrar: un AAD distinto (ciphertext copiado a otra fila) rechaza
✔ cadenaDeMotores: un ciclo A→B→A no cuelga y corta en 2
✔ cadenaDeMotores: el tope de 3 eslabones se respeta aunque la cadena siga
✔ calcularCostoTurno: la resta de tokens cacheados NO duplica el cobro
✔ calcularCostoTurno: precio nulo nunca fabrica un costo
✔ calcularCostoTurno: un turno gratis da costo 0, no null
✔ calcularCostoTurno: sin tarifa de caché propia, cae a la de entrada (y lo registra así)
✔ calcularCostoTurno: Decimal(16,10) no pierde un costo de fracción de centavo
✔ formatearCostoUsd: la tabla de redondeo completa
✔ nivelDeConsumo: los tres cortes, con los bordes exactos

✔ e2e/unidad.ts: todas las pruebas pasaron

$ npx tsx e2e/m4-costos.ts
✔ un turno completo escribe projectId y un costo que coincide con la fórmula
✔ editar el precio de un motor no reescribe costos ya congelados
✔ un turno en un motor gratuito escribe costUsd = 0, nunca NULL
✔ un motor con precio sin cargar escribe costUsd NULL, y costoPorProyecto lo respeta (no lo inventa)
✔ una fila con forma histórica (sin projectId/aiModelId) queda con costUsd NULL — se renderiza "histórico", nunca $0
✔ preparado un recurso con tokens por encima del corte de "Consumo medio"
✔ lectura por defecto: "Consumo bajo", sin moneda, sin la palabra "ficha"
✔ el mouse (hover) revela tokens + USD
✔ alejar el mouse cierra el popover
✔ el tap/click también revela el popover
✔ el foco de teclado revela el popover, sin usar el mouse
✔ Enter sobre el botón enfocado no rompe el popover (sigue revelado)
✔ Escape cierra el popover revelado por teclado
✔ el indicador funciona igual en tema oscuro (foco de teclado + revelado)
✔ un recurso con tokens por encima del corte muestra "Consumo medio"
✔ un motor con precio sin cargar muestra el aviso de "sin precios", nunca US$ 0,00
✔ un recurso sin uso no muestra ningún indicador (nunca "Consumo bajo" en $0)

✔ e2e/m4-costos.ts: todos los escenarios pasaron

$ npx tsx e2e/m1-admin-shell.ts   # regresión, no forma parte de M4
✔ e2e/m1-admin-shell.ts: todos los escenarios pasaron (11/11)

$ npx tsx e2e/m2-catalogo.ts   # regresión, no forma parte de M4
✔ e2e/m2-catalogo.ts: todos los escenarios pasaron (7/7)

$ npx tsx e2e/m3-motores.ts   # regresión, no forma parte de M4
✔ e2e/m3-motores.ts: todos los escenarios pasaron (14/14)

$ rg -n 'bg-white|bg-slate-' src/components/workspace/IndicadorConsumo.tsx src/pages/app/project/'[id].astro'
(exit 1, no matches — expected)

$ docker exec -i kodu_db_dev psql -U kodu -d koduedu -c '... AiModel ...'
  4 filas, estado sembrado sin cambios: MiniMax M3 (default, sortOrder 0),
  MiniMax M2.7 (sortOrder 1), DeepSeek (sortOrder 2), Alpha (disabled,
  sortOrder 3) — exactamente 1 fila con isDefault=true.

$ docker exec -i kodu_db_dev psql -U kodu -d koduedu -c '... conteos ...'
  TokenUsage/Project/AiModel del usuario de prueba de M4: 0/0/0 tras la
  corrida (limpiarEstado corrió en el finally). Los 14 Project restantes con
  email "%e2e%" pertenecen a los usuarios de prueba de M2/M3 (4+10), no a M4
  — debris preexistente de milestones anteriores, no introducido acá.
```

### Remaining tasks

None for Phase 4. Phases 5–8 (M5–M8) remain out of scope for this apply batch.

### Workload / PR boundary

- Mode: stacked-to-main, chained PR slice
- Current work unit: M4
- Boundary: starts where M3 left off on `feat/panel-admin`, ends at the M4
  checkpoint (task 4.12).
- Estimated review budget impact: forecast estimated ~450 changed lines for
  M4. `review_budget_lines` is unbounded for this change per the owner, so
  this is informational only.

## Phase 5: M5 — Users route + detail

**Status**: complete. 12/12 tasks done (5.1–5.12), with two documented scope
cuts inside 5.1/5.3/5.4 (see Deviation 1) and one explicitly-deferred
sub-scenario inside 5.8 (see Deviation 2) — both pre-existing cross-milestone
dependencies the tasks author either couldn't fully resolve ahead of M6/M8 or
didn't flag, not omissions introduced here.

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npm run check` → exit 0, no output (clean `tsc --noEmit`) |
| Runtime harness command/scenario and exact result | `npx tsx e2e/m5-usuarios.ts` → all 23 scenario assertions passed, both themes; run twice in a row to confirm idempotency (same result both times). Regressions re-run clean: `npx tsx e2e/unidad.ts` (11/11), `npx tsx e2e/m1-admin-shell.ts` (11/11), `npx tsx e2e/m2-catalogo.ts` (7/7), `npx tsx e2e/m3-motores.ts` (14/14), `npx tsx e2e/m4-costos.ts` (17/17) |
| Rollback boundary | `git revert` this work unit's commit(s) on `feat/panel-admin`. No migration ran — `prisma/schema.prisma` is byte-for-byte unchanged from M4 (see Deviation 1 for why). Rollback removes `/admin/usuarios*`, `UsuariosTabla.tsx`, `GraficoColumnas.tsx`, `GraficoBarras.tsx`, the two new API routes, `src/lib/admin/usuarios.ts`, and the three new `usage.ts` functions cleanly. Reverting also RESTORES `src/pages/app/consumo.astro` and the `usageByUser()` function this batch deleted — intentional, since a partial revert without them would leave a dangling nav-less route reference. M1–M4 surfaces are untouched by this rollback |

### Completed tasks

- [x] 5.1 `src/pages/api/admin/users/[id].ts` — `PATCH { role }`, 404 on missing user, 422 on empty body, 409 on demoting the last admin with the exact spec message. `aiAccessOverride` intentionally not accepted — see Deviation 1.
- [x] 5.2 `src/pages/api/admin/users/[id]/consumo.ts` — `GET` → `{ porDia, total, porModelo }`, all `Decimal` converted to `string`/`number` before leaving the route.
- [x] 5.3 `src/pages/admin/usuarios.astro` + `src/components/admin/UsuariosTabla.tsx` — all 7 non-deferred columns (Docente + Google glyph, Rol, Acceso a la IA, Recursos, Tokens, USD, Última actividad) plus the overflow menu. USD is unconditionally visible (never behind a reveal), `text-right tabular-nums`.
- [x] 5.4 Overflow menu — `<details data-menu>` reusing the exact mechanism `BaseLayout.astro:126` already generalised in M1. `Hacer administrador`/`Quitar administrador` (real, calls the API) + `Ver ficha` (navigates to the detail page). Keyboard-operable natively (no custom JS): `<summary>` is focusable and opens on Enter/Space; Tab descends into the panel in document order.
- [x] 5.5 `src/pages/admin/usuarios/[id].astro` — stat trio + both charts, rendered with **no `client:*` directive** (pure server-side SVG, zero JS shipped for the charts — the native `<title>` tooltip needs none). No charting library in `package.json` (verified by the e2e script's dependency scan).
- [x] 5.6 `GraficoColumnas.tsx` — exact viewBox, `fill-brand-600` rects, gridline + max-value label, "Todavía no usó la IA." sentence when the user never used the IA at all (all-time, not just the 30-day window — see the code comment on `nuncaUsoLaIa` in the detail page), all-free-engine data still renders with the literal subtitle design.md specifies, single-day mode with no axis. `role="img"` + `<title>` per rect + `<table class="sr-only">` mirror, all implemented.
- [x] 5.7 `GraficoBarras.tsx` — horizontal stacked bar, `brand-600`/`brand-300`/`brand-100` cycling if more than 3 models, width ∝ tokens, legend beneath with tokens + cost per model, same accessibility shape as 5.6.
- [x] 5.8 Projects list in the detail view, each a real `<a href="/app/project/{id}">`. Opening one as admin today redirects to `/app` (no M8 ownership bypass) — verified explicitly, not faked (Deviation 2).
- [x] 5.9 `src/pages/app/consumo.astro` deleted. `BaseLayout.astro`'s "Consumo de tokens" dropdown item removed. The now-orphaned `usageByUser()`/`UsageByUser` (that page's only caller) removed from `usage.ts` as dead-code cleanup, along with the now-unused `ModelChoice` import.
- [x] 5.10 `e2e/m5-usuarios.ts` — both themes, all required scenarios (see Work Unit Evidence).
- [x] 5.11 `npm run check` exit 0. `rg -n 'bg-white|bg-slate-' src/components/admin` — no matches.
- [x] 5.12 M5 checkpoint — `/app/consumo.astro` is gone, its nav entry is gone, `/admin/usuarios` is the only admin-facing consumption surface — deliverable.

### Files changed

| File | Action | What |
|---|---|---|
| `src/pages/admin/usuarios.astro` | Modify | Empty shell → renders `UsuariosTabla` |
| `src/pages/admin/usuarios/[id].astro` | Create | Detail view: header, stat trio, both charts, projects list |
| `src/components/admin/UsuariosTabla.tsx` | Create | Table rows + per-row overflow menu (`client:load`) |
| `src/components/admin/GraficoColumnas.tsx` | Create | 30-day SVG columns, server-rendered only |
| `src/components/admin/GraficoBarras.tsx` | Create | Stacked SVG bar by model, server-rendered only |
| `src/pages/api/admin/users/[id].ts` | Create | `PATCH` role + last-admin guard |
| `src/pages/api/admin/users/[id]/consumo.ts` | Create | `GET` the two charts' raw data |
| `src/lib/admin/usuarios.ts` | Create | `listarUsuariosAdmin()`, `obtenerUsuarioAdmin()` — all `Decimal`/`Date` converted to display-ready strings before touching a component |
| `src/lib/ai/usage.ts` | Modify | Added `costoTotalDeUsuario()`, `consumoDiarioDeUsuario()`; rewrote `consumoPorUsuario()` to fix the documented partial-null-sum limitation (raw-row grouping instead of `groupBy`+`_sum`); removed dead `usageByUser()`/`UsageByUser` |
| `src/lib/format/costo.ts` | Modify | Added `formatearCostoAdminUsd()` (the `≈` prefix for admin-facing approximate figures) |
| `src/lib/format/fecha.ts` | Create | `haceTiempo()`, `fechaLarga()` |
| `src/lib/format/tokens.ts` | Create | `formatearTokensCompacto()` ("482,1 k") |
| `src/pages/app/consumo.astro` | Delete | Absorbed into `/admin/usuarios` |
| `src/layouts/BaseLayout.astro` | Modify | Removed the "Consumo de tokens" dropdown item |
| `e2e/m5-usuarios.ts` | Create | Slice verification, both themes |

### Deviations from design

1. **`aiAccessOverride` is NOT implemented in M5, despite task 5.1/5.3/5.4 naming it explicitly.** The column genuinely does not exist yet: `src/lib/auth/session.ts` and `src/middleware.ts` both carry M1-era comments stating it "arrives with M6's migration," and design.md's own M5 file-changes table lists no schema/migration work for M5 — only M6's section covers the `deepseekEnabled` → `aiAccessOverride` rename. Task 5.1's literal wording (`aiAccessOverride?` as an optional PATCH field) and 5.3/5.4's three-state UI description assume the column already exists, but nothing in tasks.md flags this as a cross-milestone dependency the way 5.8/M8 is explicitly flagged. Rather than either (a) silently adding a new column ahead of M6's planned rename — which would conflict with M6's migration SQL (`ALTER TABLE ... RENAME COLUMN "deepseekEnabled" TO "aiAccessOverride"` assumes the old name still exists) and would have my M5 admin decisions silently wiped by M6's `UPDATE ... SET NULL`, or (b) fabricating a working "individual permission" state with no real backing data, I implemented the part that's honestly buildable today: `role` toggle (fully real, DB-backed, last-admin guard) and a genuine two-state "Acceso a la IA" reading (`Sí · por dominio` / `No`) computed from the EXISTING `isAllowedDomain()` domain check (the same function that already gates registration and login today, per `domains.ts`) — never the fabricated `Sí · permiso individual` third state. **Recommendation for whoever runs M6**: since `aiAccessOverride` doesn't exist as a distinct column from M5, M6 can just rename `deepseekEnabled` as design.md already planned — this deviation changes nothing about M6's own migration, it just means M5 shipped without the individual-override UI, which M6 should add once the column lands.
2. **Task 5.8's "admin opens and prompts a listed project" is implemented as a listing + real link, not a full open-and-prompt flow** — this exact deferral is already explicitly sanctioned by tasks.md's own Phase 5 preamble note (the M8 cross-dependency), not something introduced here. `e2e/m5-usuarios.ts` verifies the link exists, points at the correct project id, and that clicking it as an admin today redirects to `/app` (the existing `project/[id].astro` ownership check, unchanged) — an accurate reflection of today's state, not a stubbed-out "TODO" or a faked pass.
3. **`consumoPorUsuario()` was rewritten** (raw-row grouping instead of `groupBy`+`_sum`) to fix the partial-null-sum limitation M4's Deviation 2 explicitly flagged and invited M5 to fix, since M5's bar-chart legend needed the same "one unpriced row nullifies the whole group's cost" guarantee `costoPorProyecto()` already has, to avoid a partial sum that looks complete.
4. **`GraficoColumnas.tsx`/`GraficoBarras.tsx` are rendered with no `client:*` directive** — design.md requires zero-JavaScript native tooltips (`<title>` elements) and neither chart has any interactivity, so shipping them as hydrated islands would be pure waste. This also sidesteps the `Decimal`-across-serialization trap entirely for these two components, though the `.astro` page still pre-converts every figure to plain strings/numbers before passing them down, matching the established convention.
5. **`usageByUser()`/`UsageByUser` (its only caller, `consumo.astro`) removed as part of task 5.9's cleanup**, not left as dead exported code — task 5.9 says "absorbed," and leaving an unused enum-keyed aggregation function next to its replacement would be exactly the kind of stale surface the milestone exists to remove.

### Issues found

None blocking. One test-script-only gotcha worth recording for future e2e authors in this repo: a keyboard-driven retry loop that (1) acts, then (2) checks a DB read for success, and retries the WHOLE action sequence on failure, is unsafe if the action isn't idempotent and the loop doesn't re-check state before acting again — a slow-to-hydrate `client:load` button can leave a `<details>` menu open with its click never having fired, and a naive retry's next `Enter` on the now-open, still-focused `<summary>` CLOSES it instead of opening it, so the following `Tab` escapes into the next row entirely (in this table, straight into that row's own name link) and an `Enter` there navigates away to a different user's detail page. Fixed by checking the DB state before every attempt (skip acting if already succeeded) and checking the `<details>` element's actual `open` property before pressing Enter to open it (never blind-toggle). Left as an explicit code comment in `e2e/m5-usuarios.ts` for whoever writes the next keyboard-only retry loop in this repo.

### Verification output (actual)

```
$ npm run check
> koduedu@0.1.0 check
> tsc --noEmit
(exit 0, no output)

$ npx tsx e2e/m5-usuarios.ts
✔ preparado: docente con consumo multi-día y multi-motor
✔ preparado: docente con un solo turno (un solo día con datos)
✔ preparado: docente con un recurso pero sin ningún turno
✔ preparado: docente con consumo, siempre en el motor gratuito
✔ preparado: docente con un motor sin precio + una fila histórica
✔ tabla: fila multi-día/multi-motor con los 6 campos correctos
✔ tabla: fila de un solo turno
✔ tabla: fila sin ningún turno muestra "—", nunca "US$ 0,00"
✔ tabla: fila 100% gratuita muestra "US$ 0,00" exacto, sin aproximar
✔ tabla: motor sin precio cargado nunca se confunde con "gratis"
✔ tabla: docente sin ningún recurso ni turno muestra "Nunca"
✔ tabla: las mismas cifras se sostienen en tema oscuro
✔ detalle: docente multi-día/multi-motor renderiza ambos gráficos con sus cifras
✔ detalle: un solo turno renderiza una única columna, no una grilla vacía
✔ detalle: sin ningún turno, la frase reemplaza a los dos gráficos (nunca uno vacío)
✔ detalle: consumo 100% gratuito se lee como tal, no como "sin actividad"
✔ detalle: la fila histórica (fuera de la ventana de 30 días) se etiqueta en la barra, sin inventarle costo
✔ detalle: el enlace al recurso existe; abrirlo como admin hoy vuelve a /app (bloqueado hasta M8, no se finge éxito)
✔ menú de fila: Tab→Enter, totalmente por teclado, promovió al docente a administrador
✔ menú de fila: la tabla refleja el nuevo rol sin recargar la página
✔ la promoción rige en el próximo pedido, con la cookie vieja, sin volver a loguearse
✔ API: bajar al único administrador responde 409 con el mensaje del spec
✔ package.json: no se agregó ninguna dependencia de gráficos

✔ e2e/m5-usuarios.ts: todos los escenarios pasaron

$ npx tsx e2e/unidad.ts   # regresión, no forma parte de M5
✔ e2e/unidad.ts: todas las pruebas pasaron (11/11)

$ npx tsx e2e/m1-admin-shell.ts   # regresión
✔ e2e/m1-admin-shell.ts: todos los escenarios pasaron (11/11)

$ npx tsx e2e/m2-catalogo.ts   # regresión
✔ e2e/m2-catalogo.ts: todos los escenarios pasaron (7/7)

$ npx tsx e2e/m3-motores.ts   # regresión
✔ e2e/m3-motores.ts: todos los escenarios pasaron (14/14)

$ npx tsx e2e/m4-costos.ts   # regresión
✔ e2e/m4-costos.ts: todos los escenarios pasaron (17/17)

$ rg -n 'bg-white|bg-slate-' src/components/admin
(exit 1, no matches — expected)

$ git diff --stat package.json package-lock.json
(no output — no dependency changes)

$ docker exec kodu_db_dev psql -U kodu -d koduedu -c 'SELECT email, role FROM "User" ORDER BY "createdAt";'
  12 filas: sólo admin@rededucativa.edu.ar es ADMIN; los 7 usuarios de
  prueba de M5 (multi/uno/vacio/gratis/sinprecio/promover/admin-solo)
  quedaron en DOCENTE — estado restaurado por limpiarEstado() en el finally.

$ docker exec kodu_db_dev psql -U kodu -d koduedu -c 'SELECT count(*) FROM "TokenUsage" WHERE ...test-m5...'
  0 filas — sin residuo de TokenUsage/AiModel/Project de M5 tras la corrida.
```

### Remaining tasks

None for Phase 5. Phases 6–8 (M6–M8) remain out of scope for this apply batch.
Recommendation for whoever picks up M6 (see Deviation 1): the
`deepseekEnabled` → `aiAccessOverride` rename in task 6.1 can proceed exactly
as design.md describes — M5 did not create a competing column — but M6
should also wire `UsuariosTabla.tsx`'s "Acceso a la IA" column and overflow
menu to the real three-state value once `aiAccessOverride` exists, since M5
only shipped the two states buildable without it.

### Workload / PR boundary

- Mode: stacked-to-main, chained PR slice
- Current work unit: M5
- Boundary: starts where M4 left off on `feat/panel-admin`, ends at the M5
  checkpoint (task 5.12).
- Estimated review budget impact: forecast estimated ~600 changed lines for
  M5. `review_budget_lines` is unbounded for this change per the owner, so
  this is informational only.

## Phase 6: M6 — Access control

**Status**: complete. 11/11 tasks done (6.1–6.11). Honours M5's Deviation 1
recommendation exactly: `deepseekEnabled` renamed to `aiAccessOverride` with
no competing column to reconcile.

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npm run check` → exit 0, no output (clean `tsc --noEmit`) |
| Runtime harness command/scenario and exact result | `npx tsx e2e/m6-acceso.ts` → all 23 scenario assertions passed, both themes; run three times in a row to confirm idempotency (same result every time). Regressions re-run clean: `npx tsx e2e/unidad.ts` (11/11), `npx tsx e2e/m1-admin-shell.ts` (11/11), `npx tsx e2e/m2-catalogo.ts` (7/7), `npx tsx e2e/m3-motores.ts` (14/14), `npx tsx e2e/m4-costos.ts` (17/17), `npx tsx e2e/m5-usuarios.ts` (23/23) |
| Rollback boundary | `git revert` this work unit's commit(s) on `feat/panel-admin`. **Not a clean schema rollback** — the hand-written migration `20260921000000_acceso_y_ajustes` is destructive by design (it clears `deepseekEnabled`/`aiAccessOverride` to `NULL` and renames the column); reverting the commits removes the application code but the DB migration itself is not auto-reverted (matches the standing convention in this repo — migrations are forward-only, `prisma migrate resolve` marks them applied, never rolled back automatically). Rollback removes `/admin/dominios`'s real content (back to the empty shell), the two `/api/admin/domains` routes, `src/lib/settings.ts`, and the three-state UI in `UsuariosTabla.tsx` (back to the M5 two-state read). `register.ts`/`login.ts`/`callback.ts` would need the domain check restored by hand if a true behavioural rollback (not just code revert) were required — this is a real behaviour change, not a toggle |

### Completed tasks

- [x] 6.1 `prisma/schema.prisma` — `AppSettings` singleton, `AuthorizedDomain`, `User.deepseekEnabled` → `aiAccessOverride` (nullable, no default)
- [x] 6.2 Hand-written migration `prisma/migrations/20260921000000_acceso_y_ajustes/migration.sql`, applied via `docker exec kodu_db_dev psql` + `prisma migrate resolve --applied` (never `prisma migrate dev`, per the trap). **Verified live**: seeded a probe row with `deepseekEnabled = true` before running the SQL; `UPDATE "User" SET "aiAccessOverride" = NULL` reported `UPDATE 13` (all 13 existing rows, including the probe); post-migration query confirmed the probe's `aiAccessOverride` is `NULL`, not `true`. Probe row deleted after verification.
- [x] 6.3 `src/lib/settings.ts` — `leerAppSettings()`, 10s cache + `invalidarAppSettings()`
- [x] 6.4 `src/lib/auth/domains.ts` — rewritten: `leerDominiosAutorizados()` (10s cache over `AuthorizedDomain`) + `invalidarDominios()`, `coincideDominio()` (the M2-era wildcard matcher, ported unchanged), `dominioAutorizado()` (domain-only, used by the admin table), `puedeUsarLaIa(user)` (the full three-state precedence). `isAllowedDomain()`/`allowedDomainsLabel()` removed — nothing calls them anymore.
- [x] 6.5 Gate moved: `isAllowedDomain` check removed from `register.ts`, `login.ts`, `callback.ts`; `allowedDomains` prop removed from `AuthForm.tsx`/`login.astro`/`register.astro` (dead `error=dominio` case also removed from both pages' error maps, since `callback.ts` no longer emits it). `puedeUsarLaIa(user)` added in `stream.ts`, as the very first check after resolving `locals.user` — before body parsing, before touching the motor catalog, before anything is spent. Exact refusal copy from the spec.
- [x] 6.6 `prisma/seed.ts` — seeds `AuthorizedDomain` from `getAllowedDomains()` only when the table is empty (idempotent, logs which branch it took)
- [x] 6.7 `src/pages/admin/dominios.astro` (was the empty shell) + `DominiosPanel.tsx` + `src/lib/admin/dominios.ts` + `src/pages/api/admin/domains/index.ts` (`GET`/`POST`) + `src/pages/api/admin/domains/[id].ts` (`DELETE`). Both literal copy strings from the spec, switched on `dominios.length === 0`.
- [x] 6.8 DB-state checks: `AppSettings` — exactly one row survives (verified: seed `INSERT` + schema `CHECK (id = 1)`, singleton by construction, no code path can create a second row since `id` is always `1`); a domain added via `/api/admin/domains` is visible to `puedeUsarLaIa()` on the very next call (`invalidarDominios()` fires synchronously in the same process, verified by the e2e suite's scene 8 — add reflects with no reload); every pre-existing `deepseekEnabled=true` row reads `aiAccessOverride=NULL` (verified live at migration time, see 6.2).
- [x] 6.9 `e2e/m6-acceso.ts` — both themes, all required scenarios (see Work Unit Evidence and Issues Found for the real local mock-provider harness built for the in-flight scenario)
- [x] 6.10 `npm run check` exit 0
- [x] 6.11 **M6 checkpoint** — access is DB-backed and gated at AI usage, not registration — deliverable

### Files changed

| File | Action | What |
|---|---|---|
| `prisma/schema.prisma` | Modify | `AppSettings`, `AuthorizedDomain` models; `User.deepseekEnabled` → `aiAccessOverride` (nullable) |
| `prisma/migrations/20260921000000_acceso_y_ajustes/migration.sql` | Create | Hand-written: two `CREATE TABLE`, the seed `INSERT` for `AppSettings`, the rename + `DROP NOT NULL`/`DROP DEFAULT` + `UPDATE ... SET NULL` for `User` |
| `prisma/seed.ts` | Modify | Seeds `AuthorizedDomain` from `ALLOWED_EMAIL_DOMAINS`, idempotent, only when empty |
| `src/lib/settings.ts` | Create | `leerAppSettings()` / `invalidarAppSettings()`, 10s cache |
| `src/lib/auth/domains.ts` | Rewrite | DB-backed domain list + wildcard matcher + `puedeUsarLaIa()`; `isAllowedDomain()`/`allowedDomainsLabel()` removed |
| `src/lib/auth/session.ts` | Modify | Comment updated — `aiAccessOverride` is now a real column, no longer a placeholder |
| `src/middleware.ts` | Modify | `resolverIdentidadFresca()` selects and forwards the real `aiAccessOverride` on every gated request |
| `src/pages/api/auth/register.ts` | Modify | Domain check removed; registration open to any domain |
| `src/pages/api/auth/login.ts` | Modify | Domain check removed; login open to any domain; session now carries the real `aiAccessOverride` |
| `src/pages/auth/callback.ts` | Modify | Domain check removed; `aiAccessOverride` selected and forwarded on both the existing-user and new-user paths |
| `src/pages/api/chat/stream.ts` | Modify | `puedeUsarLaIa(user)` gate added as the very first check in `POST`, before any parsing or spend |
| `src/components/AuthForm.tsx` | Modify | `allowedDomains` prop and its helper text removed; placeholder generalized |
| `src/pages/login.astro` | Modify | `allowedDomainsLabel()` import/usage removed; dead `dominio` error-map entry removed |
| `src/pages/register.astro` | Modify | Same, plus the now-false "restringido a docentes de la red educativa" subtitle rewritten |
| `src/pages/admin/dominios.astro` | Modify | Empty shell → renders `DominiosPanel` |
| `src/components/admin/DominiosPanel.tsx` | Create | Add/remove list, empty vs non-empty copy exactly per design.md |
| `src/lib/admin/dominios.ts` | Create | `listarDominiosAdmin()` |
| `src/pages/api/admin/domains/index.ts` | Create | `GET`/`POST`, pattern validation + normalization, `invalidarDominios()` on write |
| `src/pages/api/admin/domains/[id].ts` | Create | `DELETE`, `invalidarDominios()` on write |
| `src/lib/admin/usuarios.ts` | Modify | `accesoIa` now reflects all three real states (`textoAccesoIa()`/`accesoIaDeUsuario()`); `isAllowedDomain` swapped for `dominioAutorizado` |
| `src/pages/api/admin/users/[id].ts` | Modify | `PATCH` now accepts `aiAccessOverride` (`.nullable().optional()`, explicit `null` distinct from omitted), returns the recomputed `accesoIa` text |
| `src/components/admin/UsuariosTabla.tsx` | Modify | Row menu gained the tri-state items (`Habilitar la IA` / `Bloquear la IA` / `Volver a la regla del dominio`); column reads the real value |
| `e2e/m6-acceso.ts` | Create | Full slice verification, both themes, including a real local SSE mock AI provider for the in-flight scenario |

### Deviations from design

1. **The test message for `/api/chat/stream` had to avoid a pre-existing, unrelated regex bug in `pideCambio()` (`stream.ts`)** — not introduced by M6, not touched by M6. `INTERROGATIVA`'s trailing `\b` fails immediately after a word ending in an accented vowel (`é`, `á`, …) followed by whitespace, because JavaScript's `\b` is defined against ASCII `\w` and treats accented letters as non-word characters — so a genuinely interrogative message like `"¿Qué día es hoy?"` is misclassified as a change request (`pideCambio()` returns `true` instead of `false`), forcing an unwanted tool-call retry. Confirmed directly in `node -e`. Worked around in `e2e/m6-acceso.ts` by using test messages that don't end a matched interrogative word in an accented vowel (`"¿Existe algo nuevo hoy?"` instead of `"¿Qué día es hoy?"`) — the M6 gate itself doesn't care about message content at all, so this only affected the harness. **Flagging, not fixing**: out of M6's scope; a real pre-existing defect for whoever next touches `stream.ts`'s Spanish message classification.
2. **The `/api/chat/stream` access gate is placed before `readBody`, not merely "before the token-limit check"** — task 6.5 says "beside the token-limit check"; the implementation puts it earlier still (immediately after resolving `locals.user`, before even parsing the JSON body), because that is strictly "before anything is spent" and costs nothing extra (no dependency on the parsed body). The token-limit check remains exactly where it was; the access gate is simply first among the several checks in the handler, which is a strengthening, not a deviation from intent.

### Issues found

1. **A real local SSE mock AI provider was necessary to genuinely test "revocation doesn't cut an in-flight turn."** Rather than fabricate this scenario or skip it (both explicitly discouraged by the established convention in this repo — see M5's Deviation notes on never faking a pass), `e2e/m6-acceso.ts` starts a tiny local `node:http` server that speaks the same SSE dialect `readCompletionStream()` expects, registers it as a real `AiModel` via the admin API (so `catalogo.ts`'s 30s cache sees it immediately), and drives a real turn through the real `/api/chat/stream` pipeline with an artificial 1.5s delay mid-response. The admin's revocation call lands measurably inside that window (confirmed by direct instrumentation during debugging — see below), and the assertions are on the real HTTP responses, not simulated. Test messages are phrased as questions so `pideCambio()` returns `false` and no tool-call assembly is required from the mock (see Deviation 1) — the mock only ever needs to stream plain text.
2. **Two Playwright-vs-real-browser gaps, not app bugs, cost debugging time and are now commented in the test file**: (a) `page.request.delete()` with no body doesn't send an `Origin` header the way a real browser's `fetch()` does for same-origin DELETEs, so `csrf.ts`'s cross-origin check (correctly) rejected it — worked around with `data: {}` to force the JSON content-type exemption path. (b) Launching a second `chromium.launch()` in the middle of the "in-flight" timing window stalled the event loop long enough to invert the intended ordering (the revoke call would sometimes land server-side *before* the first request's gate check even ran) — fixed by pre-launching and pre-authenticating both browser contexts before starting the timed section.
3. **Under real system load on this shared machine** (confirmed via `free -h`/`ps aux` mid-debugging: ~5.3/7.9 GiB RAM used, 3 GiB swap in use, load average 3.7 on 4 cores, from several concurrent unrelated agent sessions), first-time-in-process Vite compilation of the `/admin/dominios` and `/admin/usuarios` islands occasionally exceeded a 10s retry budget. This is an environment characteristic, not an M6 defect — confirmed by reproducing the *exact same* timeout failure on the pre-existing, untouched `e2e/m2-catalogo.ts` (`Enviar` button staying disabled) on the same run, which passed cleanly on a second, unmodified re-run once other load subsided. `e2e/m6-acceso.ts`'s first-render waits were bumped to 45s and given an explicit `waitForLoadState('networkidle')` before interacting, to be robust against this without weakening what's actually being asserted.

### Verification output (actual)

```
$ npm run check
> koduedu@0.1.0 check
> tsc --noEmit
(exit 0, no output)

$ npx tsx e2e/m6-acceso.ts   (run 3 times in a row, identical result every time)
✔ preparado: motor de IA de prueba dado de alta por la API de admin
✔ preparado: lista blanca con "escuela-e2e-m6.edu.ar" y "*.edu.ar"
✔ registro: un dominio no listado puede crear una cuenta
✔ login: la misma cuenta, con el mismo dominio no listado, puede entrar
✔ uso de la IA: dominio no listado y sin override → 403 con el mensaje legible del spec
✔ uso de la IA: el grant de admin habilita a un usuario de dominio no listado, en su próximo turno
✔ uso de la IA: dominio listado, sin override → permitido por la regla del dominio
✔ uso de la IA: la revocación de admin bloquea a un usuario de dominio listado, sin importar el dominio
✔ uso de la IA: lista de dominios vacía → todo el mundo puede usar la IA
✔ uso de la IA: el comodín "*.edu.ar" matchea un subdominio real
✔ turno en curso: revocar a mitad de camino no lo corta, termina normal
✔ próximo turno: bloqueado, tal como pide el spec ("revocation applies to the next turn")
✔ /admin/dominios (light): agregar un dominio lo refleja en la lista sin recargar
✔ /admin/dominios (light): quitar un dominio lo saca de la lista sin recargar
✔ /admin/dominios (dark): agregar un dominio lo refleja en la lista sin recargar
✔ /admin/dominios (dark): quitar un dominio lo saca de la lista sin recargar
✔ /admin/dominios: el copy de lista vacía es el literal de design.md
✔ /admin/usuarios (light): "Habilitar la IA" pasa la columna a "Sí · permiso individual"
✔ /admin/usuarios (light): "Bloquear la IA" pasa la columna a "No"
✔ /admin/usuarios (light): "Volver a la regla del dominio" no rompe la fila
✔ /admin/usuarios (dark): "Habilitar la IA" pasa la columna a "Sí · permiso individual"
✔ /admin/usuarios (dark): "Bloquear la IA" pasa la columna a "No"
✔ /admin/usuarios (dark): "Volver a la regla del dominio" no rompe la fila

✔ e2e/m6-acceso.ts: todos los escenarios pasaron

$ npx tsx e2e/unidad.ts        # regresión → 11/11
$ npx tsx e2e/m1-admin-shell.ts  # regresión → 11/11
$ npx tsx e2e/m2-catalogo.ts    # regresión → 7/7 (one transient environment-load failure reproduced and explained — see Issues Found #3 — then a clean pass on the untouched file)
$ npx tsx e2e/m3-motores.ts    # regresión → 14/14
$ npx tsx e2e/m4-costos.ts     # regresión → 17/17
$ npx tsx e2e/m5-usuarios.ts   # regresión → 23/23

$ docker exec kodu_db_dev psql -U kodu -d koduedu -c "SELECT email, \"deepseekEnabled\" FROM \"User\" WHERE id = 'm6-migration-probe-id';"
  before migration: t

$ docker exec -i kodu_db_dev psql -U kodu -d koduedu < prisma/migrations/20260921000000_acceso_y_ajustes/migration.sql
  ...
  UPDATE 13    ← every pre-existing row, including the probe, set to NULL

$ docker exec kodu_db_dev psql -U kodu -d koduedu -c "SELECT email, \"aiAccessOverride\" FROM \"User\" WHERE id = 'm6-migration-probe-id';"
  after migration: (null)

$ docker exec kodu_db_dev psql -U kodu -d koduedu -c "SELECT count(*) FILTER (WHERE \"aiAccessOverride\" IS NOT NULL) AS non_null, count(*) AS total FROM \"User\";"
  non_null=0, total=13

$ docker exec kodu_db_dev psql -U kodu -d koduedu -c "SELECT * FROM \"AppSettings\";"
  exactly one row, id=1, demoEnabled=false, demoTokenLimit=200000

$ docker exec kodu_db_dev psql -U kodu -d koduedu -c "SELECT count(*) FROM \"AuthorizedDomain\";"
  0   ← clean after test teardown

$ docker exec kodu_db_dev psql -U kodu -d koduedu -c "SELECT email, \"aiAccessOverride\" FROM \"User\" WHERE email = 'admin@rededucativa.edu.ar';"
  admin@rededucativa.edu.ar | (null)   ← untouched by the whole test run

$ docker exec kodu_db_dev psql -U kodu -d koduedu -c "SELECT count(*) FROM \"AiModel\" WHERE provider = 'test-m6';"
  0   ← no residue from the test's mock-provider AiModel row
```

### Remaining tasks

None for Phase 6. Phases 7–8 (M7–M8) remain out of scope for this apply
batch. `demo.astro` still an empty shell for M7; `AppSettings.demoEnabled`/
`demoTokenLimit`/`demoCycleStartedAt` exist in the schema now (M6 delivered
the table itself, per design.md §9) but nothing reads or writes them yet —
that wiring is M7's job.

### Workload / PR boundary

- Mode: stacked-to-main, chained PR slice
- Current work unit: M6
- Boundary: starts where M5 left off on `feat/panel-admin`, ends at the M6
  checkpoint (task 6.11).
- Estimated review budget impact: `review_budget_lines` is unbounded for
  this change per the owner, so this is informational only.
