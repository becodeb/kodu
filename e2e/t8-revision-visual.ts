import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { fingerprintHtml } from '../src/lib/ai/revision-visual.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';
import type { BrowserContext, Page } from 'playwright';

/**
 * Chequeo de navegador + API de T8 (odd/tasks/modo-prime.md, "Revisión
 * visual con captura"). Requiere la pila de desarrollo levantada
 * (`docker compose up -d db`, `npm run dev` en el puerto 3000) y REUSA el
 * AiProvider/AiModel mock que dejó T3 (kind "kodu-mock-t3", providerModel
 * "mock-t3") — mismo patrón que e2e/t4-deshacer.ts, t6 y t7. Además prende
 * `supportsVision` en ese motor (T8 exige un motor que vea imágenes) y lo
 * restaura al final; `.env` ya trae `AI_VISION="true"` en este entorno.
 *
 * Corre con: npx tsx e2e/t8-revision-visual.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const PRIME_EMAIL = 'docente-e2e-t8-prime@kodu.local';
const PRIME_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_KIND = 'kodu-mock-t3';
const PROVIDER_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-t3';
const MODEL_DISPLAY_NAME = 'Mock local (T3+)';

const SCREENSHOT_DIR = '/tmp/kodu-t8';

/** 1×1 PNG transparente, el data URL de relleno más usado de la web —
 *  alcanza para las escenas que llaman al endpoint directo (sin pasar por
 *  el puente real de captura, que sí se ejercita en la escena de navegador
 *  al final). */
const PNG_DE_PRUEBA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────
// HTML de prueba: limpio (sin hallazgos de T7 — mismo tema, mismo ícono
// válido, sin emojis/degradados/relleno) para que ninguna escena dispare
// sin querer la corrección automática de T7 y confunda el conteo de
// llamadas al mock.
// ─────────────────────────────────────────────────────────────

function htmlLimpio(marca: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="pizarron">
<title>T8 ${marca}</title>
</head>
<body data-marca="${marca}">
  <h1>Practicá la tabla del 7</h1>
  <p><i data-lucide="calculator"></i> Elegí la respuesta correcta.</p>
</body>
</html>`;
}

/** Mismo HTML limpio, pero con un emoji NUEVO — para la escena "la
 *  corrección introduce un hallazgo y se descarta". */
function htmlConEmojiNuevo(marca: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="pizarron">
<title>T8 ${marca}</title>
</head>
<body data-marca="${marca}">
  <h1>Practicá la tabla del 7 🎉</h1>
  <p><i data-lucide="calculator"></i> Elegí la respuesta correcta.</p>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// Helpers (mismo patrón que e2e/t7-revision-automatica.ts)
// ─────────────────────────────────────────────────────────────

async function asegurarDocente(email: string, password: string, nombre: string): Promise<string> {
  const fila = await prisma.user.upsert({
    where: { email },
    update: { role: 'DOCENTE' },
    create: { email, name: nombre, role: 'DOCENTE', passwordHash: await hashPassword(password) },
    select: { id: true },
  });
  return fila.id;
}

async function asegurarMotorMock(adminPage: Page, mockUrl: string): Promise<string> {
  // Only a live, keyed account: the dev DB accumulates disabled leftovers under
  // the shared kind, and picking one silently falls back to the default model.
  const proveedorExistente = await prisma.aiProvider.findFirst({
    where: { kind: PROVIDER_KIND, enabled: true, apiKeyCipher: { not: null } },
    orderBy: { id: 'asc' },
  });
  let providerId = proveedorExistente?.id ?? null;

  if (!providerId) {
    const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/providers`, {
      data: { kind: PROVIDER_KIND, label: PROVIDER_LABEL, baseUrl: mockUrl, apiKey: 'clave-de-prueba-del-mock' },
    });
    assert.equal(respuesta.status(), 200, `alta de la cuenta mock: ${respuesta.status()} ${await respuesta.text()}`);
    providerId = ((await respuesta.json()) as { proveedor: { id: string } }).proveedor.id;
  }

  const modeloExistente = await prisma.aiModel.findFirst({ where: { providerId, providerModel: MODEL_PROVIDER_MODEL } });
  let modelId = modeloExistente?.id ?? null;

  if (!modelId) {
    const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/models`, {
      data: {
        providerId,
        providerModel: MODEL_PROVIDER_MODEL,
        displayName: MODEL_DISPLAY_NAME,
        description: 'Proveedor simulado para chequeos de navegador. No usar con docentes reales.',
        selectableByTeacher: true,
      },
    });
    assert.equal(respuesta.status(), 200, `alta del motor mock: ${respuesta.status()} ${await respuesta.text()}`);
    modelId = ((await respuesta.json()) as { motor: { id: string } }).motor.id;
  } else if (!modeloExistente!.selectableByTeacher || !modeloExistente!.enabled) {
    await prisma.aiModel.update({ where: { id: modelId }, data: { selectableByTeacher: true, enabled: true } });
  }

  return modelId;
}

async function fijarSettings(adminPage: Page, datos: Record<string, boolean>): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/settings`, { data: datos });
  assert.ok(respuesta.ok(), `PATCH /api/admin/settings ${JSON.stringify(datos)}: ${respuesta.status()} ${await respuesta.text()}`);
}

async function fijarVision(adminPage: Page, modelId: string, supportsVision: boolean): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/models/${modelId}`, {
    data: { supportsVision },
  });
  assert.ok(respuesta.ok(), `PATCH supportsVision=${supportsVision}: ${respuesta.status()} ${await respuesta.text()}`);
}

async function crearProyecto(page: Page, title: string, modelId: string): Promise<{ id: string; threadId: string }> {
  const creado = await page.request.post(`${BASE_URL}/api/projects`, { data: { title } });
  assert.equal(creado.status(), 200, `alta del proyecto "${title}": ${creado.status()} ${await creado.text()}`);
  const { project } = (await creado.json()) as { project: { id: string; threadId: string } };
  await prisma.project.update({ where: { id: project.id }, data: { aiModelId: modelId } });
  return project;
}

interface EventoSse {
  type: string;
  [key: string]: unknown;
}

async function cookieHeaderDe(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies(BASE_URL);
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/** Manda un turno por la API cruda (sin streaming detallado) y devuelve el evento "done". */
async function enviarTurnoPorApi(
  page: Page,
  args: { projectId: string; threadId: string; message: string; modelId: string; speed?: 'fast' | 'deep' },
): Promise<{ status: number; done: EventoSse | null }> {
  const resp = await page.request.post(`${BASE_URL}/api/chat/stream`, {
    data: {
      projectId: args.projectId,
      threadId: args.threadId,
      message: args.message,
      model: args.modelId,
      ...(args.speed ? { speed: args.speed } : {}),
    },
  });
  return { status: resp.status(), done: resp.status() === 200 ? extraerDone(await resp.text()) : null };
}

function extraerDone(cuerpoSse: string): EventoSse | null {
  const eventos = eventosDe(cuerpoSse);
  return eventos.find((e) => e.type === 'done') ?? null;
}

function eventosDe(cuerpoSse: string): EventoSse[] {
  return cuerpoSse
    .split('\n\n')
    .map((bloque) =>
      bloque
        .split('\n')
        .filter((linea) => linea.startsWith('data:'))
        .map((linea) => linea.slice(5).trim())
        .join(''),
    )
    .filter((linea) => linea && linea !== '[DONE]')
    .map((linea) => {
      try {
        return JSON.parse(linea) as EventoSse;
      } catch {
        return null;
      }
    })
    .filter((evento): evento is EventoSse => evento !== null);
}

/** POST directo a /api/chat/visual-review (sin pasar por el puente de
 *  captura real): para las escenas que ejercitan el ENDPOINT, no la
 *  captura del navegador — esa se ejercita aparte, en la escena final. */
async function pedirRevisionVisual(
  page: Page,
  args: { projectId: string; dataUrl?: string; fingerprint: string },
): Promise<{ status: number; body: string; eventos: EventoSse[] }> {
  const resp = await page.request.post(`${BASE_URL}/api/chat/visual-review`, {
    data: { projectId: args.projectId, dataUrl: args.dataUrl ?? PNG_DE_PRUEBA, fingerprint: args.fingerprint },
  });
  const status = resp.status();
  const body = await resp.text();
  return { status, body, eventos: status === 200 ? eventosDe(body) : [] };
}

/** Igual que arriba, pero con `fetch` crudo + AbortController — para poder
 *  cortar el pedido a mitad de camino (escena "Detener"). */
async function pedirRevisionVisualAbortable(
  cookie: string,
  args: { projectId: string; dataUrl?: string; fingerprint: string },
  cortarA: number,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cortarA);

  try {
    const respuesta = await fetch(`${BASE_URL}/api/chat/visual-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ projectId: args.projectId, dataUrl: args.dataUrl ?? PNG_DE_PRUEBA, fingerprint: args.fingerprint }),
      signal: controller.signal,
    });
    // Si el servidor ya había terminado (mock rápido) antes de que el timer
    // dispare, no hay nada que abortar: se consume el body igual.
    if (respuesta.body) {
      const reader = respuesta.body.getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    }
  } catch (error) {
    if ((error as Error).name !== 'AbortError') throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function proyectoActual(id: string): Promise<{ currentHtml: string }> {
  return prisma.project.findUniqueOrThrow({ where: { id }, select: { currentHtml: true } });
}

async function main(): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const primeId = await asegurarDocente(PRIME_EMAIL, PRIME_PASSWORD, 'Docente E2E T8 (prime)');

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  const browser = await abrirNavegador();
  let modelId = '';
  let visionOriginal: boolean | null = null;

  try {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    modelId = await asegurarMotorMock(adminPage, mock.url);
    console.log(`✔ motor mock listo (${modelId})`);

    const filaOriginal = await prisma.aiModel.findUniqueOrThrow({ where: { id: modelId }, select: { supportsVision: true } });
    visionOriginal = filaOriginal.supportsVision;
    await fijarVision(adminPage, modelId, true);
    console.log(`✔ supportsVision del mock prendido (era ${visionOriginal})`);

    await adminPage.request.patch(`${BASE_URL}/api/admin/users/${primeId}`, { data: { primeAccess: true } });
    await fijarSettings(adminPage, { primeEnabled: true, autoReviewForAll: false, deepModeForAll: false, versionsForAll: false });
    console.log('✔ cuenta prime marcada, prime encendido, "para todos" apagado');

    const primeContext = await browser.newContext();
    const primePage = await primeContext.newPage();
    await iniciarSesion(primePage, { email: PRIME_EMAIL, password: PRIME_PASSWORD });
    const cookiePrime = await cookieHeaderDe(primeContext);

    // ───────────────────────────────────────────────────────────
    // Escena A — A fondo + motor con visión: el "done" del turno normal
    // ofrece la revisión, y un resultado cambiado se aplica y persiste.
    // ───────────────────────────────────────────────────────────
    const proyectoA = await crearProyecto(primePage, 'T8 — cambia', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlLimpio('a1'), chunkDelayMs: 5, chunkBytes: 20_000 });
    const turnoA = await enviarTurnoPorApi(primePage, {
      projectId: proyectoA.id,
      threadId: proyectoA.threadId,
      message: 'Armame algo simple (ESCENA-A)',
      modelId,
      speed: 'deep',
    });
    assert.equal(turnoA.status, 200);
    assert.equal(turnoA.done?.revisionVisualDisponible, true, 'A fondo + visión + cambió el recurso → se ofrece');
    assert.equal(mock.llamadas.length, 1, 'el turno normal es UNA sola llamada (html limpio, sin corrección de T7)');
    console.log('✔ escena A (1/3): el "done" del turno normal trae revisionVisualDisponible: true');

    const htmlTrasTurnoA = (await proyectoActual(proyectoA.id)).currentHtml;
    mock.programarRespuesta({ texto: '', html: htmlLimpio('a2-mejorado'), chunkDelayMs: 5, chunkBytes: 20_000 });
    const revisionA = await pedirRevisionVisual(primePage, {
      projectId: proyectoA.id,
      fingerprint: fingerprintHtml(htmlTrasTurnoA),
    });
    assert.equal(revisionA.status, 200, revisionA.body);
    assert.equal(mock.llamadas.length, 2, 'la revisión visual es UNA llamada más al mismo motor');
    console.log('✔ escena A (2/3): un resultado cambiado dispara UNA llamada más al mismo motor');

    const segundoPedido = mock.llamadas[1]!.body as {
      messages: Array<{ role: string; content: unknown }>;
      tool_choice: unknown;
    };
    assert.equal(segundoPedido.tool_choice, 'auto', 'la herramienta NO se fuerza en la revisión visual');
    const mensajeUsuario = segundoPedido.messages[1]!;
    assert.equal(mensajeUsuario.role, 'user');
    const partes = mensajeUsuario.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    const parteTexto = partes.find((p) => p.type === 'text');
    const parteImagen = partes.find((p) => p.type === 'image_url');
    assert.ok(parteTexto, 'el mensaje tiene que traer la instrucción de crítica en texto');
    assert.ok(/diseñador exigente/i.test(parteTexto!.text ?? ''), 'la instrucción es la de revisión visual');
    assert.ok(parteImagen, 'el mensaje tiene que traer la imagen');
    assert.match(parteImagen!.image_url!.url, /^data:image\//, 'la imagen viaja como data URL');
    console.log('✔ escena A (3/3): el pedido lleva image_url (data:image/…) + la instrucción, con tool_choice "auto"');

    const codeA = revisionA.eventos.find((e) => e.type === 'code');
    const doneA = revisionA.eventos.find((e) => e.type === 'done');
    assert.ok(codeA, 'tiene que llegar un "code" con el resultado nuevo');
    assert.ok((codeA!.html as string).includes('data-marca="a2-mejorado"'));
    assert.equal(doneA?.codeUpdated, true);
    const proyectoTrasA = await proyectoActual(proyectoA.id);
    assert.ok(proyectoTrasA.currentHtml.includes('data-marca="a2-mejorado"'), 'el resultado nuevo queda persistido');
    console.log('✔ escena A: el resultado cambiado se aplica y se persiste');

    // ───────────────────────────────────────────────────────────
    // Escena B — el modelo contesta "Sin cambios." (no llama la
    // herramienta): no hay "code", el recurso queda intacto.
    // ───────────────────────────────────────────────────────────
    const proyectoB = await crearProyecto(primePage, 'T8 — sin cambios', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlLimpio('b1'), chunkDelayMs: 5, chunkBytes: 20_000 });
    const turnoB = await enviarTurnoPorApi(primePage, {
      projectId: proyectoB.id,
      threadId: proyectoB.threadId,
      message: 'Armame algo simple (ESCENA-B)',
      modelId,
      speed: 'deep',
    });
    assert.equal(turnoB.done?.revisionVisualDisponible, true);

    const htmlTrasTurnoB = (await proyectoActual(proyectoB.id)).currentHtml;
    mock.programarRespuesta({ texto: 'Sin cambios.', llamarHerramienta: false });
    const revisionB = await pedirRevisionVisual(primePage, {
      projectId: proyectoB.id,
      fingerprint: fingerprintHtml(htmlTrasTurnoB),
    });
    assert.equal(revisionB.status, 200, revisionB.body);
    assert.equal(revisionB.eventos.some((e) => e.type === 'code'), false, '"Sin cambios." no puede traer "code"');
    assert.equal(revisionB.eventos.find((e) => e.type === 'done')?.codeUpdated, false);
    const proyectoTrasB = await proyectoActual(proyectoB.id);
    assert.equal(proyectoTrasB.currentHtml, htmlTrasTurnoB, 'el recurso queda exactamente como lo dejó el turno normal');
    console.log('✔ escena B: "Sin cambios." no toca el recurso');

    // ───────────────────────────────────────────────────────────
    // Escena C — Rápido: el "done" nunca ofrece la revisión (sin llamar al
    // endpoint siquiera: el contrato ya lo impide desde el flag).
    // ───────────────────────────────────────────────────────────
    const proyectoC = await crearProyecto(primePage, 'T8 — rápido', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlLimpio('c1'), chunkDelayMs: 5, chunkBytes: 20_000 });
    const turnoC = await enviarTurnoPorApi(primePage, {
      projectId: proyectoC.id,
      threadId: proyectoC.threadId,
      message: 'Armame algo simple (ESCENA-C)',
      modelId,
      speed: 'fast',
    });
    assert.equal(turnoC.status, 200);
    assert.equal(turnoC.done?.revisionVisualDisponible, false, 'Rápido nunca ofrece la revisión visual');
    assert.equal(mock.llamadas.length, 1, 'ninguna llamada extra');
    console.log('✔ escena C: Rápido → revisionVisualDisponible: false, sin pedido de captura');

    // ───────────────────────────────────────────────────────────
    // Escena D — motor sin visión: tampoco se ofrece, aunque sea A fondo.
    // ───────────────────────────────────────────────────────────
    await fijarVision(adminPage, modelId, false);
    const proyectoD = await crearProyecto(primePage, 'T8 — sin visión', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlLimpio('d1'), chunkDelayMs: 5, chunkBytes: 20_000 });
    const turnoD = await enviarTurnoPorApi(primePage, {
      projectId: proyectoD.id,
      threadId: proyectoD.threadId,
      message: 'Armame algo simple (ESCENA-D)',
      modelId,
      speed: 'deep',
    });
    assert.equal(turnoD.status, 200);
    assert.equal(turnoD.done?.revisionVisualDisponible, false, 'sin supportsVision, A fondo no alcanza');
    await fijarVision(adminPage, modelId, true);
    console.log('✔ escena D: motor sin visión → revisionVisualDisponible: false (restaurado a true después)');

    // ───────────────────────────────────────────────────────────
    // Escena E — huella que no coincide (el docente editó en el medio):
    // 409, y el motor nunca llega a recibir el pedido.
    // ───────────────────────────────────────────────────────────
    const proyectoE = await crearProyecto(primePage, 'T8 — huella vieja', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlLimpio('e1'), chunkDelayMs: 5, chunkBytes: 20_000 });
    await enviarTurnoPorApi(primePage, {
      projectId: proyectoE.id,
      threadId: proyectoE.threadId,
      message: 'Armame algo simple (ESCENA-E)',
      modelId,
      speed: 'deep',
    });
    assert.equal(mock.llamadas.length, 1);

    const revisionE = await pedirRevisionVisual(primePage, {
      projectId: proyectoE.id,
      fingerprint: fingerprintHtml('esto no es el HTML que está en currentHtml'),
    });
    assert.equal(revisionE.status, 409, revisionE.body);
    assert.equal(mock.llamadas.length, 1, 'con la huella desactualizada, el motor NUNCA se llama');
    console.log('✔ escena E: huella desactualizada → 409, sin llamar al motor');

    // ───────────────────────────────────────────────────────────
    // Escena F — el resultado agrega un emoji nuevo: se descarta (log del
    // lado del servidor), el recurso queda como estaba.
    // ───────────────────────────────────────────────────────────
    const proyectoF = await crearProyecto(primePage, 'T8 — se descarta', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlLimpio('f1'), chunkDelayMs: 5, chunkBytes: 20_000 });
    await enviarTurnoPorApi(primePage, {
      projectId: proyectoF.id,
      threadId: proyectoF.threadId,
      message: 'Armame algo simple (ESCENA-F)',
      modelId,
      speed: 'deep',
    });
    const htmlTrasTurnoF = (await proyectoActual(proyectoF.id)).currentHtml;

    mock.programarRespuesta({ texto: '', html: htmlConEmojiNuevo('f2'), chunkDelayMs: 5, chunkBytes: 20_000 });
    const revisionF = await pedirRevisionVisual(primePage, {
      projectId: proyectoF.id,
      fingerprint: fingerprintHtml(htmlTrasTurnoF),
    });
    assert.equal(revisionF.status, 200, revisionF.body);
    assert.equal(revisionF.eventos.some((e) => e.type === 'code'), false, 'un resultado descartado no manda "code"');
    assert.equal(revisionF.eventos.find((e) => e.type === 'done')?.codeUpdated, false);
    const proyectoTrasF = await proyectoActual(proyectoF.id);
    assert.equal(proyectoTrasF.currentHtml, htmlTrasTurnoF, 'el recurso queda EXACTO como lo dejó el turno normal');
    console.log('✔ escena F: un resultado que agrega un emoji nuevo se descarta silenciosamente');

    // ───────────────────────────────────────────────────────────
    // Escena G — "Detener" a mitad de la revisión visual: se corta y el
    // recurso queda con el HTML del turno (nunca a medio escribir).
    // ───────────────────────────────────────────────────────────
    const proyectoG = await crearProyecto(primePage, 'T8 — detener', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlLimpio('g1'), chunkDelayMs: 5, chunkBytes: 20_000 });
    await enviarTurnoPorApi(primePage, {
      projectId: proyectoG.id,
      threadId: proyectoG.threadId,
      message: 'Armame algo simple (ESCENA-G)',
      modelId,
      speed: 'deep',
    });
    const htmlTrasTurnoG = (await proyectoActual(proyectoG.id)).currentHtml;

    // Respuesta lenta a propósito, para poder cortarla a mitad de camino.
    mock.programarRespuesta({ texto: '', html: htmlLimpio('g2-no-tiene-que-llegar'), chunkDelayMs: 400, chunkBytes: 15 });
    await pedirRevisionVisualAbortable(
      cookiePrime,
      { projectId: proyectoG.id, fingerprint: fingerprintHtml(htmlTrasTurnoG) },
      300,
    );
    const proyectoTrasG = await proyectoActual(proyectoG.id);
    assert.equal(proyectoTrasG.currentHtml, htmlTrasTurnoG, '"Detener" no puede dejar nada a medio escribir');
    console.log('✔ escena G: "Detener" durante la revisión visual corta limpio y conserva el HTML del turno');

    // ───────────────────────────────────────────────────────────
    // Escena H — navegador real: la fase "Mirando cómo quedó" se ve en
    // pantalla, después se ve el resultado, y se guarda la imagen que el
    // cliente mandó de verdad (vía el puente de preview.ts) para confirmar
    // que retrata el recurso.
    // ───────────────────────────────────────────────────────────
    const proyectoH = await crearProyecto(primePage, 'T8 — navegador', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlLimpio('h1'), chunkDelayMs: 5, chunkBytes: 20_000 });
    mock.programarRespuesta({ texto: '', html: htmlLimpio('h2-mejorado'), chunkDelayMs: 250, chunkBytes: 25 });

    await primePage.goto(`${BASE_URL}/app/project/${proyectoH.id}`, { waitUntil: 'load' });
    const campoMensaje = primePage.locator('textarea[placeholder="Preguntale a Kodu…"]');
    const botonEnviar = primePage.getByRole('button', { name: 'Enviar' });
    await campoMensaje.click();
    await campoMensaje.pressSequentially('Armame algo simple (ESCENA-H)', { delay: 10 });
    await botonEnviar.click();

    await primePage.getByText('Mirando cómo quedó').waitFor({ timeout: 30_000 });
    // Un respiro extra, sólo para que ESTA captura (ilustrativa, ningún
    // assert depende de ella) atrape el iframe ya pintado: el label puede
    // aparecer un instante antes de que termine de cargar/pintar el HTML
    // del primer pase, que es justo lo que `capturar()` sí espera de
    // verdad (ver escena H (3/3) más abajo, que prueba esa espera real).
    await esperar(400);
    await primePage.screenshot({ path: `${SCREENSHOT_DIR}/1-mirando-como-quedo.png` });
    console.log('✔ escena H (1/3): "Mirando cómo quedó" en pantalla mientras corre la revisión visual');

    const frenteFrame = (pagina: Page) => pagina.frameLocator('iframe[data-kodu-frente="true"]');
    await botonEnviar.waitFor({ state: 'visible', timeout: 30_000 });
    await frenteFrame(primePage).locator('[data-marca="h2-mejorado"]').waitFor({ state: 'attached', timeout: 10_000 });
    await primePage.screenshot({ path: `${SCREENSHOT_DIR}/2-despues-de-mirar.png` });
    console.log(`✔ escena H (2/3): terminó, se ve el resultado de la revisión (capturas en ${SCREENSHOT_DIR})`);

    // La imagen que el cliente mandó de verdad: la relee del pedido que le
    // llegó al mock (el servidor la reenvía tal cual en `image_url.url`).
    const llamadaConImagen = mock.llamadas.find((llamada) => {
      const cuerpo = llamada.body as { messages?: Array<{ content?: unknown }> };
      const mensaje = cuerpo.messages?.[1];
      const partes = mensaje?.content as Array<{ type: string }> | undefined;
      return Array.isArray(partes) && partes.some((p) => p.type === 'image_url');
    });
    assert.ok(llamadaConImagen, 'tiene que haber un pedido con image_url entre los que recibió el mock');
    const partesImagen = (
      (llamadaConImagen!.body as { messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }> })
        .messages[1]!.content
    ).find((p) => p.type === 'image_url')!;
    const dataUrl = partesImagen.image_url!.url;
    const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl);
    assert.ok(match, 'la imagen que se guardó tiene que ser un data URL válido');
    const extension = match![1];
    const bytes = Buffer.from(match![2]!, 'base64');
    assert.ok(bytes.byteLength > 1_000, `la captura real no puede ser minúscula (${bytes.byteLength} bytes)`);
    await writeFile(`${SCREENSHOT_DIR}/captura-enviada.${extension}`, bytes);
    console.log(
      `✔ escena H (3/3): imagen real (${extension}, ${bytes.byteLength} bytes) guardada en ${SCREENSHOT_DIR}/captura-enviada.${extension}`,
    );

    console.log('\n✔ e2e/t8-revision-visual.ts: todas las comprobaciones pasaron');
  } finally {
    try {
      const adminContext2 = await browser.newContext();
      const adminPage2 = await adminContext2.newPage();
      await iniciarSesion(adminPage2, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      if (modelId && visionOriginal !== null) {
        await fijarVision(adminPage2, modelId, visionOriginal);
      }
      await fijarSettings(adminPage2, {
        primeEnabled: false,
        autoReviewForAll: false,
        deepModeForAll: false,
        versionsForAll: false,
      });
      await adminContext2.close();
      console.log('✔ limpieza: supportsVision del mock restaurado; prime y "para todos" apagados');
    } catch (error) {
      console.error('[t8-revision-visual] no se pudo restaurar el estado al final:', error);
    }

    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
await esperar(0);
console.log('\n✔ e2e/t8-revision-visual.ts: terminado');
