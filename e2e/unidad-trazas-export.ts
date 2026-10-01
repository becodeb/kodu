import assert from 'node:assert/strict';
import { pseudonimizar } from '../src/lib/admin/pseudonimizar.ts';
import { csvEscape, filaCsv } from '../src/lib/admin/csv.ts';

/**
 * Pruebas unitarias de odd/tasks/ahorro-tokens.md (T4): la pseudonimización
 * estable del export de trazas y el escape CSV del texto libre del docente.
 *
 * `node:assert/strict` + `tsx`, mismo patrón que unidad-edicion-fragmentos.ts.
 * Ejecutar con:
 *   npx tsx e2e/unidad-trazas-export.ts
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
// pseudonimizar
// ─────────────────────────────────────────────────────────────

await prueba('pseudonimizar: estable — el mismo id y secreto siempre dan el mismo pseudónimo', () => {
  const a = pseudonimizar('user-123', 'secreto-de-prueba-bien-largo', 'docente');
  const b = pseudonimizar('user-123', 'secreto-de-prueba-bien-largo', 'docente');
  assert.equal(a, b);
});

await prueba('pseudonimizar: ids distintos dan pseudónimos distintos', () => {
  const a = pseudonimizar('user-123', 'secreto-de-prueba-bien-largo', 'docente');
  const b = pseudonimizar('user-456', 'secreto-de-prueba-bien-largo', 'docente');
  assert.notEqual(a, b);
});

await prueba('pseudonimizar: nunca contiene el id original', () => {
  const a = pseudonimizar('user-123', 'secreto-de-prueba-bien-largo', 'docente');
  assert.equal(a.includes('user-123'), false);
});

await prueba('pseudonimizar: mismo id, prefijo distinto -> pseudónimo distinto', () => {
  const a = pseudonimizar('mismo-id', 'secreto-de-prueba-bien-largo', 'docente');
  const b = pseudonimizar('mismo-id', 'secreto-de-prueba-bien-largo', 'org');
  assert.notEqual(a, b);
});

await prueba('pseudonimizar: un secreto distinto da un pseudónimo distinto (no es sólo un hash del id)', () => {
  const a = pseudonimizar('user-123', 'secreto-uno-bien-largo-tambien', 'docente');
  const b = pseudonimizar('user-123', 'secreto-dos-bien-largo-tambien', 'docente');
  assert.notEqual(a, b);
});

// ─────────────────────────────────────────────────────────────
// csvEscape / filaCsv — el pedido del docente es texto libre: puede traer
// coma, comillas y salto de línea a la vez.
// ─────────────────────────────────────────────────────────────

await prueba('csvEscape: texto simple no se toca', () => {
  assert.equal(csvEscape('hola mundo'), 'hola mundo');
});

await prueba('csvEscape: coma se envuelve en comillas', () => {
  assert.equal(csvEscape('hacé el título más grande, por favor'), '"hacé el título más grande, por favor"');
});

await prueba('csvEscape: comillas internas se duplican', () => {
  assert.equal(csvEscape('decí "hola" en el título'), '"decí ""hola"" en el título"');
});

await prueba('csvEscape: salto de línea se envuelve en comillas', () => {
  assert.equal(csvEscape('primera línea\nsegunda línea'), '"primera línea\nsegunda línea"');
});

await prueba('csvEscape: coma, comillas y salto de línea juntos en el mismo pedido', () => {
  const pedido = 'poné "Bienvenidos", y después\nun subtítulo, gracias';
  const escapado = csvEscape(pedido);
  assert.ok(escapado.startsWith('"') && escapado.endsWith('"'));
  assert.ok(escapado.includes('""Bienvenidos""'));
  assert.ok(escapado.includes('\n'));
});

await prueba('csvEscape: null/undefined se vacían, no "null"/"undefined"', () => {
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(undefined), '');
});

await prueba('filaCsv: une celdas con coma, cada una ya escapada', () => {
  assert.equal(filaCsv(['a', 'b,c', 'd']), 'a,"b,c",d');
});

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
} else {
  console.log('\nTodas las pruebas pasaron.');
}
