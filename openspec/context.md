# Project Context — kodu

**Initialized**: 2026-09-19
**Persistence mode**: openspec (file-based, in-repo). Engram is unavailable for
this repository (`ambiguous_project`, candidates `["ai-games","ai_router"]`,
neither matches `kodu`) — do not attempt Engram artifact writes for this
project; `openspec/` is the source of truth.

## Product

KoduEdu (npm package `koduedu`): a platform where Argentine schoolteachers
("docentes") build self-contained, single-file HTML didactic resources by
chatting with an AI.

## Stack

- Astro 7 SSR (`output: 'server'`, `@astrojs/node` standalone adapter)
- React 19 islands via `@astrojs/react`
- Prisma 7, `prisma-client` generator (ESM), driver adapter `@prisma/adapter-pg`,
  generated client at `src/generated/prisma`. Datasource URL comes from
  `prisma.config.ts`, not the schema file.
- PostgreSQL 17 (docker compose service `db`, port 5432)
- Tailwind CSS 4, CSS-first (`@theme` / `@utility` in `src/styles/global.css`),
  no `tailwind.config` file
- TypeScript 7, zod 4, jose (JWT)

## Architecture conventions

- API responses via `src/lib/http.ts`: `ok(data)` → `{ ok: true, ...data }` at
  HTTP 200; `fail(message, status, extra)` → `{ ok: false, error, ...extra }`.
  Validation is zod `safeParse`, returning 422 with `parsed.error.issues[0]?.message`.
- Client calls go through `apiRequest<T>()` in `src/lib/client/api.ts`, which
  returns a discriminated `ApiResult<T>` and never throws.
- Migrations are hand-written (not `prisma migrate dev` generated in CI):
  `prisma/migrations/<YYYYMMDD>000000_<nombre_en_espanol>/migration.sql`, each
  opening with a Spanish comment block explaining the WHY before any SQL.
- Design system in `src/styles/global.css` is bespoke and strictly followed:
  semantic tokens `linea`, `lienzo`, `superficie`, `sutil`, `carbon`; brand
  ramp in oklch anchored to logo blue `#3b2ce7`; ink grays `ink-500/700/900`;
  fonts Archivo and Archivo Black; radii 10px (boxes) / 8px (controls);
  utilities `kodu-card`, `kodu-input`, `kodu-label`, `kodu-btn`,
  `kodu-btn-primary`, `kodu-btn-carbon`, `kodu-btn-ghost`. `bg-white` and
  `bg-slate-*` are forbidden and must never appear in components. Dark mode
  redefines the same variables under `[data-theme='dark']`.

## Language / copy convention

All user-facing copy and all code comments are Argentine Spanish with voseo.
Prisma fields and React props are English; newer internal helpers and locals
are Spanish.

Domain vocabulary is Spanish, and each term is already taken. Do not reuse one
for a new concept — check this list before naming anything user-facing:

| Term | Means, in this app |
|---|---|
| docente | a teacher; the ordinary (non-admin) user role |
| recurso | a project: one self-contained HTML didactic resource |
| motor | an AI engine/model the resource is generated with |
| hilo | a chat thread inside a resource |
| regla | a prompt rule injected into the AI context, global or per-teacher |
| galería | the public showcase of published resources |
| consumo | token consumption |
| ficha | a resource's title-and-description card, and its workspace tab (`FichaDialog.tsx`, `PreviewPanel.tsx`) — **not** a unit of anything |
| tope | a usage ceiling, in tokens |

## Testing capabilities

**Strict TDD Mode**: disabled
**Detected**: 2026-09-19

### Test Runner

- No test runner and no test files exist (`*.test.*` / `*.spec.*`, `tests/`,
  `e2e/`, `__tests__/` — none found). `package.json` has no `test` script.
- Primary gate: `npm run check` → `tsc --noEmit` (currently passes clean).

### Test Layers

| Layer       | Available | Tool                                             |
| ----------- | --------- | ------------------------------------------------- |
| Unit        | ❌        | —                                                   |
| Integration | ❌        | —                                                   |
| E2E         | ⚠️ (capability only, no harness) | Playwright ^1.62.1 (devDependency, used by the screenshot endpoint) |

### Coverage

- Available: ❌
- Command: —

### Quality Tools

| Tool         | Available | Command          |
| ------------ | --------- | ----------------- |
| Linter       | ❌        | — (no eslint config in repo) |
| Type checker | ✅        | `npm run check` (`tsc --noEmit`) |
| Formatter    | ❌        | — (no prettier config in repo) |

### Other commands

- `npm run dev` — astro dev, port 3000
- `npm run build` — `prisma generate && astro build`
- `npm run db:migrate` / `npm run db:deploy` / `npm run db:seed`

## Environment state (already set up)

- Dependencies installed; `.env` created from `.env.example` with a real
  `AUTH_SECRET`.
- Postgres running via `docker compose up -d db` on port 5432; all 7 existing
  migrations applied; seed has run (admin user + 5 global rules).
- Dev server confirmed responding 200 on `http://localhost:3000`.

## SDD phase guidance derived from the above

- No test runner exists, so `strict_tdd: false`. Any change touching UI or the
  AI resource-generation flow should include a manual or Playwright-based
  verification step in its tasks, since `npm run check` alone only proves
  types, not behavior.
- Treat design-system token/utility rules and the Spanish-voseo copy
  convention as hard constraints during `sdd-apply` — they are enforced by
  convention, not by lint.
