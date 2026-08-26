import type { APIRoute } from 'astro';
import { prisma } from '../../lib/db.ts';
import { exchangeCode } from '../../lib/auth/google.ts';
import { isAdminEmail, isAllowedDomain, normalizeEmail } from '../../lib/auth/domains.ts';
import { createSessionToken, setSessionCookie } from '../../lib/auth/session.ts';
import { isGoogleEnabled } from '../../lib/env.ts';

/**
 * GET /auth/callback — vuelta de Google.
 *
 * Esta URL tiene que coincidir EXACTO con la registrada en Google Cloud.
 */
export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  if (!isGoogleEnabled()) return redirect('/login?error=google-no-configurado', 302);

  const guardado = cookies.get('kodu_oauth_state')?.value;
  cookies.delete('kodu_oauth_state', { path: '/' });

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
    if (!isAllowedDomain(email)) return redirect('/login?error=dominio', 302);

    // Se busca primero por googleId y después por correo: así una cuenta creada
    // antes con contraseña queda vinculada en vez de duplicarse.
    const existente =
      (await prisma.user.findUnique({ where: { googleId: perfil.googleId } })) ??
      (await prisma.user.findUnique({ where: { email } }));

    const user = existente
      ? await prisma.user.update({
          where: { id: existente.id },
          data: { googleId: perfil.googleId },
          select: { id: true, email: true, name: true, role: true },
        })
      : await prisma.user.create({
          data: {
            email,
            name: perfil.name,
            googleId: perfil.googleId,
            role: isAdminEmail(email) ? 'ADMIN' : 'DOCENTE',
          },
          select: { id: true, email: true, name: true, role: true },
        });

    setSessionCookie(cookies, await createSessionToken(user));
    return redirect('/app', 302);
  } catch (error) {
    console.error('[auth/callback]', error);
    return redirect('/login?error=google', 302);
  }
};
