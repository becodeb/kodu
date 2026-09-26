import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';
import { invalidarCatalogo, motoresParaDocente } from '../src/lib/ai/catalogo.ts';
import type { BrowserContext, Page, Request } from 'playwright';

/**
 * Chequeo de navegador del follow-up de `odd/tasks/verificador.md` (pedido
 * del usuario, 2026-09-26): T6 ("ocultar el selector de motor con un solo
 * motor elegible, y con él el aviso de repunteo") y T7 ("el verificador es
 * estrictamente opcional: sin motor, el editor nunca llama a
 * /api/chat/verificar").
 *
 * Tres escenas contra un docente NO-prime, todas sobre el editor real
 * (Workspace.tsx/ChatPanel.tsx/PreviewPanel.tsx), no contra los endpoints
 * directamente (eso ya lo cubren e2e/m3-motores.ts y
 * e2e/verificador-endpoint.ts):
 *
 *  a — con EXACTAMENTE un motor elegible: `#selector-motor` no existe en el
 *      DOM, y un proyecto cuyo motor anterior se apagó (repunteo real, no
 *      "nunca tuvo motor") NO muestra el aviso de repunteo — el aviso se
 *      refiere a un control que el docente no puede ver.
 *  b — con DOS motores elegibles: el selector vuelve a mostrarse, exactamente
 *      como antes de T6.
 *  c — sin ningún motor `isVerifier`: tras un turno de generación real (mock
 *      generador), CERO pedidos del navegador a `/api/chat/verificar`, cero
 *      pedidos a `/v1/responses`, ningún texto del panel del verificador, y
 *      ningún `console.error`/`console.warn`/`pageerror` que lo mencione.
 *
 * La base de dev es compartida con el resto de la familia (m2/m3/t5/
 * verificador-*): "exactamente un motor elegible" se logra apagando
 * `selectableByTeacher` de TODO lo que no sea el default de la semilla,
 * sin asumir qué dejó otra corrida — y se restaura en el `finally`. Mismo
 * criterio para `isVerifier`.
 *
 * Requiere la pila de desarrollo levantada (`docker compose up -d db`,
 * `npm run dev` en el puerto 3000). Corre con:
 *   npx tsx e2e/selector-y-verificador-opcional.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-selector-verificador-opcional@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

/** El único default de la semilla (migration.sql 20260919000000) — mismo
 *  supuesto que ya usan e2e/m2-catalogo.ts y e2e/m3-motores.ts. */
const MINIMAX_M3_ID = '10000000-0000-0000-0000-000000000001';

const PROVIDER_TEMPORAL_KIND = 'kodu-e2e-selector-temporal';
const PROVIDER_TEMPORAL_LABEL = 'Cuenta E2E temporal (selector, T6)';
const MODELO_TEMPORAL_PROVIDER_MODEL = 'modelo-temporal-t6';
const MODELO_TEMPORAL_DISPLAY_NAME = 'Motor temporal T6 (nunca se llama de verdad)';

const PROVIDER_GENERADOR_KIND = 'kodu-mock-t3';
const PROVIDER_GENERADOR_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_GENERADOR_PROVIDER_MODEL = 'mock-t3';
const MODEL_GENERADOR_DISPLAY_NAME = 'Mock local (T3+)';

const AVISO_REPUNTEO = 'Cambiamos el motor de este proyecto porque el anterior ya no está disponible.';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polling corto, mismo patrón que e2e/m3-motores.ts: el aviso lo dispara un
 *  `useEffect` al hidratar (no está en el HTML del SSR). */
async function hayAvisoRepunteo(page: Page, timeoutMs = 4_000): Promise<boolean> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if ((await page.getByText(AVISO_REPUNTEO).count()) > 0) return true;
    await esperar(50);
  }
  return false;
}

async function asegurarDocenteNoPrime(): Promise<string> {
  const fila = await prisma.user.upsert({
    where: { email: DOCENTE_EMAIL },
    update: { role: 'DOCENTE', primeAccess: false },
    create: {
      email: DOCENTE_EMAIL,
      name: 'Docente E2E selector/verificador opcional',
      role: 'DOCENTE',
      passwordHash: await hashPassword(DOCENTE_PASSWORD),
    },
    select: { id: true },
  });
  return fila.id;
}

async function fijarSettings(adminPage: Page, datos: Record<string, boolean>): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/settings`, { data: datos });
  assert.ok(respuesta.ok(), `PATCH /api/admin/settings ${JSON.stringify(datos)}: ${respuesta.status()} ${await respuesta.text()}`);
}

async function fijarSelectableByTeacher(adminPage: Page, modelId: string, valor: boolean): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/models/${modelId}`, {
    data: { selectableByTeacher: valor },
  });
  assert.ok(respuesta.ok(), `PATCH selectableByTeacher=${valor} en ${modelId}: ${respuesta.status()} ${await respuesta.text()}`);
}

async function fijarEnabled(adminPage: Page, modelId: string, valor: boolean): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/models/${modelId}`, { data: { enabled: valor } });
  assert.ok(respuesta.ok(), `PATCH enabled=${valor} en ${modelId}: ${respuesta.status()} ${await respuesta.text()}`);
}

async function fijarIsVerifier(adminPage: Page, modelId: string, valor: boolean): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/models/${modelId}`, { data: { isVerifier: valor } });
  assert.ok(respuesta.ok(), `PATCH isVerifier=${valor} en ${modelId}: ${respuesta.status()} ${await respuesta.text()}`);
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
      },
    });
    assert.equal(respuesta.status(), 200, `alta del motor generador: ${respuesta.status()} ${await respuesta.text()}`);
    modelId = ((await respuesta.json()) as { motor: { id: string } }).motor.id;
  } else if (!modeloExistente!.enabled) {
    await fijarEnabled(adminPage, modelId, true);
  }

  return modelId;
}

async function crearProyecto(page: Page, title: string, modelId: string): Promise<string> {
  const creado = await page.request.post(`${BASE_URL}/api/projects`, { data: { title } });
  assert.equal(creado.status(), 200, `alta del proyecto "${title}": ${creado.status()} ${await creado.text()}`);
  const { project } = (await creado.json()) as { project: { id: string } };
  await prisma.project.update({ where: { id: project.id }, data: { aiModelId: modelId } });
  return project.id;
}

function htmlSano(marca: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="pizarron">
<title>Selector/verificador ${marca}</title>
</head>
<body data-marca="${marca}">
  <h1>Practicá la tabla del 7</h1>
  <button id="comprobar" type="button">Comprobar</button>
  <p id="mensaje"></p>
  <script>
    document.getElementById('comprobar').addEventListener('click', function () {
      document.getElementById('mensaje').textContent = '¡Correcto!';
    });
  </script>
</body>
</html>`;
}

/** Distingue un pedido `/v1/responses` (Responses API, el verificador) de
 *  uno `/v1/chat/completions` — mismo criterio que e2e/verificador-editor.ts. */
function esPedidoResponses(body: Record<string, unknown>): boolean {
  return 'input' in body;
}

async function main(): Promise<void> {
  await asegurarDocenteNoPrime();

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  const browser = await abrirNavegador();
  let motoresTemporalmenteNoSeleccionables: string[] = [];
  let motorTemporalId = '';
  let modelGeneradorId = '';
  let modelosConVerificadorPrendido: string[] = [];

  try {
    const adminContext: BrowserContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    // Sin prime/auto-revisión/versiones — ninguno de esos se mete en el
    // conteo de pedidos ni en la línea de tiempo del turno (mismo criterio
    // que el resto de la familia verificador-*).
    await fijarSettings(adminPage, { primeEnabled: false, autoReviewForAll: false, deepModeForAll: false, versionsForAll: false });

    // ───────────────────────────────────────────────────────────
    // Preparación determinística: "exactamente un motor elegible" (MiniMax
    // M3, el default de la semilla) sin asumir qué dejó otra corrida en esta
    // base compartida. Se restaura en el `finally`.
    // ───────────────────────────────────────────────────────────
    invalidarCatalogo();
    const elegiblesAntes = await motoresParaDocente(false);
    motoresTemporalmenteNoSeleccionables = elegiblesAntes.map((m) => m.id).filter((id) => id !== MINIMAX_M3_ID);
    for (const id of motoresTemporalmenteNoSeleccionables) {
      await fijarSelectableByTeacher(adminPage, id, false);
    }
    console.log(
      `✔ preparación: ${motoresTemporalmenteNoSeleccionables.length} motor(es) extra puestos no-seleccionables — sólo MiniMax M3 elegible`,
    );

    // Ídem para "ningún motor verificador": apaga cualquier isVerifier que
    // haya quedado prendido de otra corrida interrumpida.
    modelosConVerificadorPrendido = (await prisma.aiModel.findMany({ where: { isVerifier: true }, select: { id: true } })).map(
      (fila) => fila.id,
    );
    for (const id of modelosConVerificadorPrendido) await fijarIsVerifier(adminPage, id, false);
    console.log(`✔ preparación: ${modelosConVerificadorPrendido.length} motor(es) con isVerifier apagados — ningún verificador activo`);

    // Motor "temporal", propio de este script (cuenta y motor exclusivos, se
    // borran enteros al final): sólo sirve para simular "el docente tenía
    // este motor asignado y se apagó" — nunca se le manda ningún pedido.
    const respuestaProveedorTemporal = await adminPage.request.post(`${BASE_URL}/api/admin/providers`, {
      data: { kind: PROVIDER_TEMPORAL_KIND, label: PROVIDER_TEMPORAL_LABEL, baseUrl: 'https://example.test/api', apiKey: 'clave-de-prueba' },
    });
    assert.equal(
      respuestaProveedorTemporal.status(),
      200,
      `alta de la cuenta temporal: ${respuestaProveedorTemporal.status()} ${await respuestaProveedorTemporal.text()}`,
    );
    const { proveedor: proveedorTemporal } = (await respuestaProveedorTemporal.json()) as { proveedor: { id: string } };

    const respuestaMotorTemporal = await adminPage.request.post(`${BASE_URL}/api/admin/models`, {
      data: {
        providerId: proveedorTemporal.id,
        providerModel: MODELO_TEMPORAL_PROVIDER_MODEL,
        displayName: MODELO_TEMPORAL_DISPLAY_NAME,
        selectableByTeacher: false,
      },
    });
    assert.equal(
      respuestaMotorTemporal.status(),
      200,
      `alta del motor temporal: ${respuestaMotorTemporal.status()} ${await respuestaMotorTemporal.text()}`,
    );
    motorTemporalId = ((await respuestaMotorTemporal.json()) as { motor: { id: string } }).motor.id;

    // El motor generador REAL (mismo mock/cuenta compartida que el resto de
    // la familia T3+): nace no-seleccionable, recién se habilita para la
    // escena B.
    modelGeneradorId = await asegurarMotorGenerador(adminPage, mock.url);
    await fijarSelectableByTeacher(adminPage, modelGeneradorId, false);
    console.log(`✔ preparación lista: motor temporal (${motorTemporalId}) y generador (${modelGeneradorId}, aún no elegible)`);

    const docenteContext = await browser.newContext();
    const docentePage = await docenteContext.newPage();
    await iniciarSesion(docentePage, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    let pedidosAVerificar = 0;
    docentePage.on('request', (req: Request) => {
      if (req.url().endsWith('/api/chat/verificar')) pedidosAVerificar++;
    });

    const consoleOProblemasDeVerificador: string[] = [];
    docentePage.on('pageerror', (error) => {
      if (/verificador/i.test(error.message)) consoleOProblemasDeVerificador.push(`pageerror: ${error.message}`);
    });
    docentePage.on('console', (msg) => {
      if ((msg.type() === 'error' || msg.type() === 'warning') && /verificador/i.test(msg.text())) {
        consoleOProblemasDeVerificador.push(`console.${msg.type()}: ${msg.text()}`);
      }
    });

    // ───────────────────────────────────────────────────────────
    // Escena A — exactamente un motor elegible (MiniMax M3): el selector no
    // existe en el DOM, y un proyecto cuyo motor anterior se apagó (repunteo
    // REAL, `motorOriginal !== null`) no muestra el aviso.
    // ───────────────────────────────────────────────────────────
    const proyectoA = await crearProyecto(docentePage, 'Selector/verificador — escena A', motorTemporalId);
    await fijarEnabled(adminPage, motorTemporalId, false); // "el motor anterior ya no está disponible".

    await docentePage.goto(`${BASE_URL}/app/project/${proyectoA}`, { waitUntil: 'domcontentloaded' });
    await docentePage.getByPlaceholder('Preguntale a Kodu…').waitFor();

    assert.equal(
      await docentePage.locator('#selector-motor').count(),
      0,
      'con un solo motor elegible, el selector no debería existir en el DOM',
    );
    console.log('✔ escena A (1/2): con un solo motor elegible, #selector-motor no existe');

    assert.equal(
      await hayAvisoRepunteo(docentePage, 1_500),
      false,
      'el aviso de repunteo no debería mostrarse sin selector visible',
    );
    const proyectoATrasAbrir = await prisma.project.findUniqueOrThrow({ where: { id: proyectoA }, select: { aiModelId: true } });
    assert.equal(
      proyectoATrasAbrir.aiModelId,
      MINIMAX_M3_ID,
      'el repunteo tiene que haber pasado de verdad (si no, la ausencia del aviso no prueba nada)',
    );
    console.log('✔ escena A (2/2): repunteo real (motor apagado → default) SIN aviso, porque el selector está oculto');

    // ───────────────────────────────────────────────────────────
    // Escena B — dos motores elegibles: el selector vuelve a mostrarse,
    // exactamente como antes de T6.
    // ───────────────────────────────────────────────────────────
    await fijarSelectableByTeacher(adminPage, modelGeneradorId, true);

    await docentePage.reload({ waitUntil: 'domcontentloaded' });
    await docentePage.getByPlaceholder('Preguntale a Kodu…').waitFor();

    const disparadorSelector = docentePage.locator('#selector-motor');
    await disparadorSelector.waitFor();
    console.log('✔ escena B (1/2): con dos motores elegibles, #selector-motor vuelve a existir');

    await disparadorSelector.click();
    const listbox = docentePage.locator('ul[role="listbox"]');
    await listbox.waitFor();
    assert.equal(await docentePage.locator('li[role="option"]').count(), 2, 'con dos motores elegibles, el listbox tiene 2 opciones');
    await docentePage.keyboard.press('Escape');
    await listbox.waitFor({ state: 'hidden' });
    console.log('✔ escena B (2/2): el listbox lista exactamente los 2 motores elegibles');

    // ───────────────────────────────────────────────────────────
    // Escena C — sin ningún motor verificador: tras un turno de generación
    // real (mock generador), cero pedidos a /api/chat/verificar y a
    // /v1/responses, ningún texto del panel, ningún console/pageerror que
    // mencione al verificador.
    // ───────────────────────────────────────────────────────────
    await prisma.project.update({ where: { id: proyectoA }, data: { aiModelId: modelGeneradorId } });
    await docentePage.reload({ waitUntil: 'domcontentloaded' });

    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlSano('escena-c'), chunkDelayMs: 5, chunkBytes: 20_000 });

    pedidosAVerificar = 0;
    const campo = docentePage.locator('textarea[placeholder="Preguntale a Kodu…"]');
    const enviar = docentePage.getByRole('button', { name: 'Enviar' });
    await campo.click();
    await campo.pressSequentially('Armame algo simple (escena C)', { delay: 10 });
    await enviar.click();
    await enviar.waitFor({ state: 'visible', timeout: 45_000 });

    // Margen tras el turno: si algo llamara al verificador, tiene tiempo de sobra.
    await esperar(1_000);

    assert.equal(pedidosAVerificar, 0, 'T7: sin motor verificador, el editor nunca llama a /api/chat/verificar');
    assert.equal(
      mock.llamadas.filter((l) => esPedidoResponses(l.body)).length,
      0,
      'T7: sin motor verificador, tampoco llega ningún pedido a /v1/responses',
    );
    assert.equal(await docentePage.getByText('Revisando el recurso…').count(), 0, 'el panel del verificador nunca arranca');
    assert.equal(await docentePage.getByText(/Revisé el recurso/).count(), 0, 'ningún resumen del verificador en pantalla');
    assert.equal(await docentePage.getByText('Revisá este dato:').count(), 0, 'ningún ítem de contenido del verificador en pantalla');
    assert.deepEqual(
      consoleOProblemasDeVerificador,
      [],
      `no debería haber console.error/warning ni pageerror mencionando al verificador: ${JSON.stringify(consoleOProblemasDeVerificador)}`,
    );
    console.log('✔ escena C: sin motor verificador, un turno real no deja rastro del verificador (pedidos, panel ni consola)');

    console.log('\n✔ e2e/selector-y-verificador-opcional.ts: todas las escenas pasaron');
  } finally {
    try {
      const adminContext2 = await browser.newContext();
      const adminPage2 = await adminContext2.newPage();
      await iniciarSesion(adminPage2, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      for (const id of motoresTemporalmenteNoSeleccionables) {
        await fijarSelectableByTeacher(adminPage2, id, true).catch(() => {});
      }
      if (modelGeneradorId) await fijarSelectableByTeacher(adminPage2, modelGeneradorId, true).catch(() => {});
      for (const id of modelosConVerificadorPrendido) {
        await fijarIsVerifier(adminPage2, id, true).catch(() => {});
      }

      await fijarSettings(adminPage2, { primeEnabled: false, autoReviewForAll: false, deepModeForAll: false, versionsForAll: false });
      await adminContext2.close();

      // Un solo docente de prueba, un solo proyecto por corrida: alcanza con
      // borrar todo lo que le pertenezca (mismo patrón que
      // e2e/m3-motores.ts's `limpiarEstado`).
      const docente = await prisma.user.findUnique({ where: { email: DOCENTE_EMAIL }, select: { id: true } });
      if (docente) await prisma.project.deleteMany({ where: { userId: docente.id } });

      // La cuenta y el motor temporales son EXCLUSIVOS de este script: se
      // borran enteros, no se restauran (no los usa ningún otro script).
      await prisma.aiModel.deleteMany({ where: { provider: { kind: PROVIDER_TEMPORAL_KIND } } });
      await prisma.aiProvider.deleteMany({ where: { kind: PROVIDER_TEMPORAL_KIND } });

      console.log('✔ limpieza: flags restaurados, proyectos y cuenta temporal borrados');
    } catch (error) {
      console.error('[selector-y-verificador-opcional] no se pudo limpiar el estado al final:', error);
    }

    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
console.log('\n✔ e2e/selector-y-verificador-opcional.ts: terminado');
