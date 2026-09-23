import { prisma } from './db.ts';
import type { AppSettings } from '../generated/prisma/client.ts';

/**
 * Lectura de `AppSettings`, la fila única de interruptores de toda la app
 * (design.md §9). Caché de 10 segundos + invalidación explícita en cada
 * escritura — el mismo patrón que `catalogo.ts` usa para `AiModel`, acá con
 * un TTL más corto porque `demoEnabled` (M7) se consulta en cada carga de
 * `/login`, no sólo en el chat.
 *
 * T5 (odd/tasks/modo-prime.md) suma cuatro campos (`primeEnabled` y los tres
 * "para todos") a esta misma fila: no hace falta otro lector ni otro caché,
 * `resolverCapacidades` (`lib/ai/capacidades.ts`) los toma de la misma
 * lectura que ya hacía cada request gateado.
 *
 * `specs/app-settings/spec.md` exige que un cambio se refleje "en el
 * siguiente request", nunca atado a la vida del JWT: por eso la caché es
 * corta y de proceso, nunca viaja en la cookie de sesión.
 */
const CACHE_TTL_MS = 10_000;

let cache: { fila: AppSettings; expira: number } | null = null;

/** La fila única. Siempre existe: la migración la sembró con `id = 1`. */
export async function leerAppSettings(): Promise<AppSettings> {
  if (cache && cache.expira > Date.now()) return cache.fila;

  const fila = await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  cache = { fila, expira: Date.now() + CACHE_TTL_MS };
  return fila;
}

/** Se llama desde cada mutación de `AppSettings` (demo, M7). */
export function invalidarAppSettings(): void {
  cache = null;
}
