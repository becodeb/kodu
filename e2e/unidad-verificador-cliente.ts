import assert from 'node:assert/strict';
import { aplicarKit, type TemaId } from '../src/lib/ai/kit.ts';
import {
  cambioElScriptPropio,
  decidirTipoVerificacion,
  problemasAccionablesParaPanel,
  problemasDeContenidoParaPanel,
  separarProblemasParaPanel,
  textoCantidadProblemas,
} from '../src/lib/client/verificador.ts';
import type { Problema } from '../src/lib/ai/verificador.ts';

/**
 * Pruebas unitarias del CLIENTE del verificador (T4, `odd/tasks/verificador.md`)
 * — `src/lib/client/verificador.ts`: el helper "cuándo corresponde
 * verificar" (`decidirTipoVerificacion`/`cambioElScriptPropio`) y el reparto
 * del panel (`separarProblemasParaPanel`/`problemasAccionablesParaPanel`/
 * `problemasDeContenidoParaPanel`).
 *
 * Sin DOM ni servidor (`verificarRecurso`, la única función con `fetch` de
 * ese módulo, la ejercita `e2e/verificador-editor.ts` contra el mock) —
 * mismo criterio que `e2e/unidad-verificador.ts` para el módulo isomórfico
 * del servidor.
 *
 * Ejecutar con: npx tsx e2e/unidad-verificador-cliente.ts
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
// Documentos de prueba: kit CANÓNICO real (via aplicarKit) + script propio
// + script de pruebas opcional — para poder afirmar que "kit ignorado" y
// "pruebas ignoradas" son de verdad, no un accidente de un HTML sin kit.
// ─────────────────────────────────────────────────────────────

function documento(tema: TemaId, cuerpoPropio: string, scriptPruebas = ''): string {
  const base =
    `<!DOCTYPE html>\n<html lang="es">\n<head>\n<meta charset="UTF-8">\n` +
    `<meta name="kodu-tema" content="${tema}">\n</head>\n<body>\n${cuerpoPropio}\n${scriptPruebas}\n</body>\n</html>`;
  return aplicarKit(base);
}

const SCRIPT_A = '<script>function suma(a,b){return a+b;}</script>';
const SCRIPT_A_OTRA_INDENTACION = '<script>\n  function suma(a,b){\n    return a+b;\n  }\n</script>';
const SCRIPT_B_LOGICA_DISTINTA = '<script>function suma(a,b){return a+b+1;}</script>';
const PRUEBAS_1 = `<script data-kodu-pruebas>try{eval("window.__koduPruebas=[{id:'c1'}]")}catch(e){window.__koduPruebasError=String(e)}</script>`;
const PRUEBAS_2 = `<script data-kodu-pruebas>try{eval("window.__koduPruebas=[{id:'c2'}]")}catch(e){window.__koduPruebasError=String(e)}</script>`;

// ─────────────────────────────────────────────────────────────
// decidirTipoVerificacion / cambioElScriptPropio
// ─────────────────────────────────────────────────────────────

await prueba('decidirTipoVerificacion: recurso inicial → "nuevo", sin mirar el resto del HTML', () => {
  const tipo = decidirTipoVerificacion({
    esRecursoInicialAlEmpezar: true,
    htmlAntes: '',
    htmlDespues: documento('pizarron', SCRIPT_A),
  });
  assert.equal(tipo, 'nuevo');
});

await prueba('decidirTipoVerificacion: ajuste con el <script> propio cambiado (lógica) → "ajuste"', () => {
  const antes = documento('pizarron', SCRIPT_A);
  const despues = documento('pizarron', SCRIPT_B_LOGICA_DISTINTA);
  assert.equal(cambioElScriptPropio(antes, despues), true);
  assert.equal(
    decidirTipoVerificacion({ esRecursoInicialAlEmpezar: false, htmlAntes: antes, htmlDespues: despues }),
    'ajuste',
  );
});

await prueba('decidirTipoVerificacion: ajuste que sólo tocó texto/clases → null (sin llamar)', () => {
  const antes = documento('pizarron', `<h1 class="text-lg">Practicá</h1>\n${SCRIPT_A}`);
  const despues = documento('pizarron', `<h1 class="text-2xl">Practicá fracciones</h1>\n${SCRIPT_A}`);
  assert.equal(cambioElScriptPropio(antes, despues), false);
  assert.equal(
    decidirTipoVerificacion({ esRecursoInicialAlEmpezar: false, htmlAntes: antes, htmlDespues: despues }),
    null,
  );
});

await prueba('decidirTipoVerificacion: sólo cambió el bloque <script data-kodu-pruebas> → null', () => {
  const antes = documento('pizarron', SCRIPT_A, PRUEBAS_1);
  const despues = documento('pizarron', SCRIPT_A, PRUEBAS_2);
  assert.equal(cambioElScriptPropio(antes, despues), false);
  assert.equal(
    decidirTipoVerificacion({ esRecursoInicialAlEmpezar: false, htmlAntes: antes, htmlDespues: despues }),
    null,
  );
});

await prueba('decidirTipoVerificacion: el bloque del kit se ignora (cambiar de tema no cuenta solo)', () => {
  const antes = documento('pizarron', SCRIPT_A);
  const despues = documento('cuaderno', SCRIPT_A); // mismo script propio, kit canónico distinto de verdad.
  assert.notEqual(antes, despues, 'los dos documentos tienen que ser de verdad distintos byte a byte (kit distinto)');
  assert.equal(cambioElScriptPropio(antes, despues), false);
  assert.equal(
    decidirTipoVerificacion({ esRecursoInicialAlEmpezar: false, htmlAntes: antes, htmlDespues: despues }),
    null,
  );
});

await prueba('decidirTipoVerificacion: cambio de sólo espacios en blanco en el script propio → null', () => {
  const antes = documento('pizarron', SCRIPT_A);
  const despues = documento('pizarron', SCRIPT_A_OTRA_INDENTACION);
  assert.notEqual(antes, despues, 'los dos documentos tienen que ser de verdad distintos byte a byte (indentación)');
  assert.equal(cambioElScriptPropio(antes, despues), false);
  assert.equal(
    decidirTipoVerificacion({ esRecursoInicialAlEmpezar: false, htmlAntes: antes, htmlDespues: despues }),
    null,
  );
});

await prueba('decidirTipoVerificacion: sin ningún cambio → null', () => {
  const html = documento('pizarron', SCRIPT_A);
  assert.equal(
    decidirTipoVerificacion({ esRecursoInicialAlEmpezar: false, htmlAntes: html, htmlDespues: html }),
    null,
  );
});

// ─────────────────────────────────────────────────────────────
// separarProblemasParaPanel / accionables / contenido / baja (nunca se ve)
// ─────────────────────────────────────────────────────────────

await prueba('problemasAccionablesParaPanel: filtra "contenido" y "baja", conserva alta/media de los demás tipos', () => {
  const lista = [
    problema({ tipo: 'logica', gravedad: 'alta', que: 'A' }),
    problema({ tipo: 'pedido', gravedad: 'media', que: 'B' }),
    problema({ tipo: 'uso', gravedad: 'baja', que: 'C-BAJA' }),
    problema({ tipo: 'contenido', gravedad: 'alta', que: 'D-CONTENIDO' }),
  ];
  const accionables = problemasAccionablesParaPanel(lista);
  assert.deepEqual(
    accionables.map((p) => p.que),
    ['A', 'B'],
  );
});

await prueba('problemasDeContenidoParaPanel: sólo "contenido" alta/media, nunca "baja"', () => {
  const lista = [
    problema({ tipo: 'contenido', gravedad: 'alta', que: 'A' }),
    problema({ tipo: 'contenido', gravedad: 'baja', que: 'B-BAJA' }),
    problema({ tipo: 'logica', gravedad: 'alta', que: 'C-LOGICA' }),
  ];
  const contenido = problemasDeContenidoParaPanel(lista);
  assert.deepEqual(
    contenido.map((p) => p.que),
    ['A'],
  );
});

await prueba('separarProblemasParaPanel: junta los dos filtros, "baja" desaparece de los dos lados', () => {
  const lista = [
    problema({ tipo: 'logica', gravedad: 'alta', que: 'ACCIONABLE' }),
    problema({ tipo: 'contenido', gravedad: 'media', que: 'CONTENIDO' }),
    problema({ tipo: 'uso', gravedad: 'baja', que: 'BAJA-1' }),
    problema({ tipo: 'contenido', gravedad: 'baja', que: 'BAJA-2' }),
  ];
  const { accionables, contenido } = separarProblemasParaPanel(lista);
  assert.deepEqual(accionables.map((p) => p.que), ['ACCIONABLE']);
  assert.deepEqual(contenido.map((p) => p.que), ['CONTENIDO']);
});

await prueba('separarProblemasParaPanel: sin problemas → las dos listas vacías', () => {
  const { accionables, contenido } = separarProblemasParaPanel([]);
  assert.equal(accionables.length, 0);
  assert.equal(contenido.length, 0);
});

// ─────────────────────────────────────────────────────────────
// textoCantidadProblemas: singular/plural
// ─────────────────────────────────────────────────────────────

await prueba('textoCantidadProblemas: singular con 1, plural con el resto', () => {
  assert.equal(textoCantidadProblemas(1), '1 cosa para mejorar');
  assert.equal(textoCantidadProblemas(2), '2 cosas para mejorar');
  assert.equal(textoCantidadProblemas(6), '6 cosas para mejorar');
});

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad-verificador-cliente.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/unidad-verificador-cliente.ts: todas las pruebas pasaron');
}
