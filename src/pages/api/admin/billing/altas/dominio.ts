import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../../lib/http.ts';
import { requireFreshAdmin } from '../../../../../lib/auth/guards.ts';
import { verificarDominio, eliminarDominio } from '../../../../../lib/billing/revision-acciones.ts';

/** odd/tasks/planes-y-cobros.md (T7): verificar o eliminar un dominio de
 *  `/admin/altas` — `accion` distingue las dos acciones del mismo recurso. */
const schema = z.object({ domainId: z.string().min(1), accion: z.enum(['VERIFICAR', 'ELIMINAR']) });

export const POST: APIRoute = async ({ request, locals }) => {
  const user = requireFreshAdmin(locals);
  if (user instanceof Response) return user;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const resultado =
    parsed.data.accion === 'VERIFICAR' ? await verificarDominio(parsed.data.domainId) : await eliminarDominio(parsed.data.domainId);
  if (!resultado.ok) return fail(resultado.message, resultado.status);
  return ok(resultado.data);
};
