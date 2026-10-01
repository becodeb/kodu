import { prisma } from '../db.ts';
import { hasResendApiKey } from '../env.ts';
import { enviarEmail } from '../email/resend.ts';
import { resolverFacturador } from './facturador/index.ts';
import type { DestinatarioFactura, FacturaInput } from './facturador/tipos.ts';
import type { ResultadoAccion } from './aplicar.ts';

/**
 * odd/tasks/planes-y-cobros.md (T8): emite (o reintenta emitir) una Factura
 * `Invoice`. Reemplaza el stub de T7 — la UI de `/admin/facturacion` y el
 * endpoint `/api/admin/billing/facturas/reintentar` NO cambiaron, siguen
 * llamando a esta misma función.
 *
 * Idempotencia/concurrencia: el `updateMany` con `status: { in: ['PENDING',
 * 'FAILED'] }` es el lock — Postgres toma el lock de fila en el UPDATE, así
 * que dos reintentos simultáneos nunca pasan los dos: sólo uno ve `count ===
 * 1` y pasa a `ISSUING`; el otro ve `count === 0` y se va con 409. Nunca se
 * emite la misma factura dos veces.
 */
type InvoiceConPago = Awaited<ReturnType<typeof cargarInvoice>>;

function cargarInvoice(invoiceId: string) {
  return prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { payment: { include: { organizationLicense: true, user: true } } },
  });
}

export async function intentarEmitirFactura(invoiceId: string): Promise<ResultadoAccion<{ status: string }>> {
  const invoice = await cargarInvoice(invoiceId);
  if (!invoice) return { ok: false, status: 404, message: 'No encontramos esa factura.' };
  if (invoice.status === 'ISSUED') return { ok: false, status: 409, message: 'Esta factura ya está emitida.' };
  if (invoice.status === 'ISSUING') return { ok: false, status: 409, message: 'Esta factura ya se está emitiendo.' };

  const facturador = resolverFacturador();
  if (!facturador) {
    return { ok: false, status: 503, message: 'La facturación automática está apagada en este entorno.' };
  }

  // Lock: sólo pasa de PENDING o FAILED a ISSUING — nunca dos veces la misma.
  const lock = await prisma.invoice.updateMany({
    where: { id: invoiceId, status: { in: ['PENDING', 'FAILED'] } },
    data: { status: 'ISSUING' },
  });
  if (lock.count === 0) {
    return { ok: false, status: 409, message: 'Esta factura ya se está emitiendo o ya fue emitida.' };
  }

  const input = construirFacturaInput(invoice);
  if (!input.ok) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'FAILED', attempts: { increment: 1 }, lastError: input.error },
    });
    return { ok: true, data: { status: 'FAILED' } };
  }

  const resultado = await facturador.issueInvoiceC(input.data);
  if (!resultado.ok) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'FAILED', attempts: { increment: 1 }, lastError: resultado.error.message },
    });
    return { ok: true, data: { status: 'FAILED' } };
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: 'ISSUED',
      number: resultado.data.number,
      cae: resultado.data.cae,
      caeDueDate: resultado.data.caeDueDate,
      condicionIvaReceptorId: resultado.data.condicionIvaReceptorId,
      lastError: null,
    },
  });

  await intentarMailFactura(invoiceId).catch((error) => {
    console.warn(`[billing] no se pudo mandar el mail de la factura ${invoiceId}:`, error);
  });

  return { ok: true, data: { status: 'ISSUED' } };
}

function construirFacturaInput(invoice: NonNullable<InvoiceConPago>): { ok: true; data: FacturaInput } | { ok: false; error: string } {
  const payment = invoice.payment;
  let recipient: DestinatarioFactura;

  if (payment.organizationLicenseId) {
    const license = payment.organizationLicense;
    if (!license?.cuit || !license.legalName) {
      return { ok: false, error: 'Falta la razón social o el CUIT de la institución.' };
    }
    if (!license.ivaCondition) {
      return { ok: false, error: 'Falta la condición frente al IVA de la institución (cargala en /org/plan).' };
    }
    recipient = { kind: 'cuit', docNumber: license.cuit, name: license.legalName, ivaCondition: license.ivaCondition };
  } else {
    // Individual: siempre consumidor final (ver el gap documentado en el
    // informe de T8 — no se pudo confirmar desde una fuente primaria el
    // monto vigente del umbral que exigiría identificar al comprador).
    recipient = { kind: 'consumidor_final', name: invoice.recipientName };
  }

  return {
    ok: true,
    data: {
      pointOfSale: invoice.pointOfSale,
      periodStart: payment.periodStart,
      periodEnd: payment.periodEnd,
      paymentDate: payment.createdAt,
      amountArs: payment.amountArs.toNumber(),
      recipient,
    },
  };
}

/**
 * Mail opcional con el resumen de la factura (T8: "sin PDF por ahora").
 * Idempotente por diseño: sólo se llama una vez, inmediatamente después de
 * dejar la factura en `ISSUED`, y graba `emailedAt` — si algún día se agrega
 * un reenvío manual, ese código tiene que chequear `emailedAt` antes de
 * llamar de nuevo.
 */
async function intentarMailFactura(invoiceId: string): Promise<void> {
  if (!hasResendApiKey()) return;

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { payment: { include: { organizationLicense: true, user: true } } },
  });
  if (!invoice || invoice.status !== 'ISSUED' || invoice.emailedAt) return;

  const destinatario = invoice.payment.organizationLicense ? null : invoice.payment.user?.email;
  // Institucional: no hay un mail de "facturación" cargado en el modelo
  // todavía — por ahora el mail sólo sale para pagos individuales (el
  // owner/admin institucional ve la factura en /org/plan). Documentado como
  // alcance acotado de esta tarea (el PDF/mail "es opcional", design.md).
  if (!destinatario) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { emailedAt: new Date() } });
    return;
  }

  const formateador = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const monto = formateador.format(invoice.payment.amountArs.toNumber());
  const resumen = `Factura C N.º ${invoice.number} — CAE ${invoice.cae} (vence ${invoice.caeDueDate?.toLocaleDateString('es-AR')}). Monto: ${monto}.`;

  const resultado = await enviarEmail({
    to: destinatario,
    subject: `Kodu — tu factura N.º ${invoice.number}`,
    text: resumen,
    html: `<p>${resumen}</p>`,
  });

  if (resultado.ok) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { emailedAt: new Date() } });
  }
}

/** Alias con el nombre histórico del botón "Reintentar" de T7 — mismo
 *  endpoint (`/api/admin/billing/facturas/reintentar`), sin tocar la UI. */
export const reintentarFacturacion = intentarEmitirFactura;
