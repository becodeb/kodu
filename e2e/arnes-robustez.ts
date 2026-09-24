import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';
import { bloqueKitLegado } from '../src/lib/ai/kit.ts';
import type { Page } from 'playwright';

/**
 * Chequeo de flujo de T4 (`odd/tasks/arnes-robustez.md`), mismo patrón que
 * `e2e/html-fuera-del-system.ts`: a través de la app real contra el
 * AiProvider mock, comprueba que T1/T3 llegan de punta a punta, no sólo en
 * las pruebas unitarias:
 *
 *   A. El system prompt que el mock RECIBIÓ lleva la sección nueva
 *      ("## Que funcione de verdad") y documenta `kodu.arrastrar`.
 *   B. El HTML que el servidor GUARDA después del turno (Project.currentHtml)
 *      lleva el bloque del kit actual: `window.kodu` y la regla `[hidden]`.
 *   C. Un recurso guardado con el bloque ANTERIOR a T1 (`bloqueKitLegado`)
 *      sigue siendo reconocido como canónico en el flujo real: el mensaje
 *      de usuario que el mock recibe lo lleva PLEGADO (el marcador corto),
 *      no el bloque completo — probando que `bloqueEsCanonico` acepta el
 *      legado también cuando pasa por `buildCurrentResourceBlock` en un
 *      pedido real, no sólo en la prueba unitaria de `kit.ts`.
 *
 * Requiere la pila de desarrollo levantada (`docker compose up -d db`,
 * `npm run dev` en el puerto 3000). Corre con: npx tsx e2e/arnes-robustez.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-arnes-robustez@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_KIND = 'kodu-mock-t3';
const PROVIDER_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-t3';
const MODEL_DISPLAY_NAME = 'Mock local (T3+)';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

// ─────────────────────────────────────────────────────────────
// Helpers (mismo patrón que e2e/html-fuera-del-system.ts / t7-revision-automatica.ts)
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
  // La base de desarrollo acumula intentos viejos de OTRAS sesiones/tareas
  // bajo el mismo kind "kodu-mock-t3" (convención compartida entre varios
  // e2e/*.ts), algunos apagados o sin clave cargada: un `findFirst` liso
  // puede agarrar uno de esos en vez del bueno. Filtrar por `enabled` Y
  // `apiKeyCipher` no nulo evita reusar una cuenta que nunca va a poder
  // contestar (el turno cae al motor por defecto real y el mock no ve nada).
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

/** Manda un turno por la API cruda (sin streaming detallado) y devuelve el evento "done". */
async function enviarTurnoPorApi(
  page: Page,
  args: { projectId: string; threadId: string; message: string; modelId: string },
): Promise<{ status: number }> {
  const resp = await page.request.post(`${BASE_URL}/api/chat/stream`, {
    data: { projectId: args.projectId, threadId: args.threadId, message: args.message, model: args.modelId },
  });
  if (resp.status() !== 200) return { status: resp.status() };
  await resp.text(); // agota el stream: el servidor termina de guardar recién al cerrar la respuesta
  return { status: 200 };
}

interface PedidoMock {
  messages: Array<{ role: string; content: unknown }>;
}

function htmlConTema(temaId: string, marca: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="${temaId}">
<title>arnes-robustez ${marca}</title>
</head>
<body data-marca="${marca}">
  <h1>Turno ${marca}</h1>
</body>
</html>`;
}

async function main(): Promise<void> {
  const docenteId = await asegurarDocente(DOCENTE_EMAIL, DOCENTE_PASSWORD, 'Docente E2E T4 (arnes-robustez)');
  void docenteId;

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  const browser = await abrirNavegador();

  try {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const modelId = await asegurarMotorMock(adminPage, mock.url);
    console.log(`✔ motor mock listo (${modelId})`);

    // Un pedido al mock por turno: sin auto-revisión, sin versiones, "fast".
    await fijarSettings(adminPage, { primeEnabled: false, autoReviewForAll: false, deepModeForAll: false });

    const docenteContext = await browser.newContext();
    const docentePage = await docenteContext.newPage();
    await iniciarSesion(docentePage, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    // ── A + B: turno normal — system prompt nuevo, HTML guardado con el kit actual ──
    const proyectoA = await crearProyecto(docentePage, 'T4 — arnes-robustez (bloque actual)', modelId);
    mock.llamadas.length = 0;

    mock.programarRespuesta({
      texto: 'Listo, turno A.',
      html: htmlConTema('pizarron', 'a'),
      chunkDelayMs: 5,
      chunkBytes: 5_000,
    });
    const resultadoA = await enviarTurnoPorApi(docentePage, {
      projectId: proyectoA.id,
      threadId: proyectoA.threadId,
      message: 'Turno A: armá algo simple (ARNES-ROBUSTEZ-A)',
      modelId,
    });
    assert.equal(resultadoA.status, 200, 'turno A: el pedido tiene que responder 200');
    assert.equal(mock.llamadas.length, 1, 'turno A: tiene que sumar exactamente un pedido al mock');

    const pedidoA = mock.llamadas[0]!.body as unknown as PedidoMock;
    const sistemaA = pedidoA.messages[0]!.content as string;
    assert.equal(pedidoA.messages[0]!.role, 'system');
    assert.ok(sistemaA.includes('## Que funcione de verdad'), 'el system prompt tiene que llevar la sección nueva de T3/T4');
    assert.ok(sistemaA.includes('kodu.arrastrar'), 'el system prompt tiene que documentar kodu.arrastrar');
    // Vuelta 2: el arrastre en unidades del problema y el orden mezclado.
    assert.ok(sistemaA.includes('alCambiar: (v) =>'), 'el system prompt tiene que llevar el ejemplo del arrastre en unidades');
    assert.ok(sistemaA.includes('kodu.mezclar('), 'el system prompt tiene que documentar kodu.mezclar');
    console.log('✔ (A) el system prompt que recibió el mock lleva "Que funcione de verdad" y "kodu.arrastrar"');

    const proyectoGuardadoA = await prisma.project.findUniqueOrThrow({
      where: { id: proyectoA.id },
      select: { currentHtml: true },
    });
    assert.ok(
      proyectoGuardadoA.currentHtml.includes('window.kodu'),
      'el HTML guardado después del turno tiene que llevar el bloque del kit con window.kodu',
    );
    assert.ok(
      proyectoGuardadoA.currentHtml.includes('[hidden]{display:none!important}'),
      'el HTML guardado después del turno tiene que llevar la regla [hidden] del kit',
    );
    assert.ok(
      proyectoGuardadoA.currentHtml.includes('festejar: festejar') && proyectoGuardadoA.currentHtml.includes('__koduDibujarIconos'),
      'el HTML guardado tiene que llevar el kit de la vuelta 2 (festejar y el dibujo de íconos nuevo)',
    );
    console.log('✔ (B) el HTML guardado (Project.currentHtml) lleva window.kodu y la regla [hidden]');

    // ── C: un recurso con el bloque LEGADO (previo a T1) sigue plegándose en el flujo real ──
    const proyectoB = await crearProyecto(docentePage, 'T4 — arnes-robustez (bloque legado)', modelId);
    const htmlLegado =
      `<!DOCTYPE html>\n<html lang="es">\n<head>\n<meta charset="UTF-8">\n` +
      `<meta name="kodu-tema" content="pizarron">\n${bloqueKitLegado('pizarron')}\n</head>\n` +
      `<body><h1>Recurso con el kit viejo</h1></body>\n</html>`;
    await prisma.project.update({ where: { id: proyectoB.id }, data: { currentHtml: htmlLegado } });

    mock.llamadas.length = 0;
    mock.programarRespuesta({
      texto: 'Listo, turno B.',
      html: htmlConTema('pizarron', 'b'),
      chunkDelayMs: 5,
      chunkBytes: 5_000,
    });
    const resultadoB = await enviarTurnoPorApi(docentePage, {
      projectId: proyectoB.id,
      threadId: proyectoB.threadId,
      message: 'Turno B: armá algo simple (ARNES-ROBUSTEZ-B)',
      modelId,
    });
    assert.equal(resultadoB.status, 200, 'turno B: el pedido tiene que responder 200');
    assert.equal(mock.llamadas.length, 1, 'turno B: tiene que sumar exactamente un pedido al mock');

    const pedidoB = mock.llamadas[0]!.body as unknown as PedidoMock;
    const ultimoB = pedidoB.messages.at(-1)!;
    assert.equal(ultimoB.role, 'user', 'el último mensaje tiene que ser del usuario (ahí viaja el bloque del recurso)');
    const contenidoB = ultimoB.content as string;
    assert.ok(
      !contenidoB.includes('tailwind.config'),
      'el bloque legado tiene que llegar PLEGADO al mock, no el bloque completo (con tailwind.config adentro)',
    );
    assert.ok(
      contenidoB.includes('<!-- kodu-kit:v1 tema=pizarron:'),
      'tiene que quedar el marcador corto del plegado para el tema pizarron',
    );
    console.log('✔ (C) un recurso guardado con el bloque legado llega PLEGADO (marcador corto) en un pedido real, no el bloque completo');

    console.log('\n✔ e2e/arnes-robustez.ts: todas las comprobaciones pasaron');
  } finally {
    try {
      const adminContext2 = await browser.newContext();
      const adminPage2 = await adminContext2.newPage();
      await iniciarSesion(adminPage2, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await fijarSettings(adminPage2, { primeEnabled: false, autoReviewForAll: false, deepModeForAll: false });
      await adminContext2.close();
    } catch (error) {
      console.error('[arnes-robustez] no se pudo restaurar settings al final:', error);
    }
    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
console.log('\n✔ e2e/arnes-robustez.ts: terminado');
