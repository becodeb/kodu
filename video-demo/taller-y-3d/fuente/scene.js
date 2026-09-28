// Kodu · demo de producto. Todo es función pura de t (segundos): render(t) pinta el cuadro.
'use strict';
const $ = (id) => document.getElementById(id);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const P = (t, a, b) => clamp((t - a) / (b - a));
const eo = (x) => 1 - Math.pow(1 - x, 3);
const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const spr = (x) => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const w = 8.5;
  return (1 - (1 + w * x) * Math.exp(-w * x)) / (1 - (1 + w) * Math.exp(-w));
};
const lerp = (a, b, x) => a + (b - a) * x;
const DUR = 56.0;

// ───────────────────────── guion ─────────────────────────
const MSG_U1 = 'Quiero un modelo 3D de las partículas del agua para 2.º año: que con la temperatura pasen de sólido a líquido y a gas, y que se pueda girar.';
const TTYPE = 'Estados del agua, en 2.º año';
const MSG_U2 = 'Sumá un mechero y un gráfico de la temperatura.';
const MSG_A1 = [['Listo: un frasco con '], ['moléculas de agua en 3D', 1], ['. Con la temperatura pasan de sólido a líquido y a gas.']];
const MSG_A2 = [['Hecho: sumé '], ['un mechero y el gráfico', 1], ['. Mientras cambia de estado, la temperatura no sube: son las mesetas.']];

const T = {
  lightIn: [0.6, 2.0], kIn: 0.9, starIn: 2.0, blinks: [3.0, 3.5], kOut: 4.4,
  noteIn: 4.55, lines: [5.05, 5.4, 5.75, 6.05], strikes: [6.5, 6.75], hls: [7.2, 7.4],
  morph1: 8.0,
  // Taller de ideas
  door: 9.5, tses: 9.55, tClick: 10.6, tType: [10.7, 11.2], chip1: 11.5, chip2: 12.0, tSend: 12.5,
  think1: [12.75, 14.0], fichaA: 13.6, ideas: 14.0, elegir: 15.5, think2: [15.7, 16.3], fichaB: 16.3,
  fScroll: [16.9, 17.45], armar: 18.0, pedido: 18.25, fBack: [18.1, 18.55], crear: 19.5, toEditor: 19.9,
  // editor
  send1: 21.5,
  st1: [[22.0, 'Pensando cómo resolverlo'], [23.0, 'Armando el recurso'], [24.0, 'Probando el recurso…']],
  genEnd: 25.0, a1: 25.0,
  drag: [27.0, 27.8], rot: [28.6, 29.5],
  click2: 31.0, type2: [31.1, 32.5], send2: 33.0,
  st2: [[33.2, 'Pensando cómo resolverlo'], [33.5, 'Armando el recurso']],
  v2: 33.8, mechero: 35.0,
  code: 38.5, copyUrl: 39.5,
  phoneIn: 40.0, phoneLoad: 40.3, phoneOut: 42.4,
  publish: 43.5, navGal: 44.5, like: 46.0, scroll1: [46.4, 47.4], like2: 48.0, scroll2: [48.4, 49.5],
  morph2: 51.0, wm: 52.2, tag: 53.2, blackIn: [54.8, 55.85],
};

const COPIES = [
  [5.0, 6.95, [['Para crearlo,'], ['hay que programar.', 1]]],
  [7.0, 8.35, [['Con Kodu,'], ['se conversa.', 1]]],
  [8.5, 13.9, [['Primero,'], ['pensalo con Kodu.', 1]]],
  [14.0, 16.9, [['Te propone'], ['ideas.', 1]]],
  [17.0, 19.85, [['Y arma'], ['el pedido.', 1]]],
  [20.0, 22.75, [['Kodu'], ['programa.', 1]]],
  [22.85, 25.35, [['En'], ['segundos.', 1]]],
  [25.5, 30.3, [['Lo'], ['probás.', 1]]],
  [30.5, 37.95, [['Lo'], ['ajustás.', 1]]],
  [38.0, 39.45, [['Sin tocar'], ['el código.', 1]]],
  [39.5, 42.85, [['Un link,'], ['al aula.', 1]]],
  [43.0, 50.9, [['Compartido'], ['entre colegas.', 1]]],
];

// ───────────────────────── eventos de audio ─────────────────────────
const EVENTS = [];
const ev = (t, k) => EVENTS.push({ t: +t.toFixed(4), k });
const CLICKS = [];
function click(t, target) {
  CLICKS.push({ t, target });
  ev(t, 'click');
}

// ───────────────────────── geometría ─────────────────────────
const R_NOTE = { x: 580, y: 400, w: 760, h: 540, r: 16 };
const R_WIN = { x: 150, y: 196, w: 1620, h: 864, r: 22 };
const R_ICON = { x: 960 - 120, y: 470 - 120, w: 240, h: 240, r: 56 };
const WM = { w: 600 };
WM.s = WM.w / 932;
WM.h = 357 * WM.s;
WM.x = 960 - WM.w / 2;
WM.y = 470 - WM.h / 2;

let M = {}; // medidas en coordenadas de layout

function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}

// ───────────────────────── recurso 3D (public/demos/estados-del-agua.html, en iframes) ─────────────────────────
const FR_ACTS = {
  fr1: { load: 23.0, acts: [
    { t: 19.0 - 15.0, t1: 19.8 - 15.0, tipo: 'arrastrarTemp', de: 20, a: 110 },
    { t: 20.6 - 15.0, t1: 21.5 - 15.0, tipo: 'girar', rad: -2.4 },
  ] },
  fr2: { load: 33.8, acts: [{ t: 35.0 - 33.8, tipo: 'mechero' }] },
  frP: { load: 40.3, acts: [{ t: 0.55, tipo: 'mechero' }] },
};

// ───────────────────────── contenido estático ─────────────────────────
const CODE = [
  [['c', '// 64 moléculas: un oxígeno y dos hidrógenos cada una']],
  [['k', 'const '], ['v', 'oxi '], ['k', '= new '], ['f', 'THREE.InstancedMesh'], ['', '(']],
  [['', '  '], ['k', 'new '], ['f', 'THREE.SphereGeometry'], ['', '('], ['nm', '0.085'], ['', ', '], ['nm', '24'], ['', ', '], ['nm', '16'], ['', '),']],
  [['', '  '], ['k', 'new '], ['f', 'THREE.MeshStandardMaterial'], ['', '({ color: '], ['s', "'#1d5bd8'"], ['', ' }), N);']],
  [['k', 'const '], ['v', 'hid '], ['k', '= new '], ['f', 'THREE.InstancedMesh'], ['', '(']],
  [['', '  '], ['k', 'new '], ['f', 'THREE.SphereGeometry'], ['', '('], ['nm', '0.052'], ['', ', '], ['nm', '18'], ['', ', '], ['nm', '12'], ['', '),']],
  [['', '  '], ['k', 'new '], ['f', 'THREE.MeshStandardMaterial'], ['', '({ color: '], ['s', "'#f4f6fa'"], ['', ' }), N * '], ['nm', '2'], ['', ');']],
  [['', 'escena.'], ['f', 'add'], ['', '(oxi, hid);']],
  [['', '']],
  [['c', '// Con el mechero prendido el calor sube la temperatura,']],
  [['c', '// salvo mientras cambia de estado: ahí se queda quieta.']],
  [['k', 'function '], ['f', 'paso'], ['', '(dt) {']],
  [['', '  '], ['k', 'if '], ['', '(S.mechero) {']],
  [['', '    '], ['k', 'const '], ['v', 'q '], ['k', '= '], ['', 'dt * RITMO;']],
  [['', '    '], ['k', 'if '], ['', '(S.T '], ['k', '< '], ['nm', '0'], ['', ') S.T '], ['k', '+= '], ['', 'q * C_CALOR;']],
  [['', '    '], ['k', 'else if '], ['', '(S.Fm '], ['k', '< '], ['nm', '1'], ['', ') S.Fm '], ['k', '+= '], ['', 'q * K_FUSION;']],
  [['', '    '], ['k', 'else if '], ['', '(S.T '], ['k', '< '], ['nm', '100'], ['', ') S.T '], ['k', '+= '], ['', 'q * C_CALOR;']],
  [['', '    '], ['k', 'else if '], ['', '(S.Fv '], ['k', '< '], ['nm', '1'], ['', ') S.Fv '], ['k', '+= '], ['', 'q * K_EBULL;']],
  [['', '    '], ['k', 'else '], ['', 'S.T '], ['k', '+= '], ['', 'q * C_CALOR;']],
  [['', '  }']],
  [['', '  S.fase '], ['k', '+= '], ['', 'dt * ('], ['nm', '0.5'], ['', ' + '], ['nm', '2.4'], ['', ' * '], ['f', 'energia'], ['', '());']],
  [['', '}']],
];

const FICHA = [
  ['Tema', 'Qué contenido vas a dar', 'Estados del agua', 'A'],
  ['Para quién', 'Grado, año o edad del grupo', '2.º año, secundaria', 'A'],
  ['Qué tienen que lograr', 'Qué entienden o pueden hacer al terminar', 'Que el agua cambia de estado porque cambia el movimiento de sus partículas.', 'A'],
  ['La herramienta', 'Qué es, en una o dos frases', 'Un frasco en 3D con moléculas de agua que se mueven según la temperatura.', 'B'],
  ['Qué hacen los alumnos', 'Qué tocan, mueven, eligen o prueban', 'Suben y bajan la temperatura, y giran el frasco para mirarlo.', 'B'],
  ['Pasos o desafíos', 'En qué orden, y cómo se avanza', null],
  ['Cuando aciertan o se equivocan', 'Qué les muestra la herramienta', null],
  ['Datos que tienen que estar bien', 'Fechas, fórmulas, nombres exactos', 'Fusión a 0 °C y ebullición a 100 °C.', 'B'],
  ['Cómo se ve', 'Estilo, colores, botones, pantallas', null],
  ['Dónde se usa', 'Proyector, tablet, celular; solos o en grupo', null],
];

const CARDS = [
  { id: 'celula', t: 'Célula animal en 3D', by: 'Martín Acosta', d: 'Una célula que se gira y explica cada organelo al tocarlo. Para 7.º grado.', n: 23 },
  { id: 'func', t: 'Explorador de funciones', by: 'Carla Benítez', d: 'Cuadrática, seno y exponencial con coeficientes regulables. 4.º año.', n: 18 },
  { id: 'tiro', t: 'Tiro oblicuo', by: 'Diego Ferreyra', d: 'Ángulo, velocidad y planeta regulables para comparar tiros. 5.º año.', n: 15 },
  { id: 'solar', t: 'Sistema solar a escala', by: 'Valeria Núñez', d: 'Los planetas en órbita, con distancias y tamaños comparables. 6.º grado.', n: 13 },
  { id: 'mayo', t: 'Revolución de Mayo', by: 'Sofía Ruiz', d: 'Línea de tiempo con los hitos desplegables. Para 5.º grado.', n: 12 },
  { id: 'tabla', t: 'Tabla periódica interactiva', by: 'Tomás Herrera', d: 'Las propiedades de cada elemento al tocarlo. Química, 3.º año.', n: 10 },
  { id: 'flash', t: 'Flashcards de inglés', by: 'Julián Paz', d: 'Vocabulario con repetición espaciada, para repasar en casa. 1.º año.', n: 9 },
  { id: 'mapa', t: 'Provincias y capitales', by: 'Ana Pereyra', d: 'Un mapa para practicar capitales, con puntaje. Geografía, 4.º grado.', n: 6 },
  { id: 'pizza', t: 'Fracciones con pizza', by: 'Laura Méndez', d: 'Cortar y comparar porciones para encontrar fracciones equivalentes. 4.º grado.', n: 5 },
  { id: 'circuito', t: 'Armá el circuito', by: 'Pablo Ríos', d: 'Conectar pila, cables y lamparita para ver cuándo se prende. 6.º grado.', n: 4 },
  { id: 'ciclo', t: 'El ciclo del agua', by: 'Mariana Luna', d: 'Evaporación, condensación y lluvia, paso a paso. 3.º grado.', n: 3 },
  { id: 'agua', t: 'Estados del agua', by: 'Paula Gómez', d: 'Las partículas del agua en 3D: sólido, líquido y gas, con mechero y gráfico. 2.º año.', n: 0 },
];
const HEART = '<svg width="15" height="15" viewBox="0 0 24 24" fill="FILL" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.2-9.3C1.6 7.8 3.9 4.5 7.3 4.5c2 0 3.6 1.1 4.7 2.7 1.1-1.6 2.7-2.7 4.7-2.7 3.4 0 5.7 3.3 4.5 6.7-1.7 4.7-9.2 9.3-9.2 9.3z"/></svg>';

function thumb(cv, id) {
  const W = cv.width, H = cv.height, c = cv.getContext('2d');
  const s = W / 400;
  c.save(); c.scale(s, s);
  const w = 400, h = H / s;
  if (id === 'celula') {
    c.fillStyle = '#eef6f3'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#f9c9d4'; c.beginPath(); c.ellipse(200, 62, 120, 50, -0.1, 0, 7); c.fill();
    c.strokeStyle = '#e58fa4'; c.lineWidth = 3; c.stroke();
    c.fillStyle = '#8b5cf6'; c.beginPath(); c.arc(205, 62, 22, 0, 7); c.fill();
    c.fillStyle = '#34d399'; [[140, 50], [260, 80], [150, 85], [255, 42]].forEach(([x, y]) => { c.beginPath(); c.ellipse(x, y, 13, 7, 0.5, 0, 7); c.fill(); });
    c.fillStyle = '#f59e0b'; [[170, 35], [240, 95], [120, 70]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill(); });
  } else if (id === 'func') {
    c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#eef0f5'; c.lineWidth = 1;
    for (let x = 0; x < w; x += 25) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let y = 0; y < h; y += 25) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.strokeStyle = '#9aa1b5'; c.beginPath(); c.moveTo(0, 90); c.lineTo(w, 90); c.moveTo(200, 0); c.lineTo(200, h); c.stroke();
    c.strokeStyle = '#3b2ce7'; c.lineWidth = 3; c.beginPath();
    for (let x = 0; x <= w; x += 4) { const X = (x - 200) / 60; const y = 90 - (X * X - 2) * 22; x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
    c.strokeStyle = '#f59e0b'; c.beginPath();
    for (let x = 0; x <= w; x += 4) { const y = 70 - Math.sin((x - 200) / 30) * 26; x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
  } else if (id === 'tabla') {
    c.fillStyle = '#fafafa'; c.fillRect(0, 0, w, h);
    const cols = ['#fde68a', '#bfdbfe', '#c7d2fe', '#bbf7d0', '#fecaca', '#e9d5ff'];
    for (let r = 0; r < 5; r++) for (let k = 0; k < 18; k++) {
      if (r === 0 && k > 0 && k < 17) continue;
      if ((r === 1 || r === 2) && k > 1 && k < 12) continue;
      c.fillStyle = cols[(k < 2 ? 0 : k > 11 ? 3 + (k % 3) : 1 + (k % 2))];
      c.fillRect(22 + k * 20.3, 14 + r * 21, 18, 18);
    }
  } else if (id === 'mayo') {
    c.fillStyle = '#fbf7ef'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#9a7b4f'; c.lineWidth = 3; c.beginPath(); c.moveTo(30, 70); c.lineTo(370, 70); c.stroke();
    [60, 130, 200, 270, 340].forEach((x, i) => { c.fillStyle = i === 2 ? '#3b82f6' : '#9a7b4f'; c.beginPath(); c.arc(x, 70, 8, 0, 7); c.fill(); c.fillStyle = '#e8dcc6'; c.fillRect(x - 28, i % 2 ? 84 : 26, 56, 26); });
  } else if (id === 'flash') {
    c.fillStyle = '#eef2ff'; c.fillRect(0, 0, w, h);
    [[-8, '#c7d2fe'], [-3, '#a5b4fc'], [0, '#fff']].forEach(([a, col], i) => {
      c.save(); c.translate(200, 65); c.rotate((a * Math.PI) / 180); c.fillStyle = col; c.beginPath(); c.roundRect(-90, -40, 180, 80, 10); c.fill(); c.restore();
    });
    c.fillStyle = '#1e1b4b'; c.font = '600 26px Archivo'; c.textAlign = 'center'; c.fillText('house', 200, 74);
  } else if (id === 'solar') {
    c.fillStyle = '#0e1a33'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffd76a'; c.beginPath(); c.arc(60, 60, 26, 0, 7); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 1.2;
    [[90, 22], [130, 30], [180, 38], [240, 46], [320, 54]].forEach(([r, e]) => { c.beginPath(); c.ellipse(60, 60, r, e, 0, 0, 7); c.stroke(); });
    [[150, 60, 5, '#c9b28f'], [182, 84, 7, '#e6a15a'], [210, 50, 7, '#4f8dff'], [276, 92, 6, '#ff8f6e'], [372, 70, 14, '#e8c07a']].forEach(([x, y, r, col]) => { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); });
  } else if (id === 'mapa') {
    c.fillStyle = '#e8f1f4'; c.fillRect(0, 0, w, h);
    const cols = ['#cfe3c6', '#e9dcb4', '#d7e7d0', '#f0e2c2', '#c8dcc0'];
    const poly = [[[150, 8], [230, 14], [222, 46], [160, 40]], [[160, 40], [222, 46], [214, 80], [168, 76]], [[168, 76], [214, 80], [206, 112], [176, 110]], [[230, 14], [262, 30], [250, 60], [222, 46]], [[222, 46], [250, 60], [240, 96], [214, 80]]];
    poly.forEach((p, i) => { c.fillStyle = cols[i]; c.beginPath(); p.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill(); c.strokeStyle = '#9aa88f'; c.lineWidth = 1.2; c.stroke(); });
    c.fillStyle = '#b45309'; [[190, 28], [192, 60], [236, 40]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.fill(); });
  } else if (id === 'pizza') {
    c.fillStyle = '#fff7ed'; c.fillRect(0, 0, w, h);
    [[120, 8], [280, 6]].forEach(([cx, n]) => {
      c.fillStyle = '#f6c56b'; c.beginPath(); c.arc(cx, 60, 44, 0, 7); c.fill();
      c.fillStyle = '#e4572e'; for (let k = 0; k < n; k += 2) { c.beginPath(); c.moveTo(cx, 60); c.arc(cx, 60, 40, (k / n) * 6.283, ((k + 1) / n) * 6.283); c.closePath(); c.fill(); }
      c.strokeStyle = '#fff7ed'; c.lineWidth = 2; for (let k = 0; k < n; k++) { const a = (k / n) * 6.283; c.beginPath(); c.moveTo(cx, 60); c.lineTo(cx + Math.cos(a) * 44, 60 + Math.sin(a) * 44); c.stroke(); }
    });
  } else if (id === 'circuito') {
    c.fillStyle = '#f1f5f9'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#334155'; c.lineWidth = 4; c.strokeRect(110, 22, 180, 76);
    c.fillStyle = '#1d4ed8'; c.fillRect(96, 44, 28, 34);
    c.fillStyle = '#fde047'; c.beginPath(); c.arc(290, 22, 16, 0, 7); c.fill(); c.strokeStyle = '#a16207'; c.lineWidth = 2; c.stroke();
  } else if (id === 'ciclo') {
    c.fillStyle = '#e0f2fe'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#0ea5e9'; c.fillRect(0, 92, w, 40);
    c.fillStyle = '#fff'; [[240, 34, 22], [268, 28, 26], [296, 36, 20]].forEach(([x, y, r]) => { c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); });
    c.fillStyle = '#0284c7'; [[250, 64], [270, 74], [290, 62]].forEach(([x, y]) => { c.beginPath(); c.ellipse(x, y, 3, 6, 0, 0, 7); c.fill(); });
    c.fillStyle = '#facc15'; c.beginPath(); c.arc(70, 34, 20, 0, 7); c.fill();
  } else if (id === 'agua') {
    const im = window.THUMB_AGUA;
    const sc = 400 / im.width;
    c.drawImage(im, 0, 0, 400, im.height * sc);
  } else if (id === 'tiro') {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#131a30'); g.addColorStop(1, '#1b2440');
    c.fillStyle = '#0f1424'; c.fillRect(0, 0, w, h); c.fillStyle = g; c.fillRect(10, 10, 280, h - 20);
    c.strokeStyle = '#414d78'; c.lineWidth = 2; c.beginPath(); c.moveTo(10, h - 26); c.lineTo(290, h - 26); c.stroke();
    c.strokeStyle = 'rgba(255,200,87,.3)'; c.lineWidth = 2; c.beginPath(); c.moveTo(24, h - 26); c.quadraticCurveTo(60, h - 70, 96, h - 26); c.stroke();
    c.strokeStyle = '#ffc857'; c.lineWidth = 3; c.beginPath(); c.moveTo(24, h - 26); c.quadraticCurveTo(150, h - 140, 276, h - 26); c.stroke();
    c.fillStyle = '#172038'; [[300, 14], [300, 44]].forEach(([x, y]) => { c.fillRect(x, y, 90, 22); });
    c.fillStyle = '#4f46e5'; c.fillRect(300, 78, 90, 26);
  }
  c.restore();
}

// ───────────────────────── init ─────────────────────────
function buildCopy(i) {
  const [, , parts] = COPIES[i];
  const html = [];
  for (const [txt, acc] of parts) for (const w of txt.split(' ')) html.push(`<span class="w${acc ? ' a' : ''}">${w}</span>`);
  $('copy').innerHTML = html.join(' ');
}

function streamHtml(parts, n) {
  let out = '';
  let left = n;
  for (const [txt, b] of parts) {
    if (left <= 0) break;
    const s = txt.slice(0, left);
    left -= txt.length;
    out += b ? `<b>${s}</b>` : s;
  }
  return out;
}
const lenOf = (parts) => parts.reduce((a, [t]) => a + t.length, 0);

async function init() {
  await document.fonts.ready;
  await new Promise((res) => { const im = new Image(); im.onload = () => { window.THUMB_AGUA = im; res(); }; im.src = 'thumb_agua.png'; });
  await Promise.all(['fr1', 'fr2', 'frP'].map((id) => new Promise((res) => {
    const chk = () => { const w = $(id).contentWindow; if (w && w.__listo && w.document.fonts.status === 'loaded') res(); else setTimeout(chk, 50); };
    chk();
  })));
  for (const [id, f] of Object.entries(FR_ACTS)) $(id).contentWindow.__video.configurar(f.acts);
  await Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => (im.onload = r)))));
  // código
  $('code').innerHTML = CODE.map((ln, i) => `<div class="l"><span class="n">${i + 1}</span><span>${ln.map(([c, s]) => (c ? `<span class="${c}">${s}</span>` : s)).join('')}</span></div>`).join('');
  // galería
  $('grid').innerHTML = CARDS.map((c) => `<div class="card" id="card-${c.id}"><canvas width="840" height="248"></canvas><div class="bd"><div class="tt">${c.t}</div><div class="by">por ${c.by}</div><div class="ds">${c.d}</div></div><div class="ft"><span class="like" id="like-${c.id}"><span class="hs">${HEART.replace('FILL', 'none')}</span><span class="cnt">${c.n}</span></span><span style="margin-left:auto" class="xs g">Duplicar</span><span class="xs p">Probar a pantalla completa</span></div></div>`).join('');
  CARDS.forEach((c) => thumb(document.querySelector(`#card-${c.id} canvas`), c.id));

  // medir en layout (cámara neutra, superficie en su lugar)
  const cam = $('cam');
  cam.style.transform = 'none';
  const surf = $('surf');
  Object.assign(surf.style, { left: R_WIN.x + 'px', top: R_WIN.y + 'px', width: R_WIN.w + 'px', height: R_WIN.h + 'px' });
  $('win').style.display = 'block';
  $('gal').style.display = 'block';
  $('code').style.display = 'none';
  $('empty').style.display = 'flex';
  M.ta = rectOf($('ta'));
  M.send = rectOf($('send'));
  M.chat = rectOf(document.querySelector('.chat'));
  M.prev = rectOf(document.querySelector('.prev'));
  M.pbody = rectOf($('pbody'));
  M.tabCode = rectOf($('tabCode'));
  M.tabPrev = rectOf($('tabPrev'));
  M.copyUrl = rectOf($('copyUrl'));
  M.sw = rectOf($('sw'));
  M.navGal = rectOf($('navGal'));
  M.card = rectOf($('card-celula'));
  M.like = rectOf($('like-celula'));
  M.win = rectOf($('win'));
  // dentro del recurso (iframes): coordenadas de layout
  const inRect = (fid, sel) => {
    const fr = $(fid), r = rectOf(fr), k = r.w / fr.offsetWidth;
    const e = fr.contentDocument.querySelector(sel).getBoundingClientRect();
    const x = r.x + e.left * k, y = r.y + e.top * k, w = e.width * k, h = e.height * k;
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, k, wcss: e.width };
  };
  // ficha del taller
  $('fdl').innerHTML = FICHA.map(([et, ay, v], i) => `<div><dt>${et}</dt><dd id="fd${i}">Todavía no lo hablamos (${ay.toLowerCase()}).</dd></div>`).join('');
  // taller: medir cada estado que hace falta
  const tq = $('tq');
  const showT = (ids) => ['tk0', 'tq', 'tu1', 'tth', 'tk1', 'tprops', 'tu2', 'tk2', 'tu3', 'tk3'].forEach((id) => ($(id).style.display = ids.includes(id) ? '' : 'none'));
  ['tidx', 'tses'].forEach((id) => ($(id).style.display = 'block'));
  M.door1 = rectOf($('door1'));
  M.tchat = rectOf(document.querySelector('.tchat'));
  M.tficha = rectOf($('tficha'));
  M.tta = rectOf($('tta'));
  M.tsend = rectOf($('tsend'));
  showT(['tk0', 'tq']);
  M.chip1 = rectOf($('chip1'));
  M.chip2 = rectOf($('chip2'));
  showT(['tk0', 'tu1', 'tk1', 'tprops']);
  M.elegir1 = rectOf($('elegir1'));
  M.tprops = rectOf($('tprops'));
  M.tk1 = rectOf($('tk1'));
  FICHA.forEach(([, , v], i) => { if (v) { $('fd' + i).textContent = v; $('fd' + i).className = 'v'; } });
  $('ftit').textContent = 'Las partículas del agua en 3D';
  $('fped').style.display = 'none';
  M.finH = $('fin').offsetHeight;
  M.fichaH = $('tficha').offsetHeight;
  M.fScrollMax = Math.max(0, M.finH - M.fichaH);
  M.armar = rectOf($('farmar'));
  $('fped').style.display = '';
  $('fpta').textContent = MSG_U1;
  M.crear = rectOf($('crear'));
  $('fpta').textContent = '';
  FICHA.forEach(([, ay], i) => { $('fd' + i).textContent = `Todavía no lo hablamos (${ay.toLowerCase()}).`; $('fd' + i).className = ''; });
  $('ftit').textContent = 'Todavía sin nombre';
  ['tidx', 'tses'].forEach((id) => ($(id).style.display = 'none'));
  // galería: tarjetas, corazones y scroll
  M.like2 = rectOf($('like-solar'));
  M.cardAgua = rectOf($('card-agua'));
  M.cardSolar = rectOf($('card-solar'));
  M.rowStep = (M.cardSolar.y - M.card.y) / 1.2;
  M.gScrollMax = Math.max(M.rowStep, (M.cardAgua.y + M.cardAgua.h - (R_WIN.y + R_WIN.h) + 22 * 1.2) / 1.2);
  M.slider = inRect('fr1', '#temp');
  M.visor = inRect('fr1', '#visor');
  M.mechero = inRect('fr2', '#mechero');
  M.grafico = inRect('fr2', '.grafico');
  M.thumbX = (v) => M.slider.x + M.slider.k * (9 + ((v + 20) / 140) * (M.slider.wcss - 18));
  $('gal').style.display = 'none';

  buildTimeline();
  window.EVENTS = EVENTS.sort((a, b) => a.t - b.t);
  window.DUR = DUR;
  window.M = M;
}

// ───────────────────────── cámara y cursor ─────────────────────────
const C0 = { cx: 960, cy: 540, z: 1 };
function fit(r, pad = 40, zmax = 1.6) {
  const top = 180, H = 1080 - top - 16;
  const z = Math.min(zmax, 1920 / (r.w + pad * 2), H / (r.h + pad * 2));
  const sy = top + H / 2;
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2 - (sy - 540) / z, z };
}
let CAM = [];
let CUR = [];

function buildTimeline() {
  const chatZoom = fit({ x: M.chat.x, y: M.chat.y + M.chat.h - 520, w: M.chat.w, h: 520 }, 30, 1.5);
  const prevBody = fit(M.pbody, 20, 1.4);
  const prevFull = fit({ x: M.prev.x, y: M.prev.y, w: M.prev.w, h: M.prev.h }, 16, 1.4);
  const phoneV = { cx: 1400, cy: 618, z: 0.95 };
  const cardZ = fit({ x: M.card.x - 30, y: M.card.y - 20, w: M.card.w + 60, h: M.card.h + 40 }, 30, 1.6);
  // [t0, t1, destino]
  const tChatZ = fit({ x: M.tchat.x, y: M.tchat.y + M.tchat.h - 470, w: M.tchat.w, h: 470 }, 30, 1.5);
  const propsZ = fit({ x: M.tchat.x, y: M.tk1.y - 20, w: M.tchat.w, h: M.tprops.y + M.tprops.h - M.tk1.y + 40 }, 30, 1.5);
  const fichaZ = fit({ x: M.tficha.x - 20, y: M.tficha.y, w: M.tficha.w + 40, h: M.tficha.h }, 16, 1.5);
  const galZ = { cx: 960, cy: M.card.y - 70 + (540 - 186) / 1.2, z: 1.2 };
  CAM = [
    [10.0, 10.5, tChatZ],
    [12.7, 13.3, C0],
    [14.3, 14.9, propsZ],
    [16.2, 16.8, fichaZ],
    [20.0, 20.6, chatZoom],
    [21.65, 22.25, C0],
    [26.2, 26.8, prevBody],
    [30.3, 30.9, chatZoom],
    [34.45, 34.95, prevFull],
    [40.0, 40.6, phoneV],
    [42.4, 43.0, C0],
    [45.0, 45.6, galZ],
    [51.0, 51.8, C0],
  ];
  const c = (r, dx = 0, dy = 0) => ({ x: r.cx + dx, y: r.cy + dy });
  const rotP0 = { x: M.visor.x + M.visor.w * 0.42, y: M.visor.y + M.visor.h * 0.55 };
  const idle1 = { x: M.pbody.x + M.pbody.w * 0.62, y: M.pbody.y + M.pbody.h * 0.82 };
  // [t0, t1, destino]  (destino en layout; función para el arrastre)
  const gs1 = M.rowStep * 1.2, gsMax = M.gScrollMax * 1.2;
  CUR = [
    [8.8, 8.8, { x: 1540, y: 930 }],
    [8.95, 9.45, c(M.door1, -10, 3)],
    [9.9, 10.55, c(M.tta, -120, 4)],
    [11.05, 11.45, c(M.chip1, -10, 3)],
    [11.55, 11.95, c(M.chip2, -10, 3)],
    [12.05, 12.45, c(M.tsend, 10, 4)],
    [12.7, 13.4, { x: M.tficha.x - 70, y: M.tficha.cy + 120 }],
    [14.6, 15.45, c(M.elegir1, -8, 3)],
    [15.7, 16.6, { x: M.tficha.cx + 60, y: M.tficha.y + M.tficha.h * 0.62 }],
    [17.5, 17.95, { x: M.armar.cx - 10, y: M.armar.cy - M.fScrollMax * 1.2 + 3 }],
    [18.9, 19.45, c(M.crear, -10, 3)],
    [20.4, 21.45, c(M.send, 10, 4)],
    [21.7, 22.5, idle1],
    [26.3, 26.95, { x: M.thumbX(20), y: M.slider.cy }],
    [27.0, 27.8, (t) => ({ x: M.thumbX(20 + 90 * eio(P(t, 27.0, 27.8))), y: M.slider.cy })],
    [28.0, 28.55, rotP0],
    [28.6, 29.5, (t) => ({ x: rotP0.x + 300 * eio(P(t, 28.6, 29.5)), y: rotP0.y + 18 * Math.sin(Math.PI * P(t, 28.6, 29.5)) })],
    [29.7, 30.2, { x: rotP0.x + 330, y: rotP0.y + 90 }],
    [30.35, 30.95, c(M.ta, -40, 6)],
    [32.55, 32.95, c(M.send, 10, 4)],
    [33.1, 33.9, idle1],
    [34.3, 34.95, c(M.mechero, 8, 3)],
    [35.3, 36.3, { x: M.mechero.cx - 40, y: M.mechero.cy + 150 }],
    [37.4, 38.45, c(M.tabCode, 2, 2)],
    [38.8, 39.45, c(M.copyUrl, 4, 2)],
    [42.5, 43.45, c(M.sw, 2, 1)],
    [43.6, 44.45, c(M.navGal, 0, 2)],
    [45.0, 45.95, c(M.like, -6, 1)],
    [47.45, 47.95, { x: M.like2.cx - 6, y: M.like2.cy - gs1 + 1 }],
    [49.6, 50.3, { x: M.cardAgua.cx + 40, y: M.cardAgua.cy - gsMax + 30 }],
  ];
  // clicks
  click(T.door, 'door1');
  click(T.tClick, 'tta');
  click(T.chip1, 'chip1');
  click(T.chip2, 'chip2');
  click(T.tSend, 'tsend');
  click(T.elegir, 'elegir1');
  click(T.armar, 'farmar');
  click(T.crear, 'crear');
  click(T.send1, 'send');
  click(T.drag[0], null);
  click(T.rot[0], null);
  click(T.click2, 'ta');
  click(T.send2, 'send');
  click(T.mechero, 'mechero');
  click(T.code, 'tabCode');
  click(T.copyUrl, 'copyUrl');
  click(T.publish, 'pub');
  click(T.navGal, 'navGal');
  click(T.like, 'like-celula');
  click(T.like2, 'like-solar');
  // teclas
  const keys = (txt, a, b) => { for (let i = 0; i < txt.length; i++) ev(a + ((b - a) * (i + 1)) / txt.length - 0.01, 'key'); };
  keys(TTYPE, ...T.tType);
  keys(MSG_U2, ...T.type2);
  // lapicera
  T.lines.forEach((t0) => { for (let k = 0; k < 6; k++) ev(t0 + k * 0.05, 'pen'); });
  // tics
  T.strikes.forEach((t) => ev(t, 'tick'));
  T.st1.forEach(([t]) => ev(t, 'tick'));
  T.st2.forEach(([t]) => ev(t, 'tick'));
  ev(T.genEnd, 'tick');
  [T.fichaA, T.fichaB, T.pedido].forEach((t) => ev(t, 'tick'));
  // soplos
  [T.morph1, T.tses, T.toEditor, 23.0, T.v2, T.phoneIn, T.navGal + 0.05, T.morph2, T.wm].forEach((t) => ev(t, 'whoosh'));
  ev(T.starIn, 'pop');
  ev(T.kIn, 'pop');
}

function camAt(t) {
  let cur = { ...C0 };
  for (const [a, b, d] of CAM) {
    if (t >= b) cur = { ...d };
    else if (t > a) {
      const x = eio(P(t, a, b));
      // zoom en espacio log para que el movimiento se sienta parejo
      const z = Math.exp(lerp(Math.log(cur.z), Math.log(d.z), x));
      return { cx: lerp(cur.cx, d.cx, x), cy: lerp(cur.cy, d.cy, x), z };
    } else break;
  }
  return cur;
}
const toStage = (p, c) => ({ x: 960 + (p.x - c.cx) * c.z, y: 540 + (p.y - c.cy) * c.z });

function curAt(t) {
  let p = CUR[0][2];
  for (const [a, b, d] of CUR) {
    if (typeof d === 'function') {
      if (t >= a) p = d(Math.min(t, b));
      if (t < b) return p;
      continue;
    }
    if (t >= b) p = d;
    else if (t > a) {
      const x = eio(P(t, a, b));
      // curva natural: control desplazado en perpendicular
      const dx = d.x - p.x, dy = d.y - p.y;
      const mx = (p.x + d.x) / 2 - dy * 0.14, my = (p.y + d.y) / 2 + dx * 0.14;
      const u = 1 - x;
      return { x: u * u * p.x + 2 * u * x * mx + x * x * d.x, y: u * u * p.y + 2 * u * x * my + x * x * d.y };
    } else break;
  }
  return p;
}
function curVisible(t) {
  if (t < 8.8) return 0;
  if (t < 9.1) return P(t, 8.8, 9.1);
  if (t >= 39.8 && t < 42.5) return 1 - P(t, 39.8, 40.05);
  if (t >= 42.5 && t < 50.6) return P(t, 42.5, 42.75);
  if (t >= 50.6) return 1 - P(t, 50.6, 50.9);
  return 1;
}

// ───────────────────────── render ─────────────────────────
let lastCopy = -1;
function setOp(el, o) { el.style.opacity = o; el.style.visibility = o <= 0.001 ? 'hidden' : 'visible'; }
function pressScale(id, t) {
  let s = 1;
  for (const c of CLICKS) if (c.target === id) {
    const d = t - c.t;
    if (d >= -0.06 && d < 0.26) s = Math.min(s, d < 0.04 ? lerp(1, 0.94, P(d, -0.06, 0.04)) : lerp(0.94, 1, eo(P(d, 0.04, 0.26))));
  }
  return s;
}

function renderIntro(t) {
  const kb = $('kbox');
  const s0 = 320 / 704;
  const kIn = spr(P(t, T.kIn, T.kIn + 0.9));
  const kOut = eio(P(t, T.kOut, T.kOut + 0.6));
  const s = s0 * lerp(0.9, 1, kIn) * lerp(1, 0.55, kOut);
  const cx = 960, cy = lerp(540, 470, kOut);
  kb.style.transform = `translate(${cx - 252.5 * s}px, ${cy - 351.5 * s}px) scale(${s})`;
  const o = kIn * (1 - P(t, T.kOut + 0.1, T.kOut + 0.5));
  setOp(kb, o);
  kb.style.filter = t < T.kIn + 0.4 ? `blur(${(1 - kIn) * 8}px)` : t > T.kOut ? `blur(${kOut * 6}px)` : 'none';
  // estrella
  const st = $('kstar');
  const sIn = spr(P(t, T.starIn, T.starIn + 0.5));
  let sc = sIn, rot = lerp(-60, 0, sIn);
  for (const b of T.blinks) {
    const d = P(t, b, b + 0.28);
    if (d > 0 && d < 1) { sc *= 1 - 0.5 * Math.sin(Math.PI * d); rot += 90 * eio(d); }
    else if (d >= 1) rot += 90;
  }
  Object.assign(st.style, { left: 172.5 - 46.5 + 'px', top: 353.5 - 46.5 + 'px', width: '93px', height: '93px', transform: `rotate(${rot}deg) scale(${sc})`, opacity: sIn > 0 ? 1 : 0 });
}

function renderSurf(t) {
  const surf = $('surf');
  let R, o = 1;
  if (t < T.noteIn) { setOp(surf, 0); return; }
  if (t < T.morph1) {
    const x = spr(P(t, T.noteIn, T.noteIn + 0.8));
    R = { ...R_NOTE, y: R_NOTE.y + (1 - x) * 70 };
    o = eo(P(t, T.noteIn, T.noteIn + 0.4));
  } else if (t < T.morph2) {
    const x = spr(P(t, T.morph1, T.morph1 + 0.85));
    R = { x: lerp(R_NOTE.x, R_WIN.x, x), y: lerp(R_NOTE.y, R_WIN.y, x), w: lerp(R_NOTE.w, R_WIN.w, x), h: lerp(R_NOTE.h, R_WIN.h, x), r: lerp(R_NOTE.r, R_WIN.r, x) };
  } else {
    const x = spr(P(t, T.morph2, T.morph2 + 0.85));
    R = { x: lerp(R_WIN.x, R_ICON.x, x), y: lerp(R_WIN.y, R_ICON.y, x), w: lerp(R_WIN.w, R_ICON.w, x), h: lerp(R_WIN.h, R_ICON.h, x), r: lerp(R_WIN.r, R_ICON.r, x) };
    o = 1 - eo(P(t, T.wm - 0.05, T.wm + 0.18));
  }
  setOp(surf, o);
  Object.assign(surf.style, { left: R.x + 'px', top: R.y + 'px', width: R.w + 'px', height: R.h + 'px', borderRadius: R.r + 'px' });

  // libreta
  const note = $('note');
  const nOut = P(t, T.morph1, T.morph1 + 0.22);
  setOp(note, 1 - nOut);
  note.style.filter = nOut > 0 && nOut < 1 ? `blur(${nOut * 6}px)` : 'none';
  if (nOut < 1) {
    T.lines.forEach((t0, i) => {
      const ln = $('ln' + i);
      const w = eo(P(t, t0, t0 + 0.32));
      ln.querySelector('.txt').style.clipPath = w >= 1 ? 'inset(-10px -30px -10px -10px)' : `inset(-10px ${(1 - w) * 100}% -10px -10px)`;
      if (i >= 2) {
        const s = eio(P(t, T.strikes[i - 2], T.strikes[i - 2] + 0.2));
        const stE = ln.querySelector('.strike');
        stE.style.width = s * (ln.querySelector('.txt').offsetWidth + 8) + 'px';
        ln.querySelector('.txt').style.opacity = lerp(1, 0.32, P(t, T.strikes[i - 2] + 0.1, T.strikes[i - 2] + 0.4));
      } else {
        const h = eio(P(t, T.hls[i], T.hls[i] + 0.3));
        ln.querySelector('.hl').style.width = h * (ln.querySelector('.txt').offsetWidth + 4) + 'px';
      }
    });
  }

  // páginas dentro de la superficie: taller (índice y charla) → editor → galería
  const PAGES = [['tidx', T.morph1 + 0.4, T.tses], ['tses', T.tses, T.toEditor], ['win', T.toEditor, T.navGal + 0.05], ['gal', T.navGal + 0.05, 99]];
  const allOut = P(t, T.morph2, T.morph2 + 0.22);
  for (const [id, a, b] of PAGES) {
    const el = $(id);
    const inX = P(t, a, a + 0.35), outX = P(t, b, b + 0.35);
    const o = inX * (1 - outX) * (1 - allOut);
    el.style.display = o > 0 ? 'block' : 'none';
    setOp(el, o);
    const bl = inX > 0 && inX < 1 ? (1 - inX) * 5 : outX > 0 && outX < 1 ? outX * 4 : allOut > 0 && allOut < 1 ? allOut * 6 : 0;
    el.style.filter = bl > 0.05 ? `blur(${bl}px)` : 'none';
    if (o > 0) ({ tidx: renderTidx, tses: renderTses, win: renderWin, gal: renderGal })[id](t);
  }
}

function renderTidx(t) {
  $('door1').style.transform = `scale(${pressScale('door1', t)})`;
  $('door1').style.display = 'inline-flex';
}

function renderTses(t) {
  const show = (id, from, to = 99) => {
    const e = $(id); const on = t >= from && t < to;
    e.style.display = on ? '' : 'none';
    if (on) { const x = spr(P(t, from, from + 0.45)); e.style.transform = `translateY(${(1 - x) * 14}px)`; e.style.opacity = eo(P(t, from, from + 0.25)); }
    return on;
  };
  show('tk0', 0);
  show('tq', 0, T.tSend);
  show('tu1', T.tSend);
  $('tth').style.display = (t >= T.think1[0] && t < T.think1[1]) || (t >= T.think2[0] && t < T.think2[1]) ? '' : 'none';
  if ($('tth').style.display === '') { $('tthL').style.backgroundPosition = `${100 - ((t * 100) / 1.5) % 100}% 0`; orb($('orbT'), t * 1.6, false); }
  show('tk1', T.ideas);
  show('tprops', T.ideas + 0.15);
  show('tu2', T.elegir + 0.3);
  show('tk2', T.think2[1]);
  show('tu3', T.armar);
  show('tk3', T.pedido);
  $('chip1').className = t >= T.chip1 ? 'chip on' : 'chip';
  $('chip2').className = t >= T.chip2 ? 'chip on' : 'chip';
  for (const id of ['chip1', 'chip2', 'tsend', 'elegir1', 'farmar', 'crear']) $(id).style.transform = `scale(${pressScale(id, t)})`;
  $('elegir1').style.color = t >= T.elegir ? 'var(--brand)' : '';
  $('elegir1').style.borderColor = t >= T.elegir ? 'var(--brand300)' : '';
  // composer
  const typing = t >= T.tClick && t < T.tSend;
  const typed = typing ? TTYPE.slice(0, Math.floor(TTYPE.length * P(t, ...T.tType))) : '';
  $('ttaTxt').textContent = typed;
  $('ttaPh').style.display = typed ? 'none' : '';
  $('tta').style.borderColor = typing ? 'var(--brand500)' : 'var(--linea)';
  $('tta').style.boxShadow = typing ? '0 0 0 3px var(--brand100)' : 'none';
  $('tcaret').style.display = typing && (Math.floor(t * 2.2) % 2 === 0 || typed.length < TTYPE.length) ? '' : 'none';
  if (!typed && typing) $('tta').insertBefore($('tcaret'), $('ttaPh')); else $('tta').appendChild($('tcaret'));
  const busy = (t >= T.tSend && t < T.ideas) || (t >= T.elegir && t < T.think2[1]) || (t >= T.armar && t < T.pedido);
  $('tsend').textContent = busy ? 'Kodu está contestando…' : 'Enviar';
  $('tsend').style.opacity = busy ? 0.6 : 1;
  // ficha
  const nA = t >= T.fichaA ? 3 : 0, nB = t >= T.fichaB ? 3 : 0;
  const n = nA + nB;
  FICHA.forEach(([, ay, v, g], i) => {
    const on = v && ((g === 'A' && t >= T.fichaA) || (g === 'B' && t >= T.fichaB));
    const dd = $('fd' + i);
    dd.textContent = on ? v : `Todavía no lo hablamos (${ay.toLowerCase()}).`;
    dd.className = on ? 'v' : '';
    const t0 = g === 'A' ? T.fichaA : T.fichaB;
    const hl = on ? 1 - P(t, t0 + 0.4, t0 + 1.4) : 0;
    dd.style.background = hl > 0 ? `rgba(59,44,231,${0.1 * hl})` : 'transparent';
  });
  const ped = t >= T.pedido;
  const progX = n === 0 ? 0 : n === 3 ? 0.3 * eo(P(t, T.fichaA, T.fichaA + 0.5)) : 0.3 + 0.3 * eo(P(t, T.fichaB, T.fichaB + 0.5));
  $('fbar').style.width = progX * 100 + '%';
  $('ftxt').textContent = ped ? 'El pedido está listo.' : `${n} de 10 cosas definidas. Kodu te va preguntando el resto.`;
  $('ftit').textContent = t >= T.fichaB ? 'Las partículas del agua en 3D' : 'Todavía sin nombre';
  $('fped').style.display = ped ? '' : 'none';
  if (ped) {
    const x = eo(P(t, T.pedido, T.pedido + 0.35));
    $('fped').style.opacity = x;
    $('fped').style.transform = `translateY(${(1 - x) * 10}px)`;
    $('fpta').textContent = MSG_U1.slice(0, Math.floor(P(t, T.pedido + 0.1, T.pedido + 0.75) * MSG_U1.length));
  }
  $('farmarBox').style.display = ped ? 'none' : '';
  $('crear').textContent = t >= T.crear ? 'Abriendo el editor…' : 'Crear mi recurso';
  $('crear').style.opacity = t >= T.crear ? 0.75 : 1;
  const sc = t < T.fBack[0] ? M.fScrollMax * eio(P(t, ...T.fScroll)) : M.fScrollMax * (1 - eio(P(t, ...T.fBack)));
  $('fin').style.transform = `translateY(${-sc}px)`;
}

function orb(cv, t, pulse) {
  const c = cv.getContext('2d');
  const W = cv.width;
  c.clearRect(0, 0, W, W);
  const r = (W / 2) * (pulse ? 0.86 + 0.08 * Math.sin(t * 2.4) : 0.92);
  c.save();
  c.translate(W / 2, W / 2);
  c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.clip();
  const g = c.createConicGradient(t * 2.2, 0, 0);
  g.addColorStop(0, '#3b2ce7'); g.addColorStop(0.3, '#7c6cf5'); g.addColorStop(0.55, '#c7bfff'); g.addColorStop(0.8, '#5b4cf0'); g.addColorStop(1, '#3b2ce7');
  c.fillStyle = g; c.fillRect(-r, -r, 2 * r, 2 * r);
  const h = c.createRadialGradient(-r * 0.3, -r * 0.35, 0, 0, 0, r);
  h.addColorStop(0, 'rgba(255,255,255,.55)'); h.addColorStop(0.6, 'rgba(255,255,255,0)');
  c.fillStyle = h; c.fillRect(-r, -r, 2 * r, 2 * r);
  c.restore();
}

function renderWin(t) {
  // chat
  const empty = $('empty');
  const sent1 = t >= T.send1;
  empty.style.display = sent1 ? 'none' : 'flex';
  if (!sent1) orb($('orbBig'), t, true);
  const show = (id, from, to = 99) => { const e = $(id); const on = t >= from && t < to; e.style.display = on ? '' : 'none'; if (on) { const x = spr(P(t, from, from + 0.45)); e.style.transform = `translateY(${(1 - x) * 14}px)`; e.style.opacity = eo(P(t, from, from + 0.25)); } return on; };
  if (show('mu1', T.send1)) $('mu1').textContent = MSG_U1;
  if (show('ma1', T.a1)) $('ma1').innerHTML = streamHtml(MSG_A1, Math.floor((t - T.a1) * 95));
  show('undo1', T.a1 + lenOf(MSG_A1) / 95 + 0.1, T.send2);
  if (show('mu2', T.send2)) $('mu2').textContent = MSG_U2;
  if (show('ma2', T.v2)) $('ma2').innerHTML = streamHtml(MSG_A2, Math.floor((t - T.v2) * 150));
  show('undo2', T.v2 + lenOf(MSG_A2) / 150 + 0.1);

  // estado de la IA
  let label = null, t0 = 0;
  if (t >= T.st1[0][0] && t < T.genEnd) { for (const [a, l] of T.st1) if (t >= a) label = l; t0 = T.send1; }
  if (t >= T.st2[0][0] && t < T.v2) { for (const [a, l] of T.st2) if (t >= a) label = l; t0 = T.send2; }
  const stE = $('status');
  const hOn = label ? eo(P(t, t >= T.send2 ? T.st2[0][0] : T.st1[0][0], (t >= T.send2 ? T.st2[0][0] : T.st1[0][0]) + 0.2)) : 0;
  stE.style.height = hOn * 40 + 'px';
  if (label) {
    $('stLabel').textContent = label;
    $('stLabel').style.backgroundPosition = `${100 - ((t * 100) / 1.5) % 100}% 0`;
    $('stTimer').textContent = Math.floor(t - t0) + 's';
    orb($('orbS'), t * 1.6, false);
  }

  // composer
  let typed = '', focus = false;
  if (t < T.send1) typed = MSG_U1;
  if (t >= T.click2 && t < T.send2) { focus = true; typed = MSG_U2.slice(0, Math.floor(MSG_U2.length * P(t, ...T.type2))); }
  $('taTxt').textContent = typed;
  $('taPh').style.display = typed ? 'none' : '';
  const ta = $('ta');
  ta.style.borderColor = focus ? 'var(--brand500)' : 'var(--linea)';
  ta.style.boxShadow = focus ? '0 0 0 3px var(--brand100)' : 'none';
  $('caret').style.display = focus && (Math.floor(t * 2.2) % 2 === 0 || (typed && typed.length < (t < T.send1 ? MSG_U1 : MSG_U2).length)) ? '' : 'none';
  if (!typed && focus) { $('taPh').style.display = ''; ta.insertBefore($('caret'), $('taPh')); } else ta.appendChild($('caret'));
  const gen = (t >= T.send1 && t < T.genEnd) || (t >= T.send2 && t < T.v2);
  $('send').textContent = gen ? 'Generando…' : 'Enviar';
  $('send').style.opacity = gen ? 0.6 : 1;
  $('send').style.transform = `scale(${pressScale('send', t)})`;
  ta.style.transform = `scale(${lerp(1, 0.985, 1 - pressScale('ta', t))})`;

  // encabezado de la vista previa
  const codeOn = t >= T.code;
  $('tabCode').className = codeOn ? 'on' : '';
  $('tabPrev').className = codeOn ? '' : 'on';
  $('tabCode').style.transform = `scale(${pressScale('tabCode', t)})`;
  const copied = t >= T.copyUrl && t < T.copyUrl + 2.6;
  $('copyUrl').textContent = copied ? '¡Copiada!' : 'Copiar URL';
  $('copyUrl').style.color = copied ? 'var(--brand)' : '';
  $('copyUrl').style.borderColor = copied ? 'var(--brand300)' : '';
  $('copyUrl').style.transform = `scale(${pressScale('copyUrl', t)})`;
  const pubX = eo(P(t, T.publish, T.publish + 0.18));
  $('sw').style.background = pubX > 0.5 ? 'var(--brand)' : '#d6d6d2';
  $('sw').querySelector('i').style.left = 2 + 11 * pubX + 'px';
  $('pub').style.transform = `scale(${pressScale('pub', t)})`;
  $('navGal').style.color = t >= T.navGal ? 'var(--brand700)' : '';
  $('navMis').style.color = t >= T.navGal ? '' : 'var(--brand700)';
  $('navGal').style.display = 'inline-block';
  $('navGal').style.transform = `scale(${pressScale('navGal', t)})`;
  // pie
  $('checks').style.opacity = t >= T.genEnd ? eo(P(t, T.genEnd, T.genEnd + 0.3)) : 0;
  $('saveSt').textContent = t >= T.publish ? 'Publicado en la galería' : t >= T.v2 ? 'Recurso actualizado' : 'Guardado';
  $('saveSt').style.color = t >= T.publish ? 'var(--brand)' : '';

  // vista previa: recurso o código
  $('code').style.display = codeOn ? 'block' : 'none';
  renderApp(t);
}

function frameAt(id, t) {
  const f = FR_ACTS[id];
  $(id).contentWindow.__video.cuadro(Math.max(0, t - f.load));
}
function renderApp(t) {
  const f1 = $('fr1'), f2 = $('fr2');
  const codeOn = t >= T.code;
  const on1 = t >= 23.0 && t < T.v2 && !codeOn;
  const on2 = t >= T.v2 && !codeOn;
  f1.style.visibility = on1 ? 'visible' : 'hidden';
  f2.style.visibility = on2 ? 'visible' : 'hidden';
  if (on1) {
    // se arma en vivo mientras se genera (15 → 16.7)
    const d = f1.contentDocument;
    const parts = [d.querySelector('header'), d.querySelector('.visor'), ...d.querySelectorAll('.panel > *')];
    const stepT = [23.0, 23.4, 23.8, 24.1, 24.4, 24.6, 24.6];
    parts.forEach((el, i) => { const x = eo(P(t, stepT[i], stepT[i] + 0.3)); el.style.opacity = x; el.style.transform = x < 1 ? `translateY(${(1 - x) * 8}px)` : ''; });
    frameAt('fr1', t);
  }
  if (on2) {
    // recarga con la versión nueva: un parpadeo corto del iframe
    f2.style.opacity = t < T.v2 + 0.25 ? eo(P(t, T.v2, T.v2 + 0.25)) : 1;
    const b = f2.contentDocument.getElementById('mechero');
    const s = pressScale('mechero', t);
    b.style.transform = s < 1 ? `scale(${s})` : '';
    frameAt('fr2', t);
  }
}

function renderPhone(t) {
  const ph = $('phone');
  const inX = spr(P(t, T.phoneIn + 0.1, T.phoneIn + 0.9));
  const outX = eio(P(t, T.phoneOut, T.phoneOut + 0.5));
  const vis = t >= T.phoneIn && t < T.phoneOut + 0.5;
  ph.style.visibility = vis ? 'visible' : 'hidden';
  if (!vis) return;
  ph.style.left = 1832 + (1 - inX) * 260 + outX * 300 + 'px';
  ph.style.top = 252 + 'px';
  ph.style.opacity = eo(P(t, T.phoneIn + 0.1, T.phoneIn + 0.45)) * (1 - outX);
  ph.style.filter = (inX < 0.6 && inX > 0) ? `blur(${(0.6 - inX) * 6}px)` : outX > 0 ? `blur(${outX * 5}px)` : 'none';
  $('phone').querySelector('.mapp').style.opacity = eo(P(t, T.phoneLoad, T.phoneLoad + 0.25));
  frameAt('frP', t);
}

function renderGal(t) {
  const sc = M.rowStep * eio(P(t, ...T.scroll1)) + (M.gScrollMax - M.rowStep) * eio(P(t, ...T.scroll2));
  $('gwrap').style.transform = `translateY(${-sc}px)`;
  for (const [id, tl, n] of [['celula', T.like, 23], ['solar', T.like2, 13]]) {
    const liked = t >= tl;
    const el = $('like-' + id);
    el.querySelector('.hs').innerHTML = HEART.replace('FILL', liked ? '#dc2626' : 'none');
    el.style.color = liked ? '#dc2626' : '';
    el.querySelector('.cnt').textContent = liked ? n + 1 : n;
    el.style.transform = `scale(${liked ? 1 + 0.18 * Math.sin(Math.PI * P(t, tl, tl + 0.3)) : pressScale('like-' + id, t)})`;
    el.style.display = 'flex';
    el.style.transformOrigin = '30% 50%';
  }
}

function renderEnd(t) {
  const ek = $('endk'), wm = $('wm'), es = $('estar');
  // K dentro del ícono
  const kIcon = { s: 150 / 704 };
  kIcon.x = 960 - 252.5 * kIcon.s; kIcon.y = 470 - 351.5 * kIcon.s;
  const sK = WM.s * 0.495;
  const kWm = { s: sK, x: WM.x + 8 * WM.s - 8 * sK, y: WM.y + 8 * WM.s - 8 * sK };
  const inO = eo(P(t, T.morph2 + 0.45, T.morph2 + 0.8));
  const m = eio(P(t, T.wm, T.wm + 0.6)); const xf = P(t, T.wm + 0.6, T.wm + 0.9);
  const k = { x: lerp(kIcon.x, kWm.x, m), y: lerp(kIcon.y, kWm.y, m), s: lerp(kIcon.s, kWm.s, m) };
  const vis = t >= T.morph2;
  ek.style.display = vis ? 'block' : 'none';
  wm.style.display = vis ? 'block' : 'none';
  if (!vis) { $('wmstar').style.display = 'none'; return; }
  ek.style.transform = `translate(${k.x}px, ${k.y}px) scale(${k.s})`;
  ek.querySelector('img').style.opacity = 1;
  setOp(ek, inO);
  Object.assign(es.style, { left: 172.5 - 46.5 + 'px', top: 353.5 - 46.5 + 'px', width: '93px', height: '93px' });
  Object.assign(wm.style, { left: WM.x + 'px', top: WM.y + 'px', width: WM.w + 'px', height: WM.h + 'px', transformOrigin: '0 50%' });
  const wo = eo(P(t, T.wm + 0.35, T.wm + 0.8));
  wm.style.opacity = wo;
  wm.style.transform = `translateX(${(1 - spr(P(t, T.wm + 0.35, T.wm + 1.0))) * -28}px)`; wm.style.filter = wo < 1 ? `blur(${(1 - wo) * 5}px)` : 'none';
  // estrella: queda como pieza propia encima de la marca
  const ws = $('wmstar');
  const sp = { x: kWm.x + 172.5 * sK, y: kWm.y + 353.5 * sK, sz: 93 * sK };
  ws.style.display = 'none';
  Object.assign(ws.style, { left: sp.x - sp.sz / 2 + 'px', top: sp.y - sp.sz / 2 + 'px', width: sp.sz + 'px', height: sp.sz + 'px' });
  es.style.opacity = 1;
  // bajada
  const tag = $('tag');
  tag.style.top = WM.y + WM.h + 70 + 'px';
  if (!tag.dataset.b) {
    tag.innerHTML = 'El docente aporta la pedagogía.'.split(' ').map((w) => `<span class="w">${w}</span>`).join(' ') + ' ' + 'Kodu, el código.'.split(' ').map((w) => `<span class="w a">${w}</span>`).join(' ');
    tag.dataset.b = 1;
  }
  [...tag.querySelectorAll('.w')].forEach((w, i) => {
    const x = spr(P(t, T.tag + i * 0.07, T.tag + i * 0.07 + 0.5));
    w.style.opacity = eo(P(t, T.tag + i * 0.07, T.tag + i * 0.07 + 0.3));
    w.style.transform = `translateY(${(1 - x) * 14}px)`;
    w.style.filter = x < 1 ? `blur(${(1 - x) * 5}px)` : 'none';
  });
}

function renderCopy(t) {
  let idx = -1;
  COPIES.forEach(([a, b], i) => { if (t >= a && t < b) idx = i; });
  const el = $('copy');
  if (idx !== lastCopy) { if (idx >= 0) buildCopy(idx); else el.innerHTML = ''; lastCopy = idx; }
  if (idx < 0) return;
  const [a, b] = COPIES[idx];
  const ws = [...el.querySelectorAll('.w')];
  ws.forEach((w, i) => {
    const s0 = a + i * 0.08;
    const x = spr(P(t, s0, s0 + 0.5));
    const out = eo(P(t, b - 0.22, b));
    w.style.opacity = eo(P(t, s0, s0 + 0.28)) * (1 - out);
    w.style.transform = `translateY(${(1 - x) * 18 - out * 8}px)`;
    const bl = (1 - x) * 7 + out * 5;
    w.style.filter = bl > 0.05 ? `blur(${bl}px)` : 'none';
  });
}

// empuje lento de cámara en los momentos quietos, para que no haya cuadros muertos
const DRIFTS = [[1.4, 4.4, 4.4, 5.2, 0.035], [40.6, 42.4, 42.4, 43.0, 0.03], [49.6, 51.0, 51.0, 51.8, 0.02], [52.4, 55.85, 99, 100, 0.025]];
function render(t) {
  const c = { ...camAt(t) };
  for (const [a, b, d0, d1, amt] of DRIFTS) c.z *= 1 + amt * P(t, a, b) * (1 - eio(P(t, d0, d1)));
  $('cam').style.transform = `translate(${960 - c.cx * c.z}px, ${540 - c.cy * c.z}px) scale(${c.z})`;
  // máscara superior para que la UI no pise el copy
  $('camclip').style.webkitMaskImage = $('camclip').style.maskImage = 'linear-gradient(to bottom, transparent 0px, transparent 150px, #000 186px)';
  renderIntro(t);
  renderSurf(t);
  renderPhone(t);
  renderEnd(t);
  renderCopy(t);
  // cursor
  const cur = $('cur');
  const vo = curVisible(t);
  setOp(cur, vo);
  if (vo > 0) {
    const p = toStage(curAt(t), c);
    let s = 1;
    for (const k of CLICKS) { const d = t - k.t; if (d >= -0.05 && d < 0.22) s = Math.min(s, d < 0.05 ? lerp(1, 0.84, P(d, -0.05, 0.05)) : lerp(0.84, 1, eo(P(d, 0.05, 0.22)))); }
    if ((t >= T.drag[0] && t < T.drag[1] + 0.05) || (t >= T.rot[0] && t < T.rot[1] + 0.05)) s = 0.9;
    cur.style.transform = `translate(${p.x - 3}px, ${p.y - 2}px) scale(${s})`;
  }
  // anillo de click
  const ring = $('ring');
  let rv = 0;
  for (const k of CLICKS) {
    const d = t - k.t;
    if (d >= 0 && d < 0.45) {
      const p = toStage(curAt(k.t), c);
      const x = eo(d / 0.45);
      const r = lerp(8, 30, x);
      Object.assign(ring.style, { left: p.x - r + 'px', top: p.y - r + 'px', width: 2 * r + 'px', height: 2 * r + 'px' });
      rv = 0.55 * (1 - x);
    }
  }
  setOp(ring, rv);
  $('tap').style.display = 'none';
  // negro de entrada y salida (mismo cuadro al principio y al final)
  const b = t < T.lightIn[1] ? 1 - eio(P(t, T.lightIn[0], T.lightIn[1])) : eio(P(t, T.blackIn[0], T.blackIn[1]));
  setOp($('black'), b);
}

window.render = render;
window.ready = init();
