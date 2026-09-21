# Design: Publicación, likes y motores

> **Size note**: `sdd-design` budgets 800 words. This design is over it, following the
> precedent of `archive/2026-09-19-catalogo-de-proveedores/design.md`. Nine independent
> surfaces share one branch; the migration runs unattended on production and the only
> automated gate (`npm run check`) cannot see a single behaviour in this change. Writing
> the SQL and the control states out here is the only thing that keeps `sdd-apply` from
> improvising them. Prose stays tight; SQL, tables and sketches carry the weight.

## Technical Approach

Three independent tracks that happen to share a migration:

1. **Publishing becomes a transaction, not a switch.** The client sequence is
   `flush → capture → POST screenshot → PATCH isInGallery`, and the PATCH refuses a null
   `screenshotUrl`. The server guard is what makes "no published resource without a
   cover" *true*; the client sequence is what makes it *pleasant*.
2. **Likes are a join table read twice per page.** `_count` for the number,
   `orderBy: { likes: { _count: 'desc' } }` for the order, and one bounded
   `projectId IN (…)` query for "did I like these".
3. **Two controls stop lying.** The admin row toggle moves to `selectableByTeacher`, the
   teacher's engine picker becomes a real listbox, and the teacher's USD figure leaves.

**Prisma wiring** (per `config.yaml rules.design`): `prisma.config.ts` and the datasource
are untouched. `src/generated/prisma` gains `ProjectLike` and `Project.screenshotAt`, so
`npm run db:generate` is mandatory before `npm run check` compiles. The migration is
hand-written and registered with
`npx prisma migrate resolve --applied 20260925000000_publicacion_likes_y_motores`.
`prisma migrate dev` must **never** generate it: its diff would drop the partial indexes
`AiModel_un_solo_default` and `User_un_solo_demo`, which Prisma cannot express.

---

## 1. Schema

```prisma
model Project {
  // … sin cambios …
  screenshotUrl String?
  /// Cuándo se sacó la portada vigente. Se compara contra `updatedAt` para
  /// saber si quedó vieja (ver design §6). NULL = portada sacada antes de que
  /// esta columna existiera; se trata como FRESCA, nunca como vieja.
  screenshotAt  DateTime?
  likes         ProjectLike[]

  @@index([userId])
  @@index([isInGallery, updatedAt])
}

/// Un "me gusta" de un docente sobre un recurso publicado (galería, M9).
/// No hay contador desnormalizado en `Project` a propósito: la galería lee 60
/// filas y un contador paralelo se desincroniza (ver §11).
model ProjectLike {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  projectId String
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  /// Un like por docente por recurso. Es TODA la regla anti-abuso que hay.
  @@unique([userId, projectId])
  /// El unique arranca con userId, así que NO sirve para contar por recurso ni
  /// para el join del `orderBy _count`. Este índice es el que sirve eso, y de
  /// paso el borrado en cascada de un recurso.
  @@index([projectId])
}
```

`User` gains `likes ProjectLike[]`.

**Why both FKs are `Cascade` and not `SetNull`**, unlike `Project.lastAdminActorId`
(`schema.prisma:150-151`): there, `SetNull` keeps the *fact* (someone from admin edited
this) while dropping the identity. Here the identity **is** the fact — a like is one
named teacher's endorsement, and `userId` cannot be null without destroying
`@@unique([userId, projectId])`. A deleted teacher's likes leaving with them is the
correct count, not data loss.

---

## 2. The migration — `prisma/migrations/20260925000000_publicacion_likes_y_motores/`

Purely additive: one `CREATE TABLE`, one `ADD COLUMN`, one `UPDATE`. Nothing is dropped,
nothing is re-keyed, no ciphertext moves. Postgres runs DDL transactionally, so the file
is one atomic step, and **every statement is guarded, so the whole file is replayable**
— unlike the provider split, this one has no point of no return.

### 2.1 `migration.sql`

```sql
-- POR QUE esta migracion esta escrita a mano y no generada por
-- `prisma migrate dev` (misma convencion que 20260919000000, 20260923000000 y
-- 20260924000000):
--
-- 1) Esta base tiene DOS indices unicos PARCIALES que Prisma no sabe expresar
--    en el schema: `AiModel_un_solo_default` (WHERE "isDefault" = true) y
--    `User_un_solo_demo`. `prisma migrate dev` genera un diff que no los
--    encuentra en el schema y los DROPEA. Esta migracion no los toca, pero se
--    escribe a mano por esa misma disciplina y se marca aplicada con
--    `prisma migrate resolve --applied`.
--
-- 2) El backfill tiene que ser SQL PURO. El deploy es un webhook de Coolify:
--    `docker/prod-entrypoint.sh:11` corre `npx prisma migrate deploy` y
--    arranca el server. La imagen de runtime NO puede correr un script de
--    TypeScript (`Dockerfile:51` = `npm ci --omit=dev`, sin tsx; el COPY de
--    `Dockerfile:53-56` no incluye `scripts/`). Nadie va a entrar a mano a
--    terminar esto.
--
-- 3) Todo lo de abajo es ADITIVO. No se borra ninguna columna, no se re-keyea
--    ninguna fila y no se toca una sola primitiva de cripto. La peor falla
--    posible es una tabla que todavia no existe, no una clave que dejo de
--    descifrar.
--
-- 4) NO se despublica ningun recurso que hoy este en la galeria sin portada.
--    Ver el comentario del backfill.

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProjectLike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Un like por docente por recurso: es toda la regla anti-abuso que hay. El
-- doble click del navegador choca contra esto, no contra logica de la app.
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectLike_userId_projectId_key"
    ON "ProjectLike"("userId", "projectId");

-- CreateIndex
-- El unique de arriba arranca por "userId", asi que NO puede servir el conteo
-- por recurso ni el join del `orderBy: { likes: { _count: 'desc' } }` de la
-- galeria. Este si, y ademas le da un indice al FK para el borrado en cascada.
CREATE INDEX IF NOT EXISTS "ProjectLike_projectId_idx" ON "ProjectLike"("projectId");

-- AddForeignKey
-- Los dos en CASCADE: si se borra el recurso, sus likes no significan nada; si
-- se borra la cuenta del docente, su like tampoco, porque un like ES la
-- persona (por eso el unique lleva "userId" y por eso no puede ser NULL).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectLike_userId_fkey') THEN
        ALTER TABLE "ProjectLike"
          ADD CONSTRAINT "ProjectLike_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectLike_projectId_fkey') THEN
        ALTER TABLE "ProjectLike"
          ADD CONSTRAINT "ProjectLike_projectId_fkey"
          FOREIGN KEY ("projectId") REFERENCES "Project"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "screenshotAt" TIMESTAMP(3);

-- Backfill: toda portada que ya existe se declara SACADA AL DIA.
--
-- Sin esto, el dia del deploy TODOS los recursos con portada quedarian con
-- screenshotAt = NULL y, si NULL se leyera como "vieja", la app entera
-- amanece gritando "Actualizar portada". Por eso pasan dos cosas: este UPDATE,
-- y que el predicado de §6 trate NULL como FRESCA. Las dos, no una.
--
-- `= "updatedAt"` y no CURRENT_TIMESTAMP: deja screenshotAt EXACTAMENTE igual
-- a updatedAt, que es el unico valor que garantiza que el predicado de §6 de
-- "fresca" con cualquier tolerancia, incluso cero.
UPDATE "Project"
   SET "screenshotAt" = "updatedAt"
 WHERE "screenshotUrl" IS NOT NULL
   AND "screenshotAt" IS NULL;

-- LO QUE ESTA MIGRACION NO HACE, A PROPOSITO:
-- No corre `UPDATE "Project" SET "isInGallery" = false WHERE "screenshotUrl"
-- IS NULL`. Despublicar el recurso de un docente sin avisarle es sacarle el
-- trabajo de la estanteria en silencio, y el rollback NO lo puede deshacer:
-- el esquema previo no guarda en ningun lado cuales filas se dieron vuelta,
-- asi que la reversion no tiene como distinguirlas de las que ya estaban
-- privadas. La invariante nueva rige de aca en adelante (ver §3); las filas
-- viejas sin portada siguen mostrando el marcador "Sin captura" que la galeria
-- ya dibuja (gallery.astro:57-61) y se arreglan solas la primera vez que su
-- dueño saque una portada.
```

### 2.2 `migration_down.sql`

Hand-run, never executed by Prisma, following
`20260923000000_atribucion_admin/migration_down.sql`. No `BEGIN/COMMIT` wrapper: unlike
the provider rollback, nothing here can abort mid-way, so psql's autocommit is fine.

```sql
-- Rollback manual de 20260925000000_publicacion_likes_y_motores. Se corre por
-- fuera de `prisma migrate`:
--   docker exec -i kodu_db_dev psql -U kodu -d koduedu -f - < migration_down.sql
-- y despues:
--   npx prisma migrate resolve --rolled-back 20260925000000_publicacion_likes_y_motores
--
-- PERDIDA ACEPTADA, y es la unica: LOS LIKES. Se van con la tabla y no hay
-- forma de reconstruirlos. Ningun recurso, portada, consumo ni clave se toca:
-- las portadas sacadas despues del cambio sobreviven enteras, porque son
-- `screenshotUrl` comun y corriente y esa columna no se creo acá.

ALTER TABLE "ProjectLike" DROP CONSTRAINT IF EXISTS "ProjectLike_projectId_fkey";
ALTER TABLE "ProjectLike" DROP CONSTRAINT IF EXISTS "ProjectLike_userId_fkey";
DROP INDEX IF EXISTS "ProjectLike_projectId_idx";
DROP INDEX IF EXISTS "ProjectLike_userId_projectId_key";
DROP TABLE IF EXISTS "ProjectLike";

ALTER TABLE "Project" DROP COLUMN IF EXISTS "screenshotAt";
```

### 2.3 Idempotency — what is actually guaranteed

| Layer | Guarantee |
|---|---|
| `_prisma_migrations` ledger | `migrate deploy` runs an applied migration **zero** more times. This, not the SQL, is the mechanism. |
| Postgres advisory lock | Two replicas booting at once serialise; the loser finds it applied. |
| Transactional DDL | All-or-nothing. A failure leaves the database byte-identical. |
| Statement guards | `IF NOT EXISTS`, the `pg_constraint` guards and `AND "screenshotAt" IS NULL` make the **whole file** replayable, with no drop step to poison it. Re-running it after a manual `migrate resolve --rolled-back` is safe. |

Failure on boot: `migrate deploy` exits non-zero, `set -e` (`docker/prod-entrypoint.sh:8`)
kills the container, Coolify reports a failed deploy and the previous container keeps
serving. Loud, not silent.

---

## 3. The publish invariant

### 3.1 Server guard — `src/pages/api/projects/[id].ts`

`findProjectForActor` (`:22`) already returns the full row with no `select`, so
`project.screenshotUrl` is in hand at zero extra cost. Between the `parsed.data` empty
check (`:30-32`) and `marcarSiActuaAdmin` (`:37`):

```ts
// LA INVARIANTE (proposal §1): no puede existir un recurso publicado sin
// portada. El cliente ya saca la captura antes de publicar, pero esa secuencia
// se puede saltear, se puede cortar a la mitad y puede correr contra el iframe;
// este rechazo es lo unico que hace VERDADERA la frase.
if (parsed.data.isInGallery === true && !project.screenshotUrl) {
  return fail('Para publicar hace falta una portada. Sacá una captura del recurso y volvé a intentar.', 422);
}
```

`isInGallery: false` is never blocked: un-publishing must always work, including from the
resource list, including for the coverless rows §2.1 deliberately left published.

`DELETE /api/projects/:id/screenshot` (`screenshot.ts:40-51`) gets the mirror rule — it
is the other door to the same broken state:

```ts
// Borrar la portada de un recurso publicado lo dejaria publicado y sin foto,
// que es exactamente lo que la invariante prohibe. Se despublica en el mismo
// update, y se le avisa: no es un efecto oculto.
data: { screenshotUrl: null, screenshotAt: null, isInGallery: false }
```
Response becomes `ok({ screenshotUrl: null, despublicado: project.isInGallery })`, and the
workspace flashes `'Portada borrada. El recurso salió de la galería.'` when
`despublicado` is true.

`POST /api/projects/:id/screenshot` writes both columns (`screenshot.ts:31-34`):
`data: { screenshotUrl: stored.url, screenshotAt: new Date() }`, and returns
`ok({ screenshotUrl: stored.url })` unchanged.

### 3.2 Client sequence

```
Docente toca "Publicar"
   │
   ├─ flushSave()                      ← Workspace.tsx:181-190. Vacía el debounce de
   │                                     700 ms (:171) ANTES de la foto: si no, la
   │                                     portada retrata código que todavía no se guardó
   │                                     y updatedAt salta DESPUÉS de screenshotAt.
   ├─ ¿el iframe renderizó?            ← nuevo estado `listo` en PreviewPanel (onLoad
   │     no → botón deshabilitado        del iframe, :178-186). Sin esto la captura sale
   │                                     de un documento en blanco.
   ├─ pedirCaptura({ publicar: true }) ← postMessage CAPTURE_REQUEST (:63-74)
   │     ├─ error del iframe  → captureError, el switch NO se mueve
   │     └─ timeout 15 s      → captureError (HOY se apaga en silencio: :73)
   ├─ POST /screenshot                 ← falla → setError, el switch NO se mueve
   └─ PATCH { isInGallery: true }      ← falla (incl. el 422 de §3.1) → el switch NO se mueve
         └─ 200 → switch ON + "Publicado en la galería"
```

**The switch never moves optimistically.** An optimistic flip that reverts reads as "it
published and then broke", and the entire point of the owner's request is that a failed
publish be unmistakable. While the sequence runs, the control is `disabled`,
`aria-busy="true"`, and its text reads `Publicando…`.

Un-publishing (`On → Off`) stays exactly as it is today (`Workspace.tsx:608-613`): one
PATCH, one gesture, no capture.

### 3.3 The control itself — a verified correction to the proposal

**A publish toggle already exists in the workspace**, at `PreviewPanel.tsx:130-153`, in
the same button group as the cover button. The proposal's "publishing moves to the
workspace" is therefore **not a new control**: it is the removal of the *duplicate* in
`FichaDialog` plus new behaviour on the one that is already there. `sdd-apply` must not
add a second control.

It stays a `<label>` + `sr-only` checkbox — the shape already gives it focus,
Enter/Space and a screen-reader announcement for free, and it is the only shape where
un-publishing is one gesture. `PreviewPanel` props change to:

```ts
isInGallery: boolean;
/** Sólo despublica. Publicar entra por la secuencia de §3.2. */
onDespublicar: () => void;
/** `publicar: true` = la captura fue pedida para publicar. */
onScreenshot: (dataUrl: string, opciones?: { publicar?: boolean }) => Promise<void>;
/** El recurso cambió después de la última portada (§6). */
portadaVieja: boolean;
```

`Workspace.handleScreenshot` (`:462-478`) becomes the single writer of the sequence:

```ts
async function handleScreenshot(dataUrl: string, opciones?: { publicar?: boolean }) {
  setSaving(true);
  const guardada = await apiRequest<{ screenshotUrl: string }>(
    `/api/projects/${projectId}/screenshot`, 'POST', { dataUrl },
  );
  setSaving(false);
  if (!guardada.ok) { setError(guardada.error); return; }

  setScreenshotUrl(guardada.data.screenshotUrl);
  setPortadaVieja(false);

  if (!opciones?.publicar) { flashNotice('Portada guardada'); return; }
  if (await patchProject({ isInGallery: true })) {
    setIsInGallery(true);
    flashNotice('Publicado en la galería');
  }
  // patchProject ya dejó el error en pantalla; el switch queda como estaba.
}
```

`FichaDialog.tsx` loses the toggle at `:82-109`, the `isInGallery` state at `:27`, the
field in the `onGuardar` payload type at `:18` and its value at `:45`, and the closing
paragraph at `:111-115` is rewritten to point at the workspace instead of a "pestaña
Ficha" that no longer exists. `Workspace.tsx:520-532` drops `setIsInGallery(datos.isInGallery)`
and `isInGallery` from the PATCH body. That is the whole of item 2.

`src/pages/app/index.astro:88-97` (published state dot) and its un-publish action are
**unchanged** — verified by reading: the dot reads `project.isInGallery` and nothing
else, and un-publishing from there is never blocked by §3.1.

---

## 4. Likes

### 4.1 Route — `src/pages/api/projects/[id]/like.ts` (new)

**Middleware, verified, no change needed.** `PROTECTED_API_PREFIXES` includes
`/api/projects` (`middleware.ts:17`) and `matches()` (`:22-24`) is a prefix match on a
`/` boundary, so `/api/projects/<id>/like` returns `fail('Sesión no válida o expirada', 401)`
at `:106-108` before the route runs — `locals.user!` is safe. CSRF is the global origin
check at `:81` (`isForbiddenCrossOrigin`, `src/lib/csrf.ts:43-60`), which runs before any
routing, so the new route inherits it. There is no CSRF *token*; `apiRequest` sends
same-origin `fetch`, exactly like `DuplicateButton` already does.

```ts
/**
 * POST/DELETE /api/projects/:id/like — el corazón de la galería.
 *
 * NO usa `findProjectForActor`: un like es sobre el recurso de OTRO docente, así
 * que el chequeo de propiedad es justo el chequeo equivocado. Lo que autoriza acá
 * es `isInGallery: true` — si el recurso no está publicado, no se puede likear,
 * y se contesta 404 (no 403) para no revelar que existe.
 */
async function recursoPublicado(id: string) {
  return prisma.project.findFirst({ where: { id, isInGallery: true }, select: { id: true } });
}

export const POST: APIRoute = async ({ params, locals }) => {
  const user = locals.user!;
  const project = await recursoPublicado(params.id!);
  if (!project) return fail('Ese recurso no está en la galería.', 404);

  // upsert y no create: el doble click del navegador manda dos POST y el
  // segundo NO tiene que ser un error — el docente pidió "que esté likeado",
  // y ya lo está.
  await prisma.projectLike.upsert({
    where: { userId_projectId: { userId: user.id, projectId: project.id } },
    create: { userId: user.id, projectId: project.id },
    update: {},
  });

  return ok({ liked: true, likes: await prisma.projectLike.count({ where: { projectId: project.id } }) });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user!;
  const project = await recursoPublicado(params.id!);
  if (!project) return fail('Ese recurso no está en la galería.', 404);

  // deleteMany y no delete: borrar algo que no está no es un error, es el
  // estado pedido. `delete` tiraría P2025.
  await prisma.projectLike.deleteMany({ where: { userId: user.id, projectId: project.id } });

  return ok({ liked: false, likes: await prisma.projectLike.count({ where: { projectId: project.id } }) });
};
```

**Two verbs, not one toggle.** A toggle makes the result depend on a read-modify-write, so
two clicks racing each other land on an unpredictable final state. With POST/DELETE the
client's intent is the truth and every retry is safe. Both are idempotent, both return the
authoritative count, so the card never has to guess.

### 4.2 The gallery query — `src/pages/gallery.astro:9-22`

```ts
const user = Astro.locals.user;

const projects = await prisma.project.findMany({
  where: { isInGallery: true },
  // Más likes primero; a igual cantidad, el más recién tocado. El desempate
  // importa: sin él, los 40 recursos con cero likes salen en orden arbitrario
  // y la galería cambia de orden sola entre dos recargas.
  orderBy: [{ likes: { _count: 'desc' } }, { updatedAt: 'desc' }],
  take: 60,
  select: {
    id: true, title: true, description: true, slug: true,
    screenshotUrl: true, updatedAt: true,
    user: { select: { name: true } },
    _count: { select: { likes: true } },
  },
});

// "¿Este docente likeó estos 60?" en UNA consulta, no en 60. Es
// `WHERE "userId" = $1 AND "projectId" IN (…)`, que cae entero sobre el índice
// único (userId, projectId). Para un visitante anónimo la consulta ni se hace.
const likeados = user
  ? new Set(
      (
        await prisma.projectLike.findMany({
          where: { userId: user.id, projectId: { in: projects.map((p) => p.id) } },
          select: { projectId: true },
        })
      ).map((fila) => fila.projectId),
    )
  : new Set<string>();
```

**Why a second query instead of a nested `likes: { where: { userId } }`**: the nested form
needs the `where` to be conditional on `user`, which makes the `select` a union and the
result type unusable without a cast — and the sentinel workaround (`userId: user?.id ?? ''`)
buys an always-executed query for anonymous visitors in exchange for a lie in the code.
Two named queries are honest, statically typed, and skip work for anonymous readers.

**The order is a snapshot.** The page is SSR and liking does not re-sort live; the card
updates its own count and heart from the response, and the new order appears on the next
load. Re-sorting the grid under the cursor the moment someone likes something would move
the card they are pointing at.

---

## 5. The gallery card

The heart goes at the **start of the existing action row** (`gallery.astro:72-82`), which
is the bottom-left of the card. Not overlaid on the screenshot: a screenshot is arbitrary
teacher-authored artwork, and text laid over it is unreadable roughly half the time.

```astro
<div class="mt-4 flex flex-wrap items-center gap-2 border-t border-linea pt-3">
  <BotonLike
    client:visible
    projectId={project.id}
    title={project.title}
    inicial={project._count.likes}
    likeadoInicial={likeados.has(project.id)}
    isLoggedIn={Boolean(user)}
  />
  <a href={`/p/${project.slug}`} … class="kodu-btn-primary ml-auto px-2.5 py-1.5 text-xs">
    Probar a pantalla completa
  </a>
  <DuplicateButton client:visible projectId={project.id} isLoggedIn={Boolean(user)} />
</div>
```

`flex-wrap` is added to the row: at `lg:grid-cols-3` the card is ~22 rem and three
controls plus gaps land within ~0.5 rem of that, so without wrapping the row overflows on
narrow viewports. `ml-auto` on the CTA keeps the heart alone on the left.

`src/components/BotonLike.tsx` (new), sibling of `DuplicateButton.tsx`:

| State | Icon | Classes | Accessibility |
|---|---|---|---|
| Liked | filled heart | `text-red-600 hover:bg-sutil` | `aria-pressed="true"`, `aria-label={"Quitar mi me gusta de " + title}` |
| Not liked, logged in | outline heart | `text-ink-500 hover:bg-sutil hover:text-ink-700` | `aria-pressed="false"`, `aria-label={"Me gusta " + title}` |
| Anonymous | outline heart | `text-ink-500 hover:bg-sutil hover:text-ink-700` | **no `aria-pressed`**, `aria-label="Iniciá sesión para dar me gusta"`, click → `/login?next=%2Fgallery` |

```tsx
<button
  type="button"
  onClick={alternar}
  disabled={pendiente}
  aria-pressed={isLoggedIn ? likeado : undefined}
  aria-label={etiqueta}
  className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-xs tabular-nums transition-colors ${
    likeado ? 'text-red-600 hover:bg-sutil' : 'text-ink-500 hover:bg-sutil hover:text-ink-700'
  }`}
>
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
       fill={likeado ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.5">
    <path d="M8 13.6 2.7 8.2a3.15 3.15 0 0 1 4.45-4.45L8 4.6l.85-.85A3.15 3.15 0 0 1 13.3 8.2Z"
          stroke-linejoin="round" />
  </svg>
  {cuenta}
</button>
```

Decisions inside those classes:

- **No `aria-pressed` for anonymous visitors.** An unpressed toggle promises that pressing
  it toggles; this one navigates to login. `DuplicateButton.tsx:16-19` already sets that
  precedent. The label says what actually happens.
- **`text-red-600`, never `bg-red-50`.** `red-600` is a fixed Tailwind value with adequate
  contrast on both `#ffffff` and `#17171e`, and the repo already uses it in both themes
  (`PreviewPanel.tsx:124`, `ProjectCardActions.tsx:73`). `bg-red-50` does **not** flip with
  `data-theme` — the repo only uses it inside error strips, and on the dark surface it
  would be a white slab. Every other colour here (`text-ink-500`, `text-ink-700`,
  `bg-sutil`) is a semantic token that flips on its own (`global.css:45-58`).
- **Fill, not only colour.** Red-versus-grey alone is a colour-only distinction (WCAG
  1.4.1); the outline→solid change carries the state without it, and `aria-pressed`
  carries it for a screen reader.
- **The count renders even at 0.** A heart with no number next to it reads as decoration.
- Optimistic update with rollback on failure, and on failure a
  `<span role="alert" className="text-xs text-red-600">` next to the button — the row
  wraps, so the message drops to a second line instead of breaking the card. Same shape as
  `DuplicateButton.tsx:43-47`.

---

## 6. The stale-cover affordance

### 6.1 The predicate — `src/lib/projects.ts`

```ts
/**
 * Margen para no marcar vieja una portada por el ida y vuelta de sacarla.
 *
 * `updatedAt` se mueve con CUALQUIER escritura al recurso, incluida la que
 * publica justo después de la foto (§3.2). Ese PATCH llega uno o dos segundos
 * más tarde que el POST de la captura, así que sin margen una portada recién
 * sacada nace vieja y el marcador no significa nada. 5 s cubre ese viaje con
 * aire; el debounce de 700 ms ya lo elimina `flushSave()` antes de la foto.
 */
export const TOLERANCIA_PORTADA_MS = 5_000;

export function portadaDesactualizada(screenshotAt: Date | null, updatedAt: Date): boolean {
  // NULL = portada anterior a esta columna. FRESCA, nunca vieja: si no, el día
  // del deploy toda la app amanece pidiendo actualizar la portada.
  if (!screenshotAt) return false;
  return updatedAt.getTime() - screenshotAt.getTime() > TOLERANCIA_PORTADA_MS;
}
```

The SSR value seeds the workspace at `src/pages/app/project/[id].astro` and travels in
`WorkspaceProject`. **Once the workspace is open, the flag is live and precise** — it is
`useState` in `Workspace`, and only *content* moves it:

| Trigger | Site | Effect |
|---|---|---|
| The AI returns code | `Workspace.tsx:347-353` (`event.type === 'code'`) | `setPortadaVieja(true)` |
| The teacher edits the code by hand | `Workspace.tsx:585-591` (`onHtmlChange`) | `setPortadaVieja(true)` |
| A cover is stored | `Workspace.tsx:476` (inside `handleScreenshot`) | `setPortadaVieja(false)` |
| Title / description / engine edits | `scheduleSave` | **nothing** |

So the owner's literal trigger ("si la ia hace cambios") is exact while the page is open.
The SSR seed is the coarse proxy, and it over-fires: a title-only edit followed by a
reload can raise "Actualizar portada" for no visual reason. Accepted — the affordance is
deliberately low-salience, so a false positive costs one ignorable glance, and the precise
fix (a `htmlUpdatedAt` column) is named in Open Questions rather than smuggled in.

### 6.2 The marker — `PreviewPanel.tsx:110-118`

```tsx
<button
  type="button"
  onClick={() => pedirCaptura()}
  disabled={capturing}
  className="kodu-btn-ghost relative px-2.5 py-1.5 text-xs"
  title={props.portadaVieja
    ? 'El recurso cambió después de la última portada.'
    : 'Guarda una foto de la vista previa como portada de la galería'}
>
  {capturing ? 'Capturando…'
    : props.portadaVieja ? 'Actualizar portada'
    : props.screenshotUrl ? 'Cambiar portada' : 'Sacar portada'}
  {props.portadaVieja && (
    <>
      <span aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-brand-600" />
      <span className="sr-only">La portada quedó desactualizada.</span>
    </>
  )}
</button>
```

**Why this reads without shouting.** Two changes, both tiny, neither urgent:

- A **6 px dot** in `bg-brand-600` on the button's corner — the "unread" idiom, borrowed
  from a context where it means *worth a look*, not *something is wrong*. It is the
  smallest mark the eye reliably catches in peripheral vision against a flat toolbar, and
  it is brand blue, not red: nothing failed.
- The **verb changes**: `Sacar`/`Cambiar` → `Actualizar`. The dot gets the eye there; the
  word explains why once it lands.

What it deliberately is **not**: no banner, no modal, no colour flood on the button, no
motion, no change to the button's weight (it stays `kodu-btn-ghost` beside three other
ghost buttons). Ignoring it costs nothing, so it must not behave like an error. The
`sr-only` line and the `title` carry the same meaning for anyone who cannot see a 6 px
dot, so the state is never colour-only.

---

## 7. Admin engine toggles — `ModelosPanel.tsx`

The row keeps **two independent controls that look nothing alike**, because two identical
switches side by side is exactly the confusion this item exists to remove.

| Control | Writes | Shape | Copy |
|---|---|---|---|
| Prominent | `selectableByTeacher` | the existing `Interruptor` at `:208-214`, unchanged shape | `label="Lo ven los docentes"`, `srOnly` |
| Quiet | `enabled` | small text chip, no riel | `En servicio` / `Fuera de servicio` |

```tsx
<Interruptor
  checked={motor.selectableByTeacher}
  onChange={(valor) => void alternarVisible(motor, valor)}
  label="Lo ven los docentes"
  srOnly
  id={`visible-${motor.id}`}
/>

<button
  type="button"
  aria-pressed={motor.enabled}
  onClick={() => pedirFueraDeServicio(motor)}
  title="Un motor fuera de servicio no se usa nunca: ni a mano ni como respaldo de otro."
  className={`shrink-0 rounded-full px-2 py-0.5 text-xs transition-colors ${
    motor.enabled
      ? 'text-ink-500 hover:bg-sutil hover:text-ink-700'
      : 'bg-sutil font-medium text-ink-700'
  }`}
>
  {motor.enabled ? 'En servicio' : 'Fuera de servicio'}
</button>
```

**The weight is inverted on purpose**: the *abnormal* state gets the filled chip, so a row
that is out of service is visible at a glance while a normal row stays silent. That is what
"quieter" has to mean here — quiet when nothing is wrong, not quiet always.

`selectableByTeacher: false` + `enabled: true` stays expressible because neither control
writes the other: DeepSeek's row shows the riel off and a quiet `En servicio`, which is
exactly what it is.

**The API needs no change** — verified: `/api/admin/models/[id].ts:33` already accepts
`selectableByTeacher` in the zod schema and `:83` already applies it. `toggleEnabled`
(`ModelosPanel.tsx:93-106`) is duplicated into `alternarVisible` with the same optimistic
pattern and the same rollback.

### 7.1 The fallback warning — where the lookup lives

**The DB lookup already happened.** `src/pages/admin/motores.astro:9` loads the whole
catalogue, `serializarMotor` ships `fallbackModelId` (`src/lib/admin/modelos.ts:32,55`),
and `ModelosPanel` holds every row in `motores` state (`:22`). So the check is a filter
over data that is already on the page — no new endpoint, no new query, no round trip:

```ts
/** Qué motores se quedan sin respaldo si éste sale de servicio. */
function respaldadosPor(id: string): MotorAdmin[] {
  return motores.filter((m) => m.fallbackModelId === id);
}
```

`pedirFueraDeServicio` fires the PATCH directly when turning `enabled` **on**, or when
turning it off and `respaldadosPor(motor.id).length === 0`. Otherwise it sets
`confirmando = motor.id` and the row renders an inline strip — no modal, following the
precedent of `DemoPanel.tsx:208-222`, because a modal is over-ceremony for a reversible
toggle:

```tsx
<p className="w-full rounded-lg bg-sutil px-3 py-2 text-xs text-ink-700">
  Si sacás {motor.displayName} de servicio, {lista} se queda sin respaldo automático.
  <button … className="ml-2 font-semibold text-ink-900 underline">Sacarlo igual</button>
  <button … className="ml-2 underline">Cancelar</button>
</p>
```

Turning `selectableByTeacher` off needs **no** warning, verified: `cadenaDeMotores` only
consults `utilizable(fila)` (`catalogo.ts:191-192`) and `selectableByTeacher` is read
solely by `motoresParaDocente` (`:216`). Hiding an engine from teachers cannot break a
chain. That asymmetry is the whole reason the two controls are shaped differently.

---

## 8. The teacher engine selector

`ChatPanel.tsx:212-236` (the `<fieldset>` with the segmented group) is replaced by
`<SelectorDeMotor …/>`, a new file `src/components/workspace/SelectorDeMotor.tsx`.

**The "hover description" is implemented as a description that is always visible while
the list is open.** Hover-only content is unreachable by keyboard and by touch (WCAG
2.1.1 and 1.4.13), and a native `<select>` with `<option title="…">` is hover-only,
silently dead on a tablet — which is a projector-and-tablet product. Hovering an option
still *does* something (it highlights the row); it is simply not the only way to get the
information.

```
┌───────────────────────────────────────────┐
│ MiniMax M3                             ⌄  │  ← <button aria-haspopup="listbox">
└───────────────────────────────────────────┘
  Gratuito y multimodal. …                     ← descripción del elegido, cerrado
┌───────────────────────────────────────────┐
│ ▸ MiniMax M3                              │  ← <li role="option" aria-selected="true">
│   Gratuito y multimodal. …                │  ← description, SIEMPRE visible
│   DeepSeek Flash                          │
│   Rápido y pago. Entra como respaldo.     │
└───────────────────────────────────────────┘
```

| Concern | Behaviour |
|---|---|
| Trigger | `<button type="button" id="selector-motor" aria-haspopup="listbox" aria-expanded={abierto}>`, `kodu-input` classes plus `flex items-center justify-between`, showing `displayName` and a chevron |
| List | `<ul role="listbox" tabIndex={-1} aria-labelledby="selector-motor" aria-activedescendant={…}>`, `absolute z-20 mt-1 w-full kodu-card p-1 shadow-lg` |
| Option | `<li role="option" id={"opt-" + motor.id} aria-selected={…}>` with `displayName` in `text-sm font-medium text-ink-900` over `description` in `text-[0.7rem] leading-snug text-ink-500`; `rounded-md px-2 py-1.5`, `bg-sutil` on hover **and** on `activeIndex` |
| Touch | The option is a full-width tap target ≥ 40 px tall with the description inside it; nothing is revealed by hover alone |
| Keyboard | Open with `Enter`/`Space`/`ArrowDown`; focus moves to the `<ul>`; `ArrowUp`/`ArrowDown`/`Home`/`End` move `activeIndex`; `Enter`/`Space` select and close; `Escape` closes and returns focus to the trigger; `Tab` closes |
| Closed | The selected engine's description stays under the trigger, exactly as `ChatPanel.tsx:233-235` does today — nothing is lost when the list is shut |
| Dismiss | One `pointerdown` listener on `document`, removed on unmount |
| Selection | `props.onModelChange(id)` — the existing contract at `ChatPanel.tsx:221`; `Workspace.tsx:562-565` is untouched |

The comment at `ChatPanel.tsx:209-211` is rewritten: it currently explains why the cost
warning is in plain view, and item 9 removes that warning.

---

## 9. Price visibility

`IndicadorConsumo.tsx` keeps its trigger, its `aria-expanded` popover and every one of
its hover/tap/focus/Escape handlers (`:74-82`) — no accessibility regression, no new
component. What changes is the payload.

**Exactly what the teacher sees after this change:**

| | Before | After |
|---|---|---|
| Pill | `Consumo bajo` / `medio` / `alto` | identical |
| Popover line 1 | `1,2 M tokens` | identical |
| Popover line 2 | `≈ US$ 0,0431 acumulado en este recurso` | `Es cuánto texto procesó la IA en este recurso.` |
| Popover, no prices loaded | `Sin precios registrados para estos turnos.` | *(gone — it only ever explained a missing price)* |
| Popover, free engine | `US$ 0,00` + `…motor sin costo.` | *(gone)* |
| When `tokens === 0` | absent entirely | identical (`project/[id].astro:146`) |

Concretely: `costUsd` leaves `IndicadorConsumoProps` (`:26-35`), the `detalle` IIFE
(`:50-68`) collapses to one static line, and `import { formatearCostoUsd }` (`:2`) goes.
`src/pages/app/project/[id].astro:150` stops passing `costUsd`. **No `$`, no `US$`, no
digit denominated in money survives on any teacher-facing surface.**

**Admin surfaces are untouched, verified:** `formatearCostoUsd`'s only teacher-facing
caller is `IndicadorConsumo.tsx:2,56`; the admin figures go through
`formatearCostoAdminUsd` (`src/lib/format/costo.ts:52-57`), which keeps calling
`formatearCostoUsd` internally, so that export stays. `costoPorProyecto`,
`costoTotalDeUsuario`, `consumoPorUsuario` and `consumoDiarioDeUsuario`
(`src/lib/ai/usage.ts`) are unchanged — `costoPorProyecto` keeps returning `costUsd`, the
page simply stops reading it. `/admin` is not in this change's file list at all.

---

## 10. Early-turn questioning

### 10.1 The signal

```ts
export interface PromptContext {
  // … sin cambios …
  /** Turnos del DOCENTE ya guardados en este hilo, sin contar el actual. */
  turnosPrevios: number;
  /** Este turno viene con la herramienta forzada (`pideCambio`). Ver §10.3. */
  herramientaForzada: boolean;
}
```

Computed at the `stream.ts:415` call site from `history`, which is loaded at `:341-346`
and — verified — does **not** include the current message, because that row is persisted
later at `:434`:

```ts
turnosPrevios: history.filter((entry) => entry.role === 'user').length,
```

Only `role: 'user'` rows are counted, not `history.length`. A turn that fails leaves an
apology row with `role: 'assistant'` (`stream.ts:580`), and counting those would age the
thread for something the teacher never said. `HISTORY_LIMIT = 40` (`:67`) saturates the
count, which is irrelevant against a window of 2.

### 10.2 The two numbers, pinned

**Early = `turnosPrevios <= 1`.** The guidance is in the prompt for the first and second
message of a thread, and gone from the third onward.

- Turn 1 carries the least information and the most invention risk — the owner's
  complaint verbatim ("mas que nada en las primeras iteraciones").
- Turn 2 is included because turn 1 is very often one of the pre-written prompts from
  `src/components/workspace/starters.ts`, which is already detailed; the teacher's own
  first free-form sentence is frequently turn 2.
- From turn 3 the resource exists and travels in the prompt (`renderCurrentHtml`,
  `prompt.ts:143-170`), so the model is editing something concrete instead of guessing.
  Questions there are friction, not care.
- The bound is 2 and not 3 because a teacher who has sent three messages and still has no
  resource has been interrogated — the exact failure the proposal's risk table names.

**At most 3 questions, all in one message.**

- Fewer (one at a time) turns a single clarification into a three-turn interrogation to
  collect the same three facts: the same failure, slower.
- More reads as a form, and the chat column is `minmax(18rem,24rem)` wide
  (`Workspace.tsx:515`). Four or more questions do not fit without scrolling, so the
  teacher answers the visible ones and the rest are silently dropped.
- Three is the number of things that are almost always missing and almost always decide
  what gets built: the grade/age, which part of the topic is in scope, and the activity
  format.

### 10.3 The collision rule

`forzarHerramienta` is `pideCambio(message)`, currently computed at `stream.ts:511` —
**inside** the `ReadableStream.start` callback, i.e. *after* `buildSystemPrompt` at
`:415`. It is hoisted to just above `:415` and reused at `:518`. `pideCambio`
(`:158-169`) is pure, so hoisting is behaviour-preserving.

```ts
// src/lib/ai/prompt.ts
export const TURNOS_TEMPRANOS = 1;

function renderPreguntas(turnosPrevios: number, herramientaForzada: boolean): string {
  // LA COLISION, resuelta acá y no en tiempo de ejecución: forzar la
  // herramienta le dice al modelo "escribí código ahora" y la guía de preguntas
  // le dice "podés contestar sin código". Dos instrucciones opuestas en un
  // mismo pedido no se arbitran: si hay forzado, la guía NO EXISTE.
  if (herramientaForzada) return '';
  if (turnosPrevios > TURNOS_TEMPRANOS) return '';
  return PREGUNTAS_TEMPRANAS;
}
```

```ts
const PREGUNTAS_TEMPRANAS = `

## Antes de construir: preguntá lo que no sabés
Recién arranca esta conversación y todavía no sabés lo suficiente sobre el curso. NO ADIVINES.

- Si te falta algo que cambia de verdad lo que hay que construir (para qué grado o edad es, qué parte del tema entra, qué formato de actividad quiere), pedilo en el chat y esperá la respuesta. Hasta TRES preguntas, cortas y concretas, TODAS en el mismo mensaje.
- Preguntá sólo lo que no podés deducir del pedido ni del recurso que ya existe. Si el docente ya lo dijo, no se lo vuelvas a preguntar.
- Si con lo que te dijo alcanza para empezar, empezá. Las preguntas no son una excusa para no construir.
- Nunca preguntes de a una para ir sacando datos de a poco: eso es un interrogatorio, no una consulta.`;
```

**Position in the concatenation.** `buildSystemPrompt` (`:172-180`) inserts it **second,
right after `BASE_PROMPT`**, before the institutional rules — it modifies "Cómo
respondés", which is `BASE_PROMPT`'s own first section, and the header comment at
`prompt.ts:2-11` is updated to a six-step order. It must **not** be appended at the end:
that would place "ask before guessing" after up to 200 000 characters of HTML, which is
the worst possible position for an instruction about how to open a conversation.

---

## 11. Architecture decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Cover-less published rows that already exist | Leave them published | `UPDATE … SET "isInGallery" = false` in the migration | The rollback cannot undo it: the pre-change schema records nowhere which rows were flipped, so the down migration could not tell them from rows that were already private. Silently shelving a teacher's work with no way back is worse than an ugly card, and `gallery.astro:57-61` already draws "Sin captura". |
| Publish switch during the sequence | Never moves until the server confirms | Optimistic flip with rollback | A flip that reverts reads as "it published and then broke". The owner's request is precisely that a failed publish be unmistakable. |
| Like API | `POST` = like, `DELETE` = unlike, both idempotent | One toggling `POST` | A toggle's outcome depends on a read-modify-write, so two racing clicks land unpredictably. With explicit verbs the client's intent is the truth and every retry is safe. |
| Like count | `_count` + `orderBy: { likes: { _count: 'desc' } }` | Denormalised `Project.likeCount` | The gallery takes 60 rows. A parallel counter buys nothing at this size and drifts, which is worse than a join — a wrong number is worse than a slightly slower right one. |
| "Did I like these 60" | A second query with `projectId IN (…)` | Nested `likes: { where: { userId } }` in the `select` | The nested form needs a conditional `where`, which makes the result a union type and forces either a cast or a `userId: ''` sentinel. Two named queries are typed, honest, and skipped entirely for anonymous readers. |
| `ProjectLike` FKs | Both `Cascade` | `SetNull` on `userId`, mirroring `lastAdminActorId` | There `SetNull` keeps the fact and drops the identity. Here the identity **is** the fact, and `userId` cannot be null without destroying `@@unique([userId, projectId])`. |
| Staleness source of truth | Live client flag in `Workspace`, SSR predicate as the seed | `screenshotAt < updatedAt` evaluated only server-side | `updatedAt` moves on *any* write, including the publish PATCH that lands one second after the capture. Server-side only, a fresh cover is born stale. |
| Staleness tolerance | 5 s, with `flushSave()` before every capture | Zero tolerance; or `htmlUpdatedAt` column | Zero tolerance makes the marker permanent and meaningless. A new column is the precise fix and is out of the proposal's scope — named in Open Questions instead. |
| "Description on hover" | Description always visible inside the open listbox | Native `<select>` with `<option title>`; a `:hover` tooltip | `title` is hover-only: dead on touch, inconsistently announced by screen readers, unreachable by keyboard. This is a tablet-and-projector product. |
| `enabled` control shape | Text chip, filled only when **off** | A second `Interruptor` next to the first | Two identical switches on one row look interchangeable, which is the exact confusion item 7 exists to remove. And "quieter" should mean quiet when nothing is wrong, not quiet always. |
| Fallback warning | Client-side filter over `motores` state | New `GET /api/admin/models/:id/dependientes` | `motores.astro:9` already loads the whole catalogue and `MotorAdmin.fallbackModelId` is already serialized. A round trip to re-derive data already on the page is invented work. |
| Question guidance vs forced tool | Guidance omitted entirely when `forzarHerramienta` | Softening one instruction; letting the model arbitrate | Two instructions telling the model opposite things in one request *is* the collision. Removing one is a rule; weighting them is a coin flip per turn. |
| Teacher's cost signal | `nivelDeConsumo` + token count, no money | Removing the indicator entirely | `ChatPanel.tsx:209-211` records a deliberate earlier decision to warn teachers about spend. This reverses it **in its money dimension only** — "Consumo alto" with no number at all would be unactionable. |

---

## 12. Data flow

```
PUBLICAR (workspace)                       GALERIA (SSR, /gallery)
  flushSave()                                findMany where isInGallery
     │                                         orderBy [likes._count desc, updatedAt desc]
  ¿iframe listo? ──no──▶ botón disabled        select { …, _count: { likes } }
     │ sí                                            │
  postMessage CAPTURE_REQUEST                  ¿hay sesión?
     │                                            │ sí → findMany ProjectLike
  CAPTURE_RESULT ──error/15s──▶ captureError    │        where userId AND projectId IN (60)
     │ dataUrl                                  │        → Set<projectId>
  POST /screenshot                              │ no  → Set vacío
     │ { screenshotUrl, screenshotAt = now }         │
     │  ──!ok──▶ setError, switch OFF           card: ♥ _count.likes  (rojo si está en el Set)
     │                                                │
  PATCH { isInGallery: true }                    click anónimo → /login?next=/gallery
     │  ──422 sin portada──▶ captureError        click docente → POST|DELETE /like
     └─ 200 ──▶ switch ON, "Publicado"                            → { liked, likes } → estado local


UN TURNO DE CHAT (stream.ts)
  history (sin el mensaje actual, :341-346)
     └─ turnosPrevios = history.filter(role === 'user').length
  forzar = pideCambio(message)        ← hoisted de :511 a arriba de :415
     └───────────┬───────────────────────────────┐
                 ▼                               ▼
      buildSystemPrompt({ turnosPrevios,   requestCompletionStream({
        herramientaForzada: forzar })        forzarHerramienta: forzar })   (:518)
                 │
      forzar → guía OMITIDA
      !forzar && turnosPrevios <= 1 → guía PRESENTE (máx. 3 preguntas)
```

---

## 13. File changes

Every line reference below was verified by reading the file in this phase.

| File | Action | What |
|---|---|---|
| `prisma/schema.prisma:123-156` | Modify | `Project.screenshotAt DateTime?` + `likes ProjectLike[]`; new `ProjectLike` model; `User.likes` back-relation at `:52-60` |
| `prisma/migrations/20260925000000_publicacion_likes_y_motores/migration.sql` | Create | §2.1 |
| `…/migration_down.sql` | Create | §2.2 |
| `src/pages/api/projects/[id].ts:30-37` | Modify | The 422 guard on `isInGallery: true` with a null `screenshotUrl`; `screenshotAt` added to the `select` at `:42-51` |
| `src/pages/api/projects/[id]/screenshot.ts:31-34,45-48` | Modify | POST writes `screenshotAt`; DELETE clears it and un-publishes, returning `despublicado` |
| `src/pages/api/projects/[id]/like.ts` | Create | §4.1 — POST + DELETE, no GET |
| `src/lib/projects.ts` | Modify | `TOLERANCIA_PORTADA_MS` + `portadaDesactualizada()` (§6.1), appended after `findWorkspaceProjectForActor` (`:42-54`) |
| `src/lib/workspace-types.ts:16-26` | Modify | `WorkspaceProject` gains `portadaVieja: boolean` |
| `src/pages/gallery.astro:9-22,47-85` | Modify | §4.2 query + `likeados` set; `<BotonLike>` in the action row at `:72-82`, which gains `flex-wrap` and `ml-auto` on the CTA |
| `src/components/BotonLike.tsx` | Create | §5 |
| `src/components/workspace/Workspace.tsx:49-50,347-353,462-488,516-533,583-616` | Modify | `portadaVieja` state; `handleScreenshot` becomes the publish sequence; `onDespublicar`; `FichaDialog` callback loses `isInGallery`; new props to `PreviewPanel` |
| `src/components/workspace/PreviewPanel.tsx:6-20,41-74,110-153,178-186,203-214` | Modify | Prop shape; `pedirCaptura({publicar})` + the 15 s timeout now raising an error; the stale marker; the publish switch with its busy state; `listo` from the iframe's `onLoad` |
| `src/components/workspace/FichaDialog.tsx:15-20,27,45,82-115` | Modify | Publish toggle removed; `isInGallery` out of the props type and the payload; closing paragraph rewritten |
| `src/components/workspace/ChatPanel.tsx:7-13,209-236` | Modify | `<SelectorDeMotor>` replaces the `<fieldset>`; the cost comment at `:209-211` rewritten |
| `src/components/workspace/SelectorDeMotor.tsx` | Create | §8 |
| `src/components/workspace/IndicadorConsumo.tsx:2,26-35,50-68` | Modify | §9 — `costUsd` and `formatearCostoUsd` out |
| `src/pages/app/project/[id].astro:146-153` | Modify | Stops passing `costUsd`; passes `portadaVieja` into `Workspace`'s `project` object at `:164-170` |
| `src/components/admin/ModelosPanel.tsx:93-106,208-214` | Modify | §7 — `alternarVisible`, the `En servicio` chip, `confirmando` state and the inline warning strip |
| `src/lib/ai/prompt.ts:2-11,25-35,172-180` | Modify | §10 — `PromptContext` gains two fields; `PREGUNTAS_TEMPRANAS`, `TURNOS_TEMPRANOS`, `renderPreguntas`; concatenation comment updated to six steps |
| `src/pages/api/chat/stream.ts:415-423,511` | Modify | `forzar` hoisted above the prompt build; `turnosPrevios` + `herramientaForzada` passed in; `:518` reads the hoisted variable |
| `e2e/m9-publicacion-y-likes.ts` | Create | §14 |
| `e2e/m3-motores.ts` | Modify | §14 — admin toggles and the new selector |

**Not changed, verified by reading:** `src/pages/app/index.astro:88-97` (published state
and un-publish both keep working; §3.1 never blocks `isInGallery: false`);
`src/pages/api/admin/models/[id].ts` (`:33,:83` already handle `selectableByTeacher`);
`src/middleware.ts` (`/api/projects` is already in `PROTECTED_API_PREFIXES` at `:17`);
`src/lib/ai/catalogo.ts` (no predicate changes — this change only alters how `enabled` and
`selectableByTeacher` are *surfaced*); `src/lib/ai/usage.ts`; `src/lib/format/costo.ts`;
every `/admin` page and the whole `TokenUsage` path.

---

## 14. Testing strategy

`npm run check` (`tsc --noEmit`) is the only automated gate, and **it cannot see a single
behaviour in this change.** It will catch the mechanical fallout — the `PromptContext`
fields, the `PreviewPanel` prop rename, `IndicadorConsumoProps` losing `costUsd`, the new
Prisma types after `npm run db:generate` — and nothing else. It cannot tell a heart from a
star, cannot see an order-by, cannot notice that the publish switch flipped without a
cover. The Playwright scripts are the only real proof.

| Layer | What | Approach |
|---|---|---|
| Type | Every stale prop and context field | `npm run db:generate` then `npm run check`. The `onScreenshot` signature change and `costUsd` removal are compile-or-fail. |
| Migration | Backfill | On a dev DB with rows in all three shapes (cover + published, cover + private, no cover + published), run `npm run db:deploy` and assert: every `screenshotUrl IS NOT NULL` row has `screenshotAt = updatedAt`; no row changed `isInGallery`; `ProjectLike` exists with both indexes. |
| Migration | Replay | Run the file a second time by hand against the already-migrated DB: it must complete without error (every statement is guarded). Then `migration_down.sql`, then the file again. |
| E2E | Everything else | Two scripts, both themes, via `e2e/harness.ts` (`conTema`, `iniciarSesion`). |

### `e2e/m9-publicacion-y-likes.ts` (new) — what it must cover

1. **Publish with no cover is impossible.** Open a fresh resource, delete the cover if
   any, then `PATCH /api/projects/<id>` with `{ isInGallery: true }` **directly** (not
   through the UI): assert 422 and the exact message. This is the invariant; it must be
   tested at the API, because the UI is the thing that is allowed to be bypassed.
2. **Publish through the UI captures first.** Click Publicar; assert a
   `POST /api/projects/<id>/screenshot` is observed **before** the `PATCH`, that the
   switch is off while the sequence runs, and that it is on afterwards.
3. **A failed capture leaves it unpublished.** Force the failure (block the capture
   script in the iframe), assert the error strip is visible, the switch is still off, and
   `isInGallery` is still `false` in the DB. A silent success here is the whole bug.
4. **Deleting the cover un-publishes**, and the notice says so.
5. **The creation dialog has no publish toggle.** Assert the strings `Publicar en la
   galería institucional` and `pestaña Ficha` are **absent** from `¿Qué vas a armar?`, so
   a half-landed change cannot pass.
6. **Like round trip.** Teacher A likes → count 1, heart filled, `aria-pressed="true"`.
   Same teacher clicks again → count 0, outline. Teacher B likes → count 1. Double-click
   fast → count 1 and exactly one row in `ProjectLike` (the `@@unique` holds).
7. **Most-liked first.** Three published resources with 2 / 1 / 0 likes; reload
   `/gallery`; assert the DOM order. Then two with equal likes; assert the more recent
   `updatedAt` wins.
8. **Anonymous.** Log out, load `/gallery`: the heart **and** the count are visible, the
   heart is not filled, there is no `aria-pressed`, and clicking lands on
   `/login?next=%2Fgallery`.
9. **Stale cover.** Capture a cover, then change the HTML through the code tab; assert the
   button reads `Actualizar portada` and the dot exists. Capture again; assert it reverts
   to `Cambiar portada` and the dot is gone. Reload right after a capture and assert the
   button is **not** stale — that is the tolerance regression test, and it is the one that
   would have caught a fresh cover born stale.
10. **No USD for teachers.** On a resource with usage, open the consumption popover and
    assert the text contains `tokens` and matches neither `US$` nor `$`.
11. Both themes for 6, 8 and 9 (`conTema(page, 'dark')`): the heart, the dot and the chip
    are the three things this change adds that carry colour.

### `e2e/m3-motores.ts` (modify)

12. **The row toggle writes `selectableByTeacher`.** Turn it off; assert the engine leaves
    the teacher's selector **and** that `aiModel.enabled` is still `true` in the DB. That
    single assertion is the whole of item 7.
13. **`enabled` is still reachable.** Click `En servicio`; assert the PATCH sent
    `{ enabled: false }` and the chip reads `Fuera de servicio`.
14. **The fallback warning.** Point engine B's `fallbackModelId` at A, then take A out of
    service: assert the inline strip names B, that `Cancelar` sends no PATCH, and that
    `Sacarlo igual` does.
15. **`selectableByTeacher: false` + `enabled: true` survives** a page reload — the
    DeepSeek configuration must remain expressible.
16. **The selector is a listbox.** Assert `role="listbox"`, that each `role="option"`
    renders its description as **text** (not a `title`), and drive the whole selection
    with the keyboard only: `ArrowDown`, `Enter`, `Escape`. Then repeat the selection with
    a tap (`page.tap`) to prove the description is reachable without a pointer hover.

---

## Threat Matrix

**N/A** — no routing change, no shell command, no subprocess, no VCS/PR automation, no
executable-file classification and no process integration is introduced. The one new HTTP
route sits under the already-guarded `/api/projects` prefix (`middleware.ts:17`, verified
in §4.1) and the deploy-time migration runs through the existing, unmodified
`docker/prod-entrypoint.sh`.

---

## Migration / Rollout

Push → Coolify webhook → `npx prisma migrate deploy` → server start. No manual step, no
feature flag, no phase. Purely additive, fully replayable, and the worst failure mode is a
table that does not exist yet.

Dev sequence, in order: edit `schema.prisma` → hand-write the migration folder →
`npm run db:generate` → `npm run db:deploy` on a fresh DB (or
`npx prisma migrate resolve --applied 20260925000000_publicacion_likes_y_motores` where it
already ran) → `npm run check`. Never `prisma migrate dev`.

Rollback: revert the branch, hand-run `migration_down.sql`, then
`npx prisma migrate resolve --rolled-back …`. The only loss is the likes. Reverting
re-exposes the publish toggle in the creation dialog and the USD figure to teachers, which
is the prior behaviour, not a regression.

## Open Questions

- [ ] None blocking. Three accepted consequences worth the owner seeing once:
      **(a)** resources that are already published without a cover stay published (§2.1)
      — the invariant is forward-looking, and the migration refuses to shelve someone's
      work in a way the rollback could not undo;
      **(b)** the *server-seeded* stale flag over-fires on metadata-only edits (a title
      change followed by a reload can raise "Actualizar portada"); the live in-workspace
      flag is exact, and the precise fix is a `Project.htmlUpdatedAt` column that this
      change's scope does not authorise;
      **(c)** the shared demo account holds one like per resource, by design — it is one
      identity, and `@@unique([userId, projectId])` treats it as such.
