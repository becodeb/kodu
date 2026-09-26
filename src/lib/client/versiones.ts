import type { WorkspaceMessage } from '../workspace-types.ts';

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
