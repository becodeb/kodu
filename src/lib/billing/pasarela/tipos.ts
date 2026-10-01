/**
 * odd/tasks/planes-y-cobros.md (T4): puerto de cobro. `PaymentGateway` es la
 * única interfaz que el resto del código conoce (`src/lib/billing/aplicar.ts`
 * y los endpoints de `/api/billing/*`) — quién la implementa (`simulado.ts` o
 * `mercadopago.ts`) se elige por env (`BILLING_PROVIDER`, ver
 * `src/lib/billing/pasarela/index.ts`).
 *
 * Diseño elegido para que un mismo `externalReference` sirva de principio a
 * fin de una suscripción: es el id de nuestro propio "checkout row"
 * (`Payment.id` que crea el endpoint ANTES de llamar al proveedor, con el
 * monto ya calculado del lado del servidor) para el PRIMER cobro, y el mismo
 * valor se espera de vuelta en cada renovación (así lo hace Mercado Pago con
 * `external_reference` en una suscripción por `preapproval`: se fija una vez
 * y se repite en todo pago asociado). `src/lib/billing/aplicar.ts` es el
 * único lugar que interpreta ese valor.
 */

/**
 * T4c (sandbox real, fase 2): Mercado Pago puede rechazar la CREACIÓN de un
 * checkout con un 4xx cuyo mensaje es legible y vale la pena mostrar (p.ej.
 * "Both payer and collector must be real or test users" cuando `payer_email`
 * no es una cuenta de Mercado Pago) — antes esto bubbleaba como una
 * excepción genérica y los endpoints de checkout devolvían un 500 sin
 * explicación. `aplicar.ts` atrapa este tipo para devolver un 502 con
 * `mpMessage` en vez de un 500.
 */
export class ErrorProveedorPago extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly mpMessage: string,
  ) {
    super(`Mercado Pago rechazó la operación (${httpStatus}): ${mpMessage}`);
    this.name = 'ErrorProveedorPago';
  }
}

export type EstadoPagoProveedor = 'approved' | 'rejected' | 'pending' | 'refunded' | 'cancelled';
export type EstadoSuscripcionProveedor = 'authorized' | 'paused' | 'cancelled' | 'pending';

export interface CheckoutSuscripcionInput {
  /** `Payment.id` del checkout row creado por el endpoint antes de llamar acá. */
  externalReference: string;
  /** Lo que ve quien paga en Mercado Pago ("reason"). */
  reason: string;
  amountArs: number;
  /** Sólo `{ frequency: 1, frequencyType: 'months' }` — ver el comentario de
   *  `mercadopago.ts` sobre por qué no se arma un ciclo anual real con
   *  `preapproval`. */
  frequency: 1;
  frequencyType: 'months';
  /** Cuándo arranca a cobrar (hoy, salvo que se posponga). */
  startDate: Date;
  /** A dónde redirige el proveedor tras aprobar/rechazar. */
  backUrl: string;
  payerEmail: string;
}

export interface CheckoutUnicoInput {
  externalReference: string;
  concept: string;
  amountArs: number;
  backUrls: { success: string; failure: string; pending: string };
  notificationUrl: string;
  payerEmail: string;
}

export interface ResultadoCheckout {
  /** El id de la suscripción/pago del lado del proveedor (preapproval id en
   *  Mercado Pago) — se guarda en `externalSubscriptionId` de la licencia o
   *  la suscripción individual. */
  providerCheckoutId: string;
  /** URL a la que se redirige a quien paga (`init_point`). */
  initPoint: string;
}

export interface PagoObtenido {
  providerPaymentId: string;
  status: EstadoPagoProveedor;
  amountArs: number;
  /** `null` si el proveedor no lo devolvió — nunca se inventa. */
  externalReference: string | null;
}

export interface SuscripcionObtenida {
  providerSubscriptionId: string;
  status: EstadoSuscripcionProveedor;
  externalReference: string | null;
}

export type NotificacionRecibida =
  | { kind: 'payment'; id: string }
  | { kind: 'subscription_preapproval'; id: string }
  | { kind: 'subscription_authorized_payment'; id: string }
  | { kind: 'unknown'; id: string | null };

export interface PaymentGateway {
  createSubscriptionCheckout(input: CheckoutSuscripcionInput): Promise<ResultadoCheckout>;
  createOneTimeCheckout(input: CheckoutUnicoInput): Promise<ResultadoCheckout>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  fetchPayment(providerPaymentId: string): Promise<PagoObtenido>;
  /**
   * T4c (probado contra el sandbox real): un cobro recurrente de una
   * suscripción (tópico `subscription_authorized_payment`) NO se relee con
   * `fetchPayment` — el `data.id` de esa notificación es el id del
   * "authorized payment" (`GET /authorized_payments/{id}`), un recurso
   * DISTINTO del pago (`GET /v1/payments/{id}` con ese mismo id da 404).
   * `aplicar.ts#procesarNotificacion` despacha a este método para ese
   * tópico en vez de a `fetchPayment`.
   */
  fetchAuthorizedPayment(providerAuthorizedPaymentId: string): Promise<PagoObtenido>;
  fetchSubscription(providerSubscriptionId: string): Promise<SuscripcionObtenida>;
  /**
   * `false` = rechazar el webhook sin procesarlo (firma inválida o
   * faltante cuando se exige). El adaptador simulado siempre da `true` (no
   * hay nada que firmar sin un proveedor real detrás).
   */
  verifyNotification(headers: Headers, query: URLSearchParams, rawBody: string): boolean;
  parseNotification(body: unknown, query: URLSearchParams): NotificacionRecibida;
}
