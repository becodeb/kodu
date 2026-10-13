import { prisma } from '../db.ts';

/**
 * T7 (motor-claude): modos de generación, definidos en CÓDIGO — mismo
 * criterio que `presets.ts` (T7/T9 ahorro-tokens): la clave vive en
 * `AppSettings.generationMode`, nunca se valida contra una tabla, y una
 * clave desconocida (modo sacado del código) cae a `'base'`, nunca un
 * crash. Cada modo mapea un ROL (`creation`, `adjustment`, `reviewer`) a un
 * preset de `presets.ts` + el nivel de esfuerzo con el que se lo llama ESE
 * turno — el esfuerzo del modo pisa el `reasoningEffort` default que
 * quedó guardado en la fila de `AiModel` al enlazarla al preset (un mismo
 * motor puede jugar roles distintos con esfuerzos distintos según el modo
 * activo, ej. Sonnet 5.5 a "low" como revisor en `revisor-sonnet` pero a
 * "medium" como creador en `crea-sonnet`/`todo-sonnet`).
 *
 * `'personalizado'` NO vive en `MODES`: sus dos roles productivos
 * (`creation`/`adjustment`) son motores elegidos a mano por el admin
 * (`AppSettings.creationModelId`/`adjustmentModelId`), no presets — lo
 * resuelve `catalogo.ts#motorParaRol` como un caso aparte.
 *
 * El rol `reviewer` es INFORMATIVO en todos los modos: el mecanismo real de
 * selección del verificador sigue siendo `AiModel.isVerifier`
 * (`catalogo.ts#motorVerificador`, sin cambios de T7) — un modo sólo
 * describe qué preset CONVIENE marcar `isVerifier` para que el modo tenga
 * sentido, y `/admin/generacion` usa ese dato para avisar si el verificador
 * configurado no coincide (nunca para reencaminar el verificador solo).
 */

export interface RoleSpec {
  presetKey: string;
  /** "none" | "low" | "medium" | "high" — el que `anthropicRazonamientoBody`
   *  (provider.ts) ya sabe traducir por modelo. */
  effort: string;
}

export interface GenerationMode {
  key: string;
  label: string;
  /** Para `/admin/generacion`: una línea en español, tono existente. */
  description: string;
  roles: {
    creation: RoleSpec;
    adjustment: RoleSpec;
    reviewer: RoleSpec;
  };
  /** Costo/tiempo medidos en rondas reales (`odd/tasks/motor-claude.md`
   *  §T7) — SÓLO para mostrar en el panel admin, nunca leído por el
   *  reencaminamiento: un número viejo no puede romper un turno. */
  measured: {
    creation: string;
    adjustment: string;
  };
}

const HAIKU_LOW: RoleSpec = { presetKey: 'claude-haiku-5-5', effort: 'low' };
const SONNET_LOW: RoleSpec = { presetKey: 'claude-sonnet-5-5', effort: 'low' };
const SONNET_MEDIUM: RoleSpec = { presetKey: 'claude-sonnet-5-5', effort: 'medium' };
const OPUS_MEDIUM: RoleSpec = { presetKey: 'claude-opus-5-5', effort: 'medium' };

export const MODES: Record<string, GenerationMode> = {
  base: {
    key: 'base',
    label: 'Haiku (recomendado)',
    description: 'Crea y ajusta con Claude Haiku 5.5, esfuerzo bajo. El motor de todos los días: mejor relación calidad/precio (6,2/10 en la prueba a ciegas).',
    roles: { creation: HAIKU_LOW, adjustment: HAIKU_LOW, reviewer: HAIKU_LOW },
    measured: { creation: '≈USD 0,008 · ≈55 s', adjustment: '≈USD 0,006 · ≈40 s (con revisión)' },
  },
  'revisor-sonnet': {
    key: 'revisor-sonnet',
    label: 'Haiku con revisor Sonnet',
    description: 'Igual que el modo base, pero el revisor pasa a Sonnet 5.5 (esfuerzo bajo). Sin medir a ciegas todavía.',
    roles: { creation: HAIKU_LOW, adjustment: HAIKU_LOW, reviewer: SONNET_LOW },
    measured: { creation: '≈USD 0,008 · ≈60 s', adjustment: '≈USD 0,005 · ≈42 s (con revisión)' },
  },
  'crea-sonnet': {
    key: 'crea-sonnet',
    label: 'Sonnet para crear (no recomendado)',
    description: 'Crea con Sonnet 5.5 y ajusta con Haiku. En la prueba a ciegas salió PEOR que todo Haiku (4,2/10): a Haiku le cuesta ajustar código que escribió otro modelo.',
    roles: { creation: SONNET_MEDIUM, adjustment: HAIKU_LOW, reviewer: HAIKU_LOW },
    measured: { creation: '≈USD 0,16 · ≈2 min', adjustment: '≈USD 0,007 · ≈35 s (con revisión)' },
  },
  'crea-opus': {
    key: 'crea-opus',
    label: 'Opus para crear',
    description: 'Crea con Opus 5.5 y ajusta con Haiku. 7,0/10 a ciegas: los ajustes pierden parte de la calidad de Opus.',
    roles: { creation: OPUS_MEDIUM, adjustment: HAIKU_LOW, reviewer: HAIKU_LOW },
    measured: { creation: '≈USD 0,57 · ≈4 min', adjustment: '≈USD 0,04 · ≈26 s (con revisión)' },
  },
  'todo-sonnet': {
    key: 'todo-sonnet',
    label: 'Sonnet para todo',
    description: 'Crea y ajusta con Sonnet 5.5 (esfuerzo medio). 6,6/10 a ciegas: apenas mejor que Haiku a unas 17 veces el precio.',
    roles: { creation: SONNET_MEDIUM, adjustment: SONNET_MEDIUM, reviewer: HAIKU_LOW },
    measured: { creation: '≈USD 0,17 · ≈1,8 min', adjustment: '≈USD 0,07 · ≈55 s' },
  },
  'todo-opus': {
    key: 'todo-opus',
    label: 'Opus para todo',
    description: 'Crea y ajusta con Opus 5.5 (esfuerzo medio). La mejor calidad medida (8,4/10 a ciegas), pero lenta y cara: usala con el tope premium.',
    roles: { creation: OPUS_MEDIUM, adjustment: OPUS_MEDIUM, reviewer: HAIKU_LOW },
    measured: { creation: '≈USD 0,58 · ≈4,5 min', adjustment: '≈USD 0,19 · ≈75 s' },
  },
};

/** No vive en `MODES`: sus roles no son presets, son motores elegidos a
 *  mano (`AppSettings.creationModelId`/`adjustmentModelId`). */
export const MODO_PERSONALIZADO_KEY = 'personalizado';

export function modeByKey(key: string | null | undefined): GenerationMode | null {
  if (!key) return null;
  return MODES[key] ?? null;
}

export function esClaveDeModoConocida(key: string): boolean {
  return key === MODO_PERSONALIZADO_KEY || key in MODES;
}

/** Todas las claves que `/admin/generacion` puede ofrecer en el selector,
 *  en un orden fijo (barato→caro, "personalizado" al final). */
export const ORDEN_MODOS = [
  'base',
  'revisor-sonnet',
  'crea-sonnet',
  'crea-opus',
  'todo-sonnet',
  'todo-opus',
  MODO_PERSONALIZADO_KEY,
] as const;

/**
 * El modo configurado, salvo que el gasto del ciclo ya llegó al tope
 * premium — ahí CUALQUIER modo que no sea `'base'` (incluido
 * `'personalizado'`: el admin pudo haber elegido Sonnet/Opus a mano ahí
 * también) se comporta como `'base'`. Una clave desconocida (modo sacado
 * del código) también cae a `'base'`, sin importar el gasto — nunca un
 * crash por una clave vieja.
 */
export function modoEfectivo(modeKeyConfigurado: string, gastoDelCicloUsd: number, premiumUntilUsd: number): string {
  if (modeKeyConfigurado === 'base') return 'base';
  if (!esClaveDeModoConocida(modeKeyConfigurado)) return 'base';
  if (gastoDelCicloUsd >= premiumUntilUsd) return 'base';
  return modeKeyConfigurado;
}

/**
 * Inicio del ciclo de facturación VIGENTE, en UTC, a partir de
 * `AppSettings.billingCycleDay` (1-28: todo mes tiene al menos 28 días, sin
 * ambigüedad de "día 31"). Si el día de corte de ESTE mes todavía no
 * llegó, el ciclo arrancó el mes anterior — `Date.UTC` con `month - 1`
 * resuelve el cruce de año solo (`Date.UTC(2026, -1, 1)` es diciembre de
 * 2025), no hace falta ninguna rama extra para eso.
 */
export function inicioDelCiclo(billingCycleDay: number, ahora: Date): Date {
  const dia = Math.min(Math.max(Math.trunc(billingCycleDay) || 1, 1), 28);
  const esteMetodo = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), dia, 0, 0, 0, 0));
  if (esteMetodo.getTime() <= ahora.getTime()) return esteMetodo;
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - 1, dia, 0, 0, 0, 0));
}

/** El próximo corte después de `inicio` (mismo día del mes, mes siguiente). */
export function finDelCiclo(billingCycleDay: number, inicio: Date): Date {
  const dia = Math.min(Math.max(Math.trunc(billingCycleDay) || 1, 1), 28);
  return new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, dia, 0, 0, 0, 0));
}

const MS_POR_DIA = 86_400_000;

/**
 * Proyección lineal al cierre del ciclo: `gasto / días transcurridos × días
 * del ciclo`. Los días transcurridos se pisan a un mínimo de 1 hora para
 * que un ciclo recién arrancado no devuelva `Infinity`/`NaN` — a los pocos
 * minutos de un corte, "cuánto se va a gastar este mes" todavía no tiene
 * una base confiable de todos modos, así que un número grande pero finito
 * (en vez de infinito) es el único requisito real acá.
 */
export function proyeccionDeCierre(gastoUsd: number, inicio: Date, fin: Date, ahora: Date): number {
  const diasTranscurridos = Math.max((ahora.getTime() - inicio.getTime()) / MS_POR_DIA, 1 / 24);
  const diasDelCiclo = (fin.getTime() - inicio.getTime()) / MS_POR_DIA;
  return (gastoUsd / diasTranscurridos) * diasDelCiclo;
}

const CACHE_TTL_MS = 60_000;
let cacheGasto: { inicioMs: number; expira: number; totalUsd: number } | null = null;

/**
 * Gasto del ciclo vigente (sólo modelos `apiFormat: "anthropic"` — el
 * crédito mensual del dueño sólo cubre esos), cacheado hasta 60s para que
 * ningún turno pague una consulta de agregación por cada token (T7, "Cache
 * this sum (≤60 s)"). La caché se invalida sola si el `inicio` del ciclo
 * cambió (cruzó un corte, o el admin cambió `billingCycleDay`) — nunca hace
 * falta un invalidador explícito como el de `catalogo.ts`/`settings.ts`
 * porque esto nunca lo escribe un admin directamente.
 *
 * Filas sin `costUsd` (motor sin precio cargado) no entran en la suma —
 * subestimar el gasto es la dirección segura (nunca se inventa un costo),
 * mismo criterio que el resto de `usage.ts`.
 */
export async function gastoDelCicloActual(billingCycleDay: number, ahora: Date = new Date()): Promise<number> {
  const inicio = inicioDelCiclo(billingCycleDay, ahora);

  if (cacheGasto && cacheGasto.inicioMs === inicio.getTime() && cacheGasto.expira > Date.now()) {
    return cacheGasto.totalUsd;
  }

  const resultado = await prisma.tokenUsage.aggregate({
    where: {
      createdAt: { gte: inicio },
      costUsd: { not: null },
      aiModel: { provider: { apiFormat: 'anthropic' } },
    },
    _sum: { costUsd: true },
  });

  const totalUsd = resultado._sum.costUsd?.toNumber() ?? 0;
  cacheGasto = { inicioMs: inicio.getTime(), expira: Date.now() + CACHE_TTL_MS, totalUsd };
  return totalUsd;
}

/** Se llama sólo desde pruebas: fuerza una relectura real en el próximo
 *  `gastoDelCicloActual`. Nunca hace falta en producción (el TTL de 60s ya
 *  alcanza) — existe para que un test no dependa de esperar un minuto real. */
export function invalidarCacheDeGasto(): void {
  cacheGasto = null;
}
