import { prisma } from '../db.ts';
import type { ResultadoAccion } from './aplicar.ts';

/**
 * odd/tasks/planes-y-cobros.md (T7, punto 4): el botón "Reintentar" de
 * `/admin/facturacion` — STUB a propósito: T8 todavía no implementó el
 * puerto `Invoicer` (adaptador ARCA WSFE real). Esta función es el gancho
 * donde T8 va a enchufar el reintento de verdad (quedó "claramente cableado"
 * como pide la tarea: la UI ya llama a este endpoint, el endpoint ya
 * registra el intento) — cuando T8 exista, sólo hace falta reemplazar el
 * cuerpo de esta función por una llamada al adaptador, sin tocar la UI ni el
 * endpoint.
 */
export async function reintentarFacturacion(invoiceId: string): Promise<ResultadoAccion<{ status: string }>> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { ok: false, status: 404, message: 'No encontramos esa factura.' };
  if (invoice.status === 'ISSUED') return { ok: false, status: 409, message: 'Esta factura ya está emitida.' };

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      attempts: { increment: 1 },
      lastError: 'Reintento manual: todavía no hay un adaptador de facturación real conectado (T8, ARCA WSFE pendiente).',
    },
  });
  return { ok: true, data: { status: invoice.status } };
}
