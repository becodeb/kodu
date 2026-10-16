import { prisma } from '../db.ts';
import { leerAppSettings } from '../settings.ts';
import { filaCsv } from './csv.ts';
import {
  modoEfectivo,
  inicioDelCiclo,
  finDelCiclo,
  proyeccionDeCierre,
  gastoDelCicloActual,
  MODES,
  MODO_AUTOMATICO_KEY,
  tierAutomaticoActual,
  type TierAutomatico,
} from '../ai/modos-generacion.ts';

/**
 * odd/tasks/motor-claude.md (T11): agregaciones de uso real para
 * `/admin/uso` y sus dos exports (`/api/admin/uso.json`/`.csv`, sesión de
 * admin) y el endpoint de sólo lectura para el dueño
 * (`/api/stats/uso.json`, token). Lee `AiTrace`/`TokenUsage` dentro de un
 * rango de fechas — nunca inventa un número: todo lo que no se puede medir
 * queda en `null`, nunca en `0` disfrazado de medición.
 *
 * Construye sobre lo que YA existe (`lib/admin/trazas.ts`,
 * `lib/admin/generacion.ts`, `lib/ai/modos-generacion.ts`) en vez de
 * duplicarlo: la caja de crédito reusa exactamente los mismos cálculos que
 * `/admin/generacion`.
 */

export interface RangoUso {
  desde: Date;
  hasta: Date;
}

/** El ciclo de facturación VIGENTE — default de `/admin/uso` cuando no se
 *  pide un rango explícito (la tarea lo pide así: "default: current billing
 *  cycle"). */
export function rangoDelCicloActual(billingCycleDay: number, ahora: Date = new Date()): RangoUso {
  const desde = inicioDelCiclo(billingCycleDay, ahora);
  const hasta = finDelCiclo(billingCycleDay, desde);
  return { desde, hasta };
}

export function parsearRangoQuery(searchParams: URLSearchParams, billingCycleDay: number): RangoUso {
  const desde = searchParams.get('desde');
  const hasta = searchParams.get('hasta');
  if (!desde && !hasta) return rangoDelCicloActual(billingCycleDay);
  const desdeFecha = desde ? new Date(desde) : rangoDelCicloActual(billingCycleDay).desde;
  const hastaFecha = hasta ? new Date(hasta) : new Date();
  if (Number.isNaN(desdeFecha.getTime()) || Number.isNaN(hastaFecha.getTime())) {
    return rangoDelCicloActual(billingCycleDay);
  }
  return { desde: desdeFecha, hasta: hastaFecha };
}

/**
 * Percentil por "nearest rank" (método simple, determinístico): ordena,
 * toma el índice `ceil(p/100 * N) - 1`. `null` sobre una lista vacía — nunca
 * un 0 que parezca una medición real.
 */
export function percentil(valores: readonly number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenados.length - 1, Math.max(0, Math.ceil((p / 100) * ordenados.length) - 1));
  return ordenados[indice]!;
}

export function mediana(valores: readonly number[]): number | null {
  return percentil(valores, 50);
}

function promedio(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  return valores.reduce((suma, v) => suma + v, 0) / valores.length;
}

function tasa(numerador: number, denominador: number): number | null {
  if (denominador === 0) return null;
  return numerador / denominador;
}

// ---------------------------------------------------------------------------
// Filas crudas y agrupación por "turno" (ver el comentario grande abajo).
// ---------------------------------------------------------------------------

/** Exportada para `e2e/unidad-uso-agregacion.ts`: la forma de fila cruda que
 *  consumen `agruparPorTurno`/`agregarPorClave`, para probar la matemática
 *  de agregación con fixtures en memoria, sin tocar la base. */
export interface FilaCruda {
  id: string;
  userId: string;
  projectId: string | null;
  chatMessageId: string | null;
  parentChatMessageId: string | null;
  turnKind: string;
  generationMode: string | null;
  turnRole: string | null;
  model: string;
  editOutcome: string | null;
  durationMs: number | null;
  verifierFindings: number | null;
  redFlags: string | null;
  redFlagsFixed: boolean | null;
  faceRating: string | null;
  faceRatingComment: string | null;
  undoneSignal: boolean;
  createdAt: Date;
  costoPropioUsd: number;
  costoDeLaRondaUsd: number;
}

async function filasCrudas(rango: RangoUso): Promise<FilaCruda[]> {
  const filas = await prisma.aiTrace.findMany({
    where: { createdAt: { gte: rango.desde, lt: rango.hasta } },
    select: {
      id: true,
      userId: true,
      projectId: true,
      chatMessageId: true,
      parentChatMessageId: true,
      turnKind: true,
      generationMode: true,
      turnRole: true,
      model: true,
      editOutcome: true,
      durationMs: true,
      verifierFindings: true,
      redFlags: true,
      redFlagsFixed: true,
      faceRating: true,
      faceRatingComment: true,
      undoneSignal: true,
      createdAt: true,
      tokenUsage: { select: { costUsd: true } },
      tokenUsagesDeLaRonda: { select: { costUsd: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return filas.map((fila) => ({
    id: fila.id,
    userId: fila.userId,
    projectId: fila.projectId,
    chatMessageId: fila.chatMessageId,
    parentChatMessageId: fila.parentChatMessageId,
    turnKind: fila.turnKind,
    generationMode: fila.generationMode,
    turnRole: fila.turnRole,
    model: fila.model,
    editOutcome: fila.editOutcome,
    durationMs: fila.durationMs,
    verifierFindings: fila.verifierFindings,
    redFlags: fila.redFlags,
    redFlagsFixed: fila.redFlagsFixed,
    faceRating: fila.faceRating,
    faceRatingComment: fila.faceRatingComment,
    undoneSignal: fila.undoneSignal,
    createdAt: fila.createdAt,
    costoPropioUsd: fila.tokenUsage?.costUsd?.toNumber() ?? 0,
    costoDeLaRondaUsd: fila.tokenUsagesDeLaRonda.reduce((suma, u) => suma + (u.costUsd?.toNumber() ?? 0), 0),
  }));
}

/**
 * Un "turno" (en el sentido de esta pantalla) es un `GENERATION`/
 * `ADJUSTMENT`/`EXTRA_VERSION`/`IDEATION`/`CHECKLIST` — su propia fila, más
 * cada `CORRECTION`/`VERIFICATION` que colgó de él vía `parentChatMessageId`
 * (T11: ninguna de esas dos crea su propio `ChatMessage`). Una fila sin
 * `chatMessageId` NI `parentChatMessageId` (dato histórico, de antes de
 * T11) queda SOLA — su costo sigue contando en los totales, pero no se
 * fusiona con ningún otro turno.
 */
export interface GrupoTurno {
  clave: string;
  raiz: FilaCruda | null;
  rondas: FilaCruda[];
  costoTotalUsd: number;
  duracionTotalMs: number;
}

export function agruparPorTurno(filas: readonly FilaCruda[]): GrupoTurno[] {
  const grupos = new Map<string, GrupoTurno>();

  function grupo(clave: string): GrupoTurno {
    let g = grupos.get(clave);
    if (!g) {
      g = { clave, raiz: null, rondas: [], costoTotalUsd: 0, duracionTotalMs: 0 };
      grupos.set(clave, g);
    }
    return g;
  }

  // Primera pasada: las raíces (tienen su propio chatMessageId).
  for (const fila of filas) {
    if (fila.chatMessageId) {
      const g = grupo(fila.chatMessageId);
      g.raiz = fila;
    }
  }

  // Segunda pasada: todo lo demás, incluidas las rondas que cuelgan de una
  // raíz y las filas sueltas (sin chatMessageId ni parentChatMessageId).
  for (const fila of filas) {
    if (fila.chatMessageId) continue; // ya es raíz de su propio grupo.
    const clave = fila.parentChatMessageId ?? `suelta:${fila.id}`;
    const g = grupo(clave);
    g.rondas.push(fila);
  }

  for (const g of grupos.values()) {
    const todas = g.raiz ? [g.raiz, ...g.rondas] : g.rondas;
    g.costoTotalUsd = todas.reduce((suma, f) => suma + f.costoPropioUsd + f.costoDeLaRondaUsd, 0);
    g.duracionTotalMs = todas.reduce((suma, f) => suma + (f.durationMs ?? 0), 0);
  }

  return [...grupos.values()];
}

// ---------------------------------------------------------------------------
// Crédito (reusa modos-generacion.ts / el mismo cálculo que /admin/generacion).
// ---------------------------------------------------------------------------

export interface PuntoGastoDiario {
  fecha: string; // YYYY-MM-DD, UTC.
  gastoUsd: number;
}

export interface ResumenCreditoUso {
  inicioIso: string;
  finIso: string;
  gastoCicloUsd: number;
  monthlyCreditUsd: number;
  premiumUntilUsd: number;
  modoEfectivo: string;
  proyeccionCierreUsd: number;
  gastoPorDia: PuntoGastoDiario[];
  /** T14: sólo presente cuando `modoEfectivo === 'automatico'` — mismo
   *  dato que la caja viva de `/admin/generacion`, para que el export de
   *  `/admin/uso` también pueda explicar por qué un recurso salió en tal
   *  tier. */
  automatico: { tier: TierAutomatico; razon: string } | null;
}

async function resumenCredito(ahora: Date): Promise<ResumenCreditoUso> {
  const settings = await leerAppSettings();
  const inicio = inicioDelCiclo(settings.billingCycleDay, ahora);
  const fin = finDelCiclo(settings.billingCycleDay, inicio);
  const gastoCicloUsd = await gastoDelCicloActual(settings.billingCycleDay, ahora);
  const efectivo = modoEfectivo(settings.generationMode, gastoCicloUsd, settings.premiumUntilUsd.toNumber());

  const decisionAutomatico =
    efectivo === MODO_AUTOMATICO_KEY
      ? await tierAutomaticoActual(
          {
            billingCycleDay: settings.billingCycleDay,
            monthlyCreditUsd: settings.monthlyCreditUsd.toNumber(),
            premiumUntilUsd: settings.premiumUntilUsd.toNumber(),
          },
          ahora,
        )
      : null;

  const filasDelCiclo = await prisma.tokenUsage.findMany({
    where: { createdAt: { gte: inicio }, costUsd: { not: null }, aiModel: { provider: { apiFormat: 'anthropic' } } },
    select: { createdAt: true, costUsd: true },
  });

  const porDia = new Map<string, number>();
  for (const fila of filasDelCiclo) {
    const clave = fila.createdAt.toISOString().slice(0, 10);
    porDia.set(clave, (porDia.get(clave) ?? 0) + (fila.costUsd?.toNumber() ?? 0));
  }
  const gastoPorDia: PuntoGastoDiario[] = [...porDia.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([fecha, gastoUsd]) => ({ fecha, gastoUsd }));

  return {
    inicioIso: inicio.toISOString(),
    finIso: fin.toISOString(),
    gastoCicloUsd,
    monthlyCreditUsd: settings.monthlyCreditUsd.toNumber(),
    premiumUntilUsd: settings.premiumUntilUsd.toNumber(),
    modoEfectivo: efectivo,
    proyeccionCierreUsd: proyeccionDeCierre(gastoCicloUsd, inicio, fin, ahora),
    gastoPorDia,
    automatico: decisionAutomatico ? { tier: decisionAutomatico.tier, razon: decisionAutomatico.razon } : null,
  };
}

// ---------------------------------------------------------------------------
// Por modo / por modelo.
// ---------------------------------------------------------------------------

export interface FilaUsoPorClave {
  clave: string;
  etiqueta: string;
  turnos: number;
  costoTotalUsd: number;
  costoPorCreacionUsd: number | null;
  costoPorAjusteUsd: number | null;
  costoPorRecursoUsd: number | null;
  segundosMedianaCreacion: number | null;
  segundosP90Creacion: number | null;
  segundosMedianaAjuste: number | null;
  segundosP90Ajuste: number | null;
  tasaCorreccion: number | null;
  tasaFallaEdicion: number | null;
  tasaBanderaRoja: number | null;
  tasaArreglo: number | null;
  mensajesFalloHonesto: number;
}

/** Turnkinds que SON "el turno" (nunca una ronda que cuelga de otro) y que
 *  escriben código — la base de `tasaFallaEdicion`/"creación"/"ajuste". */
const TURNKINDS_DE_CODIGO = new Set(['GENERATION', 'ADJUSTMENT', 'EXTRA_VERSION']);

export function agregarPorClave(grupos: readonly GrupoTurno[], obtenerClave: (fila: FilaCruda) => string | null): Map<string, FilaUsoPorClave> {
  const resultado = new Map<string, FilaUsoPorClave>();

  function fila(clave: string): FilaUsoPorClave {
    let f = resultado.get(clave);
    if (!f) {
      f = {
        clave,
        etiqueta: clave,
        turnos: 0,
        costoTotalUsd: 0,
        costoPorCreacionUsd: null,
        costoPorAjusteUsd: null,
        costoPorRecursoUsd: null,
        segundosMedianaCreacion: null,
        segundosP90Creacion: null,
        segundosMedianaAjuste: null,
        segundosP90Ajuste: null,
        tasaCorreccion: null,
        tasaFallaEdicion: null,
        tasaBanderaRoja: null,
        tasaArreglo: null,
        mensajesFalloHonesto: 0,
      };
      resultado.set(clave, f);
    }
    return f;
  }

  // Acumuladores intermedios por clave (no van en la forma final).
  const costosCreacion = new Map<string, number[]>();
  const costosAjuste = new Map<string, number[]>();
  const segCreacion = new Map<string, number[]>();
  const segAjuste = new Map<string, number[]>();
  const costosPorRecurso = new Map<string, number[]>();
  const conteoTurnosCodigo = new Map<string, number>();
  const conteoConCorreccion = new Map<string, number>();
  const conteoEditOutcomeConocido = new Map<string, number>();
  const conteoEditOutcomeFallido = new Map<string, number>();
  const conteoVerification = new Map<string, number>();
  const conteoVerificationConBandera = new Map<string, number>();
  const conteoCorrectionConFixFlag = new Map<string, number>();
  const conteoCorrectionFixCierto = new Map<string, number>();

  // Por proyecto (para costo por recurso): sumo todos los grupos cuya raíz,
  // o cuyas rondas sueltas, pertenecen a ese proyecto, agrupado por la
  // MISMA clave (modo/modelo) que la raíz de creación de ese proyecto tuvo
  // — un recurso "pertenece" al modo/modelo con el que se CREÓ.
  const claveDeCreacionPorProyecto = new Map<string, string>();
  const costoPorProyecto = new Map<string, number>();

  for (const g of grupos) {
    const todas = g.raiz ? [g.raiz, ...g.rondas] : g.rondas;
    if (todas.length === 0) continue;

    if (g.raiz && g.raiz.projectId) {
      if (g.raiz.turnKind === 'GENERATION') {
        const clave = obtenerClave(g.raiz);
        if (clave) claveDeCreacionPorProyecto.set(g.raiz.projectId, clave);
      }
      costoPorProyecto.set(g.raiz.projectId, (costoPorProyecto.get(g.raiz.projectId) ?? 0) + g.costoTotalUsd);
    }

    if (!g.raiz) continue; // una ronda suelta sin raíz no cuenta como "un turno" en sí misma.

    const clave = obtenerClave(g.raiz);
    if (!clave) continue;
    const f = fila(clave);
    f.turnos += 1;
    f.costoTotalUsd += g.costoTotalUsd;

    const segundos = g.duracionTotalMs / 1000;
    if (g.raiz.turnKind === 'GENERATION') {
      costosCreacion.set(clave, [...(costosCreacion.get(clave) ?? []), g.costoTotalUsd]);
      if (g.duracionTotalMs > 0) segCreacion.set(clave, [...(segCreacion.get(clave) ?? []), segundos]);
    } else if (g.raiz.turnKind === 'ADJUSTMENT') {
      costosAjuste.set(clave, [...(costosAjuste.get(clave) ?? []), g.costoTotalUsd]);
      if (g.duracionTotalMs > 0) segAjuste.set(clave, [...(segAjuste.get(clave) ?? []), segundos]);
    }

    if (TURNKINDS_DE_CODIGO.has(g.raiz.turnKind)) {
      conteoTurnosCodigo.set(clave, (conteoTurnosCodigo.get(clave) ?? 0) + 1);
      if (g.rondas.some((r) => r.turnKind === 'CORRECTION')) {
        conteoConCorreccion.set(clave, (conteoConCorreccion.get(clave) ?? 0) + 1);
      }
    }

    for (const t of todas) {
      if (TURNKINDS_DE_CODIGO.has(t.turnKind) && t.editOutcome !== null) {
        conteoEditOutcomeConocido.set(clave, (conteoEditOutcomeConocido.get(clave) ?? 0) + 1);
        if (t.editOutcome === 'FAILED') {
          conteoEditOutcomeFallido.set(clave, (conteoEditOutcomeFallido.get(clave) ?? 0) + 1);
          f.mensajesFalloHonesto += 1;
        }
      }
      if (t.turnKind === 'VERIFICATION') {
        conteoVerification.set(clave, (conteoVerification.get(clave) ?? 0) + 1);
        if (t.redFlags) conteoVerificationConBandera.set(clave, (conteoVerificationConBandera.get(clave) ?? 0) + 1);
      }
      if (t.turnKind === 'CORRECTION' && t.redFlagsFixed !== null) {
        conteoCorrectionConFixFlag.set(clave, (conteoCorrectionConFixFlag.get(clave) ?? 0) + 1);
        if (t.redFlagsFixed) conteoCorrectionFixCierto.set(clave, (conteoCorrectionFixCierto.get(clave) ?? 0) + 1);
      }
    }
  }

  for (const [proyecto, clave] of claveDeCreacionPorProyecto) {
    const costo = costoPorProyecto.get(proyecto) ?? 0;
    costosPorRecurso.set(clave, [...(costosPorRecurso.get(clave) ?? []), costo]);
  }

  for (const [clave, f] of resultado) {
    f.costoPorCreacionUsd = promedio(costosCreacion.get(clave) ?? []);
    f.costoPorAjusteUsd = promedio(costosAjuste.get(clave) ?? []);
    f.costoPorRecursoUsd = promedio(costosPorRecurso.get(clave) ?? []);
    f.segundosMedianaCreacion = mediana(segCreacion.get(clave) ?? []);
    f.segundosP90Creacion = percentil(segCreacion.get(clave) ?? [], 90);
    f.segundosMedianaAjuste = mediana(segAjuste.get(clave) ?? []);
    f.segundosP90Ajuste = percentil(segAjuste.get(clave) ?? [], 90);
    f.tasaCorreccion = tasa(conteoConCorreccion.get(clave) ?? 0, conteoTurnosCodigo.get(clave) ?? 0);
    f.tasaFallaEdicion = tasa(conteoEditOutcomeFallido.get(clave) ?? 0, conteoEditOutcomeConocido.get(clave) ?? 0);
    f.tasaBanderaRoja = tasa(conteoVerificationConBandera.get(clave) ?? 0, conteoVerification.get(clave) ?? 0);
    f.tasaArreglo = tasa(conteoCorrectionFixCierto.get(clave) ?? 0, conteoCorrectionConFixFlag.get(clave) ?? 0);
  }

  return resultado;
}

// ---------------------------------------------------------------------------
// Docentes.
// ---------------------------------------------------------------------------

export interface ResumenDocentesUso {
  activos: number;
  recursosCreadosPorDocenteMedia: number | null;
  ajustesPorRecursoMedia: number | null;
  ajustesPorRecursoP90: number | null;
  porcentajePublicados: number | null;
  señalesDeshacer: number;
  caritas: { GOOD: number; NEUTRAL: number; BAD: number };
  comentariosDeFeedback: number;
  duracionSesionMediaMin: number | null;
}

async function resumenDocentes(grupos: readonly GrupoTurno[], rango: RangoUso): Promise<ResumenDocentesUso> {
  const usuarios = new Set<string>();
  const recursosPorUsuario = new Map<string, Set<string>>();
  const ajustesPorRecurso = new Map<string, number>();
  const proyectosCreados = new Set<string>();
  let señalesDeshacer = 0;
  const caritas = { GOOD: 0, NEUTRAL: 0, BAD: 0 };
  let comentariosDeFeedback = 0;

  const porUsuarioYDia = new Map<string, { min: number; max: number }>();

  for (const g of grupos) {
    const todas = g.raiz ? [g.raiz, ...g.rondas] : g.rondas;
    for (const t of todas) {
      usuarios.add(t.userId);
      if (t.undoneSignal) señalesDeshacer += 1;
      if (t.faceRating === 'GOOD' || t.faceRating === 'NEUTRAL' || t.faceRating === 'BAD') caritas[t.faceRating] += 1;
      if (t.faceRatingComment) comentariosDeFeedback += 1;

      const diaClave = `${t.userId}:${t.createdAt.toISOString().slice(0, 10)}`;
      const ts = t.createdAt.getTime();
      const previo = porUsuarioYDia.get(diaClave);
      porUsuarioYDia.set(diaClave, previo ? { min: Math.min(previo.min, ts), max: Math.max(previo.max, ts) } : { min: ts, max: ts });
    }

    if (!g.raiz || !g.raiz.projectId) continue;
    if (g.raiz.turnKind === 'GENERATION') {
      proyectosCreados.add(g.raiz.projectId);
      const set = recursosPorUsuario.get(g.raiz.userId) ?? new Set<string>();
      set.add(g.raiz.projectId);
      recursosPorUsuario.set(g.raiz.userId, set);
    }
    if (g.raiz.turnKind === 'ADJUSTMENT') {
      ajustesPorRecurso.set(g.raiz.projectId, (ajustesPorRecurso.get(g.raiz.projectId) ?? 0) + 1);
    }
  }

  const duracionesSesionMin: number[] = [];
  for (const { min, max } of porUsuarioYDia.values()) {
    if (max > min) duracionesSesionMin.push((max - min) / 60_000);
  }

  let publicados = 0;
  if (proyectosCreados.size > 0) {
    publicados = await prisma.project.count({ where: { id: { in: [...proyectosCreados] }, isInGallery: true } });
  }

  return {
    activos: usuarios.size,
    recursosCreadosPorDocenteMedia: promedio([...recursosPorUsuario.values()].map((set) => set.size)),
    ajustesPorRecursoMedia: promedio([...ajustesPorRecurso.values()]),
    ajustesPorRecursoP90: percentil([...ajustesPorRecurso.values()], 90),
    porcentajePublicados: tasa(publicados, proyectosCreados.size),
    señalesDeshacer,
    caritas,
    comentariosDeFeedback,
    duracionSesionMediaMin: promedio(duracionesSesionMin),
  };
}

// ---------------------------------------------------------------------------
// "¿Sobra crédito?"
// ---------------------------------------------------------------------------

export interface SugerenciaModo {
  modo: string;
  etiqueta: string;
  costoMensualEstimadoUsd: number;
  fuente: 'medido' | 'constante';
}

export interface ResumenSobraCredito {
  proyeccionCierreUsd: number;
  creditoRestanteUsd: number;
  sobra: boolean;
  sugerencias: SugerenciaModo[];
}

/** Costo mensual estimado de CADA modo a este volumen: recursos nuevos del
 *  rango × (costo por creación + ajustes por recurso × costo por ajuste) de
 *  ESE modo, si hay datos medidos en el rango; si no, cae a las constantes
 *  medidas en `modos-generacion.ts` (las mismas que ya muestra
 *  `/admin/generacion` — "Crear: ... · Ajustar: ...") — nunca inventa un
 *  número nuevo. */
export function sugerenciasDeModo(porModo: ReadonlyMap<string, FilaUsoPorClave>, recursosNuevosEnRango: number, ajustesPorRecursoMedia: number | null): SugerenciaModo[] {
  const ajustesPromedio = ajustesPorRecursoMedia ?? 0;
  const claves = Object.keys(MODES);

  return claves.map((clave) => {
    const modo = MODES[clave]!;
    const medido = porModo.get(clave);
    if (medido && medido.costoPorCreacionUsd !== null) {
      const costoAjuste = medido.costoPorAjusteUsd ?? 0;
      const costoMensual = recursosNuevosEnRango * (medido.costoPorCreacionUsd + ajustesPromedio * costoAjuste);
      return { modo: clave, etiqueta: modo.label, costoMensualEstimadoUsd: costoMensual, fuente: 'medido' as const };
    }
    // Constante: "≈USD 0,17 · ≈85 s" → se extrae el primer número USD.
    const extraerUsd = (texto: string): number => {
      const m = texto.match(/USD\s*([\d.,]+)/);
      return m ? Number(m[1]!.replace(',', '.')) : 0;
    };
    const costoCreacionConstante = extraerUsd(modo.measured.creation);
    const costoAjusteConstante = extraerUsd(modo.measured.adjustment);
    const costoMensual = recursosNuevosEnRango * (costoCreacionConstante + ajustesPromedio * costoAjusteConstante);
    return { modo: clave, etiqueta: modo.label, costoMensualEstimadoUsd: costoMensual, fuente: 'constante' as const };
  });
}

// ---------------------------------------------------------------------------
// La forma completa, consumida por la página/los tres exports.
// ---------------------------------------------------------------------------

export interface ResumenUso {
  rango: { desdeIso: string; hastaIso: string };
  credito: ResumenCreditoUso;
  porModo: FilaUsoPorClave[];
  porModelo: FilaUsoPorClave[];
  docentes: ResumenDocentesUso;
  sobraCredito: ResumenSobraCredito;
}

export async function resumenUso(rango: RangoUso): Promise<ResumenUso> {
  const ahora = new Date();
  const [credito, filas] = await Promise.all([resumenCredito(ahora), filasCrudas(rango)]);

  const grupos = agruparPorTurno(filas);

  const porModoMap = agregarPorClave(grupos, (f) => f.generationMode);
  for (const [clave, fila] of porModoMap) fila.etiqueta = MODES[clave]?.label ?? clave;

  const porModeloMap = agregarPorClave(grupos, (f) => f.model);
  for (const [, fila] of porModeloMap) fila.etiqueta = fila.clave;

  const docentes = await resumenDocentes(grupos, rango);

  const recursosNuevosEnRango = grupos.filter((g) => g.raiz?.turnKind === 'GENERATION').length;
  const creditoRestanteUsd = Math.max(credito.monthlyCreditUsd - credito.gastoCicloUsd, 0);

  return {
    rango: { desdeIso: rango.desde.toISOString(), hastaIso: rango.hasta.toISOString() },
    credito,
    porModo: [...porModoMap.values()].sort((a, b) => b.turnos - a.turnos),
    porModelo: [...porModeloMap.values()].sort((a, b) => b.turnos - a.turnos),
    docentes,
    sobraCredito: {
      proyeccionCierreUsd: credito.proyeccionCierreUsd,
      creditoRestanteUsd,
      sobra: credito.proyeccionCierreUsd < credito.monthlyCreditUsd,
      sugerencias: sugerenciasDeModo(porModoMap, recursosNuevosEnRango, docentes.ajustesPorRecursoMedia),
    },
  };
}

// ---------------------------------------------------------------------------
// Export CSV — odd/tasks/motor-claude.md (T11): `ResumenUso` no es una tabla
// de una sola forma (como `AiTrace`, que exporta `trazas.ts`) — son varias
// secciones chicas. Cada sección es su propia mini-tabla (encabezado +
// filas), separadas por una línea en blanco; más simple de leer en una
// planilla que forzar todo a una sola fila ancha.
// ---------------------------------------------------------------------------

function filaClave(f: FilaUsoPorClave): Array<string | number | boolean | null> {
  return [
    f.etiqueta,
    f.turnos,
    f.costoTotalUsd,
    f.costoPorCreacionUsd,
    f.costoPorAjusteUsd,
    f.costoPorRecursoUsd,
    f.segundosMedianaCreacion,
    f.segundosP90Creacion,
    f.segundosMedianaAjuste,
    f.segundosP90Ajuste,
    f.tasaCorreccion,
    f.tasaFallaEdicion,
    f.tasaBanderaRoja,
    f.tasaArreglo,
    f.mensajesFalloHonesto,
  ];
}

const ENCABEZADO_CLAVE = [
  'Clave',
  'Turnos',
  'Costo total USD',
  'Costo por creación USD',
  'Costo por ajuste USD',
  'Costo por recurso USD',
  'Mediana creación (s, incl. revisión)',
  'P90 creación (s, incl. revisión)',
  'Mediana ajuste (s, incl. revisión)',
  'P90 ajuste (s, incl. revisión)',
  'Tasa de corrección',
  'Tasa de falla de edición',
  'Tasa de bandera roja',
  'Tasa de arreglo',
  'Mensajes de fallo honesto',
];

export function filasCsvDeUso(resumen: ResumenUso): string[] {
  const lineas: string[] = [];

  lineas.push(filaCsv(['Rango', resumen.rango.desdeIso, resumen.rango.hastaIso]));
  lineas.push('');

  lineas.push(filaCsv(['Crédito', 'Valor']));
  lineas.push(filaCsv(['Gastado este ciclo (USD)', resumen.credito.gastoCicloUsd]));
  lineas.push(filaCsv(['Crédito mensual (USD)', resumen.credito.monthlyCreditUsd]));
  lineas.push(filaCsv(['Tope premium (USD)', resumen.credito.premiumUntilUsd]));
  lineas.push(filaCsv(['Modo efectivo', resumen.credito.modoEfectivo]));
  lineas.push(filaCsv(['Proyección al cierre (USD)', resumen.credito.proyeccionCierreUsd]));
  lineas.push('');

  lineas.push(filaCsv(['Fecha', 'Gasto del día (USD)']));
  for (const punto of resumen.credito.gastoPorDia) lineas.push(filaCsv([punto.fecha, punto.gastoUsd]));
  lineas.push('');

  lineas.push(filaCsv(['Por modo', ...ENCABEZADO_CLAVE.slice(1)]));
  for (const fila of resumen.porModo) lineas.push(filaCsv(filaClave(fila)));
  lineas.push('');

  lineas.push(filaCsv(['Por modelo', ...ENCABEZADO_CLAVE.slice(1)]));
  for (const fila of resumen.porModelo) lineas.push(filaCsv(filaClave(fila)));
  lineas.push('');

  lineas.push(filaCsv(['Docentes', 'Valor']));
  lineas.push(filaCsv(['Activos', resumen.docentes.activos]));
  lineas.push(filaCsv(['Recursos creados por docente (media)', resumen.docentes.recursosCreadosPorDocenteMedia]));
  lineas.push(filaCsv(['Ajustes por recurso (media)', resumen.docentes.ajustesPorRecursoMedia]));
  lineas.push(filaCsv(['Ajustes por recurso (p90)', resumen.docentes.ajustesPorRecursoP90]));
  lineas.push(filaCsv(['% recursos publicados', resumen.docentes.porcentajePublicados]));
  lineas.push(filaCsv(['Señales de deshacer', resumen.docentes.señalesDeshacer]));
  lineas.push(filaCsv(['Caritas buenas', resumen.docentes.caritas.GOOD]));
  lineas.push(filaCsv(['Caritas neutrales', resumen.docentes.caritas.NEUTRAL]));
  lineas.push(filaCsv(['Caritas malas', resumen.docentes.caritas.BAD]));
  lineas.push(filaCsv(['Comentarios de feedback', resumen.docentes.comentariosDeFeedback]));
  lineas.push(filaCsv(['Duración de sesión media (min, aproximada)', resumen.docentes.duracionSesionMediaMin]));
  lineas.push('');

  lineas.push(filaCsv(['¿Sobra crédito?', 'Valor']));
  lineas.push(filaCsv(['Proyección al cierre (USD)', resumen.sobraCredito.proyeccionCierreUsd]));
  lineas.push(filaCsv(['Crédito restante (USD)', resumen.sobraCredito.creditoRestanteUsd]));
  lineas.push(filaCsv(['¿Sobra?', resumen.sobraCredito.sobra]));
  lineas.push('');
  lineas.push(filaCsv(['Modo', 'Costo mensual estimado (USD)', 'Fuente']));
  for (const s of resumen.sobraCredito.sugerencias) {
    lineas.push(filaCsv([s.etiqueta, s.costoMensualEstimadoUsd, s.fuente]));
  }

  return lineas;
}
