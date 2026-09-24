# Harness robustness: functional defects in generated resources

## Objective

Generated HTML resources ship without functional defects, by fixing the harness (kit +
BASE_PROMPT), not the model or provider.

## Problem

A blind test of 22 generations with DeepSeek V4.1 Flash (2026-09-24, branch
`exp/razonamiento-deepseek`, `experimentos/razonamiento/RESULTADOS.md`, "Defectos que se
repiten") found six recurring defect classes:

1. Lucide icons: code looks up the `<i>` after `createIcons()` replaced it with `<svg>`
   (froze the osmosis simulation).
2. `hidden` attribute loses against Tailwind's `flex` (end banner visible from the start).
3. Challenges marked done in intermediate drag states and never unmarked.
4. A pending `setTimeout` changes the round while another shot is in flight.
5. A decorative overlay blocks mouse and touch on draggable points.
6. "Reset" leaves part of the old state behind.

Dragging was the interaction that failed most. BASE_PROMPT has design rules only.

## Why

These are harness-level patterns, not model noise: they repeat across topics and
reasoning levels. A kit fix removes a class regardless of the model; a short prompt rule
covers what the kit cannot.

## Scope

- Kit (`src/lib/ai/kit.ts`): global `[hidden]{display:none!important}`; a `window.kodu`
  helper namespace: `kodu.icono` (swap a Lucide icon), `kodu.arrastrar` (pointer + touch +
  keyboard drag), `kodu.despues` / `kodu.cancelarTemporizadores` (cancellable timers,
  defect 4).
- Existing saved resources carry the previous canonical block byte for byte. It must
  still be recognized as canonical so it is upgraded and folded, otherwise old resources
  never get the helpers the prompt tells the model to use.
- BASE_PROMPT (`src/lib/ai/prompt.ts`): a short functional-rules section (6 rules) and
  the helper docs.

## Constraints

- No paid model calls. Flow checks use `e2e/mock-proveedor.ts`.
- Each prompt rule one or two lines, no long examples. Report added tokens.
- No merge to main, no push (push to main deploys).

## Tasks

- [x] T1 — Kit: `[hidden]` CSS, `window.kodu` helpers, legacy canonical block
  recognition; unit tests in `e2e/unidad-kit.ts`. Route: delegated (writer trigger:
  kit + tests + browser harness + prompt are 2+ non-trivial files).
- [x] T2 — Browser verification in real Chromium: mouse drag, touch drag, keyboard
  drag, repeated icon swap, `hidden` + `flex`, timer cancellation. Route: delegated
  (same writer).
- [x] T3 — BASE_PROMPT functional rules + helper docs; tests in `e2e/unidad.ts`; token
  count of the addition. Route: delegated (same writer); token count inline.

## Acceptance criteria

- A kit-applied page hides `[hidden].flex`, exposes the helpers, and each helper works
  in Chromium with mouse, touch and keyboard as applicable.
- A resource saved with the previous kit block is upgraded by `aplicarKit` and folded
  by `plegarKit`.
- BASE_PROMPT contains the six rules and documents every helper.

## Checks

- `npm run check`
- `npx tsx e2e/unidad-kit.ts`, `npx tsx e2e/unidad.ts` (needs `kodu_db_dev`)
- Browser harness (T2)

TDD: off (source: `openspec/config.yaml`, `tdd: false`). Functional checks only.
RDD: off globally by the user since 2026-09-23; no review lifecycle.

## Progress

- Branch `feat/arnes-robustez` created from `main` (98fa485).
- T1 done. `src/lib/ai/kit.ts`: added `[hidden]{display:none!important}` to
  `construirEstiloBase`; added `window.kodu` (`icono`, `arrastrar`, `despues`,
  `cada`, `cancelarTemporizadores`) as a new `SCRIPT_KODU` string constant
  embedded in the canonical block. `construirBloque`/`construirEstiloBase`
  now take `{ legado?: boolean }`; `construirBloque(tema, { legado: true })`
  reproduces the pre-T1 block byte for byte (no `SCRIPT_KODU`, no `[hidden]`
  rule) — precomputed into `BLOQUES_LEGADO_POR_ID`, exposed as
  `bloqueKitLegado(temaId)`. `bloqueEsCanonico` now accepts either the
  current or the legado block as canonical, so `aplicarKit` upgrades an
  existing legacy-block resource to the new block and `plegarKit` still
  folds it.
  - Pinned hash (computed BEFORE this change, against `bloqueKit('pizarron')`
    on `main` @ 98fa485): sha256
    `ac6fd001d31b49cf449f54a288782ec824ae1da1014cda7cecc105e805b64a30` —
    asserted in `e2e/unidad-kit.ts` against `bloqueKitLegado('pizarron')`.
  - Checks: `npm run check` → clean (no errors). `npx tsx e2e/unidad-kit.ts`
    → 41/41 pass. `npx tsx e2e/unidad.ts` (against `kodu_db_dev`, up) →
    50/50 pass. `npx tsx e2e/unidad-revision.ts` (grepped for other files
    pinning kit-block bytes; this one uses `bloqueKit` but not a byte pin,
    no server needed) → 18/18 pass. `e2e/t10-docente-comun.ts` also
    references the block markers but needs a running dev server + browser
    harness — skipped, out of scope for a unit-level check.
  - Commit: `07a0431`.
- T2 done. New `e2e/navegador-kit.ts`: real Chromium (system binary, no
  `playwright install`), one combined test page built with the real
  `aplicarKit` (real CDN Tailwind/Lucide, nothing mocked). 11 assertions:
  `[hidden]` vs `.flex` both ways; repeated icon swap in one tick (incl.
  passing the drawn `<svg>` itself) keeping the author's class and returning
  the final node; mouse drag on an HTML `<div>`; mouse drag on an SVG
  `<circle>` inside a viewBox-scaled `<svg>` (asserts coordinates stay in the
  0–100 viewBox range, not screen pixels); touch drag via real CDP
  `Input.dispatchTouchEvent` (not `.tap()`); keyboard drag (`ArrowRight`/
  `ArrowUp`, asserts no page scroll); a `pointer-events:none` decorative
  layer on top not blocking the drag underneath; `kodu.despues` +
  `kodu.cancelarTemporizadores`; and a final check that zero `pageerror`/
  `console.error` happened across the whole run.
  - Found and fixed one harness bug (not a `kit.ts` defect): the touch and
    overlay test elements sat far enough down the combined test page to
    fall outside the default viewport, so `boundingBox()` returned
    viewport-relative coordinates that didn't hit anything — mouse/touch
    dispatch silently produced zero events. Fixed by calling
    `scrollIntoViewIfNeeded()` before measuring each element's box in
    `cajaDe()`.
  - Checks: `npx tsx e2e/navegador-kit.ts` → 11/11 pass, run twice (no
    flakiness observed). No leftover Chromium process after the run
    (`browser.close()` in a `finally`). `npm run check` → clean.

- T3 done. `src/lib/ai/prompt.ts`: new `## Que funcione de verdad` section in
  `BASE_PROMPT`, placed between "Seguridad y contexto de ejecución" and
  "Calidad pedagógica" — the six functional rules (one `reiniciar()`,
  evaluate on `soltar` not mid-drag, cancel timers on a new action,
  `pointer-events:none` on decorative layers, never start solved, topic
  data declared once) plus one line each for the four `window.kodu` helpers
  and a note that `[hidden]` now always hides. Also extended the existing
  Lucide bullet in "Diseño visual" to point at `kodu.icono` for swapping an
  already-drawn icon.
  - BASE_PROMPT length: 9792 → 11584 chars (+1792 chars). No token count
    invented — chars measured directly with `BASE_PROMPT.length` via a
    regex extract of the template literal, before and after the edit.
  - New tests in `e2e/unidad.ts` (after the T1 "no lleva el HTML actual"
    test): the 6 rules (by distinctive substring each) and the 4 helper
    names all present in `buildSystemPrompt(...)`.
  - Considered the optional mock-provider e2e flow check
    (`e2e/t5-modo-prime.ts`-style, `e2e/mock-proveedor.ts`): needs the dev
    server on :3000 plus seeded admin/teacher accounts and the full browser
    auth flow — skipped as allowed by the task (heavy setup for a flow this
    task didn't change).
  - Checks: `npm run check` → clean. `npx tsx e2e/unidad.ts` → 52/52 pass.
    `npx tsx e2e/unidad-kit.ts` → 41/41 pass. `npx tsx e2e/navegador-kit.ts`
    → 11/11 pass (re-run after the prompt change to confirm the kit itself
    didn't regress).
  - Commit: (recorded after commit below).

## Next step

None — T1/T2/T3 all done. Branch `feat/arnes-robustez` has 3 commits, not
pushed, not merged (per constraints). Next human step: review the diff and
decide push/PR/merge.
