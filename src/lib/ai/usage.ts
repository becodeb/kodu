import { prisma } from '../db.ts';
import { Prisma, type UsagePurpose, type EditMode } from '../../generated/prisma/client.ts';
import { debitUsage } from '../billing/creditos-servicio.ts';
import { precioVigente, type PriceSchedule } from './pricing.ts';

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
 * odd/tasks/planes-y-cobros.md (T2b): conservador a propósito — más caro que
 * cualquier motor real cargado hoy en el catálogo (ver `prisma/seed.ts`),
 * para que subestimar el costo real de un motor sin precio nunca le salga
 * gratis a Kodu. Sólo se usa cuando NI el turno concreto NI el motor default
 * del catálogo tienen un precio cargado — el caso normal (motor default con
 * precio) usa ESE precio, más ajustado a la realidad.
 */
const FALLBACK_PRICE_INPUT_PER_M_USD = 5;
const FALLBACK_PRICE_OUTPUT_PER_M_USD = 15;

/**
 * odd/tasks/planes-y-cobros.md (T2b, encontrado en T2): `recordUsage` NUNCA
 * debitaba nada a una cuenta personal cuando el motor usado no tenía precio
 * cargado (`costUsd` queda `null` — "nunca se inventa un costo", ver
 * `calcularCostoTurno`) — un docente podía generar gratis sin límite con
 * cualquier motor al que el superadmin todavía no le cargó precio.
 *
 * Esta función estima un costo CONSERVADOR sólo para decidir CUÁNTOS
 * CRÉDITOS debitar (nunca toca `TokenUsage.costUsd`, que sigue `null` — el
 * resto del código sigue leyendo "null = costo real desconocido" sin que
 * este débito lo contradiga): primero intenta con el precio del motor
 * DEFAULT del catálogo (`AiModel.isDefault`, si tiene los tres precios
 * cargados); si tampoco hay default con precio, usa el precio fijo de
 * arriba. Devuelve `0` (nunca negativo) si ni con la estimación hay nada que
 * cobrar (tokens en 0).
 */
export async function estimarCostoConservador(
  promptTokens: number,
  cachedInputTokens: number,
  completionTokens: number,
): Promise<Prisma.Decimal> {
  const modeloDefault = await prisma.aiModel.findFirst({
    where: { isDefault: true },
    select: { priceInputPerMToken: true, priceOutputPerMToken: true, priceCachedInputPerMToken: true },
  });

  const precios: Precios =
    modeloDefault?.priceInputPerMToken && modeloDefault?.priceOutputPerMToken
      ? {
          input: modeloDefault.priceInputPerMToken,
          output: modeloDefault.priceOutputPerMToken,
          cachedInput: modeloDefault.priceCachedInputPerMToken,
        }
      : {
          input: new Prisma.Decimal(FALLBACK_PRICE_INPUT_PER_M_USD),
          output: new Prisma.Decimal(FALLBACK_PRICE_OUTPUT_PER_M_USD),
          cachedInput: null,
        };

  // `precios` nunca es `null` acá, así que `calcularCostoTurno` tampoco
  // devuelve `costUsd: null`.
  return calcularCostoTurno(promptTokens, cachedInputTokens, completionTokens, precios).costUsd!;
}

/**
 * El registro de un turno, ya sobre el catálogo (`AiModel`): `provider` (el
 * enum viejo) queda afuera a propósito — es dato histórico, no algo que las
 * filas nuevas vuelvan a escribir (ver design.md §3). La columna admite NULL
 * desde la migración de M2, así que Prisma la deja así sin que se la pase.
 */
export interface UsageRecord {
  userId: string;
  /** El recurso en el que se gastó el turno. `null` sólo en el Taller de
   *  ideas (`IDEATION`): la charla existe antes que el recurso. */
  projectId: string | null;
  aiModelId: string;
  model: string;
  promptTokens: number;
  /** Subconjunto de `promptTokens` — ver `calcularCostoTurno`. */
  cachedInputTokens: number;
  completionTokens: number;
  /** El precio DE PICO del motor usado, ya resuelto (`ProviderConfig.precios`).
   *  El precio REALMENTE aplicado sale de combinarlo con `schedule` y `at`
   *  más abajo (odd/tasks/ahorro-tokens.md, T1). */
  precios: Precios | null;
  /** odd/tasks/ahorro-tokens.md (T1): el horario de pico del motor usado
   *  (`ProviderConfig.schedule`). `null`/`undefined` = sin horario, el
   *  comportamiento de siempre (precio de pico sin importar la hora). */
  schedule?: PriceSchedule | null;
  /**
   * odd/tasks/ahorro-tokens.md (T1): el momento del turno, para resolver el
   * precio vigente contra `schedule`. Por defecto el momento en que se llama
   * a `recordUsage` — en la práctica el turno ya terminó para entonces, así
   * que es la misma aproximación que ya hace `TokenUsage.createdAt`
   * (`@default(now())`, escrito unas líneas más abajo en esta misma
   * llamada).
   */
  at?: Date;
  /**
   * odd/tasks/organizaciones.md (T5): para qué fue esta llamada. REQUERIDO
   * (no opcional) a propósito — así ningún llamador nuevo se olvida de
   * clasificarla; las filas históricas (de antes de esta columna) son las
   * únicas con `purpose: null`, y esas nunca se escriben por acá.
   */
  purpose: UsagePurpose;
  /**
   * odd/tasks/ahorro-tokens.md (T3a): cómo se escribió el código en este
   * turno (ver el enum `EditMode`). `null`/`undefined` para cualquier turno
   * que no escribe código, o para un motor que no ofrece la edición por
   * fragmentos — mismo criterio "nunca inventar un dato" que el resto de
   * los campos opcionales de este registro.
   */
  editMode?: 'full' | 'fragments' | 'fragments_fallback' | null;
}

/** odd/tasks/ahorro-tokens.md (T3a): `UsageRecord.editMode` (minúsculas,
 *  vocabulario del llamador) al enum de Prisma. `undefined`/`null` pasa. */
function editModeAEnum(editMode: UsageRecord['editMode']): EditMode | null {
  switch (editMode) {
    case 'full':
      return 'FULL';
    case 'fragments':
      return 'FRAGMENTS';
    case 'fragments_fallback':
      return 'FRAGMENTS_FALLBACK';
    default:
      return null;
  }
}

/** GENERATION/CHECKLIST/EXTRA_VERSION nacen de un recurso nuevo;
 *  ADJUSTMENT nunca. CORRECTION/VERIFICATION no tienen opinión propia: la
 *  heredan (ver `forNewResourceHeredado`). */
function forNewResourceDirecto(purpose: UsagePurpose): boolean | null {
  switch (purpose) {
    case 'GENERATION':
    case 'CHECKLIST':
    case 'EXTRA_VERSION':
      return true;
    case 'ADJUSTMENT':
      return false;
    default:
      return null;
  }
}

/**
 * CORRECTION y VERIFICATION son llamadas AUXILIARES: no las dispara un
 * turno de docente nuevo, las dispara el CLIENTE después de que un turno ya
 * terminó (la autoprueba que falló, o un pedido explícito de verificación).
 * Tocar ese cliente para que mande "esto fue sobre un recurso nuevo o un
 * ajuste" está fuera de alcance de T5 (y sería frágil: el cliente ni
 * siempre sabe distinguirlo). En cambio, el SERVIDOR puede inferir a qué
 * turno pertenecen: son del mismo proyecto y del mismo docente que el turno
 * más reciente que sí lo sabía, así que se hereda de la última fila
 * GENERATION/ADJUSTMENT de ese proyecto y ese usuario. Sin `projectId`, o
 * sin ninguna fila así, el resultado es `null` (nunca se inventa un valor).
 */
async function forNewResourceHeredado(projectId: string | null, userId: string): Promise<boolean | null> {
  if (!projectId) return null;

  const ultima = await prisma.tokenUsage.findFirst({
    where: { projectId, userId, purpose: { in: ['GENERATION', 'ADJUSTMENT'] } },
    orderBy: { createdAt: 'desc' },
    select: { forNewResource: true },
  });

  return ultima?.forNewResource ?? null;
}

export async function recordUsage(record: UsageRecord): Promise<void> {
  // Un turno que no gastó nada no se registra: ensucia la tabla y no aporta.
  if (record.promptTokens <= 0 && record.completionTokens <= 0) return;

  // odd/tasks/ahorro-tokens.md (T1): el precio REALMENTE vigente a esta hora,
  // no el de pico siempre. Sin `schedule` (motor sin horario configurado)
  // `precioVigente` devuelve `record.precios` sin tocar — comportamiento
  // idéntico al de antes de T1.
  const at = record.at ?? new Date();
  const preciosVigentes = record.precios ? precioVigente(record.precios, record.schedule ?? null, at) : null;

  const costo = calcularCostoTurno(
    record.promptTokens,
    record.cachedInputTokens,
    record.completionTokens,
    preciosVigentes,
  );

  // La sede que paga: la del docente EN ESTE MOMENTO, no la que tenía cuando
  // se creó el proyecto (design.md — "costo congelado por organización"). La
  // demo (y cualquier cuenta sin organización) queda en NULL.
  const actor = await prisma.user.findUnique({ where: { id: record.userId }, select: { organizationId: true } });
  const organizationId = actor?.organizationId ?? null;

  const forNewResource =
    forNewResourceDirecto(record.purpose) ?? (await forNewResourceHeredado(record.projectId, record.userId));

  const fila = await prisma.tokenUsage.create({
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
      organizationId,
      purpose: record.purpose,
      forNewResource,
      editMode: editModeAEnum(record.editMode),
    },
  });

  // odd/tasks/planes-y-cobros.md (T2): sólo las cuentas PERSONALES (sin
  // organización) consumen créditos — "organizaciones no tienen créditos",
  // decisión del dueño. Puede dejar el saldo en negativo para ESTE turno —
  // el próximo pedido queda bloqueado por `resolverAccesoIa`.
  if (organizationId === null) {
    if (costo.costUsd !== null && costo.costUsd.greaterThan(0)) {
      await debitUsage(record.userId, fila.id, costo.costUsd.toNumber());
    } else if (costo.costUsd === null) {
      // odd/tasks/planes-y-cobros.md (T2b): el motor no tiene precio cargado
      // — en vez de no debitar nada (lo que dejaba generar gratis sin
      // límite), se debita una estimación conservadora. `TokenUsage.costUsd`
      // sigue `null` (nunca se inventa el costo REAL, sólo se estima para
      // decidir el débito de créditos).
      console.warn(
        `[billing] motor "${record.model}" sin precio cargado — se debita una estimación conservadora de créditos al usuario ${record.userId} (turno ${fila.id}).`,
      );
      const estimado = await estimarCostoConservador(record.promptTokens, record.cachedInputTokens, record.completionTokens);
      if (estimado.greaterThan(0)) {
        await debitUsage(record.userId, fila.id, estimado.toNumber());
      }
    }
  }
}

/** Tokens acumulados por un usuario en UN motor puntual (prompt + respuesta). */
export async function consumedTokens(
  userId: string,
  aiModelId: string,
  /**
   * Ventana móvil en horas. 0 = desde siempre, que es el comportamiento
   * histórico: un tope de por vida que nunca se repone.
   *
   * Móvil y no un ciclo que se reinicia a propósito: no hace falta un trabajo
   * programado, no hay contador que se pueda corromper, y el cupo se libera de
   * a poco en lugar de volver todo junto a una hora fija. La consulta la cubre
   * el índice `[userId, createdAt]` que ya existe.
   */
  ventanaHoras = 0,
): Promise<number> {
  const desde =
    ventanaHoras > 0 ? new Date(Date.now() - ventanaHoras * 60 * 60 * 1000) : null;

  const total = await prisma.tokenUsage.aggregate({
    where: { userId, aiModelId, ...(desde ? { createdAt: { gte: desde } } : {}) },
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
