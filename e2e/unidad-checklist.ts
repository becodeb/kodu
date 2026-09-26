import assert from 'node:assert/strict';
import {
  bloqueChecklistParaAjuste,
  bloqueChecklistParaGenerar,
  construirMensajesChecklist,
  leerChecklist,
  MARCADOR_SISTEMA_CHECKLIST,
  parsearChecklist,
  serializarChecklist,
  type ItemChecklist,
} from '../src/lib/ai/checklist.ts';

/**
 * Pruebas unitarias del checklist del docente (round 4 de `arnes-robustez`,
 * T16) — `src/lib/ai/checklist.ts`.
 *
 * Archivo separado de `e2e/unidad.ts` a propósito, mismo criterio que
 * `unidad-kit.ts`: `checklist.ts` es isomórfico (sin Prisma, sin Node más
 * allá de lo que ya trae el runtime, sin `env.ts` en runtime — el único
 * import es el TIPO `ChatMessage`, que se borra al compilar) y estas
 * pruebas no necesitan la base de datos para nada.
 *
 * `node:assert/strict` + `tsx`. Ejecutar con: npx tsx e2e/unidad-checklist.ts
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
// construirMensajesChecklist
// ─────────────────────────────────────────────────────────────

await prueba('construirMensajesChecklist: system con el marcador estable, user con el pedido crudo', () => {
  const mensajes = construirMensajesChecklist('Necesito un simulador de fracciones equivalentes');
  assert.equal(mensajes.length, 2);
  assert.equal(mensajes[0]!.role, 'system');
  assert.ok(
    typeof mensajes[0]!.content === 'string' && mensajes[0]!.content.includes(MARCADOR_SISTEMA_CHECKLIST),
    'el system prompt tiene que llevar el marcador que usa el mock para reconocer esta llamada',
  );
  assert.deepEqual(mensajes[1], { role: 'user', content: 'Necesito un simulador de fracciones equivalentes' });
});

// ─────────────────────────────────────────────────────────────
// parsearChecklist
// ─────────────────────────────────────────────────────────────

await prueba('parsearChecklist: líneas con "- " se leen y numeran c1, c2, c3', () => {
  const items = parsearChecklist(
    '- Si pinto 1/2 y 3/6, dice que son equivalentes.\n- Mover dos datos no cumple el desafío 1.\n- A 45° el alcance es máximo.',
  );
  assert.deepEqual(items, [
    { id: 'c1', texto: 'Si pinto 1/2 y 3/6, dice que son equivalentes.' },
    { id: 'c2', texto: 'Mover dos datos no cumple el desafío 1.' },
    { id: 'c3', texto: 'A 45° el alcance es máximo.' },
  ]);
});

await prueba('parsearChecklist: acepta "* " y "1. " (cualquier número) como prefijo', () => {
  const items = parsearChecklist('* Primer ítem observable.\n2. Segundo ítem observable.\n10. Tercer ítem observable.');
  assert.deepEqual(items.map((i) => i.texto), [
    'Primer ítem observable.',
    'Segundo ítem observable.',
    'Tercer ítem observable.',
  ]);
  assert.deepEqual(items.map((i) => i.id), ['c1', 'c2', 'c3']);
});

await prueba('parsearChecklist: una línea sin prefijo se descarta ENTERA, no se le sacan las primeras palabras', () => {
  const items = parsearChecklist(
    'Acá tenés el checklist:\n- Primer ítem observable.\n- Segundo ítem observable.\nGracias.',
  );
  assert.deepEqual(items.map((i) => i.texto), ['Primer ítem observable.', 'Segundo ítem observable.']);
});

await prueba('parsearChecklist: descarta líneas vacías y líneas de más de 200 caracteres', () => {
  const larga = '- ' + 'x'.repeat(201);
  const items = parsearChecklist(`- Primer ítem observable.\n-   \n${larga}\n- Segundo ítem observable.`);
  assert.deepEqual(items.map((i) => i.texto), ['Primer ítem observable.', 'Segundo ítem observable.']);
});

await prueba('parsearChecklist: tope de 6 ítems aunque el modelo mande más', () => {
  const lineas = Array.from({ length: 9 }, (_, i) => `- Ítem observable número ${i + 1}.`);
  const items = parsearChecklist(lineas.join('\n'));
  assert.equal(items.length, 6);
  assert.deepEqual(items.map((i) => i.id), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
  assert.equal(items[0]!.texto, 'Ítem observable número 1.');
  assert.equal(items[5]!.texto, 'Ítem observable número 6.');
});

await prueba('parsearChecklist: con menos de 2 ítems válidos, [] entero (ni el único que sí valía)', () => {
  assert.deepEqual(parsearChecklist('- Un solo ítem observable.'), []);
  assert.deepEqual(parsearChecklist('Ni un ítem con el prefijo correcto.'), []);
  assert.deepEqual(parsearChecklist(''), []);
});

await prueba('parsearChecklist: exactamente 2 ítems válidos SÍ alcanza', () => {
  const items = parsearChecklist('- Primer ítem observable.\n- Segundo ítem observable.');
  assert.equal(items.length, 2);
});

// ─────────────────────────────────────────────────────────────
// serializarChecklist / leerChecklist
// ─────────────────────────────────────────────────────────────

const ITEMS_DE_PRUEBA: ItemChecklist[] = [
  { id: 'c1', texto: 'Si pinto 1/2 y 3/6, dice que son equivalentes.' },
  { id: 'c2', texto: 'Mover dos datos no cumple el desafío 1.' },
];

await prueba('serializarChecklist + leerChecklist: viaje de ida y vuelta sin pérdidas', () => {
  assert.deepEqual(leerChecklist(serializarChecklist(ITEMS_DE_PRUEBA)), ITEMS_DE_PRUEBA);
});

await prueba('leerChecklist: null o vacío es "sin checklist", nunca tira', () => {
  assert.deepEqual(leerChecklist(null), []);
  assert.deepEqual(leerChecklist(''), []);
});

await prueba('leerChecklist: JSON corrupto es "sin checklist", nunca tira', () => {
  assert.deepEqual(leerChecklist('{esto no es JSON válido'), []);
});

await prueba('leerChecklist: una forma que no es un array de ítems es "sin checklist"', () => {
  assert.deepEqual(leerChecklist(JSON.stringify({ id: 'c1', texto: 'no es una lista' })), []);
  assert.deepEqual(leerChecklist(JSON.stringify([{ id: 'c1' }])), [], 'a un ítem sin "texto" le falta un campo obligatorio');
  assert.deepEqual(leerChecklist(JSON.stringify(['c1', 'c2'])), [], 'strings sueltos no son ítems');
});

await prueba('leerChecklist: respeta los mismos topes que parsearChecklist (40/200/6)', () => {
  const idDemasiadoLargo = [{ id: 'c'.repeat(41), texto: 'algo' }];
  assert.deepEqual(leerChecklist(JSON.stringify(idDemasiadoLargo)), []);

  const textoDemasiadoLargo = [{ id: 'c1', texto: 'x'.repeat(201) }];
  assert.deepEqual(leerChecklist(JSON.stringify(textoDemasiadoLargo)), []);

  const demasiadosItems = Array.from({ length: 7 }, (_, i) => ({ id: `c${i + 1}`, texto: `ítem ${i + 1}` }));
  assert.deepEqual(leerChecklist(JSON.stringify(demasiadosItems)), []);
});

// ─────────────────────────────────────────────────────────────
// bloqueChecklistParaGenerar / bloqueChecklistParaAjuste
// ─────────────────────────────────────────────────────────────

await prueba('bloqueChecklistParaGenerar: pide window.__koduPruebas y cita cada id con su texto', () => {
  const bloque = bloqueChecklistParaGenerar(ITEMS_DE_PRUEBA);
  assert.ok(bloque.includes('window.__koduPruebas'));
  assert.ok(bloque.includes('c1: Si pinto 1/2 y 3/6, dice que son equivalentes.'));
  assert.ok(bloque.includes('c2: Mover dos datos no cumple el desafío 1.'));
});

await prueba('bloqueChecklistParaAjuste: pide mantener alineado y cita cada id con su texto', () => {
  const bloque = bloqueChecklistParaAjuste(ITEMS_DE_PRUEBA);
  assert.ok(/alinead/i.test(bloque), 'tiene que pedir mantener el checklist alineado, no crearlo de cero');
  assert.ok(bloque.includes('c1: Si pinto 1/2 y 3/6, dice que son equivalentes.'));
  assert.ok(bloque.includes('c2: Mover dos datos no cumple el desafío 1.'));
});

await prueba('bloqueChecklistParaGenerar y bloqueChecklistParaAjuste son textos DISTINTOS', () => {
  assert.notEqual(bloqueChecklistParaGenerar(ITEMS_DE_PRUEBA), bloqueChecklistParaAjuste(ITEMS_DE_PRUEBA));
});

// T23: los recursos sin checklist salían con tests de ids propios (p. ej.
// `prueba-reinicio`) en vez de `c1`/`c2` — el cruce por id de
// `estadoDeChecklist` (src/lib/client/checklist.ts) no encuentra nada y
// deja todo el checklist en "sinPrueba". Los dos bloques ahora piden los
// ids EXACTOS, no sólo "el mismo id".

await prueba('bloqueChecklistParaGenerar: pide los ids EXACTOS, en orden, sin inventar otros', () => {
  const bloque = bloqueChecklistParaGenerar(ITEMS_DE_PRUEBA);
  assert.ok(/exactamente estos ids/i.test(bloque));
  assert.ok(bloque.includes('c1, c2'), 'los ids van en el mismo orden que los ítems');
  assert.ok(/no inventes otros/i.test(bloque));
});

await prueba('bloqueChecklistParaAjuste: pide los ids EXACTOS, en orden, sin inventar otros', () => {
  const bloque = bloqueChecklistParaAjuste(ITEMS_DE_PRUEBA);
  assert.ok(/exactamente estos ids/i.test(bloque));
  assert.ok(bloque.includes('c1, c2'), 'los ids van en el mismo orden que los ítems');
  assert.ok(/no inventes otros/i.test(bloque));
});

await prueba('bloqueChecklistParaGenerar: la lista de ids sigue el orden de los ítems, no orden alfabético', () => {
  const itemsDesordenados: ItemChecklist[] = [
    { id: 'c3', texto: 'tercer ítem' },
    { id: 'c1', texto: 'primer ítem' },
  ];
  const bloque = bloqueChecklistParaGenerar(itemsDesordenados);
  assert.ok(bloque.includes('c3, c1'), 'la lista de ids respeta el orden recibido, no lo reordena');
});

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad-checklist.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/unidad-checklist.ts: todas las pruebas pasaron');
}
