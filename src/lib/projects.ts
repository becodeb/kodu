import { prisma } from './db.ts';
import { buildProjectSlug } from './slug.ts';
import { DEFAULT_HTML } from './ai/versiones.ts';

/**
 * Acceso a proyectos con el chequeo de propiedad incorporado.
 *
 * Regla: ningún endpoint busca por `id` a secas. Siempre a través de
 * `findProjectForActor`/`findWorkspaceProjectForActor`, así un docente no
 * puede tocar el recurso de otro cambiando el id en la URL — y un admin sí
 * puede, a propósito (M8, design.md §7).
 */

/** Re-exportada desde `ai/versiones.ts` (T9): ese
 *  módulo es isomórfico (también lo importa el cliente) y no puede arrastrar
 *  Prisma, así que la constante vive ahí y este módulo —que sí importa
 *  Prisma— la reusa en vez de duplicarla. Cualquier import existente de
 *  `DEFAULT_HTML` desde acá sigue andando igual. */
export { DEFAULT_HTML };

/** Quien pide el recurso. `locals.user` ya tiene esta forma — no hace falta mapear nada. */
export interface Actor {
  id: string;
  role: 'DOCENTE' | 'ADMIN';
}

/**
 * El único punto que decide si un actor puede tocar un proyecto (M8,
 * design.md §7): un DOCENTE sólo ve lo suyo (`{ id, userId }`, igual que
 * siempre); un ADMIN bypasea el filtro de dueño a propósito, para poder
 * ayudar a un docente que pidió una mano por fuera de la app. La cuenta de
 * demo (M7) es un DOCENTE ordinario para este chequeo — `isDemo` no es
 * `role`, así que nunca gana este bypass.
 */
export async function findProjectForActor(projectId: string, actor: Actor) {
  return prisma.project.findFirst({
    where: actor.role === 'ADMIN' ? { id: projectId } : { id: projectId, userId: actor.id },
  });
}

/**
 * El editor necesita hilos y adjuntos en la misma consulta. También trae el
 * nombre del dueño (M8, design.md §7): el banner que ve un admin en un
 * recurso ajeno lo necesita, y pedirlo acá evita una segunda consulta en la
 * página sólo para ese dato.
 */
export async function findWorkspaceProjectForActor(projectId: string, actor: Actor) {
  return prisma.project.findFirst({
    where: actor.role === 'ADMIN' ? { id: projectId } : { id: projectId, userId: actor.id },
    include: {
      user: { select: { name: true } },
      threads: { orderBy: { createdAt: 'asc' }, select: { id: true, title: true } },
      assets: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, filename: true, url: true, fileType: true },
      },
    },
  });
}

/**
 * Deja la marca durable de que un admin actuó sobre un recurso ajeno (M8,
 * design.md §7): `Project.lastAdminActorId`/`lastAdminActionAt`. Sólo
 * escribe cuando el actor es un ADMIN Y no es el dueño — un docente
 * (incluida la demo) tocando su propio recurso nunca toca estas columnas.
 * Devuelve si escribió, para que el llamador pueda decidir si también marca
 * el `ChatMessage` del turno.
 */
export async function marcarSiActuaAdmin(
  project: { id: string; userId: string },
  actor: Actor,
): Promise<boolean> {
  if (actor.role !== 'ADMIN' || actor.id === project.userId) return false;

  await prisma.project.update({
    where: { id: project.id },
    data: { lastAdminActorId: actor.id, lastAdminActionAt: new Date() },
  });

  return true;
}

/**
 * ¿Hay un turno de la IA en curso en ESTE proyecto, en cualquiera de sus
 * hilos? Mismo criterio en los lugares que lo necesitan (T4 "Deshacer" y T9
 * "Varias versiones" del lado del servidor; el cliente y
 * `/api/chat/cancel` del lado de cuándo hay que ofrecer "Detener"): el
 * último mensaje de un hilo es del docente ⇒ la IA todavía no le contestó
 * ese turno. Se mira TODOS los hilos del proyecto, no sólo uno, porque
 * `currentHtml` es del proyecto entero y cualquier hilo puede estar a mitad
 * de un turno.
 */
export async function hayTurnoEnCurso(projectId: string): Promise<boolean> {
  const hilos = await prisma.chatThread.findMany({ where: { projectId }, select: { id: true } });
  const ultimosPorHilo = await Promise.all(
    hilos.map((hilo) =>
      prisma.chatMessage.findFirst({
        where: { threadId: hilo.id },
        orderBy: { createdAt: 'desc' },
        select: { role: true },
      }),
    ),
  );
  return ultimosPorHilo.some((mensaje) => mensaje?.role === 'user');
}

/**
 * Margen para no marcar vieja una portada por el ida y vuelta de sacarla.
 *
 * `updatedAt` se mueve con CUALQUIER escritura al recurso, incluida la que
 * publica justo después de la foto (design §3.2). Ese PATCH llega uno o dos
 * segundos más tarde que el POST de la captura, así que sin margen una
 * portada recién sacada nace vieja y el marcador no significa nada. 5 s
 * cubre ese viaje con aire; el debounce de 700 ms ya lo elimina `flushSave()`
 * antes de la foto.
 */
export const TOLERANCIA_PORTADA_MS = 5_000;

export function portadaDesactualizada(screenshotAt: Date | null, updatedAt: Date): boolean {
  // NULL = portada anterior a esta columna. FRESCA, nunca vieja: si no, el
  // día del deploy toda la app amanece pidiendo actualizar la portada.
  if (!screenshotAt) return false;
  return updatedAt.getTime() - screenshotAt.getTime() > TOLERANCIA_PORTADA_MS;
}

/** Crea el proyecto con su primer hilo de conversación, en una transacción. */
export async function createProject(options: {
  userId: string;
  title: string;
  description?: string | null;
  html?: string;
  /** El actor que crea el recurso es la cuenta de demo (design.md §8):
   *  habilita el purgado masivo desde /admin/demo sin tocar nada de
   *  docentes reales. */
  createdByDemo?: boolean;
}) {
  return withUniqueSlug(options.title, (slug) =>
    prisma.project.create({
      data: {
        title: options.title,
        description: options.description ?? null,
        slug,
        currentHtml: options.html ?? DEFAULT_HTML,
        userId: options.userId,
        createdByDemo: options.createdByDemo ?? false,
        threads: { create: { title: 'Conversación' } },
      },
      include: { threads: true },
    }),
  );
}

/** Duplica un recurso de la galería en la cuenta propia (SPEC §5.3). */
export async function duplicateProject(
  sourceId: string,
  targetUserId: string,
  createdByDemo = false,
) {
  const source = await prisma.project.findFirst({
    where: { id: sourceId, isInGallery: true },
    select: { title: true, description: true, currentHtml: true },
  });

  if (!source) return null;

  // La copia arranca privada y sin captura: es un recurso nuevo del docente.
  return createProject({
    userId: targetUserId,
    title: `${source.title} (copia)`,
    description: source.description,
    html: source.currentHtml,
    createdByDemo,
  });
}

/**
 * Reintenta con un slug nuevo si justo colisionó el sufijo aleatorio (P2002).
 */
async function withUniqueSlug<T>(title: string, create: (slug: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await create(buildProjectSlug(title));
    } catch (error) {
      const isSlugCollision =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002';

      if (!isSlugCollision || attempt === 4) throw error;
    }
  }

  throw new Error('No se pudo generar un slug único');
}
