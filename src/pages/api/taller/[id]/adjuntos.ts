import type { APIRoute } from 'astro';
import { prisma } from '../../../../lib/db.ts';
import { fail, ok } from '../../../../lib/http.ts';
import { PDF_MIMES, extractPdfText, maxUploadBytes, storeFile } from '../../../../lib/uploads.ts';
import { buscarSesionPropia } from '../../../../lib/taller/sesiones.ts';

/**
 * Las imágenes que acepta el Taller. SIN SVG a propósito, a diferencia de
 * `/api/uploads`: un SVG puede traer scripts y se sirve desde el mismo origen
 * que la app. Para una foto del pizarrón o una ficha escaneada alcanza con
 * estos cuatro.
 */
const IMAGENES_TALLER: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * POST /api/taller/:id/adjuntos — imágenes o PDFs que el docente suma a la
 * charla del Taller (odd/tasks/taller-de-ideas.md). Mismo formato que
 * `/api/uploads` (multipart con `files`); al crear el recurso se copian como
 * `ProjectAsset`.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user!;

  const sesion = await buscarSesionPropia(params.id!, user.id);
  if (!sesion) return fail('Esa idea no existe o no es tuya.', 404);
  if (sesion.projectId) return fail('Esta idea ya se convirtió en un recurso.', 409);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail('No se pudieron leer los archivos.', 415);
  }

  const files = form.getAll('files').filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) return fail('No mandaste ningún archivo.', 422);
  if (files.length > 10) return fail('Máximo 10 archivos por vez.', 422);

  const limite = maxUploadBytes();
  const creados = [];

  for (const file of files) {
    if (file.size === 0) continue;
    if (file.size > limite) {
      return fail(`"${file.name}" supera el máximo de ${limite / 1024 / 1024} MB.`, 413);
    }

    const esImagen = file.type in IMAGENES_TALLER;
    const esPdf = file.type in PDF_MIMES;
    if (!esImagen && !esPdf) {
      return fail(`"${file.name}" no se puede adjuntar: subí una imagen (PNG, JPG, WEBP, GIF) o un PDF.`, 415);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const guardado = await storeFile('assets', bytes, esImagen ? IMAGENES_TALLER[file.type]! : 'pdf');

    const adjunto = await prisma.ideaAsset.create({
      data: {
        sessionId: sesion.id,
        filename: file.name.slice(0, 200),
        url: guardado.url,
        fileType: esImagen ? 'image' : 'pdf',
        extractedText: esPdf ? await extractPdfText(bytes) : null,
      },
      select: { id: true, filename: true, url: true, fileType: true },
    });

    creados.push(adjunto);
  }

  if (creados.length === 0) return fail('Los archivos estaban vacíos.', 422);

  return ok({ assets: creados });
};
