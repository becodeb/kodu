/** Tipos que comparten la página Astro del editor y las islas de React. */

export type ModelChoice = 'ALPHA' | 'DEEPSEEK';

/** Lo que el docente ve de cada modelo al elegirlo. */
export const MODELOS: Array<{
  value: ModelChoice;
  nombre: string;
  detalle: string;
  /** Consume cupo pago: hay que avisarlo antes de que lo elija. */
  conCupo: boolean;
}> = [
  {
    value: 'ALPHA',
    nombre: 'Alpha',
    detalle: 'Gratis y sin límite. Entiende las imágenes que subas.',
    conCupo: false,
  },
  {
    value: 'DEEPSEEK',
    nombre: 'DeepSeek',
    detalle: 'Se paga por uso, así que tenés un cupo de tokens. No lee imágenes.',
    conCupo: true,
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
