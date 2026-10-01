import { Prisma } from '../../generated/prisma/client.ts';
import type { Precios } from './usage.ts';

/**
 * odd/tasks/ahorro-tokens.md (T1): time-of-day pricing.
 *
 * DeepSeek (and possibly other providers later) bills a fraction of the peak
 * price outside its peak windows. Before this, `AiModel` prices were flat —
 * `calcularCostoTurno` always used the peak price, overstating real cost by
 * about 2x for an off-peak DeepSeek turn.
 *
 * A model with no `PriceSchedule` keeps exactly today's behavior: this
 * module is a no-op unless a schedule is set.
 */

/** One peak window, in UTC. `weekday` matches `Date.prototype.getUTCDay()`
 *  (0 = Sunday .. 6 = Saturday). `startHour` inclusive, `endHour` exclusive. */
export interface PeakWindow {
  weekday: number;
  startHour: number;
  endHour: number;
}

export interface PriceSchedule {
  /** Multiplies the three prices when the call falls off-peak. */
  offPeakFactor: Prisma.Decimal;
  /** Empty = never on-peak by weekday/hour (everything is off-peak). */
  peakWindows: PeakWindow[];
  /** Dates (UTC, "YYYY-MM-DD") forced off-peak regardless of hour/weekday. */
  offPeakDates: string[];
}

/** `at` is treated as a naive UTC instant — same convention `usage.ts` and
 *  the rest of this app use (`getUTCDate`, `setUTCHours`, ...). */
export function isOffPeak(schedule: PriceSchedule, at: Date): boolean {
  const date = at.toISOString().slice(0, 10);
  if (schedule.offPeakDates.includes(date)) return true;

  const weekday = at.getUTCDay();
  const hour = at.getUTCHours();
  const enPico = schedule.peakWindows.some(
    (window) => window.weekday === weekday && hour >= window.startHour && hour < window.endHour,
  );
  return !enPico;
}

/**
 * The price that actually applies to a call made `at` a given moment.
 * `schedule: null` (no schedule configured) returns `precios` unchanged —
 * the only way to preserve "no schedule = today's behavior" exactly.
 */
export function precioVigente(precios: Precios, schedule: PriceSchedule | null, at: Date): Precios {
  if (!schedule) return precios;
  if (!isOffPeak(schedule, at)) return precios;

  return {
    input: precios.input.mul(schedule.offPeakFactor),
    output: precios.output.mul(schedule.offPeakFactor),
    cachedInput: precios.cachedInput ? precios.cachedInput.mul(schedule.offPeakFactor) : null,
  };
}

/** Builds a `PriceSchedule` from the raw `AiModel` columns, or `null` when
 *  the model has none configured (`priceOffPeakFactor` is the on/off switch:
 *  the other two columns only matter once it is set). */
export function scheduleFromAiModel(fila: {
  priceOffPeakFactor: Prisma.Decimal | null;
  peakWindowsUtc: Prisma.JsonValue | null;
  offPeakDatesUtc: Prisma.JsonValue | null;
}): PriceSchedule | null {
  if (!fila.priceOffPeakFactor) return null;

  return {
    offPeakFactor: fila.priceOffPeakFactor,
    peakWindows: Array.isArray(fila.peakWindowsUtc) ? (fila.peakWindowsUtc as unknown as PeakWindow[]) : [],
    offPeakDates: Array.isArray(fila.offPeakDatesUtc) ? (fila.offPeakDatesUtc as unknown as string[]) : [],
  };
}
