/**
 * T5 (odd/tasks/generacion-simple-y-reanudable.md): la parte PURA de "¿hace
 * falta correr el self-test/corrección/verificador del navegador para el
 * turno más nuevo que cambió el HTML de un proyecto?". Isomórfico a
 * propósito, como `versiones.ts`/`fingerprint.ts`: sin Prisma, sin `fetch`,
 * sin DOM — el servidor (`post-checks-db.ts`, para decidir si ofrece/acepta
 * un reclamo) y el cliente (`Workspace.tsx`, para decidir si intenta el
 * reclamo apenas carga la página) comparten la MISMA regla.
 */

/**
 * Un reclamo (`ChatMessage.postChecksClaimedAt`) más viejo que esto se
 * considera abandonado — una pestaña que reclamó y se cerró (o se colgó) a
 * mitad del pipeline. Cómodo por encima de lo que tarda de verdad el
 * pipeline completo (self-test + hasta 2 rondas de corrección + el
 * verificador, hasta 150 s por pasada) y bien por debajo del tope de 30
 * minutos de un turno entero (`stream.ts`) — otra pestaña puede tomar la
 * posta bastante antes de que ese tope importe.
 */
export const POST_CHECKS_CLAIM_STALE_MS = 5 * 60 * 1000;

export interface MensajeElegiblePostChequeos {
  /** `fingerprintHtml` del HTML que este turno dejó, capturado al
   *  generarlo (o refrescado al marcarlo) — `null` en cualquier fila vieja
   *  de antes de esta columna. */
  resultHtmlFingerprint: string | null;
  /** `null` = todavía no se marcó. Cualquier otro valor —una marca real, un
   *  "salteado a propósito" (turno de versiones), o el instante "legacy"
   *  del backfill de la migración— significa "no lo toques más". */
  postChecksAt: Date | null;
  /** `null` = nadie lo tiene reclamado ahora mismo. */
  postChecksClaimedAt: Date | null;
}

export type DecisionResumenPostChequeos =
  | { accion: 'correr' }
  | {
      accion: 'saltar';
      motivo: 'sin-turno' | 'ya-marcado' | 'huella-no-coincide' | 'reclamado-por-otra-pestana';
    };

/**
 * `null` en `mensaje` = no hay ningún turno candidato (proyecto sin
 * ninguna respuesta que haya cambiado el HTML, o la más nueva ya está
 * deshecha). `ahora` se inyecta (no `Date.now()` adentro) para que esto siga
 * siendo puro y testeable sin mockear el reloj — ver `e2e/unidad*.ts`.
 */
export function decidirResumenChequeosPosteriores(
  mensaje: MensajeElegiblePostChequeos | null,
  htmlActualFingerprint: string,
  ahora: number,
): DecisionResumenPostChequeos {
  if (!mensaje) return { accion: 'saltar', motivo: 'sin-turno' };

  // Cualquier marca (real, "legacy", o "salteado a propósito") es
  // definitiva: nunca se vuelve a intentar, sin importar la huella ni el
  // reclamo — por eso este chequeo va ANTES que los otros dos.
  if (mensaje.postChecksAt !== null) return { accion: 'saltar', motivo: 'ya-marcado' };

  // El HTML vigente ya no es el que dejó este turno (el docente lo tocó a
  // mano, u otro turno más nuevo lo reemplazó entre que se armó este
  // candidato y que se evalúa): probar algo que no es "el resultado de
  // este turno" no le sirve a nadie.
  if (mensaje.resultHtmlFingerprint !== htmlActualFingerprint) {
    return { accion: 'saltar', motivo: 'huella-no-coincide' };
  }

  if (mensaje.postChecksClaimedAt !== null) {
    const edadMs = ahora - mensaje.postChecksClaimedAt.getTime();
    if (edadMs < POST_CHECKS_CLAIM_STALE_MS) {
      return { accion: 'saltar', motivo: 'reclamado-por-otra-pestana' };
    }
    // Reclamo viejo: se trata como si nadie lo tuviera — cae al 'correr' de abajo.
  }

  return { accion: 'correr' };
}
