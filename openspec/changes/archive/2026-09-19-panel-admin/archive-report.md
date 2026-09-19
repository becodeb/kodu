# Archive Report: panel-admin

**Change**: `panel-admin`  
**Date Archived**: 2026-09-19  
**Status**: Closed ✓  
**Final Verification**: 146 checks, 0 failures, 0 flakes

## Executive Summary

The panel-admin change has been fully implemented, verified, and archived. Eight new administrative domains were designed and shipped: request authorization per-request identity resolution, an AI model catalog replacing the ModelChoice enum, cost accounting with project-bound usage tracking, an admin users table with role management and charts, database-backed AI access control with per-user override, demo mode with shared account and token ceiling, cross-owner project access with admin attribution, and application-wide settings. All 100 implementation tasks are complete. Sixteen commits were landed on the feature branch; the branch was not pushed and has no pull requests per the owner's instructions. The change was fully verified with 146 passing checks across nine verification suites before archival. Two intermediate issues were identified by the verify phase (one CRITICAL, one WARNING) and have been resolved per the final-state facts below.

## Scope Delivered

### New Administrative Domains (8)

1. **request-authorization**: Per-request identity resolution — role and AI-access flags read from the DB on each request, not cached in JWT. Shared `requireUser()` and `requireAdmin()` middleware. Prefixes in `src/middleware.ts`.

2. **ai-model-catalog**: Models as data instead of a compile-time enum. Prisma table with provider, encrypted AES-256-GCM API keys, base URL, provider-side model ID, friendly name, admin description, pricing fields, display order, enabled flag, and default selection. Fallback chain when a model is disabled. Teacher-facing selector updated to show name and description.

3. **ai-cost-accounting**: `TokenUsage` table gains `projectId`, cached-input-token count, and a frozen cost snapshot (USD per turn, locked at write time). Per-project consumption indicator in the workspace. Admin dashboard aggregates by model and time.

4. **admin-users**: User list with token count, cumulative USD cost, project count, access state, and last activity. Per-row overflow menu for role promotion and per-user AI-access override. User detail view with hand-rolled SVG charts (usage over time by model, cumulative cost) and linked projects. Absorbs the previous `/app/consumo.astro` (134 lines).

5. **ai-access-control**: Authorized domains moved from `.env` to the database via `AppSettings`. Gate moved from registration to AI usage time. Per-user override takes precedence over domain rules. Three-state per-user flag (default, allow, deny).

6. **admin-project-access**: An admin can open and edit any project through the workspace editor, visibly and attributably. Owner still sees who made changes via `project.lastEditedBy`.

7. **demo-mode**: Global toggle in `AppSettings`. Shared persistent demo account (`demo@kodu.test`) with its own token ceiling (200,000 tokens). Discreet entry line on `/login`. Demo account creation is idempotent.

8. **app-settings**: Single-row settings table for app-wide switches (demo mode flag, authorized-domain list). Singleton via `findOrCreateSettings()`.

### Modified Capabilities

None. `openspec/specs/` was empty at start; all eight are new specs.

## Verification & Test Coverage

**Final Run Results** (orchestrator-verified after all remediation):
- `npm run check` → exit 0, clean (no type errors)
- Nine verification suites: 146 total checks
  - `unidad` 11
  - `m1-admin-shell` 11
  - `m2-catalogo` 7
  - `m3-motores` 18
  - `m4-costos` 17
  - `m5-usuarios` 23
  - `m6-acceso` 23
  - `m7-demo` 22
  - `m8-proyectos-ajenos` 14
- Zero failures, zero flakes
- Database left in seed state: four `AiModel` rows (MiniMax M3 as default), one ADMIN user

## Issues & Resolutions

### Critical Issue (RESOLVED)

**Issue**: M2's ai-model-catalog spec required a quiet one-time notice to the teacher when a disabled model causes a project to repoint to the fallback engine. The feature was deferred from M2 to M3 in apply-progress, never picked up by M3, and covered by no task.

**Resolution**: Implemented and tested in **commit be5746b**. The notice reads "Cambiamos el motor de este proyecto porque el anterior ya no está disponible." in the workspace's lower strip. Verification confirmed:
- Notice displays correctly in both light and dark themes
- Notice does not repeat on re-opening (persists the new `aiModelId`, so the triggering condition is false on next load)
- Notice never fires for a brand-new project

**Task**: Task 3.14 added to record the implementation.

### Warning: Documentation Nit (UNRESOLVED; NO CODE CHANGE)

**Issue**: Task 3.1's documentation states the models `GET` route's Prisma select excludes `apiKeyCipher`. In fact, the query selects the full row and `serializarMotor()` strips the field in JavaScript before serialization.

**Status**: Functionally equivalent and verified non-leaking. No code defect — the key is never exposed to the browser. The documentation is inaccurate but the implementation is safe. Recorded as a known documentation nit; no fix applied as part of this change.

### Defects Found and Fixed (Orchestrator-Verified)

After the verify phase completed, the orchestrator independently discovered and fixed five defects that the verification suites missed:

1. **M2 Migration Backfill Bug** (commit `87091e2`):
   - The migration backfill mapped historical turns only by the `ModelChoice` enum, so turns served by MiniMax M2.7 (the fallback engine) were attributed to M3 in reports.
   - Found by seeding a scratch database with historical rows; the agent's verification had tested only against an empty table.
   - Fixed by backfilling based on the actual provider stored in legacy `TokenUsage.provider`.

2. **Categorical Chart Colors** (commit `1371b13`):
   - `GraficoBarras` used `brand-600` and `brand-300` as adjacent categorical colors, which dark mode renders at identical lightness (0.62), merging two series into one block.
   - Legend swatches used `fill-*` CSS on `<span>` elements, which paints nothing.
   - Fixed by switching to a perceptually distinct oklch ramp and using `bg-*` on proper elements.

3. **Form Nesting HTML Error** (commit `3787cdc`):
   - `/app/login.astro` nested a `<form>` inside a `<p>` tag, causing the browser to auto-close the paragraph.
   - Result: `text-center text-xs` classes applied to the paragraph, not the form contents.
   - Fixed by restructuring the template to use semantic HTML.
   - Note: `npm run check` cannot catch this defect — `tsc --noEmit` does not typecheck `.astro` templates.

4. **English Label in Spanish UI** (commit `ef06636`):
   - An English label "default" shipped on the models list, an all-Spanish administrative screen.
   - Layout regression: the models list floated apart into dead horizontal space at the `wide` breakpoint.
   - Fixed by localizing the label and correcting the layout.

5. **e2e Test Token Exhaustion** (commit `2929ac6`):
   - `e2e/m7-demo.ts` exhausted the demo token ceiling (200,000 tokens) against itself across repeated runs (225,000 consumed).
   - Made the test non-idempotent for only 2–3 consecutive runs before the ceiling blocked further executions.
   - Fixed by resetting the demo account's token usage before the test.
   - This was a test infrastructure failure, not a product defect; the ceiling worked as designed.

### Known Open Items (Intentional Deferral, Recorded for Transparency)

1. **Pre-existing Bug, Out of Scope, Untouched**: `pideCambio()`'s `INTERROGATIVA` regex in `src/pages/api/chat/stream.ts` ends alternatives with `\b`. JavaScript's `\b` treats accented letters as non-word characters. So "¿Qué hace este recurso?", "¿Por qué…?", and "¿Para qué…?" are misclassified as change requests, forcing the AI to rewrite the whole resource when the teacher only asked a question. Verified mechanically by orchestrator. Deliberately left out of this change's scope; reported to owner.

2. **No Rate Limiting**: The codebase has no rate-limiting middleware anywhere. The demo account's token ceiling caps token spend only; upload spam and gallery operations from the demo account are bounded only by manual purge after the fact.

3. **Admin USD Figures Are Approximate**: The dashboard shows USD costs marked with `≈`. DeepSeek bills at 2× during two UTC windows (01:00–04:00 and 06:00–10:00) and the catalog stores a single flat rate per model.

4. **Harness Fragility (Not a Product Defect)**: Across repeated full-sequence verification runs on this memory-constrained machine, `m2-catalogo` failed once and `m5-usuarios` failed once, each passing in isolation and on retry. Root cause is Astro `client:load` islands whose SSR HTML is in the DOM before React hydration attaches handlers — a real weakness of the verification harness, not a product defect. A failed run also leaves fixtures behind (e.g., a promoted ADMIN user) until the next successful run cleans up.

5. **Model Prices All NULL in Seed**: The seeded `AiModel` catalog has all pricing fields as NULL. Every USD figure on the dashboard reads "sin precio cargado" (no price loaded) rather than zero. Correct behavior — prices must be entered manually in production. The panel is ready to display them once prices exist.

6. **`.env.example` Control Bytes Removed**: Two stray `0x01` control bytes on lines 25 and 38 that broke `docker compose` were removed as part of this change (M1, preventive).

## Specifications Synced to `openspec/specs/`

All eight delta specs were new (not modifications) and have been copied mechanically to the main specs directory:

| Domain | File | Status |
|--------|------|--------|
| admin-project-access | `openspec/specs/admin-project-access/spec.md` | ✓ Synced |
| admin-users | `openspec/specs/admin-users/spec.md` | ✓ Synced |
| ai-access-control | `openspec/specs/ai-access-control/spec.md` | ✓ Synced |
| ai-cost-accounting | `openspec/specs/ai-cost-accounting/spec.md` | ✓ Synced |
| ai-model-catalog | `openspec/specs/ai-model-catalog/spec.md` | ✓ Synced |
| app-settings | `openspec/specs/app-settings/spec.md` | ✓ Synced |
| demo-mode | `openspec/specs/demo-mode/spec.md` | ✓ Synced |
| request-authorization | `openspec/specs/request-authorization/spec.md` | ✓ Synced |

**Verification**: Each spec copied with `cp`, verified byte-identical with `diff -r`. Empty diffs confirm no truncation or alteration.

## Archive Verification

- **Change folder moved**: `openspec/changes/panel-admin/` → `openspec/changes/archive/2026-09-19-panel-admin/`
- **Source verified gone**: Source directory removed after move
- **Archive byte-identity verified**: `diff -r` snapshot vs. archive = empty (no differences)
- **All artifacts present** in archive:
  - ✓ `proposal.md`
  - ✓ `design.md`
  - ✓ `tasks.md` (100 implementation tasks, all complete: 100/100 ✓)
  - ✓ `apply-progress.md`
  - ✓ `specs/` (8 domains, all copied)

## Implementation Summary

**Commits**: 16 commits on branch `feat/panel-admin`, off `main`  
**Branch Status**: Not pushed, no pull requests  
**Tasks**: 100 implementation tasks, 100 complete (0 stale checkboxes)

**Milestones Delivered**:
| M | Slice | Scope |
|---|-------|-------|
| M1 | Authorization + `/admin` shell | Per-request role, `requireAdmin()`, middleware, nav, `.env.example` byte fix |
| M2 | `AiModel` data model | Table, seeding, key encryption, FK swaps, provider resolution |
| M3 | Models route + teacher selector | Admin CRUD, order, toggle, default, selector UI |
| M4 | Cost accounting + indicator | `TokenUsage` columns, frozen snapshots, per-project cost |
| M5 | Users route + detail | Table, overflow menu, SVG charts, `consumo.astro` absorbed |
| M6 | Access control | `AppSettings`, domains route, per-user override |
| M7 | Demo mode | Toggle, shared account, ceiling, login entry |
| M8 | Cross-owner project access | Admin bypass, banner, attribution |

## Final-State Authority Notes

This archive report reflects the **state of the change at close**, per the SDD Final-State Authority hierarchy:

1. **Critical Issue**: Resolved per orchestrator's explicit final-state facts (commit be5746b). Not inferred from stale snapshots.
2. **Warning**: Recorded as documentation nit only per orchestrator's final-state facts. Not a code defect.
3. **Defects**: Five defects found and fixed by the orchestrator after verify phase; recorded here with commits for traceability.
4. **Test Counts**: 146 checks, all green, on the final run — not copied from earlier snapshots.
5. **Task Completion**: All 100 tasks marked complete in `tasks.md`; no stale checkboxes.

Earlier `verify-report` and `apply-progress` artifacts are intermediate snapshots. Their claims about pending work do not override the final state documented here and corroborated by the commits and test run.

## SDD Cycle Status

**✓ Complete**: The change has been designed, implemented, verified, and archived. All specs are now in the main specification tree. The active changes directory no longer contains this change.

**Ready for**: The next change request or iteration cycle.
