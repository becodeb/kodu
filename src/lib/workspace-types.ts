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

/**
 * Lo que el editor le puede ofrecer a ESTE docente (T5, odd/tasks/modo-prime.md
 * — "Discreto" en las decisiones del dueño: la palabra "prime" y cualquier
 * bandera de `AppSettings` NUNCA cruzan al cliente, sólo lo que puede hacer).
 * Lo arma `project/[id].astro` a partir de `Capacidades`
 * (`src/lib/ai/capacidades.ts`, server-only), quedándose SÓLO con estos dos
 * campos — nunca ese objeto entero.
 */
export interface CapacidadesEditor {
  /** T6 ("Velocidad Rápido / A fondo"): puede elegir velocidad en el compositor. */
  puedeElegirVelocidad: boolean;
  /** T9 ("Varias versiones al crear"): puede pedir varias versiones. */
  puedePedirVersiones: boolean;
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
  /**
   * T4 ("Deshacer cambios de la IA"): epoch ms de cuándo se deshizo este
   * mensaje, o `null`/ausente si sigue vigente. Deshacer marca a la vez el
   * mensaje de la IA y el pedido del docente que lo disparó, así que los DOS
   * mensajes del par quedan con esto puesto.
   */
  undoneAt?: number | null;
  /**
   * T4: si este mensaje puntual se puede pedir deshacer ahora mismo (tiene
   * instantánea y `undoneAt` sigue en `null`). Sólo tiene sentido en
   * mensajes "assistant"; `mensajeParaDeshacer` (src/lib/client/undo.ts) es
   * quien decide, con esto, cuál es "el más nuevo deshacible".
   */
  canUndo?: boolean;
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
