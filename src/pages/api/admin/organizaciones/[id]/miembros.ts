import type { APIRoute } from 'astro';
import { fail, ok } from '../../../../../lib/http.ts';
import { requireUser } from '../../../../../lib/auth/guards.ts';
import { listarMiembros, GestionError } from '../../../../../lib/orgs/gestion.ts';

/** `GET /api/admin/organizaciones/:id/miembros` — docentes de una sede (odd/tasks/organizaciones.md T6). */
export const GET: APIRoute = async ({ params, locals }) => {
  const actor = requireUser(locals);
  if (actor instanceof Response) return actor;

  try {
    const miembros = await listarMiembros(actor, params.id!);
    return ok({ miembros });
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};
