import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../../lib/http.ts';
import { requireFreshOrgAdmin } from '../../../../../lib/orgs/alcance.ts';
import { promoverAdmin, GestionError } from '../../../../../lib/orgs/gestion.ts';

/**
 * POST /api/org/organizaciones/:id/admins (odd/tasks/organizaciones.md T8) —
 * promueve a `userId` a admin de `:id` (la MISMA sede que se está mirando:
 * el toggle inline de `<MiembrosLista>` nunca promueve a nivel de red desde
 * acá). Mismo par que `/api/admin/organizaciones/:id/admins` (T6).
 */

const promoverSchema = z.object({
  userId: z.string().trim().min(1, 'Falta el docente'),
});

export const POST: APIRoute = async ({ params, request, locals }) => {
  const organizationId = params.id!;
  const parsed = promoverSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const resultado = await requireFreshOrgAdmin(locals, organizationId);
  if (resultado instanceof Response) return resultado;

  try {
    await promoverAdmin(resultado, organizationId, parsed.data.userId);
    return ok({});
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};
