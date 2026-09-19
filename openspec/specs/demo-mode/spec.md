# Demo Mode Specification

## Purpose

A global toggle exposing one shared, persistent demo account with its
own token ceiling — the only real cap, since this codebase has no rate
limiting anywhere.

## Requirements

### Requirement: Global toggle

`AppSettings` MUST hold a demo-mode boolean. Toggling it MUST take effect
on the next request, with no redeploy.

#### Scenario: Turning demo mode on shows the login entry

- GIVEN demo mode is off
- WHEN an admin turns it on
- THEN `/login` shows the demo entry line on the next request
- Verification: Playwright browser check, both themes

#### Scenario: Turning demo mode off disables the demo account immediately

- GIVEN demo mode is on and the demo account is in use
- WHEN an admin turns it off
- THEN the entry line disappears and the demo account's next AI request
  is blocked
- Verification: Playwright browser check

### Requirement: Shared persistent demo account

Demo mode MUST use one shared account whose projects and threads persist
across visitor sessions, not a fresh ephemeral account per visitor.

#### Scenario: Content persists between demo sessions

- GIVEN one demo visitor creates a resource
- WHEN a later visitor enters the demo
- THEN that resource is still present under the same demo account
- Verification: DB state inspection

### Requirement: Token ceiling is the only cap

The demo account MUST have its own token ceiling, tracked like any other
user's `TokenUsage`. The system MUST NOT imply additional protection —
there is no rate limiting in this codebase; the ceiling is the sole
abuse cap.

#### Scenario: Demo usage accrues toward the ceiling

- GIVEN the demo account sends chat turns
- WHEN usage rows are written
- THEN they accumulate against the demo account's own ceiling, separate
  from any other user's
- Verification: DB state inspection

### Requirement: Ceiling-exhausted messaging

When the demo account reaches its ceiling, a visitor MUST see a sober
message inviting them to create a real account — never a raw error or a
dead end.

#### Scenario: Visitor sees the invitation, not an error

- GIVEN the demo account has reached its ceiling
- WHEN a visitor sends a prompt
- THEN they see a message such as "Llegaste al tope de la demo. Creá tu
  cuenta para seguir generando recursos." with a working link to
  register
- Verification: Playwright browser check, both themes

### Requirement: Discreet login entry

`/login` MUST show a discreet entry line to the demo account only while
demo mode is on, and it MUST NOT compete visually with the primary login
form.

#### Scenario: Entry line renders discreetly in both themes

- GIVEN demo mode is on
- WHEN a visitor opens `/login`
- THEN the demo entry line is present but visually secondary to the
  login form, in both themes
- Verification: Playwright browser check

### Requirement: Demo-created gallery resources are marked and purgeable

Gallery resources published by the demo account MUST be marked as
demo-created, and an admin MUST be able to bulk-purge all demo-created
gallery resources from `/admin` in one action.

#### Scenario: Bulk purge removes only demo-marked resources

- GIVEN the gallery has resources from both real teachers and the demo
  account
- WHEN an admin runs the bulk purge
- THEN only demo-marked resources are removed; teacher resources remain
- Verification: DB state inspection
