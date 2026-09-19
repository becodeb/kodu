import type { APIRoute } from 'astro';
import { prisma } from '../../../../lib/db.ts';
import { fail, ok } from '../../../../lib/http.ts';
import { invalidarDominios } from '../../../../lib/auth/domains.ts';

/**
 * DELETE /api/admin/domains/:id — saca un dominio de la lista blanca
 * (design.md §10). Si la lista queda vacía, `puedeUsarLaIa()` vuelve a
 * permitir a todo el mundo — ver `domains.ts`, es la misma regla que hoy.
 *
 * La autenticación y la frescura de la identidad ya las exige el middleware
 * (`requireFreshAdmin` en toda mutación de `/api/admin` — ver
 * `src/middleware.ts`).
 */
export const DELETE: APIRoute = async ({ params }) => {
  const existente = await prisma.authorizedDomain.findUnique({ where: { id: params.id! } });
  if (!existente) return fail('Ese dominio no existe.', 404);

  await prisma.authorizedDomain.delete({ where: { id: existente.id } });
  invalidarDominios();

  return ok({});
};
