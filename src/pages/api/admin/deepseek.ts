import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';

/**
 * POST /api/admin/deepseek — habilita o deshabilita DeepSeek para un docente.
 *
 * DeepSeek es el motor que se paga por token, así que no se ofrece por defecto:
 * un admin lo habilita caso por caso. El middleware ya exige sesión en
 * `/api/admin/**`; acá se agrega el chequeo de rol, que es el que importa.
 */

const schema = z.object({
  userId: z.string().min(1),
  enabled: z.boolean(),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;
  if (user.role !== 'ADMIN') return fail('No tenés permiso para esto.', 403);

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail('Datos inválidos', 422);

  const objetivo = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true },
  });
  if (!objetivo) return fail('El docente no existe.', 404);

  const actualizado = await prisma.user.update({
    where: { id: objetivo.id },
    data: { deepseekEnabled: parsed.data.enabled },
    select: { id: true, deepseekEnabled: true },
  });

  return ok({ userId: actualizado.id, enabled: actualizado.deepseekEnabled });
};
