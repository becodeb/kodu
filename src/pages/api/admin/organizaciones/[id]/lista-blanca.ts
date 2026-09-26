import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../../lib/http.ts';
import { requireUser } from '../../../../../lib/auth/guards.ts';
import { agregarEmailListaBlanca, listarListaBlanca, GestionError } from '../../../../../lib/orgs/gestion.ts';

/**
 * `/api/admin/organizaciones/:id/lista-blanca` — lista y alta (odd/tasks/organizaciones.md T6).
 * Agregar un email une de inmediato a la cuenta personal que ya lo tenga
 * verificado (ver `agregarEmailListaBlanca` en gestion.ts).
 */

const crearEmailSchema = z.object({
  email: z.string().trim().min(1, 'Falta el email').max(300),
});

export const GET: APIRoute = async ({ params, locals }) => {
  const actor = requireUser(locals);
  if (actor instanceof Response) return actor;

  try {
    const lista = await listarListaBlanca(actor, params.id!);
    return ok({ lista });
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const actor = requireUser(locals);
  if (actor instanceof Response) return actor;

  const parsed = crearEmailSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  try {
    const item = await agregarEmailListaBlanca(actor, params.id!, parsed.data.email);
    return ok({ item });
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};
