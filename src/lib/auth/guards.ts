import type { SessionUser } from './session.ts';
import { fail } from '../http.ts';

/**
 * Guardas compartidas por las páginas de /admin y las rutas de /api/admin.
 *
 * Devuelven una Response armada con fail() en vez de tirar una excepción,
 * para quedarse en la misma convención que ya usa cada endpoint del repo.
 * El llamador chequea `resultado instanceof Response`.
 */

export function requireUser(locals: App.Locals): SessionUser | Response {
  if (!locals.user) {
    return fail('Sesión no válida o expirada', 401);
  }
  return locals.user;
}

export function requireAdmin(locals: App.Locals): SessionUser | Response {
  const resultado = requireUser(locals);
  if (resultado instanceof Response) return resultado;

  if (resultado.role !== 'ADMIN') {
    return fail('No tenés permisos de administrador.', 403);
  }
  return resultado;
}

/**
 * Además de exigir rol ADMIN, exige que la identidad se haya confirmado
 * contra la base en este mismo request. Pensada para las rutas de
 * /api/admin que escriben: un rol viejo de un JWT degradado puede alcanzar
 * para leer, nunca para mutar.
 */
export function requireFreshAdmin(locals: App.Locals): SessionUser | Response {
  const resultado = requireAdmin(locals);
  if (resultado instanceof Response) return resultado;

  if (!locals.identityFresh) {
    return fail('No pudimos confirmar tus permisos. Probá de nuevo en unos segundos.', 503);
  }
  return resultado;
}
