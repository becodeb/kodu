import { getAdminEmails, getAllowedDomains } from '../env.ts';

/** Normaliza el email para comparaciones y persistencia (siempre en minusculas). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string {
  return normalizeEmail(email).split('@')[1] ?? '';
}

/**
 * Lista blanca de dominios institucionales (SPEC.md §1).
 *
 * Acepta coincidencia exacta (`rededucativa.edu.ar`) y comodin de subdominio
 * (`*.edu.ar` habilita `escuela12.edu.ar`).
 * Si la lista esta VACIA, se acepta cualquier dominio. Es una decision tomada:
 * la plataforma se abrio a docentes de cualquier correo. Para volver a
 * restringirla alcanza con poner dominios en ALLOWED_EMAIL_DOMAINS.
 */
export function isAllowedDomain(email: string): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;

  const allowed = getAllowedDomains();
  if (allowed.length === 0) return true;

  return allowed.some((pattern) => {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // "*.edu.ar" -> ".edu.ar"
      return domain.endsWith(suffix);
    }
    return domain === pattern;
  });
}

/** Texto legible con los dominios habilitados, para mostrar en los formularios. */
export function allowedDomainsLabel(): string {
  const allowed = getAllowedDomains();
  if (allowed.length === 0) return 'cualquier correo';
  return allowed.map((domain) => `@${domain}`).join(', ');
}

export function isAdminEmail(email: string): boolean {
  return getAdminEmails().includes(normalizeEmail(email));
}
