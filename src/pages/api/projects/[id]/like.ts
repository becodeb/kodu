import type { APIRoute } from 'astro';
import { prisma } from '../../../../lib/db.ts';
import { fail, ok } from '../../../../lib/http.ts';

/**
 * POST/DELETE /api/projects/:id/like — el corazón de la galería.
 *
 * NO usa `findProjectForActor`: un like es sobre el recurso de OTRO docente,
 * así que el chequeo de propiedad es justo el chequeo equivocado. Lo que
 * autoriza acá es `isInGallery: true` — si el recurso no está publicado, no
 * se puede likear, y se contesta 404 (no 403) para no revelar que existe.
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
