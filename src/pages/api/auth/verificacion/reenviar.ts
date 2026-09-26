import type { APIRoute } from 'astro';
import { fail, ok } from '../../../../lib/http.ts';
import { reenviarVerificacion } from '../../../../lib/orgs/verificacion.ts';

/**
 * POST /api/auth/verificacion/reenviar — reenvía el mail de verificación.
 *
 * Bajo "/api/auth/*", así que el middleware NO lo trata como ruta gateada
 * (sólo relee identidad fresca en "/api/projects", "/api/chat", etc — ver
 * `PROTECTED_API_PREFIXES` en middleware.ts): por eso exige sesión acá mismo
 * con lo que ya trae el JWT (`context.locals.user`), igual de válido para
 * identificar de quién es el reenvío.
 *
 * JSON, exento del chequeo de origen cruzado (src/lib/csrf.ts).
 */
export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return fail('Sesión no válida o expirada', 401);

  const resultado = await reenviarVerificacion(user.id);

  if (resultado.ok) {
    return ok({ yaVerificado: resultado.yaVerificado });
  }

  if (resultado.motivo === 'rate_limit') {
    return fail(`Esperá ${resultado.esperarSegundos} segundos antes de pedir otro enlace.`, 429, {
      esperarSegundos: resultado.esperarSegundos,
    });
  }

  if (resultado.motivo === 'sin_cuenta') {
    return fail('Sesión no válida o expirada', 401);
  }

  return fail('No pudimos mandar el correo. Probá de nuevo en un rato.', 502);
};
