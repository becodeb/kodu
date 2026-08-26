import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getEnv } from '../env.ts';

/**
 * Ingreso con Google (OAuth 2.0 + OpenID Connect).
 *
 * El flujo es el de "authorization code": el navegador va a Google, vuelve con
 * un `code`, y el servidor lo canjea por un `id_token`. El secreto nunca sale
 * de acá.
 */

const AUTORIZACION = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const EMISOR = 'https://accounts.google.com';

/**
 * Las claves publicas de Google se cachean solas y rotan cada tanto; por eso se
 * arma una unica vez y no en cada pedido.
 */
const CLAVES = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/** Tiene que coincidir EXACTO con el redirect_uri registrado en Google Cloud. */
export function redirectUri(): string {
  return new URL('/auth/callback', getEnv().PUBLIC_SITE_URL).href;
}

export function authorizeUrl(state: string): string {
  const env = getEnv();
  const url = new URL(AUTORIZACION);

  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  // Sin esto, quien tiene varias cuentas entra siempre con la ultima usada y no
  // puede elegir con cual entrar a Kodu.
  url.searchParams.set('prompt', 'select_account');

  return url.href;
}

export interface PerfilGoogle {
  googleId: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export class GoogleError extends Error {}

/** Canjea el `code` por el perfil, validando la firma del id_token. */
export async function exchangeCode(code: string): Promise<PerfilGoogle> {
  const env = getEnv();

  const respuesta = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => '');
    throw new GoogleError(`Google rechazó el intercambio (${respuesta.status}). ${detalle.slice(0, 200)}`);
  }

  const datos = (await respuesta.json()) as { id_token?: string };
  if (!datos.id_token) throw new GoogleError('Google no devolvió el id_token.');

  // Se verifica firma, emisor y destinatario aunque el token venga por TLS
  // directo: si mañana el intercambio pasa por otro lado, esto sigue cerrado.
  const { payload } = await jwtVerify(datos.id_token, CLAVES, {
    issuer: [EMISOR, 'accounts.google.com'],
    audience: env.GOOGLE_CLIENT_ID,
  });

  const email = typeof payload.email === 'string' ? payload.email : '';
  if (!email) throw new GoogleError('La cuenta de Google no tiene un correo asociado.');

  return {
    googleId: String(payload.sub),
    email,
    name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : email.split('@')[0]!,
    emailVerified: payload.email_verified === true,
  };
}
