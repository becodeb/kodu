import { getEnv } from '../env.ts';

/**
 * odd/tasks/organizaciones.md (T3): cliente de Resend por `fetch`, sin
 * dependencia nueva (no hay SDK oficial instalado ni hace falta uno para
 * pegarle a un solo endpoint). Sólo lo usa `src/lib/orgs/verificacion.ts` —
 * nadie más debería importar esto directo.
 *
 * Nunca tira: quien manda un mail (registro, reenvío) decide qué hacer con
 * `ok: false` sin un try/catch propio. Tampoco loguea nunca la clave ni el
 * cuerpo completo del pedido (podría traer el token de verificación en el
 * HTML) — sólo el status y, en el error de red, el mensaje del error.
 */

export interface EnviarEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type EnviarEmailResultado = { ok: true } | { ok: false; motivo: string };

/** 10s: alcanza de sobra para un POST chico a la API de Resend; no vale la
 *  pena colgar un registro entero esperando un proveedor caído. */
const TIMEOUT_MS = 10_000;

export async function enviarEmail(input: EnviarEmailInput): Promise<EnviarEmailResultado> {
  const env = getEnv();

  if (!env.RESEND_API_KEY) {
    // El llamador debería chequear `hasResendApiKey()` antes de llegar acá;
    // esto es sólo para no explotar si alguien se olvida.
    return { ok: false, motivo: 'Resend no está configurado (falta RESEND_API_KEY).' };
  }

  // Con la key cargada, el remitente es obligatorio: Resend rechaza el pedido
  // sin `from`, y preferimos loguear un error claro ACÁ antes que dejar que
  // el registro reviente por una `RESEND_FROM` que alguien olvidó cargar.
  if (!env.RESEND_FROM) {
    console.error('[email/resend] falta RESEND_FROM con RESEND_API_KEY cargada: no se puede enviar.');
    return { ok: false, motivo: 'Falta RESEND_FROM en el entorno.' };
  }

  const baseUrl = (env.RESEND_API_URL || 'https://api.resend.com').replace(/\/+$/, '');

  try {
    const respuesta = await fetch(`${baseUrl}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!respuesta.ok) {
      console.error(`[email/resend] Resend respondió ${respuesta.status} al mandar un mail.`);
      return { ok: false, motivo: `Resend respondió ${respuesta.status}.` };
    }

    return { ok: true };
  } catch (error) {
    console.error('[email/resend] error de red mandando el mail:', error instanceof Error ? error.message : error);
    return { ok: false, motivo: 'No se pudo contactar a Resend.' };
  }
}
