// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { realpathSync } from 'node:fs';

// odd/tasks/planes-y-cobros.md (T5): algunos worktrees de este repo tienen
// `node_modules` como SYMLINK a otra carpeta (para no duplicar la instalación
// en cada worktree). El dev server de Vite sirve sus propios módulos (p.ej.
// `@astrojs/react/dist/client.js`, necesario para hidratar cualquier isla
// `client:load`) sólo desde el "root" del proyecto — con el symlink, el
// destino REAL queda afuera de ese root y Vite lo rechaza con 403, lo que
// rompe la hidratación de TODA isla React en ese worktree (se descubrió
// probando el formulario de `/instituciones/alta`, pero no es específico de
// esta tarea). Resolver el símlink y agregar su destino real a
// `server.fs.allow` arregla esto sin tocar nada en un checkout normal (ahí
// `realpathSync` da la misma carpeta que ya está permitida — Vite deduplica).
const projectRoot = dirname(fileURLToPath(import.meta.url));
const realNodeModules = realpathSync(resolve(projectRoot, 'node_modules'));

// KoduEdu corre siempre en modo SSR (output: 'server'): necesitamos sesiones por
// cookie, proxy hacia DeepSeek y render dinamico de /p/[slug].
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),

  // host: true => escucha en 0.0.0.0. Imprescindible adentro de Docker, si no el
  // mapeo de puertos 3000:3000 no sirve nada.
  server: {
    host: true,
    port: Number(process.env.PORT ?? 3000),
  },

  // El chequeo de origen lo hace src/lib/csrf.ts: el integrado compara contra
  // el protocolo del socket y detras de un proxy TLS da 403 en cada formulario.
  security: { checkOrigin: false },

  integrations: [react()],

  vite: {
    plugins: [tailwindcss()],
    server: {
      // Los bind mounts de Docker en Windows/macOS no propagan eventos de FS.
      watch: process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true } : undefined,
      fs: { allow: [projectRoot, realNodeModules] },
    },
  },
});
