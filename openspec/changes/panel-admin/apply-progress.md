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

None for Phase 1. Phases 2–8 (M2–M8) are out of scope for this apply batch
per the orchestrator's instruction to implement Phase 1 only.

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
