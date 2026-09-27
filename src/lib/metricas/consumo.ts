import { prisma } from '../db.ts';
import { Prisma, type UsagePurpose } from '../../generated/prisma/client.ts';

/**
 * odd/tasks/organizaciones.md (T7): agregación de `TokenUsage` por
 * organización y por mes, para el superadmin ("Métricas") y, más adelante,
 * para el panel de la organización (T8, mismo loader acotado a las sedes de
 * `alcance.ts` y agrupado por docente en vez de por organización).
 *
 * Separación deliberada en dos capas:
 *  - `agregarConsumo` es PURA (nada de Prisma adentro): recibe un array de
 *    filas ya resuelto y devuelve los números. Unit-testeable sin base — el
 *    e2e de T7 la ejercita con filas sembradas a mano y cifras calculadas
 *    aparte en el propio test.
 *  - El resto de este módulo son loaders: sólo saben pedir las columnas que
 *    hacen falta y armar los grupos (por organización, por docente). Nunca
 *    hacen la cuenta ellos mismos — eso es trabajo de `agregarConsumo`.
 *
 * Regla que atraviesa todo el archivo (design.md / src/lib/ai/usage.ts): un
 * costo NULL es "no se sabe", nunca 0. `_sum` de Prisma ignora los NULL
 * dentro de un mismo grupo en vez de anular el grupo entero — por eso acá,
 * igual que en usage.ts, se suma a mano y se cuenta cuántas filas quedaron
 * afuera de la suma por no tener precio, en vez de usar `groupBy`+`_sum`.
 */

const ZONA_BA = 'America/Argentina/Buenos_Aires';

// ─────────────────────────────────────────────────────────────
// Meses en huso horario de Argentina.
//
// Argentina no tiene horario de verano (UTC-3 todo el año, sin excepciones
// vigentes), así que un offset fijo `-03:00` para construir los límites del
// mes es correcto y no hace falta la base de datos de husos de `Intl` para
// eso. `Intl.DateTimeFormat` sí hace falta para el sentido inverso (¿qué mes
// es AHORA en Argentina?), porque "ahora" es un instante UTC y convertirlo a
// mano duplicaría la regla de offset ya escrita en `limitesDelMes`.
// ─────────────────────────────────────────────────────────────

/** "YYYY-MM" del mes calendario vigente en Argentina en este instante (no en
 *  UTC ni en el huso del servidor). `en-CA` da directamente el orden
 *  año-mes que hace falta. */
export function mesActualBA(instante: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_BA,
    year: 'numeric',
    month: '2-digit',
  }).format(instante);
}

/**
 * Límites `[desde, hasta)` de un mes calendario "YYYY-MM" en huso de
 * Argentina, ya en UTC (lo que espera un filtro de `createdAt` en Postgres).
 * Ej.: para "2026-09", `desde` es 2026-08-31T23:30 hora Argentina → NO
 * entra (es agosto); 2026-09-01T00:30 hora Argentina → SÍ entra.
 */
export function limitesDelMes(mes: string): { desde: Date; hasta: Date } {
  const [anioStr, mesStr] = mes.split('-');
  const anio = Number(anioStr);
  const mesNum = Number(mesStr);
  const desde = new Date(`${anioStr}-${mesStr}-01T00:00:00-03:00`);
  const mesSiguiente = mesNum === 12 ? 1 : mesNum + 1;
  const anioSiguiente = mesNum === 12 ? anio + 1 : anio;
  const hasta = new Date(`${anioSiguiente}-${String(mesSiguiente).padStart(2, '0')}-01T00:00:00-03:00`);
  return { desde, hasta };
}

/** `cantidad` meses "YYYY-MM", ORDEN ASCENDENTE (el más viejo primero), el
 *  último es siempre `mesReferencia`. Sirve tanto para el selector (12) como
 *  para la tendencia (6). */
export function ultimosMeses(cantidad: number, mesReferencia: string = mesActualBA()): string[] {
  const [anioStr, mesStr] = mesReferencia.split('-');
  let anio = Number(anioStr);
  let mes = Number(mesStr);
  const resultado: string[] = [];
  for (let i = 0; i < cantidad; i++) {
    resultado.unshift(`${anio}-${String(mes).padStart(2, '0')}`);
    mes -= 1;
    if (mes === 0) {
      mes = 12;
      anio -= 1;
    }
  }
  return resultado;
}

/** "Septiembre 2026", para el selector y los títulos. */
export function etiquetaMes(mes: string): string {
  const fecha = new Date(`${mes}-01T00:00:00-03:00`);
  const texto = new Intl.DateTimeFormat('es-AR', { timeZone: ZONA_BA, month: 'long', year: 'numeric' }).format(
    fecha,
  );
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// ─────────────────────────────────────────────────────────────
// experimentos/razonamiento/PLAN-produccion.md §4: los supuestos de costo
// que este cambio existe para poder verificar contra `TokenUsage` real.
// Constantes en un solo lugar (task T7) — la UI las muestra al lado de las
// cifras medidas para que el dueño vea la brecha, nunca hardcodeadas de
// nuevo en el componente.
// ─────────────────────────────────────────────────────────────

/** Recurso nuevo, tarifa valle de DeepSeek medida en la ronda 6 (§4). */
export const PLAN_COSTO_RECURSO_NUEVO_USD = 0.02;
/** Ajuste — EL SUPUESTO MÁS DÉBIL de §4/§6.2: nunca se midió, es la razón de ser de T7. */
export const PLAN_COSTO_AJUSTE_USD = 0.01;
/** Por docente activo y por mes, con DeepSeek directo (§4, "peor caso" aparte en la tabla). */
export const PLAN_COSTO_POR_DOCENTE_ACTIVO_USD = 0.43;

// ─────────────────────────────────────────────────────────────
// Loader: sólo las columnas que hace falta, filtradas por mes y por un
// conjunto opcional de organizaciones.
// ─────────────────────────────────────────────────────────────

export interface FilaConsumoCruda {
  userId: string;
  /** La sede CONGELADA en el momento de la llamada (nunca la actual). `null`
   *  = demo, cuenta personal, o histórico de antes de esta columna. */
  organizationId: string | null;
  purpose: UsagePurpose | null;
  forNewResource: boolean | null;
  projectId: string | null;
  promptTokens: number;
  completionTokens: number;
  cachedInputTokens: number;
  costUsd: Prisma.Decimal | null;
}

/**
 * Filas crudas de `TokenUsage` del mes `mes`, filtradas por organización.
 *
 * `organizationIds`:
 *  - `null` = sin filtro de organización — trae TODO (incluidas las filas
 *    con `organizationId: null`, el grupo "Sin organización"). Es lo que usa
 *    T7 (el superadmin quiere ver todo).
 *  - un array = sólo esas organizaciones (`organizationId IN (...)`) — las
 *    filas "Sin organización" quedan afuera a propósito. Es lo que usará T8
 *    (el panel de una organización nunca necesita ver "Sin organización").
 */
export async function cargarFilasConsumoDelMes(
  mes: string,
  organizationIds: string[] | null,
): Promise<FilaConsumoCruda[]> {
  const { desde, hasta } = limitesDelMes(mes);

  return prisma.tokenUsage.findMany({
    where: {
      createdAt: { gte: desde, lt: hasta },
      ...(organizationIds ? { organizationId: { in: organizationIds } } : {}),
    },
    select: {
      userId: true,
      organizationId: true,
      purpose: true,
      forNewResource: true,
      projectId: true,
      promptTokens: true,
      completionTokens: true,
      cachedInputTokens: true,
      costUsd: true,
    },
  });
}

/** Agrupa filas ya cargadas por organización (`null` = "Sin organización"). */
export function agruparPorOrganizacion(filas: FilaConsumoCruda[]): Map<string | null, FilaConsumoCruda[]> {
  const mapa = new Map<string | null, FilaConsumoCruda[]>();
  for (const fila of filas) {
    const grupo = mapa.get(fila.organizationId);
    if (grupo) grupo.push(fila);
    else mapa.set(fila.organizationId, [fila]);
  }
  return mapa;
}

/** Agrupa filas ya cargadas por docente — para el desglose por docente de T8. */
export function agruparPorUsuario(filas: FilaConsumoCruda[]): Map<string, FilaConsumoCruda[]> {
  const mapa = new Map<string, FilaConsumoCruda[]>();
  for (const fila of filas) {
    const grupo = mapa.get(fila.userId);
    if (grupo) grupo.push(fila);
    else mapa.set(fila.userId, [fila]);
  }
  return mapa;
}

/**
 * "Docentes hoy" (membresía ACTUAL, no hay historial de membresía) por cada
 * organización pedida. Excluye a la demo (`isDemo: false`, mismo criterio
 * que `listarUsuariosAdmin`) — no es un docente real y su fila de
 * `TokenUsage` ya queda fuera de toda organización (`organizationId: null`)
 * por decisión del dueño, así que nunca aparecería acá de todos modos; el
 * filtro es sólo para no depender de esa invariante en dos lugares.
 */
export async function docentesHoyPorOrganizacion(organizationIds: string[]): Promise<Map<string, number>> {
  if (organizationIds.length === 0) return new Map();

  const filas = await prisma.user.groupBy({
    by: ['organizationId'],
    where: { organizationId: { in: organizationIds }, isDemo: false },
    _count: { _all: true },
  });

  return new Map(filas.map((fila) => [fila.organizationId as string, fila._count._all]));
}

/** "Docentes hoy" del grupo "Sin organización": cuentas personales, e
 *  históricas de usuarios sin organización (nunca la demo). */
export async function docentesHoySinOrganizacion(): Promise<number> {
  return prisma.user.count({ where: { organizationId: null, isDemo: false } });
}

// ─────────────────────────────────────────────────────────────
// Agregación PURA — sin Prisma, sin reloj, sin red. Unit-testeable con un
// array armado a mano.
// ─────────────────────────────────────────────────────────────

/** Una suma de USD que puede ser un PISO: si `filasSinPrecio > 0`, `suma`
 *  NUNCA incluyó esas filas (nunca se suma NULL como 0) y el número real es
 *  mayor o igual a `suma` — de ahí el prefijo "≥" que usa la UI. */
export interface SumaUsd {
  suma: Prisma.Decimal;
  filasSinPrecio: number;
}

function sumarCostos(filas: Array<{ costUsd: Prisma.Decimal | null }>): SumaUsd {
  let suma = new Prisma.Decimal(0);
  let filasSinPrecio = 0;
  for (const fila of filas) {
    if (fila.costUsd === null) filasSinPrecio += 1;
    else suma = suma.add(fila.costUsd);
  }
  return { suma, filasSinPrecio };
}

/** Un promedio que hereda el mismo piso que su numerador: si el numerador
 *  tuvo filas sin precio, el promedio también es un piso, aunque la
 *  división en sí sea exacta. `promedio: null` sólo cuando el denominador
 *  es 0 (nunca se divide por cero, y nunca se muestra un promedio de "0
 *  recursos nuevos" como si fuera 0). */
export interface PromedioConDudas {
  promedio: Prisma.Decimal | null;
  filasSinPrecio: number;
}

function promediar(suma: SumaUsd, denominador: number): PromedioConDudas {
  if (denominador <= 0) return { promedio: null, filasSinPrecio: suma.filasSinPrecio };
  return { promedio: suma.suma.div(denominador), filasSinPrecio: suma.filasSinPrecio };
}

/** Orden fijo de "Costo por paso" en la UI — los 7 propósitos, siempre en
 *  el mismo orden aunque un grupo no tenga filas de alguno, más "Sin
 *  clasificar" (histórico, `purpose: null`) al final. */
const ORDEN_PROPOSITOS: UsagePurpose[] = [
  'GENERATION',
  'ADJUSTMENT',
  'CHECKLIST',
  'CORRECTION',
  'VERIFICATION',
  'EXTRA_VERSION',
  // odd/tasks/taller-de-ideas.md: pensar la idea, antes de generar nada.
  'IDEATION',
];

export interface FilaCostoPorPaso {
  /** `null` = "Sin clasificar" (fila histórica, de antes de T1). */
  purpose: UsagePurpose | null;
  filas: number;
  costo: SumaUsd;
}

export interface AgregadoConsumo {
  /** Distinct `userId` con ≥1 fila en el grupo. */
  docentesActivos: number;
  /** Distinct `projectId` con ≥1 fila `GENERATION`. */
  recursosNuevos: number;
  /** Filas `ADJUSTMENT`. */
  ajustes: number;
  /** `GENERATION` + `ADJUSTMENT`. */
  turnos: number;
  /** `promptTokens + completionTokens`, TODAS las filas del grupo. */
  tokens: number;
  /** Subconjunto de `tokens` — nunca se suma aparte. */
  tokensCacheados: number;
  costoTotal: SumaUsd;
  costoPorPaso: FilaCostoPorPaso[];
  /** Σ costo de filas `forNewResource: true` ÷ `recursosNuevos`. */
  costoPromedioRecursoNuevo: PromedioConDudas;
  /** Σ costo de filas `forNewResource: false` ÷ `ajustes`. */
  costoPromedioAjuste: PromedioConDudas;
  /** Filas con `forNewResource: null` — excluidas de los dos promedios de
   *  arriba, nunca prorrateadas ni adivinadas. */
  filasSinAtribuir: number;
  /** `costoTotal ÷ docentesActivos`. */
  costoPorDocenteActivo: PromedioConDudas;
}

/**
 * La cuenta completa de UN grupo (una organización, una red entera, "Sin
 * organización", o el total) para UN mes. `filas` ya viene filtrada a ese
 * grupo y ese mes por el caller (el loader, o el propio test con filas
 * sembradas a mano) — esta función no filtra nada, sólo cuenta.
 */
export function agregarConsumo(filas: FilaConsumoCruda[]): AgregadoConsumo {
  const docentesActivos = new Set(filas.map((fila) => fila.userId)).size;

  const proyectosGeneracion = new Set(
    filas.filter((fila) => fila.purpose === 'GENERATION' && fila.projectId !== null).map((fila) => fila.projectId!),
  );
  const recursosNuevos = proyectosGeneracion.size;

  const ajustes = filas.filter((fila) => fila.purpose === 'ADJUSTMENT').length;
  const turnos = filas.filter((fila) => fila.purpose === 'GENERATION' || fila.purpose === 'ADJUSTMENT').length;

  let tokens = 0;
  let tokensCacheados = 0;
  for (const fila of filas) {
    tokens += fila.promptTokens + fila.completionTokens;
    tokensCacheados += fila.cachedInputTokens;
  }

  const costoTotal = sumarCostos(filas);

  const costoPorPaso: FilaCostoPorPaso[] = [
    ...ORDEN_PROPOSITOS.map((purpose) => {
      const delGrupo = filas.filter((fila) => fila.purpose === purpose);
      return { purpose, filas: delGrupo.length, costo: sumarCostos(delGrupo) };
    }),
    // "Sin clasificar": purpose NULL, siempre al final.
    (() => {
      const delGrupo = filas.filter((fila) => fila.purpose === null);
      return { purpose: null, filas: delGrupo.length, costo: sumarCostos(delGrupo) };
    })(),
  ];

  const filasRecursoNuevo = filas.filter((fila) => fila.forNewResource === true);
  const filasAjuste = filas.filter((fila) => fila.forNewResource === false);
  const filasSinAtribuir = filas.filter((fila) => fila.forNewResource === null).length;

  const costoPromedioRecursoNuevo = promediar(sumarCostos(filasRecursoNuevo), recursosNuevos);
  const costoPromedioAjuste = promediar(sumarCostos(filasAjuste), ajustes);
  const costoPorDocenteActivo = promediar(costoTotal, docentesActivos);

  return {
    docentesActivos,
    recursosNuevos,
    ajustes,
    turnos,
    tokens,
    tokensCacheados,
    costoTotal,
    costoPorPaso,
    costoPromedioRecursoNuevo,
    costoPromedioAjuste,
    filasSinAtribuir,
    costoPorDocenteActivo,
  };
}
