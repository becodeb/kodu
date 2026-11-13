import type { APIRoute } from 'astro';
import { espejarCdn } from '../../../lib/cdn-proxy.ts';

/** GET /cdn/:host/* — espejo de los CDN de scripts (ver src/lib/cdn-proxy.ts). */
export const GET: APIRoute = async ({ params, url }) =>
  (await espejarCdn(params.host ?? '', `/${params.path ?? ''}${url.search}`))
  ?? new Response('Not found', { status: 404 });
