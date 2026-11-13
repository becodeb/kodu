/**
 * Espejo propio de los CDN de scripts que usan los recursos.
 *
 * Por qué existe: los recursos cargaban Tailwind / lucide / three directo de
 * `cdn.tailwindcss.com`, `cdn.jsdelivr.net` y `unpkg.com`. Muchas redes de
 * escuela y los iPad/Mac administrados filtran esos dominios, y el recurso
 * llegaba sin estilos (Tailwind) o con la escena 3D en blanco. Servidos desde
 * nuestro propio origen, el alumno sólo necesita poder entrar a Kodu.
 *
 * Seguridad: sólo hosts de la lista, sólo `GET`, sólo respuestas de tipo
 * script/css/json/mapa, tope de tamaño. No es un proxy abierto.
 */

export const CDN_ESPEJADOS: readonly string[] = [
  'cdn.tailwindcss.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
];

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_BYTES = 6 * 1024 * 1024;
const MAX_ENTRADAS = 60;
const TIMEOUT_MS = 12_000;

interface Entrada {
  cuerpo: Uint8Array;
  tipo: string;
  expira: number;
}

const cache = new Map<string, Entrada>();
const enVuelo = new Map<string, Promise<Entrada | null>>();

const TIPOS_OK = /^(application|text)\/(javascript|x-javascript|ecmascript|css|json)|^application\/octet-stream$/i;

async function traer(url: string): Promise<Entrada | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'KoduEdu-cdn-mirror' },
    });
    if (!res.ok) return null;
    // Tras los redirects debe seguir siendo un host de la lista.
    if (!CDN_ESPEJADOS.includes(new URL(res.url).hostname)) return null;
    const tipo = res.headers.get('content-type') ?? 'application/javascript';
    if (!TIPOS_OK.test(tipo)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;
    return { cuerpo: buf, tipo, expira: Date.now() + TTL_MS };
  } catch {
    return null;
  }
}

/** Devuelve la respuesta espejada o `null` si el host no está permitido o el origen falló sin copia previa. */
export async function espejarCdn(host: string, rutaYQuery: string): Promise<Response | null> {
  if (!CDN_ESPEJADOS.includes(host)) return null;
  const ruta = rutaYQuery.startsWith('/') ? rutaYQuery : `/${rutaYQuery}`;
  const url = `https://${host}${ruta}`;

  let entrada = cache.get(url) ?? null;
  if (!entrada || entrada.expira < Date.now()) {
    let pendiente = enVuelo.get(url);
    if (!pendiente) {
      pendiente = traer(url).finally(() => enVuelo.delete(url));
      enVuelo.set(url, pendiente);
    }
    const nueva = await pendiente;
    if (nueva) {
      if (cache.size >= MAX_ENTRADAS) cache.delete(cache.keys().next().value!);
      cache.set(url, nueva);
      entrada = nueva;
    }
    // Si el origen falló, se sirve la copia vencida antes que nada.
  }
  if (!entrada) return null;

  return new Response(entrada.cuerpo, {
    headers: {
      'Content-Type': entrada.tipo,
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

const SCRIPT_CDN = /(<script\b[^>]*?\bsrc=)(["'])https:\/\/(cdn\.tailwindcss\.com|cdn\.jsdelivr\.net|unpkg\.com)(\/[^"'\s]*)?\2/gi;

/** Reescribe los `<script src>` de CDN hacia el espejo `/cdn/<host>/...`. Las fuentes (CSS) quedan como están. */
export function reescribirScriptsCdn(html: string): string {
  return html.replace(SCRIPT_CDN, (_m, antes: string, q: string, host: string, ruta?: string) =>
    `${antes}${q}/cdn/${host.toLowerCase()}${ruta ?? ''}${q}`);
}
