import type { APIRoute } from 'astro';
import { fail, ok } from '../../../../lib/http.ts';
import { requireFreshUser } from '../../../../lib/auth/guards.ts';
import { cancelarIndividual } from '../../../../lib/billing/aplicar.ts';

/** POST /api/billing/individual/cancel (odd/tasks/planes-y-cobros.md T4). */
export const POST: APIRoute = async ({ locals }) => {
  const user = requireFreshUser(locals);
  if (user instanceof Response) return user;

  const resultado = await cancelarIndividual(user.id);
  if (!resultado.ok) return fail(resultado.message, resultado.status);
  return ok(resultado.data);
};
