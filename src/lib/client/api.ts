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
  | { type: 'done'; messageId: string; codeUpdated: boolean; content: string }
  | { type: 'error'; message: string };

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
  model?: 'FLASH' | 'PRO';
  attachmentUrls?: string[];
  /** El docente escribió o pegó código a mano desde la última respuesta. */
  codeEditedByTeacher?: boolean;
}): AsyncGenerator<StreamEvent> {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    const error = (await response.json().catch(() => ({}))) as { error?: string };
    yield { type: 'error', message: error.error ?? 'El servidor rechazó el pedido.' };
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
