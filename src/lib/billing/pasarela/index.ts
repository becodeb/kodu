import { getEnv, isProduction } from '../../env.ts';
import { GatewaySimulado } from './simulado.ts';
import { GatewayMercadoPago } from './mercadopago.ts';
import type { PaymentGateway } from './tipos.ts';

export type { PaymentGateway } from './tipos.ts';
export * from './tipos.ts';

/**
 * odd/tasks/planes-y-cobros.md (T4): a qué adaptador de `PaymentGateway` le
 * habla el servidor, elegido por `BILLING_PROVIDER`. `null` = "cobro no
 * disponible en este entorno" — los endpoints de checkout lo traducen a un
 * 503 con mensaje claro; NUNCA se cae de vuelta al simulado en producción
 * (decisión de esta tarea: "nunca se simula un cobro real en silencio").
 */
export function resolverGatewayDePago(): PaymentGateway | null {
  const env = getEnv();

  if (env.BILLING_PROVIDER === 'mercadopago') {
    if (!env.MP_ACCESS_TOKEN) return null;
    return new GatewayMercadoPago(env.MP_ACCESS_TOKEN, env.MP_WEBHOOK_SECRET);
  }

  // BILLING_PROVIDER === 'simulado'
  if (isProduction()) return null;
  return new GatewaySimulado();
}
