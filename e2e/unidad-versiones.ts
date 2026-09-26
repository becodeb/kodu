import assert from 'node:assert/strict';
import {
  DEFAULT_HTML,
  contenidoMensajeDeVersiones,
  directivaDeVersion,
  esRecursoInicial,
  variantesEfectivas,
  MENSAJE_VERSIONES_LISTAS,
} from '../src/lib/ai/versiones.ts';

/**
 * Pruebas unitarias de las partes puras de T9 ("Varias versiones al crear
 * un recurso"): elegibilidad (`variantesEfectivas`), si el recurso todavía
 * es el de arranque (`esRecursoInicial`), las directivas por versión
 * (`directivaDeVersion`) y la elección del contenido del mensaje fijo
 * (`contenidoMensajeDeVersiones`).
 *
 * Archivo separado, DB-free, mismo patrón que e2e/unidad-kit.ts:
 * `lib/ai/versiones.ts` es puro (nada de Prisma, nada de red, nada de
 * `env.ts`) y no hace falta levantar nada para probarlo.
 *
 * `node:assert/strict` + `tsx`. Ejecutar con:
 *   npx tsx e2e/unidad-versiones.ts
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
// esRecursoInicial
// ─────────────────────────────────────────────────────────────

await prueba('esRecursoInicial: el HTML de arranque exacto → true', () => {
  assert.equal(esRecursoInicial(DEFAULT_HTML), true);
});

await prueba('esRecursoInicial: string vacío → true', () => {
  assert.equal(esRecursoInicial(''), true);
});

await prueba('esRecursoInicial: sólo espacios en blanco → true', () => {
  assert.equal(esRecursoInicial('   \n\t  '), true);
});

await prueba('esRecursoInicial: un recurso real (con contenido del docente) → false', () => {
  assert.equal(
    esRecursoInicial('<!DOCTYPE html><html><body><h1>Tabla del 7</h1></body></html>'),
    false,
  );
});

await prueba('esRecursoInicial: el de arranque con un solo caracter de más → false', () => {
  assert.equal(esRecursoInicial(`${DEFAULT_HTML} `), false);
});

// ─────────────────────────────────────────────────────────────
// variantesEfectivas — tabla de verdad: capacidad × recurso inicial × pedido
// ─────────────────────────────────────────────────────────────

await prueba('variantesEfectivas: las tres condiciones juntas → 3', () => {
  assert.equal(
    variantesEfectivas({ puedePedirVersiones: true, esRecursoInicial: true, variantsPedidas: 3 }),
    3,
  );
});

await prueba('variantesEfectivas: sin capacidad (aunque el resto de todo bien) → 1', () => {
  assert.equal(
    variantesEfectivas({ puedePedirVersiones: false, esRecursoInicial: true, variantsPedidas: 3 }),
    1,
  );
});

await prueba('variantesEfectivas: recurso ya no inicial (aunque tenga capacidad y lo pida) → 1', () => {
  assert.equal(
    variantesEfectivas({ puedePedirVersiones: true, esRecursoInicial: false, variantsPedidas: 3 }),
    1,
  );
});

await prueba('variantesEfectivas: no lo pidió (variantsPedidas ausente) → 1', () => {
  assert.equal(
    variantesEfectivas({ puedePedirVersiones: true, esRecursoInicial: true, variantsPedidas: undefined }),
    1,
  );
});

await prueba('variantesEfectivas: pidió explícitamente 1 → 1', () => {
  assert.equal(
    variantesEfectivas({ puedePedirVersiones: true, esRecursoInicial: true, variantsPedidas: 1 }),
    1,
  );
});

await prueba('variantesEfectivas: ninguna de las tres condiciones → 1', () => {
  assert.equal(
    variantesEfectivas({ puedePedirVersiones: false, esRecursoInicial: false, variantsPedidas: undefined }),
    1,
  );
});

await prueba('variantesEfectivas: capacidad sola, sin recurso inicial ni pedido → 1', () => {
  assert.equal(
    variantesEfectivas({ puedePedirVersiones: true, esRecursoInicial: false, variantsPedidas: undefined }),
    1,
  );
});

await prueba('variantesEfectivas: recurso inicial solo, sin capacidad ni pedido → 1', () => {
  assert.equal(
    variantesEfectivas({ puedePedirVersiones: false, esRecursoInicial: true, variantsPedidas: undefined }),
    1,
  );
});

await prueba('variantesEfectivas: capacidad + recurso inicial, pero no lo pidió → 1', () => {
  assert.equal(
    variantesEfectivas({ puedePedirVersiones: true, esRecursoInicial: true, variantsPedidas: undefined }),
    1,
  );
});

// ─────────────────────────────────────────────────────────────
// directivaDeVersion
// ─────────────────────────────────────────────────────────────

await prueba('directivaDeVersion: las tres mencionan "versión N de 3" y "que se note distinta"', () => {
  for (const indice of [1, 2, 3] as const) {
    const texto = directivaDeVersion(indice);
    assert.match(texto, new RegExp(`versión ${indice} de 3`, 'i'));
    assert.match(texto, /que se note distinta/i);
  }
});

await prueba('directivaDeVersion(1): pide una frase de presentación para el chat', () => {
  const texto = directivaDeVersion(1);
  assert.match(texto, /una sola oración/i);
  assert.match(texto, /versiones distintas/i);
  // La 1 NO lleva el enfoque de la 2 ni de la 3.
  assert.doesNotMatch(texto, /priorizá lo visual/i);
  assert.doesNotMatch(texto, /priorizá el juego/i);
});

await prueba('directivaDeVersion(2): prioriza lo visual', () => {
  const texto = directivaDeVersion(2);
  assert.match(texto, /priorizá lo visual/i);
  assert.match(texto, /dibujo o diagrama/i);
});

await prueba('directivaDeVersion(3): prioriza el juego', () => {
  const texto = directivaDeVersion(3);
  assert.match(texto, /priorizá el juego/i);
  assert.match(texto, /puntaje o tiempo/i);
});

await prueba('directivaDeVersion: las tres son distintas entre sí', () => {
  const [d1, d2, d3] = [directivaDeVersion(1), directivaDeVersion(2), directivaDeVersion(3)];
  assert.notEqual(d1, d2);
  assert.notEqual(d1, d3);
  assert.notEqual(d2, d3);
});

// ─────────────────────────────────────────────────────────────
// contenidoMensajeDeVersiones — elección del contenido del mensaje
// ─────────────────────────────────────────────────────────────

await prueba('contenidoMensajeDeVersiones: hubo versión 1 → el texto fijo', () => {
  assert.equal(contenidoMensajeDeVersiones(true), MENSAJE_VERSIONES_LISTAS);
});

await prueba('contenidoMensajeDeVersiones: no hubo versión 1 (falló como cualquier turno) → null', () => {
  assert.equal(contenidoMensajeDeVersiones(false), null);
});

await prueba('contenidoMensajeDeVersiones: el texto fijo no es un texto vacío ni menciona "prime"', () => {
  assert.ok(MENSAJE_VERSIONES_LISTAS.trim().length > 0);
  assert.doesNotMatch(MENSAJE_VERSIONES_LISTAS, /prime/i);
});

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad-versiones.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/unidad-versiones.ts: todas las pruebas pasaron');
}
