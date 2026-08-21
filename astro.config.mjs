// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

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
    },
  },
});
