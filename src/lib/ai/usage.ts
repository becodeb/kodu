import { prisma } from '../db.ts';
import { Prisma } from '../../generated/prisma/client.ts';

/**
 * Registro de tokens por usuario y proveedor.
 *
 * Sirve para tres cosas distintas: hacer cumplir el tope del proveedor pago
 * (antes de gastar, no después), poder mirar quién consume cuánto sin tener
 * que entrar a la consola del proveedor, y — desde M4 — congelar cuánto costó
 * cada turno con los precios vigentes ese día (design.md §6).
 */

/** Los tres precios de un motor, en USD por millón de tokens (`AiModel`). */
export interface Precios {
  input: Prisma.Decimal;
  output: Prisma.Decimal;
  /** `null` cuando el motor no tiene una tarifa de caché propia cargada. */
  cachedInput: Prisma.Decimal | null;
}

export interface CostoCalculado {
  /** `null` si `precios` era `null`: nunca se inventa un costo. */
  costUsd: Prisma.Decimal | null;
  priceInputSnapshot: Prisma.Decimal | null;
  priceOutputSnapshot: Prisma.Decimal | null;
  /** La tarifa REALMENTE aplicada a los tokens cacheados (ver más abajo). */
  priceCachedInputSnapshot: Prisma.Decimal | null;
}

/**
 * El cálculo de costo de UN turno (design.md §6).
 *
 * `promptTokens` en el dialecto OpenAI INCLUYE los tokens cacheados — no son
 * un balde aparte, son un subconjunto (`prompt_tokens_details.cached_tokens`,
 * ver `provider.ts`). Facturar los dos enteros duplica el cobro de la porción
 * cacheada en cada turno después del primero de un hilo, porque en esta app
 * el system prompt y las reglas se reenvían idénticos en cada turno. La resta
 * de `facturables` es exactamente la corrección de eso.
 *
 * Si `precios` es `null` (el motor tiene algún precio sin cargar), el
 * resultado entero es `null` — nunca se fabrica un costo ni parcial.
 *
 * `priceCachedInputSnapshot` guarda la tarifa que se USÓ de verdad, no la
 * columna cruda de `AiModel`: si el motor no tiene una tarifa de caché propia
 * cargada, los tokens cacheados se facturan a la tarifa de entrada normal (la
 * misma regla que aplica el cálculo de `costUsd` un poco más abajo), y ese es
 * el número que hace falta guardar para que alguien pueda recalcular el total
 * a partir de los tres snapshots y que dé exactamente lo mismo.
 */
export function calcularCostoTurno(
  promptTokens: number,
  cachedInputTokens: number,
  completionTokens: number,
  precios: Precios | null,
): CostoCalculado {
  if (!precios) {
    return {
      costUsd: null,
      priceInputSnapshot: null,
      priceOutputSnapshot: null,
      priceCachedInputSnapshot: null,
    };
  }

  // Defensivo: si algún día un proveedor reporta cachedTokens > promptTokens
  // (dato mal formado), no se factura una cantidad negativa de tokens nuevos.
  const facturables = Math.max(promptTokens - cachedInputTokens, 0);
  const tarifaCache = precios.cachedInput ?? precios.input;

  const costUsd = new Prisma.Decimal(facturables)
    .mul(precios.input)
    .div(1_000_000)
    .add(new Prisma.Decimal(cachedInputTokens).mul(tarifaCache).div(1_000_000))
    .add(new Prisma.Decimal(completionTokens).mul(precios.output).div(1_000_000));

  return {
    costUsd,
    priceInputSnapshot: precios.input,
    priceOutputSnapshot: precios.output,
    priceCachedInputSnapshot: tarifaCache,
  };
}

/**
 * El registro de un turno, ya sobre el catálogo (`AiModel`): `provider` (el
 * enum viejo) queda afuera a propósito — es dato histórico, no algo que las
 * filas nuevas vuelvan a escribir (ver design.md §3). La columna admite NULL
 * desde la migración de M2, así que Prisma la deja así sin que se la pase.
 */
export interface UsageRecord {
  userId: string;
  /** El recurso en el que se gastó el turno. */
  projectId: string;
  aiModelId: string;
  model: string;
  promptTokens: number;
  /** Subconjunto de `promptTokens` — ver `calcularCostoTurno`. */
  cachedInputTokens: number;
  completionTokens: number;
  /** Los precios vigentes del motor usado, ya resueltos (`ProviderConfig.precios`). */
  precios: Precios | null;
}

export async function recordUsage(record: UsageRecord): Promise<void> {
  // Un turno que no gastó nada no se registra: ensucia la tabla y no aporta.
  if (record.promptTokens <= 0 && record.completionTokens <= 0) return;

  const costo = calcularCostoTurno(
    record.promptTokens,
    record.cachedInputTokens,
    record.completionTokens,
    record.precios,
  );

  await prisma.tokenUsage.create({
    data: {
      userId: record.userId,
      projectId: record.projectId,
      aiModelId: record.aiModelId,
      model: record.model,
      promptTokens: record.promptTokens,
      cachedInputTokens: record.cachedInputTokens,
      completionTokens: record.completionTokens,
      costUsd: costo.costUsd,
      priceInputSnapshot: costo.priceInputSnapshot,
      priceOutputSnapshot: costo.priceOutputSnapshot,
      priceCachedInputSnapshot: costo.priceCachedInputSnapshot,
    },
  });
}

/** Tokens acumulados por un usuario en UN motor puntual (prompt + respuesta). */
export async function consumedTokens(userId: string, aiModelId: string): Promise<number> {
  const total = await prisma.tokenUsage.aggregate({
    where: { userId, aiModelId },
    _sum: { promptTokens: true, completionTokens: true },
  });

  return (total._sum.promptTokens ?? 0) + (total._sum.completionTokens ?? 0);
}

// ─────────────────────────────────────────────────────────────
// El indicador de consumo del workspace (design.md — "The workspace cost
// indicator"). Dos constantes, no dos números sueltos en el JSX.
// ─────────────────────────────────────────────────────────────

/** Los cortes son arbitrarios: están calibrados a ojo, no derivados de nada. */
export const CONSUMO_MEDIO = 250_000; // ~15 turnos de trabajo pesado
export const CONSUMO_ALTO = 1_000_000;

export type NivelConsumo = 'bajo' | 'medio' | 'alto';

/** El indicador SIEMPRE se calcula sobre tokens, nunca sobre dólares (design.md). */
export function nivelDeConsumo(tokens: number): NivelConsumo {
  if (tokens >= CONSUMO_ALTO) return 'alto';
  if (tokens >= CONSUMO_MEDIO) return 'medio';
  return 'bajo';
}

export interface CostoPorProyecto {
  tokens: number;
  /**
   * `null` cuando NINGUNA fila del proyecto tiene un costo conocido, O
   * cuando alguna fila lo tiene y otra no: un total parcial que se ve
   * completo es peor que decir "no se sabe" (design.md — "nunca se inventa
   * un costo").
   */
  costUsd: Prisma.Decimal | null;
}

/** El consumo de UN recurso, para el indicador del workspace (M4). */
export async function costoPorProyecto(projectId: string): Promise<CostoPorProyecto> {
  const filas = await prisma.tokenUsage.findMany({
    where: { projectId },
    select: { promptTokens: true, completionTokens: true, costUsd: true },
  });

  if (filas.length === 0) return { tokens: 0, costUsd: null };

  const tokens = filas.reduce((total, fila) => total + fila.promptTokens + fila.completionTokens, 0);

  const conFilaSinPrecio = filas.some((fila) => fila.costUsd === null);
  if (conFilaSinPrecio) return { tokens, costUsd: null };

  const costUsd = filas.reduce((total, fila) => total.add(fila.costUsd!), new Prisma.Decimal(0));
  return { tokens, costUsd };
}

export interface ConsumoPorModelo {
  /** `null` = fila histórica (enum viejo, sin motor del catálogo ni costo). */
  aiModelId: string | null;
  etiqueta: string;
  tokens: number;
  /** `null` cuando ALGUNA fila del grupo no tiene costo conocido — ver abajo. */
  costUsd: Prisma.Decimal | null;
  historico: boolean;
}

/**
 * Consumo de UN docente agrupado por motor, para el gráfico de barra
 * apilada del detalle de usuario (M5).
 *
 * Trae las filas crudas y agrupa a mano en vez de usar `groupBy`+`_sum` de
 * Prisma: el `_sum` de Postgres ignora los `NULL` dentro de un mismo grupo
 * en vez de anular el grupo entero, así que un motor con turnos de antes y
 * después de cargarle un precio mostraría una suma parcial indistinguible de
 * una completa. Mismo criterio todo-o-nada que `costoPorProyecto` — una fila
 * sin costo conocido alcanza para volver `null` el total de SU grupo, nunca
 * un número que se ve completo y no lo es.
 */
export async function consumoPorUsuario(userId: string): Promise<ConsumoPorModelo[]> {
  const [filas, modelos] = await Promise.all([
    prisma.tokenUsage.findMany({
      where: { userId },
      select: { aiModelId: true, promptTokens: true, completionTokens: true, costUsd: true },
    }),
    prisma.aiModel.findMany({ select: { id: true, displayName: true } }),
  ]);

  const nombrePorId = new Map(modelos.map((modelo) => [modelo.id, modelo.displayName]));

  const grupos = new Map<string | null, { tokens: number; costUsd: Prisma.Decimal; sinPrecio: boolean }>();
  for (const fila of filas) {
    const previo = grupos.get(fila.aiModelId) ?? {
      tokens: 0,
      costUsd: new Prisma.Decimal(0),
      sinPrecio: false,
    };
    previo.tokens += fila.promptTokens + fila.completionTokens;
    if (fila.costUsd === null) previo.sinPrecio = true;
    else previo.costUsd = previo.costUsd.add(fila.costUsd);
    grupos.set(fila.aiModelId, previo);
  }

  return Array.from(grupos.entries())
    .map(([aiModelId, datos]) => {
      const historico = aiModelId === null;
      return {
        aiModelId,
        etiqueta: historico ? 'Histórico' : (nombrePorId.get(aiModelId!) ?? 'Motor eliminado'),
        tokens: datos.tokens,
        costUsd: datos.sinPrecio ? null : datos.costUsd,
        historico,
      };
    })
    .sort((a, b) => b.tokens - a.tokens);
}

export interface CostoTotalUsuario {
  tokens: number;
  /** Mismo criterio todo-o-nada que `costoPorProyecto`: una fila sin costo
   *  conocido vuelve `null` el total entero. */
  costUsd: Prisma.Decimal | null;
}

/** Consumo TOTAL (todo el tiempo) de un docente, para el trío de estadísticas
 *  del detalle de usuario (M5). */
export async function costoTotalDeUsuario(userId: string): Promise<CostoTotalUsuario> {
  const filas = await prisma.tokenUsage.findMany({
    where: { userId },
    select: { promptTokens: true, completionTokens: true, costUsd: true },
  });

  if (filas.length === 0) return { tokens: 0, costUsd: null };

  const tokens = filas.reduce((total, fila) => total + fila.promptTokens + fila.completionTokens, 0);

  const conFilaSinPrecio = filas.some((fila) => fila.costUsd === null);
  if (conFilaSinPrecio) return { tokens, costUsd: null };

  const costUsd = filas.reduce((total, fila) => total.add(fila.costUsd!), new Prisma.Decimal(0));
  return { tokens, costUsd };
}

export interface ConsumoDiario {
  /** `YYYY-MM-DD`, en UTC. */
  fecha: string;
  tokens: number;
}

export interface ConsumoPeriodo {
  /** Siempre `dias` casilleros, uno por día, aunque no haya uso ese día —
   *  así el gráfico de columnas dibuja una grilla completa en vez de un
   *  arreglo salteado. */
  porDia: ConsumoDiario[];
  tokens: number;
  /** Mismo criterio todo-o-nada que `costoPorProyecto`, acotado a la ventana. */
  costUsd: Prisma.Decimal | null;
}

/**
 * Consumo de un docente día por día en los últimos `dias` (30 por defecto),
 * para `GraficoColumnas.tsx` (M5). Es una ventana de tiempo, no "todo el
 * historial" — por eso vive separada de `costoTotalDeUsuario`, que sí es
 * all-time (design.md — "Consumption over the last 30 days").
 */
export async function consumoDiarioDeUsuario(userId: string, dias = 30): Promise<ConsumoPeriodo> {
  const desde = new Date();
  desde.setUTCHours(0, 0, 0, 0);
  desde.setUTCDate(desde.getUTCDate() - (dias - 1));

  const filas = await prisma.tokenUsage.findMany({
    where: { userId, createdAt: { gte: desde } },
    select: { promptTokens: true, completionTokens: true, costUsd: true, createdAt: true },
  });

  const porDiaMapa = new Map<string, number>();
  for (let i = 0; i < dias; i++) {
    const dia = new Date(desde);
    dia.setUTCDate(dia.getUTCDate() + i);
    porDiaMapa.set(dia.toISOString().slice(0, 10), 0);
  }

  let tokens = 0;
  let costUsd = new Prisma.Decimal(0);
  let sinPrecio = false;

  for (const fila of filas) {
    const clave = fila.createdAt.toISOString().slice(0, 10);
    const total = fila.promptTokens + fila.completionTokens;
    porDiaMapa.set(clave, (porDiaMapa.get(clave) ?? 0) + total);
    tokens += total;
    if (fila.costUsd === null) sinPrecio = true;
    else costUsd = costUsd.add(fila.costUsd);
  }

  const porDia = Array.from(porDiaMapa.entries()).map(([fecha, tokens]) => ({ fecha, tokens }));

  return {
    porDia,
    tokens,
    costUsd: filas.length === 0 ? null : sinPrecio ? null : costUsd,
  };
}
