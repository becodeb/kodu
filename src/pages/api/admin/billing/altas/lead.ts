import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../../lib/http.ts';
import { requireFreshAdmin } from '../../../../../lib/auth/guards.ts';
import { marcarLead } from '../../../../../lib/billing/revision-acciones.ts';

const schema = z.object({
  leadId: z.string().min(1),
  accion: z.enum(['CONTACTED', 'CLOSED']),
  note: z.string().trim().max(2000).nullable().optional(),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const user = requireFreshAdmin(locals);
  if (user instanceof Response) return user;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const resultado = await marcarLead(parsed.data.leadId, parsed.data.accion, parsed.data.note ?? null);
  if (!resultado.ok) return fail(resultado.message, resultado.status);
  return ok(resultado.data);
};
