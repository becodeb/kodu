import type { APIRoute } from 'astro';
import { prisma } from '../lib/db.ts';
import { getEnv } from '../lib/env.ts';

/**
 * GET /sitemap.xml — el mapa del sitio para los buscadores.
 *
 * Se arma en cada pedido y no con `@astrojs/sitemap` porque esa integración
 * recorre las rutas en tiempo de build, y acá el sitio corre en SSR: la fecha
 * de la galería depende de lo que los docentes hayan publicado, que cambia
 * sin que nadie vuelva a compilar nada.
 *
 * Los recursos publicados (`/p/[slug]`) NO entran a propósito. La galería los
 * linkea, así que un buscador igual llega siguiendo los enlaces; la decisión
 * es no empujar activamente el nombre de un docente y su material a las
 * búsquedas, que es distinto de que sean visibles para quien entra a la
 * galería.
 */

interface Entrada {
  ruta: string;
  lastmod?: Date;
  /** Sugerencia de frecuencia de recrawl. No es una orden, es una pista. */
  changefreq: 'daily' | 'weekly' | 'monthly';
  priority: string;
}

function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = async () => {
  const base = getEnv().PUBLIC_SITE_URL;

  // La galería cambia cuando se publica o se edita un recurso. Darle a Google
  // esa fecha real evita que la recorra todos los días al pedo, y a la vez que
  // se quede con una versión vieja durante semanas.
  const ultimoPublicado = await prisma.project
    .findFirst({
      where: { isInGallery: true },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    })
    .catch(() => null);

  const entradas: Entrada[] = [
    { ruta: '/', changefreq: 'weekly', priority: '1.0' },
    {
      ruta: '/gallery',
      lastmod: ultimoPublicado?.updatedAt,
      changefreq: 'daily',
      priority: '0.8',
    },
    { ruta: '/login', changefreq: 'monthly', priority: '0.3' },
  ];

  const urls = entradas
    .map((entrada) => {
      const loc = escaparXml(new URL(entrada.ruta, base).href);
      const lastmod = entrada.lastmod
        ? `\n    <lastmod>${entrada.lastmod.toISOString().slice(0, 10)}</lastmod>`
        : '';
      return `  <url>
    <loc>${loc}</loc>${lastmod}
    <changefreq>${entrada.changefreq}</changefreq>
    <priority>${entrada.priority}</priority>
  </url>`;
    })
    .join('\n');

  const cuerpo = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(cuerpo, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
