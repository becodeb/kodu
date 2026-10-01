import assert from 'node:assert/strict';
import { decidirPreguntaFeedback } from '../src/lib/feedback/frecuencia.ts';
import { detectarFraseDefecto, normalizarTexto } from '../src/lib/feedback/clasificador.ts';

/**
 * Pruebas unitarias de odd/tasks/ahorro-tokens.md (T5): la regla de
 * frecuencia de la pregunta inline y el clasificador de frases de defecto.
 *
 * Las pruebas de pseudonimización/CSV del export (T4) viven aparte, en
 * `e2e/unidad-trazas-export.ts` — cada commit lleva sus propias pruebas.
 *
 * `node:assert/strict` + `tsx`, mismo patrón que unidad-edicion-fragmentos.ts.
 * Ejecutar con:
 *   npx tsx e2e/unidad-feedback-y-trazas.ts
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
// decidirPreguntaFeedback
// ─────────────────────────────────────────────────────────────

const ESTADO_BASE = {
  promptsDeshabilitados: false,
  esPrimeraGeneracion: false,
  turnosDesdeUltimaPregunta: 0,
  ultimoTipoPreguntado: null,
  hayPreguntaSinResponder: false,
} as const;

await prueba('decidirPreguntaFeedback: primera generación siempre pregunta FUNCIONA', () => {
  const r = decidirPreguntaFeedback({ ...ESTADO_BASE, esPrimeraGeneracion: true });
  assert.deepEqual(r, { mostrar: true, tipo: 'FUNCIONA' });
});

await prueba('decidirPreguntaFeedback: menos de 5 turnos desde la última, no pregunta', () => {
  const r = decidirPreguntaFeedback({ ...ESTADO_BASE, turnosDesdeUltimaPregunta: 4 });
  assert.equal(r.mostrar, false);
});

await prueba('decidirPreguntaFeedback: a los 5 turnos, pregunta y alterna desde FUNCIONA a VISUAL', () => {
  const r = decidirPreguntaFeedback({ ...ESTADO_BASE, turnosDesdeUltimaPregunta: 5, ultimoTipoPreguntado: 'FUNCIONA' });
  assert.deepEqual(r, { mostrar: true, tipo: 'VISUAL' });
});

await prueba('decidirPreguntaFeedback: alterna de VISUAL a FUNCIONA', () => {
  const r = decidirPreguntaFeedback({ ...ESTADO_BASE, turnosDesdeUltimaPregunta: 7, ultimoTipoPreguntado: 'VISUAL' });
  assert.deepEqual(r, { mostrar: true, tipo: 'FUNCIONA' });
});

await prueba('decidirPreguntaFeedback: nunca si los prompts están deshabilitados', () => {
  const r = decidirPreguntaFeedback({ ...ESTADO_BASE, esPrimeraGeneracion: true, promptsDeshabilitados: true });
  assert.deepEqual(r, { mostrar: false, tipo: null });
});

await prueba('decidirPreguntaFeedback: nunca encima de una sin responder, ni siquiera la primera', () => {
  const r = decidirPreguntaFeedback({ ...ESTADO_BASE, esPrimeraGeneracion: true, hayPreguntaSinResponder: true });
  assert.deepEqual(r, { mostrar: false, tipo: null });
});

await prueba('decidirPreguntaFeedback: nunca encima de una sin responder, aunque toque por turnos', () => {
  const r = decidirPreguntaFeedback({ ...ESTADO_BASE, turnosDesdeUltimaPregunta: 10, hayPreguntaSinResponder: true });
  assert.deepEqual(r, { mostrar: false, tipo: null });
});

// ─────────────────────────────────────────────────────────────
// detectarFraseDefecto
// ─────────────────────────────────────────────────────────────

await prueba('detectarFraseDefecto: "no funciona" matchea', () => {
  assert.equal(detectarFraseDefecto('che, no funciona el botón'), 'no funciona');
});

await prueba('detectarFraseDefecto: insensible a mayúsculas y acentos ("ARREGLÁ esto")', () => {
  assert.equal(detectarFraseDefecto('ARREGLÁ esto por favor'), 'arregla');
});

await prueba('detectarFraseDefecto: "se rompió" con acento matchea la raíz sin acento', () => {
  assert.equal(detectarFraseDefecto('uy, se rompió todo'), 'se rompio');
});

await prueba('detectarFraseDefecto: "arreglalo" matchea la misma raíz que "arreglá"', () => {
  assert.equal(detectarFraseDefecto('arreglalo por favor'), 'arregla');
});

await prueba('detectarFraseDefecto: un mensaje normal no matchea nada', () => {
  assert.equal(detectarFraseDefecto('cambiá el color del título a azul'), null);
});

await prueba('detectarFraseDefecto: "no aparece" matchea', () => {
  assert.equal(detectarFraseDefecto('el botón no aparece en el celular'), 'no aparece');
});

await prueba('normalizarTexto: quita diacríticos y pasa a minúsculas', () => {
  assert.equal(normalizarTexto('ÁÉÍÓÚñ Hola'), 'aeioun hola');
});

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
} else {
  console.log('\nTodas las pruebas pasaron.');
}
