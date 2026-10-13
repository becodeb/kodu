import assert from 'node:assert/strict';
import {
  computarDiffTurno,
  detectarBanderasRojas,
  resumenDiffParaRevisor,
  UMBRAL_TEXTO_TRIVIAL,
  type DiffTurno,
} from '../src/lib/ai/turno-diff.ts';
import { buildCurrentResourceBlock } from '../src/lib/ai/prompt.ts';
import { problemaDeBanderaRoja } from '../src/lib/ai/verificador.ts';

/**
 * Pruebas unitarias de T4 round 6 (motor-claude, `odd/tasks/motor-claude.md`):
 * `src/lib/ai/turno-diff.ts` (diff compacto + banderas rojas determinísticas)
 * y la guía por pedido puntual que `buildCurrentResourceBlock` (`prompt.ts`)
 * agrega cuando `editsEnabled` es `true`.
 *
 * Mismo patrón que `unidad-edicion-fragmentos.ts`/`unidad-verificador.ts`:
 * `node:assert/strict` + `tsx`, sin DB ni servidor.
 *
 * Ejecutar con: npx tsx e2e/unidad-turno-diff.ts
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

function pagina(body: string, scripts = ''): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${body}${
    scripts ? `<script>${scripts}</script>` : ''
  }</body></html>`;
}

// ─────────────────────────────────────────────────────────────
// computarDiffTurno
// ─────────────────────────────────────────────────────────────

await prueba('computarDiffTurno: sin cambios, todo en cero', () => {
  const html = pagina('<h1>Título</h1><p>Un párrafo fijo.</p>');
  const diff = computarDiffTurno(html, html);
  assert.equal(diff.charsVisibleAgregados, 0);
  assert.equal(diff.charsVisibleQuitados, 0);
  assert.deepEqual(diff.elementosPorTag, {});
  assert.equal(diff.interactivosAntes, diff.interactivosDespues);
  assert.equal(diff.lineasScriptCambiadas, 0);
  assert.equal(diff.comentariosPromesaNuevos.length, 0);
});

await prueba('computarDiffTurno: agregar texto visible real se mide como agregado', () => {
  const antes = pagina('<h1>Título</h1>');
  const despues = pagina(
    '<h1>Título</h1><p>Pregunta uno: explicá con tus palabras por qué el agua del mar se evapora y forma nubes.</p>',
  );
  const diff = computarDiffTurno(antes, despues);
  assert.ok(diff.charsVisibleAgregados > UMBRAL_TEXTO_TRIVIAL, `esperaba > ${UMBRAL_TEXTO_TRIVIAL}, dio ${diff.charsVisibleAgregados}`);
  assert.equal(diff.charsVisibleQuitados, 0);
});

await prueba('computarDiffTurno: reordenar el MISMO texto no cuenta como agregar', () => {
  const antes = pagina('<p>Uno</p><p>Dos</p><p>Tres</p>');
  const despues = pagina('<p>Tres</p><p>Uno</p><p>Dos</p>');
  const diff = computarDiffTurno(antes, despues);
  assert.equal(diff.charsVisibleAgregados, 0);
  assert.equal(diff.charsVisibleQuitados, 0);
});

await prueba('computarDiffTurno: scripts y estilos no cuentan como texto visible', () => {
  const antes = pagina('<p>Fijo</p>');
  const despues = pagina('<p>Fijo</p>', 'const x = "un valor que no debería contar como texto visible";');
  const diff = computarDiffTurno(antes, despues);
  assert.equal(diff.charsVisibleAgregados, 0);
  assert.ok(diff.lineasScriptCambiadas > 0, 'el script sí tiene que verse como línea de script cambiada');
});

await prueba('computarDiffTurno: nuevos botones suman al delta de la etiqueta y a interactivos', () => {
  const antes = pagina('<button>Uno</button>');
  const despues = pagina('<button>Uno</button><button>Dos</button><button>Tres</button>');
  const diff = computarDiffTurno(antes, despues);
  assert.equal(diff.elementosPorTag.button, 2);
  assert.equal(diff.interactivosAntes, 1);
  assert.equal(diff.interactivosDespues, 3);
});

await prueba('computarDiffTurno: quitar una etiqueta entera da delta negativo', () => {
  const antes = pagina('<input><input><button>Ir</button>');
  const despues = pagina('<button>Ir</button>');
  const diff = computarDiffTurno(antes, despues);
  assert.equal(diff.elementosPorTag.input, -2);
  assert.equal(diff.interactivosAntes, 3);
  assert.equal(diff.interactivosDespues, 1);
});

await prueba('computarDiffTurno: detecta un comentario nuevo que promete contenido', () => {
  const antes = pagina('<div id="preguntas"></div>');
  const despues = pagina('<!-- las preguntas de repaso se agregan abajo --><div id="preguntas"></div>');
  const diff = computarDiffTurno(antes, despues);
  assert.equal(diff.comentariosPromesaNuevos.length, 1);
  assert.match(diff.comentariosPromesaNuevos[0]!, /se agregan abajo/);
});

await prueba('computarDiffTurno: un comentario que YA estaba antes no cuenta como "nuevo"', () => {
  const html = pagina('<!-- TODO: revisar esto --><p>Fijo</p>');
  const diff = computarDiffTurno(html, html);
  assert.equal(diff.comentariosPromesaNuevos.length, 0);
});

// ─────────────────────────────────────────────────────────────
// detectarBanderasRojas — el caso medido en la ronda 5 (H2 turno 3)
// ─────────────────────────────────────────────────────────────

await prueba('detectarBanderasRojas: "agregá 3 preguntas" sin preguntas nuevas dispara agregar_trivial', () => {
  const antes = pagina('<div id="ciclo"></div>');
  // Mismo defecto medido en la ronda 5: un comentario que promete, una barra
  // vacía, pero NINGUNA pregunta/control nuevo.
  const despues = pagina('<!-- las preguntas de repaso se agregan abajo --><div id="ciclo"></div><div id="barra"></div>');
  const diff = computarDiffTurno(antes, despues);
  const banderas = detectarBanderasRojas('Al final agregá 3 preguntas de repaso', diff);
  const motivos = banderas.map((b) => b.motivo);
  assert.ok(motivos.includes('agregar_trivial'), `esperaba 'agregar_trivial', dio ${JSON.stringify(motivos)}`);
  assert.ok(motivos.includes('comentario_promesa_sin_contenido'), `esperaba también la bandera del comentario, dio ${JSON.stringify(motivos)}`);
});

await prueba('detectarBanderasRojas: "agregá 3 preguntas" CON preguntas reales no dispara nada', () => {
  const antes = pagina('<div id="ciclo"></div>');
  const despues = pagina(
    '<div id="ciclo"></div><div id="preguntas">' +
      '<p>¿Qué es la evaporación?</p><input type="text">' +
      '<p>¿Qué es la condensación?</p><input type="text">' +
      '<p>¿Qué es la precipitación?</p><input type="text">' +
      '</div>',
  );
  const diff = computarDiffTurno(antes, despues);
  const banderas = detectarBanderasRojas('Al final agregá 3 preguntas de repaso', diff);
  assert.deepEqual(banderas, []);
});

await prueba('detectarBanderasRojas: pedido sin palabra clave de agregar no dispara agregar_trivial', () => {
  const antes = pagina('<p>Fijo</p>');
  const despues = pagina('<p>Fijo</p><!-- comentario cualquiera -->');
  const diff = computarDiffTurno(antes, despues);
  const banderas = detectarBanderasRojas('Cambiá el color del botón a verde', diff);
  assert.equal(banderas.find((b) => b.motivo === 'agregar_trivial'), undefined);
});

await prueba('detectarBanderasRojas: "hacelo más corto" sin achicar nada dispara acortar_sin_achicar', () => {
  const antes = pagina('<p>Un párrafo largo con bastante contenido real.</p>');
  const despues = pagina('<p>Un párrafo largo con bastante contenido real.</p><p>Y otro más que no acorta nada.</p>');
  const diff = computarDiffTurno(antes, despues);
  const banderas = detectarBanderasRojas('Hacelo más corto, por favor', diff);
  assert.ok(banderas.some((b) => b.motivo === 'acortar_sin_achicar'));
});

await prueba('detectarBanderasRojas: "hacelo más corto" que sí quita contenido no dispara nada', () => {
  const antes = pagina('<p>Un párrafo largo con bastante contenido real que sobra.</p><p>Otro párrafo.</p>');
  const despues = pagina('<p>Un párrafo corto.</p>');
  const diff = computarDiffTurno(antes, despues);
  const banderas = detectarBanderasRojas('Hacelo más corto, por favor', diff);
  assert.deepEqual(banderas, []);
});

await prueba('detectarBanderasRojas: nunca más de una bandera del mismo motivo', () => {
  const antes = pagina('<div></div>');
  const despues = pagina('<!-- se agregan abajo --><!-- todo: completar --><div></div>');
  const diff = computarDiffTurno(antes, despues);
  const banderas = detectarBanderasRojas('agregá algo', diff);
  const comentarioBanderas = banderas.filter((b) => b.motivo === 'comentario_promesa_sin_contenido');
  assert.equal(comentarioBanderas.length, 1);
});

await prueba('detectarBanderasRojas: acentos no importan ("agregá" normaliza igual que "agrega")', () => {
  const diffVacio: DiffTurno = {
    charsVisibleAgregados: 0,
    charsVisibleQuitados: 0,
    elementosPorTag: {},
    interactivosAntes: 0,
    interactivosDespues: 0,
    lineasScriptCambiadas: 0,
    comentariosPromesaNuevos: [],
  };
  const conAcento = detectarBanderasRojas('Agregá una pregunta más', diffVacio);
  const sinAcento = detectarBanderasRojas('Agrega una pregunta mas', diffVacio);
  assert.equal(conAcento.length, 1);
  assert.equal(sinAcento.length, 1);
  assert.equal(conAcento[0]!.motivo, sinAcento[0]!.motivo);
});

// ─────────────────────────────────────────────────────────────
// resumenDiffParaRevisor — texto compacto para el prompt del revisor
// ─────────────────────────────────────────────────────────────

await prueba('resumenDiffParaRevisor: incluye los cuatro números clave', () => {
  const antes = pagina('<button>Uno</button>');
  const despues = pagina('<button>Uno</button><button>Dos</button><p>Nuevo texto real agregado.</p>');
  const diff = computarDiffTurno(antes, despues);
  const resumen = resumenDiffParaRevisor(diff);
  assert.match(resumen, /Texto visible: \+\d+ \/ -\d+ caracteres\./);
  assert.match(resumen, /button \+1/);
  assert.match(resumen, /Controles interactivos .*: 1 → 2\./);
  assert.match(resumen, /Líneas de <script> cambiadas: 0\./);
});

await prueba('resumenDiffParaRevisor: sin comentarios-promesa no menciona esa línea', () => {
  const html = pagina('<p>Fijo</p>');
  const resumen = resumenDiffParaRevisor(computarDiffTurno(html, html));
  assert.ok(!resumen.includes('prometen contenido'));
});

// ─────────────────────────────────────────────────────────────
// problemaDeBanderaRoja — la misma forma que un Problema del modelo
// ─────────────────────────────────────────────────────────────

await prueba('problemaDeBanderaRoja: gravedad alta, tipo pedido, cita el pedido', () => {
  const bandera = detectarBanderasRojas('Agregá 3 preguntas al final', {
    charsVisibleAgregados: 0,
    charsVisibleQuitados: 0,
    elementosPorTag: {},
    interactivosAntes: 0,
    interactivosDespues: 0,
    lineasScriptCambiadas: 0,
    comentariosPromesaNuevos: [],
  })[0]!;
  const problema = problemaDeBanderaRoja(bandera, 'Agregá 3 preguntas al final');
  assert.equal(problema.gravedad, 'alta');
  assert.equal(problema.tipo, 'pedido');
  assert.match(problema.que, /Agregá 3 preguntas al final/);
  assert.ok(problema.arreglo.length > 0);
});

// ─────────────────────────────────────────────────────────────
// buildCurrentResourceBlock — la guía por pedido puntual (goal B)
// ─────────────────────────────────────────────────────────────

const HTML_BASE = pagina('<p>Recurso existente.</p>');

await prueba('buildCurrentResourceBlock: sin editsEnabled, nunca agrega la guía puntual', () => {
  const bloque = buildCurrentResourceBlock(HTML_BASE, 'Proyecto', false, false, 'Agregá 3 preguntas al final');
  assert.ok(!bloque.includes('Para este pedido puntual'));
});

await prueba('buildCurrentResourceBlock: editsEnabled sin pedido no agrega la guía puntual', () => {
  const bloque = buildCurrentResourceBlock(HTML_BASE, 'Proyecto', false, true);
  assert.ok(!bloque.includes('Para este pedido puntual'));
});

await prueba('buildCurrentResourceBlock: "agregá" dispara la línea de AGREGAR', () => {
  const bloque = buildCurrentResourceBlock(HTML_BASE, 'Proyecto', false, true, 'Agregá 3 preguntas al final');
  assert.ok(bloque.includes('Para este pedido puntual'));
  assert.match(bloque, /Este pedido es de AGREGAR/);
});

await prueba('buildCurrentResourceBlock: "más grande para proyectar" dispara la línea de AGRANDAR', () => {
  const bloque = buildCurrentResourceBlock(HTML_BASE, 'Proyecto', false, true, 'Hacelo más grande para proyectar');
  assert.match(bloque, /Este pedido es de AGRANDAR/);
});

await prueba('buildCurrentResourceBlock: un pedido sin palabras clave no agrega nada nuevo', () => {
  const bloque = buildCurrentResourceBlock(HTML_BASE, 'Proyecto', false, true, 'Decime qué temas cubre este recurso');
  assert.ok(!bloque.includes('Para este pedido puntual'));
});

await prueba('buildCurrentResourceBlock: nunca más de 3 líneas aunque matcheen varias claves', () => {
  const bloque = buildCurrentResourceBlock(
    HTML_BASE,
    'Proyecto',
    false,
    true,
    'Agregá una sección al final, hacelo más grande para proyectar, más corto y cambiá el color y la leyenda',
  );
  const seccion = bloque.split('## Para este pedido puntual\n')[1] ?? '';
  const lineas = seccion.split('\n').filter((l) => l.startsWith('- '));
  assert.ok(lineas.length <= 3, `esperaba como mucho 3 líneas, dio ${lineas.length}`);
});

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('\nTodas las pruebas pasaron.');
