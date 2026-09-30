import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../../lib/http.ts';
import { requireFreshUser } from '../../../../../lib/auth/guards.ts';
import { getEnv, isProduction } from '../../../../../lib/env.ts';
import { resolverGatewayDePago } from '../../../../../lib/billing/pasarela/index.ts';
import { obtenerPagoSimulado, resolverCheckoutSimulado, simularRenovacion } from '../../../../../lib/billing/pasarela/simulado.ts';
import { procesarNotificacion } from '../../../../../lib/billing/aplicar.ts';

/**
 * POST /api/billing/pago-simulado/[id]/accion (odd/tasks/planes-y-cobros.md
 * T4): los botones de `/pago-simulado/[id]`. SOLO existe con
 * `BILLING_PROVIDER=simulado` fuera de producción (404 en cualquier otro
 * caso, igual que la página) — nunca hay forma de "aprobar un pago" a mano
 * contra un proveedor real.
 *
 * Arma la MISMA `NotificacionRecibida` que produciría un webhook real y la
 * pasa por `aplicar.ts#procesarNotificacion` — el flujo de aplicar efectos es
 * IDÉNTICO al de `/api/billing/webhook/mercadopago` (decisión de esta
 * tarea).
 */
const schema = z.object({
  accion: z.enum(['aprobar', 'rechazar', 'renovacion_ok', 'renovacion_fallida']),
});

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (getEnv().BILLING_PROVIDER !== 'simulado' || isProduction()) {
    return fail('No encontrado', 404);
  }

  const user = requireFreshUser(locals);
  if (user instanceof Response) return user;

  const id = params.id;
  if (!id) return fail('Falta el id del pago.', 422);

  const gateway = resolverGatewayDePago();
  if (!gateway) return fail('El cobro simulado no está disponible en este entorno.', 503);

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);

  const fila = await obtenerPagoSimulado(id);
  if (!fila) return fail('No encontramos ese pago simulado.', 404);

  if (parsed.data.accion === 'aprobar' || parsed.data.accion === 'rechazar') {
    const resuelto = await resolverCheckoutSimulado(id, parsed.data.accion === 'aprobar');
    if (!resuelto) return fail('Ese pago ya fue resuelto.', 409);
    const resultado = await procesarNotificacion(gateway, resuelto.notificacion);
    return ok({ applied: resultado.applied, reason: resultado.reason, backUrl: resuelto.backUrl });
  }

  // Renovaciones: sólo tienen sentido sobre el checkout de una suscripción
  // (kind SUBSCRIPTION), nunca sobre un pago único.
  if (fila.kind !== 'SUBSCRIPTION') {
    return fail('Este pago no admite simular una renovación.', 422);
  }
  const notif = await simularRenovacion(id, parsed.data.accion === 'renovacion_ok', fila.amountArs);
  const resultado = await procesarNotificacion(gateway, notif);
  return ok({ applied: resultado.applied, reason: resultado.reason });
};
