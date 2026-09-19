# Proposal: Panel de administración (`/admin`)

**Impact flags (per `config.yaml` rules.proposal):** this change affects the **AI resource-generation flow**, **auth**, and the **Prisma schema**. All three.

## Intent

KoduEdu is operated by ~3 admins on one shared, paid API key, but the platform has no operator surface. Engines are a compile-time Postgres enum duplicated across 5 files; prices exist nowhere, so nobody knows what a teacher costs; access is gated at registration by an env var; the only admin page (`/app/consumo.astro`, 134 lines) shows all-time `user × provider` token sums and nothing else. Every operational act — add an engine, promote an admin, let one person in, help a teacher who wrote asking for help — is a code edit and a redeploy.

This change gives admins a real panel: engines and keys as data, cost in USD, per-user control, and a demo door that can be opened and closed.

## Scope

### In Scope

- `/admin` section (own top-level route, several sub-routes) + distinct nav button; ADMIN gate on pages and `/api/admin`.
- **Users**: table (tokens, USD cost, project count, access state, last activity), per-row overflow menu for admin role and AI-access override, detail view with hand-rolled SVG charts (usage over time, by model) and the user's projects.
- **Models**: `AiModel` table replacing the `ModelChoice` enum — provider, encrypted key, base URL, provider-side model id, friendly name, admin description, pricing, order, enabled, default. Reorder, toggle, default radio.
- **Teacher selector** shows friendly name + description (C).
- **Cost**: `TokenUsage` gains `projectId`, cached-input tokens and a frozen cost snapshot; discreet per-project cost indicator in the workspace (D).
- **Access**: domain list moves to the DB and changes meaning — anyone registers, only authorized domains *use the AI*; per-user override wins over the domain rule (F).
- **Demo mode**: global toggle, shared persistent demo account with its own token ceiling, discreet entry line on `/login` (G).
- **Admin acts on another teacher's project** through the existing workspace, with a banner (E).
- Absorb `/app/consumo.astro` into the panel (no second admin surface).
- Fix the `0x01` bytes in `.env.example:25,38` that break `docker compose`.

### Out of Scope

- Charting/UI dependencies (decision 6), audit-log UI beyond what E needs, per-school or org hierarchy, billing/invoicing, quota self-service, e-mail notifications, model streaming-parameter editing beyond the listed fields, retiring the enum's historical values (rows are preserved, not deleted).

## Capabilities

### New Capabilities

- `request-authorization`: per-request identity resolution — role and AI-access flags read from the DB, not the JWT; shared `requireUser()` / `requireAdmin()`; `/admin` and `/api/admin` prefixes in `src/middleware.ts`.
- `ai-model-catalog`: models as data — fields, key encryption at rest, ordering, enable/disable, default selection, fallback chain, and the teacher-facing selector copy.
- `ai-cost-accounting`: usage rows bound to a project, cached-token accounting, price snapshot frozen at write time, per-project indicator, admin aggregates.
- `admin-users`: user list, role management, per-user AI override, user detail with charts and projects.
- `ai-access-control`: authorized domains in the DB; the gate moves from registration to AI usage; override precedence.
- `admin-project-access`: an admin prompting and editing a project they do not own, visibly and attributably.
- `demo-mode`: global toggle, shared demo account, login entry, token ceiling.
- `app-settings`: a single-row settings store for app-wide switches.

### Modified Capabilities

- None. `openspec/specs/` is empty; this is the first change.

## Approach

Decided by the orchestrator, recorded here with rationale:

| # | Decision | Rationale |
|---|---|---|
| 1 | `/admin` is top-level, not under `/app` | Different audience and layout; keeps the teacher app's prefixes clean |
| 2 | Enum → `AiModel` table, migration seeds from current env | Kills the 5-file sync; env becomes seed source, not runtime authority. `Project.selectedModel` and `TokenUsage.provider` become nullable FKs so history survives |
| 3 | `TokenUsage` gains `projectId`, cached tokens, frozen cost | Cost must be answerable per project; a later price edit must never rewrite history |
| 4 | Keys encrypted (AES-256-GCM), never sent to the browser | One shared key is the whole budget. UI shows a masked tail + replace field |
| 5 | Role and flags re-read per request | A DB promotion today must not wait up to 168h for the JWT to expire; the same lag would break the demo toggle and the AI override |
| 6 | Charts are hand-rolled SVG on the oklch brand ramp | A generic chart library would visibly clash with the bespoke design system |
| 7 | Admin works inside the existing workspace, with a banner | One editor to maintain; the owner still sees who touched their resource |
| 8 | Demo = one shared persistent account + its own ceiling | Continuity between visitors is the point; the ceiling caps the damage |
| 9 | `AppSettings` singleton row | Demo toggle and anything app-wide need a home that a toggle can write |

Technique notes: engine resolution moves from `resolveProvider()`'s env if-chain to a cached DB read; `findOwnedProject()` becomes the single place where an admin bypass is granted, and the two inline ownership queries (`src/pages/app/project/[id].astro:12`, `src/pages/app/index.astro:11`) are routed through it; the dead `User.deepseekEnabled` column is repurposed/replaced as the per-user AI override; the dead `assertOwnedProject` helper is either used or deleted.

## Milestones (auto-chain slices)

Each slice compiles, migrates and is independently deliverable.

| # | Slice | Depends on | Delivers |
|---|---|---|---|
| M1 | Authorization + `/admin` shell | — | Per-request role, `requireAdmin()`, middleware prefixes, nav button, empty sub-routes, `.env.example` byte fix |
| M2 | `AiModel` data model | M1 | Table + seeding migration, key encryption, FK swaps, provider resolution from DB |
| M3 | Models route + teacher selector (B, C) | M2 | Admin CRUD, order, toggle, default; selector shows name + description |
| M4 | Cost accounting + indicator (D) | M2 | `TokenUsage` columns, write site in `stream.ts`, frozen snapshot, discreet per-project cost |
| M5 | Users route + detail (A) | M4 | Table, overflow menu, SVG charts; `consumo.astro` absorbed |
| M6 | Access control (F) | M1, M5 | `AppSettings`, domains route, per-user override, gate moves to AI usage |
| M7 | Demo mode (G) | M6 | Toggle, shared account, ceiling, login entry |
| M8 | Cross-owner project access (E) | M1 | Admin bypass in `findOwnedProject()`, banner, attribution |

M8 depends only on M1 and may land earlier if the owner needs it sooner.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `prisma/schema.prisma` + `prisma/migrations/20260919…` | Modified | `AiModel`, `AppSettings`; `TokenUsage` columns; FK swaps; `deepseekEnabled` repurposed |
| `src/lib/ai/provider.ts` | Modified | Env if-chain → DB catalog; `MODEL_CHOICES`/`MODELO_PRINCIPAL`/`normalizarEleccion` become data-driven |
| `src/lib/ai/usage.ts`, `src/pages/api/chat/stream.ts` | Modified | Project-bound usage, cached tokens, cost snapshot, AI-access gate |
| `src/middleware.ts`, `src/lib/auth/session.ts`, `src/env.d.ts` | Modified | Per-request DB read, new protected prefixes |
| `src/lib/auth/domains.ts` | Modified | Domain source moves to DB; meaning moves from registration to AI usage |
| `src/lib/projects.ts` | Modified | Admin bypass; the two inline ownership queries routed through it |
| `src/pages/admin/**`, `src/pages/api/admin/**`, `src/components/admin/**` | New | Panel routes, APIs, React islands, SVG charts |
| `src/components/workspace/ChatPanel.tsx`, `src/lib/workspace-types.ts` | Modified | Selector fed by the catalog; cost indicator |
| `src/layouts/BaseLayout.astro` | Modified | Distinct admin button |
| `src/pages/app/consumo.astro` | Removed | Absorbed into `/admin/usuarios` |
| `.env.example` | Modified | Strip `0x01` bytes on lines 25 and 38 |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Enum→FK migration loses or orphans history | Med | Nullable FKs, seed rows before backfill, data backfill in the same migration file, no enum value dropped |
| Per-request role read adds a query to every request | High | Narrow `select`, short in-request cache; JWT keeps `role` as a degraded fallback if the read fails |
| Encryption key management undecided (rotation, loss) | Med | `KODU_ENCRYPTION_KEY` env; design phase must specify rotation (re-encrypt on read+write) and the "key lost ⇒ re-enter the API keys" path |
| Pricing entered wrong ⇒ meaningless cost figures | Med | Explicit per-million input/output/cached-input fields with units in the label; a preview line showing the cost of a sample turn |
| Demo account abused (shared credentials, public link) | High | Own token ceiling, toggle off kills AI immediately (per-request read), no password to leak but also no rate limit today — the ceiling is the only real cap; gallery publishing from demo is a spam surface the owner accepted |
| Admin editing someone's project confuses the owner | Med | Banner while acting + a durable mark on the affected thread/project so the teacher can see it |
| Existing `TokenUsage` rows have no project and no cost | High | Left null and rendered as "histórico" rather than back-filled with today's prices |
| No test runner; UI-heavy change | High | Playwright is installed — stand up a minimal harness in M1 and verify each slice in both themes |

## Rollback Plan

Per slice: revert the branch and run the paired down-migration. M2 is the only irreversible-ish step — its down path restores `ModelChoice` columns from the preserved enum (never dropped) and re-reads engines from env, which are left intact in `.env` precisely for this. M1's per-request role read can be disabled by a one-line fallback to the JWT claim. M7 rolls back by flipping the toggle off without deploying.

## Dependencies

- `KODU_ENCRYPTION_KEY` (new env var) present before M2 deploys.
- Real provider pricing figures from the owner before cost numbers mean anything (M3/M4).
- No new npm dependencies.

## Success Criteria

- [ ] An admin adds a model, enables it and sets it default without touching code or redeploying; a teacher sees it in the selector with its description.
- [ ] Promoting a user to ADMIN takes effect on their next request, not their next login.
- [ ] The users table shows tokens, USD cost and project count for every user; a user's detail renders charts with no charting dependency in `package.json`.
- [ ] A teacher outside an authorized domain can register but cannot use the AI; an admin override flips that for one person.
- [ ] A project screen shows its accumulated cost without competing for attention.
- [ ] An admin opens another teacher's project, prompts and edits, and the owner can tell it happened.
- [ ] Demo toggle on ⇒ the login line appears and the demo account works and persists; toggle off ⇒ the line is gone and the account cannot use the AI.
- [ ] `npm run check` and `npm run build` pass; no `bg-white` / `bg-slate-*` appears; every new surface works in both themes.

## Open Product Questions

Resolved already (do not reopen): per-user AI override, demo token ceiling, and the nine decisions above.

1. Does the teacher see the cost in **USD**, or in a neutral unit ("consumo")? Showing a docente a dollar figure may discourage use; admins need USD either way.
2. When an admin disables a model that projects are pointing at, do those projects fall back to the default silently, or does the teacher get told?
3. Does revoking a user's AI access cut the turn in flight, or take effect on the next one?
4. In the user detail view, may an admin **open** any teacher's project, or only see titles and figures? (E needs opening; A does not.)
5. Should demo-created gallery resources be marked and bulk-purgeable?
6. What does a visitor see when the demo ceiling is exhausted — a plain message, or an invitation to register?
