import type { APIRoute } from 'astro';
import { prisma } from '../../../lib/db.ts';
import { hashPassword } from '../../../lib/auth/password.ts';
import { isAdminEmail } from '../../../lib/auth/domains.ts';
import { firstIssue, registerSchema } from '../../../lib/auth/schemas.ts';
import { createSessionToken, setSessionCookie } from '../../../lib/auth/session.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';

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
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await hashPassword(password),
        role: isAdminEmail(email) ? 'ADMIN' : 'DOCENTE',
      },
      select: { id: true, email: true, name: true, role: true },
    });

    // Una cuenta nueva arranca sin permiso individual (null: sigue la regla
    // de dominio). `isDemo` todavía no tiene columna propia — llega en M7.
    // `primeAccess` de una cuenta recién creada siempre nace en `false`
    // (columna real, default de la migración): no hace falta leerla, se
    // sabe de antemano.
    const session = { ...user, aiAccessOverride: null, isDemo: false, primeAccess: false };
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
