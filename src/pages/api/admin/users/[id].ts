import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../../lib/db.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { accesoIaDeUsuario } from '../../../../lib/admin/usuarios.ts';

/**
 * PATCH /api/admin/users/:id — cambia el rol y/o el permiso individual de
 * acceso a la IA de un docente (design.md — "The users table"; §10;
 * specs/ai-access-control/spec.md — "Per-user override precedence").
 *
 * La autenticación y la frescura de la identidad ya las exige el middleware
 * (`requireFreshAdmin` en toda mutación de `/api/admin`, ver
 * `src/middleware.ts`); acá sólo queda la lógica de negocio.
 *
 * `aiAccessOverride: null` es un valor explícito ("volver a la regla del
 * dominio"), no "no lo toques" — por eso el campo es `.nullable().optional()`
 * y no simplemente opcional: hace falta distinguir "no vino en el body" de
 * "vino, y es null".
 */

const actualizarUsuarioSchema = z.object({
  role: z.enum(['DOCENTE', 'ADMIN']).optional(),
  aiAccessOverride: z.boolean().nullable().optional(),
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

  // La cuenta de demo no es promovible (design.md §8): es una cuenta
  // sintética compartida, sin dueño humano — un admin con esas credenciales
  // no tiene sentido y `/admin/usuarios` ni siquiera la lista (ver
  // `listarUsuariosAdmin`), así que esto sólo defiende contra pegarle el
  // PATCH directo con su id.
  if (existente.isDemo && datos.role === 'ADMIN') {
    return fail('La cuenta de demo no puede ser administradora.', 409);
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
    // `undefined` no toca la columna (Prisma estándar); `null` explícito SÍ
    // la pisa — es justo la distinción que necesita "volver a la regla del
    // dominio" (ver el comentario de arriba).
    data: { role: datos.role, aiAccessOverride: datos.aiAccessOverride },
    select: { id: true, email: true, role: true, aiAccessOverride: true },
  });

  // Se devuelve el texto ya calculado (no sólo el booleano crudo) para que
  // la tabla no tenga que reimplementar la regla de dominio del lado del
  // cliente ni pedir otra vuelta sólo para refrescar la columna.
  const accesoIa = await accesoIaDeUsuario(actualizado.email, actualizado.aiAccessOverride);

  return ok({
    usuario: {
      id: actualizado.id,
      role: actualizado.role,
      aiAccessOverride: actualizado.aiAccessOverride,
      accesoIa,
    },
  });
};
