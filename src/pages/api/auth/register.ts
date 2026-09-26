import type { APIRoute } from 'astro';
import { prisma } from '../../../lib/db.ts';
import { hashPassword } from '../../../lib/auth/password.ts';
import { isAdminEmail } from '../../../lib/auth/domains.ts';
import { firstIssue, registerSchema } from '../../../lib/auth/schemas.ts';
import { createSessionToken, setSessionCookie } from '../../../lib/auth/session.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';
import { hasResendApiKey } from '../../../lib/env.ts';
import { unirSiCorresponde } from '../../../lib/orgs/membresia.ts';
import { emitirYEnviarVerificacion } from '../../../lib/orgs/verificacion.ts';

/**
 * POST /api/auth/register — alta de docente, abierta a cualquier dominio
 * desde M6 (design.md §10). El dominio institucional ya no gatea el registro
 * ni el login: gatea sólo el USO de la IA, en `/api/chat/stream`.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const parsed = registerSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(firstIssue(parsed.error), 422);
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return fail('Ya existe una cuenta con ese email.', 409);
  }

  try {
    /**
     * odd/tasks/organizaciones.md (T2/T3, decisión del dueño — "fallback sin
     * Resend"): mientras no haya `RESEND_API_KEY` en el entorno, toda
     * creación de usuario se toma como verificada de una. Con la key
     * cargada, queda sin verificar hasta que confirme el enlace que se
     * manda abajo.
     */
    const verificadaAlNacer = !hasResendApiKey();

    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await hashPassword(password),
        role: isAdminEmail(email) ? 'ADMIN' : 'DOCENTE',
        emailVerifiedAt: verificadaAlNacer ? new Date() : null,
        emailVerificationSource: verificadaAlNacer ? 'NO_PROVIDER' : null,
      },
      select: { id: true, email: true, name: true, role: true },
    });

    // T3: con Resend configurado, se manda el mail de verificación acá mismo.
    // El registro NUNCA falla por esto — si el envío falla (proveedor caído,
    // falta RESEND_FROM), el docente puede pedirlo de nuevo desde el cartel
    // de "cuenta personal" (POST /api/auth/verificacion/reenviar).
    if (!verificadaAlNacer) {
      const envio = await emitirYEnviarVerificacion(user);
      if (!envio.ok) {
        console.error('[auth/register] no se pudo mandar el mail de verificación:', envio.motivo);
      }
    }

    // "Unirse ocurre en el momento" (decisión del dueño): si el email ya
    // resuelve a una organización (dominio o lista blanca) y la cuenta es
    // confiable, se une acá mismo, antes de armar la sesión. Con la cuenta
    // recién creada sin verificar (Resend cargado), `emailConfiable` corta
    // esto en `false` y no hace nada — se une recién al confirmar el enlace.
    const organizationId = await unirSiCorresponde(user.id);

    // Una cuenta nueva arranca sin permiso individual (null: sigue la regla
    // de la organización). `isDemo` todavía no tiene columna propia — llega en M7.
    const session = { ...user, aiAccessOverride: null, isDemo: false, organizationId };
    setSessionCookie(cookies, await createSessionToken(session));
    return ok({ user: session, redirect: '/app' });
  } catch (error) {
    // Carrera entre el findUnique y el create.
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return fail('Ya existe una cuenta con ese email.', 409);
    }
    console.error('[auth/register]', error);
    return fail('No pudimos crear la cuenta. Intentá de nuevo.', 500);
  }
};
