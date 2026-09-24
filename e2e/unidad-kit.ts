import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  TEMAS,
  FAMILIAS_NEUTRAS,
  FAMILIAS_ACENTO,
  FAMILIAS_ACENTO2,
  FAMILIAS_EXITO,
  FAMILIAS_ERROR,
  aplicarKit,
  aplicarKitConRedDeSeguridad,
  usaClasesDeTailwind,
  plegarKit,
  temaDe,
  bloqueKit,
  bloqueKitLegado,
  paletaDeTema,
  temaPorId,
  esTemaId,
  contraste,
  hexAOklab,
  type TemaId,
  type TokensTema,
  type Rampa,
} from '../src/lib/ai/kit.ts';
import { NOMBRES_LUCIDE } from '../src/lib/ai/lucide-nombres.ts';

/**
 * Pruebas unitarias del kit de diseño (src/lib/ai/kit.ts) y de la lista de
 * íconos de Lucide (src/lib/ai/lucide-nombres.ts) — tarea T1 de
 * odd/tasks/modo-prime.md.
 *
 * Archivo separado de e2e/unidad.ts a propósito: kit.ts es un módulo puro,
 * isomórfico, sin Prisma ni Node, y estas pruebas no necesitan la base de
 * datos para nada — mientras que unidad.ts sí la levanta (`prisma`,
 * `prisma.$disconnect()` al final) y exige `docker compose up -d db`
 * corriendo. Separar el archivo deja este conjunto corrible solo, sin
 * levantar nada.
 *
 * `node:assert/strict` + `tsx`, mismo patrón que unidad.ts. Ejecutar con:
 *   npx tsx e2e/unidad-kit.ts
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

function documentoConMeta(temaId: TemaId, extraEnHead = ''): string {
  return (
    `<!DOCTYPE html>\n<html lang="es">\n<head>\n<meta charset="UTF-8">\n` +
    `<meta name="kodu-tema" content="${temaId}">\n${extraEnHead}</head>\n<body>\n<h1>Hola</h1>\n</body>\n</html>`
  );
}

function distanciaOklab(hexA: string, hexB: string): number {
  const a = hexAOklab(hexA);
  const b = hexAOklab(hexB);
  return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

// ─────────────────────────────────────────────────────────────
// Contraste (Apéndice A: umbrales que cada tema debe cumplir)
// ─────────────────────────────────────────────────────────────

const UMBRALES_APENDICE_A: readonly [keyof TokensTema, keyof TokensTema, number][] = [
  ['tinta', 'fondo', 7],
  ['tinta', 'superficie', 7],
  ['suave', 'fondo', 4.5],
  ['suave', 'superficie', 4.5],
  ['superficie', 'acento', 4.5],
  ['exito', 'superficie', 4.5],
  ['error', 'superficie', 4.5],
  ['acento', 'fondo', 3],
];

await prueba('cada tema cumple los umbrales de contraste del Apéndice A', () => {
  for (const tema of TEMAS) {
    for (const [a, b, minimo] of UMBRALES_APENDICE_A) {
      const razon = contraste(tema.tokens[a], tema.tokens[b]);
      assert.ok(razon >= minimo, `${tema.id}: ${a}/${b} = ${razon.toFixed(3)}, esperaba >= ${minimo}`);
    }
  }
});

// ─────────────────────────────────────────────────────────────
// Rampas
// ─────────────────────────────────────────────────────────────

await prueba('paletaDeTema: 500 y 600 son el token EXACTO, sin mezclar', () => {
  for (const tema of TEMAS) {
    const paleta = paletaDeTema(tema);
    const blue = paleta.blue as Rampa;
    const red = paleta.red as Rampa;
    assert.equal(blue[500], tema.tokens.acento, `${tema.id}: blue[500] debería ser el token acento`);
    assert.equal(blue[600], tema.tokens.acento, `${tema.id}: blue[600] debería ser el token acento`);
    assert.equal(red[500], tema.tokens.error, `${tema.id}: red[500] debería ser el token error`);
  }
});

await prueba('paletaDeTema: 50 queda cerca de fondo, 900/950 cerca de tinta', () => {
  for (const tema of TEMAS) {
    const paleta = paletaDeTema(tema);
    const blue = paleta.blue as Rampa;
    const gray = paleta.gray as Rampa;

    for (const rampa of [blue, gray]) {
      assert.ok(
        distanciaOklab(rampa[50], tema.tokens.fondo) < distanciaOklab(rampa[50], tema.tokens.tinta),
        `${tema.id}: el escalón 50 tiene que estar más cerca de fondo que de tinta`,
      );
      assert.ok(
        distanciaOklab(rampa[900], tema.tokens.tinta) < distanciaOklab(rampa[900], tema.tokens.fondo),
        `${tema.id}: el escalón 900 tiene que estar más cerca de tinta que de fondo`,
      );
      assert.ok(
        distanciaOklab(rampa[950], tema.tokens.tinta) < distanciaOklab(rampa[900], tema.tokens.tinta),
        `${tema.id}: el escalón 950 tiene que estar todavía más cerca de tinta que el 900`,
      );
    }
  }
});

await prueba('paletaDeTema: las familias de un mismo grupo comparten rampa idéntica', () => {
  for (const tema of TEMAS) {
    const paleta = paletaDeTema(tema);
    for (const grupo of [FAMILIAS_NEUTRAS, FAMILIAS_ACENTO, FAMILIAS_ACENTO2, FAMILIAS_EXITO, FAMILIAS_ERROR]) {
      const [primera, ...resto] = grupo;
      for (const familia of resto) {
        assert.deepEqual(paleta[familia], paleta[primera], `${tema.id}: ${familia} debería compartir rampa con ${primera}`);
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────
// temaDe: tolerancia de orden, comillas y mayúsculas
// ─────────────────────────────────────────────────────────────

await prueba('temaDe: tolera orden de atributos, comillas y mayúsculas', () => {
  assert.equal(temaDe('<META CONTENT="pizarron" NAME="KODU-TEMA">'), 'pizarron');
  assert.equal(temaDe(`<meta name='kodu-tema' content='atlas'>`), 'atlas');
  assert.equal(temaDe('<meta name=kodu-tema content=huerta>'), 'huerta');
  assert.equal(temaDe('<meta content="CUADERNO" name="kodu-tema">'), 'cuaderno');
});

await prueba('temaDe: sin meta válido da null', () => {
  assert.equal(temaDe('<html><body>sin meta</body></html>'), null);
  assert.equal(temaDe('<meta name="kodu-tema" content="no-existe">'), null);
  assert.equal(temaDe('<meta name="otra-cosa" content="pizarron">'), null);
});

// ─────────────────────────────────────────────────────────────
// aplicarKit
// ─────────────────────────────────────────────────────────────

await prueba('aplicarKit: meta válido sin bloque ni placeholder inserta el canónico justo después', () => {
  const resultado = aplicarKit(documentoConMeta('plano'));
  assert.ok(resultado.includes(bloqueKit('plano')));
  const posMeta = resultado.indexOf('kodu-tema');
  const posBloque = resultado.indexOf('kodu-kit:v1:inicio');
  assert.ok(posBloque > posMeta, 'el bloque tiene que quedar después del meta');
});

await prueba('aplicarKit: html sin meta válido y sin temaPrevio vuelve sin tocar', () => {
  const x = '<!DOCTYPE html><html><body>Sin tema todavía</body></html>';
  assert.equal(aplicarKit(x), x);
  assert.equal(aplicarKit(x, {}), x);
  assert.equal(aplicarKit(x, { temaPrevio: null }), x);
  assert.equal(aplicarKit(x, { temaPrevio: 'no-existe' }), x);
});

await prueba('aplicarKit es idempotente', () => {
  const original = documentoConMeta('laboratorio');
  const una = aplicarKit(original);
  const dos = aplicarKit(una);
  assert.equal(dos, una);
});

await prueba('aplicarKit: cambiar el id del meta reemplaza el bloque por el del tema nuevo', () => {
  const conKit = aplicarKit(documentoConMeta('pizarron'));
  assert.ok(conKit.includes(bloqueKit('pizarron')));

  // El docente (o el modelo) cambia el meta a otro tema, pero deja el bloque viejo tal cual.
  const conMetaCambiado = conKit.replace('content="pizarron"', 'content="cuaderno"');
  const resultado = aplicarKit(conMetaCambiado);

  assert.ok(resultado.includes(bloqueKit('cuaderno')), 'tiene que traer el bloque canónico de cuaderno');
  assert.ok(!resultado.includes(bloqueKit('pizarron')), 'el bloque viejo de pizarron no puede quedar');
  assert.equal(aplicarKit(resultado), resultado, 'y ya queda estable (idempotente) en el tema nuevo');
});

await prueba('aplicarKit: un bloque editado a mano no se toca', () => {
  const conKit = aplicarKit(documentoConMeta('atlas'));
  const editado = conKit.replace(
    '<!-- kodu-kit:v1:fin -->',
    '<!-- un comentario de más, a mano --><!-- kodu-kit:v1:fin -->',
  );
  const resultado = aplicarKit(editado);
  assert.equal(resultado, editado, 'un bloque que no es byte a byte el canónico de su propio id se deja tal cual');
});

await prueba('aplicarKit: sin meta, usa temaPrevio e inserta meta+bloque después de <head>', () => {
  const sinMeta = '<!DOCTYPE html>\n<html lang="es">\n<head>\n<meta charset="UTF-8">\n</head>\n<body></body>\n</html>';
  const resultado = aplicarKit(sinMeta, { temaPrevio: 'noche' });

  assert.equal(temaDe(resultado), 'noche');
  assert.ok(resultado.includes(bloqueKit('noche')));

  const posHead = resultado.indexOf('<head>') + '<head>'.length;
  const posMeta = resultado.indexOf('kodu-tema');
  const posCharset = resultado.indexOf('charset=');
  assert.ok(posMeta > posHead && posMeta < posCharset, 'el meta de kodu-tema tiene que quedar antes que el resto del head original');
});

await prueba('aplicarKit: sin <head>, cae a insertar después de <html>', () => {
  const sinHead = '<!DOCTYPE html>\n<html lang="es">\n<body></body>\n</html>';
  const resultado = aplicarKit(sinHead, { temaPrevio: 'huerta' });

  assert.equal(temaDe(resultado), 'huerta');
  const posHtml = resultado.indexOf('<html lang="es">') + '<html lang="es">'.length;
  assert.ok(resultado.indexOf('kodu-tema') > posHtml);
  assert.ok(resultado.indexOf('kodu-tema') < resultado.indexOf('<body>'));
});

await prueba('aplicarKit: sin <head> ni <html>, inserta al principio', () => {
  const fragmento = '<body><p>fragmento suelto</p></body>';
  const resultado = aplicarKit(fragmento, { temaPrevio: 'plano' });

  assert.equal(temaDe(resultado), 'plano');
  assert.ok(resultado.startsWith('<meta name="kodu-tema" content="plano">'));
});

await prueba('aplicarKit: un meta válido gana siempre por sobre temaPrevio', () => {
  const conMeta = documentoConMeta('recreo');
  const resultado = aplicarKit(conMeta, { temaPrevio: 'noche' });
  assert.equal(temaDe(resultado), 'recreo', 'el meta existente manda; temaPrevio es sólo el respaldo sin meta');
});

// ─────────────────────────────────────────────────────────────
// plegarKit y la ida y vuelta con aplicarKit
// ─────────────────────────────────────────────────────────────

await prueba('plegarKit: un bloque canónico se pliega al marcador corto', () => {
  const conKit = aplicarKit(documentoConMeta('noche'));
  const plegado = plegarKit(conKit);

  assert.ok(!plegado.includes('tailwind.config'), 'el bloque completo ya no puede estar');
  assert.ok(plegado.includes('kodu-kit:v1 tema=noche:'), 'tiene que quedar el marcador corto con el id');
  assert.equal(temaDe(plegado), 'noche', 'el meta no se toca al plegar');
});

await prueba('plegarKit: un bloque editado a mano no se pliega', () => {
  const conKit = aplicarKit(documentoConMeta('recreo'));
  const editado = conKit.replace('font-size:clamp(16px,0.55vw + 11px,20px)', 'font-size:16px');
  const resultado = plegarKit(editado);
  assert.equal(resultado, editado);
});

await prueba('plegarKit: sin bloque (ni canónico ni plegado), no hace nada', () => {
  const sinBloque = documentoConMeta('cuaderno');
  assert.equal(plegarKit(sinBloque), sinBloque);
});

await prueba('plegarKit: sobre un doc ya plegado no hace nada (idempotente)', () => {
  const plegado = plegarKit(aplicarKit(documentoConMeta('huerta')));
  assert.equal(plegarKit(plegado), plegado);
});

await prueba('ida y vuelta: aplicarKit(plegarKit(aplicarKit(x))) === aplicarKit(x)', () => {
  for (const tema of TEMAS) {
    const x = documentoConMeta(tema.id);
    const aplicadoUnaVez = aplicarKit(x);
    const idaYVuelta = aplicarKit(plegarKit(aplicadoUnaVez));
    assert.equal(idaYVuelta, aplicadoUnaVez, `round trip falló para ${tema.id}`);
  }
});

// ─────────────────────────────────────────────────────────────
// T1 (arnes-robustez): [hidden], window.kodu y el bloque legado
// (odd/tasks/arnes-robustez.md)
// ─────────────────────────────────────────────────────────────

await prueba('bloqueKit: lleva la regla [hidden]{display:none!important}', () => {
  for (const tema of TEMAS) {
    assert.ok(
      bloqueKit(tema.id).includes('[hidden]{display:none!important}'),
      `${tema.id}: falta la regla que arregla el defecto 2 (hidden pierde contra flex)`,
    );
  }
});

await prueba('bloqueKit: define window.kodu con los cuatro helpers públicos', () => {
  for (const tema of TEMAS) {
    const bloque = bloqueKit(tema.id);
    assert.ok(bloque.includes('window.kodu = {'), `${tema.id}: falta la asignación de window.kodu`);
    for (const helper of ['icono:', 'arrastrar:', 'despues:', 'cancelarTemporizadores:']) {
      assert.ok(bloque.includes(helper), `${tema.id}: falta el helper "${helper}"`);
    }
  }
});

await prueba('bloqueKitLegado: pinned contra el bloque canónico previo a T1', () => {
  // Hash calculado ANTES de este cambio, contra bloqueKit('pizarron') del
  // código en main (commit 98fa485, previo a la rama arnes-robustez) — ver
  // el comentario de BLOQUES_LEGADO_POR_ID en kit.ts. Si este assert falla,
  // construirBloque(tema, { legado: true }) dejó de reproducir byte a byte
  // el bloque viejo, y los recursos guardados con el kit anterior a T1
  // dejarían de reconocerse como canónicos.
  const hash = createHash('sha256').update(bloqueKitLegado('pizarron'), 'utf8').digest('hex');
  assert.equal(hash, 'ac6fd001d31b49cf449f54a288782ec824ae1da1014cda7cecc105e805b64a30');
});

await prueba('bloqueKitLegado: no lleva [hidden] ni window.kodu (es el bloque de antes de T1)', () => {
  const legado = bloqueKitLegado('cuaderno');
  assert.ok(!legado.includes('[hidden]{display:none!important}'));
  assert.ok(!legado.includes('window.kodu'));
  assert.ok(legado.startsWith('<!-- kodu-kit:v1:inicio tema=cuaderno -->'));
  assert.ok(legado.endsWith('<!-- kodu-kit:v1:fin -->'));
});

await prueba('aplicarKit: un recurso guardado con el bloque legado se actualiza al bloque actual', () => {
  // Simula un recurso guardado ANTES de T1: meta + bloque legado (no el que
  // arma aplicarKit, que ya usaría el bloque nuevo).
  const doc = documentoConMeta('noche', `${bloqueKitLegado('noche')}\n`);
  assert.ok(doc.includes(bloqueKitLegado('noche')), 'setup: el doc de prueba tiene que llevar el bloque legado');

  const resultado = aplicarKit(doc);
  assert.ok(resultado.includes(bloqueKit('noche')), 'aplicarKit tiene que subir al bloque canónico actual');
  assert.ok(resultado.includes('window.kodu'), 'el bloque insertado tiene que ser el nuevo, con window.kodu');
  assert.ok(!resultado.includes(bloqueKitLegado('noche')), 'el bloque legado viejo no puede quedar');
  assert.equal(aplicarKit(resultado), resultado, 'y ya queda estable (idempotente) en el bloque actual');
});

await prueba('plegarKit: un bloque legado también se pliega (sigue siendo canónico)', () => {
  const doc = documentoConMeta('recreo', `${bloqueKitLegado('recreo')}\n`);
  const plegado = plegarKit(doc);
  assert.ok(!plegado.includes('tailwind.config'), 'el bloque legado completo ya no puede estar');
  assert.ok(plegado.includes('kodu-kit:v1 tema=recreo:'), 'tiene que quedar el marcador corto');
});

await prueba('aplicarKit: un bloque legado editado a mano sigue sin tocarse', () => {
  const doc = documentoConMeta('huerta', `${bloqueKitLegado('huerta')}\n`);
  const editado = doc.replace(
    '<!-- kodu-kit:v1:fin -->',
    '<!-- un comentario de más, a mano --><!-- kodu-kit:v1:fin -->',
  );
  const resultado = aplicarKit(editado);
  assert.equal(resultado, editado, 'un bloque legado que ya no es byte a byte el legado de su id se respeta tal cual');
});

// ─────────────────────────────────────────────────────────────
// Round 2, T5 (arnes-robustez): íconos que nunca quedan viejos
// ─────────────────────────────────────────────────────────────

await prueba('bloqueKit: el observer de íconos ya no usa requestAnimationFrame (dibuja sync)', () => {
  for (const tema of TEMAS) {
    assert.ok(
      !bloqueKit(tema.id).includes('requestAnimationFrame'),
      `${tema.id}: no puede quedar rAF en el dibujo de íconos (round 2, T5)`,
    );
  }
});

await prueba('bloqueKit: dibujarIconos se expone como global privada para que SCRIPT_KODU la reuse', () => {
  for (const tema of TEMAS) {
    assert.ok(
      bloqueKit(tema.id).includes('window.__koduDibujarIconos'),
      `${tema.id}: falta la global compartida entre SCRIPT_ICONOS y SCRIPT_KODU`,
    );
  }
});

await prueba('bloqueKitLegado: sigue con el observer viejo por rAF (SCRIPT_ICONOS_LEGADO intacto)', () => {
  for (const tema of TEMAS) {
    assert.ok(
      bloqueKitLegado(tema.id).includes('requestAnimationFrame'),
      `${tema.id}: el bloque legado tiene que conservar el observer viejo tal cual`,
    );
    assert.ok(!bloqueKitLegado(tema.id).includes('__koduDibujarIconos'));
  }
});

// ─────────────────────────────────────────────────────────────
// Round 2, T6 (arnes-robustez): kodu.arrastrar a prueba de mal uso
// ─────────────────────────────────────────────────────────────

await prueba('bloqueKit: arrastrar() soporta el modo unidad (alCambiar, eje, min/max/paso, valor, ARIA)', () => {
  for (const tema of TEMAS) {
    const bloque = bloqueKit(tema.id);
    for (const fragmento of [
      'modoUnidad',
      'opciones.alCambiar',
      "opciones.eje === 'y'",
      'role',
      'aria-valuemin',
      'aria-valuemax',
      'aria-valuenow',
    ]) {
      assert.ok(bloque.includes(fragmento), `${tema.id}: falta "${fragmento}" del modo unidad`);
    }
  }
});

await prueba('bloqueKit: arrastrar() escucha el teclado en captura y corta la propagación', () => {
  for (const tema of TEMAS) {
    const bloque = bloqueKit(tema.id);
    assert.ok(bloque.includes("addEventListener('keydown', alTecla, true)"), `${tema.id}: falta el registro en captura`);
    assert.ok(bloque.includes('stopImmediatePropagation'), `${tema.id}: falta stopImmediatePropagation`);
  }
});

await prueba('bloqueKit: arrastrar() elige el arrastrable más cercano entre superpuestos (registro compartido)', () => {
  for (const tema of TEMAS) {
    const bloque = bloqueKit(tema.id);
    assert.ok(bloque.includes('registroArrastre'), `${tema.id}: falta el registro compartido`);
    assert.ok(bloque.includes('elegirArrastrable'), `${tema.id}: falta la selección por cercanía`);
  }
});

await prueba('bloqueKit: arrastrar() escucha move/up/cancel en window (sobrevive a un re-render)', () => {
  for (const tema of TEMAS) {
    const bloque = bloqueKit(tema.id);
    assert.ok(bloque.includes("window.addEventListener('pointermove'"), `${tema.id}: el arrastre tiene que escuchar en window`);
    assert.ok(
      !bloque.includes("addEventListener('lostpointercapture'"),
      `${tema.id}: no puede depender de lostpointercapture para terminar el arrastre`,
    );
  }
});

await prueba('bloqueKit: el punto del modo bajo nivel tiene valueOf (red de seguridad de mal uso numérico)', () => {
  for (const tema of TEMAS) {
    assert.ok(bloqueKit(tema.id).includes('crearPuntoDrag'), `${tema.id}: falta la fábrica de puntos con valueOf`);
  }
});

// ─────────────────────────────────────────────────────────────
// T11: red de seguridad — usaClasesDeTailwind y aplicarKitConRedDeSeguridad
// ─────────────────────────────────────────────────────────────

/** Un `<div>` con un puñado de clases de Tailwind bien variadas: alcanza de sobra el mínimo. */
const DIV_CON_TAILWIND = '<div class="flex items-center gap-4 p-6 rounded-lg bg-blue-600 text-white md:flex">Hola</div>';

function documentoSinMeta(cuerpo: string): string {
  return `<!DOCTYPE html>\n<html lang="es">\n<head>\n</head>\n<body>\n${cuerpo}\n</body>\n</html>`;
}

await prueba('usaClasesDeTailwind: detecta clases de sobra en markup y responsive', () => {
  assert.equal(usaClasesDeTailwind(documentoSinMeta(DIV_CON_TAILWIND)), true);
});

await prueba('usaClasesDeTailwind: también mira className/setAttribute/classList.add en JS', () => {
  const html = documentoSinMeta(
    '<div id="x"></div><script>' +
      'document.getElementById("x").className = "flex items-center";' +
      'document.getElementById("x").setAttribute("class", "gap-4 p-6");' +
      'document.getElementById("x").classList.add("rounded-lg", "bg-blue-600");' +
      '</script>',
  );
  assert.equal(usaClasesDeTailwind(html), true);
});

await prueba('usaClasesDeTailwind: CSS plano sin clases de utilidad da false', () => {
  const html = documentoSinMeta('<style>.tarjeta{padding:1rem;background:#fff}</style><div class="tarjeta">Hola</div>');
  assert.equal(usaClasesDeTailwind(html), false);
});

await prueba('usaClasesDeTailwind: un par de clases propias con forma de utilidad no alcanza el mínimo', () => {
  const html = documentoSinMeta('<div class="top-bar row-header">Hola</div>');
  assert.equal(usaClasesDeTailwind(html), false, 'dos coincidencias sueltas no tienen que alcanzar el mínimo');
});

await prueba('aplicarKitConRedDeSeguridad: sin meta, sin temaPrevio, sin Tailwind propio, con clases → cae a cuaderno', () => {
  const html = documentoSinMeta(DIV_CON_TAILWIND);
  const resultado = aplicarKitConRedDeSeguridad(html);
  assert.equal(temaDe(resultado), 'cuaderno', 'tiene que insertar el meta de cuaderno, el tema más neutro');
  assert.ok(resultado.includes(bloqueKit('cuaderno')), 'tiene que insertar el bloque canónico de cuaderno');
});

await prueba('aplicarKitConRedDeSeguridad: si ya carga su propio Tailwind por CDN, no toca nada', () => {
  const html =
    '<!DOCTYPE html>\n<html lang="es">\n<head>\n<script src="https://cdn.tailwindcss.com"></script>\n</head>\n' +
    `<body>\n${DIV_CON_TAILWIND}\n</body>\n</html>`;
  assert.equal(aplicarKitConRedDeSeguridad(html), html, 'un recurso que YA trae Tailwind no necesita el respaldo');
});

await prueba('aplicarKitConRedDeSeguridad: CSS plano sin clases de utilidad no toca nada', () => {
  const html = documentoSinMeta('<style>.tarjeta{padding:1rem;background:#fff}</style><div class="tarjeta">Hola</div>');
  assert.equal(aplicarKitConRedDeSeguridad(html), html);
});

await prueba('aplicarKitConRedDeSeguridad: un par de clases sueltas con forma de utilidad no toca nada', () => {
  const html = documentoSinMeta('<div class="top-bar row-header">Hola</div>');
  assert.equal(aplicarKitConRedDeSeguridad(html), html, 'por debajo del mínimo: no hay evidencia suficiente de Tailwind');
});

await prueba('aplicarKitConRedDeSeguridad: con meta válido, el meta manda aunque haya clases de Tailwind', () => {
  const html =
    `<!DOCTYPE html>\n<html lang="es">\n<head>\n<meta name="kodu-tema" content="plano">\n</head>\n` +
    `<body>\n${DIV_CON_TAILWIND}\n</body>\n</html>`;
  const resultado = aplicarKitConRedDeSeguridad(html);
  assert.equal(temaDe(resultado), 'plano', 'el meta existente manda; la red de seguridad no participa');
  assert.ok(resultado.includes(bloqueKit('plano')));
  assert.ok(!resultado.includes(bloqueKit('cuaderno')));
});

await prueba('aplicarKitConRedDeSeguridad: con temaPrevio válido, gana por sobre la red de seguridad', () => {
  const html = documentoSinMeta(DIV_CON_TAILWIND);
  const resultado = aplicarKitConRedDeSeguridad(html, { temaPrevio: 'noche' });
  assert.equal(temaDe(resultado), 'noche', 'el temaPrevio ya es un respaldo válido; la red de seguridad no participa');
  assert.ok(resultado.includes(bloqueKit('noche')));
  assert.ok(!resultado.includes(bloqueKit('cuaderno')));
});

await prueba('aplicarKitConRedDeSeguridad es idempotente incluso cuando aplica la red de seguridad', () => {
  const html = documentoSinMeta(DIV_CON_TAILWIND);
  const una = aplicarKitConRedDeSeguridad(html);
  const dos = aplicarKitConRedDeSeguridad(una);
  assert.equal(dos, una);
  assert.equal(temaDe(una), 'cuaderno');
});

await prueba('aplicarKitConRedDeSeguridad: ida y vuelta con plegarKit', () => {
  const html = documentoSinMeta(DIV_CON_TAILWIND);
  const aplicado = aplicarKitConRedDeSeguridad(html);
  const idaYVuelta = aplicarKitConRedDeSeguridad(plegarKit(aplicado));
  assert.equal(idaYVuelta, aplicado);
});

// ─────────────────────────────────────────────────────────────
// bloqueKit / esTemaId / temaPorId
// ─────────────────────────────────────────────────────────────

await prueba('bloqueKit: es determinista y lleva los delimitadores y URLs esperados', () => {
  const a = bloqueKit('pizarron');
  const b = bloqueKit('pizarron');
  assert.equal(a, b);
  assert.ok(a.startsWith('<!-- kodu-kit:v1:inicio tema=pizarron -->'));
  assert.ok(a.endsWith('<!-- kodu-kit:v1:fin -->'));
  assert.ok(a.includes('https://cdn.tailwindcss.com'));
  assert.ok(a.includes('https://cdn.jsdelivr.net/npm/lucide@1.47.0/dist/umd/lucide.min.js'));
  assert.ok(a.includes('fonts.googleapis.com/css2'));
  assert.ok(a.includes('display=swap'));
});

await prueba('esTemaId / temaPorId: básico', () => {
  assert.equal(esTemaId('pizarron'), true);
  assert.equal(esTemaId('no-existe'), false);
  assert.equal(temaPorId('pizarron').nombre, 'Pizarrón');
  assert.equal(TEMAS.length, 8);
});

// ─────────────────────────────────────────────────────────────
// Lucide (lucide-nombres.ts)
// ─────────────────────────────────────────────────────────────

const NOMBRES_APENDICE_B = [
  'check', 'x', 'lightbulb', 'rotate-ccw', 'play', 'pause', 'volume-2', 'timer', 'trophy', 'star',
  'heart', 'arrow-left', 'arrow-right', 'chevron-right', 'info', 'circle-help', 'book-open', 'pencil',
  'flask-conical', 'atom', 'globe', 'map', 'calculator', 'music', 'palette', 'puzzle', 'dice-5',
  'target', 'flag', 'eye', 'shuffle', 'list-checks',
];

await prueba('NOMBRES_LUCIDE: todos los íconos de ejemplo del Apéndice B existen', () => {
  for (const nombre of NOMBRES_APENDICE_B) {
    assert.ok(NOMBRES_LUCIDE.has(nombre), `falta "${nombre}"`);
  }
});

await prueba('NOMBRES_LUCIDE: un nombre inventado no existe', () => {
  assert.equal(NOMBRES_LUCIDE.has('banana-voladora-3000'), false);
  assert.equal(NOMBRES_LUCIDE.has('icono-que-no-existe'), false);
  assert.equal(NOMBRES_LUCIDE.has(''), false);
});

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad-kit.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/unidad-kit.ts: todas las pruebas pasaron');
}
