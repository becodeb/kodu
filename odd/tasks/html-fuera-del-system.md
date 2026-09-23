# Current HTML out of the system prompt

## Objective

Make the conversation history cacheable by the providers' automatic prefix cache.

## Problem

`buildSystemPrompt` (`src/lib/ai/prompt.ts:273`) ends with `renderCurrentHtml`: the
current resource HTML (up to 200,000 chars). The history (up to 40 messages) is sent
after the system message (`src/pages/api/chat/stream.ts:768`). Every turn that changes
the HTML changes the system message, so the cached prefix stops right before the HTML
and the whole history is billed at full input price on every turn.

## Why

Prefix caching bills cached input at a fraction of the price (DeepSeek: 0.006 vs 0.3
per million). The static part (BASE_PROMPT + rules, ~3K tokens) is already cached; the
history is the part that grows and is not.

## Scope

- Move the "current resource" block (HTML, title, teacher-edited flag) from the system
  message to the final user turn, in every call site: main turn and versions
  (`stream.ts`), revision passes (`stream.ts`), visual review (`visual-review.ts`).
- Keep everything else in the system prompt in its current order.
- Update prompt wording that points to the HTML's location.
- Stored chat history is unchanged: the HTML is never persisted into messages.

## Constraints

- No change to what the model receives, only where. No new dependencies.
- Multimodal user content (image parts) must keep working.
- `maxInputChars` / truncation accounting must still count the HTML.

## Tasks

- [x] T1 — Move the current-resource block to the final user turn in all call sites;
  update wording; keep truncation/accounting correct. Check: `npm run check`.
- [ ] T2 — Prove it with the mock provider: across two consecutive turns where the HTML
  changes, the system message and history are byte-identical; existing e2e that inspect
  the prompt still pass. Check: the new/updated `npx tsx e2e/<slice>.ts`.

## Acceptance criteria

- System message has no HTML; it is identical between turns of the same project unless
  rules, assets or the early-questions block change.
- The final user message carries the current resource block before the teacher's text.
- Versions, revision and visual review still receive the current HTML.

## Checks and mode

- TDD: off (no configured mode; repo has no test runner). Functional checks only.
- Gates: `npm run check` (tsc), hand-rolled e2e with `e2e/mock-proveedor.ts`.
- RDD: disabled globally by the user; no review.

## Routing

- T1+T2: delegated direct (writer trigger: 3 non-trivial files).

## Progress

- Branch `feat/html-fuera-del-system` created from `main` at `57d4cd7`.
- T1 done: `buildSystemPrompt` no longer calls `renderCurrentHtml`. That
  function is now exported as `buildCurrentResourceBlock(currentHtml,
  projectTitle, htmlEditedByTeacher)` and is prepended to the final user
  message (before the teacher's text / instruction) at all four call sites:
  main turn and T7 correction pass in `stream.ts` (`POST`/`revisarYCorregir`),
  T9's per-version correction pass in `stream.ts`
  (`generarVersionSecundaria`), and T8's visual review in
  `visual-review.ts`. `PromptContext` dropped `currentHtml`/`projectTitle`/
  `htmlEditedByTeacher` — unused elsewhere. Persisted `ChatMessage.content`
  still holds only the teacher's raw text (unchanged, verified by reading
  the code path: `buildUserContent`'s HTML-prefixed content never reaches
  `prisma.chatMessage.create`). `maxInputChars` truncation already only
  checked `message.length` before this change (never summed HTML), so no
  regression there; the HTML's own `MAX_HTML_CHARS` cut inside
  `buildCurrentResourceBlock` is unchanged. Updated wording in `BASE_PROMPT`
  ("el recurso... abajo" → "...en tu último mensaje de usuario") and two
  internal comments that referenced the old location. Updated
  `e2e/unidad.ts`'s `buildSystemPrompt` unit tests: the byte-identical test
  now compares the whole prompt (no more slicing at the old HTML marker),
  added an explicit "no HTML in system prompt" test, and moved the
  kit-folding test to call `buildCurrentResourceBlock` directly.
  `npm run check`: clean. Commit `3599cac613c335c69c8ecb2a98b04bf9c0b8f51d`
  on `feat/html-fuera-del-system`.

## Next step

T2.
