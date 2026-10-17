import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const files: Record<string, { name: string; type: string }> = {
  'modelo-v1.glb': { name: 'demos/assets/cell-3d/modelo-v1.glb', type: 'model/gltf-binary' },
  'visor-v1.js': { name: 'demos/assets/cell-3d/visor-v1.js', type: 'text/javascript; charset=utf-8' },
  'ilustracion-v1.webp': { name: 'demos/assets/celula.webp', type: 'image/webp' },
};

/** Public, read-only assets. Never resolve a filesystem path from user input. */
export async function cellAsset(name: string, production: boolean): Promise<Response | null> {
  const file = Object.hasOwn(files, name) ? files[name] : undefined;
  if (!file) return null;
  const data = await readFile(resolve(production ? 'dist/client' : 'public', file.name));
  return new Response(new Uint8Array(data), { headers: {
    'Content-Type': file.type,
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': production ? 'public, max-age=31536000, immutable' : 'no-cache',
  } });
}
