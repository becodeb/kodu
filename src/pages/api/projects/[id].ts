import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { findProjectForActor, marcarSiActuaAdmin } from '../../../lib/projects.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';

const updateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(400).nullable().optional(),
  currentHtml: z.string().min(20).max(400_000).optional(),
  /** El `id` de un `AiModel`. El FK de la base rechaza uno que no exista. */
  aiModelId: z.string().min(1).optional(),
  isInGallery: z.boolean().optional(),
});

/**
 * PATCH /api/projects/:id — edición manual del código, título, modelo elegido y
 * el switch "Publicar en Galería" (SPEC §5.2).
 */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user!;
  const project = await findProjectForActor(params.id!, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  const parsed = updateSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }

  if (Object.keys(parsed.data).length === 0) {
    return fail('No hay nada para actualizar.', 422);
  }

  // M8 (design.md §7): un admin editando el código/título de un recurso
  // ajeno deja la marca ANTES del update, para que un fallo del update no
  // deje una marca huérfana sin cambio real detrás.
  await marcarSiActuaAdmin(project, user);

  const updated = await prisma.project.update({
    where: { id: project.id },
    data: parsed.data,
    select: {
      id: true,
      title: true,
      description: true,
      slug: true,
      isInGallery: true,
      aiModelId: true,
      screenshotUrl: true,
      updatedAt: true,
    },
  });

  return ok({ project: updated });
};

/** DELETE /api/projects/:id — borra el recurso y todo lo que cuelga de él. */
export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user!;
  const project = await findProjectForActor(params.id!, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  await prisma.project.delete({ where: { id: project.id } });

  return ok({ deleted: project.id });
};
