/**
 * Aplicación de `edit_resource_code` (odd/tasks/ahorro-tokens.md, T3a) sobre
 * el HTML REAL guardado de un recurso — nunca sobre lo que el modelo vio en
 * el prompt (que puede venir plegado por `plegarKit` y/o recortado por
 * `MAX_HTML_CHARS`, ver `prompt.ts`).
 *
 * Todo-o-nada: se valida que CADA `find` aparezca exactamente una vez en el
 * HTML real, que ninguno caiga dentro del bloque canónico del kit (zona que
 * el modelo nunca vio sin plegar) ni más allá del punto en que el prompt
 * cortó el documento (zona que el modelo nunca vio en absoluto), y que los
 * rangos encontrados no se superpongan entre sí. Si cualquier edición falla
 * esa validación, NINGUNA se aplica — el llamador (`stream.ts`) decide qué
 * hacer con el motivo (reintento con `edit_resource_code` o rewrite).
 *
 * Módulo puro: sin Prisma ni I/O, para poder testearlo con `tsx` a secas.
 */

import { plegarKit, rangoBloqueKit } from './kit.ts';

export interface ResourceEdit {
  find: string;
  replace: string;
}

export type ApplyEditsFailureReason =
  /** El `find` no tiene longitud: nunca debería llegar acá (ya lo filtra `parseEditResourceArgs`). */
  | 'empty_find'
  | 'no_match'
  | 'multiple_matches'
  /** Dos `find` de la misma tanda matchean rangos que se pisan entre sí. */
  | 'overlap'
  /** El `find` cae (total o parcialmente) dentro del bloque canónico del kit: el modelo nunca vio ese texto, viaja plegado en el prompt. */
  | 'folded_region'
  /** El `find` empieza en o después del punto en que `MAX_HTML_CHARS` cortó el documento que vio el modelo. */
  | 'truncated_region';

export type ApplyEditsResult =
  | { ok: true; html: string }
  | { ok: false; reason: ApplyEditsFailureReason; index: number; find: string };

/**
 * Offset en el HTML REAL a partir del cual el prompt NO mostró nada (por el
 * corte de `maxVisibleChars` sobre el HTML YA plegado — ver
 * `buildCurrentResourceBlock`). `null` si el documento plegado entra entero
 * (nada se truncó).
 *
 * El corte se mide sobre el HTML plegado, así que si cae DENTRO o DESPUÉS
 * del marcador de una línea que reemplaza al bloque del kit, hay que
 * traducirlo de vuelta a la posición real correspondiente — el marcador es
 * mucho más corto que el bloque que reemplaza.
 */
function offsetTruncamientoReal(htmlReal: string, maxVisibleChars: number): number | null {
  const visible = plegarKit(htmlReal);
  if (visible.length <= maxVisibleChars) return null;

  const bloque = rangoBloqueKit(htmlReal);
  if (!bloque) return maxVisibleChars; // sin bloque de kit: el mapeo es 1 a 1.

  const finMarcadorEnVisible = bloque.desde + bloque.largoMarcador;

  if (maxVisibleChars <= bloque.desde) return maxVisibleChars; // el corte cae antes del kit.
  if (maxVisibleChars <= finMarcadorEnVisible) return bloque.hasta; // el corte cae a mitad del marcador: se trata todo el bloque como ya mostrado/cortado ahí.
  return bloque.hasta + (maxVisibleChars - finMarcadorEnVisible); // el corte cae después del kit: se corre por la diferencia de tamaño bloque/marcador.
}

export function applyResourceEdits(
  htmlReal: string,
  edits: readonly ResourceEdit[],
  maxVisibleChars: number,
): ApplyEditsResult {
  const bloque = rangoBloqueKit(htmlReal);
  const offsetTruncamiento = offsetTruncamientoReal(htmlReal, maxVisibleChars);

  const rangos: { start: number; end: number; index: number }[] = [];

  for (let index = 0; index < edits.length; index++) {
    const { find } = edits[index]!;

    if (find.length === 0) return { ok: false, reason: 'empty_find', index, find };

    const start = htmlReal.indexOf(find);
    if (start === -1) return { ok: false, reason: 'no_match', index, find };

    const segundaAparicion = htmlReal.indexOf(find, start + 1);
    if (segundaAparicion !== -1) return { ok: false, reason: 'multiple_matches', index, find };

    const end = start + find.length;

    if (bloque && start < bloque.hasta && end > bloque.desde) {
      return { ok: false, reason: 'folded_region', index, find };
    }

    if (offsetTruncamiento !== null && start >= offsetTruncamiento) {
      return { ok: false, reason: 'truncated_region', index, find };
    }

    rangos.push({ start, end, index });
  }

  const ordenados = [...rangos].sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordenados.length; i++) {
    if (ordenados[i]!.start < ordenados[i - 1]!.end) {
      const conflicto = ordenados[i]!;
      return { ok: false, reason: 'overlap', index: conflicto.index, find: edits[conflicto.index]!.find };
    }
  }

  let resultado = '';
  let cursor = 0;
  for (const rango of ordenados) {
    resultado += htmlReal.slice(cursor, rango.start) + edits[rango.index]!.replace;
    cursor = rango.end;
  }
  resultado += htmlReal.slice(cursor);

  return { ok: true, html: resultado };
}

/** Mensaje para el docente/el modelo cuando una edición falla, en español, sin tecnicismos para el primero. */
export const EDIT_FAILURE_MESSAGES: Record<ApplyEditsFailureReason, string> = {
  empty_find: 'uno de los cambios no traía texto para buscar',
  no_match: 'no encontré ese texto exacto en el recurso actual',
  multiple_matches: 'ese texto aparece más de una vez en el recurso: no es un punto único para editar',
  overlap: 'dos de los cambios pedidos se superponen en el mismo lugar del documento',
  folded_region: 'ese texto pertenece a una parte interna del kit que no viaja en tu contexto',
  truncated_region: 'ese texto está más allá de la parte del documento que se te mostró',
};
