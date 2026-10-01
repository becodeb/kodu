import { fechaAr } from '../ciclo.ts';

/**
 * odd/tasks/planes-y-cobros.md (T8): utilidades mínimas de XML/SOAP para
 * hablarle a WSAA y WSFEv1. No se agregó ninguna dependencia nueva (el
 * `node_modules` de este worktree es un symlink al checkout principal) — los
 * pedidos de ARCA tienen una forma FIJA y conocida, así que alcanza con
 * armarlos por template string y leerlos con una extracción de tags por
 * regex (nunca un parser XML genérico: no hace falta soportar XML arbitrario,
 * sólo las respuestas de estos dos servicios).
 */

/** `yyyymmdd` en hora de Argentina (mismo criterio de `ciclo.ts#fechaAr`). */
export function yyyymmdd(fecha: Date): string {
  const { year, month, day } = fechaAr(fecha);
  return `${String(year).padStart(4, '0')}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

/** Extrae el contenido de texto del PRIMER tag `<nombre ...>...</nombre>`
 *  (con o sin namespace prefix: `<a:nombre>`). `null` si no está. */
export function extraerTag(xml: string, nombre: string): string | null {
  const match = xml.match(new RegExp(`<(?:[a-zA-Z0-9]+:)?${nombre}[^>]*>([^<]*)</(?:[a-zA-Z0-9]+:)?${nombre}>`));
  return match ? match[1] : null;
}

/** Extrae TODOS los bloques `<nombre>...</nombre>` completos (con sus tags),
 *  para iterar un array de elementos repetidos (p.ej. `<Obs>` dentro de
 *  `<Observaciones>`). */
export function extraerBloques(xml: string, nombre: string): string[] {
  const regex = new RegExp(`<(?:[a-zA-Z0-9]+:)?${nombre}[^>]*>[\\s\\S]*?</(?:[a-zA-Z0-9]+:)?${nombre}>`, 'g');
  return xml.match(regex) ?? [];
}

export function escaparXml(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
