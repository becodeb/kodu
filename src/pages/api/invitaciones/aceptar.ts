import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../lib/http.ts';
import { aceptarInvitacion } from '../../../lib/orgs/invitaciones.ts';

const aceptarSchema = z.object({ token: z.string().trim().min(1, 'Falta el token') });

/** El mismo mensaje genérico de la página pública (T4) — nunca se distingue el motivo acá tampoco. */
const MENSAJE_GENERICO = 'Este enlace ya no sirve, pedile uno nuevo a tu colegio.';

/**
 * POST /api/invitaciones/aceptar (odd/tasks/organizaciones.md T4).
 *
 * Bajo "/api/invitaciones", NO "/api/org": el middleware no lo trata como
 * ruta gateada (mismo criterio que `/api/auth/verificacion/reenviar` — ver
 * `PROTECTED_API_PREFIXES` en middleware.ts), así que exige sesión acá mismo
 * con lo que ya trae el JWT — alcanza para saber DE QUIÉN es el pedido de
 * unirse, que es todo lo que hace falta.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return fail('Sesión no válida o expirada', 401);

  const parsed = aceptarSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const resultado = await aceptarInvitacion(parsed.data.token, user.id);
  if (resultado.ok) return ok({});

  if (resultado.motivo === 'demo') {
    return fail('La cuenta de demo no puede aceptar invitaciones.', 403, { motivo: resultado.motivo });
  }
  if (resultado.motivo === 'ya_en_esa_sede') {
    return fail('Ya sos parte de esta sede.', 409, { motivo: resultado.motivo });
  }
  if (resultado.motivo === 'ya_en_otra_organizacion') {
    return fail(
      `Tu cuenta ya pertenece a ${resultado.organizacion}. Su administrador te tiene que sacar antes de que puedas sumarte a otra.`,
      409,
      { motivo: resultado.motivo, organizacion: resultado.organizacion },
    );
  }
  return fail(MENSAJE_GENERICO, 410, { motivo: resultado.motivo });
};
