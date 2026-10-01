import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../lib/http.ts';
import { requireFreshUser } from '../../../lib/auth/guards.ts';
import { crearLeadInstitucional, RechazoAlta } from '../../../lib/billing/alta.ts';

/**
 * POST /api/instituciones/lead (odd/tasks/planes-y-cobros.md T5): el contacto
 * "Hablemos" — matrícula por encima del umbral, o el formulario de contacto
 * simple que ofrece `/instituciones/alta` cuando el dominio del creador es
 * público. Exige sesión (mismo criterio que `/api/instituciones/alta`: el
 * flujo entero empieza con "entrá primero") para no abrir un formulario
 * anónimo de spam; se prellenan nombre/email del lado del cliente con los de
 * la sesión.
 */
const schema = z.object({
  institutionName: z.string().trim().min(1).max(200),
  contactName: z.string().trim().min(1).max(200),
  contactEmail: z.string().trim().email(),
  phone: z.string().trim().max(40).optional().nullable(),
  declaredStudents: z.coerce.number().int().positive().optional().nullable(),
  message: z.string().trim().max(2000).optional().nullable(),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const user = requireFreshUser(locals);
  if (user instanceof Response) return user;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  try {
    const lead = await crearLeadInstitucional(parsed.data);
    return ok({ id: lead.id });
  } catch (error) {
    if (error instanceof RechazoAlta) return fail(error.message, 422);
    console.error('[instituciones/lead]', error);
    return fail('No pudimos guardar tu consulta. Intentá de nuevo.', 500);
  }
};
