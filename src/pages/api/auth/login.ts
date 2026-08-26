import type { APIRoute } from 'astro';
import { prisma } from '../../../lib/db.ts';
import { verifyPassword } from '../../../lib/auth/password.ts';
import { allowedDomainsLabel, isAllowedDomain } from '../../../lib/auth/domains.ts';
import { firstIssue, loginSchema } from '../../../lib/auth/schemas.ts';
import { createSessionToken, setSessionCookie } from '../../../lib/auth/session.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';

/** POST /api/auth/login — valida credenciales y abre la cookie de sesion. */
export const POST: APIRoute = async ({ request, cookies }) => {
  const parsed = loginSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(firstIssue(parsed.error), 422);
  }

  const { email, password } = parsed.data;

  // El SPEC condiciona tambien el *inicio de sesion* al dominio institucional:
  // si un dominio sale de la lista blanca, sus cuentas dejan de poder entrar.
  if (!isAllowedDomain(email)) {
    return fail(
      `El acceso está habilitado solo para correos institucionales (${allowedDomainsLabel()}).`,
      403,
    );
  }

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

  const session = { id: user.id, email: user.email, name: user.name, role: user.role };
  setSessionCookie(cookies, await createSessionToken(session));

  return ok({ user: session, redirect: '/app' });
};
