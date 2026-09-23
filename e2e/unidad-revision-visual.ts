import assert from 'node:assert/strict';
import {
  aplicaRevisionVisual,
  fingerprintHtml,
  validarImagenRevisionVisual,
} from '../src/lib/ai/revision-visual.ts';

/**
 * Pruebas unitarias de las partes puras de T8 ("Revisión visual con
 * captura", odd/tasks/modo-prime.md): la política (`aplicaRevisionVisual`),
 * la huella (`fingerprintHtml`) y la validación de la imagen
 * (`validarImagenRevisionVisual`).
 *
 * Archivo separado, DB-free, mismo patrón que e2e/unidad-kit.ts y
 * e2e/unidad-revision.ts: los tres módulos son puros (nada de Prisma, nada
 * de red, nada de `env.ts`) y no hace falta levantar nada para probarlos.
 *
 * `node:assert/strict` + `tsx`. Ejecutar con:
 *   npx tsx e2e/unidad-revision-visual.ts
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
// aplicaRevisionVisual — la política
// ─────────────────────────────────────────────────────────────

const BASE_OK = {
  velocidadEfectiva: 'deep' as const,
  motorVeImagenes: true,
  cambioElRecurso: true,
  huboVariasVersiones: false,
};

await prueba('aplicaRevisionVisual: las cuatro condiciones juntas → true', () => {
  assert.equal(aplicaRevisionVisual(BASE_OK), true);
});

await prueba('aplicaRevisionVisual: Rápido (velocidad !== "deep") → false', () => {
  assert.equal(aplicaRevisionVisual({ ...BASE_OK, velocidadEfectiva: 'fast' }), false);
});

await prueba('aplicaRevisionVisual: sin permiso de elegir velocidad (null) → false', () => {
  assert.equal(aplicaRevisionVisual({ ...BASE_OK, velocidadEfectiva: null }), false);
});

await prueba('aplicaRevisionVisual: el motor no ve imágenes → false', () => {
  assert.equal(aplicaRevisionVisual({ ...BASE_OK, motorVeImagenes: false }), false);
});

await prueba('aplicaRevisionVisual: el turno no cambió el recurso → false', () => {
  assert.equal(aplicaRevisionVisual({ ...BASE_OK, cambioElRecurso: false }), false);
});

await prueba('aplicaRevisionVisual: hook T9 — varias versiones → false', () => {
  assert.equal(aplicaRevisionVisual({ ...BASE_OK, huboVariasVersiones: true }), false);
});

// ─────────────────────────────────────────────────────────────
// fingerprintHtml — la huella
// ─────────────────────────────────────────────────────────────

await prueba('fingerprintHtml: el mismo HTML da siempre la misma huella', () => {
  const html = '<!DOCTYPE html><html><body><h1>Hola</h1></body></html>';
  assert.equal(fingerprintHtml(html), fingerprintHtml(html));
});

await prueba('fingerprintHtml: HTML distinto da huellas distintas', () => {
  const a = '<!DOCTYPE html><html><body><h1>Hola</h1></body></html>';
  const b = '<!DOCTYPE html><html><body><h1>Chau</h1></body></html>';
  assert.notEqual(fingerprintHtml(a), fingerprintHtml(b));
});

await prueba('fingerprintHtml: un solo caracter de diferencia ya cambia la huella', () => {
  const a = 'x'.repeat(500) + 'a';
  const b = 'x'.repeat(500) + 'b';
  assert.notEqual(fingerprintHtml(a), fingerprintHtml(b));
});

await prueba('fingerprintHtml: hex de 8 dígitos, siempre', () => {
  for (const html of ['', 'a', '<html></html>', 'á é í ó ú ñ 🎉']) {
    assert.match(fingerprintHtml(html), /^[0-9a-f]{8}$/, `huella de ${JSON.stringify(html)}`);
  }
});

await prueba('fingerprintHtml: string vacío no explota', () => {
  assert.match(fingerprintHtml(''), /^[0-9a-f]{8}$/);
});

// ─────────────────────────────────────────────────────────────
// validarImagenRevisionVisual — la validación de la imagen
// ─────────────────────────────────────────────────────────────

/** Un data URL válido y chico, para no depender de un archivo real. */
function dataUrlDe(mime: string, bytes = 100): string {
  return `data:${mime};base64,${Buffer.alloc(bytes, 1).toString('base64')}`;
}

await prueba('validarImagenRevisionVisual: acepta PNG', () => {
  const resultado = validarImagenRevisionVisual(dataUrlDe('image/png'));
  assert.ok(resultado);
  assert.equal(resultado!.mime, 'image/png');
});

await prueba('validarImagenRevisionVisual: acepta JPEG', () => {
  const resultado = validarImagenRevisionVisual(dataUrlDe('image/jpeg'));
  assert.ok(resultado);
  assert.equal(resultado!.mime, 'image/jpeg');
});

await prueba('validarImagenRevisionVisual: acepta WebP', () => {
  const resultado = validarImagenRevisionVisual(dataUrlDe('image/webp'));
  assert.ok(resultado);
  assert.equal(resultado!.mime, 'image/webp');
});

await prueba('validarImagenRevisionVisual: decodifica los bytes reales', () => {
  const resultado = validarImagenRevisionVisual(dataUrlDe('image/png', 250));
  assert.ok(resultado);
  assert.equal(resultado!.data.byteLength, 250);
});

await prueba('validarImagenRevisionVisual: rechaza un tipo no admitido (GIF)', () => {
  assert.equal(validarImagenRevisionVisual(dataUrlDe('image/gif')), null);
});

await prueba('validarImagenRevisionVisual: rechaza algo que no es un data URL', () => {
  assert.equal(validarImagenRevisionVisual('https://ejemplo.com/captura.png'), null);
  assert.equal(validarImagenRevisionVisual('no es nada de esto'), null);
});

await prueba('validarImagenRevisionVisual: rechaza un data URL vacío de contenido', () => {
  assert.equal(validarImagenRevisionVisual('data:image/png;base64,'), null);
});

await prueba('validarImagenRevisionVisual: rechaza por encima del tope de tamaño', () => {
  // > 6 MB decodificados: un poco más de 6*1024*1024*4/3 caracteres base64.
  const enorme = `data:image/jpeg;base64,${'A'.repeat(8_400_000)}`;
  assert.equal(validarImagenRevisionVisual(enorme), null);
});

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad-revision-visual.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/unidad-revision-visual.ts: todas las pruebas pasaron');
}
