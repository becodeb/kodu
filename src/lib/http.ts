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

/**
 * Destino interno seguro para un `?next=` (login, registro, Google). Un
 * chequeo de prefijo (`/` pero no `//`) no alcanza: `/\evil.com` lo pasa y el
 * navegador normaliza la barra invertida a `//evil.com`, un open redirect.
 * Se resuelve contra un origen ficticio y solo se acepta si el resultado sigue
 * en ese origen; se devuelve la forma normalizada, nunca el texto crudo.
 */
export function nextSeguro(next: string | null | undefined): string | undefined {
  if (!next || !next.startsWith('/') || /[\\\u0000-\u001f]/.test(next)) return undefined;
  const base = 'http://kodu.invalid';
  try {
    const url = new URL(next, base);
    if (url.origin !== base) return undefined;
    return url.pathname + url.search + url.hash;
  } catch {
    return undefined;
  }
}
