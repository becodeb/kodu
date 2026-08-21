import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';

const createSchema = z.object({
  title: z.string().trim().min(2, 'Poné un título').max(120),
  content: z.string().trim().min(5, 'Escribí la directiva').max(4_000),
  isGlobal: z.boolean().optional(),
});

/**
 * POST /api/rules — crea una regla de contexto (SPEC §3 del README).
 *
 * Las reglas globales (las que se inyectan a TODOS los docentes) sólo las
 * pueden crear los ADMIN; un docente sólo crea reglas propias.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;

  const parsed = createSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }

  const wantsGlobal = parsed.data.isGlobal === true;
  if (wantsGlobal && user.role !== 'ADMIN') {
    return fail('Sólo un administrador puede crear reglas institucionales.', 403);
  }

  const rule = await prisma.customRule.create({
    data: {
      title: parsed.data.title,
      content: parsed.data.content,
      isGlobal: wantsGlobal,
      isActive: true,
      userId: wantsGlobal ? null : user.id,
    },
    select: { id: true, title: true, content: true, isGlobal: true, isActive: true },
  });

  return ok({ rule });
};
