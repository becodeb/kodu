import type { APIRoute } from 'astro';
import { fail, ok } from '../../../../../../lib/http.ts';
import { requireUser } from '../../../../../../lib/auth/guards.ts';
import { quitarEmailListaBlanca, GestionError } from '../../../../../../lib/orgs/gestion.ts';

/** `DELETE /api/admin/organizaciones/:id/lista-blanca/:emailId` (odd/tasks/organizaciones.md T6). */
export const DELETE: APIRoute = async ({ params, locals }) => {
  const actor = requireUser(locals);
  if (actor instanceof Response) return actor;

  try {
    await quitarEmailListaBlanca(actor, params.id!, params.emailId!);
    return ok({});
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};
