/**
 * El pedido que el docente escribe en "Crear recurso → Ya sé lo que quiero"
 * viaja del diálogo al editor por `sessionStorage`, atado al id del recurso:
 * nunca en la URL (quedaría en el historial y en los logs del servidor) y sin
 * columna nueva en la base, porque sólo vive el instante entre crear y abrir.
 *
 * Se lee UNA vez: `tomarPedidoDirecto` lo borra al leerlo, así recargar el
 * editor no lo vuelve a mandar.
 */

const PREFIJO = 'kodu-pedido-directo:';

export function guardarPedidoDirecto(projectId: string, pedido: string): void {
  try {
    sessionStorage.setItem(PREFIJO + projectId, pedido);
  } catch {
    // Sin storage (modo privado estricto) el editor abre vacío: el docente
    // escribe el pedido ahí, que es como funcionaba antes.
  }
}

export function tomarPedidoDirecto(projectId: string): string | null {
  try {
    const pedido = sessionStorage.getItem(PREFIJO + projectId);
    if (pedido !== null) sessionStorage.removeItem(PREFIJO + projectId);
    return pedido;
  } catch {
    return null;
  }
}
