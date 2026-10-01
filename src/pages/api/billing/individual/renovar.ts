import type { APIRoute } from 'astro';
import { fail, ok } from '../../../../lib/http.ts';
import { requireFreshUser } from '../../../../lib/auth/guards.ts';
import { prisma } from '../../../../lib/db.ts';
import { crearCheckoutRenovacionIndividual } from '../../../../lib/billing/aplicar.ts';

/** POST /api/billing/individual/renovar (odd/tasks/planes-y-cobros.md T4b) —
 *  renueva el plan Individual ANUAL de quien llama, antes o después de que
 *  venza. Sin body: el monto y el período los calcula el servidor. */
export const POST: APIRoute = async ({ locals }) => {
  const user = requireFreshUser(locals);
  if (user instanceof Response) return user;

  const fila = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true } });
  if (!fila) return fail('Sesión no válida o expirada', 401);

  const resultado = await crearCheckoutRenovacionIndividual({ id: user.id, email: fila.email });
  if (!resultado.ok) return fail(resultado.message, resultado.status, resultado.reason ? { reason: resultado.reason } : {});
  return ok({ url: resultado.data.url });
};
