import { getAdminEmails } from '../env.ts';

/**
 * odd/tasks/organizaciones.md (T1/T2): `AuthorizedDomain` ya no existe — los
 * dominios ahora pertenecen a una organización (`OrganizationDomain`, ver
 * `src/lib/orgs/resolucion.ts`) y la regla de acceso a la IA se mudó a
 * `src/lib/orgs/acceso.ts`. Este archivo se achica a lo que NUNCA dependió de
 * la lista blanca de dominios: normalizar un email y decidir si es un admin
 * por variable de entorno (asunto aparte, no cambia con este cambio).
 *
 * `puedeUsarLaIa` se RE-EXPORTA acá, con el mismo nombre y el mismo import
 * path de siempre, a propósito: `src/pages/api/chat/stream.ts` (otra sesión
 * lo está cambiando en paralelo, feat/generacion-simple-y-reanudable),
 * `verificar.ts` y `autocorreccion.ts` importan `puedeUsarLaIa` desde ACÁ —
 * mudar el símbolo sin mudar el import evita tocar esos tres archivos.
 */
export { puedeUsarLaIa } from '../orgs/acceso.ts';

/** Normaliza el email para comparaciones y persistencia (siempre en minusculas). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string {
  return normalizeEmail(email).split('@')[1] ?? '';
}

export function isAdminEmail(email: string): boolean {
  return getAdminEmails().includes(normalizeEmail(email));
}
