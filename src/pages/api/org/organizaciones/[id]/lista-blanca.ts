import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../../lib/http.ts';
import { requireOrgAdmin, requireFreshOrgAdmin } from '../../../../../lib/orgs/alcance.ts';
import { agregarEmailListaBlanca, listarListaBlanca, GestionError } from '../../../../../lib/orgs/gestion.ts';

/**
 * `/api/org/organizaciones/:id/lista-blanca` (odd/tasks/organizaciones.md
 * T8) — mismo par GET/POST que `/api/admin/organizaciones/:id/lista-blanca`
 * (T6), pero autorizado contra `alcance.ts` en vez del rol superadmin del
 * middleware (`/api/org/**` sólo exige sesión, ver `src/middleware.ts`):
 * `gestion.ts` ya vuelve a autorizar solo, esto agrega el chequeo de
 * IDENTIDAD FRESCA en la mutación (T8, "Mutaciones usan requireFreshOrgAdmin").
 */

const crearEmailSchema = z.object({
  email: z.string().trim().min(1, 'Falta el email').max(300),
});

export const GET: APIRoute = async ({ params, locals }) => {
  const organizationId = params.id!;
  const resultado = await requireOrgAdmin(locals, organizationId);
  if (resultado instanceof Response) return resultado;

  try {
    const lista = await listarListaBlanca(resultado, organizationId);
    return ok({ lista });
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const organizationId = params.id!;
  const parsed = crearEmailSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const resultado = await requireFreshOrgAdmin(locals, organizationId);
  if (resultado instanceof Response) return resultado;

  try {
    const item = await agregarEmailListaBlanca(resultado, organizationId, parsed.data.email);
    return ok({ item });
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};
