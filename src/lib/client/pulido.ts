import type { ResultadoAutopruebaCliente } from './autoprueba.ts';
/**
 * T15 (motor-claude, client wiring): cliente del paso de "pulido visual"
 * (`POST /api/chat/pulir` y, si el self-test posterior falla,
 * `POST /api/chat/pulir-revertir`) — mismo criterio de errores que
 * `verificador.ts#verificarRecurso`: cualquier problema de red, abort, o
 * respuesta inesperada devuelve `null` (nunca tira), y Workspace.tsx lo
 * trata exactamente igual que "no corresponde" — nunca una alarma visible,
 * `pulirVisualmente.ts` ya documenta que "failures must be silent".
 */

export interface ResultadoPulir {
  aplicado: boolean;
  html: string | null;
  motivo: string | null;
}

export async function pulirRecurso(
  payload: { projectId: string; fingerprint: string; captura?: string | string[] | null },
  signal?: AbortSignal,
): Promise<ResultadoPulir | null> {
  const hayCaptura = Array.isArray(payload.captura) ? payload.captura.length > 0 : Boolean(payload.captura);
  let response: Response;
  try {
    response = await fetch('/api/chat/pulir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: payload.projectId,
        fingerprint: payload.fingerprint,
        ...(hayCaptura ? { captura: payload.captura } : {}),
      }),
      signal,
    });
  } catch {
    return null; // red, o abort (AbortError) — mismo tratamiento.
  }

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data || data.ok !== true) return null;
  if (data.aplicado !== true || typeof data.html !== 'string') {
    return { aplicado: false, html: null, motivo: typeof data.motivo === 'string' ? data.motivo : null };
  }
  return { aplicado: true, html: data.html, motivo: null };
}

/**
 * Deshace un pulido cuyo self-test posterior falló — ver el comentario de
 * `pulir-revertir.ts`. Devuelve `true` sólo si el servidor confirmó que
 * pisó `currentHtml` de vuelta; `false`/`null` (red, abort) nunca importan
 * del lado del cliente: ya revirtió su propio estado (`setHtml`) ANTES de
 * llamar esto, así que lo único en juego acá es que la base de datos no
 * quede con el HTML pulido que el navegador ya descartó.
 */
export async function revertirPulido(
  payload: { projectId: string; htmlPulido: string; htmlOriginal: string },
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetch('/api/chat/pulir-revertir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return Boolean(response.ok && data?.ok === true && data.revertido === true);
  } catch {
    return false;
  }
}

/**
 * T15: whether the polished resource is WORSE than the pre-polish baseline —
 * only failures the polish introduced count: a new error message, a reset
 * that used to work and now doesn't, or a checklist test that passed before
 * and fails now. Without a baseline (it couldn't run), any failure counts.
 */
export function empeoroTrasPulido(
  antes: Pick<ResultadoAutopruebaCliente, 'errores' | 'reinicioOk' | 'pruebas'> | null,
  despues: Pick<ResultadoAutopruebaCliente, 'errores' | 'reinicioOk' | 'pruebas'>,
): boolean {
  if (!antes) {
    return despues.errores.length > 0 || despues.reinicioOk === false || (despues.pruebas ?? []).some((p) => !p.ok);
  }
  const mensajesAntes = new Set(antes.errores.map((e) => e.mensaje));
  if (despues.errores.some((e) => !mensajesAntes.has(e.mensaje))) return true;
  if (antes.reinicioOk !== false && despues.reinicioOk === false) return true;
  const okAntes = new Set((antes.pruebas ?? []).filter((p) => p.ok).map((p) => p.id));
  return (despues.pruebas ?? []).some((p) => !p.ok && okAntes.has(p.id));
}
