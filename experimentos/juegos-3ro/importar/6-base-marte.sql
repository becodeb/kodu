\set ON_ERROR_STOP on
SET client_encoding = 'UTF8';
BEGIN;
-- No duplicar si ya existe un recurso con el mismo título en la cuenta.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Project" WHERE "userId" = 'a59ea305-7e4b-4374-8039-2236dd0f5a88' AND title = 'Base Marte: Operación supervivencia') THEN
    RAISE EXCEPTION 'Ya existe un recurso con ese título en la cuenta';
  END IF;
END $$;
INSERT INTO "Project" (id, title, description, slug, "currentHtml", "userId", "createdAt", "updatedAt")
VALUES ('44a76e68-6f6c-4cc5-9631-04aa889b217d', 'Base Marte: Operación supervivencia', 'Videojuego 3D · 3.er año. Sistemas de ecuaciones lineales, método gráfico, sumas y restas e interpretación de soluciones para mantener operativa una colonia en Marte.', 'base-marte-operacion-supervivencia-uv4cxnzm', $kodu$<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Base Marte: Operación supervivencia</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
} }
</script>
<style>
/* ════════════════════════════════════════════════════════════════════
   COLECCIÓN MISIONES 3D · base común
   Cada juego cambia sólo --acento / --acento-2 / --cielo-* en :root.
   ════════════════════════════════════════════════════════════════════ */
:root{
  --acento:#ff6b3d; --acento-2:#ffc477;
  --tinta:#0f1b2d; --tinta-2:#1c2b44; --tinta-3:#2a3c5c;
  --texto:#eef3fb; --texto-2:#b6c3d9; --texto-3:#7d8ca6;
  --ok:#3ddc97; --error:#ff5d6c; --aviso:#ffc43d;
  --papel:#fbf6ea; --papel-tinta:#2b2418; --papel-linea:#d9cfb8;
  --radio:14px;
  --f-titulo:'Bricolage Grotesque',system-ui,sans-serif;
  --f-texto:'Atkinson Hyperlegible',system-ui,sans-serif;
  --f-num:'JetBrains Mono',ui-monospace,monospace;
  --panel-w:380px; --barra-h:58px;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;background:var(--tinta);color:var(--texto);font-family:var(--f-texto);font-size:15px;line-height:1.45}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}
input,select{font:inherit}
.num{font-family:var(--f-num);font-weight:700}

/* ── Barra superior ─────────────────────────────────────────── */
#barra{position:fixed;inset:0 0 auto 0;height:var(--barra-h);display:flex;align-items:center;gap:14px;padding:0 16px;
  background:linear-gradient(180deg,rgba(15,27,45,.96),rgba(15,27,45,.86));border-bottom:1px solid rgba(255,255,255,.07);z-index:30;backdrop-filter:blur(8px)}
#barra .marca{display:flex;align-items:center;gap:10px;min-width:0}
#barra .marca .ico{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--acento);color:var(--tinta);font-family:var(--f-titulo);font-weight:800;font-size:18px;flex:none}
#barra h1{font-family:var(--f-titulo);font-weight:800;font-size:18px;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#barra .sub{font-size:12px;color:var(--texto-3)}
#niveles{display:flex;gap:6px;margin-left:auto}
.chip-nivel{height:34px;min-width:34px;padding:0 10px;border-radius:10px;background:var(--tinta-2);border:1px solid var(--tinta-3);font-family:var(--f-num);font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px;color:var(--texto-2)}
.chip-nivel[aria-current="true"]{background:var(--acento);border-color:var(--acento);color:var(--tinta)}
.chip-nivel.hecho:not([aria-current="true"]){border-color:var(--ok);color:var(--ok)}
.chip-nivel:disabled{opacity:.45;cursor:not-allowed}
.chip-nivel svg{width:13px;height:13px}
#modos{display:flex;background:var(--tinta-2);border:1px solid var(--tinta-3);border-radius:12px;padding:3px}
#modos button{padding:6px 12px;border-radius:9px;font-size:13px;font-weight:700;color:var(--texto-2);display:flex;gap:6px;align-items:center}
#modos button[aria-pressed="true"]{background:var(--texto);color:var(--tinta)}

/* ── Panel de misión ────────────────────────────────────────── */
#panel{position:fixed;top:calc(var(--barra-h) + 12px);left:12px;bottom:12px;width:var(--panel-w);z-index:20;display:flex;flex-direction:column;
  background:rgba(15,27,45,.92);border:1px solid rgba(255,255,255,.08);border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.35);backdrop-filter:blur(10px);overflow:hidden}
#panel .cab{padding:16px 18px 12px;border-bottom:1px solid rgba(255,255,255,.06)}
#panel .etiqueta{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--acento);font-weight:700}
#panel h2{font-family:var(--f-titulo);font-weight:800;font-size:22px;line-height:1.15;margin-top:4px}
#panel .cuerpo{flex:1;overflow:auto;padding:14px 18px;display:flex;flex-direction:column;gap:14px}
#panel .cuerpo::-webkit-scrollbar{width:8px}#panel .cuerpo::-webkit-scrollbar-thumb{background:var(--tinta-3);border-radius:8px}
.relato{color:var(--texto-2);font-size:14.5px}
.relato b,.relato strong{color:var(--texto)}
.objetivo{background:rgba(255,255,255,.04);border-left:3px solid var(--acento);border-radius:0 10px 10px 0;padding:10px 12px;font-size:14px}
.objetivo .t{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--texto-3);font-weight:700;margin-bottom:3px}
.datos{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:14px;background:var(--tinta-2);border-radius:12px;padding:10px 12px}
.datos dt{color:var(--texto-3)} .datos dd{font-family:var(--f-num);font-weight:700}
.controles{display:flex;flex-direction:column;gap:10px}
.campo{display:flex;flex-direction:column;gap:5px}
.campo label{font-size:13px;color:var(--texto-2);font-weight:700}
.campo .fila{display:flex;gap:8px;align-items:center}
.entrada{width:100%;height:40px;border-radius:10px;border:1px solid var(--tinta-3);background:var(--tinta);color:var(--texto);padding:0 12px;font-family:var(--f-num);font-weight:700;font-size:15px}
.entrada:focus{outline:2px solid var(--acento);outline-offset:1px}
.entrada.mal{border-color:var(--error)} .entrada.bien{border-color:var(--ok)}
input[type=range]{width:100%;accent-color:var(--acento)}
.btn{height:42px;padding:0 16px;border-radius:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:transform .08s,filter .15s}
.btn:active{transform:translateY(1px)}
.btn-pri{background:var(--acento);color:var(--tinta)} .btn-pri:hover{filter:brightness(1.08)}
.btn-sec{background:var(--tinta-2);border:1px solid var(--tinta-3);color:var(--texto)} .btn-sec:hover{background:var(--tinta-3)}
.btn:disabled{opacity:.45;cursor:not-allowed;filter:none}
.btn svg{width:17px;height:17px}
.btn-chico{height:32px;padding:0 10px;font-size:13px;border-radius:9px}
.grupo-btn{display:flex;flex-wrap:wrap;gap:6px}
.grupo-btn .btn[aria-pressed="true"]{background:var(--acento);color:var(--tinta);border-color:var(--acento)}
#panel .pie{padding:12px 18px 16px;border-top:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;gap:10px}
#panel .pie .acciones{display:flex;gap:8px}
#panel .pie .acciones .btn-pri{flex:1}
#mensaje{font-size:14px;border-radius:12px;padding:10px 12px;display:none}
#mensaje.ver{display:block}
#mensaje.ok{background:rgba(61,220,151,.12);border:1px solid rgba(61,220,151,.4);color:#c9f7e2}
#mensaje.error{background:rgba(255,93,108,.12);border:1px solid rgba(255,93,108,.4);color:#ffd5da}
#mensaje.info{background:rgba(255,196,61,.1);border:1px solid rgba(255,196,61,.35);color:#ffeec4}
#pistas{display:flex;flex-direction:column;gap:8px}
.pista{background:rgba(255,209,102,.08);border:1px dashed rgba(255,209,102,.45);border-radius:12px;padding:9px 12px;font-size:14px;color:#ffeec4}
.pista .n{font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-weight:700;color:var(--acento-2);display:block;margin-bottom:2px}
.intentos{font-size:12px;color:var(--texto-3)}

/* ── Escena ─────────────────────────────────────────────────── */
#escena{position:fixed;inset:0;z-index:1}
#escena canvas{display:block}
#etiquetas{position:fixed;inset:0;pointer-events:none;z-index:2}
.lbl{font-family:var(--f-num);font-weight:700;font-size:13px;background:rgba(15,27,45,.85);color:#fff;padding:3px 7px;border-radius:7px;white-space:nowrap;border:1px solid rgba(255,255,255,.15)}
.lbl.acento{background:var(--acento);color:var(--tinta);border-color:transparent}
.lbl.claro{background:rgba(255,255,255,.92);color:var(--tinta)}
.lbl.grande{font-size:15px;padding:5px 9px}
.ayuda-camara{position:fixed;right:16px;bottom:14px;z-index:15;font-size:12px;color:var(--texto-2);background:rgba(15,27,45,.75);padding:6px 10px;border-radius:9px;pointer-events:none}

/* ── Vista matemática ───────────────────────────────────────── */
#vistaMat{position:fixed;top:calc(var(--barra-h) + 12px);right:12px;bottom:12px;width:min(46vw,620px);z-index:18;display:none;flex-direction:column;
  background:#fdfcf8;color:#1b2333;border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.35);overflow:hidden}
body.modo-mat #vistaMat{display:flex}
body.modo-mat .ayuda-camara{display:none}
#vistaMat .cab{padding:12px 16px;border-bottom:1px solid #e6e1d4;display:flex;align-items:center;gap:10px}
#vistaMat .cab b{font-family:var(--f-titulo);font-size:16px}
#vistaMat .cab span{font-size:12px;color:#6b7280}
#vistaMat .lienzo{flex:1;min-height:0;padding:10px;display:flex;flex-direction:column;gap:8px;overflow:auto}
#vistaMat svg{width:100%;height:100%;min-height:260px;display:block}
#vistaMat .nota{font-size:13px;color:#4b5563;padding:0 4px}
#vistaMat .formula{font-family:var(--f-num);font-weight:700;font-size:15px;background:#f2efe6;border-radius:10px;padding:8px 12px;color:#1b2333}

/* ── Pantallas (portada, bitácora, final) ───────────────────── */
.capa{position:fixed;inset:0;z-index:50;display:none;place-items:center;padding:20px;background:rgba(8,14,26,.72);backdrop-filter:blur(6px)}
.capa.ver{display:grid}
.tarjeta{width:min(640px,100%);max-height:calc(100vh - 40px);overflow:auto;background:var(--tinta);border:1px solid rgba(255,255,255,.1);border-radius:22px;padding:28px;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.tarjeta h2{font-family:var(--f-titulo);font-weight:800;font-size:34px;line-height:1.05;letter-spacing:-.02em}
.tarjeta .kicker{font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:var(--acento);font-weight:700;margin-bottom:8px}
.tarjeta p{color:var(--texto-2);margin-top:12px}
.tarjeta .misiones{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:18px}
.tarjeta .misiones div{background:var(--tinta-2);border-radius:12px;padding:10px 12px;font-size:13.5px}
.tarjeta .misiones b{display:block;font-family:var(--f-num);color:var(--acento);font-size:12px}
.tarjeta .acciones{display:flex;gap:10px;margin-top:22px;flex-wrap:wrap}
.contenidos{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
.contenidos span{font-size:12px;border:1px solid var(--tinta-3);border-radius:99px;padding:3px 10px;color:var(--texto-2)}

/* Bitácora: hoja de papel */
#bitacora .tarjeta{background:var(--papel);color:var(--papel-tinta);border:0;position:relative;
  background-image:repeating-linear-gradient(180deg,transparent 0 31px,rgba(217,207,184,.55) 31px 32px);background-position:0 112px}
#bitacora .tarjeta::before{content:"";position:absolute;left:52px;top:0;bottom:0;width:2px;background:rgba(220,90,90,.35)}
#bitacora .contenido{padding-left:44px}
#bitacora .kicker{color:#b4541a}
#bitacora h2{font-size:30px;color:var(--papel-tinta)}
#bitacora h3{font-family:var(--f-titulo);font-size:18px;margin-top:18px}
#bitacora ol{margin:10px 0 0 20px;display:flex;flex-direction:column;gap:9px;font-size:16px;line-height:1.4}
#bitacora .aclaracion{font-size:14px;color:#6b5b3e;margin-top:14px;font-style:italic}
#bitacora .confirmar{display:flex;gap:10px;align-items:flex-start;margin-top:18px;padding:12px 14px;background:#fff;border:2px solid #e3d8bf;border-radius:12px;cursor:pointer;font-weight:700}
#bitacora .confirmar input{width:22px;height:22px;accent-color:#b4541a;flex:none;margin-top:1px}
#bitacora .btn-pri{background:#b4541a;color:#fff}
#bitacora .resumen{font-size:13.5px;background:rgba(255,255,255,.7);border:1px solid #e3d8bf;border-radius:10px;padding:8px 12px;margin-top:12px;color:#4d4230}

/* Toast */
#toast{position:fixed;left:50%;top:calc(var(--barra-h) + 18px);transform:translateX(-50%) translateY(-20px);opacity:0;z-index:60;background:var(--ok);color:var(--tinta);font-weight:700;padding:10px 18px;border-radius:12px;transition:.3s;pointer-events:none}
#toast.ver{opacity:1;transform:translateX(-50%) translateY(0)}

/* ── Responsive: panel abajo en pantallas chicas ─────────────── */
@media (max-width:860px){
  :root{--barra-h:96px}
  #barra{flex-wrap:wrap;height:auto;min-height:var(--barra-h);padding:8px 12px;row-gap:6px}
  #niveles{margin-left:0}
  #panel{top:auto;left:8px;right:8px;width:auto;height:46vh;bottom:8px}
  #vistaMat{left:8px;right:8px;width:auto;bottom:calc(46vh + 16px)}
  .ayuda-camara{display:none}
  .tarjeta{padding:20px}.tarjeta h2{font-size:26px}
  .tarjeta .misiones{grid-template-columns:1fr}
  #bitacora .contenido{padding-left:30px}#bitacora .tarjeta::before{left:34px}
}
</style>
</head>
<body>
<div id="escena"></div>
<div id="etiquetas"></div>

<header id="barra">
  <div class="marca"><div class="ico" id="marcaIco">?</div><div style="min-width:0"><h1 id="tituloJuego"></h1><div class="sub" id="subJuego"></div></div></div>
  <nav id="niveles" aria-label="Niveles"></nav>
  <div id="modos" role="group" aria-label="Modo de visualización">
    <button id="modoAventura" aria-pressed="true" title="Ver el escenario">Aventura</button>
    <button id="modoMat" aria-pressed="false" title="Ver la representación matemática">Matemático</button>
  </div>
</header>

<aside id="panel" aria-live="polite">
  <div class="cab"><div class="etiqueta" id="pnEtiqueta"></div><h2 id="pnTitulo"></h2></div>
  <div class="cuerpo">
    <div class="relato" id="pnRelato"></div>
    <div class="objetivo" id="pnObjetivo"><div class="t">Objetivo</div><div id="pnObjetivoTxt"></div></div>
    <div class="controles" id="pnControles"></div>
    <div id="pistas"></div>
  </div>
  <div class="pie">
    <div id="mensaje" role="status"></div>
    <div class="acciones">
      <button class="btn btn-sec" id="btnPista" title="Pedir una pista">Pista</button>
      <button class="btn btn-pri" id="btnComprobar">Comprobar</button>
    </div>
    <div class="intentos" id="intentos"></div>
  </div>
</aside>

<section id="vistaMat" aria-label="Representación matemática">
  <div class="cab"><b id="vmTitulo">Modo matemático</b><span id="vmSub"></span></div>
  <div class="lienzo" id="vmLienzo"></div>
</section>

<div class="ayuda-camara" id="ayudaCamara">Arrastrá el fondo para girar · rueda para acercar</div>
<div id="toast"></div>

<div class="capa" id="portada"><div class="tarjeta" id="portadaTarjeta"></div></div>

<div class="capa" id="bitacora" role="dialog" aria-modal="true" aria-labelledby="bitTitulo">
  <div class="tarjeta"><div class="contenido">
    <div class="kicker" id="bitKicker"></div>
    <h2 id="bitTitulo">Bitácora de misión</h2>
    <div class="resumen" id="bitResumen"></div>
    <h3>Antes de continuar, registrá en tu hoja:</h3>
    <ol id="bitPreguntas"></ol>
    <p class="aclaracion">Incluí tus cálculos, representaciones gráficas o esquemas cuando corresponda. Explicá con tus propias palabras.</p>
    <label class="confirmar"><input type="checkbox" id="bitCheck"> <span>Confirmo que registré mis respuestas en papel.</span></label>
    <div class="acciones" style="margin-top:16px;display:flex;gap:10px">
      <button class="btn btn-pri" id="bitContinuar" disabled>Continuar la misión</button>
    </div>
  </div></div>
</div>

<div class="capa" id="final"><div class="tarjeta" id="finalTarjeta"></div></div>

<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/* ════════════════════════════════════════════════════════════════════
   MOTOR COMÚN — no depende del juego. Cada juego define JUEGO más abajo.
   ════════════════════════════════════════════════════════════════════ */
const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...hijos) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of hijos.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
};
const SVGNS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...hijos) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of hijos.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
};

// Almacenamiento: el iframe de Kodu no tiene allow-same-origin, así que
// localStorage tira. Siempre detrás de try/catch, con memoria de respaldo.
const memoria = {};
const guardar = (k, v) => { memoria[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const leer = (k, def) => { try { const v = localStorage.getItem(k); if (v != null) return JSON.parse(v); } catch {} return k in memoria ? memoria[k] : def; };

// ── Three.js: renderer, cámara, luces ──
const contenedor = $('#escena');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
contenedor.append(renderer.domElement);
const etiquetas = new CSS2DRenderer({ element: $('#etiquetas') });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.48;

const hemi = new THREE.HemisphereLight(0xdfefff, 0x6b5a45, 1.1);
scene.add(hemi);
const sol = new THREE.DirectionalLight(0xfff1dc, 2.2);
sol.position.set(30, 50, 20);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
Object.assign(sol.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 200 });
scene.add(sol);

// El panel izquierdo (y la vista matemática) tapan parte del canvas: corremos
// el centro óptico para que lo importante quede en la zona visible.
function ajustarTamano() {
  const w = innerWidth, hgt = innerHeight;
  renderer.setSize(w, hgt);
  etiquetas.setSize(w, hgt);
  camera.aspect = w / hgt;
  const angosto = w <= 860;
  const izq = angosto ? 0 : 392;
  const der = angosto ? 0 : (document.body.classList.contains('modo-mat') ? Math.min(w * 0.46, 620) + 12 : 0);
  const abajo = angosto ? hgt * 0.46 + 8 : 0;
  const libreW = w - izq - der, libreH = hgt - abajo;
  camera.clearViewOffset();
  if (izq || der || abajo) camera.setViewOffset(w, hgt, (der - izq) / 2, abajo / 2, w, hgt);
  camera.updateProjectionMatrix();
  return { libreW, libreH };
}
addEventListener('resize', ajustarTamano);

// ── Bucle ──
const tics = new Set();
const reloj = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(reloj.getDelta(), 0.05), t = reloj.elapsedTime;
  for (const f of tics) f(dt, t);
  controls.update();
  renderer.render(scene, camera);
  etiquetas.render(scene, camera);
});

// ── Grupo del nivel: todo lo que crea un nivel cuelga de acá y se limpia solo ──
let grupoNivel = new THREE.Group();
scene.add(grupoNivel);
let ticsNivel = [];
let limpiezasNivel = [];
function limpiarNivel() {
  for (const f of ticsNivel) tics.delete(f);
  ticsNivel = [];
  for (const f of limpiezasNivel) try { f(); } catch {}
  limpiezasNivel = [];
  grupoNivel.traverse(o => {
    if (o.isCSS2DObject) o.element.remove();
    if (o.geometry) o.geometry.dispose();
    if (o.material) [].concat(o.material).forEach(m => m.dispose());
  });
  scene.remove(grupoNivel);
  grupoNivel = new THREE.Group();
  scene.add(grupoNivel);
  arrastrables.length = 0;
  clicables.length = 0;
}

// ── Interacción: arrastrar sobre un plano, con imán a grilla ──
const raycaster = new THREE.Raycaster();
const puntero = new THREE.Vector2();
const arrastrables = []; // {obj, plano:THREE.Plane, snap, limites, alMover, alSoltar, filtro}
const clicables = [];    // {obj, alClic}
let arrastre = null;
function rayoDesde(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  puntero.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  puntero.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(puntero, camera);
}
function buscarRaiz(obj, lista) {
  for (let o = obj; o; o = o.parent) { const e = lista.find(a => a.obj === o); if (e) return e; }
  return null;
}
renderer.domElement.addEventListener('pointerdown', ev => {
  rayoDesde(ev);
  const objs = [...arrastrables.map(a => a.obj), ...clicables.map(c => c.obj)];
  const hit = raycaster.intersectObjects(objs, true)[0];
  if (!hit) return;
  const a = buscarRaiz(hit.object, arrastrables);
  if (a && (!a.activo || a.activo())) {
    const p = new THREE.Vector3();
    raycaster.ray.intersectPlane(a.plano, p);
    arrastre = { a, desfase: a.obj.position.clone().sub(p) };
    controls.enabled = false;
    renderer.domElement.setPointerCapture(ev.pointerId);
    a.alTomar?.();
    return;
  }
  const c = buscarRaiz(hit.object, clicables);
  if (c) c.alClic(hit);
});
renderer.domElement.addEventListener('pointermove', ev => {
  rayoDesde(ev);
  if (!arrastre) {
    const objs = [...arrastrables.map(a => a.obj), ...clicables.map(c => c.obj)];
    renderer.domElement.style.cursor = raycaster.intersectObjects(objs, true).length ? 'grab' : '';
    return;
  }
  const { a, desfase } = arrastre;
  const p = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(a.plano, p)) return;
  p.add(desfase);
  if (a.snap) for (const eje of a.ejes) p[eje] = Math.round(p[eje] / a.snap) * a.snap;
  if (a.limites) for (const [eje, [min, max]] of Object.entries(a.limites)) p[eje] = Math.max(min, Math.min(max, p[eje]));
  for (const eje of ['x', 'y', 'z']) if (!a.ejes.includes(eje)) p[eje] = a.obj.position[eje];
  if (!p.equals(a.obj.position)) { a.obj.position.copy(p); a.alMover?.(p); }
});
const soltar = () => { if (arrastre) { arrastre.a.alSoltar?.(arrastre.a.obj.position); arrastre = null; controls.enabled = true; } };
renderer.domElement.addEventListener('pointerup', soltar);
renderer.domElement.addEventListener('pointercancel', soltar);

/* ════════════════════════════════════════════════════════════════════
   K — la API que usan los juegos
   ════════════════════════════════════════════════════════════════════ */
const K = {
  THREE, scene, camera, controls, renderer, sol, hemi, h, s, $,
  get grupo() { return grupoNivel; },
  agregar(...objs) { grupoNivel.add(...objs); return objs[0]; },
  tic(f) { tics.add(f); ticsNivel.push(f); return f; },
  alLimpiar(f) { limpiezasNivel.push(f); },

  /** Mueve la cámara (suave) a una posición mirando a un punto. */
  camara(pos, mira, { suave = true, min = 5, max = 200 } = {}) {
    controls.minDistance = min; controls.maxDistance = max;
    const p0 = camera.position.clone(), m0 = controls.target.clone();
    const p1 = new THREE.Vector3(...pos), m1 = new THREE.Vector3(...mira);
    if (!suave) { camera.position.copy(p1); controls.target.copy(m1); return; }
    let u = 0;
    const f = dt => {
      u = Math.min(1, u + dt * 1.4); const e = 1 - Math.pow(1 - u, 3);
      camera.position.lerpVectors(p0, p1, e); controls.target.lerpVectors(m0, m1, e);
      if (u >= 1) tics.delete(f);
    };
    tics.add(f);
  },

  /** Etiqueta HTML pegada a un punto 3D. clase: '', 'acento', 'claro', 'grande'. */
  etiqueta(texto, pos, clase = '', padre = grupoNivel) {
    const el = h('div', { class: 'lbl ' + clase, html: texto });
    const o = new CSS2DObject(el);
    o.position.set(...pos);
    padre.add(o);
    o.texto = t => { el.innerHTML = t; };
    return o;
  },

  /** Material plano estilo low-poly. */
  mat(color, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, flatShading: true, ...extra }); },
  caja(w, hgt, d, color, pos = [0, 0, 0], extra) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), K.mat(color, extra));
    m.position.set(...pos); m.castShadow = m.receiveShadow = true; return m;
  },
  cilindro(rt, rb, hgt, color, pos = [0, 0, 0], seg = 12, extra) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, hgt, seg), K.mat(color, extra));
    m.position.set(...pos); m.castShadow = m.receiveShadow = true; return m;
  },
  esfera(r, color, pos = [0, 0, 0], extra) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), K.mat(color, extra));
    m.position.set(...pos); m.castShadow = true; return m;
  },
  /** Línea entre puntos (en el espacio). */
  linea(puntos, color = 0xffffff, { discontinua = false, ancho = 1 } = {}) {
    const g = new THREE.BufferGeometry().setFromPoints(puntos.map(p => new THREE.Vector3(...p)));
    const m = discontinua ? new THREE.LineDashedMaterial({ color, dashSize: 0.6, gapSize: 0.35, linewidth: ancho }) : new THREE.LineBasicMaterial({ color, linewidth: ancho });
    const l = new THREE.Line(g, m); if (discontinua) l.computeLineDistances(); return l;
  },
  /** Tubo grueso entre dos puntos (las líneas de WebGL miden 1px). */
  barra(a, b, radio, color, extra) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const largo = va.distanceTo(vb);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radio, radio, largo, 10), K.mat(color, extra));
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    m.castShadow = true; return m;
  },
  /** Árbol low-poly. */
  arbol(pos, escala = 1, color = 0x3f8f5a) {
    const g = new THREE.Group();
    g.add(K.cilindro(0.18, 0.25, 1.2, 0x7a5235, [0, 0.6, 0], 6));
    const copa = new THREE.Mesh(new THREE.ConeGeometry(0.95, 2.2, 7), K.mat(color)); copa.position.y = 2.1; copa.castShadow = true; g.add(copa);
    g.position.set(...pos); g.scale.setScalar(escala); return g;
  },
  roca(pos, escala = 1, color = 0x8a8f99) {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 0), K.mat(color));
    m.position.set(...pos); m.scale.set(escala, escala * 0.7, escala); m.rotation.set(Math.random(), Math.random(), 0);
    m.castShadow = m.receiveShadow = true; return m;
  },
  /** Personita low-poly (para escala y narrativa). */
  persona(pos, color = 0xff8a3d) {
    const g = new THREE.Group();
    g.add(K.cilindro(0.22, 0.28, 0.9, color, [0, 0.45, 0], 8));
    g.add(K.esfera(0.22, 0xf2c9a0, [0, 1.12, 0]));
    g.position.set(...pos); return g;
  },
  /** Suelo amplio. */
  suelo(color = 0x7fb069, tam = 400) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(tam, tam), K.mat(color));
    m.rotation.x = -Math.PI / 2; m.receiveShadow = true; return m;
  },
  /** Cielo con degradé + niebla. */
  cielo(arriba = 0x7ec8ff, abajo = 0xdff3ff, niebla = [80, 260]) {
    const c = document.createElement('canvas'); c.width = 2; c.height = 256;
    const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#' + new THREE.Color(arriba).getHexString()); g.addColorStop(1, '#' + new THREE.Color(abajo).getHexString());
    x.fillStyle = g; x.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
    scene.fog = niebla ? new THREE.Fog(abajo, niebla[0], niebla[1]) : null;
  },

  /** Hace arrastrable un objeto sobre un plano. ejes: los que se mueven ('xz' por defecto).
   *  snap: paso de la grilla. limites: {x:[min,max], z:[...]}. activo(): si se puede tomar ahora. */
  arrastrable(obj, { ejes = 'xz', snap = 1, limites, alMover, alSoltar, alTomar, activo, plano } = {}) {
    const ej = ejes.split('');
    const normal = plano || (ej.includes('y') ? (ej.includes('x') ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)) : new THREE.Vector3(0, 1, 0));
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, obj.getWorldPosition(new THREE.Vector3()));
    const a = { obj, plano: pl, ejes: ej, snap, limites, alMover, alSoltar, alTomar, activo };
    arrastrables.push(a); return a;
  },
  clicable(obj, alClic) { clicables.push({ obj, alClic }); },

  // ── Panel ──
  controles() { return $('#pnControles'); },
  /** Campo numérico. Devuelve el <input>. */
  campoNumero(etiqueta, { id, valor = '', paso = 'any', min, max, sufijo, ancho } = {}) {
    const inp = h('input', { class: 'entrada', type: 'number', inputmode: 'decimal', step: paso, id, value: valor, min, max, style: ancho ? `width:${ancho}` : null });
    const fila = h('div', { class: 'fila' }, inp, sufijo ? h('span', { class: 'num', style: 'color:var(--texto-2)' }, sufijo) : null);
    $('#pnControles').append(h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), fila));
    return inp;
  },
  /** Deslizador con lectura del valor. */
  deslizador(etiqueta, { id, min, max, paso = 1, valor, formato = v => v, alCambiar } = {}) {
    const lec = h('span', { class: 'num', style: 'min-width:64px;text-align:right' }, formato(valor));
    const inp = h('input', { type: 'range', id, min, max, step: paso, value: valor });
    inp.addEventListener('input', () => { lec.textContent = formato(+inp.value); alCambiar?.(+inp.value); });
    $('#pnControles').append(h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), h('div', { class: 'fila' }, inp, lec)));
    inp.leer = () => +inp.value;
    inp.poner = v => { inp.value = v; lec.textContent = formato(+v); };
    return inp;
  },
  /** Grupo de botones de opción (uno elegido). */
  opciones(etiqueta, opciones, { alElegir, elegida } = {}) {
    const grupo = h('div', { class: 'grupo-btn', role: 'group' });
    const btns = opciones.map(([valor, texto]) => {
      const b = h('button', { class: 'btn btn-sec btn-chico', 'aria-pressed': valor === elegida ? 'true' : 'false' }, texto);
      b.addEventListener('click', () => { btns.forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); grupo.valor = valor; alElegir?.(valor); });
      grupo.append(b); return b;
    });
    grupo.valor = elegida;
    $('#pnControles').append(h('div', { class: 'campo' }, etiqueta ? h('label', {}, etiqueta) : null, grupo));
    return grupo;
  },
  /** Bloque de datos (dt/dd). pares: [[clave, valor], ...] */
  datos(pares) {
    const dl = h('dl', { class: 'datos' }, pares.flatMap(([k, v]) => [h('dt', {}, k), h('dd', { html: String(v) })]));
    $('#pnControles').append(dl); return dl;
  },
  html(contenido) { const d = h('div', { html: contenido }); $('#pnControles').append(d); return d; },

  /** Mensaje bajo los botones. tipo: 'ok' | 'error' | 'info'. */
  mensaje(texto, tipo = 'info') { const m = $('#mensaje'); m.className = 'ver ' + tipo; m.innerHTML = texto; },
  limpiarMensaje() { $('#mensaje').className = ''; },
  toast(texto) { const t = $('#toast'); t.textContent = texto; t.classList.add('ver'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('ver'), 2200); },

  // ── Vista matemática ──
  /** El juego llama a esto cada vez que cambia el estado: si la vista está abierta se redibuja. */
  refrescarMat() { if (document.body.classList.contains('modo-mat')) dibujarMat(); },
  get modoMat() { return document.body.classList.contains('modo-mat'); },

  /** SVG de un plano cartesiano listo para dibujar. Devuelve {svg, X(x), Y(y), g} con
   *  X/Y que pasan de coordenadas matemáticas a píxeles. */
  planoCartesiano({ xMin = -10, xMax = 10, yMin = -10, yMax = 10, paso = 1, pasoEtiqueta = 1, ejeX = 'x', ejeY = 'y', ancho = 560, alto = 420, margen = 34 } = {}) {
    const W = ancho, H = alto;
    const X = x => margen + (x - xMin) / (xMax - xMin) * (W - 2 * margen);
    const Y = y => H - margen - (y - yMin) / (yMax - yMin) * (H - 2 * margen);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', 'font-family': 'JetBrains Mono, monospace', 'font-size': 11 });
    const grilla = s('g', { stroke: '#e7e2d6', 'stroke-width': 1 });
    for (let x = Math.ceil(xMin / paso) * paso; x <= xMax + 1e-9; x += paso) grilla.append(s('line', { x1: X(x), x2: X(x), y1: Y(yMin), y2: Y(yMax) }));
    for (let y = Math.ceil(yMin / paso) * paso; y <= yMax + 1e-9; y += paso) grilla.append(s('line', { y1: Y(y), y2: Y(y), x1: X(xMin), x2: X(xMax) }));
    svg.append(grilla);
    const ejes = s('g', { stroke: '#1b2333', 'stroke-width': 1.6 });
    const y0 = Math.max(yMin, Math.min(yMax, 0)), x0 = Math.max(xMin, Math.min(xMax, 0));
    ejes.append(s('line', { x1: X(xMin), x2: X(xMax) + 8, y1: Y(y0), y2: Y(y0), 'marker-end': 'url(#flecha)' }));
    ejes.append(s('line', { x1: X(x0), x2: X(x0), y1: Y(yMin), y2: Y(yMax) - 8, 'marker-end': 'url(#flecha)' }));
    svg.append(s('defs', {}, s('marker', { id: 'flecha', viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#1b2333' }))));
    svg.append(ejes);
    const et = s('g', { fill: '#6b7280' });
    for (let x = Math.ceil(xMin / pasoEtiqueta) * pasoEtiqueta; x <= xMax + 1e-9; x += pasoEtiqueta) if (Math.abs(x) > 1e-9) et.append(s('text', { x: X(x), y: Y(y0) + 15, 'text-anchor': 'middle' }, +x.toFixed(4)));
    for (let y = Math.ceil(yMin / pasoEtiqueta) * pasoEtiqueta; y <= yMax + 1e-9; y += pasoEtiqueta) if (Math.abs(y) > 1e-9) et.append(s('text', { x: X(x0) - 6, y: Y(y) + 4, 'text-anchor': 'end' }, +y.toFixed(4)));
    et.append(s('text', { x: X(xMax) + 2, y: Y(y0) - 8, 'text-anchor': 'end', fill: '#1b2333', 'font-weight': 700 }, ejeX));
    et.append(s('text', { x: X(x0) + 8, y: Y(yMax) + 4, fill: '#1b2333', 'font-weight': 700 }, ejeY));
    svg.append(et);
    const g = s('g'); svg.append(g);
    return { svg, X, Y, g };
  },

  // ── Aritmética exacta (fracciones) para validar sin redondeos ──
  frac(n, d = 1) { if (d < 0) { n = -n; d = -d; } const m = mcd(Math.abs(n), d) || 1; return { n: n / m, d: d / m }; },
  /** Lee "3/4", "-2", "1,5" o "0.25" como fracción exacta; null si no se puede. */
  leerFrac(texto) {
    const t = String(texto).trim().replace(',', '.').replace(/\s+/g, '');
    if (!t) return null;
    let m = t.match(/^(-?\d+)\/(-?\d+)$/);
    if (m) { const d = +m[2]; return d === 0 ? null : K.frac(+m[1], d); }
    m = t.match(/^(-?)(\d*)\.?(\d*)$/);
    if (m && (m[2] || m[3])) { const dec = m[3] || ''; const d = 10 ** dec.length; const n = +(m[2] || 0) * d + +(dec || 0); return K.frac((m[1] ? -1 : 1) * n, d); }
    return null;
  },
  igualFrac(a, b) { return a && b && a.n * b.d === b.n * a.d; },
  /** Número leído del input (acepta coma decimal). NaN si está vacío o es inválido. */
  num(inp) { const t = String(inp.value ?? inp).trim().replace(',', '.'); return t === '' ? NaN : Number(t); },
  fmt(x, dec = 2) { return (+x.toFixed(dec)).toLocaleString('es-AR'); },
};
function mcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
window.K = K;

/* ════════════════════════════════════════════════════════════════════
   FLUJO: portada → nivel → comprobar → bitácora → siguiente nivel → final
   ════════════════════════════════════════════════════════════════════ */
let J;            // el juego
let nivel = 0;    // índice actual
let progreso;     // {resueltos:[bool], registrados:[bool]}
let pistasVistas = 0, intentos = 0, resuelto = false;
const docente = /docente/i.test(location.hash + location.search);

function claveProgreso() { return 'kodu-juego-' + J.id; }
function desbloqueado(i) { return docente || i === 0 || progreso.registrados[i - 1]; }

function pintarNiveles() {
  const nav = $('#niveles'); nav.innerHTML = '';
  J.niveles.forEach((n, i) => {
    const libre = desbloqueado(i);
    const b = h('button', { class: 'chip-nivel' + (progreso.registrados[i] ? ' hecho' : ''), 'aria-current': i === nivel ? 'true' : 'false', disabled: !libre, title: libre ? n.titulo : 'Se desbloquea al completar el nivel anterior' },
      libre ? '' : h('span', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' }),
      String(i + 1));
    b.addEventListener('click', () => libre && cargarNivel(i));
    nav.append(b);
  });
}

function cargarNivel(i) {
  nivel = i; pistasVistas = 0; intentos = 0; resuelto = false;
  limpiarNivel();
  const n = J.niveles[i];
  $('#pnEtiqueta').textContent = `Nivel ${i + 1} de ${J.niveles.length}`;
  $('#pnTitulo').textContent = n.titulo;
  $('#pnRelato').innerHTML = n.relato;
  $('#pnObjetivoTxt').innerHTML = n.objetivo;
  $('#pnControles').innerHTML = '';
  $('#pistas').innerHTML = '';
  $('#vmLienzo').innerHTML = '';
  $('#vmTitulo').textContent = n.tituloMat || 'Modo matemático';
  $('#vmSub').textContent = n.subMat || '';
  K.limpiarMensaje();
  actualizarPie();
  $('#btnComprobar').textContent = n.textoComprobar || 'Comprobar';
  n.armar(K);
  pintarNiveles();
  ajustarTamano();
  K.refrescarMat();
  if (!docente) guardar(claveProgreso() + '-ultimo', i);
}

function actualizarPie() {
  const n = J.niveles[nivel];
  const quedan = n.pistas.length - pistasVistas;
  $('#btnPista').disabled = quedan <= 0 || resuelto;
  $('#btnPista').textContent = quedan > 0 ? `Pista (${pistasVistas + 1}/${n.pistas.length})` : 'Sin más pistas';
  $('#intentos').textContent = intentos ? `Intentos: ${intentos} · Pistas usadas: ${pistasVistas}` : '';
  $('#btnComprobar').disabled = resuelto;
}

$('#btnPista').addEventListener('click', () => {
  const n = J.niveles[nivel];
  if (pistasVistas >= n.pistas.length) return;
  const txt = n.pistas[pistasVistas];
  pistasVistas++;
  $('#pistas').append(h('div', { class: 'pista' }, h('span', { class: 'n' }, `Pista ${pistasVistas}`), h('span', { html: typeof txt === 'function' ? txt(K) : txt })));
  $('#pistas').lastChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  actualizarPie();
});

$('#btnComprobar').addEventListener('click', () => {
  if (resuelto) return;
  const n = J.niveles[nivel];
  const r = n.comprobar(K);
  if (!r) return;               // el nivel puede manejar pasos intermedios
  if (r.parcial) { K.mensaje(r.msg, r.ok ? 'ok' : 'error'); return; } // paso intermedio de un nivel con fases
  intentos++;
  if (r.ok) {
    resuelto = true;
    K.mensaje(r.msg || '¡Misión cumplida!', 'ok');
    progreso.resueltos[nivel] = true; guardar(claveProgreso(), progreso);
    actualizarPie();
    const demora = n.alResolver ? n.alResolver(K) ?? 1600 : 900;
    const nivelResuelto = nivel;
    setTimeout(() => { if (nivel === nivelResuelto && resuelto) abrirBitacora(); }, demora);
  } else {
    K.mensaje(r.msg || 'Todavía no. Revisá tus datos.', 'error');
    actualizarPie();
  }
});

function abrirBitacora() {
  const n = J.niveles[nivel];
  $('#bitKicker').textContent = `Nivel ${nivel + 1} · Fundamentación matemática`;
  $('#bitResumen').innerHTML = n.resumenBitacora ? n.resumenBitacora(K) : `Resolviste: <b>${n.titulo}</b>`;
  $('#bitPreguntas').innerHTML = '';
  n.bitacora.forEach(q => $('#bitPreguntas').append(h('li', { html: q })));
  $('#bitCheck').checked = false;
  $('#bitContinuar').disabled = true;
  $('#bitContinuar').textContent = nivel < J.niveles.length - 1 ? 'Continuar la misión' : 'Terminar la misión';
  $('#bitacora').classList.add('ver');
  $('#bitCheck').focus();
}
$('#bitCheck').addEventListener('change', e => { $('#bitContinuar').disabled = !e.target.checked; });
$('#bitContinuar').addEventListener('click', () => {
  if (!$('#bitCheck').checked) return;
  progreso.registrados[nivel] = true; guardar(claveProgreso(), progreso);
  $('#bitacora').classList.remove('ver');
  if (nivel < J.niveles.length - 1) { K.toast(`Nivel ${nivel + 2} desbloqueado`); cargarNivel(nivel + 1); }
  else mostrarFinal();
});

function mostrarFinal() {
  pintarNiveles();
  const t = $('#finalTarjeta'); t.innerHTML = '';
  t.append(
    h('div', { class: 'kicker' }, 'Misión completa'),
    h('h2', {}, J.final?.titulo || '¡Lo lograron!'),
    h('p', { html: J.final?.texto || '' }),
    h('div', { class: 'misiones' }, J.niveles.map((n, i) => h('div', {}, h('b', {}, `Nivel ${i + 1} ✓`), n.titulo))),
    h('p', { html: 'Llevá tu bitácora a la clase: vamos a comparar los procedimientos que usó cada grupo.' }),
    h('div', { class: 'acciones' },
      h('button', { class: 'btn btn-sec', onclick: () => { $('#final').classList.remove('ver'); } }, 'Volver al escenario'),
      h('button', { class: 'btn btn-pri', onclick: () => { progreso = { resueltos: J.niveles.map(() => false), registrados: J.niveles.map(() => false) }; guardar(claveProgreso(), progreso); $('#final').classList.remove('ver'); cargarNivel(0); } }, 'Empezar de nuevo')));
  $('#final').classList.add('ver');
}

function mostrarPortada() {
  const t = $('#portadaTarjeta'); t.innerHTML = '';
  const hayAvance = progreso.registrados.some(Boolean);
  t.append(
    h('div', { class: 'kicker' }, J.kicker || 'Matemática · 3.er año'),
    h('h2', {}, J.titulo),
    h('p', { html: J.portada }),
    h('div', { class: 'contenidos' }, J.contenidos.map(c => h('span', {}, c))),
    h('div', { class: 'misiones' }, J.niveles.map((n, i) => h('div', {}, h('b', {}, `Nivel ${i + 1}`), n.titulo))),
    h('p', { html: 'Cada nivel termina con una <b>bitácora</b>: antes de seguir, registrás en tu hoja cómo lo resolviste. Usá el botón <b>Matemático</b> para ver la representación geométrica o algebraica de lo que pasa en el escenario.' }),
    h('div', { class: 'acciones' },
      h('button', { class: 'btn btn-pri', onclick: () => { $('#portada').classList.remove('ver'); const u = leer(claveProgreso() + '-ultimo', 0); cargarNivel(desbloqueado(u) ? u : 0); } }, hayAvance ? 'Continuar la misión' : 'Comenzar la misión'),
      docente ? h('span', { style: 'font-size:12px;color:var(--texto-3);align-self:center' }, 'Modo docente: todos los niveles abiertos') : null));
  $('#portada').classList.add('ver');
}

function setModo(mat) {
  document.body.classList.toggle('modo-mat', mat);
  $('#modoMat').setAttribute('aria-pressed', mat); $('#modoAventura').setAttribute('aria-pressed', !mat);
  ajustarTamano();
  if (mat) dibujarMat();
  J.niveles[nivel]?.alCambiarModo?.(K, mat);
}
function dibujarMat() {
  const n = J.niveles[nivel]; if (!n?.mat) return;
  const l = $('#vmLienzo'); l.innerHTML = '';
  n.mat(K, l);
}
$('#modoMat').addEventListener('click', () => setModo(true));
$('#modoAventura').addEventListener('click', () => setModo(false));

/** Punto de entrada: el juego llama a iniciar(JUEGO). */
function iniciar(juego) {
  J = juego;
  document.title = J.titulo;
  $('#tituloJuego').textContent = J.titulo;
  $('#subJuego').textContent = J.subtitulo || '';
  $('#marcaIco').textContent = J.icono || J.titulo[0];
  progreso = leer(claveProgreso(), null) || { resueltos: J.niveles.map(() => false), registrados: J.niveles.map(() => false) };
  J.escenaBase?.(K);
  ajustarTamano();
  pintarNiveles();
  // El escenario se ve detrás de la portada: cargamos el primer nivel abierto.
  cargarNivel(0);
  mostrarPortada();
  // Gancho para las pruebas automáticas (probar.mjs). No lo usa el alumno.
  window.__motor = { J, K, cargarNivel, setModo, comprobar: () => J.niveles[nivel].comprobar(K), get nivel() { return nivel; } };
}

/* ════════════════════════════════════════════════════════════════════
   JUEGO — Base Marte: Operación supervivencia
   Sistemas de ecuaciones lineales 2×2 (método gráfico, sumas y restas,
   planteo e interpretación de soluciones).
   ════════════════════════════════════════════════════════════════════ */
const T = THREE;
{
  const st = document.createElement('style');
  st.textContent = `
.lbl.mini{font-size:11px;padding:1px 5px;background:rgba(6,32,44,.8);border-color:rgba(95,211,255,.45);color:#c8f4ff}
.lbl.holo{background:rgba(6,32,44,.86);border-color:rgba(95,211,255,.6);color:#c8f4ff;font-size:12.5px}
.lbl.naranja{background:#ff8a3d;color:#1b1206;border-color:transparent}
.lbl.celeste{background:#4fd1ff;color:#06202c;border-color:transparent}
.lbl.verde{background:#3ddc97;color:#0f1b2d;border-color:transparent}
.lbl.rojo{background:#ff5d6c;color:#fff;border-color:transparent}
.lbl.magenta{background:#ff5d9e;color:#fff;border-color:transparent}
.lbl.claro b{color:#b8431c}
.ecu{font-family:var(--f-num);font-weight:700;font-size:14px;background:var(--tinta-2);border-radius:12px;padding:9px 12px;display:flex;flex-direction:column;gap:3px}
.ecu .tag{font-family:var(--f-texto);font-size:11px;font-weight:700;color:var(--texto-3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px}
.ecu .res{color:var(--acento-2)} .ecu .ok{color:var(--ok);font-family:var(--f-texto);font-size:13px}
.ecu .aviso{color:var(--aviso);font-family:var(--f-texto);font-size:13px}
.ecu .sub{font-family:var(--f-texto);font-weight:400;font-size:13.5px;color:var(--texto-2)}
.ecu .entrada{display:inline-block;width:96px;height:32px;vertical-align:middle;text-align:center}
.fila-ecu{display:flex;align-items:center;gap:5px;font-family:var(--f-num);font-weight:700}
.fila-ecu .entrada{width:76px;height:36px;padding:0 6px;text-align:center;font-size:14px}
.paso{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13.5px;color:var(--texto-2);font-weight:700}
.stepper{display:flex;align-items:center;gap:4px}
.stepper .v{min-width:52px;text-align:center;font-family:var(--f-num);font-weight:700;font-size:16px;color:var(--texto)}
.stepper .btn{width:34px;padding:0;font-size:18px}
.estado{display:flex;flex-direction:column;gap:5px;font-size:13.5px}
.estado div{display:flex;justify-content:space-between;gap:8px;background:var(--tinta-2);border-radius:9px;padding:6px 10px}
.estado b{font-family:var(--f-num)} .estado .ok{color:var(--ok)} .estado .mal{color:var(--error)} .estado .aviso{color:var(--aviso)}
.nota-p{font-size:13px;color:var(--texto-3)}
.fase{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--acento-2);font-weight:700}
.vm-marco{flex:1 1 auto;min-height:250px;position:relative}
.vm-marco svg{position:absolute;inset:0;width:100%!important;height:100%!important;min-height:0!important}
.vm-tabla{font-family:var(--f-num);font-weight:700;font-size:14px;background:#f2efe6;border-radius:10px;padding:8px 12px;display:grid;grid-template-columns:auto auto 1fr;gap:4px 12px;align-items:baseline;color:#1b2333}
.vm-tabla .k{font-family:var(--f-texto);font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em}
.vm-ok{color:#0f8a4f} .vm-mal{color:#c92a3a} .vm-res{color:#a2480f}
`;
  document.head.append(st);
}

/* ── utilidades ─────────────────────────────────────────────── */
const BASE = {};
const ROJO = 0xd8432f, VERDE = 0x3fa34d;
const fmtN = n => { if (n == null || !isFinite(n)) return '—'; const r = Math.round(n * 1000) / 1000; return (r < 0 ? '−' : '') + Math.abs(r).toLocaleString('es-AR', { maximumFractionDigits: 3 }); };
function termino(c, v, primero, ceros) {
  if (c === 0 && !ceros) return '';
  const ab = Math.abs(c), sig = primero ? (c < 0 ? '−' : '') : (c < 0 ? ' − ' : ' + ');
  return sig + (ab === 1 ? '' : fmtN(ab)) + v;
}
function ecu(a, b, c, { vx = 'x', vy = 'y', ceros = false } = {}) {
  let t = termino(a, vx, true, ceros);
  t += termino(b, vy, t === '', ceros);
  return (t || '0') + ' = ' + fmtN(c);
}
/** Lee "34000", "34.000", "34 000", "7,5", "15/2", "−300". NaN si no se puede. */
function leerNum(txt) {
  let t = String(txt ?? '').trim().replace(/[−–]/g, '-').replace(/\s+/g, '');
  if (!t) return NaN;
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  t = t.replace(',', '.');
  const f = t.match(/^(-?\d+)\/(-?\d+)$/);
  if (f) return +f[2] === 0 ? NaN : +f[1] / +f[2];
  return /^-?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
}
const cerca = (p, q) => Math.abs(p - q) <= 1e-9 * Math.max(1, Math.abs(p), Math.abs(q));
/** ¿La ecuación e = [a,b,c] es un múltiplo (no nulo) de f? */
function proporcional(e, f) {
  if (!e || e.some(v => !isFinite(v)) || e.every(v => v === 0)) return false;
  return cerca(e[0] * f[1], e[1] * f[0]) && cerca(e[0] * f[2], e[2] * f[0]) && cerca(e[1] * f[2], e[2] * f[1]);
}
/** ¿El primer miembro de e es múltiplo de A·x + B·y? */
const razon = (e, A, B) => (e[0] !== 0 || e[1] !== 0) && cerca(e[0] * B, e[1] * A);
function azar(sem) { return () => { sem |= 0; sem = sem + 0x6D2B79F5 | 0; let t = Math.imul(sem ^ sem >>> 15, 1 | sem); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function animar(K, dur, f, fin) { let u = 0, listo = false; K.tic(dt => { if (listo) return; u = Math.min(1, u + dt / dur); f(u); if (u >= 1) { listo = true; fin?.(); } }); }
const suave = u => u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
const rebote = u => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
function limpiarGrupo(g) {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse(o => { if (o.isCSS2DObject) o.element.remove(); o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); });
  }
}
function mostrar(K, obj, vis) {
  if (vis && !obj.visible) { obj.visible = true; obj.scale.setScalar(.01); animar(K, .35, u => obj.scale.setScalar(Math.max(.01, rebote(u)))); }
  else if (!vis) obj.visible = false;
}
function elegir(grupo, valor, valores) {
  grupo.valor = valor;
  [...grupo.children].forEach((b, i) => b.setAttribute('aria-pressed', valores[i] === valor ? 'true' : 'false'));
}

/* ── controles del panel ───────────────────────────────────── */
function entrada(K, aria, valor = '') { return K.h('input', { class: 'entrada', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'aria-label': aria, value: valor }); }
function filaEcu(K, etiqueta, alCambiar) {
  const ins = ['coeficiente de x', 'coeficiente de y', 'término independiente'].map(a => entrada(K, etiqueta + ': ' + a));
  ins.forEach(i => i.addEventListener('input', () => alCambiar?.()));
  K.controles().append(K.h('div', { class: 'campo' }, K.h('label', {}, etiqueta),
    K.h('div', { class: 'fila-ecu' }, ins[0], K.h('span', {}, 'x +'), ins[1], K.h('span', {}, 'y ='), ins[2])));
  return ins;
}
function parXY(K, etiqueta, alCambiar) {
  const ix = entrada(K, 'x'), iy = entrada(K, 'y');
  [ix, iy].forEach(i => i.addEventListener('input', () => alCambiar?.()));
  K.controles().append(K.h('div', { class: 'campo' }, K.h('label', {}, etiqueta),
    K.h('div', { class: 'fila-ecu' }, K.h('span', {}, 'x ='), ix, K.h('span', { style: 'margin-left:12px' }, 'y ='), iy)));
  return [ix, iy];
}
function stepper(K, etiqueta, { valor = 0, min = 0, max = 99, saltarCero = false, fmt = v => String(v), alCambiar, donde } = {}) {
  let val = valor;
  const v = K.h('span', { class: 'v' }, fmt(val));
  const cambiar = d => { let n = val + d; if (saltarCero && n === 0) n += d; if (n < min || n > max) return; val = n; v.textContent = fmt(val); alCambiar?.(val); };
  const menos = K.h('button', { class: 'btn btn-sec btn-chico', 'aria-label': 'Menos', onclick: () => cambiar(-1) }, '−');
  const mas = K.h('button', { class: 'btn btn-sec btn-chico', 'aria-label': 'Más', onclick: () => cambiar(1) }, '+');
  (donde || K.controles()).append(K.h('div', { class: 'paso' }, K.h('span', { html: etiqueta }), K.h('div', { class: 'stepper' }, menos, v, mas)));
  return { get valor() { return val; }, poner(n) { val = n; v.textContent = fmt(n); } };
}

/* ── vista matemática ──────────────────────────────────────── */
function rectaEnCaja(a, b, c, x0, x1, y0, y1) {
  const P = [], e = 1e-9;
  if (b !== 0) for (const x of [x0, x1]) { const y = (c - a * x) / b; if (y >= y0 - e && y <= y1 + e) P.push([x, y]); }
  if (a !== 0) for (const y of [y0, y1]) { const x = (c - b * y) / a; if (x >= x0 - e && x <= x1 + e) P.push([x, y]); }
  let mejor = null, d = 1e-12;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) { const dd = (P[i][0] - P[j][0]) ** 2 + (P[i][1] - P[j][1]) ** 2; if (dd > d) { d = dd; mejor = [P[i], P[j]]; } }
  return mejor;
}
function recta(K, p, R, a, b, c, color, etq, o = {}) {
  const seg = rectaEnCaja(a, b, c, ...R); if (!seg) return;
  const [[x1, y1], [x2, y2]] = seg[0][1] >= seg[1][1] ? seg : [seg[1], seg[0]];
  p.g.append(K.s('line', { x1: p.X(x1), y1: p.Y(y1), x2: p.X(x2), y2: p.Y(y2), stroke: color, 'stroke-width': o.grosor || 3.2, 'stroke-linecap': 'round', 'stroke-dasharray': o.discontinua ? '8 6' : null }));
  if (etq) {
    const t = o.t ?? .1, lx = x1 + (x2 - x1) * t, ly = y1 + (y2 - y1) * t;
    const ang = o.rotar ? Math.atan2(p.Y(y2) - p.Y(y1), p.X(x2) - p.X(x1)) * 180 / Math.PI : 0;
    const tx = o.rotar ? p.X(lx) : p.X(lx) + (o.dx ?? 9), ty = o.rotar ? p.Y(ly) : p.Y(ly) + (o.dy ?? -9);
    p.g.append(K.s('text', { x: tx, y: ty, dy: o.rotar ? (o.dy ?? -8) : null, transform: o.rotar ? `rotate(${ang} ${tx} ${ty})` : null, fill: color, 'font-weight': 700, 'font-size': 13.5, stroke: '#fdfcf8', 'stroke-width': 4, 'paint-order': 'stroke', 'text-anchor': o.ancla || 'start' }, etq));
  }
}
function punto(K, p, x, y, color, etq) {
  p.g.append(K.s('circle', { cx: p.X(x), cy: p.Y(y), r: 7.5, fill: color, stroke: '#fff', 'stroke-width': 2.5 }));
  if (etq) p.g.append(K.s('text', { x: p.X(x) + 11, y: p.Y(y) - 11, fill: '#1b2333', 'font-weight': 700, 'font-size': 13.5, stroke: '#fdfcf8', 'stroke-width': 4, 'paint-order': 'stroke' }, etq));
}
/** Cámara del nivel; en pantallas angostas (celular) se aleja para que entre la escena. */
function encuadre(K, pos, mira, op) {
  const f = innerWidth <= 860 ? 1.75 : 1;
  K.camara(pos.map((v, i) => mira[i] + (v - mira[i]) * f), mira, op);
}
function marcoPlano(K, el, p) { const d = K.h('div', { class: 'vm-marco' }); d.append(p.svg); el.append(d); return d; }
const marca = (ok, txt) => `<span class="${ok ? 'vm-ok' : 'vm-mal'}">${ok ? '✓' : '✗'} ${txt}</span>`;

/* ── modelos low-poly ──────────────────────────────────────── */
let _texPanel;
function texPanel() {
  if (_texPanel) return _texPanel;
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#16306b'; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = '#7397da'; x.lineWidth = 3;
  for (let i = 0; i <= 128; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(128, i); x.stroke(); }
  x.fillStyle = 'rgba(255,255,255,.1)'; x.fillRect(0, 0, 128, 44);
  _texPanel = new T.CanvasTexture(c); _texPanel.colorSpace = T.SRGBColorSpace; return _texPanel;
}
const vidrio = (op = .28, color = 0xbfe4ff) => new T.MeshStandardMaterial({ color, transparent: true, opacity: op, roughness: .08, metalness: .3, side: T.DoubleSide, depthWrite: false });
function domo(K, r, pos) {
  const g = new T.Group();
  g.add(K.cilindro(r + .25, r + .45, .6, 0xe7e1d6, [0, .3, 0], 24));
  const v = new T.Mesh(new T.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), vidrio()); v.position.y = .6; g.add(v);
  const marco = new T.LineSegments(new T.EdgesGeometry(new T.IcosahedronGeometry(r * 1.01, 1)), new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .5 }));
  marco.position.y = .6; g.add(marco);
  g.add(K.caja(1.5, 1.9, 1.4, 0xe7e1d6, [0, .95, r + .25]));
  g.add(K.caja(.8, 1.3, .05, 0x2a3c5c, [0, .85, r + .96]));
  g.add(K.caja(1.52, .14, 1.42, 0xff6b3d, [0, 1.85, r + .25]));
  g.position.set(...pos); return g;
}
function astronauta(K, pos, rotY = 0, acento = 0xff6b3d) {
  const g = new T.Group();
  g.add(K.cilindro(.26, .3, .95, 0xf3f1ec, [0, .5, 0], 10));
  g.add(K.cilindro(.31, .31, .12, acento, [0, .72, 0], 10));
  g.add(K.caja(.44, .52, .24, 0xd9d4ca, [0, .78, -.27]));
  g.add(K.esfera(.28, 0xf3f1ec, [0, 1.22, 0]));
  const visor = K.esfera(.2, 0xffb347, [0, 1.24, .13], { metalness: .8, roughness: .2 }); visor.scale.set(1, .75, .7); g.add(visor);
  g.add(K.cilindro(.08, .08, .62, 0xf3f1ec, [.34, .66, 0], 6));
  g.add(K.cilindro(.08, .08, .62, 0xf3f1ec, [-.34, .66, 0], 6));
  g.position.set(...pos); g.rotation.y = rotY; return g;
}
function panelSolar(K, grande, polvo = false) {
  const g = new T.Group();
  const w = grande ? 2.2 : 1.3, d = grande ? 1.5 : 1.0, alto = grande ? 1.1 : .85;
  g.add(K.cilindro(.07, .09, alto, 0x9aa3ad, [0, alto / 2, 0], 6));
  const placa = new T.Group(); placa.position.y = alto + .05; placa.rotation.x = .5;
  placa.add(K.caja(w + .12, .07, d + .12, 0xc3c8ce, [0, 0, 0]));
  const cel = new T.Mesh(new T.BoxGeometry(w, .04, d), new T.MeshStandardMaterial({ color: polvo ? 0xc7865e : 0xffffff, map: texPanel(), roughness: .35, metalness: .3 }));
  cel.position.y = .05; cel.castShadow = true; placa.add(cel); g.add(placa);
  Object.assign(g, { cel, ancho: w, prof: d, alto }); return g;
}
function electrolizador(K) {
  const g = new T.Group();
  g.add(K.caja(.85, .25, .85, 0x8d8a86, [0, .125, 0]));
  g.add(K.cilindro(.3, .3, 1.1, 0xeef1f4, [0, .8, 0], 12, { metalness: .4, roughness: .35 }));
  g.add(K.cilindro(.31, .31, .12, 0x4fd1ff, [0, 1.05, 0], 12, { emissive: 0x4fd1ff, emissiveIntensity: .8 }));
  g.add(K.esfera(.3, 0xeef1f4, [0, 1.35, 0]));
  g.add(K.cilindro(.05, .05, .5, 0xb9c0c8, [0, 1.75, 0], 6));
  return g;
}
function biorreactor(K) {
  const g = new T.Group();
  g.add(K.caja(.85, .2, .85, 0x8d8a86, [0, .1, 0]));
  const tubo = new T.Mesh(new T.CylinderGeometry(.33, .33, 1.5, 14), new T.MeshStandardMaterial({ color: 0x3bd16f, emissive: 0x1d8a3f, emissiveIntensity: .7, transparent: true, opacity: .85, roughness: .2 }));
  tubo.position.y = .95; g.add(tubo); g.tubo = tubo;
  g.add(K.cilindro(.37, .37, .12, 0xd8d4cc, [0, 1.74, 0], 14));
  g.add(K.cilindro(.37, .37, .12, 0xd8d4cc, [0, .24, 0], 14));
  return g;
}
/** Medidor vertical con anillo de meta. poner(valor, meta, texto). */
function medidor(K, pos, color, altLbl = 5.1) {
  const g = new T.Group();
  g.add(K.cilindro(.5, .56, .3, 0x6f6a66, [0, .15, 0], 12));
  const tubo = new T.Mesh(new T.CylinderGeometry(.36, .36, 4.2, 14, 1, true), vidrio(.22, 0xcfe9ff)); tubo.position.y = 2.4; g.add(tubo);
  g.add(K.cilindro(.4, .4, .12, 0xd8d4cc, [0, 4.5, 0], 14));
  const relleno = new T.Mesh(new T.CylinderGeometry(.29, .29, 1, 14), new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .45 }));
  relleno.position.y = .3; g.add(relleno);
  const meta = new T.Mesh(new T.TorusGeometry(.44, .05, 6, 24), new T.MeshBasicMaterial({ color: 0xffffff })); meta.rotation.x = Math.PI / 2; meta.position.y = 3.3; g.add(meta);
  g.lbl = K.etiqueta('', [0, altLbl, 0], '', g);
  g.position.set(...pos);
  g.poner = (val, obj, txt) => {
    const f = Math.max(.002, Math.min(1.3, val / obj));
    relleno.scale.y = f * 3; relleno.position.y = .3 + f * 1.5;
    const c = val === obj ? 0x3ddc97 : val > obj ? 0xff5d6c : color;
    relleno.material.color.set(c); relleno.material.emissive.set(c);
    g.lbl.texto(txt); g.lbl.element.className = 'lbl ' + (val === obj ? 'verde' : val > obj ? 'rojo' : '');
  };
  return g;
}
function rover(K) {
  const g = new T.Group();
  g.add(K.caja(3.6, .45, 2.0, 0xe9e4da, [0, .95, 0]));
  g.add(K.caja(3.7, .1, 2.1, 0xff6b3d, [0, 1.2, 0]));
  g.add(K.caja(1.2, .9, 1.8, 0xe9e4da, [1.15, 1.7, 0]));
  g.add(K.caja(.06, .5, 1.5, 0x22344f, [1.76, 1.82, 0], { metalness: .6, roughness: .2 }));
  g.add(K.caja(2.15, .08, 2.0, 0x55524e, [-.6, 1.3, 0]));
  for (const z of [-1.02, 1.02]) g.add(K.caja(2.15, .38, .06, 0xd9d4ca, [-.6, 1.49, z]));
  g.add(K.caja(.06, .38, 2.0, 0xd9d4ca, [-1.67, 1.49, 0]));
  g.ruedas = [];
  for (const x of [-1.25, 0, 1.25]) for (const z of [-1.12, 1.12]) {
    const r = K.cilindro(.45, .45, .34, 0x2f2b29, [x, .45, z], 14); r.rotation.x = Math.PI / 2; g.add(r); g.ruedas.push(r);
    const c = K.cilindro(.2, .2, .36, 0xb9c0c8, [x, .45, z], 8); c.rotation.x = Math.PI / 2; g.add(c);
  }
  g.add(K.cilindro(.03, .03, 1.4, 0xb9c0c8, [1.45, 2.8, -.6], 6));
  g.add(K.esfera(.1, 0xff6b3d, [1.45, 3.5, -.6]));
  g.add(K.caja(.25, .25, .4, 0x3a3532, [1.5, 2.3, .55]));
  return g;
}
const SLOTS = Array.from({ length: 16 }, (_, i) => [-1.35 + (i % 4) * .5, 1.52, -.75 + Math.floor(i / 4) * .5]);
function pack(K, color, pos = [0, 0, 0]) {
  const g = new T.Group();
  g.add(K.caja(.44, .34, .44, color, [0, 0, 0]));
  g.add(K.caja(.45, .07, .45, 0xf3efe6, [0, .05, 0]));
  g.position.set(...pos); return g;
}
function pilaPacks(K, color, pos) {
  const g = new T.Group();
  g.add(K.caja(1.9, .16, 1.9, 0x8a6a4a, [0, .08, 0]));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < (i + j > 2 ? 2 : 3); k++) g.add(pack(K, color, [-.55 + i * .55, .34 + k * .36, -.55 + j * .55]));
  g.position.set(...pos); return g;
}
const CAJAS = {
  agua: { nombre: 'Tanque de agua', corto: 'tanques de agua', kg: 60, m3: 1, color: 0x3d8bff, forma: 'tanque', alto: .7 },
  repuestos: { nombre: 'Caja de repuestos', corto: 'cajas de repuestos', kg: 40, m3: 2, color: 0x8d939c, forma: 'caja', lado: .7, alto: .72 },
  semillas: { nombre: 'Caja de semillas', corto: 'cajas de semillas', kg: 50, m3: 1, color: 0x5bbf5a, forma: 'caja', lado: .56, alto: .58 },
  herramientas: { nombre: 'Caja de herramientas', corto: 'cajas de herramientas', kg: 100, m3: 2, color: 0xf2b134, forma: 'caja', lado: .7, alto: .72 },
  paneles: { nombre: 'Paneles plegados', corto: 'paquetes de paneles', kg: 20, m3: 2, color: 0x2f5fb3, forma: 'placa', alto: .44 },
};
const PROP = [null, ['agua', 'repuestos'], ['semillas', 'herramientas'], ['agua', 'paneles']];
const VEREDICTOS = [['sirve', 'Sirve (enteros ≥ 0)'], ['noentera', 'No sirve: no da entera'], ['negativa', 'No sirve: da negativa'], ['sinsol', 'No tiene solución'], ['infinitas', 'Infinitas soluciones']];
function cajaModelo(K, tipo) {
  const c = CAJAS[tipo], g = new T.Group();
  if (c.forma === 'tanque') { g.add(K.cilindro(.3, .3, .62, c.color, [0, .31, 0], 12, { metalness: .3, roughness: .4 })); g.add(K.cilindro(.31, .31, .08, 0xeef1f4, [0, .52, 0], 12)); g.add(K.cilindro(.08, .08, .08, 0xeef1f4, [0, .66, 0], 8)); }
  else if (c.forma === 'placa') { for (let i = 0; i < 3; i++) g.add(K.caja(.74, .13, .64, i % 2 ? 0x2f5fb3 : 0x24498c, [0, .07 + i * .14, 0])); }
  else { g.add(K.caja(c.lado, c.lado, c.lado, c.color, [0, c.lado / 2, 0])); g.add(K.caja(c.lado + .01, .08, c.lado + .01, 0xf3efe6, [0, c.lado * .62, 0])); }
  return g;
}
function crearFila(K, tipos, cx, z, nombre) {
  const anchoDe = t => t === 'A' ? 2.6 : 1.6;
  const total = tipos.reduce((s, t) => s + anchoDe(t), 0);
  const fila = { tipos, paneles: [], cx, z, total, nombre };
  let x = cx - total / 2;
  for (const t of tipos) { const w = anchoDe(t); const p = panelSolar(K, t === 'A', true); p.position.set(x + w / 2, 0, z); p.tipo = t; K.agregar(p); fila.paneles.push(p); x += w; }
  K.agregar(K.caja(total + .4, .12, 1.9, 0x8a7f78, [cx, .06, z]));
  return fila;
}

/* ════════════════════════════════════════════════════════════════════ */
const JUEGO = {
  id: 'base-marte',
  titulo: 'Base Marte: Operación supervivencia',
  subtitulo: 'Colección Misiones 3D · Sistemas de ecuaciones',
  icono: 'M',
  kicker: 'Matemática · 3.er año · Sistemas de ecuaciones',
  portada: 'Año 2061. Una tormenta de polvo dejó a la <b>Base Cruz del Sur</b>, en Marte, funcionando a media máquina. Sos parte del equipo científico que tiene que volver a ponerla en marcha: oxígeno, energía, raciones y el próximo envío de suministros. En cada misión hay <b>dos condiciones que se tienen que cumplir a la vez</b>: las vas a modelizar con un sistema de ecuaciones y vas a usar su solución para decidir qué hacer en la base.',
  contenidos: ['Sistemas de ecuaciones 2×2', 'Método gráfico', 'Método de sumas y restas', 'Planteo de problemas', 'Interpretación de soluciones'],
  final: {
    titulo: '¡La Base Cruz del Sur está operativa!',
    texto: 'Recuperaste el oxígeno, reconectaste la energía, cargaste las raciones de la expedición y despachaste el cohete de suministros. En todas las misiones pasó lo mismo: resolver un sistema no es sólo encontrar dos números. La solución tiene que cumplir <b>las dos condiciones a la vez</b> y, además, <b>tener sentido en la situación</b>: no se manda media caja ni se instala una cantidad negativa de equipos.',
  },

  escenaBase(K) {
    const sc = K.scene, rnd = azar(11);
    K.cielo(0x5e3328, 0xe0a47a, [70, 330]);
    K.renderer.toneMappingExposure = 1.0;
    K.sol.color.set(0xffe3c6); K.sol.intensity = 2.6; K.sol.position.set(-30, 50, 35);
    K.hemi.color.set(0xffd8c0); K.hemi.groundColor.set(0x6e2f1a); K.hemi.intensity = 1.0;

    // Terreno: plano al centro (la base), dunas y lomas hacia el horizonte.
    const geo = new T.PlaneGeometry(560, 560, 140, 140); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, cols = [];
    const c1 = new T.Color(0xb95a2f), c2 = new T.Color(0x93401f), c3 = new T.Color(0xcf7b48), tmp = new T.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), d = Math.hypot(x, z);
      const n = Math.sin(x * .045) * Math.cos(z * .05) + .5 * Math.sin(x * .12 + z * .09) + .25 * Math.cos(x * .31 - z * .27);
      const f = Math.min(1, Math.max(0, (d - 50) / 50));
      pos.setY(i, f * (n * 3.2 + f * 2.5));
      const t = .5 + .5 * Math.sin(x * .19 + z * .13) * Math.cos(z * .07 - x * .05);
      tmp.copy(c1).lerp(t > .5 ? c3 : c2, Math.abs(t - .5) * 1.4); cols.push(tmp.r, tmp.g, tmp.b);
    }
    geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3)); geo.computeVertexNormals();
    const terreno = new T.Mesh(geo, K.mat(0xffffff, { vertexColors: true })); terreno.receiveShadow = true; sc.add(terreno);

    // Mesetas y un volcán lejano
    for (let i = 0; i < 26; i++) {
      const ang = (i / 26) * Math.PI * 2 + rnd() * .2, r = 160 + rnd() * 100, rad = 8 + rnd() * 20, alto = 5 + rnd() * 15;
      const m = new T.Mesh(new T.CylinderGeometry(rad * .7, rad, alto, 7), K.mat(rnd() < .5 ? 0x9b4628 : 0xa9552f));
      m.position.set(Math.cos(ang) * r, alto / 2 - 1, Math.sin(ang) * r); m.rotation.y = rnd() * 3; sc.add(m);
    }
    const volcan = new T.Mesh(new T.ConeGeometry(80, 30, 10), K.mat(0xa04f2d)); volcan.position.set(-110, 12, -250); sc.add(volcan);

    // Cráteres
    const crater = (x, z, r) => {
      const borde = new T.Mesh(new T.TorusGeometry(r, r * .2, 6, 22), K.mat(0xa8532c)); borde.rotation.x = -Math.PI / 2; borde.scale.z = .45; borde.position.set(x, 0, z); borde.receiveShadow = true; sc.add(borde);
      const fondo = new T.Mesh(new T.CircleGeometry(r, 22), K.mat(0x8a3c1d)); fondo.rotation.x = -Math.PI / 2; fondo.position.set(x, .03, z); fondo.receiveShadow = true; sc.add(fondo);
    };
    crater(8, 30, 5); crater(-62, 22, 7); crater(58, -12, 6); crater(-4, -48, 8); crater(-55, -44, 5); crater(50, 34, 4); crater(-20, 34, 3.5);

    // Rocas (fuera de las zonas de las misiones)
    const zonas = [[-40, -18, -13, 14], [16, 50, -6, 12], [-38, -18, -34, -14], [15, 40, -40, -16], [-14, 16, -24, 12]];
    const libre = (x, z) => !zonas.some(([x0, x1, z0, z1]) => x > x0 - 2 && x < x1 + 2 && z > z0 - 2 && z < z1 + 2);
    for (let i = 0, n = 0; i < 500 && n < 85; i++) {
      const ang = rnd() * Math.PI * 2, r = 10 + rnd() * 75, x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (!libre(x, z)) continue;
      sc.add(K.roca([x, .1, z], .3 + rnd() * 1.2, rnd() < .5 ? 0x7c3a22 : 0x934a2b)); n++;
    }

    // Hábitat central: domos unidos por túneles
    sc.add(domo(K, 5, [0, 0, -4]), domo(K, 3.2, [-9.5, 0, -1]), domo(K, 3.2, [9, 0, -6.5]));
    sc.add(K.barra([-6.5, 1.1, -1.8], [-4.4, 1.1, -3], .7, 0xe7e1d6), K.barra([4.6, 1.1, -4.8], [6.1, 1.1, -5.7], .7, 0xe7e1d6));
    const piso = new T.Mesh(new T.CircleGeometry(4.8, 24), K.mat(0xcfc6b8)); piso.rotation.x = -Math.PI / 2; piso.position.set(0, .62, -4); sc.add(piso);
    sc.add(K.arbol([1.6, .6, -5], .7, 0x4caf50), K.arbol([-1.8, .6, -5.6], .55, 0x5cbf60));
    sc.add(K.caja(1.6, .7, .8, 0xffffff, [-1.2, .95, -2.4]), K.caja(.9, .9, .9, 0x4f6d8f, [2.2, 1.05, -2.6]));
    sc.add(astronauta(K, [.4, .6, -3.2], .3));
    BASE.luz = new T.PointLight(0xffd29a, 4, 16); BASE.luz.position.set(0, 3, -4); sc.add(BASE.luz);

    // Invernadero
    const inv = new T.Group();
    inv.add(K.caja(10.4, .3, 5.2, 0xe7e1d6, [0, .15, 0]));
    const techo = new T.Mesh(new T.CylinderGeometry(2.4, 2.4, 10, 16, 1, true, 0, Math.PI), vidrio(.3, 0xd6f5d0)); techo.rotation.z = Math.PI / 2; techo.position.y = .3; inv.add(techo);
    for (let i = 0; i < 8; i++) for (const j of [-1.1, 0, 1.1]) inv.add(K.esfera(.36, i % 2 ? 0x4caf50 : 0x66c46a, [-3.9 + i * 1.1, .7, j], { emissive: 0x1e5a24, emissiveIntensity: .3 }));
    inv.position.set(-4, 0, -17); sc.add(inv);

    // Campo solar fijo, antena, bandera, astronautas
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { const p = panelSolar(K, true); p.position.set(9.5 + i * 2.7, 0, -15 - j * 3); sc.add(p); }
    const ant = new T.Group();
    ant.add(K.cilindro(.15, .22, 3.4, 0xd9d4ca, [0, 1.7, 0], 8));
    const plato = new T.Group(); plato.position.y = 3.6;
    const disco = new T.Mesh(new T.CylinderGeometry(1.5, .25, .55, 18, 1, true), K.mat(0xeeeae2, { side: T.DoubleSide })); disco.rotation.x = .7; plato.add(disco);
    plato.add(K.barra([0, 0, 0], [0, .9, .8], .04, 0xb9c0c8));
    ant.add(plato); BASE.antena = plato; ant.position.set(13, 0, 5); sc.add(ant);
    const bandera = new T.Group();
    bandera.add(K.cilindro(.05, .05, 3.2, 0xd9d4ca, [0, 1.6, 0], 6));
    const cv = document.createElement('canvas'); cv.width = 96; cv.height = 60; const cx = cv.getContext('2d');
    cx.fillStyle = '#74acdf'; cx.fillRect(0, 0, 96, 60); cx.fillStyle = '#fff'; cx.fillRect(0, 20, 96, 20); cx.fillStyle = '#f6b40e'; cx.beginPath(); cx.arc(48, 30, 6, 0, 7); cx.fill();
    const tx = new T.CanvasTexture(cv); tx.colorSpace = T.SRGBColorSpace;
    const tela = new T.Mesh(new T.PlaneGeometry(1.6, 1), new T.MeshStandardMaterial({ map: tx, side: T.DoubleSide, roughness: .9 })); tela.position.set(.8, 2.65, 0); bandera.add(tela);
    bandera.position.set(4.5, 0, 3.5); sc.add(bandera);
    sc.add(astronauta(K, [3, 0, 5], -.4, 0x4fd1ff), astronauta(K, [-6.5, 0, 4.5], .6));

    // Plataforma de lanzamiento y cohete
    sc.add(K.cilindro(5, 5.4, 1, 0x8c8f94, [34, .5, -34], 22));
    const anillo = new T.Mesh(new T.RingGeometry(3, 3.4, 32), new T.MeshBasicMaterial({ color: 0xf2b134 })); anillo.rotation.x = -Math.PI / 2; anillo.position.set(34, 1.02, -34); sc.add(anillo);
    const torre = new T.Group(), tc = 0xc9452f;
    for (const [dx, dz] of [[-.6, -.6], [.6, -.6], [-.6, .6], [.6, .6]]) torre.add(K.barra([dx, 0, dz], [dx, 15, dz], .08, tc));
    for (let y = 0; y < 15; y += 1.5) { torre.add(K.barra([-.6, y, -.6], [.6, y + 1.5, -.6], .05, tc)); torre.add(K.barra([-.6, y, .6], [.6, y + 1.5, .6], .05, tc)); torre.add(K.barra([.6, y, -.6], [.6, y + 1.5, .6], .05, tc)); }
    torre.add(K.barra([-.6, 10.5, 0], [-2.4, 10.5, 0], .1, 0x8c8f94));
    torre.position.set(38.5, 1, -34); sc.add(torre);
    const coh = new T.Group();
    coh.add(K.cilindro(.6, .9, 1, 0x3a3a3a, [0, .5, 0], 14));
    coh.add(K.cilindro(1.2, 1.4, 8, 0xf1ede6, [0, 5, 0], 18));
    coh.add(K.cilindro(1.23, 1.23, .6, 0xff6b3d, [0, 7.6, 0], 18));
    coh.add(K.cilindro(1.37, 1.37, .4, 0xff6b3d, [0, 1.6, 0], 18));
    const nariz = new T.Mesh(new T.ConeGeometry(1.2, 3, 18), K.mat(0xf1ede6)); nariz.position.y = 10.5; nariz.castShadow = true; coh.add(nariz);
    for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2 + .5; const al = K.caja(.15, 2.2, 1.3, 0xff6b3d, [Math.sin(a) * 1.5, 1.6, Math.cos(a) * 1.5]); al.rotation.y = a; coh.add(al); }
    coh.add(K.caja(1.3, 1.5, .1, 0x2a3c5c, [0, 4, 1.32]));
    coh.add(K.esfera(.32, 0x22344f, [0, 6.6, 1.15], { metalness: .6, roughness: .2 }));
    const llama = new T.Mesh(new T.ConeGeometry(.8, 4, 14), new T.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: .9 }));
    llama.rotation.x = Math.PI; llama.position.y = -2; llama.visible = false; coh.add(llama);
    coh.position.set(34, 1, -34); sc.add(coh);
    BASE.cohete = coh; BASE.llama = llama;

    // Cielo: lunas Fobos y Deimos
    const luna = (r, p) => { const m = new T.Mesh(new T.DodecahedronGeometry(r, 1), new T.MeshBasicMaterial({ color: 0xc9b6a6, fog: false })); m.position.set(...p); sc.add(m); };
    luna(5, [80, 95, -290]); luna(2.4, [-130, 120, -300]);

    // Polvo en suspensión (animación permanente: no depende del nivel)
    const nP = 700, pp = new Float32Array(nP * 3);
    for (let i = 0; i < nP; i++) { pp[i * 3] = (rnd() - .5) * 160; pp[i * 3 + 1] = rnd() * 22; pp[i * 3 + 2] = (rnd() - .5) * 160; }
    const pg = new T.BufferGeometry(); pg.setAttribute('position', new T.BufferAttribute(pp, 3));
    const polvo = new T.Points(pg, new T.PointsMaterial({ color: 0xf0c49a, size: .22, transparent: true, opacity: .55, depthWrite: false }));
    sc.add(polvo);
    const t0 = performance.now();
    sc.onBeforeRender = () => { const t = (performance.now() - t0) / 1000; polvo.position.x = (t * 1.6) % 40 - 20; polvo.position.y = Math.sin(t * .3) * .6; BASE.antena.rotation.y = t * .25; };
  },

  niveles: [
    /* ═════════════════ NIVEL 1 · método gráfico ═════════════════ */
    {
      titulo: 'Recuperar la producción de oxígeno',
      relato: 'La tormenta tiró abajo la planta de O₂ y hay que reinstalar dos tipos de equipos. La colonia necesita <b>exactamente 18 kg de O₂ por día</b> (lo que sobra se pierde) y la línea eléctrica de la planta entrega <b>exactamente 10 kW</b> (si sobra, el generador recalienta; si falta, se corta).',
      objetivo: 'Elegí cuántos <b>electrolizadores (x)</b> y <b>biorreactores (y)</b> instalar para cumplir <b>las dos condiciones a la vez</b>. Arrastrá la baliza amarilla del holograma o usá los deslizadores.',
      tituloMat: 'Método gráfico',
      subMat: 'Cada condición es una recta: la solución tiene que estar en las dos',
      armar(K) {
        const OX = -36, OZ = 10, X = x => OX + x, Z = y => OZ - y;
        Object.assign(this, { OX, OZ, x: 0, y: 0 });
        encuadre(K, [-28.5, 12.5, 24.5], [-29.5, 1.5, -1], { min: 8, max: 60 });
        BASE.luz.intensity = 4;
        K.datos([['Electrolizador', '3 kg O₂/día · 1 kW'], ['Biorreactor', '2 kg O₂/día · 2 kW'], ['Hace falta', '18 kg O₂/día · 10 kW']]);
        this.sx = K.deslizador('Electrolizadores (x)', { id: 'sx', min: 0, max: 10, valor: 0, alCambiar: v => this.poner(K, v, this.y, 'slider') });
        this.sy = K.deslizador('Biorreactores (y)', { id: 'sy', min: 0, max: 10, valor: 0, alCambiar: v => this.poner(K, this.x, v, 'slider') });
        this.boxEstado = K.html('');

        // Holograma: plano cartesiano en el piso (x hacia la derecha, y hacia el fondo)
        const tab = new T.Group();
        const base = new T.Mesh(new T.BoxGeometry(11.8, .12, 11.8), new T.MeshStandardMaterial({ color: 0x0c2230, emissive: 0x06202c, roughness: .4, metalness: .2 }));
        base.position.set(X(4.9), .06, Z(4.9)); base.receiveShadow = true; tab.add(base);
        const pts = [];
        for (let i = 0; i <= 10; i++) { pts.push(X(i), .13, Z(0), X(i), .13, Z(10), X(0), .13, Z(i), X(10), .13, Z(i)); }
        const gg = new T.BufferGeometry(); gg.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
        tab.add(new T.LineSegments(gg, new T.LineBasicMaterial({ color: 0x5fd3ff, transparent: true, opacity: .4 })));
        tab.add(K.barra([X(0), .15, Z(0)], [X(10.7), .15, Z(0)], .05, 0xeaf6ff), K.barra([X(0), .15, Z(0)], [X(0), .15, Z(10.7)], .05, 0xeaf6ff));
        for (const i of [2, 4, 6, 8, 10]) { K.etiqueta(String(i), [X(i), .2, Z(-.55)], 'mini', tab); K.etiqueta(String(i), [X(-.55), .2, Z(i)], 'mini', tab); }
        K.etiqueta('0', [X(-.45), .2, Z(-.45)], 'mini', tab);
        K.etiqueta('x · electrolizadores', [X(8.2), .2, Z(-1.35)], 'holo', tab);
        K.etiqueta('y · biorreactores', [X(-1.2), .2, Z(11.4)], 'holo', tab);
        K.agregar(tab);
        this.r1 = K.agregar(K.barra([X(0), .2, Z(9)], [X(6), .2, Z(0)], .1, 0xff8a3d, { emissive: 0xff8a3d, emissiveIntensity: .3 }));
        this.r2 = K.agregar(K.barra([X(0), .2, Z(5)], [X(10), .2, Z(0)], .1, 0x4fd1ff, { emissive: 0x4fd1ff, emissiveIntensity: .3 }));
        K.etiqueta('O₂: 3x + 2y = 18', [X(-2.9), .4, Z(9)], 'naranja');
        K.etiqueta('Energía: x + 2y = 10', [X(8.3), .4, Z(2.3)], 'celeste');
        this.proy = K.agregar(new T.Group());

        // Baliza arrastrable = el punto (x, y)
        const bal = new T.Group();
        const aro = new T.Mesh(new T.TorusGeometry(.42, .08, 8, 24), new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd166, emissiveIntensity: .9 }));
        aro.rotation.x = Math.PI / 2; aro.position.y = .25; bal.add(aro);
        const haz = new T.Mesh(new T.CylinderGeometry(.1, .3, 3, 12, 1, true), new T.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: .45, depthWrite: false, side: T.DoubleSide }));
        haz.position.y = 1.6; bal.add(haz);
        bal.add(K.esfera(.3, 0xffd166, [0, 3.2, 0], { emissive: 0xffd166, emissiveIntensity: .8 }));
        const toque = new T.Mesh(new T.CylinderGeometry(.7, .7, 3.8, 8), new T.MeshBasicMaterial({ visible: false })); toque.position.y = 1.8; bal.add(toque);
        bal.position.set(X(0), 0, Z(0)); K.agregar(bal); this.baliza = bal; this.aro = aro;
        this.lblP = K.etiqueta('(0, 0)', [0, 3.75, 0], 'acento grande', bal);
        K.arrastrable(bal, { snap: 1, limites: { x: [X(0), X(10)], z: [Z(10), Z(0)] }, alMover: p => this.poner(K, p.x - OX, OZ - p.z, 'baliza') });

        // Planta: dos filas de equipos, edificio, cañerías y medidores
        this.elec = []; this.bio = [];
        K.agregar(K.caja(11.6, .1, 1.5, 0x8d8a86, [X(5), .05, -3.2]), K.caja(11.6, .1, 1.5, 0x8d8a86, [X(5), .05, -5.9]));
        for (let i = 0; i < 10; i++) {
          const e = electrolizador(K); e.position.set(X(.2 + i * 1.07), 0, -3.2); e.visible = false; K.agregar(e); this.elec.push(e);
          const b = biorreactor(K); b.position.set(X(.2 + i * 1.07), 0, -5.9); b.visible = false; K.agregar(b); this.bio.push(b);
        }
        K.agregar(K.caja(12.5, 3.2, 3, 0xe7e1d6, [X(5), 1.6, -9.6]), K.caja(12.7, .3, 3.2, 0xff6b3d, [X(5), 3.3, -9.6]));
        for (let i = 0; i < 5; i++) K.agregar(K.caja(1.2, .7, .05, 0x22344f, [X(1 + i * 2), 2, -8.08], { metalness: .5, roughness: .25 }));
        K.etiqueta('PLANTA DE OXÍGENO', [X(5), 4.1, -9.6], 'claro');
        K.agregar(K.barra([X(-.6), .55, -3.2], [-23.2, .55, -3.2], .09, 0xb9c0c8), K.barra([X(-.6), .55, -5.9], [-23.2, .55, -5.9], .09, 0xb9c0c8));
        this.medO2 = K.agregar(medidor(K, [-22.5, 0, -4.4], 0x7fe3ff));
        this.medE = K.agregar(medidor(K, [-22.5, 0, 1.6], 0xffd166));
        K.agregar(K.caja(1.6, 1.4, 1.4, 0x6f7a86, [-20.6, .7, 1.6]), K.caja(.5, .5, .05, 0xffd166, [-20.6, 1, 2.33], { emissive: 0xffd166, emissiveIntensity: .6 }));
        K.agregar(astronauta(K, [-24.3, 0, 4.5], -.8), astronauta(K, [-37.6, 0, -1.2], .9, 0x4fd1ff));

        K.tic((dt, t) => {
          this.bio.forEach((b, i) => { if (b.visible) b.tubo.material.emissiveIntensity = .55 + .3 * Math.sin(t * 3 + i); });
          this.aro.rotation.z = t * 1.5; this.aro.position.y = .25 + Math.sin(t * 3) * .06;
        });
        this.actualizar(K);
      },
      poner(K, x, y, origen) {
        x = Math.max(0, Math.min(10, Math.round(x))); y = Math.max(0, Math.min(10, Math.round(y)));
        this.x = x; this.y = y;
        if (origen !== 'baliza') this.baliza.position.set(this.OX + x, 0, this.OZ - y);
        if (origen !== 'slider') { this.sx.poner(x); this.sy.poner(y); }
        this.actualizar(K);
      },
      actualizar(K) {
        const { x, y } = this, o2 = 3 * x + 2 * y, en = x + 2 * y, ok1 = o2 === 18, ok2 = en === 10;
        this.elec.forEach((e, i) => mostrar(K, e, i < x));
        this.bio.forEach((b, i) => mostrar(K, b, i < y));
        this.medO2.poner(o2, 18, `O₂ ${o2} / 18 kg`);
        this.medE.poner(en, 10, `Energía ${en} / 10 kW`);
        this.r1.material.emissiveIntensity = ok1 ? 1.8 : .3;
        this.r2.material.emissiveIntensity = ok2 ? 1.8 : .3;
        this.lblP.texto(`(${x}, ${y})`);
        this.lblP.element.className = 'lbl grande ' + (ok1 && ok2 ? 'verde' : 'acento');
        limpiarGrupo(this.proy);
        const X = v => this.OX + v, Z = v => this.OZ - v;
        if (y > 0) this.proy.add(K.linea([[X(x), .24, Z(y)], [X(x), .24, Z(0)]], 0xffd166, { discontinua: true }));
        if (x > 0) this.proy.add(K.linea([[X(x), .24, Z(y)], [X(0), .24, Z(y)]], 0xffd166, { discontinua: true }));
        const est = (v, meta, u, falta, sobra) => v === meta ? `<b class="ok">${v} ${u} · justo</b>` : `<b class="${v < meta ? 'aviso' : 'mal'}">${v} ${u} · ${v < meta ? falta : sobra}</b>`;
        this.boxEstado.innerHTML = `<div class="estado"><div><span>O₂ producido</span>${est(o2, 18, 'kg', 'falta', 'sobra')}</div><div><span>Energía usada</span>${est(en, 10, 'kW', 'sobra', 'sobrecarga')}</div></div>`;
        K.refrescarMat();
      },
      comprobar(K) {
        const { x, y } = this, o2 = 3 * x + 2 * y, en = x + 2 * y, ok1 = o2 === 18, ok2 = en === 10;
        if (ok1 && ok2) return { ok: true, msg: `¡Planta en marcha! Con ${x} electrolizadores y ${y} biorreactores salen 18 kg de O₂ y se usan justo 10 kW: el punto (${x}, ${y}) está sobre las dos rectas.` };
        if (x === 0 && y === 0) return { ok: false, msg: 'La planta está vacía: arrastrá la baliza o usá los deslizadores para instalar equipos.' };
        if (ok1) return { ok: false, msg: `El oxígeno da justo (el punto está sobre la recta naranja), pero la planta usa ${en} kW y no 10. Cumplir una sola condición no alcanza: buscá un punto que también esté sobre la recta celeste.` };
        if (ok2) return { ok: false, msg: `La energía da justo (el punto está sobre la recta celeste), pero se producen ${o2} kg de O₂ y no 18. Buscá un punto que también esté sobre la recta naranja.` };
        return { ok: false, msg: `Con (${x}, ${y}) no se cumple ninguna condición: salen ${o2} kg de O₂ y se usan ${en} kW. Tu punto no está sobre ninguna de las dos rectas.` };
      },
      alResolver(K) {
        K.camara([-25, 11, 15], [-28, 1, -3]);
        const burbujas = [];
        this.bio.forEach(b => { if (b.visible) for (let k = 0; k < 4; k++) burbujas.push(K.agregar(K.esfera(.07, 0xdff9ff, [b.position.x + (k % 2 - .5) * .25, .5 + k * .32, b.position.z], { emissive: 0xbff4ff, emissiveIntensity: .9 }))); });
        K.tic(dt => { for (const e of burbujas) { e.position.y += dt * 1.1; if (e.position.y > 1.7) e.position.y = .4; } });
        K.toast('Oxígeno restablecido: 18 kg por día');
        return 1900;
      },
      pistas: [
        'Cada condición se puede escribir como una ecuación con dos incógnitas: una para el oxígeno y otra para la energía. Cada una, por separado, la cumplen muchísimos pares (x, y).',
        'En el holograma (o en el modo Matemático) cada ecuación es una recta: todos sus puntos cumplen esa condición. Buscá el punto que esté sobre las dos rectas al mismo tiempo.',
        'Llevá la baliza sobre la recta naranja (el oxígeno da justo) y recorrela hasta que también toque la celeste. Después verificá reemplazando x e y en 3x + 2y = 18 y en x + 2y = 10.',
      ],
      bitacora: [
        '¿Qué ecuación escribiste para el oxígeno y cuál para la energía? ¿Qué representan x e y?',
        '¿Por qué la solución del sistema es el punto donde se cortan las dos rectas? ¿Qué pasa con los puntos que están sobre una sola de ellas?',
        'Verificá tu solución reemplazando en las dos ecuaciones. ¿Puede haber otra combinación de equipos que cumpla las dos condiciones? ¿Por qué?',
      ],
      resumenBitacora(K) { return `Instalaste <b>${this.x} electrolizadores y ${this.y} biorreactores</b>: 3·${this.x} + 2·${this.y} = 18 kg de O₂ y ${this.x} + 2·${this.y} = 10 kW.`; },
      mat(K, el) {
        const R = [0, 10, 0, 10], { x, y } = this, o2 = 3 * x + 2 * y, en = x + 2 * y, ok1 = o2 === 18, ok2 = en === 10;
        const p = K.planoCartesiano({ xMin: 0, xMax: 10, yMin: 0, yMax: 10, ejeX: 'x', ejeY: 'y', ancho: 520, alto: 430 });
        recta(K, p, R, 3, 2, 18, '#e8662f', 'O₂: 3x + 2y = 18', { t: .06 });
        recta(K, p, R, 1, 2, 10, '#1690c9', 'Energía: x + 2y = 10', { t: .62, dy: -12 });
        punto(K, p, x, y, ok1 && ok2 ? '#0f8a4f' : (ok1 || ok2) ? '#d99a00' : '#1b2333', `P(${x}, ${y})`);
        marcoPlano(K, el, p);
        el.append(K.h('div', { class: 'vm-tabla', html: `<span class="k">O₂</span><span>3·${x} + 2·${y} = ${o2}</span>${marca(ok1, ok1 ? '= 18' : '≠ 18')}<span class="k">Energía</span><span>${x} + 2·${y} = ${en}</span>${marca(ok2, ok2 ? '= 10' : '≠ 10')}` }));
        el.append(K.h('div', { class: 'nota', html: 'x = electrolizadores, y = biorreactores. Cada punto de una recta es una combinación que cumple <b>esa</b> condición; la solución del sistema tiene que estar en <b>las dos rectas a la vez</b>.' }));
      },
      prueba: {
        mal: [function (K) { this.poner(K, 6, 0); }, function (K) { this.poner(K, 2, 4); }, function (K) { this.poner(K, 3, 3); }],
        bien(K) { this.poner(K, 4, 3); },
      },
    },

    /* ═════════════════ NIVEL 2 · sumas y restas ═════════════════ */
    {
      titulo: 'Restablecer la energía',
      relato: 'El polvo borró las etiquetas de los paneles solares y el controlador perdió los datos. Sólo andan los medidores: el arreglo <b>Norte</b> (3 grandes y 2 chicos) da <b>26 kW</b> y el <b>Sur</b> (2 grandes y 5 chicos) da <b>32 kW</b>.',
      objetivo: '',
      objetivos: ['', 'Con <b>x</b> = kW de un panel grande e <b>y</b> = kW de uno chico, usá <b>sumas y restas</b>: multiplicá las ecuaciones para que una incógnita se cancele, despejá y reemplazá.',
        'Ya sabés cuánto rinde cada panel. <b>Tocá los paneles en la escena</b> para conectarlos al inversor del soporte vital: necesita <b>exactamente 40 kW</b>.'],
      tituloMat: 'Método de sumas y restas',
      subMat: 'Multiplicá, sumá o restá: una incógnita se cancela',
      armar(K) {
        Object.assign(this, { fase: 1, m1: 1, m2: 1, op: 'sumar' });
        encuadre(K, [34, 15, 33.5], [34, 3.6, 1.5], { min: 8, max: 80 });
        BASE.luz.intensity = 1;
        this.filas = [crearFila(K, ['A', 'A', 'A', 'B', 'B'], 24.5, 4, 'Norte'), crearFila(K, ['A', 'A', 'B', 'B', 'B', 'B', 'B'], 40.5, 4, 'Sur')];
        for (const [f, kw] of [[this.filas[0], 26], [this.filas[1], 32]]) {
          const mx = f.cx - f.total / 2 - .7;
          K.agregar(K.cilindro(.08, .08, 1.6, 0x9aa3ad, [mx, .8, 5.4], 6), K.caja(.7, .55, .25, 0xe2ddd3, [mx, 1.75, 5.4]), K.caja(.5, .3, .03, 0x0f1b2d, [mx, 1.78, 5.54], { emissive: 0x0b3a2a }));
          K.etiqueta(`Arreglo ${f.nombre} · <b>${kw} kW</b>`, [f.cx, .2, 6.9], 'claro');
        }
        // Inversor y baterías (detrás, entre los arreglos)
        K.agregar(K.caja(2.2, 2.4, 1.3, 0xe2ddd3, [32, 1.2, -2.6]), K.caja(1.4, .9, .05, 0x0f1b2d, [32, 1.6, -1.93], { emissive: 0x0b2a3a }));
        this.lblInv = K.etiqueta('Inversor del soporte vital', [32, 3.2, -2.6], 'holo');
        this.cargaBat = [];
        for (let i = 0; i < 4; i++) {
          const bx = 35.2 + i * 1.15;
          K.agregar(K.caja(.95, 1.7, .95, 0x6f7a86, [bx, .85, -2.6]));
          const nivel = K.agregar(K.caja(.6, 1.3, .03, 0xff5d6c, [bx, .2, -2.11], { emissive: 0xff5d6c, emissiveIntensity: .6 }));
          nivel.geometry.translate(0, .65, 0); nivel.scale.y = .15; this.cargaBat.push(nivel);
        }
        K.agregar(astronauta(K, [30.4, 0, 7.5], .5), astronauta(K, [47.6, 0, 1.5], -.9, 0x4fd1ff));
        // Cables y clic en cada panel
        for (const f of this.filas) for (const p of f.paneles) {
          p.cable = K.agregar(K.barra([p.position.x, .07, 3.2], [32 + (p.position.x - 32) * .06, .07, -1.9], .045, 0x3a3532));
          p.conectado = false;
          p.lblKw = K.etiqueta(p.tipo === 'A' ? '6 kW' : '4 kW', [0, 2.3, 0], 'mini', p); p.lblKw.visible = false;
          K.clicable(p, () => this.alternar(K, p));
        }
        this.holo = K.agregar(new T.Group());
        this.lblM = this.filas.map(f => K.etiqueta('', [f.cx, 3, f.z], 'holo'));
        this.lblRes = K.etiqueta('', [32, 8, 4], 'holo grande');
        K.tic((dt, t) => { for (const f of this.filas) for (const p of f.paneles) if (p.conectado) p.cable.material.emissiveIntensity = .6 + .4 * Math.sin(t * 5 + p.position.x); });
        this.irFase(K, 1);
      },
      irFase(K, n) {
        this.fase = n;
        for (const f of this.filas) for (const p of f.paneles) {
          p.cel.material.color.set(n === 2 ? 0xffffff : 0xc7865e);
          p.lblKw.visible = n === 2; p.conectado = false; this.pintar(p);
        }
        K.$('#pnObjetivoTxt').innerHTML = this.objetivos[n];
        const c = K.controles(); c.innerHTML = '';
        this.lblInv.visible = n === 2;
        if (n === 1) {
          const fm = v => '× ' + (v < 0 ? `(−${-v})` : v);
          const caja = K.h('div', { class: 'ecu' }, K.h('span', { class: 'tag' }, 'Multiplicá cada ecuación'));
          this.st1 = stepper(K, '<span class="num">Norte: 3x + 2y = 26</span>', { valor: this.m1, min: -6, max: 6, saltarCero: true, fmt: fm, donde: caja, alCambiar: v => { this.m1 = v; this.actualizar(K); } });
          this.lin1 = K.h('div', { class: 'sub' }); caja.append(this.lin1);
          this.st2 = stepper(K, '<span class="num">Sur:&nbsp;&nbsp; 2x + 5y = 32</span>', { valor: this.m2, min: -6, max: 6, saltarCero: true, fmt: fm, donde: caja, alCambiar: v => { this.m2 = v; this.actualizar(K); } });
          this.lin2 = K.h('div', { class: 'sub' }); caja.append(this.lin2);
          K.controles().append(caja);
          this.gOp = K.opciones('Después', [['sumar', 'Sumar las ecuaciones'], ['restar', 'Restar (Norte − Sur)']], { elegida: this.op, alElegir: v => { this.op = v; this.actualizar(K); } });
          this.boxRes = K.html('');
          [this.inX, this.inY] = parXY(K, 'Despejá y reemplazá: ¿cuántos kW rinde cada panel?', () => K.refrescarMat());
        } else {
          K.html('<div class="ecu"><span class="tag">Potencias que encontraste</span><div>Panel grande: x = 6 kW</div><div>Panel chico:&nbsp; y = 4 kW</div></div>');
          K.datos([['Disponibles', '5 grandes · 7 chicos'], ['Inversor', 'exactamente 40 kW']]);
          this.boxInv = K.html('');
          K.html('<p class="nota-p">Tocá un panel en la escena para conectarlo o desconectarlo (el cable se enciende).</p>');
        }
        this.actualizar(K);
      },
      setMult(K, m1, m2, op) {
        Object.assign(this, { m1, m2, op });
        if (this.fase === 1) { this.st1.poner(m1); this.st2.poner(m2); elegir(this.gOp, op, ['sumar', 'restar']); }
        this.actualizar(K);
      },
      comb() {
        const s = this.op === 'restar' ? -1 : 1, { m1, m2 } = this;
        const a = [3 * m1, 2 * m1, 26 * m1], b = [2 * m2, 5 * m2, 32 * m2];
        const r = [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
        const elim = r[0] === 0 && r[1] !== 0 ? 'x' : r[1] === 0 && r[0] !== 0 ? 'y' : null;
        return { a, b, r, s, elim };
      },
      contar() { let a = 0, b = 0; for (const f of this.filas) for (const p of f.paneles) if (p.conectado) p.tipo === 'A' ? a++ : b++; return { a, b, P: 6 * a + 4 * b }; },
      pintar(p) {
        p.cable.material.color.set(p.conectado ? 0xffb347 : 0x3a3532);
        p.cable.material.emissive.set(p.conectado ? 0xff8a3d : 0x000000);
        p.cel.material.emissive.set(p.conectado ? 0x1b3f8f : 0x000000);
        p.lblKw.element.className = 'lbl mini' + (p.conectado ? ' verde' : '');
      },
      alternar(K, p) {
        if (this.fase !== 2) { K.toast('Primero averiguá cuántos kW rinde cada panel'); return; }
        p.conectado = !p.conectado; this.pintar(p); this.actualizar(K);
      },
      conectar(K, a, b) {
        let na = 0, nb = 0;
        for (const f of this.filas) for (const p of f.paneles) { p.conectado = p.tipo === 'A' ? na++ < a : nb++ < b; this.pintar(p); }
        this.actualizar(K);
      },
      actualizar(K) {
        limpiarGrupo(this.holo);
        if (this.fase === 1) {
          const { a, b, r, s, elim } = this.comb(), fm = v => v < 0 ? `(−${-v})` : v;
          this.lin1.textContent = `→ ${ecu(...a)}`; this.lin2.textContent = `→ ${ecu(...b)}`;
          this.boxRes.innerHTML = `<div class="ecu"><span class="tag">${s > 0 ? 'Suma' : 'Resta (Norte − Sur)'}</span><div class="res">${ecu(...r, { ceros: true })}</div>${elim ? `<div class="ok">✓ Se canceló ${elim}. Ahora despejá ${elim === 'x' ? 'y' : 'x'}.</div>` : '<div class="aviso">Todavía no se cancela ninguna incógnita.</div>'}</div>`;
          // Hologramas: cada arreglo repetido tantas veces como su multiplicador
          let alto = 0;
          [[this.filas[0], this.m1, 1], [this.filas[1], this.m2, s]].forEach(([f, m, sg], idx) => {
            const neg = m * sg < 0, col = neg ? 0xff5d9e : 0x5fd3ff;
            for (let k = 1; k <= Math.abs(m); k++) for (const p of f.paneles) {
              const cancel = (elim === 'x' && p.tipo === 'A') || (elim === 'y' && p.tipo === 'B');
              const mesh = new T.Mesh(new T.BoxGeometry(p.ancho, .04, p.prof), new T.MeshBasicMaterial({ color: cancel ? 0xb9c0c8 : col, transparent: true, opacity: cancel ? .08 : .3, depthWrite: false }));
              mesh.position.set(p.position.x, 1.3 + k * 1.3, f.z); mesh.rotation.x = .5;
              mesh.add(new T.LineSegments(new T.EdgesGeometry(mesh.geometry), new T.LineBasicMaterial({ color: cancel ? 0x9aa3ad : col, transparent: true, opacity: cancel ? .35 : .95 })));
              this.holo.add(mesh);
            }
            const l = this.lblM[idx]; l.visible = true;
            l.position.set(f.cx, 2.3 + Math.abs(m) * 1.3, f.z);
            l.texto(`${f.nombre} × ${fm(m)}${idx === 1 && s < 0 ? ' · se resta' : ''}`);
            l.element.className = 'lbl ' + (neg ? 'magenta' : 'holo');
            alto = Math.max(alto, Math.abs(m));
          });
          this.lblRes.visible = true;
          this.lblRes.position.set(32.2, 4.4 + alto * 1.3, 4);
          this.lblRes.texto(ecu(...r, { ceros: true }));
          this.lblRes.element.className = 'lbl grande ' + (elim ? 'verde' : 'holo');
        } else {
          this.lblM.forEach(l => { l.visible = false; }); this.lblRes.visible = false;
          const { a, b, P } = this.contar();
          this.boxInv.innerHTML = `<div class="estado"><div><span>Conectados</span><b>${a} grandes · ${b} chicos</b></div><div><span>Potencia al inversor</span><b class="${P === 40 ? 'ok' : P > 40 ? 'mal' : 'aviso'}">${P} / 40 kW</b></div></div>`;
          this.lblInv.texto(`Inversor · ${P} / 40 kW`);
          this.lblInv.element.className = 'lbl ' + (P === 40 ? 'verde' : P > 40 ? 'rojo' : 'holo');
        }
        K.refrescarMat();
      },
      comprobar(K) {
        if (this.fase === 1) {
          const { r, elim } = this.comb();
          if (!elim) return { parcial: true, ok: false, msg: 'Todavía no se cancela ninguna incógnita. Elegí multiplicadores para que los coeficientes de x (o los de y) queden iguales y restá, u opuestos y sumá.' };
          const x = leerNum(this.inX.value), y = leerNum(this.inY.value);
          if (isNaN(x) || isNaN(y)) return { parcial: true, ok: false, msg: 'Escribí los dos valores: x (kW de un panel grande) e y (kW de uno chico).' };
          const queda = elim === 'x' ? 'y' : 'x', coef = elim === 'x' ? r[1] : r[0], val = elim === 'x' ? y : x;
          if (!cerca(coef * val, r[2])) return { parcial: true, ok: false, msg: `Revisá el despeje: la ecuación que te quedó es ${ecu(...r)}, y tu ${queda} = ${fmtN(val)} no la cumple (${fmtN(coef)}·${fmtN(val)} = ${fmtN(coef * val)}).` };
          const n = 3 * x + 2 * y, su = 2 * x + 5 * y, ok1 = cerca(n, 26), ok2 = cerca(su, 32);
          if (ok1 && ok2) { this.irFase(K, 2); return { parcial: true, ok: true, msg: `¡Bien! Un panel grande rinde ${fmtN(x)} kW y uno chico ${fmtN(y)} kW: se cumplen las mediciones de los dos arreglos. Ahora conectá el soporte vital.` }; }
          if (ok1) return { parcial: true, ok: false, msg: `Tus valores cumplen la ecuación del Norte, pero no la del Sur: 2·${fmtN(x)} + 5·${fmtN(y)} = ${fmtN(su)} kW, no 32. Revisá el reemplazo.` };
          if (ok2) return { parcial: true, ok: false, msg: `Tus valores cumplen la ecuación del Sur, pero no la del Norte: 3·${fmtN(x)} + 2·${fmtN(y)} = ${fmtN(n)} kW, no 26. Revisá el reemplazo.` };
          return { parcial: true, ok: false, msg: `Con esos valores el arreglo Norte daría ${fmtN(n)} kW (no 26) y el Sur ${fmtN(su)} kW (no 32). Reemplazá el ${queda} que encontraste en una de las ecuaciones originales, despejá la otra incógnita y verificá en las dos.` };
        }
        const { a, b, P } = this.contar();
        if (P === 40) return { ok: true, msg: `¡Soporte vital con energía! Conectaste ${a} paneles grandes y ${b} chicos: 6·${a} + 4·${b} = 40 kW.` };
        if (a + b === 0) return { ok: false, msg: 'No conectaste ningún panel: tocalos en la escena.' };
        return { ok: false, msg: `Conectaste ${a} grandes y ${b} chicos: 6·${a} + 4·${b} = ${P} kW. ${P < 40 ? 'Falta' : 'Sobra'} potencia: el inversor necesita exactamente 40 kW.` };
      },
      alResolver(K) {
        this.cargaBat.forEach((n, i) => animar(K, 1.4 + i * .2, u => { n.scale.y = .15 + .85 * suave(u); if (u > .6) { n.material.color.set(0x3ddc97); n.material.emissive.set(0x3ddc97); } }));
        animar(K, 1.5, u => { BASE.luz.intensity = 1 + 40 * u; });
        K.camara([33, 14, 22], [33, 2, -2]);
        K.toast('Energía restablecida');
        return 1900;
      },
      pistas: [
        'Para eliminar una incógnita, sus coeficientes tienen que quedar iguales (y entonces restás) u opuestos (y entonces sumás). Elegí primero cuál te conviene eliminar.',
        'Para que x tenga el mismo coeficiente en las dos ecuaciones, podés multiplicar cada una por el coeficiente de x de la otra (en la Norte hay 3x y en la Sur 2x).',
        'Con la ecuación que te queda, despejá la incógnita que sobrevivió. Después reemplazá ese valor en la ecuación Norte o en la Sur, despejá la otra y verificá en las dos.',
      ],
      bitacora: [
        'Describí paso a paso cómo eliminaste una incógnita: ¿por qué número multiplicaste cada ecuación y por qué sumaste o restaste?',
        '¿Por qué al multiplicar los dos miembros de una ecuación por un número no cambian sus soluciones? ¿Por qué se pueden sumar o restar dos ecuaciones miembro a miembro?',
        '¿Cómo comprobaste que las potencias que encontraste cumplen las mediciones de los dos arreglos? ¿Qué otras combinaciones de paneles darían 40 kW?',
      ],
      resumenBitacora(K) { const { a, b } = this.contar(); return `Encontraste que un panel grande rinde <b>6 kW</b> y uno chico <b>4 kW</b> (3·6 + 2·4 = 26 y 2·6 + 5·4 = 32). Conectaste ${a} grandes y ${b} chicos: 6·${a} + 4·${b} = 40 kW.`; },
      mat(K, el) {
        const R = [0, 14, 0, 14];
        const p = K.planoCartesiano({ xMin: 0, xMax: 14, yMin: 0, yMax: 14, ejeX: 'x', ejeY: 'y', ancho: 520, alto: 400 });
        recta(K, p, R, 3, 2, 26, '#e8662f', 'Norte: 3x + 2y = 26', { t: .06 });
        recta(K, p, R, 2, 5, 32, '#1690c9', 'Sur: 2x + 5y = 32', { t: .7, dy: -12 });
        if (this.fase === 1) {
          const { a, b, r, s, elim } = this.comb(), fm = v => v < 0 ? `(−${-v})` : v;
          if (r[0] !== 0 || r[1] !== 0) recta(K, p, R, r[0], r[1], r[2], elim ? '#0f8a4f' : '#8b5cf6', elim ? ecu(...r) : 'combinación', { discontinua: true, grosor: 2.4, t: elim === 'x' ? .75 : .9, dy: -8 });
          marcoPlano(K, el, p);
          el.append(K.h('div', { class: 'vm-tabla', html: `<span class="k">Norte</span><span>3x + 2y = 26</span><span>× ${fm(this.m1)} → ${ecu(...a)}</span><span class="k">Sur</span><span>2x + 5y = 32</span><span>× ${fm(this.m2)} → ${ecu(...b)}</span><span class="k">${s > 0 ? 'Suma' : 'Resta'}</span><span></span><span class="vm-res">${ecu(...r, { ceros: true })}</span>` }));
          el.append(K.h('div', { class: 'nota', html: elim ? `Se canceló ${elim}: la ecuación que queda tiene una sola incógnita. Fijate que su recta (punteada) pasa por el mismo punto donde se cortan las dos originales.` : 'Cualquier combinación de las dos ecuaciones (recta punteada) pasa por el punto donde se cortan. Buscá la combinación en la que una incógnita desaparece.' }));
        } else {
          punto(K, p, 6, 4, '#0f8a4f', '(6, 4)');
          marcoPlano(K, el, p);
          const { a, b, P } = this.contar();
          el.append(K.h('div', { class: 'vm-tabla', html: `<span class="k">Solución</span><span>x = 6 kW</span><span>y = 4 kW</span><span class="k">Inversor</span><span>6a + 4b = 40</span>${marca(P === 40, `6·${a} + 4·${b} = ${P}`)}` }));
          el.append(K.h('div', { class: 'nota', html: 'a = paneles grandes conectados, b = paneles chicos conectados. Con la solución del sistema podés calcular cuánta potencia entrega cualquier combinación.' }));
        }
      },
      prueba: {
        mal: [
          function (K) { this.irFase(K, 1); this.setMult(K, 1, 1, 'sumar'); this.inX.value = '6'; this.inY.value = '4'; },
          function (K) { this.irFase(K, 1); this.setMult(K, 2, 3, 'restar'); this.inX.value = '5'; this.inY.value = '4'; },
          function (K) { this.irFase(K, 1); this.setMult(K, 2, 3, 'sumar'); this.inX.value = '6'; this.inY.value = '4'; },
          function (K) { this.irFase(K, 2); this.conectar(K, 5, 2); },
        ],
        bien(K) { this.irFase(K, 1); this.setMult(K, 2, 3, 'restar'); this.inX.value = '6'; this.inY.value = '4'; },
        pasos: 2,
        entrePasos(K) { this.conectar(K, 4, 4); },
      },
    },

    /* ═════════════════ NIVEL 3 · planteo ═════════════════ */
    {
      titulo: 'Preparar raciones',
      relato: 'Dos geólogas salen en el rover hacia el cráter Galle a buscar hielo. Los <b>16 compartimentos</b> de la bodega tienen que ir todos ocupados (si no, la carga se mueve) y la nutricionista calculó <b>34.000 kcal</b> para el viaje.',
      objetivo: '',
      objetivos: ['', 'Primero <b>planteá el sistema</b>: con <b>x = packs rojos</b> e <b>y = packs verdes</b>, completá los números de las dos ecuaciones. Sin un plan aprobado no se carga nada.',
        'Plan aprobado. <b>Resolvé el sistema</b> y cargá el rover: tocá las pilas de packs para subirlos (o usá los botones) y tocá un pack del rover para bajarlo.'],
      tituloMat: 'Del enunciado al sistema',
      subMat: 'Cada ecuación que planteás es una recta',
      armar(K) {
        Object.assign(this, { fase: 1, carga: [], sis: null });
        encuadre(K, [-19, 7, -8], [-29, 2, -23.5], { min: 6, max: 50 });
        BASE.luz.intensity = 40;
        // Depósito
        K.agregar(K.caja(7, 3.6, 4, 0xe2ddd3, [-31, 1.8, -30.5]), K.caja(7.2, .3, 4.2, 0xff6b3d, [-31, 3.75, -30.5]), K.caja(2.2, 2.6, .1, 0x2a3c5c, [-31, 1.3, -28.45]));
        K.etiqueta('DEPÓSITO DE RACIONES', [-31, 4.5, -28.6], 'claro');
        this.pilaR = K.agregar(pilaPacks(K, ROJO, [-34.6, 0, -25.2]));
        this.pilaV = K.agregar(pilaPacks(K, VERDE, [-34.6, 0, -21.2]));
        K.etiqueta('Pack rojo · 2.500 kcal · 3 kg', [-34.6, 1.9, -25.2], 'rojo');
        K.etiqueta('Pack verde · 1.500 kcal · 2 kg', [-34.6, 1.9, -21.2], 'verde');
        K.clicable(this.pilaR, () => this.cargar(K, 'R'));
        K.clicable(this.pilaV, () => this.cargar(K, 'V'));
        // Rover con 16 compartimentos
        this.rover = K.agregar(rover(K)); this.rover.position.set(-27, 0, -22.6);
        for (const s of SLOTS) this.rover.add(K.caja(.46, .02, .46, 0x77736e, [s[0], 1.35, s[2]]));
        this.bodega = new T.Group(); this.rover.add(this.bodega);
        K.clicable(this.bodega, hit => { const i = hit.object.userData.i; if (i != null) this.descargar(K, i); });
        this.lblRover = K.etiqueta('', [-.6, 2.6, 0], 'holo', this.rover);
        K.agregar(astronauta(K, [-30.8, 0, -20.6], .9), astronauta(K, [-23.6, 0, -20.4], -.7, 0x4fd1ff));
        K.agregar(K.roca([-22, .1, -27], 1.2, 0x7c3a22), K.roca([-36.5, .1, -17.5], .9, 0x934a2b));
        this.irFase(K, 1);
      },
      irFase(K, n) {
        this.fase = n; this.carga = [];
        K.$('#pnObjetivoTxt').innerHTML = this.objetivos[n];
        K.controles().innerHTML = '';
        K.datos([['Pack rojo', '2.500 kcal · 3 kg'], ['Pack verde', '1.500 kcal · 2 kg'], ['Bodega', '16 compartimentos'], ['Plan del viaje', '34.000 kcal']]);
        if (n === 1) {
          this.ec1 = filaEcu(K, 'Ecuación 1', () => K.refrescarMat());
          this.ec2 = filaEcu(K, 'Ecuación 2', () => K.refrescarMat());
          K.html('<p class="nota-p">Si una incógnita no aparece en una ecuación, poné 0 como coeficiente.</p>');
        } else {
          K.html(`<div class="ecu"><span class="tag">Sistema aprobado</span><div>${ecu(...this.sis[0])}</div><div>${ecu(...this.sis[1])}</div></div>`);
          this.stR = stepper(K, 'Packs rojos (x)', { min: 0, max: 16, alCambiar: v => this.ajustar(K, 'R', v) });
          this.stV = stepper(K, 'Packs verdes (y)', { min: 0, max: 16, alCambiar: v => this.ajustar(K, 'V', v) });
          this.boxEstado = K.html('');
        }
        K.$('#btnComprobar').textContent = n === 1 ? 'Presentar el plan' : 'Comprobar la carga';
        this.dibujarBodega(K, false); this.actualizar(K);
      },
      cuenta() { const r = this.carga.filter(t => t === 'R').length; return { r, v: this.carga.length - r }; },
      cargar(K, tipo) {
        if (this.fase !== 2) { K.toast('Primero planteá el sistema: sin plan no se carga nada'); return; }
        if (this.carga.length >= 16) { K.toast('Los 16 compartimentos ya están ocupados'); this.actualizar(K); return; }
        this.carga.push(tipo); this.dibujarBodega(K, true); this.actualizar(K);
      },
      descargar(K, i) { if (this.fase !== 2 || i >= this.carga.length) return; this.carga.splice(i, 1); this.dibujarBodega(K, false); this.actualizar(K); },
      ajustar(K, tipo, v) {
        const n = this.carga.filter(t => t === tipo).length;
        if (v > n) this.cargar(K, tipo);
        else if (v < n) this.descargar(K, this.carga.lastIndexOf(tipo));
        else this.actualizar(K);
      },
      setCarga(K, r, v) { this.carga = [...Array(r).fill('R'), ...Array(v).fill('V')]; this.dibujarBodega(K, false); this.actualizar(K); },
      dibujarBodega(K, anim) {
        limpiarGrupo(this.bodega);
        this.rover.updateMatrixWorld(true);
        this.carga.forEach((tipo, i) => {
          const m = pack(K, tipo === 'R' ? ROJO : VERDE, SLOTS[i]); m.traverse(o => { o.userData.i = i; });
          this.bodega.add(m);
          if (anim && i === this.carga.length - 1) {
            const pila = tipo === 'R' ? this.pilaR : this.pilaV;
            const ini = this.rover.worldToLocal(pila.position.clone().add(new T.Vector3(0, 1.5, 0))), fin = m.position.clone();
            m.position.copy(ini);
            animar(K, .45, u => { m.position.lerpVectors(ini, fin, suave(u)); m.position.y += Math.sin(u * Math.PI) * 1.4; });
          }
        });
      },
      actualizar(K) {
        const { r, v } = this.cuenta(), n = r + v;
        this.lblRover.texto(this.fase === 1 ? 'Bodega: esperando el plan' : `Bodega ${n} / 16`);
        this.lblRover.element.className = 'lbl ' + (n === 16 ? 'verde' : 'holo');
        if (this.fase === 2) {
          this.stR.poner(r); this.stV.poner(v);
          this.boxEstado.innerHTML = `<div class="estado"><div><span>Compartimentos ocupados</span><b class="${n === 16 ? 'ok' : 'aviso'}">${n} / 16</b></div></div>`;
        }
        K.refrescarMat();
      },
      leerSis() { return [this.ec1, this.ec2].map(f => f.map(i => leerNum(i.value))); },
      comprobar(K) {
        if (this.fase === 1) {
          const [e1, e2] = this.leerSis();
          if ([...e1, ...e2].some(isNaN)) return { parcial: true, ok: false, msg: 'Completá los tres números de cada ecuación (si una incógnita no aparece, poné 0).' };
          const C = [1, 1, 16], E = [2500, 1500, 34000];
          const c1 = proporcional(e1, C), c2 = proporcional(e2, C), k1 = proporcional(e1, E), k2 = proporcional(e2, E);
          if ((c1 && k2) || (k1 && c2)) { this.sis = [e1, e2]; this.irFase(K, 2); return { parcial: true, ok: true, msg: '¡Plan aprobado! Tu sistema modeliza las dos condiciones. Ahora resolvelo y cargá el rover.' }; }
          if ((c1 && c2) || (k1 && k2)) return { parcial: true, ok: false, msg: 'Escribiste dos veces la misma condición (una ecuación es múltiplo de la otra). El problema tiene dos condiciones distintas: una sobre la cantidad de packs y otra sobre las kilocalorías.' };
          const diag = e => {
            if (razon(e, 1, 1)) return proporcional(e, [1, 1, 34000]) ? 'x + y cuenta packs, así que no puede dar 34.000: eso son kilocalorías.' : 'el primer miembro cuenta packs: revisá qué total le corresponde.';
            if (razon(e, 2500, 1500)) return proporcional(e, [2500, 1500, 16]) ? '2.500x + 1.500y son kilocalorías: no pueden dar 16, que es la cantidad de packs.' : 'el primer miembro suma kilocalorías: revisá qué total le corresponde.';
            if (razon(e, 1500, 2500)) return 'invertiste los coeficientes: x son los packs rojos, ¿cuántas kcal aporta cada uno?';
            if (razon(e, 3, 2)) return 'usaste el peso de los packs (3 kg y 2 kg), pero el problema no pone ninguna condición sobre el peso total: ese dato no hace falta.';
            return 'no representa ninguna condición del problema. Preguntate qué cuenta el primer miembro y qué total le corresponde.';
          };
          const ok1 = c1 || k1, ok2 = c2 || k2;
          if (ok1) return { parcial: true, ok: false, msg: `La ecuación 1 está bien planteada. En la ecuación 2: ${diag(e2)}` };
          if (ok2) return { parcial: true, ok: false, msg: `La ecuación 2 está bien planteada. En la ecuación 1: ${diag(e1)}` };
          return { parcial: true, ok: false, msg: `Ecuación 1: ${diag(e1)} Ecuación 2: ${diag(e2)}` };
        }
        const { r, v } = this.cuenta(), n = r + v, kcal = 2500 * r + 1500 * v, okN = n === 16, okK = kcal === 34000;
        if (n === 0) return { ok: false, msg: 'El rover está vacío: cargá los packs que da la solución del sistema.' };
        if (okN && okK) return { ok: true, msg: `¡Rover listo! ${r} packs rojos y ${v} verdes: ${r} + ${v} = 16 compartimentos y 2.500·${r} + 1.500·${v} = 34.000 kcal.` };
        if (okK) return { ok: false, msg: `Las kilocalorías dan justo, pero ocupaste ${n} compartimentos y no 16: la carga se movería. La solución tiene que cumplir las dos ecuaciones a la vez.` };
        if (okN) return { ok: false, msg: `Ocupaste los 16 compartimentos (primera condición ✓), pero ${kcal < 34000 ? 'no llegás a' : 'te pasás de'} las 34.000 kcal (segunda condición ✗). Resolvé el sistema en lugar de probar.` };
        return { ok: false, msg: `Con ${r} rojos y ${v} verdes no se cumple ninguna condición: hay ${n} packs y ${kcal < 34000 ? 'faltan' : 'sobran'} kilocalorías.` };
      },
      alResolver(K) {
        const rv = this.rover, x0 = rv.position.x;
        K.camara([-18, 8, -9], [-22, 1, -22]);
        K.toast('¡Buen viaje al cráter Galle!');
        animar(K, 2.6, u => { const e = suave(u); rv.position.x = x0 + e * 16; rv.ruedas.forEach(w => { w.rotation.y = -e * 30; }); });
        return 2300;
      },
      pistas: [
        'Separá la información: ¿qué dato habla de la cantidad de packs y cuál de la energía? ¿Hay algún dato que no necesitás para las condiciones?',
        'Una ecuación cuenta packs: cada pack ocupa un compartimento. La otra suma kilocalorías: cada pack rojo aporta 2.500 y cada verde 1.500.',
        'Para resolver, despejá y de la ecuación de los compartimentos (y = 16 − x) y reemplazala en la de las kilocalorías: te queda una ecuación con una sola incógnita.',
      ],
      bitacora: [
        '¿Cómo pasaste del enunciado al sistema? ¿Qué representa cada ecuación? ¿Qué dato no usaste y por qué?',
        '¿Qué método usaste para resolver el sistema? Escribí los pasos.',
        'Verificá tu carga en las dos ecuaciones. ¿Por qué no alcanza con que las kilocalorías den justo?',
      ],
      resumenBitacora(K) { const { r, v } = this.cuenta(); return `Planteaste <b>${ecu(...this.sis[0])}</b> y <b>${ecu(...this.sis[1])}</b>. Cargaste ${r} packs rojos y ${v} verdes: ${r} + ${v} = 16 y 2.500·${r} + 1.500·${v} = 34.000 kcal.`; },
      mat(K, el) {
        const R = [0, 18, 0, 24];
        const p = K.planoCartesiano({ xMin: 0, xMax: 18, yMin: 0, yMax: 24, pasoEtiqueta: 2, ejeX: 'x', ejeY: 'y', ancho: 480, alto: 440 });
        const eqs = this.fase === 1 ? this.leerSis() : this.sis, cols = ['#e8662f', '#1690c9'];
        const valida = e => e && !e.some(isNaN) && (e[0] !== 0 || e[1] !== 0);
        eqs.forEach((e, i) => { if (valida(e)) recta(K, p, R, ...e, cols[i], `Ec. ${i + 1}: ${ecu(...e)}`, { t: i ? .55 : .06, dy: i ? -12 : -9 }); });
        const { r, v } = this.cuenta();
        if (this.fase === 2) {
          const ok = eqs.map(e => cerca(e[0] * r + e[1] * v, e[2]));
          punto(K, p, r, v, ok[0] && ok[1] ? '#0f8a4f' : (ok[0] || ok[1]) ? '#d99a00' : '#1b2333', `(${r}, ${v})`);
          marcoPlano(K, el, p);
          el.append(K.h('div', { class: 'vm-tabla', html: eqs.map((e, i) => `<span class="k">Ec. ${i + 1}</span><span>${fmtN(e[0])}·${r} + ${fmtN(e[1])}·${v} = ${fmtN(e[0] * r + e[1] * v)}</span>${marca(ok[i], (ok[i] ? '= ' : '≠ ') + fmtN(e[2]))}`).join('') }));
          el.append(K.h('div', { class: 'nota', html: 'El punto es la carga del rover (x = packs rojos, y = packs verdes). Tiene que cumplir las dos ecuaciones: estar sobre las dos rectas.' }));
        } else {
          marcoPlano(K, el, p);
          el.append(K.h('div', { class: 'vm-tabla', html: eqs.map((e, i) => `<span class="k">Ec. ${i + 1}</span><span>${valida(e) ? ecu(...e) : '…'}</span><span></span>`).join('') }));
          el.append(K.h('div', { class: 'nota', html: 'Cada ecuación que escribís aparece como una recta. Si el planteo es correcto, la carga que buscás es el punto donde se cortan.' }));
        }
      },
      prueba: {
        mal: [
          function (K) { this.irFase(K, 1); ['1', '1', '34000'].forEach((v, i) => { this.ec1[i].value = v; }); ['2500', '1500', '16'].forEach((v, i) => { this.ec2[i].value = v; }); },
          function (K) { this.irFase(K, 1); ['1', '1', '16'].forEach((v, i) => { this.ec1[i].value = v; }); ['1500', '2500', '34.000'].forEach((v, i) => { this.ec2[i].value = v; }); },
          function (K) { this.sis = [[1, 1, 16], [2500, 1500, 34000]]; this.irFase(K, 2); this.setCarga(K, 13, 1); },
          function (K) { this.sis = [[1, 1, 16], [2500, 1500, 34000]]; this.irFase(K, 2); this.setCarga(K, 8, 8); },
        ],
        bien(K) { this.irFase(K, 1); ['1', '1', '16'].forEach((v, i) => { this.ec1[i].value = v; }); ['2.500', '1500', '34 000'].forEach((v, i) => { this.ec2[i].value = v; }); },
        pasos: 2,
        entrePasos(K) { this.setCarga(K, 10, 6); },
      },
    },

    /* ═════════════════ NIVEL 4 · integrador ═════════════════ */
    {
      titulo: 'Organizar el envío de suministros',
      relato: 'El cohete lleva suministros a la estación de Fobos. Para despegar estable tiene que salir con la <b>bodega llena (30 m³)</b> y con la <b>masa de diseño (1.200 kg)</b>. Logística propuso tres combinaciones de cajas: analizá cada una.',
      objetivo: '',
      objetivos: ['',
        'Resolvé el sistema de la <b>propuesta 1</b>, escribí su solución y decidí si sirve. Podés probar cargas tocando las pilas de cajas (y una caja de la plataforma para sacarla).',
        '<b>Propuesta 2:</b> eliminá x con sumas y restas y decidí qué pasa con este sistema.',
        '<b>Propuesta 3:</b> planteá el sistema, resolvelo y cargá la plataforma con la solución.'],
      tituloMat: 'Interpretar la solución',
      subMat: 'Masa y volumen: dos rectas por propuesta',
      armar(K) {
        Object.assign(this, { fase: 1, cx: 0, cy: 0 });
        encuadre(K, [24.5, 15.5, 5], [26.5, 3.4, -26.5], { min: 8, max: 80 });
        BASE.luz.intensity = 40;
        K.agregar(K.caja(7.6, .3, 4.6, 0x6f6a66, [24, .15, -24]));
        for (const z of [-21.65, -26.35]) K.agregar(K.caja(7.8, .06, .25, 0xf2b134, [24, .32, z]));
        this.grupoCarga = K.agregar(new T.Group());
        K.clicable(this.grupoCarga, hit => { let o = hit.object; while (o && !o.userData.cual) o = o.parent; if (o) this.fijar(K, o.userData.cual, (o.userData.cual === 'a' ? this.cx : this.cy) - 1); });
        this.medMasa = K.agregar(medidor(K, [32.6, 0, -21.6], 0xff8a3d, 5.1));
        this.medVol = K.agregar(medidor(K, [34.8, 0, -21.6], 0x4fd1ff, 6.2));
        K.agregar(K.caja(1.6, .04, 8, 0x8d8a86, [31, .02, -28]));
        this.pilas = K.agregar(new T.Group());
        K.clicable(this.pilas, hit => { let o = hit.object; while (o && !o.userData.cual) o = o.parent; if (o) this.fijar(K, o.userData.cual, (o.userData.cual === 'a' ? this.cx : this.cy) + 1); });
        K.agregar(astronauta(K, [21, 0, -20.2], .6), astronauta(K, [27.6, 0, -20.4], -.5, 0x4fd1ff));
        this.humo = [];
        for (let i = 0; i < 16; i++) { const m = new T.Mesh(new T.SphereGeometry(1, 10, 8), new T.MeshStandardMaterial({ color: 0xe8d6c4, transparent: true, opacity: 0, depthWrite: false })); m.visible = false; K.agregar(m); this.humo.push(m); }
        K.alLimpiar(() => { BASE.cohete.position.y = 1; BASE.llama.visible = false; });
        this.irFase(K, 1);
      },
      eqs() {
        if (this.fase === 3) return [this.ecM, this.ecV].map(f => f.map(i => leerNum(i.value)));
        const [a, b] = PROP[this.fase].map(t => CAJAS[t]);
        return [[a.kg, b.kg, 1200], [a.m3, b.m3, 30]];
      },
      irFase(K, n) {
        this.fase = n; this.cx = 0; this.cy = 0;
        const [ta, tb] = PROP[n], A = CAJAS[ta], B = CAJAS[tb];
        // Pilas de la propuesta
        limpiarGrupo(this.pilas);
        [[ta, 'a', 17.9, -24], [tb, 'b', 30.1, -24.6]].forEach(([tipo, cual, px, pz]) => {
          const g = new T.Group(); g.userData.cual = cual;
          g.add(K.caja(2.2, .16, 2.2, 0x8a6a4a, [0, .08, 0]));
          for (let i = 0; i < 6; i++) { const m = cajaModelo(K, tipo); m.position.set(-.5 + (i % 2) * 1, .16 + Math.floor(i / 4) * CAJAS[tipo].alto, -.65 + (Math.floor(i / 2) % 2) * 1.2 + (i >= 4 ? .6 : 0)); g.add(m); }
          g.position.set(px, 0, pz); this.pilas.add(g);
          K.etiqueta(`${CAJAS[tipo].nombre}<br>${CAJAS[tipo].kg} kg · ${CAJAS[tipo].m3} m³ c/u`, [0, 2.2, 0], cual === 'a' ? 'celeste' : 'naranja', g);
        });
        K.$('#pnObjetivoTxt').innerHTML = this.objetivos[n];
        K.controles().innerHTML = '';
        const inc = `<span class="tag">Propuesta ${n} de 3 · cohete: 1.200 kg y 30 m³</span><div class="sub">x = ${A.corto} (${A.kg} kg · ${A.m3} m³ c/u)</div><div class="sub">y = ${B.corto} (${B.kg} kg · ${B.m3} m³ c/u)</div>`;
        if (n === 3) {
          K.html(`<div class="ecu">${inc}</div>`);
          this.ecM = filaEcu(K, 'Ecuación de la masa (kg)', () => K.refrescarMat());
          this.ecV = filaEcu(K, 'Ecuación del volumen (m³)', () => K.refrescarMat());
          this.stA = stepper(K, `Tanques de agua (x)`, { min: 0, max: 40, alCambiar: v => this.fijar(K, 'a', v) });
          this.stB = stepper(K, `Paneles plegados (y)`, { min: 0, max: 30, alCambiar: v => this.fijar(K, 'b', v) });
        } else {
          const [em, ev] = this.eqs();
          K.html(`<div class="ecu">${inc}<div style="margin-top:4px">Masa: ${ecu(...em)}</div><div>Volumen: ${ecu(...ev)}</div></div>`);
          if (n === 1) [this.inX, this.inY] = parXY(K, 'Solución del sistema (podés usar coma o fracción)');
          else {
            this.inK = entrada(K, 'resultado de la resta');
            K.controles().append(K.h('div', { class: 'ecu' }, K.h('span', { class: 'tag' }, 'Masa − 50 · Volumen'),
              K.h('div', {}, '  50x + 100y = 1.200'), K.h('div', {}, '− 50·(x + 2y) = 50·30'), K.h('div', { class: 'res' }, '0x + 0y = ', this.inK)));
          }
          this.gV = K.opciones('¿Qué pasa con esta propuesta?', VEREDICTOS);
        }
        K.$('#btnComprobar').textContent = n === 3 ? 'Despachar el cohete' : 'Comprobar la propuesta';
        this.dibujarCarga(K, null); this.actualizar(K);
      },
      fijar(K, cual, v) {
        const max = cual === 'a' ? 40 : 30; v = Math.max(0, Math.min(max, v));
        const antes = cual === 'a' ? this.cx : this.cy;
        if (cual === 'a') this.cx = v; else this.cy = v;
        this.dibujarCarga(K, v > antes ? cual : null); this.actualizar(K);
      },
      dibujarCarga(K, nuevo) {
        limpiarGrupo(this.grupoCarga);
        const [ta, tb] = PROP[this.fase];
        [[ta, 'a', this.cx, 20.75, .8], [tb, 'b', this.cy, 24.55, .86]].forEach(([tipo, cual, n, x0, dx]) => {
          for (let i = 0; i < n; i++) {
            const m = cajaModelo(K, tipo), capa = Math.floor(i / 16), j = i % 16;
            m.position.set(x0 + (j % 4) * dx, .3 + capa * CAJAS[tipo].alto, -25.45 + Math.floor(j / 4) * .96);
            m.userData.cual = cual; this.grupoCarga.add(m);
            if (nuevo === cual && i === n - 1) { m.scale.setScalar(.01); animar(K, .3, u => m.scale.setScalar(Math.max(.01, rebote(u)))); }
          }
        });
      },
      actualizar(K) {
        const [ta, tb] = PROP[this.fase], A = CAJAS[ta], B = CAJAS[tb];
        const m = A.kg * this.cx + B.kg * this.cy, v = A.m3 * this.cx + B.m3 * this.cy;
        this.medMasa.poner(m, 1200, `Masa ${fmtN(m)} / 1.200 kg`);
        this.medVol.poner(v, 30, `Volumen ${v} / 30 m³`);
        if (this.fase === 3) { this.stA.poner(this.cx); this.stB.poner(this.cy); }
        K.refrescarMat();
      },
      comprobar(K) {
        if (this.fase === 1) {
          const x = leerNum(this.inX.value), y = leerNum(this.inY.value);
          if (isNaN(x) || isNaN(y)) return { parcial: true, ok: false, msg: 'Escribí la solución del sistema: x e y (podés usar coma decimal o fracción, por ejemplo 2,5 o 5/2).' };
          const m = 60 * x + 40 * y, v = x + 2 * y, okM = cerca(m, 1200), okV = cerca(v, 30);
          if (!okM || !okV) {
            const red = Number.isInteger(x) && Number.isInteger(y) && x === 15 && (y === 7 || y === 8);
            if (red) return { parcial: true, ok: false, msg: `Verificá en las dos ecuaciones: con x = 15 e y = ${y} la masa da ${fmtN(m)} kg y el volumen ${fmtN(v)} m³. ¿Redondeaste? La solución algebraica es otra.` };
            return { parcial: true, ok: false, msg: `Ese par no es solución: no cumple ${!okM && !okV ? 'ninguna de las dos ecuaciones' : !okM ? 'la ecuación de la masa' : 'la ecuación del volumen'} (da ${fmtN(m)} kg y ${fmtN(v)} m³). Resolvé el sistema: por ejemplo, despejá x de la ecuación del volumen.` };
          }
          const vd = this.gV.valor;
          if (!vd) return { parcial: true, ok: false, msg: 'La solución está bien. Ahora elegí qué pasa con esta propuesta.' };
          if (vd === 'sirve') return { parcial: true, ok: false, msg: `El sistema tiene solución, pero ¿se pueden mandar ${fmtN(y)} cajas? Probá cargarlas en la plataforma: una solución sirve sólo si tiene sentido en la situación.` };
          if (vd === 'negativa') return { parcial: true, ok: false, msg: '¿Algún valor de tu solución es negativo? Mirala de nuevo: el problema es otro.' };
          if (vd !== 'noentera') return { parcial: true, ok: false, msg: 'El sistema tiene una única solución (la encontraste vos y las rectas se cortan en un punto). El problema es si esa solución tiene sentido en la situación.' };
          this.irFase(K, 2);
          return { parcial: true, ok: true, msg: 'Correcto: el sistema tiene solución, pero no se pueden mandar 7,5 cajas. Con 7 no se llega y con 8 se pasa: la propuesta 1 se descarta. Seguí con la propuesta 2.' };
        }
        if (this.fase === 2) {
          const k = leerNum(this.inK.value);
          if (isNaN(k)) return { parcial: true, ok: false, msg: 'Completá el resultado de la resta: ¿qué número queda del lado derecho?' };
          if (k === 300) return { parcial: true, ok: false, msg: 'Revisá el orden de la resta: es la ecuación de la masa menos 50 veces la del volumen, también del lado derecho.' };
          if (k !== -300) return { parcial: true, ok: false, msg: 'Revisá la cuenta: al multiplicar la ecuación del volumen por 50 se multiplican los dos miembros (también el 30). Después restá miembro a miembro.' };
          const vd = this.gV.valor;
          if (!vd) return { parcial: true, ok: false, msg: 'La resta está bien. Ahora elegí qué pasa con esta propuesta.' };
          if (vd === 'infinitas') return { parcial: true, ok: false, msg: 'Si hubiera quedado 0 = 0, cualquier par que cumpla una ecuación cumpliría la otra. Pero te quedó 0 = −300: ¿hay algún par (x, y) que haga verdadera esa igualdad?' };
          if (vd !== 'sinsol') return { parcial: true, ok: false, msg: 'Al eliminar x también desapareció y, y quedó 0 = −300. ¿Qué dice eso sobre las soluciones? Mirá las rectas en el modo Matemático.' };
          this.irFase(K, 3);
          return { parcial: true, ok: true, msg: 'Exacto: 0 = −300 es falso para cualquier x e y. Las rectas son paralelas y no se cortan: ninguna carga cumple las dos condiciones. Seguí con la propuesta 3.' };
        }
        const [em, ev] = this.eqs();
        if ([...em, ...ev].some(isNaN)) return { ok: false, msg: 'Completá las dos ecuaciones del planteo (los tres números de cada una).' };
        const M = [60, 20, 1200], V = [1, 2, 30];
        const okSis = (proporcional(em, M) && proporcional(ev, V)) || (proporcional(em, V) && proporcional(ev, M));
        if (!okSis) {
          const diag = (e, nom) => {
            if (proporcional(e, M) || proporcional(e, V)) return '';
            if (razon(e, 20, 60)) return `${nom}: invertiste los coeficientes; x son los tanques de agua (60 kg y 1 m³ cada uno). `;
            if (razon(e, 2, 1)) return `${nom}: invertiste los coeficientes; cada tanque ocupa 1 m³ y cada paquete de paneles 2 m³. `;
            if (razon(e, 60, 20)) return `${nom}: el primer miembro son kilos; ¿cuál es la masa total? `;
            if (razon(e, 1, 2)) return `${nom}: el primer miembro son m³; ¿cuál es el volumen total? `;
            return `${nom}: en cada ecuación usá una sola magnitud (kilos con kilos, m³ con m³). `;
          };
          return { ok: false, msg: ('Revisá el planteo. ' + diag(em, 'Masa') + diag(ev, 'Volumen')).trim() };
        }
        const m = 60 * this.cx + 20 * this.cy, v = this.cx + 2 * this.cy, okM = m === 1200, okV = v === 30;
        if (okM && okV) return { ok: true, msg: `¡Carga perfecta! ${this.cx} tanques de agua y ${this.cy} paquetes de paneles: 60·${this.cx} + 20·${this.cy} = 1.200 kg y ${this.cx} + 2·${this.cy} = 30 m³.` };
        if (this.cx + this.cy === 0) return { ok: false, msg: 'Tu planteo está bien. Ahora resolvelo y cargá la plataforma con la solución.' };
        if (okM) return { ok: false, msg: `La masa da justo (1.200 kg), pero el volumen es ${v} m³: ${v < 30 ? 'la bodega queda con lugar libre' : 'no entra en la bodega'}. La carga tiene que cumplir las dos ecuaciones.` };
        if (okV) return { ok: false, msg: `La bodega queda llena (30 m³), pero la masa es ${fmtN(m)} kg y no 1.200. La carga tiene que cumplir las dos ecuaciones.` };
        return { ok: false, msg: `Con esa carga la masa es ${fmtN(m)} kg y el volumen ${v} m³: no se cumple ninguna condición. Resolvé tu sistema y cargá esa solución.` };
      },
      alResolver(K) {
        const coh = BASE.cohete, llama = BASE.llama, puerta = new T.Vector3(34, 5, -32.6);
        [...this.grupoCarga.children].forEach((c, i) => {
          const ini = c.position.clone(), ret = (i % 12) * .05;
          animar(K, 1.2 + ret, u => { const w = Math.max(0, Math.min(1, (u * (1.2 + ret) - ret) / 1.2)); c.position.lerpVectors(ini, puerta, suave(w)); c.position.y += Math.sin(w * Math.PI) * 2; c.scale.setScalar(Math.max(.05, 1 - .9 * w)); });
        });
        K.camara([14, 9, -4], [32, 7, -32]);
        setTimeout(() => K.toast('3… 2… 1… ¡Despegue hacia Fobos!'), 900);
        let t = 0;
        K.tic(dt => {
          t += dt; if (t < 1.7) return;
          const tt = t - 1.7;
          this.grupoCarga.visible = false;
          llama.visible = true; llama.scale.set(1, .9 + Math.random() * .4, 1);
          coh.position.y = 1 + tt * tt * 3.2;
          K.controls.target.y = Math.min(7 + coh.position.y * .7, 45);
          this.humo.forEach((h, i) => {
            const fase = (tt * .9 + i / this.humo.length) % 1;
            h.visible = true; h.position.set(34 + Math.cos(i * 2.4) * (1 + fase * 6), 1 + fase * 2, -34 + Math.sin(i * 2.4) * (1 + fase * 6));
            h.scale.setScalar(.6 + fase * 2.4); h.material.opacity = .55 * (1 - fase);
          });
        });
        return 4800;
      },
      pistas: [
        'En las tres propuestas las condiciones son las mismas: la masa total tiene que ser 1.200 kg y el volumen total 30 m³. Lo que cambia es cuánto pesa y cuánto ocupa cada caja.',
        'Una solución sirve sólo si tiene sentido en la situación: cantidades enteras y no negativas (no se manda media caja). Si al eliminar una incógnita desaparece también la otra, mirá la igualdad que queda: si es falsa no hay solución; si es 0 = 0 hay infinitas.',
        () => [
          '',
          'Propuesta 1: despejá x de la ecuación del volumen (x = 30 − 2y) y reemplazalo en la de la masa. Después mirá el gráfico: ¿el punto de corte cae en un cruce de la grilla?',
          'Propuesta 2: multiplicá toda la ecuación del volumen por 50 (el 30 también) y restásela a la de la masa, miembro a miembro. ¿Qué queda de cada lado?',
          'Propuesta 3: cada tanque de agua pesa 60 kg y ocupa 1 m³; cada paquete de paneles pesa 20 kg y ocupa 2 m³. Armá una ecuación con los kilos y otra con los m³, y eliminá x multiplicando la del volumen por 60.',
        ][JUEGO.niveles[3].fase],
      ],
      bitacora: [
        'Para cada propuesta, explicá qué obtuviste al resolver el sistema (o por qué no tiene solución) y qué se ve en el gráfico.',
        '¿Por qué la propuesta 1 no sirve, aunque el sistema tenga solución? ¿Qué significa que al eliminar una incógnita quede 0 = −300?',
        'Verificá en las dos condiciones la carga que despachaste. ¿Qué tiene que cumplir una solución para ser válida en una situación como esta?',
      ],
      resumenBitacora(K) { return `Descartaste la propuesta 1 (solución x = 15, y = 7,5: no entera) y la 2 (al eliminar quedó 0 = −300: sin solución). Despachaste la 3 con <b>${this.cx} tanques de agua y ${this.cy} paquetes de paneles</b>: 60·${this.cx} + 20·${this.cy} = 1.200 kg y ${this.cx} + 2·${this.cy} = 30 m³.`; },
      mat(K, el) {
        const R = [0, 32, 0, 20];
        const p = K.planoCartesiano({ xMin: 0, xMax: 32, yMin: 0, yMax: 20, pasoEtiqueta: 4, ejeX: 'x', ejeY: 'y', ancho: 560, alto: 380 });
        const [em, ev] = this.eqs(), valida = e => e && !e.some(isNaN) && (e[0] !== 0 || e[1] !== 0);
        if (valida(em)) recta(K, p, R, ...em, '#e8662f', 'Masa: ' + ecu(...em), this.fase === 2 ? { t: .12, dy: 18, rotar: true } : { t: .08 });
        if (valida(ev)) recta(K, p, R, ...ev, '#1690c9', 'Volumen: ' + ecu(...ev), this.fase === 2 ? { t: .12, dy: -8, rotar: true } : { t: .72, dy: 24 });
        const [ta, tb] = PROP[this.fase], A = CAJAS[ta], B = CAJAS[tb];
        const m = A.kg * this.cx + B.kg * this.cy, v = A.m3 * this.cx + B.m3 * this.cy;
        if (this.cx || this.cy) punto(K, p, this.cx, this.cy, m === 1200 && v === 30 ? '#0f8a4f' : (m === 1200 || v === 30) ? '#d99a00' : '#1b2333', `carga (${this.cx}, ${this.cy})`);
        marcoPlano(K, el, p);
        el.append(K.h('div', { class: 'vm-tabla', html: `<span class="k">Masa</span><span>${A.kg}·${this.cx} + ${B.kg}·${this.cy} = ${fmtN(m)} kg</span>${marca(m === 1200, m === 1200 ? '= 1.200' : '≠ 1.200')}<span class="k">Volumen</span><span>${A.m3}·${this.cx} + ${B.m3}·${this.cy} = ${v} m³</span>${marca(v === 30, v === 30 ? '= 30' : '≠ 30')}` }));
        el.append(K.h('div', { class: 'nota', html: ['', 'x = tanques de agua, y = cajas de repuestos. Mirá dónde se cortan las rectas: ¿cae justo en un cruce de la grilla?', 'x = cajas de semillas, y = cajas de herramientas. ¿Estas rectas se cortan en algún punto? Compará cómo están inclinadas.', 'x = tanques de agua, y = paquetes de paneles. Las rectas son las de tu planteo: la carga tiene que ser un punto que esté en las dos.'][this.fase] }));
      },
      prueba: {
        mal: [
          function (K) { this.irFase(K, 1); this.inX.value = '15'; this.inY.value = '7'; elegir(this.gV, 'sirve', VEREDICTOS.map(v => v[0])); },
          function (K) { this.irFase(K, 1); this.inX.value = '15'; this.inY.value = '7,5'; elegir(this.gV, 'sirve', VEREDICTOS.map(v => v[0])); },
          function (K) { this.irFase(K, 2); this.inK.value = '0'; elegir(this.gV, 'infinitas', VEREDICTOS.map(v => v[0])); },
          function (K) { this.irFase(K, 2); this.inK.value = '−300'; elegir(this.gV, 'infinitas', VEREDICTOS.map(v => v[0])); },
          function (K) { this.irFase(K, 3); ['60', '20', '1.200'].forEach((v, i) => { this.ecM[i].value = v; }); ['1', '2', '30'].forEach((v, i) => { this.ecV[i].value = v; }); this.fijar(K, 'a', 20); this.fijar(K, 'b', 0); },
          function (K) { this.irFase(K, 3); ['20', '60', '1200'].forEach((v, i) => { this.ecM[i].value = v; }); ['2', '1', '30'].forEach((v, i) => { this.ecV[i].value = v; }); this.fijar(K, 'a', 18); this.fijar(K, 'b', 6); },
        ],
        bien(K) { this.irFase(K, 1); this.inX.value = '15'; this.inY.value = '15/2'; elegir(this.gV, 'noentera', VEREDICTOS.map(v => v[0])); },
        pasos: 3,
        entrePasos(K, k) {
          if (k === 0) { this.inK.value = '−300'; elegir(this.gV, 'sinsol', VEREDICTOS.map(v => v[0])); }
          else { ['60', '20', '1.200'].forEach((v, i) => { this.ecM[i].value = v; }); ['1', '2', '30'].forEach((v, i) => { this.ecV[i].value = v; }); this.fijar(K, 'a', 18); this.fijar(K, 'b', 6); }
        },
      },
    },
  ],
};
iniciar(JUEGO);
</script>
</body>
</html>
$kodu$, 'a59ea305-7e4b-4374-8039-2236dd0f5a88', now(), now());
INSERT INTO "ChatThread" (id, title, "projectId", "createdAt") VALUES ('6d59b824-8c9e-448f-b0d2-b4f36d4d1e3d', 'Conversación', '44a76e68-6f6c-4cc5-9631-04aa889b217d', now());
COMMIT;
SELECT id, title, slug, length("currentHtml") AS largo FROM "Project" WHERE id = '44a76e68-6f6c-4cc5-9631-04aa889b217d';
