import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/auth/guards.ts';
import { leerAppSettings } from '../../../lib/settings.ts';
import { parsearRangoQuery, resumenUso, filasCsvDeUso } from '../../../lib/admin/uso.ts';

/**
 * GET /api/admin/uso.csv?desde=&hasta= — odd/tasks/motor-claude.md (T11):
 * mismo resumen que `/api/admin/uso.json`, en CSV (varias mini-tablas, ver
 * el comentario de `filasCsvDeUso`) — mismo patrón que
 * `/api/admin/trazas.csv`/`/api/admin/metricas.csv`.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const actor = requireAdmin(locals);
  if (actor instanceof Response) return actor;

  const settings = await leerAppSettings();
  const rango = parsearRangoQuery(url.searchParams, settings.billingCycleDay);
  const resumen = await resumenUso(rango);
  const csv = `${filasCsvDeUso(resumen).join('\r\n')}\r\n`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kodu-uso-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
};
