import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../lib/http.ts';
import { chequearAccesoTaller, crearSesion } from '../../../lib/taller/sesiones.ts';

const schema = z.object({
  mode: z.enum(['TOPIC', 'IDEA'], { message: 'Elegí por dónde querés empezar.' }),
});

/**
 * POST /api/taller — abre una charla nueva del Taller de ideas
 * (odd/tasks/taller-de-ideas.md) por una de sus dos puertas. La primera
 * pregunta es fija y ya viene guardada: no se gasta IA hasta que el docente
 * contesta.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;

  const sinAcceso = await chequearAccesoTaller(user);
  if (sinAcceso) return sinAcceso;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const sesion = await crearSesion(user.id, parsed.data.mode);
  return ok({ id: sesion.id, redirect: `/app/taller/${sesion.id}` });
};
