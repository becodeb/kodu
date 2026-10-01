import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../../lib/http.ts';
import { requireFreshAdmin } from '../../../../../lib/auth/guards.ts';
import { activarLicenciaManualPorTransferencia } from '../../../../../lib/billing/aplicar.ts';

/** odd/tasks/planes-y-cobros.md (T7): "Activar licencia manual por
 *  transferencia" desde /admin/altas (o /admin/organizaciones/[id]). */
const schema = z.object({
  organizationId: z.string().min(1),
  interval: z.enum(['MONTHLY', 'CYCLE']),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  amountArs: z.coerce.number().positive(),
  paymentDate: z.coerce.date(),
  legalName: z.string().trim().min(1).optional(),
  cuit: z.string().trim().min(1).optional(),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const user = requireFreshAdmin(locals);
  if (user instanceof Response) return user;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const { organizationId, ...input } = parsed.data;
  const resultado = await activarLicenciaManualPorTransferencia(organizationId, input);
  if (!resultado.ok) return fail(resultado.message, resultado.status);
  return ok(resultado.data);
};
