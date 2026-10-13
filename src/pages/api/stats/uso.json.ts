import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { getEnv } from '../../../lib/env.ts';
import { leerAppSettings } from '../../../lib/settings.ts';
import { parsearRangoQuery, resumenUso } from '../../../lib/admin/uso.ts';

/**
 * GET /api/stats/uso.json?desde=&hasta= — odd/tasks/motor-claude.md (T11):
 * el ÚNICO acceso de sólo lectura a las estadísticas de uso que NO pasa por
 * una sesión de admin — pensado para el dueño, desde afuera de la app
 * (un script propio, un dashboard). Fuera del middleware de sesión a
 * propósito (`/api/stats` no está en `PROTECTED_API_PREFIXES`, mismo
 * criterio que `/api/internal/recordatorios-renovacion`), gateado por un
 * secreto compartido en el header `Authorization: Bearer <token>` en vez de
 * un rol.
 *
 * Fail-closed por diseño: sin `STATS_API_TOKEN` configurado, o uno más
 * corto de 32 caracteres (demasiado débil para un secreto de acceso), el
 * endpoint devuelve 404 — ni siquiera confirma que existe (a diferencia de
 * `recordatorios-renovacion`, que devuelve 503/401: ESTE endpoint expone
 * datos, aunque sean agregados y sin PII, así que un atacante no gana nada
 * sabiendo "está pero mal configurado"). Un header ausente o un token que no
 * coincide (comparación en tiempo constante) dan el MISMO 404 — nunca un 401
 * que confirme que el secreto existe y sólo está mal.
 *
 * Mismo agregado que `/api/admin/uso.json` — nunca texto de pedidos, nunca
 * emails/nombres (sólo pseudónimos los exports que los llevan; este
 * endpoint ni eso: todo lo que devuelve son números agregados).
 */
function tokenCoincide(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  // timingSafeEqual exige el MISMO largo — comparar los largos primero sólo
  // filtra "cuánto mide el token recibido", nunca su contenido, y es
  // inevitable: no hay forma de comparar en tiempo constante dos buffers de
  // largo distinto.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const GET: APIRoute = async ({ request, url }) => {
  const env = getEnv();
  if (!env.STATS_API_TOKEN || env.STATS_API_TOKEN.length < 32) {
    return new Response(null, { status: 404 });
  }

  const header = request.headers.get('authorization') ?? '';
  const recibido = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!recibido || !tokenCoincide(recibido, env.STATS_API_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  const settings = await leerAppSettings();
  const rango = parsearRangoQuery(url.searchParams, settings.billingCycleDay);
  const resumen = await resumenUso(rango);

  return new Response(JSON.stringify({ ok: true, resumen }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
