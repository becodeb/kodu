/**
 * odd/tasks/planes-y-cobros.md (T1): dominios de email públicos, rechazados
 * al dar de alta una institución (decisión de diseño: "dominios públicos
 * (gmail, hotmail, outlook, yahoo, etc.) rechazados" — T5 los usa para
 * validar el formulario de alta). Módulo PURO.
 */

/** En minúsculas, sin "@", sin espacios. Lo que llega de un formulario suele
 *  traer "@dominio.com" o mayúsculas mezcladas. */
export function normalizarDominio(domain: string): string {
  let d = domain.trim().toLowerCase();
  const arroba = d.lastIndexOf('@');
  if (arroba >= 0) d = d.slice(arroba + 1);
  return d;
}

/**
 * Webmails masivos y los ISP argentinos más comunes que dan casillas de
 * correo personales — nadie contrata Kodu institucionalmente con uno de
 * estos como "el dominio del colegio".
 */
const DOMINIOS_PUBLICOS = new Set<string>([
  // Webmails masivos.
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.com.ar',
  'hotmail.es',
  'outlook.com',
  'outlook.com.ar',
  'outlook.es',
  'live.com',
  'live.com.ar',
  'msn.com',
  'yahoo.com',
  'yahoo.com.ar',
  'icloud.com',
  'me.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'gmx.net',
  'yandex.com',
  'yandex.ru',
  'zoho.com',
  'mail.com',
  // ISPs argentinos que reparten casillas @proveedor a sus abonados.
  'fibertel.com.ar',
  'arnet.com.ar',
  'speedy.com.ar',
  'personal.com.ar',
  'telecentro.com.ar',
]);

export function isPublicEmailDomain(domain: string): boolean {
  return DOMINIOS_PUBLICOS.has(normalizarDominio(domain));
}
