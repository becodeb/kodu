import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../db.ts';
import { getEnv } from '../env.ts';
import { enviarEmail } from '../email/resend.ts';
import { unirSiCorresponde } from './membresia.ts';

/**
 * odd/tasks/organizaciones.md (T3): emisión, envío y validación del token de
 * verificación de email por Resend. Fuente única de verdad de este flujo —
 * el registro y el reenvío la usan, nunca arman el token a mano.
 */

const VENCIMIENTO_HORAS = 24;
const REENVIO_MIN_SEGUNDOS = 60;

function hashToken(tokenPlano: string): string {
  return createHash('sha256').update(tokenPlano).digest('hex');
}

/** 32 bytes al azar, mismo criterio que el token de invitación (T4): nunca
 *  se guarda en claro, sólo su hash (ver `EmailVerificationToken.tokenHash`). */
function generarTokenPlano(): string {
  return randomBytes(32).toString('base64url');
}

function enlaceVerificacion(tokenPlano: string): string {
  const base = getEnv().PUBLIC_SITE_URL.replace(/\/+$/, '');
  return `${base}/verificar-email?token=${encodeURIComponent(tokenPlano)}`;
}

function textoCorreo(nombre: string, enlace: string): { html: string; text: string } {
  const primerNombre = nombre.trim().split(/\s+/)[0] || 'docente';

  const text = [
    `Hola ${primerNombre},`,
    '',
    'Confirmá tu email para empezar a usar la IA de Kodu:',
    enlace,
    '',
    'Si no pediste esto, ignorá este correo.',
  ].join('\n');

  const html = `
    <p>Hola ${primerNombre},</p>
    <p>Confirmá tu email para empezar a usar la IA de Kodu:</p>
    <p><a href="${enlace}">${enlace}</a></p>
    <p>Si no pediste esto, ignorá este correo.</p>
  `.trim();

  return { html, text };
}

/**
 * Genera un token nuevo e invalida los anteriores SIN USAR de este usuario
 * (decisión del dueño: "issuing a new one invalidates previous unused
 * ones"). Se borran en vez de marcarse usados: un enlace viejo que llega
 * después simplemente no existe más, mismo mensaje genérico que uno que
 * nunca existió (`verificarToken` no distingue el motivo al mostrarlo).
 */
async function emitirToken(userId: string): Promise<string> {
  const tokenPlano = generarTokenPlano();
  const tokenHash = hashToken(tokenPlano);
  const expiresAt = new Date(Date.now() + VENCIMIENTO_HORAS * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } }),
    prisma.emailVerificationToken.create({ data: { userId, tokenHash, expiresAt } }),
  ]);

  return tokenPlano;
}

/**
 * Emite el token y manda el correo. Nunca tira — quien llama decide qué
 * hacer con `ok: false` (el registro deja crear la cuenta igual; el
 * reenvío lo refleja como error legible).
 */
export async function emitirYEnviarVerificacion(user: {
  id: string;
  email: string;
  name: string;
}): Promise<{ ok: boolean; motivo?: string }> {
  const tokenPlano = await emitirToken(user.id);
  const { html, text } = textoCorreo(user.name, enlaceVerificacion(tokenPlano));
  return enviarEmail({ to: user.email, subject: 'Confirmá tu email en Kodu', html, text });
}

export type ResultadoVerificacion = { ok: true } | { ok: false; motivo: 'invalido' | 'vencido' | 'usado' };

/**
 * Nunca revela a quién pertenece un token que falla (decisión del spec de
 * este endpoint) — mismo criterio que `login.ts` con credenciales
 * inválidas: un mensaje genérico sirve para los tres motivos.
 */
export async function verificarToken(tokenPlano: string): Promise<ResultadoVerificacion> {
  const tokenHash = hashToken(tokenPlano);
  const fila = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });

  if (!fila) return { ok: false, motivo: 'invalido' };
  if (fila.usedAt !== null) return { ok: false, motivo: 'usado' };
  if (fila.expiresAt.getTime() < Date.now()) return { ok: false, motivo: 'vencido' };

  await prisma.$transaction([
    prisma.emailVerificationToken.update({ where: { id: fila.id }, data: { usedAt: new Date() } }),
    prisma.user.update({
      where: { id: fila.userId },
      data: { emailVerifiedAt: new Date(), emailVerificationSource: 'EMAIL' },
    }),
  ]);

  // "Unirse ocurre en el momento" (decisión del dueño): recién ahora el email
  // es confiable, así que puede unirse a la organización de su dominio/lista
  // blanca si corresponde.
  await unirSiCorresponde(fila.userId);

  return { ok: true };
}

export type ResultadoReenvio =
  | { ok: true; yaVerificado: boolean }
  | { ok: false; motivo: 'rate_limit'; esperarSegundos: number }
  | { ok: false; motivo: 'envio_fallido'; detalle?: string }
  | { ok: false; motivo: 'sin_cuenta' };

/**
 * odd/tasks/organizaciones.md (T3): reenvío desde el cartel de "cuenta
 * personal" (`CuentaPersonal.astro`/`ReenviarVerificacion.tsx`). Rate limit
 * de 1 por 60s calculado a partir del token MÁS NUEVO de este usuario —
 * nunca hace falta una tabla de rate limiting aparte, `createdAt` alcanza.
 */
export async function reenviarVerificacion(userId: string): Promise<ResultadoReenvio> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, emailVerifiedAt: true },
  });
  if (!user) return { ok: false, motivo: 'sin_cuenta' };
  if (user.emailVerifiedAt !== null) return { ok: true, yaVerificado: true };

  const ultimoToken = await prisma.emailVerificationToken.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  if (ultimoToken) {
    const restanteMs = REENVIO_MIN_SEGUNDOS * 1000 - (Date.now() - ultimoToken.createdAt.getTime());
    if (restanteMs > 0) {
      return { ok: false, motivo: 'rate_limit', esperarSegundos: Math.ceil(restanteMs / 1000) };
    }
  }

  const envio = await emitirYEnviarVerificacion(user);
  if (!envio.ok) return { ok: false, motivo: 'envio_fallido', detalle: envio.motivo };
  return { ok: true, yaVerificado: false };
}
