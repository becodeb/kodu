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

- [ ] T1 — Admin tables: make the scroll card a containing block so nothing escapes it.
  Check: `innerWidth === 390` on `/admin`, `/admin/usuarios`, `/admin/proyectos`.
- [ ] T2 — `/p/[slug]`: inject a viewport meta when the stored HTML lacks one.
  Check: `innerWidth === 390` on a public resource without the tag.
- [ ] T3 — Header fits at 360 px for an admin (logo never shrinks). Check: capture.
- [ ] T4 — No zoom on focus: form controls ≥ 16 px on touch screens only.
  Check: computed `font-size` on phone context, unchanged on desktop.
- [ ] T5 — Workspace on a phone: composer visible at 390×664, back link on one line.
  Check: send button's rect inside the viewport.
- [ ] T6 — Minor polish: delete button tap target, model form grids.
- [ ] T7 — Desktop regression: 1280 and 1024 captures equal the baseline
  (byte-identical where the baseline is deterministic, visual review otherwise);
  `npm run check`.

## Route

Delegated direct: one writer for all tasks (2+ non-trivial files; mapping already done
by one explorer). TDD: off — the repo has no unit test runner; checks are
`npm run check` plus Playwright measurements.

## Progress

- Branch `feat/responsive-celulares` created from `main` (a77714e).
