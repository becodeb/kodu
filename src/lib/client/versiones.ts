import type { WorkspaceMessage } from '../workspace-types.ts';

/**
 * T9 ("Varias versiones al crear un recurso"): la última elección de ESTE
 * navegador sobre si pedir varias versiones persiste en `localStorage`
 * (mismo patrón que T6, `client/velocidad.ts`) — pero acá "off por default"
 * es la decisión del dueño sin matices: a diferencia de la velocidad, no hay
 * un default que dependa de la cuenta, así que ausente en `localStorage` es
 * sencillamente `false`.
 */
const STORAGE_KEY = 'kodu-versiones';

export function leerVersionesGuardado(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Modo privado, cookies bloqueadas, etc.: seguimos apagado, no rompemos el turno.
    return false;
  }
}

export function guardarVersiones(activo: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, activo ? '1' : '0');
  } catch {
    // Si no se puede guardar, sólo se pierde la persistencia entre sesiones.
  }
}

/**
 * Qué mensaje "assistant" muestra ahora mismo la fila de chips de versiones.
 *
 * A propósito NO es "el más nuevo con versiones" recorriendo desde el final
 * (como sí hace `mensajeParaDeshacer` con `canUndo`, que puede saltar turnos
 * sin cambios de por medio): la tarea es explícita en que la fila
 * "desaparece en cuanto el docente manda el próximo mensaje", así que sólo
 * cuenta el ÚLTIMO elemento de la lista — ni siquiera un turno más nuevo sin
 * versiones puede dejar reaparecer las de uno viejo.
 */
export function mensajeParaVersiones(messages: WorkspaceMessage[]): string | null {
  const ultimo = messages[messages.length - 1];
  if (!ultimo || ultimo.role !== 'assistant') return null;
  if (!ultimo.variants || ultimo.variants.length === 0) return null;
  return ultimo.id;
}
