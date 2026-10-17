import type { APIRoute } from 'astro';
import { cellAsset } from '../../../lib/cell-assets.ts';

export const GET: APIRoute = async ({ params }) =>
  await cellAsset(params.file ?? '', process.env.NODE_ENV === 'production')
  ?? new Response('Not found', { status: 404 });
