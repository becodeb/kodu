import type { WorkspaceMessage } from '../workspace-types.ts';

/**
 * T4 ("Deshacer cambios de la IA"): qué mensaje de la IA hay que ofrecer para
 * deshacer — el más nuevo (recorriendo desde el final, porque `messages` ya
 * viene en orden cronológico ascendente) que todavía se puede deshacer.
 * `null` cuando no hay ninguno: hilo nuevo, o ya se deshicieron todos los
 * turnos que tenían instantánea.
 *
 * Sólo mira `canUndo` (que el servidor ya calculó sobre si hay instantánea y
 * si `undoneAt` sigue en `null`): así, apenas se deshace uno, el próximo más
 * nuevo pasa a ser el candidato solo — con `canUndo` puesto desde que se
 * cargó, no hace falta ninguna regla nueva acá para "caminar hacia atrás".
 */
export function mensajeParaDeshacer(messages: WorkspaceMessage[]): string | null {
  for (let indice = messages.length - 1; indice >= 0; indice--) {
    const mensaje = messages[indice]!;
    if (mensaje.role === 'assistant' && mensaje.canUndo) return mensaje.id;
  }
  return null;
}
