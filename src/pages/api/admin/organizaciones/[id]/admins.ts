import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../../lib/http.ts';
import { requireUser } from '../../../../../lib/auth/guards.ts';
import { promoverAdmin, GestionError } from '../../../../../lib/orgs/gestion.ts';

/** `POST /api/admin/organizaciones/:id/admins` — promueve a un docente de la organización (odd/tasks/organizaciones.md T6). */

const promoverSchema = z.object({
  userId: z.string().trim().min(1, 'Falta el docente'),
});

export const POST: APIRoute = async ({ params, request, locals }) => {
  const actor = requireUser(locals);
  if (actor instanceof Response) return actor;

  const parsed = promoverSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  try {
    await promoverAdmin(actor, params.id!, parsed.data.userId);
    return ok({});
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};
