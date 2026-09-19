# Migration rehearsal — `catalogo-de-proveedores`

This is the change's only proof that production keys survive the
`20260924000000_catalogo_de_proveedores` migration. It is durable evidence,
not scratch: kept under version control, reproducible by anyone with a local
copy of the dev Postgres container.

The real transcript of the run this batch executed is in
[`rehearsal-output.log`](./rehearsal-output.log). Do not trust it blindly —
re-run the sequence below and compare.

## Precondition

- `kodu_db_dev` (or an equivalent Postgres container) running, with the real
  `koduedu` dev database already migrated (this migration included).
- `.env` has a real `KODU_ENCRYPTION_KEY` and a `DATABASE_URL` pointing at
  the real dev DB.
- **Never runs against the working dev DB.** Every step below targets a
  disposable clone, `koduedu_migration_test`. If that database already
  exists from a previous run, drop it first.

## Sequence

```bash
# 0. Fresh scratch clone of the REAL, already-migrated dev DB.
docker exec -i kodu_db_dev psql -U kodu -d postgres -c \
  'DROP DATABASE IF EXISTS koduedu_migration_test;'
docker exec -i kodu_db_dev psql -U kodu -d postgres -c \
  'CREATE DATABASE koduedu_migration_test WITH TEMPLATE koduedu;'

# 1. Revert the clone to the PRE-migration shape. This is what makes case
#    (a) free: the clone still has the real `gmi` group (MiniMax M3 + M2.7,
#    both keyless) once it's back on the old `provider`/`baseUrl` columns.
docker exec -i kodu_db_dev psql -U kodu -d koduedu_migration_test \
  -f - < prisma/migrations/20260924000000_catalogo_de_proveedores/migration_down.sql

# 2. Seed groups (b), (c), (d) with REAL cifrar() ciphertext, raw SQL because
#    the generated Prisma Client no longer matches the pre-migration shape.
DATABASE_URL=postgresql://kodu:kodu@localhost:5432/koduedu_migration_test \
  npx tsx openspec/changes/catalogo-de-proveedores/rehearsal/seed.ts

# 3. Apply the migration forward, for real, against the scratch DB.
#
#    GOTCHA: because the scratch DB is a `CREATE DATABASE ... WITH TEMPLATE`
#    clone of the ALREADY-MIGRATED dev DB, its `_prisma_migrations` ledger
#    table came along too, and it still marks this migration as cleanly
#    applied — even though step 1 just reverted its actual schema. The first
#    `migrate deploy` here will print "No pending migrations to apply." and
#    do nothing. `prisma migrate resolve --rolled-back` does NOT fix this: it
#    only works on a migration in a FAILED state, and this one finished
#    cleanly before being hand-reverted. The ledger row has to go by hand —
#    exactly what a real operator following design.md's own rollback note
#    would have to do for a genuinely hand-written down migration:
docker exec -i kodu_db_dev psql -U kodu -d koduedu_migration_test -c \
  "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20260924000000_catalogo_de_proveedores';"

DATABASE_URL=postgresql://kodu:kodu@localhost:5432/koduedu_migration_test \
  npx prisma migrate deploy

# 4. Verify all 4 group shapes + zero orphans + real decrypt, against
#    Postgres, with the app's own generated Prisma Client.
DATABASE_URL=postgresql://kodu:kodu@localhost:5432/koduedu_migration_test \
  npx tsx openspec/changes/catalogo-de-proveedores/rehearsal/verify.ts

# 5. Migration re-run idempotency (spec "Migration re-run is a no-op"): the
#    exact same `migrate deploy` invocation a SECOND time against an
#    already-migrated DB must be a no-op — no error, no new migration
#    applied, no data change.
DATABASE_URL=postgresql://kodu:kodu@localhost:5432/koduedu_migration_test \
  npx prisma migrate deploy

# 6. Down-migration abort path: manufacture the exact collision the down
#    script has to refuse to resolve on its own, then run it.
docker exec -i kodu_db_dev psql -U kodu -d koduedu_migration_test \
  -f - < openspec/changes/catalogo-de-proveedores/rehearsal/down-abort-setup.sql
docker exec -i kodu_db_dev psql -U kodu -d koduedu_migration_test \
  -f - < prisma/migrations/20260924000000_catalogo_de_proveedores/migration_down.sql
# Expect: RAISE EXCEPTION naming "rehearsal-c / choque-rehearsal-down (2 motores)",
# transaction rolled back, `AiProvider` still has every row from step 4.

# 7. Cleanup.
docker exec -i kodu_db_dev psql -U kodu -d postgres -c \
  'DROP DATABASE koduedu_migration_test;'
```

## What each case proves

| Case | Setup | What's asserted |
|---|---|---|
| (a) all-NULL | real `gmi` group (MiniMax M3 + M2.7), free from the dev DB's own real data via the revert-then-reseed trick above | 1 `AiProvider` at `MIN(id)`, `apiKeyCipher IS NULL` |
| (b) single-cipher | 1 keyed row + 2 keyless, same synthetic group | 1 `AiProvider` at the keyed anchor's id; decrypts with `descifrar()` using its own id as AAD |
| (c) multi-cipher | 2 rows, distinct real ciphers | 2 separate `AiProvider`s, each keeping its own id/cipher, both decrypt |
| (d) split-group keyless | 2 keyed rows (distinct ciphers) + 2 keyless rows, same synthetic group | the 2 keyed rows each get their own provider; the 2 keyless rows land on a **third, separate keyless** provider — never folded into either keyed account |
| re-run idempotency | `migrate deploy` a second time on an already-migrated scratch DB | exit 0, "No pending migrations", zero data change |
| down-migration abort | 2 `AiModel` rows, same `providerModel`, 2 `AiProvider`s of the same `kind` | `migration_down.sql` raises the exact `choques` error, transaction rolls back, nothing destroyed |

## Why revert-then-reseed instead of a fresh pre-migration DB

The previous rehearsal (first `sdd-apply` batch) cloned the dev DB **while it
was still pre-migration** — that option no longer exists, because the real
dev DB now has this migration applied. Reverting a post-migration clone with
`migration_down.sql` and reseeding is the reproducible equivalent: it
recovers the exact pre-migration shape (confirmed by `migration_down.sql`'s
own `ALTER TABLE ... ADD COLUMN` + backfill `UPDATE`), and it exercises the
down-migration's normal (non-aborting) path as a side effect before step 6
exercises its aborting path.
