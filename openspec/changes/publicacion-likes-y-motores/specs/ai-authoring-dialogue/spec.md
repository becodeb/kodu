# AI Authoring Dialogue Specification

## Purpose

Governs when the model asks a clarifying question instead of guessing while
building a resource, bounded to early conversation turns, and its
interaction with the forced tool choice that makes the model write code.

## Requirements

### Requirement: Early turns favor asking over guessing

On early turns of a project's conversation (a bounded turn window, sized in
design — not fixed here), `buildSystemPrompt` MUST instruct the model to ask
about information it does not have rather than inventing it, bounded to a
small number of questions rather than an open-ended interrogation.
`PromptContext` MUST carry a turn signal (the thread's message count) so the
prompt can distinguish early turns from later ones.

#### Scenario: Early turn asks instead of guessing

- GIVEN a new project whose thread has fewer messages than the early-turn
  threshold
- WHEN the teacher sends an underspecified request (e.g. "hazme un
  formulario")
- THEN the model's response asks about the missing specifics rather than
  producing a finished build
- Verification: Playwright browser check (chat transcript inspection)

#### Scenario: Later turns build without interrogating

- GIVEN a project whose thread has passed the early-turn threshold
- WHEN the teacher sends a request
- THEN the model proceeds to build rather than asking clarifying questions,
  unless the request is itself ambiguous enough to require one
- Verification: Playwright browser check (chat transcript inspection)

### Requirement: Question guidance is omitted when a tool call is forced

Whenever `forzarHerramienta` causes the provider request to force the
code-editing tool choice (`stream.ts:518`, when `pideCambio(message)` is
true), the early-turn question guidance MUST be omitted from that request's
system prompt. The system MUST NOT send both "ask a clarifying question" and
"you must call this tool now" in the same request.

#### Scenario: Forced tool choice omits question guidance

- GIVEN an early-turn message that is within the early-turn window and also
  triggers `pideCambio`, forcing the tool choice
- WHEN `buildSystemPrompt` composes the system prompt for that request
- THEN the early-turn question guidance is absent from the prompt
- Verification: unit/integration check of `buildSystemPrompt` output

#### Scenario: Non-forced early turn keeps the question guidance

- GIVEN an early-turn message that does not trigger `pideCambio`
- WHEN `buildSystemPrompt` composes the system prompt
- THEN the early-turn question guidance is present
- Verification: unit/integration check of `buildSystemPrompt` output
