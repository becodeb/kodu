import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../../lib/db.ts';
import { findProjectForActor } from '../../../../lib/projects.ts';
import { decodeDataUrl, storeFile } from '../../../../lib/uploads.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';

const schema = z.object({
  dataUrl: z.string().min(32).max(20_000_000),
});

/**
 * POST /api/projects/:id/screenshot — guarda la captura que tomó el navegador
 * sobre el iframe (SPEC §5.2). El cliente manda un data URL PNG/WebP.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user!;
  const project = await findProjectForActor(params.id!, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail('Captura inválida.', 422);

  const decoded = decodeDataUrl(parsed.data.dataUrl);
  if (!decoded) {
    return fail('La captura debe ser PNG o WebP y no superar el tamaño máximo.', 422);
  }

  const stored = await storeFile('screenshots', decoded.data, decoded.extension);

  await prisma.project.update({
    where: { id: project.id },
    data: { screenshotUrl: stored.url, screenshotAt: new Date() },
  });

  return ok({ screenshotUrl: stored.url });
};

/**
 * DELETE /api/projects/:id/screenshot — descarta la captura.
 *
 * Borrar la portada de un recurso publicado lo dejaria publicado y sin foto,
 * que es exactamente lo que la invariante prohibe (design §3.1). Se
 * despublica en el mismo update, y se avisa: no es un efecto oculto.
 */
export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user!;
  const project = await findProjectForActor(params.id!, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  await prisma.project.update({
    where: { id: project.id },
    data: { screenshotUrl: null, screenshotAt: null, isInGallery: false },
  });

  return ok({ screenshotUrl: null, despublicado: project.isInGallery });
};
