import assert from 'node:assert/strict';
import { htmlParcialDeArgumentos } from '../src/lib/client/html-parcial.ts';

/**
 * Pruebas unitarias del decodificador de JSON parcial
 * (src/lib/client/html-parcial.ts) — tarea T3 de odd/tasks/modo-prime.md.
 *
 * Archivo separado, DB-free, mismo patrón que e2e/unidad-kit.ts: el módulo es
 * puro e isomórfico y estas pruebas no necesitan la base de datos para nada.
 *
 * `node:assert/strict` + `tsx`. Ejecutar con:
 *   npx tsx e2e/unidad-html-parcial.ts
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
// Todavía no hay nada que mostrar
// ─────────────────────────────────────────────────────────────

await prueba('null mientras la clave "html" no empezó', () => {
  assert.equal(htmlParcialDeArgumentos(''), null);
  assert.equal(htmlParcialDeArgumentos('{'), null);
  assert.equal(htmlParcialDeArgumentos('{"ht'), null);
  assert.equal(htmlParcialDeArgumentos('{"html"'), null);
  assert.equal(htmlParcialDeArgumentos('{"html":'), null);
  assert.equal(htmlParcialDeArgumentos('{"html": '), null);
  assert.equal(htmlParcialDeArgumentos('   '), null);
});

await prueba('null si el valor de "html" no es un string', () => {
  assert.equal(htmlParcialDeArgumentos('{"html":123'), null);
  assert.equal(htmlParcialDeArgumentos('{"html":true'), null);
  assert.equal(htmlParcialDeArgumentos('{"html":null'), null);
});

await prueba('string vacío apenas abre la comilla: no es null, es ""', () => {
  assert.equal(htmlParcialDeArgumentos('{"html":"'), '');
});

// ─────────────────────────────────────────────────────────────
// Crecimiento normal, mientras el string sigue abierto
// ─────────────────────────────────────────────────────────────

await prueba('devuelve lo decodificado hasta donde llegó el buffer', () => {
  assert.equal(htmlParcialDeArgumentos('{"html":"<!DOCTYPE html><html>'), '<!DOCTYPE html><html>');
});

await prueba('tolera espacios alrededor de la clave y los dos puntos', () => {
  const resultado = htmlParcialDeArgumentos('{ \n "html" \t : \n "<p>x</p>');
  assert.equal(resultado, '<p>x</p>');
});

await prueba('en una tanda creciente, cada paso es un prefijo del HTML final', () => {
  const html =
    '<!DOCTYPE html><html><head><meta name="kodu-tema" content="cuaderno"></head>' +
    '<body><h1>Hola</h1><p>3/4 + 1/4 = 1</p></body></html>';
  const completo = JSON.stringify({ html });

  for (let corte = 10; corte <= completo.length; corte += 7) {
    const parcial = htmlParcialDeArgumentos(completo.slice(0, corte));
    if (parcial === null) continue;
    assert.ok(html.startsWith(parcial), `en el corte ${corte}, "${parcial}" tendría que ser prefijo del html final`);
  }

  assert.equal(htmlParcialDeArgumentos(completo), html);
});

// ─────────────────────────────────────────────────────────────
// El string ya cerró: no sigue leyendo lo que venga después
// ─────────────────────────────────────────────────────────────

await prueba('si "html" ya cerró, no sigue leyendo el resto del objeto', () => {
  const resultado = htmlParcialDeArgumentos('{"html":"<p>x</p>","otraClave":"esto no debería aparecer"');
  assert.equal(resultado, '<p>x</p>');
});

// ─────────────────────────────────────────────────────────────
// "html" no es la primera clave
// ─────────────────────────────────────────────────────────────

await prueba('"html" no es la primera clave: strings, números, booleanos, null, arrays y objetos anteriores se saltean', () => {
  const crudo =
    '{"nombre":"algo con \\"comillas\\" internas","numero":42,"activo":true,' +
    '"nulo":null,"lista":[1,2,"x"],"objeto":{"a":1,"b":[true,null]},' +
    '"html":"<p>hola</p>';
  assert.equal(htmlParcialDeArgumentos(crudo), '<p>hola</p>');
});

await prueba('"html" no es la primera clave y la clave anterior viene cortada: null, no una lectura a medias', () => {
  // "otraClave" todavía no cerró su string: no se puede saber qué viene después.
  const crudo = '{"otraClave":"a medio escribir sin cerrar';
  assert.equal(htmlParcialDeArgumentos(crudo), null);
});

// ─────────────────────────────────────────────────────────────
// Escapes de JSON
// ─────────────────────────────────────────────────────────────

await prueba('escapes simples de JSON (\\" \\\\ \\/ \\b \\f \\n \\r \\t), cruzado contra JSON.parse', () => {
  const original = 'a"b\\c/d\be\ff\ng\rh\ti';
  const crudo = JSON.stringify({ html: original });
  assert.equal(htmlParcialDeArgumentos(crudo), original);
  assert.equal(htmlParcialDeArgumentos(crudo), (JSON.parse(crudo) as { html: string }).html);
});

await prueba('\\uXXXX de un caracter del plano básico (con tilde y ñ)', () => {
  const resultado = htmlParcialDeArgumentos('{"html":"<title>Ma\\u00f1ana: \\u00bfqu\\u00e9 hora es?</title>');
  assert.equal(resultado, '<title>Mañana: ¿qué hora es?</title>');
});

await prueba('par subrogado completo (un emoji fuera del plano básico)', () => {
  const resultado = htmlParcialDeArgumentos('{"html":"<title>\\ud83d\\ude00</title>');
  assert.equal(resultado, '<title>😀</title>');
});

await prueba('par subrogado partido justo en el corte de una tanda no deja la mitad suelta', () => {
  const primeraTanda = '{"html":"<p>';
  const conMitadAlta = primeraTanda + '\\ud83d';

  const resultado1 = htmlParcialDeArgumentos(conMitadAlta);
  assert.equal(resultado1, '<p>', 'la mitad alta sola no debería aparecer todavía');

  const resultado2 = htmlParcialDeArgumentos(conMitadAlta + '\\ude00</p>');
  assert.equal(resultado2, '<p>😀</p>', 'con la mitad baja ya completa, el emoji tiene que aparecer entero');
});

await prueba('una \\ sola al final del buffer se corta ahí, no cuelga nada', () => {
  const resultado = htmlParcialDeArgumentos('{"html":"<p>ok' + '\\');
  assert.equal(resultado, '<p>ok');
});

await prueba('un \\u con menos de 4 hex se corta ahí, no cuelga nada', () => {
  assert.equal(htmlParcialDeArgumentos('{"html":"<p>ok\\u00'), '<p>ok');
  assert.equal(htmlParcialDeArgumentos('{"html":"<p>ok\\u'), '<p>ok');
});

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad-html-parcial.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/unidad-html-parcial.ts: todas las pruebas pasaron');
}
