import type { APIRoute } from 'astro';
import { prisma } from '../../../lib/db.ts';
import { hashPassword } from '../../../lib/auth/password.ts';
import { allowedDomainsLabel, isAdminEmail, isAllowedDomain } from '../../../lib/auth/domains.ts';
import { firstIssue, registerSchema } from '../../../lib/auth/schemas.ts';
import { createSessionToken, setSessionCookie } from '../../../lib/auth/session.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';

/** POST /api/auth/register — alta de docente restringida por dominio institucional. */
export const POST: APIRoute = async ({ request, cookies }) => {
  const parsed = registerSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(firstIssue(parsed.error), 422);
  }

  const { name, email, password } = parsed.data;

  // Regla dura del SPEC: solo correos de dominios habilitados.
  if (!isAllowedDomain(email)) {
    return fail(
      `El registro está habilitado solo para correos institucionales (${allowedDomainsLabel()}).`,
      403,
    );
  }

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

    setSessionCookie(cookies, await createSessionToken(user));
    return ok({ user, redirect: '/app' });
  } catch (error) {
    // Carrera entre el findUnique y el create.
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return fail('Ya existe una cuenta con ese email.', 409);
    }
    console.error('[auth/register]', error);
    return fail('No pudimos crear la cuenta. Intentá de nuevo.', 500);
  }
};
