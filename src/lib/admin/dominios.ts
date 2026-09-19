import { prisma } from '../db.ts';
import { fechaLarga } from '../format/fecha.ts';

/**
 * Lectura para `/admin/dominios` (design.md §10). El dato ya llega
 * convertido a `string` — nada de `Date` cruza hacia `DominiosPanel.tsx`,
 * que es una isla `client:load` (mismo borde que `modelos.ts`/`usuarios.ts`
 * ya resuelven para sus propias tablas).
 */

export interface FilaDominioAdmin {
  id: string;
  pattern: string;
  note: string | null;
  /** "agregado el 4 de marzo". */
  agregadoDisplay: string;
}

export async function listarDominiosAdmin(): Promise<FilaDominioAdmin[]> {
  const filas = await prisma.authorizedDomain.findMany({ orderBy: { createdAt: 'asc' } });
  return filas.map((fila) => ({
    id: fila.id,
    pattern: fila.pattern,
    note: fila.note,
    agregadoDisplay: `agregado el ${fechaLarga(fila.createdAt)}`,
  }));
}
