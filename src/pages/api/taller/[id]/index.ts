import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../../lib/db.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { MAX_LARGO_PEDIDO } from '../../../../lib/taller/ficha.ts';
import { buscarSesionPropia, hayTurnoEnCurso, sesionParaCliente } from '../../../../lib/taller/sesiones.ts';

/**
 * GET /api/taller/:id — la charla entera, y si hay un turno de la IA
 * corriendo ahora mismo. Lo usa la isla cuando se recargó la página con una
 * respuesta todavía en camino.
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user!;
  const sesion = await sesionParaCliente(params.id!, user.id);
  if (!sesion) return fail('Esa idea no existe o no es tuya.', 404);

  return ok({ session: sesion, enCurso: hayTurnoEnCurso(sesion.id) });
};

const patchSchema = z.object({
  finalPrompt: z
    .string()
    .trim()
    .min(1, 'El pedido no puede quedar vacío.')
    .max(MAX_LARGO_PEDIDO, 'El pedido es demasiado largo.'),
});

/**
 * PATCH /api/taller/:id — el docente editó el pedido final a mano. Queda
 * marcado para que el próximo turno se lo avise a la IA (ver
 * `finalPromptEditedByTeacher`).
 */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user!;
  const sesion = await buscarSesionPropia(params.id!, user.id);
  if (!sesion) return fail('Esa idea no existe o no es tuya.', 404);
  if (sesion.projectId) return fail('Esta idea ya se convirtió en un recurso.', 409);

  const parsed = patchSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  await prisma.ideaSession.update({
    where: { id: sesion.id },
    data: { finalPrompt: parsed.data.finalPrompt, finalPromptEditedByTeacher: true },
  });

  return ok();
};

/**
 * DELETE /api/taller/:id — borra la charla de "Mis ideas". Si ya dio un
 * recurso, el recurso sigue intacto: sólo se pierde el link "Ver cómo
 * pensamos esta idea".
 */
export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user!;
  const sesion = await buscarSesionPropia(params.id!, user.id);
  if (!sesion) return fail('Esa idea no existe o no es tuya.', 404);
  if (hayTurnoEnCurso(sesion.id)) return fail('Esperá a que Kodu termine de contestar.', 409);

  await prisma.ideaSession.delete({ where: { id: sesion.id } });
  return ok();
};
