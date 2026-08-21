import { prisma } from './db.ts';
import { buildProjectSlug } from './slug.ts';

/**
 * Acceso a proyectos con el chequeo de propiedad incorporado.
 *
 * Regla: ningún endpoint busca por `id` a secas. Siempre por `{ id, userId }`,
 * así un docente no puede tocar el recurso de otro cambiando el id en la URL.
 */

export const DEFAULT_HTML =
  "<!DOCTYPE html><html><head><meta charset='UTF-8'><script src='https://cdn.tailwindcss.com'></script></head><body class='p-6 text-center text-gray-700 font-sans'><p>Tu recurso aparecerá acá...</p></body></html>";

export async function findOwnedProject(projectId: string, userId: string) {
  return prisma.project.findFirst({ where: { id: projectId, userId } });
}

export async function assertOwnedProject(projectId: string, userId: string) {
  const project = await findOwnedProject(projectId, userId);
  if (!project) throw new ProjectNotFound();
  return project;
}

export class ProjectNotFound extends Error {
  constructor() {
    super('El recurso no existe o no es tuyo.');
    this.name = 'ProjectNotFound';
  }
}

/** Crea el proyecto con su primer hilo de conversación, en una transacción. */
export async function createProject(options: {
  userId: string;
  title: string;
  description?: string | null;
  html?: string;
}) {
  return withUniqueSlug(options.title, (slug) =>
    prisma.project.create({
      data: {
        title: options.title,
        description: options.description ?? null,
        slug,
        currentHtml: options.html ?? DEFAULT_HTML,
        userId: options.userId,
        threads: { create: { title: 'Conversación' } },
      },
      include: { threads: true },
    }),
  );
}

/** Duplica un recurso de la galería en la cuenta propia (SPEC §5.3). */
export async function duplicateProject(sourceId: string, targetUserId: string) {
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
