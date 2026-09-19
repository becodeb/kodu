# Delta for AI Model Catalog

## MODIFIED Requirements

### Requirement: AiModel data model

The system MUST store, per model: a reference to its owning
`AiProvider` account, provider-side model id, friendly name,
admin-facing description, pricing (per-million input/output/cached-input
tokens), display order, an enabled flag, and a default flag. Provider,
encrypted API key, and base URL MUST NOT be stored on `AiModel` — they
live on the referenced `AiProvider`.

(Previously: provider, encrypted API key, and base URL were stored
directly on `AiModel`; they now live on `AiProvider` and `AiModel`
holds a `providerId` foreign key instead.)

#### Scenario: Creating a model persists all fields

- GIVEN an admin submits a new model with a `providerId`, pricing and
  copy fields
- WHEN the model is saved
- THEN every submitted field is present on the stored row
- AND the row has no `provider`, `apiKeyCipher`, or `baseUrl` columns
- Verification: DB state inspection

#### Scenario: Model form requires selecting an existing provider

- GIVEN no `AiProvider` rows exist yet
- WHEN an admin opens the new-model form
- THEN the form shows an empty state pointing at the providers screen
  instead of a usable provider field
- AND the model creation API rejects a request missing `providerId`
- Verification: Playwright browser check, both themes

### Requirement: Key encryption at rest

The system MUST encrypt API keys with AES-256-GCM before persisting
them on `AiProvider` and MUST NOT transmit a decrypted key to the
browser under any request. The additional authenticated data (AAD)
MUST be the id of the row that owns the ciphertext — the `AiProvider`
row, not the `AiModel` rows that reference it.

(Previously: the encrypted key lived on `AiModel` and the AAD was the
`AiModel.id`; both now belong to `AiProvider`.)

#### Scenario: Stored key is ciphertext

- GIVEN a provider with a saved API key
- WHEN the raw `AiProvider` row is inspected
- THEN the key column does not match the plaintext key
- Verification: DB state inspection

#### Scenario: Admin UI never renders the full key

- GIVEN an admin opens the provider edit form
- WHEN the key field renders
- THEN it shows a masked tail and a replace field, never the full key
- Verification: Playwright browser check

#### Scenario: Model API responses never include the provider's cipher

- GIVEN a model whose provider has a saved API key
- WHEN an admin calls any `GET /api/admin/models` endpoint
- THEN the response includes no ciphertext for the model's provider
- Verification: DB state inspection of response payload

## ADDED Requirements

### Requirement: Model identity is unique per provider account

The uniqueness of a model's provider-side identity MUST be scoped to
the owning `AiProvider` account (`@@unique([providerId, providerModel])`),
not to the provider's kind or label. The same `providerModel` string
MAY be configured on two different `AiProvider` accounts of the same
`kind`.

#### Scenario: Same provider-model string on two accounts of the same kind

- GIVEN two `AiProvider` rows of kind "gmi" with different API keys
- WHEN an admin creates a model with `providerModel` "gmi-large" on
  each account
- THEN both model rows persist without a uniqueness violation
- AND the teacher selector shows both, distinguished by `displayName`
- Verification: DB state inspection + Playwright browser check

#### Scenario: Duplicate provider-model string on the same account is rejected

- GIVEN an `AiProvider` already has a model with `providerModel`
  "gmi-large"
- WHEN an admin tries to create a second model with the same
  `providerModel` on the same provider
- THEN the request is rejected with a uniqueness violation
- Verification: DB state inspection

### Requirement: Model-level fallback chain may span providers

`fallbackModelId` MUST remain a self-relation on `AiModel`. The
fallback traversal MUST NOT change behavior as a result of the
provider split, and a fallback chain MAY link a model on one
`AiProvider` to a model on a different `AiProvider`.

#### Scenario: Fallback chain crosses two providers

- GIVEN model A on provider 1 has `fallbackModelId` pointing at model B
  on provider 2
- WHEN model A's request fails and the fallback chain is traversed
- THEN model B is used as the fallback, resolved via provider 2's key
  and base URL
- Verification: DB state inspection + integration check of
  `cadenaDeMotores()`
