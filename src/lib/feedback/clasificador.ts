/**
 * odd/tasks/ahorro-tokens.md (T5): señal implícita (a) — el PRÓXIMO mensaje
 * del docente sobre el mismo recurso matchea una frase de defecto ("no
 * funciona", "no anda", "error", "arreglá/arreglalo", "se rompió", "no
 * hace nada", "no aparece", "sigue igual", y similares). Pura, sin Prisma,
 * para poder testearla directo.
 *
 * Insensible a mayúsculas/acentos: se normaliza con NFD + se quitan las
 * marcas diacríticas antes de comparar, así "arreglá", "arreglalo" y
 * "arreglar" matchean todas con la raíz "arregl".
 */

const NORMALIZADOR_DIACRITICOS = /\p{Diacritic}/gu;

export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(NORMALIZADOR_DIACRITICOS, '')
    .toLowerCase();
}

/**
 * Cada entrada es una raíz normalizada que alcanza para cubrir sus
 * variantes (ver el comentario de arriba) — nunca una palabra completa
 * cuando una raíz más corta ya las cubre todas.
 */
const FRASES_DEFECTO: readonly string[] = [
  'no funciona',
  'no anda',
  'error',
  'arregla', // arreglá, arreglalo, arreglalá, arreglar
  'arreglame',
  'se rompio', // se rompió (ya normalizado)
  'no hace nada',
  'no aparece',
  'sigue igual',
  'no sirve',
  'esta roto', // está roto/rota
  'esta mal', // está mal
];

/**
 * Devuelve la frase (en su forma de catálogo, no la del docente) que
 * matcheó, o `null` si el mensaje no sugiere un defecto. Sólo la PRIMERA
 * que matchea, en el orden del catálogo — alcanza con una para marcar la
 * traza anterior como `suspectedDefect`.
 */
export function detectarFraseDefecto(mensaje: string): string | null {
  const normalizado = normalizarTexto(mensaje);
  for (const frase of FRASES_DEFECTO) {
    if (normalizado.includes(frase)) return frase;
  }
  return null;
}
