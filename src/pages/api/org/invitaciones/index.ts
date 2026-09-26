import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { prisma } from '../../../../lib/db.ts';
import { requireFreshOrgAdmin, requireOrgAdmin } from '../../../../lib/orgs/alcance.ts';
import { crearInvitacion, listarInvitaciones } from '../../../../lib/orgs/invitaciones.ts';

/**
 * `/api/org/invitaciones` — alta y listado de invitaciones de una CAMPUS
 * (odd/tasks/organizaciones.md T4). El middleware ya exige sesión + identidad
 * fresca en "/api/org/*" (src/middleware.ts); acá falta la autorización
 * PUNTUAL de la organización pedida, que pasa siempre por el chokepoint de
 * `orgs/alcance.ts` — nunca por un chequeo de rol suelto.
 */

const crearInvitacionSchema = z.object({
  organizationId: z.string().trim().min(1, 'Falta la organización'),
  expiresAt: z.string().trim().min(1).optional().nullable(),
  maxUses: z.coerce.number().int().min(1, 'El cupo tiene que ser al menos 1').optional().nullable(),
});

/** GET /api/org/invitaciones?organizationId=… — listado, nunca el token. */
export const GET: APIRoute = async ({ url, locals }) => {
  const organizationId = url.searchParams.get('organizationId');
  if (!organizationId) return fail('Falta la organización.', 422);

  const resultado = await requireOrgAdmin(locals, organizationId);
  if (resultado instanceof Response) return resultado;

  const invitaciones = await listarInvitaciones(organizationId);
  return ok({ invitaciones });
};

/** POST /api/org/invitaciones — crea un enlace nuevo; el token en claro sólo viaja UNA vez, acá. */
export const POST: APIRoute = async ({ request, locals }) => {
  const parsed = crearInvitacionSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  const { organizationId, maxUses } = parsed.data;

  let expiresAt: Date | null = null;
  if (parsed.data.expiresAt) {
    expiresAt = new Date(parsed.data.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) return fail('La fecha de vencimiento no es válida.', 422);
    if (expiresAt.getTime() <= Date.now()) return fail('El vencimiento tiene que ser una fecha futura.', 422);
  }

  const resultado = await requireFreshOrgAdmin(locals, organizationId);
  if (resultado instanceof Response) return resultado;

  // Regla de aplicación (T4): una invitación siempre suma a una sede
  // CONCRETA, nunca a una red entera — ni siquiera al admin de la red se le
  // deja invitar "a la red", tiene que elegir una de sus sedes.
  const organizacion = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { kind: true },
  });
  if (!organizacion || organizacion.kind !== 'CAMPUS') {
    return fail('Sólo se puede invitar a una sede puntual.', 422);
  }

  const { url, invitacion } = await crearInvitacion(
    organizationId,
    { expiresAt, maxUses: maxUses ?? null },
    resultado.id,
  );
  return ok({ url, invitacion });
};
