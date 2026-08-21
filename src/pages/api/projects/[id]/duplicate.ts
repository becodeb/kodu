import type { APIRoute } from 'astro';
import { duplicateProject } from '../../../../lib/projects.ts';
import { fail, ok } from '../../../../lib/http.ts';

/**
 * POST /api/projects/:id/duplicate — copia a la cuenta propia un recurso
 * publicado en la galería para adaptarlo (SPEC §5.3).
 */
export const POST: APIRoute = async ({ params, locals }) => {
  const user = locals.user!;

  const copy = await duplicateProject(params.id!, user.id);
  if (!copy) return fail('Ese recurso no está publicado en la galería.', 404);

  return ok({
    project: { id: copy.id, title: copy.title, slug: copy.slug },
    redirect: `/app/project/${copy.id}`,
  });
};
