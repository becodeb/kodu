import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../lib/http.ts';
import { prisma } from '../../../lib/db.ts';
import { organizacionParaEmail } from '../../../lib/orgs/resolucion.ts';

const elegirSedeSchema = z.object({
  organizationId: z.string().trim().min(1, 'Falta la sede'),
});

/**
 * POST /api/org/elegir-sede (odd/tasks/organizaciones.md T4, decisión del
 * dueño — "Red con dominio compartido": quien entra por un dominio de la red
 * elige su sede la primera vez).
 *
 * El middleware ya exige sesión en "/api/org/*"; acá se revalida TODO contra
 * la base (nunca contra lo que mande el cliente): que el email siga
 * resolviendo a una red con sedes para elegir, que la sede pedida sea
 * REALMENTE una de esa red (nunca de otra), y que la cuenta siga sin
 * organización — mismo criterio de "no confiar en el cliente" que
 * `aceptarInvitacion`.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return fail('Sesión no válida o expirada', 401);

  const parsed = elegirSedeSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const fila = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, organizationId: true, isDemo: true },
  });
  if (!fila) return fail('Sesión no válida o expirada', 401);
  if (fila.isDemo) return fail('La cuenta de demo no puede elegir una sede.', 403);
  if (fila.organizationId !== null) return fail('Tu cuenta ya pertenece a una organización.', 409);

  const resolucion = await organizacionParaEmail(fila.email);
  if (!resolucion || !('red' in resolucion)) {
    return fail('Tu email no corresponde a ninguna red con sedes para elegir.', 422);
  }

  const sedeValida = resolucion.sedes.some((sede) => sede.id === parsed.data.organizationId);
  if (!sedeValida) return fail('Esa sede no pertenece a tu red.', 422);

  // updateMany con el guard `organizationId: null` (no `update`): si se coló
  // otra membresía entre el chequeo de arriba y acá (carrera de dos pestañas),
  // esto no pisa nada — simplemente no afecta ninguna fila.
  const actualizado = await prisma.user.updateMany({
    where: { id: user.id, organizationId: null },
    data: { organizationId: parsed.data.organizationId },
  });
  if (actualizado.count === 0) return fail('Tu cuenta ya pertenece a una organización.', 409);

  return ok({ organizationId: parsed.data.organizationId });
};
