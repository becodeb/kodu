import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db.ts';

/**
 * GET /p/:slug — vista pública del recurso (SPEC §5.4).
 *
 * Sirve el HTML guardado tal cual, sin barras ni paneles: está pensado para
 * proyector o para el dispositivo del alumno. El enlace es permanente y no
 * depende de que el recurso esté publicado en la galería: la galería es sólo el
 * listado, el link se comparte igual.
 *
 * ── Por qué la CSP ──
 * Este HTML lo generó una IA a pedido de un docente y se sirve desde NUESTRO
 * origen, así que sin restricciones podría hacer `fetch('/api/...')` con la
 * cookie de sesión de quien lo esté mirando. La CSP corta eso: permite los CDN
 * didácticos y bloquea cualquier conexión o envío de formulario hacia la app.
 */

const ALLOWED_CDNS = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

const CSP = [
  `default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ${ALLOWED_CDNS.join(' ')}`,
  `img-src 'self' data: blob: https:`,
  // Sin 'self': el recurso no puede llamar a la API de KoduEdu.
  `connect-src ${ALLOWED_CDNS.join(' ')}`,
  `form-action 'none'`,
  `base-uri 'none'`,
].join('; ');

export const GET: APIRoute = async ({ params }) => {
  const project = await prisma.project.findUnique({
    where: { slug: params.slug! },
    select: { currentHtml: true },
  });

  if (!project) {
    return new Response(
      '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Recurso no encontrado</title></head><body style="font-family:system-ui;padding:3rem;text-align:center"><h1>Este recurso no existe</h1><p>Puede que lo hayan borrado o que el enlace esté mal escrito.</p></body></html>',
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  return new Response(project.currentHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'public, max-age=60',
    },
  });
};
