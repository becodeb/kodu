import { prisma } from '../db.ts';
import { Prisma } from '../../generated/prisma/client.ts';
import type { ModelChoice } from './provider.ts';

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

export interface UsageByUser {
  userId: string;
  name: string;
  email: string;
  /** `null` en toda fila escrita después de M2 — ver el comentario de arriba. */
  provider: ModelChoice | null;
  promptTokens: number;
  completionTokens: number;
  total: number;
  turnos: number;
}

/** Consumo agrupado por usuario y proveedor, para el panel de administración. */
export async function usageByUser(): Promise<UsageByUser[]> {
  const [grupos, usuarios] = await Promise.all([
    prisma.tokenUsage.groupBy({
      by: ['userId', 'provider'],
      _sum: { promptTokens: true, completionTokens: true },
      _count: { _all: true },
    }),
    prisma.user.findMany({ select: { id: true, name: true, email: true } }),
  ]);

  const porId = new Map(usuarios.map((u) => [u.id, u]));

  return grupos
    .map((grupo) => {
      const promptTokens = grupo._sum.promptTokens ?? 0;
      const completionTokens = grupo._sum.completionTokens ?? 0;
      const usuario = porId.get(grupo.userId);

      return {
        userId: grupo.userId,
        name: usuario?.name ?? '(usuario borrado)',
        email: usuario?.email ?? '',
        provider: grupo.provider,
        promptTokens,
        completionTokens,
        total: promptTokens + completionTokens,
        turnos: grupo._count._all,
      };
    })
    .sort((a, b) => b.total - a.total);
}

export interface ConsumoPorModelo {
  /** `null` = fila histórica (enum viejo, sin motor del catálogo ni costo). */
  aiModelId: string | null;
  etiqueta: string;
  tokens: number;
  costUsd: Prisma.Decimal | null;
  historico: boolean;
}

/**
 * Consumo de UN docente agrupado por motor, para el gráfico de barra
 * apilada del detalle de usuario (M5). Se crea acá (task 4.5) porque
 * `TokenUsage.aiModelId` y las columnas de costo recién existen desde esta
 * migración; M5 sólo tiene que consumir esta función, no volver a leer la
 * tabla.
 *
 * **Limitación conocida, para quien retome esto en M5**: a diferencia de
 * `costoPorProyecto`, acá el `_sum` de Postgres ignora los `NULL` dentro de
 * un mismo grupo en vez de anular el grupo entero. Si un motor tiene turnos
 * con precio cargado Y turnos de antes de cargarlo, el total que devuelve
 * esta función es el de las filas con precio, no `null` — una suma parcial
 * que no se distingue de una completa. No pasa en el flujo normal (una vez
 * que un admin carga el precio de un motor, todas sus filas nuevas lo llevan
 * y las viejas de ESE motor específico no existen porque el motor es nuevo),
 * pero si M5 necesita la misma garantía que `costoPorProyecto`, hay que
 * traer las filas crudas y sumarlas a mano igual que ahí.
 */
export async function consumoPorUsuario(userId: string): Promise<ConsumoPorModelo[]> {
  const [grupos, modelos] = await Promise.all([
    prisma.tokenUsage.groupBy({
      by: ['aiModelId'],
      where: { userId },
      _sum: { promptTokens: true, completionTokens: true, costUsd: true },
    }),
    prisma.aiModel.findMany({ select: { id: true, displayName: true } }),
  ]);

  const nombrePorId = new Map(modelos.map((modelo) => [modelo.id, modelo.displayName]));

  return grupos
    .map((grupo) => {
      const promptTokens = grupo._sum.promptTokens ?? 0;
      const completionTokens = grupo._sum.completionTokens ?? 0;
      const historico = grupo.aiModelId === null;

      return {
        aiModelId: grupo.aiModelId,
        etiqueta: historico ? 'Histórico' : (nombrePorId.get(grupo.aiModelId!) ?? 'Motor eliminado'),
        tokens: promptTokens + completionTokens,
        costUsd: grupo._sum.costUsd,
        historico,
      };
    })
    .sort((a, b) => b.tokens - a.tokens);
}
