import assert from 'node:assert/strict';
import { bandForStudents, HABLEMOS_THRESHOLD_DEFAULT, LIMITES_DE_BANDA } from '../src/lib/billing/bandas.ts';
import {
  cicloQueEmpiezaEn,
  cycleFor,
  diasDeFebrero,
  esBisiesto,
  fechaAr,
  firstCharge,
  medianocheAr,
  renewalChargeIndividualAnnual,
  renewalChargeOrgCycle,
} from '../src/lib/billing/ciclo.ts';
import { creditsForCost, monthlyGrantPeriodKey, WELCOME_PERIOD_KEY } from '../src/lib/billing/creditos.ts';
import { isPublicEmailDomain, normalizarDominio } from '../src/lib/billing/dominios.ts';
import { licenseAllowsAi, type LicenciaParaAcceso } from '../src/lib/billing/acceso-licencia.ts';

/**
 * odd/tasks/planes-y-cobros.md (T1): pruebas unitarias de `src/lib/billing/`
 * (módulos puros, sin base de datos ni servidor). El dueño pidió que las
 * reglas de bandas/ciclo/créditos "no puedan fallar": esta suite es
 * exhaustiva en los bordes a propósito, con el mismo patrón que
 * `e2e/unidad-taller.ts`.
 *
 * Ejecutar con: npx tsx e2e/unidad-planes.ts
 */

let fallas = 0;

async function prueba(nombre: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✔ ${nombre}`);
  } catch (error) {
    fallas++;
    console.error(`✖ ${nombre}`);
    console.error(`  ${(error as Error).message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// bandas.ts
// ─────────────────────────────────────────────────────────────

await prueba('bandForStudents: los límites fijos son los que decidió el dueño', () => {
  assert.deepEqual(LIMITES_DE_BANDA.PEQUENA, { minStudents: 1, maxStudents: 300 });
  assert.deepEqual(LIMITES_DE_BANDA.MEDIANA, { minStudents: 301, maxStudents: 800 });
  assert.deepEqual(LIMITES_DE_BANDA.GRANDE, { minStudents: 801, maxStudents: 1500 });
  assert.equal(HABLEMOS_THRESHOLD_DEFAULT, 1500);
});

await prueba('bandForStudents: n <= 0 o fraccionario es inválido', () => {
  for (const n of [0, -1, -300, 1.5, 300.5, NaN]) {
    const r = bandForStudents(n);
    assert.equal(r.kind, 'invalid', `n=${n} tendría que ser inválido`);
  }
});

await prueba('bandForStudents: n = 1, el piso de Pequeña', () => {
  const r = bandForStudents(1);
  assert.deepEqual(r, { kind: 'band', key: 'PEQUENA' });
});

await prueba('bandForStudents: el borde 300/301 (Pequeña/Mediana)', () => {
  assert.deepEqual(bandForStudents(300), { kind: 'band', key: 'PEQUENA' });
  assert.deepEqual(bandForStudents(301), { kind: 'band', key: 'MEDIANA' });
});

await prueba('bandForStudents: el borde 800/801 (Mediana/Grande)', () => {
  assert.deepEqual(bandForStudents(800), { kind: 'band', key: 'MEDIANA' });
  assert.deepEqual(bandForStudents(801), { kind: 'band', key: 'GRANDE' });
});

await prueba('bandForStudents: el borde 1500/1501 (Grande/Hablemos)', () => {
  assert.deepEqual(bandForStudents(1500), { kind: 'band', key: 'GRANDE' });
  assert.deepEqual(bandForStudents(1501), { kind: 'hablemos' });
});

await prueba('bandForStudents: muy por encima también es Hablemos', () => {
  assert.deepEqual(bandForStudents(50_000), { kind: 'hablemos' });
});

await prueba('bandForStudents: un umbral "Hablemos" configurado más bajo lo respeta', () => {
  // Si el superadmin baja el umbral de "Hablemos" por debajo de 1.500 (T7,
  // BillingSettings.hablemosThresholdStudents), un n que técnicamente
  // calzaría en Grande tiene que pasar a "Hablemos" igual.
  assert.deepEqual(bandForStudents(900, 850), { kind: 'hablemos' });
  assert.deepEqual(bandForStudents(850, 850), { kind: 'band', key: 'GRANDE' });
});

// ─────────────────────────────────────────────────────────────
// ciclo.ts — zona horaria y calendario
// ─────────────────────────────────────────────────────────────

await prueba('fechaAr: 23:30 UTC del 28/2 es 20:30 AR del mismo día (sin cruzar medianoche)', () => {
  const instante = new Date('2027-02-28T23:30:00.000Z');
  assert.deepEqual(fechaAr(instante), { year: 2027, month: 2, day: 28 });
});

await prueba('fechaAr: 02:30 UTC del 1/3 ya es 28/2 AR (offset -03:00 corre el día hacia atrás)', () => {
  const instante = new Date('2027-03-01T02:30:00.000Z');
  assert.deepEqual(fechaAr(instante), { year: 2027, month: 2, day: 28 });
});

await prueba('medianocheAr: ida y vuelta con fechaAr', () => {
  const m = medianocheAr(2027, 3, 1);
  assert.deepEqual(fechaAr(m), { year: 2027, month: 3, day: 1 });
  // Es exactamente las 03:00 UTC (medianoche AR = UTC + 3h).
  assert.equal(m.toISOString(), '2027-03-01T03:00:00.000Z');
});

await prueba('esBisiesto / diasDeFebrero: los cuatro casos de la regla gregoriana', () => {
  assert.equal(esBisiesto(2024), true); // divisible por 4, no por 100
  assert.equal(esBisiesto(2027), false); // no divisible por 4
  assert.equal(esBisiesto(1900), false); // divisible por 100, no por 400
  assert.equal(esBisiesto(2000), true); // divisible por 400
  assert.equal(diasDeFebrero(2024), 29);
  assert.equal(diasDeFebrero(2027), 28);
  assert.equal(diasDeFebrero(1900), 28);
  assert.equal(diasDeFebrero(2000), 29);
});

await prueba('cicloQueEmpiezaEn: arranca el 1/3 AR y termina el último instante de febrero siguiente', () => {
  const ciclo = cicloQueEmpiezaEn(2026); // termina en feb 2027, no bisiesto
  assert.deepEqual(fechaAr(ciclo.start), { year: 2026, month: 3, day: 1 });
  assert.deepEqual(fechaAr(ciclo.end), { year: 2027, month: 2, day: 28 });
  // El instante siguiente ya es el 1 de marzo del año que viene.
  assert.deepEqual(fechaAr(new Date(ciclo.end.getTime() + 1)), { year: 2027, month: 3, day: 1 });
});

await prueba('cicloQueEmpiezaEn: un ciclo que termina en un febrero bisiesto (2027→2028)', () => {
  const ciclo = cicloQueEmpiezaEn(2027);
  assert.deepEqual(fechaAr(ciclo.end), { year: 2028, month: 2, day: 29 });
});

await prueba('cycleFor: marzo a diciembre resuelve al ciclo que empezó este mismo año', () => {
  for (const [mes, dia] of [[3, 1], [3, 2], [8, 31], [9, 1], [12, 31]] as const) {
    const ciclo = cycleFor(medianocheAr(2026, mes, dia));
    assert.equal(ciclo.startYear, 2026, `mes=${mes} día=${dia}`);
  }
});

await prueba('cycleFor: enero y febrero resuelven al ciclo que empezó el año anterior', () => {
  for (const [mes, dia] of [[1, 1], [1, 15], [2, 1], [2, 28]] as const) {
    const ciclo = cycleFor(medianocheAr(2027, mes, dia));
    assert.equal(ciclo.startYear, 2026, `mes=${mes} día=${dia}`);
  }
  // 29/2 en un año bisiesto.
  assert.equal(cycleFor(medianocheAr(2028, 2, 29)).startYear, 2027);
});

// ─────────────────────────────────────────────────────────────
// ciclo.ts — firstCharge
// ─────────────────────────────────────────────────────────────

const BANDA_PRUEBA = { monthlyPriceArs: 90_000, cyclePriceArs: 900_000 };

await prueba('firstCharge MONTHLY: precio mensual completo, período de un mes exacto', () => {
  const r = firstCharge({ date: medianocheAr(2026, 5, 10), interval: 'MONTHLY', banda: BANDA_PRUEBA });
  assert.equal(r.amountArs, 90_000);
  assert.deepEqual(fechaAr(r.periodEnd), { year: 2026, month: 6, day: 10 });
  assert.equal(r.nextRenewalAt?.getTime(), r.periodEnd.getTime());
});

await prueba('firstCharge MONTHLY: el desborde de mes (31 de enero) no rompe (cae en marzo, mismo criterio que Date)', () => {
  const r = firstCharge({ date: medianocheAr(2026, 1, 31), interval: 'MONTHLY', banda: BANDA_PRUEBA });
  // 31 de enero + 1 mes: JS normaliza al no existir el 31 de febrero.
  const { month, day } = fechaAr(r.periodEnd);
  assert.ok(month === 3, `esperaba que desborde a marzo, dio mes=${month} día=${day}`);
});

await prueba('firstCharge CYCLE: contratado el 1 de marzo (día 1 del ciclo) cobra el ciclo COMPLETO', () => {
  const r = firstCharge({ date: medianocheAr(2026, 3, 1), interval: 'CYCLE', banda: BANDA_PRUEBA });
  assert.equal(r.amountArs, 900_000, 'el primer día del ciclo, el prorrateo da el 100%');
  assert.deepEqual(fechaAr(r.periodEnd), { year: 2027, month: 2, day: 28 });
});

/** Días de calendario entre dos fechas AR (ambos extremos incluidos), para
 *  calcular a mano el resultado esperado sin llamar a la implementación
 *  interna — usa `Date.UTC` sobre los campos de calendario, NUNCA la resta
 *  de instantes de `ciclo.end` (que es 23:59:59.999 del último día, no la
 *  medianoche: restar sus milisegundos crudos suma un día de más). */
function diasEntre(desde: { year: number; month: number; day: number }, hasta: { year: number; month: number; day: number }): number {
  const desdeMs = Date.UTC(desde.year, desde.month - 1, desde.day);
  const hastaMs = Date.UTC(hasta.year, hasta.month - 1, hasta.day);
  return Math.round((hastaMs - desdeMs) / 86_400_000) + 1;
}

await prueba('firstCharge CYCLE: contratado el 31 de agosto (último día del bloque marzo-agosto), sigue prorrateado', () => {
  const r = firstCharge({ date: medianocheAr(2026, 8, 31), interval: 'CYCLE', banda: BANDA_PRUEBA });
  // Quedan del 31/8 al 28/2 inclusive: sep(30)+oct(31)+nov(30)+dic(31)+ene(31)+feb(28)+31ago(1) = 182 días,
  // sobre un ciclo 2026 (no bisiesto en el feb de cierre) de 365 días.
  const diasRestantesEsperados = 182;
  const diasDelCiclo = diasEntre({ year: 2026, month: 3, day: 1 }, { year: 2027, month: 2, day: 28 });
  assert.equal(diasDelCiclo, 365, 'el ciclo 2026 (cierra en feb 2027, no bisiesto) tiene 365 días');
  const esperado = Math.round((BANDA_PRUEBA.cyclePriceArs * diasRestantesEsperados) / diasDelCiclo);
  assert.equal(r.amountArs, esperado);
  assert.ok(r.amountArs > 0 && r.amountArs < BANDA_PRUEBA.cyclePriceArs, 'tiene que ser una fracción del precio completo');
  assert.deepEqual(fechaAr(r.periodEnd), { year: 2027, month: 2, day: 28 });
});

await prueba('firstCharge CYCLE: contratado el 1 de septiembre cobra el ciclo SIGUIENTE completo, resto del año de regalo', () => {
  const r = firstCharge({ date: medianocheAr(2026, 9, 1), interval: 'CYCLE', banda: BANDA_PRUEBA });
  assert.equal(r.amountArs, 900_000, 'precio de ciclo completo, sin prorratear');
  // El período cubierto va de hoy (1/9/2026) al fin del ciclo que arranca en marzo 2027.
  assert.deepEqual(fechaAr(r.periodStart), { year: 2026, month: 9, day: 1 });
  assert.deepEqual(fechaAr(r.periodEnd), { year: 2028, month: 2, day: 29 }); // 2028 es bisiesto
});

await prueba('firstCharge CYCLE: contratado el 31 de diciembre (último día del bloque sep-dic)', () => {
  const r = firstCharge({ date: medianocheAr(2026, 12, 31), interval: 'CYCLE', banda: BANDA_PRUEBA });
  assert.equal(r.amountArs, 900_000);
  assert.deepEqual(fechaAr(r.periodEnd), { year: 2028, month: 2, day: 29 });
});

await prueba('firstCharge CYCLE: contratado el 15 de enero cobra el ciclo que arranca el 1° de marzo de ESE año', () => {
  const r = firstCharge({ date: medianocheAr(2027, 1, 15), interval: 'CYCLE', banda: BANDA_PRUEBA });
  assert.equal(r.amountArs, 900_000, 'precio de ciclo completo, sin prorratear');
  assert.deepEqual(fechaAr(r.periodStart), { year: 2027, month: 1, day: 15 });
  // El ciclo que arranca en marzo de 2027 termina en febrero de 2028 (bisiesto).
  assert.deepEqual(fechaAr(r.periodEnd), { year: 2028, month: 2, day: 29 });
});

await prueba('firstCharge CYCLE: contratado el 28 de febrero (no bisiesto), último día antes del 1° de marzo', () => {
  const r = firstCharge({ date: medianocheAr(2027, 2, 28), interval: 'CYCLE', banda: BANDA_PRUEBA });
  assert.equal(r.amountArs, 900_000);
  assert.deepEqual(fechaAr(r.periodEnd), { year: 2028, month: 2, day: 29 });
});

await prueba('firstCharge CYCLE: contratado el 29 de febrero de un año bisiesto', () => {
  const r = firstCharge({ date: medianocheAr(2028, 2, 29), interval: 'CYCLE', banda: BANDA_PRUEBA });
  assert.equal(r.amountArs, 900_000);
  // El ciclo que arranca en marzo de 2028 termina en febrero de 2029 (no bisiesto).
  assert.deepEqual(fechaAr(r.periodEnd), { year: 2029, month: 2, day: 28 });
});

await prueba('firstCharge CYCLE: el redondeo del prorrateo es a pesos enteros (mitad para arriba)', () => {
  // Un precio de ciclo que no divide entero por los días, para forzar un
  // redondeo real. Contratado el 1° de marzo con días restantes = días del
  // ciclo → 100% siempre da entero; se prueba con un día intermedio.
  const banda = { monthlyPriceArs: 10_000, cyclePriceArs: 100_003 }; // no múltiplo de días
  const r = firstCharge({ date: medianocheAr(2026, 3, 2), interval: 'CYCLE', banda });
  const diasDelCiclo = diasEntre({ year: 2026, month: 3, day: 1 }, { year: 2027, month: 2, day: 28 });
  const diasRestantes = diasDelCiclo - 1; // un día menos que el ciclo completo (empieza el 2/3, no el 1/3)
  const esperado = Math.round((banda.cyclePriceArs * diasRestantes) / diasDelCiclo);
  assert.equal(r.amountArs, esperado);
  assert.equal(Number.isInteger(r.amountArs), true, 'nunca se cobran centavos de peso en el prorrateo');
});

// ─────────────────────────────────────────────────────────────
// creditos.ts
// ─────────────────────────────────────────────────────────────

await prueba('creditsForCost: costo 0 da 0 créditos (turno gratis no debita)', () => {
  assert.equal(creditsForCost(0, 0.0025), 0);
});

await prueba('creditsForCost: cualquier costo > 0 debita al menos 1 crédito', () => {
  assert.equal(creditsForCost(0.0000001, 0.0025), 1);
  assert.equal(creditsForCost(0.001, 0.0025), 1);
});

await prueba('creditsForCost: redondea hacia ARRIBA, no al más cercano', () => {
  // 0.0025 * 2 = 0.005; un costo de 0.0051 son "2 créditos y un poquito" → 3.
  assert.equal(creditsForCost(0.0051, 0.0025), 3);
  // Exactamente 2 créditos, sin resto: da 2, no 3.
  assert.equal(creditsForCost(0.005, 0.0025), 2);
});

await prueba('creditsForCost: costo negativo se trata como 0 (defensivo)', () => {
  assert.equal(creditsForCost(-1, 0.0025), 0);
});

await prueba('creditsForCost: creditUsdValue inválido revienta explícito, no calcula cualquier cosa', () => {
  assert.throws(() => creditsForCost(1, 0));
  assert.throws(() => creditsForCost(1, -0.0025));
});

await prueba('monthlyGrantPeriodKey: "YYYY-MM" en hora de Argentina, con el corte de medianoche AR', () => {
  assert.equal(monthlyGrantPeriodKey(medianocheAr(2027, 3, 1)), '2027-03');
  // 02:30 UTC del 1/3 es 28/2 en AR: todavía tiene que dar el mes anterior.
  assert.equal(monthlyGrantPeriodKey(new Date('2027-03-01T02:30:00.000Z')), '2027-02');
  assert.equal(monthlyGrantPeriodKey(medianocheAr(2027, 1, 5)), '2027-01');
});

await prueba('WELCOME_PERIOD_KEY: llave fija, nunca un "YYYY-MM"', () => {
  assert.equal(WELCOME_PERIOD_KEY, 'once');
  assert.doesNotMatch(WELCOME_PERIOD_KEY, /^\d{4}-\d{2}$/);
});

// ─────────────────────────────────────────────────────────────
// dominios.ts
// ─────────────────────────────────────────────────────────────

await prueba('normalizarDominio: minúsculas, sin "@", sin espacios', () => {
  assert.equal(normalizarDominio('  Gmail.COM '), 'gmail.com');
  assert.equal(normalizarDominio('profe@Colegio.EDU.AR'), 'colegio.edu.ar');
});

await prueba('isPublicEmailDomain: los webmails masivos y los ISP argentinos pedidos quedan rechazados', () => {
  for (const dominio of [
    'gmail.com',
    'googlemail.com',
    'hotmail.com',
    'hotmail.com.ar',
    'outlook.com',
    'outlook.com.ar',
    'live.com',
    'msn.com',
    'yahoo.com',
    'yahoo.com.ar',
    'icloud.com',
    'me.com',
    'aol.com',
    'protonmail.com',
    'proton.me',
    'gmx.com',
    'yandex.com',
    'zoho.com',
    'mail.com',
    'fibertel.com.ar',
    'arnet.com.ar',
    'speedy.com.ar',
  ]) {
    assert.equal(isPublicEmailDomain(dominio), true, `${dominio} tiene que ser público`);
  }
});

await prueba('isPublicEmailDomain: acepta con "@" adelante y mayúsculas, normaliza antes de comparar', () => {
  assert.equal(isPublicEmailDomain('docente@GMAIL.com'), true);
});

await prueba('isPublicEmailDomain: un dominio institucional real no es público', () => {
  for (const dominio of ['colegio.edu.ar', 'rededucativa.edu.ar', 'institutosanmartin.com.ar']) {
    assert.equal(isPublicEmailDomain(dominio), false, `${dominio} no tendría que ser público`);
  }
});

// ─────────────────────────────────────────────────────────────
// acceso-licencia.ts
// ─────────────────────────────────────────────────────────────

const AHORA = medianocheAr(2027, 6, 15);

function licenciaDePrueba(overrides: Partial<LicenciaParaAcceso>): LicenciaParaAcceso {
  return { status: 'ACTIVE', trialEndsAt: null, graceEndsAt: null, ...overrides };
}

await prueba('licenseAllowsAi: ACTIVE siempre permite', () => {
  assert.deepEqual(licenseAllowsAi(licenciaDePrueba({ status: 'ACTIVE' }), AHORA), {
    allowed: true,
    reason: 'active',
  });
});

await prueba('licenseAllowsAi: MANUAL siempre permite (organizaciones preexistentes)', () => {
  assert.deepEqual(licenseAllowsAi(licenciaDePrueba({ status: 'MANUAL' }), AHORA), {
    allowed: true,
    reason: 'manual',
  });
});

await prueba('licenseAllowsAi: READ_ONLY y CANCELED nunca permiten', () => {
  assert.equal(licenseAllowsAi(licenciaDePrueba({ status: 'READ_ONLY' }), AHORA).allowed, false);
  assert.equal(licenseAllowsAi(licenciaDePrueba({ status: 'CANCELED' }), AHORA).allowed, false);
});

await prueba('licenseAllowsAi: PENDING_PAYMENT (T11, prueba institucional apagada) nunca permite, razón pending_payment', () => {
  assert.deepEqual(licenseAllowsAi(licenciaDePrueba({ status: 'PENDING_PAYMENT', trialEndsAt: null }), AHORA), {
    allowed: false,
    reason: 'pending_payment',
  });
});

await prueba('licenseAllowsAi: TRIAL permite exactamente hasta trialEndsAt, inclusive', () => {
  const trialEndsAt = medianocheAr(2027, 6, 15);
  const justoAntes = new Date(trialEndsAt.getTime() - 1);
  const justoDespues = new Date(trialEndsAt.getTime() + 1);

  assert.deepEqual(licenseAllowsAi(licenciaDePrueba({ status: 'TRIAL', trialEndsAt }), trialEndsAt), {
    allowed: true,
    reason: 'trial_vigente',
  });
  assert.equal(licenseAllowsAi(licenciaDePrueba({ status: 'TRIAL', trialEndsAt }), justoAntes).allowed, true);
  assert.deepEqual(licenseAllowsAi(licenciaDePrueba({ status: 'TRIAL', trialEndsAt }), justoDespues), {
    allowed: false,
    reason: 'trial_expirado',
  });
});

await prueba('licenseAllowsAi: TRIAL sin trialEndsAt cargado nunca se trata como "sin límite"', () => {
  assert.deepEqual(licenseAllowsAi(licenciaDePrueba({ status: 'TRIAL', trialEndsAt: null }), AHORA), {
    allowed: false,
    reason: 'trial_sin_fecha',
  });
});

await prueba('licenseAllowsAi: PAST_DUE permite exactamente hasta graceEndsAt, inclusive (7 días de gracia)', () => {
  const graceEndsAt = medianocheAr(2027, 6, 22); // 7 días después de un vencimiento hipotético
  const justoAntes = new Date(graceEndsAt.getTime() - 1);
  const justoDespues = new Date(graceEndsAt.getTime() + 1);

  assert.deepEqual(licenseAllowsAi(licenciaDePrueba({ status: 'PAST_DUE', graceEndsAt }), graceEndsAt), {
    allowed: true,
    reason: 'gracia_vigente',
  });
  assert.equal(licenseAllowsAi(licenciaDePrueba({ status: 'PAST_DUE', graceEndsAt }), justoAntes).allowed, true);
  assert.deepEqual(licenseAllowsAi(licenciaDePrueba({ status: 'PAST_DUE', graceEndsAt }), justoDespues), {
    allowed: false,
    reason: 'gracia_expirada',
  });
});

await prueba('licenseAllowsAi: PAST_DUE sin graceEndsAt cargado nunca se trata como "sin límite"', () => {
  assert.deepEqual(licenseAllowsAi(licenciaDePrueba({ status: 'PAST_DUE', graceEndsAt: null }), AHORA), {
    allowed: false,
    reason: 'gracia_sin_fecha',
  });
});

// ─────────────────────────────────────────────────────────────
// ciclo.ts — renovación (T4b)
// ─────────────────────────────────────────────────────────────

await prueba('renewalChargeOrgCycle: cobra el precio de ciclo completo, nunca prorrateado', () => {
  const finDelCicloActual = cicloQueEmpiezaEn(2026).end; // fin de febrero 2027
  const resultado = renewalChargeOrgCycle({ currentPeriodEnd: finDelCicloActual, cyclePriceArs: 100_000 });
  assert.equal(resultado.amountArs, 100_000);
});

await prueba('renewalChargeOrgCycle: el período nuevo arranca exactamente donde terminó el anterior (sin solapar ni regalar días)', () => {
  const finDelCicloActual = cicloQueEmpiezaEn(2026).end;
  const resultado = renewalChargeOrgCycle({ currentPeriodEnd: finDelCicloActual, cyclePriceArs: 100_000 });
  assert.equal(resultado.periodStart.getTime(), finDelCicloActual.getTime() + 1);
  // El ciclo 2027 (1/3/2027 → fin de febrero 2028).
  assert.deepEqual(resultado.periodEnd, cicloQueEmpiezaEn(2027).end);
});

await prueba('renewalChargeOrgCycle: pagar 30 días antes del vencimiento da el MISMO período que pagar el día exacto (sin doble cobro de franja)', () => {
  const finDelCicloActual = cicloQueEmpiezaEn(2026).end;
  const resultado = renewalChargeOrgCycle({ currentPeriodEnd: finDelCicloActual, cyclePriceArs: 100_000 });
  // El cálculo no toma "hoy" como parámetro — pagar antes o después del
  // vencimiento da el mismo resultado, siempre anclado a `currentPeriodEnd`.
  assert.equal(resultado.periodStart.getTime(), finDelCicloActual.getTime() + 1);
});

await prueba('renewalChargeIndividualAnnual: cobra el precio anual completo y el período nuevo arranca donde terminó el anterior', () => {
  const currentPeriodEnd = medianocheAr(2027, 6, 15);
  const resultado = renewalChargeIndividualAnnual({ currentPeriodEnd, annualPriceArs: 50_000 });
  assert.equal(resultado.amountArs, 50_000);
  assert.equal(resultado.periodStart.getTime(), currentPeriodEnd.getTime());
  assert.equal(resultado.periodEnd.getTime(), medianocheAr(2028, 6, 15).getTime());
});

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad-planes.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/unidad-planes.ts: todas las pruebas pasaron');
}
