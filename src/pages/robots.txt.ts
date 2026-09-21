import type { APIRoute } from 'astro';
import { getEnv } from '../lib/env.ts';

/**
 * GET /robots.txt — las reglas de rastreo y el puntero al sitemap.
 *
 * Va como endpoint y no como archivo en `public/` porque la línea `Sitemap:`
 * necesita la URL absoluta, y el dominio sale de PUBLIC_SITE_URL: el mismo
 * motivo por el que la og:image de BaseLayout no se arma con `Astro.url`.
 *
 * Lo que se bloquea no es secreto (`/app`, `/admin` y `/api` ya exigen sesión
 * en src/middleware.ts): es para que Googlebot no gaste su presupuesto de
 * rastreo golpeando páginas que sólo le van a devolver un redirect a /login.
 */
export const GET: APIRoute = () => {
  const sitemap = new URL('/sitemap.xml', getEnv().PUBLIC_SITE_URL).href;

  const cuerpo = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /app/',
    'Disallow: /admin/',
    'Disallow: /api/',
    '',
    `Sitemap: ${sitemap}`,
    '',
  ].join('\n');

  return new Response(cuerpo, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};
