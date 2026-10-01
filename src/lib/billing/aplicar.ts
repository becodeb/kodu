import { prisma } from '../db.ts';
import { billingNow, getEnv } from '../env.ts';
import { bandForStudents } from './bandas.ts';
import { firstCharge, renewalChargeIndividualAnnual, renewalChargeOrgCycle, type IntervaloCobro } from './ciclo.ts';
import { esCuitValido, formatearCuit } from './cuit.ts';
import { activarCreditosIndividual, ensureGrants } from './creditos-servicio.ts';
import { resolverGatewayDePago } from './pasarela/index.ts';
import {
  ErrorProveedorPago,
  type NotificacionRecibida,
  type PagoObtenido,
  type PaymentGateway,
  type SuscripcionObtenida,
} from './pasarela/tipos.ts';
import { intentarEmitirFactura } from './facturacion-superadmin.ts';
import type { IndividualInterval, OrgBillingInterval, OrgIvaCondition } from '../../generated/prisma/client.ts';

/**
 * odd/tasks/planes-y-cobros.md (T4): el servicio de dominio que aplica los
 * efectos de un cobro — el ÚNICO lugar que escribe `OrganizationLicense`,
 * `IndividualSubscription`, `Payment` e `Invoice` a partir de un pago. Los
 * endpoints de checkout (`/api/billing/org/checkout`,
 * `/api/billing/individual/checkout`) y el webhook
 * (`/api/billing/webhook/mercadopago`, y las acciones de
 * `/pago-simulado/[id]` con el adaptador simulado) son los dos únicos
 * llamadores.
 *
 * Seguridad (decisión de esta tarea): el monto SIEMPRE se calcula del lado
 * del servidor a partir del catálogo (nunca lo que mande el cliente); el
 * `external_reference` identifica al dueño Y a la fila de `Payment` que este
 * mismo módulo creó ANTES de llamar al proveedor (ver el comentario de
 * `pasarela/tipos.ts`); un webhook con una referencia desconocida o un monto
 * que no coincide con lo esperado se loguea y NO se aplica.
 */

export type ResultadoAccion<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; reason?: string };

function proveedorActual(): 'SIMULADO' | 'MERCADOPAGO' {
  return getEnv().BILLING_PROVIDER === 'mercadopago' ? 'MERCADOPAGO' : 'SIMULADO';
}

function gatewayORefuse(): PaymentGateway | { refuse: ResultadoAccion<never> } {
  const gateway = resolverGatewayDePago();
  if (!gateway) {
    return {
      refuse: {
        ok: false,
        status: 503,
        message: 'El cobro no está disponible en este entorno: falta configurar BILLING_PROVIDER.',
      },
    };
  }
  return gateway;
}

/**
 * T4c (sandbox real, fase 2): probando contra Mercado Pago real encontramos
 * que un checkout puede fallar en la CREACIÓN con un 4xx legible — p.ej.
 * `payer_email` que no corresponde a ninguna cuenta de Mercado Pago
 * ("Both payer and collector must be real or test users"), o un monto bajo
 * el mínimo. Antes esa excepción bubbleaba sin atrapar y los endpoints de
 * checkout devolvían un 500 sin explicación. Este helper envuelve la
 * llamada al gateway y traduce `ErrorProveedorPago` a un 502 con el mensaje
 * de Mercado Pago — cualquier otro error (red, 5xx) sigue bubbleando.
 */
async function intentarCheckout<T>(crear: () => Promise<T>): Promise<{ ok: true; data: T } | ResultadoAccion<never>> {
  try {
    return { ok: true, data: await crear() };
  } catch (error) {
    if (error instanceof ErrorProveedorPago) {
      return { ok: false, status: 502, message: `Mercado Pago rechazó el checkout: ${error.mpMessage}` };
    }
    throw error;
  }
}

async function settings() {
  return prisma.billingSettings.findUniqueOrThrow({ where: { id: 1 } });
}

// ─────────────────────────────────────────────────────────────
// Checkout — institución
// ─────────────────────────────────────────────────────────────

export interface CheckoutOrgInput {
  interval: OrgBillingInterval;
  legalName: string;
  cuit: string;
  /** T8: obligatoria para `CondicionIVAReceptorId` (RG 5616) — se pide junto
   *  con razón social y CUIT, antes de contratar. */
  ivaCondition: OrgIvaCondition;
}

export async function crearCheckoutOrg(
  actor: { id: string; email: string },
  rootOrganizationId: string,
  input: CheckoutOrgInput,
): Promise<ResultadoAccion<{ url: string }>> {
  const gateway = gatewayORefuse();
  if ('refuse' in gateway) return gateway.refuse;

  const legalName = input.legalName.trim();
  if (!legalName) return { ok: false, status: 422, message: 'Falta la razón social.' };
  if (!esCuitValido(input.cuit)) return { ok: false, status: 422, message: 'El CUIT no es válido.' };
  if (!input.ivaCondition) return { ok: false, status: 422, message: 'Falta la condición frente al IVA.' };

  const license = await prisma.organizationLicense.findUnique({ where: { organizationId: rootOrganizationId } });
  if (!license) return { ok: false, status: 404, message: 'No encontramos la licencia de tu institución.' };
  if (license.status === 'MANUAL') {
    return { ok: false, status: 409, message: 'Tu institución ya tiene una licencia manual activa.' };
  }
  if (license.status === 'ACTIVE' || license.status === 'PAST_DUE') {
    return { ok: false, status: 409, message: 'Tu institución ya tiene una licencia contratada.' };
  }

  const cfg = await settings();
  const banda = bandForStudents(license.declaredStudents, cfg.hablemosThresholdStudents);
  if (banda.kind === 'invalid') {
    return { ok: false, status: 422, message: 'La matrícula declarada no es válida.' };
  }
  if (banda.kind === 'hablemos') {
    return {
      ok: false,
      status: 422,
      message: 'Tu matrícula supera nuestras bandas con precio fijo — escribinos y lo vemos.',
      reason: 'HABLEMOS',
    };
  }

  const filaBanda = await prisma.institutionalBand.findUniqueOrThrow({ where: { key: banda.key } });
  const now = billingNow();
  const primerCobro = firstCharge({
    date: now,
    interval: input.interval,
    banda: {
      monthlyPriceArs: filaBanda.monthlyPriceArs.toNumber(),
      cyclePriceArs: filaBanda.cyclePriceArs.toNumber(),
    },
  });

  await prisma.organizationLicense.update({
    where: { id: license.id },
    data: { legalName, cuit: formatearCuit(input.cuit), interval: input.interval, ivaCondition: input.ivaCondition },
  });

  const checkout = await prisma.payment.create({
    data: {
      organizationId: rootOrganizationId,
      organizationLicenseId: license.id,
      amountArs: primerCobro.amountArs,
      status: 'PENDING',
      provider: proveedorActual(),
      periodStart: primerCobro.periodStart,
      periodEnd: primerCobro.periodEnd,
      intervalSnapshot: input.interval,
    },
  });

  const env = getEnv();
  const backUrl = `${env.PUBLIC_SITE_URL}/org/plan?checkout=listo`;
  const notificationUrl = `${env.PUBLIC_SITE_URL}/api/billing/webhook/mercadopago`;

  if (input.interval === 'MONTHLY') {
    // T4c (fase 4): `createSubscriptionPlanCheckout` en vez de
    // `createSubscriptionCheckout` — ya no manda `payer_email` (confirmado
    // contra el sandbox real que exigir una cuenta de Mercado Pago igual al
    // email de login de Kodu rechazaba la institución casi siempre). Lo
    // único que se conoce AHORA es el `preapproval_plan_id`; el
    // `preapproval` real recién se sabe cuando Mercado Pago avisa que
    // alguien se suscribió (`procesarNotificacion` lo resuelve por ese id —
    // ver `resolverCheckoutPorPlan`).
    const intento = await intentarCheckout(() =>
      gateway.createSubscriptionPlanCheckout({
        externalReference: checkout.id,
        reason: 'Kodu — licencia institucional mensual',
        amountArs: primerCobro.amountArs,
        frequency: 1,
        frequencyType: 'months',
        backUrl,
      }),
    );
    if (!intento.ok) return intento;
    await prisma.organizationLicense.update({
      where: { id: license.id },
      data: { externalPlanId: intento.data.planId },
    });
    return { ok: true, data: { url: intento.data.initPoint } };
  }

  // CYCLE: pago único, sin preapproval automática — ver el comentario de
  // `pasarela/mercadopago.ts` sobre por qué (no se pudo confirmar un "anual"
  // real de Mercado Pago en esta sesión). La renovación de marzo es un
  // checkout nuevo (T7/T9, fuera de esta tarea): esta licencia queda
  // ACTIVE con `currentPeriodEnd` en el fin del ciclo cubierto y sin
  // `externalSubscriptionId`.
  const intento = await intentarCheckout(() =>
    gateway.createOneTimeCheckout({
      externalReference: checkout.id,
      concept: 'Kodu — licencia institucional, ciclo lectivo',
      amountArs: primerCobro.amountArs,
      backUrls: { success: backUrl, failure: backUrl, pending: backUrl },
      notificationUrl,
      payerEmail: actor.email,
    }),
  );
  if (!intento.ok) return intento;
  return { ok: true, data: { url: intento.data.initPoint } };
}

// ─────────────────────────────────────────────────────────────
// Renovación — ciclo lectivo institucional (T4b)
// ─────────────────────────────────────────────────────────────

/**
 * odd/tasks/planes-y-cobros.md (T4b): checkout de renovación de una
 * licencia por CICLO ya contratada — precio de ciclo completo (nunca
 * prorrateado), período nuevo anclado a `currentPeriodEnd` (nunca a "hoy":
 * ver `ciclo.ts#renewalChargeOrgCycle`). Se puede pagar desde 30 días antes
 * del vencimiento (el banner, en las páginas) hasta que entra en sólo
 * lectura — pagar en cualquier momento de esa ventana da el MISMO período, así
 * que nunca duplica cobro ni regala meses. Reutiliza `aplicarPrimerCobroOrg`
 * al aplicarse (ver `aplicarPrimerCobro`): esa función ya es "pisar
 * status/período con lo que diga el Payment", sin importar si es la primera
 * vez o una renovación.
 */
export async function crearCheckoutRenovacionOrg(
  actor: { id: string; email: string },
  rootOrganizationId: string,
): Promise<ResultadoAccion<{ url: string }>> {
  const gateway = gatewayORefuse();
  if ('refuse' in gateway) return gateway.refuse;

  const license = await prisma.organizationLicense.findUnique({ where: { organizationId: rootOrganizationId } });
  if (!license) return { ok: false, status: 404, message: 'No encontramos la licencia de tu institución.' };
  if (license.status === 'MANUAL') {
    return { ok: false, status: 409, message: 'Esta licencia la administra Kodu directamente — escribinos.' };
  }
  if (license.interval !== 'CYCLE') {
    return { ok: false, status: 409, message: 'La renovación anticipada es sólo para la licencia por ciclo lectivo.' };
  }
  if (!license.currentPeriodEnd || !license.bandKey) {
    return { ok: false, status: 409, message: 'Todavía no tenés un período contratado para renovar.' };
  }

  const yaHayRenovacionEnCurso = await prisma.payment.findFirst({
    where: {
      organizationLicenseId: license.id,
      periodStart: { gt: license.currentPeriodEnd },
      status: { in: ['PENDING', 'APPROVED'] },
    },
  });
  if (yaHayRenovacionEnCurso) {
    return { ok: false, status: 409, message: 'Ya hay una renovación en curso para el próximo ciclo.' };
  }

  const filaBanda = await prisma.institutionalBand.findUniqueOrThrow({ where: { key: license.bandKey } });
  const renovacion = renewalChargeOrgCycle({
    currentPeriodEnd: license.currentPeriodEnd,
    cyclePriceArs: filaBanda.cyclePriceArs.toNumber(),
  });

  const checkout = await prisma.payment.create({
    data: {
      organizationId: rootOrganizationId,
      organizationLicenseId: license.id,
      amountArs: renovacion.amountArs,
      status: 'PENDING',
      provider: proveedorActual(),
      periodStart: renovacion.periodStart,
      periodEnd: renovacion.periodEnd,
      intervalSnapshot: 'CYCLE',
    },
  });

  const env = getEnv();
  const backUrl = `${env.PUBLIC_SITE_URL}/org/plan?checkout=listo`;
  const notificationUrl = `${env.PUBLIC_SITE_URL}/api/billing/webhook/mercadopago`;
  const intento = await intentarCheckout(() =>
    gateway.createOneTimeCheckout({
      externalReference: checkout.id,
      concept: 'Kodu — renovación del ciclo lectivo',
      amountArs: renovacion.amountArs,
      backUrls: { success: backUrl, failure: backUrl, pending: backUrl },
      notificationUrl,
      payerEmail: actor.email,
    }),
  );
  if (!intento.ok) return intento;
  return { ok: true, data: { url: intento.data.initPoint } };
}

export async function cancelarOrg(rootOrganizationId: string): Promise<ResultadoAccion<{ cancelAtPeriodEnd: true }>> {
  const license = await prisma.organizationLicense.findUnique({ where: { organizationId: rootOrganizationId } });
  if (!license) return { ok: false, status: 404, message: 'No encontramos la licencia de tu institución.' };
  if (license.status === 'MANUAL') {
    return { ok: false, status: 409, message: 'Esta licencia la administra Kodu directamente — escribinos.' };
  }

  if (license.externalSubscriptionId && license.interval === 'MONTHLY') {
    const gateway = resolverGatewayDePago();
    if (gateway) await gateway.cancelSubscription(license.externalSubscriptionId);
  }

  await prisma.organizationLicense.update({ where: { id: license.id }, data: { cancelAtPeriodEnd: true } });
  return { ok: true, data: { cancelAtPeriodEnd: true } };
}

// ─────────────────────────────────────────────────────────────
// Manual — superadmin (T7)
// ─────────────────────────────────────────────────────────────

export interface ActivarManualInput {
  interval: OrgBillingInterval;
  periodStart: Date;
  periodEnd: Date;
  amountArs: number;
  paymentDate: Date;
  legalName?: string;
  cuit?: string;
}

/**
 * odd/tasks/planes-y-cobros.md (T7): "Activar licencia manual por
 * transferencia" — el superadmin carga un cobro que pasó FUERA de cualquier
 * `PaymentGateway` (transferencia bancaria). Crea el `Payment` ya APROBADO
 * (provider `MANUAL`) y su `Invoice` PENDING, y deja la licencia ACTIVE con
 * ese período — mismo resultado final que `aplicarPrimerCobroOrg`, pero sin
 * pasar por ningún webhook (no hay ninguno: nadie del lado de un proveedor
 * sabe que esto pasó).
 */
export async function activarLicenciaManualPorTransferencia(
  rootOrganizationId: string,
  input: ActivarManualInput,
): Promise<ResultadoAccion<{ paymentId: string }>> {
  const license = await prisma.organizationLicense.findUnique({ where: { organizationId: rootOrganizationId } });
  if (!license) return { ok: false, status: 404, message: 'No encontramos la licencia de esta institución.' };
  if (!(input.amountArs > 0)) return { ok: false, status: 422, message: 'El monto tiene que ser mayor a 0.' };
  if (input.periodEnd.getTime() <= input.periodStart.getTime()) {
    return { ok: false, status: 422, message: 'El período no es válido: el fin tiene que ser posterior al inicio.' };
  }

  const cfg = await settings();
  const banda = bandForStudents(license.declaredStudents, cfg.hablemosThresholdStudents);

  const payment = await prisma.$transaction(async (tx) => {
    const pago = await tx.payment.create({
      data: {
        organizationId: rootOrganizationId,
        organizationLicenseId: license.id,
        amountArs: input.amountArs,
        status: 'APPROVED',
        provider: 'MANUAL',
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        intervalSnapshot: input.interval,
        createdAt: input.paymentDate,
      },
    });
    await tx.organizationLicense.update({
      where: { id: license.id },
      data: {
        status: 'ACTIVE',
        interval: input.interval,
        currentPeriodStart: input.periodStart,
        currentPeriodEnd: input.periodEnd,
        bandKey: banda.kind === 'band' ? banda.key : license.bandKey,
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
        legalName: input.legalName ?? license.legalName,
        cuit: input.cuit ?? license.cuit,
      },
    });
    await tx.invoice.create({
      data: {
        paymentId: pago.id,
        pointOfSale: 1,
        status: 'PENDING',
        recipientDocType: 'CUIT',
        recipientDocNumber: input.cuit ?? license.cuit ?? 'sin-cuit',
        recipientName: input.legalName ?? license.legalName ?? 'sin-razon-social',
      },
    });
    return pago;
  });

  // T8: la Invoice ya quedó PENDING adentro de la transacción de arriba;
  // intentar emitirla pasa DESPUÉS de que esa transacción cerró (mismo
  // criterio que el webhook: nunca adentro de la transacción crítica).
  const invoiceCreada = await prisma.invoice.findUnique({ where: { paymentId: payment.id }, select: { id: true } });
  if (invoiceCreada) {
    try {
      await intentarEmitirFactura(invoiceCreada.id);
    } catch (error) {
      console.warn(`[billing] la emisión automática de la factura ${invoiceCreada.id} (activación manual) falló:`, error);
    }
  }

  return { ok: true, data: { paymentId: payment.id } };
}

/** T7: "switch a license to/from MANUAL". A MANUAL es inmediato y siempre
 *  válido (congela la licencia como "la administra Kodu directamente"); de
 *  MANUAL vuelve a ACTIVE si ya tiene un período cargado, o a TRIAL si
 *  todavía no — nunca hay un cobro automático en ese camino de vuelta, así
 *  que el superadmin tiene que cargar uno a mano después si corresponde. */
export async function cambiarEstadoManual(
  rootOrganizationId: string,
  aManual: boolean,
): Promise<ResultadoAccion<{ status: string }>> {
  const license = await prisma.organizationLicense.findUnique({ where: { organizationId: rootOrganizationId } });
  if (!license) return { ok: false, status: 404, message: 'No encontramos la licencia de esta institución.' };

  if (aManual) {
    if (license.status === 'MANUAL') return { ok: false, status: 409, message: 'Ya es manual.' };
    await prisma.organizationLicense.update({ where: { id: license.id }, data: { status: 'MANUAL' } });
    return { ok: true, data: { status: 'MANUAL' } };
  }

  if (license.status !== 'MANUAL') return { ok: false, status: 409, message: 'Esta licencia no es manual.' };
  const nuevoStatus = license.currentPeriodEnd ? 'ACTIVE' : 'TRIAL';
  await prisma.organizationLicense.update({ where: { id: license.id }, data: { status: nuevoStatus } });
  return { ok: true, data: { status: nuevoStatus } };
}

/** T7: "mark refund done" para un pago con `refundRequested` (arrepentimiento
 *  individual, T4) — el reintegro de verdad lo hace el dueño a mano fuera de
 *  Kodu; esto sólo registra que ya se hizo. */
export async function marcarReintegroHecho(paymentId: string): Promise<ResultadoAccion<{ refundedAt: Date }>> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return { ok: false, status: 404, message: 'No encontramos ese pago.' };
  if (!payment.refundRequested) return { ok: false, status: 409, message: 'Este pago no tiene un reintegro pedido.' };
  if (payment.refundedAt) return { ok: false, status: 409, message: 'Este reintegro ya estaba marcado como hecho.' };

  const refundedAt = new Date();
  await prisma.payment.update({ where: { id: paymentId }, data: { refundedAt, status: 'REFUNDED' } });
  return { ok: true, data: { refundedAt } };
}

// ─────────────────────────────────────────────────────────────
// Checkout — individual
// ─────────────────────────────────────────────────────────────

export interface CheckoutIndividualInput {
  interval: IndividualInterval;
}

export async function crearCheckoutIndividual(
  actor: { id: string; email: string; organizationId: string | null },
  input: CheckoutIndividualInput,
): Promise<ResultadoAccion<{ url: string }>> {
  if (actor.organizationId !== null) {
    return { ok: false, status: 403, message: 'Tu cuenta pertenece a una organización: el plan Individual es para cuentas personales.' };
  }

  const gateway = gatewayORefuse();
  if ('refuse' in gateway) return gateway.refuse;

  const existente = await prisma.individualSubscription.findUnique({ where: { userId: actor.id } });
  if (existente && existente.status === 'ACTIVE') {
    return { ok: false, status: 409, message: 'Ya tenés el plan Individual activo.' };
  }

  const plan = await prisma.individualPlan.findUniqueOrThrow({ where: { key: 'INDIVIDUAL' } });
  const amountArs = input.interval === 'MONTHLY' ? plan.monthlyPriceArs.toNumber() : plan.annualPriceArs?.toNumber();
  if (amountArs === undefined || amountArs === null) {
    return { ok: false, status: 422, message: 'El plan anual no está disponible todavía.' };
  }

  const now = billingNow();
  const periodStart = now;
  const periodEnd = new Date(periodStart);
  if (input.interval === 'MONTHLY') {
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  } else {
    periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
  }

  const checkout = await prisma.payment.create({
    data: {
      userId: actor.id,
      amountArs,
      status: 'PENDING',
      provider: proveedorActual(),
      periodStart,
      periodEnd,
      intervalSnapshot: input.interval,
    },
  });

  const env = getEnv();
  const backUrl = `${env.PUBLIC_SITE_URL}/app/plan?checkout=listo`;
  const notificationUrl = `${env.PUBLIC_SITE_URL}/api/billing/webhook/mercadopago`;

  if (input.interval === 'MONTHLY') {
    // T4c (fase 4): ver el comentario equivalente en `crearCheckoutOrg`.
    const intento = await intentarCheckout(() =>
      gateway.createSubscriptionPlanCheckout({
        externalReference: checkout.id,
        reason: 'Kodu — plan Individual mensual',
        amountArs,
        frequency: 1,
        frequencyType: 'months',
        backUrl,
      }),
    );
    if (!intento.ok) return intento;
    await prisma.payment.update({
      where: { id: checkout.id },
      data: { pendingPlanId: intento.data.planId },
    });
    return { ok: true, data: { url: intento.data.initPoint } };
  }

  // ANNUAL: mismo criterio que el ciclo institucional — pago único, sin
  // preapproval automática (ver el comentario de `pasarela/mercadopago.ts`).
  const intento = await intentarCheckout(() =>
    gateway.createOneTimeCheckout({
      externalReference: checkout.id,
      concept: 'Kodu — plan Individual anual',
      amountArs,
      backUrls: { success: backUrl, failure: backUrl, pending: backUrl },
      notificationUrl,
      payerEmail: actor.email,
    }),
  );
  if (!intento.ok) return intento;
  return { ok: true, data: { url: intento.data.initPoint } };
}

/**
 * odd/tasks/planes-y-cobros.md (T4b): checkout de renovación del plan
 * Individual ANUAL — mismo criterio que `crearCheckoutRenovacionOrg`
 * (período anclado a `currentPeriodEnd`, precio anual completo). A
 * diferencia de la renovación de institución, acá el `Payment` SÍ lleva
 * `individualSubscriptionId` ya cargado (apuntando a la suscripción
 * EXISTENTE): es la marca que usa `aplicarPrimerCobro` para despachar a
 * `aplicarRenovacionIndividualAnual` en vez de crear una fila nueva (que
 * chocaría con el único de `IndividualSubscription.userId`).
 */
export async function crearCheckoutRenovacionIndividual(
  actor: { id: string; email: string },
): Promise<ResultadoAccion<{ url: string }>> {
  const gateway = gatewayORefuse();
  if ('refuse' in gateway) return gateway.refuse;

  const sub = await prisma.individualSubscription.findUnique({ where: { userId: actor.id } });
  if (!sub) return { ok: false, status: 404, message: 'No tenés una suscripción Individual.' };
  if (sub.interval !== 'ANNUAL') {
    return { ok: false, status: 409, message: 'La renovación anticipada es sólo para el plan anual.' };
  }

  const yaHayRenovacionEnCurso = await prisma.payment.findFirst({
    where: {
      individualSubscriptionId: sub.id,
      periodStart: { gt: sub.currentPeriodEnd },
      status: { in: ['PENDING', 'APPROVED'] },
    },
  });
  if (yaHayRenovacionEnCurso) {
    return { ok: false, status: 409, message: 'Ya hay una renovación en curso.' };
  }

  const plan = await prisma.individualPlan.findUniqueOrThrow({ where: { key: 'INDIVIDUAL' } });
  const annualPriceArs = plan.annualPriceArs?.toNumber();
  if (!annualPriceArs) return { ok: false, status: 422, message: 'El plan anual no está disponible todavía.' };

  const renovacion = renewalChargeIndividualAnnual({ currentPeriodEnd: sub.currentPeriodEnd, annualPriceArs });

  const checkout = await prisma.payment.create({
    data: {
      userId: actor.id,
      individualSubscriptionId: sub.id,
      amountArs: renovacion.amountArs,
      status: 'PENDING',
      provider: proveedorActual(),
      periodStart: renovacion.periodStart,
      periodEnd: renovacion.periodEnd,
      intervalSnapshot: 'ANNUAL',
    },
  });

  const env = getEnv();
  const backUrl = `${env.PUBLIC_SITE_URL}/app/plan?checkout=listo`;
  const notificationUrl = `${env.PUBLIC_SITE_URL}/api/billing/webhook/mercadopago`;
  const intento = await intentarCheckout(() =>
    gateway.createOneTimeCheckout({
      externalReference: checkout.id,
      concept: 'Kodu — renovación del plan Individual anual',
      amountArs: renovacion.amountArs,
      backUrls: { success: backUrl, failure: backUrl, pending: backUrl },
      notificationUrl,
      payerEmail: actor.email,
    }),
  );
  if (!intento.ok) return intento;
  return { ok: true, data: { url: intento.data.initPoint } };
}

export async function cancelarIndividual(userId: string): Promise<ResultadoAccion<{ cancelAtPeriodEnd: true }>> {
  const sub = await prisma.individualSubscription.findUnique({ where: { userId } });
  if (!sub || sub.status !== 'ACTIVE') {
    return { ok: false, status: 404, message: 'No tenés una suscripción Individual activa.' };
  }

  if (sub.externalSubscriptionId && sub.interval === 'MONTHLY') {
    const gateway = resolverGatewayDePago();
    if (gateway) await gateway.cancelSubscription(sub.externalSubscriptionId);
  }

  await prisma.individualSubscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
  return { ok: true, data: { cancelAtPeriodEnd: true } };
}

const DIAS_ARREPENTIMIENTO = 10;

export async function arrepentimientoIndividual(userId: string): Promise<ResultadoAccion<{ revertidoAFree: true }>> {
  const sub = await prisma.individualSubscription.findUnique({ where: { userId } });
  if (!sub) return { ok: false, status: 404, message: 'No tenés una suscripción Individual.' };

  const primerPago = await prisma.payment.findFirst({
    where: { individualSubscriptionId: sub.id, status: 'APPROVED' },
    orderBy: { createdAt: 'asc' },
  });
  if (!primerPago) return { ok: false, status: 404, message: 'No encontramos un pago aprobado de esta suscripción.' };

  const limite = new Date(primerPago.createdAt.getTime() + DIAS_ARREPENTIMIENTO * 24 * 60 * 60 * 1000);
  if (billingNow().getTime() > limite.getTime()) {
    return { ok: false, status: 409, message: `El derecho de arrepentimiento vence a los ${DIAS_ARREPENTIMIENTO} días del primer pago.` };
  }

  if (sub.externalSubscriptionId) {
    const gateway = resolverGatewayDePago();
    if (gateway) await gateway.cancelSubscription(sub.externalSubscriptionId).catch(() => {});
  }

  await prisma.$transaction([
    prisma.individualSubscription.update({
      where: { id: sub.id },
      data: { status: 'CANCELED', cancelAtPeriodEnd: true },
    }),
    prisma.payment.update({ where: { id: primerPago.id }, data: { refundRequested: true } }),
  ]);

  return { ok: true, data: { revertidoAFree: true } };
}

// ─────────────────────────────────────────────────────────────
// Webhook / simulado — procesar una notificación
// ─────────────────────────────────────────────────────────────

export interface ResultadoNotificacion {
  applied: boolean;
  reason: string;
}

export async function procesarNotificacion(
  gateway: PaymentGateway,
  notif: NotificacionRecibida,
): Promise<ResultadoNotificacion> {
  if (notif.kind === 'subscription_preapproval') {
    return procesarCambioDeSuscripcion(gateway, notif.id);
  }
  if (notif.kind !== 'payment' && notif.kind !== 'subscription_authorized_payment') {
    return { applied: false, reason: 'topic_ignorado' };
  }

  let pago: PagoObtenido;
  try {
    // T4c (sandbox real): `subscription_authorized_payment` trae el id de un
    // "authorized payment", un recurso distinto de un pago — ver el
    // comentario de `fetchAuthorizedPayment` en `pasarela/tipos.ts`.
    pago =
      notif.kind === 'subscription_authorized_payment'
        ? await gateway.fetchAuthorizedPayment(notif.id)
        : await gateway.fetchPayment(notif.id);
  } catch (error) {
    console.warn(`[billing] no se pudo releer el pago ${notif.id} del proveedor:`, error);
    return { applied: false, reason: 'fetch_fallido' };
  }

  return aplicarPago(gateway, pago);
}

async function procesarCambioDeSuscripcion(gateway: PaymentGateway, providerSubscriptionId: string): Promise<ResultadoNotificacion> {
  const sub = await gateway.fetchSubscription(providerSubscriptionId);

  if (sub.status === 'cancelled') {
    const license = await prisma.organizationLicense.findFirst({ where: { externalSubscriptionId: providerSubscriptionId } });
    if (license) {
      await prisma.organizationLicense.update({ where: { id: license.id }, data: { cancelAtPeriodEnd: true } });
      return { applied: true, reason: 'org_cancelada_en_proveedor' };
    }

    const indiv = await prisma.individualSubscription.findFirst({ where: { externalSubscriptionId: providerSubscriptionId } });
    if (indiv) {
      await prisma.individualSubscription.update({ where: { id: indiv.id }, data: { cancelAtPeriodEnd: true } });
      return { applied: true, reason: 'individual_cancelada_en_proveedor' };
    }

    return { applied: false, reason: 'referencia_desconocida' };
  }

  // T4c (fase 4): una `preapproval` creada desde un `preapproval_plan` NUNCA
  // trae `external_reference` — en cuanto deja de estar `pending` (alguien
  // la autorizó) hay que "reclamarla" para el checkout pendiente de ESE
  // plan. Una `preapproval` del flujo viejo (con `external_reference`) no
  // necesita nada acá: se activa sola cuando llega su primer pago.
  if (!sub.externalReference && sub.planId) {
    return reclamarPreapprovalDePlan(gateway, providerSubscriptionId, sub.planId);
  }

  return { applied: false, reason: 'sin_cambio_relevante' };
}

/**
 * T4c (fase 4): "una `preapproval_plan` pertenece a un único dueño" — la
 * primera `preapproval` que se ve para un plan se queda con el checkout
 * pendiente de ese plan (`pendingExternalSubscriptionId`/
 * `externalSubscriptionId`, los MISMOS campos que ya usaba el flujo viejo
 * para identificar una suscripción, sólo que ahora se completan tarde en
 * vez de al crear el checkout). Cualquier SEGUNDA `preapproval` que
 * reutilice el mismo link de pago (alguien compartió la URL, o el dueño
 * probó el link dos veces) se cancela y se ignora — nunca activa un segundo
 * titular ni pisa el período del primero.
 */
async function reclamarPreapprovalDePlan(
  gateway: PaymentGateway,
  providerSubscriptionId: string,
  planId: string,
): Promise<ResultadoNotificacion> {
  const yaReclamadaPorEsteId =
    (await prisma.payment.findFirst({ where: { pendingExternalSubscriptionId: providerSubscriptionId } })) ||
    (await prisma.organizationLicense.findFirst({ where: { externalSubscriptionId: providerSubscriptionId } }));
  if (yaReclamadaPorEsteId) return { applied: false, reason: 'ya_reclamada' };

  const paymentPendiente = await prisma.payment.findFirst({
    where: { pendingPlanId: planId, pendingExternalSubscriptionId: null },
    orderBy: { createdAt: 'desc' },
  });
  if (paymentPendiente) {
    await prisma.payment.update({
      where: { id: paymentPendiente.id },
      data: { pendingExternalSubscriptionId: providerSubscriptionId },
    });
    return { applied: true, reason: 'plan_reclamado_individual' };
  }

  const licenciaPendiente = await prisma.organizationLicense.findFirst({
    where: { externalPlanId: planId, externalSubscriptionId: null },
    orderBy: { createdAt: 'desc' },
  });
  if (licenciaPendiente) {
    await prisma.organizationLicense.update({
      where: { id: licenciaPendiente.id },
      data: { externalSubscriptionId: providerSubscriptionId },
    });
    return { applied: true, reason: 'plan_reclamado_org' };
  }

  const planYaTieneDueno =
    (await prisma.payment.findFirst({ where: { pendingPlanId: planId } })) ||
    (await prisma.organizationLicense.findFirst({ where: { externalPlanId: planId } }));
  if (planYaTieneDueno) {
    console.warn(
      `[billing] segunda preapproval (${providerSubscriptionId}) sobre el plan ${planId} — ya tiene dueño, se cancela para no activar un segundo titular.`,
    );
    await gateway.cancelSubscription(providerSubscriptionId).catch((error) => {
      console.warn(`[billing] no se pudo cancelar la preapproval duplicada ${providerSubscriptionId}:`, error);
    });
    return { applied: false, reason: 'plan_ya_asignado_cancelada' };
  }

  // Plan que no corresponde a ningún checkout nuestro (p.ej. uno creado a
  // mano para probar, fuera de la app) — no hay nada que reclamar ni nadie
  // a quien avisarle; se ignora sin tocar nada.
  console.warn(`[billing] preapproval ${providerSubscriptionId} de un plan (${planId}) ajeno a cualquier checkout — se ignora.`);
  return { applied: false, reason: 'plan_desconocido' };
}

async function aplicarPago(gateway: PaymentGateway, pago: PagoObtenido): Promise<ResultadoNotificacion> {
  // Idempotencia: un pago que ya conocemos (por su id del proveedor) nunca
  // se vuelve a aplicar — mismo criterio "nunca se confía en el cuerpo del
  // webhook" (design.md): esto vale también para el reintento legítimo de
  // Mercado Pago ante una respuesta lenta nuestra.
  const yaAplicado = await prisma.payment.findUnique({ where: { providerPaymentId: pago.providerPaymentId } });
  if (yaAplicado) return { applied: false, reason: 'ya_aplicado' };

  let checkoutRaiz = pago.externalReference ? await prisma.payment.findUnique({ where: { id: pago.externalReference } }) : null;

  if (!checkoutRaiz && pago.providerSubscriptionId) {
    // T4c (fase 4): preapproval sin `external_reference` (creada desde un
    // plan) — resolver por el `preapproval_plan_id` de la suscripción.
    checkoutRaiz = await resolverCheckoutPorSuscripcion(gateway, pago.providerSubscriptionId);
  }

  if (!checkoutRaiz) {
    console.warn(
      `[billing] webhook sin checkout resoluble (external_reference=${pago.externalReference ?? 'null'}, providerSubscriptionId=${pago.providerSubscriptionId ?? 'null'})`,
    );
    return { applied: false, reason: 'referencia_desconocida' };
  }

  if (checkoutRaiz.providerPaymentId === null) {
    return aplicarPrimerCobro(checkoutRaiz, pago);
  }
  return aplicarRenovacion(checkoutRaiz, pago);
}

type FilaPayment = Awaited<ReturnType<typeof prisma.payment.findUniqueOrThrow>>;

/**
 * T4c (fase 4): resuelve el checkout (`Payment`) dueño de una `preapproval`
 * cuando el pago que la originó no trae `external_reference`. Camino feliz:
 * `subscription_preapproval` ya la reclamó (`reclamarPreapprovalDePlan`) y
 * acá sólo hace falta encontrar esa fila. Defensivo: si el cobro llegó
 * ANTES que esa notificación (Mercado Pago no garantiza el orden de entrega
 * de sus webhooks), se reclama acá mismo con la MISMA lógica (incluida la
 * protección contra una segunda preapproval reutilizando el plan).
 */
async function resolverCheckoutPorSuscripcion(gateway: PaymentGateway, providerSubscriptionId: string): Promise<FilaPayment | null> {
  const buscarYaReclamado = async (): Promise<FilaPayment | null> => {
    const paymentClaimed = await prisma.payment.findFirst({ where: { pendingExternalSubscriptionId: providerSubscriptionId } });
    if (paymentClaimed) return paymentClaimed;

    const licenseClaimed = await prisma.organizationLicense.findFirst({ where: { externalSubscriptionId: providerSubscriptionId } });
    if (licenseClaimed) {
      return prisma.payment.findFirst({
        where: { organizationLicenseId: licenseClaimed.id, providerPaymentId: null },
        orderBy: { createdAt: 'desc' },
      });
    }
    return null;
  };

  const yaReclamado = await buscarYaReclamado();
  if (yaReclamado) return yaReclamado;

  const sub: SuscripcionObtenida = await gateway.fetchSubscription(providerSubscriptionId);
  if (sub.externalReference || !sub.planId) return null;

  const resultado = await reclamarPreapprovalDePlan(gateway, providerSubscriptionId, sub.planId);
  if (!resultado.applied) return null;
  return buscarYaReclamado();
}

const ESTADO_A_PAYMENT_STATUS = {
  approved: 'APPROVED',
  rejected: 'REJECTED',
  refunded: 'REFUNDED',
  cancelled: 'REJECTED',
  pending: 'PENDING',
} as const;

async function aplicarPrimerCobro(checkoutRaiz: FilaPayment, pago: PagoObtenido): Promise<ResultadoNotificacion> {
  if (Math.round(pago.amountArs) !== Math.round(checkoutRaiz.amountArs.toNumber())) {
    console.warn(
      `[billing] monto no coincide en el primer cobro de Payment ${checkoutRaiz.id}: esperado ${checkoutRaiz.amountArs}, recibido ${pago.amountArs}`,
    );
    return { applied: false, reason: 'monto_no_coincide' };
  }

  const status = ESTADO_A_PAYMENT_STATUS[pago.status];
  await prisma.payment.update({
    where: { id: checkoutRaiz.id },
    data: { providerPaymentId: pago.providerPaymentId, status, rawStatus: pago.status },
  });

  if (status !== 'APPROVED') return { applied: true, reason: `primer_cobro_${pago.status}` };

  if (checkoutRaiz.organizationLicenseId) {
    // T4b: sirve tanto para el primer cobro como para la renovación de
    // CICLO — `aplicarPrimerCobroOrg` sólo pisa status/período con lo que
    // ya trae este mismo Payment, no le importa si la licencia es nueva.
    await aplicarPrimerCobroOrg(checkoutRaiz);
  } else if (checkoutRaiz.individualSubscriptionId) {
    // T4b: renovación del plan Individual ANUAL — `individualSubscriptionId`
    // ya viene cargado desde `crearCheckoutRenovacionIndividual` apuntando a
    // la suscripción EXISTENTE; a diferencia del primer cobro, acá hay que
    // actualizarla, nunca crear una fila nueva (único de `userId`).
    await aplicarRenovacionIndividualAnual(checkoutRaiz);
  } else if (checkoutRaiz.userId) {
    await aplicarPrimerCobroIndividual(checkoutRaiz);
  }

  await crearFacturaYEmitir(checkoutRaiz.id);
  return { applied: true, reason: 'primer_cobro_aprobado' };
}

async function aplicarPrimerCobroOrg(checkout: FilaPayment): Promise<void> {
  const license = await prisma.organizationLicense.findUniqueOrThrow({ where: { id: checkout.organizationLicenseId! } });
  const cfg = await settings();
  const banda = bandForStudents(license.declaredStudents, cfg.hablemosThresholdStudents);

  await prisma.organizationLicense.update({
    where: { id: license.id },
    data: {
      status: 'ACTIVE',
      currentPeriodStart: checkout.periodStart,
      currentPeriodEnd: checkout.periodEnd,
      bandKey: banda.kind === 'band' ? banda.key : null,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
    },
  });
}

async function aplicarPrimerCobroIndividual(checkout: FilaPayment): Promise<void> {
  const interval = (checkout.intervalSnapshot ?? 'MONTHLY') as IndividualInterval;
  const sub = await prisma.individualSubscription.create({
    data: {
      userId: checkout.userId!,
      status: 'ACTIVE',
      interval,
      currentPeriodStart: checkout.periodStart,
      currentPeriodEnd: checkout.periodEnd,
      externalSubscriptionId: checkout.pendingExternalSubscriptionId,
      // T4c (fase 4): copiado igual que `externalSubscriptionId` — ya
      // cumplió su propósito (encontrar este checkout antes de que existiera
      // la suscripción) pero se conserva para diagnóstico.
      externalPlanId: checkout.pendingPlanId,
    },
  });
  await prisma.payment.update({ where: { id: checkout.id }, data: { individualSubscriptionId: sub.id } });
  // T10: alta nueva = activación — crédito Individual completo y fresco este
  // mes, sin importar el otorgamiento FREE que ya se haya dado/gastado.
  await activarCreditosIndividual(checkout.userId!, billingNow());
}

async function aplicarRenovacionIndividualAnual(checkout: FilaPayment): Promise<void> {
  await prisma.individualSubscription.update({
    where: { id: checkout.individualSubscriptionId! },
    data: {
      status: 'ACTIVE',
      currentPeriodStart: checkout.periodStart,
      currentPeriodEnd: checkout.periodEnd,
      cancelAtPeriodEnd: false,
    },
  });
  // T10: la renovación ANUAL llega como un checkout nuevo (T4b, Mercado Pago
  // no confirma `frequency: 12`), equivalente a una reactivación — mismo
  // criterio de "activación" que el alta nueva de arriba.
  await activarCreditosIndividual(checkout.userId!, billingNow());
}

async function aplicarRenovacion(checkoutRaiz: FilaPayment, pago: PagoObtenido): Promise<ResultadoNotificacion> {
  const status = ESTADO_A_PAYMENT_STATUS[pago.status];
  const cfg = await settings();

  if (checkoutRaiz.organizationLicenseId) {
    const license = await prisma.organizationLicense.findUniqueOrThrow({ where: { id: checkoutRaiz.organizationLicenseId } });
    const bandaEsperada = license.bandKey
      ? await prisma.institutionalBand.findUnique({ where: { key: license.bandKey } })
      : null;
    const esperado = bandaEsperada
      ? (license.interval === 'MONTHLY' ? bandaEsperada.monthlyPriceArs : bandaEsperada.cyclePriceArs).toNumber()
      : null;
    if (esperado !== null && Math.round(esperado) !== Math.round(pago.amountArs)) {
      console.warn(`[billing] monto no coincide en la renovación de la licencia ${license.id}: esperado ${esperado}, recibido ${pago.amountArs}`);
      return { applied: false, reason: 'monto_no_coincide' };
    }

    const periodStart = license.currentPeriodEnd ?? billingNow();
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

    await prisma.payment.create({
      data: {
        organizationId: checkoutRaiz.organizationId,
        organizationLicenseId: license.id,
        amountArs: pago.amountArs,
        status,
        provider: checkoutRaiz.provider,
        providerPaymentId: pago.providerPaymentId,
        periodStart,
        periodEnd,
        rawStatus: pago.status,
      },
    });

    if (status === 'APPROVED') {
      await prisma.organizationLicense.update({
        where: { id: license.id },
        data: { status: 'ACTIVE', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, graceEndsAt: null },
      });
      const nuevoPago = await prisma.payment.findFirst({ where: { providerPaymentId: pago.providerPaymentId } });
      if (nuevoPago) await crearFacturaYEmitir(nuevoPago.id);
    } else {
      await prisma.organizationLicense.update({
        where: { id: license.id },
        data: { status: 'PAST_DUE', graceEndsAt: new Date(billingNow().getTime() + cfg.graceDays * 24 * 60 * 60 * 1000) },
      });
    }
    return { applied: true, reason: `renovacion_org_${pago.status}` };
  }

  if (checkoutRaiz.individualSubscriptionId || checkoutRaiz.userId) {
    const sub = checkoutRaiz.individualSubscriptionId
      ? await prisma.individualSubscription.findUniqueOrThrow({ where: { id: checkoutRaiz.individualSubscriptionId } })
      : await prisma.individualSubscription.findUniqueOrThrow({ where: { userId: checkoutRaiz.userId! } });

    const plan = await prisma.individualPlan.findUniqueOrThrow({ where: { key: 'INDIVIDUAL' } });
    const esperado = (sub.interval === 'MONTHLY' ? plan.monthlyPriceArs : (plan.annualPriceArs ?? plan.monthlyPriceArs)).toNumber();
    if (Math.round(esperado) !== Math.round(pago.amountArs)) {
      console.warn(`[billing] monto no coincide en la renovación de la suscripción individual ${sub.id}: esperado ${esperado}, recibido ${pago.amountArs}`);
      return { applied: false, reason: 'monto_no_coincide' };
    }

    const periodStart = sub.currentPeriodEnd;
    const periodEnd = new Date(periodStart);
    if (sub.interval === 'MONTHLY') periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    else periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);

    await prisma.payment.create({
      data: {
        userId: sub.userId,
        individualSubscriptionId: sub.id,
        amountArs: pago.amountArs,
        status,
        provider: checkoutRaiz.provider,
        providerPaymentId: pago.providerPaymentId,
        periodStart,
        periodEnd,
        rawStatus: pago.status,
      },
    });

    if (status === 'APPROVED') {
      await prisma.individualSubscription.update({
        where: { id: sub.id },
        data: { status: 'ACTIVE', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
      });
      // T10 (decisión del dueño): "renewals in later months follow the
      // normal monthly grant" — ÉSTA es la renovación recurrente de una
      // suscripción MONTHLY ya activa, no la activación (ver
      // `activarCreditosIndividual` en `aplicarPrimerCobroIndividual` /
      // `aplicarRenovacionIndividualAnual`). `ensureGrants` ya otorga
      // `PLAN_GRANT` normal para el período nuevo porque la suscripción sigue
      // ACTIVE arriba — no hace falta el "fresco con vencimiento" de la
      // activación.
      await ensureGrants(sub.userId, billingNow());
    } else {
      await prisma.individualSubscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } });
    }
    return { applied: true, reason: `renovacion_individual_${pago.status}` };
  }

  return { applied: false, reason: 'referencia_sin_dueno' };
}

/**
 * odd/tasks/planes-y-cobros.md (T8): crea la factura PENDING y, FUERA de
 * cualquier transacción (`crearFacturaPendiente` ya hizo su propio `create`
 * suelto), intenta emitirla de una — nunca bloquea al llamador: un error acá
 * se traga (queda `FAILED` con `lastError`, reintentable desde
 * `/admin/facturacion`) para que el webhook siempre responda 200 aunque ARCA
 * esté caído (design.md — "el webhook debe responder 200 incluso si ARCA
 * falla").
 */
async function crearFacturaYEmitir(paymentId: string): Promise<void> {
  await crearFacturaPendiente(paymentId);
  const invoice = await prisma.invoice.findUnique({ where: { paymentId }, select: { id: true } });
  if (!invoice) return;
  try {
    await intentarEmitirFactura(invoice.id);
  } catch (error) {
    console.warn(`[billing] la emisión automática de la factura ${invoice.id} falló:`, error);
  }
}

async function crearFacturaPendiente(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: {
      organizationLicense: true,
      user: true,
    },
  });

  const yaExiste = await prisma.invoice.findUnique({ where: { paymentId } });
  if (yaExiste) return;

  const recipiente = payment.organizationLicense
    ? {
        recipientDocType: 'CUIT',
        recipientDocNumber: payment.organizationLicense.cuit ?? 'sin-cuit',
        recipientName: payment.organizationLicense.legalName ?? 'sin-razon-social',
      }
    : {
        recipientDocType: 'DNI',
        recipientDocNumber: 'sin-dato',
        recipientName: payment.user?.name ?? payment.user?.email ?? 'sin-dato',
      };

  await prisma.invoice.create({
    data: {
      paymentId,
      pointOfSale: 1,
      status: 'PENDING',
      ...recipiente,
    },
  });
}
