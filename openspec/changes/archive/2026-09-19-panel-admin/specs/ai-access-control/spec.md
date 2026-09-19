# AI Access Control Specification

## Purpose

Authorized domains move from an env var to the database, and their
meaning changes: registration is open to anyone, and only AI usage is
gated. A per-user override takes precedence over the domain rule.

## Requirements

### Requirement: Authorized domains live in the database

The system MUST store the authorized-domain list in the database,
editable from `/admin`, replacing the env-var source.

#### Scenario: Admin adds a domain without redeploy

- GIVEN an admin adds a new authorized domain in `/admin`
- WHEN that change is saved
- THEN it takes effect for subsequent requests without a redeploy
- Verification: DB state inspection

### Requirement: Gate applies to AI usage, not registration

Registration MUST succeed regardless of the registering email's domain.
The domain check MUST apply only when a user attempts to use the AI.

#### Scenario: Unauthorized-domain user can register

- GIVEN an email domain not on the authorized list
- WHEN that person registers
- THEN the account is created successfully
- Verification: Playwright browser check

#### Scenario: Unauthorized-domain user is blocked from AI use

- GIVEN the same account, still on an unauthorized domain, with no
  per-user override
- WHEN that user sends a chat prompt
- THEN the AI request is blocked
- Verification: Playwright browser check

### Requirement: Per-user override precedence

A per-user AI-access override MUST take precedence over the domain rule
in both directions: granting access despite an unauthorized domain, or
revoking it despite an authorized one.

#### Scenario: Override grants access on an unauthorized domain

- GIVEN a user on an unauthorized domain
- WHEN an admin sets that user's override to granted
- THEN the user's next AI request succeeds
- Verification: Playwright browser check

### Requirement: Revocation applies to the next turn

Revoking a user's AI access MUST take effect starting with that user's
next turn. It MUST NOT interrupt a turn already streaming.

#### Scenario: In-flight turn completes, next one is blocked

- GIVEN a user mid-stream on a chat response
- WHEN an admin revokes that user's AI access during the stream
- THEN the in-flight response completes normally
- AND the user's following prompt is blocked with a message such as "Ya
  no tenés acceso a la IA. Pedile a un admin que te habilite."
- Verification: Playwright browser check, both themes
