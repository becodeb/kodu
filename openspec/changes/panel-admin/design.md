# Design: Panel de administración (`/admin`)

> **Size note**: `sdd-design` sets an 800-word budget. This design is deliberately
> over it. The orchestrator asked for a file-by-file buildable answer to ten
> architectural questions plus eight UI surfaces across eight slices. Compressing
> that to 800 words would push the real decisions into `sdd-apply`, where nobody
> reviews them. Prose is kept tight; tables carry the weight.

## Technical Approach

Three moves, in this order:

1. **Identity stops being a claim and becomes a read.** `src/middleware.ts` resolves
   role and the AI flags from Postgres on every authenticated request to a gated
   path. The JWT keeps identity; the database keeps authority.
2. **Engines stop being a compile-time enum and become rows.** `AiModel` carries the
   provider identifier, an AES-256-GCM key, prices, order and the fallback link.
   `resolveProvider()` goes async and reads a short-lived cached catalog.
3. **Money gets recorded at the moment it is spent.** `TokenUsage` gains the project,
   cached-input tokens, and a frozen USD snapshot computed from the prices in force
   at write time. Nothing recomputes history.

Everything else — users table, domains, demo, cross-owner access — hangs off those
three. Slices M1–M8 in the proposal map to the sections below.

**Prisma wiring**: `prisma.config.ts` is untouched; the datasource still resolves
`DATABASE_URL` at runtime through `@prisma/adapter-pg`. Every schema edit requires
`npm run db:generate` before `npm run check` passes, because the client at
`src/generated/prisma` is what TypeScript reads. Migrations stay hand-written; after
editing `schema.prisma`, write the SQL yourself and mark it applied with
`prisma migrate resolve --applied <nombre>` rather than letting `prisma migrate dev`
diff the schema (it would drop the partial indexes below, which Prisma cannot express).

---

## 1. Per-request role and flag resolution (M1)

### The read

`src/middleware.ts`, after `readSessionFromCookies`:

```ts
const identidad = await prisma.user.findUnique({
  where: { id: claims.id },
  select: { id: true, email: true, name: true, role: true,
            aiAccessOverride: true, isDemo: true },
});
```

One indexed primary-key lookup, six columns, no relations, no counts.

### Which requests pay for it

| Path class | Examples | DB read |
|---|---|---|
| Public | `/`, `/gallery`, `/p/[slug]`, `/uploads/*`, `/login`, `/register`, `/api/auth/*` | **No** |
| Gated pages | `/app/**`, `/admin/**` | Yes |
| Gated APIs | `/api/projects`, `/api/chat`, `/api/rules`, `/api/uploads`, `/api/admin` | Yes |

Public routes skip it entirely. `BaseLayout.astro` still renders the nav on public
pages from the JWT claims, so a demoted admin browsing `/gallery` sees a "Panel"
button until they click it and `/admin` refuses them. That is the whole cost of
skipping, and it is acceptable: the button is not authority, the route is.

Cost: **exactly one extra query per gated request**. On `/api/chat/stream` it is
noise next to a retry ladder that can run 102 seconds. On `/app` it is one of the
several queries the page already runs.

### Caching

None across requests. A cache is precisely what decision 5 forbids — a promotion
must land on the next request, and a revoked demo toggle must bite immediately.
Within a request the value lives in `Astro.locals`, read once, reused everywhere.

### When the read fails

The proposal suggests keeping the JWT `role` as a degraded fallback. **Confirmed for
reads, overruled for writes**, split like this:

| Situation | Behaviour |
|---|---|
| Read throws (DB blip) | Keep JWT identity and `role`; force `aiAccess = false` and `isDemo = false`; set `locals.identityFresh = false` |
| `identityFresh === false` on any mutating `/api/admin/*` | 503, `"No pudimos confirmar tus permisos. Probá de nuevo en unos segundos."` |
| `identityFresh === false` on a read-only admin page | Render, with a strip saying the data may be stale |
| Row missing (user deleted) | Clear the cookie, treat as anonymous |
| DB role differs from the claim | DB wins, always |

Reasoning: if Postgres is down, every page is already broken, so refusing admins
entry buys nothing. But letting a stale claim *grant an admin a write* during that
same blip is the one case worth failing closed on. The spending flags fail closed
unconditionally, because the cost of a wrong `true` there is real money.

### `src/env.d.ts`

```ts
declare namespace App {
  interface Locals {
    user: SessionUser | null;
    /** false cuando la lectura de identidad falló y se usó el JWT degradado. */
    identityFresh: boolean;
  }
}
```

`SessionUser` gains `aiAccessOverride: boolean | null` and `isDemo: boolean`.

### Shared guards

New `src/lib/auth/guards.ts`:

```ts
export function requireUser(locals: App.Locals): SessionUser        // throws 401
export function requireAdmin(locals: App.Locals): SessionUser       // throws 403
export function requireFreshAdmin(locals: App.Locals): SessionUser  // + 503 si !identityFresh
```

They return a `Response` via `fail()` rather than throwing, matching how every
existing route handles refusal.

---

## 2. The `AiModel` table (M2)

```prisma
model AiModel {
  id            String @id                  // generado en la app (ver §4: es el AAD)
  /// Etiqueta corta del proveedor: "gmi", "deepseek", "openrouter".
  provider      String
  /// El identificador exacto que espera la API: "MiniMaxAI/MiniMax-M3".
  providerModel String
  /// Lo que ve el docente en el selector.
  displayName   String
  /// Una línea para el docente, debajo del selector.
  description   String?
  /// Nota interna. El docente nunca la ve.
  adminNote     String?
  baseUrl       String

  /// AES-256-GCM. Formato "v1.<nonce>.<ct>.<tag>" en base64url. Nunca sale del server.
  apiKeyCipher  String?
  /// Últimos 4 caracteres de la clave en claro, para reconocerla en el panel.
  apiKeyHint    String?

  /// Precio APROXIMADO en USD por millón de tokens. NULL = sin cargar (≠ 0 = gratis).
  /// Entrada sin caché ("cache miss"): lo que se cobra por un token nuevo.
  priceInputPerMToken       Decimal? @db.Decimal(12, 6)
  priceOutputPerMToken      Decimal? @db.Decimal(12, 6)
  /// Entrada que el proveedor ya tenía cacheada. Suele costar 50× menos.
  priceCachedInputPerMToken Decimal? @db.Decimal(12, 6)

  enabled             Boolean @default(true)
  /// Aparece en el selector del docente. DeepSeek va en false: es el respaldo.
  selectableByTeacher Boolean @default(true)
  /// Ver el índice único parcial en la migración: a lo sumo un true.
  isDefault           Boolean @default(false)
  sortOrder           Int     @default(0)

  maxOutputTokens Int     @default(65536)
  maxInputChars   Int     @default(400000)
  supportsVision  Boolean @default(false)
  /// Tope acumulado por usuario, en tokens. 0 = sin tope.
  userTokenLimit  Int     @default(0)

  fallbackModelId String?
  fallbackModel   AiModel?  @relation("Respaldo", fields: [fallbackModelId], references: [id], onDelete: SetNull)
  respaldoDe      AiModel[] @relation("Respaldo")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  projects   Project[]
  tokenUsage TokenUsage[]

  @@unique([provider, providerModel])
  @@index([enabled, sortOrder])
}
```

### Why the pricing shape

Three rates, because that is how the bill arrives. DeepSeek's published September 2026
pricing confirms the structure rather than a two-rate simplification:

| Model | Cached input | Input (cache miss) | Output |
|---|---|---|---|
| DeepSeek V4.1 Flash, off-peak | $0.003 | $0.15 | $0.60 |
| DeepSeek Pro, off-peak | $0.022 | $0.66 | $1.98 |

(Sources: <https://deepseek.ai/pricing>, <https://benchlm.ai/deepseek/api-pricing>.)

Cached input costs **50× less** than a cache miss on Flash. Folding the two into one
"input" rate would overstate the bill on every turn that reuses a system prompt,
which in this app is every turn after the first in a thread. Three columns match how
the numbers are published, so an admin copies them without arithmetic.

Nullable because `NULL` means "nobody loaded this price" and `0` means "this model is
free" — two different facts, and collapsing them would make every free model look
unpriced. MiniMax on GMI Cloud is genuinely free here, so `0` is a value this table
carries in production, not a placeholder.

### One flat rate set, and the error it carries

Per `specs/ai-model-catalog/spec.md`, "Pricing is one flat, approximate rate set":
**no peak/off-peak columns.** DeepSeek bills exactly 2× off-peak during 01:00–04:00
and 06:00–10:00 UTC. Modelling that would mean two more rate columns plus a window
definition on every model, and every other provider's form would carry four dead
fields to serve one provider's billing quirk.

The margin of error this accepts, stated so nobody mistakes the figure for a bill:

> **For DeepSeek — the only paid engine in this deployment — real spend can be up to
> twice the displayed figure.** Seven hours of every UTC day fall inside a peak
> window, so a displayed `US$ 4,00` means somewhere between `US$ 4,00` and
> `US$ 8,00`, depending on when the turns landed. MiniMax is free, so its figures
> carry no error at all.

The admin form therefore labels the section `Precio aproximado (USD por millón de
tokens)` and carries one line underneath:
`"Es una estimación. Algunos proveedores cobran distinto según la hora."` Every
admin USD figure in the panel is prefixed `≈`. Calling an estimate an exact number
is the failure mode this whole section exists to avoid.

### Numeric type and scale

`Decimal`, never `Float`. Binary floating point cannot represent `0.1`, so summing
thousands of turn costs drifts; the drift is small and invisible, which is worse than
large and obvious. Prisma maps `Decimal` to Postgres `numeric` and to
`Prisma.Decimal` (decimal.js) in TypeScript.

Two different scales, for two different jobs:

| Column | Type | Why |
|---|---|---|
| The three rate columns | `Decimal(12, 6)` | Providers publish 3–4 decimals (`0.003`, `0.022`). Six gives headroom without inviting fake precision; twelve digits total allows a rate up to 999 999 |
| `TokenUsage.costUsd` | `Decimal(16, 10)` | **A per-turn cost is a very small number.** 200 cached tokens at $0.003/M is `$0.0000006`. At scale 6 that rounds to `0.000000` — a real cost recorded as free, which is the exact lie this design exists to prevent. Ten decimals put the floor at `$0.0000000001`, far below any single turn |

Postgres `SUM()` over `numeric` is exact, so aggregating 10-decimal rows loses
nothing.

Display is a separate concern from storage, and it needs a rule because the honest
number is often unreadable:

| Value | Rendered |
|---|---|
| `>= 0.01` | `≈ US$ 3,17` (2 decimals) |
| `> 0` and `< 0.01` | `≈ US$ 0,0024` (4 decimals) |
| `> 0` but rounds to `0.0000` | `menos de US$ 0,0001` — **never** `US$ 0,00`, which reads as free |
| exactly `0` with prices loaded | `US$ 0,00` — true, and it means the free engine served the turn |
| `NULL` | `—` with `histórico` |

**Gotcha to carry into apply**: `Prisma.Decimal` does not survive `JSON.stringify`
as a number. Every API response and every Astro page prop must call `.toString()`
(for display) or `.toNumber()` (for charts) at the boundary. A `Decimal` handed to a
React island silently becomes `{}`.

### Exactly one default

A **partial unique index**, written by hand in the migration because Prisma cannot
express it:

```sql
CREATE UNIQUE INDEX "AiModel_un_solo_default"
  ON "AiModel" ("isDefault") WHERE "isDefault" = true;
```

Setting a new default runs inside `prisma.$transaction`: clear the old, set the new.
The transaction is the mechanism; the index is the thing that catches a bug in it.

The index permits **zero** defaults, so the resolver must handle that:

| Case | Behaviour |
|---|---|
| Default exists and is enabled | Use it |
| Default exists but is disabled | Use the enabled model with the lowest `sortOrder`; log a warning |
| No default at all | Same fallback |
| No enabled model at all | Chat answers 503: `"No hay ningún motor habilitado. Avisale a un administrador."` |

Disabling the row that is currently default is **refused** at the API with 409:
`"Ese motor es el predeterminado. Elegí otro predeterminado antes de apagarlo."`
Silently promoting a model the admin did not pick is how the wrong engine ends up
serving everyone.

**Deleting a model is not implemented.** The FKs are `onDelete: SetNull`, so a delete
would not orphan rows, but it would erase what every historical `TokenUsage` row
meant. Disable is the only removal. No `DELETE /api/admin/models/:id` exists.

---

## 3. The enum → FK migration (M2)

One file, `prisma/migrations/20260919000000_catalogo_de_motores/migration.sql`,
opening with the Spanish WHY block. Postgres runs DDL transactionally, so the whole
file is one atomic step.

```
1. CREATE TABLE "AiModel" + índices (incluido el parcial de default)
2. INSERT de 4 filas semilla con UUID literales fijos
3. ALTER TABLE "Project"    ADD COLUMN "aiModelId" TEXT NULL REFERENCES "AiModel"("id") ON DELETE SET NULL
4. ALTER TABLE "TokenUsage" ADD COLUMN "aiModelId" TEXT NULL REFERENCES ... (+ columnas de §6)
5. UPDATE ... SET "aiModelId" = '<uuid>' WHERE "selectedModel"/"provider" = '<ENUM>'   (×3 por tabla)
6. ALTER TABLE "TokenUsage" ALTER COLUMN "provider" DROP NOT NULL
```

### The seed rows

A `.sql` file cannot read `.env`, so the seed values are the **defaults already
written into `src/lib/env.ts:48-93`**, which is where the real configuration lives
anyway. `apiKeyCipher` stays `NULL`; the admin enters keys through the panel after
deploy, and until then `cadenaDeMotores()` skips keyless models exactly as
`provider.ts:126-128` skips them today.

| UUID literal | displayName | provider / providerModel | enabled | selectable | default | fallback → |
|---|---|---|---|---|---|---|
| `…0001` | MiniMax M3 | gmi / `MiniMaxAI/MiniMax-M3` | true | true | **true** | `…0002` |
| `…0002` | MiniMax M2.7 | gmi / `MiniMaxAI/MiniMax-M2.7` | true | false | false | `…0003` |
| `…0003` | DeepSeek | deepseek / `deepseek-v4-flash` | true | false | false | — |
| `…0004` | Alpha | openrouter / `stealth/ox-alpha` | **false** | false | false | — |

Four rows, not three: the M2.7 sibling is a real link in today's chain
(`provider.ts:120-124`) and only becomes data if it gets a row. `selectableByTeacher`
is the field that preserves "DeepSeek stays under lock" — the proposal's field list
omitted it, and without it `enabled` would have to mean two different things.

Backfill mapping: `MINIMAX → …0001`, `DEEPSEEK → …0003`, `ALPHA → …0004`. Every
historical row lands on a row that says what it meant.

### What happens to the enum columns

**Retained, both of them, and the `ModelChoice` type is not dropped.**

- `Project.selectedModel` keeps `NOT NULL DEFAULT 'MINIMAX'`. The app stops reading
  and writing it; new rows satisfy the constraint through the default without the
  app knowing it exists.
- `TokenUsage.provider` loses `NOT NULL` (the one constraint relaxation, and
  relaxations are always safe). New rows write `NULL` there and fill `aiModelId`.

In `schema.prisma` both are marked with a `///` comment: *dato histórico, no leer.*

### Rollback, honestly

`migration_down.sql` sits beside the migration and is run by hand. It drops the new
columns and the table. Because no enum value was ever dropped, every row that existed
**before** M2 still answers the old question perfectly.

What is genuinely lost: usage rows written **between** the M2 deploy and the
rollback have `provider = NULL`. The down script remaps the three that can be
remapped:

```sql
UPDATE "TokenUsage" SET "provider" = 'MINIMAX'  WHERE "provider" IS NULL AND "aiModelId" IN ('…0001','…0002');
UPDATE "TokenUsage" SET "provider" = 'DEEPSEEK' WHERE "provider" IS NULL AND "aiModelId" = '…0003';
UPDATE "TokenUsage" SET "provider" = 'MINIMAX'  WHERE "provider" IS NULL;  -- modelos nuevos: no hay valor de enum
```

That last line is the accepted loss: a turn served by a model an admin added after
M2 has no enum value to become, so it is filed under MiniMax and the script prints
the affected count. `costUsd` on those rows is dropped with the column. This is not
a clean revert and the operator should be told so before running it.

---

## 4. API key encryption (M2)

New module `src/lib/crypto/secretos.ts`. Node's `crypto` is available under the
`@astrojs/node` adapter.

| Aspect | Decision |
|---|---|
| Key source | `KODU_ENCRYPTION_KEY`, 32 bytes as 64 hex characters |
| Relation to `AUTH_SECRET` | **Separate, not derived.** Rotating `AUTH_SECRET` logs everyone out; an operator must be free to do that without re-entering every provider key. HKDF from `AUTH_SECRET` would weld the two lifecycles together |
| Validation | Lazy, inside `secretos.ts`, not in `env.ts`'s schema — an instance with no models yet must still boot |
| Stored format | `v1.<nonce>.<ciphertext>.<tag>`, each part base64url. 12-byte nonce from `randomBytes`, 16-byte GCM tag |
| Version prefix | `v1` so a future `v2` (new KDF, key id, envelope) can live beside it during rotation |
| AAD | The model's `id`. A ciphertext copied into another row fails authentication |

The AAD choice is why `AiModel.id` has no `@default(uuid())`: the id must exist
**before** the key is encrypted, so the create path generates it with
`crypto.randomUUID()` and passes it explicitly.

### Failure modes

| Condition | Behaviour |
|---|---|
| `KODU_ENCRYPTION_KEY` missing, admin tries to save a key | 503, `"El servidor no tiene configurada la clave de cifrado. Sin eso no se pueden guardar claves de proveedor."` |
| Key missing or wrong, chat resolving a model | That model is treated as unusable and the chain moves to the next one — the same path as an empty key today. `console.error` names the model id, never the ciphertext |
| GCM auth tag fails | Same as above, distinct error class `ClaveInvalida`, so the log says "wrong key" rather than "no key" |

### Rotation

`scripts/rotar-clave.ts`, run with `tsx`. Reads `KODU_ENCRYPTION_KEY_OLD` and
`KODU_ENCRYPTION_KEY`, decrypts each row with the old, re-encrypts with the new,
writes all rows in one transaction, prints the count.

Re-encrypt-on-read is **rejected**: reads happen inside the chat hot path, and a
write hiding in a read is the kind of side effect that surprises someone at 2am.

Key lost with no backup: there is no recovery. The admin re-enters each key through
the panel; `apiKeyHint` tells them which key each row had.

### Browser invariant

`apiKeyCipher` appears in **no** `select` that feeds a page prop or an API response.
The models API returns `{ tieneClave: boolean, apiKeyHint: string | null }`. The
write path is a single write-only `apiKey` field: omitting it leaves the stored key
alone, sending `null` clears it.

Masked representation in the UI: `•••• 7f3a` when a hint exists, `Sin clave` when
not, with the field labelled `Reemplazar clave` and permanently empty on load.

---

## 5. Provider resolution from the database (M2, M3)

New file `src/lib/ai/catalogo.ts` (the catalog), leaving `src/lib/ai/provider.ts`
about HTTP and SSE. Signatures:

```ts
export interface ProviderConfig {
  id: string; label: string; apiKey: string; baseUrl: string; model: string;
  maxTokens: number; userTokenLimit: number; maxInputChars: number;
  supportsVision: boolean;
  precios: { input: Decimal; output: Decimal; cachedInput: Decimal | null } | null;
}

export async function resolverMotor(modelId: string | null): Promise<ProviderConfig | null>;
export async function motorPorDefecto(): Promise<ProviderConfig | null>;
export async function normalizarMotor(modelId: string | null): Promise<ProviderConfig | null>;
export async function cadenaDeMotores(desdeId: string | null): Promise<ProviderConfig[]>;
export async function motoresParaDocente(): Promise<MotorPublico[]>;  // sin claves ni precios
export function invalidarCatalogo(): void;
```

### Call sites

| File | Change |
|---|---|
| `src/pages/api/chat/stream.ts:242` | `normalizarEleccion(...)` → `await normalizarMotor(model ?? project.aiModelId)` |
| `stream.ts:284` | `resolveProvider(chosenModel)` → the config `normalizarMotor` already returned |
| `stream.ts:438` | `cadenaDeMotores()` → `await cadenaDeMotores(motor.id)` |
| `stream.ts:289-318` | `maxInputChars` / `userTokenLimit` read off the row |
| `src/pages/app/project/[id].astro:44` | `MODEL_CHOICES.filter(isChoiceConfigured)` → `await motoresParaDocente()` |
| `src/lib/workspace-types.ts:12-22` | `MODELOS` constant deleted; the list arrives as a prop |
| `src/components/workspace/ChatPanel.tsx:214,232` | Reads the prop instead of the constant |

### The cache

A module-level `Map<string, AiModel[]>` with a 30-second TTL and
`invalidarCatalogo()` called by every `/api/admin/models` mutation.

Being straight about what it buys: one primary-key query per chat turn is free next
to an LLM call. The cache is justified by the *decrypt*, which runs per model per
turn, and by `cadenaDeMotores` walking up to three rows. Since Astro node standalone
is a single process, explicit invalidation is exact and the TTL is only a net for a
future multi-process deploy. Thirty seconds means an admin toggling a model sees it
in a teacher's selector on the next page load, which satisfies "edits take effect
promptly" without ever serving a stale key.

### Building the chain from rows

```
motor = punto de partida
cadena = []
visitados = Set()
mientras motor && cadena.length < 3 && !visitados.has(motor.id):
    visitados.add(motor.id)
    si motor.enabled && tieneClaveUtilizable(motor): cadena.push(motor)
    motor = motor.fallbackModelId ? filas[motor.fallbackModelId] : null
si cadena vacía: cadena = [motorPorDefecto()]  (si existe)
```

Two guards that matter. The `visitados` set stops an admin who points A→B→A from
hanging the request. **The hard cap of 3 is the important one**: the retry ladder at
`provider.ts:180-182` burns ~102 seconds per engine before falling through, so a
five-link chain would make a teacher wait eight minutes to be told nothing worked.
Three is exactly today's worst case and it is a constant, not a setting — an admin
should not be able to configure a timeout that long by accident.

### A disabled model a project still points at

`normalizarMotor` returns the default. The repoint happens at **page load**, in the
frontmatter of `src/pages/app/project/[id].astro`: if the project's `aiModelId` is
missing, disabled or not selectable, it is updated to the default there and the page
passes `avisoDeMotor` to `Workspace`, which renders it as the existing quiet
`notice` bubble — `"Cambiamos el motor de este proyecto porque el anterior ya no
está disponible. Seguimos con MiniMax M3."` Not a modal, not an alarm.

`stream.ts` keeps the same normalisation as a backstop for a model disabled between
page load and send, reusing the update already at `stream.ts:244-249`.

**The notice cannot repeat**, and it needs no "seen" flag to guarantee that: the page
load persisted `aiModelId`, so the second visit finds a valid model and the condition
is false. Repointed on next use, no bulk migration, told once.

---

## 6. Cost accounting (M4)

### Columns

```prisma
model TokenUsage {
  // … existentes …
  provider          ModelChoice?   /// histórico, no leer
  projectId         String?
  project           Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)
  aiModelId         String?
  aiModel           AiModel? @relation(fields: [aiModelId], references: [id], onDelete: SetNull)
  cachedInputTokens Int      @default(0)
  /// Escala 10: el costo de UN turno puede ser 0,0000006 USD. Ver §2.
  costUsd                   Decimal? @db.Decimal(16, 10)
  priceInputSnapshot        Decimal? @db.Decimal(12, 6)
  priceOutputSnapshot       Decimal? @db.Decimal(12, 6)
  priceCachedInputSnapshot  Decimal? @db.Decimal(12, 6)

  @@index([projectId])
  @@index([userId, createdAt])
}
```

`onDelete: SetNull` on `projectId`, not `Cascade`: deleting a resource must not
delete the record of what it cost.

Both the total **and** the three rates are stored. The total is what every aggregate
sums (`SUM("costUsd")`, one column). The rates are the audit trail that explains the
total and lets someone recompute it after finding a typo, without guessing what was
in effect that day. Storing only the total makes a wrong price permanent and
unexplainable.

### The computation

```ts
const facturables = promptTokens - cachedInputTokens;   // ← la resta que importa
const tarifaCache = precios.cachedInput ?? precios.input;
costUsd = new Decimal(facturables).mul(precios.input).div(1e6)
  .add(new Decimal(cachedInputTokens).mul(tarifaCache).div(1e6))
  .add(new Decimal(completionTokens).mul(precios.output).div(1e6));
```

`prompt_tokens` in the OpenAI dialect **includes** the cached ones —
`prompt_tokens_details.cached_tokens` is a subset, not a sibling. Billing the cached
tokens at both rates is the commonest bug in this exact calculation. The subtraction
is the fix, and it needs `readCompletionStream` at `provider.ts:391-399` to start
emitting `cachedTokens: Number(chunk.usage.prompt_tokens_details?.cached_tokens ?? 0)`.

Arithmetic in `Prisma.Decimal`, never `number`.

If `precios === null`, or either of `input`/`output` is null: `costUsd = null` and
all three snapshots stay null. Nothing is ever fabricated.

### Where it happens

`recordUsage` keeps its single call site in the `finally` of
`src/pages/api/chat/stream.ts:623-631`. Its signature grows to
`{ userId, projectId, aiModelId, model, promptTokens, cachedInputTokens, completionTokens, precios }`
— the prices ride in on the `ProviderConfig` already in hand as `proveedorUsado`, so
there is no second query on the write path. The `finally` placement is preserved for
the reason the comment there already gives: the tokens were spent whether or not the
turn finished.

### Three states that look alike and are not

This deployment runs a **free principal engine** (MiniMax on GMI) and a **paid
automatic fallback** (DeepSeek). Most turns therefore cost exactly zero. That makes
the following distinction load-bearing everywhere a number is rendered:

| State | Row shape | Rendered as |
|---|---|---|
| **No usage at all** | no rows | `Todavía no usó la IA.` / indicator absent |
| **Usage, cost genuinely zero** | rows with `costUsd = 0` | `US$ 0,00` and, where there is room, `Los turnos se sirvieron con un motor sin costo.` |
| **Usage, price unknown** | rows with `costUsd = NULL` | `—` plus `histórico` |

A zero is an answer. Collapsing it into "no data" would tell an admin that a teacher
who built fifteen resources on the free engine had never used the platform.

Historical rows (`projectId` null, `aiModelId` null, `costUsd` null, `provider` enum
set) render the old enum name with a muted `histórico` tag and `—` in the cost
column, carrying `title="Consumo anterior al registro de precios"`. Never a
fabricated figure, and never a zero standing in for unknown.

---

## 7. Admin bypass of project ownership (M8)

`src/lib/projects.ts`:

```ts
export interface Actor { id: string; role: 'DOCENTE' | 'ADMIN' }

export async function findProjectForActor(projectId: string, actor: Actor) {
  return prisma.project.findFirst({
    where: actor.role === 'ADMIN' ? { id: projectId } : { id: projectId, userId: actor.id },
  });
}

/** El editor necesita hilos y adjuntos en la misma consulta. */
export async function findWorkspaceProjectForActor(projectId: string, actor: Actor) { … }
```

`findOwnedProject` is deleted in M8 and its **seven** call sites
(`uploads/index.ts:31`, `chat/cancel.ts:30`, `chat/stream.ts:225`,
`projects/[id].ts:21,54`, `projects/[id]/screenshot.ts:18,42`,
`projects/[id]/threads.ts:19,44`) switch to `findProjectForActor(id, locals.user!)`.
The refusal message stays `"El recurso no existe o no es tuyo."` for docentes.

`assertOwnedProject` (`projects.ts:18-22`) is referenced by nothing outside its own
file — **deleted**, not adopted.

### Correcting the proposal on the inline queries

The proposal names two inline ownership queries. Only one is:

- `src/pages/app/project/[id].astro:11` — a real ownership check. Becomes
  `findWorkspaceProjectForActor`.
- `src/pages/app/index.astro:10` — **not** an ownership check. It lists the acting
  user's own projects (`where: { userId: user.id }`). An admin browsing `/app` should
  see their own resources, not everyone's. It stays exactly as it is.

### Attribution

```prisma
model Project {
  lastAdminActorId  String?
  lastAdminActor    User?     @relation("AccionAdmin", fields: [lastAdminActorId], references: [id], onDelete: SetNull)
  lastAdminActionAt DateTime?
}
model ChatMessage {
  /// Quién escribió este turno cuando NO fue la persona dueña del recurso.
  authorUserId String?
  authorUser   User? @relation(fields: [authorUserId], references: [id], onDelete: SetNull)
}
```

Written whenever `actor.role === 'ADMIN' && actor.id !== project.userId`: the two
`Project` columns on any mutation, `authorUserId` on the messages of that turn. The
owner's chat then labels those bubbles, and their project card shows
`Editado por administración · hace 3 días` while `lastAdminActionAt` is under a week
old. An audit-log table is out of scope; these three columns are the durable mark
the risk register asked for.

---

## 8. Demo mode (M7)

| Aspect | Mechanism |
|---|---|
| Account creation | Lazily by `asegurarCuentaDemo()` the first time the toggle is switched on. Not in the migration, so `createdAt` means something |
| Identification | `User.isDemo Boolean @default(false)`, already in the middleware's narrow select. Partial unique index `WHERE "isDemo" = true` guarantees exactly one. Email `demo@kodu.local` is only for human readability |
| Credentials | `passwordHash = null`, `googleId = null`. Neither login path can reach it, so there is no credential to leak |
| Session issue | `POST /api/auth/demo` (form-urlencoded, same-origin, so `csrf.ts` covers it). Returns **404** when the toggle is off — not 403, so the endpoint does not advertise itself while closed. On success it sets the ordinary cookie with `DEMO_TTL_HOURS = 2` and redirects to `/app` |
| Ceiling | `AppSettings.demoTokenLimit` (default 200 000), checked where the per-model limit is checked today (`stream.ts:308-318`), summed across all models, `WHERE createdAt >= demoCycleStartedAt` |
| Reset | An admin button moves `demoCycleStartedAt` to now. It never deletes usage rows, so cost history survives a reset |
| Toggle off | The AI gate returns false for `isDemo && !demoEnabled`. The gate runs before a turn starts, so the turn already streaming finishes; the next one is refused with `"La demo está cerrada por el momento."` The session is not killed and the demo's resources stay readable |
| Gallery marking | `Project.createdByDemo Boolean @default(false)`, set at creation when the actor is the demo user. `DELETE /api/admin/demo/recursos` purges them; threads and assets cascade already |

Ceiling exhausted: `"La demo ya usó todo el crédito de esta ronda. Si querés seguir
armando recursos, creá tu cuenta: es gratis y tus recursos quedan guardados."`

### The residual abuse surface, stated plainly

**There is no rate limiting anywhere in this codebase.** Not on `/api/auth/login`,
not on `/api/chat/stream`, not on `/api/uploads`. That is a fact about the repository
today, and this change does not improve it.

What that means concretely for the demo:

- One visitor can burn the entire ceiling in a single sitting, and every other
  visitor that day gets the exhausted message. The ceiling caps total spend, not
  fairness.
- A script can call `/api/auth/demo` a thousand times. Each call issues a cookie for
  the *same* account, so the token ceiling still binds — but each of those sessions
  can also upload files up to `MAX_UPLOAD_MB` each and publish to the gallery.
  **Uploads and gallery spam from the demo are capped by nothing except the purge
  button, after the fact.**
- Disk is the exposure, not the API bill.

The ceiling is the only real cap and it only covers tokens. Rate limiting belongs in
its own proposal; pretending this change contains it would be worse than saying so.

---

## 9. `AppSettings` (M6)

```prisma
model AppSettings {
  id                 Int      @id @default(1)   // CHECK (id = 1) en la migración
  demoEnabled        Boolean  @default(false)
  demoTokenLimit     Int      @default(200000)
  demoCycleStartedAt DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

Seeded by the migration with one `INSERT`. Read through `leerAppSettings()` with a
10-second in-process cache and explicit invalidation on write — the same pattern as
the model catalog, and here it earns its keep, because `demoEnabled` is consulted on
every chat turn and on every render of `/login`.

**Singleton row over key-value**, because of how these values are read: in the
request path, typed, and few. A key-value table costs a row per value, forces every
read through a string key with no compile-time checking (`settings.get('demoEnabld')`
returns `undefined`, not a type error), and turns "read three settings" into three
lookups or a `groupBy` plus reshaping. The singleton is one primary-key read that
returns a fully typed object. Over env vars: a toggle must be writable at runtime,
which is the entire point.

Domains do **not** live here — a list of rows belongs in a table of rows:

```prisma
model AuthorizedDomain {
  id        String   @id @default(uuid())
  /// "rededucativa.edu.ar" o "*.edu.ar". Siempre minúsculas, sin "@".
  pattern   String   @unique
  note      String?
  createdAt DateTime @default(now())
}
```

---

## 10. Authorized domains (M6)

`User.deepseekEnabled` is **read by nothing** — grep confirms `src/lib/ai/provider.ts`
never consults it, and the column has been inert since
`20260826000000_deepseek_por_docente`. Its stored `true` values mean "this teacher
was allowed DeepSeek", which is not the question the new column asks. So the
migration renames it and clears it rather than reinterpreting it:

```sql
ALTER TABLE "User" RENAME COLUMN "deepseekEnabled" TO "aiAccessOverride";
ALTER TABLE "User" ALTER COLUMN "aiAccessOverride" DROP NOT NULL,
                   ALTER COLUMN "aiAccessOverride" DROP DEFAULT;
UPDATE "User" SET "aiAccessOverride" = NULL;
```

Three states, because two cannot express "no opinion":
`NULL` = follow the domain rule, `true` = explicit grant, `false` = explicit revocation.

### Precedence, exactly

| `aiAccessOverride` | Domain list | Domain matches | Result |
|---|---|---|---|
| `true` | any | any | **allowed** — an explicit grant beats an unlisted domain |
| `false` | any | any | **denied** — an explicit revocation beats a listed domain |
| `NULL` | empty | — | **allowed** |
| `NULL` | non-empty | yes | allowed |
| `NULL` | non-empty | no | denied |

### Why empty means allowed

It is the one case with two defensible readings, and the deciding factor is what
happens the morning M6 deploys. The table starts empty. If empty meant denied, every
teacher on the platform would lose AI access at once, caused by a migration — an
outage manufactured by a semantic choice. Empty meaning allowed makes M6 a no-op on
deploy, matching how `ALLOWED_EMAIL_DOMAINS` reads today (`domains.ts:26`), and the
admin opts into restriction by adding the first row.

The meaning is carried by the UI rather than by anyone's memory. Under the list:

- empty — `"La lista está vacía: cualquier docente registrado puede usar la IA."`
- non-empty — `"Solo estos dominios pueden usar la IA. El resto necesita un permiso individual."`

Seeding from the env var happens in `prisma/seed.ts`, idempotently (insert the parsed
`ALLOWED_EMAIL_DOMAINS` only when the table is empty), because SQL cannot read `.env`.

### Wildcards survive verbatim

The matcher moves from `domains.ts:28-34` into `puedeUsarLaIa()` unchanged, quirk
included: `*.edu.ar` becomes the suffix `.edu.ar`, so `escuela12.edu.ar` matches and
bare `edu.ar` does **not**. That asymmetry is existing behaviour and changing it
silently would quietly widen or narrow someone's access.

### The gate moves — and four call sites lose it

Today `isAllowedDomain` gates **registration, password login, and the Google
callback**, not just registration:

| File | Today | After M6 |
|---|---|---|
| `src/pages/api/auth/register.ts:19` | blocks registration | removed |
| `src/pages/api/auth/login.ts:20` | blocks login | removed |
| `src/pages/auth/callback.ts:37` | blocks Google login | removed |
| `src/pages/login.astro:55`, `register.astro:53` | shows `allowedDomainsLabel()` | prop removed from `AuthForm` |
| `src/pages/api/chat/stream.ts` | — | **new**: `puedeUsarLaIa(user)` before anything is spent |

Worth flagging to the owner: this means **existing users currently locked out of
login by a domain rule regain login** the day M6 ships. They just cannot use the AI.
That follows from the decision, but it is a visible change nobody asked about.

The gate lives in `stream.ts`, beside the token-limit check, **not** in the
middleware. The middleware resolves facts; policy decides. That placement is also
what makes "revoking access applies to the next turn, never the one already
streaming" true by construction rather than by care.

Refusal copy: `"Tu cuenta todavía no tiene habilitado el uso de la IA. Escribinos y lo vemos."`

---

## Data Flow

### Authenticated request

```
  cookie ──► verifySessionToken ──► claims {id, email, name, role}
                                       │
                          ¿ruta pública? ──sí──► locals.user = claims (identityFresh = false)
                                       │no
                                       ▼
                    prisma.user.findUnique (6 columnas, PK)
                          │ok                       │falla
                          ▼                         ▼
        locals.user = fila (role de la BD)   claims + aiAccess=false, isDemo=false
        identityFresh = true                 identityFresh = false
                          │
                          ├─► /admin/**      requireAdmin()
                          ├─► /api/admin/**  requireFreshAdmin()  (503 si !fresh)
                          └─► /app/**        requireUser()
```

### A chat turn

```
POST /api/chat/stream
   │
   ├─ findProjectForActor(projectId, locals.user)      (ADMIN pasa; docente sólo lo suyo)
   ├─ puedeUsarLaIa(user)                              ── no ──► 403
   ├─ normalizarMotor(body.model ?? project.aiModelId) ── cambió ──► notice + persiste el default
   ├─ message.length > motor.maxInputChars             ── sí ──► 413
   ├─ tope por usuario / tope de la demo                ── pasado ──► 429
   │
   ├─ cadenaDeMotores(motor.id)   →  [M3, M2.7, DeepSeek]   (máx. 3, sin ciclos, sin claves rotas)
   │      └─ por cada uno: requestCompletionStream (hasta 10 intentos, ~102 s)
   │
   ├─ readCompletionStream ──► text | tool | usage{prompt, cached, completion} | finish
   │
   └─ finally:
        recordUsage({ userId, projectId, aiModelId, tokens…, precios })
              └─ costUsd = (prompt − cached)·input/1e6 + cached·cacheado/1e6 + completion·output/1e6
                 (null si falta algún precio — nunca se inventa)
```

---

## File Changes

### M1 — Authorization and the `/admin` shell

| File | Action | What |
|---|---|---|
| `src/middleware.ts` | Modify | Per-request identity read; `/admin` and `/api/admin` prefixes; public-route skip list. Reuse the existing `matches()` helper — it already rejects `/adminfoo` correctly |
| `src/lib/auth/session.ts` | Modify | `SessionUser` gains `aiAccessOverride`, `isDemo` |
| `src/lib/auth/guards.ts` | Create | `requireUser` / `requireAdmin` / `requireFreshAdmin` |
| `src/env.d.ts` | Modify | `identityFresh: boolean` |
| `src/layouts/BaseLayout.astro` | Modify | Admin nav pill; generalise `[data-menu-perfil]` to `[data-menu]` so row menus reuse the open/close script |
| `src/layouts/AdminLayout.astro` | Create | Header, tab row, `wide` |
| `src/pages/admin/index.astro` | Create | Redirects to `/admin/usuarios` |
| `src/pages/admin/{usuarios,motores,dominios,demo}.astro` | Create | Empty shells |
| `e2e/harness.ts` | Create | Chromium launcher + login + dual-theme capture |
| `e2e/m1-admin-shell.ts` | Create | Slice verification |
| `.env.example` | Modify | Strip the `0x01` bytes on lines 25 and 38 |

### M2 — The catalog

| File | Action | What |
|---|---|---|
| `prisma/schema.prisma` | Modify | `AiModel`; FK columns on `Project`/`TokenUsage`; enum columns marked historical |
| `prisma/migrations/20260919000000_catalogo_de_motores/migration.sql` | Create | §3 |
| `prisma/migrations/20260919000000_catalogo_de_motores/migration_down.sql` | Create | Hand-run rollback, §3 |
| `src/lib/crypto/secretos.ts` | Create | `cifrar` / `descifrar` / `pistaDeClave` |
| `src/lib/ai/catalogo.ts` | Create | Catalog, cache, chain walk |
| `src/lib/ai/provider.ts` | Modify | Drop `MODEL_CHOICES`, `MODELO_PRINCIPAL`, `normalizarEleccion`, `resolveProvider`, `cadenaDeMotores`, `isChoiceConfigured`; `supportsVision` takes a config; `usage` event gains `cachedTokens` |
| `src/lib/env.ts` | Modify | Add `KODU_ENCRYPTION_KEY`; leave the `AI_*` vars in place (rollback depends on them) |
| `scripts/rotar-clave.ts` | Create | Key rotation |
| `e2e/unidad.ts` | Create | GCM round trip, chain cycle guard |

### M3 — Models route and teacher selector

| File | Action | What |
|---|---|---|
| `src/pages/admin/motores.astro` | Modify | Renders the list island |
| `src/components/admin/ModelosPanel.tsx` | Create | List, reorder, toggle, default radio |
| `src/components/admin/ModeloForm.tsx` | Create | Create/edit, write-only key field, price preview line |
| `src/pages/api/admin/models/index.ts` | Create | `GET` list, `POST` create |
| `src/pages/api/admin/models/[id].ts` | Create | `PATCH`, incl. the default transaction |
| `src/pages/api/admin/models/orden.ts` | Create | `PATCH` full ordered id array |
| `src/components/workspace/ChatPanel.tsx` | Modify | Selector from props; name + description |
| `src/lib/workspace-types.ts` | Modify | `MODELOS` deleted; `MotorPublico` added |
| `src/pages/app/project/[id].astro` | Modify | Feeds `motoresParaDocente()` |

### M4 — Cost

| File | Action | What |
|---|---|---|
| `prisma/schema.prisma` + migration | Modify/Create | `TokenUsage` columns (folded into the M2 migration if M2 and M4 ship together; separate file otherwise) |
| `src/lib/ai/usage.ts` | Modify | `recordUsage` with prices; `costoPorProyecto`; `consumoPorUsuario` |
| `src/pages/api/chat/stream.ts` | Modify | Single write site keeps its `finally`; cached tokens threaded through |
| `src/pages/app/project/[id].astro` | Modify | Passes the project's consumption to the workspace |
| `src/components/workspace/IndicadorConsumo.tsx` | Create | Neutral reading, USD on hover/focus/tap |

### M5 — Users

| File | Action | What |
|---|---|---|
| `src/pages/admin/usuarios.astro` | Modify | Table |
| `src/pages/admin/usuarios/[id].astro` | Create | Detail |
| `src/components/admin/UsuariosTabla.tsx` | Create | Rows + overflow menu |
| `src/components/admin/GraficoColumnas.tsx` | Create | 30-day SVG columns |
| `src/components/admin/GraficoBarras.tsx` | Create | Stacked SVG bar by model |
| `src/pages/api/admin/users/[id].ts` | Create | `PATCH` role and AI override |
| `src/pages/app/consumo.astro` | **Delete** | Absorbed |
| `src/layouts/BaseLayout.astro` | Modify | Drop the "Consumo de tokens" dropdown item (`:132-139`) |

### M6 — Access

| File | Action | What |
|---|---|---|
| `prisma/schema.prisma` + migration | Modify/Create | `AppSettings`, `AuthorizedDomain`, `deepseekEnabled` rename |
| `src/lib/settings.ts` | Create | `leerAppSettings()` + cache |
| `src/lib/auth/domains.ts` | Modify | DB-backed; `puedeUsarLaIa(user)`; wildcard matcher preserved |
| `src/pages/api/auth/{register,login}.ts`, `src/pages/auth/callback.ts` | Modify | Domain gate removed |
| `src/pages/{login,register}.astro`, `src/components/AuthForm.tsx` | Modify | `allowedDomains` prop removed |
| `src/pages/api/chat/stream.ts` | Modify | Gate added |
| `src/pages/admin/dominios.astro` + `src/pages/api/admin/domains/*` | Create | CRUD |
| `prisma/seed.ts` | Modify | Idempotent domain import from the env var |

### M7 — Demo

| File | Action | What |
|---|---|---|
| Migration | Create | `User.isDemo` + partial unique index; `Project.createdByDemo` |
| `src/lib/demo.ts` | Create | `asegurarCuentaDemo`, `consumoDeLaDemo` |
| `src/pages/api/auth/demo.ts` | Create | 404 when off |
| `src/pages/login.astro` | Modify | Discreet line |
| `src/pages/admin/demo.astro` + `src/pages/api/admin/demo/*` | Create | Toggle, ceiling, reset, purge |
| `src/pages/api/chat/stream.ts` | Modify | Demo ceiling check |

### M8 — Cross-owner access

| File | Action | What |
|---|---|---|
| Migration | Create | `Project.lastAdminActor*`, `ChatMessage.authorUserId` |
| `src/lib/projects.ts` | Modify | `findProjectForActor`; `findOwnedProject` and `assertOwnedProject` deleted |
| 7 API routes | Modify | Switch to the actor helper |
| `src/pages/app/project/[id].astro` | Modify | Actor helper + banner |
| `src/components/admin/BannerAdmin.astro` | Create | The strip |
| `src/components/workspace/ChatPanel.tsx` | Modify | Author label on admin-written bubbles |

---

## UI Design

Design read: an operator console for three people, living inside a teacher-facing
product. Density can run higher than `/app` because the audience is looking for a
number and an action. The visual language does **not** change — a distinct admin
theme would read as a different website and would break the token discipline that
`src/styles/global.css` has held so far. Boldness is spent in exactly one place: the
nav pill that says you are leaving `/app`.

Every colour below is a token (`linea`, `lienzo`, `superficie`, `sutil`, `carbon`,
`brand-*`, `ink-500/700/900`). No `bg-white`, no `bg-slate-*`, no raw hex. Radii stay
at 10px for boxes and 8px for controls.

### The admin nav entry

Right-hand column of the three-column nav, immediately left of the profile
`<details>`, rendered only when `role === 'ADMIN'`:

```
border border-linea bg-sutil rounded-lg px-2.5 py-1.5 text-sm text-ink-700
  ├─ <span class="h-1.5 w-1.5 rounded-full bg-brand-600">   (aria-hidden)
  └─ "Panel"
```

On `/admin/*`: `aria-current="page"` plus `border-brand-300 text-brand-700`.

It differs by **kind**, not by volume. The centre links are bare text with a gradient
hover (`kodu-nav-link`); this is a bordered object with a filled dot, so it reads as a
different sort of destination at a glance. The dot is the only brand colour on it.

Rejected: `kodu-btn-primary`. A filled blue button would out-weigh "Crear cuenta" on
the same bar and make the operator route the loudest element in a product built for
teachers.

Below `sm` the label stays — "Panel" is five characters and fits at 360px. A
dot-only button would be unreadable.

### The `/admin` shell

A horizontal tab row under the page header. Not a sidebar.

```
┌──────────────────────────────────────────────────────────────┐
│  Panel                                                       │   h1 text-2xl font-bold text-ink-900
│  Motores, acceso y consumo de la plataforma.                 │   mt-1 text-sm text-ink-500
│  ┌──────────┬─────────┬───────────┬──────┐                   │   mb-6 max-w-2xl
│  │ Docentes │ Motores │ Dominios  │ Demo │                   │   bg-sutil p-0.5 rounded-lg
│  └──────────┴─────────┴───────────┴──────┘                   │
└──────────────────────────────────────────────────────────────┘
```

Justified against the existing layout: the product has no sidebar anywhere, the nav
is a single top bar, and there are four destinations. A sidebar would spend 240px of
a table-heavy page on four links and would be the only sidebar in the app. The tab
row reuses the segmented-control idiom already shipping in `ChatPanel.tsx:213`
(`flex rounded-lg bg-sutil p-0.5`, active tab `bg-superficie text-ink-900 shadow-sm`),
so it is a pattern the codebase already carries.

Mobile: the same row becomes a horizontally scrollable strip
(`overflow-x-auto -mx-4 px-4 snap-x`) keeping full labels. No hamburger, no
`<select>` — a select hides the sibling sections, which is the one thing a tab row
exists to show.

The layout uses `wide` (`max-w-[110rem]`) so the users table breathes.

### The users table

| Column | Treatment |
|---|---|
| Docente | Name over email, the two-line cell from `consumo.astro:96-99`. A small muted glyph beside the email marks a Google account |
| Rol | `Docente` / `Admin` as plain text |
| Acceso a la IA | `Sí · por dominio` / `Sí · permiso individual` / `No`. The reason, not just the verdict |
| Recursos | `text-right tabular-nums` |
| Tokens | `text-right tabular-nums`, thousands in `es-AR` |
| USD | `text-right tabular-nums`, `≈ US$ 1,24` per the rounding table in §2; `US$ 0,00` when the free engine served everything; `—` when every row is historical. Visible without hover — per `specs/ai-cost-accounting/spec.md`, admin surfaces show USD unconditionally; the reveal interaction belongs to the teacher's workspace only |
| Última actividad | `hace 3 días` |
| ⋯ | Overflow menu |

Cells `px-4 py-3`, header `border-b border-linea text-xs text-ink-500 uppercase`,
rows `border-b border-linea last:border-0`, all matching `consumo.astro` exactly.

Join date and auth method were considered and **cut from the table**: nobody scans a
user list by signup date (it moves to the detail view), and auth method matters only
when someone cannot log in (it becomes the glyph). Two fewer columns keeps the table
readable at 1024px.

Overflow menu: a `<details>` whose `<summary>` carries the three dots — the same
mechanism as the profile dropdown at `BaseLayout.astro:109-170`. `<summary>` is
natively focusable and opens on Enter or Space, so it is keyboard-reachable with no
focus-trap code, and the existing click-outside plus Escape handlers cover it once
the selector is generalised to `[data-menu]`. Items:

- `Hacer administrador` / `Quitar administrador`
- `Habilitar la IA` / `Bloquear la IA` / `Volver a la regla del dominio`
- `Ver ficha`

Each is a `<button>` calling `apiRequest`. The last admin cannot demote themselves:
the API answers 409 with `"Sos el único administrador. Nombrá a otro antes de sacarte el rol."`

Empty state: `kodu-card p-10 text-center`.

### The user detail view

```
┌─ Ana Giménez ────────────────────────────────────────────────┐
│  ana@escuela12.edu.ar · se sumó el 4 de marzo · Google        │
├──────────────┬──────────────┬────────────────────────────────┤
│  482,1 k     │  US$ 3,17    │  9 recursos                    │   figuras, font-display text-2xl
│  tokens      │  costo       │                                │   label text-xs text-ink-500
├──────────────┴──────────────┴────────────────────────────────┤
│  Consumo de los últimos 30 días          [columnas SVG]       │
├──────────────────────────────────────────────────────────────┤
│  En qué motor se fue                      [barra apilada SVG] │
├──────────────────────────────────────────────────────────────┤
│  Recursos                                 [lista, cada uno    │
│                                            abre el editor]    │
└──────────────────────────────────────────────────────────────┘
```

**Two charts, and only two.** Each answers a question an operator actually asks.

**Both charts are denominated in tokens, with USD as an annotation beneath.** That is
not a stylistic choice, it follows from the engine mix: MiniMax is free, so a
dollar-denominated chart would be a flat zero line for a teacher who has been using
the platform every day. Tokens measure *use*; dollars measure *the bill*. The charts
answer the first question and label the second.

**1. Consumption over the last 30 days — columns.**
`<svg viewBox="0 0 700 160">`, one `<rect class="fill-brand-600">` per day, width
`700/30 − 4`, height proportional to that day's tokens. Answers: *is this person
ramping up, or did they try it once in March?* Columns, not a line: a line
interpolates across days with no turns and invents usage that did not happen.
Gridline at the max value only, `class="stroke-linea"`, labelled with the figure.

- No rows at all: the chart is replaced by one sentence — `"Todavía no usó la IA."`
  Not an empty axis.
- Rows exist but every turn was free: **the chart renders normally.** The columns are
  token heights, which are not zero. The subtitle reads
  `"482,1 k tokens · US$ 0,00 — todo con el motor sin costo."`
- One day of data: one column, its date below it, no axis, no interpolation.

**2. Where the use went, and what it cost — a horizontal stacked bar.**
One `<rect>` per model, width proportional to **tokens**, filled `brand-600`,
`brand-300`, `brand-100` in order. Beneath each: the model name, its token count, and
its USD (`≈ US$ 3,17`, or `US$ 0,00`, or `— histórico`). Answers: *which engine is
doing the work, and which one is generating the bill?* Those are usually different
engines here, which is exactly why one bar carries both figures.

A pie is rejected — two to four slices where one holds 95% is unreadable, and the
legend costs more room than the bars do.

- No rows at all: same sentence treatment.
- All free: the bar renders at full width with `US$ 0,00` beneath. Not empty.
- One model: a full-width bar with its label. Still true, still readable.

Explicitly rejected: a sparkline per table row (decoration at this data volume), a
cumulative-total line (the figure above already says it), any donut, and a grid of
KPI tiles.

Accessibility for both: `role="img"` with a `<title>`, a `<title>` per `<rect>` for a
native tooltip with zero JavaScript, and a `<table class="sr-only">` carrying the same
numbers. Dark mode follows automatically because the fills are token classes, not
attributes — `brand-600` is redefined at `global.css:65`.

### The models list

One `kodu-card` per row:

```
⠿  1   MiniMax M3                        •••• 7f3a   in 0,27 / out 1,10   [●—] ( ) default  Editar
        gmi · MiniMaxAI/MiniMax-M3
```

**Reorder.** The handle is a `<button>`, not a bare `<span>`: pointer drag via
`draggable` for the mouse, and **ArrowUp / ArrowDown while focused** for the keyboard,
moving the row one position and announcing it through an `aria-live="polite"` region
(`"MiniMax M3, posición 2 de 4"`). `aria-label="Mover MiniMax M3"`. Drag-and-drop
alone is unreachable, so the keyboard path is not an add-on, it is the primary
contract and the drag is the shortcut.

Both paths write the same `PATCH /api/admin/models/orden` with the **full ordered
array of ids**, not a delta. One endpoint for two input methods, and a concurrent
edit becomes last-write-wins instead of a corrupted sequence.

**Enable toggle**: the rail-and-knob switch already built at `BaseLayout.astro:147-156`,
lifted into `src/components/admin/Interruptor.tsx`.

**Default**: a real `<input type="radio" name="motor-default">`, so arrow keys move
between models natively and the group reads correctly to a screen reader. Selecting
it fires the transaction from §2.

**Price fields.** Three inputs under one heading,
`Precio aproximado (USD por millón de tokens)`, labelled
`Entrada (sin caché)`, `Entrada cacheada` and `Salida`. No peak/off-peak fields (§2).
One line under the group:
`"Es una estimación. Algunos proveedores cobran distinto según la hora."`

A live preview line sits below them:
`"Un turno típico —8.000 de entrada, 2.000 cacheados, 4.000 de salida— costaría ≈ US$ 0,0033."`
That preview is the defence against a rate entered in the wrong unit (per thousand
instead of per million is a factor of 1000), which is the risk register's concern and
is otherwise invisible until a monthly total looks wrong. It also makes the
cache-miss versus cached distinction concrete while the admin is typing.

A model with no prices loaded shows `Sin precio cargado` in the list row, not
`US$ 0,00`.

### The workspace cost indicator

Placement: the breadcrumb strip at `src/pages/app/project/[id].astro:52-78`, pushed
right with `ml-auto`. **Not** inside `ChatPanel` — the chat column is where attention
belongs.

### Default reading: a qualitative level

`Consumo bajo` / `Consumo medio` / `Consumo alto`, in `text-xs text-ink-500`. No
currency, and **no invented unit**.

`ficha` is forbidden here, per `specs/ai-cost-accounting/spec.md`. In this app
"Ficha" already names the resource's title-and-description card and its workspace
tab — `FichaDialog.tsx:35` says *"lo podés cambiar cuando quieras desde la pestaña
Ficha"*, and `PreviewPanel.tsx:29` calls the right-hand panel *"visor, editor de
código y ficha del recurso"*. Two meanings of one word on one screen, in the same
panel. `bajo` / `medio` / `alto` are ordinary adjectives and collide with nothing in
the domain vocabulary (recurso, motor, hilo, regla, galería, ficha, tope). They are
plain text in a token colour, so both themes are satisfied by construction.

### What drives the level, and where the number came from

**The level tracks tokens, not dollars.** Driving it by cost would pin every project
at `bajo` forever, because the principal engine is free — a label that never changes
is decoration. Tokens answer the question a teacher actually has ("did I lean on this
a lot?"), and the reveal answers the one the school has ("what did that cost?").

Two constants in `src/lib/ai/usage.ts`, against the project's accumulated tokens:

```ts
/** Los cortes son arbitrarios: están calibrados a ojo, no derivados de nada. */
export const CONSUMO_MEDIO = 250_000;   // ~15 turnos de trabajo pesado
export const CONSUMO_ALTO  = 1_000_000;
```

Saying this plainly rather than dressing it up: **these thresholds are arbitrary.**
A turn in this app runs roughly 8k prompt plus 10k completion, so 250 000 is about
fifteen substantial turns and 1 000 000 is about sixty. They are a rough calibration
chosen so the word means something, not a derivation, and they should be revisited
once there are a few months of `TokenUsage` rows to look at.

Alternatives considered and rejected:

| Option | Why not |
|---|---|
| Relative to the platform's distribution | A teacher's label would move because of other people's work, with no explanation available to them |
| Relative to the project's own history | A project's first turn is always 100% of its history, so every project would read `alto` on day one |
| Absolute USD bands | Meaningless to a docente with no reference point, and always `bajo` here |
| A knob in `AppSettings` | More configuration than a cosmetic label is worth. Two named constants make it a one-line edit |

### The reveal

A `<button aria-expanded>` opening a small `kodu-card` popover on `mouseenter`, on
`focus`, and on click, closing on `mouseleave`, `blur` and Escape. It shows both
numbers, so the relationship between the level and the money is explicit rather than
implied:

```
128,4 k tokens
≈ US$ 0,42 acumulado en este recurso
```

Why a button and not the obvious alternatives: a `title` attribute gives nothing on
touch and cannot be styled; a CSS-only `:hover` is unreachable by keyboard. One
button satisfies hover, tap and keyboard.

It never animates, never changes colour on update, and never polls. The figure is
computed in the Astro frontmatter on page load, so it refreshes when the page does.
A live counter ticking beside a chat is exactly the competition for attention the
decision rules out.

| Project state | Level | Popover |
|---|---|---|
| No turns recorded | indicator absent (not a `0`) | — |
| Turns, all on the free engine | from the token thresholds | `128,4 k tokens` · `US$ 0,00` · `Los turnos se sirvieron con un motor sin costo.` |
| Turns, some on the paid fallback | from the token thresholds | `128,4 k tokens` · `≈ US$ 0,42 acumulado en este recurso` |
| Turns, prices never loaded | from the token thresholds | `128,4 k tokens` · `Sin precios registrados para estos turnos.` |

The steady state of this deployment is row two: a level that moves as the teacher
works, and an honest `US$ 0,00` behind it. The indicator is doing its job there — it
is reporting that the work was free, which is a fact worth having.

### The admin-acting banner

A full-width strip in the document flow, directly under the breadcrumb row, inside
the `wide` container:

```
border border-brand-300 bg-brand-50 rounded-[10px] px-4 py-2.5 text-sm text-brand-700
"Estás trabajando en un recurso de Ana Giménez. Todo lo que cambies lo va a ver esa persona."
                                                              [Volver al panel →]
```

`role="status"`. In the flow, not floating: it pushes the editor down instead of
covering part of it, so nothing is ever hidden behind it. In dark mode `brand-50`
becomes `oklch(0.28 0.09 273.2)` (a deep blue) and `brand-700` becomes light, so it
survives both themes without a single raw colour.

Rejected: a red or amber warning strip. Nothing is wrong — the admin is doing
something permitted, and colouring permitted work as an alarm trains people to
dismiss alarms.

For the owner, the durable mark: chat bubbles written during an admin turn carry
`Ana Giménez (administración)` above them in `text-xs text-ink-500`, and the project
card in `/app` shows `Editado por administración · hace 3 días` while
`lastAdminActionAt` is under a week old.

### The demo entry on the login screen

One line under the `¿No tenés cuenta?` line at `login.astro:57-60`, rendered only
when `demoEnabled`:

```html
<p class="mt-2 text-center text-sm text-ink-500">
  ¿Querés mirar cómo funciona?
  <form method="POST" action="/api/auth/demo" class="inline">
    <button type="submit" class="font-medium text-brand-600 hover:underline">Entrá a la demo</button>
  </form>
</p>
```

The same treatment as "Registrate" directly above it, one step quieter. No card, no
icon, no badge, no border. When the toggle is off the line is not rendered at all —
not hidden, not disabled. A POST form so it works without JavaScript.

---

## Interfaces / Contracts

All admin endpoints follow `src/lib/http.ts` exactly: `ok(data)` spreads at the top
level with HTTP 200, `fail(message, status, extra)` otherwise, zod `safeParse`
returning 422 with `parsed.error.issues[0]?.message`. All clients go through
`apiRequest<T>()`.

**Every mutating admin endpoint takes JSON.** `src/lib/csrf.ts:51-58` requires
same-origin only for form-like content types and exempts JSON, and there is no CSRF
token anywhere in the codebase. Keeping these endpoints JSON keeps them on the
existing, understood path. The one exception is `POST /api/auth/demo`, which is
form-urlencoded precisely so it works without JavaScript — and being form-like, it
gets the same-origin check for free.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/admin/models` | — | `{ motores: MotorAdmin[] }` — `tieneClave`, `apiKeyHint`, never `apiKeyCipher` |
| POST | `/api/admin/models` | full model + optional `apiKey` | `{ motor }` |
| PATCH | `/api/admin/models/[id]` | partial; `apiKey` write-only | `{ motor }` |
| PATCH | `/api/admin/models/orden` | `{ ids: string[] }` | `{ motores }` |
| GET | `/api/admin/users` | — | `{ usuarios: UsuarioFila[] }` |
| PATCH | `/api/admin/users/[id]` | `{ role?, aiAccessOverride? }` | `{ usuario }` |
| GET | `/api/admin/users/[id]/consumo` | — | `{ porDia, porModelo, total }` |
| GET/POST/DELETE | `/api/admin/domains[/id]` | `{ pattern, note? }` | `{ dominios }` |
| PATCH | `/api/admin/settings` | `{ demoEnabled?, demoTokenLimit? }` | `{ settings }` |
| POST | `/api/admin/demo/reiniciar` | — | `{ settings }` |
| DELETE | `/api/admin/demo/recursos` | — | `{ borrados: number }` |
| POST | `/api/auth/demo` | form, no fields | 302 to `/app`, or 404 when off |

`MotorPublico` (what the teacher's browser receives) is
`{ id, displayName, description, supportsVision }` and nothing else — no base URL, no
key state, no prices.

---

## Testing Strategy

The repo has no test runner and `npm run check` (`tsc --noEmit`) is the only
automated gate. Playwright is a devDependency **with no browsers downloaded**; the
orchestrator verified the system Chromium works.

| Layer | What | How |
|---|---|---|
| Types | Everything | `npm run check`, after `npm run db:generate` |
| Logic scripts | Domain precedence table (§10), cost arithmetic including the cached-token subtraction and the `Decimal(16,10)` floor (§6), the display-rounding table (§2), GCM round trip and AAD rejection (§4), chain cycle guard and 3-hop cap (§5), the `bajo/medio/alto` thresholds | `e2e/unidad.ts` with `node:assert/strict`, run by `npx tsx`. Not a test runner — a script that exits non-zero. It is the only honest way to check these, and every one of them is cheap to get subtly wrong |
| Browser | Every new surface, both themes | `e2e/<slice>.ts` driving real Chromium |
| Build | Whole app | `npm run build` |

`e2e/harness.ts`:

```ts
import { chromium } from 'playwright';
export const abrirNavegador = () => chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--disable-gpu', '--no-sandbox'],
});
export async function conTema(page, tema: 'light' | 'dark') {
  await page.evaluate((t) => localStorage.setItem('kodu-tema', t), tema);
  await page.reload();
}
```

`playwright.config.ts` is **not** added — there is no test runner to configure and
adding one would imply a suite that does not exist.

One browser check per slice, each capturing both themes:

| Slice | Browser check |
|---|---|
| M1 | A docente hitting `/admin` is redirected; an admin sees the shell; promoting a user in the DB takes effect on their next request |
| M2 | A seeded model resolves and answers a turn; a keyless model is skipped |
| M3 | Create a model, enable it, set it default, reorder by keyboard; it appears in the teacher's selector with its description; the price group shows three rates and no peak/off-peak fields |
| M4 | A turn writes a `TokenUsage` row with the right `costUsd`; a free-engine turn writes `costUsd = 0`, not `NULL`; the indicator shows `Consumo bajo` and reveals tokens plus USD on keyboard focus |
| M5 | Table renders; both charts render with data, with one data point, with free-engine-only data (non-empty chart, `US$ 0,00`), and with none at all; the overflow menu opens with the keyboard |
| M6 | An unlisted teacher registers and logs in but is refused the AI; an individual grant flips it |
| M7 | Toggle on → the line appears and the demo works; toggle off → the line is gone and the AI refuses; ceiling exhausted → the invitation copy |
| M8 | An admin opens someone else's project, prompts, and the owner sees the banner mark |

A grep gate every slice must pass:
`rg -n 'bg-white|bg-slate-' src/` returns nothing.

---

## Threat Matrix

The matrix's rows cover shell, git and PR automation. This change touches none of
them; its only routing boundary is in-app HTTP authorization.

| Boundary | Applicability | Reason |
|---|---|---|
| Documentation-like paths | N/A | No file-type classification and no file execution. The change reads and writes database rows and Astro routes |
| Git repository selection | N/A | No VCS automation. Migrations are applied by `prisma migrate deploy`, never by this code |
| Commit state | N/A | Same |
| Push state | N/A | Same |
| PR commands | N/A | Same |

The in-app routing boundary carries its own requirements instead, and they must
reach `tasks.md`:

| Case | Expected behaviour |
|---|---|
| `/adminfoo`, `/api/adminx` | Not treated as protected prefixes. The existing `matches()` helper (`middleware.ts:22-24`) already compares `pathname === prefix \|\| startsWith(prefix + '/')`. New prefixes MUST use it, not a bare `startsWith` |
| `/admin/**` for a DOCENTE | 302 to `/app`, not 404 and not a blank page |
| `/api/admin/**` for a DOCENTE | 403 JSON through `fail()`, never a redirect (it would break `fetch`) |
| `/api/admin/**` when `identityFresh === false` | 503, no mutation performed |
| Trailing slash, double slash, encoded `%2F` | Astro normalises the pathname before the middleware sees it; the check runs on `context.url.pathname`, which is already decoded |
| Playwright launching Chromium | Development and verification only. `e2e/**` is never imported by `src/**` and never ships in the build |

---

## Migration / Rollout

| Slice | Migration | Reversible |
|---|---|---|
| M1 | none | yes, revert the branch |
| M2 | `20260919000000_catalogo_de_motores` | partially — see §3. **The one awkward step** |
| M3 | none | yes |
| M4 | `TokenUsage` columns (folds into M2 if they ship together) | yes, drop the columns; only cost history is lost |
| M5 | none | yes |
| M6 | `AppSettings`, `AuthorizedDomain`, `deepseekEnabled` rename | yes; the rename is reversible, the cleared values are not (they were inert) |
| M7 | `User.isDemo`, `Project.createdByDemo` | yes |
| M8 | attribution columns | yes |

`KODU_ENCRYPTION_KEY` must exist in the deploy environment **before** M2 ships.
Without it M2 still deploys and the panel still lists models — it just refuses to
save a key, with a message that says why.

M8 depends only on M1 and can land before M2 if the owner needs cross-owner access
sooner.

---

## Open Questions

- [x] **DeepSeek prices.** Verified and recorded in §2. The seed migration still
      leaves them `NULL`; an admin enters them through the panel, because a price in
      a `.sql` file goes stale silently.
- [ ] **GMI / MiniMax price.** Believed to be zero (free tier), which is why the
      steady state of this deployment is `US$ 0,00`. Someone should confirm it is
      free rather than unbilled-for-now, and enter `0` explicitly — an explicit zero
      and an unloaded price render differently everywhere by design.
- [ ] **The `bajo/medio/alto` thresholds are arbitrary** (250 k / 1 M tokens).
      They are named constants so a better number is a one-line change. Worth
      revisiting after a few months of real `TokenUsage` rows.
- [ ] **Rate limiting.** Out of scope here and named plainly in §8. It should become
      its own proposal before the demo is opened to a public link.
- [ ] **Login regains for domain-blocked users** (§10). The decision follows from
      moving the gate, but nobody was asked about it. Worth a yes from the owner
      before M6 ships.
- [ ] **The `es-AR` currency format.** `US$ 1,24` is what `Intl.NumberFormat('es-AR',
      { style: 'currency', currency: 'USD' })` produces. Confirm that reads right to
      the owner rather than `USD 1,24`.
