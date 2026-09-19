import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../../lib/db.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';

/**
 * PATCH /api/admin/users/:id — cambia el rol de un docente (design.md —
 * "The users table"; specs/admin-users/spec.md — "Per-row overflow menu").
 *
 * La autenticación y la frescura de la identidad ya las exige el middleware
 * (`requireFreshAdmin` en toda mutación de `/api/admin`, ver
 * `src/middleware.ts`); acá sólo queda la lógica de negocio.
 *
 * **`aiAccessOverride` queda AFUERA de este endpoint a propósito.** Esa
 * columna todavía no existe — `src/lib/auth/session.ts` y
 * `src/middleware.ts` ya documentan que llega con la migración de M6 — y
 * aceptar el campo sin escribirlo en ningún lado sería peor que no
 * aceptarlo: un admin creería que guardó un permiso que en realidad nunca
 * se persistió. Ver `src/lib/admin/usuarios.ts` para la nota completa.
 */

const actualizarUsuarioSchema = z.object({
  role: z.enum(['DOCENTE', 'ADMIN']).optional(),
});

export const PATCH: APIRoute = async ({ params, request }) => {
  const existente = await prisma.user.findUnique({ where: { id: params.id! } });
  if (!existente) return fail('Ese usuario no existe.', 404);

  const parsed = actualizarUsuarioSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }
  const datos = parsed.data;

  if (Object.keys(datos).length === 0) {
    return fail('No hay nada para actualizar.', 422);
  }

  // Bajar al único admin que queda está prohibido: primero hay que nombrar
  // a otro (specs/admin-users/spec.md — el mensaje es literal del spec).
  if (datos.role === 'DOCENTE' && existente.role === 'ADMIN') {
    const totalAdmins = await prisma.user.count({ where: { role: 'ADMIN' } });
    if (totalAdmins <= 1) {
      return fail('Sos el único administrador. Nombrá a otro antes de sacarte el rol.', 409);
    }
  }

  const actualizado = await prisma.user.update({
    where: { id: existente.id },
    data: { role: datos.role },
    select: { id: true, role: true },
  });

  return ok({ usuario: actualizado });
};
