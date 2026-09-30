import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { requireFreshUser } from '../../../../lib/auth/guards.ts';
import { prisma } from '../../../../lib/db.ts';
import { crearCheckoutIndividual } from '../../../../lib/billing/aplicar.ts';

const schema = z.object({ interval: z.enum(['MONTHLY', 'ANNUAL']) });

/** POST /api/billing/individual/checkout (odd/tasks/planes-y-cobros.md T4) —
 *  sólo cuentas PERSONALES (sin organización); `crearCheckoutIndividual`
 *  vuelve a chequearlo del lado del servicio. */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = requireFreshUser(locals);
  if (user instanceof Response) return user;

  const fila = await prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true, email: true } });
  if (!fila) return fail('Sesión no válida o expirada', 401);

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const resultado = await crearCheckoutIndividual(
    { id: user.id, email: fila.email, organizationId: fila.organizationId },
    parsed.data,
  );
  if (!resultado.ok) return fail(resultado.message, resultado.status, resultado.reason ? { reason: resultado.reason } : {});
  return ok({ url: resultado.data.url });
};
