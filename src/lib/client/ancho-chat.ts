/** Ancho del chat en px. 24rem: el que tenía la columna antes del divisor. */
export const ANCHO_CHAT_INICIAL = 384;
export const ANCHO_CHAT_MIN = 288;
/** Lo mínimo que se le deja al recurso, para que nunca desaparezca. Con
 *  menos, la barra de botones de la vista previa se parte en dos renglones. */
export const ANCHO_RECURSO_MIN = 440;

const CLAVE = 'kodu-ancho-chat';

/** Preferencia de este navegador; puede no estar (modo privado, almacenamiento
 *  bloqueado), y entonces vale el ancho de siempre. */
export function leerAnchoChat(): number {
  try {
    const guardado = Number(window.localStorage.getItem(CLAVE));
    return Number.isFinite(guardado) && guardado >= ANCHO_CHAT_MIN ? guardado : ANCHO_CHAT_INICIAL;
  } catch {
    return ANCHO_CHAT_INICIAL;
  }
}

export function guardarAnchoChat(ancho: number): void {
  try {
    window.localStorage.setItem(CLAVE, String(ancho));
  } catch {
    // Sin almacenamiento el divisor igual anda; sólo no se recuerda.
  }
}
