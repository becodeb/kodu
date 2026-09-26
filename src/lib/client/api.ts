import type { Speed } from '../workspace-types.ts';
import type { ItemChecklist } from '../ai/checklist.ts';
import type { Problema } from '../ai/verificador.ts';

/**
 * Cliente HTTP del navegador. Todas las llamadas son al mismo origen, así que
 * el navegador manda la cookie de sesión y el header Origin que Astro exige
 * para los métodos que no son GET.
 */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function apiRequest<T = Record<string, unknown>>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok || payload.ok !== true) {
      return { ok: false, error: String(payload.error ?? 'Algo salió mal.') };
    }

    return { ok: true, data: payload as T };
  } catch {
    return { ok: false, error: 'No se pudo contactar al servidor.' };
  }
}

export async function uploadFiles(
  projectId: string,
  files: File[],
): Promise<ApiResult<{ assets: Array<{ id: string; filename: string; url: string; fileType: string }> }>> {
  const form = new FormData();
  form.set('projectId', projectId);
  for (const file of files) form.append('files', file);

  try {
    const response = await fetch('/api/uploads', { method: 'POST', body: form });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok || payload.ok !== true) {
      return { ok: false, error: String(payload.error ?? 'No se pudieron subir los archivos.') };
    }

    return { ok: true, data: payload as never };
  } catch {
    return { ok: false, error: 'No se pudo contactar al servidor.' };
  }
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'code'; html: string }
  /** La IA empezó a escribir el recurso; el HTML todavía no llegó. */
  | { type: 'code_start' }
  /** Fragmento crudo del HTML que se está escribiendo (T3, "Progresivo"):
   *  se acumula y se decodifica con `htmlParcialDeArgumentos` para ir
   *  pintando la vista previa mientras la IA todavía escribe. */
  | { type: 'code_delta'; delta: string }
  /** El parcial que se venía acumulando quedó obsoleto (reintento, cambio de
   *  motor, re-pedido forzado): hay que tirar el buffer y esperar uno nuevo. */
  | { type: 'code_reset' }
  /**
   * T7 ("Revisión automática"): cambio de fase que no es ninguno de los
   * eventos de arriba. `'revisando'` (terminó el primer pase, está
   * corrigiendo lo que encontró el lint antes de entregar el recurso) —
   * la vista previa sigue mostrando el `code` anterior mientras dura,
   * nunca se manda un `code_delta` de esta pasada. `'planificando'` (T16,
   * round 4): sólo al crear un recurso nuevo, ANTES de la generación
   * principal — está armando el checklist de comportamientos.
   */
  | { type: 'phase'; phase: 'revisando' | 'planificando' }
  /**
   * T16 (round 4, "checklist del docente"): sólo en un turno que crea un
   * recurso NUEVO y de verdad va a generar código. Llega, si llega, ANTES
   * de cualquier `code`/`code_delta` de este turno — nunca trae el HTML,
   * sólo los ítems (T18 los va a mostrar; este evento sólo hace que
   * lleguen). Ausente cuando el paso falló, dio timeout o muy pocos ítems
   * válidos: el turno sigue igual, simplemente sin checklist.
   */
  | { type: 'checklist'; items: ItemChecklist[] }
  /**
   * T9 ("Varias versiones al crear un recurso"): sólo en un turno de
   * versiones. `ready: false` es el anuncio de que ESTE índice va a existir
   * (las tres llegan juntas, apenas arranca el turno); `ready: true` es que
   * ya terminó (o se descartó si nunca llega). Nunca trae el HTML —eso sólo
   * se pide al elegir, `POST /api/projects/[id]/variant` (ver el reporte de
   * la tarea para la justificación de no mandarlo acá)—, así que elegir
   * siempre confirma contra el servidor, incluida la versión 1 que ya se
   * vio completa por `code`.
   */
  | { type: 'variant'; index: 1 | 2 | 3; ready: boolean }
  /** Algo que el docente tiene que saber pero que no cortó el turno. */
  | { type: 'notice'; message: string }
  /** `userMessageId` (T4) es el id REAL del mensaje "user" que este turno
   *  guardó — el cliente lo agregó de forma optimista con un id local, y
   *  necesita el real para poder reconocer este mensaje puntual más tarde
   *  (por ejemplo, si el docente pide deshacer este turno).
   *  `revisionVisualDisponible` (T8): el SERVIDOR decidió que corresponde
   *  ofrecer la revisión visual de este turno — el cliente nunca lo decide
   *  solo (ver odd/tasks/modo-prime.md). Ausente/`false` en cualquier otro
   *  caso, incluidos todos los turnos de antes de T8. */
  | {
      type: 'done';
      messageId: string;
      userMessageId: string;
      codeUpdated: boolean;
      content: string;
      revisionVisualDisponible?: boolean;
    }
  /** `fallbackModel` (el `id` de un `AiModel`) llega cuando el motor elegido
   *  falló pero otro de la cadena tiene lugar para el pedido.
   *  `registerUrl` llega cuando la cuenta de demo agotó su tope (M7): nunca
   *  un error mudo, siempre con una salida real. */
  | { type: 'error'; message: string; fallbackModel?: string; fallbackLabel?: string; registerUrl?: string };

/**
 * Lee el body de una `Response` de streaming como una secuencia de eventos
 * SSE ya parseados (sin tipar: cada llamador sabe qué forma esperar).
 * Compartido por `streamChat` y `streamVisualReview` (T8): las dos hablan el
 * mismo protocolo de transporte (`data: <json>\n\n`, tolerante a fragmentos
 * cortados por el chunking de red), sólo cambia el VOCABULARIO de eventos.
 */
async function* leerEventosSse(response: Response): AsyncGenerator<unknown> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let separator = buffer.indexOf('\n\n');
    while (separator !== -1) {
      const rawEvent = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf('\n\n');

      const data = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');

      if (!data) continue;

      try {
        yield JSON.parse(data);
      } catch {
        // fragmento corrupto: seguimos con el próximo evento
      }
    }
  }
}

/**
 * Consume el SSE de /api/chat/stream.
 *
 * Es POST (lleva el mensaje y el proyecto en el body), por eso `fetch` + reader
 * en vez de EventSource, que sólo sabe hacer GET.
 */
export async function* streamChat(payload: {
  projectId: string;
  threadId: string;
  message: string;
  /** El `id` de un `AiModel`. */
  model?: string;
  attachmentUrls?: string[];
  /** El docente escribió o pegó código a mano desde la última respuesta. */
  codeEditedByTeacher?: boolean;
  /** T6 ("Velocidad Rápido / A fondo"). El servidor la ignora sin el permiso
   *  (`puedeElegirVelocidad`), así que siempre es seguro mandarla. */
  speed?: Speed;
  /** T9 ("Varias versiones al crear un recurso"). El servidor la ignora sin
   *  `puedePedirVersiones` O si el recurso ya no es el de arranque, así que
   *  también es siempre seguro mandarla. */
  variants?: 3;
}, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || !response.body) {
    // Cuando el que corta es un proxy, el cuerpo no es JSON y el `.catch` dejaba
    // un mensaje genérico que no ayudaba a nadie a entender qué pasó.
    const error = (await response.json().catch(() => null)) as {
      error?: string;
      fallbackModel?: string;
      fallbackLabel?: string;
      registerUrl?: string;
    } | null;
    const detalle =
      error?.error ??
      (response.status === 401
        ? 'Se venció tu sesión. Volvé a entrar y probá de nuevo.'
        : response.status >= 500
          ? `El servidor no pudo completar el pedido (error ${response.status}).`
          : `El servidor rechazó el pedido (error ${response.status}).`);
    yield {
      type: 'error',
      message: detalle,
      fallbackModel: error?.fallbackModel,
      fallbackLabel: error?.fallbackLabel,
      registerUrl: error?.registerUrl,
    };
    return;
  }

  for await (const evento of leerEventosSse(response)) {
    yield evento as StreamEvent;
  }
}

/**
 * T8 ("Revisión visual con captura"): vocabulario reducido a propósito —
 * ver el comentario grande en `src/pages/api/chat/visual-review.ts`. Nunca
 * hay un mensaje de chat detrás de esto (discreto), así que no hace falta
 * `messageId` ni `content`.
 */
export type VisualReviewEvent =
  | { type: 'code'; html: string }
  | { type: 'done'; codeUpdated: boolean }
  /** Sólo por una respuesta HTTP que no llegó a abrir el SSE (permiso,
   *  huella que no coincide, imagen inválida, tope de tokens): una falla
   *  DEL MODELO adentro del SSE nunca llega como esto, siempre termina en
   *  un "done" silencioso (ver el endpoint). */
  | { type: 'error'; message: string };

export async function* streamVisualReview(
  payload: { projectId: string; dataUrl: string; fingerprint: string },
  signal?: AbortSignal,
): AsyncGenerator<VisualReviewEvent> {
  const response = await fetch('/api/chat/visual-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || !response.body) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    yield {
      type: 'error',
      message: error?.error ?? `El servidor rechazó el pedido (error ${response.status}).`,
    };
    return;
  }

  for await (const evento of leerEventosSse(response)) {
    yield evento as VisualReviewEvent;
  }
}

/**
 * T12 (round 3, "Autoprueba + autocorrección"): mismo vocabulario reducido
 * que T8 — ver el comentario grande en `src/pages/api/chat/autocorreccion.ts`.
 */
export type AutocorreccionEvent =
  | { type: 'code'; html: string }
  | { type: 'done'; codeUpdated: boolean }
  /** Sólo por una respuesta HTTP que no llegó a abrir el SSE (permiso,
   *  huella vieja, tope de tokens): una falla DEL MODELO adentro del SSE
   *  nunca llega como esto, siempre termina en un "done" silencioso. */
  | { type: 'error'; message: string };

export async function* streamAutocorreccion(
  payload: {
    projectId: string;
    fingerprint: string;
    ronda: 1 | 2;
    errores: Array<{
      tipo: 'error' | 'promesa' | 'consola';
      mensaje: string;
      linea: number | null;
      columna: number | null;
      accion: string;
    }>;
    reinicioOk: boolean | null;
    exitoVisibleAlInicio: boolean;
    diferencias: {
      textoQueFalta: string[];
      textoQueSobra: string[];
      controles: Array<{
        etiqueta: string;
        antes: string | number | boolean | null;
        despues: string | number | boolean | null;
      }>;
    };
    /**
     * T17 (round 4, "checklist del docente"): los resultados de
     * `window.__koduPruebas` de ESTA corrida de la autoprueba (T14).
     * `null`/ausente = recurso sin checklist (viejo, o el paso T16 no
     * generó uno) — mismo criterio de compatibilidad hacia atrás que el
     * resto de este body.
     */
    pruebas?: Array<{ id: string; ok: boolean; detalle: string }> | null;
    /**
     * T4 (verificador): con al menos un problema ACCIONABLE (nunca
     * `contenido` — el propio endpoint lo filtra igual, ver
     * `problemasAccionables`/`construirMensajeCorreccionVerificador` en
     * `ai/verificador.ts`), la corrección se arma a partir de estos
     * problemas en vez del informe de la autoprueba de arriba. El botón
     * "¿Las arreglo?" del panel del verificador (Workspace.tsx) es el único
     * llamador que lo manda; el resto del body sigue funcionando igual.
     */
    problemasVerificador?: Problema[];
  },
  signal?: AbortSignal,
): AsyncGenerator<AutocorreccionEvent> {
  const response = await fetch('/api/chat/autocorreccion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || !response.body) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    yield {
      type: 'error',
      message: error?.error ?? `El servidor rechazó el pedido (error ${response.status}).`,
    };
    return;
  }

  for await (const evento of leerEventosSse(response)) {
    yield evento as AutocorreccionEvent;
  }
}
