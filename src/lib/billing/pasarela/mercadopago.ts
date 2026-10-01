import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ErrorProveedorPago,
  type CheckoutSuscripcionInput,
  type CheckoutUnicoInput,
  type EstadoPagoProveedor,
  type NotificacionRecibida,
  type PagoObtenido,
  type PaymentGateway,
  type ResultadoCheckout,
  type SuscripcionObtenida,
} from './tipos.ts';

/**
 * odd/tasks/planes-y-cobros.md (T4): adaptador real de Mercado Pago, por
 * `fetch` (sin el SDK — decisión del cambio, para no agregar una dependencia
 * en un worktree con `node_modules` simlinkeado).
 *
 * Hechos verificados contra la documentación pública de Mercado Pago para
 * esta tarea (ver el informe final del cambio para el detalle con URLs; acá
 * sólo el resumen que explica cada endpoint):
 *
 * - `POST /preapproval` (suscripción SIN plan asociado) acepta `reason`,
 *   `external_reference`, `payer_email`, `back_url`, `status: 'pending'` y
 *   `auto_recurring: { frequency, frequency_type, transaction_amount,
 *   currency_id, start_date, end_date?, free_trial? }`. Devuelve `id`,
 *   `init_point`, `status`.
 * - `PUT /preapproval/{id}` actualiza una suscripción existente — el cuerpo
 *   puede traer `auto_recurring.transaction_amount` y
 *   `auto_recurring.start_date`, y `status` ("cancelled" para dar de baja).
 * - Los tópicos de notificación de suscripciones son
 *   `subscription_preapproval` (alta/cambio de la suscripción misma) y
 *   `subscription_authorized_payment` (un cobro recurrente concreto); los
 *   pagos sueltos (Checkout Pro) notifican con tópico `payment`.
 * - `x-signature` trae `ts=<epoch>,v1=<hmac hex>`; el manifiesto que se firma
 *   es `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` y se valida con
 *   HMAC-SHA256 usando la clave secreta del webhook, en hexadecimal,
 *   comparado en tiempo constante.
 * - `POST /checkout/preferences` (Checkout Pro, pago único) acepta `items`,
 *   `external_reference`, `back_urls` (`success`/`failure`/`pending`),
 *   `notification_url` y `auto_return: 'approved'` (redirige solo tras un
 *   pago aprobado).
 * - `GET /v1/payments/{id}` devuelve el pago (`status`, `transaction_amount`,
 *   `external_reference`).
 *
 * LO QUE NO SE PUDO CONFIRMAR contra una página primaria en esta sesión (las
 * URLs de referencia devolvieron 404 al momento de escribir esto — quedó
 * confirmado sólo por resultados de búsqueda/documentación de terceros, no
 * por la página oficial en vivo) — diseñado con margen alrededor de cada uno:
 *
 * 1. Si `auto_recurring.frequency_type: 'months'` admite `frequency: 12`
 *    como "un cobro cada 12 meses" (lo que haría falta para el ciclo lectivo
 *    ANUAL como una sola `preapproval`). Los ejemplos encontrados arman un
 *    anual como 12 cobros MENSUALES (`frequency: 1`, `repetitions: 12`), no
 *    como un cobro anual. Por eso el ciclo lectivo (T4, `aplicar.ts`) NO usa
 *    una `preapproval` anual: usa un pago único (`createOneTimeCheckout`,
 *    Checkout Pro) para el primer cobro Y para cada renovación de marzo —
 *    la organización recibe un nuevo link de pago cada ciclo en vez de un
 *    cobro automático. Queda documentado como decisión de esta tarea, no
 *    como limitación de Mercado Pago: si en producción se confirma que
 *    `frequency: 12` sí cobra una vez al año, cambiar `crearCheckoutCiclo`
 *    para usar `createSubscriptionCheckout` es un cambio acotado a esa
 *    función.
 * 2. La forma exacta de un cobro recurrente reportado por el tópico
 *    `subscription_authorized_payment` (si conviene leerlo por
 *    `GET /authorized_payments/{id}` en vez de `GET /v1/payments/{id}`, y si
 *    ese recurso expone `preapproval_id` directamente). Este adaptador trata
 *    CUALQUIER notificación de pago (`payment` o
 *    `subscription_authorized_payment`) igual: relee con `fetchPayment`
 *    (`GET /v1/payments/{id}`) y confía en que `external_reference` viaja
 *    igual en el primer cobro y en cada renovación (documentado como
 *    comportamiento esperado de Mercado Pago, no verificado en vivo acá por
 *    falta de credenciales reales — no hay ninguna en este entorno).
 */

const API_BASE = 'https://api.mercadopago.com';

/** Ver el comentario de `createSubscriptionCheckout`: colchón para que
 *  `auto_recurring.start_date` nunca llegue como pasado a Mercado Pago. */
const COLCHON_START_DATE_MS = 5 * 60 * 1000;

export class GatewayMercadoPago implements PaymentGateway {
  constructor(
    private readonly accessToken: string,
    private readonly webhookSecret: string,
  ) {}

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const respuesta = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
    if (!respuesta.ok) {
      const cuerpo = await respuesta.text().catch(() => '');
      // Un 4xx de Mercado Pago (datos rechazados: payer_email inválido,
      // monto bajo el mínimo, start_date en el pasado, etc.) tiene un
      // mensaje legible que vale la pena mostrar en vez de un 500 genérico
      // — ver `ErrorProveedorPago` en `tipos.ts`. Un 5xx es un problema del
      // lado de Mercado Pago (transitorio): sigue como excepción genérica.
      if (respuesta.status >= 400 && respuesta.status < 500) {
        let mensaje = cuerpo;
        try {
          const parseado = JSON.parse(cuerpo) as { message?: string };
          if (parseado.message) mensaje = parseado.message;
        } catch {
          // cuerpo no era JSON — se usa tal cual.
        }
        throw new ErrorProveedorPago(respuesta.status, mensaje);
      }
      throw new Error(`Mercado Pago ${init.method ?? 'GET'} ${path} → ${respuesta.status}: ${cuerpo}`);
    }
    return (await respuesta.json()) as T;
  }

  async createSubscriptionCheckout(input: CheckoutSuscripcionInput): Promise<ResultadoCheckout> {
    // BUG encontrado probando contra el sandbox real (T4c): Mercado Pago
    // rechaza `auto_recurring.start_date` con "cannot be a past date" si se
    // manda el `Date` exacto de `billingNow()` — para cuando el request
    // llega a su servidor (red + el tiempo que tardó `crearCheckoutOrg` /
    // `crearCheckoutIndividual` en armar el `Payment` antes de este fetch),
    // ese instante ya quedó en el pasado desde el punto de vista de Mercado
    // Pago. Se le suma un colchón fijo para que siempre llegue en el futuro;
    // no cambia marzo/comportamiento visible para quien paga (la suscripción
    // de todos modos queda "pending" hasta que se autoriza).
    const startDateConColchon = new Date(input.startDate.getTime() + COLCHON_START_DATE_MS);
    const body = {
      reason: input.reason,
      external_reference: input.externalReference,
      payer_email: input.payerEmail,
      back_url: input.backUrl,
      status: 'pending',
      auto_recurring: {
        frequency: input.frequency,
        frequency_type: input.frequencyType,
        transaction_amount: input.amountArs,
        currency_id: 'ARS',
        start_date: startDateConColchon.toISOString(),
      },
    };
    const respuesta = await this.request<{ id: string; init_point: string }>('/preapproval', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { providerCheckoutId: respuesta.id, initPoint: respuesta.init_point };
  }

  async createOneTimeCheckout(input: CheckoutUnicoInput): Promise<ResultadoCheckout> {
    const body = {
      items: [{ title: input.concept, quantity: 1, unit_price: input.amountArs, currency_id: 'ARS' }],
      external_reference: input.externalReference,
      payer: { email: input.payerEmail },
      back_urls: input.backUrls,
      notification_url: input.notificationUrl,
      auto_return: 'approved',
    };
    const respuesta = await this.request<{ id: string; init_point: string }>('/checkout/preferences', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { providerCheckoutId: respuesta.id, initPoint: respuesta.init_point };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    await this.request(`/preapproval/${providerSubscriptionId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'cancelled' }),
    });
  }

  async fetchPayment(providerPaymentId: string): Promise<PagoObtenido> {
    const respuesta = await this.request<{
      id: number | string;
      status: string;
      transaction_amount: number;
      external_reference: string | null;
    }>(`/v1/payments/${providerPaymentId}`, { method: 'GET' });
    return {
      providerPaymentId: String(respuesta.id),
      status: mapearEstadoPago(respuesta.status),
      amountArs: respuesta.transaction_amount,
      externalReference: respuesta.external_reference,
    };
  }

  /**
   * Ver el comentario de `fetchAuthorizedPayment` en `tipos.ts`: confirmado
   * contra el sandbox real (T4c, fase 2) que `GET /v1/payments/{id}` con el
   * id de un "authorized payment" da 404 — hay que leer
   * `GET /authorized_payments/{id}`, que trae `external_reference` y
   * `transaction_amount` propios y, si ya se efectivizó, un `payment`
   * anidado con el id y el estado del pago real detrás del cobro.
   */
  async fetchAuthorizedPayment(providerAuthorizedPaymentId: string): Promise<PagoObtenido> {
    const respuesta = await this.request<{
      id: number | string;
      status: string;
      transaction_amount: number;
      external_reference: string | null;
      payment?: { id: number | string; status: string } | null;
    }>(`/authorized_payments/${providerAuthorizedPaymentId}`, { method: 'GET' });

    // El `payment` anidado es el pago real (mismo id/estado que devolvería
    // `GET /v1/payments/{id}`) — se usa ese id para `providerPaymentId` así
    // la idempotencia de `aplicar.ts` coincide con una eventual notificación
    // del tópico `payment` sobre el MISMO cobro. Sin `payment` todavía (el
    // débito está `scheduled`/`recycle`, no efectivizado) no hay pago real
    // que aplicar: se informa `pending` con el id del authorized_payment.
    if (respuesta.payment) {
      return {
        providerPaymentId: String(respuesta.payment.id),
        status: mapearEstadoPago(respuesta.payment.status),
        amountArs: respuesta.transaction_amount,
        externalReference: respuesta.external_reference,
      };
    }
    return {
      providerPaymentId: String(respuesta.id),
      status: respuesta.status === 'cancelled' ? 'cancelled' : 'pending',
      amountArs: respuesta.transaction_amount,
      externalReference: respuesta.external_reference,
    };
  }

  async fetchSubscription(providerSubscriptionId: string): Promise<SuscripcionObtenida> {
    const respuesta = await this.request<{ id: string; status: string; external_reference: string | null }>(
      `/preapproval/${providerSubscriptionId}`,
      { method: 'GET' },
    );
    return {
      providerSubscriptionId: respuesta.id,
      status:
        respuesta.status === 'authorized' || respuesta.status === 'paused' || respuesta.status === 'cancelled'
          ? respuesta.status
          : 'pending',
      externalReference: respuesta.external_reference,
    };
  }

  verifyNotification(headers: Headers, query: URLSearchParams): boolean {
    if (!this.webhookSecret) {
      // Sin clave cargada no hay nada que validar — el llamador decide si
      // eso es aceptable (nunca lo es en producción; ver env.ts).
      return true;
    }

    const xSignature = headers.get('x-signature');
    const xRequestId = headers.get('x-request-id');
    const dataId = query.get('data.id') ?? query.get('id');
    if (!xSignature) return false;

    const partes = Object.fromEntries(
      xSignature.split(',').map((par) => {
        const [clave, valor] = par.split('=').map((s) => s.trim());
        return [clave, valor];
      }),
    );
    const ts = partes.ts;
    const v1 = partes.v1;
    if (!ts || !v1) return false;

    const manifiesto = [
      dataId ? `id:${dataId};` : '',
      xRequestId ? `request-id:${xRequestId};` : '',
      ts ? `ts:${ts};` : '',
    ].join('');

    const esperado = createHmac('sha256', this.webhookSecret).update(manifiesto).digest('hex');

    const bufferEsperado = Buffer.from(esperado, 'hex');
    const bufferRecibido = Buffer.from(v1, 'hex');
    if (bufferEsperado.length !== bufferRecibido.length) return false;
    return timingSafeEqual(bufferEsperado, bufferRecibido);
  }

  parseNotification(body: unknown, query: URLSearchParams): NotificacionRecibida {
    const data = body as { type?: string; action?: string; data?: { id?: string } } | null;
    // Formato "nuevo" (type + data.id) y el legado (?topic=&id=) — Mercado
    // Pago mandó los dos formatos históricamente según la integración.
    const tipo = data?.type ?? query.get('topic') ?? undefined;
    const id = data?.data?.id ?? query.get('id') ?? query.get('data.id') ?? undefined;

    if (!id) return { kind: 'unknown', id: null };
    if (tipo === 'payment') return { kind: 'payment', id };
    if (tipo === 'subscription_preapproval') return { kind: 'subscription_preapproval', id };
    if (tipo === 'subscription_authorized_payment') return { kind: 'subscription_authorized_payment', id };
    return { kind: 'unknown', id };
  }
}

function mapearEstadoPago(status: string): EstadoPagoProveedor {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'rejected':
    case 'cancelled':
      return status === 'cancelled' ? 'cancelled' : 'rejected';
    case 'refunded':
    case 'charged_back':
      return 'refunded';
    default:
      return 'pending';
  }
}
