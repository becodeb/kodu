```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:336a6437aa15f9b1f94481bc410bce43bcbd48f3d5194f5e11fb3dd2cbb2ba80
verdict: fail
blockers: 1
critical_findings: 2
requirements: 12/13
scenarios: 29/31
test_command: npm run check
test_exit_code: 0
test_output_hash: sha256:ef26626cb54fb19d64d01c69cab38ca41373679bd3b916f74475dd969918871c
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:9d393496951ffaf8f174a96f621b019a4bf796cdd0ff04d89ea057f76a8fae8a
```

## Verification Report — Scoped Re-Verification (2026-09-21)

**Change**: publicacion-likes-y-motores
**Scope**: This is a SCOPED re-verification, not a full re-run. The prior pass
(preserved verbatim below) already independently reproduced 27/31 scenarios
green across 4 of 5 spec domains and FAILED on exactly one CRITICAL: the
`ai-authoring-dialogue` domain had zero runtime coverage. This pass verifies
only whether that gap is closed and whether anything regressed. The full
Playwright suite was **not** re-run, per instruction — no UI code changed
since the prior pass's 10/10 green reproduction.

### What changed since the prior pass

```
$ git diff --stat
```
Full working-tree diff against the branch base is unchanged in file list and
line counts from what the prior pass already reviewed and approved, with one
exception: `e2e/unidad.ts` now carries the four new tests (prior pass already
noted `unidad.ts` existed with pure-function tests for `pideCambio`,
`cadenaDeMotores`, `calcularCostoTurno`; the new diff adds 69 lines, of which
lines 385-451 are the four `buildSystemPrompt` tests plus the
`contextoDePrueba` helper and the `MARCA_PREGUNTAS` constant).

**Caveat on this claim**: this branch is fully uncommitted (per task framing,
"Branch: `sdd/publicacion-likes-y-motores` (uncommitted)"), so there is no
git commit boundary that pins "the exact state the prior pass verified." I
cannot produce a `git diff` between "prior-pass working tree" and "current
working tree" — only between "current working tree" and the branch's base
commit, which conflates the whole feature diff with any incremental change.
What I verified directly instead:
- `src/lib/ai/prompt.ts` lines 120-129 (the `renderPreguntas` collision
  logic) read byte-for-byte identical to the exact lines the prior report
  quoted and analyzed ("`herramientaForzada` short-circuits to `''` before
  the turn-count check" — confirmed present, unchanged).
- `src/pages/api/chat/stream.ts`'s `buildSystemPrompt` call site and the
  hoisted `forzar = pideCambio(message)` pattern match the prior report's
  description exactly (`:415` call site, reused at `:434` and `:529`).
- `npm run check`'s output hash (`sha256:ef26626c...`) is **byte-identical**
  to the prior pass's recorded hash for the same command — the strongest
  available evidence that no source file affecting the type-check changed.
- I additionally performed my own destructive mutation test directly against
  `src/lib/ai/prompt.ts` (see below) and restored it to the exact byte
  content it had before I touched it (sha256 verified equal before/after,
  `diff` empty). This is independent of trusting the orchestrator's account.

Conclusion: no evidence of regression in any file other than the intended
`e2e/unidad.ts` addition. This is a high-confidence but not commit-boundary-
provable claim, given the uncommitted state of this branch.

### Scenario-by-scenario mapping: are all four `ai-authoring-dialogue` scenarios now covered?

**No — two of four are covered by a test matching the spec's own mandated
verification method; two remain uncovered.** This is a partial closure, not
a full closure, and it does not fully resolve the prior CRITICAL.

| Requirement | Scenario | Spec-mandated verification method | New test | Verdict |
|---|---|---|---|---|
| Early turns favor asking over guessing | Early turn asks instead of guessing | **Playwright browser check (chat transcript inspection)** | `unidad.ts` test 1 ("en el primer turno pide preguntar...") checks that `buildSystemPrompt`'s *template output* contains the guidance marker at `turnosPrevios: 0` | ⚠️ **Still UNTESTED against the spec's own required method.** The scenario's GIVEN/WHEN/THEN is about an actual teacher message and an actual model response ("the model's response asks about the missing specifics"). The new test never invokes a model and never inspects a chat transcript — it only proves the static system-prompt text a request *would carry* is correct. Necessary, not sufficient. |
| Early turns favor asking over guessing | Later turns build without interrogating | **Playwright browser check (chat transcript inspection)** | `unidad.ts` test 3 ("del turno 3 en adelante ya no pregunta") checks the guidance marker is absent at `turnosPrevios: 2` | ⚠️ **Still UNTESTED against the spec's own required method.** Same gap as above: the scenario is about the model's actual behavior in a live thread, not the prompt template. |
| Question guidance is omitted when a tool call is forced | Forced tool choice omits question guidance | unit/integration check of `buildSystemPrompt` output | `unidad.ts` test 4 ("la herramienta forzada gana...") — `turnosPrevios: 0, herramientaForzada: true` and `turnosPrevios: 5, herramientaForzada: true`, both assert the marker is absent | ✅ **COMPLIANT.** Matches the spec's own mandated verification method exactly, passed at runtime, and independently mutation-tested by me (see below). |
| Question guidance is omitted when a tool call is forced | Non-forced early turn keeps the question guidance | unit/integration check of `buildSystemPrompt` output | `unidad.ts` test 1 (`turnosPrevios: 0, herramientaForzada: false`) asserts the marker is present | ✅ **COMPLIANT.** Matches the spec's own mandated verification method exactly, passed at runtime, and independently mutation-tested by me (see below). |

**Net result**: the requirement "Question guidance is omitted when a tool
call is forced" (2/2 scenarios) is now genuinely CLOSED. The requirement
"Early turns favor asking over guessing" (0/2 scenarios) remains OPEN — no
Playwright chat-transcript check was added, and no documented
manual-verification exception was added to `openspec/config.yaml`'s `verify`
rules (I checked: `openspec/config.yaml` is unchanged from the prior pass —
still generic "Playwright is available... no harness exists yet — set one up
if a change needs it," with no `ai-authoring-dialogue`-specific exception).
`tasks.md:43` still records the test method for this work unit as "Manual
chat transcript check (no harness for `stream.ts`)," and `apply-progress.md`
still contains no transcript excerpt or description of that manual check
having been performed — the exact same gap the prior report already flagged
in its remediation item #2, unaddressed.

This means **2 of the 4 `ai-authoring-dialogue` scenarios remain CRITICAL
UNTESTED**, not 0. The domain-wide scenario count moves from 0/4 to 2/4.

### My own mutation testing (independent, not taking the orchestrator's word)

I did not trust the orchestrator's mutation-testing claim. I performed three
of my own mutations against `src/lib/ai/prompt.ts`, one at a time, each
followed by an exact restore and a green re-run, backed by sha256 checksums.

**Setup**: `sha256sum src/lib/ai/prompt.ts` before touching anything:
`53cb02623a9686a7c5a96428f81d37436643560c3b27cb2d0e36b5fb6c701492`.

**Mutation 1** — commented out `if (herramientaForzada) return '';`
(`prompt.ts:126`):
```
✔ buildSystemPrompt: en el primer turno pide preguntar antes de construir
✔ buildSystemPrompt: el turno 2 sigue siendo temprano (el borde)
✔ buildSystemPrompt: del turno 3 en adelante ya no pregunta
✖ buildSystemPrompt: la herramienta forzada gana sobre las preguntas
  con la herramienta forzada la guía de preguntas NO puede viajar
✖ e2e/unidad.ts: 1 prueba(s) fallaron
```
Exactly test 4 fails, as expected — this is the test covering the forced-tool
scenario. Restored; `diff` against the pre-mutation backup was empty.

**Mutation 2** — commented out `if (turnosPrevios > TURNOS_TEMPRANOS)
return '';` (`prompt.ts:127`):
```
✔ buildSystemPrompt: en el primer turno pide preguntar antes de construir
✔ buildSystemPrompt: el turno 2 sigue siendo temprano (el borde)
✖ buildSystemPrompt: del turno 3 en adelante ya no pregunta
  con el recurso ya armado la guía sobra: el modelo tiene que editar, no interrogar
✔ buildSystemPrompt: la herramienta forzada gana sobre las preguntas
✖ e2e/unidad.ts: 1 prueba(s) fallaron
```
Exactly test 3 fails, as expected. Restored; `diff` empty.

**Mutation 3** (my own addition, not in the orchestrator's account) — shifted
the boundary constant `TURNOS_TEMPRANOS = 1` → `TURNOS_TEMPRANOS = 0`, to
confirm the boundary test (test 2) actually exercises the boundary rather
than being redundant with test 1 or test 3:
```
✔ buildSystemPrompt: en el primer turno pide preguntar antes de construir
✖ buildSystemPrompt: el turno 2 sigue siendo temprano (el borde)
  turnosPrevios=1 es el último turno temprano: la guía tiene que estar
✔ buildSystemPrompt: del turno 3 en adelante ya no pregunta
✔ buildSystemPrompt: la herramienta forzada gana sobre las preguntas
✖ e2e/unidad.ts: 1 prueba(s) fallaron
```
Exactly test 2 fails, as expected — confirming the boundary test is not
redundant.

**Final restore verification**:
```
$ diff /tmp/prompt_backup.ts src/lib/ai/prompt.ts   → (empty, files identical)
$ sha256sum src/lib/ai/prompt.ts
53cb02623a9686a7c5a96428f81d37436643560c3b27cb2d0e36b5fb6c701492   (same as before mutation 1)
$ git diff --stat src/lib/ai/prompt.ts
 src/lib/ai/prompt.ts | 42 ++++++++++++++++++++++++++++++++++++++----
 1 file changed, 38 insertions(+), 4 deletions(-)
```
`prompt.ts` is byte-identical to its state before I began mutation testing.
Its diff against the branch base is the same 42-line diff the prior pass
already reviewed line-by-line and found correct on inspection — no new
change.

**Conclusion**: each of the four new tests can independently fail, each
fails for exactly the reason it should, and the file was left untouched.
This is real, adversarial, mutation-verified runtime coverage for the two
scenarios it covers — not merely "tests exist and pass."

### Commands run directly (real output, not taken on trust)

```
$ npx tsx e2e/unidad.ts
✔ cifrar/descifrar: ida y vuelta con el mismo AAD
✔ descifrar: un AAD distinto (ciphertext copiado a otra fila) rechaza
✔ cadenaDeMotores: un ciclo A→B→A no cuelga y corta en 2
✔ cadenaDeMotores: la cadena puede cruzar dos cuentas de proveedor distintas
✔ cadenaDeMotores: el tope de 3 eslabones se respeta aunque la cadena siga
✔ calcularCostoTurno: la resta de tokens cacheados NO duplica el cobro
✔ calcularCostoTurno: precio nulo nunca fabrica un costo
✔ calcularCostoTurno: un turno gratis da costo 0, no null
✔ calcularCostoTurno: sin tarifa de caché propia, cae a la de entrada (y lo registra así)
✔ calcularCostoTurno: Decimal(16,10) no pierde un costo de fracción de centavo
✔ formatearCostoUsd: la tabla de redondeo completa
✔ nivelDeConsumo: los tres cortes, con los bordes exactos
✔ pideCambio: una pregunta con tilde NO dispara una reescritura
✔ pideCambio: sin tilde sigue andando, como se escribe al apuro
✔ pideCambio: un pedido SIGUE siendo un pedido (la otra dirección)
✔ buildSystemPrompt: en el primer turno pide preguntar antes de construir
✔ buildSystemPrompt: el turno 2 sigue siendo temprano (el borde)
✔ buildSystemPrompt: del turno 3 en adelante ya no pregunta
✔ buildSystemPrompt: la herramienta forzada gana sobre las preguntas

✔ e2e/unidad.ts: todas las pruebas pasaron
exit code: 0
```

```
$ npm run check
> koduedu@0.1.0 check
> tsc --noEmit
(no output)
exit code: 0
```
Output hash (`sha256:ef26626cb54fb19d64d01c69cab38ca41373679bd3b916f74475dd969918871c`)
is byte-identical to the prior pass's recorded hash for the same command —
direct evidence of no type-check-relevant regression.

```
$ npm run build
> koduedu@0.1.0 build
> prisma generate && astro build
✔ Generated Prisma Client (7.9.1) to ./src/generated/prisma
[build] Server built in 2.48s
[build] Complete!
(same pre-existing "chunks larger than 500 kB" warning as the prior pass)
exit code: 0
```
The build output hash differs from the prior pass's recorded hash
(`sha256:9d393496...` vs. `sha256:a6e44481...`) — this is expected and not a
regression signal: the raw build log embeds wall-clock timestamps and
per-step millisecond durations that vary on every run (Astro/Vite print
`HH:MM:SS` prefixes and `Server built in N.NNs`). Step sequence, warning
text, and exit code are identical to the prior run.

Per instruction, the full Playwright suite was **not** re-run this pass.

### Regression check on the other four spec domains

Not re-run in full (out of scope for this pass), but spot-checked for
tampering: `git diff --stat` shows the identical file list, and identical
per-file line counts, as recorded in the prior pass's own analysis for
`catalogo.ts`, `/api/admin/models/[id].ts`, `docker/prod-entrypoint.sh`, and
`Dockerfile` (the last two: still zero diff). No file outside
`e2e/unidad.ts` shows any change in insertion/deletion counts versus what
the prior report's line-level source reads already described. I have no
reason, and found no evidence, to believe any of the 27 previously-compliant
scenarios regressed.

### Prior pass's WARNING and SUGGESTIONs — still accurately recorded

Re-confirmed present and unchanged; not silently dropped:

**WARNING** (still open, not addressed by this fix, not in scope for it):
1. `Workspace.tsx:505-510` (`handleDespublicar`) moves `isInGallery` to
   `false` optimistically and does not roll it back if the un-publish PATCH
   fails — only `setError` is called. Re-confirmed by reading the same lines
   again: unchanged. No spec scenario requires rollback on this path (the
   "never moves optimistically" language is scoped to the publish switch,
   not un-publish), so this remains a real bug, not a spec violation.

**SUGGESTIONS** (still open):
1. `IndicadorConsumo.tsx:9-13`'s header doc comment is stale — still
   describes the removed USD-reveal-on-hover behavior. Re-confirmed
   unchanged; cosmetic.
2. Consider retroactively adding the `ai-authoring-dialogue` test coverage
   gap to `design.md` §14 as a design-level correction. **Updated status**:
   half-addressed at the implementation level (unit tests for the
   forced-tool scenarios now exist) but the design document itself was not
   updated, and the harder half (the live-chat-transcript scenarios) is
   still open — this suggestion still stands for the remaining two
   scenarios.

### Updated Issues

**CRITICAL** (narrowed from 4 scenarios to 2; NOT fully closed):

1. Two of the four `ai-authoring-dialogue` scenarios — "Early turn asks
   instead of guessing" and "Later turns build without interrogating" —
   still have zero runtime coverage matching their spec-mandated
   verification method (Playwright chat-transcript inspection). The new
   unit tests in `e2e/unidad.ts` correctly close the other two scenarios
   (the forced-tool-choice collision, verified via `buildSystemPrompt`
   output per the spec's own stated unit/integration verification method)
   but do not and cannot close these two, because they never invoke a model
   or inspect a chat transcript — they inspect only the static system-prompt
   template. `tasks.md`'s own work-unit table still records the verification
   method for this area as "Manual chat transcript check (no harness for
   `stream.ts`)," and `apply-progress.md` still contains no evidence that
   manual check was ever performed. No exception was added to
   `openspec/config.yaml`. This remains a blocking CRITICAL under this
   skill's hard rule ("a spec scenario is compliant only when a covering
   test passed at runtime") — it is smaller than before, but not resolved.

**WARNING**: unchanged, see above (1 item, carried forward).

**SUGGESTION**: unchanged, see above (2 items, carried forward, item 2 updated).

### Updated Verdict

**FAIL** (narrowed scope: 29/31 scenarios compliant, 12/13 requirements
compliant, 1 requirement / 2 scenarios still CRITICAL).

The orchestrator's fix is real, correctly implemented, and independently
mutation-tested by me to a standard I trust: it genuinely closes half of the
original CRITICAL (the "Question guidance is omitted when a tool call is
forced" requirement, both scenarios, exactly matching the spec's own
mandated verification method). It does **not** close the other half (the
"Early turns favor asking over guessing" requirement, both scenarios), which
by the spec's own text requires a live Playwright chat-transcript check that
was neither added nor formally waived. The gap is genuinely narrower, but
not genuinely closed, and this change is not yet ready for archive.

**What remains before this can pass**:
1. Add a Playwright chat-transcript check (or equivalent recorded,
   reproducible integration check against a real model call) covering
   "Early turn asks instead of guessing" and "Later turns build without
   interrogating" — or, if a live-model harness is genuinely infeasible in
   this environment, get that constraint explicitly accepted as a
   documented, permanent manual-verification exception in
   `openspec/config.yaml`'s `verify` rules, with actual recorded manual
   evidence (a transcript excerpt), before treating those two scenarios as
   anything other than blocking.
2. Re-run this verify phase once that coverage (or documented exception)
   exists.

---

## Previous Pass (superseded above; preserved verbatim for audit trail)

```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:0dfa1795bde29636ac5260078ee14b41fcc840fd73b5789b28f57a5f975bf820
verdict: fail
blockers: 1
critical_findings: 4
requirements: 11/13
scenarios: 27/31
test_command: npm run check
test_exit_code: 0
test_output_hash: sha256:ef26626cb54fb19d64d01c69cab38ca41373679bd3b916f74475dd969918871c
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:a6e4448173ce1a03b88faa2763b89a3cb179f9f8ce5d7858fe07af21760b2d77
```

## Verification Report

**Change**: publicacion-likes-y-motores
**Version**: N/A (single-shot delta specs, no prior version)
**Mode**: Standard (no Strict TDD; project config `tdd: false`)

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 43 |
| Tasks complete | 43 |
| Tasks incomplete | 0 |

All 12 phases in `tasks.md` are checked `[x]`. Independently confirmed by counting checkbox markers in the file (43 `[x]`, 0 `[ ]`) — apply's own count matches.

### Build & Tests Execution

**Build**: ✅ Passed (re-run independently, not taken on trust)
```text
$ npm run build
> koduedu@0.1.0 build
> prisma generate && astro build
✔ Generated Prisma Client (7.9.1) to ./src/generated/prisma
[build] Server built in 1.86s
[build] Complete!
(one pre-existing "chunks larger than 500 kB" warning, unrelated to this change)
exit code: 0
```

**Tests (`npm run check`)**: ✅ Passed (re-run independently)
```text
$ npm run check
> koduedu@0.1.0 check
> tsc --noEmit
(no output)
exit code: 0
```

**Tests (Playwright e2e, re-run independently against the real dev server + dev DB, one script at a time, sequential)**:

| Script | Result (run 1) | Result (retry, only where run 1 failed) |
|---|---|---|
| `e2e/unidad.ts` | ✅ pass | — |
| `e2e/m9-publicacion-y-likes.ts` | ❌ timeout waiting for the publish switch to enable (`esperarSwitchListo`) | ✅ pass, all 11 item groups, clean |
| `e2e/m1-admin-shell.ts` | ✅ pass | — |
| `e2e/m2-catalogo.ts` | ❌ "Enviar" button stayed disabled after `fill()` (chat-input hydration timing) | ✅ pass, incl. the `#selector-motor` fix |
| `e2e/m3-motores.ts` | ✅ pass, incl. new items 12–16 | — |
| `e2e/m4-costos.ts` | ✅ pass, incl. rewritten 7.b/7.e/7.g (no `US$`, no `$`) | — |
| `e2e/m5-usuarios.ts` | ✅ pass | — |
| `e2e/m6-acceso.ts` | ✅ pass | — |
| `e2e/m7-demo.ts` | ✅ pass, incl. the `screenshotUrl` publish fix | — |
| `e2e/m8-proyectos-ajenos.ts` | ✅ pass | — |

Both first-run failures reproduce the exact class of flakiness apply-progress.md documented ("Playwright runs on this machine … show occasional transient flakiness under load"): one is an iframe-`onLoad` timing race unrelated to any code this change touches, the other is a chat-input hydration race unrelated to the `#selector-motor` change that same script exercises. Per the orchestrator's instruction, each was retried once and passed clean on retry with no code change. Net result: **10/10 scripts + `unidad.ts` green**, independently reproduced, not taken on trust.

Seed-data integrity (apply's Deviation 4 claim) independently confirmed via direct DB read: `AiModel` "MiniMax M3" (`…0001`) has `fallbackModelId = …0002` ("MiniMax M2.7"), the original seeded value — not `null`, not the test-only engine.

**Coverage**: Not applicable (no coverage tool configured; project config `coverage_threshold: 0`).

### Spec Compliance Matrix

#### `resource-publishing` (4 requirements, 11 scenarios — all COMPLIANT)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Publishing lives in the workspace | Creation dialog no longer offers publishing | `e2e/m9…ts` item 5 | ✅ COMPLIANT |
| Publishing lives in the workspace | Workspace still shows and controls published state | `e2e/m9…ts` item 2, 4 | ✅ COMPLIANT |
| No published resource without a cover | Capture succeeds, then publish succeeds | `e2e/m9…ts` item 2 | ✅ COMPLIANT |
| No published resource without a cover | Capture fails or preview has not rendered | `e2e/m9…ts` item 3 | ✅ COMPLIANT |
| No published resource without a cover | Direct API call with no stored cover is rejected | `e2e/m9…ts` item 1 (API-level, not UI) | ✅ COMPLIANT |
| No published resource without a cover | Pre-existing published-but-coverless rows not retroactively affected | Migration rehearsal (`rehearsal/03_down_output.txt`, row c) | ✅ COMPLIANT |
| Cover freshness is visible | Stale cover after an AI edit | `e2e/m9…ts` item 9c | ✅ COMPLIANT |
| Cover freshness is visible | Fresh cover shows ordinary label | `e2e/m9…ts` item 9a | ✅ COMPLIANT |
| Cover freshness is visible | No cover shows the capture label | `e2e/m9…ts` item 9a | ✅ COMPLIANT |
| Cover freshness is visible | Pre-existing covers not flagged stale on deploy day | Migration rehearsal (`02_apply_output.txt`, `UPDATE 2`) | ✅ COMPLIANT |
| Cover schema changes are additive and unattended | Migration and backfill run unattended | Migration rehearsal (all 4 files) | ✅ COMPLIANT |

Load-bearing invariant independently re-verified at the source, not just via the e2e script: `src/pages/api/projects/[id].ts:38-40` rejects `isInGallery: true` when `project.screenshotUrl` is falsy, unconditionally of client path. `src/pages/api/projects/[id]/screenshot.ts` DELETE clears `screenshotUrl`, `screenshotAt`, **and** `isInGallery` in one `prisma.project.update` call (the "second door" closed in the same transaction as the write, not a follow-up call).

#### `gallery-likes` (4 requirements, 8 scenarios — all COMPLIANT)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| One like per teacher per resource | Teacher likes a resource | `e2e/m9…ts` item 6 | ✅ COMPLIANT |
| One like per teacher per resource | Teacher unlikes a resource | `e2e/m9…ts` item 6 | ✅ COMPLIANT |
| One like per teacher per resource | Double-like from a double-click is not double-counted | `e2e/m9…ts` item 6, real concurrent `Promise.all` against `/api/projects/:id/like` | ✅ COMPLIANT |
| Anonymous visitors see the count but cannot like | Anonymous visitor sees count and unfilled heart | `e2e/m9…ts` item 8 | ✅ COMPLIANT |
| Anonymous visitors see the count but cannot like | Anonymous click goes to login | `e2e/m9…ts` item 8 | ✅ COMPLIANT |
| Gallery lists most-liked first | More-liked project sorts first | `e2e/m9…ts` item 7a | ✅ COMPLIANT |
| Gallery lists most-liked first | Equal like counts fall back to recency | `e2e/m9…ts` item 7b | ✅ COMPLIANT |
| Likes schema migration is additive and unattended | Migration runs unattended on deploy | Migration rehearsal | ✅ COMPLIANT |

`gallery.astro` independently re-read: single `projectLike.findMany({ where: { userId, projectId: { in: [...60 ids] } } })` resolves "did I like these 60" — one query, not 60 (no N+1), skipped entirely for anonymous visitors. `@@unique([userId, projectId])` confirmed present in `schema.prisma`.

#### `ai-model-catalog` (2 requirements, 6 scenarios — all COMPLIANT)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Ordering/enable-disable/visibility distinct | Turning off selectableByTeacher hides from teachers, fallback still resolves | `e2e/m3…ts` items 12, 15 | ✅ COMPLIANT |
| Ordering/enable-disable/visibility distinct | DeepSeek-style config remains expressible | `e2e/m3…ts` item 15 + DB read (`selectableByTeacher: false`/`enabled: true` survives reload) | ✅ COMPLIANT |
| Ordering/enable-disable/visibility distinct | Disabling a fallback target warns first | `e2e/m3…ts` item 14 (warning text, Cancelar/Sacarlo igual) | ✅ COMPLIANT |
| Ordering/enable-disable/visibility distinct | Setting a new default unsets the previous one | `e2e/m3…ts` "setear un nuevo default desmarca el anterior" | ✅ COMPLIANT |
| Teacher-facing selector is a dropdown | Selector renders as dropdown with hover description | `e2e/m3…ts` item 16 (listbox, keyboard, tap) | ✅ COMPLIANT |
| Teacher-facing selector is a dropdown | Selector excludes models not selectable by teacher | `e2e/m3…ts` "deshabilitar un motor no-default lo saca del selector" | ✅ COMPLIANT |

`cadenaDeMotores()` independently re-read (`src/lib/ai/catalogo.ts:177-196`): its `utilizable()` gate checks only `enabled` (motor + provider), never `selectableByTeacher` — the fallback chain is provably blind to the teacher-visibility flag, matching the DeepSeek-configuration requirement at the source, not just at test-observed behavior. Byte-identical confirmed via `git diff --stat` (no diff) for `catalogo.ts` and `/api/admin/models/[id].ts`.

#### `ai-cost-accounting` (1 requirement, 2 scenarios — all COMPLIANT)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Teacher-facing cost indicator | Default reading is neutral | `e2e/m9…ts` item 10; `e2e/m4-costos.ts` | ✅ COMPLIANT |
| Teacher-facing cost indicator | No interaction reveals a dollar amount | `e2e/m4-costos.ts` (hover/tap/click/keyboard-focus, both themes) | ✅ COMPLIANT |

`IndicadorConsumo.tsx` independently re-read: no `costUsd` prop, no `formatearCostoUsd` import, no price-conditional branch left. Admin surfaces (`usuarios/[id].astro`, `GraficoBarras.tsx`, `ModeloForm.tsx`) independently confirmed to still show exact `US$` amounts — the teacher/admin split is real, not merely claimed.

#### `ai-authoring-dialogue` (2 requirements, 4 scenarios — **ALL UNTESTED, CRITICAL**)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Early turns favor asking over guessing | Early turn asks instead of guessing | **none found** | ❌ **UNTESTED** |
| Early turns favor asking over guessing | Later turns build without interrogating | **none found** | ❌ **UNTESTED** |
| Question guidance omitted when tool call is forced | Forced tool choice omits question guidance | **none found** | ❌ **UNTESTED** |
| Question guidance omitted when tool call is forced | Non-forced early turn keeps the question guidance | **none found** | ❌ **UNTESTED** |

See CRITICAL findings below — this is not a minor gap, it is the entire spec domain.

**Compliance summary**: 27/31 scenarios compliant (13 requirements: 11 compliant, 2 untested).

### Correctness (Static Evidence, in addition to the runtime evidence above)

| Requirement area | Status | Notes |
|---|---|---|
| `stream.ts` `forzar` hoist | ✅ Implemented, behaviour-preserving | `pideCambio(message)` is pure; `message` does not mutate between the original call site (former `:511`) and the new one (`:419`); reused unchanged at both `:434` (prompt) and `:529` (`forzarHerramienta`). Confirmed by direct read, not inference. |
| `renderPreguntas` collision rule | ✅ Implemented correctly | `src/lib/ai/prompt.ts:120-129`: `herramientaForzada` short-circuits to `''` before the turn-count check. Logic is correct on inspection — **but has zero runtime test**, see CRITICAL below. |
| DELETE `/screenshot` "second door" | ✅ Implemented correctly | `screenshotUrl`, `screenshotAt`, `isInGallery` cleared in one `prisma.project.update` call — not two sequential writes that could race or partially land. |
| Migration: no un-publish SQL | ✅ Confirmed | `migration.sql` contains no `UPDATE ... SET "isInGallery" = false`; the file's own closing comment documents this decision and why the rollback direction of that decision is intentionally irreversible. |
| `docker/prod-entrypoint.sh` / `Dockerfile` | ✅ Untouched | `git diff --stat` against both paths is empty. |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| Design §14 testing strategy | ⚠️ Partially | The design's own testing-strategy table never allocates any coverage (unit or e2e) to §10 (early-turn questioning / collision rule) despite spec `ai-authoring-dialogue` explicitly requiring both a Playwright chat-transcript check and a `buildSystemPrompt`-output unit check. This gap is inherited from design, not introduced by apply — but apply also did not flag or escalate it. |
| Deviation 1 (FichaDialog `descripcion` prop) | ✅ Followed, correctly scoped | Confirmed by reading `FichaDialog.tsx` — no "pestaña Ficha" string remains anywhere in the file. |
| Deviation 2 (m2-catalogo.ts undeclared break) | ✅ Followed, correctly scoped | Confirmed: `#selector-motor:has-text(...)` assertion present and passing. |
| Deviation 3 (`portadaVieja` guard on `screenshotUrl`) | ✅ Followed, correctly scoped | Confirmed via `e2e/m9…ts` item 9a: a coverless project shows "Sacar portada," never "Actualizar portada." |
| Deviation 4 (seed-data restoration) | ✅ Followed, correctly scoped | Confirmed via direct DB read (see above), not just re-running the suite. |
| Deviation 5 (`onAntesDePublicar` prop) | ✅ Followed, correctly scoped | Confirmed: `flushSave` wired through `Workspace.tsx:650` → `PreviewPanel`'s `onChange` calls it before `pedirCaptura`. |
| Proposal's "already on this branch" disclosure (`ToolChoiceNoSoportado`) | ✅ Correctly disclosed | `provider.ts` carries a real, undisclosed-by-tasks.md but explicitly-disclosed-by-proposal.md functional change (forced-tool-choice retry for reasoning models). Proposal states it predates this change and carries no capability delta — verified it is provider-agnostic and unrelated to any spec in this change. Not a hidden deviation. |

### Issues Found

**CRITICAL**:

1. **The entire `ai-authoring-dialogue` spec domain (2 requirements, 4 scenarios) has zero runtime test coverage.** No e2e script and no unit test anywhere in `e2e/` exercises `buildSystemPrompt`, `renderPreguntas`, `turnosPrevios`, or `herramientaForzada`. This is not a borderline case: `grep -rn "buildSystemPrompt|renderPreguntas|turnosPrevios|herramientaForzada" e2e/*.ts` returns nothing. Two of the four scenarios ("Forced tool choice omits question guidance," "Non-forced early turn keeps the question guidance") have a spec-mandated verification method of "unit/integration check of `buildSystemPrompt` output" — this is a pure function with no DOM and no server dependency, directly comparable to the existing pure-function tests for `pideCambio`, `cadenaDeMotores`, and `calcularCostoTurno` already living in `e2e/unidad.ts`. Nothing prevented adding it. My own source-level reading of `src/lib/ai/prompt.ts:120-129` and `src/pages/api/chat/stream.ts:415-434` finds the logic implemented correctly, but per this skill's hard rule ("Execute relevant tests; static analysis alone is never verification" / "A spec scenario is compliant only when a covering test passed at runtime"), correct-looking source is not compliance. The other two scenarios (the actual early-turn chat-transcript behavior) require a live-model Playwright check per the spec's own text; none exists, and none is even attempted manually with recorded evidence — `tasks.md`'s own work-unit table for Phase 9 lists the test command as "Manual chat transcript check (no harness for `stream.ts`)," and `apply-progress.md` contains zero evidence that this manual check was ever actually performed (no transcript excerpt, no described session). This gap originates in `design.md` §14, which never allocates coverage to §10 at all — it is not an apply-phase oversight alone, but apply also did not escalate or flag it as a known gap before declaring "43/43 tasks complete... Ready for verify."

**WARNING**:

1. `Workspace.tsx:505-510` (`handleDespublicar`) moves `isInGallery` to `false` optimistically and does **not** roll it back if the un-publish `PATCH` fails — only `setError` is called. The UI would then show "unpublished" while the server still has the resource published, until the next reload. No spec scenario explicitly requires rollback here (the spec's "never moves optimistically" language is scoped to the *publish* switch, not the un-publish path), so this is not a spec violation, but it is a real, easily reachable state-desync bug on network failure.

**SUGGESTION**:

1. `IndicadorConsumo.tsx:9-13`'s header doc comment is stale: it still describes the pre-change behavior ("El monto exacto en USD se revela con mouse, toque O foco de teclado") that this very change explicitly removes. Purely cosmetic — the component itself has no USD-related code left — but it will mislead the next reader.
2. Consider retroactively adding the missing `ai-authoring-dialogue` test coverage to `design.md` §14 as a design-level correction, not only as an apply-level patch, so the same gap-class doesn't recur for future prompt-composition changes.

### Verdict

**FAIL**

43/43 tasks are genuinely complete, `npm run check` and `npm run build` are independently reproduced clean, all 10 e2e scripts + `unidad.ts` are independently reproduced green (two flaky reruns, consistent with the documented Pi hardware contention, neither related to the code paths their scripts exercise), the load-bearing publish invariant is enforced server-side and independently confirmed at the API (not just the UI), the owner's "leave existing coverless-published rows alone" decision is confirmed absent from the migration SQL, and 27 of 31 spec scenarios across four of five spec domains are genuinely test-covered and passing. But one full spec domain — `ai-authoring-dialogue`, 2 requirements and 4 scenarios — has no passing (or even attempted, with recorded evidence) runtime test anywhere in the repository, which this skill's hard rules treat as a blocking CRITICAL regardless of how confident source inspection makes me that the implementation is correct. Verify cannot pass a change with an entire untested spec domain.

**What remains before this can pass**:
1. Add a unit/integration test (in `e2e/unidad.ts` or equivalent) asserting `buildSystemPrompt(...)` output excludes `PREGUNTAS_TEMPRANAS` when `herramientaForzada: true`, and includes it when `herramientaForzada: false` and `turnosPrevios <= TURNOS_TEMPRANOS` — covering both remaining scenarios of "Question guidance is omitted when a tool call is forced."
2. Add a Playwright chat-transcript check (or an equivalent recorded, reproducible integration check) covering "Early turn asks instead of guessing" and "Later turns build without interrogating" — or, if a live-model harness is genuinely infeasible in this environment, get that constraint explicitly accepted as a documented, permanent manual-verification exception in `openspec/config.yaml`'s `verify` rules before treating those two scenarios as anything other than blocking.
3. Re-run this verify phase once coverage exists.
