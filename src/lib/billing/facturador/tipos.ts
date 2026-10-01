/**
 * odd/tasks/planes-y-cobros.md (T8): puerto de facturación. `Invoicer` es la
 * única interfaz que el resto del código conoce (`src/lib/billing/aplicar.ts`
 * y `src/lib/billing/facturacion-superadmin.ts`) — quién la implementa
 * (`simulado.ts` o `arca.ts`) se elige por env (`INVOICE_PROVIDER`, ver
 * `src/lib/billing/facturador/index.ts`), igual que `PaymentGateway` en T4.
 *
 * Factura C únicamente (el dueño es monotributista — decisión del dueño, ver
 * odd/tasks/planes-y-cobros.md). Hechos de ARCA/WSFEv1 confirmados en el
 * informe de T8 (ver el reporte del escritor): Concepto 2 = servicios, exige
 * `FchServDesde`/`FchServHasta`/`FchVtoPago`; para Factura C `ImpTotal =
 * ImpNeto`, `ImpIVA = 0`; `CondicionIVAReceptorId` es obligatorio desde la RG
 * 5616 (1 = Responsable Inscripto, 4 = Exento, 5 = Consumidor Final, 6 =
 * Monotributo).
 */

export type CondicionIva = 'RESPONSABLE_INSCRIPTO' | 'EXENTO' | 'MONOTRIBUTO' | 'CONSUMIDOR_FINAL';

/** `CondicionIVAReceptorId` de WSFEv1 — confirmado por búsqueda (no hay URL
 *  oficial que haya respondido con el listado completo en esta sesión; ver el
 *  informe de T8 para las fuentes). */
export const CONDICION_IVA_RECEPTOR_ID: Record<CondicionIva, number> = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTO: 6,
};

export type DestinatarioFactura =
  | {
      /** Pago institucional: CUIT con razón social y condición frente al IVA
       *  cargadas en `OrganizationLicense` (obligatorias para contratar,
       *  T8). DocTipo 80. */
      kind: 'cuit';
      docNumber: string;
      name: string;
      ivaCondition: CondicionIva;
    }
  | {
      /** Pago individual: consumidor final, DocTipo 99 / DocNro 0 — salvo
       *  que supere el umbral de identificación obligatoria (ver el gap
       *  documentado en el informe de T8: no se pudo confirmar el monto
       *  vigente de ese umbral desde una fuente primaria en esta sesión). */
      kind: 'consumidor_final';
      name: string;
    };

export interface FacturaInput {
  pointOfSale: number;
  /** Período de servicio cubierto por el pago (Concepto 2 siempre, Kodu es
   *  un servicio): `Payment.periodStart`/`periodEnd`. */
  periodStart: Date;
  periodEnd: Date;
  /** `FchVtoPago` — fecha del pago. */
  paymentDate: Date;
  amountArs: number;
  recipient: DestinatarioFactura;
  /**
   * SOLO el adaptador simulado lo mira (dev-only, nunca en producción): si el
   * nombre del destinatario contiene este marcador, `simulado.ts` devuelve un
   * error en vez de emitir — así `e2e/planes-facturacion.ts` puede probar el
   * camino de FAILED/reintento sin tocar variables de entorno nuevas.
   */
}

/** Marcador de prueba (ver el comentario de `FacturaInput.recipient` más
 *  arriba) — exportado para que el e2e lo use sin inventar el string. */
export const MARCADOR_FORZAR_FALLO_SIMULADO = '__FORZAR_FALLO_FACTURACION__';

export interface FacturaEmitida {
  pointOfSale: number;
  number: number;
  cae: string;
  caeDueDate: Date;
  condicionIvaReceptorId: number;
}

export type FacturaError =
  | { kind: 'config'; message: string }
  | { kind: 'rejected'; message: string; observaciones?: string[] }
  | { kind: 'network'; message: string };

export type ResultadoFactura = { ok: true; data: FacturaEmitida } | { ok: false; error: FacturaError };

export interface Invoicer {
  issueInvoiceC(input: FacturaInput): Promise<ResultadoFactura>;
}
