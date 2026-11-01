\set ON_ERROR_STOP on
SET client_encoding = 'UTF8';
BEGIN;
-- No duplicar si ya existe un recurso con el mismo título en la cuenta.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Project" WHERE "userId" = 'a59ea305-7e4b-4374-8039-2236dd0f5a88' AND title = 'Drone City: Operación entregas') THEN
    RAISE EXCEPTION 'Ya existe un recurso con ese título en la cuenta';
  END IF;
END $$;
INSERT INTO "Project" (id, title, description, slug, "currentHtml", "userId", "createdAt", "updatedAt")
VALUES ('6f83abd0-4088-4211-874c-333de6c7d436', 'Drone City: Operación entregas', 'Videojuego 3D · 3.er año. Ejes cartesianos, abscisas y ordenadas, coordenadas, variables independientes y dependientes en cuatro misiones de entregas con drones.', 'drone-city-operacion-entregas-hy2opdc4', $kodu$<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITULO__</title>
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
  --acento:#22d3c5; --acento-2:#ffd23f;
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

/* ── Drone City ─────────────────────────────────────────────── */
.lbl.dron{background:#22d3c5;color:#0f1b2d;border-color:transparent}
.lbl.altura{background:rgba(255,255,255,.93);color:#0f1b2d;font-size:12px;border-color:#22d3c5}
.lbl.chico{font-size:11.5px;padding:2px 6px}
.lbl.pin{font-family:var(--f-titulo);font-weight:800;font-size:16px;padding:1px 9px;border:2px solid #fff;color:#0f1b2d}
.lbl.eje{font-size:12px;padding:3px 8px}
.lbl.ejex{background:#ff6f59;color:#fff;border-color:transparent}
.lbl.ejey{background:#3d8bfd;color:#fff;border-color:transparent}
.lbl.cliente{font-family:var(--f-texto);font-size:12.5px}
.dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:14px;background:var(--tinta-2);border-radius:12px;padding:10px 12px}
.dl dt{color:var(--texto-2)} .dl dd{font-family:var(--f-num);font-weight:700;text-align:right}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:7px;vertical-align:0}
.conds{list-style:none;display:flex;flex-direction:column;gap:7px;font-size:13.5px;background:var(--tinta-2);border-radius:12px;padding:10px 12px}
.conds li{display:flex;gap:8px;align-items:flex-start}.conds i{flex:none;width:11px;height:11px;border-radius:50%;margin-top:5px}
.sub-t{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--acento);font-weight:700;margin-top:4px}
.nota-p{font-size:13.5px;color:var(--texto-2);margin-top:3px}
.par-campos{display:flex;align-items:center;gap:6px}
.par-campos .entrada{width:86px;text-align:center}
.par-campos .pn{font-family:var(--f-num);font-size:24px;font-weight:700;color:var(--texto-2)}
.aviso-dest{font-size:13px;color:var(--texto-2);min-height:18px}
.tabla{border-collapse:collapse;width:100%;font-family:var(--f-num);font-size:14px}
.tabla th,.tabla td{border:1px solid var(--tinta-3);padding:4px;text-align:center}
.tabla th{color:var(--texto-2);font-size:12px;text-align:left;white-space:nowrap;font-family:var(--f-texto)}
.tabla .entrada{height:34px;padding:0 4px;text-align:center;font-size:14px;-moz-appearance:textfield}
.tabla .entrada::-webkit-inner-spin-button,.tabla .entrada::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
#vistaMat .tabla-mat{border-collapse:collapse;font-family:var(--f-num);font-size:13px;margin:0 4px}
#vistaMat .tabla-mat th,#vistaMat .tabla-mat td{border:1px solid #e0d9c8;padding:3px 9px;text-align:center}
#vistaMat .tabla-mat th{background:#f2efe6;font-family:var(--f-texto);font-size:12px}
#vistaMat .ley{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12.5px;color:#374151;padding:0 4px}
#vistaMat .ley i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:0}
#vistaMat .fila-mat{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start}
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
/* ── Drone City: escala y utilidades ─────────────────────────────────
   El piso de la ciudad ES el plano cartesiano: 1 cuadra = U unidades del mundo.
   Abscisa x → eje X del mundo (este); ordenada y → −Z del mundo (norte).
   La altura de vuelo (eje Y del mundo) NO forma parte del par (x; y). */
const U = 4, ALT = 9;
const CORAL = '#ff6f59', AZUL = '#3d8bfd';
const W = (x, y, alt = 0) => new THREE.Vector3(x * U, alt, -y * U);
const aGrilla = p => ({ x: Math.round(p.x / U) + 0, y: Math.round(-p.z / U) + 0 });
const enCiudad = o => o.position.z <= 24.5;
const sg = n => (n < 0 ? '−' + (-n) : String(n + 0));
const par = (x, y) => `(${sg(x)}; ${sg(y)})`;
const hex = c => '#' + c.toString(16).padStart(6, '0');
const PLAZAS = { '3,3': 'I', '-4,3': 'II', '-4,-4': 'III', '3,-4': 'IV' };
const sinRayo = o => { o.traverse(m => { m.raycast = () => {}; }); return o; };
function azar(seed) {
  return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const transp = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });

/** Piso de la ciudad pintado en un canvas: manzanas, calles, ejes-avenida y números de los ejes. */
function texturaCiudad(K) {
  const N = 2048, R = 7, k = N / (2 * R);
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = K.renderer.capabilities.getMaxAnisotropy();
  const X = v => (v + R) * k, Y = v => (R - v) * k;
  const dibujar = () => {
    const c = cv.getContext('2d');
    c.fillStyle = '#8fc06a'; c.fillRect(0, 0, N, N);
    const r = azar(3);
    for (let i = 0; i < 240; i++) { c.fillStyle = r() < .5 ? 'rgba(255,255,255,.06)' : 'rgba(0,70,0,.07)'; c.beginPath(); c.arc(r() * N, r() * N, 10 + r() * 40, 0, 7); c.fill(); }
    c.fillStyle = '#d8cfbd'; c.fillRect(X(-6.42), Y(6.42), 12.84 * k, 12.84 * k);
    c.fillStyle = '#4b5263'; c.fillRect(X(-6.3), Y(6.3), 12.6 * k, 12.6 * k);
    for (let i = -6; i < 6; i++) for (let j = -6; j < 6; j++) {
      const pl = PLAZAS[`${i},${j}`];
      c.fillStyle = '#ddd3c1'; c.fillRect(X(i + .12), Y(j + .88), .76 * k, .76 * k);
      c.fillStyle = pl ? '#7cc265' : '#c9bea9'; c.fillRect(X(i + .17), Y(j + .83), .66 * k, .66 * k);
      if (pl) {
        c.strokeStyle = '#eadfc4'; c.lineWidth = 12; c.beginPath();
        c.moveTo(X(i + .17), Y(j + .83)); c.lineTo(X(i + .83), Y(j + .17)); c.moveTo(X(i + .83), Y(j + .83)); c.lineTo(X(i + .17), Y(j + .17)); c.stroke();
        c.fillStyle = '#7cc265'; c.beginPath(); c.arc(X(i + .5), Y(j + .5), .2 * k, 0, 7); c.fill();
        c.strokeStyle = '#eadfc4'; c.lineWidth = 8; c.stroke();
        c.fillStyle = '#fff'; c.font = '800 62px "Bricolage Grotesque", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(pl, X(i + .5), Y(j + .5) + 3);
      }
    }
    c.setLineDash([16, 14]); c.strokeStyle = 'rgba(255,255,255,.42)'; c.lineWidth = 3;
    for (let v = -6; v <= 6; v++) {
      if (v === 0) continue;
      c.beginPath(); c.moveTo(X(v), Y(6.3)); c.lineTo(X(v), Y(-6.3)); c.stroke();
      c.beginPath(); c.moveTo(X(-6.3), Y(v)); c.lineTo(X(6.3), Y(v)); c.stroke();
    }
    c.setLineDash([]);
    // Las dos avenidas principales son los ejes: doble línea de color.
    c.lineWidth = 7;
    for (const off of [-.04, .04]) {
      c.strokeStyle = CORAL; c.beginPath(); c.moveTo(X(-6.3), Y(off)); c.lineTo(X(6.3), Y(off)); c.stroke();
      c.strokeStyle = AZUL; c.beginPath(); c.moveTo(X(off), Y(6.3)); c.lineTo(X(off), Y(-6.3)); c.stroke();
    }
    // Flechas de los ejes pintadas en el parque.
    const flecha = (pts, col) => { c.fillStyle = col; c.beginPath(); pts.forEach(([a, b], i) => i ? c.lineTo(X(a), Y(b)) : c.moveTo(X(a), Y(b))); c.fill(); };
    flecha([[6.42, .16], [6.9, 0], [6.42, -.16]], CORAL);
    flecha([[-.16, 6.42], [0, 6.9], [.16, 6.42]], AZUL);
    c.font = '800 70px "Bricolage Grotesque", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = CORAL; c.fillText('x', X(6.68), Y(-.42));
    c.fillStyle = AZUL; c.fillText('y', X(.42), Y(6.68));
    // Números de los ejes en cada esquina de la avenida.
    c.font = '700 46px "JetBrains Mono", ui-monospace, monospace';
    const placa = (cx, cy, txt, col) => {
      const w = Math.max(62, c.measureText(txt).width + 22), hh = 54;
      c.fillStyle = col; c.strokeStyle = '#fff'; c.lineWidth = 3;
      c.beginPath(); c.roundRect(cx - w / 2, cy - hh / 2, w, hh, 10); c.fill(); c.stroke();
      c.fillStyle = '#fff'; c.fillText(txt, cx, cy + 2);
    };
    for (let v = -6; v <= 6; v++) {
      if (v === 0) continue;
      placa(X(v), Y(0), sg(v), CORAL);
      placa(X(0), Y(v), sg(v), AZUL);
    }
    c.fillStyle = '#fff'; c.beginPath(); c.arc(X(0), Y(0), 30, 0, 7); c.fill();
    c.strokeStyle = '#0f1b2d'; c.lineWidth = 4; c.stroke();
    c.fillStyle = '#0f1b2d'; c.fillText('0', X(0), Y(0) + 2);
    // Rosa de los vientos
    c.fillStyle = 'rgba(255,255,255,.9)'; c.font = '800 54px "Bricolage Grotesque", system-ui, sans-serif';
    c.fillText('N', X(-6.7), Y(6.62));
    flecha([[-6.82, 6.25], [-6.7, 6.45], [-6.58, 6.25]], 'rgba(255,255,255,.9)');
    tex.needsUpdate = true;
  };
  dibujar();
  document.fonts?.ready?.then(dibujar);
  return tex;
}

function instanciar(K, geo, items, extra) {
  const m = new THREE.InstancedMesh(geo, K.mat(0xffffff, extra), items.length);
  const o = new THREE.Object3D(), col = new THREE.Color();
  items.forEach((e, i) => {
    o.position.set(e[0], e[1], e[2]); o.scale.set(e[3], e[4], e[5]); o.rotation.set(0, e[7] || 0, 0); o.updateMatrix();
    m.setMatrixAt(i, o.matrix); m.setColorAt(i, col.set(e[6]));
  });
  m.castShadow = m.receiveShadow = true; K.scene.add(m); return m;
}

/** Edificios, casas y árboles (instanciados: miles de piezas en pocas llamadas de dibujo). */
function ciudad3D(K) {
  const r = azar(20251);
  const paleta = ['#f4d6a0', '#e8a87c', '#f2b880', '#a8d5ba', '#9cc3e4', '#f6efe4', '#d7b9e8', '#ffc9b9', '#c7d3dd', '#ffe08a'];
  const tejas = ['#c4553a', '#9b4a3c', '#5b6b7f', '#b5651d', '#7d4e57'];
  const cuerpos = [], techos = [], franjas = [], azoteas = [], arboles = [];
  for (let i = -6; i < 6; i++) for (let j = -6; j < 6; j++) {
    const cx = (i + .5) * U, cz = -(j + .5) * U;
    if (PLAZAS[`${i},${j}`]) {
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) arboles.push([cx + dx * 1.02, cz + dz * 1.02, .75 + r() * .3]);
      continue;
    }
    const col = () => paleta[(r() * paleta.length) | 0];
    const cerca = (i >= -1 && i <= 0) || (j >= -1 && j <= 0);
    const t = r();
    if (cerca || t < .3) {
      for (const [dx, dz] of [[-.62, -.62], [.62, -.62], [-.62, .62], [.62, .62]]) {
        if (r() < .2) { arboles.push([cx + dx, cz + dz, .55 + r() * .2]); continue; }
        const w = .9 + r() * .25, hh = .7 + r() * .5;
        cuerpos.push([cx + dx, 0, cz + dz, w, hh, w, col()]);
        techos.push([cx + dx, hh, cz + dz, w, .45 + r() * .2, w, tejas[(r() * tejas.length) | 0], Math.PI / 4]);
      }
    } else if (t < .68) {
      const w = 1.8 + r() * .5, d = 1.8 + r() * .5, hh = 1.9 + r() * 1.5;
      cuerpos.push([cx, 0, cz, w, hh, d, col()]);
      for (let y = .5; y < hh - .3; y += .6) franjas.push([cx, y, cz, w + .05, .16, d + .05, '#35506e']);
      azoteas.push([cx + (r() - .5) * .7, hh, cz + (r() - .5) * .7, .55, .3, .45, '#94a3b8']);
    } else {
      for (const dx of [-.62, .62]) {
        const hh = 1.1 + r() * 1.3, c = col();
        cuerpos.push([cx + dx, 0, cz, 1.1, hh, 2.3, c]);
        for (let y = .45; y < hh - .3; y += .55) franjas.push([cx + dx, y, cz, 1.15, .14, 2.35, '#3b5574']);
      }
    }
  }
  // Cinturón verde alrededor de la ciudad y árboles sueltos en las afueras.
  let n = 0;
  while (n < 150) {
    const x = (r() * 2 - 1) * 7.6, y = (r() * 2 - 1) * 7.6;
    const m = Math.max(Math.abs(x), Math.abs(y));
    if (m < 6.55 || (y < -6 && Math.abs(x) < 3.2)) continue;
    arboles.push([x * U, -y * U, .7 + r() * .5]); n++;
  }
  n = 0;
  while (n < 110) {
    const a = r() * Math.PI * 2, d = 34 + r() * 50, x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (z < -28 && z > -46 && Math.abs(x) < 21) continue;  // ahí va la pantalla de telemetría
    if (z > 26 && Math.abs(x) < 14) continue;               // zona de carga
    arboles.push([x, z, .9 + r() * .8]); n++;
  }
  const caja = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0);
  instanciar(K, caja, cuerpos);
  instanciar(K, caja, franjas, { roughness: .4, metalness: .3 });
  instanciar(K, caja, azoteas);
  instanciar(K, new THREE.ConeGeometry(.71, 1, 4).translate(0, .5, 0), techos);
  const verdes = ['#3f8f5a', '#4fa36a', '#2f7d4f', '#5cae5c'];
  instanciar(K, new THREE.CylinderGeometry(.14, .2, 1, 6).translate(0, .5, 0), arboles.map(([x, z, s]) => [x, 0, z, s, s * .9, s, '#7a5235']));
  instanciar(K, new THREE.ConeGeometry(.8, 1.9, 7).translate(0, .95, 0), arboles.map(([x, z, s], i) => [x, .7 * s, z, s, s, s, verdes[i % 4], i]));
}

function paisaje(K) {
  const r = azar(11);
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2 + r() * .2, rad = 120 + r() * 70;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), K.mat([0x7fb069, 0x6aa35a, 0x8cbf72, 0x5e9a52][i % 4]));
    m.scale.set(20 + r() * 22, 10 + r() * 18, 20 + r() * 22); m.position.set(Math.cos(a) * rad, -3, Math.sin(a) * rad); m.rotation.y = r() * 3;
    K.scene.add(m);
  }
  const blanco = K.mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: .25 });
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group(), a = r() * Math.PI * 2, d = 70 + r() * 110;
    for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + r() * 3, 0), blanco); m.position.set(k * 4 - 6, r() * 2, r() * 3); g.add(m); }
    g.position.set(Math.cos(a) * d, 60 + r() * 25, Math.sin(a) * d); g.scale.setScalar(1 + r());
    K.scene.add(g);
  }
}

/** Dron low-poly: cuerpo, brazos, rotores que giran, LED y paquete. */
function crearDron(K, { color = 0x22d3c5, escala = 1, paquete = true } = {}) {
  const g = new THREE.Group(), cuerpo = new THREE.Group(); g.add(cuerpo);
  cuerpo.add(K.caja(1.2, .42, 1.2, 0xf1f5f9));
  cuerpo.add(K.caja(.8, .22, .8, color, [0, .3, 0]));
  for (const ang of [Math.PI / 4, -Math.PI / 4]) { const b = K.caja(3.2, .12, .2, 0x334155, [0, .05, 0]); b.rotation.y = ang; cuerpo.add(b); }
  const rotores = [];
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const px = sx * 1.13, pz = sz * 1.13;
    cuerpo.add(K.cilindro(.16, .16, .3, 0x1f2937, [px, .15, pz], 8));
    const rot = new THREE.Group(); rot.position.set(px, .33, pz);
    rot.add(K.caja(1.25, .03, .14, 0xe2e8f0));
    const b2 = K.caja(1.25, .03, .14, 0xe2e8f0); b2.rotation.y = Math.PI / 2; rot.add(b2);
    const halo = new THREE.Mesh(new THREE.CircleGeometry(.66, 20), transp(0xffffff, .2)); halo.rotation.x = -Math.PI / 2; rot.add(halo);
    cuerpo.add(rot); rotores.push(rot);
  }
  const led = K.esfera(.11, 0xff4d6d, [0, .05, .62], { emissive: 0xff4d6d, emissiveIntensity: 1.6 }); cuerpo.add(led);
  for (const sx of [-.45, .45]) { cuerpo.add(K.caja(.07, .4, .07, 0x334155, [sx, -.35, 0])); cuerpo.add(K.caja(.08, .06, 1.1, 0x334155, [sx, -.55, 0])); }
  let caja = null;
  if (paquete) { caja = K.caja(.7, .55, .7, 0xc98a4b, [0, -.62, 0]); cuerpo.add(caja); cuerpo.add(K.caja(.73, .56, .12, 0x8a5a2b, [0, -.62, 0])); }
  g.scale.setScalar(escala);
  g.userData = { rotores, cuerpo, led, caja, fase: Math.random() * 6 };
  return g;
}
function animarDron(K, d) {
  const u = d.userData;
  K.tic((dt, t) => {
    for (const r of u.rotores) r.rotation.y += dt * 38;
    u.cuerpo.position.y = Math.sin(t * 2.2 + u.fase) * .12;
    u.led.visible = Math.sin(t * 6 + u.fase) > -.3;
  });
}
/** Línea punteada desde el dron hasta el piso, con el punto del plano que queda debajo. */
function guiaAltura(K, d, texto = 'altura de vuelo: 30 m') {
  d.add(K.linea([[0, -.7, 0], [0, -ALT + .1, 0]], 0x0f766e, { discontinua: true }));
  const aro = new THREE.Mesh(new THREE.RingGeometry(.75, 1.02, 32), transp(0x22d3c5, .95));
  aro.rotation.x = -Math.PI / 2; aro.position.y = -ALT + .1; d.add(aro);
  const disco = new THREE.Mesh(new THREE.CircleGeometry(.75, 32), transp(0x0f766e, .35));
  disco.rotation.x = -Math.PI / 2; disco.position.y = -ALT + .09; d.add(disco);
  sinRayo(d);
  return K.etiqueta(texto, [.25, -ALT / 2, 0], 'altura', d);
}
/** Recorre una lista de puntos a velocidad constante en `dur` segundos. */
function volar(K, obj, puntos, dur, alLlegar, alAvanzar) {
  const seg = []; let tot = 0;
  for (let i = 1; i < puntos.length; i++) { const l = puntos[i - 1].distanceTo(puntos[i]); seg.push(l); tot += l; }
  let t = 0, llegados = 0;
  K.tic(dt => {
    if (llegados >= seg.length) return;
    t = Math.min(dur, t + dt);
    let s = t / dur * tot, i = 0;
    while (i < seg.length - 1 && s > seg[i]) { s -= seg[i]; i++; }
    obj.position.lerpVectors(puntos[i], puntos[i + 1], seg[i] ? Math.min(1, s / seg[i]) : 1);
    alAvanzar?.(t / dur);
    const hechos = t >= dur ? seg.length : i;
    while (llegados < hechos) alLlegar?.(llegados++);
  });
}
/** Drones de otras empresas dando vueltas: la ciudad está viva. */
function vida(K) {
  for (const [col, alt, rad, vel, fase] of [[0xff6f59, 14, 21, .2, 0], [0xffc93c, 16.5, 27, -.14, 2]]) {
    const d = crearDron(K, { color: col, escala: .6 }); K.agregar(d); animarDron(K, d);
    K.tic((dt, t) => { const a = fase + t * vel; d.position.set(Math.cos(a) * rad, alt, Math.sin(a) * rad * .8); d.rotation.y = -a; });
  }
}
/** Zona de carga al sur de la ciudad, donde esperan las piezas a ubicar. */
function zonaCarga(K) {
  K.agregar(K.caja(20, .1, 4, 0x334155, [0, .05, 29.6]));
  for (const z of [27.75, 31.45]) K.agregar(K.caja(20, .12, .3, 0xffd23f, [0, .06, z]));
  K.etiqueta('Zona de carga', [-12.2, .4, 29.6], 'chico');
}
const POS_CARGA = i => new THREE.Vector3(-6 + 4 * i, .1, 29.6);

function crearPlataforma(K, letra, col) {
  const g = new THREE.Group();
  g.add(K.cilindro(1.15, 1.25, .22, 0xf8fafc, [0, .11, 0], 20));
  g.add(K.cilindro(.85, .85, .24, col, [0, .12, 0], 20));
  g.add(K.cilindro(.06, .06, 3, 0x334155, [0, 1.6, 0], 6));
  const band = K.caja(1, .62, .06, col, [.53, 2.75, 0]); g.add(band);
  g.add(K.caja(.6, .5, .6, 0xc98a4b, [.35, .48, .35]));
  const et = K.etiqueta(letra, [0, 3.75, 0], 'pin', g); et.element.style.background = hex(col);
  g.userData = { band, et };
  return g;
}
function crearAntena(K, col, nombre) {
  const g = new THREE.Group();
  g.add(K.cilindro(1.1, 1.25, .22, 0xe2e8f0, [0, .11, 0], 16));
  g.add(K.cilindro(.85, .85, .24, col, [0, .12, 0], 16));
  const mastil = new THREE.Mesh(new THREE.CylinderGeometry(.08, .3, 4.4, 4), K.mat(0xcbd5e1)); mastil.position.y = 2.45; mastil.castShadow = true; g.add(mastil);
  for (const yy of [1.5, 2.9]) g.add(K.cilindro(.3 - yy * .05, .3 - yy * .05, .14, col, [0, yy, 0], 8));
  g.add(K.esfera(.38, col, [0, 4.8, 0], { emissive: col, emissiveIntensity: .7 }));
  const cob = new THREE.Group();
  const disco = new THREE.Mesh(new THREE.CircleGeometry(2 * U, 48), transp(col, .1));
  const aro = new THREE.Mesh(new THREE.RingGeometry(2 * U - .2, 2 * U, 64), transp(col, .8));
  for (const m of [disco, aro]) { m.rotation.x = -Math.PI / 2; m.position.y = .07; cob.add(m); }
  sinRayo(cob); cob.visible = false; g.add(cob);
  const et = K.etiqueta(nombre, [0, 5.75, 0], 'pin', g); et.element.style.background = hex(col);
  g.userData = { cob, et };
  return g;
}
function torreFija(K, nombre, x, y) {
  const g = new THREE.Group(); g.position.copy(W(x, y));
  for (let k = 0; k < 6; k++) g.add(K.cilindro(.36 - k * .045, .4 - k * .045, 1.1, k % 2 ? 0xffffff : 0xe24b4b, [0, .55 + k * 1.1, 0], 6));
  g.add(K.esfera(.22, 0xff3b3b, [0, 6.8, 0], { emissive: 0xff3b3b, emissiveIntensity: 2 }));
  const aro = new THREE.Mesh(new THREE.RingGeometry(2 * U - .2, 2 * U, 64), transp(0x475569, .6));
  aro.rotation.x = -Math.PI / 2; aro.position.y = .07; g.add(sinRayo(aro));
  K.etiqueta(`${nombre} ${par(x, y)}`, [0, 7.7, 0], 'claro', g);
  K.agregar(g); return g;
}
/** Tubo cuyos extremos se pueden mover (rectas del gráfico, recorridos). */
function segmento(K, color, radio = .13) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radio, radio, 1, 8), K.mat(color, { emissive: color, emissiveIntensity: .45 }));
  const eY = new THREE.Vector3(0, 1, 0);
  m.poner = (a, b) => {
    const dir = b.clone().sub(a), L = dir.length();
    m.visible = L > 1e-4;
    m.position.copy(a).add(b).multiplyScalar(.5); m.scale.set(1, Math.max(L, 1e-4), 1);
    if (L > 1e-4) m.quaternion.setFromUnitVectors(eY, dir.normalize());
  };
  sinRayo(m);
  return m;
}

/** Pantalla gigante de telemetría: un plano cuyos ejes son MAGNITUDES, no lugares. */
function crearPantalla(K, cfg) {
  const { ancho = 36, alto = 22, centro = [0, 22.5, -38], xMax, yMax, gx, gy, lx, ly, extraD = 0, nombre = '' } = cfg;
  const mI = 3.6, mD = 1.2, mA = 1.7, mB = 2.7;
  const [cx, cy, cz] = centro;
  K.agregar(K.caja(ancho + 1.2, alto + 1.2, .7, 0x1e293b, [cx, cy, cz - .4]));
  K.agregar(K.caja(ancho + 1.4, .35, .9, 0x22d3c5, [cx, cy + alto / 2 + .7, cz - .4], { emissive: 0x22d3c5, emissiveIntensity: .6 }));
  for (const sx of [-1, 1]) {
    const hp = cy - alto / 2 - .6;
    K.agregar(K.caja(1, hp, 1, 0x475569, [cx + sx * (ancho / 2 - 5), hp / 2, cz - .4]));
    K.agregar(K.caja(3, .5, 3, 0x64748b, [cx + sx * (ancho / 2 - 5), .25, cz - .4]));
  }
  const CW = 2048, CH = Math.round(CW * alto / ancho), k = CW / ancho;
  const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const pant = new THREE.Mesh(new THREE.PlaneGeometry(ancho, alto), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  pant.position.set(cx, cy, cz); K.agregar(pant);
  const x0 = cx - ancho / 2 + mI, x1 = cx + ancho / 2 - mD - extraD, y0 = cy - alto / 2 + mB, y1 = cy + alto / 2 - mA;
  const aX = u => x0 + u / xMax * (x1 - x0), aY = v => y0 + v / yMax * (y1 - y0);
  const deX = wx => (wx - x0) / (x1 - x0) * xMax, deY = wy => (wy - y0) / (y1 - y0) * yMax;
  const cX = wx => (wx - (cx - ancho / 2)) * k, cY = wy => ((cy + alto / 2) - wy) * k;
  const P = { aX, aY, deX, deY, x0, x1, y0, y1, z: cz + .5, tx: cfg.tx, ty: cfg.ty, bandejaX: x1 + .4 + extraD / 2 };
  P.dibujar = () => {
    const c = cv.getContext('2d');
    const gr = c.createLinearGradient(0, 0, 0, CH); gr.addColorStop(0, '#0d2036'); gr.addColorStop(1, '#0a1626');
    c.fillStyle = gr; c.fillRect(0, 0, CW, CH);
    c.strokeStyle = 'rgba(34,211,197,.2)'; c.lineWidth = 2;
    for (let u = 0; u <= xMax + 1e-9; u += gx) { c.beginPath(); c.moveTo(cX(aX(u)), cY(y0)); c.lineTo(cX(aX(u)), cY(y1)); c.stroke(); }
    for (let v = 0; v <= yMax + 1e-9; v += gy) { c.beginPath(); c.moveTo(cX(x0), cY(aY(v))); c.lineTo(cX(x1), cY(aY(v))); c.stroke(); }
    c.strokeStyle = '#e8f6ff'; c.fillStyle = '#e8f6ff'; c.lineWidth = 5;
    c.beginPath(); c.moveTo(cX(x0), cY(y0)); c.lineTo(cX(x1) + 26, cY(y0)); c.moveTo(cX(x0), cY(y0)); c.lineTo(cX(x0), cY(y1) - 26); c.stroke();
    c.beginPath(); c.moveTo(cX(x1) + 44, cY(y0)); c.lineTo(cX(x1) + 20, cY(y0) - 13); c.lineTo(cX(x1) + 20, cY(y0) + 13); c.fill();
    c.beginPath(); c.moveTo(cX(x0), cY(y1) - 44); c.lineTo(cX(x0) - 13, cY(y1) - 20); c.lineTo(cX(x0) + 13, cY(y1) - 20); c.fill();
    c.font = '700 54px "JetBrains Mono", ui-monospace, monospace'; c.fillStyle = '#cfe8ff';
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let u = 0; u <= xMax + 1e-9; u += lx) c.fillText(String(u), cX(aX(u)), cY(y0) + 14);
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let v = ly; v <= yMax + 1e-9; v += ly) c.fillText(String(v), cX(x0) - 18, cY(aY(v)));
    c.font = '800 58px "Bricolage Grotesque", system-ui, sans-serif'; c.fillStyle = '#ffd23f';
    c.textAlign = 'right'; c.textBaseline = 'top'; c.fillText(P.tx, cX(x1) + 40, cY(y0) + 80);
    c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(P.ty, cX(x0) + 2.6 * k, cY(y1) - 50);
    if (nombre) { c.font = '700 44px "JetBrains Mono", ui-monospace, monospace'; c.fillStyle = '#22d3c5'; c.textAlign = 'right'; c.fillText(nombre, CW - 36, cY(y1) - 50); }
    if (extraD) {
      c.strokeStyle = 'rgba(255,210,63,.6)'; c.lineWidth = 3; c.setLineDash([12, 10]);
      c.beginPath(); c.roundRect(cX(x1 + .8), cY(y1), (extraD - .8) * k, (y1 - y0) * k, 18); c.stroke(); c.setLineDash([]);
      c.font = '700 40px "Atkinson Hyperlegible", system-ui, sans-serif'; c.fillStyle = '#ffd23f'; c.textAlign = 'center'; c.textBaseline = 'top';
      c.fillText('bandeja', cX(P.bandejaX), cY(y0) + 12);
    }
    tex.needsUpdate = true;
  };
  P.titulos = (tx, ty) => { P.tx = tx; P.ty = ty; P.dibujar(); };
  P.dibujar(); document.fonts?.ready?.then(P.dibujar);
  return P;
}

// ── Vista matemática: helpers SVG ──
function encajar(svg) { svg.style.cssText = 'flex:1 1 0;min-height:230px;height:auto;width:100%'; return svg; }
function planoCiudad(K) {
  const p = K.planoCartesiano({ xMin: -6.7, xMax: 6.7, yMin: -6.7, yMax: 6.7, ancho: 520, alto: 520, margen: 24 });
  encajar(p.svg);
  const fondo = K.s('g');
  for (const [q, x, y] of [['I', 3.5, 3.5], ['II', -3.5, 3.5], ['III', -3.5, -3.5], ['IV', 3.5, -3.5]])
    fondo.append(K.s('text', { x: p.X(x), y: p.Y(y) + 12, 'text-anchor': 'middle', 'font-size': 34, 'font-weight': 800, fill: '#ebe5d6', 'font-family': 'Bricolage Grotesque, sans-serif' }, q));
  fondo.append(K.s('line', { x1: p.X(-6.7), x2: p.X(6.7), y1: p.Y(0), y2: p.Y(0), stroke: CORAL, 'stroke-width': 3.5, opacity: .7 }));
  fondo.append(K.s('line', { y1: p.Y(-6.7), y2: p.Y(6.7), x1: p.X(0), x2: p.X(0), stroke: AZUL, 'stroke-width': 3.5, opacity: .7 }));
  fondo.append(K.s('text', { x: p.X(6.6), y: p.Y(0) + 30, 'text-anchor': 'end', fill: CORAL, 'font-weight': 700 }, 'eje x: abscisas'));
  fondo.append(K.s('text', { x: p.X(0) + 8, y: p.Y(6.6) + 18, fill: AZUL, 'font-weight': 700 }, 'eje y: ordenadas'));
  p.g.append(fondo);
  return p;
}
function punto(K, p, x, y, col, txt, { r = 8, dx = 10, dy = -10, ancla = 'start', borde = '#fff' } = {}) {
  p.g.append(K.s('circle', { cx: p.X(x), cy: p.Y(y), r, fill: col, stroke: borde, 'stroke-width': 2 }));
  if (txt) p.g.append(K.s('text', { x: p.X(x) + dx, y: p.Y(y) + dy, 'text-anchor': ancla, 'font-weight': 700, fill: '#1b2333', stroke: '#fdfcf8', 'stroke-width': 3, 'paint-order': 'stroke' }, txt));
}
/** Plano de magnitudes (primer cuadrante) con pasos distintos en cada eje. */
function planoMag(K, { xMax, yMax, gx, gy, lx, ly, tx, ty, Wd = 560, H = 360 }) {
  const mL = 54, mB = 46, mR = 26, mT = 34;
  const X = u => mL + u / xMax * (Wd - mL - mR), Y = v => H - mB - v / yMax * (H - mB - mT);
  const svg = encajar(K.s('svg', { viewBox: `0 0 ${Wd} ${H}`, preserveAspectRatio: 'xMidYMid meet', 'font-family': 'JetBrains Mono, monospace', 'font-size': 11 }));
  const gr = K.s('g', { stroke: '#e7e2d6' });
  for (let u = 0; u <= xMax + 1e-9; u += gx) gr.append(K.s('line', { x1: X(u), x2: X(u), y1: Y(0), y2: Y(yMax) }));
  for (let v = 0; v <= yMax + 1e-9; v += gy) gr.append(K.s('line', { x1: X(0), x2: X(xMax), y1: Y(v), y2: Y(v) }));
  svg.append(gr);
  svg.append(K.s('defs', {}, K.s('marker', { id: 'flechaM', viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, K.s('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#1b2333' }))));
  const ej = K.s('g', { stroke: '#1b2333', 'stroke-width': 1.6 });
  ej.append(K.s('line', { x1: X(0), x2: X(xMax) + 12, y1: Y(0), y2: Y(0), 'marker-end': 'url(#flechaM)' }));
  ej.append(K.s('line', { x1: X(0), x2: X(0), y1: Y(0), y2: Y(yMax) - 12, 'marker-end': 'url(#flechaM)' }));
  svg.append(ej);
  const et = K.s('g', { fill: '#6b7280' });
  for (let u = 0; u <= xMax + 1e-9; u += lx) et.append(K.s('text', { x: X(u), y: Y(0) + 15, 'text-anchor': 'middle' }, String(u)));
  for (let v = ly; v <= yMax + 1e-9; v += ly) et.append(K.s('text', { x: X(0) - 6, y: Y(v) + 4, 'text-anchor': 'end' }, String(v)));
  et.append(K.s('text', { x: X(xMax) + 10, y: Y(0) + 34, 'text-anchor': 'end', fill: '#0f766e', 'font-weight': 700, 'font-size': 12 }, tx));
  et.append(K.s('text', { x: X(0) + 74, y: Y(yMax) - 16, fill: '#0f766e', 'font-weight': 700, 'font-size': 12 }, ty));
  svg.append(et);
  const g = K.s('g'); svg.append(g);
  return { svg, X, Y, g };
}
function tablaDatos(K, filas) {
  return K.html(`<dl class="dl">${filas.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>`);
}
/** Dos casilleros con forma de par ordenado: ( x ; y ). */
function campoPar(K, etiqueta, id, [phx, phy] = ['x', 'y']) {
  const ix = K.h('input', { class: 'entrada', type: 'number', step: 'any', id: id + 'x', placeholder: phx, 'aria-label': phx });
  const iy = K.h('input', { class: 'entrada', type: 'number', step: 'any', id: id + 'y', placeholder: phy, 'aria-label': phy });
  K.controles().append(K.h('div', { class: 'campo' }, K.h('label', { for: id + 'x' }, etiqueta),
    K.h('div', { class: 'par-campos' }, K.h('span', { class: 'pn' }, '('), ix, K.h('span', { class: 'pn' }, ';'), iy, K.h('span', { class: 'pn' }, ')'))));
  return [ix, iy];
}
function elegir(grupo, valores, v) { const i = valores.indexOf(v); if (i >= 0) grupo.querySelectorAll('button')[i].click(); }

const VARS = { dist: 'distancia recorrida (km)', bat: 'batería restante (%)', alt: 'altura de vuelo (m)' };
const BAT_OK = [84, 68, 52, 36];

/* ════════════════════════════════════════════════════════════════════ */
/** Cámara que se aleja en pantallas angostas (celular), para que entre toda la ciudad. */
function cam(K, pos, mira) {
  const f = innerWidth <= 860 ? Math.min(2.2, Math.max(1, 1.2 / (innerWidth / innerHeight))) : 1;
  const p = pos.map((v, i) => mira[i] + (v - mira[i]) * f);
  if (K.scene.fog) { K.scene.fog.near = 120 * f; K.scene.fog.far = 320 * f; }
  K.camara(p, mira, { min: 12, max: 260 });
}
const JUEGO = {
  id: 'drone-city',
  titulo: 'Drone City: Operación entregas',
  subtitulo: 'Colección Misiones 3D · Plano cartesiano y magnitudes',
  icono: 'D',
  kicker: 'Matemática · 3.er año · Coordenadas',
  portada: `Entrás a trabajar como operador/a de <b>Drone City Express</b>, la empresa de entregas con drones de una ciudad planificada. El piso de la ciudad es un <b>plano cartesiano</b>: la Av. de las Abscisas es el eje x, la Av. de las Ordenadas es el eje y, y cada esquina es un par ordenado medido en cuadras. Los drones vuelan a 30 m de altura… pero esa altura no forma parte del par: las entregas se ubican sobre el piso.<br><br>Escribimos los pares como <b>(x; y)</b>, con punto y coma, porque la coma la usamos para los decimales.`,
  contenidos: ['Ejes cartesianos', 'Abscisas y ordenadas', 'Pares ordenados en los 4 cuadrantes', 'Punto medio y simetrías', 'Variable independiente y dependiente', 'Tablas y gráficos', 'Problemas en contexto'],
  final: { titulo: '¡Operación entregas completa!', texto: 'Empezaste ubicando esquinas con pares (x; y) sobre el piso de la ciudad y terminaste usando pares para relacionar magnitudes: kilómetros y batería, cuadras y costo. El mismo plano cartesiano sirve para decir <b>dónde</b> está algo y para mostrar <b>cómo cambia</b> una magnitud cuando cambia otra.' },

  escenaBase(K) {
    K.cielo(0x4fb3ea, 0xfde9cf, [120, 320]);
    K.scene.add(K.suelo(0x8fbf68, 700));
    const piso = new THREE.Mesh(new THREE.PlaneGeometry(56, 56), new THREE.MeshStandardMaterial({ map: texturaCiudad(K), roughness: .95 }));
    piso.rotation.x = -Math.PI / 2; piso.position.y = .02; piso.receiveShadow = true; K.scene.add(piso);
    ciudad3D(K);
    paisaje(K);
    K.etiqueta('eje x · Av. de las Abscisas →', [29.5, 1.2, 2.6], 'eje ejex', K.scene);
    K.etiqueta('↑ eje y · Av. de las Ordenadas', [8.6, 1.2, -26.6], 'eje ejey', K.scene);
  },

  niveles: [
  /* ─────────────────────────── NIVEL 1 ─────────────────────────── */
  {
    titulo: 'Ubicar entregas',
    relato: `Primer turno en la central. Cada esquina de Drone City se nombra con un par <b>(x; y)</b>: la <b style="color:${CORAL}">abscisa x</b> dice cuántas cuadras al este (+) u oeste (−) del eje y; la <b style="color:#7fb0ff">ordenada y</b>, cuántas al norte (+) o al sur (−) del eje x. El hangar está en el origen (0; 0).`,
    objetivo: 'Arrastrá cada plataforma desde la zona de carga hasta la esquina de su pedido. Después, cargá en la consola dónde está el cliente que espera debajo del dron D-7.',
    tituloMat: 'El piso de la ciudad, visto desde arriba', subMat: '1 unidad = 1 cuadra',
    textoComprobar: 'Despachar entregas',
    armar(K) {
      this.K = K;
      cam(K, [0, 62, 40], [0, 0, 5.5]);
      vida(K); zonaCarga(K);
      this.pedidos = [
        { L: 'A', nombre: 'Panadería Sol', x: -3, y: 4, col: 0xff6f59 },
        { L: 'B', nombre: 'Veterinaria Pampa', x: 5, y: -2, col: 0xffc93c },
        { L: 'C', nombre: 'Biblioteca Popular', x: -4, y: -1, col: 0x8b7bff },
        { L: 'D', nombre: 'Taller de bicis', x: 2, y: 6, col: 0x2ec27e },
      ];
      K.html('<div class="sub-t">Pedidos del turno</div>');
      tablaDatos(K, this.pedidos.map(p => [`<span class="dot" style="background:${hex(p.col)}"></span>${p.L} · ${p.nombre}`, par(p.x, p.y)]));
      this.pedidos.forEach((p, i) => {
        const g = crearPlataforma(K, p.L, p.col); g.position.copy(POS_CARGA(i)); K.agregar(g); p.pad = g;
        K.arrastrable(g, { snap: U, limites: { x: [-24, 24], z: [-24, 24] }, alMover: () => K.refrescarMat() });
      });
      // El dron D-7 espera, a 30 m de altura, encima de un cliente.
      const d = crearDron(K); d.position.copy(W(3, -5, ALT)); K.agregar(d); animarDron(K, d);
      guiaAltura(K, d);
      K.etiqueta('D-7', [0, 1.4, 0], 'dron', d);
      this.dron = d;
      const cli = K.persona(W(3, -5).add(new THREE.Vector3(1.1, 0, .9)).toArray(), 0x22d3c5); cli.scale.setScalar(1.6); K.agregar(cli);
      this.cli = cli;
      K.tic((dt, t) => { cli.rotation.y = Math.sin(t * 3) * .4; });
      // Destino que se carga en la consola (anillo amarillo).
      const dest = new THREE.Group();
      const aro = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.7, 4), transp(0xffd23f, .95)); aro.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
      dest.add(aro, K.cilindro(0, .45, .9, 0xffd23f, [0, 1.6, 0], 4));
      dest.children[1].rotation.x = Math.PI;
      sinRayo(dest); dest.visible = false; K.agregar(dest); this.dest = dest;
      K.tic((dt, t) => { dest.children[1].position.y = 1.6 + Math.sin(t * 4) * .25; });
      K.html('<div class="sub-t">Consola del dron D-7</div><p class="nota-p">El D-7 espera quieto a <b>30 m de altura</b>, justo encima del cliente Nº 5. Cargá las coordenadas del punto de entrega para que baje.</p>');
      [this.ix, this.iy] = campoPar(K, 'Punto de entrega del cliente Nº 5', 'd7', ['x', 'y']);
      this.aviso = K.html(''); this.aviso.className = 'aviso-dest';
      for (const i of [this.ix, this.iy]) i.addEventListener('input', () => this.actualizarDestino());
    },
    actualizarDestino() {
      const x = this.K.num(this.ix), y = this.K.num(this.iy);
      this.destVal = null;
      if (isNaN(x) || isNaN(y)) { this.dest.visible = false; this.aviso.innerHTML = ''; this.K.refrescarMat(); return; }
      const dentro = Number.isInteger(x) && Number.isInteger(y) && Math.abs(x) <= 6 && Math.abs(y) <= 6;
      this.dest.visible = dentro;
      if (dentro) { this.dest.position.copy(W(x, y, .12)); this.destVal = { x, y }; }
      this.aviso.innerHTML = dentro ? `Destino cargado: <b class="num">${par(x, y)}</b> (marca amarilla en el piso).`
        : `El destino <b class="num">${par(x, y)}</b> queda fuera del mapa: la ciudad va de −6 a 6 cuadras en cada eje.`;
      this.K.refrescarMat();
    },
    colocar(lista) { lista.forEach(([x, y], i) => this.pedidos[i].pad.position.copy(W(x, y, .1))); this.K.refrescarMat(); },
    cargar(x, y) { this.ix.value = x; this.iy.value = y; this.actualizarDestino(); },
    comprobar(K) {
      const sinUbicar = this.pedidos.filter(p => !enCiudad(p.pad));
      if (sinUbicar.length) return { ok: false, msg: `Todavía hay plataformas en la zona de carga (${sinUbicar.map(p => p.L).join(', ')}). Arrastrá cada una a la esquina de su pedido.` };
      const errores = [];
      for (const p of this.pedidos) {
        const g = aGrilla(p.pad.position);
        if (g.x === p.x && g.y === p.y) continue;
        if (g.x === p.y && g.y === p.x) errores.push(`Pedido ${p.L}: el par quedó dado vuelta. En (x; y) primero va la abscisa —cuadras hacia el este u oeste— y después la ordenada —cuadras hacia el norte o el sur—.`);
        else if (Math.abs(g.x) === Math.abs(p.x) && Math.abs(g.y) === Math.abs(p.y)) errores.push(`Pedido ${p.L}: estás a la distancia justa de cada eje, pero en otro cuadrante. Revisá los signos: x negativa queda al oeste del eje y; y negativa, al sur del eje x.`);
        else errores.push(`Pedido ${p.L}: esa esquina no es ${par(p.x, p.y)}. Contá las cuadras desde el origen: primero en la dirección del eje x, después en la del eje y.`);
      }
      if (errores.length) return { ok: false, msg: errores[0] + (errores.length > 1 ? ` <br><small>(Hay ${errores.length} plataformas para revisar.)</small>` : '') };
      const x = K.num(this.ix), y = K.num(this.iy);
      if (isNaN(x) || isNaN(y)) return { ok: false, msg: 'Las plataformas están bien. Falta cargar en la consola el punto de entrega del cliente que espera debajo del D-7.' };
      if (x === 30 || y === 30) return { ok: false, msg: 'Cliente Nº 5: 30 m es la <b>altura</b> a la que vuela el dron, no una coordenada del piso. La ordenada mide cuadras hacia el norte o el sur sobre la ciudad; la altura es una tercera medida que no entra en el par (x; y).' };
      if (x === 3 && y === -5) return { ok: true, msg: '¡Todas las entregas ubicadas! El D-7 sale del cliente Nº 5 y recorre las cuatro esquinas.' };
      if (x === -5 && y === 3) return { ok: false, msg: 'Cliente Nº 5: invertiste el orden. Primero va la abscisa (sobre el eje x) y después la ordenada (sobre el eje y).' };
      if (Math.abs(x) === 3 && Math.abs(y) === 5) return { ok: false, msg: 'Cliente Nº 5: los valores están cerca, pero el signo no. ¿El punto que está debajo del dron queda al este o al oeste del eje y? ¿Al norte o al sur del eje x?' };
      return { ok: false, msg: 'Cliente Nº 5: ese no es el punto que está debajo del dron. Seguí la línea punteada hasta el anillo del piso y leé desde ahí las dos coordenadas.' };
    },
    alResolver(K) {
      const ruta = [this.dron.position.clone(), ...this.pedidos.map(p => W(p.x, p.y, ALT))];
      this.cli.visible = true;
      volar(K, this.dron, ruta, 2.6, i => {
        const u = this.pedidos[i].pad.userData;
        u.band.material.color.set(0x3ddc97); u.et.texto('✓ ' + this.pedidos[i].L);
      });
      return 3000;
    },
    pistas: [
      'Los ejes son las dos avenidas con doble línea de color: la <b style="color:#ff8f7d">coral</b> es el eje x y la <b style="color:#7fb0ff">azul</b> es el eje y. Los números pintados en cada avenida te dicen a cuántas cuadras del origen estás.',
      'Para ubicar (x; y), salí del origen: primero recorré las cuadras de x sobre el eje x (positivo al este, negativo al oeste); desde ahí, las de y en la dirección del eje y (positivo al norte, negativo al sur).',
      'Para el cliente Nº 5, olvidate de la altura: bajá por la línea punteada hasta el anillo del piso. Desde esa esquina, seguí la calle vertical hasta el eje x (eso es x) y la calle horizontal hasta el eje y (eso es y).',
    ],
    bitacora: [
      'Contá paso a paso cómo ubicaste el pedido A en la ciudad. ¿Desde dónde arrancaste y en qué orden usaste las coordenadas?',
      '¿Por qué (−3; 4) y (4; −3) son esquinas distintas? ¿Qué te indica el signo de cada coordenada sobre el lugar?',
      'El D-7 estaba a 30 m de altura sobre el cliente Nº 5. ¿Por qué ese 30 no aparece en el par ordenado? ¿Cómo comprobaste que las coordenadas que cargaste eran las correctas?',
    ],
    resumenBitacora() { return `Ubicaste ${this.pedidos.map(p => `<b>${p.L} ${par(p.x, p.y)}</b>`).join(', ')} y programaste al D-7 para el cliente Nº 5 en <b>(3; −5)</b>, aunque el dron volaba a 30 m de altura.`; },
    mat(K, el) {
      const p = planoCiudad(K);
      p.g.append(K.s('circle', { cx: p.X(3), cy: p.Y(-5), r: 13, fill: 'rgba(34,211,197,.18)', stroke: '#0f9488', 'stroke-width': 2.5, 'stroke-dasharray': '4 3' }));
      p.g.append(K.s('text', { x: p.X(3), y: p.Y(-5) - 19, 'text-anchor': 'middle', fill: '#0f766e', 'font-weight': 700, stroke: '#fdfcf8', 'stroke-width': 4, 'paint-order': 'stroke' }, 'D-7 arriba, a 30 m'));
      if (this.destVal) p.g.append(K.s('rect', { x: p.X(this.destVal.x) - 8, y: p.Y(this.destVal.y) - 8, width: 16, height: 16, fill: '#ffd23f', stroke: '#1b2333', 'stroke-width': 1.5, transform: `rotate(45 ${p.X(this.destVal.x)} ${p.Y(this.destVal.y)})` }));
      for (const pd of this.pedidos) {
        if (!enCiudad(pd.pad)) continue;
        const g = aGrilla(pd.pad.position);
        punto(K, p, g.x, g.y, hex(pd.col), pd.L);
      }
      el.append(p.svg,
        K.h('div', { class: 'formula', html: 'Par ordenado (x; y): primero la <span style="color:#e2553f">abscisa x</span> (este–oeste), después la <span style="color:#2f6fd6">ordenada y</span> (norte–sur).' }),
        K.h('div', { class: 'nota', html: 'El dron vuela a 30 m, pero la <b>altura es una tercera medida</b>: no es la ordenada. En este plano sólo se marca el punto del piso que queda justo debajo del dron. Las plataformas aparecen acá cuando las sacás de la zona de carga.' }));
    },
    prueba: {
      mal: [
        function () { this.colocar([[4, -3], [5, -2], [-4, -1], [2, 6]]); this.cargar(3, -5); },   // A con el par invertido
        function () { this.colocar([[-3, 4], [5, -2], [-4, -1], [2, 6]]); this.cargar(3, 30); },   // la altura como ordenada
        function () { this.colocar([[-3, 4], [-5, 2], [-4, -1], [2, 6]]); this.cargar(3, -5); },   // B en el cuadrante opuesto
        function () { this.colocar([[-3, 4], [5, -2], [-4, -1], [2, 6]]); this.cargar(-5, 3); },   // cliente con el par invertido
      ],
      bien() { this.colocar([[-3, 4], [5, -2], [-4, -1], [2, 6]]); this.cargar(3, -5); },
    },
  },

  /* ─────────────────────────── NIVEL 2 ─────────────────────────── */
  {
    titulo: 'Puestos de cobertura',
    relato: 'Para que los drones no pierdan la señal, la empresa tiene dos torres: <b>T1</b> y <b>T2</b>. Hay que sumar cuatro antenas nuevas, y cada una tiene una condición sobre sus coordenadas. Cada antena cubre 2 cuadras a la redonda.',
    objetivo: 'Calculá dónde va cada antena y arrastrala desde la zona de carga hasta su esquina. Las cuatro condiciones se tienen que cumplir a la vez.',
    tituloMat: 'Red de antenas en el plano', subMat: 'Torres fijas, antenas nuevas y su cobertura',
    textoComprobar: 'Encender antenas',
    armar(K) {
      this.K = K;
      cam(K, [0, 62, 40], [0, 0, 5.5]);
      vida(K); zonaCarga(K);
      this.T = [{ n: 'T1', x: -4, y: 3 }, { n: 'T2', x: 2, y: -5 }];
      for (const t of this.T) torreFija(K, t.n, t.x, t.y);
      this.antenas = [
        { id: 'R', nombre: 'Roja', col: 0xff5d6c, x: -4, y: -3, cond: 'misma abscisa que T1 y ordenada opuesta a la de T1.' },
        { id: 'V', nombre: 'Verde', col: 0x3ddc97, x: -1, y: -1, cond: 'justo en el punto medio entre T1 y T2.' },
        { id: 'Z', nombre: 'Azul', col: 0x4c8dff, x: 3, y: -1, cond: 'en el cuadrante IV, sobre la misma calle horizontal que la verde (misma ordenada) y a 4 cuadras de ella.' },
        { id: 'M', nombre: 'Amarilla', col: 0xffc93c, x: -2, y: 5, cond: 'simétrica de T2 respecto del origen: sus dos coordenadas son las opuestas de las de T2.' },
      ];
      tablaDatos(K, this.T.map(t => [`Torre ${t.n}`, par(t.x, t.y)]));
      K.html(`<ol class="conds">${this.antenas.map(a => `<li><i style="background:${hex(a.col)}"></i><span><b>${a.nombre}:</b> ${a.cond}</span></li>`).join('')}</ol>`);
      this.antenas.forEach((a, i) => {
        const g = crearAntena(K, a.col, a.nombre); g.position.copy(POS_CARGA(i)); K.agregar(g); a.obj = g;
        K.arrastrable(g, { snap: U, limites: { x: [-24, 24], z: [-24, 24] }, alMover: () => { g.userData.cob.visible = enCiudad(g); K.refrescarMat(); } });
      });
      this.ondas = [];
    },
    colocar(lista) { lista.forEach(([x, y], i) => { const g = this.antenas[i].obj; g.position.copy(W(x, y, .1)); g.userData.cob.visible = true; }); this.K.refrescarMat(); },
    comprobar() {
      const sin = this.antenas.filter(a => !enCiudad(a.obj));
      if (sin.length) return { ok: false, msg: `Faltan antenas por ubicar: ${sin.map(a => a.nombre.toLowerCase()).join(', ')}. Arrastralas desde la zona de carga.` };
      const diag = {
        R: (x, y) => x === 4 && y === 3 ? 'Antena roja: cambiaste el signo de la abscisa. Te piden conservar la abscisa de T1 y cambiar sólo la ordenada.'
          : x === -4 && y === 3 ? 'Antena roja: quedó encima de T1. La abscisa es la misma, sí, pero la ordenada tiene que ser la opuesta.'
          : x === 4 && y === -3 ? 'Antena roja: cambiaste los dos signos. La abscisa se conserva: la antena va sobre la misma calle vertical que T1.'
          : x === -4 ? 'Antena roja: está en la calle vertical correcta (misma abscisa que T1), pero revisá la ordenada: tiene que ser la opuesta de la de T1.'
          : 'Antena roja: “misma abscisa que T1” quiere decir quedar sobre la misma calle vertical que T1. Empezá por ahí y después pensá la ordenada.',
        V: (x, y) => (x === 3 && y === -4) || (x === -3 && y === 4) ? 'Antena verde: calculaste la mitad de lo que hay que recorrer entre las torres, pero no se lo sumaste a la posición de T1. El punto medio es un lugar, no una distancia.'
          : x === -2 && y === -2 ? 'Antena verde: sumaste las coordenadas de T1 y T2, pero te faltó dividir por 2.'
          : 'Antena verde: el punto medio queda a la misma cantidad de cuadras de T1 que de T2, tanto en la dirección del eje x como en la del eje y.',
        Z: (x, y) => x === -5 && y === -1 ? 'Antena azul: está a 4 cuadras de la verde, pero cayó en el cuadrante III. En el cuadrante IV la abscisa es positiva y la ordenada, negativa.'
          : y === -1 ? 'Antena azul: la calle es la correcta (misma ordenada que la verde), pero no está a 4 cuadras de la verde. Contá las cuadras sobre esa calle.'
          : 'Antena azul: tiene que tener la misma ordenada que la verde. Ubicá primero esa calle horizontal y recorré 4 cuadras sobre ella.',
        M: (x, y) => x === 2 && y === 5 ? 'Antena amarilla: cambiaste sólo el signo de la ordenada. Simétrica respecto del origen significa que las dos coordenadas son opuestas.'
          : x === -2 && y === -5 ? 'Antena amarilla: cambiaste sólo el signo de la abscisa. Simétrica respecto del origen significa que las dos coordenadas son opuestas.'
          : (x === -5 && y === 2) || (x === 5 && y === -2) ? 'Antena amarilla: invertiste el orden de las coordenadas. Primero va la abscisa, después la ordenada.'
          : 'Antena amarilla: escribí las coordenadas de T2 y cambiale el signo a cada una. Ese par es el lugar de la antena.',
      };
      const errores = [];
      for (const a of this.antenas) { const g = aGrilla(a.obj.position); if (g.x !== a.x || g.y !== a.y) errores.push(diag[a.id](g.x, g.y)); }
      if (errores.length) return { ok: false, msg: errores[0] + (errores.length > 1 ? ` <br><small>(Hay ${errores.length} antenas para revisar.)</small>` : '') };
      return { ok: true, msg: '¡Red encendida! Las cuatro antenas cumplen sus condiciones y los drones tienen señal en todo su recorrido.' };
    },
    alResolver(K) {
      for (const a of this.antenas) {
        const o = new THREE.Mesh(new THREE.RingGeometry(.9, 1.3, 40), transp(a.col, .9)); o.rotation.x = -Math.PI / 2; o.position.copy(a.obj.position).setY(.15);
        K.agregar(sinRayo(o)); this.ondas.push(o);
      }
      let t = 0;
      K.tic(dt => { t += dt; for (const o of this.ondas) { const f = (t % 1) ; o.scale.setScalar(1 + f * 6); o.material.opacity = .9 * (1 - f); } });
      return 2600;
    },
    pistas: [
      'Anotá primero las coordenadas de T1 y T2. Después, para cada antena, preguntate qué pasa con su abscisa y qué pasa con su ordenada.',
      'Opuesto de un número: mismo valor, otro signo (el opuesto de 3 es −3). Para el punto medio, promediá por separado las abscisas de T1 y T2, y las ordenadas de T1 y T2.',
      'Para la azul: la ordenada ya la sabés (es la de la verde). Desde la verde, contá 4 cuadras hacia el este y 4 hacia el oeste sobre esa calle: quedate con la que cae en el cuadrante IV (x positiva, y negativa).',
    ],
    bitacora: [
      'Explicá cómo encontraste el punto medio entre T1 y T2. ¿Qué cálculo hiciste con las abscisas y cuál con las ordenadas?',
      '¿Qué tienen en común dos puntos con la misma abscisa? ¿Y qué cambia cuando una ordenada pasa a ser su opuesta? Usá la antena roja como ejemplo.',
      '¿Cómo podés comprobar, sólo con los pares ordenados y sin mirar la ciudad, que la antena azul está en el cuadrante IV y a 4 cuadras de la verde?',
    ],
    resumenBitacora() { return `Antenas ubicadas: ${this.antenas.map(a => `<b>${a.nombre} ${par(a.x, a.y)}</b>`).join(', ')}. Torres: T1 (−4; 3) y T2 (2; −5).`; },
    mat(K, el) {
      const p = planoCiudad(K);
      const rr = p.X(2) - p.X(0);
      const [t1, t2] = this.T;
      p.g.append(K.s('line', { x1: p.X(t1.x), y1: p.Y(t1.y), x2: p.X(t2.x), y2: p.Y(t2.y), stroke: '#64748b', 'stroke-width': 1.5, 'stroke-dasharray': '6 4' }));
      for (const a of this.antenas) {
        if (!enCiudad(a.obj)) continue;
        const g = aGrilla(a.obj.position);
        p.g.append(K.s('circle', { cx: p.X(g.x), cy: p.Y(g.y), r: rr, fill: hex(a.col), 'fill-opacity': .1, stroke: hex(a.col), 'stroke-opacity': .7, 'stroke-width': 1.5 }));
      }
      for (const t of this.T) {
        p.g.append(K.s('rect', { x: p.X(t.x) - 7, y: p.Y(t.y) - 7, width: 14, height: 14, fill: '#e24b4b', stroke: '#fff', 'stroke-width': 2 }));
        p.g.append(K.s('text', { x: p.X(t.x) + 11, y: p.Y(t.y) - 9, 'font-weight': 700, fill: '#1b2333', stroke: '#fdfcf8', 'stroke-width': 3, 'paint-order': 'stroke' }, `${t.n} ${par(t.x, t.y)}`));
      }
      for (const a of this.antenas) {
        if (!enCiudad(a.obj)) continue;
        const g = aGrilla(a.obj.position);
        punto(K, p, g.x, g.y, hex(a.col), a.nombre[0] + (a.id === 'M' ? 'm' : ''), { dy: 16, dx: 9 });
      }
      el.append(p.svg,
        K.h('div', { class: 'ley', html: this.antenas.map(a => `<span><i style="background:${hex(a.col)}"></i>${a.nombre}</span>`).join('') + '<span><i style="background:#e24b4b;border-radius:2px"></i>Torres fijas</span>' }),
        K.h('div', { class: 'nota', html: 'La línea punteada une T1 con T2. Cada círculo es la zona que cubre una antena (2 cuadras a la redonda). Las torres miden 20 m de alto, pero en el plano sólo importa dónde están apoyadas.' }));
    },
    prueba: {
      mal: [
        function () { this.colocar([[4, 3], [-1, -1], [3, -1], [-2, 5]]); },    // roja: cambia la abscisa
        function () { this.colocar([[-4, -3], [-2, -2], [3, -1], [-2, 5]]); },  // verde: suma sin dividir
        function () { this.colocar([[-4, -3], [-1, -1], [-5, -1], [-2, 5]]); }, // azul: cuadrante III
        function () { this.colocar([[-4, -3], [-1, -1], [3, -1], [2, 5]]); },   // amarilla: sólo un signo
      ],
      bien() { this.colocar([[-4, -3], [-1, -1], [3, -1], [-2, 5]]); },
    },
  },

  /* ─────────────────────────── NIVEL 3 ─────────────────────────── */
  {
    titulo: 'Consumo de batería',
    relato: 'Antes de habilitar rutas largas hay que conocer al D-7. En los vuelos de prueba (siempre a 30 m de altura) arrancó con la batería al <b>100 %</b>; a los <b>3 km</b> le quedaba <b>76 %</b> y a los <b>5 km</b>, <b>60 %</b>. La batería baja siempre lo mismo por cada kilómetro.',
    objetivo: 'Elegí las variables, completá la tabla, graficá tus pares en la pantalla de telemetría (arrastrá los 4 puntos de la bandeja) y calculá la autonomía hasta la reserva del 20 %.',
    tituloMat: 'Batería según la distancia', subMat: 'Ahora los ejes miden magnitudes, no calles',
    textoComprobar: 'Validar telemetría',
    armar(K) {
      this.K = K; this.listo = false;
      cam(K, [0, 30, 22], [0, 17.5, -38]);
      vida(K);
      const P = this.P = crearPantalla(K, { xMax: 12, yMax: 100, gx: 1, gy: 10, lx: 2, ly: 20, extraD: 3.6, tx: 'variable independiente: ?', ty: 'variable dependiente: ?', nombre: 'TELEMETRÍA D-7' });
      for (const [u, v] of [[0, 100], [3, 76], [5, 60]]) {
        const m = K.esfera(.48, 0xf8fafc, [P.aX(u), P.aY(v), P.z], { emissive: 0xffffff, emissiveIntensity: .5 }); K.agregar(m);
        K.etiqueta(par(u, v), [0, .95, 0], 'chico claro', m);
      }
      this.pts = [0, 1, 2, 3].map(i => {
        const m = K.esfera(.62, 0x22d3c5, [P.bandejaX, P.aY(18 + 21 * i), P.z], { emissive: 0x22d3c5, emissiveIntensity: .6 }); K.agregar(m);
        m.userData.et = K.etiqueta('', [0, 1, 0], 'chico dron', m); m.userData.et.visible = false;
        K.arrastrable(m, { ejes: 'xy', snap: 0, alMover: p => this.ajustar(m, p) });
        return m;
      });
      // El D-7 hace su circuito de prueba frente a la pantalla.
      const d = crearDron(K); K.agregar(d); animarDron(K, d); guiaAltura(K, d);
      K.etiqueta('D-7 · vuelo de prueba', [0, 2.3, 0], 'dron', d);
      const bat = new THREE.Group(); bat.position.y = 1.35; d.add(bat);
      bat.add(K.caja(1.9, .34, .3, 0x0f172a));
      const relleno = K.caja(1.7, .22, .34, 0x3ddc97); bat.add(relleno); this.relleno = relleno;
      this.dron = d; this.ang = 0; this.giro = true;
      K.tic(dt => { if (!this.giro) return; this.ang += dt * .22; d.position.set(Math.cos(this.ang) * 13, ALT, -25 + Math.sin(this.ang) * 4); d.rotation.y = -this.ang; });
      this.bateria(1);
      // Panel
      const V = ['dist', 'bat', 'alt'], etq = [['dist', 'Distancia (km)'], ['bat', 'Batería (%)'], ['alt', 'Altura (m)']];
      this.V = V;
      this.gInd = K.opciones('Variable independiente', etq, { alElegir: () => this.cambioVar() });
      this.gDep = K.opciones('Variable dependiente', etq, { alElegir: () => this.cambioVar() });
      this.ins = [2, 4, 6, 8].map(d => K.h('input', { class: 'entrada', type: 'number', step: 'any', 'aria-label': `batería con ${d} km` }));
      K.controles().append(K.h('div', { class: 'campo' }, K.h('label', {}, 'Tabla de la batería según la distancia'),
        K.h('table', { class: 'tabla' },
          K.h('tr', {}, K.h('th', {}, 'd (km)'), [2, 4, 6, 8].map(d => K.h('td', {}, String(d)))),
          K.h('tr', {}, K.h('th', {}, 'B (%)'), this.ins.map(i => K.h('td', {}, i))))));
      this.iAuto = K.campoNumero('Autonomía: ¿cuántos km puede recorrer hasta que la batería llegue a la reserva del 20 %?', { id: 'autonomia', sufijo: 'km' });
      for (const i of [...this.ins, this.iAuto]) i.addEventListener('input', () => K.refrescarMat());
    },
    bateria(f) {
      this.relleno.scale.x = Math.max(.001, f); this.relleno.position.x = -.85 + .85 * f;
      this.relleno.material.color.setHSL(.33 * Math.max(0, (f - .1) / .9), .7, .5);
    },
    cambioVar() {
      const n = (g, txt) => g.valor ? VARS[g.valor] : txt;
      this.P.titulos(n(this.gInd, 'variable independiente: ?'), n(this.gDep, 'variable dependiente: ?'));
      this.K.refrescarMat();
    },
    ajustar(m, p) {
      const P = this.P;
      const u = Math.max(0, Math.min(12, Math.round(P.deX(p.x))));
      const v = Math.max(0, Math.min(100, Math.round(P.deY(p.y) / 2) * 2));
      this.ponerPunto(m, u, v);
    },
    ponerPunto(m, u, v) {
      m.position.set(this.P.aX(u), this.P.aY(v), this.P.z);
      Object.assign(m.userData, { u, v, puesto: true });
      m.userData.et.visible = true; m.userData.et.texto(par(u, v));
      this.K.refrescarMat();
    },
    llenar({ ind = 'dist', dep = 'bat', tabla = BAT_OK, pts = [[2, 84], [4, 68], [6, 52], [8, 36]], auto = 10 } = {}) {
      elegir(this.gInd, this.V, ind); elegir(this.gDep, this.V, dep);
      tabla.forEach((v, i) => { this.ins[i].value = v; });
      pts.forEach(([u, v], i) => this.ponerPunto(this.pts[i], u, v));
      this.iAuto.value = auto; this.K.refrescarMat();
    },
    comprobar(K) {
      const ind = this.gInd.valor, dep = this.gDep.valor;
      if (!ind || !dep) return { ok: false, msg: 'Primero elegí cuál es la variable independiente y cuál la dependiente.' };
      if (ind === 'alt' || dep === 'alt') return { ok: false, msg: 'La altura de vuelo se mantiene en 30 m durante todo el recorrido: no cambia, así que no es una de las variables de esta relación. Y ojo: en este gráfico el eje vertical no es la altura del dron.' };
      if (ind === dep) return { ok: false, msg: 'Elegiste la misma magnitud para las dos variables. En una relación hay una magnitud que cambia libremente y otra que cambia según ella.' };
      if (ind === 'bat') return { ok: false, msg: 'Las variables quedaron invertidas. Preguntate qué depende de qué: ¿la batería baja porque el dron recorre kilómetros, o el dron recorre kilómetros porque baja la batería?' };
      const vals = this.ins.map(i => K.num(i));
      if (vals.some(isNaN)) return { ok: false, msg: 'Completá la tabla: falta la batería para alguna de las distancias.' };
      if (!vals.every((v, i) => v === BAT_OK[i])) {
        if (vals.every((v, i) => v === 100 - 16 * 2 * (i + 1))) return { ok: false, msg: 'Revisá la tabla: entre los 3 km y los 5 km la batería bajó 16 puntos, pero en 2 km, no en 1. ¿Cuánto baja en cada kilómetro?' };
        if (vals[3] > vals[0]) return { ok: false, msg: 'En tu tabla la batería sube a medida que el dron recorre más kilómetros. Tiene que bajar.' };
        return { ok: false, msg: 'Revisá la tabla: la batería baja siempre la misma cantidad por cada kilómetro. Calculá esa cantidad con los datos de los vuelos de prueba y restala desde el 100 %.' };
      }
      const puestos = this.pts.filter(m => m.userData.puesto);
      if (puestos.length < 4) return { ok: false, msg: 'La tabla está bien. Ahora graficá: arrastrá los 4 puntos de la bandeja a la pantalla, uno por cada columna de tu tabla.' };
      const pares = this.pts.map(m => [m.userData.u, m.userData.v]);
      const faltan = [2, 4, 6, 8].filter((d, i) => !pares.some(([u, v]) => u === d && v === BAT_OK[i]));
      if (faltan.length) {
        const d = faltan[0], conD = pares.find(([u]) => u === d);
        if (conD) return { ok: false, msg: `Revisá el punto que pusiste en d = ${d} km: su segunda coordenada tiene que ser la batería que calculaste en la tabla para esa distancia.` };
        return { ok: false, msg: `No hay ningún punto para d = ${d} km. Cada columna de la tabla es un par (d; B): la distancia se ubica en el eje horizontal y la batería, en el vertical.` };
      }
      const a = K.num(this.iAuto);
      if (isNaN(a)) return { ok: false, msg: 'Tabla y gráfico, perfectos. Falta la autonomía hasta la reserva del 20 %.' };
      if (a === 12.5) return { ok: false, msg: 'Esa es la distancia hasta que la batería llega a 0 %. El D-7 tiene que aterrizar con la reserva del 20 %.' };
      if (a !== 10) return { ok: false, msg: 'Revisá la autonomía: ¿cuántos puntos de batería puede gastar el dron desde 100 % hasta 20 %? ¿Cuántos kilómetros son, si en cada uno gasta lo mismo?' };
      return { ok: true, msg: '¡Telemetría validada! El D-7 pierde 8 % por kilómetro y puede volar 10 km antes de usar la reserva.' };
    },
    alResolver(K) {
      const P = this.P;
      this.listo = true; this.giro = false;
      const traza = segmento(K, 0xffd23f, .14); K.agregar(traza);
      const cab = K.esfera(.45, 0xffd23f, [P.aX(0), P.aY(100), P.z + .1], { emissive: 0xffd23f, emissiveIntensity: .9 }); K.agregar(cab);
      const et = K.etiqueta('', [0, 1, 0], 'chico acento', cab);
      const ini = this.dron.position.clone();
      const ruta = [ini, W(-4, -6.5, ALT), W(4, -6.5, ALT), W(4, -5.5, ALT), W(-4, -5.5, ALT)];
      volar(K, this.dron, ruta, 2.7, null, f => {
        const u = 10 * f, b = 100 - 8 * u;
        const a = new THREE.Vector3(P.aX(0), P.aY(100), P.z + .05), z = new THREE.Vector3(P.aX(u), P.aY(b), P.z + .05);
        traza.poner(a, z); cab.position.copy(z);
        et.texto(`${K.fmt(u, 1)} km · ${K.fmt(b, 0)} %`); this.bateria(b / 100);
      });
      K.refrescarMat();
      return 3000;
    },
    pistas: [
      'Preguntate: ¿qué magnitud cambia <i>porque</i> cambia la otra? La que avanza libremente es la independiente; la que responde a ella es la dependiente. ¿Hay alguna magnitud que ni siquiera cambie?',
      'Entre los 3 km y los 5 km el dron recorrió 2 km. ¿Cuánto bajó la batería en ese tramo? Con eso averiguás cuánto baja por cada kilómetro.',
      'Para cada distancia d, la batería es 100 menos (lo que baja por km) × d. Para la autonomía: del 100 % al 20 % el dron puede gastar cierta cantidad de puntos; dividila por lo que gasta en cada km.',
    ],
    bitacora: [
      '¿Cuál es la variable independiente y cuál la dependiente en esta situación? ¿Por qué la altura de vuelo no es ninguna de las dos?',
      '¿Cómo calculaste cuánto baja la batería por kilómetro? Mostrá la cuenta con los datos de los vuelos de prueba y cómo la usaste para completar la tabla.',
      '¿Qué significa el punto (6; 52) del gráfico? ¿En qué se diferencia de un punto como (−3; 4) del nivel 1? ¿Cómo comprobaste la autonomía?',
    ],
    resumenBitacora() { return 'Variables: <b>distancia recorrida</b> (independiente) y <b>batería restante</b> (dependiente). Tabla: 2 km → 84 %, 4 km → 68 %, 6 km → 52 %, 8 km → 36 %. Autonomía hasta la reserva del 20 %: <b>10 km</b>.'; },
    mat(K, el) {
      const n = (g, t) => g?.valor ? VARS[g.valor] : t;
      const p = planoMag(K, { xMax: 12, yMax: 100, gx: 1, gy: 10, lx: 2, ly: 20, tx: n(this.gInd, 'variable independiente: ?') + ' →', ty: '↑ ' + n(this.gDep, 'variable dependiente: ?') });
      p.g.append(K.s('line', { x1: p.X(0), x2: p.X(12), y1: p.Y(20), y2: p.Y(20), stroke: '#ef4444', 'stroke-dasharray': '5 4', 'stroke-width': 1.3 }));
      p.g.append(K.s('text', { x: p.X(12), y: p.Y(20) - 5, 'text-anchor': 'end', fill: '#b91c1c', 'font-size': 10.5 }, 'reserva 20 %'));
      if (this.listo) {
        p.g.append(K.s('line', { x1: p.X(0), y1: p.Y(100), x2: p.X(12), y2: p.Y(4), stroke: '#d4a017', 'stroke-width': 2.5 }));
        p.g.append(K.s('line', { x1: p.X(10), y1: p.Y(0), x2: p.X(10), y2: p.Y(20), stroke: '#d4a017', 'stroke-dasharray': '4 3' }));
      }
      for (const [u, v] of [[0, 100], [3, 76], [5, 60]]) punto(K, p, u, v, '#94a3b8', par(u, v), { r: 6 });
      for (const m of this.pts) if (m.userData.puesto) punto(K, p, m.userData.u, m.userData.v, '#14b8a6', null, { r: 7 });
      const vals = this.ins.map(i => i.value === '' ? '…' : i.value);
      el.append(p.svg,
        K.h('div', { class: 'ley', html: '<span><i style="background:#94a3b8"></i>datos de los vuelos de prueba</span><span><i style="background:#14b8a6"></i>tus puntos</span>' }),
        K.h('div', { class: 'fila-mat' },
          K.h('table', { class: 'tabla-mat', html: `<tr><th>d (km)</th><td>0</td><td>2</td><td>4</td><td>6</td><td>8</td></tr><tr><th>B (%)</th><td>100</td>${vals.map(v => `<td>${v}</td>`).join('')}</tr>` }),
          this.listo ? K.h('div', { class: 'formula', html: 'B = 100 − 8 · d' }) : null),
        K.h('div', { class: 'nota', html: 'Cada punto es un par <b>(d; B)</b>: no marca un lugar de la ciudad, sino cuánta batería queda después de recorrer cierta distancia. Mismo plano cartesiano, otro significado para los ejes.' }));
    },
    prueba: {
      mal: [
        function () { this.llenar({ ind: 'bat', dep: 'dist' }); },                     // variables invertidas
        function () { this.llenar({ ind: 'dist', dep: 'alt' }); },                     // la altura como variable
        function () { this.llenar({ tabla: [68, 36, 4, -28] }); },                    // 16 % por km
        function () { this.llenar({ pts: [[2, 84], [4, 68], [6, 52], [8, 40]] }); },  // un punto mal graficado
        function () { this.llenar({ auto: 12.5 }); },                                  // hasta 0 %, sin reserva
      ],
      bien() { this.llenar(); },
    },
  },

  /* ─────────────────────────── NIVEL 4 ─────────────────────────── */
  {
    titulo: 'Costo del servicio',
    relato: 'Drone City Express ofrece dos tarifas. <b style="color:#ffb454">Tarifa A</b>: $600 fijos más $40 por cuadra. <b style="color:#c4a8ff">Tarifa B</b>: $100 por cuadra, sin costo fijo. Por reglamento, los drones vuelan siguiendo las calles (a 30 m de altura: la altura no se cobra). Los paquetes de más de 5 kg pagan además un recargo fijo de $150.',
    objetivo: 'Armá en la pantalla las rectas de las dos tarifas (arrastrá sus extremos), encontrá el punto de equilibrio, asigná a cada cliente la tarifa más barata y calculá el costo total del envío al Hospital Sur.',
    tituloMat: 'Costo según la distancia', subMat: 'Dos tarifas, dos rectas',
    textoComprobar: 'Confirmar tarifas',
    armar(K) {
      this.K = K; this.listo = false;
      this.camPantalla = () => cam(K, [0, 30, 22], [0, 17.5, -38]);
      this.camCiudad = () => cam(K, [0, 62, 40], [0, 0, 5.5]);
      this.camPantalla();
      vida(K);
      const P = this.P = crearPantalla(K, { xMax: 12, yMax: 1400, gx: 1, gy: 100, lx: 2, ly: 200, tx: 'distancia recorrida (cuadras) →', ty: '↑ costo del envío ($)', nombre: 'TARIFAS' });
      this.lA = K.agregar(segmento(K, 0xff9f1c)); this.lB = K.agregar(segmento(K, 0xa47bff));
      const mk = (col, u, v, lado) => {
        const m = K.esfera(.65, col, [P.aX(u), P.aY(v), P.z], { emissive: col, emissiveIntensity: .5 }); K.agregar(m);
        m.userData = { u, v, et: K.etiqueta('', lado < 0 ? [2.3, .95, 0] : [2.3, 0, 0], 'chico', m) };
        m.userData.et.element.style.background = hex(col); m.userData.et.element.style.color = '#0f1b2d';
        K.arrastrable(m, { ejes: 'y', plano: new THREE.Vector3(0, 0, 1), snap: 0, alMover: p => this.ponerManija(m, Math.max(0, Math.min(1400, Math.round(P.deY(p.y) / 20) * 20))) });
        return m;
      };
      this.H = { A0: mk(0xff9f1c, 0, 200, -1), A12: mk(0xff9f1c, 12, 200, 1), B0: mk(0xa47bff, 0, 400, -1), B12: mk(0xa47bff, 12, 400, 1) };
      this.cruce = K.esfera(.5, 0xffffff, [0, 0, P.z + .1], { emissive: 0xffffff, emissiveIntensity: .8 }); K.agregar(sinRayo(this.cruce));
      K.tic((dt, t) => this.cruce.scale.setScalar(1 + Math.sin(t * 5) * .2));
      for (const k in this.H) this.ponerManija(this.H[k], this.H[k].userData.v);
      // Hangar y clientes
      const d = crearDron(K); d.position.copy(W(0, 0, ALT)); K.agregar(d); animarDron(K, d); guiaAltura(K, d, '30 m (no se cobra)');
      K.etiqueta('D-7 · hangar (0; 0)', [0, 1.4, 0], 'dron', d); this.dron = d;
      this.clientes = [
        { nombre: 'Farmacia Norte', x: 2, y: 5, kg: 1, ok: 'B' },
        { nombre: 'Escuela 14', x: -6, y: 6, kg: 3, ok: 'A' },
        { nombre: 'Club Atlético', x: -4, y: -2, kg: 4, ok: 'B' },
        { nombre: 'Hospital Sur', x: 5, y: -6, kg: 8, ok: 'A' },
      ];
      // Panel
      this.gCam = K.opciones('Cámara', [['pantalla', 'Pantalla de tarifas'], ['ciudad', 'Ciudad y clientes']], { elegida: 'pantalla', alElegir: v => (v === 'pantalla' ? this.camPantalla() : this.camCiudad()) });
      [this.eqC, this.eqP] = campoPar(K, 'Punto de equilibrio: (cuadras; costo en $)', 'eq', ['c', '$']);
      K.html('<div class="sub-t">Tarifa para cada cliente</div><p class="nota-p">Elegila acá o tocando la columna de luz del cliente en la ciudad.</p>');
      this.clientes.forEach((c, i) => {
        const base = W(c.x, c.y);
        const pilar = new THREE.Mesh(new THREE.CylinderGeometry(.8, .8, 8, 16, 1, true), transp(0xdff7ff, .42)); pilar.position.copy(base).setY(4); K.agregar(pilar);
        const pad = K.cilindro(1.15, 1.25, .22, 0xffffff, base.clone().setY(.11).toArray(), 20); K.agregar(pad);
        c.pilar = pilar; c.pad = pad;
        c.et = K.etiqueta(`${c.nombre} · ?`, base.clone().setY(8.8).toArray(), 'cliente');
        c.grupo = K.opciones(`${c.nombre} ${par(c.x, c.y)} · paquete de ${c.kg} kg`, [['A', 'Tarifa A'], ['B', 'Tarifa B']], { alElegir: v => this.asignar(i, v) });
        K.clicable(pilar, () => elegir(c.grupo, ['A', 'B'], c.grupo.valor === 'A' ? 'B' : 'A'));
      });
      this.iHosp = K.campoNumero('Costo total del envío al Hospital Sur (con la tarifa que le conviene)', { id: 'hosp', sufijo: '$' });
      for (const i of [this.eqC, this.eqP, this.iHosp]) i.addEventListener('input', () => K.refrescarMat());
    },
    ponerManija(m, v) {
      const P = this.P;
      m.userData.v = v; m.position.set(P.aX(m.userData.u), P.aY(v), P.z);
      m.userData.et.texto('$' + v);
      const { A0, A12, B0, B12 } = this.H;
      if (!A12 || !B12) return;
      const pt = (u, vv) => new THREE.Vector3(P.aX(u), P.aY(vv), P.z - .05);
      this.lA.poner(pt(0, A0.userData.v), pt(12, A12.userData.v));
      this.lB.poner(pt(0, B0.userData.v), pt(12, B12.userData.v));
      const c = this.interseccion();
      this.cruce.visible = !!c;
      if (c) this.cruce.position.set(P.aX(c.u), P.aY(c.v), P.z + .1);
      this.K.refrescarMat();
    },
    interseccion() {
      const a0 = this.H.A0.userData.v, a1 = this.H.A12.userData.v, b0 = this.H.B0.userData.v, b1 = this.H.B12.userData.v;
      const den = (a1 - a0) - (b1 - b0);
      if (den === 0) return null;
      const u = 12 * (b0 - a0) / den;
      if (u < 0 || u > 12) return null;
      return { u, v: a0 + (a1 - a0) * u / 12 };
    },
    asignar(i, v) {
      const c = this.clientes[i], col = v === 'A' ? 0xff9f1c : 0xa47bff;
      c.pilar.material.color.set(col); c.pilar.material.opacity = .55; c.pad.material.color.set(col);
      c.et.texto(`${c.nombre} · tarifa ${v}`);
      this.K.refrescarMat();
    },
    llenar({ rectas = [600, 1080, 0, 1200], eq = [10, 1000], planes = ['B', 'A', 'B', 'A'], hosp = 1190 } = {}) {
      ['A0', 'A12', 'B0', 'B12'].forEach((k, i) => this.ponerManija(this.H[k], rectas[i]));
      this.eqC.value = eq[0]; this.eqP.value = eq[1];
      planes.forEach((v, i) => elegir(this.clientes[i].grupo, ['A', 'B'], v));
      this.iHosp.value = hosp; this.K.refrescarMat();
    },
    comprobar(K) {
      const [a0, a1, b0, b1] = ['A0', 'A12', 'B0', 'B12'].map(k => this.H[k].userData.v);
      if (!(a0 === 600 && a1 === 1080 && b0 === 0 && b1 === 1200)) {
        if (a0 === 0 && a1 === 1200 && b0 === 600 && b1 === 1080) return { ok: false, msg: 'Armaste las rectas cambiadas: la naranja es la tarifa A y la violeta, la tarifa B.' };
        if (a0 === 0) return { ok: false, msg: 'La recta A arranca en $0: te olvidaste del costo fijo. Con la tarifa A se pagan $600 aunque el dron no recorra ninguna cuadra.' };
        if (a0 !== 600) return { ok: false, msg: 'Revisá el extremo izquierdo de la recta A: con 0 cuadras recorridas, ¿cuánto se paga con esa tarifa?' };
        if (a1 === 640) return { ok: false, msg: 'Recta A: para 12 cuadras sumaste $40 una sola vez. Se cobran $40 por cada una de las 12 cuadras.' };
        if (a1 === 480) return { ok: false, msg: 'Recta A: $480 es lo que se cobra por las 12 cuadras, pero falta sumar el costo fijo.' };
        if (a1 !== 1080) return { ok: false, msg: 'Revisá el extremo derecho de la recta A: calculá el costo de un envío de 12 cuadras con la tarifa A.' };
        if (b0 !== 0) return { ok: false, msg: 'La tarifa B no tiene costo fijo: si el dron recorre 0 cuadras, ¿cuánto se paga?' };
        return { ok: false, msg: 'Revisá el extremo derecho de la recta B: calculá el costo de un envío de 12 cuadras con la tarifa B.' };
      }
      const ec = K.num(this.eqC), ep = K.num(this.eqP);
      if (isNaN(ec) || isNaN(ep)) return { ok: false, msg: 'Las rectas están bien. Ahora cargá el punto de equilibrio, donde se cruzan: (cuadras; costo).' };
      if (ec === 1000 && ep === 10) return { ok: false, msg: 'Invertiste el par: primero va la distancia (eje horizontal, la variable independiente) y después el costo (eje vertical).' };
      if (ec === 10 && ep !== 1000) return { ok: false, msg: 'La distancia del cruce es correcta, pero revisá el costo: calculalo con cualquiera de las dos tarifas para esa cantidad de cuadras (tienen que dar lo mismo).' };
      if (ec !== 10) return { ok: false, msg: 'Ese no es el punto donde se cruzan las rectas. Buscá la distancia en la que las dos tarifas cobran exactamente lo mismo y verificala con las cuentas.' };
      const el = this.clientes.map(c => c.grupo.valor), ok = this.clientes.map(c => c.ok);
      if (el.some(v => !v)) return { ok: false, msg: 'Falta asignar una tarifa a algún cliente. Tocá su columna de luz en la ciudad o usá los botones del panel.' };
      if (!el.every((v, i) => v === ok[i])) {
        if (el.every(v => v === 'B')) return { ok: false, msg: 'Elegiste la tarifa B para todos. Es la más barata en recorridos cortos, pero después del cruce de las rectas, ¿cuál queda más abajo? Y acordate: las cuadras se cuentan siempre positivas, aunque el dron vaya hacia el oeste o hacia el sur.' };
        if (el.every(v => v === 'A')) return { ok: false, msg: 'Elegiste la tarifa A para todos. Con su costo fijo, en los recorridos cortos, ¿qué recta queda más abajo?' };
        if (el.every((v, i) => v !== ok[i])) return { ok: false, msg: 'Elegiste justo al revés en todos los casos. Antes del punto de equilibrio, ¿qué recta está más abajo? ¿Y después?' };
        const c = this.clientes[el.findIndex((v, i) => v !== ok[i])];
        return { ok: false, msg: `Revisá ${c.nombre}: contá las cuadras que recorre el dron desde el hangar (0; 0) siguiendo las calles y ubicá esa distancia en el eje horizontal del gráfico. ¿Qué recta queda más abajo ahí?` };
      }
      const h = K.num(this.iHosp);
      if (isNaN(h)) return { ok: false, msg: 'Tarifas asignadas. Falta el costo total del envío al Hospital Sur.' };
      if (h === 1040) return { ok: false, msg: 'Hospital Sur: el costo por distancia está bien, pero te faltó el recargo. Ese paquete pesa 8 kg.' };
      if (h === 1250 || h === 1100) return { ok: false, msg: 'Hospital Sur: hiciste la cuenta con la tarifa B, que no es la que le conviene.' };
      if (h !== 1190) return { ok: false, msg: 'Hospital Sur: revisá la cuenta. Cuadras desde el hangar → costo con la tarifa elegida → recargo por peso, si corresponde.' };
      return { ok: true, msg: '¡Tarifas configuradas! Cada cliente recibe su paquete con la tarifa más barata.' };
    },
    alResolver(K) {
      this.listo = true;
      elegir(this.gCam, ['pantalla', 'ciudad'], 'ciudad');
      this.clientes.forEach((c, i) => {
        const col = c.ok === 'A' ? 0xff9f1c : 0xa47bff;
        const t1 = K.agregar(segmento(K, col, .22)), t2 = K.agregar(segmento(K, col, .22));
        const o = W(0, 0, .35 + i * .04), m = W(c.x, 0, .35 + i * .04), f = W(c.x, c.y, .35 + i * .04);
        let t = 0;
        K.tic(dt => {
          t = Math.min(1, t + dt / 2.2);
          const s = t * (Math.abs(c.x) + Math.abs(c.y)), sx = Math.min(s, Math.abs(c.x));
          const pm = o.clone().lerp(m, Math.abs(c.x) ? sx / Math.abs(c.x) : 1);
          t1.poner(o, pm);
          const sy = Math.max(0, s - Math.abs(c.x));
          t2.poner(m, m.clone().lerp(f, Math.abs(c.y) ? sy / Math.abs(c.y) : 1));
          if (s <= Math.abs(c.x)) t2.visible = false;
        });
      });
      const h = this.clientes[3];
      volar(K, this.dron, [this.dron.position.clone(), W(h.x, 0, ALT), W(h.x, h.y, ALT)], 2.4);
      K.refrescarMat();
      return 3000;
    },
    pistas: [
      'Cada recta necesita dos puntos: cuánto cuesta un envío de 0 cuadras y cuánto uno de 12 cuadras, con cada tarifa. Las etiquetas de los extremos te muestran el valor en pesos.',
      'Costo con la tarifa A = 600 + 40 × cuadras; con la tarifa B = 100 × cuadras. El cruce de las rectas es la distancia en la que las dos cobran lo mismo: leelo en la pantalla y verificalo con las dos cuentas.',
      'Las cuadras desde el hangar (0; 0) hasta un cliente (x; y), por las calles, son las cuadras en dirección x más las cuadras en dirección y, contadas sin signo. Compará ese número con la distancia del punto de equilibrio.',
    ],
    bitacora: [
      '¿Cómo construiste cada recta? ¿Qué representa, en la situación, el punto donde la recta A corta al eje vertical?',
      '¿Qué significa el punto donde se cruzan las dos rectas? ¿Cómo lo usaste para decidir la tarifa de cada cliente?',
      '¿Cómo calculaste las cuadras desde el hangar hasta cada cliente? Comprobá con una cuenta completa el costo del envío al Hospital Sur.',
    ],
    resumenBitacora() { return 'Tarifa A: <b>C = 600 + 40 · c</b>. Tarifa B: <b>C = 100 · c</b>. Equilibrio: <b>(10; 1000)</b>. Farmacia Norte (7 cuadras) → B · Escuela 14 (12) → A · Club Atlético (6) → B · Hospital Sur (11) → A: $1040 + $150 de recargo = <b>$1190</b>.'; },
    mat(K, el) {
      if (!this.clientes?.[3]?.grupo) return;  // todavía armando el nivel
      const p = planoMag(K, { xMax: 12, yMax: 1400, gx: 1, gy: 100, lx: 2, ly: 200, tx: 'distancia recorrida (cuadras) →', ty: '↑ costo del envío ($)' });
      const v = k => this.H[k].userData.v;
      p.g.append(K.s('line', { x1: p.X(0), y1: p.Y(v('A0')), x2: p.X(12), y2: p.Y(v('A12')), stroke: '#f08c00', 'stroke-width': 3 }));
      p.g.append(K.s('line', { x1: p.X(0), y1: p.Y(v('B0')), x2: p.X(12), y2: p.Y(v('B12')), stroke: '#8b5cf6', 'stroke-width': 3 }));
      for (const [k, col] of [['A0', '#f08c00'], ['A12', '#f08c00'], ['B0', '#8b5cf6'], ['B12', '#8b5cf6']]) {
        const u = k.endsWith('12') ? 12 : 0;
        const otro = (k[0] === 'A' ? 'B' : 'A') + k.slice(1), arriba = v(k) >= v(otro);
        punto(K, p, u, v(k), col, '$' + v(k), { r: 5, dx: u ? -8 : 8, ancla: u ? 'end' : 'start', dy: arriba ? -9 : 17 });
      }
      const c = this.interseccion();
      if (c) p.g.append(K.s('circle', { cx: p.X(c.u), cy: p.Y(c.v), r: 7, fill: '#fff', stroke: '#1b2333', 'stroke-width': 2.5 }));
      if (this.listo) p.g.append(K.s('text', { x: p.X(10), y: p.Y(1000) - 14, 'text-anchor': 'middle', 'font-weight': 700, fill: '#1b2333' }, '(10; 1000)'));
      const filas = this.clientes.map(cl => `<tr><td style="text-align:left">${cl.nombre}</td><td>${par(cl.x, cl.y)}</td><td>${cl.kg} kg</td><td>${cl.grupo.valor || '–'}</td></tr>`).join('');
      el.append(p.svg,
        K.h('div', { class: 'fila-mat' },
          K.h('div', { class: 'formula', html: '<span style="color:#f08c00">A: C = 600 + 40 · c</span><br><span style="color:#8b5cf6">B: C = 100 · c</span>' }),
          K.h('table', { class: 'tabla-mat', html: `<tr><th>Cliente</th><th>(x; y)</th><th>peso</th><th>tarifa</th></tr>${filas}` })),
        K.h('div', { class: 'nota', html: 'c = cuadras recorridas desde el hangar (0; 0) por las calles; C = costo en pesos. Cada punto del gráfico es un par (c; C). Recargo de $150 para paquetes de más de 5 kg.' }));
    },
    prueba: {
      mal: [
        function () { this.llenar({ rectas: [0, 480, 0, 1200] }); },        // recta A sin costo fijo
        function () { this.llenar({ eq: [1000, 10] }); },                     // par de equilibrio invertido
        function () { this.llenar({ planes: ['B', 'B', 'B', 'B'] }); },       // B para todos (cuadras con signo)
        function () { this.llenar({ hosp: 1040 }); },                         // sin recargo por peso
      ],
      bien() { this.llenar(); },
    },
  },
  ],
};
iniciar(JUEGO);
</script>
</body>
</html>
$kodu$, 'a59ea305-7e4b-4374-8039-2236dd0f5a88', now(), now());
INSERT INTO "ChatThread" (id, title, "projectId", "createdAt") VALUES ('ff19351e-4a9a-4fdb-93b5-b2bdbf306ed6', 'Conversación', '6f83abd0-4088-4211-874c-333de6c7d436', now());
COMMIT;
SELECT id, title, slug, length("currentHtml") AS largo FROM "Project" WHERE id = '6f83abd0-4088-4211-874c-333de6c7d436';
