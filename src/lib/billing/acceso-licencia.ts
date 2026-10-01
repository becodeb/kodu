/**
 * odd/tasks/planes-y-cobros.md (T1, usado por T3): si el estado actual de la
 * licencia de una organización permite generar con la IA. Módulo PURO — sin
 * Prisma, recibe sólo los campos que necesita (T3 los lee de
 * `OrganizationLicense`, siempre la de la organización RAÍZ, nunca la de una
 * sede — ver el comentario de `OrganizationLicense` en schema.prisma).
 *
 * | status          | permite generar                                    |
 * |-----------------|-----------------------------------------------------|
 * | TRIAL           | sí, mientras `now <= trialEndsAt`                    |
 * | ACTIVE          | siempre sí                                           |
 * | PAST_DUE        | sí, mientras `now <= graceEndsAt` (7 días de gracia) |
 * | MANUAL          | siempre sí (organizaciones preexistentes y altas a mano) |
 * | READ_ONLY       | no (sólo lectura: la prueba terminó sin pago)        |
 * | CANCELED        | no                                                   |
 * | PENDING_PAYMENT | no (T11: alta con la prueba APAGADA — nunca generó, nunca tuvo prueba) |
 *
 * Los bordes (`now === trialEndsAt`, `now === graceEndsAt`) cuentan como
 * PERMITIDO — "hasta" incluye el instante exacto del vencimiento; recién el
 * milisegundo siguiente corta el acceso. El paso de TRIAL/PAST_DUE a
 * READ_ONLY quien lo hace es un trabajo aparte (T3) que lee este mismo
 * resultado; esta función sólo contesta "en este instante, ¿se puede?".
 */

export type LicenseStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'READ_ONLY' | 'CANCELED' | 'MANUAL' | 'PENDING_PAYMENT';

export interface LicenciaParaAcceso {
  status: LicenseStatus;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
  /**
   * odd/tasks/planes-y-cobros.md (T4): sólo importa cuando `status ===
   * 'ACTIVE'` — si se pidió cancelar al fin del período (T4, endpoints de
   * cancelación) y ese período YA terminó, se trata como CANCELED (decisión
   * de diseño: "al fin del período la licencia se lee como CANCELED,
   * perezoso" — no hace falta un cron que la pase a CANCELED de verdad, esta
   * misma función lo resuelve en el instante). `undefined`/`false`/`null` =
   * comportamiento de siempre (T1/T3, sin tocar).
   */
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: Date | null;
}

export type RazonAcceso =
  | 'active'
  | 'manual'
  | 'trial_vigente'
  | 'trial_expirado'
  | 'trial_sin_fecha'
  | 'gracia_vigente'
  | 'gracia_expirada'
  | 'gracia_sin_fecha'
  | 'read_only'
  | 'canceled'
  | 'pending_payment';

export interface ResultadoAcceso {
  allowed: boolean;
  reason: RazonAcceso;
}

export function licenseAllowsAi(license: LicenciaParaAcceso, now: Date): ResultadoAcceso {
  switch (license.status) {
    case 'ACTIVE': {
      // T4: cancelación perezosa — ver el comentario de `cancelAtPeriodEnd`.
      if (license.cancelAtPeriodEnd && license.currentPeriodEnd && now.getTime() > license.currentPeriodEnd.getTime()) {
        return { allowed: false, reason: 'canceled' };
      }
      return { allowed: true, reason: 'active' };
    }

    case 'MANUAL':
      return { allowed: true, reason: 'manual' };

    case 'TRIAL': {
      if (!license.trialEndsAt) {
        // Defensivo: una licencia TRIAL sin fecha de fin es un dato
        // incompleto, nunca se trata como "sin límite".
        return { allowed: false, reason: 'trial_sin_fecha' };
      }
      const vigente = now.getTime() <= license.trialEndsAt.getTime();
      return { allowed: vigente, reason: vigente ? 'trial_vigente' : 'trial_expirado' };
    }

    case 'PAST_DUE': {
      if (!license.graceEndsAt) {
        return { allowed: false, reason: 'gracia_sin_fecha' };
      }
      const vigente = now.getTime() <= license.graceEndsAt.getTime();
      return { allowed: vigente, reason: vigente ? 'gracia_vigente' : 'gracia_expirada' };
    }

    case 'READ_ONLY':
      return { allowed: false, reason: 'read_only' };

    case 'CANCELED':
      return { allowed: false, reason: 'canceled' };

    case 'PENDING_PAYMENT':
      // T11: alta con la prueba institucional APAGADA — nunca tuvo prueba,
      // nunca generó; sólo contratar (ACTIVE) habilita la IA.
      return { allowed: false, reason: 'pending_payment' };
  }
}
