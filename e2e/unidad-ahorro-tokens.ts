import assert from 'node:assert/strict';
import { Prisma } from '../src/generated/prisma/client.ts';
import { isOffPeak, precioVigente, scheduleFromAiModel, type PriceSchedule } from '../src/lib/ai/pricing.ts';

/**
 * Pruebas unitarias de odd/tasks/ahorro-tokens.md (T1): src/lib/ai/pricing.ts
 * (horario de pico, sin Prisma ni Node — módulo puro, mismo criterio que
 * unidad-kit.ts).
 *
 * `node:assert/strict` + `tsx`, mismo patrón que unidad-kit.ts. Ejecutar con:
 *   npx tsx e2e/unidad-ahorro-tokens.ts
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

const PRECIOS_BASE = {
  input: new Prisma.Decimal('1'),
  output: new Prisma.Decimal('2'),
  cachedInput: new Prisma.Decimal('0.1'),
};

/** El horario oficial de DeepSeek: pico 01:00-04:00 y 06:00-10:00 UTC,
 *  lunes a viernes, factor 0.5 — el mismo que setea la migración. */
const HORARIO_DEEPSEEK: PriceSchedule = {
  offPeakFactor: new Prisma.Decimal('0.5'),
  peakWindows: [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startHour: 1, endHour: 4 },
    { weekday, startHour: 6, endHour: 10 },
  ]),
  offPeakDates: [],
};

await prueba('precioVigente: sin horario (null) devuelve el precio tal cual, sin importar la hora', () => {
  const resultado = precioVigente(PRECIOS_BASE, null, new Date('2026-10-06T02:00:00Z')); // martes, en ventana
  assert.equal(resultado, PRECIOS_BASE, 'tiene que ser el mismo objeto, no una copia recalculada');
});

await prueba('precioVigente: hora de pico (martes 02:00 UTC) devuelve el precio de pico sin descuento', () => {
  const resultado = precioVigente(PRECIOS_BASE, HORARIO_DEEPSEEK, new Date('2026-10-06T02:00:00Z'));
  assert.equal(resultado.input.toString(), '1');
  assert.equal(resultado.output.toString(), '2');
  assert.equal(resultado.cachedInput!.toString(), '0.1');
});

await prueba('precioVigente: hora fuera de pico (martes 05:00 UTC, entre las dos ventanas) aplica el factor', () => {
  const resultado = precioVigente(PRECIOS_BASE, HORARIO_DEEPSEEK, new Date('2026-10-06T05:00:00Z'));
  assert.equal(resultado.input.toString(), '0.5');
  assert.equal(resultado.output.toString(), '1');
  assert.equal(resultado.cachedInput!.toString(), '0.05');
});

await prueba('precioVigente: motor sin tarifa de caché propia (cachedInput null) no inventa una al descontar', () => {
  const resultado = precioVigente(
    { input: new Prisma.Decimal('1'), output: new Prisma.Decimal('2'), cachedInput: null },
    HORARIO_DEEPSEEK,
    new Date('2026-10-06T05:00:00Z'), // fuera de pico
  );
  assert.equal(resultado.cachedInput, null);
});

await prueba('isOffPeak: el borde de inicio de ventana (01:00 UTC) es INCLUSIVE — todavía pico', () => {
  assert.equal(isOffPeak(HORARIO_DEEPSEEK, new Date('2026-10-06T01:00:00Z')), false);
});

await prueba('isOffPeak: un milisegundo antes del inicio (00:59:59.999 UTC) ya es fuera de pico', () => {
  assert.equal(isOffPeak(HORARIO_DEEPSEEK, new Date('2026-10-06T00:59:59.999Z')), true);
});

await prueba('isOffPeak: el borde de fin de ventana (04:00 UTC) es EXCLUSIVE — ya fuera de pico', () => {
  assert.equal(isOffPeak(HORARIO_DEEPSEEK, new Date('2026-10-06T04:00:00Z')), true);
});

await prueba('isOffPeak: un milisegundo antes del fin (03:59:59.999 UTC) todavía es pico', () => {
  assert.equal(isOffPeak(HORARIO_DEEPSEEK, new Date('2026-10-06T03:59:59.999Z')), false);
});

await prueba('isOffPeak: fin de semana (sábado) siempre fuera de pico, aunque caiga en la hora de una ventana', () => {
  // 2026-10-10 es sábado.
  assert.equal(isOffPeak(HORARIO_DEEPSEEK, new Date('2026-10-10T02:00:00Z')), true);
});

await prueba('isOffPeak: un feriado listado es fuera de pico aunque la hora y el día caigan en una ventana', () => {
  const conFeriado: PriceSchedule = { ...HORARIO_DEEPSEEK, offPeakDates: ['2026-10-06'] };
  assert.equal(isOffPeak(conFeriado, new Date('2026-10-06T02:00:00Z')), true);
});

await prueba('precioVigente/isOffPeak: un motor sin horario nunca está "fuera de pico" vía precioVigente (no se toca)', () => {
  // La función isOffPeak exige un schedule; precioVigente es la que de verdad
  // soporta null — ya cubierta arriba, esta prueba documenta el contrato.
  const resultado = precioVigente(PRECIOS_BASE, null, new Date('2026-10-10T02:00:00Z')); // sábado
  assert.equal(resultado, PRECIOS_BASE);
});

await prueba('scheduleFromAiModel: priceOffPeakFactor null (o 0) → sin horario, aunque haya ventanas cargadas', () => {
  assert.equal(
    scheduleFromAiModel({ priceOffPeakFactor: null, peakWindowsUtc: [{ weekday: 1, startHour: 1, endHour: 4 }], offPeakDatesUtc: [] }),
    null,
  );
});

await prueba('scheduleFromAiModel: con factor cargado arma el PriceSchedule desde las columnas crudas', () => {
  const resultado = scheduleFromAiModel({
    priceOffPeakFactor: new Prisma.Decimal('0.5'),
    peakWindowsUtc: [{ weekday: 1, startHour: 1, endHour: 4 }],
    offPeakDatesUtc: ['2026-01-01'],
  });
  assert.ok(resultado);
  assert.equal(resultado!.offPeakFactor.toString(), '0.5');
  assert.deepEqual(resultado!.peakWindows, [{ weekday: 1, startHour: 1, endHour: 4 }]);
  assert.deepEqual(resultado!.offPeakDates, ['2026-01-01']);
});

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('\nTodo OK.');
