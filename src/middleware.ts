import { defineMiddleware } from 'astro:middleware';
import { clearSessionCookie, readSessionFromCookies, type SessionUser } from './lib/auth/session.ts';
import { fail } from './lib/http.ts';
import { crossOriginForbiddenResponse, isForbiddenCrossOrigin } from './lib/csrf.ts';
import { requireAdmin, requireFreshAdmin } from './lib/auth/guards.ts';
import { prisma } from './lib/db.ts';

/**
 * Resuelve la sesion en cada request y protege las areas privadas.
 *
 * Publico: "/", "/login", "/register", "/gallery", "/p/[slug]", "/uploads/*"
 * y "/api/auth/*".
 * Privado: todo lo que cuelgue de "/app" y "/admin", y las APIs de trabajo.
 */

const PROTECTED_PAGE_PREFIXES = ['/app', '/admin'];
const PROTECTED_API_PREFIXES = ['/api/projects', '/api/chat', '/api/rules', '/api/uploads', '/api/admin'];
const ADMIN_PAGE_PREFIXES = ['/admin'];
const ADMIN_API_PREFIXES = ['/api/admin'];
const GUEST_ONLY_PATHS = ['/login', '/register'];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Vuelve a leer el rol desde la base en cada request a una ruta protegida,
 * en vez de confiar en el rol grabado en el JWT hasta 168 horas atrás: la
 * identidad deja de ser una afirmación y pasa a ser una lectura. Si la
 * lectura falla se degrada al JWT existente — las páginas de solo lectura
 * toleran un dato viejo, las mutaciones de /api/admin no (ver
 * requireFreshAdmin).
 *
 * `aiAccessOverride` tiene columna propia desde M6 e `isDemo` desde M7; las
 * dos se releen acá en cada pedido gateado. Esto es lo que hace que apagar
 * el interruptor de la demo (`AppSettings.demoEnabled`, chequeado en
 * `chat/stream.ts`) surta efecto en el PRÓXIMO pedido de la cuenta de demo
 * sin ningún re-login: no cambia `isDemo` en sí (la cuenta sigue siendo la
 * cuenta de demo), lo que cambia es que el gate de `stream.ts` vuelve a leer
 * `demoEnabled` en ese pedido nuevo.
 */
async function resolverIdentidadFresca(
  sesion: SessionUser,
): Promise<{ user: SessionUser | null; fresh: boolean }> {
  try {
    const fila = await prisma.user.findUnique({
      where: { id: sesion.id },
      select: { id: true, email: true, name: true, role: true, aiAccessOverride: true, isDemo: true },
    });

    if (!fila) {
      // La cuenta fue borrada: la cookie ya no representa a nadie.
      return { user: null, fresh: false };
    }

    return {
      user: {
        id: fila.id,
        email: fila.email,
        name: fila.name,
        role: fila.role,
        aiAccessOverride: fila.aiAccessOverride,
        isDemo: fila.isDemo,
      },
      fresh: true,
    };
  } catch {
    // Base caída o lenta: si todo lo demás también está roto, negarle la
    // entrada a un admin no soluciona nada. Lo que sí importa es no dejar
    // que ese dato viejo autorice una escritura (requireFreshAdmin se
    // encarga con identityFresh=false).
    return { user: sesion, fresh: false };
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Reemplaza a security.checkOrigin de Astro, que detras de un proxy TLS
  // rechaza todo POST de formulario (ver src/lib/csrf.ts).
  if (isForbiddenCrossOrigin(context)) {
    return crossOriginForbiddenResponse(context);
  }

  context.locals.user = await readSessionFromCookies(context.cookies);
  context.locals.identityFresh = false;

  const esRutaGateada =
    matches(pathname, PROTECTED_PAGE_PREFIXES) || matches(pathname, PROTECTED_API_PREFIXES);

  // Solo las rutas gateadas pagan la lectura extra a la base; las públicas
  // (/, /gallery, /p/[slug], /uploads/*, /login, /register, /api/auth/*)
  // se quedan con la identidad del JWT y no llaman a resolverIdentidadFresca.
  if (context.locals.user && esRutaGateada) {
    const { user, fresh } = await resolverIdentidadFresca(context.locals.user);
    if (!user) {
      clearSessionCookie(context.cookies);
      context.locals.user = null;
    } else {
      context.locals.user = user;
      context.locals.identityFresh = fresh;
    }
  }

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

  // A esta altura, si la ruta es de /admin o /api/admin, ya hay sesión
  // (si no, ya se redirigió o se devolvió 401 más arriba).
  if (matches(pathname, ADMIN_PAGE_PREFIXES)) {
    const resultado = requireAdmin(context.locals);
    if (resultado instanceof Response) {
      // Nunca 404 ni pantalla en blanco: un docente que llega acá vuelve a lo suyo.
      return context.redirect('/app', 302);
    }
  }

  if (matches(pathname, ADMIN_API_PREFIXES)) {
    const esMutacion = context.request.method !== 'GET' && context.request.method !== 'HEAD';
    const resultado = esMutacion ? requireFreshAdmin(context.locals) : requireAdmin(context.locals);
    if (resultado instanceof Response) return resultado;
  }

  return next();
});
