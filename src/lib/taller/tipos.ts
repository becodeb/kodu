/**
 * Taller de ideas: lo que cruza del servidor a la isla de React
 * (`TallerDeIdeas.tsx`). Sólo tipos y strings/números: nunca un `Date` ni un
 * tipo de Prisma, mismo criterio que `workspace-types.ts`.
 */

import type { FichaIdea, IdeaPropuesta, PreguntaTaller } from './ficha.ts';
import type { ModoTaller } from './prompt.ts';

export interface MensajeTaller {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  questions: PreguntaTaller[];
  proposals: IdeaPropuesta[];
  attachments: string[];
}

export interface AdjuntoTallerCliente {
  id: string;
  filename: string;
  url: string;
  fileType: string;
}

export interface SesionTaller {
  id: string;
  mode: ModoTaller;
  title: string | null;
  brief: FichaIdea;
  finalPrompt: string | null;
  description: string | null;
  /** El recurso que salió de esta charla: con valor, la charla es de sólo lectura. */
  projectId: string | null;
  messages: MensajeTaller[];
  assets: AdjuntoTallerCliente[];
}

/** Eventos del SSE de `POST /api/taller/[id]/turno`. */
export type EventoTaller =
  | { type: 'text'; delta: string }
  | { type: 'notice'; message: string }
  | {
      type: 'done';
      userMessage: MensajeTaller;
      message: MensajeTaller;
      brief: FichaIdea;
      title: string | null;
      description: string | null;
      finalPrompt: string | null;
    }
  | { type: 'error'; message: string };
