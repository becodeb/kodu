import type { AstroCookies } from 'astro';
import { SignJWT, jwtVerify } from 'jose';
import { getEnv, isProduction } from '../env.ts';

/**
 * Sesiones por cookie httpOnly con JWT firmado (HS256).
 *
 * El SPEC define "cookies/JWT" y su modelo de datos no incluye tabla `Session`,
 * asi que la sesion es stateless: no hay revocacion server-side, cerrar sesion
 * borra la cookie. Si mas adelante hace falta revocar (expulsar un docente al
 * instante), se agrega un modelo `Session` y se cambia solo este archivo.
 */

export const SESSION_COOKIE = 'kodu_session';

export type SessionRole = 'DOCENTE' | 'ADMIN';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: SessionRole;
  /**
   * null = sin opinión, sigue la regla de dominio; true = acceso a la IA
   * habilitado a mano; false = revocado a mano. Todavía no tiene columna
   * propia en la base (llega con la migración de M6); hasta entonces viaja
   * en null.
   */
  aiAccessOverride: boolean | null;
  /** Cuenta compartida de demo (M7). Todavía no tiene columna propia. */
  isDemo: boolean;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().AUTH_SECRET);
}

function ttlSeconds(): number {
  return getEnv().SESSION_TTL_HOURS * 60 * 60;
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setIssuer('koduedu')
    .setAudience('koduedu-app')
    .setExpirationTime(now + ttlSeconds())
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: 'koduedu',
      audience: 'koduedu-app',
    });

    if (!payload.sub || typeof payload.email !== 'string' || typeof payload.name !== 'string') {
      return null;
    }
    const role = payload.role === 'ADMIN' ? 'ADMIN' : 'DOCENTE';

    // El JWT solo guarda identidad (email/nombre/rol); las banderas de IA se
    // leen de la base en cada request a una ruta protegida (middleware.ts).
    // Acá arrancan degradadas: nadie las usó todavía en este request.
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role,
      aiAccessOverride: null,
      isDemo: false,
    };
  } catch {
    // Firma invalida, token expirado o manipulado: sesion inexistente.
    return null;
  }
}

export function setSessionCookie(cookies: AstroCookies, token: string): void {
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    path: '/',
    maxAge: ttlSeconds(),
  });
}

export function clearSessionCookie(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

export async function readSessionFromCookies(cookies: AstroCookies): Promise<SessionUser | null> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
