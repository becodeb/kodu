import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createProject } from '../../../lib/projects.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';
import { puedeUsarLaIa } from '../../../lib/orgs/acceso.ts';

const createSchema = z.object({
  title: z.string().trim().min(1).max(120).default('Nuevo Recurso'),
  description: z.string().trim().max(400).optional(),
});

/** POST /api/projects — crea un recurso vacío con su primer hilo de chat. */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;

  /**
   * odd/tasks/organizaciones.md (T2, decisión del dueño — "Cuenta
   * personal"): quien no puede usar la IA y no es superadmin no puede crear
   * recursos nuevos — los que ya tenía siguen ahí, sólo se corta el alta.
   */
  if (!(await puedeUsarLaIa(user)) && user.role !== 'ADMIN') {
    return fail('Tu cuenta todavía no tiene habilitado el uso de la IA. Escribinos y lo vemos.', 403);
  }

  const parsed = createSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }

  const project = await createProject({
    userId: user.id,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    createdByDemo: user.isDemo,
  });

  return ok({
    project: {
      id: project.id,
      title: project.title,
      slug: project.slug,
      threadId: project.threads[0]?.id ?? null,
    },
    redirect: `/app/project/${project.id}`,
  });
};
