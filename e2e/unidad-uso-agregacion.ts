import 'dotenv/config';
import assert from 'node:assert/strict';
import {
  percentil,
  mediana,
  rangoDelCicloActual,
  parsearRangoQuery,
  agruparPorTurno,
  agregarPorClave,
  sugerenciasDeModo,
  type FilaCruda,
  type FilaUsoPorClave,
} from '../src/lib/admin/uso.ts';
import { MODES } from '../src/lib/ai/modos-generacion.ts';

/**
 * T11 (motor-claude): pruebas puras de la matemática de agregación de
 * `/admin/uso` — percentiles, ventana del ciclo, agrupamiento de un turno
 * (raíz + rondas de corrección/verificación que cuelgan de él), y el costo
 * por modo/modelo/recurso que sale de ahí. Todo con fixtures en memoria,
 * sin tocar la base (a diferencia de `unidad-modos-generacion.ts`, que sí
 * necesita un `AiModel` real para probar la resolución modo→motor).
 *
 * Ejecutar con: npx tsx e2e/unidad-uso-agregacion.ts
 */

let fallas = 0;

async function prueba(nombre: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✔ ${nombre}`);
  } catch (error) {
    fallas++;
    console.error(`✖ ${nombre}`);
    console.error(`  ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Percentiles.
// ---------------------------------------------------------------------------

await prueba('percentil: lista vacía -> null, nunca 0', () => {
  assert.equal(percentil([], 50), null);
  assert.equal(mediana([]), null);
});

await prueba('mediana: un solo valor es ese valor', () => {
  assert.equal(mediana([42]), 42);
});

await prueba('mediana: cantidad par de valores (nearest-rank, no promedio de los dos del medio)', () => {
  // Ordenados: [10, 20, 30, 40]. ceil(0.5*4)-1 = 1 -> índice 1 -> 20.
  assert.equal(mediana([40, 10, 30, 20]), 20);
});

await prueba('percentil: p90 sobre 10 valores da el 9no (índice 8)', () => {
  const valores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentil(valores, 90), 9);
});

await prueba('percentil: no muta el array de entrada (ordena una copia)', () => {
  const valores = [3, 1, 2];
  percentil(valores, 50);
  assert.deepEqual(valores, [3, 1, 2]);
});

// ---------------------------------------------------------------------------
// Ventana del ciclo (wrapper de `/admin/uso` sobre modos-generacion.ts).
// ---------------------------------------------------------------------------

await prueba('rangoDelCicloActual: devuelve [inicio del ciclo, próximo corte)', () => {
  const ahora = new Date('2026-03-15T12:00:00.000Z');
  const rango = rangoDelCicloActual(10, ahora);
  assert.equal(rango.desde.toISOString(), '2026-03-10T00:00:00.000Z');
  assert.equal(rango.hasta.toISOString(), '2026-04-10T00:00:00.000Z');
});

await prueba('parsearRangoQuery: sin desde/hasta -> el ciclo actual', () => {
  const params = new URLSearchParams();
  const esperado = rangoDelCicloActual(5);
  const rango = parsearRangoQuery(params, 5);
  // Comparables con <1s de margen (el "ahora" interno puede diferir en ms).
  assert.equal(rango.desde.toISOString(), esperado.desde.toISOString());
  assert.equal(rango.hasta.toISOString(), esperado.hasta.toISOString());
});

await prueba('parsearRangoQuery: desde/hasta explícitos se respetan tal cual', () => {
  const params = new URLSearchParams({ desde: '2026-01-01T00:00:00.000Z', hasta: '2026-02-01T00:00:00.000Z' });
  const rango = parsearRangoQuery(params, 1);
  assert.equal(rango.desde.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(rango.hasta.toISOString(), '2026-02-01T00:00:00.000Z');
});

await prueba('parsearRangoQuery: una fecha inválida cae al ciclo actual (nunca Invalid Date)', () => {
  const params = new URLSearchParams({ desde: 'no-es-una-fecha', hasta: 'tampoco' });
  const rango = parsearRangoQuery(params, 1);
  assert.equal(Number.isNaN(rango.desde.getTime()), false);
  assert.equal(Number.isNaN(rango.hasta.getTime()), false);
});

// ---------------------------------------------------------------------------
// Fixtures para el agrupamiento por turno.
// ---------------------------------------------------------------------------

function fila(parcial: Partial<FilaCruda> & { id: string; turnKind: FilaCruda['turnKind'] }): FilaCruda {
  return {
    userId: 'docente-1',
    projectId: 'recurso-1',
    chatMessageId: null,
    parentChatMessageId: null,
    generationMode: 'base',
    turnRole: null,
    model: 'claude-haiku-5-5',
    editOutcome: null,
    durationMs: 0,
    verifierFindings: null,
    redFlags: null,
    redFlagsFixed: null,
    faceRating: null,
    faceRatingComment: null,
    undoneSignal: false,
    createdAt: new Date('2026-03-10T10:00:00.000Z'),
    costoPropioUsd: 0,
    costoDeLaRondaUsd: 0,
    ...parcial,
  };
}

await prueba('agruparPorTurno: una CORRECTION/VERIFICATION sin chatMessageId propio se fusiona con su turno padre vía parentChatMessageId', () => {
  const creacion = fila({ id: 'g1', turnKind: 'GENERATION', chatMessageId: 'msg-A', costoPropioUsd: 0.17 });
  const verificacion = fila({ id: 'v1', turnKind: 'VERIFICATION', parentChatMessageId: 'msg-A', costoPropioUsd: 0.002, costoDeLaRondaUsd: 0.001 });

  const grupos = agruparPorTurno([creacion, verificacion]);
  assert.equal(grupos.length, 1, 'las dos filas pertenecen al MISMO turno, no a dos turnos separados');
  const [g] = grupos;
  assert.equal(g!.raiz?.id, 'g1');
  assert.equal(g!.rondas.length, 1);
  // 0.17 (creación) + 0.002 (propio de la verificación) + 0.001 (ronda extra, tokenUsagesDeLaRonda).
  assert.ok(Math.abs(g!.costoTotalUsd - 0.173) < 1e-9, `costo total inesperado: ${g!.costoTotalUsd}`);
});

await prueba('agruparPorTurno: dos turnos con sus propias rondas quedan en grupos DISTINTOS', () => {
  const ajuste = fila({ id: 'a1', turnKind: 'ADJUSTMENT', chatMessageId: 'msg-B', costoPropioUsd: 0.005 });
  const correccion = fila({ id: 'c1', turnKind: 'CORRECTION', parentChatMessageId: 'msg-B', costoPropioUsd: 0.001 });
  const otraCreacion = fila({ id: 'g2', turnKind: 'GENERATION', chatMessageId: 'msg-C', costoPropioUsd: 0.1 });

  const grupos = agruparPorTurno([ajuste, correccion, otraCreacion]);
  assert.equal(grupos.length, 2);
  const porClave = new Map(grupos.map((g) => [g.clave, g]));
  assert.equal(porClave.get('msg-B')!.costoTotalUsd, 0.006);
  assert.equal(porClave.get('msg-C')!.costoTotalUsd, 0.1);
});

await prueba('agruparPorTurno: una fila sin chatMessageId NI parentChatMessageId (dato histórico pre-T11) queda sola, cuenta igual su costo', () => {
  const huerfana = fila({ id: 'h1', turnKind: 'ADJUSTMENT', chatMessageId: null, parentChatMessageId: null, costoPropioUsd: 0.02 });
  const grupos = agruparPorTurno([huerfana]);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0]!.raiz, null, 'sin chatMessageId propio no es una raíz');
  assert.equal(grupos[0]!.costoTotalUsd, 0.02);
});

// ---------------------------------------------------------------------------
// Agregación por clave (modo/modelo): costo por creación/ajuste/recurso,
// duraciones, tasas.
// ---------------------------------------------------------------------------

await prueba('agregarPorClave: costoPorCreacionUsd/costoPorAjusteUsd son el promedio de los turnos de ESE tipo en esa clave', () => {
  const g1 = fila({ id: 'g1', turnKind: 'GENERATION', chatMessageId: 'm1', generationMode: 'crea-sonnet', costoPropioUsd: 0.1, durationMs: 60_000 });
  const g2 = fila({ id: 'g2', turnKind: 'GENERATION', chatMessageId: 'm2', generationMode: 'crea-sonnet', projectId: 'recurso-2', costoPropioUsd: 0.2, durationMs: 90_000 });
  const a1 = fila({ id: 'a1', turnKind: 'ADJUSTMENT', chatMessageId: 'm3', generationMode: 'crea-sonnet', costoPropioUsd: 0.01, durationMs: 30_000 });

  const grupos = agruparPorTurno([g1, g2, a1]);
  const porModo = agregarPorClave(grupos, (f) => f.generationMode);

  const fila1 = porModo.get('crea-sonnet')!;
  assert.equal(fila1.turnos, 3, '2 GENERATION + 1 ADJUSTMENT, los únicos turnKinds "raíz" probados acá');
  assert.ok(Math.abs(fila1.costoPorCreacionUsd! - 0.15) < 1e-9, `costoPorCreacionUsd esperado 0.15, dio ${fila1.costoPorCreacionUsd}`);
  assert.equal(fila1.costoPorAjusteUsd, 0.01);
  // Mediana (nearest-rank) de [60, 90] segundos, N=2: índice ceil(0.5*2)-1 = 0 -> el menor, 60.
  assert.equal(fila1.segundosMedianaCreacion, 60);
});

await prueba('agregarPorClave: segundosMedianaCreacion/segundosP90Creacion usan la duración TOTAL del grupo (incluye revisión/corrección)', () => {
  const g1 = fila({ id: 'g1', turnKind: 'GENERATION', chatMessageId: 'm1', durationMs: 60_000 });
  const v1 = fila({ id: 'v1', turnKind: 'VERIFICATION', parentChatMessageId: 'm1', durationMs: 15_000 });
  const g2 = fila({ id: 'g2', turnKind: 'GENERATION', chatMessageId: 'm2', projectId: 'recurso-2', durationMs: 100_000 });

  const grupos = agruparPorTurno([g1, v1, g2]);
  const porModo = agregarPorClave(grupos, (f) => f.generationMode);
  const base = porModo.get('base')!;

  // Grupo m1: 60s + 15s de revisión = 75s. Grupo m2: 100s. Mediana de [75, 100] (nearest-rank, N=2) -> índice 0 -> 75.
  assert.equal(base.segundosMedianaCreacion, 75);
  assert.equal(base.segundosP90Creacion, 100);
});

await prueba('agregarPorClave: tasaCorreccion es la fracción de turnos de código que arrastraron al menos una CORRECTION', () => {
  const sinCorreccion = fila({ id: 'a1', turnKind: 'ADJUSTMENT', chatMessageId: 'm1' });
  const conCorreccion = fila({ id: 'a2', turnKind: 'ADJUSTMENT', chatMessageId: 'm2', projectId: 'recurso-2' });
  const correccion = fila({ id: 'c1', turnKind: 'CORRECTION', parentChatMessageId: 'm2' });

  const grupos = agruparPorTurno([sinCorreccion, conCorreccion, correccion]);
  const porModo = agregarPorClave(grupos, (f) => f.generationMode);
  assert.equal(porModo.get('base')!.tasaCorreccion, 0.5);
});

await prueba('agregarPorClave: tasaFallaEdicion sólo cuenta editOutcome conocido (nunca null como "no falló")', () => {
  const ok = fila({ id: 'a1', turnKind: 'ADJUSTMENT', chatMessageId: 'm1', editOutcome: 'FULL' });
  const fallo = fila({ id: 'a2', turnKind: 'ADJUSTMENT', chatMessageId: 'm2', projectId: 'recurso-2', editOutcome: 'FAILED' });
  const sinDato = fila({ id: 'a3', turnKind: 'ADJUSTMENT', chatMessageId: 'm3', projectId: 'recurso-3', editOutcome: null });

  const grupos = agruparPorTurno([ok, fallo, sinDato]);
  const porModo = agregarPorClave(grupos, (f) => f.generationMode);
  const base = porModo.get('base')!;
  assert.equal(base.tasaFallaEdicion, 0.5, '1 fallo de 2 con editOutcome conocido (la tercera, null, no entra al denominador)');
  assert.equal(base.mensajesFalloHonesto, 1);
});

await prueba('agregarPorClave: tasaBanderaRoja y tasaArreglo', () => {
  const v1 = fila({ id: 'v1', turnKind: 'VERIFICATION', chatMessageId: 'm1', redFlags: 'agregar_trivial' });
  const v2 = fila({ id: 'v2', turnKind: 'VERIFICATION', chatMessageId: 'm2', projectId: 'recurso-2', redFlags: null });
  const c1 = fila({ id: 'c1', turnKind: 'CORRECTION', parentChatMessageId: 'm1', redFlagsFixed: true });

  const grupos = agruparPorTurno([v1, v2, c1]);
  const porModo = agregarPorClave(grupos, (f) => f.generationMode);
  const base = porModo.get('base')!;
  assert.equal(base.tasaBanderaRoja, 0.5);
  assert.equal(base.tasaArreglo, 1);
});

await prueba('agregarPorClave: costoPorRecursoUsd es el costo COMPLETO de un proyecto (creación + todos sus ajustes), atribuido al modo con el que se CREÓ', () => {
  const creacion = fila({ id: 'g1', turnKind: 'GENERATION', chatMessageId: 'm1', projectId: 'recurso-1', generationMode: 'crea-sonnet', costoPropioUsd: 0.17 });
  const ajuste1 = fila({ id: 'a1', turnKind: 'ADJUSTMENT', chatMessageId: 'm2', projectId: 'recurso-1', generationMode: 'base', costoPropioUsd: 0.005 });
  const ajuste2 = fila({ id: 'a2', turnKind: 'ADJUSTMENT', chatMessageId: 'm3', projectId: 'recurso-1', generationMode: 'base', costoPropioUsd: 0.005 });

  const grupos = agruparPorTurno([creacion, ajuste1, ajuste2]);
  const porModo = agregarPorClave(grupos, (f) => f.generationMode);
  // El recurso se creó en "crea-sonnet": TODO su costo (0.17 + 0.005*2 = 0.18) se atribuye ahí,
  // aunque los ajustes individuales corrieran en "base".
  assert.ok(Math.abs(porModo.get('crea-sonnet')!.costoPorRecursoUsd! - 0.18) < 1e-9);
});

// ---------------------------------------------------------------------------
// "¿Sobra crédito?": sugerencias por modo, medido vs. constante.
// ---------------------------------------------------------------------------

await prueba('sugerenciasDeModo: con datos medidos en el rango, usa el costo REAL (no la constante del código)', () => {
  const porModo = new Map<string, FilaUsoPorClave>([
    [
      'crea-sonnet',
      {
        clave: 'crea-sonnet',
        etiqueta: 'Sonnet para crear',
        turnos: 1,
        costoTotalUsd: 0.2,
        costoPorCreacionUsd: 0.2,
        costoPorAjusteUsd: 0.01,
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
      },
    ],
  ]);

  const sugerencias = sugerenciasDeModo(porModo, 10, 2);
  const sonnet = sugerencias.find((s) => s.modo === 'crea-sonnet')!;
  assert.equal(sonnet.fuente, 'medido');
  // 10 recursos × (0.2 creación + 2 ajustes × 0.01) = 10 × 0.22 = 2.2.
  assert.ok(Math.abs(sonnet.costoMensualEstimadoUsd - 2.2) < 1e-9);
});

await prueba('sugerenciasDeModo: sin datos medidos de un modo, cae a la constante de modos-generacion.ts', () => {
  const sugerencias = sugerenciasDeModo(new Map(), 10, 0);
  const haiku = sugerencias.find((s) => s.modo === 'base')!;
  assert.equal(haiku.fuente, 'constante');
  assert.ok(haiku.costoMensualEstimadoUsd > 0, 'la constante del modo base (≈USD 0,008) extraída del texto debe dar algo > 0');
});

await prueba('sugerenciasDeModo: devuelve exactamente las claves de MODES (todas, sin "personalizado")', () => {
  const sugerencias = sugerenciasDeModo(new Map(), 0, 0);
  assert.deepEqual(
    sugerencias.map((s) => s.modo).sort(),
    Object.keys(MODES).sort(),
  );
});

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('\nTodo OK.');
