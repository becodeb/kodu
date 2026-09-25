import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { DEFAULT_HTML, MENSAJE_VERSIONES_LISTAS } from '../src/lib/ai/versiones.ts';
import { MARCADOR_SISTEMA_CHECKLIST } from '../src/lib/ai/checklist.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';
import type { Page } from 'playwright';

/**
 * Chequeo de navegador + API de T9 (odd/tasks/modo-prime.md, "Varias
 * versiones al crear un recurso"). Requiere la pila de desarrollo levantada
 * (`docker compose up -d db`, `npm run dev` en el puerto 3000) y REUSA el
 * AiProvider/AiModel mock que dejó T3 (kind "kodu-mock-t3", providerModel
 * "mock-t3") — mismo patrón que e2e/t4-deshacer.ts, t6, t7 y t8.
 *
 * Corre con: npx tsx e2e/t9-varias-versiones.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const PRIME_EMAIL = 'docente-e2e-t9-prime@kodu.local';
const PRIME_PASSWORD = 'Docente.E2E.2026';
const SIN_CAPACIDAD_EMAIL = 'docente-e2e-t9-comun@kodu.local';
const SIN_CAPACIDAD_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_KIND = 'kodu-mock-t3';
const PROVIDER_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-t3';
const MODEL_DISPLAY_NAME = 'Mock local (T3+)';

const SCREENSHOT_DIR = '/tmp/kodu-t9';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────
// HTML de prueba: limpio (sin hallazgos de T7) salvo la variante con emoji,
// a propósito para la escena de corrección. `marca` queda en `data-marca`
// para poder reconocer qué versión terminó aplicada.
// ─────────────────────────────────────────────────────────────

function htmlLimpio(marca: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="pizarron">
<title>T9 ${marca}</title>
</head>
<body data-marca="${marca}">
  <h1>Recurso ${marca}</h1>
  <p><i data-lucide="calculator"></i> Contenido de prueba para T9.</p>
</body>
</html>`;
}

function htmlConEmoji(marca: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="pizarron">
<title>T9 ${marca}</title>
</head>
<body data-marca="${marca}">
  <h1>Recurso ${marca} 🎉</h1>
  <p><i data-lucide="calculator"></i> Contenido de prueba para T9.</p>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// Helpers (mismo patrón que e2e/t7-revision-automatica.ts y t8)
// ─────────────────────────────────────────────────────────────

async function asegurarDocente(
  email: string,
  password: string,
  nombre: string,
  primeAccess = false,
): Promise<string> {
  const fila = await prisma.user.upsert({
    where: { email },
    update: { role: 'DOCENTE', primeAccess },
    create: { email, name: nombre, role: 'DOCENTE', passwordHash: await hashPassword(password), primeAccess },
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

/** Manda un turno por la API cruda y devuelve TODOS los eventos SSE (no sólo "done"). */
async function enviarTurnoCompleto(
  page: Page,
  args: {
    projectId: string;
    threadId: string;
    message: string;
    modelId: string;
    speed?: 'fast' | 'deep';
    variants?: 3;
  },
): Promise<{ status: number; eventos: EventoSse[]; done: EventoSse | null }> {
  const resp = await page.request.post(`${BASE_URL}/api/chat/stream`, {
    data: {
      projectId: args.projectId,
      threadId: args.threadId,
      message: args.message,
      model: args.modelId,
      ...(args.speed ? { speed: args.speed } : {}),
      ...(args.variants ? { variants: args.variants } : {}),
    },
  });
  const status = resp.status();
  const eventos = status === 200 ? eventosDe(await resp.text()) : [];
  return { status, eventos, done: eventos.find((e) => e.type === 'done') ?? null };
}

async function proyectoActual(id: string): Promise<{ currentHtml: string }> {
  return prisma.project.findUniqueOrThrow({ where: { id }, select: { currentHtml: true } });
}

async function variantesDe(chatMessageId: string) {
  return prisma.resourceVariant.findMany({ where: { chatMessageId }, orderBy: { index: 'asc' } });
}

/** Matchea el pedido de UNA versión por la directiva que `directivaDeVersion`
 *  (lib/ai/versiones.ts) le suma al system prompt — el fragmento de cada
 *  una es único, así que sirve para distinguir las tres llamadas concurrentes
 *  sin depender del orden de llegada. La pasada de CORRECCIÓN (T7) no lleva
 *  esta directiva (reconstruye el system prompt sin ella), así que nunca
 *  matchea acá — cae sola al FIFO/default, que es justo lo que queremos. */
/** T16 (round 4, "checklist del docente"): todo turno que crea un recurso
 *  NUEVO manda su propio pedido de checklist ANTES de la generación
 *  principal — hay que poder distinguirlo del resto para no contarlo como
 *  una de las llamadas "de versión" que estas escenas miden. */
function esPedidoDeChecklist(body: Record<string, unknown>): boolean {
  const mensajes = body.messages as Array<{ role: string; content: unknown }> | undefined;
  const sistema = mensajes?.[0];
  return typeof sistema?.content === 'string' && sistema.content.includes(MARCADOR_SISTEMA_CHECKLIST);
}

function matchVersion(indice: 1 | 2 | 3) {
  const fragmento = indice === 1 ? 'una sola oración' : indice === 2 ? 'Priorizá lo visual' : 'Priorizá el juego';
  return (body: Record<string, unknown>) => {
    const mensajes = body.messages as Array<{ role: string; content: unknown }> | undefined;
    const sistema = mensajes?.[0];
    return typeof sistema?.content === 'string' && sistema.content.includes(fragmento);
  };
}

async function leerHilo(
  page: Page,
  projectId: string,
  threadId: string,
): Promise<{
  currentHtml: string;
  messages: Array<{ id: string; role: string; variants?: Array<{ index: number }>; chosenVariant?: number }>;
}> {
  const resp = await page.request.get(
    `${BASE_URL}/api/projects/${projectId}/threads?threadId=${encodeURIComponent(threadId)}`,
  );
  assert.equal(resp.status(), 200, `GET threads: ${resp.status()} ${await resp.text()}`);
  return (await resp.json()) as never;
}

async function main(): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const primeId = await asegurarDocente(PRIME_EMAIL, PRIME_PASSWORD, 'Docente E2E T9 (prime)');
  await asegurarDocente(SIN_CAPACIDAD_EMAIL, SIN_CAPACIDAD_PASSWORD, 'Docente E2E T9 (común)');

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  const browser = await abrirNavegador();

  try {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const modelId = await asegurarMotorMock(adminPage, mock.url);
    console.log(`✔ motor mock listo (${modelId})`);

    await adminPage.request.patch(`${BASE_URL}/api/admin/users/${primeId}`, { data: { primeAccess: true } });
    await fijarSettings(adminPage, {
      primeEnabled: true,
      autoReviewForAll: false,
      deepModeForAll: false,
      versionsForAll: false,
    });
    console.log('✔ cuenta prime marcada, prime encendido, "para todos" apagado');

    const primeContext = await browser.newContext();
    const primePage = await primeContext.newPage();
    await iniciarSesion(primePage, { email: PRIME_EMAIL, password: PRIME_PASSWORD });

    const comunContext = await browser.newContext();
    const comunPage = await comunContext.newPage();
    await iniciarSesion(comunPage, { email: SIN_CAPACIDAD_EMAIL, password: SIN_CAPACIDAD_PASSWORD });

    // ───────────────────────────────────────────────────────────
    // Escena A — prime + versiones + recurso vacío: exactamente 3 llamadas
    // concurrentes, sólo la 1 transmite parciales, "variant" para la 2 y la
    // 3, se guardan las 3, currentHtml = versión 1.
    // ───────────────────────────────────────────────────────────
    const proyectoA = await crearProyecto(primePage, 'T9 — tres versiones', modelId);
    mock.llamadas.length = 0;
    // chunkDelayMs/chunkBytes deliberadamente chicos: `stream.ts` sólo manda
    // un "code_delta" si el buffer llega a los 4096 bytes O pasan ~200ms
    // desde el último envío (CODE_DELTA_BATCH_MS) — con una respuesta
    // demasiado rápida, el tool call entero llega antes de que ese timer
    // dispare ni una vez, y `descartarCodeDelta()` lo tira sin flushear.
    mock.programarRespuestaCondicional(matchVersion(1), { html: htmlLimpio('a-v1'), chunkDelayMs: 60, chunkBytes: 40 });
    mock.programarRespuestaCondicional(matchVersion(2), { html: htmlLimpio('a-v2'), chunkDelayMs: 5, chunkBytes: 5_000 });
    mock.programarRespuestaCondicional(matchVersion(3), { html: htmlLimpio('a-v3'), chunkDelayMs: 5, chunkBytes: 5_000 });

    const turnoA = await enviarTurnoCompleto(primePage, {
      projectId: proyectoA.id,
      threadId: proyectoA.threadId,
      message: 'Armame algo simple (ESCENA-A)',
      modelId,
      speed: 'fast',
      variants: 3,
    });
    assert.equal(turnoA.status, 200, JSON.stringify(turnoA));
    // T16: `proyectoA` es nuevo, así que hay un pedido de checklist PROPIO
    // (secuencial, antes de las 3 versiones) — 4 llamadas, no 3.
    assert.equal(mock.llamadas.length, 4, `esperaba checklist + exactamente 3 llamadas, dio ${mock.llamadas.length}`);

    // La ventana de concurrencia sólo tiene sentido entre las 3 llamadas DE
    // VERSIÓN — la de checklist corre antes y sola, ensancharía la medición
    // sin decir nada sobre si las 3 versiones se dispararon juntas.
    const llamadasDeVersion = mock.llamadas.filter((l) => !esPedidoDeChecklist(l.body));
    assert.equal(llamadasDeVersion.length, 3);
    const tiempos = llamadasDeVersion.map((l) => l.recibidaEn);
    const ventana = Math.max(...tiempos) - Math.min(...tiempos);
    assert.ok(ventana < 2_000, `las 3 llamadas deberían solaparse en el tiempo; ventana medida: ${ventana}ms`);
    console.log(`✔ escena A (1/5): 3 llamadas concurrentes (ventana de arribo: ${ventana}ms)`);

    assert.equal(turnoA.eventos.filter((e) => e.type === 'code').length, 1, 'sólo la versión 1 manda "code"');
    assert.ok(turnoA.eventos.some((e) => e.type === 'code_delta'), 'la versión 1 tiene que transmitir parciales');
    console.log('✔ escena A (2/5): sólo la versión 1 transmitió "code_delta"/"code"');

    const anuncios = turnoA.eventos.filter((e) => e.type === 'variant' && e.ready === false).map((e) => e.index);
    const listas = turnoA.eventos.filter((e) => e.type === 'variant' && e.ready === true).map((e) => e.index);
    assert.deepEqual([...anuncios].sort(), [1, 2, 3], 'las tres se anuncian apenas arranca');
    assert.deepEqual([...listas].sort(), [1, 2, 3], 'las tres terminan bien en esta escena');
    console.log('✔ escena A (3/5): eventos "variant" — anuncio de 1/2/3, listas las 1/2/3');

    assert.equal(turnoA.done?.content, MENSAJE_VERSIONES_LISTAS, 'el mensaje persistido es el texto fijo');
    assert.equal(turnoA.done?.revisionVisualDisponible, false, 'un turno de versiones nunca ofrece revisión visual');

    const variantesA = await variantesDe(turnoA.done!.messageId as string);
    assert.equal(variantesA.length, 3);
    assert.deepEqual(variantesA.map((v) => v.index), [1, 2, 3]);
    assert.ok(variantesA[0]!.html.includes('data-marca="a-v1"'));
    assert.ok(variantesA[1]!.html.includes('data-marca="a-v2"'));
    assert.ok(variantesA[2]!.html.includes('data-marca="a-v3"'));

    const proyectoTrasA = await proyectoActual(proyectoA.id);
    assert.ok(proyectoTrasA.currentHtml.includes('data-marca="a-v1"'), 'currentHtml queda en la versión 1 hasta elegir');
    console.log('✔ escena A (4/5): las 3 quedaron guardadas en ResourceVariant; currentHtml = versión 1');

    const hiloA = await leerHilo(primePage, proyectoA.id, proyectoA.threadId);
    const mensajeA = hiloA.messages.find((m) => m.id === turnoA.done!.messageId);
    assert.deepEqual(mensajeA?.variants?.map((v) => v.index), [1, 2, 3]);
    assert.equal(mensajeA?.chosenVariant, 1);
    console.log('✔ escena A (5/5): threads.ts expone las 3 versiones y la elegida (1) para el mensaje más nuevo');

    // ───────────────────────────────────────────────────────────
    // Escena B — una versión 2 que falla: sólo quedan los chips 1 y 3.
    // ───────────────────────────────────────────────────────────
    const proyectoB = await crearProyecto(primePage, 'T9 — falla la 2', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuestaCondicional(matchVersion(1), { html: htmlLimpio('b-v1'), chunkDelayMs: 5, chunkBytes: 5_000 });
    mock.programarRespuestaCondicional(matchVersion(2), { status: 500 });
    mock.programarRespuestaCondicional(matchVersion(3), { html: htmlLimpio('b-v3'), chunkDelayMs: 5, chunkBytes: 5_000 });

    const turnoB = await enviarTurnoCompleto(primePage, {
      projectId: proyectoB.id,
      threadId: proyectoB.threadId,
      message: 'Armame algo simple (ESCENA-B)',
      modelId,
      speed: 'fast',
      variants: 3,
    });
    assert.equal(turnoB.status, 200, JSON.stringify(turnoB));

    const listasB = turnoB.eventos.filter((e) => e.type === 'variant' && e.ready === true).map((e) => e.index);
    assert.deepEqual([...listasB].sort(), [1, 3], 'la 2 nunca se anuncia lista');

    const variantesB = await variantesDe(turnoB.done!.messageId as string);
    assert.deepEqual(variantesB.map((v) => v.index), [1, 3], 'sólo quedan guardadas la 1 y la 3');

    const hiloB = await leerHilo(primePage, proyectoB.id, proyectoB.threadId);
    const mensajeB = hiloB.messages.find((m) => m.id === turnoB.done!.messageId);
    assert.deepEqual(mensajeB?.variants?.map((v) => v.index), [1, 3]);
    assert.equal(turnoB.done?.content, MENSAJE_VERSIONES_LISTAS, 'el turno igual se cierra bien: sólo se achican los chips');
    console.log('✔ escena B: una versión 2 que falla → sólo quedan los chips 1 y 3');

    // ───────────────────────────────────────────────────────────
    // Escena C — A fondo + versiones: nunca ofrece revisión visual, y CADA
    // versión corre su propia corrección de T7 (html con emoji → 6
    // llamadas en total, y ninguna versión guardada conserva el emoji).
    // ───────────────────────────────────────────────────────────
    const proyectoC = await crearProyecto(primePage, 'T9 — a fondo + corrección', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuestaCondicional(matchVersion(1), { html: htmlConEmoji('c-v1'), chunkDelayMs: 5, chunkBytes: 5_000 });
    mock.programarRespuestaCondicional(matchVersion(2), { html: htmlConEmoji('c-v2'), chunkDelayMs: 5, chunkBytes: 5_000 });
    mock.programarRespuestaCondicional(matchVersion(3), { html: htmlConEmoji('c-v3'), chunkDelayMs: 5, chunkBytes: 5_000 });
    // Las 3 pasadas de corrección (sin la directiva de versión en el
    // prompt: no matchean `matchVersion`) caen acá, FIFO, todas limpias.
    for (let i = 0; i < 3; i++) {
      mock.programarRespuesta({ html: htmlLimpio(`c-corregida-${i}`), chunkDelayMs: 5, chunkBytes: 5_000 });
    }

    const turnoC = await enviarTurnoCompleto(primePage, {
      projectId: proyectoC.id,
      threadId: proyectoC.threadId,
      message: 'Armame algo simple (ESCENA-C)',
      modelId,
      speed: 'deep',
      variants: 3,
    });
    assert.equal(turnoC.status, 200, JSON.stringify(turnoC));
    assert.equal(turnoC.done?.revisionVisualDisponible, false, 'versiones y revisión visual son excluyentes');
    // T16: `proyectoC` también es nuevo — checklist + 3 pasadas + 3
    // correcciones = 7, no 6.
    assert.equal(
      mock.llamadas.length,
      7,
      `esperaba checklist + 3 pasadas + 3 correcciones = 7, dio ${mock.llamadas.length}`,
    );

    const variantesC = await variantesDe(turnoC.done!.messageId as string);
    assert.equal(variantesC.length, 3);
    for (const variante of variantesC) {
      assert.doesNotMatch(variante.html, /🎉/, `la versión ${variante.index} tiene que haber perdido el emoji al corregirse`);
    }
    console.log('✔ escena C: A fondo + versiones → sin revisión visual, y cada versión se corrigió sola (7 llamadas)');

    // ───────────────────────────────────────────────────────────
    // Escena D — sin capacidad (ni prime, ni "para todos"): pedir variants:3
    // no alcanza, es un turno de 1 sola llamada, sin eventos "variant".
    // ───────────────────────────────────────────────────────────
    const proyectoD = await crearProyecto(comunPage, 'T9 — sin capacidad', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ html: htmlLimpio('d-unica'), chunkDelayMs: 5, chunkBytes: 20_000 });

    const turnoD = await enviarTurnoCompleto(comunPage, {
      projectId: proyectoD.id,
      threadId: proyectoD.threadId,
      message: 'Armame algo simple (ESCENA-D)',
      modelId,
      speed: 'fast',
      variants: 3,
    });
    assert.equal(turnoD.status, 200, JSON.stringify(turnoD));
    // T16: `proyectoD` es nuevo (aunque sin capacidad de versiones) — sigue
    // llevando su propio pedido de checklist, 2 llamadas, no 1.
    assert.equal(mock.llamadas.length, 2, 'sin puedePedirVersiones, variants:3 se ignora del todo (checklist + turno)');
    assert.equal(turnoD.eventos.some((e) => e.type === 'variant'), false);
    assert.notEqual(turnoD.done?.content, MENSAJE_VERSIONES_LISTAS);
    console.log('✔ escena D: docente sin capacidad + variants:3 → 1 sola llamada, sin "variant"');

    // ───────────────────────────────────────────────────────────
    // Escena E — recurso que ya no es el de arranque: aunque tenga prime y
    // lo pida, es un turno de 1 sola llamada.
    // ───────────────────────────────────────────────────────────
    const proyectoE = await crearProyecto(primePage, 'T9 — recurso no vacío', modelId);
    await prisma.project.update({ where: { id: proyectoE.id }, data: { currentHtml: htmlLimpio('e-ya-existente') } });
    mock.llamadas.length = 0;
    mock.programarRespuesta({ html: htmlLimpio('e-editado'), chunkDelayMs: 5, chunkBytes: 20_000 });

    const turnoE = await enviarTurnoCompleto(primePage, {
      projectId: proyectoE.id,
      threadId: proyectoE.threadId,
      message: 'Armame algo simple (ESCENA-E)',
      modelId,
      speed: 'fast',
      variants: 3,
    });
    assert.equal(turnoE.status, 200, JSON.stringify(turnoE));
    assert.equal(mock.llamadas.length, 1, 'con el recurso ya no vacío, variants:3 se ignora del todo');
    assert.equal(turnoE.eventos.some((e) => e.type === 'variant'), false);
    console.log('✔ escena E: recurso no vacío + prime + variants:3 → 1 sola llamada');

    // ───────────────────────────────────────────────────────────
    // Escena F — POST /api/projects/:id/variant: elige la 3 sobre el
    // proyecto A, y las guardas (404 índice inexistente, 422 índice
    // inválido, 409 turno en curso).
    // ───────────────────────────────────────────────────────────
    const eligeV3 = await primePage.request.post(`${BASE_URL}/api/projects/${proyectoA.id}/variant`, {
      data: { messageId: turnoA.done!.messageId, index: 3 },
    });
    assert.equal(eligeV3.status(), 200, await eligeV3.text());
    const cuerpoV3 = (await eligeV3.json()) as { html: string };
    assert.ok(cuerpoV3.html.includes('data-marca="a-v3"'));

    const proyectoTrasElegir = await proyectoActual(proyectoA.id);
    assert.ok(proyectoTrasElegir.currentHtml.includes('data-marca="a-v3"'), 'currentHtml pasa a ser la versión elegida');

    const mensajeTrasElegir = await prisma.chatMessage.findUniqueOrThrow({
      where: { id: turnoA.done!.messageId as string },
      select: { chosenVariantIndex: true },
    });
    assert.equal(mensajeTrasElegir.chosenVariantIndex, 3);

    const hiloTrasElegir = await leerHilo(primePage, proyectoA.id, proyectoA.threadId);
    assert.equal(hiloTrasElegir.messages.find((m) => m.id === turnoA.done!.messageId)?.chosenVariant, 3);
    console.log('✔ escena F (1/4): elegir la versión 3 swapea currentHtml, persiste, y threads.ts lo refleja');

    // 404: la escena B tiene un índice 2 que nunca se generó.
    const indiceInexistente = await primePage.request.post(`${BASE_URL}/api/projects/${proyectoB.id}/variant`, {
      data: { messageId: turnoB.done!.messageId, index: 2 },
    });
    assert.equal(indiceInexistente.status(), 404, await indiceInexistente.text());
    console.log('✔ escena F (2/4): elegir un índice que nunca se generó → 404');

    // 422: índice fuera del dominio 1|2|3.
    const indiceInvalido = await primePage.request.post(`${BASE_URL}/api/projects/${proyectoA.id}/variant`, {
      data: { messageId: turnoA.done!.messageId, index: 5 },
    });
    assert.equal(indiceInvalido.status(), 422, await indiceInvalido.text());
    console.log('✔ escena F (3/4): índice fuera de 1|2|3 → 422');

    // 409: turno en curso — otro hilo del mismo proyecto con un pedido del
    // docente sin contestar todavía.
    const proyectoInflight = await crearProyecto(primePage, 'T9 — turno en curso', modelId);
    const segundoHilo = await primePage.request.post(`${BASE_URL}/api/projects/${proyectoInflight.id}/threads`, {
      data: {},
    });
    const { thread: hiloNuevo } = (await segundoHilo.json()) as { thread: { id: string } };
    await prisma.chatMessage.create({
      data: { threadId: hiloNuevo.id, role: 'user', content: 'turno que nunca contestó' },
    });
    const conTurnoEnCurso = await primePage.request.post(`${BASE_URL}/api/projects/${proyectoInflight.id}/variant`, {
      data: { messageId: turnoA.done!.messageId, index: 1 },
    });
    assert.equal(conTurnoEnCurso.status(), 409, await conTurnoEnCurso.text());
    console.log('✔ escena F (4/4): un turno en curso en CUALQUIER hilo del proyecto → 409');

    // ───────────────────────────────────────────────────────────
    // Escena G — un deshacer vuelve al recurso de arranque, sin importar
    // qué versión estaba elegida (proyecto A: eligió la 3 en la escena F).
    // ───────────────────────────────────────────────────────────
    const deshacerA = await primePage.request.post(`${BASE_URL}/api/projects/${proyectoA.id}/undo`, {
      data: { messageId: turnoA.done!.messageId },
    });
    assert.equal(deshacerA.status(), 200, await deshacerA.text());
    const proyectoTrasDeshacer = await proyectoActual(proyectoA.id);
    assert.equal(
      proyectoTrasDeshacer.currentHtml,
      DEFAULT_HTML,
      'un deshacer vuelve al recurso de arranque sin importar qué versión estaba elegida (acá, la 3)',
    );
    console.log('✔ escena G: un deshacer devuelve currentHtml al recurso de arranque (deshace TODO el turno)');

    // ───────────────────────────────────────────────────────────
    // Escena H — el próximo turno del proyecto borra los chips y las
    // versiones guardadas del turno viejo.
    // ───────────────────────────────────────────────────────────
    mock.llamadas.length = 0;
    mock.programarRespuesta({ html: htmlLimpio('h-turno-nuevo'), chunkDelayMs: 5, chunkBytes: 20_000 });
    const turnoH = await enviarTurnoCompleto(primePage, {
      projectId: proyectoA.id,
      threadId: proyectoA.threadId,
      message: 'Armame algo simple (ESCENA-H, turno normal)',
      modelId,
      speed: 'fast',
    });
    assert.equal(turnoH.status, 200, JSON.stringify(turnoH));

    const variantesViejasTrasH = await variantesDe(turnoA.done!.messageId as string);
    assert.equal(variantesViejasTrasH.length, 0, 'el turno nuevo borró las versiones guardadas del turno viejo');

    const hiloTrasH = await leerHilo(primePage, proyectoA.id, proyectoA.threadId);
    const mensajeViejoTrasH = hiloTrasH.messages.find((m) => m.id === turnoA.done!.messageId);
    assert.equal(mensajeViejoTrasH?.variants, undefined, 'threads.ts ya no expone versiones para el mensaje viejo');
    console.log('✔ escena H: el turno siguiente borra los chips y las versiones guardadas del turno de versiones viejo');

    // ───────────────────────────────────────────────────────────
    // Escena I — navegador real: toggle, chips pendientes, chips listas,
    // elegir una, y que sobreviva a un reload.
    // ───────────────────────────────────────────────────────────
    const proyectoI = await crearProyecto(primePage, 'T9 — navegador', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuestaCondicional(matchVersion(1), { html: htmlLimpio('i-v1'), chunkDelayMs: 60, chunkBytes: 40 });
    mock.programarRespuestaCondicional(matchVersion(2), { html: htmlLimpio('i-v2'), chunkDelayMs: 60, chunkBytes: 200 });
    mock.programarRespuestaCondicional(matchVersion(3), { html: htmlLimpio('i-v3'), chunkDelayMs: 200, chunkBytes: 200 });

    await primePage.goto(`${BASE_URL}/app/project/${proyectoI.id}`, { waitUntil: 'load' });

    const toggleVersiones = primePage.getByTitle('Varias versiones: arma tres propuestas distintas para que elijas una');
    await toggleVersiones.waitFor({ state: 'visible', timeout: 10_000 });
    await toggleVersiones.click();
    await primePage.screenshot({ path: `${SCREENSHOT_DIR}/1-toggle-on.png` });
    console.log('✔ escena I (1/6): el interruptor está visible en un recurso vacío y se prende (captura 1)');

    const campoMensaje = primePage.locator('textarea[placeholder="Preguntale a Kodu…"]');
    const botonEnviar = primePage.getByRole('button', { name: 'Enviar' });
    await campoMensaje.click();
    await campoMensaje.pressSequentially('Armame algo simple (ESCENA-I, navegador)', { delay: 10 });
    await botonEnviar.click();

    const filaVersiones = primePage.getByRole('group', { name: 'Versiones generadas' });
    await filaVersiones.waitFor({ state: 'visible', timeout: 30_000 });
    await primePage.screenshot({ path: `${SCREENSHOT_DIR}/2-chips-pendientes.png` });
    console.log('✔ escena I (2/6): la fila de chips aparece progresivamente, todavía con alguna pendiente (captura 2)');

    await primePage.waitForFunction(
      () => !document.querySelector('button[type="submit"]')?.hasAttribute('disabled'),
      { timeout: 30_000 },
    );
    await primePage.screenshot({ path: `${SCREENSHOT_DIR}/3-chips-listas.png` });
    console.log('✔ escena I (3/6): el turno terminó, las 3 chips están listas (captura 3)');

    const chip3 = filaVersiones.getByRole('button', { name: '3', exact: true });
    await chip3.click();
    await primePage.waitForTimeout(400); // margen para que la elección viaje y el iframe recargue

    const frenteFrame = (pagina: Page) => pagina.frameLocator('iframe[data-kodu-frente="true"]');
    await frenteFrame(primePage).locator('[data-marca="i-v3"]').waitFor({ state: 'attached', timeout: 10_000 });
    await primePage.screenshot({ path: `${SCREENSHOT_DIR}/4-eligio-version-3.png` });
    console.log('✔ escena I (4/6): elegir la versión 3 swapea la vista previa al instante (captura 4)');

    const proyectoTrasClick = await proyectoActual(proyectoI.id);
    assert.ok(proyectoTrasClick.currentHtml.includes('data-marca="i-v3"'), 'el click también persistió en el servidor');

    await primePage.reload({ waitUntil: 'load' });
    await frenteFrame(primePage).locator('[data-marca="i-v3"]').waitFor({ state: 'attached', timeout: 10_000 });
    const chip3TrasReload = primePage.getByRole('group', { name: 'Versiones generadas' }).getByRole('button', {
      name: '3',
      exact: true,
    });
    await chip3TrasReload.waitFor({ state: 'visible' });
    assert.equal(await chip3TrasReload.getAttribute('aria-pressed'), 'true', 'la elección sobrevive a un reload');
    console.log('✔ escena I (5/6): un reload mantiene los chips y cuál está elegida');

    mock.programarRespuesta({ html: htmlLimpio('i-turno-2'), chunkDelayMs: 5, chunkBytes: 20_000 });
    await campoMensaje.click();
    await campoMensaje.pressSequentially('Otro pedido (ESCENA-I, turno 2)', { delay: 10 });
    await botonEnviar.click();
    await primePage.waitForFunction(
      () => !document.querySelector('button[type="submit"]')?.hasAttribute('disabled'),
      { timeout: 30_000 },
    );
    await primePage.getByRole('group', { name: 'Versiones generadas' }).waitFor({ state: 'detached', timeout: 5_000 });
    console.log('✔ escena I (6/6): el próximo mensaje hace desaparecer la fila de chips en la UI real');

    console.log('\n✔ e2e/t9-varias-versiones.ts: todas las comprobaciones pasaron');
  } finally {
    try {
      const adminContext2 = await browser.newContext();
      const adminPage2 = await adminContext2.newPage();
      await iniciarSesion(adminPage2, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await fijarSettings(adminPage2, {
        primeEnabled: false,
        autoReviewForAll: false,
        deepModeForAll: false,
        versionsForAll: false,
      });
      await adminContext2.close();
      console.log('✔ limpieza: prime y "para todos" apagados');
    } catch (error) {
      console.error('[t9-varias-versiones] no se pudo restaurar el estado al final:', error);
    }

    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
await esperar(0);
console.log('\n✔ e2e/t9-varias-versiones.ts: terminado');
