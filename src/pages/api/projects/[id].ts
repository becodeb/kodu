import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { findProjectForActor, marcarSiActuaAdmin } from '../../../lib/projects.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';
import { leerAppSettings } from '../../../lib/settings.ts';
import { resolverCapacidades } from '../../../lib/ai/capacidades.ts';
import { motoresParaDocente } from '../../../lib/ai/catalogo.ts';

const updateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(400).nullable().optional(),
  currentHtml: z.string().min(20).max(400_000).optional(),
  /** El `id` de un `AiModel` que esta persona podría elegir en el selector. */
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

  // LA INVARIANTE (proposal §1): no puede existir un recurso publicado sin
  // portada. El cliente ya saca la captura antes de publicar, pero esa
  // secuencia se puede saltear, se puede cortar a la mitad y puede correr
  // contra el iframe; este rechazo es lo unico que hace VERDADERA la frase.
  if (parsed.data.isInGallery === true && !project.screenshotUrl) {
    return fail('Para publicar hace falta una portada. Sacá una captura del recurso y volvé a intentar.', 422);
  }

  // Sólo se guarda un motor que esta persona podría elegir en el selector.
  // Antes cualquier id pasaba: uno inexistente terminaba en un error de FK
  // (500) y uno exclusivo quedaba guardado aunque después se normalizara al
  // leerlo. El chat igual re-normaliza en cada turno; esto cierra la puerta
  // de entrada.
  if (parsed.data.aiModelId !== undefined) {
    const capacidades = resolverCapacidades(user, await leerAppSettings());
    const elegibles = await motoresParaDocente(capacidades.puedeUsarModelosPrime);
    if (!elegibles.some((motor) => motor.id === parsed.data.aiModelId)) {
      return fail('Ese motor no está disponible.', 422);
    }
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
      screenshotAt: true,
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
