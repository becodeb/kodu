/**
 * odd/tasks/planes-y-cobros.md (T1): reglas de créditos de un docente
 * individual. Módulo PURO — sin Prisma; T2 hace las lecturas/escrituras
 * reales del libro (`CreditLedgerEntry`) usando estas funciones.
 *
 * Semántica elegida para "el otorgamiento mensual no se acumula" (decisión
 * del dueño: "50 por mes (no se acumulan)" en FREE, "1.000 créditos por mes"
 * en Individual — odd/tasks/ahorro-tokens.md T8 lo subió a 2.500/mes al
 * bajar `creditUsdValue`, misma cobertura de USD 2,50) — la RECOMENDADA en
 * el documento de la feature:
 *
 *   En cada mes calendario (hora de Argentina) nuevo, el saldo del
 *   otorgamiento mensual se REPONE a `monthlyCredits`, no se le suma otra
 *   vez. Concretamente (T2 lo implementa así): al primer uso del mes, si
 *   todavía no se otorgó el `MONTHLY_GRANT`/`PLAN_GRANT` de ESTE `periodKey`
 *   (ver `monthlyGrantPeriodKey`), se registra primero un movimiento
 *   `EXPIRY` que cancela lo que haya quedado sin usar del otorgamiento
 *   ANTERIOR (nunca negativo más allá de lo que quedaba), y recién después
 *   el `MONTHLY_GRANT`/`PLAN_GRANT` nuevo por `monthlyCredits`. Los
 *   créditos de BIENVENIDA (`WELCOME`) son la única excepción: se otorgan
 *   una sola vez al crear la cuenta y NUNCA expiran ni se tocan acá.
 *
 * El índice único `CreditLedgerEntry_userId_kind_periodKey_key` (T1, ver
 * schema.prisma) es lo que hace que otorgar dos veces el mismo mes sea un
 * no-op idempotente: un `periodKey` repetido para el mismo `userId`/`kind`
 * viola el único y la segunda escritura falla (T2 la atrapa y no hace nada).
 */

/** 1 crédito = este costo real en USD (`BillingSettings.creditUsdValue`,
 *  decisión de diseño: USD 0,001 por default desde T8 — era 0,0025 —,
 *  configurable). */
export function creditsForCost(costUsd: number, creditUsdValue: number): number {
  if (!(creditUsdValue > 0)) {
    throw new Error('creditUsdValue tiene que ser mayor a 0');
  }
  if (costUsd <= 0) return 0;

  // Redondeo hacia ARRIBA (nunca se le regala centavo de USD al docente:
  // cualquier fracción de crédito que sobre se cobra el crédito entero) y
  // mínimo 1 para cualquier uso con costo > 0 — decisión del dueño: un turno
  // gratis del motor (costo 0) no debe debitar créditos, pero un turno que
  // costó lo mínimo posible siempre debita al menos 1.
  return Math.max(1, Math.ceil(costUsd / creditUsdValue));
}

/** "YYYY-MM" del mes calendario en hora de Argentina (offset fijo -03:00,
 *  ver el comentario de zona horaria en ciclo.ts). Es la llave de
 *  idempotencia de un otorgamiento mensual. */
export function monthlyGrantPeriodKey(date: Date): string {
  const OFFSET_AR_MS = 3 * 60 * 60 * 1000;
  const desplazado = new Date(date.getTime() - OFFSET_AR_MS);
  const year = desplazado.getUTCFullYear();
  const month = desplazado.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Llave de idempotencia fija de la bienvenida: una sola fila `WELCOME` por
 *  usuario, para siempre — nunca un "YYYY-MM" (no es un otorgamiento mensual). */
export const WELCOME_PERIOD_KEY = 'once';

/**
 * "D/M" del 1º del PRÓXIMO mes calendario (hora de Argentina) — cuándo se
 * repone el otorgamiento mensual (T2, mensaje de "sin créditos" en la UI:
 * "Se renuevan el 1/11"). Reusa `monthlyGrantPeriodKey` como única fuente del
 * mes actual en vez de recalcularlo con Date directo.
 */
export function proximaRenovacionEtiqueta(now: Date): string {
  const [year, month] = monthlyGrantPeriodKey(now).split('-').map(Number);
  const mesSiguiente = month === 12 ? 1 : month + 1;
  return `1/${mesSiguiente}`;
}
