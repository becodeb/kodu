# Design: Catálogo de proveedores (`AiProvider`)

> **Size note**: `sdd-design` sets an 800-word budget. This design is deliberately over
> it, following the precedent of `archive/2026-09-19-panel-admin/design.md`. The
> centerpiece is a data migration that runs unattended on production and cannot be
> retried by hand; writing it out as real SQL here is the only way `sdd-apply` does not
> improvise it. Prose stays tight; SQL and tables carry the weight.

## Technical Approach

Three moves, in this order:

1. **The provider account becomes a row.** `AiProvider` carries `kind`, `label`,
   `baseUrl`, the encrypted key and `enabled`. `AiModel` keeps everything about the
   model and gains `providerId`.
2. **The migration copies ids, never ciphertext semantics.** Each `AiProvider` takes
   the `id` of the `AiModel` row it inherits the key from, so the AES-GCM AAD
   (`src/lib/crypto/secretos.ts:99-114`) is unchanged and **no crypto primitive runs
   during the migration**. That is what makes pure SQL possible, which is what makes
   the unattended Coolify deploy possible (`docker/prod-entrypoint.sh:11`).
3. **`enabled` folds into predicates that already exist.** `catalogo.ts` checks
   `fila.enabled && fila.provider.enabled` wherever it checks `fila.enabled` today.
   `cadenaDeMotores()`'s traversal is untouched.

**Prisma wiring** (per `config.yaml rules.design`): `prisma.config.ts` and the
datasource are untouched. `src/generated/prisma` changes shape — `npm run db:generate`
is mandatory before `npm run check` compiles. The migration stays hand-written and is
registered with `npx prisma migrate resolve --applied 20260924000000_catalogo_de_proveedores`;
`prisma migrate dev` must **never** generate it, because its diff would drop the
partial index `AiModel_un_solo_default`, which Prisma cannot express.

---

## 1. Schema

```prisma
model AiProvider {
  /// Generado por la app con crypto.randomUUID() ANTES de cifrar la clave: es
  /// el AAD del cifrado (src/lib/crypto/secretos.ts). No lleva @default.
  id String @id
  /// Slug estable: "gmi", "deepseek", "openrouter". Es lo que hace legible
  /// "el mismo proveedor dos veces".
  kind String
  /// Lo que distingue dos cuentas del mismo kind en el desplegable del
  /// formulario de motor: "GMI — cuenta de la escuela".
  label String
  baseUrl String

  /// AES-256-GCM, "v1.<nonce>.<ct>.<tag>" en base64url. Nunca sale del server.
  apiKeyCipher String?
  apiKeyHint   String?

  /// Apagar la cuenta apaga sus motores sin tocarles su propio `enabled`, así
  /// que volver a prenderla restaura el estado anterior de cada uno.
  enabled Boolean @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  modelos AiModel[]
}

model AiModel {
  // … sin `provider`, `baseUrl`, `apiKeyCipher`, `apiKeyHint` …
  providerId String
  provider   AiProvider @relation(fields: [providerId], references: [id], onDelete: Restrict)

  @@unique([providerId, providerModel])
  @@index([enabled, sortOrder])
}
```

Three deliberate omissions:

- **No `@@index([providerId])`** — `@@unique([providerId, providerModel])` already
  creates an index with `providerId` leading, which is what the FK needs.
- **No index or unique constraint on `kind` or `label`.** The table holds a handful of
  rows and is read whole. Two accounts of the same kind with the same label are legal
  (confusing, and the admin's to fix), so there is no `P2002` path on this table.
- **No `CHECK` on `kind`.** A slug regex lives in the zod schema for *new* rows;
  putting it in SQL would make the migration fail on legacy free-text values.

**The relation field is named `provider` on purpose.** `AiModel.provider` was a
`string`; it becomes an `AiProvider`. Every stale read becomes a type error under
`npm run check` instead of a silent behaviour change. Verified: the three live readers
(`src/lib/admin/modelos.ts:39`, `api/admin/models/index.ts:83`, `[id].ts:73`) all
assign it into a `string`, so all three break loudly. No site interpolates it into a
template literal, which is the one shape that would survive the rename as
`"[object Object]"`.

---

## 2. The migration — `prisma/migrations/20260924000000_catalogo_de_proveedores/migration.sql`

Postgres runs DDL transactionally, so the whole file is one atomic step. Order is
load-bearing: **add and backfill before dropping anything.**

### 2.1 DDL

```sql
-- POR QUE esta migracion esta escrita a mano (igual que 20260919000000):
--
-- 1) `AiModel` conserva el indice unico PARCIAL `AiModel_un_solo_default`
--    (WHERE "isDefault" = true), que Prisma no sabe expresar. Si esta
--    migracion la generara `prisma migrate dev`, el diff lo dropearia por no
--    encontrarlo en el schema. Se escribe a mano y se marca aplicada con
--    `prisma migrate resolve --applied`.
--
-- 2) El backfill tiene que ser SQL PURO. El deploy es un webhook de Coolify:
--    `docker/prod-entrypoint.sh` corre `npx prisma migrate deploy` y arranca el
--    server. La imagen de runtime no puede correr un script TypeScript
--    (`Dockerfile:51` = `npm ci --omit=dev`, sin tsx; `Dockerfile:53-56` no
--    copia `scripts/`). Nadie va a entrar a mano a terminar esto.
--
-- 3) NO SE DESCIFRA NI SE VUELVE A CIFRAR NADA. El AAD del cifrado es el `id`
--    de la fila duena de la clave. Cada `AiProvider` se queda con el `id` de
--    la fila `AiModel` de la que hereda la clave, asi que el ciphertext sigue
--    autenticando tal cual. Esta migracion no toca una sola primitiva de
--    cripto: mueve bytes y conserva el id.

CREATE TABLE IF NOT EXISTS "AiProvider" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyCipher" TEXT,
    "apiKeyHint" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProvider_pkey" PRIMARY KEY ("id")
);

-- Nullable por ahora: el backfill la llena antes de que se le exija NOT NULL.
ALTER TABLE "AiModel" ADD COLUMN IF NOT EXISTS "providerId" TEXT;
```

### 2.2 The backfill — the conservative grouping rule, in SQL

Group by (`provider`, `baseUrl`). Per group, three numbers decide everything:

| Per group | Meaning |
|---|---|
| `cifradas` | how many rows carry a non-null `apiKeyCipher` |
| `ancla_con_clave` | `MIN(id)` among cipher-bearing rows — when `cifradas = 1`, that *is* the anchor |
| `ancla_sin_clave` | `MIN(id)` among keyless rows |

```sql
-- EL REPARTO. Una sola pasada sobre (provider, baseUrl).
WITH grupos AS (
    SELECT
        "provider",
        "baseUrl",
        COUNT(*)  FILTER (WHERE "apiKeyCipher" IS NOT NULL) AS cifradas,
        MIN("id") FILTER (WHERE "apiKeyCipher" IS NOT NULL) AS ancla_con_clave,
        MIN("id") FILTER (WHERE "apiKeyCipher" IS NULL)     AS ancla_sin_clave
      FROM "AiModel"
     GROUP BY "provider", "baseUrl"
)
UPDATE "AiModel" m
   SET "providerId" = CASE
       -- 2+ claves distintas en el grupo: NO se fusiona. Cada fila con clave
       -- se queda con su propio id y con su propia clave. GCM usa un nonce
       -- aleatorio, asi que comparar ciphertexts NO puede distinguir "la misma
       -- clave dos veces" de "dos claves distintas": fusionar seria perder una
       -- clave en silencio, y el modelo perdedor terminaria autenticando
       -- contra una cuenta que no es la suya.
       WHEN g.cifradas >= 2 AND m."apiKeyCipher" IS NOT NULL THEN m."id"
       -- Las filas SIN clave de un grupo partido no se cuelgan de ninguna de
       -- las cuentas partidas: elegir una al azar les REGALARIA una clave que
       -- nunca tuvieron (y le mandaria trafico y factura a esa cuenta). Van a
       -- una cuenta propia, sin clave, que es exactamente lo que eran.
       WHEN g.cifradas >= 2                                  THEN g.ancla_sin_clave
       -- 1 clave: esa fila es el ancla y el grupo entero se cuelga de ella.
       -- 0 claves: no hay clave que atar, el AAD es irrelevante, y se usa la
       -- fila de menor id del grupo como ancla. Es un id que ya existe, que ya
       -- es unico, y que es deterministico entre corridas.
       ELSE COALESCE(g.ancla_con_clave, g.ancla_sin_clave)
   END
  FROM grupos g
 WHERE g."provider" = m."provider"
   AND g."baseUrl"  = m."baseUrl"
   AND m."providerId" IS NULL;
```

Why the zero-cipher group reuses a model id instead of `gen_random_uuid()`: it keeps
**every** `AiProvider.id` equal to some `AiModel.id`, which makes one sentence true for
the whole table — *the provider id is the id of the row the account was born from* —
and it stays deterministic across replays. It is safe because there is no ciphertext
bound to it; and if the admin later saves a key on that account, `PATCH` encrypts with
that same provider id as AAD, so the invariant holds going forward. Ids are unique
across `AiModel` and each row belongs to exactly one group, so every chosen anchor id
is distinct — the `AiProvider` PK cannot collide. `AiProvider.id` colliding with an
unrelated `AiModel.id` is a non-event: different table, different PK, and `TokenUsage`
/ `Project` still point at `AiModel` only.

```sql
-- Una fila de AiProvider por cada id que quedo elegido como ancla. El id, el
-- cipher y la pista se copian TAL CUAL: eso es lo que mantiene valido el AAD.
INSERT INTO "AiProvider" ("id", "kind", "label", "baseUrl", "apiKeyCipher", "apiKeyHint", "enabled", "createdAt", "updatedAt")
SELECT
    a."id",
    a.kind,
    -- Etiqueta inicial: el texto que el admin ya tipeo. Si una sola cuenta
    -- salio de ese kind, va tal cual. Si salieron varias, se numeran y se les
    -- cuelga la pista de la clave: dos cuentas partidas del MISMO proveedor
    -- pueden tener la misma pista (la misma clave tipeada dos veces da la
    -- misma pista), por eso el numero de cuenta es el que garantiza que se
    -- distingan y la pista es solo ayuda.
    CASE WHEN a.hermanas = 1 THEN a."provider"
         ELSE a."provider" || ' · cuenta ' || a.orden
              || COALESCE(' (••••' || a."apiKeyHint" || ')', ' (sin clave)')
    END,
    a."baseUrl",
    a."apiKeyCipher",
    a."apiKeyHint",
    true,
    a."createdAt",
    CURRENT_TIMESTAMP
FROM (
    SELECT m."id", m."provider", m."baseUrl", m."apiKeyCipher", m."apiKeyHint", m."createdAt",
           lower(btrim(m."provider")) AS kind,
           COUNT(*)     OVER (PARTITION BY lower(btrim(m."provider"))) AS hermanas,
           ROW_NUMBER() OVER (PARTITION BY lower(btrim(m."provider"))
                              ORDER BY m."baseUrl", m."id")            AS orden
      FROM "AiModel" m
     WHERE EXISTS (SELECT 1 FROM "AiModel" h WHERE h."providerId" = m."id")
) a
ON CONFLICT ("id") DO NOTHING;
```

`kind` is `lower(btrim(provider))` — a slug, per the binding decision. `label` keeps the
original casing, because that is the string the admin recognises. Grouping still uses
the **raw** `provider`, so `'GMI'` and `'gmi'` produce two accounts rather than one:
the conservative side of the trade, again.

```sql
-- Nadie puede quedar sin cuenta. Si el CASE dejo algo en NULL, el deploy tiene
-- que gritar ACA, con un numero, y no tres statements mas abajo con un error
-- de constraint que no explica nada.
DO $$
DECLARE huerfanos BIGINT;
BEGIN
    SELECT COUNT(*) INTO huerfanos FROM "AiModel" WHERE "providerId" IS NULL;
    IF huerfanos > 0 THEN
        RAISE EXCEPTION 'Quedaron % motores sin cuenta de proveedor: el reparto no cubrio todos los grupos.', huerfanos;
    END IF;
END $$;

ALTER TABLE "AiModel" ALTER COLUMN "providerId" SET NOT NULL;

-- Postgres no admite ADD CONSTRAINT IF NOT EXISTS: se guarda a mano.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiModel_providerId_fkey') THEN
        ALTER TABLE "AiModel"
          ADD CONSTRAINT "AiModel_providerId_fkey"
          FOREIGN KEY ("providerId") REFERENCES "AiProvider"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
```

### 2.3 Constraint swap

```sql
-- EL CAMBIO QUE ES LA FUNCION: la identidad de un motor pasa a ser unica POR
-- CUENTA, no por etiqueta de proveedor. Es lo que habilita el mismo modelo
-- cargado dos veces, una por cuenta.
DROP INDEX IF EXISTS "AiModel_provider_providerModel_key";
CREATE UNIQUE INDEX IF NOT EXISTS "AiModel_providerId_providerModel_key"
    ON "AiModel"("providerId", "providerModel");

-- NO SE TOCAN: `AiModel_un_solo_default` (el parcial que Prisma no expresa) ni
-- `AiModel_enabled_sortOrder_idx`. Ninguno depende de las columnas que se van.

-- Recien ahora se van las cuatro columnas. De aca en adelante el archivo ya no
-- se puede replayear: ver §2.4.
ALTER TABLE "AiModel"
  DROP COLUMN IF EXISTS "provider",
  DROP COLUMN IF EXISTS "baseUrl",
  DROP COLUMN IF EXISTS "apiKeyCipher",
  DROP COLUMN IF EXISTS "apiKeyHint";
```

`AiModel_provider_providerModel_key` was created with `CREATE UNIQUE INDEX`
(`20260919000000/migration.sql:61`), not `ALTER TABLE ADD CONSTRAINT`, so `DROP INDEX`
is the right verb. Dropping `provider` would take it anyway; doing it explicitly first
keeps the two statements independently replayable.

**The new index cannot fail.** Two rows sharing a `providerId` necessarily came from the
same (`provider`, `baseUrl`) group, so they shared the old `provider` value, so the old
`@@unique([provider, providerModel])` already forced their `providerModel` apart. The
new partition is a *refinement* of the old one, so it is strictly weaker. No
pre-check is needed and none is written.

### 2.4 Idempotency — what is actually guaranteed

The entrypoint runs on every container boot, so this needs to be exact rather than
reassuring.

| Layer | Guarantee |
|---|---|
| `_prisma_migrations` ledger | `migrate deploy` executes an applied migration **zero** more times. This, not the SQL, is the idempotency mechanism. |
| Postgres advisory lock | Two replicas booting at once serialise; the loser waits and then finds the migration applied. |
| Transactional DDL | The file is all-or-nothing. A failure leaves the database byte-identical to before, so there is no half-migrated state to reason about. |
| Statement guards | `IF NOT EXISTS`, `ON CONFLICT DO NOTHING` and `WHERE "providerId" IS NULL` make §2.1–§2.3 replayable **while the old columns still exist** — the state an operator is in after `prisma migrate resolve --rolled-back`. |

**Stated plainly: the file is not idempotent after the `DROP COLUMN` step, by
construction.** A second execution would fail parsing `m."provider"`. That is why the
drops are last and why the ledger is what protects production.

Failure mode on a bad boot: `migrate deploy` exits non-zero, `set -e` in
`docker/prod-entrypoint.sh:8` kills the container, and Coolify reports a failed deploy
with the previous container still serving. Prisma marks the migration failed and blocks
later deploys until a human runs `migrate resolve`. Loud, not silent — which is the
correct outcome for a migration that moves keys.

### 2.5 `migration_down.sql`

Hand-run, never executed by Prisma, following the convention of
`20260920000000_costo_de_turnos/migration_down.sql`.

```sql
-- Rollback a mano de 20260924000000_catalogo_de_proveedores. Se corre por
-- fuera de `prisma migrate`:
--   docker exec -i kodu_db_dev psql -U kodu -d koduedu -f - < migration_down.sql
-- y despues:
--   npx prisma migrate resolve --rolled-back 20260924000000_catalogo_de_proveedores
--
-- A DIFERENCIA de los otros migration_down.sql del repo, este va envuelto en
-- BEGIN/COMMIT: tiene una comprobacion que puede ABORTAR, y con el autocommit
-- de psql un aborto a mitad dejaria media reversion puesta.
--
-- PERDIDA ACEPTADA:
--  * El `label` de cada cuenta. `AiModel.provider` vuelve con el `kind` (en
--    minusculas), no con el texto original. Si antes convivian 'GMI' y 'gmi'
--    con el mismo providerModel, el freno de abajo va a abortar: la
--    normalizacion a slug no tiene vuelta exacta. Se arregla renombrando uno
--    de los dos motores a mano y volviendo a correr.
--  * Las cuentas creadas DESPUES de la migracion que no tengan ningun motor
--    colgando: se van con la tabla, y su clave cifrada con ellas.
--  * `AiProvider.enabled`: ver el UPDATE de mas abajo.

BEGIN;

-- EL FRENO. Restaurar @@unique([provider, providerModel]) es IMPOSIBLE si
-- despues de la migracion se cargaron modelos con el mismo providerModel en
-- dos cuentas del mismo kind — que es EXACTAMENTE lo que esta migracion vino a
-- habilitar. Este script ABORTA y no borra nada: cual de los dos motores sobra
-- es una decision de una persona, no de un .sql.
DO $$
DECLARE choques TEXT;
BEGIN
    SELECT string_agg(format('  %s / %s (%s motores)', d.kind, d."providerModel", d.n), E'\n')
      INTO choques
      FROM (
          SELECT p."kind" AS kind, m."providerModel", COUNT(*) AS n
            FROM "AiModel" m
            JOIN "AiProvider" p ON p."id" = m."providerId"
           GROUP BY p."kind", m."providerModel"
          HAVING COUNT(*) > 1
      ) d;

    IF choques IS NOT NULL THEN
        RAISE EXCEPTION E'No se puede revertir: hay motores repetidos que el indice unico viejo no admite.\n%\nBorralos o repuntalos a mano desde /admin/motores y volve a correr este archivo. NO se borro nada.', choques;
    END IF;
END $$;

ALTER TABLE "AiModel"
  ADD COLUMN IF NOT EXISTS "provider" TEXT,
  ADD COLUMN IF NOT EXISTS "baseUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "apiKeyCipher" TEXT,
  ADD COLUMN IF NOT EXISTS "apiKeyHint" TEXT;

-- Cada motor se lleva de vuelta los datos de SU cuenta actual. Un motor
-- repunteado a otra cuenta despues de la migracion vuelve con la clave de esa
-- cuenta, que es su estado correcto de hoy y no una regresion. El AAD nunca
-- cambio, asi que el ciphertext restaurado descifra igual que antes.
UPDATE "AiModel" m
   SET "provider"     = p."kind",
       "baseUrl"      = p."baseUrl",
       "apiKeyCipher" = p."apiKeyCipher",
       "apiKeyHint"   = p."apiKeyHint"
  FROM "AiProvider" p
 WHERE p."id" = m."providerId";

-- El modelo viejo no tiene donde decir "la cuenta esta apagada", asi que la
-- cascada se traduce a apagar esos motores: conservar "no tienen que servir"
-- vale mas, en un rollback, que conservar el enabled propio de cada uno.
DO $$
DECLARE apagados BIGINT;
BEGIN
    UPDATE "AiModel" m SET "enabled" = false
      FROM "AiProvider" p
     WHERE p."id" = m."providerId" AND p."enabled" = false AND m."enabled";
    GET DIAGNOSTICS apagados = ROW_COUNT;
    RAISE NOTICE 'Se apagaron % motores que colgaban de una cuenta apagada (su enabled propio se pierde).', apagados;
END $$;

ALTER TABLE "AiModel" ALTER COLUMN "provider" SET NOT NULL;
ALTER TABLE "AiModel" ALTER COLUMN "baseUrl"  SET NOT NULL;

DROP INDEX IF EXISTS "AiModel_providerId_providerModel_key";
CREATE UNIQUE INDEX IF NOT EXISTS "AiModel_provider_providerModel_key"
    ON "AiModel"("provider", "providerModel");

ALTER TABLE "AiModel" DROP CONSTRAINT IF EXISTS "AiModel_providerId_fkey";
ALTER TABLE "AiModel" DROP COLUMN IF EXISTS "providerId";
DROP TABLE IF EXISTS "AiProvider";

COMMIT;
```

If the `enabled` cascade turns off the row that is `isDefault`, the old app copes:
`motorPorDefecto()` already falls through to the lowest-`sortOrder` enabled model with
a `console.warn` (`catalogo.ts:115-131`). No extra handling.

---

## 3. Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Keyless rows inside a **split** group | Their own keyless `AiProvider` (`ancla_sin_clave`) | Folding them into one of the split accounts | Folding grants a key they never had and sends traffic/billing to an account picked by `MIN(id)`. "Keyless stays keyless" is the behaviour-preserving reading of the invariant. The proposal did not resolve this case; this is the resolution. |
| Zero-cipher group's id | `MIN(id)` of the group's own rows | `gen_random_uuid()` | Deterministic across replays, unique for free, and keeps one sentence true of the whole table. No cipher is bound, so the AAD is irrelevant. |
| Cascade mechanism in `catalogo.ts` | `fila.enabled && fila.provider.enabled` in the enabled predicates | Blanking `apiKey` in `construirConfig()` when the provider is off | Blanking conflates "no key loaded" with "account off" in logs, in `tieneClave`, and in the chain-skip reason. The two states must stay distinguishable. |
| Disabling a provider that owns the default model | Allowed; the panel warns | 409, mirroring the models route | An account-wide kill switch that refuses to fire because of a per-model flag is the opposite of what it is for — a leaked key has to be shut off now. `motorPorDefecto()` already has a documented fallback for a default it cannot use. |
| Bad `providerId` on model create/update | Explicit `findUnique` pre-check → precise 422 | Relying on the P2003 handler | `AiModel` now has **two** FKs, and today both P2003 and P2025 map to `"El motor de respaldo elegido no existe."` Without the pre-check, a wrong `providerId` reports a fallback problem. |
| `label` uniqueness | None | `@@unique([kind, label])` | The migration guarantees distinguishable labels; after that, naming is the admin's. A unique constraint would turn a cosmetic clash into a save failure. |

---

## 4. `src/lib/ai/catalogo.ts`

```ts
type FilaConProveedor = AiModel & { provider: AiProvider };
let cache: { filas: FilaConProveedor[]; expira: number } | null = null;

const filas = await prisma.aiModel.findMany({
  orderBy: { sortOrder: 'asc' },
  include: { provider: true },
});

/** Un motor sirve sólo si están prendidos los dos: el motor y su cuenta. */
function utilizable(fila: FilaConProveedor): boolean {
  return fila.enabled && fila.provider.enabled;
}
```

`clavePlano()` reads `fila.provider.apiKeyCipher` and decrypts with AAD
`fila.provider.id`. The `console.error` on failure names the model id **and** the
provider id, never the ciphertext — with one account feeding many models, the provider
id is what makes the line actionable. `construirConfig()` takes `baseUrl` from
`fila.provider.baseUrl`; `ProviderConfig` keeps its exact shape, so
**`src/lib/ai/provider.ts` is untouched.**

Predicate-by-predicate, exactly:

| Function | Change |
|---|---|
| `motoresParaDocente()` (`:199-210`) | `.filter((fila) => utilizable(fila) && fila.selectableByTeacher)` |
| `motorPorDefecto()` (`:115-131`) | Both branches fold it in: `fila.isDefault && utilizable(fila)`, then `filas.filter(utilizable)`. The existing `console.warn` / `console.error` / `null` shape is unchanged. |
| `normalizarMotor()` (`:141-148`) | `if (fila && utilizable(fila)) return construirConfig(fila); return motorPorDefecto();` |
| `cadenaDeMotores()` (`:164-191`) | **Traversal untouched**: `visitados`, `TOPE_CADENA`, the `actualId = fila.fallbackModelId` hop and the empty-chain last resort all stay verbatim. Only the push guard changes, `if (fila.enabled)` → `if (utilizable(fila))`. `tieneClaveUtilizable(config)` itself is unchanged (`config.apiKey.length > 0`) and still runs after it. |
| `resolverMotor()` (`:100-106`) | **Unchanged.** It is the "resolve exactly this row" primitive with no enabled check today. Verified: it has no caller anywhere in `src/` — folding a predicate into a function nobody calls would be invented behaviour. |
| `invalidarCatalogo()` | Unchanged, but now also called by every `/api/admin/providers/*` mutation. Missing that is a stale-key bug with a 30s window. |

A project pointing at a model whose account was just disabled needs **no new UI**: it
takes the existing repoint path in `src/pages/app/project/[id].astro` and shows the
existing quiet notice.

---

## 5. DTOs

```ts
// src/lib/admin/proveedores.ts (nuevo)
export interface ProveedorAdmin {
  id: string;
  kind: string;
  label: string;
  baseUrl: string;
  /** Nunca la clave ni el cifrado: sólo si hay una cargada. */
  tieneClave: boolean;
  apiKeyHint: string | null;
  enabled: boolean;
  /** Cuántos motores dependen de esta cuenta. Ausente donde no se pidió el _count. */
  motores?: number;
}
export function serializarProveedor(
  fila: AiProvider & { _count?: { modelos: number } },
): ProveedorAdmin;
```

```ts
// src/lib/admin/modelos.ts — MotorAdmin después del corte
export interface MotorAdmin {
  id: string;
  providerId: string;
  /** Era un string. Ahora es la cuenta, ya enmascarada. */
  provider: ProveedorAdmin;
  providerModel: string;
  // … displayName, description, adminNote, los tres precios como string,
  //    enabled, selectableByTeacher, isDefault, sortOrder, maxOutputTokens,
  //    maxInputChars, supportsVision, userTokenLimit, fallbackModelId — sin cambios …
}
export function serializarMotor(fila: AiModel & { provider: AiProvider }): MotorAdmin;
```

`baseUrl`, `tieneClave` and `apiKeyHint` leave `MotorAdmin` as own fields and arrive
through `provider`. Masking discipline is unchanged and unchanged in shape: `include`
does pull `apiKeyCipher` into memory (exactly as `findMany` does today), and the
serializers remain the single boundary that drops it. **No route returns a raw Prisma
row.**

---

## 6. API routes

Middleware: **verified, no change needed.** `ADMIN_API_PREFIXES = ['/api/admin']`
(`src/middleware.ts:19`) and `matches()` (`:22-24`) accepts a prefix match on a `/`
boundary, so `/api/admin/providers` and `/api/admin/providers/<id>` are already covered
by `:130-134` — `requireAdmin` on GET, `requireFreshAdmin` on POST/PATCH. CSRF is a
global origin check at `:81`, before any route matching, so new routes inherit it too.

### `src/pages/api/admin/providers/index.ts`

```ts
const crearProveedorSchema = z.object({
  kind: z.string().trim().min(1).max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'El tipo va en minúsculas, sin espacios (ej: "gmi").'),
  label: z.string().trim().min(1, 'Falta el nombre de la cuenta').max(120),
  baseUrl: z.string().trim().min(1, 'Falta la URL base').max(300),
  apiKey: z.string().trim().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
});
```

`GET` → `findMany({ orderBy: [{ kind: 'asc' }, { label: 'asc' }], include: { _count: { select: { modelos: true } } } })`,
returns `{ proveedores }`.

`POST` follows `models/index.ts:64-75` **verbatim in order**, because the id is the AAD:

```ts
const id = randomUUID();          // ← ANTES de cifrar, siempre
let apiKeyCipher: string | null = null;
let apiKeyHint: string | null = null;
if (datos.apiKey) {
  try { apiKeyCipher = cifrar(datos.apiKey, id); }
  catch (error) {
    if (error instanceof ClaveNoConfigurada) return fail(error.message, 503);
    throw error;
  }
  apiKeyHint = pistaDeClave(datos.apiKey);
}
```

### `src/pages/api/admin/providers/[id].ts`

`PATCH` only, with the same "no hay DELETE" docstring as `models/[id].ts:13-16`, adapted:
the FK is `Restrict`, so a delete would be refused by Postgres for any account in use,
and for an unused one it would still throw away a stored key. Disabling is the only
removal. Every field optional; `apiKey` is `undefined` = leave, `null` = clear, string =
replace, encrypted with `existente.id` (never a new id — same comment as
`models/[id].ts:102-104`). 404 `"Esa cuenta no existe."` from the leading `findUnique`.

### Error mapping

| Code | Route | Response |
|---|---|---|
| Pre-check (not Prisma) | models POST/PATCH with `providerId` | 422 `"La cuenta de proveedor elegida no existe."` |
| P2002 | models POST/PATCH | 422 — **copy changes** to `"Ya existe un motor con ese identificador en esa cuenta."` The old wording named the provider label, which is no longer what the index is on. |
| P2002 | providers | Unreachable (no unique constraint beyond the PK). Not handled. |
| P2003 / P2025 | models POST/PATCH | 422 `"El motor de respaldo elegido no existe."` — now only reachable for `fallbackModelId`, thanks to the pre-check above. |
| P2003 | providers | Unreachable; `AiProvider` has no outgoing FK. |
| P2025 | providers PATCH | Pre-empted by the `findUnique` 404; kept as the generic net. |

Model schemas lose `provider`, `baseUrl` and `apiKey`, and gain
`providerId: z.string().trim().min(1, 'Elegí una cuenta de proveedor')` — required on
POST, optional on PATCH (re-pointing a model to another account is how the admin
consolidates what the migration split).

---

## 7. Admin UI

| Surface | Shape |
|---|---|
| `src/layouts/AdminLayout.astro:20-25` | `PESTAÑAS` gains `{ href: '/admin/proveedores', etiqueta: 'Proveedores' }`, placed **before** `Motores` — an account is upstream of a model. Five tabs fit above ~640px and the strip already scrolls below that (`overflow-x-auto`, `:41`); no layout change. |
| `src/pages/admin/proveedores.astro` | Mirrors `motores.astro` exactly: SSR `findMany` + `_count`, `serializarProveedor`, one `client:load` island. |
| `ProveedoresPanel.tsx` | Row list, not cards, mirroring `ModelosPanel`. Per row: `label` (`font-medium text-ink-900`) over `kind · baseUrl` (`text-xs text-ink-500`), then `•••• 2345` / `Sin clave`, `N motores`, the `Interruptor` (`srOnly`, same as the models row), `Editar`. **No drag handle, no order column, no default radio** — accounts have neither order nor a default. Header button `+ Nueva cuenta`. Optimistic toggle with rollback on failure, copied from `ModelosPanel.toggleEnabled`. Empty state `kodu-card p-10 text-center`. |
| Disabled-account warning | A disabled row keeps an inline strip: `Esta cuenta está apagada: sus N motores no se ofrecen.` No confirmation modal — the toggle is the kill switch and it has to be one gesture. |
| `ProveedorForm.tsx` | `Modal` + `kind`, `label`, `baseUrl`, write-only `Reemplazar clave` (`type="password"`, `autoComplete="new-password"`, placeholder `•••• 2345` / `Sin clave`, the same helper line as `ModeloForm.tsx:236-238`), and an `Interruptor` for `enabled` when editing. |
| `ModeloForm.tsx:54-59,140-239` | The `provider`, `baseUrl` and `apiKey` inputs and their state are **deleted**; one `<select id="…-provider">` labelled `Cuenta de proveedor` takes their place, options `label` + ` (apagada)` when disabled, plus a `— Elegí una cuenta —` placeholder. New prop `proveedores: ProveedorAdmin[]`, threaded `proveedores.astro`/`motores.astro` → `ModelosPanel` → `ModeloForm`. Validation copy becomes `'Completá la cuenta, el identificador y el nombre.'` |
| Empty state | When `proveedores.length === 0`, the dialog body is replaced by a `kodu-card`: `Todavía no hay ninguna cuenta de proveedor. Cargá una y volvé a crear el motor.` + `<a href="/admin/proveedores" class="kodu-btn-primary">Ir a Proveedores</a>`, with `Guardar` disabled. `+ Nuevo motor` stays **enabled** — opening the dialog is how the admin discovers why, and one explanation beats two. |
| `ModelosPanel.tsx:189-198` | Line 2 becomes `{motor.provider.label} · {motor.providerModel}`; the key column reads `motor.provider.tieneClave` / `motor.provider.apiKeyHint`. **Required addition**: when `!motor.provider.enabled`, a muted `Cuenta apagada` chip on the row — this is the proposal's mitigation for "a model quietly stops working", and it only works if it lives on the model row. |

All colours are existing tokens (`linea`, `sutil`, `superficie`, `ink-*`, `brand-*`); no
`bg-white`, no `bg-slate-*`.

---

## 8. Data Flow

```
ADMIN                                        CHAT (un turno)
  POST /api/admin/providers                    cadenaDeMotores(motor.id)
    id = randomUUID()   ← AAD                    │
    cifrar(apiKey, id)                           ├─ filasDelCatalogo()  include: { provider: true }
    AiProvider {id, kind, label, baseUrl,        │     └─ cache 30 s, invalidada por CADA mutación
                apiKeyCipher, enabled}          │        de /api/admin/models/* Y /api/admin/providers/*
           │                                     │
  POST /api/admin/models                         ├─ por fila: fila.enabled && fila.provider.enabled
    providerId = <esa cuenta>                    │            └─ construirConfig()
    AiModel {providerId, providerModel, …}       │                 apiKey  = descifrar(provider.apiKeyCipher,
           │                                     │                                     provider.id)
           └──────────── @@unique(providerId, providerModel)  baseUrl = provider.baseUrl
                         (el mismo modelo, dos cuentas: legal) │
                                                               └─ tieneClaveUtilizable() → entra a la cadena
```

Migration, in one line: `(provider, baseUrl)` → group → `cifradas` ∈ {0, 1, ≥2} →
1 account / 1 account / N+1 accounts → ids copied verbatim → AAD still valid.

---

## 9. File Changes

| File | Action | What |
|---|---|---|
| `prisma/schema.prisma:161-213` | Modify | `AiProvider`; `AiModel` loses four columns, gains `providerId` + relation; unique swap |
| `prisma/migrations/20260924000000_catalogo_de_proveedores/migration.sql` | Create | §2.1–§2.3 |
| `…/migration_down.sql` | Create | §2.5, with the abort |
| `src/lib/ai/catalogo.ts:32-93,115-210` | Modify | `include`, `utilizable()`, decrypt via the join; traversal untouched |
| `src/lib/admin/proveedores.ts` | Create | `ProveedorAdmin` + `serializarProveedor` |
| `src/lib/admin/modelos.ts:11-60` | Modify | `MotorAdmin` split; `serializarMotor` takes the join |
| `src/pages/api/admin/providers/index.ts`, `[id].ts` | Create | GET/POST, PATCH. No DELETE |
| `src/pages/api/admin/models/index.ts`, `[id].ts` | Modify | Schemas, `providerId` pre-check, `include`, P2002 copy |
| `src/pages/api/admin/models/orden.ts:40` | Modify | **Correction to the proposal**, which said this file was untouched: `:41` calls `serializarMotor`, so `:40`'s `findMany` needs `include: { provider: true }`. One line; without it `npm run check` fails. |
| `src/pages/admin/proveedores.astro` | Create | Mirrors `motores.astro` |
| `src/pages/admin/motores.astro:8` | Modify | `include` + loads `proveedores` for the form |
| `src/layouts/AdminLayout.astro:20-25` | Modify | Fifth tab |
| `src/components/admin/ProveedoresPanel.tsx`, `ProveedorForm.tsx` | Create | §7 |
| `src/components/admin/ModelosPanel.tsx:189-198` | Modify | Label from the join, `Cuenta apagada` chip, `proveedores` prop passthrough |
| `src/components/admin/ModeloForm.tsx:54-59,140-239` | Modify | `<select>` + empty state |
| `src/lib/crypto/secretos.ts:5,99-114` | Modify | Docstrings only: the AAD is "the id of the row that owns the cipher". No functional change |
| `scripts/rotar-clave.ts:36-57` | Modify | `prisma.aiModel` → `prisma.aiProvider`; `select: { id, label, apiKeyCipher }`; `displayName` → `label` in the log. Still an operator tool, still outside the runtime image |
| `e2e/m3-motores.ts` | Modify | §10. Filename kept — it is the slice name |

---

## 10. Testing Strategy

`npm run check` (tsc) is the only automated gate; Playwright drives the rest.

| Layer | What | Approach |
|---|---|---|
| Type | Every stale `fila.provider` string read | `npm run check` after `npm run db:generate`. The relation rename makes it compile-or-fail |
| Migration | Backfill against real shapes | On a dev DB, seed rows for the three cases (0 / 1 / ≥2 ciphers in a group) **before** `migrate deploy`, then assert: every model has a `providerId`; every pre-existing key still decrypts through the panel (`tieneClave` true, chat resolves); no ciphertext deleted |
| Migration | The abort | Apply, create two models with the same `providerModel` on two accounts of one kind, run `migration_down.sql`, assert it raises and that `AiProvider` still exists |
| E2E | Admin flows | `e2e/m3-motores.ts`, both themes |

### `e2e/m3-motores.ts` — new shape

1. `limpiarEstado()` deletes test **models first, then test providers** (FK is `Restrict`), and must not touch the seeded accounts.
2. Create a provider through the real UI at `/admin/proveedores` (dark theme): `kind` `test-e2e`, `label` `Cuenta E2E`, base URL, key `CLAVE_DE_PRUEBA`. Assert POST 200 and that the body contains neither the plaintext nor `apiKeyCipher`.
3. Assert the row renders `•••• 2345`, and in the DB that `aiProvider.apiKeyCipher` starts with `v1.` and is not the plaintext (this assertion moves off the model).
4. **Ciphertext-leak assertion (required by the proposal)**: `GET /api/admin/providers` text contains none of `CLAVE_DE_PRUEBA`, `apiKeyCipher`, or `'v1.'` — the last one is a format-level check that catches a leak even under a renamed field.
5. Create the model at `/admin/motores` by choosing `Cuenta E2E` in the `<select>`. Also assert the labels `Proveedor`, `URL base` and `Reemplazar clave` are **absent** from the model dialog, so a half-landed change cannot pass.
6. Steps 2–10 of the current script (enable/disable, default, the 409, keyboard reorder, masked `GET /api/admin/models`, teacher selector, repoint notice, both themes) carry over unchanged except for selector text.
7. **New — the cascade**: `PATCH /api/admin/providers/<id>` with `enabled: false`; assert the model leaves the teacher selector while `aiModel.enabled` is still `true` in the DB; re-enable and assert it returns. This is the only automated coverage of the new capability.
8. **New — the feature itself**: a second provider of kind `test-e2e` plus a second model with the **same** `providerModel` returns 200. That POST was impossible before this change.
9. The zero-provider empty state is not automatable without emptying the table; it stays a manual Playwright check, recorded as such.

---

## Threat Matrix

**N/A** — no shell command, subprocess, VCS/PR automation, executable-file
classification, or repository/cwd selection is introduced. The new HTTP routes sit
under the already-guarded `/api/admin` prefix (§6, verified) and the deploy-time
migration runs through the existing, unmodified `docker/prod-entrypoint.sh`.

---

## Migration / Rollout

Push → Coolify webhook → `npx prisma migrate deploy` → server start. No manual step, no
flag, no phase. The acceptance condition is the deploy itself: every pre-existing key
still decrypts because no key was ever re-encrypted.

Dev sequence, in order: edit `schema.prisma` → hand-write the migration folder →
`npm run db:generate` → `npm run db:deploy` on a fresh DB (or
`npx prisma migrate resolve --applied 20260924000000_catalogo_de_proveedores` where it
already ran) → `npm run check`. Never `prisma migrate dev`.

Rollback: revert the branch, then hand-run `migration_down.sql` and
`npx prisma migrate resolve --rolled-back …`, accepting the losses listed in §2.5 — and
accepting that it can refuse to run at all, by design.

## Open Questions

- [ ] None blocking. Two accepted consequences worth the owner seeing once: the
      migration may emit more accounts than there are real accounts (documented trade,
      consolidated in the panel in a minute), and `kind` normalisation to lowercase is
      not round-trippable, so mixed-case legacy `provider` values can make the down
      migration abort even with no post-migration edits.
