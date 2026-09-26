import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { MARCADOR_SISTEMA_CHECKLIST } from '../src/lib/ai/checklist.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';
import type { BrowserContext, Page } from 'playwright';

/**
 * Chequeo de navegador de T4/T5 (odd/tasks/generacion-simple-y-reanudable.md):
 * cerrar la pestaña ya no frena la generación (T4), y el self-test que se
 * perdió por eso corre solo al reabrir el proyecto (T5). Mismo mock que T3
 * (`e2e/mock-proveedor.ts`, `kodu-mock-t3`/`mock-t3`, reusado por
 * `t9-varias-versiones.ts`/`verificador-editor.ts`).
 *
 * Tres escenas:
 *  a/b — cerrar la pestaña a mitad de la generación: el servidor la termina
 *        solo, un reload muestra primero el turno en curso y después el
 *        resultado, y el self-test/checklist que se perdieron corren una
 *        sola vez al reabrir (nunca dos).
 *  c   — "Detener" sigue frenando: la conexión con el PROVEEDOR se corta de
 *        verdad (no sólo la del navegador con kodu), y el hilo termina con
 *        el mismo "Frenaste este pedido" de siempre — un solo mensaje.
 *  d   — dos pestañas abiertas sobre un proyecto con un turno sin chequear:
 *        sólo una corre el pipeline.
 *
 * Requiere la pila de desarrollo levantada (`docker compose up -d db`,
 * `npm run dev` en el puerto 3000). Corre con:
 *   npx tsx e2e/generacion-reanudable.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-generacion-reanudable@kodu.local';
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

/**
 * Espera hasta que `fn` devuelva algo verdadero, sondeando cada
 * `intervaloMs` — para esperar estado del SERVIDOR (Prisma) mientras la
 * generación sigue corriendo del lado de kodu aunque la pestaña que la pidió
 * ya se haya cerrado (justo lo que T4 tiene que probar).
 */
async function esperarHasta<T>(fn: () => Promise<T | null | undefined>, timeoutMs: number, intervaloMs = 400): Promise<T> {
  const limite = Date.now() + timeoutMs;
  for (;;) {
    const resultado = await fn();
    if (resultado) return resultado;
    if (Date.now() > limite) throw new Error(`esperarHasta: se agotó el tiempo (${timeoutMs}ms)`);
    await esperar(intervaloMs);
  }
}

// ─────────────────────────────────────────────────────────────
// HTML de prueba: bastante grande como para que, con chunks chicos y
// demorados, la generación tarde varios segundos de verdad — el tiempo que
// necesita cerrar la pestaña "a mitad de camino" y no al final por accidente.
// ─────────────────────────────────────────────────────────────

function htmlReanudable(marca: string): string {
  const relleno = Array.from({ length: 60 }, (_, i) => `  <p>Línea de relleno ${i} para ${marca}.</p>`).join('\n');
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="pizarron">
<title>Reanudable ${marca}</title>
</head>
<body data-marca="${marca}">
  <h1>Recurso ${marca}</h1>
${relleno}
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// Helpers (mismo patrón que e2e/t9-varias-versiones.ts / verificador-editor.ts)
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

async function crearProyecto(page: Page, title: string, modelId: string): Promise<{ id: string; threadId: string }> {
  const creado = await page.request.post(`${BASE_URL}/api/projects`, { data: { title } });
  assert.equal(creado.status(), 200, `alta del proyecto "${title}": ${creado.status()} ${await creado.text()}`);
  const { project } = (await creado.json()) as { project: { id: string; threadId: string } };
  await prisma.project.update({ where: { id: project.id }, data: { aiModelId: modelId } });
  return project;
}

async function mensajesDelHilo(threadId: string) {
  return prisma.chatMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, undoneAt: true, postChecksAt: true, snapshot: { select: { id: true } } },
  });
}

async function proyectoActual(id: string) {
  return prisma.project.findUniqueOrThrow({ where: { id }, select: { currentHtml: true } });
}

/** Cuerpos crudos vistos en `POST /api/chat/post-checks` — capturados vía
 *  `page.on('response', ...)` para probar el reclamo atómico (escena D) y
 *  "no se vuelve a intentar" (escena B). */
interface RespuestaPostChecks {
  action: string;
  claimed?: boolean;
  marked?: boolean;
}

function observarPostChecks(page: Page, sink: RespuestaPostChecks[]): void {
  page.on('requestfinished', (request) => {
    if (!request.url().endsWith('/api/chat/post-checks') || request.method() !== 'POST') return;
    const postData = request.postDataJSON() as { action: string } | null;
    request
      .response()
      .then((resp) => resp?.json())
      .then((body) => {
        if (postData) sink.push({ action: postData.action, ...(body as Record<string, unknown>) });
      })
      .catch(() => {
        /* la conexión pudo cerrarse antes de leer el body (pestaña cerrada) */
      });
  });
}

async function main(): Promise<void> {
  await asegurarDocente(DOCENTE_EMAIL, DOCENTE_PASSWORD, 'Docente E2E generación reanudable');

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  const browser = await abrirNavegador();

  try {
    const adminContext: BrowserContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const modelId = await asegurarMotorMock(adminPage, mock.url);
    console.log(`✔ motor mock listo (${modelId})`);
    await adminContext.close();

    const docenteContext = await browser.newContext();
    await iniciarSesion(await docenteContext.newPage(), { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    // ═══════════════════════════════════════════════════════════
    // Escenas A/B — cerrar la pestaña a mitad de la generación
    // ═══════════════════════════════════════════════════════════

    const proyectoAB = await crearProyecto(docenteContext.pages()[0]!, 'Reanudable — A/B', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ html: htmlReanudable('ab'), chunkBytes: 24, chunkDelayMs: 150 });

    const pagina1 = await docenteContext.newPage();
    await pagina1.goto(`${BASE_URL}/app/project/${proyectoAB.id}`, { waitUntil: 'load' });

    await pagina1.locator('textarea[placeholder="Preguntale a Kodu…"]').click();
    await pagina1.locator('textarea[placeholder="Preguntale a Kodu…"]').pressSequentially('Armame algo simple (A/B)', { delay: 10 });
    await pagina1.getByRole('button', { name: 'Enviar' }).click();

    // "Armando el recurso" sólo aparece después de `tool_start` — para ese
    // momento el checklist YA corrió y el tool call de verdad arrancó a
    // mandar bytes, así que cerrar acá es "a mitad de camino", no "antes de
    // arrancar".
    await pagina1.getByText('Armando el recurso').waitFor({ state: 'visible', timeout: 15_000 });
    await pagina1.close();
    console.log('✔ escena A (1/4): la pestaña se cerró con el tool call ya en curso');

    // El servidor sigue pidiéndole al mock aunque la pestaña ya no exista —
    // se espera a que termine SIN volver a abrir nada todavía.
    const mensajesTrasGenerar = await esperarHasta(
      async () => {
        const mensajes = await mensajesDelHilo(proyectoAB.threadId);
        const asistente = mensajes.find((m) => m.role === 'assistant');
        return asistente ? mensajes : null;
      },
      30_000,
    );
    assert.equal(
      mensajesTrasGenerar.filter((m) => m.role === 'assistant').length,
      1,
      'exactamente un mensaje "assistant", aunque la pestaña se haya cerrado a mitad de camino',
    );
    const proyectoTrasGenerar = await proyectoActual(proyectoAB.id);
    assert.ok(
      proyectoTrasGenerar.currentHtml.includes('data-marca="ab"'),
      'currentHtml tiene que ser el HTML COMPLETO que mandó el mock, no un parcial',
    );
    const consumoTrasGenerar = await prisma.tokenUsage.count({ where: { projectId: proyectoAB.id } });
    assert.ok(consumoTrasGenerar >= 1, 'se tiene que haber registrado consumo de tokens');
    console.log('✔ escena A (2/4): el servidor terminó solo — un mensaje, HTML completo, consumo registrado');

    // Reabre el proyecto DURANTE la generación de un turno 2 (repite la
    // misma mecánica: cerrar, reabrir) para comprobar el "muestra primero el
    // turno en curso y después el resultado" de punta a punta, con la
    // pestaña de verdad cerrada (no sólo recargada).
    mock.programarRespuesta({ html: htmlReanudable('ab-2'), chunkBytes: 24, chunkDelayMs: 150 });
    const pagina1b = await docenteContext.newPage();
    await pagina1b.goto(`${BASE_URL}/app/project/${proyectoAB.id}`, { waitUntil: 'load' });
    await pagina1b.locator('textarea[placeholder="Preguntale a Kodu…"]').click();
    await pagina1b.locator('textarea[placeholder="Preguntale a Kodu…"]').pressSequentially('Otro pedido (A/B, turno 2)', { delay: 10 });
    await pagina1b.getByRole('button', { name: 'Enviar' }).click();
    await pagina1b.getByText('Armando el recurso').waitFor({ state: 'visible', timeout: 15_000 });
    await pagina1b.close();

    const pagina2 = await docenteContext.newPage();
    const postChecksVistosEnPagina2: RespuestaPostChecks[] = [];
    observarPostChecks(pagina2, postChecksVistosEnPagina2);
    await pagina2.goto(`${BASE_URL}/app/project/${proyectoAB.id}`, { waitUntil: 'load' });

    // Todavía en curso del lado del servidor: muestra el estado "pensando"
    // (el poll de reanudación) ANTES de mostrar el resultado.
    await pagina2.getByText('Pensando cómo resolverlo').waitFor({ state: 'visible', timeout: 5_000 });
    console.log('✔ escena B (1/4): al reabrir, muestra primero el turno en curso ("Pensando cómo resolverlo")');

    // Y después, el resultado — el poll de 4s lo trae solo.
    // El HTML todavía se está transmitiendo desde el mock cuando se abrió
    // esta pestaña (chunkDelayMs=150 × ~110 chunks), así que "Pensando cómo
    // resolverlo" queda visible hasta que el poll de 4s encuentra el mensaje
    // final — un margen generoso cubre generación + latencia del poll.
    await pagina2.getByText('Pensando cómo resolverlo').waitFor({ state: 'hidden', timeout: 45_000 });
    const frenteFrame = pagina2.frameLocator('iframe[data-kodu-frente="true"]');
    await frenteFrame.locator('[data-marca="ab-2"]').waitFor({ state: 'attached', timeout: 10_000 });
    console.log('✔ escena B (2/4): … y después, el recurso terminado');

    // T5: el self-test/checklist que se perdieron corren solos al reabrir —
    // "Esto es lo que probé" es la marca visible de que el checklist +
    // autoprueba corrieron sobre ESTE HTML.
    await pagina2.getByText(/Esto es lo que probé/).waitFor({ state: 'visible', timeout: 30_000 });
    console.log('✔ escena B (3/4): el self-test reanudado corrió ("Esto es lo que probé" apareció)');

    const mensajeTurno2 = await esperarHasta(async () => {
      const mensajes = await mensajesDelHilo(proyectoAB.threadId);
      const ultimo = mensajes.filter((m) => m.role === 'assistant').at(-1);
      return ultimo?.postChecksAt ? ultimo : null;
    }, 15_000);
    assert.ok(mensajeTurno2.postChecksAt, 'el marcador postChecksAt tiene que quedar puesto tras el pipeline reanudado');
    console.log('✔ escena B (3b/4): postChecksAt quedó marcado en la base');

    await pagina2.close();

    // Reabrir DE NUEVO no debe volver a reclamar nada: pendingPostChecks ya
    // es null (el marcador quedó puesto arriba).
    const pagina3 = await docenteContext.newPage();
    const postChecksVistosEnPagina3: RespuestaPostChecks[] = [];
    observarPostChecks(pagina3, postChecksVistosEnPagina3);
    await pagina3.goto(`${BASE_URL}/app/project/${proyectoAB.id}`, { waitUntil: 'load' });
    await pagina3.waitForTimeout(2_000); // margen para que, si algo dispara un reclamo, alcance a verse.
    assert.equal(
      postChecksVistosEnPagina3.filter((r) => r.action === 'claim').length,
      0,
      'reabrir un proyecto ya chequeado no debe pedir ningún reclamo nuevo',
    );
    await pagina3.close();
    console.log('✔ escena B (4/4): reabrir de nuevo no vuelve a correr el pipeline');

    // ═══════════════════════════════════════════════════════════
    // Escena C — "Detener" corta la conexión con el PROVEEDOR
    // ═══════════════════════════════════════════════════════════

    const proyectoC = await crearProyecto(docenteContext.pages()[0]!, 'Reanudable — C (Detener)', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ html: htmlReanudable('c'), chunkBytes: 20, chunkDelayMs: 200 });

    const paginaC = await docenteContext.newPage();
    await paginaC.goto(`${BASE_URL}/app/project/${proyectoC.id}`, { waitUntil: 'load' });
    await paginaC.locator('textarea[placeholder="Preguntale a Kodu…"]').click();
    await paginaC.locator('textarea[placeholder="Preguntale a Kodu…"]').pressSequentially('Armame algo simple (C)', { delay: 10 });
    await paginaC.getByRole('button', { name: 'Enviar' }).click();

    await paginaC.getByText('Armando el recurso').waitFor({ state: 'visible', timeout: 15_000 });
    await paginaC.getByRole('button', { name: 'Detener' }).click();
    console.log('✔ escena C (1/3): "Detener" tocado con el tool call en curso');

    // Le da tiempo al servidor a terminar de desenrollarse (abortar el
    // fetch al mock, correr el `finally`, y a `/api/chat/cancel` a dejar
    // constancia) antes de mirar el resultado.
    await esperarHasta(async () => {
      const mensajes = await mensajesDelHilo(proyectoC.threadId);
      return mensajes.some((m) => m.role === 'assistant') ? mensajes : null;
    }, 10_000);
    // Y un margen extra: si HUBIERA una duplicación (el `finally` de
    // stream.ts creando su propio mensaje además del de /api/chat/cancel),
    // es en esta ventana donde aparecería.
    await esperar(1_500);

    const mensajesTrasDetener = await mensajesDelHilo(proyectoC.threadId);
    const asistentesTrasDetener = mensajesTrasDetener.filter((m) => m.role === 'assistant');
    assert.equal(asistentesTrasDetener.length, 1, '"Detener" no debe dejar dos mensajes "assistant"');
    assert.equal(
      asistentesTrasDetener[0]!.content,
      'Frenaste este pedido. Tu recurso quedó como estaba.',
      'el mismo aviso de siempre, no el "cortó sin devolver nada" genérico',
    );
    console.log('✔ escena C (2/3): un solo mensaje, el aviso de "Detener" de siempre');

    const llamadaPrincipal = mock.llamadas.filter((l) => {
      const mensajesDelBody = (l.body as { messages?: Array<{ content?: unknown }> }).messages;
      const primero = mensajesDelBody?.[0]?.content;
      return typeof primero === 'string' && !primero.includes(MARCADOR_SISTEMA_CHECKLIST);
    });
    assert.ok(llamadaPrincipal.length >= 1, 'tiene que haber por lo menos una llamada principal al mock');
    assert.ok(
      llamadaPrincipal.some((l) => l.cortadoTemprano),
      '"Detener" tiene que cortar la conexión del SERVIDOR con el proveedor, no sólo la del navegador con kodu',
    );
    console.log('✔ escena C (3/3): el mock vio la conexión cortada de verdad (cortadoTemprano)');

    await paginaC.close();

    // ═══════════════════════════════════════════════════════════
    // Escena D — dos pestañas sobre un proyecto con un turno sin chequear:
    // sólo una corre el pipeline.
    // ═══════════════════════════════════════════════════════════

    const proyectoD = await crearProyecto(docenteContext.pages()[0]!, 'Reanudable — D (dos pestañas)', modelId);
    mock.programarRespuesta({ html: htmlReanudable('d'), chunkBytes: 4_000, chunkDelayMs: 5 });
    // Generado por API directa (sin abrir el editor): el turno queda
    // completo pero SIN pasar nunca por el self-test del navegador — mismo
    // estado que dejaría cerrar la pestaña antes de que arrancara.
    const generado = await docenteContext.pages()[0]!.request.post(`${BASE_URL}/api/chat/stream`, {
      data: { projectId: proyectoD.id, threadId: proyectoD.threadId, message: 'Armame algo simple (D)', model: modelId },
    });
    assert.equal(generado.status(), 200, `generación directa (D): ${generado.status()} ${await generado.text()}`);

    const paginaD1 = await docenteContext.newPage();
    const paginaD2 = await docenteContext.newPage();
    const vistosD1: RespuestaPostChecks[] = [];
    const vistosD2: RespuestaPostChecks[] = [];
    observarPostChecks(paginaD1, vistosD1);
    observarPostChecks(paginaD2, vistosD2);

    await Promise.all([
      paginaD1.goto(`${BASE_URL}/app/project/${proyectoD.id}`, { waitUntil: 'load' }),
      paginaD2.goto(`${BASE_URL}/app/project/${proyectoD.id}`, { waitUntil: 'load' }),
    ]);

    await esperarHasta(async () => {
      const mensajes = await mensajesDelHilo(proyectoD.threadId);
      const ultimo = mensajes.filter((m) => m.role === 'assistant').at(-1);
      return ultimo?.postChecksAt ? true : null;
    }, 20_000);
    await esperar(1_000); // margen para que ambas respuestas de "claim" ya se hayan visto.

    const reclamosAceptados = [...vistosD1, ...vistosD2].filter((r) => r.action === 'claim' && r.claimed === true);
    assert.equal(reclamosAceptados.length, 1, 'de las dos pestañas, exactamente una tiene que quedarse con el reclamo');
    console.log('✔ escena D: dos pestañas, un solo reclamo aceptado — el pipeline corrió una sola vez');

    await paginaD1.close();
    await paginaD2.close();

    console.log('\n✔ e2e/generacion-reanudable.ts: todas las comprobaciones pasaron');
  } finally {
    // Los contexts (admin/docente) se cierran solos con `browser.close()`.
    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
console.log('\n✔ e2e/generacion-reanudable.ts: terminado');
