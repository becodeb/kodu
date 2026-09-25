import { prisma } from '../db.ts';
import { leerChecklist, type ItemChecklist } from './checklist.ts';

/**
 * El checklist VIGENTE de un proyecto (round 4, T16): el `ChatMessage.checklist`
 * (JSON de `ItemChecklist[]`) del mensaje "assistant" MÁS RECIENTE con
 * `checklist != null` y `undoneAt == null`, en cualquier hilo del proyecto —
 * mismo alcance que `Project.currentHtml` (T4, "Deshacer cambios de la IA"
 * ya trata el HTML como del proyecto, no de un hilo puntual). Deshacer el
 * turno que lo creó lo descarta solo: ese mensaje queda con `undoneAt`
 * puesto y esta consulta deja de encontrarlo, sin lógica aparte.
 *
 * Server-only (importa Prisma) — separado de `checklist.ts` (isomórfico) a
 * propósito, mismo criterio que separa `revision-visual.ts` de cualquier
 * cosa que necesite la base.
 *
 * Reusado por `stream.ts` (turnos de AJUSTE: sumar `bloqueChecklistParaAjuste`
 * al bloque del recurso actual) y por `autocorreccion.ts` (T17: citar el
 * TEXTO de cada ítem fallido en el mensaje de corrección).
 */
export async function checklistActual(projectId: string): Promise<ItemChecklist[]> {
  const fila = await prisma.chatMessage.findFirst({
    where: {
      thread: { projectId },
      role: 'assistant',
      checklist: { not: null },
      undoneAt: null,
    },
    orderBy: { createdAt: 'desc' },
    select: { checklist: true },
  });

  return leerChecklist(fila?.checklist ?? null);
}
