import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';
import { MARCADOR_CORRECCION_AUTOPRUEBA } from '../src/lib/ai/autoprueba.ts';
import { MARCADOR_SISTEMA_CHECKLIST, leerChecklist } from '../src/lib/ai/checklist.ts';
import type { Page } from 'playwright';

/**
 * Chequeo de navegador de T19 (`odd/tasks/arnes-robustez.md`, round 4): el
 * ciclo completo del checklist del docente (T16-T18) contra la app real en
 * Chromium, sin ninguna llamada paga (mock en `e2e/mock-proveedor.ts`).
 *
 * Mismo patrón que `e2e/t11-autoprueba.ts` (mismo AiProvider/AiModel
 * compartido "kodu-mock-t3", mismo dialecto `reasoning_effort` pisado a
 * "none" para poder afirmar que la corrección pide "low", mismo criterio de
 * limpieza en el `finally`). Cinco escenas:
 *
 *  A  — el checklist falla (c2) → UNA corrección que cita id + texto del
 *       ítem + detalle + "nunca debilites" → queda sano.
 *  A2 — turno de AJUSTE sobre el MISMO proyecto: el bloque de ajuste (no el
 *       de creación) viaja con los 3 textos, CERO pedidos de checklist
 *       nuevos, la autoprueba vuelve a correr — y tras recargar la página el
 *       checklist se ve en estado "sin probar todavía".
 *  B  — todas las pruebas pasan a la primera: cero correcciones.
 *  C  — recurso VIEJO sin `window.__koduPruebas`: cero correcciones,
 *       `pruebas: null` manejado, la UI ofrece los 3 ítems como "sin prueba
 *       automática".
 *  D  — sigue fallando después de las 2 rondas: exactamente 2 correcciones,
 *       el ítem queda en "falla" con su detalle, y aparece el aviso discreto.
 *
 * Requiere la pila de desarrollo levantada (`docker compose up -d db`,
 * `npm run dev` en el puerto 3000). Corre con:
 *   npx tsx e2e/t12-checklist-pruebas.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-t12-checklist@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_KIND = 'kodu-mock-t3';
const PROVIDER_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-t3';
const MODEL_DISPLAY_NAME = 'Mock local (T3+)';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

// ─────────────────────────────────────────────────────────────
// Checklist de las escenas A/A2/B/D: 3 ítems, cada uno con su propia prueba
// en window.__koduPruebas de la misma id. El texto de cada ítem es a
// propósito el mismo que verifica su prueba, para poder afirmar en el
// pedido de corrección que el id, el TEXTO del ítem y el detalle de la
// prueba viajan los tres.
// ─────────────────────────────────────────────────────────────

const ITEMS_T12 = [
  { id: 'c1', texto: 'Si respondo 4 en el desafío 1, dice "Correcto".' },
  { id: 'c2', texto: 'Si respondo mal en el desafío 2, dice "Incorrecto".' },
  { id: 'c3', texto: 'Si respondo 10 en el desafío 3, dice "Correcto".' },
] as const;

const DETALLE_FALLA_C2 = 'el desafío 2 dice "Correcto" aunque la respuesta sea incorrecta';

function textoChecklistPlano(items: ReadonlyArray<{ texto: string }>): string {
  return items.map((item) => `- ${item.texto}`).join('\n');
}

function documento(marca: string, cuerpo: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="pizarron">
<title>T12 ${marca}</title>
</head>
<body data-marca="${marca}">
${cuerpo}
</body>
</html>`;
}

/**
 * Los tres desafíos con su propio `window.__koduPruebas`. `c2Bug`: el
 * defecto real que dispara la escena A/D — el desafío 2 dice "Correcto" SIN
 * IMPORTAR la respuesta (una condición mal escrita, no un error de JS: el
 * botón funciona, sólo miente). Con `c2Bug: false` el desafío 2 compara de
 * verdad, igual que el 1 y el 3.
 */
function htmlConPruebas(marca: string, opciones: { c2Bug: boolean }): string {
  const handlerC2 = opciones.c2Bug
    ? `document.getElementById('c2-msg').textContent = 'Correcto';`
    : `var v2 = document.getElementById('c2-input').value;
      document.getElementById('c2-msg').textContent = (v2 === '7') ? 'Correcto' : 'Incorrecto';`;

  return documento(
    marca,
    `  <h1>Practicá los tres desafíos</h1>
  <div>
    <input id="c1-input" type="text">
    <button id="c1-check" type="button">Comprobar 1</button>
    <p id="c1-msg"></p>
  </div>
  <div>
    <input id="c2-input" type="text">
    <button id="c2-check" type="button">Comprobar 2</button>
    <p id="c2-msg"></p>
  </div>
  <div>
    <input id="c3-input" type="text">
    <button id="c3-check" type="button">Comprobar 3</button>
    <p id="c3-msg"></p>
  </div>
  <script>
    document.getElementById('c1-check').addEventListener('click', function () {
      var v1 = document.getElementById('c1-input').value;
      document.getElementById('c1-msg').textContent = (v1 === '4') ? 'Correcto' : 'Incorrecto';
    });
    document.getElementById('c2-check').addEventListener('click', function () {
      ${handlerC2}
    });
    document.getElementById('c3-check').addEventListener('click', function () {
      var v3 = document.getElementById('c3-input').value;
      document.getElementById('c3-msg').textContent = (v3 === '10') ? 'Correcto' : 'Incorrecto';
    });

    window.__koduPruebas = [
      { id: 'c1', prueba: function (t) {
          document.getElementById('c1-input').value = '4';
          t.clic('#c1-check');
          var ok1 = t.texto('#c1-msg') === 'Correcto';
          return { ok: ok1, detalle: ok1 ? '' : 'el desafío 1 no dijo Correcto con la respuesta correcta' };
        } },
      { id: 'c2', prueba: function (t) {
          document.getElementById('c2-input').value = '999';
          t.clic('#c2-check');
          var ok2 = t.texto('#c2-msg') === 'Incorrecto';
          return { ok: ok2, detalle: ok2 ? '' : '${DETALLE_FALLA_C2}' };
        } },
      { id: 'c3', prueba: function (t) {
          document.getElementById('c3-input').value = '10';
          t.clic('#c3-check');
          var ok3 = t.texto('#c3-msg') === 'Correcto';
          return { ok: ok3, detalle: ok3 ? '' : 'el desafío 3 no dijo Correcto con la respuesta correcta' };
        } }
    ];
  </script>`,
  );
}

/** Escena C: un recurso "viejo", sin `window.__koduPruebas` en absoluto —
 *  mismo patrón que `htmlSano` de t11-autoprueba.ts (sin botón de reinicio,
 *  sin errores de JS). */
function htmlSinPruebas(marca: string): string {
  return documento(
    marca,
    `  <h1>Practicá la tabla del 8</h1>
  <button id="comprobar" type="button">Comprobar</button>
  <p id="mensaje"></p>
  <script>
    document.getElementById('comprobar').addEventListener('click', function () {
      document.getElementById('mensaje').textContent = '¡Correcto!';
    });
  </script>`,
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers (mismo patrón que e2e/t11-autoprueba.ts)
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

  const modeloExistente = await prisma.aiModel.findFirst({
    where: { providerId, providerModel: MODEL_PROVIDER_MODEL, enabled: true },
    orderBy: { id: 'asc' },
  });
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

async function fijarDialecto(adminPage: Page, modelId: string, datos: Record<string, string | null>): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/models/${modelId}`, { data: datos });
  assert.ok(respuesta.ok(), `PATCH dialecto ${JSON.stringify(datos)}: ${respuesta.status()} ${await respuesta.text()}`);
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

async function proyectoActual(id: string): Promise<{ currentHtml: string }> {
  return prisma.project.findUniqueOrThrow({ where: { id }, select: { currentHtml: true } });
}

interface PedidoMock {
  reasoning_effort?: string;
  messages: Array<{ role: string; content: unknown }>;
}

function matchChecklist(body: Record<string, unknown>): boolean {
  const mensajes = (body as unknown as PedidoMock).messages;
  const primero = mensajes?.[0];
  return typeof primero?.content === 'string' && primero.content.includes(MARCADOR_SISTEMA_CHECKLIST);
}

function matchCorreccion(body: Record<string, unknown>): boolean {
  const mensajes = (body as unknown as PedidoMock).messages;
  const ultimo = mensajes?.at(-1);
  return typeof ultimo?.content === 'string' && ultimo.content.includes(MARCADOR_CORRECCION_AUTOPRUEBA);
}

const frenteFrame = (pagina: Page) => pagina.frameLocator('iframe[data-kodu-frente="true"]');

/** Manda un turno desde el editor real (UI) y espera a que el turno entero
 *  (checklist/generación + autoprueba/corrección) termine. Mismo helper que
 *  t11-autoprueba.ts. */
async function enviarTurnoPorUi(page: Page, projectId: string, mensaje: string): Promise<void> {
  await page.goto(`${BASE_URL}/app/project/${projectId}`, { waitUntil: 'load' });
  const campoMensaje = page.locator('textarea[placeholder="Preguntale a Kodu…"]');
  const botonEnviar = page.getByRole('button', { name: 'Enviar' });
  await campoMensaje.click();
  await campoMensaje.pressSequentially(mensaje, { delay: 10 });
  await botonEnviar.click();
  await botonEnviar.waitFor({ state: 'visible', timeout: 45_000 });
}

/** El `<summary>` "Esto es lo que probé · N de TOTAL" — siempre visible,
 *  esté plegado o desplegado. Para hacer click (abrir/cerrar). */
function resumenChecklist(page: Page) {
  return page.locator('summary', { hasText: 'Esto es lo que probé' });
}

/** El MISMO `<summary>`, pero filtrado por el texto exacto del resumen
 *  ("N de TOTAL") — `hasText` reevalúa en vivo, así que `.waitFor()` acá
 *  espera a que el contador llegue a ese valor (nunca lee un valor viejo). */
function esperarResumenChecklist(page: Page, resumen: string, timeoutMs = 10_000) {
  return page.locator('summary', { hasText: `Esto es lo que probé · ${resumen}` }).waitFor({ timeout: timeoutMs });
}

async function main(): Promise<void> {
  const docenteId = await asegurarDocente(DOCENTE_EMAIL, DOCENTE_PASSWORD, 'Docente E2E T12 (checklist)');
  void docenteId;

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  const browser = await abrirNavegador();
  let modelId = '';
  let dialectoOriginal: { reasoningEffort: string | null; reasoningParam: string | null } | null = null;
  const erroresDeConsola: string[] = [];

  try {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    modelId = await asegurarMotorMock(adminPage, mock.url);
    console.log(`✔ motor mock listo (${modelId})`);

    const filaOriginal = await prisma.aiModel.findUniqueOrThrow({
      where: { id: modelId },
      select: { reasoningEffort: true, reasoningParam: true },
    });
    dialectoOriginal = filaOriginal;
    // Mismo motivo que t11-autoprueba.ts: sin esto, la corrección no manda
    // `reasoning_effort` y no hay nada que afirmar sobre "low".
    await fijarDialecto(adminPage, modelId, { reasoningEffort: 'none', reasoningParam: 'reasoning_effort' });

    await fijarSettings(adminPage, { primeEnabled: false, autoReviewForAll: false, deepModeForAll: false, versionsForAll: false });

    const docenteContext = await browser.newContext();
    const docentePage = await docenteContext.newPage();
    docentePage.on('pageerror', (error) => erroresDeConsola.push(`pageerror: ${error.message}`));
    docentePage.on('console', (msg) => {
      if (msg.type() === 'error') erroresDeConsola.push(`console.error: ${msg.text()}`);
    });
    await iniciarSesion(docentePage, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    // ───────────────────────────────────────────────────────────
    // Escena A — el checklist falla (c2) → UNA corrección → queda sano.
    // ───────────────────────────────────────────────────────────
    const proyectoA = await crearProyecto(docentePage, 'T12 — checklist falla y se corrige', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuestaCondicional(matchChecklist, { texto: textoChecklistPlano(ITEMS_T12), llamarHerramienta: false, finishReason: 'stop' });
    mock.programarRespuesta({ texto: '', html: htmlConPruebas('a1', { c2Bug: true }), chunkDelayMs: 5, chunkBytes: 20_000 });
    mock.programarRespuestaCondicional(matchCorreccion, {
      texto: '',
      html: htmlConPruebas('a1b', { c2Bug: false }),
      chunkDelayMs: 5,
      chunkBytes: 20_000,
    });

    await enviarTurnoPorUi(docentePage, proyectoA.id, 'Armame tres desafíos con corrección (T12-ESCENA-A)');

    assert.equal(mock.llamadas.length, 3, 'checklist + turno principal + EXACTAMENTE una corrección');
    const pedidoCorreccionA = mock.llamadas[2]!.body as unknown as PedidoMock;
    assert.equal(pedidoCorreccionA.reasoning_effort, 'low', 'la corrección tiene que pedir razonamiento "low"');
    const promptCorreccionA = pedidoCorreccionA.messages.at(-1)!.content as string;
    assert.ok(promptCorreccionA.includes('c2'), 'tiene que citar el id de la prueba fallida');
    assert.ok(promptCorreccionA.includes(ITEMS_T12[1].texto), 'tiene que citar el TEXTO del ítem del checklist');
    assert.ok(promptCorreccionA.includes(DETALLE_FALLA_C2), 'tiene que citar el detalle exacto de la prueba fallida');
    assert.ok(
      promptCorreccionA.includes('Nunca debilites ni borres una prueba para que pase'),
      'tiene que llevar la instrucción de nunca debilitar la prueba',
    );
    console.log('✔ escena A (1/4): la corrección cita id c2 + texto del ítem + detalle + "nunca debilites"');

    await frenteFrame(docentePage).locator('[data-marca="a1b"]').waitFor({ state: 'attached', timeout: 10_000 });
    const htmlTrasA = await proyectoActual(proyectoA.id);
    assert.ok(htmlTrasA.currentHtml.includes('data-marca="a1b"'), 'Project.currentHtml tiene que quedar con el HTML corregido (sano)');

    const mensajeAsistenteA = await prisma.chatMessage.findFirst({
      where: { threadId: proyectoA.threadId, role: 'assistant' },
      select: { checklist: true },
    });
    const checklistPersistidoA = leerChecklist(mensajeAsistenteA?.checklist ?? null);
    assert.equal(checklistPersistidoA.length, 3, 'el ChatMessage "assistant" tiene que guardar el checklist de 3 ítems');
    assert.deepEqual(
      checklistPersistidoA.map((item) => item.id),
      ['c1', 'c2', 'c3'],
    );

    const instantaneasA = await prisma.projectSnapshot.count({ where: { projectId: proyectoA.id } });
    assert.equal(instantaneasA, 1, 'sólo la instantánea del turno principal — la corrección no crea una propia');
    const usosA = await prisma.tokenUsage.count({ where: { projectId: proyectoA.id } });
    assert.equal(usosA, 3, 'TokenUsage: checklist + turno principal + la ronda de corrección');
    console.log('✔ escena A (2/4): Project.currentHtml sano, checklist de 3 ítems persistido, 1 instantánea, 3 TokenUsage');

    await esperarResumenChecklist(docentePage, '3 de 3');
    assert.equal(
      await docentePage.locator('text=Probamos el recurso y algo puede no funcionar bien.').count(),
      0,
      'sin aviso discreto: se corrigió bien a la primera',
    );
    await resumenChecklist(docentePage).click();
    for (const item of ITEMS_T12) {
      await docentePage.locator('li', { hasText: item.texto }).waitFor({ timeout: 5_000 });
    }
    console.log('✔ escena A (3/4): UI "Esto es lo que probé · 3 de 3", los 3 ítems visibles al desplegar, sin aviso');

    // T18 (punto 4): capturas del estado plegado y desplegado, desktop y
    // 360px — se miran a mano antes de dar por buena la UI.
    await docentePage.setViewportSize({ width: 1280, height: 800 });
    await docentePage.waitForTimeout(150);
    await resumenChecklist(docentePage).click(); // vuelve a plegar
    await docentePage.screenshot({ path: '/tmp/kodu-checklist-desktop-plegado.png' });
    await resumenChecklist(docentePage).click(); // despliega
    await docentePage.screenshot({ path: '/tmp/kodu-checklist-desktop-desplegado.png' });

    await docentePage.setViewportSize({ width: 360, height: 780 });
    await docentePage.getByRole('tab', { name: 'Recurso' }).click();
    await docentePage.waitForTimeout(150);
    await resumenChecklist(docentePage).click(); // pliega (venía desplegado)
    await docentePage.screenshot({ path: '/tmp/kodu-checklist-360-plegado.png' });
    await resumenChecklist(docentePage).click(); // despliega
    await docentePage.screenshot({ path: '/tmp/kodu-checklist-360-desplegado.png' });
    await docentePage.setViewportSize({ width: 1280, height: 800 });
    console.log('✔ escena A (4/4): capturas guardadas en /tmp/kodu-checklist-*.png');

    // ───────────────────────────────────────────────────────────
    // Escena A2 — turno de AJUSTE sobre el MISMO proyecto: bloque de
    // ajuste (no el de creación), CERO pedidos de checklist, la autoprueba
    // vuelve a correr, y tras recargar el checklist se ve "sin probar".
    // ───────────────────────────────────────────────────────────
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlConPruebas('a2', { c2Bug: false }), chunkDelayMs: 5, chunkBytes: 20_000 });

    await enviarTurnoPorUi(docentePage, proyectoA.id, 'Cambiale el título a "Desafíos de hoy" (T12-ESCENA-A2)');

    assert.equal(mock.llamadas.length, 1, 'ajuste sano a la primera: SÓLO el turno principal, cero checklist, cero corrección');
    const ningunoEsChecklist = mock.llamadas.every((llamada) => !matchChecklist(llamada.body));
    assert.ok(ningunoEsChecklist, 'ningún pedido de este turno puede llevar el marcador de sistema del checklist');

    const pedidoAjuste = mock.llamadas[0]!.body as unknown as PedidoMock;
    const promptAjuste = pedidoAjuste.messages.at(-1)!.content as string;
    assert.ok(promptAjuste.includes('Checklist vigente de este recurso'), 'tiene que llevar el bloque de AJUSTE, no el de creación');
    assert.ok(!promptAjuste.includes('Agregá window.__koduPruebas'), 'el bloque de creación no tiene que aparecer en un ajuste');
    for (const item of ITEMS_T12) {
      assert.ok(promptAjuste.includes(`${item.id}: ${item.texto}`), `el bloque de ajuste tiene que citar ${item.id} con su texto`);
    }
    console.log('✔ escena A2 (1/3): CERO pedidos de checklist, el bloque de AJUSTE cita los 3 ítems');

    await frenteFrame(docentePage).locator('[data-marca="a2"]').waitFor({ state: 'attached', timeout: 10_000 });
    await esperarResumenChecklist(docentePage, '3 de 3');
    console.log('✔ escena A2 (2/3): la autoprueba volvió a correr sobre el HTML del ajuste — "3 de 3" de nuevo');

    await docentePage.reload({ waitUntil: 'load' });
    await esperarResumenChecklist(docentePage, '0 de 3');
    await resumenChecklist(docentePage).click();
    assert.equal(
      await docentePage.locator('text=Se prueba después de cada cambio').count(),
      3,
      'tras recargar, sin ninguna autoprueba corrida todavía en ESTA pestaña, los 3 ítems tienen que verse "sin probar"',
    );
    console.log('✔ escena A2 (3/3): tras recargar, el checklist se ve (servidor) en estado "sin probar todavía"');

    // ───────────────────────────────────────────────────────────
    // Escena B — todas las pruebas pasan a la primera: cero correcciones.
    // ───────────────────────────────────────────────────────────
    const proyectoB = await crearProyecto(docentePage, 'T12 — checklist sano a la primera', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuestaCondicional(matchChecklist, { texto: textoChecklistPlano(ITEMS_T12), llamarHerramienta: false, finishReason: 'stop' });
    mock.programarRespuesta({ texto: '', html: htmlConPruebas('b1', { c2Bug: false }), chunkDelayMs: 5, chunkBytes: 20_000 });

    await enviarTurnoPorUi(docentePage, proyectoB.id, 'Armame tres desafíos sanos (T12-ESCENA-B)');

    assert.equal(mock.llamadas.length, 2, 'sano a la primera: checklist + turno principal, CERO correcciones');
    await esperarResumenChecklist(docentePage, '3 de 3');
    assert.equal(
      await docentePage.locator('text=Probamos el recurso y algo puede no funcionar bien.').count(),
      0,
      'sin aviso: nunca hizo falta corregir nada',
    );
    console.log('✔ escena B: sano a la primera, checklist "3 de 3", cero correcciones, sin aviso');

    // ───────────────────────────────────────────────────────────
    // Escena C — recurso VIEJO sin window.__koduPruebas: cero
    // correcciones, `pruebas: null` manejado, "sin prueba automática".
    // ───────────────────────────────────────────────────────────
    const proyectoC = await crearProyecto(docentePage, 'T12 — recurso viejo sin pruebas', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuestaCondicional(matchChecklist, { texto: textoChecklistPlano(ITEMS_T12), llamarHerramienta: false, finishReason: 'stop' });
    mock.programarRespuesta({ texto: '', html: htmlSinPruebas('c1'), chunkDelayMs: 5, chunkBytes: 20_000 });

    await enviarTurnoPorUi(docentePage, proyectoC.id, 'Armame la tabla del 8 (T12-ESCENA-C)');

    assert.equal(mock.llamadas.length, 2, 'recurso sin __koduPruebas: checklist + turno principal, CERO correcciones');
    await esperarResumenChecklist(docentePage, '0 de 3');
    await resumenChecklist(docentePage).click();
    assert.equal(
      await docentePage.locator('text=Sin prueba automática').count(),
      3,
      'los 3 ítems tienen que verse "sin prueba automática" (pruebas: null, no falla)',
    );
    assert.equal(
      await docentePage.locator('text=Probamos el recurso y algo puede no funcionar bien.').count(),
      0,
      'un recurso sano sin checklist propio no dispara el aviso de autoprueba',
    );
    console.log('✔ escena C: recurso sin __koduPruebas → "0 de 3", los 3 ítems "sin prueba automática", sin aviso');

    // ───────────────────────────────────────────────────────────
    // Escena D — sigue fallando después de las 2 rondas: exactamente 2
    // correcciones, el ítem queda "falla" con su detalle, aviso discreto.
    // ───────────────────────────────────────────────────────────
    const proyectoD = await crearProyecto(docentePage, 'T12 — checklist sigue fallando', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuestaCondicional(matchChecklist, { texto: textoChecklistPlano(ITEMS_T12), llamarHerramienta: false, finishReason: 'stop' });
    mock.programarRespuesta({ texto: '', html: htmlConPruebas('d1', { c2Bug: true }), chunkDelayMs: 5, chunkBytes: 20_000 });
    mock.programarRespuestaCondicional(matchCorreccion, { texto: '', html: htmlConPruebas('d2', { c2Bug: true }), chunkDelayMs: 5, chunkBytes: 20_000 });
    mock.programarRespuestaCondicional(matchCorreccion, { texto: '', html: htmlConPruebas('d3', { c2Bug: true }), chunkDelayMs: 5, chunkBytes: 20_000 });

    await enviarTurnoPorUi(docentePage, proyectoD.id, 'Armame tres desafíos que van a seguir fallando (T12-ESCENA-D)');

    assert.equal(mock.llamadas.length, 4, 'checklist + turno principal + EXACTAMENTE 2 rondas de corrección, nunca una 3ra');
    await frenteFrame(docentePage).locator('[data-marca="d3"]').waitFor({ state: 'attached', timeout: 10_000 });
    await esperarResumenChecklist(docentePage, '2 de 3');
    await resumenChecklist(docentePage).click();
    await docentePage.locator('li', { hasText: DETALLE_FALLA_C2 }).waitFor({ timeout: 5_000 });
    assert.ok(
      (await docentePage.locator('text=Probamos el recurso y algo puede no funcionar bien.').count()) > 0,
      'tiene que verse el aviso discreto después de agotar las 2 rondas',
    );
    console.log('✔ escena D: 2 correcciones exactas, "2 de 3" con el detalle de c2, aviso discreto visible');

    assert.equal(erroresDeConsola.length, 0, `sin errores de JS en la pestaña del editor:\n${erroresDeConsola.join('\n')}`);
    console.log('✔ ninguna de las 5 escenas dejó un error de JS/consola en la pestaña del editor');

    console.log('\n✔ e2e/t12-checklist-pruebas.ts: todas las comprobaciones pasaron');
  } finally {
    try {
      const adminContext2 = await browser.newContext();
      const adminPage2 = await adminContext2.newPage();
      await iniciarSesion(adminPage2, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      if (modelId && dialectoOriginal) {
        await fijarDialecto(adminPage2, modelId, {
          reasoningEffort: dialectoOriginal.reasoningEffort,
          reasoningParam: dialectoOriginal.reasoningParam,
        });
      }
      await fijarSettings(adminPage2, { primeEnabled: false, autoReviewForAll: false, deepModeForAll: false, versionsForAll: false });
      await adminContext2.close();
      console.log('✔ limpieza: dialecto del mock restaurado, settings apagados');
    } catch (error) {
      console.error('[t12-checklist-pruebas] no se pudo restaurar el estado al final:', error);
    }

    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
console.log('\n✔ e2e/t12-checklist-pruebas.ts: terminado');
