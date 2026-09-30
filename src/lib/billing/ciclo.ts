/**
 * odd/tasks/planes-y-cobros.md (T1): el ciclo lectivo y el prorrateo del
 * primer cobro institucional por ciclo. Módulo PURO — sin Prisma, sin fecha
 * de sistema (todo `Date` que entra viene de afuera, para que el llamador
 * decida qué es "ahora").
 *
 * TIMEZONE: todas las fechas de calendario ("qué día es hoy", "1 de marzo",
 * "fin de febrero") se calculan en hora de Argentina. Argentina usa un
 * offset FIJO de UTC-3 desde 2009 (sin horario de verano) — no hace falta
 * una librería de timezones para esto: se resta 3 horas al instante UTC y se
 * leen los campos de calendario del resultado con los getters UTC. Si
 * alguna vez Argentina reintroduce el horario de verano, este supuesto deja
 * de valer y hay que revisar este archivo entero.
 */

const OFFSET_AR_MS = 3 * 60 * 60 * 1000;

export interface FechaAr {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
}

/** Los campos de calendario (año/mes/día) de un instante, en hora de Argentina. */
export function fechaAr(instante: Date): FechaAr {
  const desplazado = new Date(instante.getTime() - OFFSET_AR_MS);
  return {
    year: desplazado.getUTCFullYear(),
    month: desplazado.getUTCMonth() + 1,
    day: desplazado.getUTCDate(),
  };
}

/** El instante UTC que corresponde a la medianoche de ese día en Argentina. */
export function medianocheAr(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) + OFFSET_AR_MS);
}

export function esBisiesto(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Días que tiene febrero de `year` (28 o 29). */
export function diasDeFebrero(year: number): number {
  return esBisiesto(year) ? 29 : 28;
}

/** Cantidad de días de calendario ARgentino entre dos medianoches AR,
 *  ambos extremos incluidos (p.ej. 1/3 a 2/3 = 2 días). */
function diasInclusive(desde: FechaAr, hasta: FechaAr): number {
  const desdeMs = Date.UTC(desde.year, desde.month - 1, desde.day);
  const hastaMs = Date.UTC(hasta.year, hasta.month - 1, hasta.day);
  return Math.round((hastaMs - desdeMs) / 86_400_000) + 1;
}

export interface Ciclo {
  /** Medianoche AR del 1 de marzo. */
  start: Date;
  /** El último instante del ciclo: 23:59:59.999 AR del último día de febrero
   *  siguiente (inclusive, no el "1 de marzo próximo" exclusivo). */
  end: Date;
  /** Año en que empieza el ciclo (el "1 de marzo de este año"). */
  startYear: number;
}

/** El ciclo lectivo (1 de marzo → último día de febrero) que arranca en `startYear`. */
export function cicloQueEmpiezaEn(startYear: number): Ciclo {
  const start = medianocheAr(startYear, 3, 1);
  const endYear = startYear + 1;
  const febDays = diasDeFebrero(endYear);
  // Último instante del último día de febrero: la medianoche del día
  // SIGUIENTE (1 de marzo del año que viene) menos 1 milisegundo.
  const end = new Date(medianocheAr(endYear, 3, 1).getTime() - 1);
  return { start, end, startYear };
}

/**
 * El ciclo lectivo VIGENTE en `date` (el que ya empezó y todavía no terminó).
 * Marzo–diciembre → el ciclo que empezó el 1/3 de este mismo año. Enero y
 * febrero → el ciclo que empezó el 1/3 del año ANTERIOR (todavía no llegó el
 * próximo 1 de marzo).
 */
export function cycleFor(date: Date): Ciclo {
  const { year, month } = fechaAr(date);
  const startYear = month >= 3 ? year : year - 1;
  return cicloQueEmpiezaEn(startYear);
}

export type IntervaloCobro = 'MONTHLY' | 'CYCLE';

export interface BandaParaCobro {
  monthlyPriceArs: number;
  cyclePriceArs: number;
}

export interface PrimerCobroInput {
  /** "Hoy", el día en que se contrata (instante, se lee en hora AR). */
  date: Date;
  interval: IntervaloCobro;
  banda: BandaParaCobro;
}

export interface PrimerCobroResultado {
  amountArs: number;
  /** Desde cuándo cubre este cobro (= `date`, el momento de contratar). */
  periodStart: Date;
  /** Hasta cuándo cubre este cobro. */
  periodEnd: Date;
  /** Cuándo se cobra a precio lleno la próxima vez. `null` para MONTHLY
   *  (T4 arma la renovación mensual con el mismo período que ya cubrió). */
  nextRenewalAt: Date | null;
  /** Explica de dónde salió el número, para logs y para el e2e. */
  note: string;
}

/**
 * El primer cobro al contratar una licencia institucional (decisiones del
 * dueño, "Alta a mitad de año").
 *
 * MONTHLY: precio mensual completo, cubre un mes calendario desde `date`.
 *
 * CYCLE, contratado de marzo a agosto (dentro del ciclo ya arrancado): se
 * paga la parte proporcional del precio del ciclo por los días que quedan
 * hasta fin de febrero — `cyclePriceArs × díasRestantes / díasDelCiclo`,
 * REDONDEADO a pesos enteros con "redondeo comercial" (`Math.round`: 0,5 para
 * arriba). El período cubierto llega hasta fin del ciclo actual; la próxima
 * renovación es el 1 de marzo que sigue, a precio de ciclo completo.
 *
 * CYCLE, contratado de septiembre a diciembre: se cobra el ciclo SIGUIENTE
 * completo (lo que queda de este año es regalo). El período cubierto va de
 * hoy hasta el fin de ese ciclo siguiente.
 *
 * CYCLE, contratado en enero o febrero: se cobra el ciclo completo que
 * arranca el 1 de marzo que sigue (los días de enero/febrero que quedan
 * también son regalo). El período cubierto va de hoy hasta el fin de ese
 * ciclo.
 */
export function firstCharge(input: PrimerCobroInput): PrimerCobroResultado {
  const { date, interval, banda } = input;

  if (interval === 'MONTHLY') {
    const { year, month, day } = fechaAr(date);
    // Un mes calendario después, mismo día — `Date.UTC` normaliza el
    // desborde de mes (p.ej. 31/1 + 1 mes → 3/3, no un 31 de febrero
    // inexistente; es el mismo comportamiento que ya usa el resto del repo
    // con Date, no una regla nueva).
    const periodEnd = medianocheAr(year, month + 1, day);
    return {
      amountArs: banda.monthlyPriceArs,
      periodStart: date,
      periodEnd,
      nextRenewalAt: periodEnd,
      note: 'mensual: precio completo, un mes desde hoy',
    };
  }

  const { year, month } = fechaAr(date);

  if (month >= 3 && month <= 8) {
    const ciclo = cicloQueEmpiezaEn(year);
    const hoyAr = fechaAr(date);
    const finAr = fechaAr(ciclo.end);
    const diasRestantes = diasInclusive(hoyAr, finAr);
    const diasDelCiclo = diasInclusive(fechaAr(ciclo.start), finAr);
    const amountArs = Math.round((banda.cyclePriceArs * diasRestantes) / diasDelCiclo);
    return {
      amountArs,
      periodStart: date,
      periodEnd: ciclo.end,
      nextRenewalAt: new Date(ciclo.end.getTime() + 1),
      note: `ciclo, prorrateado: ${diasRestantes}/${diasDelCiclo} días del ciclo ${ciclo.startYear}`,
    };
  }

  if (month >= 9 && month <= 12) {
    const proximo = cicloQueEmpiezaEn(year + 1);
    return {
      amountArs: banda.cyclePriceArs,
      periodStart: date,
      periodEnd: proximo.end,
      nextRenewalAt: new Date(proximo.end.getTime() + 1),
      note: `ciclo, contratado en septiembre-diciembre: se cobra el ciclo ${proximo.startYear} completo, resto de este año de regalo`,
    };
  }

  // month es 1 o 2 (enero/febrero).
  const proximo = cicloQueEmpiezaEn(year);
  return {
    amountArs: banda.cyclePriceArs,
    periodStart: date,
    periodEnd: proximo.end,
    nextRenewalAt: new Date(proximo.end.getTime() + 1),
    note: `ciclo, contratado en enero-febrero: se cobra el ciclo ${proximo.startYear} completo, días que quedan de regalo`,
  };
}
