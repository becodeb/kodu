import assert from 'node:assert/strict';
import {
  armarRespuesta,
  CAMPOS_FICHA,
  fusionarFicha,
  leerFichaGuardada,
  leerIdeasGuardadas,
  leerPreguntasGuardadas,
  nombreDeLaIdea,
  prefijoVisible,
  progresoFicha,
  separarRespuesta,
} from '../src/lib/taller/ficha.ts';
import {
  APERTURAS,
  construirMensajesTaller,
  MARCADOR_SISTEMA_TALLER,
  pedidoParaElEditor,
  systemPromptTaller,
} from '../src/lib/taller/prompt.ts';

/**
 * Pruebas unitarias del Taller de ideas (odd/tasks/taller-de-ideas.md):
 * `src/lib/taller/ficha.ts` y `src/lib/taller/prompt.ts`, los dos
 * isomórficos. Sin base de datos ni servidor.
 *
 * `node:assert/strict` + `tsx`. Ejecutar con: npx tsx e2e/unidad-taller.ts
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
// separarRespuesta
// ─────────────────────────────────────────────────────────────

await prueba('separa el texto visible del bloque y lee todo lo estructurado', () => {
  const respuesta = `Entonces querés trabajar fracciones equivalentes con 4.º grado.

<taller>
{"preguntas":[{"texto":"¿Cómo lo van a usar?","opciones":["Proyector","Tablets"],"multiple":false}],
 "ficha":{"tema":"Fracciones equivalentes","nivel":"4.º grado","inventado":"x"},
 "ideas":[{"nombre":"Barras de chocolate","resumen":"Parten barras y comparan","por_que":"Lo ven"}],
 "titulo":null,"descripcion":null,"pedido":null}
</taller>`;

  const { visible, datos, bloqueValido } = separarRespuesta(respuesta);
  assert.equal(bloqueValido, true);
  assert.equal(visible, 'Entonces querés trabajar fracciones equivalentes con 4.º grado.');
  assert.equal(datos.preguntas.length, 1);
  assert.deepEqual(datos.preguntas[0]!.opciones, ['Proyector', 'Tablets']);
  assert.deepEqual(datos.ficha, { tema: 'Fracciones equivalentes', nivel: '4.º grado' });
  assert.equal(datos.ideas[0]!.porQue, 'Lo ven');
  assert.equal(datos.pedido, null);
});

await prueba('tolera el JSON envuelto en ```json y una coma de más', () => {
  const respuesta = 'Perfecto.\n<taller>\n```json\n{"preguntas":[{"texto":"¿Y el color?","opciones":["Rojo","Azul",],}],}\n```\n</taller>';
  const { datos, bloqueValido } = separarRespuesta(respuesta);
  assert.equal(bloqueValido, true);
  assert.equal(datos.preguntas[0]!.texto, '¿Y el color?');
  assert.deepEqual(datos.preguntas[0]!.opciones, ['Rojo', 'Azul']);
});

await prueba('sin bloque: todo es texto visible y los datos quedan vacíos', () => {
  const { visible, datos, bloqueValido } = separarRespuesta('Hola, contame más.');
  assert.equal(bloqueValido, false);
  assert.equal(visible, 'Hola, contame más.');
  assert.deepEqual(datos.preguntas, []);
});

await prueba('bloque roto: no tira, conserva el texto', () => {
  const { visible, bloqueValido } = separarRespuesta('Genial.\n<taller>{"preguntas": [ esto no es json</taller>');
  assert.equal(bloqueValido, false);
  assert.equal(visible, 'Genial.');
});

await prueba('bloque sin cierre (cortado por tope de tokens) se lee igual si el JSON está entero', () => {
  const { datos, bloqueValido } = separarRespuesta('Listo.\n<taller>{"pedido":"Quiero un simulador."}');
  assert.equal(bloqueValido, true);
  assert.equal(datos.pedido, 'Quiero un simulador.');
});

await prueba('saca los <think> del texto visible', () => {
  const { visible } = separarRespuesta('<think>razonando…</think>Buenísimo.\n<taller>{}</taller>');
  assert.equal(visible, 'Buenísimo.');
});

await prueba('topes: a lo sumo 3 preguntas, 5 opciones sin repetidas, 3 ideas', () => {
  const preguntas = Array.from({ length: 5 }, (_, i) => ({
    texto: `P${i}`,
    opciones: ['a', 'a', 'b', 'c', 'd', 'e', 'f'],
  }));
  const ideas = Array.from({ length: 5 }, (_, i) => ({ nombre: `I${i}`, resumen: 'r' }));
  const { datos } = separarRespuesta(`x<taller>${JSON.stringify({ preguntas, ideas })}</taller>`);
  assert.equal(datos.preguntas.length, 3);
  assert.deepEqual(datos.preguntas[0]!.opciones, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(datos.ideas.length, 3);
});

await prueba('descarta preguntas sin texto e ideas sin nombre o sin resumen', () => {
  const { datos } = separarRespuesta(
    'x<taller>{"preguntas":[{"opciones":["a"]},{"texto":"  "},{"texto":"¿Ok?"}],"ideas":[{"nombre":"Sin resumen"},{"resumen":"sin nombre"}]}</taller>',
  );
  assert.deepEqual(
    datos.preguntas.map((pregunta) => pregunta.texto),
    ['¿Ok?'],
  );
  assert.equal(datos.ideas.length, 0);
});

// ─────────────────────────────────────────────────────────────
// prefijoVisible (el stream)
// ─────────────────────────────────────────────────────────────

await prueba('prefijoVisible corta en <taller> y retiene un comienzo de etiqueta', () => {
  assert.equal(prefijoVisible('Hola'), 'Hola');
  assert.equal(prefijoVisible('Hola <ta'), 'Hola ');
  assert.equal(prefijoVisible('Hola <taller>{"x":1}'), 'Hola ');
  assert.equal(prefijoVisible('3 < 4 y sigue'), '3 < 4 y sigue');
  assert.equal(prefijoVisible('<thi'), '');
  assert.equal(prefijoVisible('<think>pienso</think>Dale'), 'Dale');
});

await prueba('el stream nunca muestra nada del bloque, llegue como llegue', () => {
  const completo = 'Muy bien, sigamos.\n<taller>{"preguntas":[]}</taller>';
  let emitido = '';
  for (let i = 1; i <= completo.length; i++) {
    const visible = prefijoVisible(completo.slice(0, i));
    if (visible.length > emitido.length && visible.startsWith(emitido)) emitido = visible;
  }
  assert.equal(emitido.trim(), 'Muy bien, sigamos.');
  assert.ok(!emitido.includes('<'));
});

// ─────────────────────────────────────────────────────────────
// ficha
// ─────────────────────────────────────────────────────────────

await prueba('fusionarFicha pisa sólo los campos nuevos', () => {
  assert.deepEqual(fusionarFicha({ tema: 'A', nivel: 'B' }, { nivel: 'C', idea: 'D' }), {
    tema: 'A',
    nivel: 'C',
    idea: 'D',
  });
});

await prueba('progresoFicha cuenta campos con contenido', () => {
  assert.equal(progresoFicha({}), 0);
  assert.equal(progresoFicha({ tema: 'x', nivel: ' ' }), 1 / CAMPOS_FICHA.length);
});

await prueba('leer*Guardad* nunca tiran con basura', () => {
  assert.deepEqual(leerFichaGuardada('no json'), {});
  assert.deepEqual(leerFichaGuardada(null), {});
  assert.deepEqual(leerPreguntasGuardadas('{'), []);
  assert.deepEqual(leerIdeasGuardadas(undefined), []);
});

await prueba('leerIdeasGuardadas lee el formato guardado (porQue)', () => {
  const ideas = leerIdeasGuardadas(JSON.stringify([{ nombre: 'N', resumen: 'R', porQue: 'P' }]));
  assert.equal(ideas[0]!.porQue, 'P');
});

await prueba('nombreDeLaIdea: título, si no la idea, si no el tema', () => {
  assert.equal(nombreDeLaIdea('Mi idea', { tema: 'T' }), 'Mi idea');
  assert.equal(nombreDeLaIdea(null, { idea: 'Un simulador de palancas. Con pesas.' }), 'Un simulador de palancas');
  assert.equal(nombreDeLaIdea(null, { tema: 'Palancas' }), 'Palancas');
  assert.equal(nombreDeLaIdea(null, {}), 'Idea sin nombre');
});

await prueba('armarRespuesta junta respuestas tocadas y texto libre, cada una con su pregunta', () => {
  const preguntas = [
    { texto: '¿Grado?', opciones: ['4.º', '5.º'], multiple: false },
    { texto: '¿Qué hacen?', opciones: ['Arrastran', 'Eligen'], multiple: true },
    { texto: '¿Tema?', opciones: [], multiple: false },
  ];
  assert.equal(
    armarRespuesta(preguntas, { 0: ['4.º'], 1: ['Arrastran', 'Eligen'] }, 'Fracciones'),
    '¿Grado? → 4.º\n¿Qué hacen? → Arrastran, Eligen\nFracciones',
  );
  assert.equal(armarRespuesta(preguntas, {}, '  '), '');
});

// ─────────────────────────────────────────────────────────────
// prompt
// ─────────────────────────────────────────────────────────────

await prueba('el system prompt arranca con el marcador y no menciona jerga técnica como algo a decir', () => {
  const prompt = systemPromptTaller();
  assert.ok(prompt.startsWith(MARCADOR_SISTEMA_TALLER));
  assert.ok(prompt.includes('<taller>'));
  assert.ok(prompt.includes('Quiero'));
});

await prueba('las aperturas de las dos puertas traen entre 1 y 3 preguntas', () => {
  for (const apertura of Object.values(APERTURAS)) {
    assert.ok(apertura.content.length > 0);
    assert.ok(apertura.questions.length >= 1 && apertura.questions.length <= 3);
  }
});

await prueba('construirMensajesTaller: system, historial con bloques, y el estado en el último mensaje', () => {
  const mensajes = construirMensajesTaller({
    modo: 'TOPIC',
    ficha: { tema: 'Palancas' },
    pedido: null,
    pedidoEditadoAMano: false,
    historial: [
      { role: 'assistant', content: 'Hola', questions: APERTURAS.TOPIC.questions, proposals: [] },
      { role: 'user', content: 'Palancas, 6.º', questions: [], proposals: [] },
    ],
    mensaje: 'Les cuesta ver la fuerza',
    adjuntos: [{ filename: 'ficha.pdf', fileType: 'pdf', extractedText: 'Texto de la ficha' }],
    puedeVerImagenes: false,
    imagenes: [],
  });

  assert.equal(mensajes[0]!.role, 'system');
  assert.equal(mensajes.length, 4);
  assert.ok((mensajes[1]!.content as string).includes('<taller>'));
  const ultimo = mensajes[3]!.content as string;
  assert.ok(ultimo.includes('tema: Palancas'));
  assert.ok(ultimo.includes('Texto de la ficha'));
  assert.ok(ultimo.endsWith('Les cuesta ver la fuerza'));
});

await prueba('construirMensajesTaller: avisa cuando el pedido se editó a mano', () => {
  const mensajes = construirMensajesTaller({
    modo: 'IDEA',
    ficha: {},
    pedido: 'Quiero un juego.',
    pedidoEditadoAMano: true,
    historial: [],
    mensaje: 'Cambiá el color',
    adjuntos: [],
    puedeVerImagenes: true,
    imagenes: ['data:image/png;base64,AAAA'],
  });
  const ultimo = mensajes[1]!.content;
  assert.ok(Array.isArray(ultimo));
  const texto = (ultimo as Array<{ type: string; text?: string }>)[0]!.text!;
  assert.ok(texto.includes('A MANO'));
  assert.ok(texto.includes('Quiero un juego.'));
});

await prueba('pedidoParaElEditor: un pedido que arranca como pregunta se vuelve orden', () => {
  assert.equal(pedidoParaElEditor('  Quiero un simulador.  '), 'Quiero un simulador.');
  assert.ok(pedidoParaElEditor('¿Podés armar un juego?').startsWith('Quiero que armes'));
});

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron`);
  process.exit(1);
}
console.log('\nTodas las pruebas del Taller pasaron');
