import type { APIRoute } from 'astro';
import { prisma } from '../../../lib/db.ts';
import { verifyPassword } from '../../../lib/auth/password.ts';
import { firstIssue, loginSchema } from '../../../lib/auth/schemas.ts';
import { createSessionToken, setSessionCookie } from '../../../lib/auth/session.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';

/**
 * POST /api/auth/login — valida credenciales y abre la cookie de sesion.
 *
 * Desde M6 el dominio institucional ya no condiciona el login (design.md
 * §10): una cuenta que hoy queda fuera de la lista de dominios autorizados
 * igual puede entrar, ver la app y sus recursos — sólo el USO de la IA queda
 * gateado, en `/api/chat/stream`.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const parsed = loginSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(firstIssue(parsed.error), 422);
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });

  // Mensaje generico y deliberadamente igual para "no existe" y "clave mala":
  // no queremos que el formulario sirva para enumerar cuentas.
  const credencialesInvalidas = fail('Email o contraseña incorrectos.', 401);

  if (!user) {
    return credencialesInvalidas;
  }

  // Una cuenta creada con Google no tiene contraseña. Acá SÍ conviene ser
  // específico: el docente existe y está intentando entrar por la puerta
  // equivocada, así que decirle "email o contraseña incorrectos" lo manda a
  // dar vueltas sin salida. No filtra nada que Google no confirme igual.
  if (!user.passwordHash) {
    return fail('Esta cuenta entra con Google. Usá el botón "Continuar con Google".', 409);
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    return credencialesInvalidas;
  }

  // `aiAccessOverride` ya tiene columna propia (M6); el JWT sólo firma
  // identidad (session.ts) así que esto es sólo lo que ve la respuesta —
  // la próxima request a una ruta protegida lo vuelve a leer de la base.
  // `isDemo` todavía no tiene columna propia (llega en M7).
  const session = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    aiAccessOverride: user.aiAccessOverride,
    isDemo: false,
    // Mismo criterio que `isDemo` de arriba: no tiene columna en el `select`
    // de esta consulta, así que ninguna cuenta real que entra por acá tiene
    // por qué llevar prime en esta respuesta puntual — el middleware relee
    // el valor real de la base en la próxima request a una ruta gateada.
    primeAccess: false,
  };
  setSessionCookie(cookies, await createSessionToken(session));

  return ok({ user: session, redirect: '/app' });
};
