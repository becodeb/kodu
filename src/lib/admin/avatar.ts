/**
 * Iniciales y color de avatar compartidos entre `UsuariosTabla.tsx` y la
 * ficha de un docente (`usuarios/[id].astro`) — antes cada uno tenía su
 * propia versión, y la de la ficha no filtraba puntuación: un nombre como
 * "Docente E2E T3 (verificador)" daba "D(" en vez de dos letras (parent
 * review, odd/tasks/admin-ui-redesign.md polish #1).
 *
 * `\p{L}\p{N}` (Unicode) y no `[A-Za-z0-9]`: un nombre con tilde o en otro
 * alfabeto también tiene que dar una inicial, no quedarse vacío.
 */

const LETRA_O_NUMERO = /[\p{L}\p{N}]/u;

export function inicialesAvatar(nombre: string): string {
  const letras = nombre
    .trim()
    .split(/\s+/)
    .map((palabra) => palabra.match(LETRA_O_NUMERO)?.[0] ?? '')
    .filter((letra) => letra !== '');

  if (letras.length === 0) return '?';
  const primera = letras[0]!;
  const segunda = letras.length > 1 ? letras[letras.length - 1]! : '';
  return `${primera}${segunda}`.toUpperCase();
}

/** Un tono fijo de la rampa de marca por id (hash del id, no del índice en la
 *  lista: así una fila no cambia de color cuando un filtro reordena el
 *  arreglo). Se usa para el avatar de un docente y para la portada de un
 *  recurso sin captura — mismo criterio, mismas tres variantes. */
const TONOS = ['bg-brand-50 text-brand-700', 'bg-brand-100 text-brand-700', 'bg-sutil text-ink-700'];

function hashSimple(texto: string): number {
  let hash = 0;
  for (let i = 0; i < texto.length; i++) hash = (hash * 31 + texto.charCodeAt(i)) >>> 0;
  return hash;
}

export function tonoPorId(id: string): string {
  return TONOS[hashSimple(id) % TONOS.length]!;
}
