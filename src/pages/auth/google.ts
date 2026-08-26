import type { APIRoute } from 'astro';
import { authorizeUrl } from '../../lib/auth/google.ts';
import { isGoogleEnabled } from '../../lib/env.ts';

/**
 * GET /auth/google — arranca el ingreso con Google.
 *
 * El `state` es un valor al azar que viaja a Google y vuelve con él: se guarda
 * en una cookie de un solo uso y se compara al volver. Sin eso, cualquiera
 * podría empujarle a un docente un callback armado y hacerlo entrar a una
 * cuenta que no es la suya.
 */
export const GET: APIRoute = async ({ cookies, redirect }) => {
  if (!isGoogleEnabled()) return redirect('/login?error=google-no-configurado', 302);

  const state = crypto.randomUUID();

  cookies.set('kodu_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax', // 'lax' y no 'strict': la cookie tiene que sobrevivir la vuelta desde Google.
    secure: import.meta.env.PROD,
    path: '/',
    maxAge: 600,
  });

  return redirect(authorizeUrl(state), 302);
};
