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
- [ ] T8 — BASE_PROMPT: rewrite rules 1-2 (initial state, achievement vs condition),
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

## Next step

Round 2: T5-T7 done (this session). T8 (BASE_PROMPT rewrite + `e2e/arnes-robustez.ts`
mock flow check) is the parent's task, not this writer's. Then measure with DeepSeek in
a later session, only the affected prompts (D3, D1, N2, N1), `high` x2 and `low` x1.
