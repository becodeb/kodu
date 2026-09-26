import assert from 'node:assert/strict';
import { reglasDelArnes } from '../src/lib/ai/prompt.ts';
import {
  construirMensajeCorreccionVerificador,
  construirSistemaVerificador,
  construirUsuarioVerificador,
  htmlParaVerificador,
  normalizarProblema,
  parsearVerificacion,
  pedidoDocente,
  problemasAccionables,
  unirPasadas,
  type Problema,
} from '../src/lib/ai/verificador.ts';

/**
 * Pruebas unitarias del verificador (T3, `odd/tasks/verificador.md`) —
 * `src/lib/ai/verificador.ts` (+ `reglasDelArnes` en `prompt.ts`).
 *
 * Módulo isomórfico (sin Prisma, sin `env.ts` en runtime): estas pruebas no
 * tocan la base de datos ni llaman a ningún proveedor — mismo criterio que
 * `unidad-checklist.ts`/`unidad-pruebas-aisladas.ts`.
 *
 * Ejecutar con: npx tsx e2e/unidad-verificador.ts
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

function problema(extra: Partial<Problema> = {}): Problema {
  return {
    gravedad: 'alta',
    tipo: 'logica',
    que: 'El botón de reiniciar no vuelve el contador a cero',
    como_reproducir: 'Sumá 3 puntos, tocá "Reiniciar" y el contador sigue en 3',
    arreglo: 'Llamar a reiniciarContador() dentro de reiniciar()',
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────
// reglasDelArnes (prompt.ts)
// ─────────────────────────────────────────────────────────────

await prueba('reglasDelArnes: no vacío y con contenido real de "Que funcione de verdad"', () => {
  const reglas = reglasDelArnes();
  assert.ok(reglas.length > 200, 'tiene que traer el bloque de reglas entero, no un recorte vacío');
  assert.ok(reglas.includes('ESTADO_INICIAL'), 'tiene que incluir la regla 1 (ESTADO_INICIAL/reiniciar)');
  assert.ok(reglas.includes('kodu.festejar()'), 'tiene que incluir una regla del final del bloque (8)');
  assert.ok(!reglas.includes('## Calidad pedagógica'), 'no tiene que arrastrar la sección siguiente');
});

await prueba('reglasDelArnes: sin el ejemplo de window.__koduPruebas (envuelto en <script data-kodu-pruebas>)', () => {
  const reglas = reglasDelArnes();
  // BASE_PROMPT menciona `window.__koduPruebas` DOS veces: una vez en la
  // prosa ("agregá `window.__koduPruebas` en un `<script data-kodu-pruebas>`
  // APARTE…", que sí es parte de las reglas) y una vez en el EJEMPLO
  // concreto (`<script data-kodu-pruebas>window.__koduPruebas=[{id:'c1',…`).
  // Sólo la segunda tiene que desaparecer — de ahí chequear la llamada
  // `pintar(1,2)` del ejemplo, no el string `__koduPruebas` a secas.
  assert.ok(!reglas.includes('pintar(1,2)'), 'el ejemplo concreto (script incluido) tiene que estar afuera');
  assert.ok(!reglas.includes("window.__koduPruebas=[{id:'c1'"), 'no tiene que quedar el arreglo de ejemplo');
  assert.ok(
    reglas.includes('agregá `window.__koduPruebas` en un `<script data-kodu-pruebas>` APARTE'),
    'la instrucción en PROSA (no el ejemplo) sigue estando: no se cortó de más',
  );
  assert.ok(reglas.includes('window.kodu'), 'el texto de después del ejemplo sigue estando (no se cortó de más)');
});

// ─────────────────────────────────────────────────────────────
// htmlParaVerificador: kit plegado + <script data-kodu-pruebas> plegado
// ─────────────────────────────────────────────────────────────

const HTML_CON_PRUEBAS = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="kodu-tema" content="pizarron"></head>
<body>
  <h1>Practicá</h1>
  <script>function reiniciar(){}</script>
  <script data-kodu-pruebas>try{eval("window.__koduPruebas=[{id:'c1',prueba:()=>({ok:true,detalle:''})}]")}catch(e){window.__koduPruebasError=String(e)}</script>
</body>
</html>`;

await prueba('htmlParaVerificador: reemplaza <script data-kodu-pruebas> por un comentario corto', () => {
  const salida = htmlParaVerificador(HTML_CON_PRUEBAS);
  assert.ok(!salida.includes('__koduPruebas'), 'no tiene que quedar ni rastro del JSON envuelto en eval(...)');
  assert.ok(!salida.includes('<script data-kodu-pruebas>'), 'la etiqueta del script de pruebas no tiene que sobrevivir');
  assert.ok(salida.includes('<!-- pruebas automáticas plegadas -->'), 'tiene que dejar el comentario de reemplazo');
  assert.ok(salida.includes('function reiniciar(){}'), 'el resto del HTML (el script del recurso) queda intacto');
});

await prueba('htmlParaVerificador: sin script de pruebas, sólo pliega el kit (no rompe nada)', () => {
  const sinPruebas = '<!DOCTYPE html><html><head></head><body><h1>Hola</h1></body></html>';
  assert.equal(htmlParaVerificador(sinPruebas), sinPruebas);
});

// ─────────────────────────────────────────────────────────────
// construirSistemaVerificador / construirUsuarioVerificador
// ─────────────────────────────────────────────────────────────

await prueba('construirSistemaVerificador: lleva las reglas y pide el JSON de "problemas"', () => {
  const sistema = construirSistemaVerificador('REGLA-DE-PRUEBA-XYZ');
  assert.ok(sistema.includes('REGLA-DE-PRUEBA-XYZ'), 'tiene que incrustar las reglas recibidas');
  assert.ok(sistema.includes('"problemas"'), 'tiene que pedir el formato JSON con la clave "problemas"');
  assert.ok(/revisor experto/i.test(sistema), 'redacción verbatim del experimento: "revisor experto"');
});

await prueba('construirUsuarioVerificador: pedido + HTML plegado (sin pruebas en claro)', () => {
  const mensaje = construirUsuarioVerificador('Un simulador de fracciones', HTML_CON_PRUEBAS);
  assert.ok(mensaje.includes('## Pedido del docente'));
  assert.ok(mensaje.includes('Un simulador de fracciones'));
  assert.ok(mensaje.includes('## Recurso generado'));
  assert.ok(!mensaje.includes('__koduPruebas'), 'el HTML que viaja no puede traer el JSON de pruebas en claro');
  assert.ok(mensaje.includes('<!-- pruebas automáticas plegadas -->'));
});

// ─────────────────────────────────────────────────────────────
// pedidoDocente
// ─────────────────────────────────────────────────────────────

await prueba('pedidoDocente: sin ajuste, devuelve el pedido original tal cual', () => {
  assert.equal(pedidoDocente('Armame un quiz de tablas', null), 'Armame un quiz de tablas');
});

await prueba('pedidoDocente: con ajuste, agrega el último pedido etiquetado', () => {
  const texto = pedidoDocente('Armame un quiz de tablas', 'Agregale un cronómetro');
  assert.ok(texto.startsWith('Armame un quiz de tablas'));
  assert.ok(texto.includes('## Último pedido (ajuste)'));
  assert.ok(texto.endsWith('Agregale un cronómetro'));
});

// ─────────────────────────────────────────────────────────────
// normalizarProblema / parsearVerificacion
// ─────────────────────────────────────────────────────────────

await prueba('parsearVerificacion: JSON plano', () => {
  const texto = JSON.stringify({ problemas: [problema()] });
  const resultado = parsearVerificacion(texto);
  assert.ok(resultado);
  assert.equal(resultado!.problemas.length, 1);
  assert.deepEqual(resultado!.problemas[0], problema());
});

await prueba('parsearVerificacion: JSON dentro de una cerca ```json … ```', () => {
  const texto = '```json\n' + JSON.stringify({ problemas: [problema({ gravedad: 'media' })] }) + '\n```';
  const resultado = parsearVerificacion(texto);
  assert.ok(resultado);
  assert.equal(resultado!.problemas[0]!.gravedad, 'media');
});

await prueba('parsearVerificacion: con texto alrededor del JSON', () => {
  const texto = `Acá está mi revisión:\n${JSON.stringify({ problemas: [problema()] })}\nEso es todo.`;
  const resultado = parsearVerificacion(texto);
  assert.ok(resultado);
  assert.equal(resultado!.problemas.length, 1);
});

await prueba('parsearVerificacion: lista vacía es un resultado VÁLIDO (recurso sin problemas)', () => {
  const resultado = parsearVerificacion(JSON.stringify({ problemas: [] }));
  assert.deepEqual(resultado, { problemas: [] });
});

await prueba('parsearVerificacion: texto sin JSON parseable → null', () => {
  assert.equal(parsearVerificacion('esto no es JSON en absoluto'), null);
  assert.equal(parsearVerificacion(''), null);
  assert.equal(parsearVerificacion('{"otraCosa": true}'), null, 'sin la clave "problemas" no cuenta');
});

await prueba('parsearVerificacion: entradas individuales inválidas se descartan, no invalidan la pasada', () => {
  const texto = JSON.stringify({
    problemas: [
      problema({ que: 'problema válido' }),
      { gravedad: 'catastrófica', tipo: 'logica', que: 'x', como_reproducir: 'y', arreglo: 'z' }, // gravedad inválida
      { gravedad: 'alta', tipo: 'estilo', que: 'x', como_reproducir: 'y', arreglo: 'z' }, // tipo inválido
      { gravedad: 'alta', tipo: 'logica', que: '', como_reproducir: 'y', arreglo: 'z' }, // "que" vacío
      { gravedad: 'alta', tipo: 'logica', que: 'x', arreglo: 'z' }, // falta como_reproducir
    ],
  });
  const resultado = parsearVerificacion(texto);
  assert.ok(resultado);
  assert.equal(resultado!.problemas.length, 1);
  assert.equal(resultado!.problemas[0]!.que, 'problema válido');
});

await prueba('parsearVerificacion: tope de 6 problemas aunque el modelo mande más', () => {
  const muchos = Array.from({ length: 9 }, (_, i) => problema({ que: `problema ${i + 1}` }));
  const resultado = parsearVerificacion(JSON.stringify({ problemas: muchos }));
  assert.ok(resultado);
  assert.equal(resultado!.problemas.length, 6);
  assert.equal(resultado!.problemas[0]!.que, 'problema 1');
  assert.equal(resultado!.problemas[5]!.que, 'problema 6');
});

await prueba('normalizarProblema: recorta espacios y topea el largo de cada campo de texto', () => {
  const largo = 'x'.repeat(500);
  const normalizado = normalizarProblema({
    gravedad: 'baja',
    tipo: 'uso',
    que: `  ${largo}  `,
    como_reproducir: '  tocar el botón  ',
    arreglo: '  agrandar el área táctil  ',
  });
  assert.ok(normalizado);
  assert.equal(normalizado!.que.length, 400, 'topeado a 400, sin los espacios del borde');
  assert.equal(normalizado!.como_reproducir, 'tocar el botón');
  assert.equal(normalizado!.arreglo, 'agrandar el área táctil');
});

await prueba('normalizarProblema: no-objeto o campos faltantes → null', () => {
  assert.equal(normalizarProblema(null), null);
  assert.equal(normalizarProblema('un string'), null);
  assert.equal(normalizarProblema({}), null);
  assert.equal(normalizarProblema({ gravedad: 'alta', tipo: 'logica' }), null);
});

// ─────────────────────────────────────────────────────────────
// unirPasadas
// ─────────────────────────────────────────────────────────────

await prueba('unirPasadas: una sola pasada — se ordena por gravedad y se topea a 6', () => {
  const lista = [
    problema({ gravedad: 'baja', que: 'problema baja' }),
    problema({ gravedad: 'alta', que: 'problema alta' }),
    problema({ gravedad: 'media', que: 'problema media' }),
  ];
  const resultado = unirPasadas([lista]);
  assert.deepEqual(
    resultado.map((p) => p.gravedad),
    ['alta', 'media', 'baja'],
  );
});

await prueba('unirPasadas: dos pasadas — unión simple sin superposición', () => {
  const pasada1 = [problema({ tipo: 'logica', que: 'el contador no reinicia' })];
  const pasada2 = [problema({ tipo: 'contenido', que: 'la fecha de la revolución está mal' })];
  const resultado = unirPasadas([pasada1, pasada2]);
  assert.equal(resultado.length, 2);
});

await prueba('unirPasadas: mismo tipo + "que" muy parecido entre pasadas → se fusiona, queda el más grave', () => {
  const pasada1 = [
    problema({ tipo: 'logica', gravedad: 'media', que: 'El botón de reiniciar no vuelve el contador a cero' }),
  ];
  const pasada2 = [
    problema({
      tipo: 'logica',
      gravedad: 'alta',
      que: 'El botón de reiniciar no vuelve el contador a cero nunca',
      arreglo: 'otra redacción del arreglo',
    }),
  ];
  const resultado = unirPasadas([pasada1, pasada2]);
  assert.equal(resultado.length, 1, 'las dos pasadas describen el MISMO hallazgo: una sola entrada final');
  assert.equal(resultado[0]!.gravedad, 'alta', 'se conserva la versión más grave de las dos');
});

await prueba('unirPasadas: mismo tipo pero "que" distinto NO se fusiona', () => {
  const pasada1 = [problema({ tipo: 'logica', que: 'El botón de reiniciar no vuelve el contador a cero' })];
  const pasada2 = [problema({ tipo: 'logica', que: 'El cronómetro sigue corriendo después de terminar el juego' })];
  const resultado = unirPasadas([pasada1, pasada2]);
  assert.equal(resultado.length, 2, 'son dos problemas de lógica DISTINTOS, no un duplicado');
});

await prueba('unirPasadas: mismo texto pero tipo distinto NO se fusiona', () => {
  const pasada1 = [problema({ tipo: 'logica', que: 'El botón de reiniciar no vuelve el contador a cero' })];
  const pasada2 = [problema({ tipo: 'uso', que: 'El botón de reiniciar no vuelve el contador a cero' })];
  const resultado = unirPasadas([pasada1, pasada2]);
  assert.equal(resultado.length, 2, 'el tipo distinto ya alcanza para tratarlos como hallazgos separados');
});

await prueba('unirPasadas: tope de 6 después de combinar', () => {
  // Ocho temas GENUINAMENTE distintos (ninguna palabra de contenido
  // compartida entre sí) para que ninguno se fusione con otro por
  // solapamiento — lo único que tiene que recortar acá es el tope de 6.
  const temas = [
    'el cronómetro nunca se detiene',
    'la fracción equivalente aparece repetida',
    'el mapa no marca la capital correcta',
    'el ícono de pausa queda invisible',
    'la puntuación permite valores negativos',
    'el teclado no activa el botón de enviar',
    'la animación de festejo se dispara sin ganar',
    'el texto de ayuda tapa el dibujo principal',
  ];
  const pasada1 = temas.slice(0, 4).map((que) => problema({ que }));
  const pasada2 = temas.slice(4).map((que) => problema({ que }));
  const resultado = unirPasadas([pasada1, pasada2]);
  assert.equal(resultado.length, 6);
});

await prueba('unirPasadas: lista vacía en todas las pasadas da []', () => {
  assert.deepEqual(unirPasadas([[], []]), []);
});

// ─────────────────────────────────────────────────────────────
// problemasAccionables / construirMensajeCorreccionVerificador
// ─────────────────────────────────────────────────────────────

await prueba('problemasAccionables: descarta "contenido", conserva el resto', () => {
  const lista = [
    problema({ tipo: 'logica' }),
    problema({ tipo: 'contenido' }),
    problema({ tipo: 'pedido' }),
    problema({ tipo: 'uso' }),
  ];
  const resultado = problemasAccionables(lista);
  assert.equal(resultado.length, 3);
  assert.ok(resultado.every((p) => p.tipo !== 'contenido'));
});

await prueba('construirMensajeCorreccionVerificador: filtra "contenido" y cita que/como_reproducir/arreglo', () => {
  const accionable = problema({
    tipo: 'logica',
    que: 'QUE-ACCIONABLE',
    como_reproducir: 'COMO-REPRODUCIR-ACCIONABLE',
    arreglo: 'ARREGLO-ACCIONABLE',
  });
  const deContenido = problema({
    tipo: 'contenido',
    que: 'QUE-DE-CONTENIDO',
    como_reproducir: 'COMO-REPRODUCIR-DE-CONTENIDO',
    arreglo: 'ARREGLO-DE-CONTENIDO',
  });
  const mensaje = construirMensajeCorreccionVerificador([deContenido, accionable]);

  assert.ok(mensaje.includes('QUE-ACCIONABLE'));
  assert.ok(mensaje.includes('COMO-REPRODUCIR-ACCIONABLE'));
  assert.ok(mensaje.includes('ARREGLO-ACCIONABLE'));
  assert.ok(!mensaje.includes('QUE-DE-CONTENIDO'), 'un problema de "contenido" nunca puede colarse en la corrección');
  assert.ok(!mensaje.includes('COMO-REPRODUCIR-DE-CONTENIDO'));
  assert.ok(!mensaje.includes('ARREGLO-DE-CONTENIDO'));
});

await prueba('construirMensajeCorreccionVerificador: sólo "contenido" → header sin ítems', () => {
  const mensaje = construirMensajeCorreccionVerificador([problema({ tipo: 'contenido' })]);
  assert.ok(mensaje.includes('Un revisor encontró estos problemas'));
  assert.ok(!mensaje.includes('Cómo reproducirlo'), 'sin ningún ítem accionable, no hay ningún detalle que citar');
});

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad-verificador.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/unidad-verificador.ts: todas las pruebas pasaron');
}
