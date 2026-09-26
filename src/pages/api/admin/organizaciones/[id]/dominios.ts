import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../../lib/http.ts';
import { requireUser } from '../../../../../lib/auth/guards.ts';
import { agregarDominio, listarDominios, GestionError } from '../../../../../lib/orgs/gestion.ts';

/** `/api/admin/organizaciones/:id/dominios` — lista y alta (odd/tasks/organizaciones.md T6). */

const crearDominioSchema = z.object({
  pattern: z.string().trim().min(1, 'Falta el dominio').max(200),
  note: z.string().trim().max(300).nullable().optional(),
});

export const GET: APIRoute = async ({ params, locals }) => {
  const actor = requireUser(locals);
  if (actor instanceof Response) return actor;

  try {
    const dominios = await listarDominios(actor, params.id!);
    return ok({ dominios });
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const actor = requireUser(locals);
  if (actor instanceof Response) return actor;

  const parsed = crearDominioSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  try {
    const dominio = await agregarDominio(actor, params.id!, parsed.data);
    return ok({ dominio });
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};
