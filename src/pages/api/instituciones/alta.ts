import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../lib/http.ts';
import { requireFreshUser } from '../../../lib/auth/guards.ts';
import { prisma } from '../../../lib/db.ts';
import { emailConfiable } from '../../../lib/orgs/membresia.ts';
import { altaInstitucion } from '../../../lib/billing/alta.ts';

/**
 * POST /api/instituciones/alta (odd/tasks/planes-y-cobros.md T5): alta de
 * institución por cuenta propia — "Probá 30 días gratis". Exige sesión
 * (`requireFreshUser`, igual que `/api/billing/*`: ver `middleware.ts`,
 * `/api/instituciones` está en `PROTECTED_API_PREFIXES`) y email confiable
 * (una cuenta con contraseña sin confirmar, con Resend configurado, no puede
 * dar de alta nada — mismo criterio que `unirSiCorresponde`).
 */
const campusSchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(253).optional().nullable(),
});

const schema = z.object({
  institutionName: z.string().trim().min(1).max(200),
  kind: z.enum(['CAMPUS', 'NETWORK']),
  declaredStudents: z.coerce.number().int(),
  extraDomains: z.array(z.string().trim().max(253)).max(50).default([]),
  campuses: z.array(campusSchema).max(100).default([]),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const user = requireFreshUser(locals);
  if (user instanceof Response) return user;

  const fila = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, emailVerifiedAt: true },
  });
  if (!fila) return fail('Sesión no válida o expirada', 401);
  if (!emailConfiable(fila)) {
    return fail('Confirmá tu email antes de dar de alta una institución.', 403, { reason: 'EMAIL_SIN_VERIFICAR' });
  }

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const resultado = await altaInstitucion(
    { id: user.id, email: fila.email },
    {
      institutionName: parsed.data.institutionName,
      kind: parsed.data.kind,
      declaredStudents: parsed.data.declaredStudents,
      extraDomains: parsed.data.extraDomains,
      campuses: parsed.data.campuses,
    },
  );

  if (!resultado.ok) {
    return fail(resultado.message, resultado.status, resultado.reason ? { reason: resultado.reason } : {});
  }
  return ok({
    organizationId: resultado.data.organizationId,
    // T11: `null` cuando la prueba institucional está apagada — el alta
    // creó la institución igual, en `PENDING_PAYMENT`.
    trialEndsAt: resultado.data.trialEndsAt ? resultado.data.trialEndsAt.toISOString() : null,
    pendingDomains: resultado.data.pendingDomains,
    individualSubCancelada: resultado.data.individualSubCancelada,
    redirect: '/org?bienvenida=1',
  });
};
