import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { DEFAULT_HTML } from '../src/lib/projects.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';
import type { Page } from 'playwright';

/**
 * Chequeo de navegador + API de T4 (odd/tasks/modo-prime.md, "Deshacer
 * cambios de la IA"). Requiere la pila de desarrollo levantada (`docker
 * compose up -d db`, `npm run dev` en el puerto 3000) y REUSA el
 * AiProvider/AiModel mock que dejó T3 en la base de desarrollo (kind
 * "kodu-mock-t3", providerModel "mock-t3") — los crea si todavía no existen,
 * para que este script también ande solo contra una base nueva.
 *
 * Corre con: npx tsx e2e/t4-deshacer.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-t4@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';
const OTRO_DOCENTE_EMAIL = 'docente-e2e-t4-otro@kodu.local';
const OTRO_DOCENTE_PASSWORD = 'Docente.E2E.Otro.2026';

const PROVIDER_KIND = 'kodu-mock-t3';
const PROVIDER_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-t3';
const MODEL_DISPLAY_NAME = 'Mock local (T3+)';

const SCREENSHOT_DIR = '/tmp/kodu-t4';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** HTML mínimo pero válido, con una marca fácil de ubicar en el DOM. */
function htmlDeTurno(marca: number): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="kodu-tema" content="pizarron"><title>Turno ${marca}</title></head><body><h1 data-turno="${marca}">Turno ${marca}</h1></body></html>`;
}

async function asegurarDocente(email: string, password: string, nombre: string): Promise<void> {
  await prisma.user.upsert({
    where: { email },
    update: { role: 'DOCENTE' },
    create: { email, name: nombre, role: 'DOCENTE', passwordHash: await hashPassword(password) },
  });
}

/** Mismo criterio que usa el servidor (POST /api/projects/:id/undo): la
 *  instantánea más nueva del proyecto cuyo mensaje todavía no se deshizo. */
async function idParaDeshacer(projectId: string): Promise<string | null> {
  const snapshot = await prisma.projectSnapshot.findFirst({
    where: { projectId, chatMessage: { undoneAt: null } },
    orderBy: { createdAt: 'desc' },
    select: { chatMessage: { select: { id: true } } },
  });
  return snapshot?.chatMessage.id ?? null;
}

/** Cuenta y motor mock — reusa lo que dejó T3, o lo crea si hace falta. */
async function asegurarProveedorYMotorMock(
  adminPage: Page,
  mockUrl: string,
): Promise<{ providerId: string; modelId: string }> {
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
  }

  return { providerId, modelId };
}

async function crearProyecto(page: Page, title: string, modelId: string): Promise<{ id: string; threadId: string }> {
  const creado = await page.request.post(`${BASE_URL}/api/projects`, { data: { title } });
  assert.equal(creado.status(), 200, `alta del proyecto "${title}": ${creado.status()} ${await creado.text()}`);
  const { project } = (await creado.json()) as { project: { id: string; threadId: string } };
  await prisma.project.update({ where: { id: project.id }, data: { aiModelId: modelId } });
  return project;
}

/** Manda un turno por la API cruda (sin pasar por la UI) y devuelve lo que
 *  trajo el evento "done". */
async function enviarTurno(
  page: Page,
  args: { projectId: string; threadId: string; message: string; modelId: string },
): Promise<{ messageId: string; codeUpdated: boolean }> {
  const resp = await page.request.post(`${BASE_URL}/api/chat/stream`, {
    data: { projectId: args.projectId, threadId: args.threadId, message: args.message, model: args.modelId },
  });
  assert.equal(resp.status(), 200, `turno "${args.message}": ${resp.status()} ${await resp.text()}`);

  const eventos = (await resp.text())
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
        return JSON.parse(linea) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((evento): evento is Record<string, unknown> => evento !== null);

  const done = eventos.find((evento) => evento.type === 'done');
  assert.ok(done, `no llegó "done" para "${args.message}": ${eventos.map((e) => e.type).join(', ')}`);
  return { messageId: done!.messageId as string, codeUpdated: Boolean(done!.codeUpdated) };
}

async function main(): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await asegurarDocente(DOCENTE_EMAIL, DOCENTE_PASSWORD, 'Docente E2E T4');
  await asegurarDocente(OTRO_DOCENTE_EMAIL, OTRO_DOCENTE_PASSWORD, 'Docente E2E T4 (otro)');

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  const browser = await abrirNavegador();

  try {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const { modelId } = await asegurarProveedorYMotorMock(adminPage, mock.url);
    console.log(`✔ motor mock listo (${modelId})`);

    const docenteContext = await browser.newContext();
    const page = await docenteContext.newPage();
    await iniciarSesion(page, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    // ───────────────────────────────────────────────────────────
    // Escenario principal: turno 1 (UI) → HTML A; turno 2 (UI) → HTML B;
    // deshacer por click → currentHtml vuelve a A y el par de turno 2 queda
    // marcado; turno 3 (API) no debe ver el pedido de turno 2 en su
    // historial; deshacer dos veces más (API) → vuelve al HTML de arranque;
    // un cuarto deshacer → 409.
    // ───────────────────────────────────────────────────────────
    const p1 = await crearProyecto(page, 'T4 — deshacer', modelId);
    console.log(`✔ proyecto principal creado (${p1.id})`);

    const campoMensaje = page.locator('textarea[placeholder="Preguntale a Kodu…"]');
    const botonEnviar = page.getByRole('button', { name: 'Enviar' });

    async function enviarPorUi(mensaje: string): Promise<void> {
      await campoMensaje.click();
      await campoMensaje.pressSequentially(mensaje, { delay: 10 });
      assert.equal(await campoMensaje.inputValue(), mensaje, 'no se pudo escribir el mensaje en el compositor');
      await botonEnviar.click();
      // El compositor vuelve a decir "Enviar" recién cuando `isStreaming`
      // pasa a `false` — ese es el fin del turno (mismo criterio que T3).
      await botonEnviar.waitFor({ state: 'visible', timeout: 30_000 });
    }

    mock.programarRespuesta({ texto: 'Listo.', html: htmlDeTurno(1), chunkDelayMs: 20, chunkBytes: 10_000 });
    await page.goto(`${BASE_URL}/app/project/${p1.id}`, { waitUntil: 'load' });
    await enviarPorUi('Turno uno: creá algo simple (PEDIDO-UNO)');
    console.log('✔ turno 1 (UI) terminado');

    mock.programarRespuesta({ texto: 'Listo.', html: htmlDeTurno(2), chunkDelayMs: 20, chunkBytes: 10_000 });
    await enviarPorUi('Turno dos: cambialo del todo (PEDIDO-DOS)');
    console.log('✔ turno 2 (UI) terminado');

    // Sólo el mensaje MÁS NUEVO ofrece "Deshacer" — nunca los dos a la vez.
    const botonDeshacer = page.getByRole('button', { name: 'Deshacer' });
    assert.equal(await botonDeshacer.count(), 1, 'tiene que haber exactamente un botón "Deshacer" (sólo en el más nuevo)');
    assert.equal(await page.locator('article.opacity-50').count(), 0, 'todavía no se deshizo nada: nada apagado');
    await page.screenshot({ path: `${SCREENSHOT_DIR}/1-antes-de-deshacer.png` });
    console.log('✔ "Deshacer" aparece sólo en el mensaje de IA más nuevo');

    await botonDeshacer.click();

    const frenteFrame = () => page.frameLocator('iframe[data-kodu-frente="true"]');
    await frenteFrame().locator('h1[data-turno="1"]').waitFor({ state: 'attached', timeout: 10_000 });
    console.log('✔ la vista previa volvió al HTML de turno 1 (A)');

    await page.locator('article.opacity-50').first().waitFor({ state: 'visible', timeout: 5_000 });
    assert.equal(await page.locator('article.opacity-50').count(), 2, 'el PAR de turno 2 tiene que quedar apagado');
    // Acotado a <p> (no un getByText de toda la página): `handleUndo` además
    // dispara un aviso "Deshecho" propio (flashNotice, un <span> aparte en
    // PreviewPanel) que de otro modo se cuenta de más acá.
    assert.equal(
      await page.locator('p', { hasText: 'Deshecho' }).count(),
      2,
      'el par apagado lleva su etiqueta "Deshecho"',
    );
    await page.screenshot({ path: `${SCREENSHOT_DIR}/2-despues-de-deshacer.png` });
    console.log('✔ clic en "Deshacer" restaura la vista previa y apaga el par (con capturas en ' + SCREENSHOT_DIR + ')');

    // Verificación a nivel de datos del mismo estado (currentHtml === A, el
    // par de turno 2 con `undoneAt`, turno 1 intacto).
    const proyectoTrasDeshacer1 = await prisma.project.findUniqueOrThrow({ where: { id: p1.id } });
    assert.ok(proyectoTrasDeshacer1.currentHtml.includes('data-turno="1"'));
    assert.ok(!proyectoTrasDeshacer1.currentHtml.includes('data-turno="2"'));

    const mensajesTrasDeshacer1 = await prisma.chatMessage.findMany({
      where: { thread: { projectId: p1.id } },
      orderBy: { createdAt: 'asc' },
    });
    const pedidoUno = mensajesTrasDeshacer1.find((m) => m.content.includes('PEDIDO-UNO'))!;
    const pedidoDos = mensajesTrasDeshacer1.find((m) => m.content.includes('PEDIDO-DOS'))!;
    assert.equal(pedidoUno.undoneAt, null, 'turno 1 no se tocó');
    assert.ok(pedidoDos.undoneAt !== null, 'el pedido del docente de turno 2 tiene que quedar marcado');
    const respuestaDos = mensajesTrasDeshacer1.find((m) => m.role === 'assistant' && m.createdAt > pedidoDos.createdAt);
    assert.ok(respuestaDos?.undoneAt, 'la respuesta de la IA de turno 2 también tiene que quedar marcada');
    console.log('✔ datos: currentHtml = A, par de turno 2 marcado, turno 1 intacto');

    // Turno 3 (API): el historial que ve el modelo NO puede llevar el pedido
    // de turno 2, pero sigue llevando el de turno 1.
    mock.llamadas.length = 0; // sólo interesan las llamadas de acá en más
    mock.programarRespuesta({ texto: 'Listo.', html: htmlDeTurno(3), chunkDelayMs: 20, chunkBytes: 10_000 });
    const turno3 = await enviarTurno(page, {
      projectId: p1.id,
      threadId: p1.threadId,
      message: 'Turno tres: cambialo de nuevo (PEDIDO-TRES)',
      modelId,
    });
    assert.equal(mock.llamadas.length, 1, 'turno 3 tiene que ser la única llamada nueva al mock');
    const cuerpoTurno3 = JSON.stringify(mock.llamadas[0]!.body);
    assert.ok(!cuerpoTurno3.includes('PEDIDO-DOS'), 'el historial no puede llevar el pedido de un turno deshecho');
    assert.ok(cuerpoTurno3.includes('PEDIDO-UNO'), 'el historial SÍ tiene que seguir llevando un turno no deshecho');
    console.log('✔ turno 3: el modelo dejó de ver el pedido del turno deshecho, pero no los demás');

    // Deshacer turno 3 (API): vuelve a A otra vez (turno 3 arrancó de A).
    const objetivoTurno3 = await idParaDeshacer(p1.id);
    assert.equal(objetivoTurno3, turno3.messageId);
    const deshacerTurno3 = await page.request.post(`${BASE_URL}/api/projects/${p1.id}/undo`, {
      data: { messageId: objetivoTurno3 },
    });
    assert.equal(deshacerTurno3.status(), 200, await deshacerTurno3.text());
    const cuerpoDeshacerTurno3 = (await deshacerTurno3.json()) as { currentHtml: string; undoneMessageIds: string[] };
    assert.ok(cuerpoDeshacerTurno3.currentHtml.includes('data-turno="1"'));
    assert.equal(cuerpoDeshacerTurno3.undoneMessageIds.length, 2);
    console.log('✔ deshacer turno 3 (API): currentHtml vuelve a A otra vez');

    // Deshacer turno 1 (API): el único que queda con instantánea. Vuelve al
    // HTML de arranque, byte a byte.
    const objetivoTurno1 = await idParaDeshacer(p1.id);
    assert.ok(objetivoTurno1, 'todavía tiene que quedar el turno 1 por deshacer');
    const deshacerTurno1 = await page.request.post(`${BASE_URL}/api/projects/${p1.id}/undo`, {
      data: { messageId: objetivoTurno1 },
    });
    assert.equal(deshacerTurno1.status(), 200, await deshacerTurno1.text());
    const cuerpoDeshacerTurno1 = (await deshacerTurno1.json()) as { currentHtml: string };
    assert.equal(cuerpoDeshacerTurno1.currentHtml, DEFAULT_HTML, 'tiene que volver EXACTO al HTML de arranque');
    console.log('✔ deshacer turno 1 (API): currentHtml vuelve al HTML de arranque, byte a byte');

    // Un cuarto deshacer: ya no queda nada, 409 (y no el 409 de "en curso").
    assert.equal(await idParaDeshacer(p1.id), null);
    const sinNada = await page.request.post(`${BASE_URL}/api/projects/${p1.id}/undo`, {
      data: { messageId: turno3.messageId },
    });
    assert.equal(sinNada.status(), 409);
    const errorSinNada = ((await sinNada.json()) as { error: string }).error;
    assert.ok(!errorSinNada.includes('en curso'), `tiene que ser el 409 de "nada para deshacer", vino: "${errorSinNada}"`);
    console.log(`✔ un cuarto deshacer: 409 ("${errorSinNada}")`);

    // ───────────────────────────────────────────────────────────
    // 409 mientras hay un turno en curso — proyecto propio, aislado.
    // ───────────────────────────────────────────────────────────
    const p2 = await crearProyecto(page, 'T4 — turno en curso', modelId);
    mock.programarRespuesta({ texto: 'Listo.', html: htmlDeTurno(1), chunkDelayMs: 20, chunkBytes: 10_000 });
    const turnoPrevio = await enviarTurno(page, {
      projectId: p2.id,
      threadId: p2.threadId,
      message: 'Turno único de este proyecto',
      modelId,
    });

    // Un segundo turno con delays largos, para tener ventana de sobra: se
    // dispara sin esperarlo.
    mock.programarRespuesta({
      texto: 'Pensando…',
      html: htmlDeTurno(2),
      chunkDelayMs: 400,
      chunkBytes: 40,
    });
    const turnoEnCurso = page.request.post(`${BASE_URL}/api/chat/stream`, {
      data: { projectId: p2.id, threadId: p2.threadId, message: 'Otro pedido más', model: modelId },
    });
    await esperar(400); // el mensaje del docente ya está persistido bastante antes de esto

    const bloqueado = await page.request.post(`${BASE_URL}/api/projects/${p2.id}/undo`, {
      data: { messageId: turnoPrevio.messageId },
    });
    assert.equal(bloqueado.status(), 409);
    const errorBloqueado = ((await bloqueado.json()) as { error: string }).error;
    assert.ok(errorBloqueado.includes('en curso'), `tiene que avisar que hay un turno en curso, vino: "${errorBloqueado}"`);
    console.log(`✔ deshacer con un turno en curso: 409 ("${errorBloqueado}")`);

    await turnoEnCurso; // se deja terminar, para no dejar nada colgando
    console.log('✔ (el turno en curso terminó solo, sin que el 409 lo afectara)');

    // ───────────────────────────────────────────────────────────
    // Otro docente no puede deshacer un recurso ajeno.
    // ───────────────────────────────────────────────────────────
    const otroContext = await browser.newContext();
    const otroPage = await otroContext.newPage();
    await iniciarSesion(otroPage, { email: OTRO_DOCENTE_EMAIL, password: OTRO_DOCENTE_PASSWORD });

    const ajeno = await otroPage.request.post(`${BASE_URL}/api/projects/${p1.id}/undo`, {
      data: { messageId: turno3.messageId },
    });
    assert.equal(ajeno.status(), 404, 'un docente que no es dueño tiene que ver 404, como los demás endpoints de proyecto');
    console.log('✔ otro docente: 404, igual que los demás endpoints de /api/projects/:id');

    // ───────────────────────────────────────────────────────────
    // Poda a 20 instantáneas (chequeo a nivel de base, ver la tarea).
    // ───────────────────────────────────────────────────────────
    const p3 = await crearProyecto(page, 'T4 — poda de instantáneas', modelId);
    const TOTAL_TURNOS = 25;
    for (let i = 1; i <= TOTAL_TURNOS; i++) {
      mock.programarRespuesta({ texto: '', html: htmlDeTurno(1_000 + i), chunkDelayMs: 5, chunkBytes: 50_000 });
      await enviarTurno(page, {
        projectId: p3.id,
        threadId: p3.threadId,
        message: `Turno de poda número ${i}`,
        modelId,
      });
    }
    const cantidadDeInstantaneas = await prisma.projectSnapshot.count({ where: { projectId: p3.id } });
    assert.equal(cantidadDeInstantaneas, 20, `${TOTAL_TURNOS} turnos tienen que podarse a 20, quedaron ${cantidadDeInstantaneas}`);
    console.log(`✔ poda: ${TOTAL_TURNOS} turnos con cambio real dejan exactamente 20 instantáneas`);

    console.log(`\n✔ mock: ${mock.llamadas.length} pedidos recibidos desde el turno 3 (incluye la poda)`);
  } finally {
    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
console.log('\n✔ e2e/t4-deshacer.ts: todas las comprobaciones pasaron');
