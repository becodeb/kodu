import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../../lib/http.ts';
import { requireFreshAdmin } from '../../../../../lib/auth/guards.ts';
import { marcarRevisada } from '../../../../../lib/billing/revision-acciones.ts';

const schema = z.object({ organizationId: z.string().min(1) });

export const POST: APIRoute = async ({ request, locals }) => {
  const user = requireFreshAdmin(locals);
  if (user instanceof Response) return user;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const resultado = await marcarRevisada(parsed.data.organizationId);
  if (!resultado.ok) return fail(resultado.message, resultado.status);
  return ok(resultado.data);
};
