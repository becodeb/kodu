import type { APIRoute } from 'astro';
import { ok } from '../../../lib/http.ts';
import { requireUser } from '../../../lib/auth/guards.ts';
import { campusesAdministrables } from '../../../lib/orgs/alcance.ts';

/**
 * GET /api/org/sedes (odd/tasks/organizaciones.md T8) — las sedes (CAMPUS,
 * no archivadas) que el actor administra, para el picker de "Mover a otra
 * sede" de `<MiembrosLista>` en `/org`. Para un admin de UNA sola CAMPUS esto
 * devuelve sólo esa sede (el cliente la filtra, ver `cargarDestinos` en
 * `PanelOrganizacion.tsx`); para un admin de RED, todas las sedes de su red
 * (`alcance.ts` ya resuelve esa herencia) — nunca hace falta un
 * `organizationId` de query: `campusesAdministrables` sólo mira al actor.
 */
export const GET: APIRoute = async ({ locals }) => {
  const actor = requireUser(locals);
  if (actor instanceof Response) return actor;

  const sedes = await campusesAdministrables(actor);
  return ok({ sedes });
};
