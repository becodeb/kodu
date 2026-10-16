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

/** Exportado (T14): `catalogo.ts#motorAutomatico` lo usa como el respaldo de
 *  AJUSTE del modo `automatico` cuando no hay (o ya no sirve) un motor
 *  "pegado" al proyecto — mismo criterio que el resto de los modos
 *  (`crea-sonnet`/`crea-opus`/`todo-sonnet`/`todo-opus` también ajustan en
 *  Haiku cuando no hay nada mejor que hacer). */
export const HAIKU_LOW: RoleSpec = { presetKey: 'claude-haiku-5-5', effort: 'low' };
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
  /**
   * T15 (motor-claude): Haiku crea y ajusta exactamente como el modo
   * `base`; lo único distinto es un paso EXTRA que `stream.ts` dispara
   * después del ciclo de self-test/revisor de la generación inicial (nunca
   * de un ajuste) — ver `src/lib/ai/pulido.ts`. Este registro sólo existe
   * para que `/admin/generacion` lo liste y para que `resolverRolDeModo`
   * sepa qué motor usar en los tres roles; el paso de pulido en sí NO es un
   * rol de este objeto, así que no hay un `RoleSpec` para "pulido" acá.
   */
  'haiku-pulido': {
    key: 'haiku-pulido',
    label: 'Haiku + pulido visual con Sonnet',
    description: 'Crea y ajusta con Haiku 5.5, igual que el modo base. En CADA recurso nuevo, un paso extra con Sonnet 5.5 mejora sólo lo visual (paleta, ilustración, composición) después del self-test — nunca toca lógica, texto ni ids. Experimental, sin medir a ciegas todavía.',
    roles: { creation: HAIKU_LOW, adjustment: HAIKU_LOW, reviewer: HAIKU_LOW },
    measured: { creation: '≈USD 0,008 · ≈55 s (+ pulido, ver panel)', adjustment: '≈USD 0,006 · ≈40 s (con revisión)' },
  },
};

/**
 * T14: clave del modo `automatico`. Vive AFUERA de `MODES` — a diferencia de
 * los modos de arriba, sus roles no son fijos: el rol `creation` de un
 * recurso NUEVO lo decide `tierAutomaticoActual` (abajo, pacing según el
 * crédito del ciclo) y el rol `adjustment` prioriza el motor con el que ESE
 * proyecto nació (`Project.creationModelId`, "stickiness") antes de caer a
 * `HAIKU_LOW` — exactamente el mismo motivo por el que `'personalizado'`
 * tampoco vive en `MODES` (sus roles no son presets fijos).
 */
export const MODO_AUTOMATICO_KEY = 'automatico';

/** No vive en `MODES`: sus roles no son presets, son motores elegidos a
 *  mano (`AppSettings.creationModelId`/`adjustmentModelId`). */
export const MODO_PERSONALIZADO_KEY = 'personalizado';

export function modeByKey(key: string | null | undefined): GenerationMode | null {
  if (!key) return null;
  return MODES[key] ?? null;
}

export function esClaveDeModoConocida(key: string): boolean {
  return key === MODO_PERSONALIZADO_KEY || key === MODO_AUTOMATICO_KEY || key in MODES;
}

/** Todas las claves que `/admin/generacion` puede ofrecer en el selector,
 *  en un orden fijo (barato→caro, "personalizado" al final). `automatico`
 *  va primero (T14, nuevo default recomendado) — el resto no cambia de
 *  orden. */
export const ORDEN_MODOS = [
  MODO_AUTOMATICO_KEY,
  'base',
  'revisor-sonnet',
  'crea-sonnet',
  'crea-opus',
  'todo-sonnet',
  'todo-opus',
  'haiku-pulido',
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
/**
 * Hallazgo de revisión (motor-claude, pre-deploy): el mismo booleano que
 * decide `modoEfectivo` abajo, pero exportado aparte — un motor elegido
 * EXPLÍCITAMENTE por el docente (`Project.engineChosenByTeacher`) no pasa
 * por `modoEfectivo` (ver `catalogo.ts#motorDeGeneracion`), así que
 * necesitaba su propia comparación "¿ya se agotó el presupuesto premium?",
 * duplicada en tres lugares antes de esto.
 */
export function presupuestoPremiumAgotado(gastoDelCicloUsd: number, premiumUntilUsd: number): boolean {
  return gastoDelCicloUsd >= premiumUntilUsd;
}

export function modoEfectivo(modeKeyConfigurado: string, gastoDelCicloUsd: number, premiumUntilUsd: number): string {
  if (modeKeyConfigurado === 'base') return 'base';
  if (!esClaveDeModoConocida(modeKeyConfigurado)) return 'base';
  /**
   * T14: `automatico` NUNCA se recorta por `premiumUntilUsd` — ese tope es
   * el mecanismo de los modos FIJOS (T7), pensado para un modo que siempre
   * pide el mismo motor premium. `automatico` ya decide sólo, recurso por
   * recurso, con su propio pacing contra `monthlyCreditUsd`
   * (`tierAutomaticoActual`) — aplicarle el mismo recorte binario encima
   * sería una segunda política de crédito peleando con la primera.
   */
  if (modeKeyConfigurado === MODO_AUTOMATICO_KEY) return MODO_AUTOMATICO_KEY;
  if (presupuestoPremiumAgotado(gastoDelCicloUsd, premiumUntilUsd)) return 'base';
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

// ---------------------------------------------------------------------------
// T14: pacing del modo `automatico` — decide a qué tier (haiku/sonnet/opus)
// manda un recurso NUEVO. `decidirTierAutomatico` es PURA (sin I/O, para
// poder probarla con fechas/números fijos); `tierAutomaticoActual` es el
// wrapper con efecto que de verdad se llama en producción.
// ---------------------------------------------------------------------------

export type TierAutomatico = 'haiku' | 'sonnet' | 'opus';

export interface CostosPorTierUsd {
  haiku: number;
  sonnet: number;
  opus: number;
}

/**
 * Promedio medido por recurso (generación + ajustes de ese recurso),
 * `odd/tasks/motor-claude.md` §T4/T6/T8. Respaldo cuando no hay todavía
 * ≥20 recursos recientes de ese tier para promediar en vivo desde
 * `TokenUsage`/`AiTrace` (ese promedio en vivo queda para cuando haya
 * volumen real en `automatico` — ver la nota en `tierAutomaticoActual`).
 */
export const COSTO_MEDIDO_POR_RECURSO_USD: CostosPorTierUsd = {
  haiku: 0.019,
  sonnet: 0.32,
  opus: 0.96,
};

const DIAS_ULTIMO_TRAMO = 4;
const FACTOR_SEGURIDAD_OPUS = 1.5;
const MARGEN_SEGURIDAD_OPUS_USD = 10;
const UMBRAL_SONNET = 0.9;
/** Histéresis: una vez en `haiku`, hace falta una proyección más floja
 *  (≤80%, no ≤90%) para volver a `sonnet` — evita el "flapping" de un
 *  gasto que oscila justo alrededor del 90%. */
const UMBRAL_VUELTA_A_SONNET = 0.8;

export interface InsumoPacingAutomatico {
  gastoDelCicloUsd: number;
  monthlyCreditUsd: number;
  inicio: Date;
  fin: Date;
  ahora: Date;
  /** USD/día: últimos 3 días reales si hay datos, si no el promedio del
   *  ciclo hasta ahora (gasto / días transcurridos) — lo decide el
   *  llamador (`tierAutomaticoActual`); esta función sólo lo usa. */
  gastoPromedioDiarioRecienteUsd: number;
  costosPorTier: CostosPorTierUsd;
}

export interface DecisionPacingAutomatico {
  tier: TierAutomatico;
  razon: string;
  diasRestantes: number;
  creditoRestanteUsd: number;
  /** Fin de ciclo = gasto ya hecho + lo que falta del ciclo, al ritmo
   *  reciente RE-ESCALADO al precio de Sonnet (ver el comentario de la
   *  función). Es el número que `/admin/generacion`/`/admin/uso` muestran
   *  como "proyección". */
  proyeccionCierreUsd: number;
  proyeccionRestoCicloConSonnetUsd: number;
}

/**
 * T14 (motor-claude): decide el tier de un recurso NUEVO del modo
 * `automatico`. Pura — ni lee ni cachea nada; `tierAutomaticoActual` abajo
 * hace esa parte.
 *
 * El "ritmo con Sonnet" es una aproximación DELIBERADA: no hay forma de
 * saber, sin guardar qué tier corrió cada recurso reciente, cuántos
 * recursos reales hay detrás del gasto diario reciente — así que se estima
 * esa cantidad dividiendo el gasto reciente por el costo de UN recurso
 * Haiku (el tier por defecto la mayoría del tiempo) y se multiplica esa
 * cantidad por el costo de Sonnet. Determinístico, documentado, y nunca
 * peor que no proyectar nada — exactamente el mismo criterio de
 * "subestimar es la dirección segura" que ya usa `gastoDelCicloActual`.
 */
export function decidirTierAutomatico(
  insumo: InsumoPacingAutomatico,
  tierCacheado: TierAutomatico | null,
): DecisionPacingAutomatico {
  const { gastoDelCicloUsd, monthlyCreditUsd, inicio, fin, ahora, gastoPromedioDiarioRecienteUsd, costosPorTier } = insumo;

  const diasRestantes = Math.max((fin.getTime() - ahora.getTime()) / MS_POR_DIA, 0);
  const creditoRestanteUsd = monthlyCreditUsd - gastoDelCicloUsd;
  const recursosPorDiaReciente = costosPorTier.haiku > 0 ? gastoPromedioDiarioRecienteUsd / costosPorTier.haiku : 0;
  const proyeccionRestoCicloConSonnetUsd = recursosPorDiaReciente * costosPorTier.sonnet * diasRestantes;
  const proyeccionCierreUsd = gastoDelCicloUsd + proyeccionRestoCicloConSonnetUsd;

  const base = { diasRestantes, creditoRestanteUsd, proyeccionCierreUsd, proyeccionRestoCicloConSonnetUsd };

  // Siempre gana esta regla, pase lo que pase con días/proyección: ya no
  // queda crédito, así que un recurso nuevo no puede ser premium.
  if (gastoDelCicloUsd >= monthlyCreditUsd) {
    return { ...base, tier: 'haiku', razon: 'el crédito del ciclo ya se agotó' };
  }

  if (
    diasRestantes <= DIAS_ULTIMO_TRAMO &&
    creditoRestanteUsd >= proyeccionRestoCicloConSonnetUsd * FACTOR_SEGURIDAD_OPUS + MARGEN_SEGURIDAD_OPUS_USD
  ) {
    return {
      ...base,
      tier: 'opus',
      razon: `quedan ${diasRestantes.toFixed(1)} días del ciclo y el crédito restante (USD ${creditoRestanteUsd.toFixed(2)}) sobra para no desperdiciarlo`,
    };
  }

  const umbral = tierCacheado === 'haiku' ? UMBRAL_VUELTA_A_SONNET : UMBRAL_SONNET;
  const umbralUsd = monthlyCreditUsd * umbral;
  if (proyeccionCierreUsd <= umbralUsd) {
    return {
      ...base,
      tier: 'sonnet',
      razon: `la proyección de cierre (USD ${proyeccionCierreUsd.toFixed(2)}) no pasa el ${Math.round(umbral * 100)}% del crédito mensual (USD ${umbralUsd.toFixed(2)})`,
    };
  }

  return {
    ...base,
    tier: 'haiku',
    razon: `la proyección de cierre (USD ${proyeccionCierreUsd.toFixed(2)}) ya pasa el ${Math.round(umbral * 100)}% del crédito mensual (USD ${umbralUsd.toFixed(2)})`,
  };
}

async function gastoUltimosNDiasUsd(ahora: Date, dias: number): Promise<number> {
  const desde = new Date(ahora.getTime() - dias * MS_POR_DIA);
  const resultado = await prisma.tokenUsage.aggregate({
    where: {
      createdAt: { gte: desde, lte: ahora },
      costUsd: { not: null },
      aiModel: { provider: { apiFormat: 'anthropic' } },
    },
    _sum: { costUsd: true },
  });
  return resultado._sum.costUsd?.toNumber() ?? 0;
}

const CACHE_TIER_TTL_MS = 5 * 60_000;
let cacheTier: { inicioMs: number; expira: number; decision: DecisionPacingAutomatico } | null = null;

/**
 * Wrapper con efecto de `decidirTierAutomatico`: lee el gasto del ciclo
 * (ya cacheado 60s por `gastoDelCicloActual`) y el gasto de los últimos 3
 * días reales, y cachea la DECISIÓN completa 5 minutos (T14: "cache the
 * decision ≤5 min") — dentro de esos 5 min, ningún turno paga una
 * proyección nueva y la histéresis ve el mismo `tierCacheado` que el
 * último cálculo real. La caché se invalida sola si cambia el `inicio` del
 * ciclo, igual que `gastoDelCicloActual`.
 *
 * `costosPorTier` queda fijo en los valores medidos (`COSTO_MEDIDO_POR_
 * RECURSO_USD`) por ahora — el promedio EN VIVO desde `TokenUsage`/
 * `AiTrace` cuando haya ≥20 recursos de `automatico` queda abierto para una
 * ronda futura (necesita acumular volumen real primero).
 */
export async function tierAutomaticoActual(
  settings: { billingCycleDay: number; monthlyCreditUsd: number; premiumUntilUsd: number },
  ahora: Date = new Date(),
): Promise<DecisionPacingAutomatico> {
  const inicio = inicioDelCiclo(settings.billingCycleDay, ahora);

  if (cacheTier && cacheTier.inicioMs === inicio.getTime() && cacheTier.expira > Date.now()) {
    return cacheTier.decision;
  }

  const fin = finDelCiclo(settings.billingCycleDay, inicio);
  const gastoDelCicloUsd = await gastoDelCicloActual(settings.billingCycleDay, ahora);
  const diasTranscurridos = Math.max((ahora.getTime() - inicio.getTime()) / MS_POR_DIA, 1 / 24);

  let gastoPromedioDiarioRecienteUsd = (await gastoUltimosNDiasUsd(ahora, 3)) / 3;
  if (gastoPromedioDiarioRecienteUsd <= 0) {
    gastoPromedioDiarioRecienteUsd = gastoDelCicloUsd / diasTranscurridos;
  }

  const decision = decidirTierAutomatico(
    {
      gastoDelCicloUsd,
      monthlyCreditUsd: settings.monthlyCreditUsd,
      inicio,
      fin,
      ahora,
      gastoPromedioDiarioRecienteUsd,
      costosPorTier: COSTO_MEDIDO_POR_RECURSO_USD,
    },
    cacheTier?.decision.tier ?? null,
  );

  cacheTier = { inicioMs: inicio.getTime(), expira: Date.now() + CACHE_TIER_TTL_MS, decision };
  return decision;
}

/** Sólo para pruebas: ver `invalidarCacheDeGasto`. */
export function invalidarCacheDeTierAutomatico(): void {
  cacheTier = null;
}
