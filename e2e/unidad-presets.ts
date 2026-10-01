import assert from 'node:assert/strict';
import { isOffPeak, precioVigente } from '../src/lib/ai/pricing.ts';
import { PRESETS, presetByKey, preciosDePreset } from '../src/lib/ai/presets.ts';

/**
 * Pruebas unitarias de odd/tasks/ahorro-tokens.md (T7): src/lib/ai/presets.ts
 * (sin Prisma real salvo `Prisma.Decimal`, mismo criterio que
 * unidad-ahorro-tokens.ts). Cubre: resolución de preset, precio de preset
 * vs. "Personalizado", un feriado dentro de una ventana de pico (off-peak
 * pese a caer en horario/día de pico), y un día de reposición (fin de
 * semana laborable, sigue siendo fin de semana → off-peak).
 *
 * Ejecutar con: npx tsx e2e/unidad-presets.ts
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

await prueba('presetByKey: una clave conocida devuelve el preset', () => {
  const preset = presetByKey('deepseek-flash');
  assert.ok(preset, 'deepseek-flash tiene que existir');
  assert.equal(preset!.providerModel, 'deepseek-flash');
  assert.equal(preset!.provider.baseUrl, 'https://api.deepseek.com');
});

await prueba('presetByKey: null/undefined/clave desconocida (preset sacado del código) -> null, nunca tira', () => {
  assert.equal(presetByKey(null), null);
  assert.equal(presetByKey(undefined), null);
  assert.equal(presetByKey('no-existe-mas'), null);
});

await prueba('PRESETS: las tres claves verificadas por la tarea están cargadas', () => {
  assert.ok(PRESETS['deepseek-flash']);
  assert.ok(PRESETS['deepseek-v4-pro']);
  assert.ok(PRESETS['openai-gpt-6-luna']);
});

await prueba('deepseek-flash: precios PEAK verificados (input 0.30, cached 0.006, output 1.20)', () => {
  const precios = preciosDePreset(PRESETS['deepseek-flash']!);
  assert.equal(precios.input.toString(), '0.3');
  assert.equal(precios.cachedInput.toString(), '0.006');
  assert.equal(precios.output.toString(), '1.2');
});

await prueba('deepseek-v4-pro: precios PEAK verificados (input 1.32, cached 0.044, output 3.96)', () => {
  const precios = preciosDePreset(PRESETS['deepseek-v4-pro']!);
  assert.equal(precios.input.toString(), '1.32');
  assert.equal(precios.cachedInput.toString(), '0.044');
  assert.equal(precios.output.toString(), '3.96');
});

await prueba('openai-gpt-6-luna: precios verificados (input 0.10, cached 0.01, output 0.50), sin horario', () => {
  const preset = PRESETS['openai-gpt-6-luna']!;
  const precios = preciosDePreset(preset);
  assert.equal(precios.input.toString(), '0.1');
  assert.equal(precios.cachedInput.toString(), '0.01');
  assert.equal(precios.output.toString(), '0.5');
  assert.equal(preset.schedule, null, 'luna no tiene schedule: siempre el mismo precio');
});

await prueba('deepseek-flash/v4-pro: precioVigente aplica el factor off-peak igual que cualquier AiModel con schedule', () => {
  const preset = PRESETS['deepseek-flash']!;
  const precios = preciosDePreset(preset);
  // Sábado 12:00 UTC: fin de semana, siempre fuera de pico.
  const sabadoAlMediodia = new Date('2026-10-03T12:00:00.000Z');
  const vigente = precioVigente(precios, preset.schedule, sabadoAlMediodia);
  assert.equal(vigente.input.toString(), '0.15', 'mitad de 0.30');
  assert.equal(vigente.output.toString(), '0.6', 'mitad de 1.20');
});

await prueba('feriado chino DENTRO de una ventana de pico: off-peak pese a hora/día de pico', () => {
  const preset = PRESETS['deepseek-flash']!;
  // 2026-10-01 es jueves (día de semana, 4) y 02:00 UTC cae en la ventana
  // 01:00-04:00 — sería PICO si no fuera un feriado listado (parte del
  // asueto 2026-10-01..07).
  const feriadoEnHorarioDePico = new Date('2026-10-01T02:00:00.000Z');
  assert.equal(isOffPeak(preset.schedule!, feriadoEnHorarioDePico), true);
});

await prueba('mismo día de semana/hora SIN ser feriado: sigue siendo pico', () => {
  const preset = PRESETS['deepseek-flash']!;
  // Un jueves cualquiera que no está en la lista de feriados.
  const juevesComun = new Date('2026-10-08T02:00:00.000Z');
  assert.equal(isOffPeak(preset.schedule!, juevesComun), false);
});

await prueba('día de reposición (01-04, sábado): sigue siendo fin de semana -> off-peak', () => {
  const preset = PRESETS['deepseek-flash']!;
  // 2026-01-04 es domingo según la tarea ("make-up workdays... son fines de
  // semana"); no está en la lista de feriados (serían días laborables si no
  // fuera por el día de la semana), pero el chequeo de fin de semana de
  // isOffPeak ya lo cubre igual.
  const diaDeReposicion = new Date('2026-01-04T02:00:00.000Z');
  assert.equal(isOffPeak(preset.schedule!, diaDeReposicion), true);
  // Y no está en la lista explícita de feriados (es el día de semana, no la
  // fecha, lo que lo hace off-peak).
  assert.ok(!preset.schedule!.offPeakDates.includes('2026-01-04'));
});

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('\nTodo OK.');
