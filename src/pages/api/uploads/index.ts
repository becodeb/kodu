import type { APIRoute } from 'astro';
import { prisma } from '../../../lib/db.ts';
import { findOwnedProject } from '../../../lib/projects.ts';
import {
  IMAGE_MIMES,
  PDF_MIMES,
  extractPdfText,
  maxUploadBytes,
  storeFile,
} from '../../../lib/uploads.ts';
import { fail, ok } from '../../../lib/http.ts';

/**
 * POST /api/uploads — adjuntar imágenes o PDFs a un recurso (SPEC §5.1).
 *
 * multipart/form-data con `projectId` y uno o varios `files`.
 * De los PDFs se extrae el texto acá mismo, para que el prompt del chat lo
 * tenga disponible sin re-parsear en cada turno.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail('Se esperaba multipart/form-data.', 415);
  }

  const projectId = String(form.get('projectId') ?? '');
  const project = await findOwnedProject(projectId, user.id);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  const files = form.getAll('files').filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) return fail('No mandaste ningún archivo.', 422);
  if (files.length > 10) return fail('Máximo 10 archivos por vez.', 422);

  const limit = maxUploadBytes();
  const created = [];

  for (const file of files) {
    if (file.size === 0) continue;
    if (file.size > limit) {
      return fail(`"${file.name}" supera el máximo de ${limit / 1024 / 1024} MB.`, 413);
    }

    const isImage = file.type in IMAGE_MIMES;
    const isPdf = file.type in PDF_MIMES;
    if (!isImage && !isPdf) {
      return fail(`Tipo de archivo no permitido: ${file.type || 'desconocido'}.`, 415);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = isImage ? IMAGE_MIMES[file.type]! : 'pdf';
    const stored = await storeFile('assets', bytes, extension);

    const asset = await prisma.projectAsset.create({
      data: {
        projectId: project.id,
        filename: file.name.slice(0, 200),
        url: stored.url,
        fileType: isImage ? 'image' : 'pdf',
        extractedText: isPdf ? await extractPdfText(bytes) : null,
      },
      select: { id: true, filename: true, url: true, fileType: true, extractedText: true },
    });

    created.push({
      ...asset,
      // El texto completo no le sirve al navegador; sólo si hubo extracción.
      extractedText: undefined,
      hasText: Boolean(asset.extractedText),
    });
  }

  if (created.length === 0) return fail('Los archivos estaban vacíos.', 422);

  return ok({ assets: created });
};
