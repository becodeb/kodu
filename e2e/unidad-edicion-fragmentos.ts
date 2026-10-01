import assert from 'node:assert/strict';
import { applyResourceEdits } from '../src/lib/ai/edits.ts';
import { parseEditResourceArgs } from '../src/lib/ai/tools.ts';
import { aplicarKit, plegarKit } from '../src/lib/ai/kit.ts';

/**
 * Pruebas unitarias de odd/tasks/ahorro-tokens.md (T3a): `edit_resource_code`
 * — aplicación todo-o-nada de ediciones por fragmento (`src/lib/ai/edits.ts`)
 * y el parseo de su argumento (`src/lib/ai/tools.ts`).
 *
 * `node:assert/strict` + `tsx`, mismo patrón que unidad-ahorro-tokens.ts.
 * Ejecutar con:
 *   npx tsx e2e/unidad-edicion-fragmentos.ts
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

const HTML_SIMPLE = [
  '<!DOCTYPE html>',
  '<html><head><meta charset="UTF-8"></head>',
  '<body>',
  '  <h1>Título original</h1>',
  '  <p>Un párrafo.</p>',
  '  <p>Un párrafo.</p>', // texto duplicado a propósito, para la prueba "multiple_matches"
  '</body></html>',
].join('\n');

// ── parseEditResourceArgs ─────────────────────────────────────────────

await prueba('parseEditResourceArgs: edits válido, un elemento', () => {
  const r = parseEditResourceArgs(JSON.stringify({ edits: [{ find: 'a', replace: 'b' }] }));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.edits, [{ find: 'a', replace: 'b' }]);
});

await prueba('parseEditResourceArgs: JSON inválido sin truncated -> invalid', () => {
  const r = parseEditResourceArgs('{not json');
  assert.deepEqual(r, { ok: false, reason: 'invalid' });
});

await prueba('parseEditResourceArgs: JSON inválido con truncated -> truncated', () => {
  const r = parseEditResourceArgs('{"edits": [{"find": "a", "repl', true);
  assert.deepEqual(r, { ok: false, reason: 'truncated' });
});

await prueba('parseEditResourceArgs: edits no es array -> invalid', () => {
  const r = parseEditResourceArgs(JSON.stringify({ edits: 'nope' }));
  assert.deepEqual(r, { ok: false, reason: 'invalid' });
});

await prueba('parseEditResourceArgs: edits vacío -> empty', () => {
  const r = parseEditResourceArgs(JSON.stringify({ edits: [] }));
  assert.deepEqual(r, { ok: false, reason: 'empty' });
});

await prueba('parseEditResourceArgs: find vacío -> invalid', () => {
  const r = parseEditResourceArgs(JSON.stringify({ edits: [{ find: '', replace: 'x' }] }));
  assert.deepEqual(r, { ok: false, reason: 'invalid' });
});

await prueba('parseEditResourceArgs: falta replace -> invalid', () => {
  const r = parseEditResourceArgs(JSON.stringify({ edits: [{ find: 'a' }] }));
  assert.deepEqual(r, { ok: false, reason: 'invalid' });
});

// ── applyResourceEdits: casos básicos ─────────────────────────────────

await prueba('applyResourceEdits: un match único se reemplaza', () => {
  const r = applyResourceEdits(HTML_SIMPLE, [{ find: 'Título original', replace: 'Título nuevo' }], 200_000);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.html.includes('Título nuevo'));
    assert.ok(!r.html.includes('Título original'));
  }
});

await prueba('applyResourceEdits: sin match -> no_match, nada se toca', () => {
  const r = applyResourceEdits(HTML_SIMPLE, [{ find: 'esto no existe', replace: 'x' }], 200_000);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'no_match');
});

await prueba('applyResourceEdits: dos o más matches -> multiple_matches, nada se toca', () => {
  const r = applyResourceEdits(HTML_SIMPLE, [{ find: '<p>Un párrafo.</p>', replace: '<p>x</p>' }], 200_000);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'multiple_matches');
});

await prueba('applyResourceEdits: todo o nada — un find malo tira abajo un find bueno en la misma tanda', () => {
  const r = applyResourceEdits(
    HTML_SIMPLE,
    [
      { find: 'Título original', replace: 'Título nuevo' },
      { find: 'no existe esto', replace: 'x' },
    ],
    200_000,
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'no_match');
    assert.equal(r.index, 1);
  }
});

await prueba('applyResourceEdits: varios edits válidos y no solapados se aplican todos', () => {
  const r = applyResourceEdits(
    HTML_SIMPLE,
    [
      { find: 'Título original', replace: 'T' },
      { find: '<h1>', replace: '<h2>' },
    ],
    200_000,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.html.includes('<h2>T</h1>'));
    assert.ok(!r.html.includes('<h1>'));
    assert.ok(!r.html.includes('Título original'));
  }
});

await prueba('applyResourceEdits: dos finds que se solapan -> overlap', () => {
  const r = applyResourceEdits(
    HTML_SIMPLE,
    [
      { find: 'Título original', replace: 'a' },
      { find: 'original</h1>', replace: 'b' },
    ],
    200_000,
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'overlap');
});

await prueba('applyResourceEdits: find vacío -> empty_find', () => {
  const r = applyResourceEdits(HTML_SIMPLE, [{ find: '', replace: 'x' }], 200_000);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'empty_find');
});

await prueba('applyResourceEdits: CRLF/espacios exactos — un find sin los \\r no matchea', () => {
  const htmlCrlf = HTML_SIMPLE.replace(/\n/g, '\r\n');
  const r = applyResourceEdits(htmlCrlf, [{ find: '<h1>Título original</h1>', replace: 'x' }], 200_000);
  // El find de una sola línea sigue matcheando igual (no cruza el salto de línea).
  assert.equal(r.ok, true);
});

await prueba('applyResourceEdits: CRLF exacto — un find que cruza el salto con \\n falla contra un documento con \\r\\n', () => {
  const htmlCrlf = HTML_SIMPLE.replace(/\n/g, '\r\n');
  const findConLfSolo = '<h1>Título original</h1>\n  <p>Un párrafo.</p>';
  const r = applyResourceEdits(htmlCrlf, [{ find: findConLfSolo, replace: 'x' }], 200_000);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'no_match');
});

// ── applyResourceEdits: zona plegada del kit ──────────────────────────

const HTML_CON_KIT = aplicarKit(
  [
    '<!DOCTYPE html>',
    '<html><head><meta charset="UTF-8"><meta name="kodu-tema" content="pizarron"></head>',
    '<body>',
    '  <h1>Consigna del docente</h1>',
    '</body></html>',
  ].join('\n'),
);

await prueba('setup: HTML_CON_KIT trae el bloque canónico del kit', () => {
  assert.ok(HTML_CON_KIT.includes('kodu-kit'));
  assert.notEqual(plegarKit(HTML_CON_KIT), HTML_CON_KIT, 'plegado tiene que ser distinto del real: hay bloque que plegar');
});

await prueba('applyResourceEdits: un find copiado del DENTRO del bloque canónico (nunca visto plegado) -> folded_region', () => {
  // `_kodu_pruebas_no_cargaron` aparece una sola vez en todo el bloque canónico: sirve para aislar
  // el chequeo de "zona plegada" del de "multiple_matches" (otros strings del bloque, como
  // __koduDibujarIconos, aparecen más de una vez y disparan multiple_matches primero).
  const count = (HTML_CON_KIT.match(/_kodu_pruebas_no_cargaron/g) ?? []).length;
  assert.equal(count, 1, 'el bloque canónico tiene que traer este texto interno UNA sola vez para que la prueba aísle folded_region');
  const r = applyResourceEdits(HTML_CON_KIT, [{ find: '_kodu_pruebas_no_cargaron', replace: 'x' }], 200_000);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'folded_region');
});

await prueba('applyResourceEdits: un find FUERA del bloque del kit se aplica normalmente aunque haya kit', () => {
  const r = applyResourceEdits(HTML_CON_KIT, [{ find: 'Consigna del docente', replace: 'Consigna nueva' }], 200_000);
  assert.equal(r.ok, true);
  if (r.ok) assert.ok(r.html.includes('Consigna nueva'));
});

// ── applyResourceEdits: zona truncada por MAX_HTML_CHARS ──────────────

await prueba('applyResourceEdits: un find que arranca después del corte visible -> truncated_region', () => {
  const relleno = 'x'.repeat(1000);
  const htmlLargo = `<!DOCTYPE html><html><body><p>${relleno}</p><p id="cola">texto de la cola</p></body></html>`;
  const corte = htmlLargo.indexOf('<p id="cola">'); // todo lo que sigue a esto queda "no visto" con este tope
  const r = applyResourceEdits(htmlLargo, [{ find: 'texto de la cola', replace: 'x' }], corte);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'truncated_region');
});

await prueba('applyResourceEdits: un find antes del corte se aplica igual con documento largo', () => {
  const relleno = 'x'.repeat(1000);
  const htmlLargo = `<!DOCTYPE html><html><body><p id="cabeza">texto de la cabeza</p><p>${relleno}</p></body></html>`;
  const corte = htmlLargo.indexOf('<p>' + relleno); // el corte cae DESPUÉS de "cabeza"
  const r = applyResourceEdits(htmlLargo, [{ find: 'texto de la cabeza', replace: 'nuevo' }], corte);
  assert.equal(r.ok, true);
  if (r.ok) assert.ok(r.html.includes('nuevo'));
});

await prueba('applyResourceEdits: sin truncamiento (documento entra entero) no rechaza nada por "truncated_region"', () => {
  const r = applyResourceEdits(HTML_SIMPLE, [{ find: 'Título original', replace: 'x' }], 200_000);
  assert.equal(r.ok, true);
});

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
} else {
  console.log('\nTodas las pruebas pasaron.');
}
