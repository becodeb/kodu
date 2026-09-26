import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { requireUser } from '../../../../lib/auth/guards.ts';
import { crearOrganizacion, listarOrganizacionesSuperadmin, GestionError } from '../../../../lib/orgs/gestion.ts';

/**
 * `/api/admin/organizaciones` — árbol completo (redes con sus sedes +
 * colegios standalone) y alta de organización (odd/tasks/organizaciones.md T6).
 *
 * La autenticación, el rol ADMIN y la frescura de la identidad en la
 * mutación ya los exige el middleware (`requireAdmin`/`requireFreshAdmin` en
 * todo `/api/admin/*`, ver `src/middleware.ts`); `gestion.ts` vuelve a
 * confirmar "es superadmin" por su cuenta porque las MISMAS funciones las
 * reusa T8 desde `/api/org/*`, donde el middleware NO exige rol ADMIN.
 */

const crearOrganizacionSchema = z.object({
  name: z.string().trim().min(1, 'Falta el nombre').max(200),
  kind: z.enum(['CAMPUS', 'NETWORK']),
  parentId: z.string().trim().min(1).optional().nullable(),
});

export const GET: APIRoute = async ({ locals }) => {
  const actor = requireUser(locals);
  if (actor instanceof Response) return actor;

  try {
    const arbol = await listarOrganizacionesSuperadmin(actor);
    return ok(arbol);
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const actor = requireUser(locals);
  if (actor instanceof Response) return actor;

  const parsed = crearOrganizacionSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  try {
    const organizacion = await crearOrganizacion(actor, parsed.data);
    return ok({ organizacion });
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};
