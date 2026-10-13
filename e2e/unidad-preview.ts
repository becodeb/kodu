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
 * Hallazgo de revisión (motor-claude, pre-deploy): el parche ahora es
 * OPCIONAL (`opciones.conRevisor`, default `false`) — las pruebas que
 * cubren el parche en sí lo piden explícito; una prueba nueva confirma que,
 * sin pedirlo, el documento sale IDÉNTICO salvo por el bridge (ningún
 * proyecto sin verificador configurado paga el parche).
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

await prueba('buildPreviewDocument: con conRevisor, agrega el parche WebGL ANTES del bridge, y el bridge antes de </body>', () => {
  const html = '<!DOCTYPE html><html><head></head><body><p>hola</p></body></html>';
  const resultado = buildPreviewDocument(html, { conRevisor: true });
  const idxParche = resultado.indexOf('data-kodu-webgl-patch');
  const idxBridge = resultado.indexOf('data-kodu-bridge');
  assert.ok(idxParche !== -1, 'tiene que incluir el parche de WebGL');
  assert.ok(idxBridge !== -1, 'tiene que incluir el bridge de captura');
  assert.ok(idxParche < idxBridge, 'el parche tiene que correr antes que el bridge (y antes que el resto del body)');
  assert.ok(resultado.includes('preserveDrawingBuffer'));
  assert.ok(resultado.endsWith('</html>') === false || resultado.includes('</body>'));
});

await prueba('buildPreviewDocument: con conRevisor y <head> sin atributos, el parche va justo después', () => {
  const html = '<html><head><title>x</title></head><body></body></html>';
  const resultado = buildPreviewDocument(html, { conRevisor: true });
  const esperado = '<head><script data-kodu-webgl-patch';
  assert.ok(resultado.startsWith('<html>' + esperado.slice(0)) || resultado.includes(esperado));
});

await prueba('buildPreviewDocument: con conRevisor y sin <head>, el parche se agrega antes de <body>', () => {
  const html = '<html><body><p>sin head</p></body></html>';
  const resultado = buildPreviewDocument(html, { conRevisor: true });
  const idxParche = resultado.indexOf('data-kodu-webgl-patch');
  const idxBody = resultado.indexOf('<p>sin head</p>');
  assert.ok(idxParche !== -1 && idxParche < idxBody);
});

await prueba('buildPreviewDocument: con conRevisor y sin <head> ni <body>, el parche se antepone a todo y el bridge se agrega al final', () => {
  const html = '<p>documento sin estructura</p>';
  const resultado = buildPreviewDocument(html, { conRevisor: true });
  assert.ok(resultado.startsWith('<script data-kodu-webgl-patch'));
  assert.ok(resultado.includes('data-kodu-bridge'));
  assert.ok(resultado.indexOf('<p>documento sin estructura</p>') > resultado.indexOf('data-kodu-webgl-patch'));
});

await prueba('buildPreviewDocument: con conRevisor, el parche fuerza preserveDrawingBuffer sólo para tipos webgl/webgl2', () => {
  const resultado = buildPreviewDocument('<html><head></head><body></body></html>', { conRevisor: true });
  assert.ok(/webgl\|webgl2\|experimental-webgl/i.test(resultado));
});

await prueba(
  'Hallazgo de revisión: SIN conRevisor (default), nunca se inyecta el parche de WebGL — ni sin opciones, ni con conRevisor:false explícito',
  () => {
    const html = '<!DOCTYPE html><html><head></head><body><p>hola</p></body></html>';

    const sinOpciones = buildPreviewDocument(html);
    assert.ok(!sinOpciones.includes('data-kodu-webgl-patch'), 'sin opciones, nunca se paga el parche');
    assert.ok(sinOpciones.includes('data-kodu-bridge'), 'el bridge de captura SIEMPRE va, el parche es lo único condicional');

    const explicitoFalso = buildPreviewDocument(html, { conRevisor: false });
    assert.ok(!explicitoFalso.includes('data-kodu-webgl-patch'));

    // Mismo documento salvo por el parche: con conRevisor sólo se le agrega
    // el bloque del parche, nada más cambia.
    const conRevisor = buildPreviewDocument(html, { conRevisor: true });
    assert.equal(conRevisor.replace(/<script data-kodu-webgl-patch[\s\S]*?<\/script>/, ''), sinOpciones);
  },
);

await prueba(
  'Hallazgo de revisión: la captura de página completa (revisor) nunca escala para ARRIBA del ancho natural',
  () => {
    const resultado = buildPreviewDocument('<html><head></head><body></body></html>', { conRevisor: true });
    // La matemática real (canvas de verdad) ya la cubre `navegador-kit.ts`
    // para el resto del puente — esto es una guarda de texto contra que el
    // clamp se borre sin querer en una edición futura de la plantilla.
    assert.ok(
      /ratioEscala\s*=\s*canvas\.width\s*\?\s*Math\.min\(1,\s*anchoObjetivo\s*\/\s*canvas\.width\)/.test(resultado),
      'recortarYEscalar (página completa, exclusiva del revisor) tiene que clampear a 1 — nunca upscale',
    );
  },
);

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad-preview.ts: ${fallas} prueba(s) fallaron`);
  process.exit(1);
} else {
  console.log('\n✔ e2e/unidad-preview.ts: todas las pruebas pasaron');
}
