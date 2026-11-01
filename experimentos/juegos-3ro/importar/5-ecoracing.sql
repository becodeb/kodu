\set ON_ERROR_STOP on
SET client_encoding = 'UTF8';
BEGIN;
-- No duplicar si ya existe un recurso con el mismo título en la cuenta.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Project" WHERE "userId" = 'a59ea305-7e4b-4374-8039-2236dd0f5a88' AND title = 'EcoRacing: La carrera de la energía') THEN
    RAISE EXCEPTION 'Ya existe un recurso con ese título en la cuenta';
  END IF;
END $$;
INSERT INTO "Project" (id, title, description, slug, "currentHtml", "userId", "createdAt", "updatedAt")
VALUES ('de22f5a8-1481-409e-b867-df41b43360d7', 'EcoRacing: La carrera de la energía', 'Videojuego 3D · 3.er año. Función lineal y afín, pendiente, ordenada al origen y recta por dos puntos en cuatro misiones de competición con autos eléctricos.', 'ecoracing-la-carrera-de-la-energia-unzh442x', $kodu$<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EcoRacing · La carrera de la energía</title>
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
  --acento:#2fe0a8; --acento-2:#ffd84d;
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

/* ── EcoRacing ── */
.lbl small{display:block;font-weight:500;font-size:11px;opacity:.9;margin-top:1px}
.lbl.tel{background:rgba(9,32,38,.9);border-color:rgba(47,224,168,.6);text-align:center}
.lbl.ok{background:#1f9e6e;border-color:transparent;color:#fff}
.lbl.mal{background:#c2410c;border-color:transparent;color:#fff}
.formula-viva{font-family:var(--f-num);font-weight:700;font-size:18px;background:var(--tinta-2);border:1px dashed var(--tinta-3);border-radius:12px;padding:9px 12px;text-align:center}
.formula-viva b{color:var(--acento)}
.nota-p{font-size:13.5px;color:var(--texto-2)}
.nota-p b{color:var(--texto)}
.lectura{font-family:var(--f-num);font-weight:700;color:var(--acento-2)}
#vistaMat .nota{line-height:1.45}
.tabla-mat{border-collapse:collapse;font-family:var(--f-num);font-size:12.5px;width:100%;flex:none}
.tabla-mat th{text-align:left;font-weight:700;color:#4b5563;padding:3px 6px;white-space:nowrap}
.tabla-mat td{text-align:center;border-left:1px solid #e6e1d4;padding:3px 6px;font-weight:700}
.lbl.banda{color:#fff;border-color:transparent;font-size:14px}
.tabla-mat tr+tr{border-top:1px solid #e6e1d4}
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
/* ── EcoRacing: utilidades ─────────────────────────────────────────── */
const ACENTO = 0x2fe0a8, AMARILLO = 0xffd84d;
const COL = { linea: '#0e9f74', tri: '#e8590c', ord: '#b5179e', dato: '#1b2333', meta: '#c2410c', dron: '#6d28d9', A: '#e03131', B: '#1c7ed6', C: '#2f9e44', gris: '#6b7280' };
const ft = f => f ? (f.d === 1 ? String(f.n) : f.n + '/' + f.d) : '?';
const fv = f => f.n / f.d;
const eq = (f, n, d = 1) => !!f && f.n * d === n * f.d;
const nf = (x, d = 2) => K.fmt(x, d);
const pesos = x => '$' + Math.round(x).toLocaleString('es-AR');
const ftc = f => ft(f).replace('.', ',');
let semilla = 11;
const rnd = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;

/** Textura de texto en canvas (carteles). */
function texTexto(lineas, { w = 512, h = 128, bg = '#0f1b2d', fg = '#ffffff', tam = 64 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `800 ${tam}px "Bricolage Grotesque", system-ui, sans-serif`;
  const ls = [].concat(lineas);
  ls.forEach((l, i) => x.fillText(l, w / 2, h / 2 + (i - (ls.length - 1) / 2) * tam * 1.1));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function texCuadros(nx = 8, ny = 2) {
  const c = document.createElement('canvas'); c.width = nx * 16; c.height = ny * 16;
  const x = c.getContext('2d');
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#fff'; x.fillRect(i * 16, j * 16, 16, 16); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
}
let _texSolar;
function texSolar() {
  if (_texSolar) return _texSolar;
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#1b3f8f'; x.fillRect(0, 0, 128, 64);
  x.strokeStyle = '#8fb3ff'; x.lineWidth = 1.5;
  for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 16, 0); x.lineTo(i * 16, 64); x.stroke(); }
  for (let j = 0; j <= 4; j++) { x.beginPath(); x.moveTo(0, j * 16); x.lineTo(128, j * 16); x.stroke(); }
  _texSolar = new THREE.CanvasTexture(c); _texSolar.colorSpace = THREE.SRGBColorSpace; return _texSolar;
}
function panelSolar(w, d, pos, inclin = -0.3) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), K.mat(0xffffff, { map: texSolar(), metalness: 0.35, roughness: 0.4, flatShading: false }));
  m.position.set(...pos); m.rotation.x = inclin; m.castShadow = true; return m;
}
function cartel(texto, w, h, pos, { bg = '#0f1b2d', fg = '#2fe0a8', tam = 64, rotY = 0 } = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texTexto(texto, { w: 512, h: Math.round(512 * h / w), bg, fg, tam }), side: THREE.DoubleSide }));
  m.position.set(...pos); m.rotation.y = rotY; return m;
}

/** Auto eléctrico low-poly, mira hacia +x. */
function autoEV(color = ACENTO, franja = AMARILLO) {
  const g = new THREE.Group();
  g.add(K.caja(3.7, 0.36, 1.7, 0x1d2433, [0, 0.42, 0]));
  g.add(K.caja(2.3, 0.42, 1.25, color, [-0.15, 0.78, 0]));
  g.add(K.caja(1.25, 0.26, 0.9, color, [1.55, 0.58, 0]));
  g.add(K.caja(2.6, 0.08, 1.3, franja, [-0.1, 1.0, 0]));
  const cab = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), K.mat(0x152033, { metalness: 0.4, roughness: 0.3 }));
  cab.scale.set(1.5, 0.9, 0.9); cab.position.set(0.15, 1.0, 0); g.add(cab);
  g.add(K.caja(0.5, 0.08, 1.9, 0x1d2433, [2.1, 0.32, 0]));
  g.add(K.caja(0.12, 0.6, 0.12, 0x1d2433, [-1.6, 1.05, 0.45]), K.caja(0.12, 0.6, 0.12, 0x1d2433, [-1.6, 1.05, -0.45]));
  g.add(K.caja(0.6, 0.1, 1.9, franja, [-1.65, 1.38, 0]));
  g.ruedas = [];
  for (const [x, z] of [[1.15, 0.92], [1.15, -0.92], [-1.15, 0.92], [-1.15, -0.92]]) {
    const w = new THREE.Group(); w.position.set(x, 0.38, z);
    const r = K.cilindro(0.38, 0.38, 0.34, 0x15171c, [0, 0, 0], 10); r.rotation.x = Math.PI / 2; w.add(r);
    const l = K.cilindro(0.18, 0.18, 0.36, 0xc9ced6, [0, 0, 0], 6); l.rotation.x = Math.PI / 2; w.add(l);
    g.add(w); g.ruedas.push(w);
  }
  g.rodar = dist => g.ruedas.forEach(w => { w.rotation.z -= dist / 0.38; });
  return g;
}

/* Circuito: recta principal en z = 0 (x de −40 a 40), curvas de radio 20. */
const RECTA = 80, RC = 20, LO = 2 * RECTA + 2 * Math.PI * RC;
function ovalo(s) {
  s = ((s % LO) + LO) % LO;
  if (s < RECTA) return { x: -40 + s, z: 0, dx: 1, dz: 0 };
  s -= RECTA;
  if (s < Math.PI * RC) { const a = s / RC; return { x: 40 + RC * Math.sin(a), z: -20 + RC * Math.cos(a), dx: Math.cos(a), dz: -Math.sin(a) }; }
  s -= Math.PI * RC;
  if (s < RECTA) return { x: 40 - s, z: -40, dx: -1, dz: 0 };
  s -= RECTA; const a = s / RC;
  return { x: -40 - RC * Math.sin(a), z: -20 - RC * Math.cos(a), dx: -Math.cos(a), dz: Math.sin(a) };
}
function ponerEnOvalo(obj, s) { const p = ovalo(s); obj.position.set(p.x, 0, p.z); obj.rotation.y = Math.atan2(-p.dz, p.dx); }

/** Cámara del nivel: en pantallas angostas (panel abajo) se aleja para que entre la escena. */
function cam(pos, mira, opts) {
  const f = innerWidth <= 860 ? 2 : 1;
  K.camara(pos.map((v, i) => mira[i] + (v - mira[i]) * f), mira, { ...opts, max: (opts.max || 200) * f });
}
/** Confeti de celebración. */
function confeti(pos, n = 70) {
  const cols = [ACENTO, AMARILLO, 0xff5d6c, 0x4dabf7, 0xffffff];
  const ps = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 0.2), new THREE.MeshBasicMaterial({ color: cols[i % cols.length] }));
    m.position.set(...pos); K.agregar(m);
    ps.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 12, 8 + Math.random() * 9, (Math.random() - 0.5) * 12), r: Math.random() * 8 });
  }
  let vida = 0;
  const f = K.tic(dt => {
    vida += dt;
    for (const p of ps) { p.v.y -= 18 * dt; p.m.position.addScaledVector(p.v, dt); p.m.rotation.x += p.r * dt; p.m.rotation.z += p.r * dt; if (p.m.position.y < 0.05) { p.m.position.y = 0.05; p.v.set(0, 0, 0); } }
    if (vida > 6) { ps.forEach(p => p.m.removeFromParent()); vida = -1e9; }
  });
}

/* ── Plano cartesiano propio (pasos distintos en cada eje, coma decimal) ── */
function plano({ xMin, xMax, yMin, yMax, gx, gy, lx, ly, ejeX, ejeY, fx = v => nf(v), fy = v => nf(v), W = 560, H = 390, mL = 50, mR = 22, mT = 22, mB = 40 }) {
  const X = x => mL + (x - xMin) / (xMax - xMin) * (W - mL - mR);
  const Y = y => H - mB - (y - yMin) / (yMax - yMin) * (H - mT - mB);
  const svg = K.s('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', 'font-family': 'JetBrains Mono, monospace', 'font-size': 11, style: 'flex:1 1 auto;min-height:230px;height:auto' });
  svg.append(K.s('defs', {},
    K.s('marker', { id: 'flE', viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, K.s('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#1b2333' })),
    K.s('clipPath', { id: 'recE' }, K.s('rect', { x: X(xMin), y: Y(yMax), width: X(xMax) - X(xMin), height: Y(yMin) - Y(yMax) }))));
  const gr = K.s('g', { stroke: '#ebe6da', 'stroke-width': 1 });
  for (let x = Math.ceil(xMin / gx) * gx; x <= xMax + 1e-9; x += gx) gr.append(K.s('line', { x1: X(x), x2: X(x), y1: Y(yMin), y2: Y(yMax) }));
  for (let y = Math.ceil(yMin / gy) * gy; y <= yMax + 1e-9; y += gy) gr.append(K.s('line', { y1: Y(y), y2: Y(y), x1: X(xMin), x2: X(xMax) }));
  svg.append(gr);
  const ej = K.s('g', { stroke: '#1b2333', 'stroke-width': 1.6 });
  ej.append(K.s('line', { x1: X(xMin), x2: X(xMax) + 12, y1: Y(yMin), y2: Y(yMin), 'marker-end': 'url(#flE)' }));
  ej.append(K.s('line', { x1: X(xMin), x2: X(xMin), y1: Y(yMin), y2: Y(yMax) - 12, 'marker-end': 'url(#flE)' }));
  svg.append(ej);
  const et = K.s('g', { fill: '#6b7280' });
  for (let x = Math.ceil(xMin / lx) * lx; x <= xMax + 1e-9; x += lx) et.append(K.s('text', { x: X(x), y: Y(yMin) + 15, 'text-anchor': 'middle' }, fx(x)));
  for (let y = Math.ceil(yMin / ly) * ly; y <= yMax + 1e-9; y += ly) if (y > yMin + 1e-9) et.append(K.s('text', { x: X(xMin) - 6, y: Y(y) + 4, 'text-anchor': 'end' }, fy(y)));
  et.append(K.s('text', { x: X(xMax) + 12, y: Y(yMin) + 34, 'text-anchor': 'end', fill: '#1b2333', 'font-weight': 700 }, ejeX));
  et.append(K.s('text', { x: X(xMin) + 8, y: Y(yMax) - 6, fill: '#1b2333', 'font-weight': 700 }, ejeY));
  svg.append(et);
  const gc = K.s('g', { 'clip-path': 'url(#recE)' }); svg.append(gc);
  const g = K.s('g'); svg.append(g);
  return { svg, X, Y, g, gc, xMin, xMax, yMin, yMax };
}
/** Texto con fondo blanco (para que se lea sobre la grilla). */
function etq(g, x, y, txt, color = '#1b2333', { anchor = 'start', peso = 700, tam = 11, fondo = 'rgba(255,255,255,.9)' } = {}) {
  const w = String(txt).length * tam * 0.61 + 8;
  const x0 = anchor === 'start' ? x - 4 : anchor === 'end' ? x - w + 4 : x - w / 2;
  g.append(K.s('rect', { x: x0, y: y - tam + 1, width: w, height: tam + 5, rx: 4, fill: fondo }));
  g.append(K.s('text', { x, y: y + 1, 'text-anchor': anchor, fill: color, 'font-weight': peso, 'font-size': tam }, txt));
}
function recta(P, f, color, { ancho = 3, desde = P.xMin, hasta = P.xMax, guiones } = {}) {
  P.gc.append(K.s('line', { x1: P.X(desde), y1: P.Y(f(desde)), x2: P.X(hasta), y2: P.Y(f(hasta)), stroke: color, 'stroke-width': ancho, 'stroke-linecap': 'round', 'stroke-dasharray': guiones }));
}
function punto(P, x, y, color, r = 5, borde = '#fff') { P.g.append(K.s('circle', { cx: P.X(x), cy: P.Y(y), r, fill: color, stroke: borde, 'stroke-width': 2 })); }
function hlinea(P, y, color, txt, { x0 = P.xMin, x1 = P.xMax, lado = 'end' } = {}) {
  P.gc.append(K.s('line', { x1: P.X(x0), x2: P.X(x1), y1: P.Y(y), y2: P.Y(y), stroke: color, 'stroke-width': 1.6, 'stroke-dasharray': '6 4' }));
  if (txt) etq(P.g, lado === 'end' ? P.X(x1) - 4 : P.X(x0) + 6, P.Y(y) - 6, txt, color, { anchor: lado === 'end' ? 'end' : 'start' });
}
function vlinea(P, x, color, txt, { y0 = P.yMin, y1 = P.yMax, ytxt } = {}) {
  P.gc.append(K.s('line', { x1: P.X(x), x2: P.X(x), y1: P.Y(y0), y2: P.Y(y1), stroke: color, 'stroke-width': 1.6, 'stroke-dasharray': '6 4' }));
  const der = P.X(x) > P.X(P.xMax) - 120;
  if (txt) etq(P.g, P.X(x) + (der ? -6 : 6), ytxt ?? P.Y(y1) + 14, txt, color, { anchor: der ? 'end' : 'start' });
}
/** Triángulo de pendiente sobre la recta f entre x1 y x2, con su significado. */
function triangulo(P, x1, x2, f, color, tAvance, tSubida, tSignif) {
  const y1 = f(x1), y2 = f(x2);
  const [a, b, c] = [[P.X(x1), P.Y(y1)], [P.X(x2), P.Y(y1)], [P.X(x2), P.Y(y2)]];
  P.g.append(K.s('path', { d: `M${a} L${b} L${c} Z`, fill: color, 'fill-opacity': 0.13, stroke: color, 'stroke-width': 2, 'stroke-dasharray': '5 3' }));
  const sube = y2 >= y1;
  etq(P.g, (a[0] + b[0]) / 2, a[1] + (sube ? 16 : -8), tAvance, color, { anchor: 'middle' });
  etq(P.g, b[0] + 7, (b[1] + c[1]) / 2 + 4, tSubida, color);
  if (tSignif) etq(P.g, b[0] + 7, (b[1] + c[1]) / 2 + 21, tSignif, color, { peso: 500 });
}
function ordenada(P, b, color, txt, { dy = -10, en } = {}) {
  P.g.append(K.s('circle', { cx: P.X(P.xMin), cy: P.Y(b), r: 7, fill: 'none', stroke: color, 'stroke-width': 2.5 }));
  P.g.append(K.s('circle', { cx: P.X(P.xMin), cy: P.Y(b), r: 3, fill: color }));
  if (en) { P.g.append(K.s('line', { x1: P.X(P.xMin) + 6, y1: P.Y(b) - 5, x2: P.X(en[0]) - 2, y2: P.Y(en[1]) + 3, stroke: color, 'stroke-width': 1.2 })); etq(P.g, P.X(en[0]), P.Y(en[1]), txt, color); return; }
  etq(P.g, P.X(P.xMin) + 12, P.Y(b) + dy, txt, color);
}
function cajaMat(el, html, cls = 'formula') { const d = K.h('div', { class: cls, html }); el.append(d); return d; }

/** Refresca la vista matemática a lo sumo ~10 veces por segundo durante animaciones. */
function refrescoSuave(nv, dt) { nv._acum = (nv._acum || 0) + dt; if (nv._acum > 0.1) { nv._acum = 0; K.refrescarMat(); } }
function marcarInput(inp, bien) { inp.classList.toggle('mal', bien === false); inp.classList.toggle('bien', bien === true); }
function textoInput(etq, opts) { const i = K.campoNumero(etq, opts); i.type = 'text'; i.setAttribute('autocomplete', 'off'); return i; }
function boton(txt, fn) { const b = K.h('button', { class: 'btn btn-sec', style: 'width:100%' }, txt); b.addEventListener('click', fn); K.controles().append(b); return b; }

/* ── Escenario permanente: autódromo eléctrico ─────────────────────── */
function construirAutodromo() {
  const sc = K.scene;
  K.cielo(0x3d8fe0, 0xffe0b5, [160, 460]);
  sc.add(K.suelo(0x74ad5a, 1200));
  // pasto interior
  const interior = new THREE.Shape();
  interior.moveTo(-40, 5); interior.lineTo(40, 5); interior.absarc(40, 20, 15, -Math.PI / 2, Math.PI / 2, false); interior.lineTo(-40, 35); interior.absarc(-40, 20, 15, Math.PI / 2, Math.PI * 1.5, false);
  const pasto = new THREE.Mesh(new THREE.ShapeGeometry(interior, 32), K.mat(0x86bf68)); pasto.rotation.x = -Math.PI / 2; pasto.position.y = 0.015; pasto.receiveShadow = true; sc.add(pasto);
  // asfalto
  const f = new THREE.Shape();
  f.moveTo(-40, -5); f.lineTo(40, -5); f.absarc(40, 20, 25, -Math.PI / 2, Math.PI / 2, false); f.lineTo(-40, 45); f.absarc(-40, 20, 25, Math.PI / 2, Math.PI * 1.5, false);
  const hueco = new THREE.Path();
  hueco.moveTo(-40, 5); hueco.lineTo(40, 5); hueco.absarc(40, 20, 15, -Math.PI / 2, Math.PI / 2, false); hueco.lineTo(-40, 35); hueco.absarc(-40, 20, 15, Math.PI / 2, Math.PI * 1.5, false);
  f.holes.push(hueco);
  const pista = new THREE.Mesh(new THREE.ShapeGeometry(f, 48), K.mat(0x3a404d)); pista.rotation.x = -Math.PI / 2; pista.position.y = 0.03; pista.receiveShadow = true; sc.add(pista);
  // bordes blancos de las rectas
  for (const z of [4.8, -4.8, -35.2, -44.8]) { const l = K.caja(80, 0.03, 0.22, 0xf4f4f4, [0, 0.05, z]); l.castShadow = false; sc.add(l); }
  // pianos en las curvas
  const pos = [];
  for (const [cx, sg] of [[40, 1], [-40, -1]]) for (const [r, paso] of [[25.4, 1.6], [14.6, 1.6]]) {
    const n = Math.floor(Math.PI * r / paso);
    for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * Math.PI; pos.push([cx + sg * r * Math.sin(a), -20 + sg * r * Math.cos(a), a, i]); }
  }
  const pianos = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.12, 0.8), K.mat(0xffffff), pos.length);
  const o = new THREE.Object3D(), c1 = new THREE.Color(0xe03131), c2 = new THREE.Color(0xffffff);
  pos.forEach(([x, z, a, i], k) => { o.position.set(x, 0.07, z); o.rotation.set(0, -a + (x > 0 ? 0 : Math.PI), 0); o.rotation.y = Math.atan2(-(x > 0 ? -Math.sin(a) : Math.sin(a)), x > 0 ? Math.cos(a) : -Math.cos(a)); o.updateMatrix(); pianos.setMatrixAt(k, o.matrix); pianos.setColorAt(k, i % 2 ? c1 : c2); });
  pianos.receiveShadow = true; sc.add(pianos);
  // largada: cuadros + pórtico
  const cuadros = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 10), new THREE.MeshStandardMaterial({ map: texCuadros(2, 14), roughness: 0.9 }));
  cuadros.rotation.x = -Math.PI / 2; cuadros.position.set(-30, 0.06, 0); sc.add(cuadros);
  for (const z of [6.4, -6.4]) sc.add(K.caja(0.6, 7, 0.6, 0x26324a, [-30, 3.5, z]));
  sc.add(K.caja(0.8, 1.6, 13.4, 0x0f1b2d, [-30, 7.6, 0]));
  sc.add(cartel('ECORACING GP', 12.6, 1.4, [-29.55, 7.6, 0], { rotY: Math.PI / 2, tam: 70 }));
  // calle de boxes
  sc.add(Object.assign(K.caja(66, 0.06, 4.6, 0x4a5262, [0, 0.03, -12.3]), { castShadow: false }));
  sc.add(Object.assign(K.caja(66, 0.04, 0.18, 0xffffff, [0, 0.07, -9.95]), { castShadow: false }));
  // boxes con techo solar
  const equipos = [0xff8a3d, 0x4dabf7, ACENTO, 0xcc5de8, 0xffd84d];
  equipos.forEach((col, i) => {
    const x = -24 + 12 * i, z = -21.5;
    sc.add(K.caja(10, 0.1, 7, 0xc9ced6, [x, 0.05, z]));
    sc.add(K.caja(10, 4, 0.4, 0x2a3245, [x, 2, z - 3.5]));
    sc.add(K.caja(0.4, 4, 7, 0xe9ecef, [x - 5, 2, z]), K.caja(0.4, 4, 7, 0xe9ecef, [x + 5, 2, z]));
    sc.add(K.caja(10.8, 0.35, 7.8, 0xdee2e6, [x, 4.15, z]));
    sc.add(K.caja(10.8, 0.9, 0.3, col, [x, 3.5, z + 3.75]));
    sc.add(panelSolar(4.6, 3.2, [x - 2.5, 4.75, z + 1.7], -0.28), panelSolar(4.6, 3.2, [x + 2.5, 4.75, z + 1.7], -0.28));
    sc.add(panelSolar(4.6, 3.2, [x - 2.5, 4.75, z - 1.7], -0.28), panelSolar(4.6, 3.2, [x + 2.5, 4.75, z - 1.7], -0.28));
    // cargador
    sc.add(K.caja(0.7, 1.9, 0.5, 0xf1f3f5, [x + 3.6, 0.95, -16.4]));
    sc.add(K.caja(0.72, 0.35, 0.52, col, [x + 3.6, 1.95, -16.4], { emissive: col, emissiveIntensity: 0.5 }));
  });
  for (const [i, col] of [[0, 0xff8a3d], [4, 0xffd84d]]) { const a = autoEV(col, 0x1d2433); a.position.set(-24 + 12 * i, 0.1, -21.5); a.rotation.y = -Math.PI / 2; sc.add(a); }
  // torre de cronometraje
  sc.add(K.caja(3.2, 11, 3.2, 0x1c2b44, [-36, 5.5, -9]));
  sc.add(K.caja(3.3, 2.2, 3.3, 0x2fe0a8, [-36, 9.2, -9], { emissive: 0x2fe0a8, emissiveIntensity: 0.35 }));
  sc.add(cartel('EV', 3, 1.6, [-36, 11.8, -7.3], { tam: 90 }));
  // tribuna detrás de la recta opuesta
  for (let k = 0; k < 5; k++) {
    sc.add(K.caja(72, 0.8, 1.8, 0xd9dde3, [0, 0.4 + 0.8 * k, -48 - 1.8 * k]));
    sc.add(K.caja(72, 0.25, 0.5, [0x1c7ed6, 0x2fe0a8, 0x1c7ed6, 0xffd84d, 0x1c7ed6][k], [0, 0.9 + 0.8 * k, -48.4 - 1.8 * k]));
  }
  sc.add(K.caja(74, 0.3, 11, 0xf1f3f5, [0, 7.4, -52]));
  for (const x of [-34, -12, 12, 34]) sc.add(K.caja(0.4, 7.2, 0.4, 0x495057, [x, 3.6, -57]));
  sc.add(cartel(['ECORACING', '100% ELÉCTRICO'], 24, 4.2, [0, 10.2, -57.2], { bg: '#0f1b2d', fg: '#2fe0a8', tam: 60 }));
  const ropa = [0xff8a3d, 0x4dabf7, 0xffd84d, 0x2fe0a8, 0xe64980, 0xffffff, 0x845ef7];
  for (let i = 0; i < 46; i++) { const k = Math.floor(rnd() * 5); const p = K.persona([-34 + rnd() * 68, 0.8 + 0.8 * k, -48.2 - 1.8 * k], ropa[i % ropa.length]); sc.add(p); }
  // muro de contención frente a la recta principal
  sc.add(K.caja(130, 0.7, 0.5, 0xf8f9fa, [0, 0.35, 11.5]), K.caja(130, 0.2, 0.52, 0xe03131, [0, 0.62, 11.5]));
  // granja solar en el exterior de la curva derecha
  for (let r = 0; r < 7; r++) {
    sc.add(panelSolar(26, 3, [88, 1.6, -44 + r * 6.5], -0.45));
    sc.add(K.caja(0.25, 1.4, 0.25, 0x868e96, [80, 0.7, -44 + r * 6.5]), K.caja(0.25, 1.4, 0.25, 0x868e96, [96, 0.7, -44 + r * 6.5]));
  }
  // molinos eólicos lejanos (giran con onBeforeRender: el escenario base no usa tics de nivel)
  for (const [x, z, s] of [[-95, -125, 1], [-55, -150, 0.9], [70, -140, 1.1], [115, -105, 0.95], [-130, -70, 0.85]]) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s);
    g.add(K.cilindro(0.5, 1, 34, 0xf1f3f5, [0, 17, 0], 8));
    g.add(K.caja(1.4, 1.4, 3, 0xf1f3f5, [0, 34.3, 0.4]));
    const rotor = new THREE.Group(); rotor.position.set(0, 34.3, 2.1); g.add(rotor);
    const hub = K.esfera(0.8, 0xdee2e6); rotor.add(hub);
    for (let b = 0; b < 3; b++) { const p = new THREE.Group(); p.rotation.z = b * Math.PI * 2 / 3; p.add(K.caja(0.9, 13, 0.25, 0xffffff, [0, 6.6, 0])); rotor.add(p); }
    const fase = rnd() * 6;
    hub.onBeforeRender = () => { rotor.rotation.z = fase + performance.now() * 0.0011; };
    sc.add(g);
  }
  // árboles
  for (let i = 0; i < 110; i++) {
    const x = -150 + rnd() * 300, z = -140 + rnd() * 190;
    const dentro = Math.abs(x) < 72 && z > -64 && z < 18;
    const camara = z > 14 && Math.abs(x) < 50;
    const solar = x > 76 && x < 102 && z > -50 && z < 2;
    if (dentro || camara || solar) continue;
    sc.add(K.arbol([x, 0, z], 1.2 + rnd() * 1.3, [0x3f8f5a, 0x2f7d4a, 0x5aa36b][i % 3]));
  }
  // montañas y nubes
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(40 + rnd() * 30, 50 + rnd() * 40, 6), K.mat(0x7f9cb3));
    m.position.set(-280 + i * 70, 20, -300 - rnd() * 40); sc.add(m);
  }
  for (let i = 0; i < 8; i++) {
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(4 + rnd() * 4, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true })); b.position.set(k * 5 - 7, rnd() * 2, rnd() * 3); g.add(b); }
    g.position.set(-200 + i * 55, 55 + rnd() * 25, -170 - rnd() * 80); sc.add(g);
  }
  // banderas en la recta
  for (const x of [-56, 52]) {
    sc.add(K.cilindro(0.08, 0.08, 6, 0xadb5bd, [x, 3, 13], 6));
    sc.add(K.caja(2.2, 1.3, 0.05, x < 0 ? ACENTO : AMARILLO, [x + 1.1, 5.2, 13]));
  }
}

/* ── Nivel 1: prueba de velocidad ── d(t) = 16·t ─────────────────────
   Fotocélulas: 24 m a 1,5 s · 48 m a 3 s · 72 m a 4,5 s → v = 16 m/s, b = 0.
   Dron a t = 6,5 s → 104 m. Meta 120 m → t = 7,5 s. Escala: 1 unidad = 2 m. */
const FOTO = [[24, 1.5], [48, 3], [72, 4.5]];
const xD = d => -30 + d / 2;
const N1 = {
  titulo: 'Prueba de velocidad',
  relato: 'Primer día en el autódromo. El <b>EV-7</b> entra lanzado a la recta a <b>velocidad constante</b>: el cronómetro arranca justo cuando cruza la marca de <b>0 m</b> y tres fotocélulas registran su paso. Los sensores llegan sólo hasta los 72 m; después el auto frena.',
  objetivo: 'Armá el modelo <b>d = v·t + b</b>, ubicá el <b>dron de cámara</b> justo donde va a estar el auto a los <b>6,5 s</b> y calculá en qué instante cruza la <b>meta (120 m)</b>.',
  tituloMat: 'Distancia en función del tiempo', subMat: 'función lineal · d(t) = v·t + b',
  textoComprobar: 'Comprobar y largar',
  armar(K) {
    cam([-3, 46, 69], [-3, 0, -3], { suave: false, min: 20, max: 150 });
    this.simT = null; this.anim = null;
    // marcas de distancia
    for (let d = 0; d <= 124; d += 4) {
      const m = K.caja(0.14, 0.03, d % 20 ? 0.7 : 1.4, 0xffffff, [xD(d), 0.06, d % 20 ? 4.2 : 3.9]); m.castShadow = false; K.agregar(m);
      if (d % 20 === 0 || d === 120) {
        K.agregar(K.cilindro(0.08, 0.08, 1.6, 0xdee2e6, [xD(d), 0.8, 6.2], 6));
        K.agregar(K.caja(1.5, 0.75, 0.08, d === 120 ? 0xe03131 : 0x0f1b2d, [xD(d), 1.8, 6.2]));
        K.etiqueta(d + ' m', [xD(d), 2.6, 6.2], d === 120 ? 'acento' : '');
      }
    }
    // fotocélulas
    this.fotos = FOTO.map(([d, t], i) => {
      const x = xD(d);
      for (const z of [5.6, -5.6]) K.agregar(K.caja(0.3, 4.6, 0.3, 0x868e96, [x, 2.3, z]));
      K.agregar(K.caja(0.4, 0.5, 11.6, 0x495057, [x, 4.7, 0]));
      K.agregar(K.caja(0.42, 0.16, 11.62, 0x2fe0a8, [x, 4.95, 0]));
      const haz = K.agregar(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 11.2), new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.75 })));
      haz.position.set(x, 0.7, 0);
      const luz = K.agregar(K.caja(0.6, 0.6, 0.6, 0x495057, [x, 5.2, 0], { emissive: 0x000000 }));
      const lbl = K.etiqueta(`F${i + 1} · ${d} m<small>${nf(t)} s</small>`, [x, 6.6, 0], 'tel');
      return { haz, luz, lbl, d };
    });
    // meta
    const xm = xD(120);
    for (const z of [6, -6]) K.agregar(K.caja(0.5, 6, 0.5, 0xe03131, [xm, 3, z]));
    const ban = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.3, 12.4), new THREE.MeshStandardMaterial({ map: texCuadros(14, 2) }));
    ban.position.set(xm, 6.3, 0); K.agregar(ban);
    const linea = new THREE.Mesh(new THREE.PlaneGeometry(1, 10), new THREE.MeshStandardMaterial({ map: texCuadros(2, 14) }));
    linea.rotation.x = -Math.PI / 2; linea.position.set(xm, 0.07, 0); K.agregar(linea);
    K.etiqueta('META · 120 m', [xm, 7.6, 0], 'acento grande');
    // auto
    this.auto = K.agregar(autoEV());
    this.auto.position.set(xD(-8), 0, 0);
    this.reloj = K.etiqueta('listo para la vuelta de prueba', [0, 3.4, 0], 'claro', this.auto);
    // dron de cámara (arrastrable sobre la pista)
    const dr = new THREE.Group();
    dr.add(K.caja(1.1, 0.35, 1.1, 0x6d28d9, [0, 0, 0]));
    dr.add(K.esfera(0.32, 0x111827, [0, -0.3, 0.3]));
    this.helices = [];
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      dr.add(K.barra([0, 0, 0], [x * 0.95, 0.1, z * 0.95], 0.07, 0x343a40));
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 14), new THREE.MeshBasicMaterial({ color: 0xc4b5fd, transparent: true, opacity: 0.6 }));
      h.position.set(x * 0.95, 0.2, z * 0.95); dr.add(h); this.helices.push(h);
    }
    const toque = new THREE.Mesh(new THREE.SphereGeometry(2.2, 10, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    dr.add(toque);
    const haz = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 1.2, 3.3, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    haz.position.y = -1.75; dr.add(haz);
    this.mira = new THREE.Mesh(new THREE.RingGeometry(1, 1.35, 24), new THREE.MeshBasicMaterial({ color: 0x8b5cf6 }));
    this.mira.rotation.x = -Math.PI / 2; this.mira.position.y = -3.35; dr.add(this.mira);
    dr.position.set(xD(40), 3.4, 0);
    this.dron = K.agregar(dr);
    this.lblDron = K.etiqueta('', [0, 1.1, 0], 'acento', dr);
    K.arrastrable(dr, { ejes: 'x', snap: 1, limites: { x: [-30, 30] }, alMover: () => this.act(), activo: () => !this.anim });
    K.tic((dt, t) => {
      this.helices.forEach((h, i) => { h.rotation.y += dt * 30; });
      dr.position.y = 3.4 + Math.sin(t * 2) * 0.08;
      if (this.anim) this.anim(dt);
    });
    // panel
    K.html('<p class="nota-p"><b>Telemetría de la vuelta de prueba</b> (ya está escrita en cada fotocélula):</p>');
    K.datos(FOTO.map(([d, t], i) => [`Fotocélula ${i + 1}`, `d = ${d} m · t = ${nf(t)} s`]));
    boton('▶ Ver la vuelta de prueba', () => this.vueltaPrueba());
    this.inV = textoInput('Pendiente v (velocidad)', { id: 'n1v', sufijo: 'm/s' });
    this.inB = textoInput('Ordenada al origen b', { id: 'n1b', sufijo: 'm' });
    this.form = K.html('');
    this.lecDron = K.html('');
    this.inT = textoInput('¿En qué instante cruza la meta (120 m)?', { id: 'n1t', sufijo: 's' });
    for (const i of [this.inV, this.inB, this.inT]) i.addEventListener('input', () => { marcarInput(i, null); this.act(); });
    this.act();
  },
  dronD() { return Math.round((this.dron.position.x + 30) * 2); },
  act() {
    const v = K.leerFrac(this.inV.value), b = K.leerFrac(this.inB.value), d = this.dronD();
    this.form.innerHTML = `<div class="formula-viva">d(t) = <b>${v ? ftc(v) : 'v'}</b>·t + <b>${b ? ftc(b) : 'b'}</b></div>`;
    this.lecDron.innerHTML = `<p class="nota-p">Arrastrá el <b>dron violeta</b> sobre la pista: a los <b>6,5 s</b> el auto tiene que pasar justo debajo. Ahora está en <span class="lectura">${d} m</span>.</p>`;
    this.lblDron.texto(`dron · ${d} m`);
    K.refrescarMat();
  },
  pararAnim() { this.anim = null; },
  vueltaPrueba() {
    if (this.anim) return;
    K.limpiarMensaje();
    let d = -24, v = 16, t = -1.5, frenando = false;
    this.fotos.forEach(f => { f.luz.material.emissive.setHex(0); f.lbl.element.classList.remove('ok'); });
    this.anim = dt => {
      if (!frenando) { d += v * dt; t += dt; if (d >= 74) frenando = true; }
      else { v = Math.max(0, v - 22 * dt); d += v * dt; }
      this.auto.position.x = xD(d); this.auto.rodar(v * dt / 2);
      for (const f of this.fotos) if (d >= f.d && !f.paso) { f.paso = true; f.luz.material.emissive.setHex(0x2fe0a8); f.lbl.element.classList.add('ok'); }
      if (t < 0) this.reloj.texto('entrando lanzado…');
      else if (!frenando) this.reloj.texto(`t = ${nf(t, 1)} s`);
      else this.reloj.texto('fin de la zona medida');
      this.simT = frenando ? null : t; this.simD = d;
      refrescoSuave(this, dt);
      if (frenando && v === 0) { this.anim = null; this.fotos.forEach(f => f.paso = false); setTimeout(() => this.volverAuto(), 1400); }
    };
  },
  volverAuto() { if (this.anim) return; this.auto.position.x = xD(-8); this.reloj.texto('listo para la vuelta de prueba'); this.simT = null; K.refrescarMat(); },
  comprobar(K) {
    const v = K.leerFrac(this.inV.value), b = K.leerFrac(this.inB.value), tm = K.leerFrac(this.inT.value), dd = this.dronD();
    [this.inV, this.inB, this.inT].forEach(i => marcarInput(i, null));
    const mal = (inp, msg) => { if (inp) marcarInput(inp, false); return { ok: false, msg }; };
    if (!v) return mal(this.inV, 'Escribí la pendiente <b>v</b> de tu modelo (podés usar decimales o fracciones).');
    if (!b) return mal(this.inB, 'Escribí la ordenada al origen <b>b</b>. Si el modelo no la necesita, ¿qué número la representa?');
    if (v.n * 16 === v.d) return mal(this.inV, 'Dividiste <b>tiempo por distancia</b>: eso da segundos por metro. La velocidad dice cuántos <b>metros</b> avanza el auto en cada <b>segundo</b>.');
    if ([24, 48, 72].some(x => eq(v, x))) return mal(this.inV, 'Ese número es una <b>distancia</b> registrada, no una variación. ¿Cuántos metros avanza por cada segundo que pasa?');
    if (!eq(v, 16)) return mal(this.inV, `Con v = ${ftc(v)} m/s, a los 1,5 s el auto estaría a ${nf(fv(v) * 1.5 + fv(b))} m, pero la fotocélula 1 lo registró en 24 m. Revisá cómo calculaste la pendiente.`);
    if (!eq(b, 0)) return mal(this.inB, `Con b = ${ftc(b)}, cuando el cronómetro marca 0 s el auto estaría en ${ftc(b)} m. Pero el reloj arranca justo cuando cruza la marca de <b>0 m</b>.`);
    marcarInput(this.inV, true); marcarInput(this.inB, true);
    if (dd !== 104) return { ok: false, msg: `El dron está en ${dd} m. Según tu modelo, el auto pasa por ahí a t = ${nf(dd / 16, 4)} s, no a 6,5 s. Reubicalo usando la fórmula.` };
    if (!tm) return mal(this.inT, 'Falta el instante en que el auto cruza la meta.');
    if (eq(tm, 1920)) return mal(this.inT, 'Multiplicaste 120 por 16: eso no es un tiempo. Si 120 = 16·t, ¿qué operación despeja t?');
    if (tm.n * 15 === tm.d * 2) return mal(this.inT, 'Dividiste 16 por 120. En 120 = 16·t, el 16 está multiplicando a t.');
    if (!eq(tm, 15, 2)) return mal(this.inT, `Con t = ${ftc(tm)} s, tu modelo da d = ${nf(16 * fv(tm))} m, no 120 m.`);
    marcarInput(this.inT, true);
    return { ok: true, msg: '¡Modelo exacto! Mirá la largada en cámara rápida: el dron saca la foto justo a los 6,5 s.' };
  },
  alResolver(K) {
    let t = -1.5, foto = false, meta = false;
    this.anim = dt => {
      t += dt * 3.2;
      const d = 16 * t;
      this.auto.position.x = xD(Math.min(d, 136)); this.auto.rodar(dt * 3.2 * 8);
      this.reloj.texto(t < 0 ? 'cámara rápida ×3' : `t = ${nf(Math.min(t, 8.5), 1)} s · d = ${nf(Math.min(d, 136), 0)} m`);
      this.simT = t >= 0 && t <= 8 ? t : null; this.simD = d;
      if (!foto && t >= 6.5) { foto = true; this.mira.material.color.setHex(0xffffff); this.lblDron.texto('¡FOTO! t = 6,5 s'); this.auto.position.x = xD(104); K.toast('¡Foto perfecta a los 6,5 s!'); }
      if (!meta && t >= 7.5) { meta = true; confeti([xD(120), 3, 0]); }
      refrescoSuave(this, dt);
      if (t > 8.5) this.anim = null;
    };
    return 3600;
  },
  mat(K, el) {
    const P = plano({ xMin: 0, xMax: 8, yMin: 0, yMax: 130, gx: 0.5, gy: 10, lx: 1, ly: 20, ejeX: 't (s)', ejeY: 'd (m)' });
    hlinea(P, 120, COL.meta, 'meta: 120 m', { lado: 'start' });
    const v = K.leerFrac(this.inV.value), b = K.leerFrac(this.inB.value), dd = this.dronD();
    vlinea(P, 6.5, COL.dron, 't = 6,5 s', { ytxt: P.Y(10) });
    hlinea(P, dd, COL.dron, `dron: ${dd} m`, { x1: 6.5 });
    if (v && b) {
      const f = t => fv(v) * t + fv(b);
      recta(P, f, COL.linea);
      triangulo(P, 1, 2, f, COL.tri, 'avance: 1 s', `subida: ${ftc(v)} m`, `→ ${ftc(v)} m por segundo = velocidad`);
      ordenada(P, fv(b), COL.ord, `b = ${ftc(b)} m: posición cuando arranca el reloj`, { dy: fv(b) > 100 ? 22 : -10 });
      punto(P, 6.5, f(6.5), COL.linea, 5);
    }
    FOTO.forEach(([d, t], i) => { punto(P, t, d, COL.dato, 5.5); etq(P.g, P.X(t) - 8, P.Y(d) - 9, `F${i + 1} (${nf(t)}; ${d})`, COL.dato, { anchor: 'end', peso: 500 }); });
    if (this.simT != null) { punto(P, this.simT, this.simD, '#f59f00', 8, '#1b2333'); etq(P.g, P.X(this.simT) + 10, P.Y(this.simD) + 18, 'auto', '#b45309'); }
    el.append(P.svg);
    const tmeta = K.leerFrac(this.inT.value);
    const ts = [0, 1.5, 3, 4.5, 6.5, tmeta ? fv(tmeta) : null];
    const fm = t => v && b && t != null ? nf(fv(v) * t + fv(b)) : '?';
    const med = ['0', '24', '48', '72', '—', '120 (meta)'];
    el.append(K.h('table', { class: 'tabla-mat', html: `<tr><th>t (s)</th>${ts.map((t, i) => `<td>${t == null ? '¿?' : nf(t, 3)}${i === 5 ? ' ← tu t' : ''}</td>`).join('')}</tr><tr><th>d medida (m)</th>${med.map(x => `<td>${x}</td>`).join('')}</tr><tr><th>d de tu modelo</th>${ts.map(t => `<td style="color:${COL.linea}">${fm(t)}</td>`).join('')}</tr>` }));
    cajaMat(el, `d(t) = <span style="color:${COL.tri}">${v ? ftc(v) : 'v'}</span>·t + <span style="color:${COL.ord}">${b ? ftc(b) : 'b'}</span>`);
    cajaMat(el, `<b style="color:${COL.tri}">Pendiente</b>: cuántos metros aumenta d cuando t aumenta 1 s → es la <b>velocidad</b>. <b style="color:${COL.ord}">Ordenada al origen</b>: el valor de d cuando t = 0 → <b>dónde está el auto al arrancar el reloj</b>. Los puntos negros son las fotocélulas: tu recta tiene que pasar por los tres.`, 'nota');
  },
  pistas: [
    'Mirá las fotocélulas: ¿cuántos metros recorre el auto entre una y la siguiente? ¿Cuánto tiempo tarda en recorrerlos? Si la velocidad es constante, esa relación no cambia.',
    'La pendiente es <b>Δd / Δt</b>: distancia recorrida dividida por el tiempo empleado. La ordenada al origen es la posición del auto cuando t = 0 (fijate dónde arranca el cronómetro).',
    'Con tu fórmula, reemplazá <b>t = 6,5</b> para saber dónde ubicar el dron. Para la meta, planteá la ecuación <b>v·t + b = 120</b> y despejá t.',
  ],
  bitacora: [
    '¿Cómo calculaste la velocidad a partir de las fotocélulas? Mostrá la cuenta con al menos dos mediciones distintas y explicá por qué da lo mismo.',
    '¿Por qué este modelo es una función <b>lineal</b> (ordenada 0)? ¿Qué significa la pendiente en esta situación y en qué unidad se mide?',
    '¿Cómo comprobaste dónde ubicar el dron y cuándo cruza la meta? Escribí las ecuaciones que planteaste y cómo las resolviste.',
  ],
  resumenBitacora() { return 'Modelo del EV-7: <b>d(t) = 16·t</b> (d en metros, t en segundos). Dron ubicado en <b>104 m</b> para t = 6,5 s · meta cruzada a los <b>7,5 s</b>.'; },
  prueba: {
    mal: [
      function () { this.fijar('1/16', '0', 104, '7,5'); },
      function () { this.fijar('16', '24', 104, '7,5'); },
      function () { this.fijar('16', '0', 96, '7,5'); },
      function () { this.fijar('16', '0', 104, '1920'); },
    ],
    bien() { this.fijar('16', '0', 104, '7,5'); },
  },
  fijar(v, b, d, t) { this.anim = null; this.inV.value = v; this.inB.value = b; this.inT.value = t; this.dron.position.x = xD(d); this.act(); },
};

/* ── Nivel 2: consumo de energía ── E(d) = 48 − 0,15·d ────────────────
   Telemetría: km 20 → 45 · km 60 → 39 · km 100 → 33 · km 140 → 27 kWh.
   Autonomía: 320 km. Carrera 300 km → llega con 3 kWh < 5 kWh de reserva → NO. */
const TEL = [[20, 45], [60, 39], [100, 33], [140, 27]];
const ALTO_BAT = 9;
const N2 = {
  titulo: 'Análisis de consumo de energía',
  relato: 'En los entrenamientos la batería del EV-7 se fue descargando de forma pareja. Cuatro postes de telemetría guardaron la energía que quedaba en algunos kilómetros. El domingo se corre una carrera de <b>300 km</b> y el reglamento exige cruzar la meta con al menos <b>5 kWh</b> de reserva.',
  objetivo: 'Ajustá el modelo <b>E(d) = b + m·d</b> hasta que coincida con la telemetría. Después calculá la <b>autonomía</b>, la energía al cruzar la meta y decidí si puede correr sin parar a cargar.',
  tituloMat: 'Energía de la batería según la distancia', subMat: 'función afín decreciente · E(d) = b + m·d',
  armar(K) {
    cam([6, 60, 68], [4, 0, -12], { suave: false, min: 30, max: 190 });
    this.anim = null; this.simD = null;
    this.auto = K.agregar(autoEV());
    ponerEnOvalo(this.auto, 13);
    this.lblAuto = K.etiqueta('km 0', [0, 3.2, 0], 'claro', this.auto);
    // postes de telemetría
    this.postes = TEL.map(([d, e], i) => {
      const x = -27 + 18 * i;
      K.agregar(K.cilindro(0.18, 0.25, 3.2, 0x495057, [x, 1.6, 8], 8));
      const pant = K.agregar(K.caja(2.6, 1.5, 0.25, 0x1d2433, [x, 3.8, 8], { emissive: 0x000000 }));
      const lbl = K.etiqueta('', [x, 5.6, 8], 'tel');
      return { d, e, pant, lbl };
    });
    // torre de batería
    const tb = new THREE.Group(); tb.position.set(34, 0, -21); tb.scale.setScalar(1.5); K.agregar(tb);
    tb.add(K.cilindro(2.3, 2.5, 0.6, 0x26324a, [0, 0.3, 0], 20));
    tb.add(K.cilindro(2.3, 2.3, 0.5, 0x26324a, [0, ALTO_BAT + 0.85, 0], 20));
    tb.add(K.cilindro(0.6, 0.6, 0.4, 0xadb5bd, [0, ALTO_BAT + 1.3, 0], 12));
    const vidrio = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, ALTO_BAT, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xdbe9ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    vidrio.position.y = 0.6 + ALTO_BAT / 2; tb.add(vidrio);
    const gl = new THREE.CylinderGeometry(1.85, 1.85, 1, 24); gl.translate(0, 0.5, 0);
    this.relleno = new THREE.Mesh(gl, K.mat(0x2fe0a8, { emissive: 0x0b6b4f, emissiveIntensity: 0.5 }));
    this.relleno.position.y = 0.6; tb.add(this.relleno);
    for (let e = 10; e <= 60; e += 10) { const r = new THREE.Mesh(new THREE.TorusGeometry(2.12, 0.04, 4, 32), new THREE.MeshBasicMaterial({ color: 0xffffff })); r.rotation.x = Math.PI / 2; r.position.y = 0.6 + e / 60 * ALTO_BAT; tb.add(r); }
    this.anilloRes = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.12, 6, 32), new THREE.MeshBasicMaterial({ color: 0xff3b3b }));
    this.anilloRes.rotation.x = Math.PI / 2; this.anilloRes.position.y = 0.6 + 5 / 60 * ALTO_BAT; tb.add(this.anilloRes);
    K.etiqueta('reserva 5 kWh', [2.6, 0.6 + 5 / 60 * ALTO_BAT, 0], 'mal', tb);
    K.etiqueta('60 kWh', [2.6, 0.6 + ALTO_BAT, 0], '', tb);
    this.lblBat = K.etiqueta('', [0, ALTO_BAT + 3, 0], 'acento', tb);
    // meta de la carrera
    K.etiqueta('LARGADA / META', [-30, 9.4, 0], 'claro');
    K.tic(dt => { if (this.anim) this.anim(dt); });
    // panel
    K.datos([['Carrera', '300 km'], ['Reserva obligatoria', '5 kWh en la meta'], ['Batería', 'hasta 60 kWh']]);
    this.sO = K.deslizador('Ordenada b: carga al largar', { id: 'n2o', min: 30, max: 60, paso: 0.5, valor: 40, formato: v => nf(v, 1) + ' kWh', alCambiar: () => this.act() });
    this.sP = K.deslizador('Pendiente m: cambio por km', { id: 'n2p', min: -0.4, max: -0.01, paso: 0.01, valor: -0.3, formato: v => nf(v, 2), alCambiar: () => this.act() });
    this.form = K.html('');
    this.btnSim = boton('▶ Simular la carrera con mi modelo', () => this.simular(false));
    this.inA = textoInput('Autonomía: km hasta que la batería queda en 0', { id: 'n2a', sufijo: 'km' });
    this.inE = textoInput('Energía al cruzar la meta (km 300)', { id: 'n2e', sufijo: 'kWh' });
    this.dec = K.opciones('¿Puede correr los 300 km sin cargar, respetando la reserva?', [['si', 'Sí, sin parar'], ['no', 'No: tiene que cargar']], { alElegir: () => this.act() });
    for (const i of [this.inA, this.inE]) i.addEventListener('input', () => { marcarInput(i, null); this.act(); });
    this.act();
  },
  modelo() { return { b: Math.round(this.sO.leer() * 2) / 2, m: Math.round(this.sP.leer() * 100) / 100 }; },
  E(d) { const { b, m } = this.modelo(); return (Math.round(b * 100) + Math.round(m * 100) * d) / 100; },
  ponerBat(e) {
    const u = Math.max(0, Math.min(60, e)) / 60;
    this.relleno.scale.y = Math.max(0.001, u * ALTO_BAT);
    this.relleno.material.color.setHex(e > 20 ? 0x2fe0a8 : e > 5 ? 0xffd84d : 0xff5d6c);
  },
  act() {
    const { b, m } = this.modelo();
    this.form.innerHTML = `<div class="formula-viva">E(d) = <b>${nf(b, 1)}</b> ${m < 0 ? '−' : '+'} <b>${nf(Math.abs(m), 2)}</b>·d</div>`;
    for (const p of this.postes) {
      const mod = this.E(p.d), bien = Math.round(mod * 100) === p.e * 100;
      p.lbl.texto(`km ${p.d}<small>real ${p.e} · modelo ${nf(mod)}</small>`);
      p.lbl.element.classList.toggle('ok', bien); p.lbl.element.classList.toggle('mal', !bien);
      p.pant.material.emissive.setHex(bien ? 0x1f9e6e : 0xc2410c); p.pant.material.emissiveIntensity = 0.8;
    }
    if (!this.anim) { this.ponerBat(b); this.lblBat.texto(`Batería al largar: ${nf(b, 1)} kWh`); }
    K.refrescarMat();
  },
  simular(real) {
    if (this.anim) return;
    K.limpiarMensaje();
    const E = real ? d => 48 - 0.15 * d : d => this.E(d);
    let d = 0, s = 13;
    this.lblBat.texto(real ? 'Batería (real)' : 'Batería según tu modelo');
    this.anim = dt => {
      const vel = real ? 130 : 60;
      d = Math.min(300, d + vel * dt); s += vel * 1.6 * dt;
      ponerEnOvalo(this.auto, s); this.auto.rodar(vel * 1.6 * dt);
      const e = E(d);
      this.ponerBat(e); this.simD = d;
      this.lblAuto.texto(`km ${Math.floor(d)}`);
      refrescoSuave(this, dt);
      if (e <= 0) { this.anim = null; this.ponerBat(0); this.lblAuto.texto(`¡sin batería! km ${nf(d, 0)}`); K.refrescarMat(); return; }
      if (d >= 300) {
        this.anim = null;
        ponerEnOvalo(this.auto, 10);
        this.lblAuto.texto('meta: km 300');
        if (real) { this.lblBat.texto('3 kWh &lt; 5 kWh de reserva → parada en boxes'); this.anilloRes.scale.setScalar(1.3); confeti([34, 16, -21], 40); }
        else this.lblBat.texto('Meta: mirá cuánta energía le queda');
        K.refrescarMat();
      }
    };
  },
  comprobar(K) {
    const { b, m } = this.modelo();
    [this.inA, this.inE].forEach(i => marcarInput(i, null));
    const mal = (inp, msg) => { if (inp) marcarInput(inp, false); return { ok: false, msg }; };
    const fallas = this.postes.filter(p => Math.round(this.E(p.d) * 100) !== p.e * 100);
    if (fallas.length) {
      if (m === -0.15 && b === 45) return mal(null, '45 kWh es la lectura del <b>km 20</b>, no la carga al largar. La ordenada al origen es la energía cuando <b>d = 0</b>.');
      if (m === -0.15) return mal(null, `La inclinación ya coincide con la telemetría, pero la recta está corrida: al largar (d = 0) la batería no tenía ${nf(b, 1)} kWh.`);
      if (b === 48) return mal(null, 'La carga al largar ya está bien, pero el consumo por km no. Fijate cuánto bajó la energía entre dos postes y entre cuántos km.');
      const p = fallas[0];
      return mal(null, `Tu modelo todavía no coincide con la telemetría en ${fallas.length} de los 4 postes (km ${p.d}: real ${p.e} kWh, modelo ${nf(this.E(p.d))} kWh).`);
    }
    const a = K.leerFrac(this.inA.value), e = K.leerFrac(this.inE.value);
    if (!a) return mal(this.inA, 'Completá la autonomía.');
    if (eq(a, 300)) return mal(this.inA, '300 km es el largo de la carrera, no la autonomía. La autonomía es la distancia en la que la batería llega a <b>0 kWh</b>.');
    if (eq(a, 36, 5)) return mal(this.inA, 'Multiplicaste la carga por el consumo: eso no da una distancia. Planteá en qué km la energía vale 0.');
    const Ea = 48 - 0.15 * fv(a);
    if (Math.abs(Ea) > 1e-9) return mal(this.inA, `Con d = ${ftc(a)} km, tu modelo da E = ${nf(Ea)} kWh, no 0 kWh. La autonomía es el <b>cero</b> de la función.`);
    marcarInput(this.inA, true);
    if (!e) return mal(this.inE, 'Completá la energía con la que cruza la meta.');
    if (eq(e, 45)) return mal(this.inE, '45 kWh es lo que se <b>gasta</b> en 300 km. La pregunta es cuánto <b>queda</b> en la batería.');
    if (eq(e, -3)) return mal(this.inE, 'Revisá los signos: si la autonomía es mayor que 300 km, a los 300 km todavía queda energía.');
    if (!eq(e, 3)) return mal(this.inE, `Reemplazá d = 300 en tu modelo: E(300) no da ${ftc(e)} kWh.`);
    marcarInput(this.inE, true);
    if (!this.dec.valor) return mal(null, 'Falta tu decisión: ¿puede correr los 300 km sin cargar?');
    if (this.dec.valor === 'si') return mal(null, 'Llega a la meta, sí… pero ¿con cuánta energía? Compará con la reserva que exige el reglamento.');
    return { ok: true, msg: 'Modelo calibrado. Autonomía de 320 km, pero cruzaría la meta con 3 kWh: menos que la reserva. ¡Hay que planificar la carga!' };
  },
  alResolver(K) { this.anim = null; this.simular(true); return 3300; },
  mat(K, el) {
    const P = plano({ xMin: 0, xMax: 340, yMin: 0, yMax: 60, gx: 20, gy: 5, lx: 40, ly: 10, ejeX: 'd (km)', ejeY: 'E (kWh)', fx: v => String(v), fy: v => String(v) });
    const { b, m } = this.modelo();
    const f = d => b + m * d;
    hlinea(P, 5, COL.meta, 'reserva: 5 kWh');
    vlinea(P, 300, COL.dron, 'meta 300 km', { ytxt: P.Y(56) });
    const cero = -b / m;
    recta(P, f, COL.linea, { hasta: Math.min(340, cero) });
    const x1 = Math.max(0, Math.min(Math.round(cero * 0.55 / 20) * 20, Math.floor((cero - 45) / 20) * 20));
    triangulo(P, x1, x1 + 40, f, COL.tri, 'avance: 40 km', `${nf(40 * m, 1)} kWh`, `→ ${nf(m, 2)} kWh por km = consumo`);
    ordenada(P, b, COL.ord, `b = ${nf(b, 1)} kWh: carga al largar`, { en: [30, 57] });
    if (cero <= 340) { P.g.append(K.s('circle', { cx: P.X(cero), cy: P.Y(0), r: 6, fill: '#fff', stroke: COL.linea, 'stroke-width': 3 })); etq(P.g, P.X(cero) - 8, P.Y(0) - 12, 'E = 0: autonomía', COL.linea, { anchor: 'end' }); }
    TEL.forEach(([d, e]) => { punto(P, d, e, COL.dato, 5.5); etq(P.g, P.X(d) + 8, P.Y(e) - 8, `(${d}; ${e})`, COL.dato, { peso: 500 }); });
    if (this.simD != null && this.anim) punto(P, this.simD, Math.max(0, this.E(this.simD)), '#f59f00', 8, '#1b2333');
    el.append(P.svg);
    cajaMat(el, `E(d) = <span style="color:${COL.ord}">${nf(b, 1)}</span> <span style="color:${COL.tri}">${m < 0 ? '−' : '+'} ${nf(Math.abs(m), 2)}</span>·d`);
    cajaMat(el, `La <b style="color:${COL.tri}">pendiente</b> es negativa: por cada km la batería <b>pierde</b> energía (consumo en kWh/km). La <b style="color:${COL.ord}">ordenada</b> es la carga cuando d = 0. El <b style="color:${COL.linea}">cero</b> de la función es la autonomía. Movè los deslizadores hasta que la recta pase por los cuatro puntos negros.`, 'nota');
  },
  pistas: [
    'Pasá al modo <b>Matemático</b>: cada poste de telemetría es un punto (d; E). Tu recta tiene que pasar por los cuatro a la vez.',
    'La pendiente es cuánto cambia la energía por cada km: compará dos lecturas, <b>ΔE / Δd</b>. Ojo con el signo: la batería baja. Después “volvé” por la recta hasta d = 0 para encontrar la carga al largar.',
    'Autonomía: buscá el valor de d para el que <b>E(d) = 0</b>. Para la meta calculá <b>E(300)</b> y comparalo con la reserva de 5 kWh.',
  ],
  bitacora: [
    '¿Cómo encontraste la carga al largar y el consumo por km a partir de la telemetría? Mostrá las cuentas.',
    '¿Por qué la pendiente es negativa? ¿Qué representan la ordenada al origen y el cero de la función en este problema?',
    'Explicá con números por qué el auto no puede correr la carrera sin cargar, aunque su autonomía sea mayor que 300 km. ¿Cómo lo verificaste?',
  ],
  resumenBitacora() { return 'Modelo de la batería: <b>E(d) = 48 − 0,15·d</b> (kWh, km). Autonomía: <b>320 km</b>. En la meta quedarían <b>3 kWh</b> &lt; 5 kWh de reserva → hay que cargar.'; },
  prueba: {
    mal: [
      function () { this.fijar(45, -0.15, '320', '3', 'no'); },
      function () { this.fijar(48, -0.15, '300', '3', 'no'); },
      function () { this.fijar(48, -0.15, '320', '45', 'no'); },
      function () { this.fijar(48, -0.15, '320', '3', 'si'); },
    ],
    bien() { this.fijar(48, -0.15, '320', '3', 'no'); },
  },
  fijar(b, m, a, e, dec) {
    this.anim = null; this.sO.poner(b); this.sP.poner(m); this.inA.value = a; this.inE.value = e;
    [...this.dec.children].find(x => x.textContent.startsWith(dec === 'si' ? 'Sí' : 'No')).click();
    this.act();
  },
};

/* ── Nivel 3: recta por dos puntos ── T(t) = 5/3·t + 22 ────────────────
   Mediciones: (6 min; 32 °C) y (15 min; 47 °C) → m = 15/9 = 5/3, b = 32 − 10 = 22.
   Límite 52 °C → 5/3·t = 30 → t = 18 min. Escala: x = −18 + 1,5·t ; altura = 0,13·T. */
const PT3 = [[6, 32], [15, 47]];
const xT = t => -18 + 1.5 * t, hT = T => 0.13 * T, ZR = -7.5;
const N3 = {
  titulo: 'Telemetría perdida',
  relato: 'En la clasificación la batería se calienta de forma pareja, pero un corte de radio borró casi toda la telemetría de temperatura. Sólo se salvaron <b>dos mediciones</b>. Si la batería pasa de <b>52 °C</b>, el auto queda fuera de carrera: hay que llamarlo a boxes a tiempo.',
  objetivo: 'Reconstruí la ecuación <b>T(t) = m·t + b</b> de la recta que pasa por las dos mediciones (valores exactos: podés escribir fracciones) y llevá el cartel <b>BOX</b> al minuto en que la batería llega a 52 °C.',
  tituloMat: 'Temperatura de la batería en función del tiempo', subMat: 'recta que pasa por dos puntos',
  armar(K) {
    cam([1.5, 22, 42], [1.5, 3, -8], { suave: false, min: 12, max: 110 });
    this.anim = null; this.simT = null;
    // pizarra de fondo (gráfico 3D)
    const piz = new THREE.Mesh(new THREE.PlaneGeometry(38, 8.6), new THREE.MeshStandardMaterial({ color: 0xf6f3ea, roughness: 1 }));
    piz.position.set(0, 4.3, ZR - 0.7); K.agregar(piz);
    for (const x of [-19.2, 19.2]) K.agregar(K.caja(0.3, 9, 0.3, 0x26324a, [x, 4.5, ZR - 0.7]));
    for (let T = 10; T <= 60; T += 10) { const l = K.caja(36, 0.05, 0.05, 0xb8b2a2, [0, hT(T), ZR - 0.6]); l.castShadow = false; K.agregar(l); K.etiqueta(`${T} °C`, [-20.4, hT(T), ZR - 0.6], 'claro'); }
    for (let t = 3; t <= 24; t += 3) { const l = K.caja(0.05, 8.2, 0.05, 0xd6d0c0, [xT(t), 4.2, ZR - 0.62]); l.castShadow = false; K.agregar(l); }
    K.agregar(K.caja(38.6, 0.4, 0.4, 0x26324a, [0, 8.75, ZR - 0.7]));
    // regla del tiempo
    K.agregar(K.caja(37, 0.12, 0.6, 0x0f1b2d, [0, 0.06, ZR]));
    for (let t = 0; t <= 24; t++) {
      K.agregar(K.caja(0.08, 0.05, t % 3 ? 0.5 : 0.9, 0xffffff, [xT(t), 0.15, ZR + (t % 3 ? 0.05 : 0.2)]));
      if (t % 3 === 0) K.etiqueta(`${t} min`, [xT(t), 0.2, ZR + 1.3], 'claro');
    }
    // límite de 52 °C
    const lim = K.agregar(K.caja(36.4, 0.12, 0.12, 0xff3b3b, [0, hT(52), ZR - 0.4], { emissive: 0xff3b3b, emissiveIntensity: 0.6 }));
    lim.castShadow = false;
    K.etiqueta('límite 52 °C', [-11.5, hT(52) + 0.55, ZR - 0.4], 'mal');
    // mediciones salvadas
    PT3.forEach(([t, T]) => {
      K.agregar(K.cilindro(0.08, 0.08, hT(T), 0xff8a3d, [xT(t), hT(T) / 2, ZR - 0.2], 6));
      K.agregar(K.esfera(0.32, 0xff8a3d, [xT(t), hT(T), ZR - 0.2], { emissive: 0xff8a3d, emissiveIntensity: 0.5 }));
      K.etiqueta(`min ${t} · ${T} °C`, [xT(t), hT(T) + 0.75, ZR - 0.2], 'acento');
    });
    this.grupoRecta = K.agregar(new THREE.Group());
    // termómetro gigante (misma escala que la pizarra)
    const tm = new THREE.Group(); tm.position.set(21.8, 0, ZR); K.agregar(tm);
    tm.add(K.cilindro(1.1, 1.3, 0.5, 0x26324a, [0, 0.25, 0], 16));
    tm.add(K.esfera(0.75, 0xe03131, [0, 0.8, 0]));
    const tubo = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 8, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xe7f0ff, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
    tubo.position.y = 4; tm.add(tubo);
    const gm = new THREE.CylinderGeometry(0.3, 0.3, 1, 12); gm.translate(0, 0.5, 0);
    this.mercurio = new THREE.Mesh(gm, K.mat(0xe03131, { emissive: 0xe03131, emissiveIntensity: 0.4 })); tm.add(this.mercurio);
    const ar = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 6, 20), new THREE.MeshBasicMaterial({ color: 0xff3b3b })); ar.rotation.x = Math.PI / 2; ar.position.y = hT(52); tm.add(ar);
    this.lblTerm = K.etiqueta('', [-1.2, 9.2, 0], 'claro', tm);
    // pack de baterías con ventiladores
    K.agregar(K.caja(3, 1.4, 2, 0x1d2433, [27.5, 0.7, ZR - 1]));
    this.vent = [0, 1].map(i => { const v = K.agregar(K.caja(0.9, 0.1, 0.12, 0xadb5bd, [26.8 + i * 1.4, 1.45, ZR - 1])); return v; });
    // cartel BOX arrastrable
    const box = new THREE.Group();
    box.add(K.cilindro(0.07, 0.07, 2.2, 0xdee2e6, [0, 1.1, 0], 6));
    const tabla = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1, 0.1), [K.mat(0xffd84d), K.mat(0xffd84d), K.mat(0xffd84d), K.mat(0xffd84d), new THREE.MeshBasicMaterial({ map: texTexto('BOX', { w: 256, h: 150, bg: '#ffd84d', fg: '#0f1b2d', tam: 110 }) }), K.mat(0xffd84d)]);
    tabla.position.y = 2.6; box.add(tabla);
    box.add(new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })).translateY(1.8));
    box.position.set(xT(3), 0, ZR + 0.9);
    this.box = K.agregar(box);
    this.lblBox = K.etiqueta('', [0, 3.6, 0], 'acento', box);
    this.bola = K.agregar(K.esfera(0.3, 0x7048e8, [0, 0, ZR - 0.15], { emissive: 0x7048e8, emissiveIntensity: 0.6 }));
    this.guia = K.agregar(K.caja(0.05, 1, 0.05, 0x7048e8, [0, 0, ZR - 0.15]));
    K.arrastrable(box, { ejes: 'x', snap: 0.75, limites: { x: [-18, 18] }, alMover: () => this.act(), activo: () => !this.anim });
    // auto en la recta principal
    this.auto = K.agregar(autoEV()); ponerEnOvalo(this.auto, 50);
    this.lblAuto = K.etiqueta('', [0, 3.2, 0], 'claro', this.auto);
    K.tic((dt, t) => { this.vent.forEach((v, i) => { v.rotation.y += dt * (this.anim ? 30 : 8) * (i ? 1 : -1); }); if (this.anim) this.anim(dt); });
    // panel
    K.datos([['Medición 1', 'min 6 → 32 °C'], ['Medición 2', 'min 15 → 47 °C'], ['Límite', '52 °C']]);
    this.inM = textoInput('Pendiente m (°C por minuto)', { id: 'n3m', sufijo: '°C/min' });
    this.inB = textoInput('Ordenada al origen b', { id: 'n3b', sufijo: '°C' });
    this.form = K.html('');
    this.lecBox = K.html('');
    for (const i of [this.inM, this.inB]) i.addEventListener('input', () => { marcarInput(i, null); this.act(); });
    this.act();
  },
  minBox() { return Math.round((this.box.position.x + 18) / 1.5 * 2) / 2; },
  modelo() { const m = K.leerFrac(this.inM.value), b = K.leerFrac(this.inB.value); return m && b ? { m, b, f: t => fv(m) * t + fv(b) } : null; },
  ponerTerm(T) { this.mercurio.scale.y = Math.max(0.01, hT(Math.max(0, Math.min(62, T)))); },
  act() {
    const M = this.modelo(), tb = this.minBox();
    this.form.innerHTML = `<div class="formula-viva">T(t) = <b>${M ? ftc(M.m) : 'm'}</b>·t + <b>${M ? ftc(M.b) : 'b'}</b></div>`;
    this.lecBox.innerHTML = `<p class="nota-p">Arrastrá el cartel <b>BOX</b> sobre la regla de tiempo: está en el <span class="lectura">minuto ${nf(tb, 1)}</span>. La bolita violeta muestra tu modelo en ese minuto.</p>`;
    this.lblBox.texto(`min ${nf(tb, 1)}`);
    // recta del modelo en 3D
    this.grupoRecta.clear();
    if (M) {
      const pts = [];
      for (let t = 0; t <= 24.001; t += 0.5) { const T = M.f(t); if (T >= 0 && T <= 64) pts.push([xT(t), hT(T), ZR - 0.15]); }
      for (let i = 1; i < pts.length; i++) this.grupoRecta.add(K.barra(pts[i - 1], pts[i], 0.08, 0x0e9f74));
      const T = M.f(tb), h = hT(Math.max(0, Math.min(64, T)));
      this.bola.visible = this.guia.visible = true;
      this.bola.position.set(this.box.position.x, h, ZR - 0.15);
      this.guia.scale.y = Math.max(0.01, h); this.guia.position.set(this.box.position.x, h / 2, ZR - 0.15);
      if (!this.anim) { this.ponerTerm(T); this.lblTerm.texto('tu modelo'); }
    } else {
      this.bola.visible = this.guia.visible = false;
      if (!this.anim) { this.ponerTerm(0); this.lblTerm.texto('sin modelo'); }
    }
    K.refrescarMat();
  },
  comprobar(K) {
    const m = K.leerFrac(this.inM.value), b = K.leerFrac(this.inB.value), tb = this.minBox();
    [this.inM, this.inB].forEach(i => marcarInput(i, null));
    const mal = (inp, msg) => { if (inp) marcarInput(inp, false); return { ok: false, msg }; };
    if (!m) return mal(this.inM, 'Escribí la pendiente m. Podés usar una fracción, por ejemplo 7/4.');
    if (eq(m, 3, 5)) return mal(this.inM, 'Dividiste <b>minutos por grados</b>. La pendiente es cuántos °C cambia la temperatura por cada minuto: ΔT / Δt.');
    if (eq(m, 47, 15) || eq(m, 16, 3)) return mal(this.inM, 'Dividiste una temperatura por su tiempo. Eso sólo sirve si la recta pasa por (0; 0), y acá no es así. Usá las <b>dos</b> mediciones.');
    if (eq(m, 15) || eq(m, 9)) return mal(this.inM, 'Calculaste sólo una de las diferencias. La pendiente compara las dos: <b>ΔT dividido Δt</b>.');
    if (fv(m) < 0) return mal(this.inM, 'La temperatura <b>sube</b> con el tiempo: la pendiente tiene que ser positiva.');
    if (!eq(m, 5, 3)) {
      if (Math.abs(fv(m) - 5 / 3) < 0.05) return mal(this.inM, `${this.inM.value.trim()} es una aproximación. Con ese valor el modelo se va corriendo y la decisión de BOX puede fallar. Escribí la pendiente <b>exacta</b> como fracción.`);
      return mal(this.inM, `Con m = ${ftc(m)}, entre el minuto 6 y el 15 la temperatura subiría ${nf(9 * fv(m))} °C, pero las mediciones muestran otra subida. Revisá la cuenta.`);
    }
    marcarInput(this.inM, true);
    if (!b) return mal(this.inB, 'Escribí la ordenada al origen b.');
    if (eq(b, 32) || eq(b, 47)) return mal(this.inB, `${ftc(b)} °C es una de las mediciones, no la temperatura en <b>t = 0</b>. Usá la pendiente para “volver” hasta el minuto 0.`);
    if (!eq(b, 22)) return mal(this.inB, `Tu recta no pasa por (6; 32): con b = ${ftc(b)}, a los 6 minutos marcaría ${nf(10 + fv(b))} °C.`);
    marcarInput(this.inB, true);
    if (tb !== 18) return { ok: false, msg: `Con tu ecuación, en el minuto ${nf(tb, 1)} la batería estaría a ${nf(5 / 3 * tb + 22)} °C, no a 52 °C. Planteá la ecuación y ubicá el cartel en el minuto exacto.` };
    return { ok: true, msg: '¡Recta reconstruida! El cartel BOX sale justo a tiempo: mirá cómo sube la temperatura en la tanda.' };
  },
  alResolver(K) {
    let t = 0, s = 50;
    this.lblTerm.texto('T real');
    this.anim = dt => {
      t = Math.min(18, t + dt * 6.5);
      s += dt * 70; ponerEnOvalo(this.auto, s); this.auto.rodar(dt * 70);
      const T = 5 / 3 * t + 22; this.ponerTerm(T); this.simT = t;
      this.lblAuto.texto(`min ${nf(t, 1)} · ${nf(T, 1)} °C`);
      refrescoSuave(this, dt);
      if (t >= 18) { this.anim = null; ponerEnOvalo(this.auto, 52); this.auto.position.z = -12.2; this.lblAuto.texto('¡a boxes! 52 °C'); confeti([this.box.position.x, 4, ZR + 1], 50); K.refrescarMat(); }
    };
    return 3400;
  },
  mat(K, el) {
    const P = plano({ xMin: 0, xMax: 24, yMin: 0, yMax: 60, gx: 1, gy: 5, lx: 3, ly: 10, ejeX: 't (min)', ejeY: 'T (°C)', fx: v => String(v), fy: v => String(v) });
    hlinea(P, 52, COL.meta, 'límite: 52 °C', { lado: 'start' });
    const M = this.modelo(), tb = this.minBox();
    vlinea(P, tb, COL.dron, `BOX: min ${nf(tb, 1)}`, { ytxt: P.Y(6) });
    if (M) {
      recta(P, M.f, COL.linea);
      const ok = t => M.f(t) >= 2 && M.f(t) <= 58;
      const [x1, x2] = ok(9) && ok(12) ? [9, 12] : [1, 4];
      triangulo(P, x1, x2, M.f, COL.tri, 'avance: 3 min', `subida: ${nf(3 * fv(M.m))} °C`, `→ ${ftc(M.m)} °C por minuto`);
      ordenada(P, fv(M.b), COL.ord, `b = ${ftc(M.b)} °C: temperatura al salir`, { dy: fv(M.b) > 45 ? 22 : -12 });
      const T = M.f(tb); if (T >= 0 && T <= 60) punto(P, tb, T, COL.dron, 5);
    }
    PT3.forEach(([t, T]) => { punto(P, t, T, COL.dato, 6); etq(P.g, P.X(t) + 9, P.Y(T) + 18, `(${t}; ${T})`, COL.dato); });
    if (this.simT != null && this.anim) punto(P, this.simT, 5 / 3 * this.simT + 22, '#f59f00', 8, '#1b2333');
    el.append(P.svg);
    cajaMat(el, `T(t) = <span style="color:${COL.tri}">${M ? ftc(M.m) : 'm'}</span>·t + <span style="color:${COL.ord}">${M ? ftc(M.b) : 'b'}</span>`);
    cajaMat(el, `Dos puntos alcanzan para determinar una recta. La <b style="color:${COL.tri}">pendiente</b> es cuántos °C sube la batería por minuto; la <b style="color:${COL.ord}">ordenada</b>, la temperatura en t = 0 (al salir de boxes). Tu recta tiene que pasar <b>exactamente</b> por los dos puntos negros.`, 'nota');
  },
  pistas: [
    'Tenés dos puntos de la recta: (tiempo; temperatura). Con dos puntos alcanza para conocerla entera, y en el modo Matemático podés ver si tu recta pasa por los dos.',
    'Pendiente: <b>m = (T₂ − T₁) / (t₂ − t₁)</b>. Dejala como fracción simplificada. Después reemplazá uno de los puntos en <b>T = m·t + b</b> y despejá b.',
    'Para el cartel BOX, planteá <b>m·t + b = 52</b>: primero restá b en los dos miembros, después dividí por m (dividir por una fracción es multiplicar por su inversa).',
  ],
  bitacora: [
    'Escribí paso a paso cómo obtuviste la ecuación de la recta que pasa por las dos mediciones.',
    '¿Qué significan la pendiente y la ordenada de tu ecuación en la situación de la batería? ¿Por qué conviene escribir la pendiente como fracción y no como un decimal redondeado?',
    '¿Cómo podés verificar que tu ecuación es correcta usando los dos puntos? ¿Cómo calculaste el minuto del cartel BOX?',
  ],
  resumenBitacora() { return 'Recta reconstruida: <b>T(t) = 5/3·t + 22</b> (°C, minutos). Pasa por (6; 32) y (15; 47). Cartel BOX en el <b>minuto 18</b>, cuando la batería llega a 52 °C.'; },
  prueba: {
    mal: [
      function () { this.fijar('3/5', '22', 18); },
      function () { this.fijar('5/3', '32', 18); },
      function () { this.fijar('1,67', '22', 18); },
      function () { this.fijar('5/3', '22', 17.5); },
    ],
    bien() { this.fijar('5/3', '22', 18); },
  },
  fijar(m, b, t) { this.anim = null; this.inM.value = m; this.inB.value = b; this.box.position.x = xT(t); this.act(); },
};

/* ── Nivel 4: elección del plan de carga ───────────────────────────────
   A: 12 000 + 240·x · B: 30 000 + 150·x · C: 57 000 + 60·x  (pesos, x en kWh)
   A = B en 200 kWh ($60 000) · B = C en 300 kWh ($75 000) · A = C en 250 kWh (no es cambio: B es menor).
   Necesidad: 270 kWh (6 tandas de 45 kWh) → A $76 800 · B $70 500 · C $73 200 → plan B. */
const PLANES = { A: { nom: 'Red Rápida', fijo: 12000, kwh: 240, col: 0xe03131, css: COL.A, x: -16 }, B: { nom: 'VoltPlus', fijo: 30000, kwh: 150, col: 0x1c7ed6, css: COL.B, x: 0 }, C: { nom: 'Solar Box', fijo: 57000, kwh: 60, col: 0x2f9e44, css: COL.C, x: 16 } };
const costo = (p, x) => PLANES[p].fijo + PLANES[p].kwh * x;
const xK = k => -30 + 0.15 * k, ZK = 7.6;
const N4 = {
  titulo: 'El plan de carga más conveniente',
  relato: 'Para el fin de semana el equipo necesita <b>270 kWh</b>: seis tandas de 45 kWh, lo que consume una carrera completa. En el paddock hay tres servicios de carga, cada uno con un <b>cargo fijo</b> y un <b>precio por kWh</b>. El jefe de equipo quiere un mapa claro: qué plan conviene según la energía que se compre.',
  objetivo: 'Ubicá los dos <b>banderines</b> en las energías exactas donde conviene cambiar de plan, elegí el plan para <b>270 kWh</b> y escribí cuánto va a pagar el equipo.',
  tituloMat: 'Costo total según la energía cargada', subMat: 'comparación de funciones afines · intersección de rectas',
  textoComprobar: 'Comprobar y cargar',
  armar(K) {
    cam([2, 40, 54], [2, 0, -1], { suave: false, min: 15, max: 140 });
    this.anim = null; this.plan = null;
    // estaciones de carga
    this.est = {};
    for (const [k, p] of Object.entries(PLANES)) {
      const g = new THREE.Group(); g.position.set(p.x, 0, -7.6); K.agregar(g);
      g.add(K.caja(3.6, 0.25, 2.6, 0xdee2e6, [0, 0.12, 0]));
      g.add(K.caja(1.5, 3, 1, p.col, [0, 1.75, 0]));
      g.add(K.caja(1.1, 0.8, 0.06, 0x0f1b2d, [0, 2.4, 0.53], { emissive: p.col, emissiveIntensity: 0.35 }));
      g.add(K.caja(1.7, 0.3, 1.2, 0xf8f9fa, [0, 3.4, 0]));
      if (k === 'C') { g.add(K.caja(0.15, 2.2, 0.15, 0x868e96, [-1.6, 1.1, -1]), K.caja(0.15, 2.2, 0.15, 0x868e96, [1.6, 1.1, -1])); g.add(panelSolar(4.4, 2.6, [0, 4.3, -0.5], -0.35)); }
      if (k === 'A') { const r = K.caja(0.5, 0.9, 0.5, 0xffd84d, [0, 4, 0], { emissive: 0xffd84d, emissiveIntensity: 0.6 }); r.rotation.y = 0.6; g.add(r); }
      if (k === 'B') g.add(K.cilindro(0.5, 0.5, 0.7, 0x74c0fc, [0, 3.9, 0], 8, { emissive: 0x1c7ed6, emissiveIntensity: 0.5 }));
      const cable = K.barra([0.75, 1.2, 0.4], [1.6, 0.15, 1.4], 0.07, 0x212529); g.add(cable);
      const aro = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.14, 6, 36), new THREE.MeshBasicMaterial({ color: 0x2fe0a8 }));
      aro.rotation.x = Math.PI / 2; aro.position.y = 0.3; aro.visible = false; g.add(aro);
      g.add(new THREE.Mesh(new THREE.BoxGeometry(3.6, 5, 2.6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })).translateY(2.5));
      K.etiqueta(`<b style="color:var(--acento)">${k}</b> · ${p.nom}<small>${pesos(p.fijo)} fijo + ${pesos(p.kwh)} por kWh</small>`, [0, 5.6, 0], 'tel', g);
      K.clicable(g, () => this.elegir(k, true));
      this.est[k] = { g, aro };
    }
    // regla de energía (0 a 400 kWh) sobre el borde de la recta principal
    K.agregar(K.caja(61, 0.1, 1.1, 0x0f1b2d, [0, 0.06, ZK]));
    for (let k = 0; k <= 400; k += 10) {
      K.agregar(K.caja(0.08, 0.05, k % 50 ? 0.4 : 0.9, 0xffffff, [xK(k), 0.14, ZK + 0.75]));
      if (k % 50 === 0) K.etiqueta(String(k), [xK(k), 0.2, ZK + 1.8], 'claro');
    }
    K.etiqueta('energía (kWh)', [33.5, 0.2, ZK + 1.8], '');
    this.bandas = ['A', 'B', 'C'].map(k => { const b = K.agregar(K.caja(1, 0.08, 0.7, PLANES[k].col, [0, 0.14, ZK], { emissive: PLANES[k].col, emissiveIntensity: 0.35 })); b.castShadow = false; b.lbl = K.etiqueta(k, [0, 0.4, ZK - 1.3], 'banda'); b.lbl.element.style.background = PLANES[k].css; return b; });
    // necesidad del equipo
    K.agregar(K.cilindro(0.1, 0.1, 4.8, 0xffffff, [xK(270), 2.4, ZK - 0.6], 6));
    K.etiqueta('equipo: 270 kWh', [xK(270), 5.4, ZK - 0.6], 'acento');
    // banderines arrastrables
    this.ban = [[100, 0xff922b], [380, 0x9c36b5]].map(([k, col], i) => {
      const g = new THREE.Group();
      g.add(K.cilindro(0.08, 0.08, 3, 0xdee2e6, [0, 1.5, 0], 6));
      const tri = new THREE.Shape(); tri.moveTo(0, 0); tri.lineTo(1.6, -0.5); tri.lineTo(0, -1);
      const fl = new THREE.Mesh(new THREE.ShapeGeometry(tri), new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide, flatShading: true }));
      fl.position.set(0.05, 2.95, 0); g.add(fl);
      g.add(K.cilindro(0.45, 0.55, 0.25, col, [0, 0.13, 0], 10));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(2, 3.6, 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })).translateY(1.6));
      g.position.set(xK(k), 0, ZK + 0.2); K.agregar(g);
      g.lbl = K.etiqueta('', [0, 3.6, 0], 'claro', g);
      g.nombre = `cambio ${i + 1}`;
      K.arrastrable(g, { ejes: 'x', snap: 1.5, limites: { x: [-30, 30] }, alMover: () => this.act(), activo: () => !this.anim });
      return g;
    });
    // auto en boxes
    this.auto = K.agregar(autoEV()); this.auto.position.set(6, 0, -2.4);
    this.lblAuto = K.etiqueta('', [0, 3.2, 0], 'claro', this.auto);
    K.tic(dt => { if (this.anim) this.anim(dt); });
    // panel
    K.datos([['A · Red Rápida', '$12.000 + $240/kWh'], ['B · VoltPlus', '$30.000 + $150/kWh'], ['C · Solar Box', '$57.000 + $60/kWh'], ['Necesidad', '270 kWh']]);
    this.lecBan = K.html('');
    this.selPlan = K.opciones('Plan elegido para 270 kWh (o tocá un cargador)', [['A', 'A · Red Rápida'], ['B', 'B · VoltPlus'], ['C', 'C · Solar Box']], { alElegir: v => this.elegir(v, false) });
    this.inC = textoInput('Costo total para 270 kWh', { id: 'n4c', sufijo: '$' });
    this.inC.addEventListener('input', () => { marcarInput(this.inC, null); });
    this.act();
  },
  kwh(b) { return Math.round((b.position.x + 30) / 0.15); },
  cortes() { return this.ban.map(b => this.kwh(b)).sort((a, b) => a - b); },
  elegir(k, desdeEscena) {
    if (this.anim) return;
    this.plan = k;
    for (const [q, e] of Object.entries(this.est)) e.aro.visible = q === k;
    if (desdeEscena) [...this.selPlan.children].forEach(b => { const sel = b.textContent.startsWith(k + ' '); b.setAttribute('aria-pressed', sel); if (sel) this.selPlan.valor = k; });
    K.refrescarMat();
  },
  act() {
    const [c1, c2] = this.cortes();
    this.ban.forEach(b => b.lbl.texto(`${b.nombre} · ${this.kwh(b)} kWh`));
    const tramos = [[0, c1], [c1, c2], [c2, 400]];
    this.bandas.forEach((b, i) => { const [a, z] = tramos[i]; const w = Math.max(0.01, (z - a) * 0.15); b.scale.x = w; b.position.x = xK((a + z) / 2); b.visible = b.lbl.visible = z > a; b.lbl.position.x = b.position.x; });
    this.lecBan.innerHTML = `<p class="nota-p">Arrastrá los <b>banderines</b> sobre la regla de energía (frente a la recta). Tu mapa dice: <span style="color:#ff8787">A</span> de 0 a <span class="lectura">${c1}</span> kWh, <span style="color:#74c0fc">B</span> de ${c1} a <span class="lectura">${c2}</span> kWh y <span style="color:#8ce99a">C</span> desde ${c2} kWh.</p>`;
    K.refrescarMat();
  },
  comprobar(K) {
    const [c1, c2] = this.cortes();
    marcarInput(this.inC, null);
    const mal = (inp, msg) => { if (inp) marcarInput(inp, false); return { ok: false, msg }; };
    if (c1 === 250 || c2 === 250) return mal(null, 'Un banderín está en 250 kWh. Ahí A y C cuestan lo mismo… pero ¿alguno de los dos es el más barato en ese punto? Compará también con B.');
    if (c1 !== 200) return mal(null, `Tu primer cambio (${c1} kWh) no está en la energía donde el plan más barato deja de serlo. Buscá la energía exacta en la que dos planes cuestan lo mismo.`);
    if (c2 !== 300) return mal(null, `El primer cambio está bien. El segundo (${c2} kWh) todavía no está en el punto exacto donde el plan del tramo del medio deja de convenir.`);
    if (!this.plan) return mal(null, 'Elegí un plan para los 270 kWh: tocá un cargador o usá los botones.');
    if (this.plan === 'A') return mal(null, 'Elegiste el plan con el <b>cargo fijo más bajo</b>, pero con 270 kWh pesa mucho el precio por kWh. Mirá en qué tramo de tu mapa cae 270.');
    if (this.plan === 'C') return mal(null, 'C tiene el <b>kWh más barato</b>, pero con 270 kWh todavía no alcanza a compensar su cargo fijo. Mirá en qué tramo de tu mapa cae 270.');
    let tc = this.inC.value.replace(/[$\s]/g, '');
    if (/^\d{1,3}(\.\d{3})+$/.test(tc)) tc = tc.replace(/\./g, '');
    const c = K.leerFrac(tc);
    if (!c) return mal(this.inC, 'Escribí el costo total del plan para 270 kWh.');
    if (eq(c, 40500)) return mal(this.inC, 'Calculaste sólo la energía: te faltó sumar el <b>cargo fijo</b> (la ordenada al origen).');
    if (eq(c, 30150)) return mal(this.inC, 'Sumaste el precio de <b>un solo</b> kWh. El precio por kWh se multiplica por la energía cargada.');
    if (eq(c, 76800) || eq(c, 73200)) return mal(this.inC, 'Ese es el costo de otro plan para 270 kWh, no del que elegiste.');
    if (!eq(c, 70500)) return mal(this.inC, `Ese no es el costo del plan ${this.plan} para 270 kWh. Revisá: cargo fijo + precio por kWh · energía.`);
    marcarInput(this.inC, true);
    return { ok: true, msg: '¡Plan B confirmado! Ahorran $6.300 frente a A y $2.700 frente a C. Conectando el auto…' };
  },
  alResolver(K) {
    let e = 0;
    const e0 = this.est.B.g;
    const cable = K.agregar(K.barra([0.8, 1.4, -7.1], [5, 0.7, -3.2], 0.1, 0x2fe0a8, { emissive: 0x2fe0a8, emissiveIntensity: 0.9 }));
    this.anim = dt => {
      e = Math.min(270, e + dt * 95);
      this.lblAuto.texto(`${nf(e, 0)} kWh · ${pesos(costo('B', Math.round(e)))}`);
      cable.material.emissiveIntensity = 0.5 + 0.5 * Math.sin(performance.now() / 90);
      if (e >= 270) { this.anim = null; confeti([6, 4, -3], 60); e0.rotation.y = 0; }
    };
    return 3400;
  },
  mat(K, el) {
    const P = plano({ xMin: 0, xMax: 400, yMin: 0, yMax: 120, gx: 20, gy: 10, lx: 50, ly: 20, ejeX: 'x (kWh)', ejeY: 'costo (miles de $)', fx: v => String(v), fy: v => String(v) });
    const [c1, c2] = this.cortes();
    // mapa de tramos del alumno, bajo el eje
    [[0, c1, COL.A], [c1, c2, COL.B], [c2, 400, COL.C]].forEach(([a, z, c]) => { if (z > a) P.g.append(K.s('rect', { x: P.X(a), y: P.Y(0) + 19, width: P.X(z) - P.X(a), height: 4, fill: c, rx: 2 })); });
    vlinea(P, 270, COL.dato, 'equipo: 270', { ytxt: P.Y(116) });
    this.ban.forEach((b, i) => vlinea(P, this.kwh(b), i ? '#9c36b5' : '#e8590c', `${b.nombre}: ${this.kwh(b)}`, { ytxt: P.Y(i ? 6 : 14) + 0 }));
    for (const k of ['A', 'B', 'C']) {
      const p = PLANES[k], f = x => costo(k, x) / 1000;
      recta(P, f, p.css, { ancho: this.plan === k ? 4.5 : 2.6 });
      const xe = k === 'A' ? 390 : 390;
      etq(P.g, P.X(xe) - 6, P.Y(f(xe)) + (k === 'C' ? 18 : -9), k, p.css, { anchor: 'end', tam: 13 });
      ordenada(P, p.fijo / 1000, p.css, `fijo ${k}: ${pesos(p.fijo)}`, { dy: k === 'A' ? 4 : -8 });
    }
    const pk = this.plan || 'B', pp = PLANES[pk];
    triangulo(P, 100, 200, x => costo(pk, x) / 1000, pp.css, 'avance: 100 kWh', `subida: ${pesos(pp.kwh * 100)}`, `→ ${pesos(pp.kwh)} por kWh`);
    el.append(P.svg);
    cajaMat(el, `<span style="color:${COL.A}">A(x) = 12.000 + 240·x</span><br><span style="color:${COL.B}">B(x) = 30.000 + 150·x</span><br><span style="color:${COL.C}">C(x) = 57.000 + 60·x</span>`);
    cajaMat(el, `En cada recta la <b>ordenada</b> es el cargo fijo (lo que se paga aunque no se cargue nada) y la <b>pendiente</b> es el precio de cada kWh. Donde dos rectas se cortan, los planes cuestan lo mismo. La franja de colores bajo el eje es <b>tu mapa</b>: ¿coincide con la recta más baja en cada tramo?`, 'nota');
  },
  pistas: [
    'En el modo <b>Matemático</b> cada plan es una recta: costo = cargo fijo + precio por kWh · energía. En cada tramo conviene el plan cuya recta está <b>más abajo</b>.',
    'Dos planes cuestan lo mismo donde sus rectas se cortan: igualá sus fórmulas y despejá x. Ojo: no todos los cortes son cambios de plan, sólo los que están sobre la recta más baja.',
    'Planteá <b>12 000 + 240·x = 30 000 + 150·x</b> y hacé lo mismo con B y C. Después calculá el costo de los tres planes con x = 270 y compará.',
  ],
  bitacora: [
    '¿Cómo encontraste las energías en las que conviene cambiar de plan? Escribí las ecuaciones que planteaste y cómo las resolviste.',
    '¿Qué representan la pendiente y la ordenada de cada recta? ¿Por qué el plan con el kWh más barato no siempre es el más conveniente?',
    'Justificá tu elección para 270 kWh comparando los tres costos. ¿Qué plan elegirías si el equipo necesitara 150 kWh? ¿Y 350 kWh? ¿Cómo lo comprobás?',
  ],
  resumenBitacora() { return 'Mapa de carga: <b>A</b> conviene hasta 200 kWh, <b>B</b> entre 200 y 300 kWh, <b>C</b> desde 300 kWh. Para 270 kWh: plan <b>B</b>, costo <b>$70.500</b> (A: $76.800 · C: $73.200).'; },
  prueba: {
    mal: [
      function () { this.fijar(250, 300, 'B', '70500'); },
      function () { this.fijar(200, 300, 'A', '76800'); },
      function () { this.fijar(200, 300, 'B', '40500'); },
      function () { this.fijar(190, 300, 'B', '70500'); },
    ],
    bien() { this.fijar(200, 300, 'B', '70500'); },
  },
  fijar(c1, c2, plan, c) { this.anim = null; this.ban[0].position.x = xK(c1); this.ban[1].position.x = xK(c2); this.elegir(plan, true); this.inC.value = c; this.act(); },
};

const JUEGO = {
  id: 'ecoracing',
  titulo: 'EcoRacing',
  subtitulo: 'La carrera de la energía',
  icono: 'E',
  kicker: 'Matemática · 3.er año · Función lineal y afín',
  portada: 'Sos parte del equipo de ingeniería de <b>EcoRacing</b>, una escudería de autos eléctricos. Antes de la carrera hay que analizar velocidad, consumo, temperatura y presupuesto de carga con <b>modelos lineales</b>. En cada problema la <b>pendiente</b> y la <b>ordenada al origen</b> significan algo distinto: descubrí qué representan y usalas para tomar decisiones de carrera.',
  contenidos: ['Función lineal y afín', 'Pendiente como variación', 'Ordenada al origen', 'Recta por dos puntos', 'Cero de una función', 'Intersección de rectas'],
  final: { titulo: '¡Bandera a cuadros!', texto: 'El EV-7 larga con cada decisión respaldada por un modelo. La pendiente fue <b>velocidad</b> (m/s), <b>consumo</b> (kWh/km), <b>calentamiento</b> (°C/min) y <b>precio</b> ($/kWh); la ordenada, la posición al arrancar el reloj, la carga inicial, la temperatura al salir y el cargo fijo. Misma forma, y = m·x + b: distintos significados.' },
  escenaBase(K) { construirAutodromo(); },
  niveles: [N1, N2, N3, N4],
};
iniciar(JUEGO);

</script>
</body>
</html>
$kodu$, 'a59ea305-7e4b-4374-8039-2236dd0f5a88', now(), now());
INSERT INTO "ChatThread" (id, title, "projectId", "createdAt") VALUES ('ba5c2f30-6e96-4d15-98da-1f2e87143247', 'Conversación', 'de22f5a8-1481-409e-b867-df41b43360d7', now());
COMMIT;
SELECT id, title, slug, length("currentHtml") AS largo FROM "Project" WHERE id = 'de22f5a8-1481-409e-b867-df41b43360d7';
