import type { APIRoute } from 'astro';
import { fail, ok } from '../../../../lib/http.ts';
import { resolverGatewayDePago } from '../../../../lib/billing/pasarela/index.ts';
import { procesarNotificacion } from '../../../../lib/billing/aplicar.ts';

/**
 * POST /api/billing/webhook/mercadopago (odd/tasks/planes-y-cobros.md T4).
 *
 * PÚBLICO a propósito (Mercado Pago no manda cookie de sesión) — la
 * seguridad acá es `verifyNotification` (firma `x-signature`) más
 * `procesarNotificacion`, que NUNCA confía en el cuerpo: relee el pago del
 * lado del proveedor antes de aplicar nada (design.md — "nunca se confía en
 * el cuerpo del webhook; se relee el recurso en el proveedor").
 *
 * Siempre responde 200 salvo que la firma sea inválida: un 4xx/5xx hace que
 * Mercado Pago reintente indefinidamente una notificación que en realidad ya
 * procesamos (o que decidimos ignorar a propósito, p.ej. un tópico que no
 * nos interesa) — `procesarNotificacion` ya es idempotente por sí sola.
 */
export const POST: APIRoute = async ({ request, url }) => {
  const gateway = resolverGatewayDePago();
  if (!gateway) return fail('BILLING_PROVIDER no configurado en este entorno.', 503);

  const rawBody = await request.text();
  if (!gateway.verifyNotification(request.headers, url.searchParams, rawBody)) {
    return fail('Firma inválida.', 401);
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
