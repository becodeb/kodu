import assert from 'node:assert/strict';
import { aislarPruebasKit, aplicarKit, bloqueKit } from '../src/lib/ai/kit.ts';

/**
 * Pruebas unitarias de `aislarPruebasKit` (T1 de `odd/tasks/verificador.md`):
 * el normalizador server-side que saca `window.__koduPruebas` del script
 * propio del recurso (cuando el modelo lo dejó inline, ignorando el pedido
 * del prompt) y blinda CUALQUIER `<script data-kodu-pruebas>` — separado a
 * mano por el modelo, o armado acá — contra un error de sintaxis o una
 * excepción al evaluarlo.
 *
 * Archivo aparte de `e2e/unidad-kit.ts` a propósito (mismo criterio: pura,
 * isomórfica, sin Prisma ni Node de verdad — `node:assert/strict` + `tsx`,
 * nada de DB) — este conjunto de casos es grande por sí solo (el scanner
 * respeta strings, templates, comentarios y regex) y no tiene sentido
 * mezclarlo con el resto del kit.
 *
 * Ejecutar con: npx tsx e2e/unidad-pruebas-aisladas.ts
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

/** Documento mínimo con el kit REAL aplicado (tema `cuaderno`), mismo criterio que `construirRecurso` en `e2e/navegador-kit.ts`. */
function documento(cuerpo: string): string {
  const html =
    '<!DOCTYPE html>\n<html lang="es">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="kodu-tema" content="cuaderno">\n</head>\n<body>\n' +
    cuerpo +
    '\n</body>\n</html>';
  return aplicarKit(html);
}

/** El contenido crudo del PRIMER `<script>` (sin `data-kodu-pruebas`) que contiene `ancla`. */
function scriptQueContiene(html: string, ancla: string): string {
  const idx = html.indexOf(ancla);
  assert.ok(idx !== -1, `no se encontró "${ancla}" en el html`);
  const aperturaDesde = html.lastIndexOf('<script', idx);
  assert.ok(aperturaDesde !== -1);
  const contenidoDesde = html.indexOf('>', aperturaDesde) + 1;
  const cierreDesde = html.indexOf('</script', idx);
  return html.slice(contenidoDesde, cierreDesde);
}

/** Todos los `<script data-kodu-pruebas>` de `html`, en orden, con su contenido crudo. */
function scriptsDePruebas(html: string): string[] {
  const salida: string[] = [];
  const re = /<script[^>]*\bdata-kodu-pruebas\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) salida.push(m[1]!);
  return salida;
}

/** Decodifica el string fuente que `envolverPruebas` empaquetó en `try{eval("...")}catch...`. */
function fuenteEnvuelta(contenidoScript: string): string {
  assert.ok(contenidoScript.startsWith('try{eval('), `no está envuelto: ${contenidoScript.slice(0, 40)}`);
  const desdeComilla = contenidoScript.indexOf('"', 'try{eval('.length);
  assert.ok(desdeComilla !== -1, 'no se encontró el string envuelto');
  let j = desdeComilla + 1;
  for (;;) {
    if (contenidoScript[j] === '\\') { j += 2; continue; }
    if (contenidoScript[j] === '"') { j++; break; }
    j++;
  }
  return JSON.parse(contenidoScript.slice(desdeComilla, j)) as string;
}

// ── Extracción desde el script del recurso ───────────────────────────────

await prueba('aislarPruebasKit: extrae window.__koduPruebas inline a su propio <script data-kodu-pruebas>', () => {
  const html = documento(`
    <p id="m">listo</p>
    <script>
      function reiniciar() { document.getElementById('m').textContent = 'reiniciado'; }
      reiniciar();
      window.__koduPruebas = [{ id: 'c1', prueba: function (t) { return { ok: true, detalle: 'ok' }; } }];
    </script>
  `);
  const resultado = aislarPruebasKit(html);

  const scriptRecurso = scriptQueContiene(resultado, 'function reiniciar');
  assert.ok(!scriptRecurso.includes('__koduPruebas'), 'la asignación tiene que salir del script del recurso');
  assert.ok(scriptRecurso.includes("reiniciar();"), 'el resto del script tiene que sobrevivir intacto');

  const separados = scriptsDePruebas(resultado);
  assert.equal(separados.length, 1, 'tiene que aparecer exactamente un <script data-kodu-pruebas>');
  const fuente = fuenteEnvuelta(separados[0]!);
  assert.equal(
    fuente,
    "window.__koduPruebas = [{ id: 'c1', prueba: function (t) { return { ok: true, detalle: 'ok' }; } }];",
  );
});

await prueba('aislarPruebasKit: un <script data-kodu-pruebas> ya separado se envuelve entero', () => {
  const html = documento(`
    <script>function reiniciar() {}</script>
    <script data-kodu-pruebas>window.__koduPruebas = [{ id: 'c1', prueba: function (t) { return { ok: true }; } }];</script>
  `);
  const resultado = aislarPruebasKit(html);
  const separados = scriptsDePruebas(resultado);
  assert.equal(separados.length, 1);
  const fuente = fuenteEnvuelta(separados[0]!);
  assert.equal(
    fuente,
    "window.__koduPruebas = [{ id: 'c1', prueba: function (t) { return { ok: true }; } }];",
  );
});

await prueba('aislarPruebasKit: varios <script data-kodu-pruebas> se envuelven todos, sin ambigüedad entre ellos', () => {
  const html = documento(`
    <script data-kodu-pruebas>window.__koduPruebas = [{ id: 'a', prueba: function () { return { ok: true }; } }];</script>
    <script data-kodu-pruebas>window.__koduPruebas = [{ id: 'b', prueba: function () { return { ok: false }; } }];</script>
  `);
  const resultado = aislarPruebasKit(html);
  const separados = scriptsDePruebas(resultado);
  assert.equal(separados.length, 2);
  assert.ok(fuenteEnvuelta(separados[0]!).includes("id: 'a'"));
  assert.ok(fuenteEnvuelta(separados[1]!).includes("id: 'b'"));
});

// ── Strings, templates y comentarios: la mención sola no cuenta ──────────

await prueba('aislarPruebasKit: la mención en un comentario no dispara nada', () => {
  const html = documento(`
    <script>
      // acordate de mirar window.__koduPruebas si algo falla
      function reiniciar() {}
    </script>
  `);
  const resultado = aislarPruebasKit(html);
  assert.equal(resultado, html, 'una mención en un comentario no debería cambiar nada');
});

await prueba('aislarPruebasKit: la mención dentro de un string no dispara nada', () => {
  const html = documento(`
    <script>
      var mensaje = "revisá window.__koduPruebas = [] si el checklist no corre";
      function reiniciar() {}
    </script>
  `);
  const resultado = aislarPruebasKit(html);
  assert.equal(resultado, html);
});

await prueba('aislarPruebasKit: la mención dentro de un template literal (con ${}) no dispara nada', () => {
  const html = documento(`
    <script>
      var n = 3;
      var mensaje = \`hay \${n} pruebas en window.__koduPruebas = [\${n}]\`;
      function reiniciar() {}
    </script>
  `);
  const resultado = aislarPruebasKit(html);
  assert.equal(resultado, html);
});

await prueba('aislarPruebasKit: una LECTURA (no asignación) de window.__koduPruebas no dispara nada', () => {
  const html = documento(`
    <script>
      function reiniciar() {}
      if (typeof window.__koduPruebas !== 'undefined') { console.log(window.__koduPruebas.length); }
    </script>
  `);
  const resultado = aislarPruebasKit(html);
  assert.equal(resultado, html, 'una lectura nunca es un candidato ni una ambigüedad');
});

// ── Ambigüedad: deja TODO el HTML sin tocar ──────────────────────────────

await prueba('aislarPruebasKit: dos asignaciones en el mismo script es ambiguo (sin tocar nada)', () => {
  const html = documento(`
    <script>
      window.__koduPruebas = [{ id: 'a', prueba: function () { return { ok: true }; } }];
      window.__koduPruebas = [{ id: 'b', prueba: function () { return { ok: true }; } }];
    </script>
  `);
  const resultado = aislarPruebasKit(html);
  assert.equal(resultado, html);
});

await prueba('aislarPruebasKit: una asignación ANIDADA (no top-level) es ambigua (sin tocar nada)', () => {
  const html = documento(`
    <script>
      function armar() {
        window.__koduPruebas = [{ id: 'a', prueba: function () { return { ok: true }; } }];
      }
      armar();
    </script>
  `);
  const resultado = aislarPruebasKit(html);
  assert.equal(resultado, html);
});

await prueba('aislarPruebasKit: un arreglo sin cerrar (corchete desbalanceado) es ambiguo', () => {
  const html = documento(`
    <script>
      window.__koduPruebas = [{ id: 'a', prueba: function () { return { ok: true }; } };
      function reiniciar() {}
    </script>
  `);
  const resultado = aislarPruebasKit(html);
  assert.equal(resultado, html);
});

await prueba('aislarPruebasKit: el lado derecho no es un arreglo es ambiguo', () => {
  const html = documento(`
    <script>
      window.__koduPruebas = construirPruebas();
      function construirPruebas() { return []; }
    </script>
  `);
  const resultado = aislarPruebasKit(html);
  assert.equal(resultado, html);
});

await prueba('aislarPruebasKit: duda regex-vs-división deja el HTML sin tocar', () => {
  // Una división real cortada en dos líneas DENTRO de lo que el escáner
  // podría confundir con el inicio de un regex (después de un operador):
  // sin cerrar en la misma línea, el escaneo del "regex" nunca cierra.
  const html = documento(`
    <script>
      var a = 10, b = 2, c = 4;
      var raro = a + /
      b;
      window.__koduPruebas = [{ id: 'a', prueba: function () { return { ok: true }; } }];
    </script>
  `);
  const resultado = aislarPruebasKit(html);
  assert.equal(resultado, html);
});

// ── Idempotencia ──────────────────────────────────────────────────────────

await prueba('aislarPruebasKit es idempotente sobre una extracción', () => {
  const html = documento(`
    <script>
      function reiniciar() {}
      window.__koduPruebas = [{ id: 'c1', prueba: function () { return { ok: true }; } }];
    </script>
  `);
  const una = aislarPruebasKit(html);
  const dos = aislarPruebasKit(una);
  assert.equal(dos, una);
});

await prueba('aislarPruebasKit es idempotente sobre un script ya separado', () => {
  const html = documento(`
    <script>function reiniciar() {}</script>
    <script data-kodu-pruebas>window.__koduPruebas = [{ id: 'c1', prueba: function () { return { ok: true }; } }];</script>
  `);
  const una = aislarPruebasKit(html);
  const dos = aislarPruebasKit(una);
  assert.equal(dos, una);
});

// ── El bloque canónico del kit nunca se toca ─────────────────────────────

await prueba('aislarPruebasKit: el bloque canónico del kit queda byte a byte intacto', () => {
  const html = documento(`
    <script>
      function reiniciar() {}
      window.__koduPruebas = [{ id: 'c1', prueba: function () { return { ok: true }; } }];
    </script>
  `);
  const resultado = aislarPruebasKit(html);
  assert.ok(resultado.includes(bloqueKit('cuaderno')), 'el bloque canónico tiene que seguir byte a byte igual');
});

await prueba('aislarPruebasKit: un HTML sin ningún __koduPruebas no cambia', () => {
  const html = documento('<p>Hola</p><script>function reiniciar() {}</script>');
  const resultado = aislarPruebasKit(html);
  assert.equal(resultado, html);
});

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad-pruebas-aisladas.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/unidad-pruebas-aisladas.ts: todas las pruebas pasaron');
}
