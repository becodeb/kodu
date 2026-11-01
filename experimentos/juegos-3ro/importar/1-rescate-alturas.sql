\set ON_ERROR_STOP on
SET client_encoding = 'UTF8';
BEGIN;
-- No duplicar si ya existe un recurso con el mismo título en la cuenta.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Project" WHERE "userId" = 'a59ea305-7e4b-4374-8039-2236dd0f5a88' AND title = 'Rescate en las alturas') THEN
    RAISE EXCEPTION 'Ya existe un recurso con ese título en la cuenta';
  END IF;
END $$;
INSERT INTO "Project" (id, title, description, slug, "currentHtml", "userId", "createdAt", "updatedAt")
VALUES ('2f04dc12-4121-483f-a07f-d6520723d258', 'Rescate en las alturas', 'Videojuego 3D · 3.er año. Reparto proporcional, semejanza de triángulos, medición con sombras y criterios AA, LAL y LLL en cuatro misiones de rescate en la montaña.', 'rescate-en-las-alturas-v46v8g6t', $kodu$<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rescate en las alturas</title>
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
  --acento:#ff6a2b; --acento-2:#9fd6f5;
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

/* ── Rescate en las alturas: paleta, estilos y piezas del decorado ── */
const COL = {
  nieve: 0xf2f7fd, nieve2: 0xdbe8f5, hielo: 0xa9dcf5, glaciar: 0x3f8fd0, glaciarOsc: 0x24578c,
  naranja: 0xff6a2b, naranjaOsc: 0xc9501c, madera: 0x9a6640, maderaOsc: 0x5e3b24,
  roca: 0x6c7a8c, rocaOsc: 0x465265, pino: 0x2f6152, acero: 0xa7b3c2, aceroOsc: 0x5f6c7d,
  rojo: 0xe23d4b, amarillo: 0xffc43d, crema: 0xfff3e0, hormigon: 0xc3cdd9,
};
const CHAQUETAS = [0xff6a2b, 0x3f8fd0, 0xe23d4b, 0xffc43d, 0x2fbf86, 0x8e6cf0, 0xff8fb1, 0x24578c, 0xf2f2f2];
document.head.append(h('style', { html: `
.lbl.mini{font-size:11.5px;padding:2px 6px}
.lbl.glaciar{background:#3f8fd0;color:#fff;border-color:transparent}
.lbl.verde{background:#3ddc97;color:#0f1b2d;border-color:transparent}
.lbl.rojo{background:#ff5d6c;color:#fff;border-color:transparent}
.lbl.gris{background:rgba(70,82,101,.92);color:#dfe6f0}
.fila-kit{display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--tinta-2);border-radius:12px;padding:5px 10px}
.fila-kit .n{font-size:12.5px;color:var(--texto-3)}
.fila-kit .btn-chico{width:34px;padding:0;font-size:18px}
.fila-kit input{width:70px;text-align:center;height:34px}
.fila-sop{display:flex;align-items:center;gap:6px;padding:3px 8px;border-radius:10px;background:var(--tinta-2)}
.fila-sop.sel{outline:2px solid var(--acento)}
.fila-sop b{width:22px;font-family:var(--f-titulo);font-size:17px;color:var(--acento)}
.fila-sop .grupo-btn{flex:1;flex-wrap:nowrap}
.fila-sop .btn-chico{flex:1;padding:0 4px;height:28px}
.total-kits{font-size:13.5px;color:var(--texto-2)}
.total-kits.mal{color:var(--error)}
.tabla-mat{width:100%;border-collapse:collapse;font-size:13.5px}
.tabla-mat th{font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;text-align:left;padding:6px 8px;border-bottom:2px solid #e6e1d4}
.tabla-mat td{padding:6px 8px;border-bottom:1px solid #eee8db;font-family:var(--f-num);font-weight:500}
.tabla-mat td:first-child{font-family:var(--f-texto);font-weight:700}
.tabla-mat .si{color:#14845a;font-weight:700}.tabla-mat .no{color:#c2283a;font-weight:700}
.tarjetas-sop{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
@media (max-width:860px){.tarjetas-sop{grid-template-columns:repeat(4,minmax(0,1fr))}.tarjeta-sop .badge.m{display:none}}
.tarjeta-sop{border:1.5px solid #e6e1d4;border-radius:12px;padding:6px 6px 4px;background:#fff}
.tarjeta-sop.modelo{border-color:#3f8fd0;background:#eef6fd}
.tarjeta-sop.sel{border-color:#ff6a2b;box-shadow:0 0 0 2px rgba(255,106,43,.25)}
.tarjeta-sop .t{display:flex;justify-content:space-between;align-items:center;font-family:var(--f-titulo);font-weight:800;font-size:15px}
.tarjeta-sop .badge{font-family:var(--f-num);font-size:11px;border-radius:6px;padding:1px 6px;background:#eceae4;color:#4b5563}
.tarjeta-sop .badge.si{background:#ff6a2b;color:#fff}.tarjeta-sop .badge.no{background:#4b5563;color:#fff}
#vistaMat .tarjeta-sop svg{min-height:0;height:auto}
` }));

// Azar con semilla: el decorado sale siempre igual.
let semilla = 20251031;
const azar = () => { semilla = (semilla + 0x6D2B79F5) | 0; let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const fmtN = x => (+(+x).toFixed(3)).toLocaleString('es-AR');
const transparente = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });

/** Altura del terreno: plano en el centro (donde se juega) y lomas nevadas alrededor. */
function alturaTerreno(x, z) {
  const r = Math.hypot(x, z * 1.15);
  const t = Math.min(1, Math.max(0, (r - 46) / 75)); const s = t * t * (3 - 2 * t);
  return s * (12 + 8 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05) + 4 * Math.sin(x * 0.11 + z * 0.07));
}
function terreno(K) {
  const g = new THREE.PlaneGeometry(560, 560, 112, 112); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, alturaTerreno(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, K.mat(COL.nieve, { roughness: 0.95 })); m.receiveShadow = true; return m;
}
function pino(K, x, z, e = 1) {
  const g = new THREE.Group();
  g.add(K.cilindro(0.16, 0.24, 1, COL.maderaOsc, [0, 0.5, 0], 6));
  [[1.35, 1.7, 1.45], [1.05, 1.5, 2.35], [0.72, 1.3, 3.15]].forEach(([r, hh, y]) => {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, hh, 7), K.mat(COL.pino)); c.position.y = y; c.castShadow = true; g.add(c);
    const n = new THREE.Mesh(new THREE.ConeGeometry(r * 0.56, hh * 0.46, 7), K.mat(COL.nieve)); n.position.y = y + hh * 0.29; g.add(n);
  });
  g.position.set(x, alturaTerreno(x, z) - 0.1, z); g.scale.setScalar(e); g.rotation.y = azar() * 6; return g;
}
function montana(K, x, z, r, alto, color = COL.roca) {
  const g = new THREE.Group(); const seg = 6 + Math.floor(azar() * 3);
  const cuerpo = new THREE.Mesh(new THREE.ConeGeometry(r, alto, seg), K.mat(color)); cuerpo.position.y = alto / 2;
  const f = 0.44; const cap = new THREE.Mesh(new THREE.ConeGeometry(r * f * 1.04, alto * f, seg), K.mat(COL.nieve)); cap.position.y = alto - alto * f / 2 + 0.05;
  g.add(cuerpo, cap); g.rotation.y = azar() * Math.PI; g.position.set(x, -4, z); return g;
}
/** Refugio de montaña: cabaña de madera con techo a dos aguas nevado. */
function refugio(K, techo = COL.rojo) {
  const g = new THREE.Group();
  g.add(K.caja(3.4, 2.2, 2.6, COL.madera, [0, 1.1, 0]));
  const tri = new THREE.Shape([new THREE.Vector2(-1.3, 0), new THREE.Vector2(1.3, 0), new THREE.Vector2(0, 1.05)]);
  const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 3.4, bevelEnabled: false }), K.mat(COL.madera));
  gable.rotation.y = Math.PI / 2; gable.position.set(-1.7, 2.2, 0); gable.castShadow = true; g.add(gable);
  for (const s of [1, -1]) {
    const tejado = K.caja(3.9, 0.18, 1.95, techo, [0, 2.74, s * 0.78]); tejado.rotation.x = -s * 0.68; g.add(tejado);
    const nv = K.caja(3.7, 0.12, 1.75, COL.nieve, [0, 2.86, s * 0.7]); nv.rotation.x = -s * 0.68; g.add(nv);
  }
  g.add(K.caja(0.8, 1.45, 0.08, COL.maderaOsc, [0, 0.73, 1.32]));
  for (const x of [-1.05, 1.05]) g.add(K.caja(0.6, 0.55, 0.08, 0xffe2a8, [x, 1.25, 1.32], { emissive: 0xffb84d, emissiveIntensity: 0.5 }));
  g.add(K.caja(0.45, 1.2, 0.45, COL.rocaOsc, [1.05, 3.1, -0.5]));
  g.add(K.caja(0.55, 0.14, 0.55, COL.nieve, [1.05, 3.75, -0.5]));
  return g;
}
function persona(K, pos, color) {
  const p = K.persona(pos, color);
  const gorro = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.28, 8), K.mat(azar() < 0.5 ? COL.rojo : COL.amarillo)); gorro.position.y = 1.36; p.add(gorro);
  return p;
}
/** Regla pintada sobre el suelo (textura de canvas): marcas cada 0,5 m, números cada `cada` m. */
function regla(K, largo, { ancho = 1.2, cada = 1, color = '#24578c', fondo = '#fffaf0' } = {}) {
  const ppm = 96, W = Math.min(4096, Math.round(largo * ppm) + 40), H = Math.round(ancho * ppm);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); const m = 20;
  x.fillStyle = fondo; x.fillRect(0, 0, W, H);
  x.fillStyle = color; x.fillRect(0, 0, W, 6); x.fillRect(0, H - 6, W, 6);
  x.font = `700 ${Math.round(H * 0.32)}px JetBrains Mono, monospace`; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 0; i <= largo * 2; i++) {
    const px = m + i * ppm / 2 * (W - 2 * m) / (largo * ppm);
    const entero = i % 2 === 0;
    x.fillRect(px - (entero ? 2.5 : 1.5), 6, entero ? 5 : 3, H * (entero ? 0.34 : 0.2));
    if (entero && (i / 2) % cada === 0) x.fillText(String(i / 2), px, H * 0.66);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const largoTotal = largo * W / (W - 2 * m);
  const geo = new THREE.PlaneGeometry(largoTotal, ancho); geo.rotateX(-Math.PI / 2); geo.translate(largo / 2, 0, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  mesh.receiveShadow = true; return mesh;
}
/** Cilindro de largo 1 sobre el eje y: se estira con scale.y y se orienta con orientar(). */
function varilla(K, radio, color) {
  const g = new THREE.CylinderGeometry(radio, radio, 1, 12);
  const m = new THREE.Mesh(g, K.mat(color, { metalness: 0.3, roughness: 0.55 })); m.castShadow = true; return m;
}
const EJE_Y = V3(0, 1, 0);
function orientar(m, a, b) {
  const d = b.clone().sub(a); const L = d.length();
  m.position.copy(a).addScaledVector(d, 0.5); m.scale.set(1, Math.max(L, 1e-4), 1);
  if (L > 1e-6) m.quaternion.setFromUnitVectors(EJE_Y, d.normalize());
}
/** Bandera-marcador para cintas métricas (arrastrable). */
function banderin(K, color) {
  const g = new THREE.Group();
  g.add(K.caja(0.08, 0.03, 1.5, color, [0, 0.06, 0]));
  g.add(K.cilindro(0.05, 0.05, 1.5, 0x333a45, [0, 0.75, 0.85], 6));
  const f = K.caja(0.55, 0.38, 0.04, color, [0.3, 1.3, 0.85]); g.add(f);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2, 2.2), transparente()); hit.position.set(0.2, 0.9, 0.4); g.add(hit);
  return g;
}
function helicoptero(K) {
  const g = new THREE.Group();
  const cuerpo = K.esfera(1, COL.naranja, [0, 0, 0]); cuerpo.scale.set(1.7, 1.05, 1.05); g.add(cuerpo);
  const vidrio = K.esfera(0.75, 0x9fd6f5, [0.95, 0.15, 0], { metalness: 0.4, roughness: 0.2 }); vidrio.scale.set(0.9, 0.8, 0.95); g.add(vidrio);
  g.add(K.caja(2.6, 0.12, 0.3, 0xffffff, [-0.3, 0.05, 1.02]));
  const cola = K.cilindro(0.18, 0.32, 3.4, COL.naranja, [-2.8, 0.2, 0]); cola.rotation.z = Math.PI / 2; g.add(cola);
  g.add(K.caja(0.12, 0.9, 0.5, COL.naranjaOsc, [-4.4, 0.6, 0]));
  for (const z of [-0.75, 0.75]) g.add(K.caja(2.6, 0.08, 0.1, 0x333a45, [0, -1.25, z]));
  g.add(K.cilindro(0.08, 0.08, 0.5, 0x333a45, [0, 1.25, 0]));
  const rotor = new THREE.Group(); rotor.position.y = 1.5;
  rotor.add(K.caja(7, 0.06, 0.28, 0x2a3240)); const r2 = K.caja(7, 0.06, 0.28, 0x2a3240); r2.rotation.y = Math.PI / 2; rotor.add(r2);
  g.add(rotor); g.rotor = rotor; return g;
}
/** Aerosilla del fondo: sillas que suben y bajan sin parar (anima con onBeforeRender). */
function aerosilla(K) {
  const g = new THREE.Group();
  const A = V3(-74, 0, -58), B = V3(52, 0, -150);
  A.y = alturaTerreno(A.x, A.z) + 9; B.y = alturaTerreno(B.x, B.z) + 9;
  let extra = 0;
  for (let u = 0; u <= 1; u += 0.05) { const p = A.clone().lerp(B, u); extra = Math.max(extra, alturaTerreno(p.x, p.z) + 7 - p.y); }
  A.y += extra; B.y += extra;
  const lado = V3(B.z - A.z, 0, -(B.x - A.x)).normalize().multiplyScalar(1.3);
  for (let i = 0; i <= 5; i++) {
    const p = A.clone().lerp(B, i / 5); const suelo = alturaTerreno(p.x, p.z);
    g.add(K.barra([p.x, suelo - 1, p.z], [p.x, p.y + 0.4, p.z], 0.28, COL.aceroOsc));
    const cruz = K.barra([p.x - lado.x * 1.2, p.y + 0.4, p.z - lado.z * 1.2], [p.x + lado.x * 1.2, p.y + 0.4, p.z + lado.z * 1.2], 0.14, COL.naranjaOsc); g.add(cruz);
  }
  for (const s of [1, -1]) {
    const cab = K.barra([A.x + lado.x * s, A.y, A.z + lado.z * s], [B.x + lado.x * s, B.y, B.z + lado.z * s], 0.05, 0x2a3240); g.add(cab);
  }
  for (const [P, d] of [[A, 1], [B, -1]]) { const casa = K.caja(7, 5, 6, COL.hormigon, [P.x, P.y - 4.5, P.z]); g.add(casa); g.add(K.caja(7.6, 0.5, 6.6, COL.naranja, [P.x, P.y - 1.8, P.z])); }
  const sillas = [];
  const N = 18;
  for (let i = 0; i < N; i++) {
    const s = new THREE.Group();
    s.add(K.caja(0.06, 2, 0.06, 0x2a3240, [0, -1, 0]));
    s.add(K.caja(1.4, 0.14, 0.6, i % 3 ? COL.naranja : COL.glaciar, [0, -2, 0.1]));
    s.add(K.caja(1.4, 0.7, 0.1, i % 3 ? COL.naranja : COL.glaciar, [0, -1.65, -0.2]));
    s.rotation.y = Math.atan2(B.x - A.x, B.z - A.z) + Math.PI / 2;
    g.add(s); sillas.push(s);
  }
  const reloj = g.children[0]; reloj.frustumCulled = false;
  let t0 = performance.now(), fase = 0;
  reloj.onBeforeRender = () => {
    const t = performance.now(); fase = (fase + Math.min(0.05, (t - t0) / 1000) * 0.012) % 2; t0 = t;
    sillas.forEach((s, i) => {
      let p = (fase + i * 2 / N) % 2; const sube = p < 1; const u = sube ? p : 2 - p;
      const sg = sube ? 1 : -1;
      s.position.set(A.x + (B.x - A.x) * u + lado.x * sg, A.y + (B.y - A.y) * u, A.z + (B.z - A.z) * u + lado.z * sg);
    });
  };
  return g;
}
function copos(K) {
  const N = 1500, pos = new Float32Array(N * 3), vel = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = azar() * 150 - 75; pos[i * 3 + 1] = azar() * 45; pos[i * 3 + 2] = azar() * 130 - 85; vel[i] = 0.9 + azar() * 1.4; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
  const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
  const mat = new THREE.PointsMaterial({ size: 0.32, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.85 });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
  let t0 = performance.now();
  pts.onBeforeRender = () => {
    const t = performance.now(); const dt = Math.min(0.05, (t - t0) / 1000); t0 = t;
    for (let i = 0; i < N; i++) {
      pos[i * 3 + 1] -= vel[i] * dt; pos[i * 3] += Math.sin(t * 0.0006 + i) * dt * 0.5;
      if (pos[i * 3 + 1] < 0) pos[i * 3 + 1] += 45;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return pts;
}
/** Animación simple: f(u) con u de 0 a 1 en `dur` segundos, con retardo opcional. */
function animar(K, dur, f, retardo = 0) {
  let t = -retardo, listo = false;
  K.tic(dt => { if (listo) return; t += dt; if (t < 0) return; const u = Math.min(1, t / dur); f(u); if (u >= 1) listo = true; });
}
const suave = u => u * u * (3 - 2 * u);
/** Cámara del nivel: en pantallas angostas (celular, panel abajo) se aleja para que entre la escena. */
function camaraNivel(K, pos, mira, opts) {
  const movil = innerWidth <= 860, f = movil ? 1.85 : 1, d = movil && opts?.desplMovil || [0, 0, 0];
  const m = mira.map((v, i) => v + d[i]);
  K.camara(pos.map((v, i) => m[i] + (v - mira[i]) * f), m, { ...opts, max: (opts?.max || 90) * f });
}

/** Mini gráfico cartesiano con pasos distintos en cada eje (para la vista matemática). */
function grafico(K, { xMax, yMax, pasoX, pasoY, etqX, etqY, ancho = 560, alto = 300 }) {
  const s = K.s, mI = 46, mD = 20, mA = 16, mB = 36;
  const X = x => mI + x / xMax * (ancho - mI - mD), Y = y => alto - mB - y / yMax * (alto - mB - mA);
  const svg = s('svg', { viewBox: `0 0 ${ancho} ${alto}`, style: 'height:auto;min-height:0', 'font-family': 'JetBrains Mono, monospace', 'font-size': 11 });
  const gr = s('g', { stroke: '#e7e2d6' });
  for (let x = 0; x <= xMax + 1e-9; x += pasoX) gr.append(s('line', { x1: X(x), x2: X(x), y1: Y(0), y2: Y(yMax) }));
  for (let y = 0; y <= yMax + 1e-9; y += pasoY) gr.append(s('line', { y1: Y(y), y2: Y(y), x1: X(0), x2: X(xMax) }));
  svg.append(gr);
  svg.append(s('line', { x1: X(0), x2: X(xMax), y1: Y(0), y2: Y(0), stroke: '#1b2333', 'stroke-width': 1.6 }));
  svg.append(s('line', { x1: X(0), x2: X(0), y1: Y(0), y2: Y(yMax), stroke: '#1b2333', 'stroke-width': 1.6 }));
  const et = s('g', { fill: '#6b7280' });
  for (let x = pasoX; x <= xMax + 1e-9; x += pasoX) et.append(s('text', { x: X(x), y: Y(0) + 15, 'text-anchor': 'middle' }, x));
  for (let y = pasoY; y <= yMax + 1e-9; y += pasoY) et.append(s('text', { x: X(0) - 6, y: Y(y) + 4, 'text-anchor': 'end' }, y));
  et.append(s('text', { x: X(0) - 6, y: Y(0) + 15, 'text-anchor': 'end' }, 0));
  et.append(s('text', { x: X(xMax), y: Y(0) + 30, 'text-anchor': 'end', fill: '#1b2333', 'font-weight': 700 }, etqX));
  et.append(s('text', { x: X(0) + 6, y: Y(yMax) + 4, fill: '#1b2333', 'font-weight': 700 }, etqY));
  svg.append(et);
  const g = s('g'); svg.append(g);
  return { svg, X, Y, g };
}

/* ════════════════ Nivel 1 · Distribución de suministros ════════════════ */
const REFUGIOS = [
  { nombre: 'Cóndor', hab: 4, x: -15, z: -7, alto: 3.5, techo: COL.rojo, css: '#e23d4b' },
  { nombre: 'Lenga', hab: 7, x: 0, z: -16, alto: 6, techo: COL.naranja, css: '#ff6a2b' },
  { nombre: 'Glaciar', hab: 9, x: 15, z: -7, alto: 4.6, techo: COL.glaciar, css: '#3f8fd0' },
];
const TOTAL_KITS = 120;
function meseta(K, alto) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 8.8, alto, 9), K.mat(COL.nieve2)); m.position.y = alto / 2; m.castShadow = m.receiveShadow = true; g.add(m);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(5.65, 5.65, 0.12, 9), K.mat(COL.nieve)); top.position.y = alto; top.receiveShadow = true; g.add(top);
  for (let i = 0; i < 5; i++) { const a = i * 1.3 + 0.4; g.add(K.roca([Math.cos(a) * 7.8, alto * 0.18, Math.sin(a) * 7.8], 0.6 + azar() * 0.6, COL.rocaOsc)); }
  return g;
}
function estacion(K) {
  const g = new THREE.Group();
  g.add(K.caja(8, 4, 5, COL.hormigon, [0, 2, 0]));
  g.add(K.caja(8.6, 0.4, 5.6, COL.naranja, [0, 4.2, 0]));
  g.add(K.caja(8.2, 0.2, 5.2, COL.nieve, [0, 4.5, 0]));
  for (const x of [-2.6, 0, 2.6]) g.add(K.caja(1.6, 1.2, 0.08, 0x9fd6f5, [x, 2.5, 2.52], { emissive: 0x3f8fd0, emissiveIntensity: 0.25 }));
  g.add(K.caja(1.6, 2.4, 0.08, COL.glaciarOsc, [0, 1.2, 2.53]));
  for (const x of [-1.2, 1.2]) g.add(K.cilindro(0.2, 0.25, 2, COL.aceroOsc, [x, 5.6, -1.6], 8));
  const rueda = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.13, 8, 28), K.mat(COL.acero, { metalness: 0.5, roughness: 0.4 }));
  rueda.rotation.x = Math.PI / 2; rueda.position.set(0, 6.5, -1.6); rueda.castShadow = true; g.add(rueda);
  g.add(K.caja(2.8, 0.25, 0.4, COL.aceroOsc, [0, 6.6, -1.6]));
  return g;
}
const PALETA_CAJAS = [0xff6a2b, 0xff8a3d, 0xe85d24, 0xffa25a];
function pilaCajas(K, max, cols, filas) {
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), K.mat(0xffffff), max);
  const m = new THREE.Matrix4(), c = new THREE.Color(); const capa = cols * filas;
  for (let i = 0; i < max; i++) {
    const l = Math.floor(i / capa), r = Math.floor((i % capa) / cols), k = i % cols;
    m.makeTranslation((k - (cols - 1) / 2) * 0.4, 0.17 + l * 0.37, (r - (filas - 1) / 2) * 0.4);
    im.setMatrixAt(i, m); im.setColorAt(i, c.setHex(PALETA_CAJAS[(i * 7 + l) % 4]));
  }
  im.castShadow = im.receiveShadow = true; im.count = 0; return im;
}
const fmtQ = (a, b) => a % b === 0 ? String(a / b) : K.fmt(a / b, 2);

const N1 = {
  titulo: 'Distribución de suministros',
  relato: 'Una tormenta aisló tres refugios. En la estación del teleférico hay <b>120 kits</b> de emergencia y la jefa de rescate pide un reparto <b>justo</b>: que cada persona reciba lo mismo, esté en el refugio que esté.',
  objetivo: 'Cargá los 120 kits <b>en proporción a los habitantes</b> de cada refugio (con los botones o con clic en las plataformas) y escribí cuántos kits recibe cada persona.',
  tituloMat: 'Reparto proporcional', subMat: 'kits = k · habitantes',
  textoComprobar: 'Enviar el teleférico',
  armar(K) {
    camaraNivel(K, [0, 25, 39], [0, 2.8, -4], { min: 12, max: 95 });
    this.kits = [0, 0, 0]; this.paso = 1; this.inps = []; this.plats = [];
    const est = K.agregar(estacion(K)); est.position.set(0, 0, 10);
    K.etiqueta('Estación del teleférico', [0, 3.2, 12.8], 'claro');
    const rueda = V3(0, 6.5, 8.4);
    REFUGIOS.forEach((r, i) => {
      const mesa = K.agregar(meseta(K, r.alto)); mesa.position.set(r.x, 0, r.z);
      const ref = K.agregar(refugio(K, r.techo)); ref.position.set(r.x, r.alto, r.z - 1.2);
      for (let j = 0; j < r.hab; j++) {
        const fila = j < 5 ? 0 : 1, enFila = fila ? r.hab - 5 : Math.min(5, r.hab), k = fila ? j - 5 : j;
        K.agregar(persona(K, [r.x + (k - (enFila - 1) / 2) * 0.78, r.alto + 0.06, r.z + 1.6 + fila * 0.95], CHAQUETAS[(j + i * 3) % CHAQUETAS.length]));
      }
      K.etiqueta(`<b>Refugio ${r.nombre}</b> · ${r.hab} habitantes`, [r.x, r.alto + 4.6, r.z - 1.2], 'claro');
      // torre de llegada del cable, al costado del refugio que mira a la estación
      const lado = r.x < 0 ? 1 : r.x > 0 ? -1 : 1;
      const px = r.x + lado * 3.6, pz = r.z + 0.6, D = V3(px, r.alto + 6.6, pz);
      K.agregar(K.barra([px, r.alto, pz], [px, D.y + 0.3, pz], 0.2, COL.aceroOsc));
      K.agregar(K.caja(0.9, 0.3, 0.9, COL.naranja, [px, D.y + 0.35, pz]));
      const dir = V3(D.x - rueda.x, 0, D.z - rueda.z).normalize();
      const S = rueda.clone().addScaledVector(dir, 1.35);
      K.agregar(K.barra(S.toArray(), D.toArray(), 0.045, 0x2a3240));
      // plataforma de carga colgada del cable
      const g = new THREE.Group(); const u0 = 0.3;
      g.position.copy(S).lerp(D, u0); g.rotation.y = Math.atan2(dir.x, dir.z);
      g.add(K.caja(0.5, 0.35, 0.8, 0x2a3240, [0, 0, 0]));
      for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        g.add(K.barra([a * 1.28, -2.62, b * 1.28], [a * 1.28, -0.75, b * 1.28], 0.045, COL.aceroOsc));
        g.add(K.barra([a * 1.28, -0.75, b * 1.28], [0, -0.1, 0], 0.045, COL.aceroOsc));
      }
      g.add(K.caja(2.7, 0.12, 2.7, COL.naranjaOsc, [0, -2.68, 0]));
      const cajas = pilaCajas(K, TOTAL_KITS, 6, 6); cajas.position.y = -2.62; g.add(cajas);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), transparente()); hit.position.y = -1.4; g.add(hit);
      const lbl = K.etiqueta('0 kits', [0, 0.9, 0], 'acento grande', g);
      K.agregar(g);
      K.clicable(g, () => this.sumar(K, i, this.paso));
      this.plats.push({ g, cajas, lbl, S, D, u0 });
    });
    // depósito con los 120 kits
    this.deposito = pilaCajas(K, TOTAL_KITS, 6, 5); this.deposito.position.set(7.4, 0, 12.6); K.agregar(this.deposito);
    K.agregar(K.caja(3, 0.12, 2.6, COL.maderaOsc, [7.4, 0.06, 12.6]));
    this.lblDep = K.etiqueta('', [7.4, 2.4, 12.6], 'claro');
    for (let i = 0; i < 6; i++) K.agregar(pino(K, -24 + (i % 3) * 3.5 + azar(), 6 + Math.floor(i / 3) * 4 + azar() * 2, 0.9 + azar() * 0.4));
    for (let i = 0; i < 5; i++) K.agregar(pino(K, 22 + (i % 3) * 3 + azar(), 4 + Math.floor(i / 3) * 4.5 + azar() * 2, 0.9 + azar() * 0.4));

    // panel
    K.opciones('Cargar de a', [[1, '1 kit'], [5, '5 kits'], [10, '10 kits']], { elegida: 1, alElegir: v => { this.paso = v; } });
    const cont = K.controles();
    REFUGIOS.forEach((r, i) => {
      const inp = K.h('input', { class: 'entrada', type: 'number', min: 0, max: TOTAL_KITS, step: 1, value: 0, inputmode: 'numeric', 'aria-label': `Kits para el Refugio ${r.nombre}` });
      inp.addEventListener('input', () => { const v = Math.round(K.num(inp)); this.kits[i] = Number.isFinite(v) ? Math.max(0, Math.min(TOTAL_KITS, v)) : 0; this.actualizar(K, false); });
      cont.append(K.h('div', { class: 'fila-kit' },
        K.h('div', {}, K.h('b', { style: `color:${r.css}` }, `Refugio ${r.nombre}`), K.h('div', { class: 'n' }, `${r.hab} habitantes`)),
        K.h('div', { style: 'display:flex;gap:6px;align-items:center' },
          K.h('button', { class: 'btn btn-sec btn-chico', title: 'Descargar', 'aria-label': `Quitar kits del Refugio ${r.nombre}`, onclick: () => this.sumar(K, i, -this.paso) }, '−'), inp,
          K.h('button', { class: 'btn btn-sec btn-chico', title: 'Cargar', 'aria-label': `Cargar kits para el Refugio ${r.nombre}`, onclick: () => this.sumar(K, i, this.paso) }, '+'))));
      this.inps.push(inp);
    });
    this.lblTotal = K.html('');
    this.inpK = K.campoNumero('¿Cuántos kits recibe cada habitante?', { id: 'kitsPorHab', sufijo: 'kits', min: 0 });
    this.actualizar(K);
  },
  sumar(K, i, d) { this.kits[i] = Math.max(0, Math.min(TOTAL_KITS, this.kits[i] + d)); this.actualizar(K); },
  actualizar(K, sinc = true) {
    const s = this.kits.reduce((a, b) => a + b, 0);
    this.plats.forEach((p, i) => { p.cajas.count = Math.min(TOTAL_KITS, this.kits[i]); p.lbl.texto(`${this.kits[i]} kits`); if (sinc) this.inps[i].value = this.kits[i]; });
    this.deposito.count = Math.max(0, TOTAL_KITS - s);
    this.lblDep.texto(s > TOTAL_KITS ? `Depósito: ¡faltan ${s - TOTAL_KITS} kits!` : `Depósito: ${TOTAL_KITS - s} kits`);
    this.lblTotal.innerHTML = `<div class="total-kits${s > TOTAL_KITS ? ' mal' : ''}">Cargados: <b class="num">${s}</b> de ${TOTAL_KITS} kits</div>`;
    K.refrescarMat();
  },
  comprobar(K) {
    const [a, b, c] = this.kits; const s = a + b + c;
    if (s === 0) return { ok: false, msg: 'Las plataformas están vacías: cargá los kits antes de enviar el teleférico.' };
    if (s !== TOTAL_KITS) return { ok: false, msg: s < TOTAL_KITS ? `Cargaste ${s} kits y quedan ${TOTAL_KITS - s} en el depósito: hay que mandar los ${TOTAL_KITS}.` : `Cargaste ${s} kits, pero en el depósito hay sólo ${TOTAL_KITS}.` };
    if (a === b && b === c) return { ok: false, msg: 'Repartiste en <b>partes iguales</b>: cada refugio recibe lo mismo, pero no tienen la misma cantidad de habitantes. Así, a una persona del Cóndor le tocaría mucho más que a una del Glaciar. El reparto tiene que ser <b>proporcional a los habitantes</b>.' };
    const prop = a * 7 === b * 4 && b * 9 === c * 7;
    if (!prop) {
      if (a >= b || b >= c) return { ok: false, msg: 'Le diste igual o más kits a un refugio que tiene <b>menos</b> habitantes. En un reparto directamente proporcional, a más personas, más kits.' };
      return { ok: false, msg: `Suma 120, pero no es justo: con tu reparto cada habitante recibe <b>${fmtQ(a, 4)}</b> kits en el Cóndor, <b>${fmtQ(b, 7)}</b> en el Lenga y <b>${fmtQ(c, 9)}</b> en el Glaciar. Esos tres números tienen que ser iguales.` };
    }
    const k = K.leerFrac(this.inpK.value);
    if (!k) return { ok: false, msg: 'El reparto quedó justo. Para enviar, escribí también cuántos kits recibe cada habitante.' };
    if (K.igualFrac(k, K.frac(20))) return { ok: false, msg: 'Escribiste la cantidad total de habitantes, no los kits que recibe cada uno.' };
    if (K.igualFrac(k, K.frac(40))) return { ok: false, msg: 'Ese número es lo que recibiría cada <b>refugio</b> en partes iguales, no cada persona.' };
    if (!K.igualFrac(k, K.frac(6))) return { ok: false, msg: 'Las plataformas están bien cargadas, pero los kits por habitante que escribiste no coinciden con tu reparto. Elegí un refugio y fijate cuánto le toca a cada persona.' };
    return { ok: true, msg: '¡Reparto justo! Cada habitante recibe 6 kits: la razón kits/habitantes es la misma en los tres refugios. Sale el teleférico.' };
  },
  alResolver(K) {
    this.plats.forEach((p, i) => animar(K, 2.1, u => {
      const e = suave(u); p.g.position.copy(p.S).lerp(p.D, p.u0 + (0.965 - p.u0) * e);
      if (u >= 1) p.lbl.texto('¡Entregado!');
    }, i * 0.2));
    return 2900;
  },
  pistas: [
    '“Justo” no quiere decir “igual para cada refugio”: un refugio con más gente necesita más kits. Lo que tiene que ser igual es lo que recibe <b>cada persona</b>.',
    'Imaginá que juntás a todas las personas de los tres refugios y repartís los 120 kits entre todas. Después, cada refugio se lleva lo de su gente.',
    'Sumá los habitantes de los tres refugios y dividí 120 por ese total: eso es lo que recibe cada habitante (la constante de proporcionalidad). Después multiplicala por los habitantes de cada refugio.',
  ],
  bitacora: [
    '¿Qué procedimiento usaste para repartir los 120 kits? Escribí las cuentas que hiciste.',
    '¿Por qué un reparto en partes iguales no es justo en esta situación? ¿Qué significa que el reparto sea <b>directamente proporcional</b> a los habitantes y qué papel cumple la constante de proporcionalidad?',
    '¿Cómo podés comprobar que tu reparto es correcto? Proponé al menos dos verificaciones distintas (por ejemplo, con la suma y con las razones).',
  ],
  resumenBitacora: () => 'Repartiste 120 kits entre refugios de <b>4, 7 y 9</b> habitantes: <b>24, 42 y 54</b> kits, a razón de <b>6 kits por persona</b>.',
  mat(K, el) {
    const [a, b, c] = this.kits; const s = a + b + c;
    const filas = REFUGIOS.map((r, i) => `<tr><td style="color:${r.css}">${r.nombre}</td><td>${r.hab}</td><td>${this.kits[i]}</td><td>${this.kits[i]} ÷ ${r.hab} = <b>${fmtQ(this.kits[i], r.hab)}</b></td></tr>`).join('');
    el.append(K.h('table', { class: 'tabla-mat', html: `<thead><tr><th>Refugio</th><th>Habitantes</th><th>Kits</th><th>Kits por habitante</th></tr></thead><tbody>${filas}<tr><td>Total</td><td>20</td><td class="${s === TOTAL_KITS ? 'si' : 'no'}">${s}</td><td></td></tr></tbody>` }));
    const yMax = Math.max(60, Math.ceil((Math.max(a, b, c) + 6) / 10) * 10);
    const G = grafico(K, { xMax: 10, yMax, pasoX: 1, pasoY: 10, etqX: 'habitantes', etqY: 'kits', alto: 270 });
    const prop = s > 0 && a * 7 === b * 4 && b * 9 === c * 7;
    REFUGIOS.forEach((r, i) => {
      const y = this.kits[i]; if (!y) return;
      const fin = Math.min(10, yMax * r.hab / y);
      G.g.append(K.s('line', { x1: G.X(0), y1: G.Y(0), x2: G.X(fin), y2: G.Y(y * fin / r.hab), stroke: r.css, 'stroke-width': prop ? 2.5 : 1.6, 'stroke-dasharray': prop ? '' : '5 4', opacity: 0.85 }));
    });
    REFUGIOS.forEach((r, i) => {
      const y = this.kits[i];
      G.g.append(K.s('circle', { cx: G.X(r.hab), cy: G.Y(y), r: 6, fill: r.css, stroke: '#fff', 'stroke-width': 2 }));
      G.g.append(K.s('text', { x: G.X(r.hab) + 9, y: G.Y(y) - 8, 'font-weight': 700, fill: '#1b2333' }, `(${r.hab}; ${y})`));
    });
    el.append(G.svg);
    el.append(K.h('div', { class: 'formula', html: `${a} ÷ 4 ${a * 7 === b * 4 ? '=' : '≠'} ${b} ÷ 7 ${b * 9 === c * 7 ? '=' : '≠'} ${c} ÷ 9 = k &nbsp;·&nbsp; ${a} + ${b} + ${c} = ${s}` }));
    el.append(K.h('div', { class: 'nota', html: prop ? 'Los tres puntos están sobre <b>una misma recta que pasa por el origen</b>: los kits son directamente proporcionales a los habitantes.' : 'Cada recta une el origen con un refugio. Si el reparto es proporcional, las tres rectas coinciden: todas tienen la misma pendiente <b>k</b> (kits por habitante).' }));
  },
  prueba: {
    mal: [
      function (K) { this.kits = [40, 40, 40]; this.inpK.value = '6'; this.actualizar(K); },
      function (K) { this.kits = [30, 40, 50]; this.inpK.value = '6'; this.actualizar(K); },
      function (K) { this.kits = [24, 42, 50]; this.inpK.value = '6'; this.actualizar(K); },
      function (K) { this.kits = [24, 42, 54]; this.inpK.value = '20'; this.actualizar(K); },
    ],
    bien(K) { this.kits = [24, 42, 54]; this.inpK.value = '6'; this.actualizar(K); },
  },
};

/* ════════════════ Nivel 2 · Fabricación de piezas ════════════════ */
const POSTE = 7.5;
const N2 = {
  titulo: 'Fabricación de piezas',
  relato: 'Para la nueva torre de rescate hace falta un soporte triangular con la <b>misma forma</b> que el modelo de 3 m, 4 m y 5 m. El <b>poste</b> ya está instalado y mide <b>7,5 m</b>: es el lado que corresponde al de 3 m del modelo.',
  objetivo: 'Cortá la <b>base</b> y el <b>tirante</b> arrastrando las esferas naranjas sobre las reglas, para que el soporte sea <b>semejante</b> al modelo. Escribí la razón de ampliación <b>k</b>.',
  tituloMat: 'Semejanza: razón entre lados', subMat: 'nuevo ÷ modelo = k',
  textoComprobar: 'Soldar el soporte',
  armar(K) {
    camaraNivel(K, [-2.2, 10.5, 24], [-2.2, 3.2, -1.5], { min: 8, max: 80 });
    this.b = 4; this.t = 5;
    const P = this.P = V3(-6.5, 0.2, -3);
    const B0 = this.B0 = -9.5, BZ = 3.8;
    K.agregar(K.caja(32, 0.1, 15, 0xd3dce6, [-3, 0.05, 0.5]));
    // decorado del taller
    const cont = K.agregar(K.caja(9, 3.2, 3.2, COL.naranja, [-3, 1.6, -10]));
    K.agregar(K.caja(9.2, 0.15, 3.4, COL.nieve, [-3, 3.28, -10]));
    K.agregar(K.caja(2.6, 2.6, 0.08, COL.naranjaOsc, [-6.5, 1.4, -8.38]));
    K.etiqueta('Taller de rescate', [2.5, 3.9, -10], 'claro');
    for (let i = 0; i < 5; i++) K.agregar(K.caja(6, 0.22, 0.22, COL.aceroOsc, [9, 0.21 + Math.floor(i / 3) * 0.24, -7 + (i % 3) * 0.3 + (i > 2 ? 0.15 : 0)]));
    K.agregar(persona(K, [10.5, 0.1, -3], COL.naranja));
    // modelo 3-4-5
    const M = V3(-13.8, 0.2, -3);
    K.agregar(K.caja(5, 0.16, 1.2, COL.maderaOsc, [M.x + 2, 0.12, M.z]));
    const mb = (a, b) => { const v = varilla(K, 0.09, COL.glaciar); orientar(v, a, b); K.agregar(v); };
    mb(M, M.clone().add(V3(0, 3, 0))); mb(M, M.clone().add(V3(4, 0, 0))); mb(M.clone().add(V3(0, 3, 0)), M.clone().add(V3(4, 0, 0)));
    K.etiqueta('3 m', [M.x - 0.6, 1.7, M.z], 'glaciar mini'); K.etiqueta('4 m', [M.x + 2, -0.15, M.z + 0.7], 'glaciar mini'); K.etiqueta('5 m', [M.x + 2.4, 2.1, M.z], 'glaciar mini');
    K.etiqueta('Modelo', [M.x + 1.5, 4, M.z], 'claro');
    // poste instalado
    const T = this.T = P.clone().add(V3(0, POSTE, 0));
    const poste = varilla(K, 0.17, COL.acero); orientar(poste, P.clone().add(V3(0, -0.2, 0)), T); K.agregar(poste);
    K.agregar(K.caja(0.8, 0.3, 0.8, COL.aceroOsc, [P.x, 0.15, P.z]));
    K.etiqueta('poste 7,5 m', [P.x - 1.3, 4.2, P.z], 'mini');
    // base: varilla + regla + manija
    K.agregar((() => { const r = regla(K, 15, { ancho: 1, cada: 1 }); r.position.set(P.x, 0.11, P.z + 1.1); return r; })());
    this.vBase = K.agregar(varilla(K, 0.14, COL.naranja));
    this.manBase = new THREE.Group();
    this.manBase.add(K.esfera(0.36, COL.naranja, [0, 0, 0], { emissive: 0xff6a2b, emissiveIntensity: 0.25 }));
    const hb = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), transparente()); this.manBase.add(hb);
    K.agregar(this.manBase);
    this.lblBase = K.etiqueta('', [0, 0.85, 0], 'acento');
    K.arrastrable(this.manBase, { ejes: 'x', snap: 0.5, limites: { x: [P.x + 1, P.x + 15] }, alMover: p => { this.b = p.x - P.x; this.actualizar(K); } });
    // banco de corte del tirante
    K.agregar(K.caja(17, 0.3, 0.5, COL.maderaOsc, [B0 + 8, 0.15, BZ]));
    K.agregar((() => { const r = regla(K, 16, { ancho: 1, cada: 1 }); r.position.set(B0, 0.11, BZ + 0.9); return r; })());
    K.etiqueta('Banco de corte del tirante', [B0 + 3.2, 0.05, BZ + 2], 'mini');
    this.vTirBanco = K.agregar(varilla(K, 0.13, COL.naranja));
    this.manTir = new THREE.Group();
    this.manTir.add(K.esfera(0.36, COL.naranja, [0, 0, 0], { emissive: 0xff6a2b, emissiveIntensity: 0.25 }));
    const ht = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), transparente()); this.manTir.add(ht);
    K.agregar(this.manTir);
    this.lblTir = K.etiqueta('', [0, 0.9, 0], 'acento', this.manTir);
    K.arrastrable(this.manTir, { ejes: 'x', snap: 0.5, limites: { x: [B0 + 1, B0 + 16] }, alMover: p => { this.t = p.x - B0; this.actualizar(K); } });
    // tirante armado en la estructura
    this.vTir = K.agregar(varilla(K, 0.13, COL.naranja));
    this.union = K.agregar(K.esfera(0.32, COL.rojo, [0, 0, 0]));
    this.lblUnion = K.etiqueta('', [0, 1.1, 0], 'rojo', this.union);
    this.lblTirArm = K.etiqueta('', [0, 0, 0], 'mini');
    this.hueco = K.agregar(K.linea([[0, 0, 0], [1, 1, 1]], 0xff3b4f, { discontinua: true }));
    // marca de ángulo recto
    K.agregar(K.linea([[P.x + 0.6, P.y, P.z], [P.x + 0.6, P.y + 0.6, P.z], [P.x, P.y + 0.6, P.z]], 0x1b2333));
    this.inpK = K.campoNumero('Razón de ampliación k (nuevo ÷ modelo)', { id: 'razonK' }); this.inpK.type = 'text'; this.inpK.placeholder = 'p. ej. 3/2 o 1,5'; this.inpK.addEventListener('input', () => K.refrescarMat());
    this.datos = K.datos([['Modelo', '3 m · 4 m · 5 m'], ['Poste nuevo', '7,5 m'], ['Base nueva', ''], ['Tirante nuevo', '']]);
    this.actualizar(K);
  },
  cierra() { return (2 * this.t) ** 2 === 4 * POSTE * POSTE + (2 * this.b) ** 2; },
  actualizar(K) {
    const P = this.P, b = this.b, t = this.t;
    orientar(this.vBase, P, P.clone().add(V3(b, 0, 0)));
    this.manBase.position.set(P.x + b, P.y, P.z);
    this.lblBase.position.set(P.x + b / 2, P.y + 0.75, P.z); this.lblBase.texto(`base ${fmtN(b)} m`);
    orientar(this.vTirBanco, V3(this.B0, 0.45, 3.8), V3(this.B0 + t, 0.45, 3.8));
    this.manTir.position.set(this.B0 + t, 0.45, 3.8);
    this.lblTir.texto(`tirante ${fmtN(t)} m`);
    const E = P.clone().add(V3(b, 0, 0)); const dir = E.clone().sub(this.T).normalize();
    const fin = this.T.clone().addScaledVector(dir, t);
    orientar(this.vTir, this.T, fin);
    this.lblTirArm.position.copy(this.T).lerp(fin, 0.5).add(V3(0.9, 0.5, 0)); this.lblTirArm.texto(`${fmtN(t)} m`);
    const ok = this.cierra(); const dist = E.distanceTo(this.T);
    this.union.position.copy(E);
    this.union.material.color.setHex(ok ? 0x3ddc97 : COL.rojo);
    this.lblUnion.element.className = 'lbl mini ' + (ok ? 'verde' : 'rojo');
    this.lblUnion.texto(ok ? '✓ cierra' : t < dist ? '✗ no llega' : '✗ se pasa');
    this.hueco.visible = !ok && t < dist;
    this.hueco.geometry.setFromPoints([fin, E]); this.hueco.computeLineDistances();
    const dd = this.datos.querySelectorAll('dd'); dd[2].textContent = fmtN(b) + ' m'; dd[3].textContent = fmtN(t) + ' m';
    K.refrescarMat();
  },
  poner(K, b, t, k) { this.b = b; this.t = t; this.inpK.value = k; this.actualizar(K); },
  comprobar(K) {
    const b = this.b, t = this.t;
    if (b === 4 && t === 5) return { ok: false, msg: 'Las barras miden lo mismo que en el modelo (4 m y 5 m), pero el poste nuevo es mucho más largo: así no se conserva la forma.' };
    if (b - 4 === POSTE - 3 || t - 5 === POSTE - 3) return { ok: false, msg: 'Le sumaste a una barra lo mismo que creció el poste (4,5 m). Ampliar no es sumar: para conservar la forma, cada lado se <b>multiplica</b> por el mismo número.' };
    if (b === POSTE) return { ok: false, msg: 'La base quedó igual al poste, pero en el modelo la base (4 m) y el poste (3 m) no miden lo mismo. Revisá qué lado del modelo le corresponde a cada barra.' };
    const semB = 3 * b === 4 * POSTE, semT = 3 * t === 5 * POSTE;
    if (!(semB && semT)) {
      if (this.cierra()) return { ok: false, msg: 'El tirante cierra el triángulo, pero la forma cambió: es otro triángulo rectángulo, no uno semejante al modelo. Compará las razones base ÷ 4, poste ÷ 3 y tirante ÷ 5: tienen que ser iguales.' };
      if (semB) return { ok: false, msg: 'La base conserva la razón del poste, pero el tirante no: con ese largo no encaja justo en la punta de la base. ¿Por cuánto tenés que multiplicar los 5 m del modelo?' };
      if (semT) return { ok: false, msg: 'El tirante conserva la razón del poste, pero la base no. ¿Por cuánto tenés que multiplicar los 4 m del modelo?' };
      return { ok: false, msg: 'Ninguna de las dos barras conserva la razón entre el poste nuevo y el del modelo: así el soporte no es semejante. Empezá calculando esa razón.' };
    }
    const k = K.leerFrac(this.inpK.value);
    if (!k) return { ok: false, msg: 'Las barras quedaron bien. Para soldar, escribí también la razón de ampliación k.' };
    if (K.igualFrac(k, K.frac(2, 5))) return { ok: false, msg: 'Escribiste la razón al revés (modelo ÷ nuevo). k compara el soporte <b>nuevo</b> con el modelo, y el nuevo es más grande: k tiene que ser mayor que 1.' };
    if (K.igualFrac(k, K.frac(9, 2))) return { ok: false, msg: 'Eso es lo que creció el poste (una diferencia), no la razón entre las longitudes.' };
    if (!K.igualFrac(k, K.frac(5, 2))) return { ok: false, msg: 'Las barras están bien, pero la k que escribiste no es el número por el que multiplicaste cada lado.' };
    return { ok: true, msg: '¡Soporte semejante! Base 10 m, poste 7,5 m y tirante 12,5 m: los tres lados del modelo multiplicados por k = 2,5.' };
  },
  alResolver(K) {
    const pl = K.agregar(K.caja(3.2, 0.3, 2.4, COL.aceroOsc, [this.T.x + 1, 16, this.T.z]));
    const bandera = K.agregar(K.caja(1.1, 0.7, 0.05, COL.naranja, [this.T.x + 0.6, 0, this.T.z]));
    const asta = K.agregar(K.cilindro(0.04, 0.04, 1.6, 0x2a3240, [this.T.x, 0, this.T.z], 6));
    animar(K, 1.2, u => { pl.position.y = 16 + (this.T.y + 0.3 - 16) * suave(u); });
    animar(K, 0.8, u => { const y = this.T.y + 0.45 + u * 0.8; asta.position.y = y; bandera.position.y = y + 0.4; }, 1.1);
    [this.vBase, this.vTir].forEach(v => v.material.emissive.setHex(0xff6a2b));
    return 2000;
  },
  pistas: [
    'Dos figuras son semejantes cuando una es una ampliación (o reducción) de la otra: todos los lados se <b>multiplican</b> por el mismo número k. Sumarle lo mismo a cada lado no conserva la forma.',
    'El poste nuevo (7,5 m) corresponde al lado de 3 m del modelo. ¿Por qué número hay que multiplicar 3 para obtener 7,5? Ese número es la razón k.',
    'Con k calculada: base nueva = 4 · k y tirante nuevo = 5 · k. Llevá cada esfera hasta esa marca de su regla (avanzan de a 0,5 m) y escribí k.',
  ],
  bitacora: [
    '¿Cómo encontraste la razón de ampliación k y cómo calculaste la base y el tirante nuevos? Anotá las cuentas.',
    '¿Por qué ampliar un triángulo no es sumarle lo mismo a cada lado? Explicá qué se conserva y qué cambia cuando dos triángulos son semejantes (lados, ángulos, razones).',
    '¿Cómo podés comprobar que el soporte nuevo es semejante al modelo? Proponé una verificación con las razones y otra con el triángulo armado.',
  ],
  resumenBitacora: () => 'Ampliaste el soporte 3-4-5 con razón <b>k = 2,5</b>: poste <b>7,5 m</b>, base <b>10 m</b> y tirante <b>12,5 m</b>.',
  mat(K, el) {
    const s = K.s, b = this.b, t = this.t, e = 24, oy = 232;
    const svg = s('svg', { viewBox: '0 0 560 262', style: 'height:auto;min-height:0', 'font-family': 'JetBrains Mono, monospace', 'font-size': 12 });
    const tri = (ox, p, ba, ti, col, nombre) => {
      const g = s('g');
      const T = [ox, oy - p * e], E = [ox + ba * e, oy];
      const d = Math.hypot(E[0] - T[0], E[1] - T[1]), u = [(E[0] - T[0]) / d, (E[1] - T[1]) / d], F = [T[0] + u[0] * ti * e, T[1] + u[1] * ti * e];
      g.append(s('path', { d: `M${ox} ${oy} L${E[0]} ${E[1]}`, stroke: col, 'stroke-width': 4, 'stroke-linecap': 'round' }));
      g.append(s('path', { d: `M${ox} ${oy} L${T[0]} ${T[1]}`, stroke: col, 'stroke-width': 4, 'stroke-linecap': 'round' }));
      g.append(s('path', { d: `M${T[0]} ${T[1]} L${F[0]} ${F[1]}`, stroke: col, 'stroke-width': 4, 'stroke-linecap': 'round' }));
      g.append(s('path', { d: `M${ox + 9} ${oy} L${ox + 9} ${oy - 9} L${ox} ${oy - 9}`, fill: 'none', stroke: '#1b2333' }));
      g.append(s('text', { x: ox - 8, y: oy - p * e / 2, 'text-anchor': 'end', fill: '#1b2333' }, fmtN(p)));
      g.append(s('text', { x: ox + ba * e / 2, y: oy + 18, 'text-anchor': 'middle', fill: '#1b2333' }, fmtN(ba)));
      g.append(s('text', { x: (T[0] + F[0]) / 2 + 8, y: (T[1] + F[1]) / 2 - 6, fill: '#1b2333' }, fmtN(ti)));
      g.append(s('text', { x: ox, y: oy - p * e - 14, 'font-weight': 700, fill: col, 'font-family': 'Atkinson Hyperlegible, sans-serif', 'font-size': 14 }, nombre));
      return g;
    };
    svg.append(tri(40, 3, 4, 5, '#3f8fd0', 'Modelo'));
    svg.append(tri(190, POSTE, b, t, '#ff6a2b', 'Soporte nuevo'));
    el.append(svg);
    const k0 = POSTE / 3;
    const fila = (n, m, v) => { const r = v / m; const igual = Math.abs(r - k0) < 1e-9; return `<tr><td>${n}</td><td>${m}</td><td>${fmtN(v)}</td><td>${fmtN(v)} ÷ ${m} = <b>${fmtN(r)}</b></td><td class="${igual ? 'si' : 'no'}">${igual ? '= poste' : '≠ poste'}</td></tr>`; };
    el.append(K.h('table', { class: 'tabla-mat', html: `<thead><tr><th>Lado</th><th>Modelo</th><th>Nuevo</th><th>Nuevo ÷ modelo</th><th></th></tr></thead><tbody>
      <tr><td>Poste</td><td>3</td><td>7,5</td><td>7,5 ÷ 3 = <b>${fmtN(k0)}</b></td><td></td></tr>${fila('Base', 4, b)}${fila('Tirante', 5, t)}</tbody>` }));
    el.append(K.h('div', { class: 'formula', html: `¿El tirante cierra el triángulo? <span style="color:${this.cierra() ? '#14845a' : '#c2283a'}">${this.cierra() ? 'sí' : 'no'}</span> &nbsp;·&nbsp; ¿Tres razones iguales? <span style="color:${3 * b === 4 * POSTE && 3 * t === 5 * POSTE ? '#14845a' : '#c2283a'}">${3 * b === 4 * POSTE && 3 * t === 5 * POSTE ? 'sí' : 'no'}</span>` }));
    el.append(K.h('div', { class: 'nota', html: 'Si dos triángulos son semejantes, el cociente entre lados correspondientes es siempre el mismo número: la <b>razón de semejanza k</b>. Los ángulos no cambian.' }));
  },
  prueba: {
    mal: [
      function (K) { this.poner(K, 8.5, 9.5, '5/2'); },
      function (K) { this.poner(K, 4, 8.5, '5/2'); },
      function (K) { this.poner(K, 10, 12.5, '2/5'); },
      function (K) { this.poner(K, 10, 11, '2,5'); },
    ],
    bien(K) { this.poner(K, 10, 12.5, '5/2'); },
  },
};

/* ════════════════ Nivel 3 · Medición de una torre ════════════════ */
const TX = -12, TZ = -2, ALTO_TORRE = 24, BAST = 2, BZ = 5.5, RB0 = -4, RB1 = 12;
function torreRescate(K) {
  const g = new THREE.Group();
  const pierna = (sx, sz, y) => { const f = y / 19; return [sx * (1.5 - 1.15 * f), y, sz * (1.5 - 1.15 * f)]; };
  const esq = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  const niveles = [0, 4.75, 9.5, 14.25, 19];
  for (const [sx, sz] of esq) for (let i = 0; i < 4; i++) g.add(K.barra(pierna(sx, sz, niveles[i]), pierna(sx, sz, niveles[i + 1]), 0.12, i % 2 ? 0xf3f3f3 : COL.rojo));
  for (let i = 1; i < 5; i++) for (let j = 0; j < 4; j++) {
    const [ax, az] = esq[j], [bx, bz] = esq[(j + 1) % 4];
    g.add(K.barra(pierna(ax, az, niveles[i]), pierna(bx, bz, niveles[i]), 0.06, COL.aceroOsc));
    g.add(K.barra(pierna(ax, az, niveles[i - 1]), pierna(bx, bz, niveles[i]), 0.045, COL.aceroOsc));
  }
  g.add(K.caja(1.5, 0.2, 1.5, COL.aceroOsc, [0, 19.1, 0]));
  g.add(K.cilindro(0.1, 0.1, 4.2, COL.acero, [0, 21.3, 0], 8));
  g.add(K.cilindro(0.1, 0.1, 0.6, COL.rojo, [0, 23.7, 0], 8)); // la antena termina justo a 24 m
  const baliza = K.esfera(0.24, COL.rojo, [0, 21, 0], { emissive: 0xff2030, emissiveIntensity: 0.8 }); g.add(baliza); g.baliza = baliza;
  g.add(K.caja(3.6, 0.25, 3.6, COL.hormigon, [0, 0.12, 0]));
  return g;
}
const N3 = {
  titulo: 'Medición de una torre',
  relato: 'La antena de la torre de rescate quedó cubierta de hielo y el helicóptero necesita saber su <b>altura</b> para acercarse. Nadie puede subir con esta tormenta… pero salió el sol, y a esta hora <b>todas las sombras tienen la misma inclinación</b>.',
  objetivo: 'Ubicá el <b>bastón de 2 m</b> sobre la regla azul, medí con las banderas las sombras de la torre y del bastón (hasta la punta de cada sombra) y calculá la altura de la torre.',
  tituloMat: 'Triángulos semejantes con sombras', subMat: 'altura ÷ sombra se conserva',
  textoComprobar: 'Enviar altura al helicóptero',
  armar(K) {
    camaraNivel(K, [-1, 12, 37], [-1, 7, -1], { min: 6, max: 90, desplMovil: [-4, 0, 0] });
    const solPrev = K.sol.position.clone();
    K.sol.position.set(-30, 40, 0); // rayos con razón vertical : horizontal = 4 : 3
    const cam = K.sol.shadow.camera, prev = [K.hemi.intensity, K.sol.intensity, cam.left, cam.right, cam.top, cam.bottom];
    K.hemi.intensity = 0.55; K.sol.intensity = 2.8;
    Object.assign(cam, { left: -34, right: 34, top: 34, bottom: -34 }); cam.updateProjectionMatrix();
    K.alLimpiar(() => { K.sol.position.copy(solPrev); [K.hemi.intensity, K.sol.intensity, cam.left, cam.right, cam.top, cam.bottom] = prev; cam.updateProjectionMatrix(); });
    this.torre = K.agregar(torreRescate(K)); this.torre.position.set(TX, 0, TZ);
    K.etiqueta('Torre de rescate · altura ?', [TX, 25.6, TZ], 'claro');
    K.agregar(refugio(K, COL.glaciar)).position.set(TX - 5, 0, TZ - 6);
    K.agregar(persona(K, [TX + 2.5, 0, TZ - 4.5], COL.naranja));
    K.agregar(persona(K, [TX + 3.4, 0, TZ - 5.2], COL.glaciar));
    // regla de la torre (0 bajo la antena)
    const rA = regla(K, 22, { ancho: 1.6, cada: 2, color: '#c9501c' }); rA.position.set(TX, 0.03, TZ); K.agregar(rA);
    this.cintaA = K.agregar(K.caja(1, 0.03, 0.14, COL.rojo, [0, 0.07, TZ + 0.62]));
    this.bandA = K.agregar(banderin(K, COL.rojo)); this.bandA.position.set(TX + 4, 0, TZ);
    this.lblA = K.etiqueta('', [0, 2.2, 0.85], 'acento', this.bandA);
    K.arrastrable(this.bandA, { ejes: 'x', snap: 0.5, limites: { x: [TX + 1, TX + 22] }, alMover: () => this.actualizar(K) });
    // zona de medición del bastón
    const rB = regla(K, RB1 - RB0, { ancho: 1.4, cada: 1 }); rB.position.set(RB0, 0.03, BZ); K.agregar(rB);
    K.etiqueta('Zona de medición', [RB0 - 2.4, 0.3, BZ + 0.2], 'mini glaciar');
    this.baston = new THREE.Group();
    this.baston.add(K.cilindro(0.085, 0.085, 1, COL.naranja, [0, 0.5, 0], 10));
    this.baston.add(K.cilindro(0.085, 0.085, 1, 0xf5f5f5, [0, 1.5, 0], 10));
    this.baston.add(K.cilindro(0.3, 0.3, 0.04, 0x2a3240, [0, 0.02, 0], 12));
    const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 2.4, 8), transparente()); hb.position.y = 1.2; this.baston.add(hb);
    this.baston.position.set(-8, 0, BZ); K.agregar(this.baston);
    K.etiqueta('bastón 2 m', [0, 2.55, 0], 'mini', this.baston);
    this.cintaB = K.agregar(K.caja(1, 0.03, 0.12, COL.glaciar, [0, 0.07, BZ + 0.55]));
    this.bandB = K.agregar(banderin(K, COL.glaciar)); this.bandB.position.set(-5, 0, BZ);
    this.lblB = K.etiqueta('', [0, 2.2, 0.85], 'glaciar', this.bandB);
    const aB = K.arrastrable(this.bandB, { ejes: 'x', snap: 0.5, limites: { x: [-8.5, -2] }, alMover: () => this.actualizar(K) });
    this.limB = () => { aB.limites.x = [this.baston.position.x + 0.5, this.baston.position.x + 6]; };
    K.arrastrable(this.baston, { ejes: 'x', snap: 0.5, limites: { x: [-9, RB1 - 2] }, alMover: p => {
      this.bandB.position.x = p.x + this.offB; this.limB(); this.actualizar(K);
    }, alTomar: () => { this.offB = this.bandB.position.x - this.baston.position.x; } });
    this.offB = 3; this.limB();
    // rayos de sol (modo matemático)
    this.rayos = new THREE.Group(); K.agregar(this.rayos); this.rayos.visible = K.modoMat;
    this.rA = K.linea([[0, 0, 0], [1, 1, 1]], 0xffb21a); this.rB = K.linea([[0, 0, 0], [1, 1, 1]], 0xffb21a);
    this.cA = K.linea([[0, 0, 0], [1, 1, 1], [2, 2, 2]], 0xc9501c); this.cB = K.linea([[0, 0, 0], [1, 1, 1], [2, 2, 2]], 0x24578c);
    this.rayos.add(this.rA, this.rB, this.cA, this.cB);
    this.datos = K.datos([['Bastón', '2 m'], ['Sombra de la torre', ''], ['Sombra del bastón', '']]);
    this.inpH = K.campoNumero('Altura de la torre', { id: 'alturaTorre', sufijo: 'm' }); this.inpH.type = 'text'; this.inpH.inputMode = 'decimal'; this.inpH.addEventListener('input', () => K.refrescarMat());
    this.actualizar(K);
  },
  medidas() { return { dA: this.bandA.position.x - TX, dB: this.bandB.position.x - this.baston.position.x, xb: this.baston.position.x }; },
  actualizar(K) {
    const { dA, dB, xb } = this.medidas();
    this.cintaA.scale.x = dA; this.cintaA.position.x = TX + dA / 2;
    this.cintaB.scale.x = Math.max(0.01, dB); this.cintaB.position.x = xb + dB / 2;
    this.lblA.texto(`${fmtN(dA)} m`); this.lblB.texto(`${fmtN(dB)} m`);
    const dd = this.datos.querySelectorAll('dd'); dd[1].textContent = fmtN(dA) + ' m'; dd[2].textContent = xb < RB0 ? 'ubicá el bastón' : fmtN(dB) + ' m';
    const xA = this.bandA.position.x, xB = this.bandB.position.x;
    this.rA.geometry.setFromPoints([V3(TX, ALTO_TORRE, TZ), V3(xA, 0.1, TZ)]);
    this.rB.geometry.setFromPoints([V3(xb, BAST, BZ), V3(xB, 0.1, BZ)]);
    this.cA.geometry.setFromPoints([V3(TX, ALTO_TORRE, TZ), V3(TX, 0.12, TZ), V3(xA, 0.12, TZ)]);
    this.cB.geometry.setFromPoints([V3(xb, BAST, BZ), V3(xb, 0.12, BZ), V3(xB, 0.12, BZ)]);
    K.refrescarMat();
  },
  alCambiarModo(K, esMat) { this.rayos.visible = esMat; },
  poner(K, xb, xB, xA, H) { this.baston.position.x = xb; this.bandB.position.x = xB; this.bandA.position.x = xA; this.limB(); this.inpH.value = H; this.actualizar(K); },
  comprobar(K) {
    const { dA, dB, xb } = this.medidas();
    if (xb < RB0) return { ok: false, msg: 'Primero ubicá el bastón sobre la regla azul de la zona de medición: fuera de ella no podés medir su sombra.' };
    if (dA !== 18) return { ok: false, msg: `La bandera roja ${dA < 18 ? 'no llega hasta' : 'se pasa de'} la punta de la sombra de la torre. Acercá la cámara y fijate dónde termina la sombra de la antena.` };
    if (dB !== 1.5) return { ok: false, msg: `La bandera azul ${dB < 1.5 ? 'no llega hasta' : 'se pasa de'} la punta de la sombra del bastón. Acercá la cámara al bastón y medí de nuevo.` };
    const H = K.leerFrac(this.inpH.value);
    if (!H) return { ok: false, msg: 'Las dos sombras están bien medidas. Ahora calculá la altura de la torre y escribila.' };
    const Hv = H.n / H.d;
    if (K.igualFrac(H, K.frac(24))) return { ok: true, msg: '¡Altura confirmada: 24 m! Altura ÷ sombra = 2 ÷ 1,5 en los dos triángulos. El helicóptero ya puede acercarse.' };
    if (K.igualFrac(H, K.frac(27, 2))) return { ok: false, msg: 'Invertiste la razón: el bastón es <b>más alto</b> que su sombra, así que la torre también tiene que ser más alta que la suya. Revisá qué dividiste por qué.' };
    if (K.igualFrac(H, K.frac(37, 2))) return { ok: false, msg: 'Sumaste a la sombra la diferencia entre el bastón y su sombra (0,5 m). En triángulos semejantes se conserva la <b>razón</b>, no la diferencia.' };
    if (Hv === 18) return { ok: false, msg: 'La altura no puede ser igual a la sombra: eso pasaría sólo si el bastón midiera lo mismo que su sombra.' };
    return { ok: false, msg: 'Esa altura no mantiene la misma razón altura ÷ sombra que el bastón. Planteá la proporción entre los dos triángulos y despejá.' };
  },
  alResolver(K) {
    const heli = K.agregar(helicoptero(K)); heli.rotation.y = Math.PI;
    const A = V3(45, 34, -30), B = V3(TX + 5, ALTO_TORRE + 4, TZ + 1);
    heli.position.copy(A);
    K.tic(dt => { heli.rotor.rotation.y += dt * 25; this.torre.baliza.material.emissiveIntensity = 0.4 + Math.abs(Math.sin(performance.now() / 180)); });
    animar(K, 2.4, u => { heli.position.copy(A).lerp(B, suave(u)); heli.position.y += Math.sin(u * Math.PI) * 3; });
    return 2700;
  },
  pistas: [
    'A la misma hora, los rayos del sol llegan <b>paralelos</b>: la torre con su sombra y el bastón con la suya forman dos triángulos rectángulos con el mismo ángulo de inclinación. ¿Qué podés decir de esos triángulos?',
    'Primero medí: llevá cada bandera hasta donde termina la sombra (la roja para la torre, la azul para el bastón). Acercá la cámara con la rueda para ver bien la punta. Después compará altura y sombra en el triángulo chico.',
    'Planteá la proporción altura de la torre ÷ sombra de la torre = altura del bastón ÷ sombra del bastón, reemplazá con tus medidas y despejá la altura de la torre.',
  ],
  bitacora: [
    '¿Qué midieron y qué cálculo hiciste para obtener la altura de la torre? Dibujá los dos triángulos con sus medidas.',
    '¿Por qué los dos triángulos (torre–sombra y bastón–sombra) son semejantes? ¿Qué criterio lo justifica y qué papel cumplen los rayos del sol?',
    '¿Cómo podés comprobar que la altura que calculaste es correcta? ¿Qué pasaría con las sombras una hora más tarde y con tu resultado?',
  ],
  resumenBitacora: () => 'Con un bastón de <b>2 m</b> que da una sombra de <b>1,5 m</b> y una sombra de la torre de <b>18 m</b>, calculaste que la torre mide <b>24 m</b>.',
  mat(K, el) {
    const s = K.s, { dA, dB, xb } = this.medidas(); const H = K.leerFrac(this.inpH.value);
    const svg = s('svg', { viewBox: '0 0 560 320', style: 'height:auto;min-height:0', 'font-family': 'JetBrains Mono, monospace', 'font-size': 12 });
    svg.append(s('circle', { cx: 32, cy: 30, r: 13, fill: '#ffc43d' }));
    const tri = (ox, oy, e, alto, sombra, col, tAlto, tSombra, nombre) => {
      const g = s('g');
      g.append(s('path', { d: `M${ox} ${oy} L${ox} ${oy - alto * e} L${ox + sombra * e} ${oy} Z`, fill: col, 'fill-opacity': 0.12, stroke: col, 'stroke-width': 3, 'stroke-linejoin': 'round' }));
      g.append(s('line', { x1: ox, y1: oy - alto * e, x2: ox + sombra * e, y2: oy, stroke: '#e0a100', 'stroke-width': 2.5, 'stroke-dasharray': '7 5' }));
      g.append(s('path', { d: `M${ox + 10} ${oy} L${ox + 10} ${oy - 10} L${ox} ${oy - 10}`, fill: 'none', stroke: '#1b2333' }));
      const ax = ox + sombra * e; g.append(s('path', { d: `M${ax - 26} ${oy} A26 26 0 0 0 ${ax - 26 * 0.6} ${oy - 26 * 0.8}`, fill: 'none', stroke: '#1b2333', 'stroke-width': 1.5 }));
      g.append(s('text', { x: ax - 40, y: oy - 8, fill: '#1b2333', 'font-weight': 700 }, 'α'));
      g.append(s('text', { x: ox - 8, y: oy - alto * e / 2, 'text-anchor': 'end', fill: '#1b2333', 'font-weight': 700 }, tAlto));
      g.append(s('text', { x: ox + sombra * e / 2, y: oy + 18, 'text-anchor': 'middle', fill: '#1b2333', 'font-weight': 700 }, tSombra));
      g.append(s('text', { x: ox, y: oy + 36, fill: col, 'font-weight': 700, 'font-family': 'Atkinson Hyperlegible, sans-serif', 'font-size': 13 }, nombre));
      return g;
    };
    const e = 10.5;
    svg.append(tri(80, 278, e, ALTO_TORRE, Math.max(0.5, dA), '#c9501c', H ? `${fmtN(H.n / H.d)} m` : 'H = ?', `${fmtN(dA)} m`, 'Torre'));
    if (xb >= RB0) svg.append(tri(380, 278, e * 6, BAST, Math.max(0.3, dB), '#24578c', '2 m', `${fmtN(dB)} m`, 'Bastón (dibujo ×6)'));
    else svg.append(s('text', { x: 360, y: 200, fill: '#6b7280' }, 'Ubicá el bastón en la regla'));
    el.append(svg);
    const hTxt = H ? fmtN(H.n / H.d) : 'H';
    el.append(K.h('div', { class: 'formula', html: `${hTxt} ÷ ${fmtN(dA)} = 2 ÷ ${xb >= RB0 ? fmtN(dB) : '?'}` }));
    el.append(K.h('div', { class: 'nota', html: 'Los rayos de sol son paralelos, así que el ángulo <b>α</b> con el suelo es el mismo en los dos triángulos; además los dos tienen un ángulo recto. Por el criterio <b>AA</b> son semejantes y la razón altura ÷ sombra es la misma. Mientras este modo está activo, en la escena 3D se dibujan los rayos de sol y los dos triángulos.' }));
  },
  prueba: {
    mal: [
      function (K) { this.poner(K, 2, 3.5, 6, '13,5'); },
      function (K) { this.poner(K, 2, 3.5, 6, '18,5'); },
      function (K) { this.poner(K, 2, 3.5, 5.5, '24'); },
      function (K) { this.poner(K, -8, -6.5, 6, '24'); },
    ],
    bien(K) { this.poner(K, 2, 3.5, 6, '24'); },
  },
};

/* ════════════════ Nivel 4 · Rescate final ════════════════ */
const ESC4 = 0.5;
const RAD = Math.PI / 180;
const ANG_G = [47, 33, 100];
const MODELO4 = { id: 'M', L: [8, 4, 6], lados: [0, 1, 2], angs: [[0, '29°'], [1, '47°'], [2, '104°']] };
const CANDIDATOS = [
  { id: 'A', L: [9, 12, 6], esp: 'LLL', lados: [0, 1, 2], angs: [], espejo: true, pos: [-10.8, -4.5] },
  { id: 'B', L: [12, Math.sqrt(208), 8], esp: 'no', trampa: 'lal', lados: [0, 2], angs: [[0, '90°']], pos: [-2.9, -4.5] },
  { id: 'C', L: [7.5, 10, 5], esp: 'AA', lados: [], angs: [[0, '104°'], [1, '29°']], espejo: true, pos: [3.6, -4.5] },
  { id: 'D', L: [9, 5, 7], esp: 'no', trampa: 'suma', lados: [0, 1, 2], angs: [], pos: [9.8, -4.5] },
  { id: 'E', L: [3, 6, 4.5], esp: 'LAL', lados: [0, 2], angs: [[0, '104°']], pos: [-10.5, 3] },
  { id: 'F', L: [14, 8, 12], esp: 'no', trampa: 'lll', lados: [0, 1, 2], angs: [], espejo: true, pos: [-4.5, 3] },
  { id: 'G', L: [9, 9 * Math.sin(47 * RAD) / Math.sin(100 * RAD), 9 * Math.sin(33 * RAD) / Math.sin(100 * RAD)], esp: 'no', trampa: 'aa', lados: [], angs: [[0, '47°'], [2, '100°']], pos: [9.8, 3] },
];
const TRAMPAS = {
  lal: 'Elegiste como semejante un soporte que tiene dos lados proporcionales a los del modelo, pero el <b>ángulo comprendido</b> entre ellos no es igual. Para LAL tienen que cumplirse las dos cosas.',
  suma: 'Elegiste como semejante un soporte cuyos lados se obtienen <b>sumando</b> lo mismo a los del modelo. Semejanza es multiplicar: calculá los cocientes entre lados correspondientes.',
  lll: 'En uno de los soportes que elegiste como semejantes, dos pares de lados tienen la misma razón pero el tercero no. <b>LLL</b> exige que las tres razones sean iguales.',
  aa: 'Elegiste como semejante un soporte que comparte un ángulo con el modelo, pero el otro ángulo no coincide con ninguno del modelo. <b>AA</b> necesita dos ángulos iguales.',
};
const OPC4 = [['no', 'No'], ['AA', 'AA'], ['LAL', 'LAL'], ['LLL', 'LLL']];
/** Coordenadas 2D de un triángulo dado por L = [v0v1, v1v2, v2v0]: base v0v1 sobre el eje x. */
function verticesTri(L, espejo) {
  const [a, b, c] = L; const x = (a * a + c * c - b * b) / (2 * a); const y = Math.sqrt(Math.max(0, c * c - x * x));
  let v = [[0, 0], [a, 0], [x, y]];
  if (espejo) v = v.map(([px, py]) => [a - px, py]);
  const minX = Math.min(...v.map(p => p[0])), maxX = Math.max(...v.map(p => p[0]));
  return v.map(([px, py]) => [px - (minX + maxX) / 2, py]);
}
function datosTri(c) {
  const t = [];
  c.lados.forEach(i => t.push(fmtN(c.L[i]) + ' m'));
  c.angs.forEach(([, a]) => t.push(a));
  return t.join(' · ');
}
const N4 = {
  titulo: 'Rescate final',
  relato: 'Tres excursionistas quedaron del otro lado de la grieta. Para el puente hacen falta anclajes <b>semejantes al modelo azul</b>. Elegí con los botones o con clic en cada soporte.',
  objetivo: 'Decidí si cada soporte es semejante al modelo y con qué criterio (<b>AA</b>, <b>LAL</b>, <b>LLL</b>), o marcá <b>No</b>.',
  tituloMat: 'Criterios de semejanza', subMat: 'AA · LAL · LLL',
  textoComprobar: 'Montar los anclajes',
  armar(K) {
    camaraNivel(K, [0, 21, 26.5], [0, 0, -4.5], { min: 8, max: 90 });
    this.eleccion = {}; this.sel = null; this.frames = {}; this.filas = {};
    // grieta
    const c = document.createElement('canvas'); c.width = 8; c.height = 128; const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#9fd6f5'); gr.addColorStop(0.18, '#3f7fb8'); gr.addColorStop(0.5, '#0b1a33'); gr.addColorStop(0.82, '#3f7fb8'); gr.addColorStop(1, '#9fd6f5');
    x.fillStyle = gr; x.fillRect(0, 0, 8, 128); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
    const grieta = new THREE.Mesh(new THREE.PlaneGeometry(90, 5.6), new THREE.MeshBasicMaterial({ map: tx })); grieta.rotation.x = -Math.PI / 2; grieta.position.set(0, 0.04, -13); K.agregar(grieta);
    const hielo = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.7, 0), K.mat(COL.hielo, { roughness: 0.4 }), 120);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < 120; i++) {
      const lado = i % 2 ? 1 : -1; const px = -44 + (i >> 1) * 1.5 + azar() * 0.6;
      e.set(azar() * 3, azar() * 3, azar() * 3); q.setFromEuler(e); const sc = 0.5 + azar() * 0.7;
      m4.compose(V3(px, 0.1, -13 + lado * (2.8 + azar() * 0.3)), q, V3(sc, sc * 0.7, sc)); hielo.setMatrixAt(i, m4);
    }
    hielo.castShadow = hielo.receiveShadow = true; K.agregar(hielo);
    // puente roto: torres y cables
    const torres = [[-1.7, -10], [1.7, -10], [-1.7, -16], [1.7, -16]];
    torres.forEach(([tx2, tz]) => K.agregar(K.cilindro(0.17, 0.22, 4.4, COL.maderaOsc, [tx2, 2.2, tz], 7)));
    torres.forEach(([tx2, tz]) => K.agregar(K.caja(0.5, 0.25, 0.5, COL.naranja, [tx2, 4.45, tz])));
    for (const sx of [-1.7, 1.7]) {
      const pts = []; for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push([sx, 4.2 - 2.4 * (1 - (2 * u - 1) ** 2), -10 - 6 * u]); }
      for (let i = 0; i < 12; i++) K.agregar(K.barra(pts[i], pts[i + 1], 0.04, 0x2a3240));
    }
    const tabla1 = K.agregar(K.caja(3, 0.12, 0.45, COL.madera, [0.2, 0.55, -10.5])); tabla1.rotation.x = 1.1;
    const tabla2 = K.agregar(K.caja(3, 0.12, 0.45, COL.madera, [-0.3, 0.5, -15.6])); tabla2.rotation.x = -1.2; tabla2.rotation.z = 0.3;
    this.tablas = [];
    for (let i = 0; i < 13; i++) { const t = K.agregar(K.caja(3.1, 0.12, 0.4, COL.madera, [0, 1.0 - 0.6 * (1 - ((i / 12) * 2 - 1) ** 2), -10 - i * 0.5])); t.visible = false; this.tablas.push(t); }
    // excursionistas y carpa
    this.excursionistas = [[-1.4, -19.5], [0.2, -20.2], [1.6, -19.4]].map(([px, pz], i) => K.agregar(persona(K, [px, 0, pz], [COL.amarillo, COL.rojo, 0x2fbf86][i])));
    const carpa = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.8, 4), K.mat(COL.naranja)); carpa.position.set(5, 0.9, -21); carpa.rotation.y = 0.5; carpa.castShadow = true; K.agregar(carpa);
    K.etiqueta('SOS · 3 excursionistas', [0.2, 2.6, -20], 'acento');
    // modelo
    K.agregar(K.caja(5, 1, 1.4, COL.glaciarOsc, [3, 0.5, 3]));
    this.frameModelo = this.marco(K, MODELO4, 3, 3, 1, COL.glaciar);
    K.etiqueta('MODELO', [3, 0.5, 3.72], 'glaciar');
    // candidatos
    CANDIDATOS.forEach(cd => {
      const f = this.marco(K, cd, cd.pos[0], cd.pos[1], 0.12, COL.acero);
      K.agregar(K.caja(Math.max(...f.v.map(p => p[0])) * 2 * ESC4 + 0.6, 0.12, 0.7, COL.nieve2, [cd.pos[0], 0.06, cd.pos[1]]));
      K.clicable(f.g, () => { const orden = [undefined, 'AA', 'LAL', 'LLL', 'no']; const i = orden.indexOf(this.eleccion[cd.id]); this.elegir(K, cd.id, orden[(i + 1) % orden.length]); });
      this.frames[cd.id] = f;
    });
    // panel
    K.html(`<div style="display:flex;gap:10px;align-items:center;background:var(--tinta-2);border-radius:12px;padding:6px 10px">${this.svgModelo()}<div style="font-size:12.5px;line-height:1.35;color:var(--texto-2)"><b style="color:var(--texto)">Anclaje modelo</b><br>lados 4 m, 6 m y 8 m<br>ángulos 29°, 47° y 104°<br><span style="color:var(--texto-3)">(medidos al grado)</span></div></div>`);
    const cont = K.h('div', { style: 'display:flex;flex-direction:column;gap:4px' }); K.controles().append(cont);
    CANDIDATOS.forEach(cd => {
      const grupo = K.h('div', { class: 'grupo-btn', role: 'group', 'aria-label': `Soporte ${cd.id}` });
      const btns = OPC4.map(([v, t]) => { const b = K.h('button', { class: 'btn btn-sec btn-chico', 'aria-pressed': 'false', onclick: () => this.elegir(K, cd.id, v) }, t); grupo.append(b); return [v, b]; });
      const fila = K.h('div', { class: 'fila-sop', title: datosTri(cd) }, K.h('b', {}, cd.id), grupo);
      cont.append(fila); this.filas[cd.id] = { fila, btns };
    });
    this.pintar(K);
  },
  /** Arma el triángulo 3D (barras + etiquetas de datos) parado en el plano x-y. */
  marco(K, cd, x0, z0, y0, color) {
    const g = new THREE.Group(); g.position.set(x0, y0, z0); K.agregar(g);
    const v = verticesTri(cd.L, cd.espejo); const P = v.map(([a, b]) => V3(a * ESC4, b * ESC4 + 0.1, 0));
    const mats = [];
    for (let i = 0; i < 3; i++) { const b = varilla(K, 0.085, color); orientar(b, P[i], P[(i + 1) % 3]); g.add(b); mats.push(b.material); }
    P.forEach(p => { const e = K.esfera(0.13, COL.aceroOsc, p.toArray()); g.add(e); });
    const cen = P[0].clone().add(P[1]).add(P[2]).divideScalar(3);
    const esModelo = cd.id === 'M';
    if (!esModelo) cd.lados.forEach(i => {
      const m = P[i].clone().lerp(P[(i + 1) % 3], 0.5); const fuera = m.clone().sub(cen).normalize().multiplyScalar(0.42);
      K.etiqueta(`${fmtN(cd.L[i])} m`, m.add(fuera).toArray(), esModelo ? 'glaciar mini' : 'mini', g);
    });
    if (!esModelo) cd.angs.forEach(([i, txt]) => {
      const a = P[i], b = P[(i + 1) % 3], c2 = P[(i + 2) % 3];
      const d1 = b.clone().sub(a).normalize(), d2 = c2.clone().sub(a).normalize();
      const r = 0.42; const pts = [];
      const ang = Math.acos(Math.max(-1, Math.min(1, d1.dot(d2))));
      for (let k = 0; k <= 12; k++) { const tt = k / 12; const d = d1.clone().multiplyScalar(Math.sin((1 - tt) * ang)).add(d2.clone().multiplyScalar(Math.sin(tt * ang))).divideScalar(Math.sin(ang)); pts.push(a.clone().addScaledVector(d, r).add(V3(0, 0, 0.02)).toArray()); }
      g.add(K.linea(pts, 0x1b2333));
      const bis = d1.clone().add(d2).normalize();
      K.etiqueta(txt, a.clone().addScaledVector(bis, Math.min(0.95, 0.5 * a.distanceTo(cen))).toArray(), esModelo ? 'glaciar mini' : 'claro mini', g);
    });
    const alto = Math.max(...P.map(p => p.y));
    const lbl = K.etiqueta(esModelo ? '' : cd.id, [0, alto + 0.75, 0], 'grande', g);
    if (esModelo) lbl.element.style.display = 'none';
    const forma = new THREE.Shape(P.map(p => new THREE.Vector2(p.x, p.y)));
    const hit = new THREE.Mesh(new THREE.ShapeGeometry(forma), transparente()); hit.scale.set(1.15, 1.15, 1); g.add(hit);
    const hit2 = new THREE.Mesh(new THREE.BoxGeometry(Math.max(...P.map(p => p.x)) * 2 + 0.6, alto + 0.6, 0.6), transparente()); hit2.position.y = alto / 2; g.add(hit2);
    return { g, mats, lbl, v };
  },
  svgModelo() {
    const v = verticesTri(MODELO4.L, false); const e = 12, W = 124, H = 66;
    const P = v.map(([a, b]) => [W / 2 + a * e, H - 14 - b * e]);
    const T = (x, y, t, anc, col = '#9fd6f5') => `<text x="${x}" y="${y}" fill="${col}" font-size="10" text-anchor="${anc}" font-family="JetBrains Mono">${t}</text>`;
    const m = (i, j) => [(P[i][0] + P[j][0]) / 2, (P[i][1] + P[j][1]) / 2];
    const [l6, l4] = [m(2, 0), m(1, 2)];
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="flex:none"><path d="M${P.map(p => p.join(' ')).join(' L')} Z" fill="rgba(63,143,208,.25)" stroke="#3f8fd0" stroke-width="3" stroke-linejoin="round"/>${T(P[0][0], P[0][1] + 12, '29°', 'start')}${T(P[1][0], P[1][1] + 12, '47°', 'end')}${T(P[2][0], P[2][1] - 5, '104°', 'middle')}${T(W / 2, H - 2, '8 m', 'middle', '#eef3fb')}${T(l6[0] - 5, l6[1] - 2, '6 m', 'end', '#eef3fb')}${T(l4[0] + 5, l4[1] - 2, '4 m', 'start', '#eef3fb')}</svg>`;
  },
  elegir(K, id, v) { this.eleccion[id] = v; this.sel = id; this.pintar(K); },
  pintar(K) {
    CANDIDATOS.forEach(cd => {
      const v = this.eleccion[cd.id]; const f = this.frames[cd.id];
      const col = v === undefined ? COL.acero : v === 'no' ? 0x3a4352 : COL.naranja;
      f.mats.forEach(m => { m.color.setHex(col); m.transparent = v === 'no'; m.opacity = v === 'no' ? 0.55 : 1; });
      f.lbl.element.className = 'lbl grande ' + (v === undefined ? '' : v === 'no' ? 'gris' : 'acento');
      f.lbl.texto(v === undefined ? cd.id : v === 'no' ? `${cd.id} · no` : `${cd.id} · ${v}`);
      const { fila, btns } = this.filas[cd.id];
      btns.forEach(([o, b]) => b.setAttribute('aria-pressed', o === v ? 'true' : 'false'));
      fila.classList.toggle('sel', this.sel === cd.id);
    });
    K.refrescarMat();
  },
  comprobar(K) {
    const e = this.eleccion;
    const faltan = CANDIDATOS.filter(c => !e[c.id]).length;
    if (faltan) return { ok: false, msg: `Te ${faltan === 1 ? 'falta decidir 1 soporte' : `faltan decidir ${faltan} soportes`}. Para cada uno elegí un criterio o marcá “No”.` };
    for (const c of CANDIDATOS) if (c.esp === 'no' && e[c.id] !== 'no') return { ok: false, msg: TRAMPAS[c.trampa] };
    const desc = CANDIDATOS.filter(c => c.esp !== 'no' && e[c.id] === 'no').length;
    if (desc) return { ok: false, msg: `Descartaste ${desc === 1 ? 'un soporte que sí es semejante' : desc + ' soportes que sí son semejantes'} al modelo. Revisá los que marcaste “No”: ¿con los datos que tienen alcanza para asegurar la semejanza?` };
    const mal = CANDIDATOS.filter(c => c.esp !== 'no' && e[c.id] !== c.esp).length;
    if (mal) return { ok: false, msg: `Separaste bien los soportes semejantes, pero en ${mal === 1 ? 'uno' : mal} el criterio no corresponde a los datos que tiene. AA usa dos ángulos; LAL, dos lados y el ángulo comprendido; LLL, los tres lados.` };
    return { ok: true, msg: '¡Anclajes correctos! A es semejante por LLL (k = 1,5), C por AA y E por LAL (k = 0,75). Se monta el puente.' };
  },
  alResolver(K) {
    const destinos = { A: V3(-4.2, 0.12, -7.6), C: V3(4.2, 0.12, -7.6), E: V3(0, 0.12, -18.4) };
    Object.entries(destinos).forEach(([id, D], i) => {
      const g = this.frames[id].g; const A = g.position.clone();
      animar(K, 1.1, u => { g.position.copy(A).lerp(D, suave(u)); g.position.y += Math.sin(u * Math.PI) * 4; }, i * 0.25);
    });
    this.tablas.forEach((t, i) => animar(K, 0.2, u => { t.visible = true; t.scale.set(1, 1, u); }, 1.4 + i * 0.07));
    this.excursionistas.forEach((p, i) => {
      const A = p.position.clone(), F = V3(0, 1, -16.6), N = V3(0, 1, -9.4), D = V3(-1.2 + i * 1.2, 0, -6.6);
      animar(K, 2.4, u => {
        if (u < 0.2) p.position.copy(A).lerp(V3(0, 0, -16.8), u / 0.2);
        else if (u < 0.8) { const w = (u - 0.2) / 0.6; p.position.copy(F).lerp(N, w); p.position.y = 1.06 - 0.6 * (1 - (2 * w - 1) ** 2); }
        else p.position.copy(V3(0, 0, -9.2)).lerp(D, (u - 0.8) / 0.2);
      }, 2.3 + i * 0.45);
    });
    return 3400;
  },
  pistas: [
    'Para cada soporte, mirá qué datos tiene: ¿dos ángulos, dos lados y el ángulo entre ellos, o los tres lados? Eso te dice qué criterio podés usar (y si los datos no alcanzan o no coinciden, no sirve).',
    'Para comparar lados, ordenalos de menor a mayor en el soporte y en el modelo, y dividí cada lado por su correspondiente: en un soporte semejante todos los cocientes dan lo mismo. Para los ángulos, compará con 29°, 47° y 104°.',
    'Chequeá así: <b>AA</b> = dos ángulos iguales a dos del modelo. <b>LAL</b> = dos lados con el mismo cociente <i>y</i> el ángulo entre ellos igual al ángulo del modelo entre los lados correspondientes. <b>LLL</b> = los tres cocientes iguales. Hay soportes trampa que cumplen sólo una parte.',
  ],
  bitacora: [
    '¿Qué procedimiento seguiste para decidir, soporte por soporte, si era semejante al modelo? Anotá las razones o los ángulos que comparaste.',
    'Explicá con tus palabras los criterios AA, LAL y LLL. ¿Por qué los soportes trampa no son semejantes aunque cumplan una parte de la condición?',
    '¿Cómo podrías comprobar de otra manera que los anclajes elegidos son semejantes al modelo (por ejemplo, calculando la razón k de cada uno)?',
  ],
  resumenBitacora: () => 'Elegiste los anclajes semejantes al modelo: <b>A por LLL</b> (k = 1,5), <b>C por AA</b> y <b>E por LAL</b> (k = 0,75). Descartaste B, D, F y G.',
  mat(K, el) {
    const s = K.s;
    const tarjeta = (cd) => {
      const esM = cd.id === 'M'; const v = this.eleccion[cd.id];
      const W = 150, H = 104; const P0 = verticesTri(cd.L, cd.espejo);
      const ancho = Math.max(...P0.map(p => p[0])) * 2, alto = Math.max(...P0.map(p => p[1]));
      const e = Math.min((W - 44) / ancho, (H - 34) / alto);
      const P = P0.map(([a, b]) => [W / 2 + a * e, H - 18 - b * e]);
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, 'font-family': 'JetBrains Mono, monospace', 'font-size': 11 });
      const col = esM ? '#3f8fd0' : v === undefined ? '#8a96a8' : v === 'no' ? '#4b5563' : '#ff6a2b';
      svg.append(s('path', { d: `M${P.map(p => p.join(' ')).join(' L')} Z`, fill: col, 'fill-opacity': 0.12, stroke: col, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
      const cx = (P[0][0] + P[1][0] + P[2][0]) / 3, cy = (P[0][1] + P[1][1] + P[2][1]) / 3;
      cd.lados.forEach(i => {
        const mx = (P[i][0] + P[(i + 1) % 3][0]) / 2, my = (P[i][1] + P[(i + 1) % 3][1]) / 2; const dx = mx - cx, dy = my - cy, d = Math.hypot(dx, dy) || 1;
        svg.append(s('text', { x: mx + dx / d * 11, y: my + dy / d * 11 + 3.5, 'text-anchor': 'middle', fill: '#1b2333', 'font-weight': 700 }, fmtN(cd.L[i])));
      });
      cd.angs.forEach(([i, t]) => {
        const [ax, ay] = P[i]; const dx = cx - ax, dy = cy - ay, d = Math.hypot(dx, dy) || 1; const k = Math.min(20, d * 0.75);
        const q1 = P[(i + 1) % 3], q2 = P[(i + 2) % 3];
        const u1 = [q1[0] - ax, q1[1] - ay], u2 = [q2[0] - ax, q2[1] - ay]; const n1 = Math.hypot(...u1), n2 = Math.hypot(...u2), r = 10;
        const p1 = [ax + u1[0] / n1 * r, ay + u1[1] / n1 * r], p2 = [ax + u2[0] / n2 * r, ay + u2[1] / n2 * r];
        const sw = u1[0] * u2[1] - u1[1] * u2[0] > 0 ? 1 : 0;
        svg.append(s('path', { d: `M${p1[0]} ${p1[1]} A${r} ${r} 0 0 ${sw} ${p2[0]} ${p2[1]}`, fill: 'none', stroke: '#b4541a', 'stroke-width': 1.5 }));
        svg.append(s('text', { x: ax + dx / d * k, y: ay + dy / d * k + 3.5, 'text-anchor': 'middle', fill: '#b4541a', 'font-weight': 700 }, t));
      });
      const badge = esM ? '<span class="badge m">modelo</span>' : `<span class="badge ${v === undefined ? '' : v === 'no' ? 'no' : 'si'}">${v === undefined ? '¿?' : v === 'no' ? 'no' : v}</span>`;
      const d = K.h('div', { class: 'tarjeta-sop' + (esM ? ' modelo' : '') + (this.sel === cd.id ? ' sel' : '') }, K.h('div', { class: 't', html: `<span>${esM ? 'Modelo' : cd.id}</span>${badge}` }), svg);
      return d;
    };
    el.append(K.h('div', { class: 'tarjetas-sop' }, tarjeta(MODELO4), CANDIDATOS.map(tarjeta)));
    const elegidos = CANDIDATOS.filter(c => this.eleccion[c.id] && this.eleccion[c.id] !== 'no').map(c => `${c.id} (${this.eleccion[c.id]})`);
    el.append(K.h('div', { class: 'formula', html: `Semejantes elegidos: ${elegidos.length ? elegidos.join(', ') : '—'}` }));
    el.append(K.h('div', { class: 'nota', html: '<b>AA</b>: dos ángulos respectivamente iguales. <b>LAL</b>: dos lados proporcionales y el ángulo comprendido igual. <b>LLL</b>: los tres lados proporcionales. Cada tarjeta muestra sólo los datos conocidos de ese soporte (los dibujos no están a la misma escala).' }));
  },
  prueba: {
    mal: [
      function (K) { this.eleccion = { A: 'LLL', B: 'LAL', C: 'AA', D: 'no', E: 'LAL', F: 'no', G: 'no' }; this.pintar(K); },
      function (K) { this.eleccion = { A: 'AA', B: 'no', C: 'AA', D: 'no', E: 'LAL', F: 'no', G: 'no' }; this.pintar(K); },
      function (K) { this.eleccion = { A: 'LLL', B: 'no', C: 'AA', D: 'LLL', E: 'LAL', F: 'no', G: 'no' }; this.pintar(K); },
      function (K) { this.eleccion = { A: 'LLL', B: 'no', C: 'no', D: 'no', E: 'LAL', F: 'no', G: 'AA' }; this.pintar(K); },
      function (K) { this.eleccion = { A: 'LLL', B: 'no', C: 'AA', D: 'no', E: 'LAL', F: 'LLL', G: 'no' }; this.pintar(K); },
    ],
    bien(K) { this.eleccion = { A: 'LLL', B: 'no', C: 'AA', D: 'no', E: 'LAL', F: 'no', G: 'no' }; this.pintar(K); },
  },
};

const JUEGO = {
  id: 'rescate-alturas',
  titulo: 'Rescate en las alturas',
  subtitulo: 'Colección Misiones 3D · Proporcionalidad y semejanza',
  icono: 'R',
  kicker: 'Matemática · 3.er año · Brigada de montaña',
  portada: 'Se viene una tormenta sobre el cordón nevado y la <b>Brigada de Rescate</b> te suma al equipo. Vas a repartir suministros entre refugios, fabricar piezas para una torre, medir una antena sin subirte y elegir los anclajes de un puente colgante. En cada misión, la matemática es tu herramienta: <b>proporciones y triángulos semejantes</b>.',
  contenidos: ['Reparto proporcional', 'Semejanza de triángulos', 'Razón de semejanza', 'Criterios AA · LAL · LLL', 'Situaciones problemáticas'],
  final: { titulo: '¡Rescate completo!', texto: 'Los refugios tienen sus kits, la torre está en pie, el helicóptero sabe cuánto mide la antena y los excursionistas cruzaron el puente. Todo gracias a la proporcionalidad y la semejanza de triángulos.' },
  escenaBase(K) {
    K.cielo(0x2d6cb5, 0xe4f2ff, [110, 330]);
    K.hemi.color.setHex(0xe6f2ff); K.hemi.groundColor.setHex(0x8fa6c4); K.hemi.intensity = 1.15;
    K.sol.shadow.bias = -0.0004; K.sol.shadow.normalBias = 0.02;
    K.scene.add(terreno(K));
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + azar() * 0.15; const d = 165 + azar() * 70;
      K.scene.add(montana(K, Math.cos(a) * d, Math.sin(a) * d - 30, 34 + azar() * 30, 55 + azar() * 60, azar() < 0.5 ? COL.roca : COL.rocaOsc));
    }
    let n = 0;
    while (n < 110) {
      const x = azar() * 220 - 110, z = azar() * 190 - 140;
      const r = Math.hypot(x, z * 1.15);
      if (r < 34 || r > 125) continue;
      if (z > 10 && Math.abs(x) < 34) continue;
      K.scene.add(pino(K, x, z, 0.9 + azar() * 0.9)); n++;
    }
    for (let i = 0; i < 26; i++) { const a = azar() * 6.28, d = 36 + azar() * 40; const x = Math.cos(a) * d, z = Math.sin(a) * d - 10; if (z > 12 && Math.abs(x) < 34) continue; K.scene.add(K.roca([x, alturaTerreno(x, z), z], 0.8 + azar() * 1.6, COL.rocaOsc)); }
    K.scene.add(aerosilla(K));
    K.scene.add(copos(K));
  },
  niveles: [N1, N2, N3, N4],
};
iniciar(JUEGO);
</script>
</body>
</html>
$kodu$, 'a59ea305-7e4b-4374-8039-2236dd0f5a88', now(), now());
INSERT INTO "ChatThread" (id, title, "projectId", "createdAt") VALUES ('d073a795-e2d7-4068-b076-3283f244a97b', 'Conversación', '2f04dc12-4121-483f-a07f-d6520723d258', now());
COMMIT;
SELECT id, title, slug, length("currentHtml") AS largo FROM "Project" WHERE id = '2f04dc12-4121-483f-a07f-d6520723d258';
