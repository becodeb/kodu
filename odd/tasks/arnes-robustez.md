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
- [ ] T4 — Follow-up: fix keyboard-drag coordinate defect (`kodu.arrastrar`), trim the
  BASE_PROMPT section, run the mock-provider flow check. Route: delegated (same writer).
  - [x] T4.1 — Fix `p.x`/`p.y` on the keyboard path of `kodu.arrastrar` (own accumulator
    from 0 instead of `area`-space coordinates); add `user-select:none`; browser
    assertions in `e2e/navegador-kit.ts`.
  - [x] T4.2 — Trim `## Que funcione de verdad` in BASE_PROMPT (drop intro paragraph,
    mention area coordinates in the `kodu.arrastrar` line); keep `e2e/unidad.ts` green.
  - [x] T4.3 — Mock-provider flow check (`e2e/mock-proveedor.ts` pattern): system prompt
    contains the new section/helper, saved HTML carries the new kit block, legacy block
    gets folded.

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
  - Commit: `73fe193`.

- T4.1 done. Fixed a real defect reported by the user in `kodu.arrastrar`'s
  keyboard path: `p.x`/`p.y` were a private `posTeclado` accumulator
  starting at `(0,0)`, in different units than the pointer path (which
  reports coordinates in `area` space). A model doing
  `punto.setAttribute('cx', p.x)` in `mover` would jump the point to
  `(paso, 0)` on the first `ArrowRight` instead of moving it `paso` units
  from where it was. Fix (`src/lib/ai/kit.ts`, `SCRIPT_KODU`): added
  `centroDeEl()` — the element's CURRENT center (`getBoundingClientRect`)
  converted through the existing `coords()` (same SVG-CTM / bounding-box
  logic as the pointer path) — and `alTecla` now reports
  `x: centro.x + dx, y: centro.y + dy`. Removed `posTeclado`. Also added
  `el.style.userSelect = 'none'` in `arrastrar` setup (mouse drag no longer
  selects text).
  - New browser assertions in `e2e/navegador-kit.ts`: an SVG `<circle
    cx="30" cy="50">` inside a viewBox-scaled `<svg>`, `paso:5`, `mover`
    writes `cx`/`cy` back — first `ArrowRight` → `x≈35` (±0.5), `y≈50`;
    second `ArrowRight` (after the first already moved the circle) → `x≈40`
    (proves no reset-to-accumulator regression). Same shape for an HTML
    `<div>` (`left:40,top:60`, `paso:5`, `mover` writes `style.left/top`
    back) → `x≈57` then `x≈62`. Also asserts `user-select:none` next to the
    existing `touch-action:none` check.
  - Found and fixed a second, unrelated harness bug while writing the HTML
    keyboard test: the new `#area-teclado-html` container was left out of
    the CSS selector that grants `position:relative`, so its
    `position:absolute` child anchored to a distant ancestor instead of its
    own box — first observed as `y≈-1556` instead of `≈72`. Fixed by adding
    it to that selector.
  - Checks: `npm run check` → clean. `npx tsx e2e/unidad-kit.ts` → 41/41
    pass (legacy-block pinned hash unaffected: the keyboard fix only
    touches `SCRIPT_KODU`'s current block, and `legado` never includes
    `SCRIPT_KODU`). `npx tsx e2e/unidad.ts` → 52/52 pass. `npx tsx
    e2e/navegador-kit.ts` → 13/13 pass (11 previous + 2 new), run twice, no
    flakiness, no leftover Chromium process.
  - Commit: `0fff82c`.
- T4.2 done. Trimmed `## Que funcione de verdad` in `src/lib/ai/prompt.ts`:
  dropped the intro paragraph ("Estos son los defectos que más se
  repiten…"); kept all 6 rules and the 4 helper lines. Extended the
  `kodu.arrastrar` helper line to say `mover`/`soltar` receive `x`/`y` in
  `area`'s coordinates (viewBox units for an SVG) — the thing T4.1 fixed on
  the code side now documented on the prompt side too.
  - BASE_PROMPT length: 9792 (`main`) → 11584 (after T3) → 11479 (after
    this trim). Net +1687 chars vs. `main`.
  - `e2e/unidad.ts`'s T3 tests needed no substring changes: both check by
    distinctive marker (`'reiniciar()'`, `'al soltar'`,
    `'kodu.cancelarTemporizadores()'`, `'pointer-events:none'`, `'nunca
    arranca resuelto'`, `'se declaran una sola vez'`, and the 4 helper
    names), none of which lived in the deleted paragraph.
  - Checks: `npm run check` → clean. `npx tsx e2e/unidad.ts` → 52/52 pass
    (both T3 prompt tests still pass unmodified). `npx tsx
    e2e/unidad-kit.ts` → 41/41 pass.
  - Commit: `920201f`.

- T4.3 done. New `e2e/arnes-robustez.ts`, same pattern as
  `e2e/html-fuera-del-system.ts` (dev server on :3000, `kodu_db_dev`,
  seeded admin, shared `kodu-mock-t3` mock provider/model). Sends real
  turns through `/api/chat/stream` against the mock and inspects what the
  mock actually received:
  - **(A)** the system prompt the mock got contains `"## Que funcione de
    verdad"` and `"kodu.arrastrar"`.
  - **(B)** after the turn, `Project.currentHtml` (read via Prisma) contains
    `window.kodu` and `[hidden]{display:none!important}` — the server-side
    `aplicarKitAlTurno` path, not just `aplicarKit` called directly in a
    unit test.
  - **(C)** a second project whose `currentHtml` is seeded (via Prisma)
    with the LEGACY kit block (`bloqueKitLegado('pizarron')`) — a turn sent
    on it makes the mock receive the block PLEGADO (the short placeholder
    comment), not the full block with `tailwind.config` inside, proving
    `bloqueEsCanonico`'s legacy recognition works through
    `buildCurrentResourceBlock` in a real request, not only in
    `unidad-kit.ts`.
  - The dev server on :3000 was **already running** when T4 started
    (PID 3285777, `astro dev --json`, parent PID 1 — left over from a prior
    session, not started by me this task). I reused it after confirming it
    answers `200` on `/` and that it picked up all of T1–T4's source
    changes (proven by the flow check itself passing, since it depends on
    the current `BASE_PROMPT` and kit code). Per the instruction to only
    stop by PID a server I start myself, I did **not** stop it — it wasn't
    mine to stop, and killing another session's server would be presumptuous.
  - Found and fixed one test-harness issue while writing this: the shared
    `kodu-mock-t3` `AiProvider`/`AiModel` lookup (same pattern as
    `html-fuera-del-system.ts`'s `asegurarMotorMock`, a bare `findFirst`)
    picked up a stale row from unrelated past e2e runs in the shared dev DB
    — a provider with `enabled:false` and no API key (`apiKeyCipher: null`)
    under the same `kind`. The turn silently fell back to the platform's
    real default model (MiniMax M3, no key configured in this
    environment) instead of reaching the mock, so `mock.llamadas.length`
    stayed `0`. Not a defect in `arnes-robustez` code — confirmed by
    querying all `AiModel`/`AiProvider` rows directly: multiple leftover
    `kodu-mock-t3` rows exist from other sessions/tasks, several disabled
    or keyless. Fixed by filtering the lookup on
    `enabled: true, apiKeyCipher: { not: null }` (provider) and
    `enabled: true` (model), so it prefers a known-good existing row and
    only creates a fresh one when none qualifies.
  - Checks: `npm run check` → clean. `npx tsx e2e/arnes-robustez.ts` → all
    3 checks (A/B/C) pass, run twice, no flakiness. Mock port 4790 released
    after each run (`mock.detener()` in `finally`); dev server on :3000 left
    running (not mine to stop).
  - Commit: `d9bbd6a`.

- Parent review (after T4): the timer rule pointed at
  `kodu.cancelarTemporizadores()` without saying it only cancels timers made
  with `kodu.despues`/`kodu.cada`; a bare `setTimeout` would survive. The
  helper line now says to use them instead of `setTimeout`/`setInterval`,
  and documents `kodu.cada`. Checks: `npm run check` clean,
  `npx tsx e2e/unidad.ts` all pass.
- Prompt cost: BASE_PROMPT 9776 -> 11450 chars (+1674, backticks unescaped).
  DeepSeek V4.1 Flash measured ~3.37 chars/token on Spanish prose (linear fit
  of `promptTokens` vs prompt length over the 6 prompts of the 2026-09-24
  run, same system prompt), so the addition is ~500 tokens (estimate; the
  code-like fragments tokenize denser). It sits in the cached prefix after
  the first turn. The kit block grows too, but it is folded before reaching
  the prompt, so it adds no prompt tokens.

## Next step

All tasks done; branch not pushed or merged. Measure with DeepSeek in a later
session using the bench in `experimentos/razonamiento/` (branch
`exp/razonamiento-deepseek`), `low` and `high`, 2-3 samples per prompt.
