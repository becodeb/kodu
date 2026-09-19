# AI Provider Catalog Specification

## Purpose

The provider account as its own entity, split out of `AiModel`. An
`AiProvider` row stores one API key once — kind, human label, base URL,
encrypted key, key hint, and an account-level enabled flag — so many
`AiModel` rows can point at it, and the same provider kind can be
configured twice against two different accounts.

## Requirements

### Requirement: AiProvider data model

The system MUST store, per provider account: a stable `kind` slug, a
human-facing `label`, `baseUrl`, an encrypted API key, a key hint (last
4 plaintext characters), an enabled flag, and timestamps.

#### Scenario: Two accounts of the same kind coexist

- GIVEN an admin creates a "gmi" provider labeled "GMI — school" with
  key A
- WHEN they create a second "gmi" provider labeled "GMI — personal"
  with key B
- THEN both providers persist as distinct rows with distinct keys
- Verification: DB state inspection

### Requirement: Zero manual post-deploy steps

The data migration that introduces `AiProvider` and backfills it from
existing `AiModel` rows MUST be pure SQL, MUST be idempotent under
`prisma migrate deploy` (the `_prisma_migrations` ledger plus its Postgres
advisory lock is the mechanism; the file itself is not replayable past its
`DROP COLUMN` statements, which is why those run last), and MUST
require no operator action beyond `prisma migrate deploy` already run
by `docker/prod-entrypoint.sh`. Every API key stored before the
migration MUST still decrypt correctly afterward, with no re-encryption
step.

#### Scenario: Push-only deploy preserves every key

- GIVEN a production database with existing `AiModel` rows holding
  encrypted keys
- WHEN the Coolify webhook fires and `prisma migrate deploy` runs the
  migration unattended
- THEN the app starts and serves requests
- AND every pre-existing API key still decrypts successfully
- Verification: DB state inspection (post-deploy decrypt check)

#### Scenario: Migration re-run is a no-op

- GIVEN the migration has already applied once
- WHEN `prisma migrate deploy` runs again (e.g. a second deploy with no
  new migration)
- THEN no duplicate `AiProvider` rows are created and no data changes
- Verification: DB state inspection

### Requirement: Migration preserves the encryption AAD

Each `AiProvider` created by the migration MUST be assigned the `id` of
the `AiModel` row whose ciphertext it inherits (the "anchor"), so the
AES-256-GCM additional authenticated data — the owning row's id — is
unchanged. The migration MUST NOT decrypt or re-encrypt any key.

#### Scenario: Inherited ciphertext still authenticates

- GIVEN an `AiModel` row with a non-null `apiKeyCipher` becomes the
  anchor for a new `AiProvider`
- WHEN the migration runs
- THEN the new `AiProvider.id` equals that `AiModel`'s original id
- AND the ciphertext decrypts successfully using that id as AAD, with
  no encryption or decryption performed during migration
- Verification: DB state inspection + decrypt check

### Requirement: Conservative grouping prevents silent key loss

The migration MUST group existing `AiModel` rows by (`provider`,
`baseUrl`) and, within each group, MUST NOT merge two or more rows that
carry distinct non-null ciphers into one `AiProvider`. Ciphertext
comparison MUST NOT be used to decide whether two ciphers represent the
same key, because AES-256-GCM's random nonce makes two encryptions of
identical plaintext differ.

#### Scenario: All-NULL group folds into one provider

- GIVEN a group of `AiModel` rows sharing (`provider`, `baseUrl`), all
  with a NULL `apiKeyCipher`
- WHEN the migration runs
- THEN exactly one `AiProvider` is created for the group, with a
  deterministic id reused from the group's own rows (`MIN(id)`) and no
  cipher. It MUST NOT be `gen_random_uuid()`: no ciphertext is bound to a
  keyless group's id, and a later `PATCH` that loads a key encrypts against
  that same provider id as AAD, so reuse is safe and determinism is what
  makes the migration's result reproducible.
- Verification: DB state inspection

#### Scenario: Single-cipher group merges around its anchor

- GIVEN a group sharing (`provider`, `baseUrl`) with exactly one row
  holding a non-null cipher and any number of NULL-cipher rows
- WHEN the migration runs
- THEN exactly one `AiProvider` is created, taking the anchor row's id,
  cipher, and hint
- AND every row in the group is repointed to that provider
- Verification: DB state inspection

#### Scenario: Multi-cipher group never merges

- GIVEN a group sharing (`provider`, `baseUrl`) with two or more rows
  holding distinct non-null ciphers
- WHEN the migration runs
- THEN one `AiProvider` is created per such row, each keeping that
  row's own id and own cipher
- AND no cipher is discarded, compared, decrypted, or moved to another
  row's provider
- Verification: DB state inspection

### Requirement: API key ciphertext never crosses the network

`GET /api/admin/providers` and every provider DTO MUST expose only
`apiKeyHint` (the last 4 plaintext characters) and a boolean presence
flag. `apiKeyCipher` MUST NOT appear in any API response, matching the
masking discipline of `serializarMotor()`.

#### Scenario: List response omits ciphertext

- GIVEN two providers exist, one with a saved key and one without
- WHEN an admin calls `GET /api/admin/providers`
- THEN each item includes `apiKeyHint` and a presence flag, and no
  field contains ciphertext
- Verification: DB state inspection of response payload

### Requirement: Account-level cascade disable

Disabling an `AiProvider` MUST make every `AiModel` pointing at it
behave as disabled — absent from the teacher selector and skipped by
the fallback chain — WITHOUT mutating any of those models' own
`enabled` column. Re-enabling the provider MUST restore each model's
prior individual enabled state.

#### Scenario: Disabling an account hides its models without touching their flags

- GIVEN a provider with two models, one individually enabled and one
  individually disabled
- WHEN an admin disables the provider
- THEN both models disappear from the teacher selector
- AND both models' own `enabled` column is unchanged
- Verification: DB state inspection

#### Scenario: Re-enabling restores prior per-model state

- GIVEN the provider from the previous scenario is disabled
- WHEN an admin re-enables the provider
- THEN the previously individually-enabled model is selectable again
- AND the previously individually-disabled model remains hidden
- Verification: Playwright browser check

### Requirement: No delete lifecycle

`AiProvider` MUST have no delete route. The foreign key from `AiModel`
MUST use `onDelete: Restrict`, matching the existing `AiModel`
no-delete precedent.

#### Scenario: No route exists to delete a provider

- GIVEN an `AiProvider` with or without models pointing at it
- WHEN the admin API surface is inspected
- THEN no DELETE endpoint exists for `/api/admin/providers/[id]`
- Verification: DB state inspection (route inventory)

### Requirement: Down migration fails loudly, never destructively

Restoring `@@unique([provider, providerModel])` MUST abort with a clear
error when doing so is impossible without deleting data — specifically
when models were created after the up migration on a second `AiProvider`
of the same `kind` sharing a `providerModel` value with a model on
another account. The down migration MUST NOT delete rows to force the
constraint to fit.

#### Scenario: Down migration aborts on a post-migration duplicate

- GIVEN two `AiProvider` rows of kind "gmi" each hold a model with the
  same `providerModel` value, created after the up migration
- WHEN the down migration runs
- THEN it aborts with an explicit error and makes no destructive change
- Verification: DB state inspection (migration exit state)
