import type { APIRoute } from 'astro';
import { fail, ok } from '../../../../lib/http.ts';
import { resolverGatewayDePago } from '../../../../lib/billing/pasarela/index.ts';
import { procesarNotificacion } from '../../../../lib/billing/aplicar.ts';

/**
 * POST /api/billing/webhook/mercadopago (odd/tasks/planes-y-cobros.md T4;
 * T4c fase 3 reescribió la postura de seguridad tras probar contra el
 * sandbox real).
 *
 * PÚBLICO a propósito (Mercado Pago no manda cookie de sesión). El límite de
 * seguridad real NUNCA fue la firma `x-signature`: es que `procesarNotificacion`
 * jamás confía en el CUERPO del webhook para decidir qué pasó — sólo lo usa
 * para saber QUÉ id releer, y siempre relee ese recurso del lado de Mercado
 * Pago con NUESTRO token antes de aplicar nada (monto, dueño e idempotencia
 * se verifican ahí, no acá). La firma es defensa en profundidad, no la
 * frontera de seguridad.
 *
 * Probado en el sandbox real (T4c fase 2): Mercado Pago todavía manda el
 * formato IPN legado (`?topic=&id=`, SIN `x-signature`) para las
 * notificaciones de Checkout Pro vía `notification_url` por-preferencia —
 * antes esto se rechazaba con 401 y Mercado Pago reintentaba para siempre
 * sin que nunca llegáramos a aplicar el pago. Ahora: con firma válida se
 * procesa sin más; sin firma o con una firma que no valida, se procesa
 * IGUAL (vía la misma relectura segura) pero se loguea el nombre de los
 * headers recibidos (nunca sus valores) y la query, para poder diagnosticar
 * — y se le pone un límite de tasa por IP de origen para acotar el abuso
 * (alguien mandando ids al voleo no puede hacernos pegarle a la API de
 * Mercado Pago sin límite).
 */

const VENTANA_LIMITE_MS = 60_000;
const MAX_SIN_FIRMA_POR_VENTANA = 30;
/** Intentos recientes SIN firma válida por IP de origen — sólo acota abuso;
 *  vive en memoria del proceso (no sobrevive un restart ni escala a más de
 *  una instancia, que alcanza para el volumen de este webhook). */
const intentosSinFirmaPorIp = new Map<string, number[]>();

function permitirIntentoSinFirma(ip: string): boolean {
  const ahora = Date.now();
  const previos = (intentosSinFirmaPorIp.get(ip) ?? []).filter((t) => ahora - t < VENTANA_LIMITE_MS);
  if (previos.length >= MAX_SIN_FIRMA_POR_VENTANA) {
    intentosSinFirmaPorIp.set(ip, previos);
    return false;
  }
  previos.push(ahora);
  intentosSinFirmaPorIp.set(ip, previos);
  return true;
}

function ipDeOrigen(request: Request, clientAddress: string | undefined): string {
  // Detrás de un proxy/túnel (Coolify, cloudflared) la IP real viaja en
  // `x-forwarded-for`; `clientAddress` (el socket directo) es el mejor
  // fallback disponible cuando ese header no está.
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return clientAddress ?? 'desconocido';
}

export const POST: APIRoute = async ({ request, url, clientAddress }) => {
  const gateway = resolverGatewayDePago();
  if (!gateway) return fail('BILLING_PROVIDER no configurado en este entorno.', 503);

  const rawBody = await request.text();
  const firmaValida = gateway.verifyNotification(request.headers, url.searchParams, rawBody);

  if (!firmaValida) {
    const ip = ipDeOrigen(request, clientAddress);
    if (!permitirIntentoSinFirma(ip)) {
      return fail('Demasiadas notificaciones sin firma válida desde este origen.', 429);
    }
    // Sólo nombres de headers y la query — nunca valores (pueden traer el
    // propio intento de firma) ni el cuerpo.
    console.warn('[billing] notificación sin firma válida (se procesa igual vía relectura a Mercado Pago):', {
      headers: [...request.headers.keys()],
      query: url.search,
    });
  }

  let body: unknown = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    body = null;
  }

  const notif = gateway.parseNotification(body, url.searchParams);
  const resultado = await procesarNotificacion(gateway, notif);
  return ok({ applied: resultado.applied, reason: resultado.reason });
};
