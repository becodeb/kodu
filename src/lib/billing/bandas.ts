/**
 * odd/tasks/planes-y-cobros.md (T1): bandas de matrícula institucional.
 * Módulo PURO — sin Prisma, sin fecha de sistema, sin I/O. La única fuente de
 * verdad de "qué banda le toca a una matrícula" es esta función; el catálogo
 * (`InstitutionalBand`, editable desde el superadmin) sólo guarda el PRECIO
 * de cada banda, nunca sus límites de matrícula — esos límites son una regla
 * del negocio (decisión del dueño, no reabrir), no un dato editable.
 *
 * Decisión del dueño: Pequeña hasta 300, Mediana 301–800, Grande 801–1.500.
 * Más de 1.500 (o una red grande) no matchea ninguna banda: es "Hablemos".
 */

export type BandKey = 'PEQUENA' | 'MEDIANA' | 'GRANDE';

/** Los límites de matrícula de cada banda, fijos (no vienen del catálogo). */
export const LIMITES_DE_BANDA: Record<BandKey, { minStudents: number; maxStudents: number }> = {
  PEQUENA: { minStudents: 1, maxStudents: 300 },
  MEDIANA: { minStudents: 301, maxStudents: 800 },
  GRANDE: { minStudents: 801, maxStudents: 1500 },
};

/** Umbral por default de "Hablemos" (decisión del dueño: 1.500). El umbral
 *  real vive en `BillingSettings.hablemosThresholdStudents` — se pasa como
 *  parámetro para que este módulo siga sin tocar la base. */
export const HABLEMOS_THRESHOLD_DEFAULT = 1500;

export type BandaResultado =
  | { kind: 'band'; key: BandKey }
  | { kind: 'hablemos' }
  | { kind: 'invalid'; reason: string };

/**
 * A qué banda le toca una matrícula declarada. `n` tiene que ser un entero
 * ≥ 1 — cualquier otra cosa (0, negativo, fraccionario, NaN) es inválida: no
 * existe una organización con menos de un alumno ni con matrícula fraccionaria.
 *
 * `hablemosThreshold` es el umbral configurado en `BillingSettings` (default
 * 1.500, decisión del dueño) — por encima de él, "Hablemos" sin importar si
 * técnicamente calzaría en la banda Grande.
 */
export function bandForStudents(n: number, hablemosThreshold: number = HABLEMOS_THRESHOLD_DEFAULT): BandaResultado {
  if (!Number.isInteger(n)) {
    return { kind: 'invalid', reason: 'la matrícula tiene que ser un número entero' };
  }
  if (n < 1) {
    return { kind: 'invalid', reason: 'la matrícula tiene que ser mayor o igual a 1' };
  }

  if (n > hablemosThreshold) {
    return { kind: 'hablemos' };
  }

  for (const key of Object.keys(LIMITES_DE_BANDA) as BandKey[]) {
    const { minStudents, maxStudents } = LIMITES_DE_BANDA[key];
    if (n >= minStudents && n <= maxStudents) {
      return { kind: 'band', key };
    }
  }

  // No debería pasar nunca: las tres bandas cubren [1, HABLEMOS_THRESHOLD_DEFAULT]
  // sin huecos mientras hablemosThreshold sea >= 1500. Si el superadmin baja el
  // umbral por debajo de 1500, un n en el hueco (p.ej. threshold=700, n=750)
  // también tiene que caer en "Hablemos", no en un error silencioso.
  return { kind: 'hablemos' };
}
