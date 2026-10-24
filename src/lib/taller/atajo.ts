/**
 * /taller: atajo tipeable al enlace de invitación de un taller presencial.
 * Los asistentes entran desde una compu, donde nadie escanea un QR, y el
 * enlace real (`/invitacion/<token>`) es demasiado largo para dictarlo.
 *
 * Sólo se aceptan invitaciones de ESTE sitio y siempre se devuelve una ruta
 * relativa: aunque `TALLER_INVITE_URL` traiga otro dominio, /taller nunca
 * puede usarse como redirect abierto hacia afuera.
 */

const TOKEN = /^[A-Za-z0-9_-]+$/;

/** La ruta de la invitación a partir del enlace completo o del token solo;
 *  `null` si el valor no tiene forma de invitación. */
export function rutaDeInvitacionDelTaller(valor: string): string | null {
  const limpio = valor.trim();
  if (!limpio) return null;

  if (TOKEN.test(limpio)) return `/invitacion/${limpio}`;

  const coincidencia = /\/invitacion\/([^/?#]+)\/?(?:[?#].*)?$/.exec(limpio);
  const token = coincidencia?.[1];
  if (!token || !TOKEN.test(token)) return null;
  return `/invitacion/${token}`;
}
