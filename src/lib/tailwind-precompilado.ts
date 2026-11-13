import { createHash } from 'node:crypto';
import postcss from 'postcss';
// Tailwind v3 (el mismo que usa el CDN de juego `cdn.tailwindcss.com`), con alias
// para no chocar con el Tailwind v4 que usa la propia app.
import tailwind from 'tailwindcss3';

/**
 * Tailwind ya compilado en el servidor para los recursos.
 *
 * Los recursos llevaban `<script src="https://cdn.tailwindcss.com">`, que
 * compila los estilos EN EL NAVEGADOR del alumno. En iPad/Mac con Safari (y
 * en equipos viejos) ese compilador falla y el recurso llega sin un solo
 * estilo. Acá se compila una vez en el servidor y se entrega CSS común, que
 * cualquier navegador entiende. El script de Tailwind se deja igual: en los
 * navegadores donde anda sigue cubriendo clases armadas en tiempo de ejecución.
 */

const TAG_TAILWIND = /<script\b[^>]*\bsrc=["'](?:https:\/\/cdn\.tailwindcss\.com|\/cdn\/cdn\.tailwindcss\.com)[^"']*["'][^>]*>\s*<\/script>/i;
const MAX_CACHE = 80;
const cache = new Map<string, string>();

/** Saca el objeto de `tailwind.config = {...}` por conteo de llaves y lo lee como JSON (nunca se evalúa código). */
function extraerConfig(html: string): Record<string, unknown> | null {
  const m = /tailwind\.config\s*=\s*/.exec(html);
  if (!m) return {};
  const ini = m.index + m[0].length;
  if (html[ini] !== '{') return null;
  let prof = 0;
  let comilla: string | null = null;
  for (let i = ini; i < html.length; i++) {
    const c = html[i];
    if (comilla) {
      if (c === '\\') i++;
      else if (c === comilla) comilla = null;
      continue;
    }
    if (c === '"' || c === "'") comilla = c;
    else if (c === '{') prof++;
    else if (c === '}' && --prof === 0) {
      try {
        const cfg = JSON.parse(html.slice(ini, i + 1));
        return cfg && typeof cfg === 'object' ? (cfg as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function precompilarTailwind(html: string): Promise<string> {
  if (!TAG_TAILWIND.test(html)) return html;
  const cfg = extraerConfig(html);
  if (!cfg) return html;

  const clave = createHash('sha1').update(html).digest('hex');
  let css = cache.get(clave);
  if (css === undefined) {
    try {
      const salida = await postcss([
        tailwind({ ...cfg, content: [{ raw: html, extension: 'html' }] }),
      ]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined });
      css = salida.css;
    } catch {
      return html; // sin CSS precompilado queda el compilador del navegador, como antes
    }
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(clave, css);
  }

  const estilo = `<style data-kodu-tailwind>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
  // Al final del <head>: donde el compilador del navegador agrega su propio <style>.
  const cierre = /<\/head>/i.exec(html);
  return cierre ? html.slice(0, cierre.index) + estilo + '\n' + html.slice(cierre.index) : estilo + html;
}
