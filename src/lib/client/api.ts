import type { Speed } from '../workspace-types.ts';

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
   * eventos de arriba. Por ahora sólo `'revisando'` (terminó el primer
   * pase, está corrigiendo lo que encontró el lint antes de entregar el
   * recurso) — la vista previa sigue mostrando el `code` anterior mientras
   * dura, nunca se manda un `code_delta` de esta pasada.
   */
  | { type: 'phase'; phase: 'revisando' }
  /** Algo que el docente tiene que saber pero que no cortó el turno. */
  | { type: 'notice'; message: string }
  /** `userMessageId` (T4) es el id REAL del mensaje "user" que este turno
   *  guardó — el cliente lo agregó de forma optimista con un id local, y
   *  necesita el real para poder reconocer este mensaje puntual más tarde
   *  (por ejemplo, si el docente pide deshacer este turno). */
  | { type: 'done'; messageId: string; userMessageId: string; codeUpdated: boolean; content: string }
  /** `fallbackModel` (el `id` de un `AiModel`) llega cuando el motor elegido
   *  falló pero otro de la cadena tiene lugar para el pedido.
   *  `registerUrl` llega cuando la cuenta de demo agotó su tope (M7): nunca
   *  un error mudo, siempre con una salida real. */
  | { type: 'error'; message: string; fallbackModel?: string; fallbackLabel?: string; registerUrl?: string };

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

  const reader = response.body.getReader();
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
        yield JSON.parse(data) as StreamEvent;
      } catch {
        // fragmento corrupto: seguimos con el próximo evento
      }
    }
  }
}
