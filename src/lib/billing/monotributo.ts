import { prisma } from '../db.ts';

/**
 * odd/tasks/planes-y-cobros.md (T7): lo facturado en los últimos 12 meses
 * contra `BillingSettings.monotributoAnnualCapArs` — el aviso del superadmin
 * ("Te estás acercando al tope del monotributo"). "Facturado" = pagos
 * APROBADOS menos reintegros, por FECHA DE FACTURA cuando existe (la factura
 * se emite unos instantes después del pago — `Invoice.createdAt` es la fecha
 * real a efectos de AFIP/ARCA); si todavía no hay factura (T8 falló o está
 * pendiente), se usa la fecha del pago como aproximación razonable.
 *
 * Simplificación deliberada de esta tarea: se filtra en la base por la fecha
 * del PAGO (no la de la factura, que Prisma no puede indexar en el mismo
 * filtro sin un `include`) con un margen de 45 días para no perder facturas
 * que tardaron en emitirse, y se afina la ventana exacta en memoria — la
 * cantidad de pagos de un negocio chico/mediano nunca justifica optimizar
 * más que esto.
 */

export interface ResumenMonotributo {
  facturado12m: number;
  capArs: number | null;
  /** `null` si no hay tope cargado — no corresponde ningún aviso. */
  porcentaje: number | null;
}

const UN_ANIO_MS = 365 * 24 * 60 * 60 * 1000;
const MARGEN_MS = 45 * 24 * 60 * 60 * 1000;

export async function resumenMonotributo(now: Date): Promise<ResumenMonotributo> {
  const cfg = await prisma.billingSettings.findUniqueOrThrow({ where: { id: 1 } });
  const desde = new Date(now.getTime() - UN_ANIO_MS);

  const pagos = await prisma.payment.findMany({
    where: { status: 'APPROVED', createdAt: { gte: new Date(desde.getTime() - MARGEN_MS), lte: now } },
    select: { amountArs: true, createdAt: true, refundRequested: true, refundedAt: true, invoice: { select: { createdAt: true } } },
  });

  let facturado = 0;
  for (const pago of pagos) {
    const fecha = pago.invoice?.createdAt ?? pago.createdAt;
    if (fecha.getTime() < desde.getTime() || fecha.getTime() > now.getTime()) continue;
    if (pago.refundRequested && pago.refundedAt) continue; // reintegrado: no cuenta como facturado neto.
    facturado += pago.amountArs.toNumber();
  }

  const capArs = cfg.monotributoAnnualCapArs ? cfg.monotributoAnnualCapArs.toNumber() : null;
  const porcentaje = capArs && capArs > 0 ? facturado / capArs : null;
  return { facturado12m: facturado, capArs, porcentaje };
}
