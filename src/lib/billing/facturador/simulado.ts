import { prisma } from '../../db.ts';
import {
  CONDICION_IVA_RECEPTOR_ID,
  MARCADOR_FORZAR_FALLO_SIMULADO,
  type FacturaInput,
  type Invoicer,
  type PingResultado,
  type ResultadoFactura,
} from './tipos.ts';

/**
 * odd/tasks/planes-y-cobros.md (T8): adaptador SIMULADO de `Invoicer` — local
 * y para los e2e, sin ningún certificado. CAE determinístico, numeración
 * creciente POR punto de venta (consulta el máximo `Invoice.number` ya usado
 * para ese `pointOfSale`, igual que ARCA haría con `FECompUltimoAutorizado`).
 *
 * Fallo forzado SOLO para pruebas: si `recipient.name` contiene
 * `MARCADOR_FORZAR_FALLO_SIMULADO`, devuelve `rejected` en vez de emitir —
 * así `e2e/planes-facturacion.ts` prueba FAILED + reintento sin ninguna
 * variable de entorno nueva. Nunca se activa por accidente: el marcador es un
 * string largo y arbitrario que ningún nombre real va a contener.
 */
export class FacturadorSimulado implements Invoicer {
  /** Siempre "OK": no hay nada remoto que chequear (T8c, `Invoicer.ping`). */
  async ping(): Promise<PingResultado> {
    return { ok: true, appServer: 'OK (simulado)', dbServer: 'OK (simulado)', authServer: 'OK (simulado)' };
  }

  async issueInvoiceC(input: FacturaInput): Promise<ResultadoFactura> {
    if (input.recipient.name.includes(MARCADOR_FORZAR_FALLO_SIMULADO)) {
      return { ok: false, error: { kind: 'rejected', message: 'Fallo forzado (prueba): CAE no otorgado.' } };
    }

    const ultimo = await prisma.invoice.aggregate({
      where: { pointOfSale: input.pointOfSale, status: 'ISSUED' },
      _max: { number: true },
    });
    const numero = (ultimo._max.number ?? 0) + 1;

    const condicionIvaReceptorId =
      input.recipient.kind === 'cuit' ? CONDICION_IVA_RECEPTOR_ID[input.recipient.ivaCondition] : CONDICION_IVA_RECEPTOR_ID.CONSUMIDOR_FINAL;

    // CAE determinístico pero sin colisiones: 14 dígitos como un CAE real,
    // derivados del punto de venta y el número (nunca al azar — un e2e tiene
    // que poder repetir la corrida y ver el mismo valor).
    const cae = `${String(input.pointOfSale).padStart(4, '0')}${String(numero).padStart(10, '0')}`;
    const caeDueDate = new Date(input.paymentDate.getTime() + 10 * 24 * 60 * 60 * 1000);

    return { ok: true, data: { pointOfSale: input.pointOfSale, number: numero, cae, caeDueDate, condicionIvaReceptorId } };
  }
}
