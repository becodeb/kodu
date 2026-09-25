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
 * Chequeo de navegador + API de T6 (odd/tasks/modo-prime.md, "Velocidad
 * Rápido / A fondo"). Requiere la pila de desarrollo levantada (`docker
 * compose up -d db`, `npm run dev` en el puerto 3000). Mismo patrón que
 * e2e/t5-modo-prime.ts: prende prime, marca un docente, y REUSA el
 * AiProvider/AiModel mock que dejó T3 (kind "kodu-mock-t3", providerModel
 * "mock-t3") — lo hace default temporalmente y le pisa el dialecto de
 * razonamiento (reasoningParam "reasoning_effort", reasoningEffort "low")
 * para poder afirmar sobre `mock.llamadas[].body.reasoning_effort`.
 * Restaura absolutamente todo al final (settings, default y dialecto).
 *
 * Corre con: npx tsx e2e/t6-velocidad.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const MARCADO_EMAIL = 'docente-e2e-t6-marcado@kodu.local';
const MARCADO_PASSWORD = 'Docente.E2E.2026';
const NORMAL_EMAIL = 'docente-e2e-t6-normal@kodu.local';
const NORMAL_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_KIND = 'kodu-mock-t3';
const PROVIDER_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-t3';
const MODEL_DISPLAY_NAME = 'Mock local (T3+)';

const SCREENSHOT_DIR = '/tmp/kodu-t6';

/** HTML mínimo pero válido: estos turnos no verifican contenido, sólo el body que recibió el mock. */
const HTML_DE_PRUEBA =
  '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="kodu-tema" content="pizarron"><title>T6</title></head><body><h1>T6</h1></body></html>';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function asegurarDocente(email: string, password: string, nombre: string): Promise<string> {
  const fila = await prisma.user.upsert({
    where: { email },
    update: { role: 'DOCENTE', primeAccess: false },
    create: { email, name: nombre, role: 'DOCENTE', passwordHash: await hashPassword(password) },
    select: { id: true },
  });
  return fila.id;
}

/** Cuenta y motor mock — reusa lo que dejó T3, lo crea si hace falta (mismo criterio que T5). */
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

/** Nunca Prisma directo para mutar — invalidaría el caché del proceso equivocado (mismo motivo que e2e/t5-modo-prime.ts). */
async function fijarSettings(adminPage: Page, datos: Record<string, boolean>): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/settings`, { data: datos });
  assert.ok(respuesta.ok(), `PATCH /api/admin/settings ${JSON.stringify(datos)}: ${respuesta.status()} ${await respuesta.text()}`);
}

async function fijarDefault(adminPage: Page, modelId: string): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/models/${modelId}`, { data: { isDefault: true } });
  assert.ok(respuesta.ok(), `marcar ${modelId} como default: ${respuesta.status()} ${await respuesta.text()}`);
}

async function fijarDialecto(adminPage: Page, modelId: string, datos: Record<string, string | null>): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/models/${modelId}`, { data: datos });
  assert.ok(respuesta.ok(), `PATCH dialecto ${JSON.stringify(datos)}: ${respuesta.status()} ${await respuesta.text()}`);
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
  args: { projectId: string; threadId: string; message: string; modelId: string; speed?: 'fast' | 'deep' },
): Promise<number> {
  const resp = await page.request.post(`${BASE_URL}/api/chat/stream`, {
    data: {
      projectId: args.projectId,
      threadId: args.threadId,
      message: args.message,
      model: args.modelId,
      ...(args.speed ? { speed: args.speed } : {}),
    },
  });
  return resp.status();
}

async function main(): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const marcadoId = await asegurarDocente(MARCADO_EMAIL, MARCADO_PASSWORD, 'Docente E2E T6 (marcado)');
  await asegurarDocente(NORMAL_EMAIL, NORMAL_PASSWORD, 'Docente E2E T6 (sin marcar)');

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  function programarTurnoRapido(): void {
    mock.programarRespuesta({ texto: 'Listo.', html: HTML_DE_PRUEBA, chunkDelayMs: 5, chunkBytes: 10_000 });
  }

  const browser = await abrirNavegador();
  let defaultOriginalId: string | null = null;
  let dialectoOriginal: { reasoningEffort: string | null; reasoningParam: string | null } | null = null;
  let modelId = '';

  try {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    modelId = await asegurarMotorMock(adminPage, mock.url);
    console.log(`✔ motor mock listo (${modelId})`);

    // Mismo cuidado que T5: para que la caída al default (y cualquier lectura
    // implícita de "el motor de este proyecto") aterrice en el mock y no en
    // un proveedor real sin key en este .env, el mock pasa a ser el default
    // temporal. Se restaura al final.
    const defaultOriginal = await prisma.aiModel.findFirst({ where: { isDefault: true }, select: { id: true } });
    defaultOriginalId = defaultOriginal?.id ?? null;
    await fijarDefault(adminPage, modelId);
    console.log(`✔ ${MODEL_DISPLAY_NAME} es el default temporal (original: ${defaultOriginalId ?? 'ninguno'})`);

    // Dialecto conocido para este chequeo (odd/tasks/modo-prime.md, T6):
    // reasoning_effort/"low" — Rápido tiene que mandar "none", A fondo
    // "high" (sube desde "low"), y sin permiso tiene que seguir viajando
    // "low" tal cual. Se lee el original ANTES de pisarlo, para restaurarlo.
    const filaOriginal = await prisma.aiModel.findUniqueOrThrow({
      where: { id: modelId },
      select: { reasoningEffort: true, reasoningParam: true },
    });
    dialectoOriginal = filaOriginal;
    await fijarDialecto(adminPage, modelId, { reasoningEffort: 'low', reasoningParam: 'reasoning_effort' });
    console.log(
      `✔ dialecto del mock pisado a reasoning_effort/"low" (original: ${dialectoOriginal.reasoningParam ?? 'null'}/${dialectoOriginal.reasoningEffort ?? 'null'})`,
    );

    await adminPage.request.patch(`${BASE_URL}/api/admin/users/${marcadoId}`, { data: { primeAccess: true } });
    console.log('✔ cuenta marcada con primeAccess=true');

    // Estado inicial conocido para las escenas A-D: prime prendido en general,
    // "A fondo para todos" apagado (si no, un docente sin marcar tendría el
    // control igual, por la capa 1, y la escena C dejaría de probar el gate).
    await fijarSettings(adminPage, { primeEnabled: true, deepModeForAll: false });

    // ───────────────────────────────────────────────────────────
    // Escena A — un usuario prime eligiendo Rápido manda reasoning_effort "none".
    // ───────────────────────────────────────────────────────────
    const marcadoContext = await browser.newContext();
    const marcadoPage = await marcadoContext.newPage();
    await iniciarSesion(marcadoPage, { email: MARCADO_EMAIL, password: MARCADO_PASSWORD });
    const proyectoMarcado = await crearProyecto(marcadoPage, 'T6 — docente marcado');

    mock.llamadas.length = 0;
    programarTurnoRapido();
    const statusFast = await enviarTurnoPorApi(marcadoPage, {
      projectId: proyectoMarcado.id,
      threadId: proyectoMarcado.threadId,
      message: 'Armá algo simple para probar',
      modelId,
      speed: 'fast',
    });
    assert.equal(statusFast, 200);
    // T16 (round 4, "checklist del docente"): `proyectoMarcado` es nuevo y
    // éste es su primer turno (`esRecursoInicial`) — hay un pedido de
    // checklist propio antes del turno principal, 2 pedidos, no 1. Se lee
    // con `.at(-1)`, el turno principal, no el de checklist.
    assert.equal(mock.llamadas.length, 2, 'checklist + turno principal tienen que haber llegado al mock');
    assert.equal(mock.llamadas.at(-1)!.body.reasoning_effort, 'none', 'prime + Rápido tiene que mandar reasoning_effort "none"');
    assert.ok(!('thinking' in mock.llamadas.at(-1)!.body), 'nunca el nombre del otro dialecto');
    console.log('✔ escena A: prime + Rápido → reasoning_effort "none"');

    // ───────────────────────────────────────────────────────────
    // Escena B — el mismo usuario eligiendo A fondo manda reasoning_effort "high".
    // ───────────────────────────────────────────────────────────
    mock.llamadas.length = 0;
    programarTurnoRapido();
    const statusDeep = await enviarTurnoPorApi(marcadoPage, {
      projectId: proyectoMarcado.id,
      threadId: proyectoMarcado.threadId,
      message: 'Armá algo simple para probar',
      modelId,
      speed: 'deep',
    });
    assert.equal(statusDeep, 200);
    assert.equal(mock.llamadas.length, 1);
    assert.equal(
      mock.llamadas[0]!.body.reasoning_effort,
      'high',
      'prime + A fondo tiene que mandar reasoning_effort "high" (sube desde "low")',
    );
    console.log('✔ escena B: prime + A fondo → reasoning_effort "high"');

    // ───────────────────────────────────────────────────────────
    // Escena C — un docente SIN marcar pidiendo "deep" por API sigue
    // recibiendo el nivel configurado ("low"): sin puedeElegirVelocidad, el
    // pedido se ignora por completo, nunca se pisa nada.
    // ───────────────────────────────────────────────────────────
    const normalContext = await browser.newContext();
    const normalPage = await normalContext.newPage();
    await iniciarSesion(normalPage, { email: NORMAL_EMAIL, password: NORMAL_PASSWORD });
    const proyectoNormal = await crearProyecto(normalPage, 'T6 — docente sin marcar');

    mock.llamadas.length = 0;
    programarTurnoRapido();
    const statusIgnorado = await enviarTurnoPorApi(normalPage, {
      projectId: proyectoNormal.id,
      threadId: proyectoNormal.threadId,
      message: 'Armá algo simple para probar',
      modelId,
      speed: 'deep',
    });
    assert.equal(statusIgnorado, 200, 'el turno igual se resuelve, no un error ni un 403');
    // T16: `proyectoNormal` también es nuevo — mismo motivo que la escena A.
    assert.equal(mock.llamadas.length, 2, 'checklist + turno principal tienen que haber llegado al mock');
    assert.equal(
      mock.llamadas.at(-1)!.body.reasoning_effort,
      'low',
      'sin el permiso, "deep" por API se ignora: sigue viajando el nivel configurado tal cual',
    );
    console.log('✔ escena C: docente sin marcar + speed="deep" por API → sigue en el "low" configurado (ignorado)');

    // ───────────────────────────────────────────────────────────
    // Escena D — el control está ausente para el docente sin marcar, y su
    // página no menciona "prime" en ningún lado (mismo chequeo que T5, ahora
    // sobre el control nuevo).
    // ───────────────────────────────────────────────────────────
    await normalPage.goto(`${BASE_URL}/app/project/${proyectoNormal.id}`, { waitUntil: 'domcontentloaded' });
    // La isla de React (client:load) todavía puede estar hidratando justo
    // después de "domcontentloaded" — esperar un elemento estable de la isla
    // antes de leer `content()` evita la carrera "page is navigating and
    // changing the content" que tira Playwright si se lee a mitad de eso.
    await normalPage.waitForSelector('textarea[placeholder="Preguntale a Kodu…"]');
    const grupoVelocidadNormal = normalPage.getByRole('group', { name: 'Velocidad de la respuesta' });
    assert.equal(await grupoVelocidadNormal.count(), 0, 'un docente sin marcar no tiene que ver el control de velocidad');

    const fuenteNormal = await normalPage.content();
    assert.ok(!/\bprime\b/i.test(fuenteNormal), 'la página de un docente sin marcar no puede mencionar "prime" en ningún lado');
    console.log('✔ escena D: sin el permiso, el control no existe y la página no dice "prime"');

    // ───────────────────────────────────────────────────────────
    // Escena E — el control existe para la cuenta marcada, arranca en "A
    // fondo" (el default de quien SÍ tiene prime, nunca "rapido"), y elegir
    // "Rápido" sobrevive a un reload (persistencia en localStorage).
    // ───────────────────────────────────────────────────────────
    await marcadoPage.goto(`${BASE_URL}/app/project/${proyectoMarcado.id}`, { waitUntil: 'domcontentloaded' });
    const grupoVelocidadMarcado = marcadoPage.getByRole('group', { name: 'Velocidad de la respuesta' });
    await grupoVelocidadMarcado.waitFor();

    const botonRapido = marcadoPage.getByRole('button', { name: 'Rápido' });
    const botonAFondo = marcadoPage.getByRole('button', { name: 'A fondo' });
    assert.equal(await botonAFondo.getAttribute('aria-pressed'), 'true', 'prime arranca en "A fondo" (navegador sin elección previa)');
    assert.equal(await botonRapido.getAttribute('aria-pressed'), 'false');
    console.log('✔ escena E (1/2): el control existe para la cuenta marcada y arranca en "A fondo"');

    await marcadoPage.screenshot({ path: `${SCREENSHOT_DIR}/1-composer-light.png` });
    await conTema(marcadoPage, 'dark');
    await grupoVelocidadMarcado.waitFor();
    await marcadoPage.screenshot({ path: `${SCREENSHOT_DIR}/2-composer-dark.png` });
    console.log('✔ capturas light/dark del compositor con el control visible');

    await botonRapido.click();
    await esperarAriaPressed(botonRapido, 'true');
    assert.equal(await botonAFondo.getAttribute('aria-pressed'), 'false');

    await marcadoPage.reload({ waitUntil: 'domcontentloaded' });
    await grupoVelocidadMarcado.waitFor();
    // El primer render (servidor + primera pasada del cliente) siempre
    // arranca en el default de la cuenta ("A fondo" para prime) — la
    // preferencia guardada recién se aplica en un `useEffect` posterior
    // (Workspace.tsx), así que hay que ESPERAR el cambio, no leerlo al toque.
    await esperarAriaPressed(marcadoPage.getByRole('button', { name: 'Rápido' }), 'true');
    assert.equal(await marcadoPage.getByRole('button', { name: 'A fondo' }).getAttribute('aria-pressed'), 'false');
    console.log('✔ escena E (2/2): elegir "Rápido" sobrevive a un reload');

    // ───────────────────────────────────────────────────────────
    // Escena F — el pie del compositor no se parte en dos renglones en el
    // ancho más angosto del chat (el límite de lg:grid-cols-[minmax(18rem,24rem)_1fr],
    // que se toca justo en el breakpoint lg = 1024px).
    // ───────────────────────────────────────────────────────────
    await marcadoPage.setViewportSize({ width: 1024, height: 800 });
    await marcadoPage.reload({ waitUntil: 'domcontentloaded' });
    const grupoAngosto = marcadoPage.getByRole('group', { name: 'Velocidad de la respuesta' });
    await grupoAngosto.waitFor();
    // Sólo para que la captura muestre la preferencia ya asentada ("Rápido",
    // elegida en la escena anterior) y no el flash del default del primer
    // render — el chequeo de no-wrap de abajo no depende de esto.
    await esperarAriaPressed(marcadoPage.getByRole('button', { name: 'Rápido' }), 'true');

    // El pie del compositor es el ÚNICO <form> que contiene "Enviar" — hay
    // otros <form> en la página (FichaDialog, StarterDialog) que quedan en
    // el DOM ocultos, y un `.first()` a ciegas podía caer en uno de esos
    // (0×0, "element is not visible").
    const pieCompositor = marcadoPage.locator('form').filter({ has: marcadoPage.getByRole('button', { name: 'Enviar' }) });
    const [bboxAdjuntar, bboxGrupo, bboxEnviar, bboxColumnaChat] = await Promise.all([
      marcadoPage.getByRole('button', { name: 'Adjuntar' }).boundingBox(),
      grupoAngosto.boundingBox(),
      marcadoPage.getByRole('button', { name: 'Enviar' }).boundingBox(),
      pieCompositor.boundingBox(),
    ]);
    assert.ok(bboxAdjuntar && bboxGrupo && bboxEnviar, 'los tres controles del pie tienen que estar visibles');
    console.log(
      `  (diagnóstico) ancho del pie del compositor a 1024px de viewport: ${bboxColumnaChat?.width ?? '?'}px`,
    );
    assert.ok(
      Math.abs(bboxAdjuntar!.y - bboxGrupo!.y) < 6 && Math.abs(bboxGrupo!.y - bboxEnviar!.y) < 6,
      `"Adjuntar" (y=${bboxAdjuntar!.y}), el control (y=${bboxGrupo!.y}) y "Enviar" (y=${bboxEnviar!.y}) tienen que estar en el mismo renglón`,
    );
    await pieCompositor.screenshot({ path: `${SCREENSHOT_DIR}/3-footer-1024-no-wrap.png` });
    console.log('✔ escena F: el pie del compositor no se parte en dos renglones a 1024px de viewport');

    // ───────────────────────────────────────────────────────────
    // Escena G — prime apagado + "A fondo para todos" prendido: un docente
    // común (sin marcar) tiene el control igual (capa 1), con "Rápido" como
    // default — nunca "A fondo", que sí encarece.
    // ───────────────────────────────────────────────────────────
    await fijarSettings(adminPage, { primeEnabled: false, deepModeForAll: true });
    await normalPage.reload({ waitUntil: 'domcontentloaded' });
    await normalPage.waitForSelector('textarea[placeholder="Preguntale a Kodu…"]');
    const grupoNormalConDeepModeForAll = normalPage.getByRole('group', { name: 'Velocidad de la respuesta' });
    await grupoNormalConDeepModeForAll.waitFor();
    // Este docente nunca eligió nada en este navegador (el control estaba
    // ausente en la escena D): no hay preferencia en localStorage, así que
    // no hay ninguna transición que esperar — pero se usa el mismo helper
    // por consistencia y para no depender de en qué instante corrió el
    // primer render.
    await esperarAriaPressed(normalPage.getByRole('button', { name: 'Rápido' }), 'true');
    assert.equal(await normalPage.getByRole('button', { name: 'A fondo' }).getAttribute('aria-pressed'), 'false');

    const fuenteConDeepModeForAll = await normalPage.content();
    assert.ok(
      !/\bprime\b/i.test(fuenteConDeepModeForAll),
      'ni siquiera con el control visible por deepModeForAll la página puede decir "prime"',
    );
    console.log('✔ escena G: prime off + "A fondo para todos" on → el docente común tiene el control con "Rápido" de default');

    console.log(`\n✔ e2e/t6-velocidad.ts: todas las comprobaciones pasaron (capturas en ${SCREENSHOT_DIR})`);
  } finally {
    try {
      const adminContext2 = await browser.newContext();
      const adminPage2 = await adminContext2.newPage();
      await iniciarSesion(adminPage2, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      if (defaultOriginalId) await fijarDefault(adminPage2, defaultOriginalId);
      if (modelId && dialectoOriginal) {
        await fijarDialecto(adminPage2, modelId, {
          reasoningEffort: dialectoOriginal.reasoningEffort,
          reasoningParam: dialectoOriginal.reasoningParam,
        });
      }
      await fijarSettings(adminPage2, { primeEnabled: false, deepModeForAll: false });
      await adminContext2.close();
      console.log('✔ limpieza: default original y dialecto del mock restaurados; prime y "A fondo para todos" apagados');
    } catch (error) {
      console.error('[t6-velocidad] no se pudo restaurar el estado al final:', error);
    }

    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

/** Espera a que `aria-pressed` tome el valor pedido (el click dispara un guardado en localStorage, no hay red que esperar). */
async function esperarAriaPressed(locator: import('playwright').Locator, valor: string, timeoutMs = 3_000): Promise<void> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if ((await locator.getAttribute('aria-pressed')) === valor) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`esperarAriaPressed: aria-pressed nunca llegó a "${valor}"`);
}

await main();
console.log('\n✔ e2e/t6-velocidad.ts: terminado');
