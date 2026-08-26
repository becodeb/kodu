/** Tipos que comparten la página Astro del editor y las islas de React. */

export type ModelChoice = 'ALPHA' | 'DEEPSEEK' | 'MINIMAX';

/**
 * Lo que el docente ve del motor.
 *
 * Hay uno solo: MiniMax M3. DeepSeek NO figura a propósito — está bajo llave y
 * entra solo, como respaldo, cuando MiniMax no responde. Alpha salió de
 * servicio cuando dejó de ser gratuito.
 */
export const MODELOS: Array<{
  value: ModelChoice;
  nombre: string;
  detalle: string;
}> = [
  {
    value: 'MINIMAX',
    nombre: 'MiniMax M3',
    detalle: 'Contexto largo, entiende las imágenes que subas y trabaja sobre tu código.',
  },
];

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
  /** Epoch ms. Permite mostrar hace cuánto espera un turno que sigue corriendo. */
  createdAt?: number;
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
