import type { AstroIntegration } from 'astro';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { cellAsset } from '../../src/lib/cell-assets.ts';

/** Astro's dev guard rejects opaque editor frames before API routes run.
 * Serve only the same closed list of public assets before that guard.
 * All other URLs, including Vite source files and Kodu APIs, retain the guard.
 */
export function cellAssetsDev(): AstroIntegration {
  let install = () => {};
  return { name: 'kodu-cell-public-assets', hooks: {
    'astro:server:setup': ({ server }) => {
      install = () => server.middlewares.stack.unshift({ route: '', handle: async (req:IncomingMessage, res:ServerResponse, next:(error?:unknown)=>void) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (!['GET','HEAD'].includes(req.method ?? '') || !pathname.startsWith('/recursos/celula/')) return next();
        try {
          const response = await cellAsset(pathname.slice('/recursos/celula/'.length), false);
          if (!response) return next();
          res.statusCode = response.status;
          response.headers.forEach((value, name) => res.setHeader(name, value));
          res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
        } catch (error) { next(error); }
      } });
    },
    'astro:server:start': () => { install(); },
  } };
}
