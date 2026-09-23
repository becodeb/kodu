import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, conTema, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';
import type { Page } from 'playwright';

/**
 * Chequeo de navegador + API de T5 (odd/tasks/modo-prime.md, "Modo prime y
 * funciones para todos"). Requiere la pila de desarrollo levantada (`docker
 * compose up -d db`, `npm run dev` en el puerto 3000) y REUSA el
 * AiProvider mock que dejó T3 en la base de desarrollo (kind "kodu-mock-t3")
 * — lo crea si todavía no existe, para que este script también ande solo
 * contra una base nueva. Le agrega un SEGUNDO AiModel sobre la MISMA cuenta,
 * marcado `primeOnly: true` (providerModel "mock-prime"), así el `model`
 * que el mock recibió en cada pedido (`mock.llamadas[].body.model`) dice
 * cuál de los dos motores respondió.
 *
 * Corre con: npx tsx e2e/t5-modo-prime.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const MARCADO_EMAIL = 'docente-e2e-t5-marcado@kodu.local';
const MARCADO_PASSWORD = 'Docente.E2E.2026';
const NORMAL_EMAIL = 'docente-e2e-t5-normal@kodu.local';
const NORMAL_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_KIND = 'kodu-mock-t3';
const PROVIDER_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_NORMAL_PROVIDER_MODEL = 'mock-t3';
const MODEL_NORMAL_DISPLAY_NAME = 'Mock local (T3+)';
const MODEL_PRIME_PROVIDER_MODEL = 'mock-prime';
const MODEL_PRIME_DISPLAY_NAME = 'Mock prime (T5, e2e/mock-proveedor.ts)';

const SCREENSHOT_DIR = '/tmp/kodu-t5';

/** HTML mínimo pero válido: los turnos de este script no verifican contenido, sólo routing. */
const HTML_DE_PRUEBA =
  '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="kodu-tema" content="pizarron"><title>T5</title></head><body><h1>T5</h1></body></html>';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function esperarHasta(condicion: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (await condicion()) return;
    await esperar(150);
  }
  throw new Error('esperarHasta: la condición nunca se cumplió a tiempo');
}

async function asegurarDocente(email: string, password: string, nombre: string): Promise<string> {
  const fila = await prisma.user.upsert({
    where: { email },
    update: { role: 'DOCENTE', primeAccess: false },
    create: { email, name: nombre, role: 'DOCENTE', passwordHash: await hashPassword(password) },
    select: { id: true },
  });
  return fila.id;
}

/** Cuenta y los dos motores mock — reusa lo que dejó T3/T4, crea el prime-only si hace falta. */
async function asegurarProveedorYMotoresMock(
  adminPage: Page,
  mockUrl: string,
): Promise<{ providerId: string; modelIdNormal: string; modelIdPrime: string }> {
  const proveedorExistente = await prisma.aiProvider.findFirst({ where: { kind: PROVIDER_KIND } });
  let providerId = proveedorExistente?.id ?? null;

  if (!providerId) {
    const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/providers`, {
      data: { kind: PROVIDER_KIND, label: PROVIDER_LABEL, baseUrl: mockUrl, apiKey: 'clave-de-prueba-del-mock' },
    });
    assert.equal(respuesta.status(), 200, `alta de la cuenta mock: ${respuesta.status()} ${await respuesta.text()}`);
    providerId = ((await respuesta.json()) as { proveedor: { id: string } }).proveedor.id;
  }

  const modeloNormalExistente = await prisma.aiModel.findFirst({
    where: { providerId, providerModel: MODEL_NORMAL_PROVIDER_MODEL },
  });
  let modelIdNormal = modeloNormalExistente?.id ?? null;

  if (!modelIdNormal) {
    const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/models`, {
      data: {
        providerId,
        providerModel: MODEL_NORMAL_PROVIDER_MODEL,
        displayName: MODEL_NORMAL_DISPLAY_NAME,
        description: 'Proveedor simulado para chequeos de navegador. No usar con docentes reales.',
        selectableByTeacher: true,
      },
    });
    assert.equal(respuesta.status(), 200, `alta del motor mock normal: ${respuesta.status()} ${await respuesta.text()}`);
    modelIdNormal = ((await respuesta.json()) as { motor: { id: string } }).motor.id;
  } else if (!modeloNormalExistente!.selectableByTeacher) {
    // T3/T4 lo dejaron no-seleccionable en algún escenario intermedio; T5 lo necesita visible.
    await prisma.aiModel.update({ where: { id: modelIdNormal }, data: { selectableByTeacher: true, enabled: true } });
  }

  const modeloPrimeExistente = await prisma.aiModel.findFirst({
    where: { providerId, providerModel: MODEL_PRIME_PROVIDER_MODEL },
  });
  let modelIdPrime = modeloPrimeExistente?.id ?? null;

  if (!modelIdPrime) {
    const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/models`, {
      data: {
        providerId,
        providerModel: MODEL_PRIME_PROVIDER_MODEL,
        displayName: MODEL_PRIME_DISPLAY_NAME,
        description: 'Motor exclusivo de prime, para el chequeo de e2e/t5-modo-prime.ts. No usar con docentes reales.',
        selectableByTeacher: true,
        primeOnly: true,
      },
    });
    assert.equal(respuesta.status(), 200, `alta del motor mock prime: ${respuesta.status()} ${await respuesta.text()}`);
    modelIdPrime = ((await respuesta.json()) as { motor: { id: string } }).motor.id;
  } else if (!modeloPrimeExistente!.primeOnly || !modeloPrimeExistente!.selectableByTeacher) {
    const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/models/${modelIdPrime}`, {
      data: { primeOnly: true, selectableByTeacher: true, enabled: true },
    });
    assert.equal(respuesta.status(), 200, `restaurar el motor mock prime: ${respuesta.status()} ${await respuesta.text()}`);
  }

  return { providerId, modelIdNormal, modelIdPrime };
}

/** Fuerza el `AppSettings` que necesita este pedido, vía la API de admin (nunca Prisma directo — invalidaría el
 *  caché de 10s del proceso equivocado, mismo motivo que documentan e2e/m6-acceso.ts y e2e/m7-demo.ts). */
async function fijarSettings(adminPage: Page, datos: Record<string, boolean>): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/settings`, { data: datos });
  assert.ok(respuesta.ok(), `PATCH /api/admin/settings ${JSON.stringify(datos)}: ${respuesta.status()} ${await respuesta.text()}`);
}

/** Mismo motivo: el motor por defecto vive en el caché de 30s de catalogo.ts, sólo la API lo invalida. */
async function fijarDefault(adminPage: Page, modelId: string): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/models/${modelId}`, {
    data: { isDefault: true },
  });
  assert.ok(respuesta.ok(), `marcar ${modelId} como default: ${respuesta.status()} ${await respuesta.text()}`);
}

async function crearProyecto(page: Page, title: string): Promise<{ id: string; threadId: string }> {
  const creado = await page.request.post(`${BASE_URL}/api/projects`, { data: { title } });
  assert.equal(creado.status(), 200, `alta del proyecto "${title}": ${creado.status()} ${await creado.text()}`);
  const { project } = (await creado.json()) as { project: { id: string; threadId: string } };
  return project;
}

/** Manda un turno por la API cruda (sin pasar por el compositor) y devuelve el status. */
async function enviarTurnoPorApi(
  page: Page,
  args: { projectId: string; threadId: string; message: string; modelId: string },
): Promise<number> {
  const resp = await page.request.post(`${BASE_URL}/api/chat/stream`, {
    data: { projectId: args.projectId, threadId: args.threadId, message: args.message, model: args.modelId },
  });
  return resp.status();
}

/**
 * `li[role="option"]` junta el `displayName` y la descripción en dos `<p>`
 * hermanos SIN separador (SelectorDeMotor.tsx): `allTextContents()` los
 * concatena sin espacio, así que un `array.includes(displayName)` exacto
 * nunca es cierto (ni cuando el motor SÍ está listado) — hace falta "algún
 * texto CONTIENE el nombre".
 */
function contieneMotor(opciones: string[], displayName: string): boolean {
  return opciones.some((texto) => texto.includes(displayName));
}

/**
 * Alterna una casilla de `Interruptor.tsx` haciendo clic en su `<label>`,
 * NO directamente sobre el `<input class="sr-only">` (que adentro del
 * `Modal.tsx` de ModeloForm queda en un área de 1×1 px que un click con
 * `{force:true}` a veces no logra impactar — el mismo patrón SÍ funciona
 * sobre el `<input>` directo en las filas de ModelosPanel.tsx, que no están
 * dentro de un modal). Clickear el `<label>` es además más fiel a como lo
 * haría un docente de verdad: el native `<label for>` activa el control
 * asociado sin importar dónde cae el input invisible.
 */
async function alternarCasillaPorLabel(page: Page, textoLabel: string): Promise<void> {
  await page.locator('label', { hasText: textoLabel }).click({ force: true });
}

/** Abre el selector de motor, lee los `displayName` visibles, y lo cierra con Escape sin elegir nada. */
async function opcionesDelSelector(page: Page): Promise<string[]> {
  const disparador = page.locator('#selector-motor');
  const listbox = page.locator('ul[role="listbox"]');
  await disparador.waitFor();

  await esperarHasta(async () => {
    await disparador.focus();
    await page.keyboard.press('Enter');
    return (await listbox.count()) > 0;
  });

  const textos = await page.locator('li[role="option"]').allTextContents();
  await page.keyboard.press('Escape');
  await listbox.waitFor({ state: 'hidden' }).catch(() => {});
  return textos;
}

/** "Sigue la entrada" de la demo — mismo POST que login.astro, ver e2e/m7-demo.ts. */
async function entrarComoDemo(page: Page): Promise<void> {
  const respuesta = await page.request.post(`${BASE_URL}/api/auth/demo`, { data: {} });
  assert.ok(respuesta.ok(), `POST /api/auth/demo debe responder 200 (dio ${respuesta.status()})`);
}

async function main(): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const marcadoId = await asegurarDocente(MARCADO_EMAIL, MARCADO_PASSWORD, 'Docente E2E T5 (marcado)');
  await asegurarDocente(NORMAL_EMAIL, NORMAL_PASSWORD, 'Docente E2E T5 (sin marcar)');

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  function programarTurnoRapido(): void {
    mock.programarRespuesta({ texto: 'Listo.', html: HTML_DE_PRUEBA, chunkDelayMs: 5, chunkBytes: 10_000 });
  }

  const browser = await abrirNavegador();
  let defaultOriginalId: string | null = null;

  try {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const { modelIdNormal, modelIdPrime } = await asegurarProveedorYMotoresMock(adminPage, mock.url);
    console.log(`✔ motores mock listos (normal=${modelIdNormal}, prime=${modelIdPrime})`);

    // El motor por defecto vive en un índice único parcial (a lo sumo una fila
    // en true, en TODA la tabla — no sólo entre los de prueba). Para que la
    // caída al default de un pedido sin prime aterrice en el mock (y no en un
    // proveedor real sin key cargada en este .env), el mock normal pasa a ser
    // el default por la duración de este script; se restaura el original al
    // final, mismo cuidado que ya toma e2e/m3-motores.ts.
    const defaultOriginal = await prisma.aiModel.findFirst({ where: { isDefault: true }, select: { id: true } });
    defaultOriginalId = defaultOriginal?.id ?? null;
    await fijarDefault(adminPage, modelIdNormal);
    console.log(`✔ ${MODEL_NORMAL_DISPLAY_NAME} es el default temporal (original: ${defaultOriginalId ?? 'ninguno'})`);

    await adminPage.request.patch(`${BASE_URL}/api/admin/users/${marcadoId}`, { data: { primeAccess: true } });
    console.log('✔ cuenta marcada con primeAccess=true');

    // Estado inicial conocido: apagado. No se asume el default de la
    // columna — se fuerza, así el primer chequeo (escena 1) es real.
    await fijarSettings(adminPage, { primeEnabled: false });

    // ───────────────────────────────────────────────────────────
    // Escena 1 — interruptor general apagado: nadie tiene prime, ni
    // siquiera un admin ni una cuenta marcada.
    // ───────────────────────────────────────────────────────────
    const proyectoAdmin = await crearProyecto(adminPage, 'T5 — admin');
    await adminPage.goto(`${BASE_URL}/app/project/${proyectoAdmin.id}`, { waitUntil: 'domcontentloaded' });
    const opcionesAdminApagado = await opcionesDelSelector(adminPage);
    assert.ok(
      !contieneMotor(opcionesAdminApagado, MODEL_PRIME_DISPLAY_NAME),
      'con el interruptor apagado, ni el admin ve el motor prime-only',
    );

    mock.llamadas.length = 0;
    programarTurnoRapido();
    const statusApagado = await enviarTurnoPorApi(adminPage, {
      projectId: proyectoAdmin.id,
      threadId: proyectoAdmin.threadId,
      message: 'Armá algo simple para probar',
      modelId: modelIdPrime,
    });
    assert.equal(statusApagado, 200, 'el turno igual se resuelve (cae al default), no un error');
    assert.equal(
      mock.llamadas.at(-1)?.body.model,
      MODEL_NORMAL_PROVIDER_MODEL,
      'con el interruptor apagado, hasta un admin pidiendo el motor prime-only a mano cae al default',
    );
    console.log('✔ escena 1: interruptor general apagado → nadie tiene prime (probado con un admin)');

    // El PATCH del recurso tampoco guarda un motor que esta persona no podría
    // elegir en el selector: ni uno exclusivo sin prime, ni un id inexistente
    // (antes de este chequeo, ese caso terminaba en un 500 por la FK).
    const patchMotor = (aiModelId: string) =>
      adminPage.request.patch(`${BASE_URL}/api/projects/${proyectoAdmin.id}`, { data: { aiModelId } });
    assert.equal((await patchMotor(modelIdPrime)).status(), 422, 'sin prime, el PATCH rechaza el motor prime-only');
    assert.equal((await patchMotor('no-existe')).status(), 422, 'un id inexistente es un 422, no un 500');
    assert.equal((await patchMotor(modelIdNormal)).status(), 200, 'un motor elegible se guarda');
    console.log('✔ escena 1b: el PATCH del recurso sólo guarda motores elegibles');

    // ───────────────────────────────────────────────────────────
    // Prende el interruptor general. `demoEnabled` también: la escena 2b
    // necesita "seguir la entrada" a la demo (POST /api/auth/demo da 404
    // con la demo apagada — design.md §8), y no se asume su default.
    // ───────────────────────────────────────────────────────────
    await fijarSettings(adminPage, { primeEnabled: true, demoEnabled: true });

    // ───────────────────────────────────────────────────────────
    // Escena 2a — el admin ve y puede usar el motor prime-only.
    // ───────────────────────────────────────────────────────────
    await adminPage.goto(`${BASE_URL}/app/project/${proyectoAdmin.id}`, { waitUntil: 'domcontentloaded' });
    const opcionesAdminPrendido = await opcionesDelSelector(adminPage);
    assert.ok(contieneMotor(opcionesAdminPrendido, MODEL_PRIME_DISPLAY_NAME), 'con prime, el admin ve el motor prime-only');

    mock.llamadas.length = 0;
    programarTurnoRapido();
    const statusAdmin = await enviarTurnoPorApi(adminPage, {
      projectId: proyectoAdmin.id,
      threadId: proyectoAdmin.threadId,
      message: 'Armá algo simple para probar',
      modelId: modelIdPrime,
    });
    assert.equal(statusAdmin, 200);
    assert.equal(mock.llamadas.at(-1)?.body.model, MODEL_PRIME_PROVIDER_MODEL, 'el admin SÍ puede usar el motor prime-only');
    console.log('✔ escena 2a: el admin ve y puede usar el motor prime-only');

    // ───────────────────────────────────────────────────────────
    // Escena 2b — la cuenta demo ve y puede usar el motor prime-only.
    // ───────────────────────────────────────────────────────────
    const demoContext = await browser.newContext();
    const demoPage = await demoContext.newPage();
    await entrarComoDemo(demoPage);
    const proyectoDemo = await crearProyecto(demoPage, 'T5 — demo');
    await demoPage.goto(`${BASE_URL}/app/project/${proyectoDemo.id}`, { waitUntil: 'domcontentloaded' });
    const opcionesDemo = await opcionesDelSelector(demoPage);
    assert.ok(contieneMotor(opcionesDemo, MODEL_PRIME_DISPLAY_NAME), 'con prime, la demo ve el motor prime-only');

    mock.llamadas.length = 0;
    programarTurnoRapido();
    const statusDemo = await enviarTurnoPorApi(demoPage, {
      projectId: proyectoDemo.id,
      threadId: proyectoDemo.threadId,
      message: 'Armá algo simple para probar',
      modelId: modelIdPrime,
    });
    assert.equal(statusDemo, 200);
    assert.equal(mock.llamadas.at(-1)?.body.model, MODEL_PRIME_PROVIDER_MODEL, 'la demo SÍ puede usar el motor prime-only');
    console.log('✔ escena 2b: la cuenta demo ve y puede usar el motor prime-only');

    // ───────────────────────────────────────────────────────────
    // Escena 2c — un docente MARCADO ve y puede usar el motor prime-only.
    // Ejercitado por la UI real (selector + compositor), no sólo por API:
    // Playwright `locator.fill()` NO dispara el `onChange` de React en este
    // editor (el valor queda en el DOM pero `draft` sigue vacío y "Enviar"
    // queda deshabilitado) — hace falta `pressSequentially`, tecla por tecla
    // (hallazgo de T3, ver odd/tasks/modo-prime.md).
    // ───────────────────────────────────────────────────────────
    const marcadoContext = await browser.newContext();
    const marcadoPage = await marcadoContext.newPage();
    await iniciarSesion(marcadoPage, { email: MARCADO_EMAIL, password: MARCADO_PASSWORD });
    const proyectoMarcado = await crearProyecto(marcadoPage, 'T5 — docente marcado');
    await marcadoPage.goto(`${BASE_URL}/app/project/${proyectoMarcado.id}`, { waitUntil: 'domcontentloaded' });

    const opcionesMarcado = await opcionesDelSelector(marcadoPage);
    assert.ok(contieneMotor(opcionesMarcado, MODEL_PRIME_DISPLAY_NAME), 'con prime, la cuenta marcada ve el motor prime-only');

    // Elige el motor prime-only en el selector, por teclado (mismo patrón que e2e/m3-motores.ts).
    const disparadorSelector = marcadoPage.locator('#selector-motor');
    const listboxMarcado = marcadoPage.locator('ul[role="listbox"]');
    await disparadorSelector.focus();
    await marcadoPage.keyboard.press('Enter');
    await listboxMarcado.waitFor();
    const idOpcionPrime = `opt-${modelIdPrime}`;
    for (let vueltas = 0; vueltas < 20; vueltas++) {
      if ((await listboxMarcado.getAttribute('aria-activedescendant')) === idOpcionPrime) break;
      await marcadoPage.keyboard.press('ArrowDown');
    }
    assert.equal(await listboxMarcado.getAttribute('aria-activedescendant'), idOpcionPrime);
    await marcadoPage.keyboard.press('Enter');
    await listboxMarcado.waitFor({ state: 'hidden' });
    await marcadoPage.waitForSelector(`#selector-motor:has-text("${MODEL_PRIME_DISPLAY_NAME}")`);

    mock.llamadas.length = 0;
    programarTurnoRapido();
    const campoMensaje = marcadoPage.locator('textarea[placeholder="Preguntale a Kodu…"]');
    const botonEnviar = marcadoPage.getByRole('button', { name: 'Enviar' });
    await campoMensaje.click();
    await campoMensaje.pressSequentially('Armá algo simple para probar', { delay: 10 });
    assert.equal(await campoMensaje.inputValue(), 'Armá algo simple para probar', 'no se pudo escribir en el compositor');
    await botonEnviar.click();
    await botonEnviar.waitFor({ state: 'visible', timeout: 30_000 }); // vuelve a decir "Enviar" cuando el turno termina

    assert.equal(mock.llamadas.length, 1, 'un solo turno tiene que haber llegado al mock');
    assert.equal(
      mock.llamadas[0]!.body.model,
      MODEL_PRIME_PROVIDER_MODEL,
      'la cuenta marcada SÍ puede usar el motor prime-only, por la UI real',
    );
    console.log('✔ escena 2c: una cuenta marcada ve y puede usar el motor prime-only (UI real, compositor incluido)');

    // El turno de arriba dejó el proyecto guardado con aiModelId = prime-only
    // (mismo mecanismo de stream.ts que usa cualquier cambio de motor) — se
    // reusa tal cual para la escena 3, más abajo.
    const proyectoMarcadoTrasUsar = await prisma.project.findUniqueOrThrow({ where: { id: proyectoMarcado.id } });
    assert.equal(proyectoMarcadoTrasUsar.aiModelId, modelIdPrime, 'el turno de arriba tiene que haber guardado el motor prime-only');

    // ───────────────────────────────────────────────────────────
    // Escena 2d — un docente SIN marcar no lo ve, no lo puede forzar por
    // API, y su código fuente no menciona "prime" en ningún lado.
    // ───────────────────────────────────────────────────────────
    const normalContext = await browser.newContext();
    const normalPage = await normalContext.newPage();
    await iniciarSesion(normalPage, { email: NORMAL_EMAIL, password: NORMAL_PASSWORD });
    const proyectoNormal = await crearProyecto(normalPage, 'T5 — docente sin marcar');
    await normalPage.goto(`${BASE_URL}/app/project/${proyectoNormal.id}`, { waitUntil: 'domcontentloaded' });

    const opcionesNormal = await opcionesDelSelector(normalPage);
    assert.ok(
      !contieneMotor(opcionesNormal, MODEL_PRIME_DISPLAY_NAME),
      'un docente sin marcar NUNCA tiene que ver el motor prime-only en el selector',
    );

    const fuente = await normalPage.content();
    assert.ok(
      !/\bprime\b/i.test(fuente),
      'el código fuente del editor de un docente sin marcar no puede mencionar "prime" en ningún lado',
    );
    console.log('✔ escena 2d (1/2): un docente sin marcar no ve el motor prime-only, y su página no dice "prime"');

    mock.llamadas.length = 0;
    programarTurnoRapido();
    const statusNormalForzado = await enviarTurnoPorApi(normalPage, {
      projectId: proyectoNormal.id,
      threadId: proyectoNormal.threadId,
      message: 'Armá algo simple para probar',
      modelId: modelIdPrime,
    });
    assert.equal(statusNormalForzado, 200, 'el turno igual se resuelve (cae al default), no un error ni un 403');
    assert.equal(
      mock.llamadas.at(-1)?.body.model,
      MODEL_NORMAL_PROVIDER_MODEL,
      'mandado a mano por API, el docente sin marcar cae al default en vez de usar el motor prime-only',
    );
    console.log('✔ escena 2d (2/2): pedido directo a /api/chat/stream con el id prime-only → cae al default igual');

    // ───────────────────────────────────────────────────────────
    // Escena 3 — apagar el interruptor general hace caer al default el
    // motor prime-only que había quedado guardado en el proyecto de la
    // cuenta marcada (escena 2c), exactamente como un motor apagado hoy.
    // ───────────────────────────────────────────────────────────
    await fijarSettings(adminPage, { primeEnabled: false });
    await marcadoPage.goto(`${BASE_URL}/app/project/${proyectoMarcado.id}`, { waitUntil: 'domcontentloaded' });
    const proyectoMarcadoTrasApagar = await prisma.project.findUniqueOrThrow({ where: { id: proyectoMarcado.id } });
    assert.equal(
      proyectoMarcadoTrasApagar.aiModelId,
      modelIdNormal,
      'sin prime, el proyecto repuntea del motor prime-only guardado al default vigente',
    );
    console.log('✔ escena 3: apagar el interruptor general repuntea el motor prime-only guardado al default');

    // ───────────────────────────────────────────────────────────
    // Chequeo en navegador: /admin/generacion, la ficha del docente y el
    // formulario de motores. Capturas en /tmp/kodu-t5/.
    // ───────────────────────────────────────────────────────────
    await adminPage.goto(`${BASE_URL}/admin/generacion`, { waitUntil: 'domcontentloaded' });
    await adminPage.waitForSelector('h2:has-text("Modo prime")');
    await adminPage.screenshot({ path: `${SCREENSHOT_DIR}/1-generacion-light.png`, fullPage: true });
    console.log('✔ /admin/generacion renderiza (tema light)');

    await conTema(adminPage, 'dark');
    await adminPage.waitForSelector('h2:has-text("Modo prime")');
    await adminPage.screenshot({ path: `${SCREENSHOT_DIR}/2-generacion-dark.png`, fullPage: true });
    console.log('✔ /admin/generacion renderiza (tema dark)');

    // Las cuatro banderas, prendidas por la UI real (no por API): tienen que
    // sobrevivir un reload. `isChecked()` refleja la actualización OPTIMISTA
    // de GeneracionPanel.tsx (cambia antes de que el PATCH siquiera salga),
    // así que esperar sólo eso no alcanza — hay que esperar la respuesta de
    // red de CADA PATCH antes de tocar el próximo interruptor o recargar, si
    // no el reload puede ganarle de mano al último guardado (visto en la
    // práctica: una corrida perdió "A fondo para todos" por esta carrera).
    for (const etiqueta of [
      'Modo prime',
      'Revisión automática para todos',
      '"A fondo" para todos',
      'Varias versiones para todos',
    ] as const) {
      const interruptor = adminPage.getByRole('checkbox', { name: etiqueta });
      await Promise.all([
        adminPage.waitForResponse(
          (res) => res.url().endsWith('/api/admin/settings') && res.request().method() === 'PATCH',
        ),
        interruptor.click({ force: true }), // el input real es sr-only; el riel pintado lo tapa (mismo caso que e2e/m3-motores.ts)
      ]);
    }
    await adminPage.reload({ waitUntil: 'domcontentloaded' });
    for (const etiqueta of [
      'Modo prime',
      'Revisión automática para todos',
      '"A fondo" para todos',
      'Varias versiones para todos',
    ] as const) {
      assert.equal(
        await adminPage.getByRole('checkbox', { name: etiqueta }).isChecked(),
        true,
        `"${etiqueta}" tiene que seguir prendido después de recargar`,
      );
    }
    console.log('✔ los cuatro interruptores de /admin/generacion persisten después de recargar');

    // ───────────────────────────────────────────────────────────
    // La ficha del docente: el interruptor "Acceso prime" existe, está
    // prendido (la cuenta marcada de arriba), y desmarcar funciona.
    // ───────────────────────────────────────────────────────────
    await adminPage.goto(`${BASE_URL}/admin/usuarios/${marcadoId}`, { waitUntil: 'domcontentloaded' });
    const interruptorFicha = adminPage.getByRole('checkbox', { name: 'Acceso prime' });
    await esperarHasta(async () => await interruptorFicha.isChecked());
    await adminPage.screenshot({ path: `${SCREENSHOT_DIR}/3-ficha-acceso-prime-prendido.png`, fullPage: true });

    await interruptorFicha.click({ force: true });
    await esperarHasta(async () => (await prisma.user.findUniqueOrThrow({ where: { id: marcadoId } })).primeAccess === false);
    await adminPage.screenshot({ path: `${SCREENSHOT_DIR}/4-ficha-acceso-prime-apagado.png`, fullPage: true });
    console.log('✔ ficha del docente: el interruptor "Acceso prime" refleja y guarda el estado');

    // ───────────────────────────────────────────────────────────
    // De vuelta en /admin/generacion: la cuenta reaparece en la lista al
    // marcarla de nuevo, y "Desmarcar" la saca — de la lista Y de la base.
    // ───────────────────────────────────────────────────────────
    await adminPage.request.patch(`${BASE_URL}/api/admin/users/${marcadoId}`, { data: { primeAccess: true } });
    await adminPage.goto(`${BASE_URL}/admin/generacion`, { waitUntil: 'domcontentloaded' });
    const filaMarcada = adminPage.locator('li', { hasText: MARCADO_EMAIL });
    await filaMarcada.waitFor();
    await adminPage.screenshot({ path: `${SCREENSHOT_DIR}/5-generacion-cuenta-marcada.png`, fullPage: true });

    await filaMarcada.getByRole('button', { name: 'Desmarcar' }).click();
    await esperarHasta(async () => (await filaMarcada.count()) === 0);
    await esperarHasta(async () => (await prisma.user.findUniqueOrThrow({ where: { id: marcadoId } })).primeAccess === false);
    await adminPage.screenshot({ path: `${SCREENSHOT_DIR}/6-generacion-tras-desmarcar.png`, fullPage: true });
    console.log('✔ /admin/generacion: "Desmarcar" saca la cuenta de la lista y de la base');

    // ───────────────────────────────────────────────────────────
    // El formulario de motores: la casilla "Solo modo prime" existe, viaja,
    // y queda deshabilitada (con su explicación) en el motor predeterminado.
    // ───────────────────────────────────────────────────────────
    await adminPage.goto(`${BASE_URL}/admin/motores`, { waitUntil: 'domcontentloaded' });
    await adminPage.waitForSelector(`li:has-text("${MODEL_PRIME_DISPLAY_NAME}")`);

    const filaPrime = adminPage.locator('li').filter({ hasText: MODEL_PRIME_DISPLAY_NAME });
    await filaPrime.getByRole('button', { name: 'Editar' }).click();
    await adminPage.waitForSelector(`[role="dialog"][aria-label="Editar ${MODEL_PRIME_DISPLAY_NAME}"]`);

    const casillaPrimeOnly = adminPage.getByLabel('Solo modo prime');
    assert.equal(await casillaPrimeOnly.isChecked(), true, 'el motor ya nació primeOnly: la casilla abre marcada');
    // El modal es más alto que el viewport: sin este scroll, la casilla queda
    // debajo del recorte y la captura no la muestra. Se scrollea el <label>
    // (visible, tamaño real) y no el <input class="sr-only"> — el mismo
    // elemento de 1×1px cuya posición ya resultó poco fiable para clickear.
    await adminPage.locator('label', { hasText: 'Solo modo prime' }).scrollIntoViewIfNeeded();
    await adminPage.screenshot({ path: `${SCREENSHOT_DIR}/7-modelo-form-primeonly-checked.png` });

    await alternarCasillaPorLabel(adminPage, 'Solo modo prime');
    await esperarHasta(async () => (await casillaPrimeOnly.isChecked()) === false);
    const [respuestaDesmarcado] = await Promise.all([
      adminPage.waitForResponse(
        (res) => res.url().endsWith(`/api/admin/models/${modelIdPrime}`) && res.request().method() === 'PATCH',
      ),
      adminPage.getByRole('button', { name: 'Guardar' }).click(),
    ]);
    assert.equal(respuestaDesmarcado.status(), 200);
    assert.equal(
      (await prisma.aiModel.findUniqueOrThrow({ where: { id: modelIdPrime } })).primeOnly,
      false,
      'destildar la casilla y guardar tiene que persistir primeOnly=false',
    );
    console.log('✔ formulario de motores: la casilla "Solo modo prime" guarda al destildarla');

    // Se restaura a primeOnly=true — es el fixture que reusan futuras corridas de este script.
    await filaPrime.getByRole('button', { name: 'Editar' }).click();
    await adminPage.waitForSelector(`[role="dialog"][aria-label="Editar ${MODEL_PRIME_DISPLAY_NAME}"]`);
    await alternarCasillaPorLabel(adminPage, 'Solo modo prime');
    await esperarHasta(async () => (await adminPage.getByLabel('Solo modo prime').isChecked()) === true);
    await Promise.all([
      adminPage.waitForResponse(
        (res) => res.url().endsWith(`/api/admin/models/${modelIdPrime}`) && res.request().method() === 'PATCH',
      ),
      adminPage.getByRole('button', { name: 'Guardar' }).click(),
    ]);
    assert.equal(
      (await prisma.aiModel.findUniqueOrThrow({ where: { id: modelIdPrime } })).primeOnly,
      true,
      'y de vuelta a primeOnly=true, para dejar el fixture como lo esperan T6+',
    );
    console.log('✔ formulario de motores: la casilla "Solo modo prime" guarda al tildarla (round trip completo)');

    // El motor QUE HOY ES el default (modelIdNormal, fijado arriba) tiene que
    // mostrar la casilla deshabilitada, con la explicación de por qué.
    const filaNormal = adminPage.locator('li').filter({ hasText: MODEL_NORMAL_DISPLAY_NAME });
    await filaNormal.getByRole('button', { name: 'Editar' }).click();
    await adminPage.waitForSelector(`[role="dialog"][aria-label="Editar ${MODEL_NORMAL_DISPLAY_NAME}"]`);
    const casillaEnElDefault = adminPage.getByLabel('Solo modo prime');
    assert.equal(await casillaEnElDefault.isDisabled(), true, 'en el motor predeterminado, la casilla tiene que estar deshabilitada');
    await adminPage.getByText(/no puede ser exclusivo de prime/i).waitFor();
    await adminPage.getByText(/no puede ser exclusivo de prime/i).scrollIntoViewIfNeeded();
    await adminPage.screenshot({ path: `${SCREENSHOT_DIR}/8-modelo-form-primeonly-disabled-en-default.png` });
    console.log('✔ formulario de motores: la casilla queda deshabilitada y explicada en el motor predeterminado');
    await adminPage.getByRole('button', { name: 'Cancelar' }).click();

    console.log(`\n✔ e2e/t5-modo-prime.ts: todas las comprobaciones pasaron (capturas en ${SCREENSHOT_DIR})`);
  } finally {
    // Deja la base como la encontró: el default original restaurado, y el
    // interruptor general (y `demoEnabled`, y los tres "para todos" — todo
    // lo que este script prendió para sus chequeos) apagados.
    try {
      const adminContext2 = await browser.newContext();
      const adminPage2 = await adminContext2.newPage();
      await iniciarSesion(adminPage2, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      if (defaultOriginalId) {
        await fijarDefault(adminPage2, defaultOriginalId);
      }
      await fijarSettings(adminPage2, {
        primeEnabled: false,
        demoEnabled: false,
        autoReviewForAll: false,
        deepModeForAll: false,
        versionsForAll: false,
      });
      await adminContext2.close();
      console.log('✔ limpieza: default original restaurado; modo prime, demo, y los tres "para todos" apagados');
    } catch (error) {
      console.error('[t5-modo-prime] no se pudo restaurar el estado al final:', error);
    }

    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
console.log('\n✔ e2e/t5-modo-prime.ts: terminado');
