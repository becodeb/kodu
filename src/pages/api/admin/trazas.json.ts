import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/auth/guards.ts';
import { filasExportTrazas, parsearFiltroQuery } from '../../../lib/admin/trazas.ts';

/** GET /api/admin/trazas.json?desde=&hasta=&plan=&model() —
 *  odd/tasks/ahorro-tokens.md (T4): mismo filtro que el CSV hermano, formato
 *  JSON para quien prefiera procesarlo en vez de abrirlo en una planilla. */
export const GET: APIRoute = async ({ url, locals }) => {
  const actor = requireAdmin(locals);
  if (actor instanceof Response) return actor;

  const filtro = parsearFiltroQuery(url.searchParams);
  const filas = await filasExportTrazas(filtro);

  return new Response(JSON.stringify(filas, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="kodu-trazas-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
};
