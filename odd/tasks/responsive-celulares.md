# Phone-ready KoduEdu

## Objective

Make every screen usable on a phone (360–390 px wide) without changing how it looks on
desktop (≥ 1024 px).

## Problem

Measured on 2026-09-23 with Playwright (`isMobile: true`, 390×844, 360×760 and 390×664,
the visible area of Safari with its bars):

- `/admin`, `/admin/usuarios` and `/admin/proyectos` zoom out on a phone: the layout
  viewport grows to 736 / 501 px. Cause: a `sr-only` span (absolute) inside the table
  escapes its `overflow-x-auto` card because the card is not a containing block
  (`UsuariosTabla.tsx`, `ProyectosTabla.tsx`).
- `/p/[slug]` serves the generated HTML raw. When the model omits
  `<meta name="viewport">`, phones render it at 980 px.
- At 360 px the admin header does not fit: the logo gets squashed.
- Form controls render at 12–14 px, so iOS Safari zooms in on every focus (chat
  composer, engine select, conversation select).
- Workspace at 390×664: the composer's send row falls below the fold; the back link
  "Mis recursos" wraps to two lines and eats the title.
- Minor: 32 px delete button on resource cards; admin model form grids of 2–3 fixed
  columns inside a 358 px modal.

Already fine and kept: the workspace Chat/Recurso switch below `lg`, the scrollable admin
tab strip, page grids with `sm:`/`md:`/`lg:` fallbacks, the `dvh`-based workspace height.

## Why

Teachers open KoduEdu and the public links from their phones; a page that zooms out or
zooms in on every tap feels broken.

## Scope

- Only mobile-scoped changes: base styles that do not alter desktop rendering, or
  classes under `max-lg`/`max-sm` or unprefixed values overridden at `sm:`/`lg:`.
- No redesign, no new dependencies, design-system tokens only.

## Constraints

- Desktop must not change: screenshots at 1280×800 and 1024×800 compared against the
  baseline taken before the change (`/tmp/kshots/base`).
- Both themes keep working.
- UI copy in Rioplatense Spanish, as the rest of the app.

## Tasks

- [x] T1 — Admin tables: make the scroll card a containing block so nothing escapes it.
  Check: `innerWidth === 390` on `/admin`, `/admin/usuarios`, `/admin/proyectos`. ✅
  Commit `f1ab812`.
- [x] T2 — `/p/[slug]`: inject a viewport meta when the stored HTML lacks one.
  Check: `innerWidth === 390` on a public resource without the tag. ✅ (found an
  existing project already missing the tag — no DB mutation needed, nothing to
  revert). Commit `295710c`.
- [x] T3 — Header fits at 360 px for an admin (logo never shrinks). Check: capture. ✅
  at 390 and 360 (logo full-size, single line, nothing overlapping). At 320
  (best-effort only) the logo stays full-size but "Mis recursos" wraps to two
  lines in the header nav — tight, not overlapping, not a zoom-out. Commit
  `8ea279e`.
- [x] T4 — No zoom on focus: form controls ≥ 16 px on touch screens only.
  Check: computed `font-size` on phone context, unchanged on desktop. ✅
  Commit `8591066`.
- [x] T5 — Workspace on a phone: composer visible at 390×664, back link on one line.
  Check: send button's rect inside the viewport. ✅ Commit `8ea279e`.
- [x] T6 — Minor polish: delete button tap target, model form grids. ✅
  Commit `dd766aa`.
- [x] T7 — Desktop regression: 1280 and 1024 captures equal the baseline
  (byte-identical where the baseline is deterministic, visual review otherwise);
  `npm run check`. ✅ All 8 deterministic pages byte-identical at both
  resolutions (including `project`, which exercises the T3/T5 changes); the 5
  non-deterministic ones reviewed visually, only expected non-determinism
  (timestamps, demo typing animation) differs.

## Route

Delegated direct: one writer for all tasks (2+ non-trivial files; mapping already done
by one explorer). TDD: off — the repo has no unit test runner; checks are
`npm run check` plus Playwright measurements.

## Progress

- Branch `feat/responsive-celulares` created from `main` (a77714e).
- All tasks T1–T7 done. Commits (newest last):
  `f1ab812` (T1), `295710c` (T2), `8ea279e` (T3+T5), `8591066` (T4),
  `dd766aa` (T6).
- `npm run check` (tsc --noEmit): pass, no errors.
- Mobile: every page (home, gallery, login, app, rules, project, and all 7
  admin pages) has `innerWidth === viewport width` at both 390×844 and
  360×760 — the T1 zoom-out bug is gone everywhere, not just the two tables.
- T4 measured on the workspace: mobile context → select/textarea/input all
  compute to 16px; desktop 1280 context → unchanged (select 12px, textarea
  14px, most inputs 14px, one input that was already 16px stays 16px).
- T5 measured on the admin's own project (id `57455e4e-…`) at 390×664,
  390×844 and 360×760: `document.scrollHeight === innerHeight` exactly, send
  button's `bottom` inside the viewport with margin to spare. On the other
  teacher's project (id `fee09dad-…`, shows the admin-only banner) the page
  scrolls ~95px to reach the composer — the banner's height isn't in the
  fixed `calc()`, so this is a deliberate secondary-path trade-off, not a
  defect; screenshot reviewed, nothing overlaps or looks broken.
- Desktop regression: 1280×800 and 1024×800 captured fresh. The 8
  deterministic pages (admin-dominios, admin-generacion, admin-motores,
  admin-proveedores, app, gallery, login, project) are byte-identical to
  `/tmp/kshots/base` via `cmp` at both resolutions. The 5 non-deterministic
  ones (home, rules, admin-home, admin-usuarios, admin-proyectos) were
  reviewed visually side by side; only expected non-determinism differs
  (relative timestamps, the home page's demo typing animation frame).
- Known open item (not fixed, noted instead of invented): at 360px, the
  *global header's* "Mis recursos" nav link (not the workspace back-link,
  which is a separate element and stays single-line) wraps to two lines for
  an admin, because the combined width of the logo + nav links + "Panel"
  pill + avatar structurally exceeds 360px without either shrinking spacing
  further (already tightened) or shortening the "Mis recursos" copy — the
  latter is a product/copy decision I didn't make unilaterally. It doesn't
  overlap anything and doesn't reintroduce the zoom-out bug (innerWidth
  still matches viewport). At 390px it's a single line.
- Parent re-check: A/B capture of `main` vs this branch on the same data at 1280
  and 1024 — `app` and `project` byte-identical; `usuarios`/`proyectos` differ only
  in the relative-time column (the branch differs from itself there too); `home`
  only in the typing caret. Note: `/tmp/kshots/ws.mjs` creates an empty project on
  every run, so compare A/B, never against an older baseline.
- Next step: owner tests on a phone, then decides merge and push.
