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

## Round 2 (2026-09-24)

### Problem

The blind round-2 evaluation (branch `exp/medicion-arnes`,
`experimentos/razonamiento/RESULTADOS-arnes.md` and `resultados/ronda2-puntajes.json`)
confirmed the round-1 gains but found a regression and new defect classes:

- `kodu.arrastrar` misused three ways in D3 (6 -> 4 and 2): `mover(p)` treated as a
  number (value became `NaN`); an extra resource `keydown` on top of the helper's (every
  arrow moved twice); a keyboard step in pixels too small to change a rounded value.
- Stacked draggable points: the wrong one moves.
- Stale Lucide references. Root cause verified in lucide@1.47.0 `createIcons`: it
  replaces EVERY `[data-lucide]` under `root`, including `<svg>`s it already drew, and
  the kit calls it over the whole document on each new icon; initial icons are drawn on
  `DOMContentLoaded`, after the resource's inline script already grabbed the `<i>`.
- Confetti that keeps falling after a reset, or fires with 0 correct answers.
- The correct option always in the same position.
- Reset that does not restore controls, messages or the prediction screen; stale
  message from the previous attempt; initial counters/labels out of sync; controls below
  the fold; ordered challenges solvable out of order.
- Round-1 rule 2 ("a challenge can go back to pending") led to live re-evaluation of
  achievements, so with two bars the three challenges were never solved together.

### Constraints (round 2)

- Prefer misuse-proof helpers over more rules; one line per new rule.
- BASE_PROMPT grows at most ~300 tokens over round 1 (11450 chars; estimate with the
  3.37 chars/token fit above). Measure and report.
- The kit block of `main` (pre-T1) stays recognized as canonical (pinned hash). The
  round-1 block never shipped (branch unmerged), so it is not kept as legacy.
- No paid model calls; browser tests in real Chromium; `npm run check` clean; no merge,
  no push.

### Tasks

- [x] T5 — Icons: draw `<i data-lucide>` synchronously in the observer (before the next
  inline script runs) and never re-replace drawn `<svg>`s; `kodu.icono` only swaps its
  own icon; legacy `SCRIPT_ICONOS` kept verbatim for the legacy block. Browser + unit
  tests. Route: delegated (writer trigger: kit + two test files).
- [x] T6 — `kodu.arrastrar`: unit mode (`eje`, `min`, `max`, `paso`, `valor`,
  `alCambiar`, `alSoltar`, keyboard in problem units, ARIA slider); low-level mode kept
  with a numeric safety net; helper owns arrow keys; nearest-to-pointer among
  overlapping draggables; drag survives a re-render. Browser + unit tests. Route:
  delegated (same writer).
- [x] T7 — `kodu.festejar` (lazy canvas-confetti, cut by
  `kodu.cancelarTemporizadores()`, also before the library loads) and `kodu.mezclar`
  (new array, never the identical order). Browser + unit tests. Route: delegated (same
  writer).
- [x] T8 — BASE_PROMPT: rewrite rules 1-2 (initial state, achievement vs condition),
  new one-line rules, helper docs with the drag example; token count; `e2e/unidad.ts`;
  mock flow check `e2e/arnes-robustez.ts`. Route: inline (one file with exact text
  designed by the parent, plus a small test update).

### Acceptance criteria (round 2)

- Unit-mode drag works with mouse, touch and keyboard and reports values in problem
  units, snapped to `paso`; a resource-level `keydown` on the document does not double
  the move.
- With two overlapping draggables, the one nearest to the pointer moves.
- An inline script right after the markup finds the drawn `<svg>`; adding icons later
  does not replace icons already drawn.
- `kodu.cancelarTemporizadores()` stops confetti, including a festejo requested before
  canvas-confetti finished loading.
- `kodu.mezclar` returns a new array with the same items in a different order.
- A resource saved with the `main` kit block is still upgraded and folded.

### Round 2 Progress

- T5 done. Verified in lucide@1.47.0's own source (`createIcons`/`replaceElement`,
  downloaded from jsdelivr and read directly): `createIcons({root})` with the default
  `nameAttr` queries `root.querySelectorAll('[data-lucide]')`, which matches an
  already-drawn `<svg data-lucide>` exactly like an undrawn `<i data-lucide>` — so any
  new icon anywhere retriggered a full redraw that replaced every icon already on the
  page with a fresh node.
  - `src/lib/ai/kit.ts`: `SCRIPT_ICONOS` now defines `dibujarIconos(root)`, exposed as a
    private global `window.__koduDibujarIconos` (not part of the public `window.kodu`
    API — `SCRIPT_ICONOS` loads before `SCRIPT_KODU` in the block, so a shared global is
    the only way for `SCRIPT_KODU` to reuse it). It marks each pending `i[data-lucide]`
    with a temporary `data-kodu-dibujar` attribute (same value as `data-lucide`), calls
    `lucide.createIcons({ nameAttr: 'data-kodu-dibujar', root })` so only those elements
    are touched (an already-drawn `<svg>` never carries the temp attribute), then strips
    the temp attribute from the resulting `<svg>`s.
  - The `MutationObserver` callback now calls `dibujarIconos(document)` directly instead
    of debouncing through `requestAnimationFrame`: a `MutationObserver` callback runs as
    a microtask, and the HTML parser does a microtask checkpoint before executing an
    inline `<script>` that follows markup, so an icon drawn by the observer is already an
    `<svg>` by the time a resource's own inline script looks it up — the previous rAF
    deferral missed that window.
  - `kodu.icono(el, nombre)` now calls `window.__koduDibujarIconos(contenedor)` instead
    of `lucide.createIcons({root: contenedor})` directly: before, that default-nameAttr
    call inside a container with more than one icon also re-replaced an already-drawn
    sibling icon (the same class of bug, just container-scoped) — this was a real,
    previously-untested defect in the T1 implementation, not only a round-2 regression.
  - The old `SCRIPT_ICONOS` text is preserved byte for byte as `SCRIPT_ICONOS_LEGADO`,
    used only when `construirBloque(tema, { legado: true })`; the pinned-hash test
    against `bloqueKitLegado('pizarron')` needed no change and still passes.
  - New unit tests in `e2e/unidad-kit.ts`: current block has no `requestAnimationFrame`
    and does expose `window.__koduDibujarIconos`; legacy block keeps `requestAnimationFrame`
    and never mentions `__koduDibujarIconos`.
  - New browser tests in `e2e/navegador-kit.ts`: (a) an inline script right after
    `<i data-lucide>` markup already finds the drawn `<svg>`; (b) drawing a new icon
    anywhere else does not disconnect a reference to a previously-drawn `<svg>`; (c)
    `kodu.icono` on one of two icons in the same container leaves the sibling connected,
    unchanged, and still the same node.
  - Checks: `npm run check` → clean. `npx tsx e2e/unidad-kit.ts` → 44/44 pass (pinned
    hash unmodified). `npx tsx e2e/navegador-kit.ts` → 16/16 pass, run three times total
    (once during development, twice more after), no flakiness, no leftover Chromium
    process.
  - Commit: `c3c8f96`.

- T6 done. `src/lib/ai/kit.ts`, `arrastrar()` rewritten with two selectable modes and a
  shared drag registry, all inside the same `SCRIPT_KODU` ES5 string:
  - **Modo unidad** (`opciones.alCambiar` is a function, or `min`/`max` present):
    `arrastrar(el, { area, eje, min, max, paso, valor, alCambiar, alSoltar })`. Value math
    is relative from `Number(valor())` captured at `pointerdown` (falls back to the
    absolute value under the pointer only when `valor` is missing/non-finite) — no jump
    on grab. Snap formula exactly as specified (`min + round((v-min)/paso)*paso`,
    clamped, then rounded to `paso`'s own decimal count via `redondearA`/`decimalesDe`
    to kill float noise). `alCambiar` fires only when the snapped value changes from the
    last emitted one; `alSoltar` fires exactly once per action (pointerup/cancel, or
    after each key press). Keyboard: ArrowRight/Up = +paso, ArrowLeft/Down = -paso,
    Home/End = min/max, all clamped. ARIA (`role="slider"` unless already set,
    `aria-valuemin/max/now`) applied at setup and kept in sync.
  - **Modo bajo nivel** (`mover`/`soltar`, `p.x/p.y` in `area` coordinates, T4's SVG-CTM
    path unchanged) kept as-is, plus a safety net: `crearPuntoDrag` gives every point a
    `valueOf` returning `p.x`, so a misused `mover: function (x) { ... }` that treats the
    whole point as a number still gets the area x in any numeric context.
  - **Keyboard ownership**: `alTecla` is registered on `el` with `capture: true` and
    calls `stopImmediatePropagation()` for every key it handles, in both modes — a
    same-element `keydown` added by the resource AFTER `kodu.arrastrar()`, or a
    `document`-level bubble-phase `keydown`, no longer double-fires the move.
  - **Nearest-to-pointer among overlapping draggables**: every `arrastrar()` call
    registers `{el, iniciar}` in a module-level `registroArrastre` array (entries with
    `el.isConnected === false` are skipped, and the returned cleanup function removes
    the entry). ONE `document`-level `pointerdown` listener in the capture phase (added
    once, outside `arrastrar()`) picks, among registered connected elements whose
    `getBoundingClientRect()` contains the pointer, the one with the nearest rect
    center (ties broken by `el.contains(evento.target)`), then calls that single
    winner's `iniciar(evento)` — so a click on stacked draggables starts exactly one
    drag, regardless of DOM nesting, paint order, or z-index.
  - **Survives a re-render**: `pointermove`/`pointerup`/`pointercancel` are attached to
    `window` (not `el`) only while a drag is active, added in `iniciarArrastre` and
    removed in `terminarArrastre` — filtered by `pointerId`, not by which element is
    `evento.target`. `setPointerCapture` stays best-effort (wrapped in try/catch); the
    old `lostpointercapture` → end-drag wiring was removed entirely, so losing capture
    (e.g. because the dragged element was replaced) can no longer end the drag on its
    own. If a resource replaces `el` with a clone mid-drag (from inside `alCambiar`) and
    re-registers the clone, the ORIGINAL closure's window listeners keep delivering
    events to the ORIGINAL callbacks until release — proven by a dedicated browser test.
  - Every existing round-1/T4 browser and unit test for `kodu.arrastrar` still passes
    unmodified — confirmed no behavior change to low-level mode's coordinate math, SVG
    CTM handling, or shift-key multiplier.
  - New browser tests in `e2e/navegador-kit.ts` (12 new, one per bullet of the round-2
    acceptance criteria): unit-mode mouse (no jump on grab, snap, no consecutive
    repeats, single `alSoltar`), unit-mode real touch (CDP), decimal `paso` (no float
    noise), `eje:'y'` (drag up increases), unit-mode keyboard (ArrowRight/Home/End, ARIA,
    both keyboard-ownership scenarios), two overlapping SVG circles (nearer center
    wins over the one painted on top), re-render mid-drag (keeps emitting until
    release), and low-level mode's `valueOf` safety net.
  - New unit tests in `e2e/unidad-kit.ts`: presence of the unit-mode branch/ARIA
    attributes, capture-phase keyboard registration + `stopImmediatePropagation`, the
    shared registry/nearest-selection functions, `window`-level move/up/cancel listeners
    with no `lostpointercapture` listener, and `crearPuntoDrag`.
  - Checks: `npm run check` → clean. `npx tsx e2e/unidad-kit.ts` → 49/49 pass (pinned
    hash unaffected — `arrastrar()` isn't part of the legacy block).
    `npx tsx e2e/navegador-kit.ts` → 24/24 pass, run three times total, no flakiness, no
    leftover Chromium process.
  - Commit: `2db95e3`.
  - **Post-review correction**: parent review found `elegirArrastrable` picked drag
    candidates by `getBoundingClientRect` containment only, regardless of what the
    pointer actually hit. Two real consequences: a `<button>`/input/link geometrically
    inside a draggable's bbox (but not a DOM descendant of it) started a drag instead of
    letting the click through, and `setPointerCapture` then diverted `pointerup` so the
    control's click never fired at all; a draggable with a large bbox (a diagonal line, a
    `<g>`, a wide bar) started a drag from pressing empty space inside that bbox, away
    from its actual rendered shape. Fixed by switching the candidate filter to
    `document.elementsFromPoint(clientX, clientY)` — a real hit test, shape-accurate for
    SVG, already skips `pointer-events:none` on its own, and returns the WHOLE element
    stack at that point (not just the topmost), so a draggable underneath a label lacking
    `pointer-events:none` is still found. Nearest-rect-center-wins and the
    `evento.target`-containment tie-break are unchanged. Added a second, independent
    guard in the `pointerdown` dispatcher: if the actually-hit element
    (`evento.target.closest('button, a[href], input, select, textarea, label,
    [contenteditable]')`) is an interactive control that is NOT contained by any
    registered draggable, no drag starts at all — the control's normal click/focus
    behavior is left completely untouched.
    - The existing "dos arrastrables superpuestos" test needed NO geometry change: its
      grab point (circulo-chico's own center, viewBox 75,35) is already inside the real
      circular shape of BOTH circles (distance to circulo-grande's center ≈29.2, under
      its radius 40), not just their bboxes — confirmed by re-running it unmodified
      against the new hit-test code, still green. Added a code comment recording this so
      it's not re-derived next time.
    - New browser tests in `e2e/navegador-kit.ts`: a real `<button>` positioned inside a
      diagonal `<line>`'s bbox (off the stroke) keeps its `click` (fires exactly once) and
      starts no drag; pressing empty space inside that same line's bbox, off the stroke
      and away from the button, starts no drag; a plain `<div>` label (no
      `pointer-events:none`) fully covering a draggable point does not block dragging the
      point underneath it.
    - Checks: `npm run check` → clean. `npx tsx e2e/unidad-kit.ts` → 53/53 pass (unchanged
      — this correction only touched `arrastrar()`'s dispatcher, no new unit-testable
      surface). `npx tsx e2e/navegador-kit.ts` → 31/31 pass (28 previous + 3 new), run
      three times total, no flakiness, no leftover Chromium process.
    - Commit: `6130055`.

- T7 done. `src/lib/ai/kit.ts`, `SCRIPT_KODU` gets two more helpers:
  - `festejar(opciones)`: if `window.confetti` already exists, fires immediately
    (`window.confetti(finales)`, `finales` = a plain-object merge of a sensible default —
    `particleCount: 120, spread: 70, origin: {y: 0.6}, disableForReducedMotion: true` —
    with the caller's `opciones`). Otherwise queues `{opciones, generacion}` and lazily
    injects exactly ONE `<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.4/dist/confetti.browser.min.js">`
    (1.9.4 is npm's current `latest` tag, verified against the npm registry and
    confirmed the exact jsdelivr URL resolves with `curl -I`); `onload` drains the
    pending queue, `onerror` clears it — nothing throws if the CDN is unreachable.
  - `cancelarTemporizadores()` now also: increments a module-level `confettiGeneracion`
    counter (so any `festejar()` queued before the increment, whose entry carries the
    OLD generation, is skipped forever when the script eventually loads and drains the
    queue) and calls `window.confetti.reset()` when the library is already loaded (stops
    whatever's currently animating).
  - `mezclar(lista)`: Fisher-Yates over a copy (`lista.slice()` for real arrays,
    `Array.prototype.slice.call(lista)` wrapped in try/catch — falling back to `[]` — for
    anything array-like or not), so the input is never mutated. If the shuffle happens to
    land on the exact input order and `length >= 2`, forces one swap of index 0 with a
    random other index.
  - Both added to `window.kodu`; the big doc comment above `SCRIPT_KODU` gets two new
    bullets. `bloqueKit`'s "define window.kodu" unit test updated from four to the
    current six helper names (`icono`, `arrastrar`, `despues`, `cada`,
    `cancelarTemporizadores`, `festejar`, `mezclar` — `cada` was already there but wasn't
    in that specific test's list before).
  - Real-library gotcha found while writing the browser tests: the exported
    `confetti(opciones)` shorthand (what `kodu.festejar` calls) always uses ONE lazily-
    created, cached, Worker + OffscreenCanvas-backed default instance
    (`R(){return y||(y=A(null,{useWorker:!0,resize:!0}))}` in
    `confetti.browser.min.js@1.9.4`) — `useWorker` is hardcoded `true` at that instance's
    first-ever creation and can't be overridden per call. Once the canvas has
    `transferControlToOffscreen()`'d itself to the worker, `canvas.getContext('2d')` from
    the test throws `InvalidStateError`, so pixel-content assertions are impossible
    against the real ambient API. Verified instead via DOM presence: the library
    synchronously creates and `document.body.appendChild`s its own `<canvas>` on first
    fire (confirmed by reading the minified source directly, `b(a)` in the same file) and
    removes it on natural completion or on `reset()` — so "a `<canvas>` with non-zero
    width/height exists" / "is absent" is the correct, real observable signal.
  - New browser tests in `e2e/navegador-kit.ts` (order matters — the "cancelled before
    load" case has to run before ANY other `festejar()` call, since `window.confetti`
    stays loaded for the rest of the page once fetched): festejar()+cancelarTemporizadores()
    called synchronously before the script has loaded, then waiting for load plus 500ms,
    never produces a canvas; festejar() alone produces one; festejar() then
    cancelarTemporizadores() mid-animation removes it; mezclar() over 200 runs of a
    4-item array keeps the same multiset, never mutates the input, never repeats the
    identical order, and the original first item visits all 4 positions; `null`/`42`
    inputs return an array without throwing.
  - New unit tests in `e2e/unidad-kit.ts`: the pinned CDN URL text, the generation-counter
    and `reset()` calls, and the `mismoOrden` guard, all present in `bloqueKit` for every
    theme.
  - Checks: `npm run check` → clean. `npx tsx e2e/unidad-kit.ts` → 53/53 pass (pinned hash
    unaffected). `npx tsx e2e/navegador-kit.ts` → 28/28 pass, run three times total, no
    flakiness, no leftover Chromium process. `npx tsx e2e/unidad.ts` (against the running
    `kodu_db_dev`, already up) → 52/52 pass — confirms no regression from the kit.ts
    changes on the server-side flow (this task didn't touch `prompt.ts` or `unidad.ts`).
  - Commit: `83f12a4`.

- T8 done (parent, inline). `src/lib/ai/prompt.ts`: the "Que funcione de verdad"
  section now has 10 one-line rules: `ESTADO_INICIAL` + one `reiniciar()` that also
  restores controls, messages, counters, screens and festejos; LOGRO (kept until reset)
  vs CONDICIÓN (re-evaluated), evaluated when the action ends; a new action cancels
  timers and clears the previous message; overlays `pointer-events:none`; first frame
  fully synced; theme data declared once; `kodu.mezclar` + match the correct option by
  value; `kodu.festejar()` only for a real achievement; controls visible at 1280×800
  and 820×1180; ordered challenges unlock in order. Helper docs: `window.kodu` always
  exists (no fallbacks); `kodu.arrastrar` already handles mouse, touch and keyboard (no
  own `pointerdown`/`keydown`), a 4-line unit-mode example, low-level mode says `p` is
  an object (`p.x`, `p.y`). The icon bullet says to keep the container, never the
  `<i>`/`<svg>`, and swap with `kodu.icono(contenedor, …)`. The Extras line drops
  "canvas-confetti" in favor of `kodu.festejar()`.
  - Prompt cost: BASE_PROMPT 11450 -> 11932 chars (+482). At the 3.37 chars/token fit
    that is ~145 tokens; even at a pessimistic 2.5 chars/token for the code-like lines
    it stays under ~200. Budget was ~300.
  - Tests: `e2e/unidad.ts` +2 (round-2 rule markers, drag/festejo docs; asserts the old
    "puede volver a pendiente" rule and "canvas-confetti" are gone). `e2e/arnes-robustez.ts`
    (A) now also requires the unit-mode example and `kodu.mezclar(`, (B) requires the
    round-2 kit (`festejar`, `__koduDibujarIconos`) in the saved HTML.
  - Checks: `npm run check` → clean. `npx tsx e2e/unidad.ts` → 54/54 pass.
    `npx tsx e2e/arnes-robustez.ts` (dev server on :3000 from this checkout, mock
    provider) → A/B/C pass, run twice.
  - Commit: `901746d`.

## Round 3 (2026-09-24): small kit/prompt fixes + automatic self-test with auto-correction

Source: `exp/medicion-arnes:experimentos/razonamiento/RESULTADOS-arnes.md` ("Ronda 3") and
`resultados/ronda3-puntajes.json`. Remaining defects: unit-mode drag updates the value but not
the point; `textContent` with HTML; hover hiding the state color; 34 px touch targets; chocolate
bars drawn in theme colors; Revolución de Mayo never branches. Most remaining defects would be
caught by an automatic test, so round 3 adds one that runs inside the sandboxed iframe.

Constraints: no paid calls (mock provider only), `npm run check` clean, work-unit commits, no
merge, no push. Prompt growth for Part A ≤ ~150 tokens.

- [x] T9 — Kit: unit-mode `kodu.arrastrar` positions the element along `eje` inside `area`
  from `min`/`max` (opt-out option for resources that draw themselves); 44 px minimum
  invisible hit area on draggables, keeping "nearest wins". Browser tests in
  `e2e/navegador-kit.ts`. Route: delegated (writer trigger: kit + prompt + tests).
- [x] T10 — BASE_PROMPT: theme colors are for the UI, content objects use what the teacher
  asked for; `textContent` only for text; state styles beat hover; "tomar decisiones" means
  branching. ≤ ~150 tokens; `e2e/unidad.ts`. Route: delegated (same writer as T9).
- [x] T11 — Kit: sentinel (onerror, unhandledrejection, console.error -> postMessage to parent)
  and self-test triggered by `kodu:autoprueba` (snapshot, move ranges, click up to N buttons,
  reset, compare). Browser tests against a healthy HTML, one that throws on click, one with a
  partial reset. Route: delegated (writer trigger).
- [x] T12 — Editor: after a generation that changed the resource, run the self-test in a hidden
  sandboxed iframe; on JS errors or a failed reset send one correction turn (reasoning `low`,
  max 2 rounds) with the exact detail; status copy for the teacher; the turn is not recorded as
  written by the teacher; after 2 failed rounds show the resource with a discreet warning.
  Route: delegated (writer trigger: stream API + workspace UI + history).
- [x] T13 — Mock provider that returns broken HTML first and a healthy one on correction; e2e of
  the full cycle in real Chromium. Route: delegated (same writer as T12).

### Round 3 Progress

- T9 done. `src/lib/ai/kit.ts`, `arrastrar()`'s modo unidad:
  - **Posiciona el propio elemento.** El blind test de ronda 3 encontró recursos que
    actualizaban el valor en `alCambiar` pero se olvidaban de mover el punto. Nueva
    `posicionarElemento(v)`, llamada en cada emisión (agarrar, mover, soltar, tecla,
    y al inicializar) DESPUÉS de `alCambiar`/`alSoltar` — decisión de diseño explícita:
    si el recurso TAMBIÉN reposiciona `el` a mano en su propio callback (patrón de
    antes de T9), el helper corre último y su posición manda siempre, nunca al revés,
    así la compatibilidad hacia atrás no depende de que el recurso deje de tocar la
    posición.
    - SVG `<circle>`/`<ellipse>`: `cx`/`cy` directo, en unidades del `viewBox` de
      `area` (mismo sistema que ya usaba el modo bajo nivel).
    - SVG genérico (`rect`, `g`, `path`…, sin `cx`/`cy` propio): `transform:
      translate(...)` relativo al centro ORIGINAL del elemento (capturado una sola
      vez, vía la misma `coords()`/CTM que el modo bajo nivel). Pisa cualquier
      `transform` propio existente — si el recurso necesita otro transform en el
      mismo nodo (p. ej. `rotate`), tiene que envolver el punto en un `<g>` aparte.
    - HTML: `left`/`top` en % de `area` (robusto a que `area` cambie de tamaño) +
      `transform: translateX/Y(-50%)` SÓLO en el eje que se mueve, así el CENTRO del
      elemento queda sobre el valor sin necesitar conocer su ancho/alto. Fuerza
      `position:absolute` sólo si el autor no puso ya una posición (`static` es el
      default de `getComputedStyle`).
    - Opt-out: `opciones.mover === false` para un recurso que dibuja el punto con su
      propio motor (canvas, D3) — el helper no toca la posición en absoluto.
  - **Zona mínima de 44px (WCAG 2.5.5).** `elegirArrastrable` gana `golpeaZonaMinima`:
    un candidato golpeado por el hit-test real (T6 post-review) O DENTRO de un
    rectángulo mínimo de 44px por eje centrado en su centro real (sólo agranda el eje
    donde el elemento renderizado es más chico que 44px — una barra ancha no gana halo
    extra en su eje largo) es candidato válido; "gana el más cercano" sigue igual entre
    TODOS los candidatos encontrados por cualquiera de los dos caminos. Ningún nodo
    nuevo en el DOM (se prefirió extender el hit-test, como pedía la consigna). La
    prioridad de un control interactivo real (botón, link…) sobre `evento.target` no
    cambia: un botón cercano a un arrastrable chico sigue recibiendo su click aunque su
    centro caiga geométricamente en la zona mínima de ese arrastrable — se decide por
    el target real del evento, no por esta selección.
  - Nuevos tests unitarios en `e2e/unidad-kit.ts` (3): presencia de
    `posicionarElemento`/`moverActivo`/`medidasAreaLocal`/`fraccionPosicion` y de las
    tres ramas de escritura (`cx`/`cy`, `left`, `top`); el opt-out
    `opciones.mover !== false`; `TAMANO_MINIMO_TOQUE = 44` + `golpeaZonaMinima` como OR
    del hit-test real, nunca reemplazándolo.
  - Nuevos tests de navegador en `e2e/navegador-kit.ts` (11): posición inicial HTML
    (valor 4 de 0..10 → `left:40%`) y SVG circle (valor 7 → `cx=70`); mouse y teclado
    reposicionan de verdad (no sólo el valor) en HTML y SVG circle; forma SVG genérica
    (`<rect>`) se mueve con `transform` (corrimiento de pantalla ~20px, escala 2x,
    signo verificado); `mover:false` no toca la posición ni al inicializar ni tras
    varios `alCambiar`; zona mínima de 44px agarrable 18px afuera de un punto de 8px
    con mouse Y con touch real (CDP); dos zonas mínimas superpuestas sin golpear
    ninguna forma real → gana la más cercana; un botón cuyo centro cae en la zona
    mínima de un punto cercano conserva su click.
  - Checks: `npm run check` → clean. `npx tsx e2e/unidad-kit.ts` → 58/58 pass (pinned
    legacy hash unaffected — T9 only touches `SCRIPT_KODU`, never `legado`).
    `npx tsx e2e/navegador-kit.ts` → 43/43 pass, run twice, no flakiness, no leftover
    Chromium process from these runs (the one found on the machine was ~2h old,
    unrelated, not started by this task — left alone per the standing rule to only
    stop processes started in this task).
  - Commit: `16773c9`.

- T10 done. `src/lib/ai/prompt.ts`, BASE_PROMPT:
  - **kodu.arrastrar docs**: now says the helper already MOVES the point in unit mode
    (matches T9's `posicionarElemento`) and to never reposition it by hand inside
    `alCambiar`; documents `mover:false` for a resource that draws the point itself
    (canvas, D3). The inline example's `alCambiar` callback was renamed from
    `dibujar()` to `actualizarTexto()` to stop implying the callback has to move
    anything.
  - **Colores (Diseño visual)**: one clause added after the existing token list —
    theme tokens are for the INTERFACE; CONTENT objects (a chocolate bar, a fruit)
    use whatever color/shape the teacher asked for, not the theme's. Directly
    addresses the round-3 defect (chocolate bars rendered blue/white across all three
    fraction resources because theme rules won).
  - **Three new one-line rules** (11-13) in "Que funcione de verdad": `textContent`
    only for plain text, `innerHTML` for markup; state styles (correct, incorrect,
    chosen) beat `:hover` — no hover after answering; "tomar decisiones" means the
    choice branches what happens next, not just the feedback text.
  - Prompt cost: BASE_PROMPT 11932 (after T8) -> 12419 chars (+487), measured at
    runtime via `buildSystemPrompt` with empty rules/assets and `herramientaForzada:
    true` (isolates BASE_PROMPT with no other section appended) — not a regex over
    the source, to avoid the escaped-backtick trap (an escaped `` \` `` inside an
    inline-code example like `` \`p.x\` `` looks like a real template-literal
    terminator to a naive regex). At 3.37 chars/token (same fit used since T3), +487
    chars is ~145 tokens — under the ~150 budget for this part. First draft was 535
    chars (~159 tokens, over budget); trimmed wording in the colores clause and all
    three new rules (dropped a parenthetical example, shortened "ganan sobre
    `:hover`: después de responder, sin hover" to "ganan a `:hover`: sin hover
    después de responder", "cambian lo que sigue (ramas)" to "ramifican lo que
    sigue") to land at 487.
  - Tests: `e2e/unidad.ts` — updated the T3/round-2 helper-docs test (the exact
    substring `'no agregues \`pointerdown\` ni \`keydown\` propios'` no longer
    exists verbatim since the wording changed to `/`; narrowed the assertion to
    `'no agregues \`pointerdown\`'`, still true). Added 3 new tests: the T9
    positioning markers (`'YA MUEVE el punto'`, `'ni lo reposiciones en
    \`alCambiar\`'`, `` '`mover:false`' ``), the colores/objetos clause, and the 3
    new one-line rules by distinctive substring.
  - `e2e/arnes-robustez.ts`: assertion (A) checks `'## Que funcione de verdad'`,
    `'kodu.arrastrar'`, `'alCambiar: (v) =>'`, `'kodu.mezclar('` — all four still
    present verbatim after T10's edits, no change needed there. Ran it for real
    (dev server on :3000 was already up from a prior session, `kodu_db_dev` up):
    A/B/C all pass.
  - Checks: `npm run check` → clean. `npx tsx e2e/unidad.ts` → 58/58 pass (54 before
    + 4 new). `npx tsx e2e/arnes-robustez.ts` → A/B/C pass (ran once; not required by
    the task's checklist for T10, done as a bonus consistency check since the dev
    server happened to already be up).
  - Commit: `962521c`.

- T11 done. `src/lib/ai/kit.ts`: new `SCRIPT_CENTINELA` — the FIRST script of the canonical
  block (before even the Tailwind/Lucide `<script src>` CDN tags), only in the current block
  (legacy stays byte-identical, pinned hash unaffected).
  - **Sentinel**: `window.addEventListener('error'/'unhandledrejection', …)` plus a
    `console.error` wrap (still calls the original). A plain (non-capture) `'error'` listener
    on `window` only ever receives real `ErrorEvent`s, never a failed-resource-load event
    (script/img/link) — those don't bubble and only reach `window` in the capture phase — so a
    dead CDN (Tailwind, Lucide, Google Fonts, canvas-confetti) or a broken `<img>` in the
    resource is excluded as noise for free, no domain filtering needed. Each capture is stored
    in an in-page list AND (capped at 20, message truncated to 300 chars) forwarded to the
    parent: `postMessage({kodu:'error', tipo:'error'|'promesa'|'consola', mensaje, linea,
    columna, accion}, '*')`, only when `window.parent !== window`, wrapped so nothing can throw
    (cross-origin parent, weird `evento.reason`, etc.). `accion` is whatever the self-test was
    doing when the error fired (`'al cargar'` by default).
  - **Self-test**: listens for `message` with `evento.source === window.parent` (verified in a
    browser test with a real sibling-iframe spoof, not just a source-check inline) and
    `data.kodu === 'autoprueba'` (`{kodu, id, botones?}`, default 8), runs once per `id`. Flow:
    wait `readyState==='complete'` + ~800ms; snapshot (body text with chequeo-rapido's seconds
    normalization, `input/select/textarea` values); find a reset button (text/aria-label/title
    against the same regex family as chequeo-rapido); if found, click it ONCE before touching
    anything and snapshot again — any TEXT LINE OR CONTROL INDEX that differs between these two
    snapshots is "volatile" (shuffled options, a random number) and is excluded BY INDEX from
    every later comparison, regardless of what it changes to next (index-based, not
    exact-string: a third random realization still gets skipped). Then move every visible
    `input[type=range]` to max, click up to N distinct visible/enabled non-reset buttons
    (re-querying each time so a "Start" screen's later buttons are reached), realistic event
    sequence (pointerdown/mousedown/pointerup/mouseup/click), ~150ms apart; wait ~1200ms; find
    and click reset again; wait ~1200ms; snapshot; compare (set-difference on the
    volatility-filtered lines, index comparison on controls) against the bare-reset snapshot
    (or the initial one if there was no reset button). Replies
    `{kodu:'autoprueba:resultado', id, errores, reinicioOk, exitoVisibleAlInicio, detalles:
    {botonesTocados, rangosMovidos, reinicio, diferencias:{textoQueFalta, textoQueSobra,
    controles, truncado}, volatiles:{lineas,controles}, duracionMs, incompleta}}`.
    `reinicioOk` is `null` when there's no reset button at all, else `true`/`false`. Each diff
    list capped at 5 with a `truncado` flag. A ~20s global budget sets `incompleta:true` and
    still replies with whatever was gathered.
  - **Timers**: `setTimeoutNativo = window.setTimeout` is captured on the very first line of
    the script (before anything else, including the resource, has a chance to touch it) and is
    the ONLY thing the self-test's waits use — `kodu.cancelarTemporizadores()` (in
    `SCRIPT_KODU`, a separate list) can never cut the self-test short even if the resource
    under test calls it from its own `reiniciar()` during the run.
  - `alert`/`confirm`/`prompt` overridden to instant no-ops as a second guard (a sandbox
    without `allow-modals` already resolves them instantly).
  - Real defect found and fixed while writing this: a first draft used named inner
    functions/const-bound arrows inside `page.evaluate` callbacks (`function onMessage(){}`, a
    self-recursive `(function revisar(){…})()`) — tsx/esbuild wraps any NAMED binding with a
    `__name(fn,"name")` helper (to preserve `.name` for stack traces) that only exists in the
    Node module, not in the string Playwright ships to the browser, so every such call threw
    `ReferenceError: __name is not defined` at runtime (type-checked fine, only failed when
    actually run). Fixed by storing callbacks on plain object properties (`estado.onMessage =
    function (…) {…}`) and replacing the recursive poll with `setInterval`/`clearInterval`
    (confirmed both patterns avoid the wrapping with a minimal repro before touching the real
    tests) — no other file in this repo had hit this yet since none nested named functions
    inside `page.evaluate`.
  - Unit tests in `e2e/unidad-kit.ts` (+6): centinela is the first thing in the block (before
    the Tailwind/Lucide CDN URLs); legacy block has neither centinela nor autoprueba; the three
    capture paths are present; the message contract (`autoprueba`/`autoprueba:resultado`,
    source check, run-once-per-id) is present; native timer capture is the first line; the
    result's field names are all present.
  - Browser tests in `e2e/navegador-kit.ts` (+7, own `mainAutoprueba()` with its own browser —
    kept separate from `main()` so the existing "no pageerror/console.error in the whole run"
    assertion doesn't trip on errors this suite deliberately causes): each of the six samples
    below hosted in a fresh `<iframe sandbox="allow-scripts" srcdoc="…">` (no
    `allow-same-origin`) built with the real `aplicarKit`, driven from the parent page.
    - **Healthy** (range + "Comprobar" + "Reiniciar" + message/counter): `errores:[]`,
      `reinicioOk:true`, `botonesTocados` has "Comprobar" but never "Reiniciar".
    - **Throws on click** (`funcionQueNoExiste()` in a click handler): exactly one error,
      `accion:"al tocar el botón 'Feo'"`, `linea` matches the real source line (computed
      dynamically from the built document, not hardcoded) — no reset button → `reinicioOk:
      null`.
    - **Partial reset** (reset restores the range but forgets to clear a message):
      `reinicioOk:false`, `"Intentaste"` shows up in `diferencias.textoQueSobra`.
    - **Random content** (`kodu.mezclar` reshuffled options + a random number on every reset,
      otherwise correct): `volatiles.lineas >= 2`, `reinicioOk:true` — proves the bare-reset
      probe keeps genuine randomness from reading as a defect.
    - **Sentinel-only** (console.error + a thrown error at load + a rejected promise, no
      autoprueba sent): exactly 3 forwarded `kodu:'error'` messages, one per `tipo`, right
      substrings.
    - **Start screen** ("Empezar" reveals "Jugar"/"Reiniciar", `[hidden]` on the game div):
      `botonesTocados` is exactly `['Empezar','Jugar']` (the self-test reaches controls that
      don't exist at load), `reinicioOk:true` (reset returns to the start screen).
    - **Source check**: a same-origin SIBLING iframe posts a spoofed `autoprueba` message
      straight at the target iframe's `contentWindow` (so `evento.source` inside the target is
      the sibling, not `window.parent`) — never produces a reply; a genuine message from
      `window.parent` right after, on the same iframe, does.
  - Checks: `npm run check` → clean. `npx tsx e2e/unidad-kit.ts` → 64/64 pass (58 previous + 6
    new; legacy pinned hash unaffected — T11 only touches the non-legado branch).
    `npx tsx e2e/navegador-kit.ts` → 50/50 pass (43 previous + 7 new), run twice, no flakiness.
    No new leftover Chromium process from these runs — one unrelated ~2h-old process was
    already on the machine before this task started (same PIDs before and after both runs,
    confirmed with `ps -eo pid,etime`) and was left alone. `npx tsx e2e/unidad.ts` (against
    `kodu_db_dev`, already up) → 58/58 pass — this task didn't touch `prompt.ts`, no regression
    expected or found.
  - Commit: `4f2c9c4`.

- T12 done, two work-unit commits.
  - **T12a (server): `2455e86`.** `src/lib/ai/provider.ts`: added `razonamientoCorreccion(provider)`
    — an internal "low" reasoning level, never exposed as part of `Speed` (effort dialect →
    `reasoning_effort:'low'`; thinking dialect → `enabled`; unknown dialect → nothing) — plus a new
    `razonamientoOverride?: Record<string, unknown> | null` option on `requestCompletionStream`/
    `intentarUna` that, when present, replaces the `razonamientoEfectivo(provider, velocidad)` call
    in the request body. This reuses all existing plumbing (retries, `forzarHerramienta` fallback,
    saturation backoff) untouched.
    New isomorphic module `src/lib/ai/autoprueba.ts` (pure, no Node/DOM — same pattern as
    `revision-visual.ts`): types matching `SCRIPT_CENTINELA`'s `autoprueba:resultado` message;
    `necesitaCorreccion({errores, reinicioOk})` (true on any error, or `reinicioOk === false`;
    `reinicioOk === null` alone does NOT trigger a correction); `lineaFuente(html, linea, contexto=1)`
    (extracts the 1-based source line ± context with a `>` marker, `null` out of range); a stable
    marker constant `MARCADOR_CORRECCION_AUTOPRUEBA` for T13's mock matching; and
    `construirMensajeCorreccion({html, informe, ronda})`, which quotes each error's message, action
    and exact source-line text (from the CURRENT server-side HTML, never client-supplied), the
    before/after diff for a failed reset (missing/extra text, control values), and an extra note
    when `exitoVisibleAlInicio` is true.
    New `POST /api/chat/autocorreccion` (`src/pages/api/chat/autocorreccion.ts`), modeled on
    `visual-review.ts`: same auth/demo/project-access/fingerprint-staleness/quota gates, but
    WITHOUT visual-review's `puedeElegirVelocidad`/`supportsVision` gates — the self-test runs for
    every teacher, it's the harness fixing its own defects, not a prime feature. Body
    `{projectId, fingerprint, ronda: 1|2, errores, reinicioOk, exitoVisibleAlInicio, diferencias}`,
    zod-capped (20 errors, 5 diff entries each list, 300-500 char strings); `ronda` as a
    `z.union([z.literal(1), z.literal(2)])` rejects anything else by construction. Historyless
    prompt (`buildSystemPrompt` + `buildCurrentResourceBlock`), forced tool,
    `razonamientoOverride: razonamientoCorreccion(provider)`. Applies the kit, persists
    `currentHtml`, records ONE `TokenUsage` row per round (consumes the teacher's quota like
    T7/T8). No `ChatMessage`, no `ProjectSnapshot`. SSE `code`/`done` only — failures never surface
    as an `error` event, just one server log line per round (`proyecto`, `ronda`, `errores` count,
    `reinicioOk`, `corrigioCodigo` — no HTML content).
    Unit tests in `e2e/unidad.ts`: 3 for `razonamientoCorreccion` (unknown dialect, always "low",
    always "enabled"), 4 for `necesitaCorreccion`, 4 for `lineaFuente`, 3 for
    `construirMensajeCorreccion` (exact message/action/source-line citation, reset diff citation,
    exitoVisibleAlInicio note presence/absence).
  - **T12b (client): `b26857f`.** `src/lib/workspace-types.ts`/`AiStatus.tsx`: two new `AiPhase`
    values, `probando` ("Probando el recurso…") and `corrigiendo` ("Corrigiendo un detalle…").
    New `src/lib/client/autoprueba.ts`: `ejecutarAutopruebaEnIframe(html, {signal, numBotones,
    timeoutMs})` — creates a hidden `<iframe sandbox="allow-scripts">` (no `allow-same-origin`,
    same as PreviewPanel), `srcdoc=html`, 1280×800, posts `{kodu:'autoprueba', id, botones}` only
    AFTER the iframe's own `load` event (a message posted before the `srcdoc` navigation starts can
    be lost — goes to the initial `about:blank`, not the final document), waits for
    `{kodu:'autoprueba:resultado', id}` from `evento.source === iframe.contentWindow`, `null` on a
    ~25s timeout or on `signal` abort (both always remove the iframe). New `streamAutocorreccion` +
    `AutocorreccionEvent` in `src/lib/client/api.ts`, same transport as `streamVisualReview`.
    `src/components/workspace/Workspace.tsx`: `ejecutarRevisionVisual` now RETURNS the html it
    ended with (corrected, or the input unchanged) instead of `void` — T12 chains off of it, so the
    self-test runs on what the teacher actually ends up seeing after T8, not before it. New
    `ejecutarAutopruebaYCorreccion(htmlInicial)`: loop of at most 2 rounds — `probando` phase, run
    the self-test; if healthy, done; if it needs correction and rounds remain, `corrigiendo` phase,
    call the endpoint, apply the returned `code` to the preview (same silent treatment as T8, no
    chat message), loop back to re-test the corrected HTML; if still failing after round 2 (or the
    endpoint call raises a non-abort error, or returns no HTML), set the discreet warning. A timeout
    or abort during the self-test itself returns immediately with NO warning (couldn't test ≠ found
    a defect). `abortador.current` is reused for both the iframe wait and the correction fetch, so
    the existing "Detener" button (already unconditionally wired for any non-idle `aiPhase`) cancels
    whichever is in flight; `/api/chat/cancel` is a safe no-op here since the main turn's assistant
    message is already saved by this point. Skipped entirely for a multi-variant turn
    (`pedirVersiones`, T9) — matches T8's existing "versions and visual review are exclusive"
    reasoning. New `autopruebaAdvertencia` state, cleared at every other place `html` changes
    (new turn start, resume-after-reload poll, undo, version switch, manual code edit) and
    surfaced as a small discreet line in `PreviewPanel`'s footer: "Probamos el recurso y algo puede
    no funcionar bien. Si lo notás, contalo en el chat." — no dismiss button, clears only via HTML
    change, never auto-times-out like `flashNotice`.
    **Hidden-iframe measurement** (required by the task — "measure, don't assume"): wrote a
    throwaway Playwright script (not committed) that put the same rAF+setInterval-animated resource
    in two placements and counted ticks over a real 2000ms window. `position:absolute;
    left:-9999px;top:-9999px` (off-screen): **0 `requestAnimationFrame` frames fired inside a 10s
    safety timeout** — Chromium fully freezes rAF scheduling for a cross-origin iframe whose rect
    never intersects the viewport (same class of throttling as an off-screen ad iframe), regardless
    of the iframe's own CSS visibility. `position:fixed;top:0;left:0;opacity:0;pointer-events:none;
    z-index:-1` (in-viewport, only visually hidden): **~122 rAF frames in 2044ms (≈60fps)** —
    behaves exactly like a visible frame. `setInterval` ticks (40 in ~2000ms, 50ms interval) were
    unaffected in EITHER placement — only rAF is gated by viewport intersection. Decision: the
    hidden self-test iframe uses the in-viewport `opacity:0` placement, not off-screen — a resource
    that animates via rAF (increasingly common after T7's `kodu.festejar`, and any hand-rolled
    animation) would otherwise never settle, or the self-test's own timing (which itself only
    depends on native `setTimeout`, unaffected) could observe a half-animated DOM state.
  - Checks: `npm run check` → clean after both commits. `npx tsx e2e/unidad.ts` (against
    `kodu_db_dev`, already up) → 70/70 pass (58 previous + 12 new: 3 `razonamientoCorreccion` + 9
    `autoprueba.ts`). `npx tsx e2e/unidad-kit.ts` → 64/64 pass, unchanged (T12 never touches
    `kit.ts`). `npx tsx e2e/navegador-kit.ts` → 50/50 pass, unchanged, run once, no leftover
    Chromium process, no regression.

- T13 done. Commit `c665d09`. `e2e/mock-proveedor.ts` needed NO code changes — it already records
  the full request body per call (`llamadas[i].body`), which is all T13 needed to assert on
  `reasoning_effort` and the correction prompt text.
  New `e2e/t11-autoprueba.ts` (real Chromium against the dev server + mock, same pattern as
  `e2e/t8-revision-visual.ts`'s browser scene). HTML fixtures (unkitted — the server applies the
  kit): `htmlRoto` (a "Comprobar" button whose handler calls `funcionQueNoExiste()`, no reset
  button), `htmlSano` (same button, works), `htmlReinicioParcial` ("Comprobar" sets a message,
  "Reiniciar" resets the range but forgets to clear the message — same defect shape as
  `navegador-kit.ts`'s own "Muestra 3"). The mock's correction response is selected via
  `programarRespuestaCondicional` matching `MARCADOR_CORRECCION_AUTOPRUEBA` (exported from
  `src/lib/ai/autoprueba.ts`) in the last user message. Pisa el dialecto del motor mock a
  `reasoning_effort`/`"none"` (mismo patrón que T6/T7) para poder comprobar que la corrección
  pide `"low"` — se restaura al final.
  - **Escena 1 (roto → corregido)**: observa "Probando el recurso…" y "Corrigiendo un detalle…"
    en pantalla, exactamente 1 pedido de corrección, `reasoning_effort:"low"`, el prompt de
    corrección cita el mensaje del error (`funcionQueNoExiste`), la etiqueta del botón
    ("Comprobar") y el TEXTO exacto de la línea de origen (`funcionQueNoExiste();`); el resultado
    final es el sano (preview y `Project.currentHtml`); el hilo tiene EXACTAMENTE 2
    `ChatMessage` (nada extra de la corrección); `TokenUsage` sumó 2 filas (turno + 1 ronda); 1
    sola `ProjectSnapshot` (la del turno, la corrección no crea la suya); sin aviso.
  - **Escena 2 (sigue roto)**: exactamente 2 pedidos de corrección (nunca un 3ro), el recurso
    final queda con lo último que devolvió la 2da corrección aunque siga roto, y se ve el aviso
    discreto.
  - **Escena 3 (sano a la primera)**: cero pedidos de corrección, sin aviso.
  - **Escena 4 (reinicio parcial, sin error de JS)**: dispara una corrección cuyo prompt incluye
    la línea "Intentaste" que quedó sin limpiar y el texto "no vuelve el recurso al estado
    inicial" (nunca la ruta de "error"), y termina sana.
  - **Gotcha real encontrado y arreglado (no era del código de T12/T13)**: la primera corrida de
    `e2e/t7-revision-automatica.ts` (chequeo de regresión pedido para esta tarea) falló con la
    secuencia SSE `['done']` en vez de `['code','phase','code','done']` — el turno cayó al motor
    real MiniMax M3 ("El servidor no tiene configurada la clave"). Investigado con Prisma
    directo: bajo el `kind` compartido `"kodu-mock-t3"` había 3 `AiProvider`, DOS
    deshabilitados y sin `apiKeyCipher` (sobras de sesiones anteriores — el mismo problema que
    ya había encontrado y arreglado `e2e/arnes-robustez.ts` en su T4.3, pero SÓLO ahí:
    `t7-revision-automatica.ts`/`t8-revision-visual.ts` siguen con un `findFirst` SIN el filtro
    `enabled`/`apiKeyCipher`, y por lo visto en esta corrida cayeron en uno de los deshabilitados,
    cuyo `AiModel` hijo `normalizarMotor` no puede usar aunque el modelo en sí esté `enabled`).
    NO se tocó ningún archivo `.ts` de e2e existente (fuera del alcance de T12/T13): se borraron
    sólo las dos filas de `AiProvider` deshabilitadas y sus `AiModel` hijos de la base de
    desarrollo compartida (`onDelete: SetNull` en `Project`/`TokenUsage.aiModelId`, así que
    cualquier fila vieja que las referenciara queda con `NULL`, nunca rota) — pura limpieza de
    datos, no un cambio de código. Con eso, `e2e/t7-revision-automatica.ts` corrió limpio
    (13/13 escenas). Queda abierto (fuera de este cambio): endurecer el `asegurarMotorMock` de
    esos dos archivos con el mismo filtro que ya usa `arnes-robustez.ts`, para que la clase de
    falla no vuelva a aparecer.
  - Checks: `npx tsx e2e/t11-autoprueba.ts` → 4/4 escenas pass, corrido dos veces, sin
    flakiness (la primera corrida real necesitó agrandar el `chunkDelayMs`/achicar el
    `chunkBytes` de la respuesta de corrección de la escena 1 — con chunks grandes y rápidos la
    fase "Corrigiendo un detalle…" duraba unos pocos ms del lado del servidor y el `waitFor` de
    Playwright la perdía; mismo truco que ya usa la escena H de `t8-revision-visual.ts`). Ningún
    Chromium ni mock quedó colgado después de ninguna corrida (`browser.close()`/`mock.detener()`
    en `finally`); el único proceso Chromium visto en la máquina durante estas corridas ya
    estaba ahí antes (mismo PID, de otra sesión, no tocado).


## Round 4 (2026-09-25): teacher checklist + in-resource tests, and five new patterns

Source: `exp/medicion-arnes:experimentos/razonamiento/RESULTADOS-arnes.md` ("Ronda 4") and
`resultados/ronda4-puntajes.json`. The self-test ran in all 12 generations and never triggered a
correction: the remaining defects are LOGIC defects relative to what the teacher asked (a challenge
stuck after moving two data points, a step already satisfied that is not marked on entry, a double
click that lands on the next screen, a fixed "N of 3" counter on a branching path, confetti on a
negative ending, Space firing during the victory pause).

Constraints: no paid calls (mock provider only), `npm run check` clean, previous regressions green,
work-unit commits, no merge, no push. Part B prompt growth ≤ ~150 tokens. TDD: off (no test runner
configured; source: repo has none, `e2e/*.ts` scripts run with `npx tsx`). RDD: off globally by the
user (2026-09-23), so verification is writer self-check + parent spot checks. Delivery: single
branch, no PR (user instruction).

### Design decisions (parent)

- **Checklist = a separate cheap call** inside the same `/api/chat/stream` request, before the main
  generation, only when `esRecursoInicial(project.currentHtml)` (new resource), never on
  adjustments. Reasoning via `razonamientoEfectivo(provider, 'fast')` (= `none`). Independent of the
  generator on purpose: tests written in the same pass as the code share the code's misreading of
  the request. Output: 3–6 items, plain lines parsed server-side (portable across providers, no
  tool/JSON-mode dependency). Failure or timeout (~15 s) never blocks the turn: it continues without
  a checklist. One `TokenUsage` row for the call.
- **Item shape**: `{ id: 'c1', texto: 'Si pinto 1/2 y 3/6, dice que son equivalentes' }`.
- **Storage**: new nullable `ChatMessage.checklist String?` (JSON string, same convention as
  `attachments`) on the ASSISTANT message of the turn that created it. Current checklist of a
  project = latest assistant message with `checklist != null` and `undoneAt == null`. Undo (T4)
  therefore drops it naturally.
- **Generation**: the checklist travels in the last user message of the main call (never in the
  teacher's stored `ChatMessage.content`), asking for one `__koduPruebas` entry per item id. In
  later adjustment turns the current checklist is appended to the current-resource block so the
  model keeps the tests aligned.
- **`window.__koduPruebas` contract**:
  `[{ id: 'c1', prueba: async (t) => ({ ok: boolean, detalle: string }) }]`; `t` =
  `{ esperar(ms), clic(selectorOrElement), texto(selector) }`. Each test starts by calling the
  resource's own reset. Invisible to the student: the array only runs on `kodu:autoprueba`.
- **Runner** (kit, `SCRIPT_CENTINELA`): after the existing checks (after the reset check), run at
  most 8 tests, 3 s timeout each, errors caught into `{ok:false, detalle}`; `detalle` truncated to
  200 chars. Result gets `pruebas: null | [{id, ok, detalle}]` (`null` = no `__koduPruebas` or not
  an array: old resources keep working). The client timeout grows to cover the test phase.
- **Correction**: `necesitaCorreccion` also fires on any failed test; the correction body carries
  the failed tests; the server loads the checklist text itself; the correction message tells the
  model to decide whether the resource or the test is wrong against the teacher's request and never
  weaken a test to make it pass. Still max 2 rounds.
- **Teacher UI**: "Esto es lo que probé", collapsed by default, discreet, in the preview panel:
  passed (check), failed after corrections (warning), no test for this item, not run yet. Visible
  by default (no flag): it only states what was tested.
- **Part B kit**: `kodu.pantalla(nombre)` shows `[data-pantalla=nombre]`, hides the other
  `[data-pantalla]`, and for ~400 ms swallows TRUSTED pointerdown/click/keydown in capture phase
  (synthetic clicks from the self-test and `__koduPruebas` pass). `kodu.ocupado()` reports the lock.
  Prompt: one-line rules for branching progress, festejar only on positive endings, shortcuts
  respect disabled/transition state, evaluate a step's condition on entry.

### Tasks

- [ ] T14 — Kit: `__koduPruebas` runner in the self-test + `kodu.pantalla`/`kodu.ocupado`; browser
  tests in `e2e/navegador-kit.ts`. Route: delegated (writer trigger: kit + browser tests).
- [ ] T15 — BASE_PROMPT: `__koduPruebas` doc with a short example (Part A) and Part B rules;
  `e2e/unidad.ts`; chars/tokens of each part. Route: delegated (same writer as T14).
- [ ] T16 — Server: checklist step (`src/lib/ai/checklist.ts`), migration for
  `ChatMessage.checklist`, wiring in `stream.ts` (new resources only, SSE `checklist` event,
  TokenUsage row, injection into generation and adjustment turns), current-checklist lookup.
  Unit tests. Route: delegated (writer trigger: 3+ non-trivial files).
- [ ] T17 — Correction with failed tests: `autoprueba.ts` types/`necesitaCorreccion`/message,
  `autocorreccion.ts` schema, client runner timeout. Route: delegated (same writer as T16).
- [ ] T18 — Editor UI "Esto es lo que probé" + initial checklist from the page. Route: delegated.
- [ ] T19 — e2e in real Chromium with the mock: tests fail → corrected; tests pass; no
  `__koduPruebas` (old resource). Regressions: `t11`, `t7`, `unidad*`, `navegador-kit`. Route:
  delegated (same writer as T18).

### Round 4 Progress

## Next step

Round 3 completa (T9–T13), branch `feat/arnes-robustez` sin pushear ni mergear. Pendiente fuera
de esta tarea: endurecer `asegurarMotorMock` en `e2e/t7-revision-automatica.ts` y
`e2e/t8-revision-visual.ts` con el mismo filtro `enabled`/`apiKeyCipher` que ya usa
`e2e/arnes-robustez.ts` (y ahora `e2e/t11-autoprueba.ts`), para no depender de limpiar la base a
mano cada vez que la base de desarrollo compartida acumula filas deshabilitadas de otras
sesiones.

Round 2 done (T5-T8), branch not pushed or merged. Measure with DeepSeek in a later
session, only the affected prompts (D3, D1, N2, N1), `high` x2 and `low` x1.
