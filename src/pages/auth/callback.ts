import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db.ts';
import { exchangeCode } from '../../lib/auth/google.ts';
import { isAdminEmail, normalizeEmail } from '../../lib/auth/domains.ts';
import { createSessionToken, setSessionCookie } from '../../lib/auth/session.ts';
import { isGoogleEnabled } from '../../lib/env.ts';
import { unirSiCorresponde } from '../../lib/orgs/membresia.ts';

/**
 * GET /auth/callback — vuelta de Google.
 *
 * Esta URL tiene que coincidir EXACTO con la registrada en Google Cloud.
 */
export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  if (!isGoogleEnabled()) return redirect('/login?error=google-no-configurado', 302);

  const guardado = cookies.get('kodu_oauth_state')?.value;
  cookies.delete('kodu_oauth_state', { path: '/' });

  // odd/tasks/organizaciones.md (T4): "next" guardado por auth/google.ts —
  // se revalida DE NUEVO acá (nunca se confía en la validación de un paso
  // anterior) antes de usarlo como destino del redirect final.
  const nextGuardado = cookies.get('kodu_oauth_next')?.value;
  cookies.delete('kodu_oauth_next', { path: '/' });
  const safeNext =
    nextGuardado && nextGuardado.startsWith('/') && !nextGuardado.startsWith('//') ? nextGuardado : '/app';

  // Si el docente cancela en la pantalla de Google, vuelve con `error`.
  if (url.searchParams.get('error')) return redirect('/login?error=google-cancelado', 302);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state || !guardado || state !== guardado) {
    return redirect('/login?error=google-state', 302);
  }

  try {
    const perfil = await exchangeCode(code);

    // Google avisa si el correo está verificado; sin eso, cualquiera que
    // controle un dominio podría reclamar una casilla ajena.
    if (!perfil.emailVerified) return redirect('/login?error=google-sin-verificar', 302);

    const email = normalizeEmail(perfil.email);

    // Se busca primero por googleId y después por correo: así una cuenta creada
    // antes con contraseña queda vinculada en vez de duplicarse.
    const existente =
      (await prisma.user.findUnique({ where: { googleId: perfil.googleId } })) ??
      (await prisma.user.findUnique({ where: { email } }));

    /**
     * odd/tasks/organizaciones.md (T2, decisión del dueño): "Google ya viene
     * verificado" — tanto al crear la cuenta como al VINCULAR una cuenta
     * vieja creada con contraseña (`existente.emailVerifiedAt` todavía en
     * `null`, nunca se pisa uno ya puesto — ni por Resend en T3 ni por el
     * fallback sin key).
     */
    const user = existente
      ? await prisma.user.update({
          where: { id: existente.id },
          data: {
            googleId: perfil.googleId,
            ...(existente.emailVerifiedAt === null
              ? { emailVerifiedAt: new Date(), emailVerificationSource: 'GOOGLE' as const }
              : {}),
          },
          select: { id: true, email: true, name: true, role: true, aiAccessOverride: true },
        })
      : await prisma.user.create({
          data: {
            email,
            name: perfil.name,
            googleId: perfil.googleId,
            role: isAdminEmail(email) ? 'ADMIN' : 'DOCENTE',
            emailVerifiedAt: new Date(),
            emailVerificationSource: 'GOOGLE',
          },
          select: { id: true, email: true, name: true, role: true, aiAccessOverride: true },
        });

    // "Unirse ocurre en el momento" (decisión del dueño) — igual que en
    // register.ts/login.ts.
    const organizationId = await unirSiCorresponde(user.id);

    // `isDemo` todavía no tiene columna propia (llega en M7).
    const session = { ...user, isDemo: false, organizationId };
    setSessionCookie(cookies, await createSessionToken(session));
    return redirect(safeNext, 302);
  } catch (error) {
    console.error('[auth/callback]', error);
    return redirect('/login?error=google', 302);
  }
};
