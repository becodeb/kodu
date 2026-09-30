import type { APIRoute } from 'astro';
import { fail, ok } from '../../../../lib/http.ts';
import { requireFreshUser } from '../../../../lib/auth/guards.ts';
import { arrepentimientoIndividual } from '../../../../lib/billing/aplicar.ts';

/**
 * POST /api/billing/individual/arrepentimiento (odd/tasks/planes-y-cobros.md
 * T4): dentro de los 10 días del primer pago, cancela ya mismo y vuelve a
 * FREE (no "al fin del período", a diferencia de una cancelación común).
 */
export const POST: APIRoute = async ({ locals }) => {
  const user = requireFreshUser(locals);
  if (user instanceof Response) return user;

  const resultado = await arrepentimientoIndividual(user.id);
  if (!resultado.ok) return fail(resultado.message, resultado.status);
  return ok(resultado.data);
};
