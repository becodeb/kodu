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
