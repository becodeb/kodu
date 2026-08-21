import { defineMiddleware } from 'astro:middleware';
import { readSessionFromCookies } from './lib/auth/session.ts';
import { fail } from './lib/http.ts';
import { crossOriginForbiddenResponse, isForbiddenCrossOrigin } from './lib/csrf.ts';

/**
 * Resuelve la sesion en cada request y protege las areas privadas.
 *
 * Publico: "/", "/login", "/register", "/gallery", "/p/[slug]" y "/api/auth/*".
 * Privado: todo lo que cuelgue de "/app" y las APIs de trabajo (Etapa 2+).
 */

const PROTECTED_PAGE_PREFIXES = ['/app'];
const PROTECTED_API_PREFIXES = ['/api/projects', '/api/chat', '/api/rules', '/api/uploads'];
const GUEST_ONLY_PATHS = ['/login', '/register'];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Reemplaza a security.checkOrigin de Astro, que detras de un proxy TLS
  // rechaza todo POST de formulario (ver src/lib/csrf.ts).
  if (isForbiddenCrossOrigin(context)) {
    return crossOriginForbiddenResponse(context);
  }

  context.locals.user = await readSessionFromCookies(context.cookies);

  // Las APIs privadas responden 401 en JSON; nunca redirigen (romperia el fetch).
  if (!context.locals.user && matches(pathname, PROTECTED_API_PREFIXES)) {
    return fail('Sesión no válida o expirada', 401);
  }

  if (!context.locals.user && matches(pathname, PROTECTED_PAGE_PREFIXES)) {
    const redirectTo = encodeURIComponent(pathname + context.url.search);
    return context.redirect(`/login?next=${redirectTo}`, 302);
  }

  // Si ya inicio sesion, no tiene sentido mostrarle login/registro.
  if (context.locals.user && GUEST_ONLY_PATHS.includes(pathname)) {
    return context.redirect('/app', 302);
  }

  return next();
});
