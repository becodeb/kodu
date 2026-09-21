# Exploration: `publicacion-likes-y-motores`

A batch of eight requests from the owner. One (the DeepSeek 400) was an
outright production bug and is already fixed on this branch; the other seven
are the change proper.

## The owner's requests, verbatim (Spanish)

1. "apenas toquen publicar se les saque una captura osea la portada así no
   puede haber publicadas sin fotos"
2. "que se puedan poner likes a las publicaciones osea que tengan corazonsitos
   que aparecen en rojo cuando los pones, tienen que aparecer en la parte de
   abajo a la izquierda de la card con el contador. Y aparecen arriba la de mas
   likes en la galería"
3. "Mandé un prompt y me da este error: DeepSeek Flash respondió 400. Thinking
   mode does not support this tool_choice" — **already fixed, see below**
4. "cuando un usuario intenta crear algo que la ia pregunte bien las cosas que
   no sabe, mas que nada en las primeras iteraciones … que no intente adivinar"
5. "Cuando creo un nuevo recurso me pregunta Que vas a armar, quiero que me
   saques el toggle ya que quiero que lo publiquen cuando lo terminan y no
   apenas lo empiezan" + "si la ia hace cambios … el boton de sacar portada
   debe decir actualizar portada … Tampoco que llame tanto la atencion pero
   como que por lo menos se puedan dar cuenta que les serviria"
6. "En el admin cuando activo el toggle de los motores debería activar y
   desactivar si les aparece a los docentes (osea ese es el toggle)"
7. "el selector de modelos (motores) de los usuario … tiene que ser un
   desplegable que al hacerle hover te aparece la descripcion"
8. "Que no aparezca tanto visible para los usuarios el precio. solo para los
   admins el precio"

## Already fixed on this branch (item 3)

`src/lib/ai/provider.ts` forced `tool_choice: {type:'function', function:{name:
'update_resource_code'}}` whenever `forzarHerramienta` was set — which happens
at `src/pages/api/chat/stream.ts:518` (the teacher asked for a change) and
`:696` (the model promised a change and didn't deliver). Reasoning models reject
a forced tool choice outright.

Fix: a new `ToolChoiceNoSoportado extends ProviderError`, thrown when the
provider answers 400 with `tool_choice` in the body. `requestCompletionStream`
catches it, drops the forcing, and repeats the request immediately with
`'auto'` — once, and without consuming any of the nine saturation retries.
`npm run check` clean.

This is deliberately provider-agnostic: no new schema column, no operator
knowledge of which models are "thinking mode". Any provider with the same
restriction is handled.

## Current state, verified

### Publishing and the cover

- `Project` (`prisma/schema.prisma:123-156`) holds `screenshotUrl String?` and
  `isInGallery Boolean @default(false)`, indexed `@@index([isInGallery, updatedAt])`.
- **The screenshot is taken client-side**, not by Playwright on the server. The
  browser captures the preview iframe and POSTs a data URL to
  `src/pages/api/projects/[id]/screenshot.ts`, which decodes it via
  `decodeDataUrl`, stores it with `storeFile('screenshots', …)` and writes
  `screenshotUrl`. There is a matching DELETE.
- `src/components/workspace/Workspace.tsx:464-482` owns both calls.
- `src/components/workspace/PreviewPanel.tsx:117` already switches its label
  between `'Sacar portada'` and `'Cambiar portada'` based on `screenshotUrl`.
- **There is no way to know the cover is stale.** `Project.updatedAt` moves on
  every edit, but nothing records *when* the cover was taken. Item 5's
  "Actualizar portada" state needs a new `screenshotAt DateTime?` column
  compared against `updatedAt`.
- The publish toggle lives in `src/components/workspace/FichaDialog.tsx:85-92`,
  inside the dialog titled `"¿Qué vas a armar?"` (`FichaDialog.tsx:34`) that
  opens when a resource is created. Item 5 removes it from there. Publishing
  still has to be reachable afterwards — `src/pages/app/index.astro:91-95`
  renders the gallery state per resource, and `Workspace.tsx:607-610` patches
  `isInGallery`; one of those is where publishing has to live instead.

### The gallery

`src/pages/gallery.astro:8-21` — `findMany({ where: { isInGallery: true },
orderBy: { updatedAt: 'desc' }, take: 60 })`. Item 2 changes the sort to likes
first. **The page renders for anonymous visitors too**: `const user =
Astro.locals.user` may be null.

### Likes

Nothing of the kind exists anywhere in the repo. This is a new entity.

**Owner's decision (asked and answered):** only logged-in teachers can like.
One like per teacher per resource, enforced by a unique pair. The counter is
visible to everyone including anonymous visitors; an anonymous click goes to
login. Rejected alternatives: anonymous likes (cookie/IP dedup is weak and
makes the "most liked first" ordering inflatable by anyone) and a
no-self-likes rule (extra rule to explain for little gain at this scale).

### The AI prompt

`src/lib/ai/prompt.ts` — `buildSystemPrompt(context: PromptContext)` at `:172`,
called once per turn from `src/pages/api/chat/stream.ts:415`. Concatenation
order is documented at `prompt.ts:2-11`: base prompt, global admin rules,
teacher rules, assets, current HTML. Thread history is appended separately as
messages.

`BASE_PROMPT` (`prompt.ts:47`) says nothing about asking clarifying questions.
Item 4 needs the prompt to know how far into the conversation it is, so
`PromptContext` needs a turn signal — the `ChatThread`/`ChatMessage` count is
available at the call site in `stream.ts`.

Note the tension worth naming: the base prompt's whole design is "build the
thing", and `stream.ts:518` *forces* the code tool when `pideCambio(message)`.
Asking a question instead of building must not collide with that forcing.

### The engine toggles in admin

`src/components/admin/ModelosPanel.tsx:93-99,209-213` — **the visible toggle
writes `enabled`, not `selectableByTeacher`.** These are different things:

- `enabled` — the engine is usable at all, *including as a link in the fallback
  chain* (`cadenaDeMotores()` in `src/lib/ai/catalogo.ts`).
- `selectableByTeacher` — the engine appears in the teacher's selector
  (`motoresParaDocente()` filters `enabled && selectableByTeacher`).

DeepSeek ships `selectableByTeacher: false` deliberately: it is the paid
backup, reachable by fallback but not pickable by hand.

Item 6 asks for the visible toggle to mean "do teachers see it". **The risk is
concrete**: if the toggle is simply repointed at `selectableByTeacher` and
`enabled` loses its control, an admin hiding DeepSeek from teachers could
silently break the fallback chain, or an admin could no longer take an engine
out of service entirely. The proposal must decide how both controls are
surfaced, not just rename one.

### The teacher-facing engine selector

`src/components/workspace/ChatPanel.tsx:212-236` — a segmented button group,
one button per engine, with the selected engine's `description` rendered as a
paragraph underneath. `MotorPublico` (`src/lib/workspace-types.ts:9-14`) carries
`{ id, displayName, description, supportsVision }`. Item 7 turns this into a
dropdown with the description on hover.

### Price visibility

`src/components/workspace/IndicadorConsumo.tsx`, mounted at
`src/pages/app/project/[id].astro:147`, shows the teacher the USD cost of their
own resource (exact amount revealed on hover). Item 8 makes it admin-only.

**Name the conflict rather than bury it:** `ChatPanel.tsx:209-211` carries a
comment explaining that surfacing cost to the teacher was a deliberate earlier
decision — "elegir el modelo pago sin saber que se gasta plata es justo la
clase de sorpresa que no queremos darle a nadie". Item 8 reverses that. The
owner asked for it explicitly, so it ships; but the proposal should say what
replaces the warning function, if anything — e.g. keeping a non-monetary
consumption level (`nivelDeConsumo` already exists and is computed on tokens,
never dollars) while dropping the USD figure.

## Deployment constraint (unchanged, and it still dominates)

Production deploys on a Coolify webhook on push to main.
`docker/prod-entrypoint.sh:11` runs `prisma migrate deploy` before the server
starts, and `Dockerfile:51` (`npm ci --omit=dev`) plus the narrow COPY list at
`:53-56` mean `scripts/` and `tsx` are absent from the runner image.

**Any migration in this change must be pure SQL and must run unattended.** The
two new pieces of schema — the likes table and `Project.screenshotAt` — are
both additive, so this is far less delicate than the provider split was. There
is no ciphertext to move and no AAD to preserve.

## Open questions for the proposal phase

1. With the publish toggle gone from the creation dialog, where does publishing
   live? The workspace (next to the cover button) or the resource list?
2. Item 6: how are `enabled` and `selectableByTeacher` both surfaced without
   letting an admin break the fallback chain by accident?
3. Item 8: does the teacher keep a non-monetary consumption signal, or does the
   indicator disappear entirely?
4. Does an anonymous visitor see the heart at all, or only the count?

## Risks

- Item 6 can silently break the fallback chain if `enabled` stops being
  controllable. That is a production outage class, not a UI nit.
- Item 1 (auto-capture on publish) depends on a client-side capture of an
  iframe. If the capture fails or the iframe has not rendered, publishing must
  not silently produce a cover-less published resource — the whole point of the
  request. Decide whether publish blocks on the capture or rolls back.
- The only automated gate is `npm run check` (tsc). As the previous change
  proved, it cannot see writes to dropped columns inside Prisma `data`
  literals. Nothing is being dropped here, but the e2e scripts are again the
  only real proof.
