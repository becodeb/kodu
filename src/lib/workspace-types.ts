/** Tipos que comparten la página Astro del editor y las islas de React. */

export type ModelChoice = 'FLASH' | 'PRO';

export interface WorkspaceProject {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  currentHtml: string;
  selectedModel: ModelChoice;
  isInGallery: boolean;
  screenshotUrl: string | null;
}

export interface WorkspaceThread {
  id: string;
  title: string;
}

export interface WorkspaceMessage {
  id: string;
  role: string;
  content: string;
  attachments: string[];
}

export interface WorkspaceAsset {
  id: string;
  filename: string;
  url: string;
  fileType: string;
}

/**
 * En qué anda la IA. Le da al docente una lectura honesta del turno: no es lo
 * mismo esperar la primera palabra que verla reescribir el recurso entero.
 */
export type AiPhase =
  | 'idle'
  /** Se subieron archivos y todavía están viajando. */
  | 'uploading'
  /** El pedido salió y todavía no volvió nada. */
  | 'thinking'
  /** Está redactando la explicación en el chat. */
  | 'writing'
  /** Está escribiendo el código del recurso. */
  | 'coding';
