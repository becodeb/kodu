import type { ItemChecklist } from '../ai/checklist.ts';
import type { ResultadoPrueba } from '../ai/autoprueba.ts';

/**
 * Estado por ítem del checklist del docente para la UI del editor (round 4,
 * `odd/tasks/arnes-robustez.md`, T18: "Esto es lo que probé").
 *
 * Puro (sin DOM, sin React): cruza el checklist vigente del recurso
 * (`ItemChecklist[]`, T16) con el resultado de `window.__koduPruebas` de la
 * ÚLTIMA autoprueba corrida en ESTA sesión (`ultimasPruebas` en
 * Workspace.tsx, T17/T14) — nunca vuelve a correr nada, sólo lee lo que ya
 * se corrió.
 *
 *  - `'sinProbar'`: todavía no corrió NINGUNA autoprueba sobre el HTML
 *    actual en esta sesión (recién se abrió la página, o el HTML acaba de
 *    cambiar — turno nuevo, deshacer, versión, edición a mano — y la
 *    autoprueba de ESE cambio todavía no terminó). `ultimaCorrida ===
 *    undefined` es la marca de esto — Workspace.tsx la pone en cada punto
 *    donde ya ponía `null` para "hay que volver a probar", cambiado a
 *    `undefined` justo para poder distinguir este caso del de abajo.
 *  - `'sinPrueba'`: SÍ corrió una autoprueba, pero el recurso no tiene
 *    `window.__koduPruebas` en absoluto (`ultimaCorrida === null`, T14: la
 *    marca de "recurso viejo o sin checklist") — o corrió y el recurso SÍ
 *    tiene pruebas, pero ninguna lleva el id de este ítem (el modelo no
 *    escribió una prueba para él).
 *  - `'ok'` / `'falla'`: corrió y hay una prueba con este id — su resultado.
 *    `detalle` sólo viaja con `'falla'` (mismo criterio que
 *    `construirMensajeCorreccion`: el detalle de una prueba que pasó no le
 *    dice nada al docente).
 */
export type EstadoItemChecklist = 'ok' | 'falla' | 'sinPrueba' | 'sinProbar';

export interface ItemChecklistConEstado extends ItemChecklist {
  estado: EstadoItemChecklist;
  detalle: string | null;
}

export function estadoDeChecklist(
  items: ItemChecklist[],
  ultimaCorrida: ResultadoPrueba[] | null | undefined,
): ItemChecklistConEstado[] {
  return items.map((item) => {
    if (ultimaCorrida === undefined) return { ...item, estado: 'sinProbar', detalle: null };
    if (ultimaCorrida === null) return { ...item, estado: 'sinPrueba', detalle: null };

    const resultado = ultimaCorrida.find((prueba) => prueba.id === item.id);
    if (!resultado) return { ...item, estado: 'sinPrueba', detalle: null };

    return resultado.ok
      ? { ...item, estado: 'ok', detalle: null }
      : { ...item, estado: 'falla', detalle: resultado.detalle };
  });
}

/** Cuántos ítems del checklist están `'ok'`, para el resumen "N de TOTAL". */
export function contarChecklistOk(items: ItemChecklistConEstado[]): number {
  return items.filter((item) => item.estado === 'ok').length;
}
