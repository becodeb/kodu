/** Tipos que comparten la página Astro del editor y las islas de React. */

/**
 * Lo que el docente ve de un motor en el selector: sin `provider`/`providerModel`
 * (identificadores internos), sin claves, sin precios. Lo produce
 * `motoresParaDocente()` en `src/lib/ai/catalogo.ts`, ya en el orden que
 * configuró un admin.
 */
export interface MotorPublico {
  id: string;
  displayName: string;
  description: string | null;
  supportsVision: boolean;
}

export interface WorkspaceProject {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  currentHtml: string;
  /** El `id` del `AiModel` vigente para este proyecto (nunca el enum viejo). */
  aiModelId: string;
  isInGallery: boolean;
  screenshotUrl: string | null;
  /** El recurso cambió después de la última portada (design §6). */
  portadaVieja: boolean;
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
  /**
   * Nombre del admin que escribió este turno, cuando NO fue el dueño del
   * recurso (M8, design.md §7). `null`/ausente en el caso normal — el
   * dueño escribiendo su propio recurso nunca lleva esta marca.
   */
  authorName?: string | null;
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
