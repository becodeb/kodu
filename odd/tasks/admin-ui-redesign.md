# Admin panel UI redesign

Locator: `odd/tasks/admin-ui-redesign.md` · Engram mirror: `odd/admin-ui-redesign/tasks` (project `kodu`)
Branch: `feat/admin-ui-redesign` (worktree `~/projects/kodu-wt/admin-ui`, DB `koduedu_admin`, port 3200)

## Objective

Make `/admin` intuitive and comfortable: clear navigation, a usage overview with
charts, filterable people and resource lists, and a teacher profile where the
admin sees and acts on that teacher's resources and consumption.

## Problem

- 13 tabs in one horizontal strip (`src/layouts/AdminLayout.astro:53-82`), no grouping, no landing page (`/admin` redirects to `/admin/usuarios`).
- `UsuariosTabla.tsx` has no search, filter or sort.
- Teacher profile (`src/pages/admin/usuarios/[id].astro`) is inline Prisma + two charts; resources are a bare list of links; role/AI access actions live only in the list.
- No platform-wide usage view over time; charts exist only per teacher or per month.

## Scope

In: admin shell/navigation, new overview dashboard at `/admin`, teachers list, teacher profile, resources list, shared header/filter/empty-state pieces applied to the remaining admin pages (visual consistency only), motion.
Out: schema changes, new billing logic, changes to `/api/admin/*` auth contracts, changes outside `/admin` except the admin entry link.

## Constraints

- Design system in `src/styles/global.css` is mandatory: semantic tokens only (`linea`, `lienzo`, `superficie`, `sutil`, `carbon`, `brand-*`, `ink-500/700/900`), no `bg-white`/`bg-slate-*`, radii 10px boxes / 8px controls, Archivo + Archivo Black. Both themes must work.
- No chart library: hand-built SVG, as the existing charts.
- UI copy in Rioplatense Spanish with voseo, matching the app. Code identifiers follow existing repo style.
- Motion: one orchestrated entrance on the overview (chart draw-in, number count-up), responsive feedback on user actions; respect `prefers-reduced-motion`.
- Mobile: usable at 375px (sidebar becomes a drawer, tables become stacked rows).
- `tsc --noEmit` does not check `.astro` templates: verify in a real browser.

## Checks

- TDD: off (no unit test runner in repo; source: repo has none). Runner for checks: `npm run check`, `npm run build`, e2e scripts `npx tsx e2e/<suite>.ts` with `KODU_BASE_URL=http://localhost:3200`.
- Admin e2e suites to keep green: `m1-admin-shell`, `m5-usuarios`, `m8-proyectos-ajenos`, `admin-metricas`, `admin-organizaciones`, `m3-motores`, `m7-demo`.
- Browser screenshots (desktop 1440 + mobile 390, light + dark) reviewed by the parent.

## Delivery

Strategy: `single-pr` style on one feature branch with work-unit commits; merge/push is the owner's decision (owner historically pushes kodu straight to `main`). RDD: off globally (since 2026-09-23).

## Tasks

- [x] T01 Shell: grouped sidebar nav (Resumen · Personas · Contenido · IA · Plata), mobile drawer, shared `EncabezadoAdmin`, motion utilities. Route: delegated (writer trigger: 2+ non-trivial files). Evidence: 35de85e; m1-admin-shell ✔, m5-usuarios ✔.
- [x] T02 Overview `/admin`: platform aggregation (KPIs, 30-day daily tokens/cost, active teachers, top teachers, top engines, latest resources) + hero chart. Route: delegated. Evidence: 2089eb0; parent screenshot review found: chart needs range selector (7/30/90, data sparse), engines list too long (cap 6), top teachers show — without price (show tokens). Fixes folded into T03 batch.
- [x] T03 Teachers list: search, filters (role, AI access, organization, activity), sort, URL-synced state, avatars, row → profile. Route: delegated. Evidence: 2b8deec (T02 fixes), 4be4cd9; m5-usuarios ✔. Parent review: avatar initials take punctuation ("D("), access/USD cells wrap, search placeholder truncated → folded into T05.
- [x] T04 Teacher profile: header with stats, sections Recursos (grid with filters) / Consumo (charts) / Cuenta (role + AI access actions). Route: delegated. Evidence: c590930; m5-usuarios ✔ (navigations moved to ?seccion=consumo). Parent review: coverless cards are oversized grey blocks → folded into T05.
- [ ] T05 Resources list: owner filter, sort, consistent filter bar; apply shared header/filter/empty states to remaining admin pages. Route: delegated.
- [ ] T06 Verification: e2e suites updated and green, browser screenshots both themes and mobile. Route: delegated + parent review.

## Progress

- 2026-10-25: T03–T04 done; check/build clean. `m8-proyectos-ajenos` fails at the owner opening their own project: pre-existing fixture gap (creates the org via `prisma.organization.create`, so no `OrganizationLicense`; billing then denies AI). Branch does not touch billing or project view. Next: T05 + polish + T06.

- 2026-10-25: T01–T02 done. Worktree node_modules symlink pointed at an old branch missing `@anthropic-ai/sdk` and `three` (main needs both); replaced with own `npm ci`. After that `npm run check` clean and `npm run build` complete. Next: T03–T04 + T02 fixes.

- 2026-10-24: mapped the panel (delegated explorer), set up worktree + cloned DB. Next: T01–T02.
