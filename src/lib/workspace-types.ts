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
 * T6 (`odd/tasks/verificador.md`, follow-up 2026-09-26): un desplegable con
 * una sola opción no le sirve al docente — se OCULTA entero (junto con el
 * aviso de repunteo, que se refiere a un control que no puede ver) cuando la
 * lista que le corresponde tiene 0 o 1 motores. Con 2+ sigue exactamente
 * igual que antes. Función pura, compartida entre `project/[id].astro`
 * (decide el aviso) y `ChatPanel.tsx` (decide si renderiza
 * `SelectorDeMotor`) — una sola fuente de verdad para el corte.
 */
export function debeMostrarSelectorDeMotor(motores: MotorPublico[]): boolean {
  return motores.length >= 2;
}

/**
 * Lo que el editor le puede ofrecer a ESTE docente
 * (odd/tasks/generacion-simple-y-reanudable.md): sólo lo que puede hacer,
 * nunca la bandera cruda de `AppSettings`. Lo arma `project/[id].astro` a
 * partir de `Capacidades` (`src/lib/ai/capacidades.ts`, server-only),
 * quedándose SÓLO con este campo — nunca ese objeto entero.
 */
export interface CapacidadesEditor {
  /** El admin permite pedir "3 versiones" al crear un recurso. */
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
  /**
   * T9 ("Varias versiones al crear un recurso"): presente sólo en el
   * mensaje "assistant" de un turno de versiones — nunca vacío cuando está
   * (al menos la versión 1). El HTML de cada una no viaja acá: sólo se pide
   * al elegir, con `POST /api/projects/[id]/variant`.
   */
  variants?: WorkspaceMessageVariant[];
  /** T9: cuál de `variants` está elegida ahora mismo (1, 2 o 3). */
  chosenVariant?: number | null;
}

/** T9: una de las versiones que expone el servidor para un mensaje ya
 *  guardado (post-turno) — ver `WorkspaceMessage.variants`. */
export interface WorkspaceMessageVariant {
  index: 1 | 2 | 3;
}

/**
 * T9: estado progresivo de las versiones de un turno EN CURSO, antes de que
 * exista el mensaje "assistant" final. `ready` distingue "todavía
 * generando" (chip apagado) de "ya se puede ofrecer" (chip visualmente
 * listo) — ver Workspace.tsx (`versionesEnCurso`) y ChatPanel.tsx.
 */
export interface VersionEnCurso {
  index: 1 | 2 | 3;
  ready: boolean;
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
  /**
   * T16 (round 4, "checklist del docente"): sólo en un turno que crea un
   * recurso NUEVO, ANTES de la generación principal — un paso corto arma un
   * checklist de comportamientos a partir del pedido. Nunca en un ajuste.
   */
  | 'planificando'
  /** El pedido salió y todavía no volvió nada. */
  | 'thinking'
  /** Está redactando la explicación en el chat. */
  | 'writing'
  /** Está escribiendo el código del recurso. */
  | 'coding'
  /**
   * T12 (round 3, "Autoprueba + autocorrección"): corre la autoprueba de
   * T11 en un iframe oculto — es el último chequeo antes de soltarle el
   * recurso al docente. La vista previa sigue mostrando el HTML con el que
   * se armó el iframe oculto (nunca lo que pasa DENTRO de él).
   */
  | 'probando'
  /**
   * T12: la autoprueba encontró errores reales o un reinicio que no
   * funciona, y se le está pidiendo al modelo una corrección puntual (hasta
   * 2 rondas). La vista previa sigue mostrando el HTML de la ronda
   * anterior hasta que, si corresponde, llega uno corregido.
   */
  | 'corrigiendo';
