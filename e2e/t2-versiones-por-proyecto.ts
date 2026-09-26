import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';
import type { Page } from 'playwright';

/**
 * Chequeo de navegador de T2 (odd/tasks/generacion-simple-y-reanudable.md):
 * versiones pasa de ser un pedido por turno a un interruptor por proyecto
 * (`Project.versionsEnabled`), visible sólo cuando el admin prendió
 * `AppSettings.versionsForAll`. Requiere la pila de desarrollo levantada
 * (`docker compose up -d db`, `npm run dev` en el puerto 3000) y REUSA el
 * AiProvider/AiModel mock que dejó T3 (kind "kodu-mock-t3", providerModel
 * "mock-t3") — mismo patrón que e2e/t9-varias-versiones.ts.
 *
 * Escenas:
 *  A. Interruptor del admin APAGADO: el docente no ve ningún control en el
 *     compositor, y aunque pida `variants: 3` a mano por la API cruda, el
 *     servidor lo ignora (1 sola llamada al mock).
 *  B. Interruptor del admin PRENDIDO: el control aparece en el compositor
 *     de un recurso vacío, apagado por default; prenderlo y mandar un
 *     pedido genera 3 versiones de verdad con el mock.
 *
 * Corre con: npx tsx e2e/t2-versiones-por-proyecto.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-t2-versiones-por-proyecto@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_KIND = 'kodu-mock-t3';
const PROVIDER_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-t3';
const MODEL_DISPLAY_NAME = 'Mock local (T3+)';

const SCREENSHOT_DIR = '/tmp/kodu-t2-versiones';

const VERSIONS_TITLE = 'Generar 3 versiones por pedido: cuesta el triple; elegís la que más te guste';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

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

async function fijarVersionsForAll(adminPage: Page, valor: boolean): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/settings`, {
    data: { versionsForAll: valor },
  });
  assert.ok(respuesta.ok(), `PATCH /api/admin/settings versionsForAll=${valor}: ${respuesta.status()} ${await respuesta.text()}`);
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

async function enviarTurnoCrudo(
  page: Page,
  args: { projectId: string; threadId: string; message: string; modelId: string; variants?: 3 },
): Promise<{ status: number; eventos: EventoSse[] }> {
  const resp = await page.request.post(`${BASE_URL}/api/chat/stream`, {
    data: {
      projectId: args.projectId,
      threadId: args.threadId,
      message: args.message,
      model: args.modelId,
      ...(args.variants ? { variants: args.variants } : {}),
    },
  });
  const status = resp.status();
  const eventos = status === 200 ? eventosDe(await resp.text()) : [];
  return { status, eventos };
}

async function proyectoActual(id: string): Promise<{ versionsEnabled: boolean }> {
  return prisma.project.findUniqueOrThrow({ where: { id }, select: { versionsEnabled: true } });
}

/** Matchea el pedido de UNA versión por la directiva que `directivaDeVersion`
 *  (lib/ai/versiones.ts) le suma al system prompt — mismo criterio que
 *  e2e/t9-varias-versiones.ts. El pedido de checklist (T16) no matchea
 *  ninguna de las tres, así que cae solo al fallback por default del mock. */
function matchVersion(indice: 1 | 2 | 3) {
  const fragmento = indice === 1 ? 'una sola oración' : indice === 2 ? 'Priorizá lo visual' : 'Priorizá el juego';
  return (body: Record<string, unknown>) => {
    const mensajes = body.messages as Array<{ role: string; content: unknown }> | undefined;
    const sistema = mensajes?.[0];
    return typeof sistema?.content === 'string' && sistema.content.includes(fragmento);
  };
}

function htmlDePrueba(marca: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="pizarron">
<title>T2 ${marca}</title>
</head>
<body data-marca="${marca}">
  <h1>Recurso ${marca}</h1>
</body>
</html>`;
}

async function main(): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await asegurarDocente(DOCENTE_EMAIL, DOCENTE_PASSWORD, 'Docente E2E T2 (versiones por proyecto)');

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
    // Escena A — el interruptor del admin está APAGADO.
    // ───────────────────────────────────────────────────────────
    await fijarVersionsForAll(adminPage, false);

    const proyectoA = await crearProyecto(docentePage, 'T2 — admin apagado', modelId);
    await docentePage.goto(`${BASE_URL}/app/project/${proyectoA.id}`, { waitUntil: 'load' });
    await docentePage.waitForSelector('textarea[placeholder="Preguntale a Kodu…"]');

    assert.equal(
      await docentePage.getByTitle(VERSIONS_TITLE).count(),
      0,
      'con el admin apagado, el compositor no puede mostrar el control de versiones',
    );
    await docentePage.screenshot({ path: `${SCREENSHOT_DIR}/1-admin-apagado-sin-control.png` });
    console.log('✔ escena A (1/2): sin el interruptor del admin, no hay control en el compositor');

    mock.llamadas.length = 0;
    mock.programarRespuesta({ html: htmlDePrueba('a-unica'), chunkDelayMs: 5, chunkBytes: 20_000 });
    const turnoA = await enviarTurnoCrudo(docentePage, {
      projectId: proyectoA.id,
      threadId: proyectoA.threadId,
      message: 'Armame algo simple (pedido crudo variants:3)',
      modelId,
      variants: 3, // pedido a mano por API: sin el interruptor del admin, se ignora igual
    });
    assert.equal(turnoA.status, 200, JSON.stringify(turnoA));
    // T16: `proyectoA` es nuevo, así que lleva su propio pedido de checklist
    // ANTES del turno principal — checklist + 1 pedido, 2 llamadas, no 1.
    assert.equal(
      mock.llamadas.length,
      2,
      'sin versionsForAll, un variants:3 pedido a mano por API también se ignora (checklist + turno)',
    );
    assert.equal(turnoA.eventos.some((e) => e.type === 'variant'), false, 'no puede aparecer ningún evento "variant"');
    console.log('✔ escena A (2/2): un pedido de variants:3 por API cruda igual da checklist + 1 sola llamada');

    // ───────────────────────────────────────────────────────────
    // Escena B — el interruptor del admin está PRENDIDO: el control aparece,
    // apagado por default, y prenderlo genera 3 versiones de verdad.
    // ───────────────────────────────────────────────────────────
    await fijarVersionsForAll(adminPage, true);

    const proyectoB = await crearProyecto(docentePage, 'T2 — admin prendido', modelId);
    await docentePage.goto(`${BASE_URL}/app/project/${proyectoB.id}`, { waitUntil: 'load' });
    await docentePage.waitForSelector('textarea[placeholder="Preguntale a Kodu…"]');

    const toggle = docentePage.getByTitle(VERSIONS_TITLE);
    await toggle.waitFor({ state: 'visible', timeout: 10_000 });
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false', 'el interruptor del proyecto nace apagado por default');
    await docentePage.screenshot({ path: `${SCREENSHOT_DIR}/2-admin-prendido-control-visible-apagado.png` });
    console.log('✔ escena B (1/4): con el admin prendido, el control aparece visible y apagado por default');

    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'el click prende el interruptor');
    await docentePage.screenshot({ path: `${SCREENSHOT_DIR}/3-toggle-on.png` });

    // El toggle persiste en el PROYECTO (no en localStorage): confirmado
    // contra la base, no sólo contra el DOM.
    const proyectoBTrasToggle = await proyectoActual(proyectoB.id);
    assert.equal(proyectoBTrasToggle.versionsEnabled, true, 'prender el interruptor persiste Project.versionsEnabled');
    console.log('✔ escena B (2/4): prender el interruptor persiste en el proyecto (no en localStorage)');

    mock.llamadas.length = 0;
    mock.programarRespuestaCondicional(matchVersion(1), { html: htmlDePrueba('b-v1'), chunkDelayMs: 30, chunkBytes: 200 });
    mock.programarRespuestaCondicional(matchVersion(2), { html: htmlDePrueba('b-v2'), chunkDelayMs: 5, chunkBytes: 5_000 });
    mock.programarRespuestaCondicional(matchVersion(3), { html: htmlDePrueba('b-v3'), chunkDelayMs: 5, chunkBytes: 5_000 });

    const campoMensaje = docentePage.locator('textarea[placeholder="Preguntale a Kodu…"]');
    const botonEnviar = docentePage.getByRole('button', { name: 'Enviar' });
    await campoMensaje.click();
    await campoMensaje.pressSequentially('Armame algo simple (ESCENA-B, con versiones)', { delay: 10 });
    await botonEnviar.click();

    const filaVersiones = docentePage.getByRole('group', { name: 'Versiones generadas' });
    await filaVersiones.waitFor({ state: 'visible', timeout: 30_000 });
    await docentePage.waitForFunction(
      () => !document.querySelector('button[type="submit"]')?.hasAttribute('disabled'),
      { timeout: 30_000 },
    );
    await docentePage.screenshot({ path: `${SCREENSHOT_DIR}/4-tres-versiones.png` });

    // Checklist (turno de creación) + 3 versiones = 4 llamadas al mock.
    assert.equal(mock.llamadas.length, 4, `esperaba checklist + 3 versiones = 4 llamadas, dio ${mock.llamadas.length}`);
    const chips = await filaVersiones.getByRole('button').all();
    assert.equal(chips.length, 3, 'la fila de chips tiene que mostrar exactamente 3 versiones');
    console.log('✔ escena B (3/4): con el interruptor prendido, un pedido normal genera 3 versiones de verdad con el mock');

    const proyectoBTrasTurno = await prisma.project.findUniqueOrThrow({
      where: { id: proyectoB.id },
      select: { currentHtml: true },
    });
    assert.ok(
      proyectoBTrasTurno.currentHtml.includes('data-marca="b-v1"'),
      'currentHtml queda en la versión 1 hasta que el docente elija otra',
    );
    console.log('✔ escena B (4/4): currentHtml se actualizó con la versión 1, como cualquier turno de versiones');

    console.log('\n✔ e2e/t2-versiones-por-proyecto.ts: todas las comprobaciones pasaron');
  } finally {
    try {
      const adminContext2 = await browser.newContext();
      const adminPage2 = await adminContext2.newPage();
      await iniciarSesion(adminPage2, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await fijarVersionsForAll(adminPage2, false);
      await adminContext2.close();
      console.log('✔ limpieza: versionsForAll apagado');
    } catch (error) {
      console.error('[t2-versiones-por-proyecto] no se pudo restaurar el estado al final:', error);
    }

    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
console.log('\n✔ e2e/t2-versiones-por-proyecto.ts: terminado');
