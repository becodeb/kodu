import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';
import type { SessionUser } from '../../../lib/auth/session.ts';

const updateSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  content: z.string().trim().min(5).max(4_000).optional(),
  isActive: z.boolean().optional(),
});

/**
 * Una regla se puede tocar si es propia, o si es global y quien la toca es ADMIN.
 */
async function findEditableRule(ruleId: string, user: SessionUser) {
  const rule = await prisma.customRule.findUnique({ where: { id: ruleId } });
  if (!rule) return null;

  if (rule.isGlobal) return user.role === 'ADMIN' ? rule : null;
  return rule.userId === user.id ? rule : null;
}

/** PATCH /api/rules/:id — editar el texto o prender/apagar la regla. */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user!;

  const rule = await findEditableRule(params.id!, user);
  if (!rule) return fail('La regla no existe o no la podés editar.', 404);

  const parsed = updateSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }
  if (Object.keys(parsed.data).length === 0) {
    return fail('No hay nada para actualizar.', 422);
  }

  const updated = await prisma.customRule.update({
    where: { id: rule.id },
    data: parsed.data,
    select: { id: true, title: true, content: true, isGlobal: true, isActive: true },
  });

  return ok({ rule: updated });
};

/** DELETE /api/rules/:id */
export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user!;

  const rule = await findEditableRule(params.id!, user);
  if (!rule) return fail('La regla no existe o no la podés borrar.', 404);

  await prisma.customRule.delete({ where: { id: rule.id } });

  return ok({ deleted: rule.id });
};
