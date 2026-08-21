import type { APIRoute } from 'astro';
import { contentTypeFor, readStoredFile, resolveStoredPath } from '../../lib/uploads.ts';

/**
 * GET /uploads/* — sirve los archivos subidos en runtime.
 *
 * Es público a propósito: las páginas /p/[slug] embeben estas URLs con <img>.
 * Por eso `resolveStoredPath` es obligatorio — bloquea el path traversal
 * (`/uploads/../../.env` y variantes) antes de tocar el disco.
 */
export const GET: APIRoute = async ({ params }) => {
  const requested = params.path ?? '';
  if (!requested) return new Response('Not found', { status: 404 });

  const absolutePath = resolveStoredPath(requested);
  if (!absolutePath) return new Response('Forbidden', { status: 403 });

  const file = await readStoredFile(absolutePath);
  if (!file) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': contentTypeFor(absolutePath),
      'Content-Length': String(file.byteLength),
      // Los nombres llevan sufijo único: el contenido de una URL nunca cambia.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
