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
const DUR = 45.0;

// ───────────────────────── guion ─────────────────────────
const MSG_U1 = 'Un simulador de tiro oblicuo para 5.º año: que cambien el ángulo y la velocidad y vean el alcance.';
const MSG_U2 = 'Sumá la Luna y Marte para comparar con la Tierra.';
const MSG_A1 = [['Listo: '], ['ángulo y velocidad', 1], [' con controles, y abajo el alcance, la altura máxima y el tiempo de vuelo.']];
const MSG_A2 = [['Hecho: sumé '], ['Tierra, Luna y Marte', 1], ['. Los tiros anteriores quedan dibujados para comparar.']];

const T = {
  lightIn: [0.6, 2.0], kIn: 0.9, starIn: 2.0, blinks: [3.0, 3.5], kOut: 4.4,
  noteIn: 4.55, lines: [5.05, 5.4, 5.75, 6.05], strikes: [6.5, 6.75], hls: [7.2, 7.4],
  morph1: 8.0,
  type1: [10.1, 13.0], click1: 10.0, send1: 13.5,
  st1: [[14.0, 'Pensando cómo resolverlo'], [15.0, 'Armando el recurso'], [16.0, 'Probando el recurso…']],
  genEnd: 17.0, a1: 17.0,
  drag: [19.0, 19.8], launch1: 20.5,
  click2: 23.0, type2: [23.1, 24.5], send2: 25.0,
  st2: [[25.2, 'Pensando cómo resolverlo'], [25.5, 'Armando el recurso']],
  v2: 25.8, luna: 28.0, launch2: 28.5,
  code: 30.5, copyUrl: 31.5,
  phoneIn: 32.0, phoneLoad: 32.3, phoneOut: 34.4,
  publish: 35.5, navGal: 36.5, like: 38.0,
  morph2: 40.0, wm: 41.2, tag: 42.2, blackIn: [43.8, 44.85],
};

const COPIES = [
  [5.0, 6.95, [['Para crearlo,'], ['hay que programar.', 1]]],
  [7.0, 8.35, [['Con Kodu,'], ['se conversa.', 1]]],
  [8.5, 14.75, [['Vos explicás.'], ['Kodu programa.', 1]]],
  [14.85, 17.35, [['En'], ['segundos.', 1]]],
  [17.5, 22.3, [['Lo'], ['probás.', 1]]],
  [22.5, 29.95, [['Lo'], ['ajustás.', 1]]],
  [30.0, 31.45, [['Sin tocar'], ['el código.', 1]]],
  [31.5, 34.85, [['Un link,'], ['al aula.', 1]]],
  [35.0, 39.9, [['Compartido'], ['entre colegas.', 1]]],
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

// ───────────────────────── simulador (réplica de public/demos/tiro-oblicuo.html) ─────────────────────────
function simAt(acts, t) {
  let st = null;
  const launches = [];
  for (const a of acts) {
    if (a.t > t) break;
    if (a.type === 'load') {
      st = { ang: 45, vel: 28, g: 9.8, planeta: 'Tierra', loadT: a.t };
      launches.length = 0;
    } else if (a.type === 'set') Object.assign(st, a.v);
    else if (a.type === 'launch') launches.push({ t: a.t });
  }
  if (!st) return null;
  for (const a of acts) {
    if (a.type === 'drag' && a.t <= t && a.t >= st.loadT) {
      st.ang = Math.round(lerp(a.from, a.to, eio(P(t, a.t, a.t1))));
    }
  }
  // Cada lanzamiento usa los parámetros vigentes en su momento.
  const fant = [];
  let estela = [];
  let volando = false;
  for (let i = 0; i < launches.length; i++) {
    const L = launches[i];
    const par = paramsAt(acts, L.t, st.loadT);
    const rad = (par.ang * Math.PI) / 180;
    const vuelo = (2 * par.vel * Math.sin(rad)) / par.g;
    const alcance = (par.vel ** 2 * Math.sin(2 * rad)) / par.g;
    const tEnd = i + 1 < launches.length ? launches[i + 1].t : t;
    const n = Math.floor((tEnd - L.t) * 60 + 1e-6);
    const pts = [];
    let landed = false;
    let tt = 0;
    for (let k = 1; k <= n; k++) {
      tt += vuelo / 90;
      const x = par.vel * Math.cos(rad) * tt;
      const y = par.vel * Math.sin(rad) * tt - 0.5 * par.g * tt * tt;
      if (y <= 0) {
        pts.push({ x: alcance, y: 0 });
        landed = true;
        break;
      }
      pts.push({ x, y });
    }
    if (landed) {
      fant.push(pts.slice());
      if (fant.length > 4) fant.shift();
    }
    estela = pts;
    volando = !landed;
  }
  return { ...st, estela, fant, volando };
}
function paramsAt(acts, t, loadT) {
  const st = { ang: 45, vel: 28, g: 9.8 };
  for (const a of acts) {
    if (a.t > t || a.t < loadT) continue;
    if (a.type === 'set') Object.assign(st, a.v);
    if (a.type === 'drag') st.ang = Math.round(lerp(a.from, a.to, eio(P(t, a.t, a.t1))));
  }
  return st;
}

function simDraw(cv, S, cssW, cssH) {
  const ctx = cv.getContext('2d');
  const dpr = cv.width / cssW;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ancho = cssW, alto = cssH;
  const rad = (S.ang * Math.PI) / 180;
  const alcance = (S.vel ** 2 * Math.sin(2 * rad)) / S.g;
  const alturaMax = (S.vel ** 2 * Math.sin(rad) ** 2) / (2 * S.g);
  const margen = 40;
  const e = Math.min((ancho - margen * 2) / Math.max(alcance, 1), (alto - margen * 2) / Math.max(alturaMax, 1));
  const piso = alto - 28;
  const x0 = 30;
  ctx.clearRect(0, 0, ancho, alto);
  ctx.strokeStyle = '#26304f';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#6f78a0';
  ctx.font = '11px system-ui, sans-serif';
  const pasoM = alcance > 400 ? 100 : alcance > 120 ? 40 : alcance > 60 ? 20 : 10;
  for (let m = 0; m * e + x0 < ancho; m += pasoM) {
    const px = x0 + m * e;
    ctx.beginPath(); ctx.moveTo(px, piso); ctx.lineTo(px, piso - 6); ctx.stroke();
    if (m > 0) ctx.fillText(m + ' m', px - 10, piso + 16);
  }
  ctx.strokeStyle = '#414d78'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, piso); ctx.lineTo(ancho, piso); ctx.stroke();
  for (const f of S.fant) {
    ctx.strokeStyle = 'rgba(255,200,87,.18)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    f.forEach((p, i) => (i ? ctx.lineTo(x0 + p.x * e, piso - p.y * e) : ctx.moveTo(x0 + p.x * e, piso - p.y * e)));
    ctx.stroke();
  }
  ctx.save(); ctx.translate(x0, piso); ctx.rotate(-rad);
  ctx.fillStyle = '#8d95b2'; ctx.beginPath(); ctx.roundRect(0, -5, 34, 10, 3); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#5b688f'; ctx.beginPath(); ctx.arc(x0, piso, 9, 0, Math.PI * 2); ctx.fill();
  if (S.estela.length) {
    ctx.strokeStyle = '#ffc857'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.beginPath();
    S.estela.forEach((p, i) => (i ? ctx.lineTo(x0 + p.x * e, piso - p.y * e) : ctx.moveTo(x0 + p.x * e, piso - p.y * e)));
    ctx.stroke();
    const u = S.estela[S.estela.length - 1];
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x0 + u.x * e, piso - u.y * e, 6, 0, Math.PI * 2); ctx.fill();
  }
  if (!S.volando && S.estela.length) {
    const cima = S.estela.reduce((a, b) => (b.y > a.y ? b : a));
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x0 + cima.x * e, piso - cima.y * e); ctx.lineTo(x0 + cima.x * e, piso); ctx.stroke();
    ctx.setLineDash([]);
  }
  return { alcance, alturaMax, vuelo: (2 * S.vel * Math.sin(rad)) / S.g };
}

const WS_ACTS = [
  { t: 15.0, type: 'load' },
  { t: T.genEnd, type: 'launch' },
  { t: T.drag[0], t1: T.drag[1], type: 'drag', from: 45, to: 62 },
  { t: T.launch1, type: 'launch' },
  { t: T.v2, type: 'load' },
  { t: T.v2 + 0.6, type: 'launch' },
  { t: T.luna, type: 'set', v: { g: 1.6, planeta: 'Luna' } },
  { t: T.launch2, type: 'launch' },
].sort((a, b) => a.t - b.t);
const PH_ACTS = [{ t: T.phoneLoad, type: 'load' }, { t: T.phoneLoad + 0.6, type: 'launch' }];

// ───────────────────────── contenido estático ─────────────────────────
const CODE = [
  [['c', '// Cambiar de planeta cambia la gravedad']],
  [['k', 'for '], ['', '('], ['k', 'const '], ['v', 'b '], ['k', 'of '], ['', 'document.'], ['f', 'querySelectorAll'], ['', '('], ['s', "'.planetas button'"], ['', ')) {']],
  [['', '  b.'], ['f', 'addEventListener'], ['', '('], ['s', "'click'"], ['', ', () '], ['k', '=> '], ['', '{']],
  [['', '    estado.g '], ['k', '= '], ['f', 'parseFloat'], ['', '(b.dataset.g);']],
  [['', '    estado.planeta '], ['k', '= '], ['', 'b.textContent;']],
  [['', '    '], ['f', 'actualizarDatos'], ['', '();']],
  [['', '  });']],
  [['', '}']],
  [['', '']],
  [['k', 'function '], ['f', 'animar'], ['', '() {']],
  [['', '  '], ['k', 'if '], ['', '(volando) {']],
  [['', '    t '], ['k', '+= '], ['f', 'vuelo'], ['', '() / '], ['nm', '90'], ['', ';']],
  [['', '    '], ['k', 'const '], ['v', 'x '], ['k', '= '], ['', 'estado.vel * Math.'], ['f', 'cos'], ['', '('], ['f', 'rad'], ['', '()) * t;']],
  [['', '    '], ['k', 'const '], ['v', 'y '], ['k', '= '], ['', 'estado.vel * Math.'], ['f', 'sin'], ['', '('], ['f', 'rad'], ['', '()) * t']],
  [['', '            - '], ['nm', '0.5'], ['', ' * estado.g * t * t;']],
  [['', '    '], ['k', 'if '], ['', '(y '], ['k', '<= '], ['nm', '0'], ['', ') {']],
  [['', '      volando '], ['k', '= '], ['nm', 'false'], ['', ';']],
  [['', '      fantasmas.'], ['f', 'push'], ['', '([...estela]);']],
  [['', '    } '], ['k', 'else '], ['', 'estela.'], ['f', 'push'], ['', '({ x, y });']],
  [['', '  }']],
  [['', '  '], ['f', 'dibujar'], ['', '();']],
  [['', '  '], ['f', 'requestAnimationFrame'], ['', '(animar);']],
  [['', '}']],
];

const CARDS = [
  { id: 'celula', t: 'Célula animal en 3D', by: 'Martín Acosta', d: 'Una célula que se gira y explica cada organelo al tocarlo. Para 7.º grado.', n: 23 },
  { id: 'func', t: 'Explorador de funciones', by: 'Carla Benítez', d: 'Cuadrática, seno y exponencial con coeficientes regulables. 4.º año.', n: 18 },
  { id: 'tabla', t: 'Tabla periódica interactiva', by: 'Diego Ferreyra', d: 'Las propiedades de cada elemento al tocarlo. Química, 3.º año.', n: 15 },
  { id: 'mayo', t: 'Revolución de Mayo', by: 'Sofía Ruiz', d: 'Línea de tiempo con los hitos desplegables. Para 5.º grado.', n: 12 },
  { id: 'flash', t: 'Flashcards de inglés', by: 'Julián Paz', d: 'Vocabulario con repetición espaciada, para repasar en casa. 1.º año.', n: 9 },
  { id: 'tiro', t: 'Tiro oblicuo', by: 'Paula Gómez', d: 'Ángulo, velocidad y planeta regulables para comparar tiros. 5.º año.', n: 0 },
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
  M.rAng = rectOf($('rAng'));
  $('plan').style.display = 'none';
  M.lanzar1 = rectOf($('lanzar'));
  M.rAng1 = rectOf($('rAng'));
  $('plan').style.display = 'grid';
  M.lanzar2 = rectOf($('lanzar'));
  M.pL = rectOf($('pL'));
  M.card = rectOf($('card-celula'));
  M.like = rectOf($('like-celula'));
  M.win = rectOf($('win'));
  // tamaños de lienzo (css del recurso)
  const lz = $('lz');
  M.lzW = lz.offsetWidth; M.lzH = lz.offsetHeight;
  $('plan').style.display = 'none';
  M.lzW1 = lz.offsetWidth; M.lzH1 = lz.offsetHeight;
  $('plan').style.display = 'grid';
  const cv = $('cv');
  cv.width = Math.round(M.lzW * 2.5); cv.height = Math.round(M.lzH * 2.5);
  cv.style.width = M.lzW + 'px'; cv.style.height = M.lzH + 'px';
  const mlz = $('mlz');
  M.mW = mlz.offsetWidth; M.mH = mlz.offsetHeight;
  const mcv = $('mcv');
  mcv.width = Math.round(M.mW * 2.5); mcv.height = Math.round(M.mH * 2.5);
  mcv.style.width = M.mW + 'px'; mcv.style.height = M.mH + 'px';
  // slider: posición del thumb por valor
  M.angX = (v, r = M.rAng1) => r.x + ((v - 10) / (85 - 10)) * r.w;
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
  CAM = [
    [9.0, 9.7, chatZoom],
    [13.65, 14.25, C0],
    [18.2, 18.8, prevBody],
    [22.3, 22.9, chatZoom],
    [26.85, 27.45, prevFull],
    [32.0, 32.6, phoneV],
    [34.4, 35.0, C0],
    [37.0, 37.6, cardZ],
    [40.0, 40.8, C0],
  ];
  const c = (r, dx = 0, dy = 0) => ({ x: r.cx + dx, y: r.cy + dy });
  const idle1 = { x: M.pbody.x + M.pbody.w * 0.62, y: M.pbody.y + M.pbody.h * 0.82 };
  // [t0, t1, destino]  (destino en layout; función para el arrastre)
  CUR = [
    [8.8, 8.8, { x: 1540, y: 930 }],
    [9.05, 9.9, c(M.ta, -40, 6)],
    [13.0, 13.45, c(M.send, 10, 4)],
    [13.7, 14.5, idle1],
    [18.3, 18.95, { x: M.angX(45), y: M.rAng1.cy }],
    [19.0, 19.8, 'drag'],
    [20.0, 20.45, c(M.lanzar1, 8, 2)],
    [20.8, 21.6, { x: M.lanzar1.cx + 60, y: M.lanzar1.cy + 110 }],
    [22.35, 22.95, c(M.ta, -40, 6)],
    [24.55, 24.95, c(M.send, 10, 4)],
    [25.1, 25.9, idle1],
    [27.4, 27.95, c(M.pL, 4, 2)],
    [28.05, 28.45, c(M.lanzar2, 8, 2)],
    [29.4, 30.45, c(M.tabCode, 2, 2)],
    [30.8, 31.45, c(M.copyUrl, 4, 2)],
    [34.5, 35.45, c(M.sw, 2, 1)],
    [35.6, 36.45, c(M.navGal, 0, 2)],
    [37.0, 37.95, c(M.like, -6, 1)],
    [38.4, 39.2, c(M.like, 70, 46)],
  ];
  // clicks
  click(T.click1, 'ta');
  click(T.send1, 'send');
  click(T.drag[0], null);
  click(T.launch1, 'lanzar');
  click(T.click2, 'ta');
  click(T.send2, 'send');
  click(T.luna, 'pL');
  click(T.launch2, 'lanzar');
  click(T.code, 'tabCode');
  click(T.copyUrl, 'copyUrl');
  click(T.publish, 'pub');
  click(T.navGal, 'navGal');
  click(T.like, 'like-celula');
  // teclas
  const keys = (txt, a, b) => { for (let i = 0; i < txt.length; i++) ev(a + ((b - a) * (i + 1)) / txt.length - 0.01, 'key'); };
  keys(MSG_U1, ...T.type1);
  keys(MSG_U2, ...T.type2);
  // lapicera
  T.lines.forEach((t0) => { for (let k = 0; k < 6; k++) ev(t0 + k * 0.05, 'pen'); });
  // tics
  T.strikes.forEach((t) => ev(t, 'tick'));
  T.st1.forEach(([t]) => ev(t, 'tick'));
  T.st2.forEach(([t]) => ev(t, 'tick'));
  ev(T.genEnd, 'tick');
  // soplos
  [T.morph1, 15.0, T.v2, T.phoneIn, T.navGal + 0.05, T.morph2, T.wm].forEach((t) => ev(t, 'whoosh'));
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

function dragPos(t) {
  const v = lerp(45, 62, eio(P(t, T.drag[0], T.drag[1])));
  return { x: M.angX(v), y: M.rAng1.cy };
}
function curAt(t) {
  let p = CUR[0][2];
  for (const [a, b, d] of CUR) {
    if (d === 'drag') {
      if (t >= a) p = dragPos(Math.min(t, b));
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
  if (t >= 31.8 && t < 34.5) return 1 - P(t, 31.8, 32.05);
  if (t >= 34.5 && t < 39.6) return P(t, 34.5, 34.75);
  if (t >= 39.6) return 1 - P(t, 39.6, 39.9);
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

  // ventana
  const win = $('win'), gal = $('gal');
  const wIn = P(t, T.morph1 + 0.4, T.morph1 + 0.75);
  const gIn = P(t, T.navGal + 0.05, T.navGal + 0.35);
  const allOut = P(t, T.morph2, T.morph2 + 0.22);
  const wo = wIn * (1 - gIn);
  setOp(win, wo);
  win.style.display = wo > 0 ? 'block' : 'none';
  win.style.filter = wIn > 0 && wIn < 1 ? `blur(${(1 - wIn) * 5}px)` : gIn > 0 && gIn < 1 ? `blur(${gIn * 4}px)` : 'none';
  const go = gIn * (1 - allOut);
  gal.style.display = go > 0 ? 'block' : 'none';
  setOp(gal, go);
  gal.style.filter = (gIn > 0 && gIn < 1) ? `blur(${(1 - gIn) * 4}px)` : (allOut > 0 && allOut < 1) ? `blur(${allOut * 6}px)` : 'none';
  if (wo > 0) renderWin(t);
  if (go > 0) renderGal(t);
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
  if (show('ma2', T.v2)) $('ma2').innerHTML = streamHtml(MSG_A2, Math.floor((t - T.v2) * 110));
  show('undo2', T.v2 + lenOf(MSG_A2) / 110 + 0.1);

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
  if (t >= T.click1 && t < T.send1) { focus = true; typed = MSG_U1.slice(0, Math.floor(MSG_U1.length * P(t, ...T.type1))); }
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

function renderApp(t) {
  const app = $('app');
  if (t < 15.0) { app.style.display = 'none'; return; }
  app.style.display = 'flex';
  const v2 = t >= T.v2;
  // se arma en vivo mientras se genera (15 → 16.6)
  const parts = [...app.querySelectorAll('header, .lz, .ctl, .lanzar, .datos')];
  const stepT = [15.0, 15.4, 15.8, 16.0, 16.3, 16.6];
  parts.forEach((el, i) => { const x = eo(P(t, stepT[i], stepT[i] + 0.3)); el.style.opacity = x; el.style.transform = `translateY(${(1 - x) * 8}px)`; });
  // recarga de la v2: un parpadeo corto del iframe
  app.style.opacity = t >= T.v2 && t < T.v2 + 0.25 ? eo(P(t, T.v2, T.v2 + 0.25)) : 1;
  $('plan').style.display = v2 ? 'grid' : 'none';
  $('app').querySelector('.pista').textContent = v2 ? 'Cambiá el ángulo, la velocidad y el planeta. Después lanzá.' : 'Cambiá el ángulo y la velocidad. Después lanzá.';
  const S = simAt(WS_ACTS, t);
  if (!S) return;
  const lz = $('lz');
  const W = v2 ? M.lzW : M.lzW1, H = v2 ? M.lzH : M.lzH1;
  const cv = $('cv');
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  if (cv.width !== Math.round(W * 2.5)) { cv.width = Math.round(W * 2.5); cv.height = Math.round(H * 2.5); }
  const d = simDraw(cv, S, W, H);
  $('vang').textContent = S.ang + '°';
  $('vvel').textContent = S.vel + ' m/s';
  setRange($('rAng'), S.ang, 10, 85);
  setRange($('rVel'), S.vel, 10, 45);
  ['pT', 'pL', 'pM'].forEach((id) => { $(id).className = S.planeta === $(id).textContent ? 'on' : ''; });
  $('pL').style.transform = `scale(${pressScale('pL', t)})`;
  $('lanzar').style.transform = `scale(${pressScale('lanzar', t)})`;
  $('datos').innerHTML = `Alcance <b>${d.alcance.toFixed(1)} m</b><br>Altura máxima <b>${d.alturaMax.toFixed(1)} m</b><br>Tiempo de vuelo <b>${d.vuelo.toFixed(2)} s</b><br>Gravedad en ${S.planeta} <b>${S.g} m/s²</b>`;
}
function setRange(el, v, a, b) {
  const f = (v - a) / (b - a);
  el.querySelector('.fi').style.width = f * 100 + '%';
  el.querySelector('.th').style.left = f * 100 + '%';
}

function renderPhone(t) {
  const ph = $('phone');
  const inX = spr(P(t, T.phoneIn + 0.1, T.phoneIn + 0.9));
  const outX = eio(P(t, T.phoneOut, T.phoneOut + 0.5));
  const vis = t >= T.phoneIn && t < T.phoneOut + 0.5;
  ph.style.display = vis ? 'block' : 'none';
  if (!vis) return;
  ph.style.left = 1832 + (1 - inX) * 260 + outX * 300 + 'px';
  ph.style.top = 252 + 'px';
  ph.style.opacity = eo(P(t, T.phoneIn + 0.1, T.phoneIn + 0.45)) * (1 - outX);
  ph.style.filter = (inX < 0.6 && inX > 0) ? `blur(${(0.6 - inX) * 6}px)` : outX > 0 ? `blur(${outX * 5}px)` : 'none';
  $('phone').querySelector('.mapp').style.opacity = eo(P(t, T.phoneLoad, T.phoneLoad + 0.25));
  const S = simAt(PH_ACTS, t) || simAt(PH_ACTS, T.phoneLoad);
  simDraw($('mcv'), S, M.mW, M.mH);
  setRange($('mrA'), 45, 10, 85); setRange($('mrV'), 28, 10, 45);
}

function renderGal(t) {
  const liked = t >= T.like;
  const el = $('like-celula');
  el.querySelector('.hs').innerHTML = HEART.replace('FILL', liked ? '#dc2626' : 'none');
  el.style.color = liked ? '#dc2626' : '';
  el.querySelector('.cnt').textContent = liked ? '24' : '23';
  el.style.transform = `scale(${liked ? 1 + 0.18 * Math.sin(Math.PI * P(t, T.like, T.like + 0.3)) : pressScale('like-celula', t)})`;
  el.style.display = 'flex';
  el.style.transformOrigin = '30% 50%';
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
const DRIFTS = [[1.4, 4.4, 4.4, 5.2, 0.035], [32.6, 34.4, 34.4, 35.0, 0.03], [37.6, 40.0, 40.0, 40.8, 0.03], [41.4, 44.85, 99, 100, 0.025]];
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
    if (t >= T.drag[0] && t < T.drag[1] + 0.05) s = 0.9;
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
