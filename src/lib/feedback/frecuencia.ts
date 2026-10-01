/**
 * odd/tasks/ahorro-tokens.md (T5): la regla de frecuencia de la pregunta
 * inline del chat ("¿Funciona bien?" / "¿Te gusta cómo se ve?") — pura, sin
 * Prisma, para poder testearla directo. El llamador (`src/lib/ai/trace.ts`)
 * resuelve el estado real (Project.feedbackTurnsSinceAsk,
 * Project.lastFeedbackPromptKind, User.feedbackPromptsDisabled, y si hay
 * una pregunta sin responder) y le pasa esta pila a la función.
 *
 * Reglas (texto de la tarea): se pregunta después de la primera generación
 * de un recurso, después a lo sumo cada ~5 turnos que cambiaron el recurso,
 * alternando entre los dos tipos. Nunca se muestra dos veces seguidas ni
 * encima de una sin responder. "No preguntar más" la apaga del todo.
 */

export type TipoPreguntaFeedback = 'FUNCIONA' | 'VISUAL';

export interface EstadoPreguntaFeedback {
  /** El docente ya pidió "No preguntar más" (`User.feedbackPromptsDisabled`). */
  promptsDeshabilitados: boolean;
  /** Este turno es la primera generación de un recurso (antes en blanco). */
  esPrimeraGeneracion: boolean;
  /** Turnos que cambiaron el recurso desde la última pregunta mostrada. */
  turnosDesdeUltimaPregunta: number;
  /** `null` = todavía no se mostró ninguna pregunta en este proyecto. */
  ultimoTipoPreguntado: TipoPreguntaFeedback | null;
  /** Hay una pregunta de un turno anterior que sigue sin responder/descartar. */
  hayPreguntaSinResponder: boolean;
}

export interface DecisionPreguntaFeedback {
  mostrar: boolean;
  tipo: TipoPreguntaFeedback | null;
}

/** Cada cuántos turnos que cambiaron el recurso se repite la pregunta, como
 *  máximo (texto de la tarea: "at most every ~5 resource-changing turns"). */
export const TURNOS_ENTRE_PREGUNTAS = 5;

function alternar(ultimo: TipoPreguntaFeedback | null): TipoPreguntaFeedback {
  return ultimo === 'FUNCIONA' ? 'VISUAL' : 'FUNCIONA';
}

export function decidirPreguntaFeedback(estado: EstadoPreguntaFeedback): DecisionPreguntaFeedback {
  // "Nunca... encima de una sin responder" y "No preguntar más" ganan
  // siempre, antes que cualquier otra regla.
  if (estado.promptsDeshabilitados || estado.hayPreguntaSinResponder) {
    return { mostrar: false, tipo: null };
  }

  // "Ask after the first generation of a resource": siempre 'FUNCIONA',
  // sin importar `turnosDesdeUltimaPregunta` (un proyecto recién creado
  // arranca en 0 de cualquier manera).
  if (estado.esPrimeraGeneracion) {
    return { mostrar: true, tipo: 'FUNCIONA' };
  }

  if (estado.turnosDesdeUltimaPregunta >= TURNOS_ENTRE_PREGUNTAS) {
    return { mostrar: true, tipo: alternar(estado.ultimoTipoPreguntado) };
  }

  return { mostrar: false, tipo: null };
}
