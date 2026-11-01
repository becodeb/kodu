// Prueba automática de un juego de la colección.
//   node experimentos/juegos-3ro/probar.mjs <archivo.html> [carpetaCapturas]
// Necesita el servidor estático en http://127.0.0.1:8765 (python -m http.server 8765 en esta carpeta).
// Por cada nivel: lo carga, saca captura en modo aventura y en modo matemático, y si el nivel
// define `prueba: { mal(K), bien(K) }` verifica que la respuesta mala NO pase y la buena SÍ.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const archivo = process.argv[2];
if (!archivo) { console.error('Uso: node probar.mjs <archivo.html> [carpetaCapturas]'); process.exit(2); }
const nombre = basename(archivo, '.html');
const dirCapturas = process.argv[3] || join('experimentos', 'juegos-3ro', 'capturas', nombre);
mkdirSync(dirCapturas, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errores = [];
page.on('pageerror', e => errores.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text()); });

await page.goto(`http://127.0.0.1:8765/${nombre}.html#docente`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__motor, null, { timeout: 20000 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(dirCapturas, '0-portada.png') });
await page.evaluate(() => document.querySelector('#portada').classList.remove('ver'));

const n = await page.evaluate(() => window.__motor.J.niveles.length);
const fallas = [];
for (let i = 0; i < n; i++) {
  await page.evaluate(i => { window.__motor.setModo(false); window.__motor.cargarNivel(i); }, i);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: join(dirCapturas, `${i + 1}-aventura.png`) });
  await page.evaluate(() => window.__motor.setModo(true));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(dirCapturas, `${i + 1}-matematico.png`) });
  await page.evaluate(() => window.__motor.setModo(false));

  const r = await page.evaluate(async () => {
    const { J, K, nivel, comprobar } = window.__motor;
    const nv = J.niveles[nivel];
    if (!nv.prueba) return { sinPrueba: true };
    const out = { mal: [], bien: null };
    const malas = [].concat(nv.prueba.mal || []);
    for (const m of malas) { await m.call(nv, K); const r = comprobar(); out.mal.push(r ? { ok: !!r.ok, parcial: !!r.parcial, msg: r.msg } : null); }
    await nv.prueba.bien.call(nv, K);
    // Un nivel con fases puede necesitar varios "comprobar" seguidos: bien() puede devolver
    // cuántos; el último es el que cuenta.
    let r; for (let k = 0; k < (nv.prueba.pasos || 1); k++) { r = comprobar(); if (nv.prueba.entrePasos && k < (nv.prueba.pasos || 1) - 1) await nv.prueba.entrePasos.call(nv, K, k); }
    out.bien = r ? { ok: !!r.ok, msg: r.msg } : null;
    return out;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dirCapturas, `${i + 1}-resuelto.png`) });
  if (r.sinPrueba) fallas.push(`Nivel ${i + 1}: no define prueba`);
  else {
    r.mal.forEach((m, k) => { if (!m || (m.ok && !m.parcial)) fallas.push(`Nivel ${i + 1}: la respuesta mala #${k + 1} PASÓ (${m?.msg})`); });
    if (!r.bien?.ok) fallas.push(`Nivel ${i + 1}: la respuesta buena NO pasó (${r.bien?.msg})`);
  }
  console.log(`Nivel ${i + 1}:`, JSON.stringify(r));
}

// Bitácora: aparece, el botón arranca deshabilitado y se habilita al confirmar.
await page.evaluate(() => { window.__motor.cargarNivel(0); });
const bit = await page.evaluate(async () => {
  const { J, K } = window.__motor; const nv = J.niveles[0];
  await nv.prueba?.bien.call(nv, K);
  document.querySelector('#btnComprobar').click();
  await new Promise(r => setTimeout(r, (nv.alResolver ? 4000 : 1500)));
  const vis = document.querySelector('#bitacora').classList.contains('ver');
  const deshab = document.querySelector('#bitContinuar').disabled;
  return { vis, deshab, preguntas: document.querySelectorAll('#bitPreguntas li').length };
});
await page.screenshot({ path: join(dirCapturas, '9-bitacora.png') });
if (!bit.vis) fallas.push('La bitácora no apareció después de resolver el nivel 1');
if (!bit.deshab) fallas.push('El botón de la bitácora no arranca deshabilitado');

const tam = await page.evaluate(() => document.documentElement.outerHTML.length);
console.log('Tamaño aprox. del HTML:', tam, 'caracteres (límite de Kodu: 400000)');
console.log('Bitácora:', JSON.stringify(bit));
console.log('Errores de consola:', errores.length ? '\n  ' + errores.join('\n  ') : 'ninguno');
console.log(fallas.length ? 'FALLAS:\n  ' + fallas.join('\n  ') : 'TODO OK');
await browser.close();
process.exit(fallas.length || errores.length ? 1 : 0);
