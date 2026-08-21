import type { APIRoute } from 'astro';
import { clearSessionCookie } from '../../../lib/auth/session.ts';

/** POST /api/auth/logout — borra la cookie y vuelve al inicio. */
export const POST: APIRoute = async ({ cookies, redirect }) => {
  clearSessionCookie(cookies);
  return redirect('/', 303);
};
