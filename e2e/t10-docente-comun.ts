import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { DEFAULT_HTML } from '../src/lib/projects.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO, type MockProveedor } from './mock-proveedor.ts';
import type { BrowserContext, Page } from 'playwright';

/**
 * Chequeo de navegador + API de T10 (odd/tasks/modo-prime.md, "Verificación
 * de punta a punta y documentación"), punto 1: guardia de invariante para un
 * docente común. Esta cuenta NUNCA se marca (`primeAccess` queda en `false`
 * todo el script): con el interruptor general de prime APAGADO y, después,
 * PRENDIDO (las tres banderas "para todos" siempre apagadas en los dos
 * casos), un docente sin marcar que crea un recurso en el editor real tiene
 * que ver EXACTAMENTE lo mismo — nada de lo agregado por T1-T9 se le puede
 * filtrar, ni siquiera cuando el dueño prende el interruptor general.
 *
 * Requiere la pila de desarrollo levantada (`docker compose up -d db`, `npm
 * run dev` en el puerto 3000) y REUSA el AiProvider/AiModel mock que dejó T3
 * (kind "kodu-mock-t3", providerModel "mock-t3") — mismo patrón que
 * e2e/t4-deshacer.ts, t6, t7, t8 y t9.
 *
 * Corre con: npx tsx e2e/t10-docente-comun.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-t10-comun@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_KIND = 'kodu-mock-t3';
const PROVIDER_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-t3';
const MODEL_DISPLAY_NAME = 'Mock local (T3+)';

const SCREENSHOT_DIR = '/tmp/kodu-t10';

// Delimitadores del bloque canónico del kit (apéndice A, odd/tasks/modo-prime.md).
const BLOQUE_KIT_PREFIJO = '<!-- kodu-kit:v1:inicio tema=';
const BLOQUE_KIT_FIN = '<!-- kodu-kit:v1:fin -->';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

// ─────────────────────────────────────────────────────────────
// Helpers (mismo patrón que e2e/t6-velocidad.ts, t7, t8 y t9).
// ─────────────────────────────────────────────────────────────

async function asegurarDocente(email: string, password: string, nombre: string): Promise<string> {
  const fila = await prisma.user.upsert({
    where: { email },
    update: { role: 'DOCENTE', primeAccess: false },
    create: { email, name: nombre, role: 'DOCENTE', passwordHash: await hashPassword(password), primeAccess: false },
    select: { id: true },
  });
  return fila.id;
}

async function asegurarMotorMock(adminPage: Page, mockUrl: string): Promise<string> {
  const proveedorExistente = await prisma.aiProvider.findFirst({ where: { kind: PROVIDER_KIND } });
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

async function cookieHeaderDe(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies(BASE_URL);
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Turno crudo por `fetch` (con la cookie de sesión), sin pasar por la UI:
 * necesario para poder leer TODOS los tipos de evento SSE, no sólo "done" —
 * hace falta para afirmar la AUSENCIA de "phase"/"variant" (mismo patrón que
 * `streamCrudo` en e2e/t7-revision-automatica.ts). Pide velocidad y
 * versiones a mano, algo que esta cuenta no tiene, para probar que el
 * servidor las ignora incluso pedidas por API de forma explícita.
 */
async function turnoCrudo(cookie: string, payload: Record<string, unknown>): Promise<EventoSse[]> {
  const respuesta = await fetch(`${BASE_URL}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(payload),
  });
  const cuerpo = await respuesta.text();
  assert.equal(respuesta.status, 200, `turno crudo: ${respuesta.status} ${cuerpo}`);
  return eventosDe(cuerpo);
}

async function proyectoActual(id: string): Promise<{ currentHtml: string }> {
  return prisma.project.findUniqueOrThrow({ where: { id }, select: { currentHtml: true } });
}

// ─────────────────────────────────────────────────────────────
// La guardia de invariante en sí, corrida una vez por estado del
// interruptor general (apagado, prendido) — siempre la misma cuenta, sin
// marcar nunca.
// ─────────────────────────────────────────────────────────────

async function verificarDocenteComun(args: {
  docentePage: Page;
  docenteContext: BrowserContext;
  modelId: string;
  mock: MockProveedor;
  /** Sólo para logs/asserts en consola: puede decir "prime" (no se manda al servidor). */
  etiqueta: string;
  /**
   * Título de los proyectos de prueba: el servidor lo repite tal cual en el
   * <title>, el <h1>, los <meta og:*> y el <input> de título — así que NO
   * puede contener la palabra "prime" o el propio chequeo "la página no dice
   * prime" se auto-falsearía con el nombre del fixture, no con un problema
   * real del producto.
   */
  tituloProyecto: string;
  indice: number;
}): Promise<void> {
  const { docentePage, docenteContext, modelId, mock, etiqueta, tituloProyecto, indice } = args;
  const slug = etiqueta.replace(/\s+/g, '-');

  // ── Parte A: por el editor real (UI) ──
  const proyecto = await crearProyecto(docentePage, tituloProyecto, modelId);
  await docentePage.goto(`${BASE_URL}/app/project/${proyecto.id}`, { waitUntil: 'load' });
  await docentePage.waitForSelector('textarea[placeholder="Preguntale a Kodu…"]');

  assert.equal(
    await docentePage.getByRole('group', { name: 'Velocidad de la respuesta' }).count(),
    0,
    `[${etiqueta}] un docente sin marcar no puede ver el control de velocidad`,
  );
  assert.equal(
    await docentePage.getByTitle('Varias versiones: arma tres propuestas distintas para que elijas una').count(),
    0,
    `[${etiqueta}] un docente sin marcar no puede ver el control de varias versiones`,
  );
  assert.ok(
    !/\bprime\b/i.test(await docentePage.content()),
    `[${etiqueta}] la página no puede mencionar "prime" en ningún lado (antes de enviar nada)`,
  );
  console.log(`✔ [${etiqueta}] 1/6: sin controles nuevos y sin "prime" en la página, antes de mandar nada`);

  mock.llamadas.length = 0;
  // Sin `html` propio: usa el default de mock-proveedor.ts (`htmlDeEjemplo()`,
  // ~15 KB, declara tema "pizarron") con el chunking por default (~15-20s) —
  // mismo criterio que e2e/t3-vista-previa-progresiva.ts, para tener ventana
  // de sobra donde comprobar el parcial.
  mock.programarRespuesta({ texto: 'Dale, te armo un recurso de prueba.' });

  const campoMensaje = docentePage.locator('textarea[placeholder="Preguntale a Kodu…"]');
  const botonEnviar = docentePage.getByRole('button', { name: 'Enviar' });
  const mensaje = 'Armá un recurso simple para probar (T10)';
  await campoMensaje.click();
  await campoMensaje.pressSequentially(mensaje, { delay: 10 });
  assert.equal(await campoMensaje.inputValue(), mensaje, `[${etiqueta}] no se pudo escribir el mensaje en el compositor`);
  await botonEnviar.click();
  console.log(`✔ [${etiqueta}] 2/6: turno enviado por el compositor real`);

  const frenteFrame = () => docentePage.frameLocator('iframe[data-kodu-frente="true"]');

  // ANTES del "code" final: el frame visible ya tiene que mostrar algo del
  // documento parcial (T3) — prueba de que "code_delta" llegó y se decodificó.
  await frenteFrame().locator('h1').waitFor({ state: 'attached', timeout: 12_000 });
  const h1Parcial = await frenteFrame().locator('h1').textContent();
  assert.ok(h1Parcial?.includes('Practicá'), `[${etiqueta}] esperaba texto del parcial en el <h1>, vino: "${h1Parcial}"`);
  const tituloParcial = await frenteFrame().locator('title').textContent();
  assert.equal(
    tituloParcial,
    'Tabla del 7 — práctica',
    `[${etiqueta}] el <title> del documento parcial tiene que verse ANTES del "code" final (vino: "${tituloParcial}")`,
  );
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await docentePage.screenshot({ path: `${SCREENSHOT_DIR}/${indice}-${slug}-1-parcial.png` });
  console.log(`✔ [${etiqueta}] 3/6: "code_delta" llegó y la vista previa muestra contenido antes del "code" final`);

  // Fin del turno: el compositor vuelve a decir "Enviar" recién cuando
  // `isStreaming` pasa a `false` (mismo criterio que t3-t9).
  await botonEnviar.waitFor({ state: 'visible', timeout: 30_000 });
  // T16 (round 4, "checklist del docente"): `proyecto` es nuevo, así que
  // lleva su propio pedido de checklist ANTES del turno principal — 2
  // pedidos, no 1 (nada que ver con prime: corre para cualquier docente).
  assert.equal(
    mock.llamadas.length,
    2,
    `[${etiqueta}] un docente común tiene que generar checklist + UN pedido al motor`,
  );
  console.log(`✔ [${etiqueta}] 4/6: exactamente checklist + un pedido al motor`);

  const proyectoTrasTurno = await proyectoActual(proyecto.id);
  assert.ok(
    proyectoTrasTurno.currentHtml.includes(BLOQUE_KIT_PREFIJO) && proyectoTrasTurno.currentHtml.includes(BLOQUE_KIT_FIN),
    `[${etiqueta}] el HTML guardado tiene que traer el bloque canónico del kit (el modelo declaró tema)`,
  );
  assert.ok(
    !/\bprime\b/i.test(await docentePage.content()),
    `[${etiqueta}] la página tampoco puede decir "prime" después de terminar el turno`,
  );
  console.log(`✔ [${etiqueta}] 5/6: el HTML guardado trae el kit aplicado, y la página sigue sin decir "prime"`);

  const botonDeshacer = docentePage.getByRole('button', { name: 'Deshacer' });
  await botonDeshacer.waitFor();
  await botonDeshacer.click();
  // El HTML de arranque (DEFAULT_HTML) es el único sin <h1>/<title> propios:
  // trae un <p>"Tu recurso aparecerá acá..."</p> — esperarlo en el frame
  // confirma que el POST /undo ya terminó (mismo criterio que t4-deshacer.ts,
  // que espera el DOM en vez de sondear la base a ciegas).
  await frenteFrame()
    .locator('p', { hasText: 'Tu recurso aparecerá acá' })
    .waitFor({ state: 'attached', timeout: 10_000 });
  const proyectoTrasDeshacer = await proyectoActual(proyecto.id);
  assert.equal(
    proyectoTrasDeshacer.currentHtml,
    DEFAULT_HTML,
    `[${etiqueta}] "Deshacer" tiene que volver EXACTO al HTML de arranque`,
  );
  await docentePage.screenshot({ path: `${SCREENSHOT_DIR}/${indice}-${slug}-2-tras-deshacer.png` });
  console.log(`✔ [${etiqueta}] 6/6: "Deshacer" restaura el HTML de arranque, byte a byte`);

  // ── Parte B: turno crudo (misma cuenta, otro proyecto), para leer el TIPO
  // de cada evento SSE — la ausencia de "phase"/"variant" no se puede probar
  // mirando sólo el DOM. Pide velocidad y versiones a mano de todos modos,
  // para probar que ni siquiera un pedido explícito por API se filtra.
  // ──
  const proyectoCrudo = await crearProyecto(docentePage, `${tituloProyecto} (crudo)`, modelId);
  const cookie = await cookieHeaderDe(docenteContext);

  mock.llamadas.length = 0;
  // Mismo HTML por default (>4KB): garantiza al menos un "code_delta" por
  // umbral de tamaño en stream.ts, sin depender del timer de 200ms.
  mock.programarRespuesta({ texto: '', chunkDelayMs: 5, chunkBytes: 5_000 });

  const eventos = await turnoCrudo(cookie, {
    projectId: proyectoCrudo.id,
    threadId: proyectoCrudo.threadId,
    message: 'Armá un recurso simple para probar (T10, crudo)',
    model: modelId,
    speed: 'deep', // pedido a mano: sin permiso, T6 lo ignora
    variants: 3, // pedido a mano: sin permiso, T9 lo ignora
  });

  // T16: `proyectoCrudo` también es nuevo — checklist + turno, 2 pedidos.
  assert.equal(
    mock.llamadas.length,
    2,
    `[${etiqueta}] tampoco el turno crudo puede generar más de checklist + un pedido al motor`,
  );
  const tipos = eventos.map((e) => e.type);
  assert.ok(tipos.includes('code_delta'), `[${etiqueta}] tiene que viajar al menos un "code_delta" (vinieron: ${tipos.join(', ')})`);
  // T16: un turno de creación manda su PROPIO "phase":"planificando" (el
  // paso de checklist) sin importar si el docente tiene prime — no cuenta
  // como el "revisando" de T7, que sí sigue vedado sin permiso.
  const fasesVistas = eventos.filter((e) => e.type === 'phase').map((e) => e.phase);
  assert.deepEqual(
    fasesVistas,
    ['planificando'],
    `[${etiqueta}] sólo "planificando" (checklist) puede aparecer, nunca "revisando" sin permiso (vinieron: ${fasesVistas.join(', ')})`,
  );
  assert.ok(!tipos.includes('variant'), `[${etiqueta}] no puede aparecer ningún evento "variant" (vinieron: ${tipos.join(', ')})`);
  const done = eventos.find((e) => e.type === 'done');
  assert.ok(done, `[${etiqueta}] el turno crudo tiene que terminar con "done"`);
  assert.ok(
    !done!.revisionVisualDisponible,
    `[${etiqueta}] "revisionVisualDisponible" tiene que ser falso/ausente (vino: ${JSON.stringify(done!.revisionVisualDisponible)})`,
  );
  console.log(
    `✔ [${etiqueta}] extra: turno crudo con speed="deep"+variants=3 a mano → checklist+1 pedido, "code_delta" sí, sólo "planificando" de "phase", "variant" no, revisionVisualDisponible falso/ausente`,
  );
}

async function main(): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await asegurarDocente(DOCENTE_EMAIL, DOCENTE_PASSWORD, 'Docente E2E T10 (común)');

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  const browser = await abrirNavegador();

  try {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const modelId = await asegurarMotorMock(adminPage, mock.url);
    console.log(`✔ motor mock listo (${modelId})`);

    const docenteContext = await browser.newContext();
    const docentePage = await docenteContext.newPage();
    await iniciarSesion(docentePage, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    // ───────────────────────────────────────────────────────────
    // Fase 1 — interruptor general de prime APAGADO.
    // ───────────────────────────────────────────────────────────
    await fijarSettings(adminPage, {
      primeEnabled: false,
      autoReviewForAll: false,
      deepModeForAll: false,
      versionsForAll: false,
    });
    await verificarDocenteComun({
      docentePage,
      docenteContext,
      modelId,
      mock,
      etiqueta: 'prime apagado',
      tituloProyecto: 'T10 — interruptor apagado',
      indice: 1,
    });

    // ───────────────────────────────────────────────────────────
    // Fase 2 — interruptor general de prime PRENDIDO (esta cuenta sigue sin
    // marcar: las mismas afirmaciones tienen que seguir siendo ciertas).
    // ───────────────────────────────────────────────────────────
    await fijarSettings(adminPage, {
      primeEnabled: true,
      autoReviewForAll: false,
      deepModeForAll: false,
      versionsForAll: false,
    });
    await verificarDocenteComun({
      docentePage,
      docenteContext,
      modelId,
      mock,
      etiqueta: 'prime prendido',
      tituloProyecto: 'T10 — interruptor prendido',
      indice: 2,
    });

    console.log(`\n✔ e2e/t10-docente-comun.ts: todas las comprobaciones pasaron (capturas en ${SCREENSHOT_DIR})`);
  } finally {
    try {
      const adminContext2 = await browser.newContext();
      const adminPage2 = await adminContext2.newPage();
      await iniciarSesion(adminPage2, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await fijarSettings(adminPage2, {
        primeEnabled: false,
        autoReviewForAll: false,
        deepModeForAll: false,
        versionsForAll: false,
      });
      await adminContext2.close();
      console.log('✔ limpieza: prime y los tres "para todos" apagados (la base queda como la dejaron T5-T9)');
    } catch (error) {
      console.error('[t10-docente-comun] no se pudo restaurar el estado al final:', error);
    }

    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
console.log('\n✔ e2e/t10-docente-comun.ts: terminado');
