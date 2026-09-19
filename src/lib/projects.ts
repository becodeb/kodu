import { prisma } from './db.ts';
import { buildProjectSlug } from './slug.ts';

/**
 * Acceso a proyectos con el chequeo de propiedad incorporado.
 *
 * Regla: ningún endpoint busca por `id` a secas. Siempre a través de
 * `findProjectForActor`/`findWorkspaceProjectForActor`, así un docente no
 * puede tocar el recurso de otro cambiando el id en la URL — y un admin sí
 * puede, a propósito (M8, design.md §7).
 */

export const DEFAULT_HTML =
  "<!DOCTYPE html><html><head><meta charset='UTF-8'><script src='https://cdn.tailwindcss.com'></script></head><body class='p-6 text-center text-gray-700 font-sans'><p>Tu recurso aparecerá acá...</p></body></html>";

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
