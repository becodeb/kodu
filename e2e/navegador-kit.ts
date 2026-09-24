import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { aplicarKit } from '../src/lib/ai/kit.ts';

/**
 * Verificación en Chromium real de `window.kodu` (T2 de
 * `odd/tasks/arnes-robustez.md`): las pruebas unitarias de
 * `e2e/unidad-kit.ts` sólo miran el TEXTO del bloque, no si el JS embebido
 * funciona de verdad en un navegador — mouse, dedo y teclado son casos que
 * ninguna prueba de texto puede cubrir.
 *
 * Sin test runner en el repo (ver openspec/context.md): se corre con
 * `npx tsx e2e/navegador-kit.ts` y sale con código de error si algo falla.
 * Chromium del sistema, nunca `playwright install` (ver harness.ts).
 */

const CHROMIUM_PW = '/opt/pw-browsers/chromium';
const CHROMIUM_SISTEMA = '/usr/bin/chromium';
const executablePath = existsSync(CHROMIUM_PW) ? CHROMIUM_PW : CHROMIUM_SISTEMA;

interface PuntoDrag {
  x: number;
  y: number;
  dx: number;
  dy: number;
  teclado: boolean;
}

/**
 * `window.kodu` y `window.__test` sólo existen adentro del navegador (los
 * agrega el `<script>` embebido de `construirPagina` / el bloque del kit),
 * nunca en este proceso de Node — pero los `page.evaluate(() => …)` de más
 * abajo SÍ son TypeScript de verdad y `tsc --noEmit` los tipa contra el
 * `lib.dom` de este mismo archivo. Sin esto, `window.kodu`/`window.__test`
 * serían "Property does not exist on type Window".
 */
interface OpcionesArrastrarBajoNivel {
  mover?: (p: PuntoDrag) => void;
  soltar?: (p: PuntoDrag) => void;
  area?: Element;
  paso?: number;
}

interface OpcionesArrastrarUnidad {
  area?: Element;
  eje?: 'x' | 'y';
  min?: number;
  max?: number;
  paso?: number;
  valor?: () => number;
  alCambiar: (v: number) => void;
  alSoltar?: (v: number) => void;
}

declare global {
  interface Window {
    kodu: {
      icono: (el: Element, nombre: string) => Element | null;
      arrastrar: {
        (el: Element, opciones: OpcionesArrastrarBajoNivel): () => void;
        (el: Element, opciones: OpcionesArrastrarUnidad): () => void;
      };
      despues: (ms: number, fn: () => void) => number;
      cada: (ms: number, fn: () => void) => number;
      cancelarTemporizadores: () => void;
      festejar: (opciones?: Record<string, unknown>) => void;
      mezclar: <T>(lista: T[]) => T[];
    };
    confetti?: { (opciones?: Record<string, unknown>): unknown; reset: () => void };
    __test: {
      moverHtml: PuntoDrag[];
      soltarHtml: PuntoDrag[];
      moverSvg: PuntoDrag[];
      soltarSvg: PuntoDrag[];
      moverTeclado: PuntoDrag[];
      soltarTeclado: PuntoDrag[];
      moverTouch: PuntoDrag[];
      soltarTouch: PuntoDrag[];
      moverOverlay: PuntoDrag[];
      soltarOverlay: PuntoDrag[];
      moverTecladoSvg: PuntoDrag[];
      soltarTecladoSvg: PuntoDrag[];
      moverTecladoHtml: PuntoDrag[];
      soltarTecladoHtml: PuntoDrag[];
      timerDisparado: boolean;
      svgSyncAlCargar: boolean | null;
      // Round 2, T6 (modo unidad, keyboard ownership, nearest-target, re-render)
      unidadCambios: number[];
      unidadSoltar: number[];
      touchUnidadCambios: number[];
      touchUnidadSoltar: number[];
      decimalCambios: number[];
      verticalCambios: number[];
      tecladoUnidadCambios: number[];
      tecladoUnidadSoltar: number[];
      contadorDocumentFlechas: number;
      contadorMismoElementoExtra: number;
      moverChico: PuntoDrag[];
      moverGrande: PuntoDrag[];
      rerenderCambios: number[];
      rerenderSoltar: number[];
      safetyValores: unknown[];
    };
  }
}

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

/**
 * Página de prueba: un solo recurso con el kit real aplicado (CDN real de
 * Tailwind, Google Fonts y Lucide 1.47.0 — nada mockeado) y un elemento por
 * caso de la lista de T2. `window.__test` junta lo que cada callback de
 * `kodu.arrastrar` recibió, para que Playwright lo lea con `page.evaluate`.
 */
function construirPagina(): string {
  const documento = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="pizarron">
<style>
  body{margin:0;padding:0}
  #area-html,#area-teclado,#area-touch,#area-overlay,#area-teclado-html{position:relative;background:#eee}
  .caja{position:absolute;width:24px;height:24px;background:#333}
</style>
</head>
<body>
  <!-- Se crea temprano (antes que cualquier ícono en el markup) con el único
       campo que una prueba necesita ANTES del script de inicialización de
       más abajo: la prueba (a) de T5 lee document.querySelector(svg) desde
       un script inline que corre en medio del parseo del body. -->
  <script>window.__test = { svgSyncAlCargar: null };</script>

  <div id="cartel" class="flex" hidden>banner de fin</div>

  <button id="btn-icono" type="button"><i data-lucide="play" class="autor-clase"></i></button>

  <div id="area-html" style="width:300px;height:300px;">
    <div id="drag-html" class="caja" style="left:10px;top:10px;"></div>
  </div>

  <svg id="area-svg" viewBox="0 0 100 100" width="300" height="300" style="display:block;background:#ddd;">
    <circle id="drag-svg" cx="20" cy="20" r="6"></circle>
  </svg>

  <div id="area-teclado" style="width:300px;height:300px;">
    <div id="drag-teclado" class="caja" style="left:10px;top:10px;"></div>
  </div>

  <div id="area-touch" style="width:300px;height:300px;">
    <div id="drag-touch" class="caja" style="left:10px;top:10px;"></div>
  </div>

  <div id="area-overlay" style="width:100px;height:100px;">
    <div id="drag-overlay" class="caja" style="left:10px;top:10px;z-index:1;"></div>
    <div id="capa-decorativa" style="position:absolute;inset:0;pointer-events:none;background:rgba(0,0,0,.15);z-index:2;"></div>
  </div>

  <!-- T4 (arnes-robustez): p.x/p.y del teclado tienen que quedar en las
       MISMAS unidades que area, no un acumulador propio arrancando en 0. -->
  <svg id="area-svg-teclado" viewBox="0 0 100 100" width="300" height="300" style="display:block;background:#ddd;">
    <circle id="drag-svg-teclado" cx="30" cy="50" r="6"></circle>
  </svg>

  <div id="area-teclado-html" style="width:300px;height:300px;">
    <div id="drag-teclado-html" class="caja" style="left:40px;top:60px;"></div>
  </div>

  <!-- Round 2, T5: prueba (a) — un ícono en el markup seguido de un script
       inline tiene que encontrar el <svg> YA dibujado en ese mismo momento
       (dibujo síncrono en el callback del observer, no en el próximo frame). -->
  <button id="btn-icono-sync" type="button"><i data-lucide="check"></i></button>
  <script>
    window.__test.svgSyncAlCargar = !!document.querySelector('#btn-icono-sync svg');
  </script>

  <!-- Round 2, T5: prueba (c) — dos íconos en el mismo contenedor; swapear
       uno con kodu.icono no puede tocar al hermano. -->
  <div id="contenedor-dos-iconos">
    <i id="icono-a" data-lucide="check"></i>
    <i id="icono-b" data-lucide="x"></i>
  </div>

  <!-- Round 2, T6: modo unidad — pista horizontal 500px, 0..10, paso 1. -->
  <div id="pista-unidad" style="position:relative;width:500px;height:20px;background:#ccc;">
    <div id="perilla-unidad" style="position:absolute;width:20px;height:20px;border-radius:50%;background:#333;left:150px;top:0;"></div>
  </div>

  <!-- misma forma, para el touch real -->
  <div id="pista-touch-unidad" style="position:relative;width:500px;height:20px;background:#ccc;">
    <div id="perilla-touch-unidad" style="position:absolute;width:20px;height:20px;border-radius:50%;background:#333;left:150px;top:0;"></div>
  </div>

  <!-- paso decimal: 200px, 0..1, paso 0.1 -->
  <div id="pista-decimal" style="position:relative;width:200px;height:20px;background:#ccc;">
    <div id="perilla-decimal" style="position:absolute;width:20px;height:20px;background:#333;left:0;top:0;"></div>
  </div>

  <!-- eje y: pista vertical 300px, 0..10, paso 1; min abajo, max arriba -->
  <div id="pista-vertical" style="position:relative;width:20px;height:300px;background:#ccc;">
    <div id="perilla-vertical" style="position:absolute;width:20px;height:20px;background:#333;left:0;top:280px;"></div>
  </div>

  <!-- teclado en modo unidad: 300px, 0..10, paso 1 -->
  <div id="pista-teclado-unidad" style="position:relative;width:300px;height:20px;background:#ccc;">
    <div id="perilla-teclado-unidad" style="position:absolute;width:20px;height:20px;background:#333;left:0;top:0;"></div>
  </div>

  <!-- dos arrastrables superpuestos: circulo-grande se pinta ENCIMA (va
       después en el DOM) pero su centro está más lejos del punto donde se
       agarra (el centro de circulo-chico) -->
  <svg id="area-superpuestos" viewBox="0 0 100 100" width="200" height="200" style="display:block;background:#ddd;">
    <circle id="circulo-chico" cx="75" cy="35" r="10" fill="#06c"></circle>
    <circle id="circulo-grande" cx="50" cy="50" r="40" fill="rgba(200,0,0,.5)"></circle>
  </svg>

  <!-- re-render a mitad de arrastre (modo unidad) -->
  <div id="pista-rerender" style="position:relative;width:300px;height:20px;background:#ccc;">
    <div id="perilla-rerender" style="position:absolute;width:20px;height:20px;background:#333;left:0;top:0;"></div>
  </div>

  <!-- modo bajo nivel: red de seguridad de p.valueOf -->
  <div id="area-safety" style="width:200px;height:100px;">
    <div id="drag-safety" class="caja" style="left:10px;top:10px;"></div>
  </div>

  <!-- fuerza scroll disponible: si ArrowUp/ArrowDown NO se previenen, esto se mueve -->
  <div id="relleno" style="height:3000px;"></div>

  <script>
    Object.assign(window.__test, {
      moverHtml: [], soltarHtml: [],
      moverSvg: [], soltarSvg: [],
      moverTeclado: [], soltarTeclado: [],
      moverTouch: [], soltarTouch: [],
      moverOverlay: [], soltarOverlay: [],
      moverTecladoSvg: [], soltarTecladoSvg: [],
      moverTecladoHtml: [], soltarTecladoHtml: [],
      timerDisparado: false,
      unidadCambios: [], unidadSoltar: [],
      touchUnidadCambios: [], touchUnidadSoltar: [],
      decimalCambios: [],
      verticalCambios: [],
      tecladoUnidadCambios: [], tecladoUnidadSoltar: [],
      contadorDocumentFlechas: 0,
      contadorMismoElementoExtra: 0,
      moverChico: [], moverGrande: [],
      rerenderCambios: [], rerenderSoltar: [],
      safetyValores: []
      // svgSyncAlCargar NO se pisa acá: ya lo puso el script de la prueba
      // (a) más arriba, y Object.assign sobre el mismo objeto lo conserva.
    });

    kodu.arrastrar(document.getElementById('drag-html'), {
      mover: function (p) { window.__test.moverHtml.push(p); },
      soltar: function (p) { window.__test.soltarHtml.push(p); }
    });
    kodu.arrastrar(document.getElementById('drag-svg'), {
      mover: function (p) { window.__test.moverSvg.push(p); },
      soltar: function (p) { window.__test.soltarSvg.push(p); }
    });
    kodu.arrastrar(document.getElementById('drag-teclado'), {
      mover: function (p) { window.__test.moverTeclado.push(p); },
      soltar: function (p) { window.__test.soltarTeclado.push(p); }
    });
    kodu.arrastrar(document.getElementById('drag-touch'), {
      mover: function (p) { window.__test.moverTouch.push(p); },
      soltar: function (p) { window.__test.soltarTouch.push(p); }
    });
    kodu.arrastrar(document.getElementById('drag-overlay'), {
      mover: function (p) { window.__test.moverOverlay.push(p); },
      soltar: function (p) { window.__test.soltarOverlay.push(p); }
    });

    // El mover() aplica p.x/p.y de vuelta al elemento, tal como haría un
    // recurso real (setAttribute('cx', p.x)): así una segunda flecha
    // demuestra que la posición se acumula desde donde quedó el elemento,
    // no desde un contador interno que reiniciaba en 0.
    kodu.arrastrar(document.getElementById('drag-svg-teclado'), {
      paso: 5,
      mover: function (p) {
        window.__test.moverTecladoSvg.push(p);
        var circulo = document.getElementById('drag-svg-teclado');
        circulo.setAttribute('cx', p.x);
        circulo.setAttribute('cy', p.y);
      },
      soltar: function (p) { window.__test.soltarTecladoSvg.push(p); }
    });
    kodu.arrastrar(document.getElementById('drag-teclado-html'), {
      paso: 5,
      mover: function (p) {
        window.__test.moverTecladoHtml.push(p);
        var elemento = document.getElementById('drag-teclado-html');
        elemento.style.left = (p.x - 12) + 'px';
        elemento.style.top = (p.y - 12) + 'px';
      },
      soltar: function (p) { window.__test.soltarTecladoHtml.push(p); }
    });

    // Se agenda Y se cancela en el mismo tick: si cancelarTemporizadores()
    // no barriera de verdad el timer, dispararía solo ~100ms después.
    kodu.despues(100, function () { window.__test.timerDisparado = true; });
    kodu.cancelarTemporizadores();

    // ── Round 2, T6: modo unidad ────────────────────────────────────────
    var valorPista = 3;
    kodu.arrastrar(document.getElementById('perilla-unidad'), {
      min: 0, max: 10, paso: 1,
      valor: function () { return valorPista; },
      alCambiar: function (v) { valorPista = v; window.__test.unidadCambios.push(v); },
      alSoltar: function (v) { window.__test.unidadSoltar.push(v); }
    });

    var valorPistaTouch = 3;
    kodu.arrastrar(document.getElementById('perilla-touch-unidad'), {
      min: 0, max: 10, paso: 1,
      valor: function () { return valorPistaTouch; },
      alCambiar: function (v) { valorPistaTouch = v; window.__test.touchUnidadCambios.push(v); },
      alSoltar: function (v) { window.__test.touchUnidadSoltar.push(v); }
    });

    var valorDecimal = 0;
    kodu.arrastrar(document.getElementById('perilla-decimal'), {
      min: 0, max: 1, paso: 0.1,
      valor: function () { return valorDecimal; },
      alCambiar: function (v) { valorDecimal = v; window.__test.decimalCambios.push(v); }
    });

    var valorVertical = 0;
    kodu.arrastrar(document.getElementById('perilla-vertical'), {
      eje: 'y', min: 0, max: 10, paso: 1,
      valor: function () { return valorVertical; },
      alCambiar: function (v) { valorVertical = v; window.__test.verticalCambios.push(v); }
    });

    var valorTecladoUnidad = 0;
    kodu.arrastrar(document.getElementById('perilla-teclado-unidad'), {
      min: 0, max: 10, paso: 1,
      valor: function () { return valorTecladoUnidad; },
      alCambiar: function (v) { valorTecladoUnidad = v; window.__test.tecladoUnidadCambios.push(v); },
      alSoltar: function (v) { window.__test.tecladoUnidadSoltar.push(v); }
    });

    kodu.arrastrar(document.getElementById('circulo-chico'), {
      mover: function (p) { window.__test.moverChico.push(p); }
    });
    kodu.arrastrar(document.getElementById('circulo-grande'), {
      mover: function (p) { window.__test.moverGrande.push(p); }
    });

    var valorRerender = 0;
    function registrarRerender(elemento) {
      return kodu.arrastrar(elemento, {
        min: 0, max: 10, paso: 1,
        valor: function () { return valorRerender; },
        alCambiar: function (v) {
          valorRerender = v;
          window.__test.rerenderCambios.push(v);
          if (window.__test.rerenderCambios.length === 1) {
            var clon = elemento.cloneNode(true);
            elemento.parentNode.replaceChild(clon, elemento);
            registrarRerender(clon);
          }
        },
        alSoltar: function (v) { window.__test.rerenderSoltar.push(v); }
      });
    }
    registrarRerender(document.getElementById('perilla-rerender'));

    kodu.arrastrar(document.getElementById('drag-safety'), {
      mover: function (x) { window.__test.safetyValores.push(x + 0); }
    });
  </script>
</body>
</html>`;
  return aplicarKit(documento);
}

interface CajaCss {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * La página de prueba junta muchas áreas una debajo de la otra y con el
 * viewport por defecto las últimas (touch, overlay) quedan fuera de lo
 * visible: `boundingBox()` igual devuelve sus coordenadas (relativas al
 * viewport actual, no al documento), y mouse/touch dispatchados ahí no le
 * pegan a nada. `scrollIntoViewIfNeeded` antes de medir evita justamente eso.
 */
async function cajaDe(page: Page, selector: string): Promise<CajaCss> {
  const locator = page.locator(selector);
  await locator.scrollIntoViewIfNeeded();
  const caja = await locator.boundingBox();
  if (!caja) throw new Error(`sin bounding box: ${selector}`);
  return caja;
}

async function arrastrarConMouse(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const caja = await cajaDe(page, selector);
  const cx = caja.x + caja.width / 2;
  const cy = caja.y + caja.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
  await page.mouse.up();
}

/** CDP `Input.dispatchTouchEvent` real (no `page.locator().tap()`): así se prueba el camino de Pointer Events con `pointerType: 'touch'` de punta a punta, tal como lo dispara un dedo real. */
async function arrastrarConTouch(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const caja = await cajaDe(page, selector);
  const cx = caja.x + caja.width / 2;
  const cy = caja.y + caja.height / 2;
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + dx, y: cy + dy }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

/**
 * Round 2, T7: kodu.festejar() dibuja con la librería real de canvas-confetti
 * (nada mockeado) en un <canvas> que la propia librería crea y agrega
 * síncronamente a document.body al primer disparo. No se puede leer los
 * píxeles: la instancia global de canvas-confetti (la que usa el atajo
 * `confetti(opciones)` que llama kodu.festejar) siempre usa un Worker +
 * OffscreenCanvas (`useWorker` queda fijo en `true` la primera vez que se
 * crea esa instancia compartida, ver `dist/confetti.browser.min.js`), así
 * que `canvas.getContext('2d')` tira `InvalidStateError` ("transferred its
 * control to offscreen") — confirmado corriendo la prueba. La señal
 * observable desde el hilo principal es la presencia del <canvas>: la
 * librería lo agrega a document.body al animar y lo saca cuando termina
 * (naturalmente) o cuando se llama a reset().
 */
async function hayCanvasDeConfetti(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    var canvas = document.querySelector('canvas');
    return !!canvas && canvas.width > 0 && canvas.height > 0;
  });
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-gpu'] });
  // hasTouch: sin esto Chromium ignora Input.dispatchTouchEvent (necesita
  // touch emulation habilitada para sintetizar el PointerEvent de touch).
  const context = await browser.newContext({ hasTouch: true });
  const page = await context.newPage();

  const erroresPagina: string[] = [];
  page.on('pageerror', (error) => erroresPagina.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') erroresPagina.push(`console.error: ${msg.text()}`);
  });

  await page.setContent(construirPagina(), { waitUntil: 'load' });
  // Lucide llega por CDN y dibuja recién tras DOMContentLoaded/carga del
  // script: hay que esperar el primer dibujo antes de tocar el ícono.
  await page.waitForFunction(() => !!document.querySelector('#btn-icono svg[data-lucide="play"]'), undefined, {
    timeout: 15_000,
  });

  try {
    // ── hidden vs flex (defecto 2) ─────────────────────────────────────
    await prueba('[hidden] gana contra .flex: no se muestra con el atributo puesto', async () => {
      const display = await page.locator('#cartel').evaluate((el) => getComputedStyle(el).display);
      assert.equal(display, 'none', 'con hidden puesto, display computado tiene que ser none');
    });

    await prueba('[hidden] al sacarlo, .flex se muestra de verdad', async () => {
      await page.locator('#cartel').evaluate((el) => el.removeAttribute('hidden'));
      const display = await page.locator('#cartel').evaluate((el) => getComputedStyle(el).display);
      assert.equal(display, 'flex', 'sin hidden, la clase flex tiene que mandar');
      await page.locator('#cartel').evaluate((el) => el.setAttribute('hidden', ''));
    });

    // ── swap de ícono repetido (defecto 1) ─────────────────────────────
    await prueba('kodu.icono: swap repetido en el mismo tick, siempre un solo svg correcto', async () => {
      const resultado = await page.evaluate(() => {
        var boton = document.getElementById('btn-icono')!;
        window.kodu.icono(boton, 'pause');
        window.kodu.icono(boton, 'play');
        var ultimo = window.kodu.icono(boton, 'pause');
        var svgs = boton.querySelectorAll('svg');
        return {
          cantidadSvg: svgs.length,
          dataLucide: svgs.length === 1 ? svgs[0].getAttribute('data-lucide') : null,
          tieneClaseAutor: svgs.length === 1 ? svgs[0].classList.contains('autor-clase') : false,
          esElUltimoDevuelto: svgs.length === 1 ? svgs[0] === ultimo : false,
        };
      });
      assert.equal(resultado.cantidadSvg, 1, 'tiene que quedar exactamente un svg en el botón');
      assert.equal(resultado.dataLucide, 'pause');
      assert.equal(resultado.tieneClaseAutor, true, 'la clase del autor no se puede perder en el swap');
      assert.equal(resultado.esElUltimoDevuelto, true, 'icono() tiene que devolver el nodo final');
    });

    await prueba('kodu.icono: acepta el propio <svg> ya dibujado como "el ícono", no sólo el contenedor', async () => {
      const resultado = await page.evaluate(() => {
        var boton = document.getElementById('btn-icono')!;
        var svgActual = boton.querySelector('svg')!;
        var devuelto = window.kodu.icono(svgActual, 'star');
        var svgs = boton.querySelectorAll('svg');
        return {
          cantidadSvg: svgs.length,
          dataLucide: svgs.length === 1 ? svgs[0].getAttribute('data-lucide') : null,
          devuelveElNuevo: svgs.length === 1 ? devuelto === svgs[0] : false,
        };
      });
      assert.equal(resultado.cantidadSvg, 1);
      assert.equal(resultado.dataLucide, 'star');
      assert.equal(resultado.devuelveElNuevo, true);
    });

    // ── Round 2, T5: dibujo síncrono, nunca se re-reemplaza un svg dibujado ──
    await prueba('SCRIPT_ICONOS: un script inline justo después del markup ya encuentra el <svg> dibujado', async () => {
      const sync = await page.evaluate(() => window.__test.svgSyncAlCargar);
      assert.equal(sync, true, 'el dibujo tiene que ser síncrono (microtarea del observer), no esperar al próximo frame');
    });

    await prueba('SCRIPT_ICONOS: agregar un ícono nuevo en otro lado no vuelve a reemplazar un <svg> ya dibujado', async () => {
      const conectado = await page.evaluate(() => {
        return new Promise<boolean>((resolve) => {
          var referencia = document.querySelector('#btn-icono svg') as Element;
          var nuevo = document.createElement('i');
          nuevo.setAttribute('data-lucide', 'heart');
          document.body.appendChild(nuevo);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve(referencia.isConnected);
            });
          });
        });
      });
      assert.equal(conectado, true, 'un <svg> ya dibujado no puede perder identidad porque se dibujó otro ícono en cualquier lugar');
    });

    await prueba('kodu.icono: swap de uno no toca al hermano del mismo contenedor (sigue conectado, mismo nodo)', async () => {
      // Espera a que el dibujo inicial (sync, en el observer) haya resuelto
      // los dos <i> del contenedor a <svg>.
      await page.waitForFunction(() => {
        var c = document.getElementById('contenedor-dos-iconos')!;
        return c.querySelectorAll('svg').length === 2;
      });
      const resultado = await page.evaluate(() => {
        var contenedor = document.getElementById('contenedor-dos-iconos')!;
        var iconoA = document.getElementById('icono-a')!;
        var iconoB = document.getElementById('icono-b')!;
        var nuevo = window.kodu.icono(iconoA, 'pause');
        return {
          hermanoConectado: iconoB.isConnected,
          hermanoSigueSiendoX: iconoB.getAttribute('data-lucide'),
          targetPaso: nuevo ? nuevo.getAttribute('data-lucide') : null,
          targetEsElDevuelto: nuevo === contenedor.querySelector('#icono-a'),
          quedaUnSoloSvgTargetEnContenedor: contenedor.querySelectorAll('[data-lucide="pause"]').length,
        };
      });
      assert.equal(resultado.hermanoConectado, true, 'el hermano ya dibujado no puede desconectarse del documento');
      assert.equal(resultado.hermanoSigueSiendoX, 'x', 'el hermano no puede cambiar de ícono');
      assert.equal(resultado.targetPaso, 'pause');
      assert.equal(resultado.targetEsElDevuelto, true);
      assert.equal(resultado.quedaUnSoloSvgTargetEnContenedor, 1);
    });

    // ── arrastre con mouse, HTML ────────────────────────────────────────
    await prueba('kodu.arrastrar: mouse sobre un <div> HTML — mover llega, soltar UNA vez', async () => {
      await arrastrarConMouse(page, '#drag-html', 40, 25);
      const estado = await page.evaluate(() => ({
        movidas: window.__test.moverHtml.length,
        soltadas: window.__test.soltarHtml.length,
        ultimaEsTeclado: window.__test.moverHtml[window.__test.moverHtml.length - 1]?.teclado,
      }));
      assert.ok(estado.movidas > 0, 'tiene que haber recibido al menos un mover()');
      assert.equal(estado.soltadas, 1, 'soltar() tiene que dispararse exactamente una vez');
      assert.equal(estado.ultimaEsTeclado, false);
    });

    // ── arrastre con mouse, SVG con viewBox escalado ────────────────────
    await prueba('kodu.arrastrar: mouse sobre un <circle> SVG — coordenadas en unidades de usuario del SVG', async () => {
      await arrastrarConMouse(page, '#drag-svg', 60, 30);
      const estado = await page.evaluate(() => ({
        movidas: window.__test.moverSvg as PuntoDrag[],
        soltadas: window.__test.soltarSvg.length,
      }));
      assert.ok(estado.movidas.length > 0, 'tiene que haber recibido al menos un mover()');
      assert.equal(estado.soltadas, 1);
      // El viewBox es 0..100 pero el SVG se dibuja a 300x300 (escala 3x): si
      // las coordenadas NO se convirtieran, x/y andarían por los cientos
      // (píxeles de pantalla) en vez de quedarse cerca del rango 0..100.
      for (const p of estado.movidas) {
        assert.ok(p.x >= -5 && p.x <= 105, `x=${p.x} fuera del rango de unidades del viewBox (0..100)`);
        assert.ok(p.y >= -5 && p.y <= 105, `y=${p.y} fuera del rango de unidades del viewBox (0..100)`);
      }
    });

    // ── arrastre con touch (CDP real) ───────────────────────────────────
    await prueba('kodu.arrastrar: touch real (CDP dispatchTouchEvent) — mismo camino de Pointer Events', async () => {
      const touchAction = await page.locator('#drag-touch').evaluate((el) => getComputedStyle(el).touchAction);
      assert.equal(touchAction, 'none', 'arrastrar() tiene que poner touch-action:none');
      const userSelect = await page.locator('#drag-touch').evaluate((el) => getComputedStyle(el).userSelect);
      assert.equal(userSelect, 'none', 'arrastrar() tiene que poner user-select:none (T4, no seleccionar texto al arrastrar)');

      await arrastrarConTouch(page, '#drag-touch', 35, 20);
      const estado = await page.evaluate(() => ({
        movidas: window.__test.moverTouch.length,
        soltadas: window.__test.soltarTouch.length,
      }));
      assert.ok(estado.movidas > 0, 'un touch real tiene que producir al menos un mover()');
      assert.equal(estado.soltadas, 1, 'soltar() tiene que dispararse exactamente una vez con touch también');
    });

    // ── arrastre con teclado ─────────────────────────────────────────────
    await prueba('kodu.arrastrar: teclado — ArrowRight/ArrowUp mueven, no hacen scroll de la página', async () => {
      await page.locator('#drag-teclado').focus();
      const scrollAntes = await page.evaluate(() => window.scrollY);

      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowUp');

      const estado = await page.evaluate(() => ({
        movidas: window.__test.moverTeclado as PuntoDrag[],
        soltadas: window.__test.soltarTeclado as PuntoDrag[],
        scrollDespues: window.scrollY,
      }));

      assert.equal(estado.movidas.length, 2, 'dos flechas, dos mover()');
      assert.equal(estado.soltadas.length, 2, 'y dos soltar() (una por acción de teclado)');
      assert.ok(estado.movidas.every((p) => p.teclado === true), 'teclado tiene que venir en true');
      assert.ok(estado.soltadas.every((p) => p.teclado === true));
      assert.equal(estado.movidas[0].dx, 10, 'ArrowRight: paso por defecto 10 en dx');
      assert.equal(estado.movidas[1].dy, -10, 'ArrowUp: paso por defecto 10 en dy, negativo');
      assert.equal(estado.scrollDespues, scrollAntes, 'las flechas no pueden scrollear la página (preventDefault)');
    });

    // ── T4: p.x/p.y del teclado en las mismas unidades que el puntero ──
    await prueba('kodu.arrastrar: teclado sobre SVG — p.x/p.y en unidades del viewBox, no un acumulador desde 0', async () => {
      await page.locator('#drag-svg-teclado').focus();
      await page.keyboard.press('ArrowRight'); // paso 5: cx 30 -> ~35
      await page.keyboard.press('ArrowRight'); // el mover() anterior ya aplicó cx=35: próximo debería ser ~40, no 10

      const movidas = await page.evaluate(() => window.__test.moverTecladoSvg as PuntoDrag[]);
      assert.equal(movidas.length, 2);
      assert.ok(Math.abs(movidas[0].x - 35) <= 0.5, `primera flecha: x=${movidas[0].x}, esperaba ≈35`);
      assert.ok(Math.abs(movidas[0].y - 50) <= 0.5, `primera flecha: y=${movidas[0].y}, esperaba ≈50 (ArrowRight no mueve y)`);
      assert.ok(
        Math.abs(movidas[1].x - 40) <= 0.5,
        `segunda flecha: x=${movidas[1].x}, esperaba ≈40 (si acumulara desde 0 dando ~10, el fix no está funcionando)`,
      );
    });

    await prueba('kodu.arrastrar: teclado sobre HTML — p.x/p.y relativos a la caja del padre, mismo criterio', async () => {
      await page.locator('#drag-teclado-html').focus();
      // caja inicial left:40,top:60,24x24 -> centro (52,72); paso 5.
      await page.keyboard.press('ArrowRight'); // centro -> ~(57,72)
      await page.keyboard.press('ArrowRight'); // desde la posición YA actualizada -> ~(62,72)

      const movidas = await page.evaluate(() => window.__test.moverTecladoHtml as PuntoDrag[]);
      assert.equal(movidas.length, 2);
      assert.ok(Math.abs(movidas[0].x - 57) <= 0.5, `primera flecha: x=${movidas[0].x}, esperaba ≈57`);
      assert.ok(Math.abs(movidas[0].y - 72) <= 0.5, `primera flecha: y=${movidas[0].y}, esperaba ≈72`);
      assert.ok(Math.abs(movidas[1].x - 62) <= 0.5, `segunda flecha: x=${movidas[1].x}, esperaba ≈62 (no un salto a ~10)`);
    });

    // ── overlay decorativo con pointer-events:none (defecto 5, documenta la regla) ──
    await prueba('capa encima con pointer-events:none no bloquea el arrastre de abajo', async () => {
      await arrastrarConMouse(page, '#drag-overlay', 15, 10);
      const estado = await page.evaluate(() => ({
        movidas: window.__test.moverOverlay.length,
        soltadas: window.__test.soltarOverlay.length,
      }));
      assert.ok(estado.movidas > 0, 'el arrastre tiene que llegar aunque haya una capa decorativa encima');
      assert.equal(estado.soltadas, 1);
    });

    // ── Round 2, T6: modo unidad — mouse ────────────────────────────────
    await prueba(
      'kodu.arrastrar (modo unidad): mouse — sin salto al agarrar, snap a paso, sin repetidos, alSoltar una vez',
      async () => {
        const caja = await cajaDe(page, '#perilla-unidad');
        // agarra unos px off-center dentro de la perilla, no en su centro exacto
        const gx = caja.x + 3;
        const gy = caja.y + caja.height / 2;
        await page.mouse.move(gx, gy);
        await page.mouse.down();
        const trasAgarrar = await page.evaluate(() => window.__test.unidadCambios.length);
        assert.equal(trasAgarrar, 0, 'agarrar no puede disparar alCambiar (sin salto al agarrar)');

        await page.mouse.move(gx + 100, gy, { steps: 10 }); // pista 500px, 0..10 -> 50px/unidad: +100px = +2
        await page.mouse.up();

        const estado = await page.evaluate(() => ({
          cambios: window.__test.unidadCambios.slice(),
          soltar: window.__test.unidadSoltar.slice(),
        }));
        assert.ok(estado.cambios.length > 0, 'tiene que haber al menos un alCambiar');
        assert.equal(estado.cambios[estado.cambios.length - 1], 5, 'valor inicial 3 + 2 = 5');
        assert.equal(estado.soltar.length, 1, 'alSoltar tiene que dispararse EXACTAMENTE una vez');
        assert.equal(estado.soltar[0], 5);
        for (let i = 1; i < estado.cambios.length; i++) {
          assert.notEqual(estado.cambios[i], estado.cambios[i - 1], 'alCambiar no puede repetir el mismo valor consecutivo');
        }
      },
    );

    // ── Round 2, T6: modo unidad — touch real (CDP) ─────────────────────
    await prueba('kodu.arrastrar (modo unidad): touch real (CDP dispatchTouchEvent)', async () => {
      await arrastrarConTouch(page, '#perilla-touch-unidad', 100, 0);
      const estado = await page.evaluate(() => ({
        cambios: window.__test.touchUnidadCambios.slice(),
        soltar: window.__test.touchUnidadSoltar.slice(),
      }));
      assert.ok(estado.cambios.length > 0, 'un touch real tiene que producir al menos un alCambiar');
      assert.equal(estado.cambios[estado.cambios.length - 1], 5, 'valor inicial 3 + 2 = 5, igual que con mouse');
      assert.equal(estado.soltar.length, 1);
    });

    // ── Round 2, T6: modo unidad — paso decimal, sin ruido de punto flotante ──
    await prueba('kodu.arrastrar (modo unidad): paso 0.1 — sin ruido de punto flotante', async () => {
      const caja = await cajaDe(page, '#perilla-decimal');
      const gy = caja.y + caja.height / 2;
      await page.mouse.move(caja.x + caja.width / 2, gy);
      await page.mouse.down();
      await page.mouse.move(caja.x + caja.width / 2 + 60, gy, { steps: 6 }); // 200px, 0..1 -> 0.3
      await page.mouse.up();
      const cambios = await page.evaluate(() => window.__test.decimalCambios.slice());
      assert.ok(cambios.length > 0, 'tiene que haber al menos un alCambiar');
      for (const v of cambios) {
        assert.equal(v, Math.round(v * 10) / 10, `valor con ruido de punto flotante: ${v}`);
        assert.ok(!String(v).includes('000'), `el string del valor no puede mostrar ruido de punto flotante: ${v}`);
      }
    });

    // ── Round 2, T6: modo unidad — eje y (arrastrar arriba aumenta) ─────
    await prueba('kodu.arrastrar (modo unidad): eje y — arrastrar hacia arriba aumenta el valor', async () => {
      const caja = await cajaDe(page, '#perilla-vertical');
      const cx = caja.x + caja.width / 2;
      const cy = caja.y + caja.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 90, { steps: 9 }); // pista 300px, 0..10 -> 90px = +3
      await page.mouse.up();
      const cambios = await page.evaluate(() => window.__test.verticalCambios.slice());
      assert.ok(cambios.length > 0);
      assert.equal(cambios[cambios.length - 1], 3, 'arrastrar 90px hacia ARRIBA en una pista de 300px (0..10) tiene que dar +3');
    });

    // ── Round 2, T6: modo unidad — teclado, ARIA, dueño de las flechas ──
    await prueba(
      'kodu.arrastrar (modo unidad): teclado — ArrowRight +1, Home/End clampeados, ARIA, dueño de las flechas',
      async () => {
        await page.evaluate(() => {
          document.addEventListener('keydown', (e) => {
            if (e.key.indexOf('Arrow') === 0) window.__test.contadorDocumentFlechas++;
          });
          document.getElementById('perilla-teclado-unidad')!.addEventListener('keydown', (e) => {
            if (e.key.indexOf('Arrow') === 0) window.__test.contadorMismoElementoExtra++;
          });
        });

        await page.locator('#perilla-teclado-unidad').focus();
        await page.keyboard.press('ArrowRight');
        const trasArrowRight = await page.evaluate(() => ({
          cambios: window.__test.tecladoUnidadCambios.slice(),
          ariaNow: document.getElementById('perilla-teclado-unidad')!.getAttribute('aria-valuenow'),
          role: document.getElementById('perilla-teclado-unidad')!.getAttribute('role'),
          ariaMin: document.getElementById('perilla-teclado-unidad')!.getAttribute('aria-valuemin'),
          ariaMax: document.getElementById('perilla-teclado-unidad')!.getAttribute('aria-valuemax'),
        }));
        assert.equal(trasArrowRight.cambios[trasArrowRight.cambios.length - 1], 1, 'ArrowRight desde 0 tiene que dar 1');
        assert.equal(trasArrowRight.ariaNow, '1', 'aria-valuenow tiene que quedar actualizado');
        assert.equal(trasArrowRight.role, 'slider');
        assert.equal(trasArrowRight.ariaMin, '0');
        assert.equal(trasArrowRight.ariaMax, '10');

        await page.keyboard.press('End');
        await page.keyboard.press('End'); // repetir no puede volver a emitir alCambiar
        const trasEnd = await page.evaluate(() => window.__test.tecladoUnidadCambios.slice());
        assert.equal(trasEnd[trasEnd.length - 1], 10, 'End tiene que clampear al máximo (10)');

        await page.keyboard.press('Home');
        const trasHome = await page.evaluate(() => window.__test.tecladoUnidadCambios.slice());
        assert.equal(trasHome[trasHome.length - 1], 0, 'Home tiene que ir al mínimo (0)');

        const estadoFinal = await page.evaluate(() => ({
          contadorDocumento: window.__test.contadorDocumentFlechas,
          contadorMismoElemento: window.__test.contadorMismoElementoExtra,
          soltadas: window.__test.tecladoUnidadSoltar.length,
        }));
        assert.equal(
          estadoFinal.contadorDocumento, 0,
          'un keydown en document (burbuja) no puede recibir las flechas que arrastrar() ya maneja',
        );
        assert.equal(
          estadoFinal.contadorMismoElemento, 0,
          'un keydown agregado DESPUÉS en el mismo elemento tampoco puede recibir las flechas',
        );
        assert.equal(estadoFinal.soltadas, 4, 'alSoltar tiene que dispararse una vez por cada tecla presionada (4)');
      },
    );

    // ── Round 2, T6: dos arrastrables superpuestos ──────────────────────
    await prueba(
      'kodu.arrastrar: dos arrastrables superpuestos — gana el de centro más cercano al puntero, no el pintado encima',
      async () => {
        const cajaChico = await cajaDe(page, '#circulo-chico');
        const cx = cajaChico.x + cajaChico.width / 2;
        const cy = cajaChico.y + cajaChico.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx + 5, cy + 5, { steps: 2 });
        await page.mouse.up();
        const estado = await page.evaluate(() => ({
          chico: window.__test.moverChico.length,
          grande: window.__test.moverGrande.length,
        }));
        assert.ok(estado.chico > 0, 'el círculo con el centro más cercano al puntero (chico) tiene que recibir el arrastre');
        assert.equal(estado.grande, 0, 'el círculo grande (pintado encima) no puede recibir el arrastre si su centro está más lejos');
      },
    );

    // ── Round 2, T6: sobrevive a un re-render a mitad de arrastre ───────
    await prueba(
      'kodu.arrastrar (modo unidad): sobrevive a un re-render — sigue emitiendo tras reemplazar el elemento',
      async () => {
        const caja = await cajaDe(page, '#perilla-rerender');
        const cy = caja.y + caja.height / 2;
        await page.mouse.move(caja.x + caja.width / 2, cy);
        await page.mouse.down();
        await page.mouse.move(caja.x + caja.width / 2 + 40, cy, { steps: 4 }); // primer cambio: dispara el reemplazo
        await page.mouse.move(caja.x + caja.width / 2 + 90, cy, { steps: 4 }); // sigue moviendo tras el reemplazo
        await page.mouse.up();
        const estado = await page.evaluate(() => ({
          cambios: window.__test.rerenderCambios.slice(),
          soltar: window.__test.rerenderSoltar.slice(),
        }));
        assert.ok(estado.cambios.length >= 2, 'el arrastre tiene que seguir emitiendo alCambiar después del reemplazo del elemento');
        assert.equal(estado.soltar.length, 1, 'alSoltar tiene que dispararse UNA sola vez pese al reemplazo a mitad de camino');
      },
    );

    // ── Round 2, T6: modo bajo nivel — red de seguridad de p.valueOf ────
    await prueba(
      'kodu.arrastrar (modo bajo nivel): mover(x) que trata el punto como número recibe p.x vía valueOf',
      async () => {
        await arrastrarConMouse(page, '#drag-safety', 30, 0);
        const valores = await page.evaluate(() => window.__test.safetyValores.slice());
        assert.ok(valores.length > 0, 'tiene que haber al menos un valor');
        for (const v of valores) assert.equal(typeof v, 'number', `x + 0 tiene que dar un número, dio ${typeof v}`);
      },
    );

    // ── temporizadores cancelables (defecto 4) ──────────────────────────
    await prueba('kodu.despues + kodu.cancelarTemporizadores: el callback cancelado nunca dispara', async () => {
      await page.waitForTimeout(250); // bien por encima de los 100ms del timer agendado al cargar
      const disparado = await page.evaluate(() => window.__test.timerDisparado);
      assert.equal(disparado, false, 'cancelarTemporizadores() tiene que haber barrido el timer agendado');
    });

    // ── Round 2, T7: kodu.festejar / kodu.cancelarTemporizadores ───────
    // ESTA prueba tiene que correr ANTES que cualquier otro festejar(): es
    // la única forma de probar el caso "cancelado antes de que la librería
    // terminara de cargar" (una vez que canvas-confetti carga, queda cacheada
    // para el resto de la página).
    await prueba('kodu.festejar + kodu.cancelarTemporizadores ANTES de que cargue la librería: nunca dibuja nada', async () => {
      const yaHabiaConfetti = await page.evaluate(() => !!window.confetti);
      assert.equal(yaHabiaConfetti, false, 'setup: esta prueba necesita correr antes de que canvas-confetti haya cargado');

      await page.evaluate(() => {
        window.kodu.festejar();
        window.kodu.cancelarTemporizadores();
      });
      await page.waitForFunction(() => !!window.confetti, undefined, { timeout: 15_000 });
      await page.waitForTimeout(500);
      const hayCanvas = await hayCanvasDeConfetti(page);
      assert.equal(hayCanvas, false, 'un festejo cancelado antes de que la librería cargara no puede dibujar nada después');
    });

    await prueba('kodu.festejar: dispara confetti real (agrega el <canvas> de la librería)', async () => {
      await page.evaluate(() => window.kodu.festejar());
      await page.waitForFunction(() => !!window.confetti, undefined, { timeout: 15_000 });
      await page.waitForTimeout(150); // bien antes de que la animación termine sola
      const hayCanvas = await hayCanvasDeConfetti(page);
      assert.equal(hayCanvas, true, 'festejar() tiene que agregar el <canvas> real de canvas-confetti');
    });

    await prueba('kodu.cancelarTemporizadores: corta un festejo ya animando', async () => {
      await page.evaluate(() => window.kodu.festejar());
      await page.waitForTimeout(100); // dejarlo animar un poco primero
      const hayCanvasAntes = await hayCanvasDeConfetti(page);
      assert.equal(hayCanvasAntes, true, 'setup: tiene que haber un festejo animando antes de cancelar');
      await page.evaluate(() => window.kodu.cancelarTemporizadores());
      await page.waitForTimeout(300);
      const hayCanvas = await hayCanvasDeConfetti(page);
      assert.equal(hayCanvas, false, 'después de cancelar, el <canvas> de confetti tiene que desaparecer (reset())');
    });

    // ── Round 2, T7: kodu.mezclar ────────────────────────────────────────
    await prueba(
      'kodu.mezclar: mismo multiset, no muta el original, nunca queda idéntico (200 corridas), toda posición aparece',
      async () => {
        const resultado = await page.evaluate(() => {
          var original = [1, 2, 3, 4];
          var copiaOriginal = original.slice();
          var vecesIdentico = 0;
          var posicionesDelPrimero: Record<number, boolean> = {};
          for (var i = 0; i < 200; i++) {
            var mezclado = window.kodu.mezclar(original);
            var ordenadoOriginal = original.slice().sort();
            var ordenadoMezclado = mezclado.slice().sort();
            if (JSON.stringify(ordenadoOriginal) !== JSON.stringify(ordenadoMezclado)) {
              throw new Error('multiset distinto en la corrida ' + i + ': ' + JSON.stringify(mezclado));
            }
            if (JSON.stringify(mezclado) === JSON.stringify(original)) vecesIdentico++;
            posicionesDelPrimero[mezclado.indexOf(original[0])] = true;
          }
          return {
            originalIntacto: JSON.stringify(original) === JSON.stringify(copiaOriginal),
            vecesIdentico: vecesIdentico,
            posiciones: Object.keys(posicionesDelPrimero).length,
          };
        });
        assert.equal(resultado.originalIntacto, true, 'mezclar() no puede mutar el array original');
        assert.equal(resultado.vecesIdentico, 0, 'en ninguna de las 200 corridas puede quedar en el mismo orden de entrada');
        assert.equal(resultado.posiciones, 4, 'en 200 corridas, el primer elemento original tiene que haber pasado por las 4 posiciones');
      },
    );

    await prueba('kodu.mezclar: entrada no-array devuelve una copia sin tirar', async () => {
      const resultado = await page.evaluate(() => ({
        // @ts-expect-error: a propósito, para probar la entrada no-array en runtime
        deNull: Array.isArray(window.kodu.mezclar(null)),
        // @ts-expect-error: ídem
        deNumero: Array.isArray(window.kodu.mezclar(42)),
      }));
      assert.equal(resultado.deNull, true);
      assert.equal(resultado.deNumero, true);
    });

    // ── sin errores de página ni de consola en todo el recorrido ───────
    await prueba('sin pageerror ni console.error en todo el recorrido de la prueba', () => {
      assert.deepEqual(erroresPagina, [], `se encontraron errores: ${erroresPagina.join(' | ')}`);
    });
  } finally {
    await browser.close();
  }
}

await main();

if (fallas > 0) {
  console.error(`\n✖ e2e/navegador-kit.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/navegador-kit.ts: todas las pruebas pasaron');
}
