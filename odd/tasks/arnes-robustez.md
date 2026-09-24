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

- [ ] T1 — Kit: `[hidden]` CSS, `window.kodu` helpers, legacy canonical block
  recognition; unit tests in `e2e/unidad-kit.ts`. Route: delegated (writer trigger:
  kit + tests + browser harness + prompt are 2+ non-trivial files).
- [ ] T2 — Browser verification in real Chromium: mouse drag, touch drag, keyboard
  drag, repeated icon swap, `hidden` + `flex`, timer cancellation. Route: delegated
  (same writer).
- [ ] T3 — BASE_PROMPT functional rules + helper docs; tests in `e2e/unidad.ts`; token
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

## Next step

T1.
