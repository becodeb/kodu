import type { APIRoute } from 'astro';
import { ok } from '../../../lib/http.ts';
import { resumenGeneracion } from '../../../lib/admin/generacion.ts';

/**
 * GET /api/admin/generacion — T7 (motor-claude): la caja viva de
 * `/admin/generacion` ("Gastado este ciclo…") necesita poder refrescarse sin
 * recargar la página entera (el gasto cambia con cada turno real de los
 * docentes, no sólo cuando el admin guarda algo acá). `PATCH
 * /api/admin/settings` sigue siendo la única escritura — este endpoint es
 * sólo lectura, mismo resumen que ya calcula `/admin/generacion.astro` en el
 * primer render.
 */
export const GET: APIRoute = async () => {
  return ok({ resumen: await resumenGeneracion() });
};
