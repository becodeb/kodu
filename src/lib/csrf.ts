import type { APIContext } from 'astro';
import { getEnv } from './env.ts';

/**
 * Chequeo de origen propio, en reemplazo del de Astro (`security.checkOrigin`).
 *
 * ── Por qué ──
 * El adapter de Node arma la URL del request con `req.socket.encrypted` y NO
 * mira `x-forwarded-proto`. Detrás de un proxy que termina TLS (Traefik,
 * Nginx, Cloudflare) la app se cree servida por http://, mientras el navegador
 * manda `Origin: https://…`. El chequeo de Astro compara ambos, no coinciden y
 * devuelve 403 en todo POST de formulario: cerrar sesión y adjuntar archivos
 * quedaban rotos en producción (verificado en kodu.becode.com.ar).
 *
 * Acá comparamos contra PUBLIC_SITE_URL, que la define el servidor y ningún
 * cliente puede falsear, más el origen propio del request para desarrollo.
 *
 * La regla replica la de Astro: los envíos tipo formulario (y los pedidos sin
 * Content-Type) tienen que ser del mismo origen. El JSON queda exento porque el
 * navegador no puede mandarlo cross-origin sin un preflight de CORS.
 */

const FORM_CONTENT_TYPES = [
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
];

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

function allowedOrigins(context: APIContext): Set<string> {
  const origins = new Set<string>([context.url.origin]);

  try {
    origins.add(new URL(getEnv().PUBLIC_SITE_URL).origin);
  } catch {
    // PUBLIC_SITE_URL mal formada: nos quedamos con el origen del request.
  }

  return origins;
}

export function isForbiddenCrossOrigin(context: APIContext): boolean {
  const { request } = context;

  if (SAFE_METHODS.includes(request.method)) return false;

  const origin = request.headers.get('origin');
  const isSameOrigin = origin !== null && allowedOrigins(context).has(origin);

  const contentType = request.headers.get('content-type');
  if (contentType) {
    const isFormLike = FORM_CONTENT_TYPES.some((type) =>
      contentType.toLowerCase().includes(type),
    );
    return isFormLike && !isSameOrigin;
  }

  return !isSameOrigin;
}

export function crossOriginForbiddenResponse(context: APIContext): Response {
  return new Response(`Cross-site ${context.request.method} form submissions are forbidden`, {
    status: 403,
  });
}
