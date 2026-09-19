import { prisma } from '../db.ts';
import { getAdminEmails } from '../env.ts';

/**
 * Acceso a la IA por dominio, con permiso individual de admin encima
 * (design.md §10). Desde M6 esto NO gatea el registro ni el login — sólo el
 * USO de la IA (`src/pages/api/chat/stream.ts`). `isAdminEmail` sigue leyendo
 * `ADMIN_EMAILS` del entorno: es un asunto separado y no cambia acá.
 */

/** Normaliza el email para comparaciones y persistencia (siempre en minusculas). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string {
  return normalizeEmail(email).split('@')[1] ?? '';
}

/**
 * 10 segundos, igual que `settings.ts`: un admin que agrega un dominio lo ve
 * reflejado en el próximo pedido, sin redeploy (specs/ai-access-control/spec.md
 * — "Admin adds a domain without redeploy").
 */
const CACHE_TTL_MS = 10_000;

let cache: { patrones: string[]; expira: number } | null = null;

async function leerDominiosAutorizados(): Promise<string[]> {
  if (cache && cache.expira > Date.now()) return cache.patrones;

  const filas = await prisma.authorizedDomain.findMany({ select: { pattern: true } });
  const patrones = filas.map((fila) => fila.pattern);
  cache = { patrones, expira: Date.now() + CACHE_TTL_MS };
  return patrones;
}

/** Se llama desde cada mutación de `/api/admin/domains/*`. */
export function invalidarDominios(): void {
  cache = null;
}

/**
 * El matcher, portado sin tocar de la versión vieja basada en env var
 * (`domains.ts:28-34` antes de M6): comodín de subdominio (`*.edu.ar` ->
 * sufijo `.edu.ar`, matchea `escuela12.edu.ar` pero NO el propio `edu.ar`) y
 * coincidencia exacta en cualquier otro caso. Se mantiene esta asimetría a
 * propósito — es comportamiento existente, y cambiarla en silencio ampliaría
 * o achicaría el acceso de alguien sin que nadie lo haya decidido.
 */
function coincideDominio(domain: string, patrones: string[]): boolean {
  return patrones.some((pattern) => {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // "*.edu.ar" -> ".edu.ar"
      return domain.endsWith(suffix);
    }
    return domain === pattern;
  });
}

/**
 * Solo la regla de dominio, sin el permiso individual — la usa la tabla de
 * `/admin/usuarios` para distinguir "Sí · por dominio" de "No" cuando
 * `aiAccessOverride` es `null` (ver `puedeUsarLaIa` para la regla completa).
 *
 * Lista vacía = permitido, calcando el comportamiento de hoy
 * (`getAllowedDomains().length === 0` en la versión vieja): si significara lo
 * contrario, esta migración le sacaría el acceso a la IA a todos los docentes
 * el mismo día que se despliega — un apagón fabricado por una decisión
 * semántica, no por nadie pidiéndolo.
 */
export async function dominioAutorizado(email: string): Promise<boolean> {
  const domain = emailDomain(email);
  if (!domain) return false;

  const patrones = await leerDominiosAutorizados();
  if (patrones.length === 0) return true;

  return coincideDominio(domain, patrones);
}

/**
 * La regla completa de acceso a la IA (design.md §10, tabla de precedencia
 * exacta):
 *
 * | aiAccessOverride | resultado                                    |
 * |---|---|
 * | true  | permitido, sin importar el dominio (grant explícito)  |
 * | false | denegado, sin importar el dominio (revocación explícita) |
 * | null  | sigue la regla de dominio (`dominioAutorizado`)       |
 */
export async function puedeUsarLaIa(user: {
  email: string;
  aiAccessOverride: boolean | null;
}): Promise<boolean> {
  if (user.aiAccessOverride !== null) return user.aiAccessOverride;
  return dominioAutorizado(user.email);
}

export function isAdminEmail(email: string): boolean {
  return getAdminEmails().includes(normalizeEmail(email));
}
