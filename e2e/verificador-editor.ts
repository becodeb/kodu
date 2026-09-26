import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, conTema, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';
import type { BrowserContext, Page, Request } from 'playwright';

/**
 * Chequeo de navegador de T4 (`odd/tasks/verificador.md`): el panel del
 * verificador en el editor REAL (Workspace.tsx/PreviewPanel.tsx) contra
 * Chromium, sin ninguna llamada paga — mismo mock que T3
 * (`e2e/mock-proveedor.ts`, generador en `/v1/chat/completions` + motor
 * verificador Responses en `/v1/responses`, mismo patrón de cuentas que
 * `e2e/verificador-endpoint.ts`).
 *
 * A diferencia de `verificador-endpoint.ts` (pega directo a los endpoints
 * con `page.request`), esto maneja el `<textarea>`/botón "Enviar" de verdad:
 * lo que se comprueba es el LADO CLIENTE de T4 — cuándo se llama, que nunca
 * bloquea el chat, qué ve el panel, y "¿Las arreglo?".
 *
 * Cuatro escenas:
 *  1 — sin motor verificador: CERO pedidos a `/v1/responses` Y a
 *      `/api/chat/verificar` (T7, follow-up 2026-09-26: `verificadorActivo`
 *      se resuelve server-side, así que el cliente ni pregunta), panel vacío.
 *  2 — recurso NUEVO con motor verificador activo: el panel aparece con la
 *      lista accionable + un ítem "Revisá este dato", y el compositor queda
 *      HABILITADO mientras "Revisando el recurso…" sigue en pantalla.
 *  3 — "¿Las arreglo?": el pedido de autocorrección (docente → servidor)
 *      lleva `problemasVerificador` sin el de contenido, la vista previa
 *      cambia, y NO hay una segunda verificación (sin loop).
 *  4 — un ajuste que sólo cambia texto: CERO pedidos nuevos a
 *      `/api/chat/verificar` (el helper de "cuándo verificar" ya lo probó
 *      puro en `unidad-verificador-cliente.ts`; acá se confirma que
 *      Workspace.tsx lo respeta de punta a punta).
 *  5 — a 390px de ancho, el panel no desborda.
 *
 * Requiere la pila de desarrollo levantada (`docker compose up -d db`,
 * `npm run dev` en el puerto 3000). Corre con:
 *   npx tsx e2e/verificador-editor.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-t4-verificador-editor@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_GENERADOR_KIND = 'kodu-mock-t3';
const PROVIDER_GENERADOR_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_GENERADOR_PROVIDER_MODEL = 'mock-t3';
const MODEL_GENERADOR_DISPLAY_NAME = 'Mock local (T3+)';

const PROVIDER_VERIFICADOR_KIND = 'kodu-mock-verificador-t3';
const PROVIDER_VERIFICADOR_LABEL = 'Mock local (T3, verificador, e2e/mock-proveedor.ts)';
const MODEL_VERIFICADOR_PROVIDER_MODEL = 'mock-verificador-t3';
const MODEL_VERIFICADOR_DISPLAY_NAME = 'Mock verificador (T3)';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────
// HTML de prueba: recursos SANOS (sin botón "Reiniciar", sin error de JS) —
// el self-test tiene que pasar a la primera, sin ninguna ronda de
// corrección, para que la línea de tiempo de cada escena sea previsible.
// ─────────────────────────────────────────────────────────────

function documento(marca: string, cuerpo: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="pizarron">
<title>T4 verificador ${marca}</title>
</head>
<body data-marca="${marca}">
${cuerpo}
</body>
</html>`;
}

const SCRIPT_B = `  <script>
    document.getElementById('comprobar').addEventListener('click', function () {
      document.getElementById('mensaje').textContent = '¡Correcto!';
    });
  </script>`;

function htmlSano(marca: string, titulo = 'Practicá la tabla del 7'): string {
  return documento(
    marca,
    `  <h1>${titulo}</h1>
  <button id="comprobar" type="button">Comprobar</button>
  <p id="mensaje"></p>
${SCRIPT_B}`,
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers (mismo patrón que e2e/verificador-endpoint.ts / t11-autoprueba.ts)
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

async function asegurarMotorGenerador(adminPage: Page, mockUrl: string): Promise<string> {
  const proveedorExistente = await prisma.aiProvider.findFirst({
    where: { kind: PROVIDER_GENERADOR_KIND, enabled: true, apiKeyCipher: { not: null } },
    orderBy: { id: 'asc' },
  });
  let providerId = proveedorExistente?.id ?? null;

  if (!providerId) {
    const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/providers`, {
      data: { kind: PROVIDER_GENERADOR_KIND, label: PROVIDER_GENERADOR_LABEL, baseUrl: mockUrl, apiKey: 'clave-de-prueba-del-mock' },
    });
    assert.equal(respuesta.status(), 200, `alta de la cuenta generadora: ${respuesta.status()} ${await respuesta.text()}`);
    providerId = ((await respuesta.json()) as { proveedor: { id: string } }).proveedor.id;
  }

  const modeloExistente = await prisma.aiModel.findFirst({
    where: { providerId, providerModel: MODEL_GENERADOR_PROVIDER_MODEL, enabled: true },
    orderBy: { id: 'asc' },
  });
  let modelId = modeloExistente?.id ?? null;

  if (!modelId) {
    const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/models`, {
      data: {
        providerId,
        providerModel: MODEL_GENERADOR_PROVIDER_MODEL,
        displayName: MODEL_GENERADOR_DISPLAY_NAME,
        description: 'Proveedor simulado para chequeos de navegador. No usar con docentes reales.',
        selectableByTeacher: true,
      },
    });
    assert.equal(respuesta.status(), 200, `alta del motor generador: ${respuesta.status()} ${await respuesta.text()}`);
    modelId = ((await respuesta.json()) as { motor: { id: string } }).motor.id;
  } else if (!modeloExistente!.selectableByTeacher || !modeloExistente!.enabled) {
    await prisma.aiModel.update({ where: { id: modelId }, data: { selectableByTeacher: true, enabled: true } });
  }

  return modelId;
}

async function asegurarMotorVerificador(adminPage: Page, mockUrl: string): Promise<string> {
  let proveedor = await prisma.aiProvider.findFirst({
    where: { kind: PROVIDER_VERIFICADOR_KIND, enabled: true, apiKeyCipher: { not: null }, apiFormat: 'responses' },
    orderBy: { id: 'asc' },
  });

  if (!proveedor) {
    const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/providers`, {
      data: {
        kind: PROVIDER_VERIFICADOR_KIND,
        label: PROVIDER_VERIFICADOR_LABEL,
        baseUrl: mockUrl,
        apiFormat: 'responses',
        apiKey: 'clave-de-prueba-del-mock-verificador',
      },
    });
    assert.equal(respuesta.status(), 200, `alta de la cuenta verificadora: ${respuesta.status()} ${await respuesta.text()}`);
    const { proveedor: creado } = (await respuesta.json()) as { proveedor: { id: string } };
    proveedor = await prisma.aiProvider.findUniqueOrThrow({ where: { id: creado.id } });
  }

  const modeloExistente = await prisma.aiModel.findFirst({
    where: { providerId: proveedor.id, providerModel: MODEL_VERIFICADOR_PROVIDER_MODEL },
  });
  let modelId = modeloExistente?.id ?? null;

  if (!modelId) {
    const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/models`, {
      data: {
        providerId: proveedor.id,
        providerModel: MODEL_VERIFICADOR_PROVIDER_MODEL,
        displayName: MODEL_VERIFICADOR_DISPLAY_NAME,
        description: 'Motor verificador simulado. No usar con docentes reales.',
        selectableByTeacher: false,
      },
    });
    assert.equal(respuesta.status(), 200, `alta del motor verificador: ${respuesta.status()} ${await respuesta.text()}`);
    modelId = ((await respuesta.json()) as { motor: { id: string } }).motor.id;
  } else if (!modeloExistente!.enabled) {
    await prisma.aiModel.update({ where: { id: modelId }, data: { enabled: true } });
  }

  // Siempre arranca SIN isVerifier: la escena 1 depende de esto.
  // Through the admin API, not Prisma: only the API calls invalidarCatalogo(),
  // and the server caches the catalog for 30 s (a previous suite may have
  // left the flag on in that cache).
  await fijarIsVerifier(adminPage, modelId, false);

  return modelId;
}

async function fijarIsVerifier(adminPage: Page, modelId: string, valor: boolean): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/models/${modelId}`, { data: { isVerifier: valor } });
  assert.ok(respuesta.ok(), `PATCH isVerifier=${valor}: ${respuesta.status()} ${await respuesta.text()}`);
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

interface CuerpoResponses {
  input?: Array<{ role: string; content: unknown }>;
}

interface CuerpoChat {
  messages?: Array<{ role: string; content: unknown }>;
}

/** Distingue un pedido `/v1/responses` (Responses API, el verificador) de
 *  uno `/v1/chat/completions` (Chat Completions, el generador/corrección):
 *  `mock.llamadas` es UNA sola cola compartida por las dos rutas — ver el
 *  comentario de `LlamadaRegistrada` en `mock-proveedor.ts`. */
function esPedidoResponses(body: Record<string, unknown>): boolean {
  return 'input' in body;
}

function matchCorreccionVerificador(body: Record<string, unknown>): boolean {
  const mensajes = (body as unknown as CuerpoChat).messages;
  const ultimo = mensajes?.at(-1);
  return typeof ultimo?.content === 'string' && ultimo.content.includes('Un revisor encontró estos problemas');
}

const frenteFrame = (pagina: Page) => pagina.frameLocator('iframe[data-kodu-frente="true"]');

async function main(): Promise<void> {
  await asegurarDocente(DOCENTE_EMAIL, DOCENTE_PASSWORD, 'Docente E2E T4 (verificador, editor)');

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  const browser = await abrirNavegador();
  let modelVerificadorId = '';
  const proyectosCreados: string[] = [];

  try {
    const adminContext: BrowserContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const modelGeneradorId = await asegurarMotorGenerador(adminPage, mock.url);
    console.log(`✔ motor generador listo (${modelGeneradorId})`);

    modelVerificadorId = await asegurarMotorVerificador(adminPage, mock.url);
    console.log(`✔ motor verificador listo, sin isVerifier todavía (${modelVerificadorId})`);

    // Sin prime/versiones/auto-revisión: nada de eso se mete en el conteo de
    // llamadas ni en la línea de tiempo del turno — mismo criterio que
    // t11-autoprueba.ts/t12-checklist-pruebas.ts.
    await fijarSettings(adminPage, { primeEnabled: false, autoReviewForAll: false, deepModeForAll: false, versionsForAll: false });

    const docenteContext = await browser.newContext();
    const docentePage = await docenteContext.newPage();
    await iniciarSesion(docentePage, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    // Cuenta los pedidos DEL NAVEGADOR a /api/chat/verificar (no al mock):
    // así se puede probar el cacheo de "desactivado" (item 4 de T4) y "sin
    // loop" tras "¿Las arreglo?" sin depender de temporizaciones.
    let pedidosAVerificar = 0;
    docentePage.on('request', (req: Request) => {
      if (req.url().endsWith('/api/chat/verificar')) pedidosAVerificar++;
    });

    // Los pedidos DEL NAVEGADOR a /api/chat/autocorreccion, con su body — para
    // poder afirmar que "¿Las arreglo?" manda `problemasVerificador` sin el
    // de contenido (T4, escena 3).
    const pedidosAutocorreccion: Array<Record<string, unknown>> = [];
    docentePage.on('request', (req: Request) => {
      if (req.url().endsWith('/api/chat/autocorreccion')) {
        const datos = req.postDataJSON();
        if (datos) pedidosAutocorreccion.push(datos as Record<string, unknown>);
      }
    });

    // ───────────────────────────────────────────────────────────
    // Escena 1 — sin motor verificador: cero pedidos a /v1/responses, panel
    // vacío. Se manda a propósito UNA sola vez desde este proyecto para
    // dejarlo con un recurso vigente (el motor sigue sin isVerifier).
    // ───────────────────────────────────────────────────────────
    const proyectoA = await crearProyecto(docentePage, 'T4 — sin motor verificador', modelGeneradorId);
    proyectosCreados.push(proyectoA.id);

    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlSano('a1'), chunkDelayMs: 5, chunkBytes: 20_000 });

    await docentePage.goto(`${BASE_URL}/app/project/${proyectoA.id}`, { waitUntil: 'load' });
    const campoA = docentePage.locator('textarea[placeholder="Preguntale a Kodu…"]');
    const enviarA = docentePage.getByRole('button', { name: 'Enviar' });
    await campoA.click();
    await campoA.pressSequentially('Armame algo simple (T4-ESCENA-1)', { delay: 10 });
    await enviarA.click();
    await enviarA.waitFor({ state: 'visible', timeout: 45_000 });

    // T7 (follow-up 2026-09-26, "el verificador es estrictamente opcional"):
    // `project/[id].astro` ya resuelve `verificadorActivo` server-side con
    // la MISMA `motorVerificador()` del endpoint — sin motor usable, el
    // cliente ni siquiera intenta preguntar. Le da igual un instante de
    // margen por si algo llamara de más.
    await esperar(500);

    assert.equal(
      mock.llamadas.filter((l) => esPedidoResponses(l.body)).length,
      0,
      'sin motor verificador, /v1/responses nunca se llama',
    );
    assert.equal(await docentePage.getByText('Revisando el recurso…').count(), 0);
    assert.equal(await docentePage.getByText('Revisé el recurso').count(), 0);
    assert.equal(pedidosAVerificar, 0, 'T7: sin motor verificador, el editor NUNCA llama a /api/chat/verificar');
    console.log('✔ escena 1: sin motor verificador → cero pedidos a /v1/responses Y a /api/chat/verificar, panel vacío (T7)');

    // ───────────────────────────────────────────────────────────
    // Escena 2 — motor verificador activo, recurso NUEVO: el panel aparece
    // con la lista accionable + un ítem de contenido, y el compositor queda
    // HABILITADO mientras "Revisando el recurso…" sigue en pantalla.
    // ───────────────────────────────────────────────────────────
    await fijarIsVerifier(adminPage, modelVerificadorId, true);

    const proyectoB = await crearProyecto(docentePage, 'T4 — recurso nuevo con verificador', modelGeneradorId);
    proyectosCreados.push(proyectoB.id);

    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlSano('b1'), chunkDelayMs: 5, chunkBytes: 20_000 });
    // Deliberadamente lentas (T4: "make the mock verifier slow for that
    // assertion") — el turno normal + self-test ya terminaron ("Enviar"
    // volvió) bastante antes de que estas dos pasadas contesten.
    mock.programarRespuestaResponses({
      demoraInicialMs: 3_000,
      texto: JSON.stringify({
        problemas: [
          {
            gravedad: 'alta',
            tipo: 'logica',
            que: 'QUE-ACCIONABLE-T4',
            como_reproducir: 'COMO-REPRODUCIR-ACCIONABLE-T4',
            arreglo: 'ARREGLO-ACCIONABLE-T4',
          },
        ],
      }),
    });
    mock.programarRespuestaResponses({
      demoraInicialMs: 3_000,
      texto: JSON.stringify({
        problemas: [
          {
            gravedad: 'media',
            tipo: 'contenido',
            que: 'QUE-DE-CONTENIDO-T4',
            como_reproducir: 'COMO-REPRODUCIR-DE-CONTENIDO-T4',
            arreglo: 'ARREGLO-DE-CONTENIDO-T4',
          },
        ],
      }),
    });

    pedidosAVerificar = 0;
    await docentePage.goto(`${BASE_URL}/app/project/${proyectoB.id}`, { waitUntil: 'load' });
    const campoB = docentePage.locator('textarea[placeholder="Preguntale a Kodu…"]');
    const enviarB = docentePage.getByRole('button', { name: 'Enviar' });
    await campoB.click();
    await campoB.pressSequentially('Armame algo simple (T4-ESCENA-2)', { delay: 10 });
    await enviarB.click();
    await enviarB.waitFor({ state: 'visible', timeout: 45_000 });
    console.log('✔ escena 2 (1/5): el turno + self-test terminaron, "Enviar" volvió');

    // El chat queda HABILITADO mientras el verificador sigue corriendo en
    // segundo plano (T4: "must NOT block the chat input or the next turn").
    // El `<textarea>` sólo se deshabilita por `isStreaming` (ver
    // ChatPanel.tsx) — el botón "Enviar", en cambio, TAMBIÉN se deshabilita
    // con el compositor vacío (recién se mandó el mensaje anterior), así que
    // la señal de verdad acá es el campo de texto, no el botón.
    await docentePage.getByText('Revisando el recurso…').waitFor({ timeout: 5_000 });
    assert.equal(await campoB.isDisabled(), false, 'el compositor tiene que seguir habilitado');
    await campoB.pressSequentially('x', { delay: 5 });
    assert.equal(await enviarB.isDisabled(), false, 'con algo escrito, "Enviar" tiene que estar habilitado');
    await campoB.fill('');
    console.log('✔ escena 2 (2/5): "Revisando el recurso…" visible Y el compositor sigue habilitado');

    const resumenB = docentePage.locator('summary', { hasText: 'Revisé el recurso y encontré' });
    await resumenB.waitFor({ timeout: 10_000 });
    // El <details> arranca PLEGADO (misma familia visual que "Esto es lo que
    // probé") — hay que abrirlo para ver la lista de adentro.
    await resumenB.click();
    await docentePage.getByText('QUE-ACCIONABLE-T4').waitFor({ timeout: 2_000 });
    // "Revisá este dato" vive AFUERA del <details> (siempre visible, nunca
    // detrás del plegado — T4: "always shown separately").
    await docentePage.getByText('Revisá este dato:').waitFor({ timeout: 2_000 });
    await docentePage.getByText('QUE-DE-CONTENIDO-T4').waitFor({ timeout: 2_000 });
    console.log('✔ escena 2 (3/5): panel con la lista accionable + el ítem "Revisá este dato"');

    assert.equal(
      mock.llamadas.filter((l) => esPedidoResponses(l.body)).length,
      2,
      'un recurso NUEVO dispara 2 pasadas en paralelo',
    );
    console.log('✔ escena 2 (4/5): 2 pasadas al motor verificador (recurso nuevo)');

    assert.equal(pedidosAVerificar, 1, 'una sola llamada a /api/chat/verificar para este turno');
    console.log('✔ escena 2 (5/5): un solo pedido a /api/chat/verificar');

    // ───────────────────────────────────────────────────────────
    // Escena 3 — "¿Las arreglo?": el pedido de autocorrección lleva
    // `problemasVerificador` sin el de contenido; la vista previa cambia;
    // NO hay una segunda verificación (sin loop).
    // ───────────────────────────────────────────────────────────
    mock.programarRespuestaCondicional(matchCorreccionVerificador, {
      texto: '',
      html: htmlSano('b1-corregido'),
      chunkDelayMs: 5,
      chunkBytes: 20_000,
    });

    pedidosAVerificar = 0;
    pedidosAutocorreccion.length = 0;
    await docentePage.getByRole('button', { name: '¿Las arreglo?' }).click();
    await docentePage.getByText('Aplicamos los arreglos que encontramos.').waitFor({ timeout: 20_000 });
    console.log('✔ escena 3 (1/4): tras "¿Las arreglo?", el panel dice que se aplicaron los arreglos');

    assert.equal(pedidosAutocorreccion.length, 1, 'una sola llamada a /api/chat/autocorreccion');
    const problemasEnviados = pedidosAutocorreccion[0]!.problemasVerificador as Array<{ que: string }> | undefined;
    assert.ok(problemasEnviados, 'el pedido tiene que llevar problemasVerificador');
    assert.equal(problemasEnviados!.length, 1, 'sólo el problema ACCIONABLE, nunca el de contenido');
    assert.equal(problemasEnviados![0]!.que, 'QUE-ACCIONABLE-T4');
    console.log('✔ escena 3 (2/4): el pedido lleva problemasVerificador con SÓLO lo accionable');

    await frenteFrame(docentePage).locator('[data-marca="b1-corregido"]').waitFor({ state: 'attached', timeout: 10_000 });
    console.log('✔ escena 3 (3/4): la vista previa cambió al HTML corregido');

    // "sin loop": el self-test vuelve a correr solo (ver
    // `ejecutarAutopruebaYCorreccion` desde `handleArreglarVerificador`),
    // pero eso NUNCA dispara una nueva verificación.
    await esperar(1_000);
    assert.equal(pedidosAVerificar, 0, 'aplicar el arreglo NUNCA dispara una nueva verificación');
    assert.equal(
      mock.llamadas.filter((l) => esPedidoResponses(l.body)).length,
      2,
      'siguen siendo las MISMAS 2 pasadas de la escena 2 — ninguna nueva',
    );
    console.log('✔ escena 3 (4/4): sin loop — ninguna verificación nueva tras aplicar el arreglo');

    // ───────────────────────────────────────────────────────────
    // Escena 4 — ajuste que sólo cambia texto visible (mismo <script>):
    // cero pedidos nuevos a /api/chat/verificar.
    // ───────────────────────────────────────────────────────────
    mock.llamadas.length = 0;
    pedidosAVerificar = 0;
    mock.programarRespuesta({
      texto: '',
      html: htmlSano('b1-ajuste-texto', 'Practicá la tabla del 7 (versión nueva)'),
      chunkDelayMs: 5,
      chunkBytes: 20_000,
    });

    await campoB.click();
    await campoB.pressSequentially('Cambiale el título nada más (T4-ESCENA-4)', { delay: 10 });
    await enviarB.click();
    await enviarB.waitFor({ state: 'visible', timeout: 45_000 });
    await esperar(1_000); // margen: si algo llamara, tiene tiempo de sobra para hacerlo.

    assert.equal(pedidosAVerificar, 0, 'un ajuste de sólo texto (mismo <script>) nunca llama al verificador');
    assert.equal(
      mock.llamadas.filter((l) => esPedidoResponses(l.body)).length,
      0,
      'tampoco llega ningún pedido nuevo al motor verificador',
    );
    assert.equal(await docentePage.getByText('Revisando el recurso…').count(), 0, 'el panel nunca arranca para este ajuste');
    console.log('✔ escena 4: ajuste de sólo texto → cero pedidos a /api/chat/verificar');

    // ───────────────────────────────────────────────────────────
    // Escena 5 — a 390px de ancho, el panel no desborda.
    // ───────────────────────────────────────────────────────────
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlSano('c1'), chunkDelayMs: 5, chunkBytes: 20_000 });
    mock.programarRespuestaResponses({
      texto: JSON.stringify({
        problemas: [
          {
            gravedad: 'alta',
            tipo: 'uso',
            que: 'Un texto bastante largo para forzar que el panel tenga que envolver sobre varias líneas y no desbordar el ancho disponible del panel de vista previa en un celular chico',
            como_reproducir: 'Abrí el recurso en un celular y mirá el panel del verificador',
            arreglo: 'Nada que arreglar en el layout, esto es sólo para medir el ancho',
          },
        ],
      }),
    });

    const proyectoC = await crearProyecto(docentePage, 'T4 — panel en celular', modelGeneradorId);
    proyectosCreados.push(proyectoC.id);

    // El turno se manda a ancho de ESCRITORIO (mismo criterio que
    // t12-checklist-pruebas.ts: nunca mandar un turno con el viewport chico
    // — el toolbar de dev de Astro se interpone con los botones ahí, algo
    // ajeno a T4). Recién DESPUÉS de que el panel ya existe se achica el
    // viewport, sólo para medir que no desborde.
    await docentePage.goto(`${BASE_URL}/app/project/${proyectoC.id}`, { waitUntil: 'load' });
    const campoC = docentePage.locator('textarea[placeholder="Preguntale a Kodu…"]');
    const enviarC = docentePage.getByRole('button', { name: 'Enviar' });
    await campoC.click();
    await campoC.pressSequentially('Armame algo simple (T4-ESCENA-5)', { delay: 10 });
    await enviarC.click();
    await enviarC.waitFor({ state: 'visible', timeout: 45_000 });

    const resumenPanel = docentePage.locator('summary', { hasText: 'Revisé el recurso y encontré' });
    await resumenPanel.waitFor({ timeout: 15_000 });
    await resumenPanel.click(); // lo despliega para medir la lista adentro, no sólo el resumen.

    const anchoViewport = 390;
    await docentePage.setViewportSize({ width: anchoViewport, height: 844 });
    // A este ancho el visor y el chat se apilan (kodu-responsive-celulares) —
    // hay que pasar a la pestaña "Recurso" para ver el panel.
    const tabRecurso = docentePage.getByRole('tab', { name: 'Recurso' });
    if (await tabRecurso.count()) await tabRecurso.click();
    await docentePage.waitForTimeout(150);
    const cajaResumen = await resumenPanel.boundingBox();
    assert.ok(cajaResumen, 'el <summary> del panel tiene que tener geometría');
    assert.ok(
      cajaResumen!.x + cajaResumen!.width <= anchoViewport + 1,
      `el <summary> desborda: x=${cajaResumen!.x} + width=${cajaResumen!.width} > ${anchoViewport}`,
    );

    const desbordaHorizontal = await docentePage.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    assert.equal(desbordaHorizontal, false, 'la página entera no puede desbordar horizontalmente a 390px');
    console.log('✔ escena 5: a 390px de ancho, el panel del verificador no desborda');

    // Captura informativa para inspección manual en modo oscuro (no es un
    // assert: comparar tokens de color a ojo, no por píxel — ver
    // odd/tasks/verificador.md, Progress T4). El panel vive SÓLO en memoria
    // de React (no se persiste): `conTema` recarga la página, así que hay
    // que rearmar el turno DESPUÉS de pasar a oscuro, en un proyecto nuevo,
    // en vez de reusar el C (un reload lo hubiera dejado en "inactivo").
    await docentePage.setViewportSize({ width: 1280, height: 900 });
    await conTema(docentePage, 'dark');

    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlSano('d1'), chunkDelayMs: 5, chunkBytes: 20_000 });
    mock.programarRespuestaResponses({
      texto: JSON.stringify({
        problemas: [
          { gravedad: 'alta', tipo: 'logica', que: 'QUE-OSCURO-T4', como_reproducir: 'CR-OSCURO-T4', arreglo: 'ARR-OSCURO-T4' },
        ],
      }),
    });

    const proyectoD = await crearProyecto(docentePage, 'T4 — panel en modo oscuro', modelGeneradorId);
    proyectosCreados.push(proyectoD.id);

    await docentePage.goto(`${BASE_URL}/app/project/${proyectoD.id}`, { waitUntil: 'load' });
    const campoD = docentePage.locator('textarea[placeholder="Preguntale a Kodu…"]');
    const enviarD = docentePage.getByRole('button', { name: 'Enviar' });
    await campoD.click();
    await campoD.pressSequentially('Armame algo simple (T4-ESCENA-5-OSCURO)', { delay: 10 });
    await enviarD.click();
    await enviarD.waitFor({ state: 'visible', timeout: 45_000 });

    const resumenOscuro = docentePage.locator('summary', { hasText: 'Revisé el recurso y encontré' });
    await resumenOscuro.waitFor({ timeout: 15_000 });
    await resumenOscuro.click(); // despliega para que la captura muestre la lista, no sólo el resumen.
    await docentePage.screenshot({ path: '/tmp/t4-verificador-dark.png' });
    console.log('✔ escena 5 (extra): captura en modo oscuro guardada en /tmp/t4-verificador-dark.png');

    console.log('\n✔ e2e/verificador-editor.ts: todas las comprobaciones pasaron');
  } finally {
    try {
      const adminContext2 = await browser.newContext();
      const adminPage2 = await adminContext2.newPage();
      await iniciarSesion(adminPage2, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      if (modelVerificadorId) {
        await prisma.aiModel.update({ where: { id: modelVerificadorId }, data: { isVerifier: false } }).catch(() => {});
      }
      await fijarSettings(adminPage2, { primeEnabled: false, autoReviewForAll: false, deepModeForAll: false, versionsForAll: false });
      await adminContext2.close();

      for (const projectId of proyectosCreados) {
        await prisma.project.delete({ where: { id: projectId } }).catch(() => {});
      }
      console.log('✔ limpieza: isVerifier apagado, settings restaurados, proyectos de prueba borrados');
    } catch (error) {
      console.error('[verificador-editor] no se pudo limpiar el estado al final:', error);
    }

    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
await esperar(0);
console.log('\n✔ e2e/verificador-editor.ts: terminado');
