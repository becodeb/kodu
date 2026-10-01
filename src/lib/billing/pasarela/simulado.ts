import { prisma } from '../../db.ts';
import type {
  CheckoutPlanInput,
  CheckoutSuscripcionInput,
  CheckoutUnicoInput,
  NotificacionRecibida,
  PagoObtenido,
  PaymentGateway,
  ResultadoCheckout,
  ResultadoCheckoutPlan,
  SuscripcionObtenida,
} from './tipos.ts';

/**
 * odd/tasks/planes-y-cobros.md (T4): adaptador SIMULADO de `PaymentGateway` —
 * local y para los e2e, sin ninguna credencial. Todo el estado vive en
 * `PagoSimulado` (ver el comentario del modelo en schema.prisma).
 *
 * "El flujo es idéntico" (design.md/tasks.md): los botones de
 * `/pago-simulado/[id]` y `POST /api/billing/pago-simulado/[id]/accion` NO
 * aplican ningún efecto de negocio directamente — arman la MISMA
 * `NotificacionRecibida` que produciría `parseNotification` sobre un webhook
 * real y se la pasan a `src/lib/billing/aplicar.ts#procesarNotificacion`, que
 * a su vez llama a `fetchPayment` de ESTE adaptador para releer el estado
 * "del proveedor" (la fila de `PagoSimulado`) — nunca confía en lo que
 * mandó el botón, igual que con Mercado Pago.
 */

function providerIdDePago(fila: { id: string }): string {
  return fila.id;
}

export class GatewaySimulado implements PaymentGateway {
  async createSubscriptionCheckout(input: CheckoutSuscripcionInput): Promise<ResultadoCheckout> {
    const fila = await prisma.pagoSimulado.create({
      data: {
        kind: 'SUBSCRIPTION',
        externalReference: input.externalReference,
        concept: input.reason,
        amountArs: input.amountArs,
        payerEmail: input.payerEmail,
        backUrl: input.backUrl,
      },
    });
    return { providerCheckoutId: fila.id, initPoint: `/pago-simulado/${fila.id}` };
  }

  /**
   * T4c (fase 4): equivalente simulado de `createSubscriptionPlanCheckout` —
   * el simulado no distingue "plan" de "checkout" (no hay nada parecido a
   * `preapproval_plan` en Mercado Pago real que imitar acá con sentido), así
   * que arma la MISMA fila `PagoSimulado` que `createSubscriptionCheckout`,
   * con `externalReference` ya cargado desde el arranque — `aplicar.ts`
   * sigue resolviendo este checkout por `external_reference` como siempre
   * (el camino nuevo "resolver por plan id" es exclusivo de Mercado Pago
   * real, donde un `preapproval` creado desde un plan NO trae
   * `external_reference`; en el simulado siempre lo trae, así que ese
   * camino nunca se ejercita acá — no cambia ningún e2e existente).
   * `payerEmail` queda vacío: el simulado no usa este campo para nada real y
   * el flujo de plan no tiene noción de "a quién se le manda el checkout".
   */
  async createSubscriptionPlanCheckout(input: CheckoutPlanInput): Promise<ResultadoCheckoutPlan> {
    const fila = await prisma.pagoSimulado.create({
      data: {
        kind: 'SUBSCRIPTION',
        externalReference: input.externalReference,
        concept: input.reason,
        amountArs: input.amountArs,
        payerEmail: '',
        backUrl: input.backUrl,
      },
    });
    return { planId: fila.id, initPoint: `/pago-simulado/${fila.id}` };
  }

  async createOneTimeCheckout(input: CheckoutUnicoInput): Promise<ResultadoCheckout> {
    const fila = await prisma.pagoSimulado.create({
      data: {
        kind: 'ONE_TIME',
        externalReference: input.externalReference,
        concept: input.concept,
        amountArs: input.amountArs,
        payerEmail: input.payerEmail,
        backUrl: input.backUrls.success,
      },
    });
    return { providerCheckoutId: fila.id, initPoint: `/pago-simulado/${fila.id}` };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    await prisma.pagoSimulado.update({
      where: { id: providerSubscriptionId },
      data: { status: 'CANCELLED' },
    });
  }

  async fetchPayment(providerPaymentId: string): Promise<PagoObtenido> {
    const fila = await prisma.pagoSimulado.findUniqueOrThrow({ where: { id: providerPaymentId } });
    return {
      providerPaymentId: providerIdDePago(fila),
      status: estadoPagoSimulado(fila.status),
      amountArs: fila.amountArs.toNumber(),
      externalReference: fila.externalReference,
      // El simulado siempre resuelve por `externalReference` (ver el
      // comentario de `createSubscriptionPlanCheckout`) — el camino por
      // `providerSubscriptionId` es exclusivo del adaptador real.
      providerSubscriptionId: null,
    };
  }

  /** El simulado nunca produce el tópico `subscription_authorized_payment`
   *  (`simularRenovacion` siempre arma `{ kind: 'payment' }`) — se
   *  implementa igual a `fetchPayment` sólo para cumplir la interfaz. */
  async fetchAuthorizedPayment(providerPaymentId: string): Promise<PagoObtenido> {
    return this.fetchPayment(providerPaymentId);
  }

  async fetchSubscription(providerSubscriptionId: string): Promise<SuscripcionObtenida> {
    const fila = await prisma.pagoSimulado.findUniqueOrThrow({ where: { id: providerSubscriptionId } });
    return {
      providerSubscriptionId: fila.id,
      status: fila.status === 'CANCELLED' ? 'cancelled' : fila.status === 'APPROVED' ? 'authorized' : 'pending',
      externalReference: fila.externalReference,
      // El simulado no tiene noción de "plan" distinta del checkout mismo.
      planId: null,
    };
  }

  verifyNotification(): boolean {
    // Sin proveedor real detrás no hay nada que firmar; la "notificación"
    // simulada la arma el propio servidor (ver más abajo), nunca un tercero.
    return true;
  }

  parseNotification(body: unknown): NotificacionRecibida {
    const data = body as { kind?: string; id?: string } | null;
    if (data && (data.kind === 'payment' || data.kind === 'subscription_preapproval') && data.id) {
      return { kind: data.kind, id: data.id };
    }
    return { kind: 'unknown', id: null };
  }
}

function estadoPagoSimulado(status: string): 'approved' | 'rejected' | 'pending' | 'refunded' | 'cancelled' {
  switch (status) {
    case 'APPROVED':
      return 'approved';
    case 'REJECTED':
      return 'rejected';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return 'pending';
  }
}

// ─────────────────────────────────────────────────────────────
// Acciones de la página /pago-simulado/[id] — usadas por
// POST /api/billing/pago-simulado/[id]/accion (T4). No aplican ningún
// efecto de negocio: sólo cambian el estado "del proveedor" y devuelven la
// notificación para que el endpoint la procese con
// aplicar.ts#procesarNotificacion, EXACTAMENTE como un webhook real.
// ─────────────────────────────────────────────────────────────

export interface FilaPagoSimulado {
  id: string;
  kind: string;
  externalReference: string;
  concept: string;
  amountArs: number;
  status: string;
  payerEmail: string;
  backUrl: string;
  parentId: string | null;
}

export async function obtenerPagoSimulado(id: string): Promise<FilaPagoSimulado | null> {
  const fila = await prisma.pagoSimulado.findUnique({ where: { id } });
  if (!fila) return null;
  return {
    id: fila.id,
    kind: fila.kind,
    externalReference: fila.externalReference,
    concept: fila.concept,
    amountArs: fila.amountArs.toNumber(),
    status: fila.status,
    payerEmail: fila.payerEmail,
    backUrl: fila.backUrl,
    parentId: fila.parentId,
  };
}

/** "Aprobar pago"/"Rechazar pago" del checkout ORIGINAL (primer cobro). */
export async function resolverCheckoutSimulado(
  id: string,
  aprobado: boolean,
): Promise<{ notificacion: NotificacionRecibida; backUrl: string } | null> {
  // updateMany con el guard de estado (no `update`): un doble click no
  // resuelve el mismo checkout dos veces con estados distintos.
  const actualizado = await prisma.pagoSimulado.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: aprobado ? 'APPROVED' : 'REJECTED' },
  });
  if (actualizado.count === 0) return null;
  const fila = await prisma.pagoSimulado.findUniqueOrThrow({ where: { id } });
  return { notificacion: { kind: 'payment', id: fila.id }, backUrl: fila.backUrl };
}

/**
 * "Simular cobro de renovación"/"Simular cobro fallido": crea un pago HIJO
 * nuevo (mismo `externalReference` que el padre, como haría Mercado Pago con
 * cada cobro recurrente de una misma `preapproval`) y devuelve la
 * notificación de ESE hijo — el padre (la "suscripción") no cambia de estado
 * acá, sólo lo hacen sus pagos.
 */
export async function simularRenovacion(
  subscriptionCheckoutId: string,
  aprobado: boolean,
  amountArs: number,
): Promise<NotificacionRecibida> {
  const padre = await prisma.pagoSimulado.findUniqueOrThrow({ where: { id: subscriptionCheckoutId } });
  const hijo = await prisma.pagoSimulado.create({
    data: {
      kind: 'SUBSCRIPTION',
      externalReference: padre.externalReference,
      concept: `Renovación — ${padre.concept}`,
      amountArs,
      status: aprobado ? 'APPROVED' : 'REJECTED',
      payerEmail: padre.payerEmail,
      backUrl: padre.backUrl,
      parentId: padre.id,
    },
  });
  return { kind: 'payment', id: hijo.id };
}
