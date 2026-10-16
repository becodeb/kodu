import assert from 'node:assert/strict';
import { empeoroTrasPulido } from '../src/lib/client/pulido.ts';

let fallas = 0;
function prueba(nombre: string, fn: () => void) {
  try { fn(); console.log(`✔ ${nombre}`); } catch (e) { fallas++; console.error(`✘ ${nombre}\n`, e); }
}
const err = (mensaje: string) => ({ tipo: 'consola' as const, mensaje, linea: null, columna: null, accion: '' });
const r = (errores: string[], reinicioOk: boolean | null, pruebas: [string, boolean][] | null) => ({
  errores: errores.map(err), reinicioOk, pruebas: pruebas ? pruebas.map(([id, ok]) => ({ id, ok, detalle: '' })) : null,
});

prueba('residual errors already present before the polish do not revert it', () => {
  assert.equal(empeoroTrasPulido(r(['x is undefined'], true, null), r(['x is undefined'], true, null)), false);
});
prueba('a new error introduced by the polish reverts', () => {
  assert.equal(empeoroTrasPulido(r([], true, null), r(['boom'], true, null)), true);
});
prueba('reset that used to work and now fails reverts', () => {
  assert.equal(empeoroTrasPulido(r([], true, null), r([], false, null)), true);
});
prueba('a reset already failing before does not revert', () => {
  assert.equal(empeoroTrasPulido(r([], false, null), r([], false, null)), false);
});
prueba('a checklist test that passed before and fails now reverts', () => {
  assert.equal(empeoroTrasPulido(r([], true, [['c1', true]]), r([], true, [['c1', false]])), true);
});
prueba('a test already failing before does not revert', () => {
  assert.equal(empeoroTrasPulido(r([], true, [['c1', false]]), r([], true, [['c1', false]])), false);
});
prueba('without a baseline any failure reverts', () => {
  assert.equal(empeoroTrasPulido(null, r(['old'], true, null)), true);
  assert.equal(empeoroTrasPulido(null, r([], true, [['c1', true]])), false);
});

if (fallas) { console.error(`\n${fallas} prueba(s) fallaron.`); process.exit(1); }
console.log('\n✔ e2e/unidad-pulido-revertir.ts: todas las comprobaciones pasaron');
