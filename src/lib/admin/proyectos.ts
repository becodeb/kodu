import { prisma } from '../db.ts';

/**
 * Una fila de `/admin/proyectos`: TODOS los recursos de la plataforma, sean de
 * quien sean y estén publicados o no.
 *
 * El acceso del admin al recurso ajeno ya existía desde M8 —
 * `findProjectForActor` (src/lib/projects.ts) deja pasar a un ADMIN a
 * cualquier proyecto, y `BannerAdmin.astro` lo hace visible cuando entra. Lo
 * que faltaba era el listado: hasta ahora, para llegar a un recurso había que
 * saber de quién era y entrar por la ficha de ese docente.
 */
export interface FilaProyectoAdmin {
  id: string;
  title: string;
  slug: string;
  isInGallery: boolean;
  tienePortada: boolean;
  /** Portada vieja: la IA tocó el recurso después de la última captura. */
  portadaVieja: boolean;
  likes: number;
  createdByDemo: boolean;
  duenoId: string;
  duenoNombre: string;
  /** Último admin que actuó sobre un recurso ajeno, si hubo alguno (M8). */
  ultimoAdmin: string | null;
  updatedAt: string;
}

export async function listarProyectosAdmin(): Promise<FilaProyectoAdmin[]> {
  const filas = await prisma.project.findMany({
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      slug: true,
      isInGallery: true,
      screenshotUrl: true,
      screenshotAt: true,
      createdByDemo: true,
      userId: true,
      updatedAt: true,
      user: { select: { name: true } },
      lastAdminActor: { select: { name: true } },
      _count: { select: { likes: true } },
    },
  });

  return filas.map((fila) => ({
    id: fila.id,
    title: fila.title,
    slug: fila.slug,
    isInGallery: fila.isInGallery,
    tienePortada: fila.screenshotUrl !== null,
    // Sin portada no hay nada que esté viejo, y sin fecha de captura se asume
    // fresca: son las filas anteriores a que se guardara `screenshotAt`.
    portadaVieja:
      fila.screenshotUrl !== null &&
      fila.screenshotAt !== null &&
      fila.screenshotAt < fila.updatedAt,
    likes: fila._count.likes,
    createdByDemo: fila.createdByDemo,
    duenoId: fila.userId,
    duenoNombre: fila.user.name,
    ultimoAdmin: fila.lastAdminActor?.name ?? null,
    // Se serializa a string acá y no en el componente: un Date cruza el límite
    // servidor→isla como string igual, y hacerlo explícito evita que el tipo
    // mienta (mismo criterio que los Decimal en modelos.ts).
    updatedAt: fila.updatedAt.toISOString(),
  }));
}
