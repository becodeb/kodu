/** Helpers minimos para respuestas JSON consistentes en los endpoints. */

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function ok<T extends Record<string, unknown>>(data: T = {} as T): Response {
  return json({ ok: true, ...data }, 200);
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, error: message, ...extra }, status);
}

/** Lee el body como JSON o como form-urlencoded, segun el Content-Type. */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('application/json')) {
      return (await request.json()) as Record<string, unknown>;
    }
    if (
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')
    ) {
      return Object.fromEntries(await request.formData());
    }
  } catch {
    return {};
  }

  return {};
}
