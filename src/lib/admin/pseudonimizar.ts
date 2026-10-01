import { createHmac } from 'node:crypto';

/**
 * odd/tasks/ahorro-tokens.md (T4): pseudonimización estable para el export
 * de trazas — nunca un email, nunca un nombre, pero el mismo docente/
 * organización siempre produce el mismo pseudónimo (para poder agrupar
 * filas del mismo autor sin poder volver al id real sin la clave).
 *
 * Decisión del dueño: "keyed by AUTH_SECRET" (texto de la tarea) — a
 * propósito, aunque el resto del código evita reusar una clave entre
 * propósitos distintos (ver `src/lib/crypto/secretos.ts`): la pseudonimi-
 * zación es unidireccional (HMAC, no cifrado — nunca hay nada que
 * desencriptar), así que no hay el mismo riesgo de key-reuse que tendría
 * compartir una clave de cifrado simétrico. `prefijo` evita que un id de
 * usuario y uno de organización con el mismo valor crudo (no pasa hoy, pero
 * no cuesta nada evitarlo) pseudonimicen igual.
 */
export function pseudonimizar(id: string, secreto: string, prefijo: 'docente' | 'org'): string {
  const hash = createHmac('sha256', secreto).update(`${prefijo}:${id}`).digest('hex').slice(0, 16);
  return `${prefijo}_${hash}`;
}
