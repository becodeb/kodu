import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../../lib/db.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { createProject } from '../../../../lib/projects.ts';
import { MAX_LARGO_PEDIDO, leerFichaGuardada, nombreDeLaIdea } from '../../../../lib/taller/ficha.ts';
import { buscarSesionPropia, chequearAccesoTaller, hayTurnoEnCurso } from '../../../../lib/taller/sesiones.ts';

const schema = z.object({
  /** El pedido tal como está en pantalla: puede traer una edición a mano que
   *  todavía no se guardó (el PATCH va con demora). */
  finalPrompt: z.string().trim().min(1).max(MAX_LARGO_PEDIDO).optional(),
});

/**
 * POST /api/taller/:id/crear — "Crear mi recurso" (odd/tasks/taller-de-ideas.md).
 *
 * Crea el recurso con el título y la descripción que salieron de la charla,
 * le pasa los adjuntos del Taller, y deja la charla vinculada (y de sólo
 * lectura). El pedido NO se manda desde acá: lo manda el editor al abrirse
 * (`pedidoInicial` en `app/project/[id].astro`), así el docente ve la
 * generación en vivo como en cualquier otro recurso.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user!;

  const sinAcceso = await chequearAccesoTaller(user);
  if (sinAcceso) return sinAcceso;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const sesion = await buscarSesionPropia(params.id!, user.id);
  if (!sesion) return fail('Esa idea no existe o no es tuya.', 404);
  if (sesion.projectId) {
    return ok({ redirect: `/app/project/${sesion.projectId}` });
  }
  if (hayTurnoEnCurso(sesion.id)) return fail('Esperá a que termine la respuesta de Kodu.', 409);

  const pedido = parsed.data.finalPrompt ?? sesion.finalPrompt;
  if (!pedido) return fail('Todavía no hay un pedido armado. Seguí la charla un poco más.', 409);

  const ficha = leerFichaGuardada(sesion.brief);
  const titulo = nombreDeLaIdea(sesion.title, ficha).slice(0, 120);
  const descripcion = (sesion.description ?? ficha.idea ?? '').slice(0, 400) || null;

  const proyecto = await createProject({
    userId: user.id,
    title: titulo,
    description: descripcion,
    createdByDemo: user.isDemo,
  });

  const adjuntos = await prisma.ideaAsset.findMany({ where: { sessionId: sesion.id }, orderBy: { createdAt: 'asc' } });

  // Vincular con `projectId: null` en el filtro: si dos clics llegaron a la
  // vez, sólo uno se queda con la charla. El otro borra su recurso de más y
  // manda al que ganó.
  const vinculada = await prisma.ideaSession.updateMany({
    where: { id: sesion.id, projectId: null },
    data: { projectId: proyecto.id, finalPrompt: pedido },
  });

  if (vinculada.count === 0) {
    await prisma.project.delete({ where: { id: proyecto.id } });
    const ganadora = await prisma.ideaSession.findUnique({ where: { id: sesion.id }, select: { projectId: true } });
    return ok({ redirect: ganadora?.projectId ? `/app/project/${ganadora.projectId}` : '/app/taller' });
  }

  if (adjuntos.length > 0) {
    await prisma.projectAsset.createMany({
      data: adjuntos.map((adjunto) => ({
        projectId: proyecto.id,
        filename: adjunto.filename,
        url: adjunto.url,
        fileType: adjunto.fileType,
        extractedText: adjunto.extractedText,
      })),
    });
  }

  return ok({ projectId: proyecto.id, redirect: `/app/project/${proyecto.id}` });
};
