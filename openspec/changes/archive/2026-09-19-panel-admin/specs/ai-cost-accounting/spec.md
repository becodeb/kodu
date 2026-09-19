# AI Cost Accounting Specification

## Purpose

Bind token usage to a project, track cached-input tokens, freeze a cost
snapshot at write time, and surface cost to teachers without turning a
pedagogical tool into a meter that discourages use.

## Requirements

### Requirement: TokenUsage carries project and cost

Every new `TokenUsage` row MUST carry a `projectId`, `cachedInputTokens`,
and a cost snapshot computed from the writing model's pricing at the
moment of write.

#### Scenario: A chat turn writes a complete usage row

- GIVEN a teacher completes a chat turn in a project
- WHEN the `stream.ts` `finally` block writes usage
- THEN the row has `projectId` set and a cost matching the model's price
  at that moment
- Verification: DB state inspection

### Requirement: Historical rows render as "histórico"

Existing `TokenUsage` rows written before this change have no project and
no cost. The system MUST NOT back-fill them with current prices and MUST
render them with a null cost labeled "histórico".

#### Scenario: Pre-migration row shows no dollar figure

- GIVEN a `TokenUsage` row written before this change
- WHEN it appears in any admin or user-facing usage view
- THEN it displays "histórico" and no dollar amount
- Verification: Playwright browser check

### Requirement: Frozen cost snapshots are immutable

A later edit to a model's pricing MUST NOT alter cost snapshots already
written to existing `TokenUsage` rows.

#### Scenario: Price edit does not rewrite history

- GIVEN a `TokenUsage` row with a frozen cost of $0.02
- WHEN an admin changes that model's price
- THEN the existing row's frozen cost remains $0.02
- Verification: DB state inspection

### Requirement: Teacher-facing cost indicator

The workspace MUST show a discreet, per-project consumption indicator
as a qualitative level ("Consumo bajo" / "medio" / "alto"), with no
currency and no invented unit shown by default. The term "ficha" MUST NOT
be used for consumption: in this app "Ficha" already names the resource's
title-and-description card and its workspace tab, and the two meanings
would collide on the same screen. The
exact USD amount MUST reveal only on hover, tap, or keyboard focus, and
the reveal control MUST be reachable by keyboard alone.

#### Scenario: Default reading is neutral

- GIVEN a project with recorded usage
- WHEN the teacher views the workspace
- THEN the indicator shows a qualitative consumption level with no
  currency and no invented unit
- Verification: Playwright browser check, both themes

#### Scenario: Hover or tap reveals the same amount in USD

- GIVEN the neutral indicator is visible
- WHEN the teacher hovers or taps it
- THEN it reveals the exact USD amount describing the same underlying
  number
- Verification: Playwright browser check

#### Scenario: Keyboard-only reveal

- GIVEN the teacher navigates with Tab only, no mouse
- WHEN focus lands on the indicator and they press Enter or Space
- THEN the USD amount reveals
- Verification: Playwright browser check (keyboard-only interaction)

### Requirement: Admin cost visibility is unconditional

Every `/admin` surface MUST show exact USD cost directly, with no reveal
interaction required.

#### Scenario: Admin views show USD without interaction

- GIVEN an admin viewing the users table or a user's detail view
- WHEN the page renders
- THEN USD figures are visible without hover, tap, or focus
- Verification: Playwright browser check, both themes
