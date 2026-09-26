import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';
import { MARCADOR_CORRECCION_AUTOPRUEBA } from '../src/lib/ai/autoprueba.ts';
import type { Page } from 'playwright';

/**
 * Chequeo de navegador de T13 (`odd/tasks/arnes-robustez.md`, round 3): el
 * ciclo completo de la autoprueba + autocorrección de T12
 * (`ejecutarAutopruebaYCorreccion`, Workspace.tsx) contra la app real en
 * Chromium, sin ninguna llamada paga (mock en `e2e/mock-proveedor.ts`).
 *
 * Mismo patrón que `e2e/t8-revision-visual.ts` (escena de navegador: turno
 * real, phases visibles en pantalla) y `e2e/t6-velocidad.ts`/
 * `e2e/t7-revision-automatica.ts` (pisa el dialecto de razonamiento del
 * motor mock para poder distinguir en el pedido que recibe el mock la
 * velocidad de la corrección — T12 pide `reasoning_effort: "low"` siempre,
 * sin importar el nivel configurado). REUSA el AiProvider/AiModel
 * compartido "kodu-mock-t3" (mismo `kind` que T3+), filtrado por
 * `enabled`/`apiKeyCipher` como hace `e2e/arnes-robustez.ts` (la base de
 * desarrollo acumula filas viejas de otras tareas).
 *
 * No prende `primeEnabled`: la autoprueba NO es una feature de prime (T12
 * lo decidió a propósito), así que corre igual para un docente común y
 * `revisionVisualDisponible` queda siempre en `false` sin necesidad de
 * apagarla explícitamente — nada de T8 se mete en el conteo de llamadas.
 *
 * Requiere la pila de desarrollo levantada (`docker compose up -d db`,
 * `npm run dev` en el puerto 3000, con las rutas de T12 ya cargadas — un
 * endpoint nuevo necesita reiniciar el server de Astro). Corre con:
 * npx tsx e2e/t11-autoprueba.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-t11-autoprueba@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_KIND = 'kodu-mock-t3';
const PROVIDER_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-t3';
const MODEL_DISPLAY_NAME = 'Mock local (T3+)';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────
// HTML de prueba (sin kit: el servidor se lo aplica). Mismo patrón que la
// "Muestra 2"/"Muestra 3" de e2e/navegador-kit.ts: un botón "Comprobar" que
// tira un error real, y un botón "Reiniciar" que deja un mensaje sin
// limpiar — acá con documentos completos, para pasar por
// `programarRespuesta` del mock.
// ─────────────────────────────────────────────────────────────

function documento(marca: string, cuerpo: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="pizarron">
<title>T11 ${marca}</title>
</head>
<body data-marca="${marca}">
${cuerpo}
</body>
</html>`;
}

/** La llamada rota, literal (se usa también para armar el assert de la
 *  línea de origen citada en el pedido de corrección). */
const LLAMADA_ROTA = 'funcionQueNoExiste();';

function htmlRoto(marca: string): string {
  return documento(
    marca,
    `  <h1>Practicá la tabla del 7</h1>
  <button id="comprobar" type="button">Comprobar</button>
  <script>
    document.getElementById('comprobar').addEventListener('click', function () {
      ${LLAMADA_ROTA}
    });
  </script>`,
  );
}

function htmlSano(marca: string): string {
  return documento(
    marca,
    `  <h1>Practicá la tabla del 7</h1>
  <button id="comprobar" type="button">Comprobar</button>
  <p id="mensaje"></p>
  <script>
    document.getElementById('comprobar').addEventListener('click', function () {
      document.getElementById('mensaje').textContent = '¡Correcto!';
    });
  </script>`,
  );
}

/** Reinicio parcial (defecto real, sin ningún error de JS): "Reiniciar" deja
 *  el mensaje "Intentaste" sin limpiar. */
function htmlReinicioParcial(marca: string): string {
  return documento(
    marca,
    `  <input id="rango" type="range" min="0" max="10" value="0">
  <button id="comprobar" type="button">Comprobar</button>
  <button id="reiniciar" type="button">Reiniciar</button>
  <p id="msg"></p>
  <script>
    document.getElementById('comprobar').addEventListener('click', function () {
      document.getElementById('msg').textContent = 'Intentaste';
    });
    document.getElementById('reiniciar').addEventListener('click', function () {
      document.getElementById('rango').value = '0';
      // A propósito: se olvida de limpiar msg — mismo defecto que la
      // "Muestra 3" de e2e/navegador-kit.ts.
    });
  </script>`,
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers (mismo patrón que e2e/t8-revision-visual.ts / arnes-robustez.ts)
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
  // Mismo filtro que e2e/arnes-robustez.ts: la base de desarrollo acumula
  // filas viejas de otras sesiones bajo el mismo "kind" compartido.
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

function matchCorreccion(body: Record<string, unknown>): boolean {
  const mensajes = (body as unknown as PedidoMock).messages;
  const ultimo = mensajes?.at(-1);
  return typeof ultimo?.content === 'string' && ultimo.content.includes(MARCADOR_CORRECCION_AUTOPRUEBA);
}

const frenteFrame = (pagina: Page) => pagina.frameLocator('iframe[data-kodu-frente="true"]');

/** Manda un turno desde el editor real (UI) y espera a que el turno entero
 *  (incluida la autoprueba/corrección de T12) termine. */
async function enviarTurnoPorUi(page: Page, projectId: string, mensaje: string): Promise<void> {
  await page.goto(`${BASE_URL}/app/project/${projectId}`, { waitUntil: 'load' });
  const campoMensaje = page.locator('textarea[placeholder="Preguntale a Kodu…"]');
  const botonEnviar = page.getByRole('button', { name: 'Enviar' });
  await campoMensaje.click();
  await campoMensaje.pressSequentially(mensaje, { delay: 10 });
  await botonEnviar.click();
  // "Enviar" reaparece recién cuando `isStreaming` vuelve a `false` — eso
  // incluye el turno normal, la revisión visual (si corriera) Y el ciclo
  // entero de autoprueba/corrección de T12 (mismo turno para el docente).
  await botonEnviar.waitFor({ state: 'visible', timeout: 45_000 });
}

async function main(): Promise<void> {
  const docenteId = await asegurarDocente(DOCENTE_EMAIL, DOCENTE_PASSWORD, 'Docente E2E T11 (autoprueba)');
  void docenteId;

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  const browser = await abrirNavegador();
  let modelId = '';
  let dialectoOriginal: { reasoningEffort: string | null; reasoningParam: string | null } | null = null;

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
    // T12 pide "low" siempre que el motor tenga dialecto "reasoning_effort":
    // sin esto, `razonamientoCorreccion` no mandaría nada y la aserción de
    // la escena 1 no tendría qué comprobar.
    await fijarDialecto(adminPage, modelId, { reasoningEffort: 'none', reasoningParam: 'reasoning_effort' });
    console.log(
      `✔ dialecto del mock pisado a reasoning_effort/"none" (original: ${dialectoOriginal.reasoningParam ?? 'null'}/${dialectoOriginal.reasoningEffort ?? 'null'})`,
    );

    // Sin prime: la autoprueba de T12 no es una feature de prime, y así se
    // prueba exactamente eso — corre igual para un docente común. También
    // deja `revisionVisualDisponible` en `false` siempre, así T8 nunca se
    // mete en el conteo de llamadas al mock.
    await fijarSettings(adminPage, { primeEnabled: false, autoReviewForAll: false, deepModeForAll: false, versionsForAll: false });

    const docenteContext = await browser.newContext();
    const docentePage = await docenteContext.newPage();
    await iniciarSesion(docentePage, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    // ───────────────────────────────────────────────────────────
    // Escena 1 — roto → corregido: se ven las dos fases, exactamente UNA
    // corrección, el resultado final es el sano, y se registra bien
    // (sin ChatMessage extra, 2 filas de TokenUsage, sin aviso).
    // ───────────────────────────────────────────────────────────
    const proyecto1 = await crearProyecto(docentePage, 'T11 — roto a corregido', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlRoto('1a'), chunkDelayMs: 5, chunkBytes: 20_000 });
    // Deliberadamente más lento que el resto (mismo truco que la escena H de
    // t8-revision-visual.ts): la corrección de verdad tarda unos cientos de
    // ms en streamear para que "Corrigiendo un detalle…" tenga tiempo de
    // pintarse en pantalla antes de que el ciclo pase a re-probar — con
    // chunks grandes/rápidos, la fase entera podía durar unos pocos ms y el
    // `waitFor` de Playwright la perdía.
    mock.programarRespuestaCondicional(matchCorreccion, {
      texto: '',
      html: htmlSano('1b'),
      chunkDelayMs: 250,
      chunkBytes: 40,
    });

    // Las fases se observan en una segunda página en paralelo, mientras la
    // primera corre `enviarTurnoPorUi` hasta el final: si esperáramos acá
    // adentro, el turno podría ya haber terminado (mock rápido) antes de
    // llegar a mirar. En vez de eso, se navega y se manda desde ACÁ mismo,
    // sin el helper, para poder intercalar los `waitFor` de fase.
    await docentePage.goto(`${BASE_URL}/app/project/${proyecto1.id}`, { waitUntil: 'load' });
    const campo1 = docentePage.locator('textarea[placeholder="Preguntale a Kodu…"]');
    const enviar1 = docentePage.getByRole('button', { name: 'Enviar' });
    await campo1.click();
    await campo1.pressSequentially('Armame algo simple (T11-ESCENA-1)', { delay: 10 });
    await enviar1.click();

    await docentePage.getByText('Probando el recurso…').waitFor({ timeout: 30_000 });
    console.log('✔ escena 1 (1/5): "Probando el recurso…" en pantalla');
    await docentePage.getByText('Corrigiendo un detalle…').waitFor({ timeout: 30_000 });
    console.log('✔ escena 1 (2/5): "Corrigiendo un detalle…" en pantalla');
    await enviar1.waitFor({ state: 'visible', timeout: 45_000 });
    console.log('✔ escena 1 (3/5): el turno completo (autoprueba + corrección) terminó, "Enviar" volvió');

    // 3, no 2: T16 (round 4) agrega un pedido de checklist PROPIO antes del
    // turno principal (proyecto nuevo == recurso inicial) — `mock-proveedor.ts`
    // lo reconoce y responde aparte, así que sigue siendo checklist(0) +
    // turno principal(1) + UNA corrección(2), nunca 2 correcciones ni una FIFO
    // corrida.
    assert.equal(mock.llamadas.length, 3, 'checklist + turno principal + EXACTAMENTE una corrección');
    const pedidoCorreccion1 = mock.llamadas[2]!.body as unknown as PedidoMock;
    assert.equal(pedidoCorreccion1.reasoning_effort, 'low', 'la corrección tiene que pedir razonamiento "low"');
    const promptCorreccion1 = pedidoCorreccion1.messages.at(-1)!.content as string;
    assert.ok(promptCorreccion1.includes('funcionQueNoExiste'), 'tiene que citar el mensaje del error real');
    assert.ok(promptCorreccion1.includes('Comprobar'), 'tiene que citar la etiqueta del botón');
    assert.ok(promptCorreccion1.includes(LLAMADA_ROTA), 'tiene que citar el TEXTO de la línea de origen');
    console.log('✔ escena 1 (4/5): el pedido de corrección lleva reasoning_effort "low" + mensaje/botón/línea de origen citados');

    await frenteFrame(docentePage).locator('[data-marca="1b"]').waitFor({ state: 'attached', timeout: 10_000 });
    const htmlTras1 = await proyectoActual(proyecto1.id);
    assert.ok(htmlTras1.currentHtml.includes('data-marca="1b"'), 'Project.currentHtml tiene que quedar con el HTML sano');
    assert.equal(
      await docentePage.locator('text=Probamos el recurso y algo puede no funcionar bien.').count(),
      0,
      'sin aviso: se corrigió bien a la primera',
    );

    const mensajesHilo1 = await prisma.chatMessage.count({ where: { threadId: proyecto1.threadId } });
    assert.equal(mensajesHilo1, 2, 'el hilo tiene que tener SOLO el mensaje del docente + el de la IA (nada extra de la corrección)');
    const usosHilo1 = await prisma.tokenUsage.count({ where: { projectId: proyecto1.id } });
    // 3, no 2: T16 (round 4) registra su propia fila de TokenUsage para el
    // pedido de checklist (`generarChecklist`, `recordUsage`), aparte de la
    // del turno principal y la de la ronda de corrección — mismo criterio de
    // "una fila por llamada al motor" que ya usan las dos de siempre.
    assert.equal(usosHilo1, 3, 'TokenUsage tiene que sumar 3 filas: checklist + turno principal + la ronda de corrección');
    const instantaneas1 = await prisma.projectSnapshot.count({ where: { projectId: proyecto1.id } });
    assert.equal(instantaneas1, 1, 'sólo la instantánea del turno principal — la corrección no crea una propia');
    console.log('✔ escena 1 (5/5): resultado final sano, 2 mensajes en el hilo, 3 filas de TokenUsage, 1 instantánea, sin aviso');

    // ───────────────────────────────────────────────────────────
    // Escena 2 — sigue roto después de las 2 rondas: exactamente 2
    // correcciones, se ve el aviso discreto.
    // ───────────────────────────────────────────────────────────
    const proyecto2 = await crearProyecto(docentePage, 'T11 — sigue roto', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlRoto('2a'), chunkDelayMs: 5, chunkBytes: 20_000 });
    mock.programarRespuestaCondicional(matchCorreccion, { texto: '', html: htmlRoto('2b'), chunkDelayMs: 5, chunkBytes: 20_000 });
    mock.programarRespuestaCondicional(matchCorreccion, { texto: '', html: htmlRoto('2c'), chunkDelayMs: 5, chunkBytes: 20_000 });

    await enviarTurnoPorUi(docentePage, proyecto2.id, 'Armame algo simple (T11-ESCENA-2)');

    // 4, no 3: checklist(0) + turno principal(1) + 2 rondas de corrección(2,3) —
    // ver la nota de la escena 1 sobre el pedido de checklist de T16.
    assert.equal(mock.llamadas.length, 4, 'checklist + turno principal + EXACTAMENTE 2 rondas de corrección, nunca una 3ra');
    await frenteFrame(docentePage).locator('[data-marca="2c"]').waitFor({ state: 'attached', timeout: 10_000 });
    const htmlTras2 = await proyectoActual(proyecto2.id);
    assert.ok(htmlTras2.currentHtml.includes('data-marca="2c"'), 'el recurso queda con lo último que devolvió la 2da corrección, aunque siga roto');
    assert.ok(
      (await docentePage.locator('text=Probamos el recurso y algo puede no funcionar bien.').count()) > 0,
      'tiene que verse el aviso discreto después de agotar las 2 rondas',
    );
    console.log('✔ escena 2: exactamente 2 correcciones y el aviso discreto después de agotarlas');

    // ───────────────────────────────────────────────────────────
    // Escena 3 — sano a la primera: cero correcciones, sin aviso.
    // ───────────────────────────────────────────────────────────
    const proyecto3 = await crearProyecto(docentePage, 'T11 — sano a la primera', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlSano('3a'), chunkDelayMs: 5, chunkBytes: 20_000 });

    await enviarTurnoPorUi(docentePage, proyecto3.id, 'Armame algo simple (T11-ESCENA-3)');

    // 2, no 1: checklist(0) + turno principal(1) — ver la nota de la escena 1.
    assert.equal(mock.llamadas.length, 2, 'sano a la primera: checklist + turno principal, CERO pedidos de corrección');
    assert.equal(
      await docentePage.locator('text=Probamos el recurso y algo puede no funcionar bien.').count(),
      0,
      'sin aviso: nunca hizo falta corregir nada',
    );
    console.log('✔ escena 3: sano a la primera, cero correcciones, sin aviso');

    // ───────────────────────────────────────────────────────────
    // Escena 4 — reinicio parcial (sin error de JS): dispara una
    // corrección cuyo prompt incluye la línea que quedó sin limpiar.
    // ───────────────────────────────────────────────────────────
    const proyecto4 = await crearProyecto(docentePage, 'T11 — reinicio parcial', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlReinicioParcial('4a'), chunkDelayMs: 5, chunkBytes: 20_000 });
    mock.programarRespuestaCondicional(matchCorreccion, { texto: '', html: htmlSano('4b'), chunkDelayMs: 5, chunkBytes: 20_000 });

    await enviarTurnoPorUi(docentePage, proyecto4.id, 'Armame algo simple (T11-ESCENA-4)');

    // 3, no 2: checklist(0) + turno principal(1) + UNA corrección(2) — ver la
    // nota de la escena 1.
    assert.equal(mock.llamadas.length, 3, 'reinicio parcial: checklist + turno principal + UNA corrección');
    const pedidoCorreccion4 = mock.llamadas[2]!.body as unknown as PedidoMock;
    const promptCorreccion4 = pedidoCorreccion4.messages.at(-1)!.content as string;
    assert.ok(
      promptCorreccion4.includes('Intentaste'),
      'el prompt de corrección tiene que incluir la línea que quedó sin limpiar',
    );
    assert.ok(
      /no vuelve el recurso al estado inicial/.test(promptCorreccion4),
      'tiene que señalar que el reinicio no vuelve al estado inicial (no un "error" de JS)',
    );
    await frenteFrame(docentePage).locator('[data-marca="4b"]').waitFor({ state: 'attached', timeout: 10_000 });
    console.log('✔ escena 4: reinicio parcial sin error de JS dispara una corrección que cita la línea sobrante');

    console.log('\n✔ e2e/t11-autoprueba.ts: todas las comprobaciones pasaron');
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
      console.error('[t11-autoprueba] no se pudo restaurar el estado al final:', error);
    }

    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
await esperar(0);
console.log('\n✔ e2e/t11-autoprueba.ts: terminado');
