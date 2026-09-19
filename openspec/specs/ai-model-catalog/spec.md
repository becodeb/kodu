# AI Model Catalog Specification

## Purpose

Models as data. The `AiModel` table replaces the compile-time
`ModelChoice` enum: provider, encrypted key, base URL, provider-side
model id, friendly name, admin description, pricing, order, enabled
state and default selection, plus the teacher-facing selector copy.

## Requirements

### Requirement: AiModel data model

The system MUST store, per model: provider, encrypted API key, base URL,
provider-side model id, friendly name, admin-facing description, pricing
(per-million input/output/cached-input tokens), display order, an
enabled flag, and a default flag.

#### Scenario: Creating a model persists all fields

- GIVEN an admin submits a new model with provider, pricing and copy
  fields
- WHEN the model is saved
- THEN every submitted field is present on the stored row
- Verification: DB state inspection

### Requirement: Pricing is one flat, approximate rate set

Each model MUST carry exactly one rate set (input, output, cached-input
per-million-token prices), not separate peak/off-peak rates, even for a
provider whose real billing varies by hour (e.g. a provider that bills
double during specific UTC windows). The admin-facing model form MUST
label the pricing fields as an approximate USD rate, and the design MUST
record the resulting margin of error rather than implying an exact
figure.

(Rationale: the owner asked for an approximate USD cost, not exact
billing reconciliation; time-of-day rate pairs are a single-provider
billing quirk that would add dead fields to every other provider's
config form.)

#### Scenario: Admin enters a single rate set

- GIVEN an admin configures pricing for a model from a provider with
  variable hourly rates
- WHEN they fill the pricing fields
- THEN the form shows one input, one output and one cached-input rate,
  labeled as an approximate USD price, with no peak/off-peak fields
- Verification: Playwright browser check, both themes

### Requirement: Key encryption at rest

The system MUST encrypt API keys with AES-256-GCM before persisting them
and MUST NOT transmit a decrypted key to the browser under any request.

#### Scenario: Stored key is ciphertext

- GIVEN a model with a saved API key
- WHEN the raw `AiModel` row is inspected
- THEN the key column does not match the plaintext key
- Verification: DB state inspection

#### Scenario: Admin UI never renders the full key

- GIVEN an admin opens the model edit form
- WHEN the key field renders
- THEN it shows a masked tail and a replace field, never the full key
- Verification: Playwright browser check

### Requirement: Ordering, enable/disable, single default

The system MUST let an admin reorder models, toggle each one enabled or
disabled, and hold exactly one model marked as default at any time.

#### Scenario: Disabling a model removes it from the selector

- GIVEN an enabled model shown in the teacher selector
- WHEN an admin disables it
- THEN it no longer appears in the selector
- Verification: Playwright browser check

#### Scenario: Setting a new default unsets the previous one

- GIVEN model A is the current default
- WHEN an admin sets model B as default
- THEN exactly one row has the default flag, and it is B
- Verification: DB state inspection

### Requirement: Fallback when a project's model is disabled

When an admin disables a model that a project still references, the
system MUST repoint that project to the current default model on its
next use (not via a bulk migration) and MUST notify the teacher once,
quietly — a low-key workspace notice, not a modal or alarm.

#### Scenario: Project silently repoints and notifies once

- GIVEN a project whose selected model was just disabled
- WHEN the teacher opens that project
- THEN the project now uses the current default model
- AND a quiet notice appears, e.g. "Cambiamos el motor de este proyecto
  porque el anterior ya no está disponible."
- Verification: Playwright browser check, both themes
  (`[data-theme='dark']` and default)

#### Scenario: Notice does not repeat

- GIVEN the teacher already saw the repoint notice for a project
- WHEN they open the same project again
- THEN the notice does not reappear
- Verification: Playwright browser check

### Requirement: Teacher-facing selector copy

The model selector in the workspace MUST show each enabled model's
friendly name and admin description, ordered per the admin's configured
order, and MUST NOT expose the provider-side model id.

#### Scenario: Selector renders name and description

- GIVEN two enabled models with distinct friendly names and descriptions
- WHEN a teacher opens the model selector
- THEN both render with name and description, in configured order
- Verification: Playwright browser check, both themes
