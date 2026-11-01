\set ON_ERROR_STOP on
SET client_encoding = 'UTF8';
BEGIN;
-- No duplicar si ya existe un recurso con el mismo título en la cuenta.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Project" WHERE "userId" = 'a59ea305-7e4b-4374-8039-2236dd0f5a88' AND title = 'Parque de decisiones') THEN
    RAISE EXCEPTION 'Ya existe un recurso con ese título en la cuenta';
  END IF;
END $$;
INSERT INTO "Project" (id, title, description, slug, "currentHtml", "userId", "createdAt", "updatedAt")
VALUES ('8cbf1b9a-4ddb-408f-b4e9-f333ef57a3c2', 'Parque de decisiones', 'Videojuego 3D · 3.er año. Concepto de función, existencia y unicidad, dominio e imagen, ceros, signos, crecimiento, decrecimiento y extremos en un parque de diversiones.', 'parque-de-decisiones-vu3mbcvx', $kodu$<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Parque de decisiones</title>
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
  --acento:#ff4f8b; --acento-2:#ffd23f;
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
   JUEGO — todo lo que sigue es específico de este recurso
   ════════════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════
   JUEGO — Parque de decisiones (funciones)
   ════════════════════════════════════════════════════════════════════ */
const T = THREE, PI = Math.PI;
const azar = sem => { let s = sem >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const neg = v => String(v).replace('-', '−');
/** Cámara de cada nivel: en pantallas angostas (celular) se aleja para que entre la escena. */
function cam(K, pos, mira, o = {}) {
  const w = innerWidth, h = innerHeight;
  const f = w <= 860 ? clamp(1.6 / (w / h) * 0.62, 1, 2.6) : 1;
  K.camara(pos.map((v, i) => mira[i] + (v - mira[i]) * f), mira, { ...o, max: (o.max || 200) * f });
}
const iv = (a, b, ca, cb) => `${ca ? '[' : '('}${a} ; ${b}${cb ? ']' : ')'}`;
const lista = xs => xs.length === 1 ? String(xs[0]) : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1];
const FUENTE = '"Trebuchet MS","Segoe UI",system-ui,sans-serif';
const deco = {};

function texCanvas(w, h, dibujar) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  dibujar(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; t.userData.canvas = c;
  return t;
}
function placa(w, h, tex, extra = {}) {
  return new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, toneMapped: false, ...extra }));
}
/** Pinta por gajos una geometría (techos rayados de carpas y calesita). */
function rayar(geo, colores, gajos) {
  const g = geo.toNonIndexed(), pos = g.attributes.position, col = [];
  const c = colores.map(x => new T.Color(x));
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const k = Math.floor(((Math.atan2(cz, cx) + PI) / (2 * PI)) * gajos) % c.length;
    for (let j = 0; j < 3; j++) col.push(c[k].r, c[k].g, c[k].b);
  }
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  return g;
}
const hhmm = t => { const h = Math.floor(t + 1e-9), m = Math.round((t - h) * 60); return `${h}:${String(m).padStart(2, '0')}`; };

/** Ejes cartesianos en SVG con pasos distintos en x y en y. */
let idFlecha = 0;
function ejes({ xMin, xMax, yMin, yMax, gx = 1, gy = 1, lx = 1, ly = 1, ex = 'x', ey = 'y', W = 580, H = 330, fx = v => v, fy = v => v, ml = 46, mr = 26, mt = 16, mb = 30 }) {
  const X = x => ml + (x - xMin) / (xMax - xMin) * (W - ml - mr);
  const Y = y => H - mb - (y - yMin) / (yMax - yMin) * (H - mt - mb);
  const s = K.s, id = 'fl' + (++idFlecha);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, 'font-family': 'JetBrains Mono, monospace', 'font-size': 11, style: 'height:auto;min-height:0;flex:none' });
  svg.append(s('defs', {}, s('marker', { id, viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#1b2333' }))));
  const gr = s('g', { stroke: '#ebe6da', 'stroke-width': 1 });
  for (let i = 0, x; (x = xMin + i * gx) <= xMax + 1e-9; i++) gr.append(s('line', { x1: X(x), x2: X(x), y1: Y(yMin), y2: Y(yMax) }));
  for (let i = 0, y; (y = yMin + i * gy) <= yMax + 1e-9; i++) gr.append(s('line', { y1: Y(y), y2: Y(y), x1: X(xMin), x2: X(xMax) }));
  svg.append(gr);
  const x0 = clamp(0, xMin, xMax), y0 = clamp(0, yMin, yMax);
  const ej = s('g', { stroke: '#1b2333', 'stroke-width': 1.6 });
  ej.append(s('line', { x1: X(xMin), x2: X(xMax) + 10, y1: Y(y0), y2: Y(y0), 'marker-end': `url(#${id})` }));
  ej.append(s('line', { x1: X(x0), x2: X(x0), y1: Y(yMin), y2: Y(yMax) - 10, 'marker-end': `url(#${id})` }));
  svg.append(ej);
  const et = s('g', { fill: '#6b7280' });
  for (let i = 0, x; (x = Math.ceil(xMin / lx - 1e-9) * lx + i * lx) <= xMax + 1e-9; i++) if (Math.abs(x - x0) > 1e-9 || x0 === xMin && x !== 0) et.append(s('text', { x: X(x), y: Y(y0) + 15, 'text-anchor': 'middle' }, fx(+x.toFixed(4))));
  for (let i = 0, y; (y = Math.ceil(yMin / ly - 1e-9) * ly + i * ly) <= yMax + 1e-9; i++) if (Math.abs(y) > 1e-9) et.append(s('text', { x: X(x0) - 6, y: Y(y) + 4, 'text-anchor': 'end' }, fy(+y.toFixed(4))));
  et.append(s('text', { x: X(xMax) + 4, y: Y(y0) - 8, 'text-anchor': 'end', fill: '#1b2333', 'font-weight': 700 }, ex));
  et.append(s('text', { x: X(x0) + 8, y: Y(yMax) + 2, fill: '#1b2333', 'font-weight': 700 }, ey));
  svg.append(et);
  const g = s('g'); svg.append(g);
  return { svg, X, Y, g };
}
function notaMat(el, html, clase = 'nota') { const d = K.h('div', { class: clase, html }); el.append(d); return d; }

/* ── Piezas del parque ──────────────────────────────────────────── */
function construirRueda(R, nCab, colores, alto) {
  const g = new T.Group(), rotor = new T.Group();
  rotor.position.y = alto; g.add(rotor);
  for (const z of [-1, 1]) for (const sx of [-1, 1]) g.add(K.barra([sx * R * 0.62, 0, z * 2.2], [0, alto, z * 1.3], 0.22, 0xf4f1ea));
  g.add(K.barra([0, alto, -1.6], [0, alto, 1.6], 0.32, 0x9aa3b2));
  g.add(K.caja(R * 1.5, 0.5, 5.4, 0xc9b79c, [0, 0.25, 0]));
  for (const z of [-0.85, 0.85]) {
    const aro = new T.Mesh(new T.TorusGeometry(R, 0.15, 6, 56), K.mat(0xff4f8b)); aro.position.z = z; rotor.add(aro);
    const aro2 = new T.Mesh(new T.TorusGeometry(R * 0.5, 0.1, 6, 36), K.mat(0xffd23f)); aro2.position.z = z; rotor.add(aro2);
    for (let i = 0; i < 16; i++) { const a = i / 16 * 2 * PI; rotor.add(K.barra([0, 0, z], [R * Math.cos(a), R * Math.sin(a), z], 0.06, 0xffffff)); }
  }
  const cabinas = [];
  for (let i = 0; i < nCab; i++) {
    const a = i / nCab * 2 * PI;
    const piv = new T.Group(); piv.position.set(R * Math.cos(a), R * Math.sin(a), 0); rotor.add(piv);
    piv.add(K.barra([0, 0, -0.9], [0, 0, 0.9], 0.07, 0x55607a));
    const cab = new T.Group(); piv.add(cab);
    const col = colores[i % colores.length];
    cab.add(K.caja(1.5, 1.15, 1.25, col, [0, -0.2, 0], i === 0 && colores.dorada ? { metalness: 0.5, roughness: 0.35, emissive: 0x6b4a00 } : undefined));
    cab.add(K.caja(1.2, 0.45, 1.3, 0x1c2b44, [0, -0.05, 0]));
    const techo = new T.Mesh(new T.ConeGeometry(1.1, 0.55, 4), K.mat(i === 0 && colores.dorada ? 0xffe08a : 0xffffff)); techo.rotation.y = PI / 4; techo.position.y = 0.62; techo.castShadow = true; cab.add(techo);
    cabinas.push({ piv, cab });
  }
  g.userData = { rotor, cabinas };
  return g;
}
function girarRueda(g, ang) { const { rotor, cabinas } = g.userData; rotor.rotation.z = ang; for (const c of cabinas) c.cab.rotation.z = -ang; }

function construirCarrito() {
  const g = new T.Group();
  g.add(K.caja(1.25, 0.45, 0.9, 0xff4f8b, [0, 0.12, 0]));
  g.add(K.caja(0.3, 0.55, 0.92, 0xffd23f, [0.55, 0.2, 0]));
  g.add(K.caja(0.25, 0.5, 0.8, 0x1c2b44, [-0.15, 0.45, 0]));
  for (const [x, c] of [[-0.45, 0x3ddc97], [0.12, 0x5aa9ff]]) { const p = K.persona([x, 0.15, 0], c); p.scale.setScalar(0.55); g.add(p); }
  for (const x of [-0.4, 0.4]) for (const z of [-0.45, 0.45]) { const r = K.cilindro(0.16, 0.16, 0.1, 0x222833, [x, -0.12, z], 10); r.rotation.x = PI / 2; g.add(r); }
  return g;
}

function escenaParque(K) {
  const S = K.scene, r = azar(7);
  deco.matFoco = new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  deco.matFarol = new T.MeshBasicMaterial({ color: 0xfff1c4, toneMapped: false });
  deco.suelo = K.suelo(0x8fd47a, 800); S.add(deco.suelo);
  const plano = (geo, color, y) => { const m = new T.Mesh(geo, K.mat(color)); m.rotation.x = -PI / 2; m.position.y = y; m.receiveShadow = true; S.add(m); return m; };
  plano(new T.CircleGeometry(24, 48), 0xf3e3c9, 0.02);
  plano(new T.RingGeometry(24, 27.5, 64), 0xe7c99c, 0.03);
  for (let i = 0; i < 4; i++) { const m = plano(new T.PlaneGeometry(5, 90), 0xe7c99c, 0.025); m.rotation.z = i * PI / 2 + PI / 4; m.position.set(Math.sin(i * PI / 2 + PI / 4) * 70, 0.025, Math.cos(i * PI / 2 + PI / 4) * 70); }
  // árboles y cerros del horizonte
  for (let i = 0; i < 90; i++) {
    const a = r() * 2 * PI, d = 46 + r() * 80, x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (z > 15 && Math.abs(x) < 60) continue;
    S.add(K.arbol([x, 0, z], 1.3 + r() * 1.4, [0x3f8f5a, 0x4fa36a, 0x2f7d4f, 0x6bb36b, 0x88c057][i % 5]));
  }
  for (let i = 0; i < 16; i++) {
    const a = PI + (i / 15) * PI, d = 230 + r() * 40;
    const m = new T.Mesh(new T.ConeGeometry(30 + r() * 30, 25 + r() * 35, 6), K.mat([0x9fcf8c, 0xa6c8e8, 0x8fbf9c][i % 3]));
    m.position.set(Math.cos(a) * d, 8, Math.sin(a) * d); S.add(m);
  }
  // nubes
  deco.nubes = new T.Group();
  for (let i = 0; i < 9; i++) {
    const n = new T.Group();
    for (let k = 0; k < 4; k++) { const e = new T.Mesh(new T.IcosahedronGeometry(3 + r() * 3, 0), K.mat(0xffffff)); e.position.set(k * 4 - 6, r() * 1.5, r() * 2); e.scale.y = 0.6; n.add(e); }
    n.position.set(-150 + i * 38, 55 + r() * 25, -120 - r() * 60); deco.nubes.add(n);
  }
  S.add(deco.nubes);
  // vuelta al mundo decorativa
  deco.rueda = construirRueda(9, 10, [0x5aa9ff, 0xffd23f, 0x3ddc97, 0xff8a3d, 0xb08cff], 11.5);
  deco.rueda.position.set(38, 0, -48); deco.rueda.rotation.y = -0.45; S.add(deco.rueda);
  { const inst = new T.InstancedMesh(new T.SphereGeometry(0.22, 8, 6), deco.matFoco, 36), m4 = new T.Matrix4(), c = new T.Color();
    for (let i = 0; i < 36; i++) { const a = i / 36 * 2 * PI; m4.makeTranslation(9 * Math.cos(a), 9 * Math.sin(a), 1.05); inst.setMatrixAt(i, m4); inst.setColorAt(i, c.set([0xffd23f, 0xff4f8b, 0x5aa9ff][i % 3])); }
    deco.rueda.userData.rotor.add(inst); }
  // montaña rusa decorativa
  deco.montana = new T.Group();
  { const pts = []; for (let i = 0; i < 12; i++) { const a = i / 12 * 2 * PI; pts.push(new T.Vector3(Math.cos(a) * 15, [4, 9, 14, 8, 3, 6, 11, 5, 3, 7, 4, 3][i], Math.sin(a) * 8)); }
    const curva = new T.CatmullRomCurve3(pts, true);
    const tubo = new T.Mesh(new T.TubeGeometry(curva, 160, 0.35, 6, true), K.mat(0xff4f8b)); tubo.castShadow = true; deco.montana.add(tubo);
    for (let i = 0; i < 40; i++) { const p = curva.getPoint(i / 40); deco.montana.add(K.barra([p.x, 0, p.z], [p.x, p.y - 0.3, p.z], 0.12, 0xf4f1ea)); } }
  deco.montana.position.set(-42, 0, -54); S.add(deco.montana);
  // calesita
  deco.calesita = new T.Group();
  { const c = deco.calesita;
    c.add(K.cilindro(6, 6.2, 0.6, 0xffd23f, [0, 0.3, 0], 16));
    c.add(K.cilindro(0.5, 0.5, 6, 0xffffff, [0, 3, 0], 10));
    const techo = new T.Mesh(rayar(new T.ConeGeometry(6.8, 2.6, 16), [0xff4f8b, 0xffffff], 16), K.mat(0xffffff, { vertexColors: true })); techo.position.y = 7.3; techo.castShadow = true; c.add(techo);
    c.add(K.cilindro(6.8, 6.8, 0.5, 0x5aa9ff, [0, 5.8, 0], 16));
    for (let i = 0; i < 8; i++) { const a = i / 8 * 2 * PI, x = Math.cos(a) * 4.4, z = Math.sin(a) * 4.4;
      c.add(K.cilindro(0.08, 0.08, 5.2, 0xffd23f, [x, 3.2, z], 6));
      c.add(K.caja(0.5, 0.8, 1.6, [0xffffff, 0xb08cff, 0x3ddc97, 0xff8a3d][i % 4], [x, 2.2 + (i % 2) * 0.5, z])); } }
  deco.calesita.position.set(-21, 0, -38); S.add(deco.calesita);
  // carpas
  const carpa = (x, z, c1) => { const g = new T.Group();
    g.add(K.cilindro(2.6, 2.6, 2.4, 0xfff6e6, [0, 1.2, 0], 8));
    const t = new T.Mesh(rayar(new T.ConeGeometry(3.1, 2.4, 8), [c1, 0xffffff], 8), K.mat(0xffffff, { vertexColors: true })); t.position.y = 3.6; t.castShadow = true; g.add(t);
    g.add(K.cilindro(0.05, 0.05, 1.2, 0x555555, [0, 5.2, 0], 5)); g.add(K.caja(0.05, 0.5, 0.8, c1, [0, 5.5, 0.4]));
    g.position.set(x, 0, z); S.add(g); };
  carpa(13, -35, 0x5aa9ff); carpa(-5, -44, 0xff8a3d); carpa(25, -30, 0x3ddc97); carpa(-33, -30, 0xb08cff);
  // globos
  deco.globos = [];
  for (let i = 0; i < 6; i++) { const g = new T.Group(); const c = [0xff4f8b, 0xffd23f, 0x5aa9ff, 0x3ddc97, 0xb08cff, 0xff8a3d][i];
    const e = K.esfera(0.7, c, [0, 3.2, 0]); e.scale.y = 1.2; g.add(e); g.add(K.linea([[0, 0, 0], [0, 2.4, 0]], 0xffffff));
    g.position.set(8 + i * 1.3, 2 + (i % 2), -32 + (i % 3)); S.add(g); deco.globos.push(g); }
  // cartel del parque
  { const tex = texCanvas(1024, 256, (x, w, h) => {
      x.fillStyle = '#1c2b44'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#ff4f8b'; x.fillRect(10, 10, w - 20, h - 20); x.fillStyle = '#1c2b44'; x.fillRect(24, 24, w - 48, h - 48);
      x.font = `900 92px ${FUENTE}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = '#ffd23f'; x.fillText('PARQUE DE', w / 2, 92); x.fillStyle = '#ffffff'; x.fillText('DECISIONES  ƒ(x)', w / 2, 180); });
    const g = new T.Group(); const p = placa(16, 4, tex); p.position.set(0, 11, 0.21); g.add(p);
    g.add(K.caja(16.6, 4.6, 0.4, 0xff4f8b, [0, 11, 0]));
    for (const x of [-6, 6]) g.add(K.cilindro(0.35, 0.4, 9, 0xffffff, [x, 4.5, -0.3], 8));
    g.position.set(54, 0, -26); g.rotation.y = -1.0; S.add(g); }
  // faroles y guirnaldas en la parte de atrás del anillo
  const postes = [];
  for (let a = 200; a <= 340; a += 20) { const ra = a * PI / 180, x = Math.cos(ra) * 26, z = Math.sin(ra) * 26;
    S.add(K.cilindro(0.12, 0.16, 5, 0x2a3c5c, [x, 2.5, z], 6));
    const f = new T.Mesh(new T.SphereGeometry(0.42, 10, 8), deco.matFarol); f.position.set(x, 5.2, z); S.add(f);
    postes.push(new T.Vector3(x, 4.9, z)); }
  { const n = (postes.length - 1) * 9, inst = new T.InstancedMesh(new T.SphereGeometry(0.17, 8, 6), deco.matFoco, n), m4 = new T.Matrix4(), c = new T.Color(); let k = 0;
    for (let i = 0; i < postes.length - 1; i++) for (let j = 0; j < 9; j++) { const u = (j + 0.5) / 9, p = postes[i].clone().lerp(postes[i + 1], u); p.y -= Math.sin(u * PI) * 1.4;
      m4.makeTranslation(p.x, p.y, p.z); inst.setMatrixAt(k, m4); inst.setColorAt(k, c.set([0xffd23f, 0xff4f8b, 0x5aa9ff, 0x3ddc97][k % 4])); k++; }
    S.add(inst); deco.focos = inst; }
}
function decoTic(dt, t) {
  girarRueda(deco.rueda, t * 0.12);
  deco.calesita.rotation.y = t * 0.5;
  deco.globos.forEach((g, i) => { g.position.y = 2 + (i % 2) + Math.sin(t * 1.3 + i) * 0.3; });
  deco.nubes.position.x = Math.sin(t * 0.02) * 20;
}
function cieloDia(K) {
  K.cielo(0x58b4ff, 0xffe2ee, [130, 360]);
  K.hemi.intensity = 1.1; K.hemi.color.set(0xdfefff); K.hemi.groundColor.set(0x6b5a45);
  K.sol.intensity = 2.2; K.sol.color.set(0xfff1dc); K.renderer.toneMappingExposure = 1.05;
  if (deco.nubes) deco.nubes.visible = true;
  if (deco.matFoco) { deco.matFoco.color.set(0xffffff); deco.matFarol.color.set(0xfff1c4); }
}
function cieloNoche(K) {
  K.cielo(0x050821, 0x3a2560, [90, 320]);
  K.hemi.intensity = 0.5; K.hemi.color.set(0x8a9cff); K.hemi.groundColor.set(0x2a1f3a);
  K.sol.intensity = 0.55; K.sol.color.set(0xa9bcff);
  deco.nubes.visible = false;
}
function prepararNivel(K, { sinRueda = false, sinMontana = false } = {}) {
  deco.rueda.visible = !sinRueda; deco.montana.visible = !sinMontana;
  K.tic(decoTic);
  K.alLimpiar(() => { deco.rueda.visible = deco.montana.visible = true; });
}
function boton(texto, fn, clase = 'btn btn-sec btn-chico') { const b = K.h('button', { class: clase, onclick: fn }, texto); return b; }
function campoTexto(etiqueta, { id, placeholder = '' } = {}) {
  const inp = K.h('input', { class: 'entrada', type: 'text', id, placeholder, autocomplete: 'off', style: 'font-size:14px' });
  K.controles().append(K.h('div', { class: 'campo' }, K.h('label', { for: id, html: etiqueta }), inp));
  return inp;
}
function marcarOpcion(grupo, valores, v) {
  [...grupo.querySelectorAll('button')].forEach((b, i) => b.setAttribute('aria-pressed', valores[i] === v ? 'true' : 'false'));
  grupo.valor = v;
}

/* ════════════════════════════════════════════════════════════════════
   NIVEL 1 · La boletera que duda (existencia y unicidad)
   ════════════════════════════════════════════════════════════════════ */
const N1 = { mx: -3.6, ox: -3.6 - 2.5, oy: 2.6, sx: 0.85, sy: 0.5 };
const N1_INI = ['1,3', '2,5', '2,8', '4,9', '5,11', '5,12'];
const N1_BIEN = ['1,3', '2,5', '3,7', '4,9', '5,11', '6,13'];
const N1_OPC = [['f', 'Es función'], ['e', 'Falta salida'], ['u', 'Dos salidas']];
const N1_TXT = { f: 'función', e: 'falta salida', u: 'dos salidas' };
function dibujarMaquinaVieja(x, w, h, cual) {
  x.fillStyle = '#fffaf0'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#1c2b44'; x.fillRect(0, 0, w, 74);
  x.font = `800 38px ${FUENTE}`; x.fillStyle = '#ffd23f'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText({ A: 'A · Tren fantasma', B: 'B · Autitos chocadores', C: 'C · Barco pirata' }[cual], w / 2, 38);
  x.fillStyle = '#1c2b44'; x.strokeStyle = '#1c2b44'; x.lineWidth = 3;
  if (cual === 'A') {
    const filas = [['Fichas', 'Boletos'], ['1', '2'], ['2', '4'], ['3', '5'], ['3', '6'], ['4', '8']];
    filas.forEach((f, i) => { const y = 110 + i * 56;
      if (i === 0) { x.fillStyle = '#ffe1ec'; x.fillRect(86, y - 26, 340, 52); x.fillStyle = '#1c2b44'; }
      x.font = i ? `700 36px ${FUENTE}` : `800 32px ${FUENTE}`; x.fillText(f[0], 170, y); x.fillText(f[1], 340, y);
      x.beginPath(); x.moveTo(86, y + 28); x.lineTo(426, y + 28); x.lineWidth = 2; x.stroke(); });
    x.beginPath(); x.moveTo(256, 84); x.lineTo(256, 418); x.stroke();
    x.font = `700 28px ${FUENTE}`; x.fillText('Acepta de 1 a 4 fichas', w / 2, 470);
  } else if (cual === 'B') {
    x.lineWidth = 3; x.beginPath(); x.ellipse(130, 270, 70, 150, 0, 0, 2 * PI); x.stroke(); x.beginPath(); x.ellipse(382, 270, 70, 150, 0, 0, 2 * PI); x.stroke();
    x.font = `700 26px ${FUENTE}`; x.fillText('fichas', 130, 100); x.fillText('boletos', 382, 100);
    const ya = [165, 235, 305, 375];
    x.font = `800 36px ${FUENTE}`;
    [1, 2, 3, 4].forEach((v, i) => x.fillText(v, 130, ya[i])); [2, 4, 6, 8].forEach((v, i) => x.fillText(v, 382, ya[i]));
    const fl = (y1, y2) => { x.strokeStyle = '#ff4f8b'; x.fillStyle = '#ff4f8b'; x.lineWidth = 4; x.beginPath(); x.moveTo(158, y1); x.lineTo(350, y2); x.stroke();
      const a = Math.atan2(y2 - y1, 192); x.beginPath(); x.moveTo(354, y2); x.lineTo(354 - 18 * Math.cos(a - 0.4), y2 - 18 * Math.sin(a - 0.4)); x.lineTo(354 - 18 * Math.cos(a + 0.4), y2 - 18 * Math.sin(a + 0.4)); x.fill(); };
    fl(ya[0], ya[0]); fl(ya[1], ya[1]); fl(ya[2], ya[2]); fl(ya[3], ya[2]);
    x.fillStyle = '#1c2b44'; x.font = `700 28px ${FUENTE}`; x.fillText('Acepta de 1 a 4 fichas', w / 2, 470);
  } else {
    const X = v => 80 + v * 64, Y = v => 420 - v * 38;
    x.strokeStyle = '#d9d2c2'; x.lineWidth = 1.5;
    for (let i = 0; i <= 6; i++) { x.beginPath(); x.moveTo(X(i), Y(0)); x.lineTo(X(i), Y(8.5)); x.stroke(); }
    for (let j = 0; j <= 8; j++) { x.beginPath(); x.moveTo(X(0), Y(j)); x.lineTo(X(6.3), Y(j)); x.stroke(); }
    x.strokeStyle = '#1c2b44'; x.lineWidth = 3; x.beginPath(); x.moveTo(X(0), Y(0)); x.lineTo(X(6.4), Y(0)); x.moveTo(X(0), Y(0)); x.lineTo(X(0), Y(8.6)); x.stroke();
    x.font = `700 22px ${FUENTE}`; x.fillStyle = '#1c2b44';
    for (let i = 1; i <= 6; i++) x.fillText(i, X(i), Y(0) + 20);
    for (let j = 2; j <= 8; j += 2) x.fillText(j, X(0) - 20, Y(j));
    x.fillText('fichas', X(5.6), Y(0) - 18); x.fillText('boletos', X(0) + 50, Y(8.6) - 2);
    x.fillStyle = '#ff4f8b'; for (const [a, b] of [[1, 3], [2, 4], [4, 6], [5, 7]]) { x.beginPath(); x.arc(X(a), Y(b), 11, 0, 2 * PI); x.fill(); }
    x.fillStyle = '#1c2b44'; x.font = `700 28px ${FUENTE}`; x.fillText('Acepta de 1 a 5 fichas', w / 2, 476);
  }
}

const nivel1 = {
  titulo: 'La boletera que duda',
  relato: 'La <b>boletera</b> de la entrada cambia <b>fichas</b> por <b>boletos</b>. Un técnico la dejó mal configurada: con algunas cantidades de fichas no entrega nada y con otras ¡no sabe cuántos boletos dar! En el depósito hay además tres máquinas viejas que alguien quiere volver a usar.',
  objetivo: '<b>1)</b> Clasificá las máquinas viejas A, B y C: ¿la relación fichas → boletos es función? <b>2)</b> Tocá los focos del tablero para prenderlos o apagarlos hasta que la boletera sea una <b>función</b> de {1, 2, 3, 4, 5, 6} que respete la tarifa.',
  tituloMat: 'Relación fichas → boletos', subMat: 'cada columna es una entrada: ¿cuántas salidas tiene?',
  armar(K) {
    prepararNivel(K);
    const N = this;
    this.vista = () => cam(K, [2.2, 7.4, 25], [2.2, 6.2, 0], { min: 6, max: 50 });
    cam(K, [2.2, 7.4, 25], [2.2, 6.2, 0], { suave: false, min: 6, max: 50 });
    this.luces = new Set(N1_INI);
    this.clasif = { A: null, B: null, C: null };
    const mx = N1.mx;
    const px = x => N1.ox + x * N1.sx, py = y => N1.oy + y * N1.sy;
    // ── la boletera
    const maq = K.agregar(new T.Group());
    maq.add(K.caja(8.4, 1, 3.4, 0x1c2b44, [mx, 0.5, -1.5]));
    maq.add(K.caja(7.8, 11, 3, 0xd6336c, [mx, 6.5, -1.5]));
    for (const sx of [-1, 1]) maq.add(K.caja(0.35, 11, 3.1, 0xffd23f, [mx + sx * 3.9, 6.5, -1.5]));
    maq.add(K.caja(8.6, 1.9, 0.7, 0x1c2b44, [mx, 12.95, -0.3]));
    const marq = placa(8.2, 1.6, texCanvas(1024, 200, (x, w, h) => {
      x.fillStyle = '#1c2b44'; x.fillRect(0, 0, w, h); x.font = `900 120px ${FUENTE}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = '#ffd23f'; x.fillText('BOLETERA', w / 2 - 70, h / 2 + 6); x.fillStyle = '#ff4f8b'; x.fillText('ƒ', w / 2 + 330, h / 2 + 6);
      for (let i = 0; i < 26; i++) { x.fillStyle = i % 2 ? '#ffd23f' : '#ffffff'; x.beginPath(); x.arc(20 + i * 38.5, 12, 7, 0, 2 * PI); x.arc(20 + i * 38.5, h - 12, 7, 0, 2 * PI); x.fill(); } }));
    marq.position.set(mx, 12.95, 0.06); maq.add(marq);
    const tab = placa(6.8, 9.8, texCanvas(512, 738, (x, w, h) => {
      const cx = wx => (wx - (mx - 3.4)) / 6.8 * w, cy = wy => (11 - wy) / 9.8 * h;
      x.fillStyle = '#13213a'; x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(255,255,255,.10)'; x.lineWidth = 2;
      for (let i = 1; i <= 6; i++) { x.beginPath(); x.moveTo(cx(px(i)), cy(py(0)) + 10); x.lineTo(cx(px(i)), cy(py(14)) - 10); x.stroke(); }
      for (let j = 0; j <= 14; j++) { x.beginPath(); x.moveTo(cx(px(0.4)), cy(py(j))); x.lineTo(cx(px(6.6)), cy(py(j))); x.stroke(); }
      x.strokeStyle = '#ffd23f'; x.lineWidth = 3; x.beginPath(); x.moveTo(cx(px(0)), cy(py(-0.6))); x.lineTo(cx(px(0)), cy(py(14.8))); x.moveTo(cx(px(-0.2)), cy(py(-0.6))); x.lineTo(cx(px(6.9)), cy(py(-0.6))); x.stroke();
      x.fillStyle = '#ffffff'; x.font = `700 22px ${FUENTE}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      for (let i = 1; i <= 6; i++) x.fillText(i, cx(px(i)), cy(py(-1.3)));
      x.textAlign = 'right'; for (let j = 0; j <= 14; j++) x.fillText(j, cx(px(0)) - 8, cy(py(j)));
      x.textAlign = 'center'; x.fillStyle = '#ffd23f'; x.font = `800 22px ${FUENTE}`;
      x.fillText('fichas →', cx(px(3.5)), cy(py(-2.3))); x.fillText('boletos ↑', cx(px(1.3)), cy(py(15.6)));
      x.fillStyle = '#ff9cc0'; x.font = `700 20px ${FUENTE}`; x.fillText('1 foco por columna = 1 salida', cx(px(4.3)), cy(py(15.6))); }));
    tab.position.set(mx, 6.1, 0.02); maq.add(tab);
    maq.add(K.caja(2.6, 0.45, 0.1, 0x05080f, [mx, 0.5, 0.22]));
    maq.add(K.caja(1.2, 1.6, 0.6, 0xffd23f, [mx + 4.6, 4.5, -0.6]));
    maq.add(K.caja(0.15, 0.7, 0.1, 0x05080f, [mx + 4.6, 4.7, -0.27]));
    // zócalos (clicables) y focos
    this.zocalos = new T.InstancedMesh(new T.CylinderGeometry(0.17, 0.17, 0.1, 10).rotateX(PI / 2), K.mat(0x3a4a66), 90);
    const m4 = new T.Matrix4();
    for (let i = 0; i < 90; i++) { m4.makeTranslation(px(1 + Math.floor(i / 15)), py(i % 15), 0.07); this.zocalos.setMatrixAt(i, m4); }
    maq.add(this.zocalos);
    this.focos = new T.InstancedMesh(new T.SphereGeometry(0.22, 12, 8), new T.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false }), 90);
    this.halos = new T.InstancedMesh(new T.SphereGeometry(0.36, 12, 8), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false }), 90);
    maq.add(this.focos, this.halos);
    this.pintarFocos = () => {
      let k = 0;
      for (const key of this.luces) { const [a, b] = key.split(',').map(Number); m4.makeTranslation(px(a), py(b), 0.16); this.focos.setMatrixAt(k, m4); this.halos.setMatrixAt(k, m4); k++; }
      this.focos.count = this.halos.count = k;
      this.focos.instanceMatrix.needsUpdate = this.halos.instanceMatrix.needsUpdate = true;
      this.focos.computeBoundingSphere(); this.halos.computeBoundingSphere();
    };
    this.pintarFocos();
    K.clicable(this.zocalos, hit => {
      if (this.bloqueo || hit.instanceId == null) return;
      const key = `${1 + Math.floor(hit.instanceId / 15)},${hit.instanceId % 15}`;
      this.luces.has(key) ? this.luces.delete(key) : this.luces.add(key);
      this.pintarFocos(); K.limpiarMensaje(); K.refrescarMat();
    });
    // ── máquinas viejas
    this.kioscos = {}; this.texK = {};
    [['A', 3.0, 0x2a9d8f], ['B', 6.3, 0x7b5cd6], ['C', 9.6, 0xf4a261]].forEach(([L, x, col]) => {
      const g = K.agregar(new T.Group()); g.position.set(x, 0, 1.2); g.rotation.y = -0.16;
      g.add(K.caja(2.9, 5.8, 1.6, col, [0, 2.9, -0.8]));
      g.add(K.caja(2.75, 2.75, 0.1, 0x1c2b44, [0, 4.1, 0.0]));
      const tex = texCanvas(512, 512, (c, w, h) => dibujarMaquinaVieja(c, w, h, L)); this.texK[L] = tex;
      const p = placa(2.55, 2.55, tex); p.position.set(0, 4.1, 0.06); g.add(p);
      g.add(K.caja(2.2, 0.9, 1.0, 0x1c2b44, [0, 1.5, 0.1]));
      const letra = placa(0.9, 0.9, texCanvas(128, 128, (c, w, h) => { c.fillStyle = '#ffd23f'; c.beginPath(); c.arc(64, 64, 62, 0, 2 * PI); c.fill(); c.fillStyle = '#1c2b44'; c.font = `900 84px ${FUENTE}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(L, 64, 70); }), { transparent: true });
      letra.position.set(0, 1.5, 0.62); g.add(letra);
      g.lbl = K.etiqueta(`${L} · ?`, [0, 6.35, 0], 'claro', g);
      K.clicable(g, () => cam(K, [x - 0.9, 4.3, 8.5], [x, 4.0, 1.0], { min: 3, max: 50 }));
      this.kioscos[L] = g;
    });
    // ── panel
    K.datos([['Entradas', 'de 1 a 6 fichas'], ['Tarifa', '1 ficha → 3 boletos<br>cada ficha más: +2 boletos']]);
    this.grupos = {};
    for (const [L, nom] of [['A', 'tren fantasma'], ['B', 'autitos chocadores'], ['C', 'barco pirata']]) {
      this.grupos[L] = K.opciones(`Máquina ${L} (${nom})`, N1_OPC, { alElegir: v => { this.clasif[L] = v; this.kioscos[L].lbl.texto(`${L} · ${N1_TXT[v]}`); K.limpiarMensaje(); K.refrescarMat(); } });
    }
    const fila = K.h('div', { class: 'grupo-btn' }, boton('Ver toda la sala', () => this.vista()), boton('Acercarme al tablero', () => cam(K, [N1.mx, 6.2, 13], [N1.mx, 6.0, 0], { min: 4, max: 50 })));
    K.controles().append(fila);
    K.html('<span style="font-size:12.5px;color:var(--texto-3)">Tocá una máquina vieja para verla de cerca. En el tablero, cada foco prendido es un par (fichas ; boletos).</span>');
  },
  poner(clasif, luces) {
    for (const L of ['A', 'B', 'C']) { this.clasif[L] = clasif[L]; marcarOpcion(this.grupos[L], N1_OPC.map(o => o[0]), clasif[L]); this.kioscos[L].lbl.texto(`${L} · ${N1_TXT[clasif[L]]}`); }
    this.luces = new Set(luces); this.pintarFocos(); K.refrescarMat();
  },
  comprobar(K) {
    const C = this.clasif;
    const faltan = ['A', 'B', 'C'].filter(k => !C[k]);
    if (faltan.length) return { ok: false, msg: `Primero clasificá ${faltan.length === 1 ? 'la máquina' : 'las máquinas'} ${lista(faltan)}.` };
    if (C.B !== 'f') return { ok: false, msg: 'Revisá la máquina B. Que dos cantidades de fichas den la misma cantidad de boletos, o que sobre un valor de boletos sin flecha, ¿rompe la existencia o la unicidad? Fijate qué le piden esas condiciones a cada <b>entrada</b>.' };
    if (C.A !== 'u') return { ok: false, msg: C.A === 'f' ? 'Revisá la máquina A: buscá si alguna cantidad de fichas aparece más de una vez en la tabla con boletos distintos.' : 'En la máquina A todas las entradas de 1 a 4 tienen al menos una salida: la falla es otra.' };
    if (C.C !== 'e') return { ok: false, msg: C.C === 'f' ? 'Revisá la máquina C: el cartel dice que acepta de 1 a 5 fichas. Pasá una recta vertical por cada entrada permitida: ¿todas cortan al gráfico?' : 'En la máquina C ninguna recta vertical corta al gráfico en dos puntos: la falla es otra.' };
    const sin = [], dos = [], mal = [];
    for (let x = 1; x <= 6; x++) {
      const ys = [...this.luces].filter(k => +k.split(',')[0] === x);
      if (!ys.length) sin.push(x); else if (ys.length > 1) dos.push(x); else if (+ys[0].split(',')[1] !== 2 * x + 1) mal.push(x);
    }
    if (sin.length) return { ok: false, msg: `Las máquinas viejas están bien clasificadas. Pero en el tablero, si un visitante mete ${lista(sin)} ficha${sin.length === 1 && sin[0] === 1 ? '' : 's'}, la boletera no le da nada: falla la <b>existencia</b>.` };
    if (dos.length) return { ok: false, msg: `Las máquinas viejas están bien clasificadas. Pero con ${lista(dos)} fichas la boletera tiene más de un foco prendido: no sabe cuántos boletos dar. Falla la <b>unicidad</b>.` };
    if (mal.length) return { ok: false, msg: `¡Ya es función! Pero no respeta la tarifa: revisá cuántos boletos corresponden a ${lista(mal)} fichas.` };
    return { ok: true, msg: '¡La boletera es una función! Cada cantidad de fichas tiene una única cantidad de boletos.' };
  },
  alResolver(K) {
    this.bloqueo = true;
    const mx = N1.mx, boletos = [];
    for (let i = 0; i < 14; i++) {
      const b = K.agregar(K.caja(0.9, 0.04, 0.45, i % 2 ? 0xff4f8b : 0xffd23f, [mx + (Math.random() - 0.5), 0.55, 0.3]));
      b.userData = { v: new T.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 2, 3 + Math.random() * 2), t0: i * 0.12, w: Math.random() * 6 - 3 };
      b.visible = false; boletos.push(b);
    }
    let t = 0;
    K.tic(dt => {
      t += dt;
      for (const b of boletos) { const u = t - b.userData.t0; if (u < 0) continue; b.visible = true;
        if (b.position.y > 0.05) { b.userData.v.y -= 9 * dt; b.position.addScaledVector(b.userData.v, dt); b.rotation.x += b.userData.w * dt; b.rotation.z += b.userData.w * 0.7 * dt; } else b.position.y = 0.04; }
      const s = 1 + 0.35 * Math.max(0, Math.sin(t * 9));
      this.halos.scale.set(1, 1, 1); this.halos.material.opacity = 0.2 + 0.3 * Math.max(0, Math.sin(t * 9));
      this.focos.material.color.setHSL(0.13, 1, 0.55 + 0.1 * (s - 1));
    });
    cam(K, [0.5, 6.5, 19], [-1.5, 4.5, 0]);
    return 2400;
  },
  pistas: [
    'Una relación es <b>función</b> cuando <b>cada</b> entrada tiene <b>exactamente una</b> salida: ninguna entrada sin salida (existencia) y ninguna con dos o más salidas (unicidad).',
    'En una tabla buscá entradas que falten o que se repitan con salidas distintas. En un gráfico pasá una recta vertical por cada entrada permitida: tiene que cortarlo en un solo punto. Que dos entradas compartan la misma salida <b>no</b> rompe ninguna de las dos condiciones.',
    'En el tablero recorré columna por columna, de 1 a 6 fichas: tiene que quedar un único foco por columna. Usá la tarifa para decidir cuál; por ejemplo, con 2 fichas son 3 + 2 = 5 boletos.',
  ],
  bitacora: [
    '¿Cómo decidiste si cada máquina vieja era función? Escribí qué buscaste en la tabla (A), en el diagrama de flechas (B) y en el gráfico (C).',
    'La máquina B entrega 6 boletos con dos cantidades distintas de fichas. ¿Por qué igual es función? ¿Qué diferencia hay con lo que pasaba en la máquina A?',
    'Escribí la función de la boletera como conjunto de pares ordenados y con una fórmula. ¿Cómo comprobarías, sin mirar la máquina, que ahora cumple existencia y unicidad?',
  ],
  resumenBitacora() { return 'Clasificaste: A <b>no es función</b> (falla la unicidad) · B <b>es función</b> · C <b>no es función</b> (falla la existencia). La boletera quedó con un único foco por columna, según la tarifa.'; },
  mat(K, el) {
    const p = ejes({ xMin: 0, xMax: 7, yMin: 0, yMax: 15, gx: 1, gy: 1, lx: 1, ly: 1, ex: 'fichas', ey: 'boletos', H: 300 });
    el.append(p.svg);
    for (let x = 1; x <= 6; x++) {
      const ys = [...this.luces].filter(k => +k.split(',')[0] === x).map(k => +k.split(',')[1]);
      p.g.append(K.s('line', { x1: p.X(x), x2: p.X(x), y1: p.Y(0), y2: p.Y(15), stroke: '#7b5cd6', 'stroke-width': 1.5, 'stroke-dasharray': '5 4', opacity: 0.6 }));
      p.g.append(K.s('text', { x: p.X(x), y: p.Y(15) + 12, 'text-anchor': 'middle', fill: '#7b5cd6', 'font-size': 10, 'font-weight': 700 }, `${ys.length} corte${ys.length === 1 ? '' : 's'}`));
    }
    for (const k of this.luces) { const [a, b] = k.split(',').map(Number); p.g.append(K.s('circle', { cx: p.X(a), cy: p.Y(b), r: 5.5, fill: '#ff4f8b', stroke: '#1b2333', 'stroke-width': 1.2 })); }
    const pares = [...this.luces].map(k => k.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([a, b]) => `(${a};${b})`).join(', ');
    notaMat(el, `R = { ${pares || '∅'} }`, 'formula');
    notaMat(el, 'Cada recta vertical punteada es una entrada (1 a 6 fichas). Para que R sea función, cada una tiene que cortar al gráfico <b>exactamente una vez</b>.');
    const fila = K.h('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px' });
    for (const L of ['A', 'B', 'C']) {
      const img = K.h('img', { src: this.texK[L].userData.canvas.toDataURL(), alt: `Máquina ${L}`, style: 'width:100%;border-radius:8px;border:1px solid #e6e1d4' });
      fila.append(K.h('div', { style: 'font-size:12px;color:#4b5563;text-align:center' }, img, K.h('div', {}, `Tu clasificación: ${this.clasif[L] ? N1_TXT[this.clasif[L]] : '—'}`)));
    }
    el.append(fila);
  },
  prueba: {
    mal: [
      function () { this.poner({ A: 'u', B: 'u', C: 'e' }, N1_BIEN); },
      function () { this.poner({ A: 'u', B: 'f', C: 'e' }, ['1,3', '2,5', '4,9', '5,11']); },
      function () { this.poner({ A: 'u', B: 'f', C: 'e' }, ['1,3', '2,5', '2,8', '3,7', '4,9', '5,11', '6,13']); },
      function () { this.poner({ A: 'u', B: 'f', C: 'e' }, ['1,3', '2,5', '3,7', '4,9', '5,12', '6,13']); },
    ],
    bien() { this.poner({ A: 'u', B: 'f', C: 'e' }, N1_BIEN); },
  },
};

/* ════════════════════════════════════════════════════════════════════
   NIVEL 2 · La vuelta al mundo (dominio e imagen)
   ════════════════════════════════════════════════════════════════════ */
const N2 = { R: 8, H: 10, MX: 15, RZ: 7, RX0: -12, RS: 1.5 };
const n2h = t => (t < 1 - 1e-9 || t > 15 + 1e-9) ? null : N2.H + N2.R * Math.sin(2 * PI * (t - 1) / 8);
const n2ang = t => 2 * PI * (clamp(t, 1, 15) - 1) / 8;
const numeros = txt => (String(txt).match(/-?\d+(?:[.,]\d+)?/g) || []).map(v => +v.replace(',', '.'));

const nivel2 = {
  titulo: 'La vuelta al mundo',
  relato: 'El inspector hizo la prueba de la vuelta al mundo viajando en la <b>cabina dorada</b>. El registrador de la cabina grabó su <b>altura</b> (en m) sólo mientras la rueda giraba. Para habilitar el juego, la ficha técnica pide el <b>dominio</b> y la <b>imagen</b> de esa función.',
  objetivo: 'Usá el reloj para reproducir el viaje. Marcá el <b>dominio</b> con los banderines rosas del riel del tiempo y la <b>imagen</b> con los cursores azules del altímetro. <b>Tocá</b> un marcador sin arrastrarlo para cambiar entre extremo cerrado ● y abierto ○. Respondé también en qué minutos estuvo en lo más alto.',
  tituloMat: 'h(t): altura de la cabina dorada', subMat: 't en minutos · h en metros',
  armar(K) {
    prepararNivel(K, { sinRueda: true });
    cam(K, [2, 10.5, 42], [2, 9, 0], { suave: false, min: 12, max: 80 });
    const N = this;
    const cols = [0xffc533, 0x5aa9ff, 0x3ddc97, 0xff8a3d, 0xb08cff, 0xff4f8b, 0x5aa9ff, 0x3ddc97]; cols.dorada = true;
    this.rueda = K.agregar(construirRueda(N2.R, 8, cols, N2.H));
    const dor = this.rueda.userData.cabinas[0].cab;
    K.etiqueta('dorada', [0, 1.45, 0], 'acento', dor);
    // indicador de altura (barra horizontal hasta el altímetro)
    this.ind = K.agregar(new T.Mesh(new T.BoxGeometry(1, 0.07, 0.07), new T.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false })));
    this.indPunto = K.agregar(new T.Mesh(new T.SphereGeometry(0.2, 12, 8), new T.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false })));
    // altímetro
    K.agregar(K.caja(1.9, 21, 0.4, 0x1c2b44, [N2.MX, 10.5, 0.2]));
    const alt = placa(1.7, 21, texCanvas(160, 2048, (x, w, h) => {
      x.fillStyle = '#173054'; x.fillRect(0, 0, w, h);
      const cy = m => (21 - m) / 21 * h;
      for (let m = 0; m <= 20; m++) { x.strokeStyle = '#ffffff'; x.lineWidth = m % 2 ? 3 : 5; x.beginPath(); x.moveTo(0, cy(m)); x.lineTo(m % 2 ? 40 : 66, cy(m)); x.stroke();
        if (m % 2 === 0) { x.fillStyle = '#ffffff'; x.font = `800 46px ${FUENTE}`; x.textAlign = 'right'; x.textBaseline = 'middle'; x.fillText(m, w - 10, cy(m)); } }
      x.fillStyle = '#ffd23f'; x.font = `800 30px ${FUENTE}`; x.textAlign = 'center'; x.fillText('m', w / 2 + 20, cy(20.6)); }));
    alt.position.set(N2.MX, 10.5, 0.42); K.agregar(alt);
    // riel del tiempo
    K.agregar(K.caja(27.4, 0.25, 1.4, 0x1c2b44, [0.85, 0.12, N2.RZ]));
    const regla = placa(27.2, 1.1, texCanvas(2048, 84, (x, w, h) => {
      x.fillStyle = '#173054'; x.fillRect(0, 0, w, h);
      const cx = m => (N2.RX0 + m * N2.RS + 12.75) / 27.2 * w;
      for (let m = 0; m <= 16; m++) { x.strokeStyle = '#fff'; x.lineWidth = 4; x.beginPath(); x.moveTo(cx(m), 0); x.lineTo(cx(m), 24); x.stroke();
        x.fillStyle = '#fff'; x.font = `800 44px ${FUENTE}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(m, cx(m), 60); }
      x.fillStyle = '#ffd23f'; x.font = `800 34px ${FUENTE}`; x.textAlign = 'right'; x.fillText('t (min)', w - 8, 56); }));
    regla.position.set(0.85, 0.62, N2.RZ + 0.78); K.agregar(regla);
    K.agregar(K.caja(27.4, 1.2, 0.1, 0x1c2b44, [0.85, 0.6, N2.RZ + 0.72]));
    this.cursorT = K.agregar(new T.Mesh(new T.ConeGeometry(0.3, 0.6, 4), new T.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false })));
    this.cursorT.rotation.x = PI;
    // marcadores
    const marcador = (tipo, color) => {
      const g = new T.Group();
      const cerr = new T.Mesh(new T.SphereGeometry(0.36, 14, 10), K.mat(color, { emissive: color, emissiveIntensity: 0.25 }));
      const abie = new T.Mesh(new T.TorusGeometry(0.32, 0.1, 8, 20), K.mat(color, { emissive: color, emissiveIntensity: 0.25 }));
      if (tipo === 'dom') {
        g.add(K.cilindro(0.08, 0.08, 2.6, 0xffffff, [0, 1.3, 0], 6));
        const ban = new T.Mesh(new T.BufferGeometry().setFromPoints([new T.Vector3(0, 2.4, 0), new T.Vector3(0, 1.6, 0), new T.Vector3(0.9, 2.0, 0)]), K.mat(color, { side: T.DoubleSide }));
        ban.geometry.computeVertexNormals(); g.add(ban);
        cerr.position.y = abie.position.y = 2.85;
      } else {
        g.add(K.caja(2.2, 0.16, 0.45, color, [-1.25, 0, 0]));
        cerr.position.x = abie.position.x = -2.65;
        g.add(K.caja(0.25, 0.5, 0.8, color, [0.15, 0, 0]));
      }
      g.add(cerr, abie);
      g.userData = { cerr, abie, cerrado: false };
      g.ponerCerrado = c => { g.userData.cerrado = c; cerr.visible = c; abie.visible = !c; };
      g.ponerCerrado(false);
      return g;
    };
    const valor = (g, v) => { g.userData.v = v; if (g.userData.tipo === 'dom') g.position.x = N2.RX0 + v * N2.RS; else g.position.y = v; };
    this.valor = valor;
    const hacer = (tipo, color, v) => {
      const g = K.agregar(marcador(tipo, color)); g.userData.tipo = tipo;
      if (tipo === 'dom') g.position.set(0, 0.25, N2.RZ); else g.position.set(N2.MX, 0, 0.75);
      valor(g, v);
      let v0;
      K.arrastrable(g, tipo === 'dom'
        ? { ejes: 'x', snap: 0, alTomar: () => { v0 = g.userData.v; }, alMover: p => { valor(g, clamp(Math.round((p.x - N2.RX0) / N2.RS), 0, 16)); this.actualizar(); }, alSoltar: () => { if (g.userData.v === v0) { g.ponerCerrado(!g.userData.cerrado); this.actualizar(); } } }
        : { ejes: 'y', snap: 0, plano: new T.Vector3(0, 0, 1), alTomar: () => { v0 = g.userData.v; }, alMover: p => { valor(g, clamp(Math.round(p.y), 0, 20)); this.actualizar(); }, alSoltar: () => { if (g.userData.v === v0) { g.ponerCerrado(!g.userData.cerrado); this.actualizar(); } } });
      return g;
    };
    this.dom = [hacer('dom', 0xff4f8b, 3), hacer('dom', 0xff4f8b, 9)];
    this.im = [hacer('im', 0x3b82f6, 5), hacer('im', 0x3b82f6, 13)];
    this.lblReg = K.etiqueta('', [N2.MX, 22.2, 0.5], 'grande');
    // panel
    this.reloj = K.deslizador('Reloj de la prueba', { id: 'n2reloj', min: 0, max: 16, paso: 0.25, valor: 0, formato: v => `${K.fmt(v, 2)} min`, alCambiar: v => { this.play = false; this.ponerT(v); } });
    K.controles().append(K.h('div', { class: 'grupo-btn' }, boton('▶ Reproducir el viaje', () => { this.play = true; if (this.t >= 16) this.t = 0; })));
    this.lectura = K.html('');
    this.inpAlto = campoTexto('¿En qué minuto(s) la dorada estuvo en lo más alto?', { id: 'n2alto', placeholder: 'por ejemplo: 4 y 9' });
    this.inpAlto.addEventListener('input', () => K.limpiarMensaje());
    this.t = 0; this.play = false; let acum = 0;
    K.tic(dt => {
      if (!this.play) return;
      this.t = Math.min(16, this.t + dt * 1.8); this.reloj.poner(Math.round(this.t * 4) / 4);
      acum += dt; this.ponerT(this.t, acum > 0.12); if (acum > 0.12) acum = 0;
      if (this.t >= 16) this.play = false;
    });
    this.ponerT(0); this.actualizar();
  },
  ponerT(t, refrescar = true) {
    this.t = t;
    girarRueda(this.rueda, n2ang(t));
    const a = n2ang(t), cx = N2.R * Math.cos(a), cy = N2.H + N2.R * Math.sin(a), h = n2h(t);
    this.ind.scale.x = Math.max(0.01, N2.MX - 0.9 - cx); this.ind.position.set((cx + N2.MX - 0.9) / 2, cy, 0.9);
    this.indPunto.position.set(cx, cy, 0.95);
    this.cursorT.position.set(N2.RX0 + t * N2.RS, 1.6, N2.RZ + 0.7);
    this.lblReg.texto(h == null ? `t = ${K.fmt(t, 2)} min · sin registro` : `t = ${K.fmt(t, 2)} min · h = ${K.fmt(h, 1)} m`);
    if (refrescar) K.refrescarMat();
  },
  marcas() {
    const [d1, d2] = [...this.dom].sort((a, b) => a.userData.v - b.userData.v), [i1, i2] = [...this.im].sort((a, b) => a.userData.v - b.userData.v);
    return { a: d1.userData.v, b: d2.userData.v, ca: d1.userData.cerrado, cb: d2.userData.cerrado, c: i1.userData.v, d: i2.userData.v, cc: i1.userData.cerrado, cd: i2.userData.cerrado };
  },
  actualizar() {
    const m = this.marcas();
    this.lectura.innerHTML = `<dl class="datos"><dt>Dominio marcado</dt><dd>${iv(m.a, m.b, m.ca, m.cb)}</dd><dt>Imagen marcada</dt><dd>${iv(m.c, m.d, m.cc, m.cd)}</dd></dl>`;
    K.limpiarMensaje(); K.refrescarMat();
  },
  poner({ dom, im, alto }) {
    this.valor(this.dom[0], dom[0]); this.valor(this.dom[1], dom[1]); this.dom[0].ponerCerrado(dom[2]); this.dom[1].ponerCerrado(dom[3]);
    this.valor(this.im[0], im[0]); this.valor(this.im[1], im[1]); this.im[0].ponerCerrado(im[2]); this.im[1].ponerCerrado(im[3]);
    this.inpAlto.value = alto; this.ponerT(3); this.reloj.poner(3); this.actualizar();
  },
  comprobar(K) {
    const { a, b, ca, cb, c, d, cc, cd } = this.marcas();
    if (a === b) return { ok: false, msg: 'Los dos banderines están en el mismo minuto. El dominio es un intervalo de tiempo: ubicá un banderín en cada extremo.' };
    if (a !== 1 || b !== 15) {
      if (a === 0 && b === 16) return { ok: false, msg: 'Marcaste todo el reloj. Pero el registrador sólo grabó mientras la rueda giraba: fuera de ese tiempo la función no tiene valores.' };
      if (a === c && b === d || a === 2 && b === 10 || a === 2 && b === 18) return { ok: false, msg: 'Esos números parecen <b>alturas</b>. El dominio se lee sobre el eje del <b>tiempo</b>: ¿entre qué minutos hay registro?' };
      return { ok: false, msg: `El dominio que marcaste, ${iv(a, b, ca, cb)}, no coincide con el tiempo en que hubo registro. Mové el reloj y fijate en qué minuto empieza a grabar y en cuál deja de hacerlo.` };
    }
    if (!ca || !cb) return { ok: false, msg: `Los extremos del dominio están bien ubicados, pero revisá si son abiertos o cerrados: ¿el registrador tiene una altura justo en t = ${!ca ? 1 : 15}? Si la tiene, ese valor pertenece al dominio.` };
    if (c !== 2 || d !== 18) {
      if (c === 1 && d === 15) return { ok: false, msg: 'Esos números son minutos. La imagen se lee sobre el eje de la <b>altura</b>.' };
      if ((c === 2 && d === 10)) return { ok: false, msg: 'Tomaste la altura del principio y la del final del viaje. La imagen son <b>todas</b> las alturas que tomó la cabina: reproducí el viaje completo y fijate hasta dónde sube y hasta dónde baja.' };
      if (c === 0) return { ok: false, msg: 'La cabina nunca toca el suelo: revisá con el altímetro cuál es la menor altura que registra.' };
      return { ok: false, msg: `La imagen que marcaste, ${iv(c, d, cc, cd)}, no contiene exactamente las alturas registradas. Buscá la menor y la mayor altura de todo el viaje.` };
    }
    if (!cc || !cd) return { ok: false, msg: `Los extremos de la imagen están bien ubicados, pero revisá si son abiertos o cerrados: ¿la dorada llega exactamente a ${!cc ? 2 : 18} m en algún momento?` };
    const ns = [...new Set(numeros(this.inpAlto.value))].sort((x, y) => x - y);
    if (!ns.length) return { ok: false, msg: 'Dominio e imagen correctos. Falta responder en qué minuto(s) la dorada estuvo en lo más alto.' };
    if (ns.length === 1 && ns[0] === 18) return { ok: false, msg: '18 m es la altura máxima: un valor de la <b>imagen</b>. La pregunta es en qué <b>minutos</b> (valores del dominio) se alcanza esa altura.' };
    if (ns.length === 1 && (ns[0] === 3 || ns[0] === 11)) return { ok: false, msg: `En el minuto ${ns[0]} está arriba, sí. ¿Es la única vez? Reproducí todo el viaje.` };
    if (ns.length !== 2 || ns[0] !== 3 || ns[1] !== 11) return { ok: false, msg: 'Revisá los minutos en que la dorada está en lo más alto: mové el reloj y mirá cuándo el altímetro marca la altura máxima.' };
    return { ok: true, msg: `Ficha técnica aprobada: Dom h = [1 ; 15], Im h = [2 ; 18]. La altura máxima se alcanza en t = 3 y en t = 11.` };
  },
  alResolver(K) {
    this.play = false; let t = 0;
    const m = this.rueda.userData.rotor.children.filter(o => o.isMesh && o.geometry.type === 'TorusGeometry');
    K.tic(dt => { t += dt; girarRueda(this.rueda, n2ang(15) + t * 1.4); m.forEach((o, i) => o.material.emissive?.setHSL((t * 0.5 + i * 0.25) % 1, 1, 0.35)); });
    return 2400;
  },
  pistas: [
    'El <b>dominio</b> es el conjunto de valores del tiempo para los que hay registro; la <b>imagen</b>, el conjunto de alturas que efectivamente tomó la cabina.',
    'Mové el reloj hasta que el registrador empiece a grabar y hasta que deje de hacerlo: esos minutos son los extremos del dominio. Para la imagen no alcanza con mirar el principio y el final: buscá la menor y la mayor altura de <b>todo</b> el viaje.',
    'Un extremo va cerrado ● cuando ese valor pertenece al conjunto. Para lo más alto: la rueda tarda 8 minutos en dar una vuelta completa, así que la cabina puede pasar más de una vez por el mismo lugar.',
  ],
  bitacora: [
    '¿Cómo encontraste el dominio y la imagen de h? Contá qué observaste en la escena (reloj, altímetro) y en el gráfico.',
    '¿Por qué la imagen no es el intervalo entre la altura inicial y la final? ¿Por qué los extremos del dominio y de la imagen son cerrados?',
    'La cabina estuvo en lo más alto en dos minutos distintos. ¿Eso contradice que la altura sea función del tiempo? ¿Qué pasaría si en un mismo minuto hubiera dos alturas?',
  ],
  resumenBitacora() { return 'Ficha técnica: Dom h = <b>[1 ; 15]</b> min, Im h = <b>[2 ; 18]</b> m. Altura máxima (18 m) en t = 3 y t = 11.'; },
  mat(K, el) {
    const p = ejes({ xMin: 0, xMax: 16, yMin: 0, yMax: 20, gx: 1, gy: 1, lx: 2, ly: 2, ex: 't (min)', ey: 'h (m)', H: 360 });
    el.append(p.svg);
    const s = K.s, m = this.marcas();
    let d = ''; for (let t = 1; t <= 15.0001; t += 0.05) d += (d ? 'L' : 'M') + p.X(t).toFixed(1) + ',' + p.Y(n2h(Math.min(t, 15))).toFixed(1);
    p.g.append(s('path', { d, fill: 'none', stroke: '#1b2333', 'stroke-width': 2.4 }));
    p.g.append(s('circle', { cx: p.X(1), cy: p.Y(10), r: 4, fill: '#1b2333' }), s('circle', { cx: p.X(15), cy: p.Y(2), r: 4, fill: '#1b2333' }));
    const ext = (x, y, cerrado, col) => s('circle', { cx: x, cy: y, r: 6, fill: cerrado ? col : '#fff', stroke: col, 'stroke-width': 2.5 });
    p.g.append(s('line', { x1: p.X(m.a), x2: p.X(m.b), y1: p.Y(0), y2: p.Y(0), stroke: '#ff4f8b', 'stroke-width': 6, opacity: 0.8 }), ext(p.X(m.a), p.Y(0), m.ca, '#ff4f8b'), ext(p.X(m.b), p.Y(0), m.cb, '#ff4f8b'));
    p.g.append(s('line', { x1: p.X(0), x2: p.X(0), y1: p.Y(m.c), y2: p.Y(m.d), stroke: '#3b82f6', 'stroke-width': 6, opacity: 0.8 }), ext(p.X(0), p.Y(m.c), m.cc, '#3b82f6'), ext(p.X(0), p.Y(m.d), m.cd, '#3b82f6'));
    const h = n2h(this.t);
    if (h != null) {
      p.g.append(s('line', { x1: p.X(this.t), x2: p.X(this.t), y1: p.Y(0), y2: p.Y(h), stroke: '#d4a300', 'stroke-dasharray': '4 3', 'stroke-width': 1.5 }));
      p.g.append(s('line', { x1: p.X(0), x2: p.X(this.t), y1: p.Y(h), y2: p.Y(h), stroke: '#d4a300', 'stroke-dasharray': '4 3', 'stroke-width': 1.5 }));
      p.g.append(s('circle', { cx: p.X(this.t), cy: p.Y(h), r: 6.5, fill: '#ffc533', stroke: '#1b2333', 'stroke-width': 1.5 }));
    }
    notaMat(el, `<span style="color:#d6336c">Dom marcado = ${iv(m.a, m.b, m.ca, m.cb)}</span> &nbsp;·&nbsp; <span style="color:#2563eb">Im marcada = ${iv(m.c, m.d, m.cc, m.cd)}</span>`, 'formula');
    notaMat(el, h == null ? `t = ${K.fmt(this.t, 2)} min: <b>sin registro</b>, ese tiempo no pertenece al dominio.` : `t = ${K.fmt(this.t, 2)} min → h(t) ≈ ${K.fmt(h, 1)} m. El punto amarillo es la cabina dorada en el gráfico.`);
    notaMat(el, 'El dominio se marca sobre el eje horizontal (tiempo) y la imagen sobre el eje vertical (altura). ● extremo incluido · ○ extremo excluido.');
  },
  prueba: {
    mal: [
      function () { this.poner({ dom: [1, 15, true, true], im: [2, 10, true, true], alto: '3 y 11' }); },
      function () { this.poner({ dom: [0, 16, true, true], im: [2, 18, true, true], alto: '3 y 11' }); },
      function () { this.poner({ dom: [1, 15, false, false], im: [2, 18, true, true], alto: '3 y 11' }); },
      function () { this.poner({ dom: [1, 15, true, true], im: [2, 18, true, true], alto: '18' }); },
    ],
    bien() { this.poner({ dom: [1, 15, true, true], im: [2, 18, true, true], alto: '3 y 11' }); },
  },
};

/* ════════════════════════════════════════════════════════════════════
   NIVEL 3 · La montaña rusa del túnel (ceros, signo, monotonía, extremos)
   ════════════════════════════════════════════════════════════════════ */
const N3 = { X0: -15, XS: 0.3, Y0: 8, Z: 1.0, MIN: -5, MAX: 9 };
const N3_INI = [2, 4, 6, 5, 3, 1, -1, -2, 0, 1, 2];
const N3_BIEN = [2, 4, 6, 8, 5, 0, -2, -4, -2, 0, 2];
const n3X = x => N3.X0 + x * N3.XS, n3Y = h => N3.Y0 + h;
const n3f = (alt, x) => { const i = Math.min(9, Math.floor(x / 10)), u = (x - 10 * i) / 10; return alt[i] + (alt[i + 1] - alt[i]) * u; };
const fq = (n, d = 1) => { const f = K.frac(n, d); return f.d === 1 ? neg(f.n) : (100 % f.d === 0 || 10 % f.d === 0 ? K.fmt(f.n / f.d, 2) : `${f.n}/${f.d}`); };
/** Analiza la pista (alturas en x = 0, 10, …, 100). Exacto: los ceros entre puntos son fracciones. */
function analizarPista(alt) {
  const ceros = [], tramosCero = [];
  for (let i = 0; i <= 10; i++) if (alt[i] === 0) ceros.push({ n: 10 * i, d: 1 });
  for (let i = 0; i < 10; i++) {
    const a = alt[i], b = alt[i + 1];
    if (a * b < 0) ceros.push(K.frac(10 * i * (a - b) + 10 * a, a - b));
    if (a === 0 && b === 0) tramosCero.push([10 * i, 10 * i + 10]);
  }
  ceros.sort((p, q) => p.n / p.d - q.n / q.d);
  const val = q => q.n / q.d;
  // signo entre puntos de corte
  const cortes = [{ n: 0, d: 1 }, ...ceros.filter(c => val(c) > 0 && val(c) < 100), { n: 100, d: 1 }];
  const pos = [], neg = [];
  for (let k = 0; k < cortes.length - 1; k++) {
    const p = cortes[k], q = cortes[k + 1], m = (val(p) + val(q)) / 2, s = n3f(alt, m);
    if (Math.abs(s) < 1e-9) continue;
    const ca = val(p) === 0 && alt[0] !== 0, cb = val(q) === 100 && alt[10] !== 0;
    (s > 0 ? pos : neg).push({ a: p, b: q, ca, cb });
  }
  const fmtI = I => I.length ? I.map(z => iv(fq(z.a.n, z.a.d), fq(z.b.n, z.b.d), z.ca, z.cb)).join(' ∪ ') : '∅';
  // monotonía
  const crece = [], decrece = [], cte = [];
  let i = 0;
  while (i < 10) { const sg = Math.sign(alt[i + 1] - alt[i]); let j = i; while (j < 10 && Math.sign(alt[j + 1] - alt[j]) === sg) j++; (sg > 0 ? crece : sg < 0 ? decrece : cte).push([10 * i, 10 * j]); i = j; }
  const fmtM = I => I.length ? I.map(([a, b]) => `(${a} ; ${b})`).join(' ∪ ') : '∅';
  const M = Math.max(...alt), m = Math.min(...alt);
  const donde = v => alt.map((h, k) => h === v ? 10 * k : null).filter(x => x != null);
  return { ceros, tramosCero, pos, neg, crece, decrece, cte, M, m, xM: donde(M), xm: donde(m),
    txtCeros: tramosCero.length ? 'infinitos (hay tramos sobre el suelo)' : ceros.length ? `{ ${ceros.map(c => fq(c.n, c.d)).join(' ; ')} }` : '∅',
    txtPos: fmtI(pos), txtNeg: fmtI(neg), txtCrece: fmtM(crece), txtDecrece: fmtM(decrece), txtCte: fmtM(cte) };
}
function leerIntervalo(txt) {
  const m = String(txt).trim().replace(/\s+/g, '').match(/^([\[\(])(-?\d+(?:[.,]\d+)?)[;,](-?\d+(?:[.,]\d+)?)([\]\)])$/);
  if (!m) return null;
  return { a: +m[2].replace(',', '.'), b: +m[3].replace(',', '.'), ca: m[1] === '[', cb: m[4] === ']' };
}

const nivel3 = {
  titulo: 'La montaña rusa del túnel',
  relato: 'La montaña rusa sale de la estación, sube a la cima, se mete en un <b>túnel bajo tierra</b> y vuelve a la superficie. El ingeniero dejó el pedido para la función <b>f</b>: altura de la pista respecto del nivel del suelo (en m) según la distancia horizontal <b>x</b> desde la estación (en m). Lo ves en corte, como una maqueta.',
  objetivo: 'Arrastrá hacia arriba o hacia abajo los 11 puntos de control (uno cada 10 m) hasta que la pista cumpla <b>todo</b> el pedido. Después respondé: ¿en qué intervalo el carrito va <b>bajo tierra y bajando</b> a la vez?',
  tituloMat: 'f(x): altura de la pista', subMat: 'x en m desde la estación · f(x) en m respecto del suelo',
  armar(K) {
    prepararNivel(K, { sinMontana: true });
    cam(K, [1.5, 11.5, 44], [1.5, 9.6, 0], { suave: false, min: 10, max: 80 });
    this.alt = [...N3_INI];
    // colina en corte
    const tierra = K.mat(0x9a6a43), pasto = K.mat(0x7cc46a);
    const colina = new T.Mesh(new T.BoxGeometry(46, N3.Y0, 26), [tierra, tierra, pasto, tierra, tierra, tierra]);
    colina.position.set(0, N3.Y0 / 2, -13); colina.receiveShadow = colina.castShadow = true; K.agregar(colina);
    const corte = placa(46, N3.Y0, texCanvas(1024, 180, (x, w, h) => {
      const capas = ['#5fae55', '#a8784c', '#946540', '#7e5434', '#6a462c', '#573823'];
      const lim = [0, 7, 32, 70, 112, 150, 180];
      for (let k = 0; k < 6; k++) { x.fillStyle = capas[k]; x.beginPath(); x.moveTo(0, lim[k]); for (let i = 0; i <= 20; i++) x.lineTo(i * w / 20, lim[k] + (k ? Math.sin(i * 1.7 + k) * 4 : 0)); x.lineTo(w, h); x.lineTo(0, h); x.fill(); }
      const r = azar(3); x.fillStyle = 'rgba(60,40,25,.55)';
      for (let i = 0; i < 70; i++) { x.beginPath(); x.ellipse(r() * w, 20 + r() * (h - 25), 3 + r() * 9, 2 + r() * 5, r() * 3, 0, 2 * PI); x.fill(); } }));
    corte.position.set(0, N3.Y0 / 2, 0.01); K.agregar(corte);
    K.agregar(K.caja(46, 0.24, 1.3, 0x7cc46a, [0, N3.Y0 - 0.12, N3.Z]));
    // estaciones a 2 m
    for (const [x, sx, txt] of [[0, -1, 'SALIDA'], [100, 1, 'LLEGADA']]) {
      const g = K.agregar(new T.Group()); g.position.set(n3X(x) + sx * 2.1, N3.Y0, N3.Z - 0.3);
      g.add(K.caja(3.6, 2, 3.2, 0xd6336c, [0, 1, 0]));
      for (const a of [-1.5, 1.5]) for (const b of [-1.3, 1.3]) g.add(K.cilindro(0.1, 0.1, 2.6, 0xffffff, [a, 3.3, b], 6));
      g.add(K.caja(4.2, 0.3, 3.8, 0xffd23f, [0, 4.7, 0]));
      const c = placa(3.4, 0.7, texCanvas(256, 52, (k, w, h) => { k.fillStyle = '#1c2b44'; k.fillRect(0, 0, w, h); k.fillStyle = '#ffd23f'; k.font = `900 34px ${FUENTE}`; k.textAlign = 'center'; k.textBaseline = 'middle'; k.fillText(txt, w / 2, h / 2 + 2); }));
      c.position.set(0, 4.25, 1.75); g.add(c);
    }
    // grilla de la maqueta
    const pts = [];
    for (let x = 0; x <= 100; x += 10) pts.push(new T.Vector3(n3X(x), n3Y(N3.MIN), 0.06), new T.Vector3(n3X(x), n3Y(N3.MAX), 0.06));
    for (let h = N3.MIN; h <= N3.MAX; h++) pts.push(new T.Vector3(n3X(0), n3Y(h), 0.06), new T.Vector3(n3X(100), n3Y(h), 0.06));
    this.grilla = K.agregar(new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 })));
    for (let x = 0; x <= 100; x += 10) K.etiqueta(String(x), [n3X(x), n3Y(N3.MIN) - 0.7, 1.4], '');
    K.etiqueta('x (m)', [n3X(100) + 2.2, n3Y(N3.MIN) - 0.7, 1.4], 'acento');
    for (let h = -4; h <= 8; h += 2) K.etiqueta(neg(h), [n3X(100) + 4.4, n3Y(h), 0.6], h === 0 ? 'acento' : '');
    K.etiqueta('f (m)', [n3X(100) + 4.4, n3Y(9.4), 0.6], 'acento');
    K.etiqueta('suelo · 0 m', [n3X(0) - 5.2, n3Y(0) + 0.35, 1.2], 'claro');
    // pista, puntos y carrito
    this.pista = K.agregar(new T.Group());
    this.puntos = [];
    this.lblPto = K.etiqueta('', [0, 0, 0], 'acento'); this.lblPto.visible = false;
    for (let i = 0; i <= 10; i++) {
      const s = K.agregar(K.esfera(0.42, 0xff4f8b, [n3X(10 * i), n3Y(this.alt[i]), N3.Z + 0.1], { emissive: 0xff4f8b, emissiveIntensity: 0.35 }));
      K.arrastrable(s, { ejes: 'y', snap: 0, plano: new T.Vector3(0, 0, 1),
        alTomar: () => { this.correr = false; },
        alMover: p => { const h = clamp(Math.round(p.y - N3.Y0), N3.MIN, N3.MAX); s.position.y = n3Y(h); if (this.alt[i] !== h) { this.alt[i] = h; this.reconstruir(); }
          this.lblPto.visible = true; this.lblPto.position.set(n3X(10 * i), n3Y(h) + 1.1, N3.Z); this.lblPto.texto(`f(${10 * i}) = ${neg(h)}`); },
        alSoltar: () => { this.lblPto.visible = false; } });
      this.puntos.push(s);
    }
    this.carrito = K.agregar(construirCarrito());
    this.lblCarro = K.etiqueta('', [0, 0, 0], 'claro'); this.lblCarro.visible = false;
    this.u = 0; this.correr = false; let acum = 0;
    K.tic(dt => {
      if (!this.correr) return;
      this.u = Math.min(100, this.u + dt * 14);
      this.ubicarCarrito(this.u);
      acum += dt; if (acum > 0.1) { acum = 0; this.moverPuntoMat(); }
      if (this.u >= 100) { this.correr = false; setTimeout(() => { this.lblCarro.visible = false; }, 900); }
    });
    // panel
    K.datos([['Dom f', '[0 ; 100]'], ['Estaciones', 'f(0) = f(100) = 2'], ['C⁰', '{50 ; 90}'], ['C⁺', '[0 ; 50) ∪ (90 ; 100]'], ['Crece', '(0 ; 30) ∪ (70 ; 100)'], ['Decrece', '(30 ; 70)'], ['Máximo', '8 m, sólo en x = 30'], ['Mínimo', '−4 m, sólo en x = 70']]);
    K.controles().append(K.h('div', { class: 'grupo-btn' }, boton('▶ Probar el recorrido', () => { this.u = 0; this.correr = true; this.lblCarro.visible = true; }), boton('Volver a la pista inicial', () => { this.ponerAlturas(N3_INI); })));
    this.inp = campoTexto('Bajo tierra <b>y</b> bajando: ¿en qué intervalo de x?', { id: 'n3int', placeholder: 'escribí un intervalo, ej.: (10 ; 25]' });
    this.inp.addEventListener('input', () => K.limpiarMensaje());
    this.reconstruir();
  },
  alCambiarModo(K, esMat) { this.grilla.material.opacity = esMat ? 0.75 : 0.3; },
  ponerAlturas(a) { this.alt = [...a]; this.puntos.forEach((s, i) => { s.position.y = n3Y(this.alt[i]); }); this.reconstruir(); },
  ubicarCarrito(u) {
    const h = n3f(this.alt, u), i = Math.min(9, Math.floor(u / 10));
    const ang = Math.atan2(this.alt[i + 1] - this.alt[i], 10 * N3.XS);
    this.carrito.position.set(n3X(u) - Math.sin(ang) * 0.42, n3Y(h) + Math.cos(ang) * 0.42 + 0.05, N3.Z);
    this.carrito.rotation.z = ang;
    const dir = this.alt[i + 1] > this.alt[i] ? 'subiendo' : this.alt[i + 1] < this.alt[i] ? 'bajando' : 'plano';
    this.lblCarro.position.set(n3X(u), n3Y(h) + 2.0, N3.Z); this.lblCarro.texto(`x = ${Math.round(u)} m · ${K.fmt(h, 1)} m · ${dir}${h < 0 ? ' · túnel' : ''}`);
  },
  reconstruir() {
    const g = this.pista;
    while (g.children.length) { const o = g.children.pop(); o.traverse(c => { c.geometry?.dispose(); [].concat(c.material || []).forEach(m => m.dispose()); }); }
    const A = this.alt, Z = N3.Z;
    for (let i = 0; i < 10; i++) {
      const x1 = n3X(10 * i), x2 = n3X(10 * i + 10), y1 = n3Y(A[i]), y2 = n3Y(A[i + 1]);
      for (const dz of [-0.28, 0.28]) g.add(K.barra([x1, y1, Z + dz], [x2, y2, Z + dz], 0.07, 0xe9edf5));
      g.add(K.barra([x1, y1 - 0.18, Z], [x2, y2 - 0.18, Z], 0.11, 0xd6336c));
      for (let k = 0; k < 4; k++) { const u = (k + 0.5) / 4; const tr = K.caja(0.12, 0.08, 0.8, 0x6b4a2b, [x1 + (x2 - x1) * u, y1 + (y2 - y1) * u - 0.06, Z]); tr.rotation.z = Math.atan2(y2 - y1, x2 - x1); g.add(tr); }
      // túnel: tramo bajo tierra
      const a = A[i], b = A[i + 1];
      if (a < 0 || b < 0) {
        let ua = 0, ub = 1;
        if (a >= 0) ua = a / (a - b); if (b >= 0) ub = a / (a - b);
        if (ub - ua > 1e-6) {
          const xa = x1 + (x2 - x1) * ua, xb = x1 + (x2 - x1) * ub, ya = y1 + (y2 - y1) * ua, yb = y1 + (y2 - y1) * ub, z = 0.05;
          const v = [xa, Math.min(ya + 0.75, N3.Y0), z, xb, Math.min(yb + 0.75, N3.Y0), z, xb, yb - 0.75, z, xa, Math.min(ya + 0.75, N3.Y0), z, xb, yb - 0.75, z, xa, ya - 0.75, z];
          const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(v, 3));
          g.add(new T.Mesh(geo, new T.MeshBasicMaterial({ color: 0x2a1d16, side: T.DoubleSide })));
        }
      }
    }
    for (let i = 0; i <= 10; i++) if (A[i] > 0) {
      const x = n3X(10 * i);
      g.add(K.cilindro(0.1, 0.12, A[i] - 0.15, 0xffffff, [x, N3.Y0 + (A[i] - 0.15) / 2, Z], 6));
    }
    // carrito al principio
    if (!this.correr) this.ubicarCarrito(0);
    K.limpiarMensaje(); K.refrescarMat();
  },
  moverPuntoMat() {
    if (!this._mat || !K.modoMat) return;
    const { X, Y, pt } = this._mat; pt.setAttribute('cx', X(this.u)); pt.setAttribute('cy', Y(n3f(this.alt, this.u))); pt.setAttribute('visibility', 'visible');
  },
  comprobar(K) {
    const A = this.alt, an = analizarPista(A);
    if (A[0] !== 2 || A[10] !== 2) return { ok: false, msg: `Las estaciones de salida y de llegada están a 2 m: f(0) y f(100) tienen que valer 2. Ahora f(0) = ${neg(A[0])} y f(100) = ${neg(A[10])}.` };
    if (an.tramosCero.length) return { ok: false, msg: 'Tu pista tiene un tramo plano justo sobre el nivel del suelo: ahí habría infinitos ceros. El pedido es C⁰ = {50 ; 90}.' };
    const zs = an.ceros.map(c => c.n / c.d);
    if (zs.length !== 2 || zs[0] !== 50 || zs[1] !== 90) return { ok: false, msg: `Tu pista cruza o toca el nivel del suelo en x ∈ ${an.txtCeros}. El pedido es C⁰ = {50 ; 90}. Ojo: entre dos puntos de control con signos distintos también hay un cero.` };
    if (!(A[6] < 0 && A[7] < 0 && A[8] < 0)) return { ok: false, msg: 'Los ceros están bien, pero entre x = 50 y x = 90 la pista tiene que ir por el túnel: ahí f tiene que ser negativa (C⁺ no incluye ese tramo).' };
    if (!A.slice(1, 5).every(h => h > 0)) return { ok: false, msg: 'Antes de x = 50 la pista tiene que ir siempre por arriba del suelo: C⁺ = [0 ; 50) ∪ (90 ; 100].' };
    if (an.M !== 8 || an.xM.length !== 1 || an.xM[0] !== 30) return { ok: false, msg: `Tu punto más alto está a ${neg(an.M)} m, en x = ${lista(an.xM)}. El pedido: máximo de 8 m, alcanzado sólo en x = 30.` };
    if (an.m !== -4 || an.xm.length !== 1 || an.xm[0] !== 70) return { ok: false, msg: `Tu punto más bajo está a ${neg(an.m)} m, en x = ${lista(an.xm)}. El pedido: mínimo de −4 m, alcanzado sólo en x = 70.` };
    const tramo = (i, debe) => { const d = A[i + 1] - A[i]; return debe > 0 ? d > 0 : d < 0; };
    for (let i = 0; i < 10; i++) {
      const debe = i < 3 || i >= 7 ? 1 : -1;
      if (!tramo(i, debe)) {
        const d = A[i + 1] - A[i];
        return { ok: false, msg: `Entre x = ${10 * i} y x = ${10 * i + 10} la pista ${d === 0 ? 'es plana (constante)' : d > 0 ? 'sube' : 'baja'}, pero según el pedido ahí f tiene que ${debe > 0 ? 'crecer' : 'decrecer'}.` };
      }
    }
    const r = leerIntervalo(this.inp.value);
    if (!this.inp.value.trim()) return { ok: false, msg: '¡La pista cumple todo el pedido! Falta responder en qué intervalo el carrito va bajo tierra y bajando.' };
    if (!r) return { ok: false, msg: 'No entiendo el intervalo. Escribilo con paréntesis o corchetes y punto y coma, por ejemplo (10 ; 25].' };
    if (r.a === 50 && r.b === 90) return { ok: false, msg: 'Ese es todo el túnel (C⁻). Pero en una parte del túnel el carrito sube: ¿dónde deja de bajar?' };
    if (r.a === 30 && r.b === 70) return { ok: false, msg: 'Ese es el intervalo en que la pista decrece, pero una parte va por arriba del suelo.' };
    if (r.a !== 50 || r.b !== 70) return { ok: false, msg: 'Buscá los valores de x que están a la vez en C⁻ (bajo tierra) y en el intervalo de decrecimiento.' };
    if (r.ca || r.cb) return { ok: false, msg: `Los números están bien; revisá los extremos. ${r.ca ? 'En x = 50 el carrito está justo a nivel del suelo: ¿está bajo tierra?' : 'En x = 70 está el punto más bajo: ahí deja de bajar; los intervalos de decrecimiento se escriben abiertos.'}` };
    return { ok: true, msg: '¡Pista aprobada! Cumple ceros, signo, crecimiento y extremos. Bajo tierra y bajando: (50 ; 70).' };
  },
  alResolver(K) { this.u = 0; this.correr = true; this.lblCarro.visible = true; cam(K, [1.5, 10.5, 38], [1.5, 9.6, 0]); return 3200; },
  pistas: [
    'Leé el pedido como un mapa: C⁰ dice dónde la pista corta el nivel del suelo; C⁺, dónde va por arriba; en el resto del dominio va por el túnel (C⁻).',
    'Empezá por los puntos fijos: las estaciones (x = 0 y x = 100), la cima (máximo) y el fondo del túnel (mínimo). Después completá los demás puntos respetando dónde tiene que subir y dónde bajar, sin tramos planos.',
    'Ojo con los cruces entre dos puntos de control: si en x = 40 la pista está a 1 m y en x = 50 a −1 m, el cero queda en x = 45. Para la pregunta, buscá los x que están en C⁻ y también en el intervalo de decrecimiento.',
  ],
  bitacora: [
    '¿En qué orden ubicaste los puntos de control y por qué? ¿Qué condición del pedido te sirvió para cada uno?',
    'Explicá con tus palabras qué significan C⁰, C⁺ y C⁻ en la montaña rusa. ¿Por qué el intervalo «bajo tierra y bajando» tiene extremos abiertos?',
    '¿Cómo comprobaste que tu pista tiene un único máximo y un único mínimo? ¿Habría otra pista distinta que también cumpla todo? Dibujala y comparala con la tuya.',
  ],
  resumenBitacora() { const A = this.alt; return `Tu pista: f(0), f(10), …, f(100) = ${A.map(neg).join(' ; ')}. C⁰ = {50 ; 90}, C⁻ = (50 ; 90). Bajo tierra y bajando: <b>(50 ; 70)</b>.`; },
  mat(K, el) {
    const p = ejes({ xMin: 0, xMax: 100, yMin: -5, yMax: 9, gx: 10, gy: 1, lx: 10, ly: 1, ex: 'x (m)', ey: 'f(x) (m)', H: 330 });
    el.append(p.svg);
    const s = K.s, A = this.alt, an = analizarPista(A);
    // sombreado de signo
    const area = (I, col) => I.forEach(z => {
      const a = z.a.n / z.a.d, b = z.b.n / z.b.d, xs = [a];
      for (let x = 0; x <= 100; x += 10) if (x > a + 1e-9 && x < b - 1e-9) xs.push(x);
      xs.push(b);
      const d = `M${p.X(a)},${p.Y(0)}` + xs.map(x => `L${p.X(x)},${p.Y(n3f(A, x))}`).join('') + `L${p.X(b)},${p.Y(0)}Z`;
      p.g.append(s('path', { d, fill: col, opacity: 0.22 }));
    });
    area(an.pos, '#3ddc97'); area(an.neg, '#ff5d6c');
    p.g.append(s('polyline', { points: A.map((h, i) => `${p.X(10 * i)},${p.Y(h)}`).join(' '), fill: 'none', stroke: '#d6336c', 'stroke-width': 2.6 }));
    A.forEach((h, i) => p.g.append(s('circle', { cx: p.X(10 * i), cy: p.Y(h), r: 3.5, fill: '#d6336c' })));
    an.ceros.forEach(c => p.g.append(s('circle', { cx: p.X(c.n / c.d), cy: p.Y(0), r: 5, fill: '#fff', stroke: '#1b2333', 'stroke-width': 2 })));
    const pt = s('circle', { cx: 0, cy: 0, r: 7, fill: '#ffd23f', stroke: '#1b2333', 'stroke-width': 1.5, visibility: this.correr ? 'visible' : 'hidden' });
    p.g.append(pt); this._mat = { X: p.X, Y: p.Y, pt }; this.moverPuntoMat();
    const dl = K.h('dl', { class: 'datos', style: 'background:#f2efe6;color:#1b2333;font-size:13px' });
    const fila = (k, v) => dl.append(K.h('dt', { style: 'color:#6b7280' }, k), K.h('dd', { html: v }));
    fila('Tu C⁰', an.txtCeros); fila('Tu C⁺', `<span style="color:#15803d">${an.txtPos}</span>`); fila('Tu C⁻', `<span style="color:#be123c">${an.txtNeg}</span>`);
    fila('Crece en', an.txtCrece); fila('Decrece en', an.txtDecrece); if (an.cte.length) fila('Constante en', an.txtCte);
    fila('Máximo', `${neg(an.M)} m en x = ${lista(an.xM)}`); fila('Mínimo', `${neg(an.m)} m en x = ${lista(an.xm)}`);
    el.append(dl);
    notaMat(el, 'Esta es la lectura de <b>tu</b> pista, calculada en vivo. Comparala con el pedido del ingeniero que está en el panel.');
  },
  prueba: {
    mal: [
      function () { this.ponerAlturas(N3_INI); this.inp.value = '(50;70)'; },
      function () { this.ponerAlturas([2, 4, 6, 8, 4, 1, -1, -4, -2, 0, 2]); this.inp.value = '(50;70)'; },
      function () { this.ponerAlturas([2, 4, 6, 8, 5, 0, -2, -4, -4, 0, 2]); this.inp.value = '(50;70)'; },
      function () { this.ponerAlturas(N3_BIEN); this.inp.value = '[50;70]'; },
      function () { this.ponerAlturas(N3_BIEN); this.inp.value = '(50;90)'; },
    ],
    bien() { this.ponerAlturas(N3_BIEN); this.inp.value = '(50 ; 70)'; },
  },
};

/* ════════════════════════════════════════════════════════════════════
   NIVEL 4 · Festival nocturno (integrador: leer el gráfico y decidir)
   ════════════════════════════════════════════════════════════════════ */
// P(t) en cientos de personas; t en horas. Vértices en cuartos de hora desde las 18.
const N4_V = [[0, 0], [8, 8], [12, 8], [14, 6], [18, 12], [20, 12], [24, 0]];
const n4P = q => { for (let k = 0; k < N4_V.length - 1; k++) { const [q1, p1] = N4_V[k], [q2, p2] = N4_V[k + 1]; if (q <= q2 + 1e-9) return p1 + (p2 - p1) * (q - q1) / (q2 - q1); } return 0; };
const n4h = q => hhmm(18 + q / 4), n4pers = q => Math.round(n4P(q) * 100);
const N4 = { BW: 16, BH: 8, BY: 7.6, BZ: -4.5, L: 90, R: 990, T: 40, B: 440, CW: 1024, CH: 512 };
const n4X = q => -N4.BW / 2 + (N4.L + (q / 24) * (N4.R - N4.L)) * N4.BW / N4.CW;
const n4Y = P => N4.BY + N4.BH / 2 - (N4.B - P / 14 * (N4.B - N4.T)) * N4.BH / N4.CH;
const N4_FICHAS = [
  { k: 'on', fila: 0, col: 0xffd23f, txt: 'enciende' }, { k: 'off', fila: 0, col: 0x8a7a3a, txt: 'apaga' },
  { k: 'ab', fila: 1, col: 0xff8a3d, txt: 'abren' }, { k: 'ce', fila: 1, col: 0x9a5a2d, txt: 'cierran' },
  { k: 'fu', fila: 2, col: 0xff4fd8, txt: 'fuegos' },
];
const N4_FILAS = [3.3, 2.2, 1.1];

const nivel4 = {
  titulo: 'Festival nocturno',
  relato: 'Esta noche hay festival. El tablero muestra el pronóstico de la venta de entradas: <b>P(t)</b>, la cantidad de personas en el parque (en cientos) según la hora t, de 18 a 24 h. La dirección te dejó tres órdenes y vos programás el parque.',
  objetivo: 'Arrastrá cada ficha por su riel hasta la hora exacta (de a 15 min) que cumple la orden. Mové el reloj o simulá la noche para ver las consecuencias de tus decisiones en el parque.',
  tituloMat: 'P(t): personas en el parque', subMat: 't en horas · P en cientos de personas',
  armar(K) {
    prepararNivel(K);
    cieloNoche(K); deco.matFoco.color.set(0xffffff); deco.matFarol.color.set(0xffe9a8);
    K.alLimpiar(() => cieloDia(K));
    cam(K, [1.5, 9.5, 31], [1.5, 5.5, 0], { suave: false, min: 8, max: 70 });
    this.q = { on: 0, off: 24, ab: 0, ce: 24, fu: 12 };
    // estrellas
    { const r = azar(11), n = 400, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const a = r() * 2 * PI, e = 0.15 + r() * 1.2, d = 300; pos.set([Math.cos(a) * Math.cos(e) * d, Math.sin(e) * d, Math.sin(a) * Math.cos(e) * d], i * 3); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
      K.agregar(new T.Points(g, new T.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false }))); }
    // tablero con el gráfico
    const tex = texCanvas(N4.CW, N4.CH, (x, w, h) => {
      const X = q => N4.L + q / 24 * (N4.R - N4.L), Y = P => N4.B - P / 14 * (N4.B - N4.T);
      x.fillStyle = '#0f1b2d'; x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(255,255,255,.09)'; x.lineWidth = 1.5;
      for (let q = 0; q <= 24; q++) { x.beginPath(); x.moveTo(X(q), Y(0)); x.lineTo(X(q), Y(14)); x.stroke(); }
      for (let P = 0; P <= 14; P++) { x.beginPath(); x.moveTo(X(0), Y(P)); x.lineTo(X(24), Y(P)); x.stroke(); }
      x.strokeStyle = 'rgba(255,255,255,.22)'; for (let q = 0; q <= 24; q += 4) { x.beginPath(); x.moveTo(X(q), Y(0)); x.lineTo(X(q), Y(14)); x.stroke(); }
      x.strokeStyle = '#fff'; x.lineWidth = 3; x.beginPath(); x.moveTo(X(0), Y(14.3)); x.lineTo(X(0), Y(0)); x.lineTo(X(24.3), Y(0)); x.stroke();
      x.fillStyle = '#fff'; x.font = `700 24px ${FUENTE}`; x.textAlign = 'center'; x.textBaseline = 'top';
      for (let q = 0; q <= 24; q += 4) x.fillText(`${18 + q / 4} h`, X(q), Y(0) + 10);
      x.textAlign = 'right'; x.textBaseline = 'middle'; for (let P = 0; P <= 14; P += 2) x.fillText(P, X(0) - 10, Y(P));
      x.textAlign = 'left'; x.fillStyle = '#ffd23f'; x.font = `800 24px ${FUENTE}`; x.fillText('P (cientos de personas)', X(0) + 10, Y(14) - 4);
      x.strokeStyle = '#ff4f8b'; x.lineWidth = 7; x.lineJoin = 'round'; x.beginPath(); N4_V.forEach(([q, P], i) => i ? x.lineTo(X(q), Y(P)) : x.moveTo(X(q), Y(P))); x.stroke();
      x.fillStyle = '#ff4f8b'; N4_V.forEach(([q, P]) => { x.beginPath(); x.arc(X(q), Y(P), 7, 0, 2 * PI); x.fill(); });
    });
    this.texTablero = tex;
    const tb = placa(N4.BW, N4.BH, tex); tb.position.set(0, N4.BY, N4.BZ + 0.16); K.agregar(tb);
    K.agregar(K.caja(N4.BW + 0.8, N4.BH + 0.8, 0.3, 0xff4f8b, [0, N4.BY, N4.BZ]));
    for (const x of [-7, 7]) K.agregar(K.cilindro(0.25, 0.3, N4.BY, 0x2a3c5c, [x, N4.BY / 2, N4.BZ - 0.3], 8));
    // rieles y fichas
    const zR = N4.BZ + 0.9;
    K.agregar(K.caja(N4.BW + 0.8, 3.6, 0.25, 0x1c2b44, [0, 2.1, N4.BZ + 0.45]));
    N4_FILAS.forEach((y, f) => {
      K.agregar(K.caja(n4X(24) - n4X(0) + 0.6, 0.12, 0.2, 0x5a6b8c, [(n4X(0) + n4X(24)) / 2, y, zR - 0.15]));
      K.etiqueta(['Guirnaldas', 'Puestos extra', 'Fuegos'][f], [n4X(0) - 2.6, y, zR], 'claro');
    });
    this.barras = [0, 1].map(f => K.agregar(new T.Mesh(new T.BoxGeometry(1, 0.32, 0.12), new T.MeshBasicMaterial({ color: f ? 0xff8a3d : 0xffd23f, transparent: true, opacity: 0.55, toneMapped: false }))));
    this.fichas = {};
    const laserMat = c => new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.75, toneMapped: false });
    for (const F of N4_FICHAS) {
      const g = K.agregar(new T.Group());
      const disco = K.cilindro(0.38, 0.38, 0.28, F.col, [0, 0, 0], 16, { emissive: F.col, emissiveIntensity: 0.45 }); disco.rotation.x = PI / 2; g.add(disco);
      g.position.set(n4X(this.q[F.k]), N4_FILAS[F.fila], zR);
      const laser = K.agregar(new T.Mesh(new T.BoxGeometry(0.06, 1, 0.06), laserMat(F.col)));
      const punto = K.agregar(new T.Mesh(new T.SphereGeometry(0.17, 10, 8), laserMat(F.col)));
      const lbl = K.etiqueta(F.txt, [0, 0.62, 0], '', g);
      F.g = g; F.laser = laser; F.punto = punto; F.lbl = lbl;
      let q0;
      K.arrastrable(g, { ejes: 'x', snap: 0, plano: new T.Vector3(0, 0, 1),
        alTomar: () => { q0 = this.q[F.k]; this.sim = false; },
        alMover: p => { const q = clamp(Math.round((p.x - n4X(0)) / (n4X(24) - n4X(0)) * 24), 0, 24); this.q[F.k] = q; this.ultima = F.k; this.ubicarFichas(); K.limpiarMensaje(); } });
      this.fichas[F.k] = F;
    }
    this.lblLectura = K.etiqueta('', [0, 0, 0], 'acento');
    this.lblReloj = K.etiqueta('', [0, N4.BY + N4.BH / 2 + 1.1, N4.BZ], 'grande');
    // plaza: guirnaldas, gente, puestos
    const postes = [[-10.5, 0.5], [10.5, 0.5], [-10.5, 16], [10.5, 16], [-12.5, 3], [12.5, 3], [-12.5, 17], [12.5, 17]];
    postes.forEach(([x, z]) => { K.agregar(K.cilindro(0.15, 0.2, 6, 0x2a3c5c, [x, 3, z], 6)); });
    const cuerdas = [[0, 2], [1, 3], [4, 6], [5, 7], [0, 6], [1, 7]], nb = 14;
    this.matGuirn = new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.guirn = K.agregar(new T.InstancedMesh(new T.SphereGeometry(0.2, 8, 6), this.matGuirn, cuerdas.length * nb));
    { const m4 = new T.Matrix4(), c = new T.Color(); let k = 0;
      for (const [a, b] of cuerdas) { const A = new T.Vector3(postes[a][0], 5.8, postes[a][1]), B = new T.Vector3(postes[b][0], 5.8, postes[b][1]);
        K.agregar(K.linea([A, ...[0.25, 0.5, 0.75].map(u => { const p = A.clone().lerp(B, u); p.y -= Math.sin(u * PI) * 1.2; return p; }), B].map(v => [v.x, v.y, v.z]), 0x444455));
        for (let j = 0; j < nb; j++) { const u = (j + 0.5) / nb, p = A.clone().lerp(B, u); p.y -= Math.sin(u * PI) * 1.2; m4.makeTranslation(p.x, p.y, p.z); this.guirn.setMatrixAt(k, m4); this.guirn.setColorAt(k, c.set([0xffd23f, 0xff4f8b, 0x5aa9ff, 0x3ddc97, 0xffffff][k % 5])); k++; } } }
    this.luz = K.agregar(new T.PointLight(0xffd59a, 0, 45, 1.2)); this.luz.position.set(0, 7, 8);
    const r = azar(5), colores = [0xff4f8b, 0x5aa9ff, 0x3ddc97, 0xffd23f, 0xb08cff, 0xff8a3d, 0xffffff];
    this.gente = [];
    for (let i = 0; i < 60; i++) { const p = K.agregar(K.persona([-9.5 + r() * 19, 0, 3 + r() * 11.5], colores[i % colores.length])); p.rotation.y = r() * 2 * PI; p.scale.setScalar(1.15); this.gente.push(p); }
    this.puestos = [];
    for (const [x, ry] of [[-14.5, PI / 2], [14.5, -PI / 2]]) {
      const g = K.agregar(new T.Group()); g.position.set(x, 0, 8); g.rotation.y = ry;
      g.add(K.caja(4.2, 2.8, 2.6, 0xfff6e6, [0, 1.4, 0]));
      const toldo = new T.Mesh(new T.BoxGeometry(4.6, 0.25, 1.6), new T.MeshStandardMaterial({ map: texCanvas(256, 32, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#ffffff' : '#ff8a3d'; c.fillRect(i * 32, 0, 32, h); } }), roughness: 0.8 }));
      toldo.position.set(0, 3.1, 1.6); toldo.rotation.x = 0.35; toldo.castShadow = true; g.add(toldo);
      const cartel = placa(3.2, 0.7, texCanvas(256, 56, (c, w, h) => { c.fillStyle = '#1c2b44'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffd23f'; c.font = `900 36px ${FUENTE}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('COMIDA', w / 2, h / 2 + 2); }));
      cartel.position.set(0, 3.55, 1.32); g.add(cartel);
      const persiana = K.caja(3.8, 1.9, 0.1, 0x8c94a6, [0, 1.6, 1.33]); g.add(persiana);
      const cocinero = K.persona([0, 0.6, 0.6], 0xffffff); g.add(cocinero);
      const luz = new T.PointLight(0xffb36b, 0, 14, 1.4); luz.position.set(0, 2.6, 2.4); g.add(luz);
      this.puestos.push({ persiana, cartel, luz, cocinero });
    }
    this.aviso = K.etiqueta('', [0, 4.5, 9], 'grande'); this.aviso.element.style.background = '#ff5d6c';
    // fuegos artificiales
    this.estallidos = []; this.proxFuego = 0;
    // panel
    K.datos([
      ['Guirnaldas', 'encendidas sólo mientras haya <b>más de 300 personas</b>'],
      ['Puestos extra', 'abren cuando la cantidad de gente <b>se estabiliza por primera vez</b>; cierran cuando <b>empieza a bajar definitivamente</b>'],
      ['Fuegos', 'se lanzan <b>apenas</b> el parque llega a su <b>máximo</b> de gente'],
    ]);
    this.reloj = K.deslizador('Reloj del parque', { id: 'n4reloj', min: 18, max: 24, paso: 0.25, valor: 20.5, formato: v => hhmm(v) + ' h', alCambiar: v => { this.sim = false; this.ponerHora(v); } });
    K.controles().append(K.h('div', { class: 'grupo-btn' }, boton('▶ Simular la noche', () => { this.hora = 18; this.sim = true; this.velSim = 0.45; })));
    this.hora = 20.5; this.sim = false; this.velSim = 0.45; let acum = 0;
    K.tic((dt, t) => {
      if (this.sim) { this.hora = Math.min(24, this.hora + dt * this.velSim); this.reloj.poner(Math.round(this.hora * 4) / 4); acum += dt; this.ponerHora(this.hora, acum > 0.2); if (acum > 0.2) acum = 0; if (this.hora >= 24) this.sim = false; }
      this.gente.forEach((p, i) => { if (p.visible) p.position.y = Math.abs(Math.sin(t * 6 + i)) * 0.12; });
      this.ticFuegos(dt);
    });
    this.ubicarFichas(); this.ponerHora(20.5);
  },
  ubicarFichas() {
    for (const F of N4_FICHAS) {
      const q = this.q[F.k], x = n4X(q), y0 = N4_FILAS[F.fila], y1 = n4Y(n4P(q));
      F.g.position.x = x;
      F.laser.scale.y = y1 - y0; F.laser.position.set(x, (y0 + y1) / 2, N4.BZ + 0.3);
      F.punto.position.set(x, y1, N4.BZ + 0.35);
    }
    for (const f of [0, 1]) { const [a, b] = f ? [this.q.ab, this.q.ce] : [this.q.on, this.q.off]; const x1 = n4X(Math.min(a, b)), x2 = n4X(Math.max(a, b));
      this.barras[f].scale.x = Math.max(0.01, x2 - x1); this.barras[f].position.set((x1 + x2) / 2, N4_FILAS[f], N4.BZ + 0.75); this.barras[f].material.color.set(a <= b ? (f ? 0xff8a3d : 0xffd23f) : 0xff5d6c); }
    const u = this.ultima && this.fichas[this.ultima];
    if (u) { const q = this.q[u.k]; this.lblLectura.visible = true; this.lblLectura.position.set(n4X(q), n4Y(n4P(q)) + 0.75, N4.BZ + 0.4); this.lblLectura.texto(`${n4h(q)} → ${n4pers(q)} personas`); }
    else this.lblLectura.visible = false;
    this.ponerHora(this.hora, true);
  },
  ponerHora(t, refrescar = true) {
    this.hora = t;
    const q = (t - 18) * 4, P = n4P(q), n = Math.round(P * 5);
    this.gente.forEach((p, i) => { p.visible = i < n; });
    const luces = this.q.on <= q && q < this.q.off, puestos = this.q.ab <= q && q < this.q.ce;
    this.matGuirn.color.set(luces ? 0xffffff : 0x22222e); this.luz.intensity = luces ? 9 : 0;
    deco.matFoco.color.set(luces ? 0xffffff : 0x22222e);
    for (const p of this.puestos) { p.persiana.visible = !puestos; p.cocinero.visible = puestos; p.luz.intensity = puestos ? 6 : 0; p.cartel.material.color.set(puestos ? 0xffffff : 0x444455); }
    this.fuegosActivos = this.q.fu <= q && q < this.q.fu + 2;
    this.lblReloj.texto(`${hhmm(t)} h · ${Math.round(P * 100)} personas`);
    const avisos = [];
    if (!luces && P > 3) avisos.push('¡Gente a oscuras!');
    if (luces && P < 3) avisos.push('Luces prendidas sin público');
    this.aviso.visible = avisos.length > 0; this.aviso.texto(avisos.join(' · '));
    if (refrescar) K.refrescarMat();
  },
  ticFuegos(dt) {
    if (this.fuegosActivos) { this.proxFuego -= dt; if (this.proxFuego <= 0) { this.proxFuego = 0.35 + Math.random() * 0.4; this.lanzar(); } }
    for (const e of this.estallidos) {
      e.t += dt; const a = e.geo.attributes.position;
      for (let i = 0; i < a.count; i++) { e.vel[i * 3 + 1] -= 3 * dt; a.setXYZ(i, a.getX(i) + e.vel[i * 3] * dt, a.getY(i) + e.vel[i * 3 + 1] * dt, a.getZ(i) + e.vel[i * 3 + 2] * dt); }
      a.needsUpdate = true; e.pts.material.opacity = Math.max(0, 1 - e.t / 1.6);
    }
    for (const e of this.estallidos.filter(e => e.t > 1.6)) { K.grupo.remove(e.pts); e.geo.dispose(); e.pts.material.dispose(); }
    this.estallidos = this.estallidos.filter(e => e.t <= 1.6);
  },
  lanzar() {
    const n = 70, pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    const c = new T.Vector3(-12 + Math.random() * 26, 13.5 + Math.random() * 5, -8 - Math.random() * 8);
    for (let i = 0; i < n; i++) { const v = new T.Vector3().randomDirection().multiplyScalar(5 + Math.random() * 2.5); vel.set([v.x, v.y, v.z], i * 3); pos.set([c.x, c.y, c.z], i * 3); }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    const pts = new T.Points(geo, new T.PointsMaterial({ color: [0xff4f8b, 0xffd23f, 0x5aa9ff, 0x3ddc97, 0xff4fd8][Math.floor(Math.random() * 5)], size: 0.55, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
    K.agregar(pts); this.estallidos.push({ pts, geo, vel, t: 0 });
  },
  poner(q) { Object.assign(this.q, q); this.ultima = 'fu'; this.ubicarFichas(); this.ponerHora(22.5); this.reloj.poner(22.5); },
  comprobar(K) {
    const { on, off, ab, ce, fu } = this.q, P = n4P, err = [];
    // guirnaldas
    if (off <= on) err.push('Las guirnaldas se apagan antes (o a la misma hora) de encenderse: revisá el orden de las fichas.');
    else {
      if (on !== 3) err.push(P(on) < 3 ? `A las ${n4h(on)} hay ${n4pers(on)} personas: todavía no superan las 300. Las guirnaldas se prenderían antes de tiempo.` : P(on) > 3 ? `A las ${n4h(on)} ya hay ${n4pers(on)} personas: el parque estaría a oscuras con más de 300 personas antes de esa hora.` : `A las ${n4h(on)} hay justo 300 personas, pero la cantidad está bajando: no es el momento de encender.`);
      if (off !== 23) err.push(off >= 12 && off <= 14 ? `A las ${n4h(off)} la cantidad de gente baja, pero sigue siendo de más de 300 personas (y después vuelve a crecer): el parque quedaría a oscuras.` : P(off) > 3 ? `A las ${n4h(off)} todavía hay ${n4pers(off)} personas: si apagás las guirnaldas quedan a oscuras.` : `A las ${n4h(off)} ${n4pers(off) ? `quedan sólo ${n4pers(off)} personas` : 'el parque ya está vacío'}: las guirnaldas estuvieron prendidas de más.`);
    }
    // puestos
    if (ce <= ab) err.push('Los puestos extra cierran antes (o a la misma hora) de abrir: revisá el orden de las fichas.');
    else {
      if (ab !== 8) err.push(ab < 8 ? `A las ${n4h(ab)} la cantidad de gente todavía está creciendo: no se estabilizó.` : ab <= 12 ? `A las ${n4h(ab)} la cantidad ya estaba estable desde antes: buscá el primer instante del tramo constante.` : ab >= 18 && ab <= 20 ? 'Ese tramo constante no es el primero: la cantidad de gente ya se había estabilizado antes.' : `A las ${n4h(ab)} la cantidad de gente está cambiando: ahí el gráfico no es constante.`);
      if (ce !== 20) err.push(ce >= 12 && ce < 14 ? `A las ${n4h(ce)} la cantidad baja, pero después vuelve a crecer: todavía no es la bajada definitiva.` : ce < 20 ? `A las ${n4h(ce)} la cantidad de gente no empezó a bajar definitivamente.` : `A las ${n4h(ce)} la gente ya se venía yendo desde antes: los puestos cerraron tarde.`);
    }
    // fuegos
    if (fu !== 18) err.push(fu >= 8 && fu <= 12 ? `A las ${n4h(fu)} el gráfico tiene un tramo constante, pero no es el máximo: después llega más gente.` : fu > 18 && fu <= 20 ? `A las ${n4h(fu)} el parque ya estaba en su máximo desde antes: «apenas» es el primer instante.` : fu < 18 ? `A las ${n4h(fu)} hay ${n4pers(fu)} personas y después llega más gente: todavía no es el máximo.` : `A las ${n4h(fu)} la gente ya se está yendo: el máximo fue antes.`);
    if (err.length) { const bien = 5 - err.length; return { ok: false, msg: `${bien > 0 ? `${bien} de 5 fichas bien ubicadas. ` : ''}Revisá: ${err[0]}${err.length > 1 ? ` <i>(y ${err.length - 1} problema${err.length > 2 ? 's' : ''} más)</i>` : ''}` }; }
    return { ok: true, msg: '¡Noche programada! Guirnaldas de 18:45 a 23:45, puestos extra de 20:00 a 23:00 y fuegos a las 22:30.' };
  },
  alResolver(K) { this.hora = 18; this.velSim = 2.2; this.sim = true; cam(K, [0, 12, 40], [0, 8, 0]); return 3300; },
  pistas: [
    'Leé el gráfico por tramos: dónde crece (llega más gente de la que se va), dónde es constante (la cantidad se mantiene) y dónde decrece. Ubicá también el máximo.',
    '300 personas son 3 cientos: imaginá la recta horizontal P = 3 y buscá entre qué horas el gráfico está por encima. Para los puestos, distinguí la primera estabilidad y una bajada que después se recupera de la bajada definitiva.',
    'Cada ficha funciona como una recta vertical: la lectura te dice cuántas personas hay a esa hora. Entre las 18 y las 20 llegan 100 personas cada 15 minutos; entre las 23 y las 24 se van 300 cada 15 minutos.',
  ],
  bitacora: [
    '¿Cómo usaste el gráfico para decidir a qué hora encender y apagar las guirnaldas? ¿Por qué la bajada de las 21 h no obligó a apagarlas?',
    '¿Qué significan, en el parque, los tramos constantes del gráfico? ¿Por qué abriste los puestos en uno de ellos y no en el otro? ¿Qué te dijo el decrecimiento para cerrarlos?',
    'Elegí una de tus decisiones y explicá cómo comprobarías que es correcta con una cuenta (por ejemplo, la pendiente de un tramo) o con el gráfico.',
  ],
  resumenBitacora() { return 'Guirnaldas: de <b>18:45</b> a <b>23:45</b> (P &gt; 3) · Puestos extra: de <b>20:00</b> a <b>23:00</b> · Fuegos: <b>22:30</b> (inicio del máximo, 1200 personas).'; },
  mat(K, el) {
    const p = ejes({ xMin: 18, xMax: 24, yMin: 0, yMax: 14, gx: 0.25, gy: 1, lx: 1, ly: 2, ex: 't (h)', ey: 'P (cientos)', H: 330, fx: v => v + ' h' });
    el.append(p.svg);
    const s = K.s, tq = q => 18 + q / 4;
    const banda = (a, b, col, y0, y1) => { if (b > a) p.g.append(s('rect', { x: p.X(tq(a)), y: p.Y(y1), width: p.X(tq(b)) - p.X(tq(a)), height: p.Y(y0) - p.Y(y1), fill: col, opacity: 0.18 })); };
    banda(this.q.on, this.q.off, '#e0a800', 0, 14); banda(this.q.ab, this.q.ce, '#ff8a3d', 0, 14);
    p.g.append(s('line', { x1: p.X(18), x2: p.X(24), y1: p.Y(3), y2: p.Y(3), stroke: '#6b7280', 'stroke-dasharray': '6 4', 'stroke-width': 1.5 }));
    p.g.append(s('text', { x: p.X(24) - 4, y: p.Y(3) - 5, 'text-anchor': 'end', fill: '#6b7280', 'font-size': 10 }, 'P = 3 (300 personas)'));
    p.g.append(s('polyline', { points: N4_V.map(([q, P]) => `${p.X(tq(q))},${p.Y(P)}`).join(' '), fill: 'none', stroke: '#d6336c', 'stroke-width': 2.8 }));
    const cols = { on: '#c99700', off: '#8a7a3a', ab: '#e86a1c', ce: '#9a5a2d', fu: '#c026d3' };
    N4_FICHAS.forEach((F, i) => { const q = this.q[F.k], x = p.X(tq(q));
      p.g.append(s('line', { x1: x, x2: x, y1: p.Y(0), y2: p.Y(n4P(q)), stroke: cols[F.k], 'stroke-width': 2, 'stroke-dasharray': '3 3' }));
      p.g.append(s('circle', { cx: x, cy: p.Y(n4P(q)), r: 5, fill: cols[F.k] }));
      const izq = F.k === 'off' || F.k === 'ce', arriba = F.k === 'on' || F.k === 'fu';
      p.g.append(s('text', { x: x + (izq ? -6 : 6), y: p.Y(n4P(q)) + (arriba ? -9 : 16) + (F.k === 'ab' || F.k === 'ce' ? 12 : 0), 'text-anchor': izq ? 'end' : 'start', fill: cols[F.k], 'font-size': 11, 'font-weight': 700, stroke: '#fdfcf8', 'stroke-width': 3, 'paint-order': 'stroke' }, `${F.txt} ${n4h(q)}`)); });
    const qh = (this.hora - 18) * 4; p.g.append(s('circle', { cx: p.X(this.hora), cy: p.Y(n4P(qh)), r: 6, fill: '#fff', stroke: '#1b2333', 'stroke-width': 2 }));
    const dl = K.h('dl', { class: 'datos', style: 'background:#f2efe6;color:#1b2333;font-size:13px' });
    const fila = (k, v) => dl.append(K.h('dt', { style: 'color:#6b7280' }, k), K.h('dd', { html: v }));
    fila('Guirnaldas', `${n4h(this.q.on)} a ${n4h(this.q.off)} · P al encender = ${n4P(this.q.on)}`);
    fila('Puestos extra', `${n4h(this.q.ab)} a ${n4h(this.q.ce)}`);
    fila('Fuegos', `${n4h(this.q.fu)} · P = ${n4P(this.q.fu)}`);
    fila('Reloj', `${hhmm(this.hora)} h → P = ${K.fmt(n4P(qh), 2)} (${Math.round(n4P(qh) * 100)} personas)`);
    el.append(dl);
    notaMat(el, 'Las bandas muestran cuándo están prendidas las guirnaldas (amarillo) y abiertos los puestos (naranja). Cada ficha es una recta vertical que corta al gráfico.');
  },
  prueba: {
    mal: [
      function () { this.poner({ on: 3, off: 14, ab: 8, ce: 20, fu: 18 }); },
      function () { this.poner({ on: 3, off: 23, ab: 8, ce: 12, fu: 18 }); },
      function () { this.poner({ on: 3, off: 23, ab: 8, ce: 20, fu: 8 }); },
      function () { this.poner({ on: 4, off: 23, ab: 8, ce: 20, fu: 18 }); },
      function () { this.poner({ on: 3, off: 23, ab: 18, ce: 20, fu: 18 }); },
    ],
    bien() { this.poner({ on: 3, off: 23, ab: 8, ce: 20, fu: 18 }); },
  },
};

const JUEGO = {
  id: 'parque-decisiones',
  titulo: 'Parque de decisiones',
  subtitulo: 'Funciones · Colección Misiones 3D',
  icono: 'ƒ',
  kicker: 'Matemática · 3.er año · Funciones',
  portada: 'Tu equipo es responsable de poner en marcha el <b>Parque de Decisiones</b> para la gran noche del festival. Cada atracción tiene una falla o una decisión pendiente, y la herramienta para resolverla es una <b>función</b>: vas a arreglar una boletera, habilitar la vuelta al mundo, construir la pista de una montaña rusa con túnel y programar el parque leyendo un gráfico.',
  contenidos: ['Concepto de función', 'Existencia y unicidad', 'Dominio e imagen', 'Ceros', 'Positividad y negatividad', 'Crecimiento y decrecimiento', 'Máximos y mínimos', 'Interpretación de gráficos'],
  final: { titulo: '¡El parque abre sus puertas!', texto: 'La boletera ya no duda, la vuelta al mundo tiene su ficha técnica, la montaña rusa pasa por el túnel justo donde tiene que pasar y el festival está programado. Cada decisión salió de leer e interpretar una función.' },
  escenaBase(K) { escenaParque(K); cieloDia(K); },
  niveles: [nivel1, nivel2, nivel3, nivel4],
};
iniciar(JUEGO);
</script>
</body>
</html>
$kodu$, 'a59ea305-7e4b-4374-8039-2236dd0f5a88', now(), now());
INSERT INTO "ChatThread" (id, title, "projectId", "createdAt") VALUES ('7b445d90-d372-4637-96e6-39ee2ef53191', 'Conversación', '8cbf1b9a-4ddb-408f-b4e9-f333ef57a3c2', now());
COMMIT;
SELECT id, title, slug, length("currentHtml") AS largo FROM "Project" WHERE id = '8cbf1b9a-4ddb-408f-b4e9-f333ef57a3c2';
