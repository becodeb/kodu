import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Astro standalone copia public a dist/client. Sin dependencias de Vite en Node. */
export async function leerCelulaEjemplo(): Promise<string> {
  const directory = process.env.NODE_ENV === 'production' ? 'dist/client' : 'public';
  return readFile(resolve(directory, 'demos/celula-3d.html'), 'utf8');
}
