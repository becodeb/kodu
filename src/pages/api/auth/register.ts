import type { APIRoute } from 'astro';
import { prisma } from '../../../lib/db.ts';
import { hashPassword } from '../../../lib/auth/password.ts';
import { isAdminEmail } from '../../../lib/auth/domains.ts';
import { firstIssue, registerSchema } from '../../../lib/auth/schemas.ts';
import { createSessionToken, setSessionCookie } from '../../../lib/auth/session.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';
import { hasResendApiKey } from '../../../lib/env.ts';
import { unirSiCorresponde } from '../../../lib/orgs/membresia.ts';

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
     * odd/tasks/organizaciones.md (T2, decisión del dueño — "fallback sin
     * Resend"): mientras no haya `RESEND_API_KEY` en el entorno, toda
     * creación de usuario se toma como verificada de una — T3 agrega el
     * flujo real de Resend, que dejará esto en `null`/`null` hasta que el
     * docente confirme el enlace.
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

    // "Unirse ocurre en el momento" (decisión del dueño): si el email ya
    // resuelve a una organización (dominio o lista blanca) y la cuenta es
    // confiable, se une acá mismo, antes de armar la sesión.
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
