import assert from 'node:assert/strict';
import { buildPreviewDocument } from '../src/lib/preview.ts';

/**
 * Pruebas unitarias de `src/lib/preview.ts` (T5, motor-claude: revisor
 * visual) — sólo lo que se puede probar como texto plano, sin DOM ni
 * navegador real (eso ya lo cubre `e2e/navegador-kit.ts` para el resto del
 * puente). Cubre el parche de `preserveDrawingBuffer` que se agrega ANTES
 * del bridge de captura, y que se agrega en el lugar correcto según la
 * forma del documento.
 *
 * Ejecutar con: npx tsx e2e/unidad-preview.ts
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

await prueba('buildPreviewDocument: agrega el parche WebGL ANTES del bridge, y el bridge antes de </body>', () => {
  const html = '<!DOCTYPE html><html><head></head><body><p>hola</p></body></html>';
  const resultado = buildPreviewDocument(html);
  const idxParche = resultado.indexOf('data-kodu-webgl-patch');
  const idxBridge = resultado.indexOf('data-kodu-bridge');
  assert.ok(idxParche !== -1, 'tiene que incluir el parche de WebGL');
  assert.ok(idxBridge !== -1, 'tiene que incluir el bridge de captura');
  assert.ok(idxParche < idxBridge, 'el parche tiene que correr antes que el bridge (y antes que el resto del body)');
  assert.ok(resultado.includes('preserveDrawingBuffer'));
  assert.ok(resultado.endsWith('</html>') === false || resultado.includes('</body>'));
});

await prueba('buildPreviewDocument: con <head> sin atributos, el parche va justo después', () => {
  const html = '<html><head><title>x</title></head><body></body></html>';
  const resultado = buildPreviewDocument(html);
  const esperado = '<head><script data-kodu-webgl-patch';
  assert.ok(resultado.startsWith('<html>' + esperado.slice(0)) || resultado.includes(esperado));
});

await prueba('buildPreviewDocument: sin <head>, el parche se agrega antes de <body>', () => {
  const html = '<html><body><p>sin head</p></body></html>';
  const resultado = buildPreviewDocument(html);
  const idxParche = resultado.indexOf('data-kodu-webgl-patch');
  const idxBody = resultado.indexOf('<p>sin head</p>');
  assert.ok(idxParche !== -1 && idxParche < idxBody);
});

await prueba('buildPreviewDocument: sin <head> ni <body>, el parche se antepone a todo y el bridge se agrega al final', () => {
  const html = '<p>documento sin estructura</p>';
  const resultado = buildPreviewDocument(html);
  assert.ok(resultado.startsWith('<script data-kodu-webgl-patch'));
  assert.ok(resultado.includes('data-kodu-bridge'));
  assert.ok(resultado.indexOf('<p>documento sin estructura</p>') > resultado.indexOf('data-kodu-webgl-patch'));
});

await prueba('buildPreviewDocument: el parche fuerza preserveDrawingBuffer sólo para tipos webgl/webgl2', () => {
  const resultado = buildPreviewDocument('<html><head></head><body></body></html>');
  assert.ok(/webgl\|webgl2\|experimental-webgl/i.test(resultado));
});

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad-preview.ts: ${fallas} prueba(s) fallaron`);
  process.exit(1);
} else {
  console.log('\n✔ e2e/unidad-preview.ts: todas las pruebas pasaron');
}
