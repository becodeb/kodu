import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/auth/guards.ts';
import { leerAppSettings } from '../../../lib/settings.ts';
import { parsearRangoQuery, resumenUso } from '../../../lib/admin/uso.ts';

/**
 * GET /api/admin/uso.json?desde=&hasta= — odd/tasks/motor-claude.md (T11):
 * el mismo resumen agregado que llena `/admin/uso`, en dos papeles a la
 * vez: `UsoPanel.tsx` lo consume (vía `apiRequest`, que exige `ok: true`)
 * para refrescarse sin recargar la página entera (mismo patrón que
 * `/api/admin/generacion`), y es TAMBIÉN el export JSON que pide la tarea —
 * `fetch()` ignora `Content-Disposition`, así que servir las dos cosas
 * desde el mismo endpoint no obliga a elegir.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const actor = requireAdmin(locals);
  if (actor instanceof Response) return actor;

  const settings = await leerAppSettings();
  const rango = parsearRangoQuery(url.searchParams, settings.billingCycleDay);
  const resumen = await resumenUso(rango);

  return new Response(JSON.stringify({ ok: true, resumen }, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="kodu-uso-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
};
