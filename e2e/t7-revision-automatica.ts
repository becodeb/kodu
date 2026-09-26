import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { DEFAULT_HTML } from '../src/lib/projects.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';
import type { BrowserContext, Page } from 'playwright';

/**
 * Chequeo de navegador + API de T7 (odd/tasks/modo-prime.md, "Revisión
 * automática (lint + una corrección) y turnos progresivos"). Requiere la
 * pila de desarrollo levantada (`docker compose up -d db`, `npm run dev` en
 * el puerto 3000) y REUSA el AiProvider/AiModel mock que dejó T3 (kind
 * "kodu-mock-t3", providerModel "mock-t3") — mismo patrón que
 * e2e/t4-deshacer.ts y e2e/t6-velocidad.ts. Pisa el dialecto de
 * razonamiento del mock (como t6) para poder distinguir en los pedidos que
 * recibe el mock la velocidad del turno (A fondo) de la de la corrección
 * (siempre apagada) — y lo restaura al final.
 *
 * Corre con: npx tsx e2e/t7-revision-automatica.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const PRIME_EMAIL = 'docente-e2e-t7-prime@kodu.local';
const PRIME_PASSWORD = 'Docente.E2E.2026';
const NORMAL_EMAIL = 'docente-e2e-t7-normal@kodu.local';
const NORMAL_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_KIND = 'kodu-mock-t3';
const PROVIDER_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-t3';
const MODEL_DISPLAY_NAME = 'Mock local (T3+)';

const SCREENSHOT_DIR = '/tmp/kodu-t7';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────
// HTML de prueba: primer pase con exactamente 3 hallazgos (emojis,
// degradados, iconos_inexistentes — con tema válido para no sumar
// sin_tema y mantener el test enfocado), y su corrección limpia.
// ─────────────────────────────────────────────────────────────

function htmlConHallazgos(marca: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="pizarron">
<title>T7 primer pase</title>
<style>.tarjeta{background:linear-gradient(90deg,#111,#222)}</style>
</head>
<body data-marca="${marca}">
  <h1>Primer pase 🎉</h1>
  <div class="tarjeta"><i data-lucide="icono-inventado-t7"></i> Elegí una opción</div>
</body>
</html>`;
}

function htmlCorregido(marca: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="pizarron">
<title>T7 corregido</title>
</head>
<body data-marca="${marca}-corregido">
  <h1>Recurso corregido</h1>
  <div><i data-lucide="check"></i> Elegí una opción</div>
</body>
</html>`;
}

/** Un único emoji estable, para el escenario "edición sin agregar nada nuevo". */
function htmlConEmoji(marca: string, texto: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="kodu-tema" content="cuaderno"><title>T7</title></head>
<body data-marca="${marca}"><h1>${texto} 🎉</h1></body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// Helpers (mismo patrón que e2e/t4-deshacer.ts y e2e/t6-velocidad.ts)
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
  } else if (!modeloExistente!.selectableByTeacher || !modeloExistente!.enabled) {
    await prisma.aiModel.update({ where: { id: modelId }, data: { selectableByTeacher: true, enabled: true } });
  }

  return modelId;
}

async function fijarSettings(adminPage: Page, datos: Record<string, boolean>): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/settings`, { data: datos });
  assert.ok(respuesta.ok(), `PATCH /api/admin/settings ${JSON.stringify(datos)}: ${respuesta.status()} ${await respuesta.text()}`);
}

async function fijarDialecto(adminPage: Page, modelId: string, datos: Record<string, string | null>): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/models/${modelId}`, { data: datos });
  assert.ok(respuesta.ok(), `PATCH dialecto ${JSON.stringify(datos)}: ${respuesta.status()} ${await respuesta.text()}`);
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

async function cookieHeaderDe(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies(BASE_URL);
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * El mismo turno que manda el navegador, pero por `fetch` crudo con la
 * cookie de sesión — para poder leer los eventos SSE UNO POR UNO a medida
 * que llegan (necesario para el chequeo de "recargar durante la
 * corrección": hay que poder pausar la lectura justo después de `phase` y
 * hacer otra cosa antes de seguir consumiendo el resto del stream).
 */
async function* streamCrudo(cookie: string, payload: Record<string, unknown>): AsyncGenerator<EventoSse> {
  const response = await fetch(`${BASE_URL}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    throw new Error(`streamCrudo: ${response.status} ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separator = buffer.indexOf('\n\n');
    while (separator !== -1) {
      const rawEvent = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf('\n\n');

      const data = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');

      if (!data) continue;
      try {
        yield JSON.parse(data) as EventoSse;
      } catch {
        /* fragmento corrupto: se ignora, igual que hace el cliente real */
      }
    }
  }
}

/** Manda un turno por la API cruda (sin streaming detallado) y devuelve el evento "done". */
async function enviarTurnoPorApi(
  page: Page,
  args: { projectId: string; threadId: string; message: string; modelId: string; speed?: 'fast' | 'deep' },
): Promise<{ status: number; done: EventoSse | null }> {
  const resp = await page.request.post(`${BASE_URL}/api/chat/stream`, {
    data: {
      projectId: args.projectId,
      threadId: args.threadId,
      message: args.message,
      model: args.modelId,
      ...(args.speed ? { speed: args.speed } : {}),
    },
  });
  if (resp.status() !== 200) return { status: resp.status(), done: null };

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
        return JSON.parse(linea) as EventoSse;
      } catch {
        return null;
      }
    })
    .filter((evento): evento is EventoSse => evento !== null);

  return { status: 200, done: eventos.find((e) => e.type === 'done') ?? null };
}

async function main(): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const primeId = await asegurarDocente(PRIME_EMAIL, PRIME_PASSWORD, 'Docente E2E T7 (prime)');
  await asegurarDocente(NORMAL_EMAIL, NORMAL_PASSWORD, 'Docente E2E T7 (normal)');

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
    // "low" para poder distinguir en los pedidos que ve el mock: A fondo
    // (turno principal) tiene que subirlo a "high"; la corrección (T7)
    // tiene que bajarlo a "none" SIEMPRE, sin importar la velocidad del
    // turno — es la prueba concreta de "razonamiento apagado para la
    // corrección" que pide la tarea.
    await fijarDialecto(adminPage, modelId, { reasoningEffort: 'low', reasoningParam: 'reasoning_effort' });
    console.log('✔ dialecto del mock pisado a reasoning_effort/"low"');

    await adminPage.request.patch(`${BASE_URL}/api/admin/users/${primeId}`, { data: { primeAccess: true } });
    console.log('✔ cuenta prime marcada (primeAccess=true)');

    await fijarSettings(adminPage, { primeEnabled: true, autoReviewForAll: false, deepModeForAll: false });

    const primeContext = await browser.newContext();
    const primePage = await primeContext.newPage();
    await iniciarSesion(primePage, { email: PRIME_EMAIL, password: PRIME_PASSWORD });
    const cookiePrime = await cookieHeaderDe(primeContext);

    // ───────────────────────────────────────────────────────────
    // Escena A — A fondo (prime): secuencia SSE exacta, el segundo pedido
    // lleva sólo el mensaje sintético (sin historial), el HTML persistido
    // es el corregido, y un deshacer vuelve al HTML de arranque.
    // ───────────────────────────────────────────────────────────
    const proyectoA = await crearProyecto(primePage, 'T7 — A fondo', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlConHallazgos('a'), chunkDelayMs: 10, chunkBytes: 20_000 });
    mock.programarRespuesta({ texto: '', html: htmlCorregido('a'), chunkDelayMs: 250, chunkBytes: 25 });

    const mensajeOriginal = 'Armame algo simple para probar (ESCENA-A)';
    const eventos: EventoSse[] = [];
    for await (const evento of streamCrudo(cookiePrime, {
      projectId: proyectoA.id,
      threadId: proyectoA.threadId,
      message: mensajeOriginal,
      model: modelId,
      speed: 'deep',
    })) {
      eventos.push(evento);
    }

    // T16 (round 4, "checklist del docente") agrega un `phase: 'planificando'`
    // AL PRINCIPIO de todo turno que crea un recurso nuevo (proyectoA lo es):
    // la secuencia ahora arranca con ese "phase" extra, antes de que exista
    // ningún "code". Se filtra "planificando" acá y se sigue comprobando la
    // secuencia de siempre para el resto — este chequeo es de T7, no de T16.
    const secuencia = eventos
      .filter((e) => (e.type === 'code' || e.type === 'phase' || e.type === 'done') && e.phase !== 'planificando')
      .map((e) => e.type);
    assert.deepEqual(secuencia, ['code', 'phase', 'code', 'done'], `secuencia observada: ${secuencia.join(' → ')}`);
    console.log('✔ escena A (1/6): secuencia SSE exacta code(primero) → phase(revisando) → code(corregido) → done');

    // Mismo criterio: se filtra por el VALOR de la fase ("revisando"), no por
    // la cantidad total de eventos "phase" — así este chequeo de T7 no se
    // rompe cada vez que otra tarea agrega una fase nueva en otro punto del
    // turno (T16: "planificando", antes de esto).
    const eventosFase = eventos.filter((e) => e.type === 'phase' && e.phase === 'revisando');
    assert.equal(eventosFase.length, 1);
    assert.equal(eventosFase[0]!.phase, 'revisando');

    const codesA = eventos.filter((e) => e.type === 'code');
    assert.ok((codesA[0]!.html as string).includes('data-marca="a"'), 'el primer "code" tiene que ser el primer pase');
    assert.ok(!(codesA[0]!.html as string).includes('a-corregido'), 'el primer "code" NO puede ser ya la corrección');
    assert.ok((codesA[1]!.html as string).includes('data-marca="a-corregido"'), 'el segundo "code" tiene que ser la corrección');
    console.log('✔ escena A (2/6): el primer "code" es el primer pase y el segundo ya es la corrección');

    // 3, no 2: T16 agrega su propio pedido de checklist ANTES del primer
    // pase (proyectoA es un recurso nuevo) — checklist(0) + primer pase(1) +
    // corrección(2).
    assert.equal(mock.llamadas.length, 3, 'tres pedidos al mock: checklist + primer pase + corrección');
    const segundoPedido = mock.llamadas[2]!.body as {
      messages: Array<{ role: string; content: string }>;
      tool_choice: unknown;
      reasoning_effort?: string;
    };
    assert.equal(segundoPedido.messages.length, 2, 'sólo system + el mensaje sintético, sin historial');
    assert.equal(segundoPedido.messages[0]!.role, 'system');
    assert.equal(segundoPedido.messages[1]!.role, 'user');
    // T1 ("html-fuera-del-system"): el bloque del recurso actual (el primer
    // pase, `primeraPasada`) va ANTES del preámbulo de la revisión, no en el
    // system prompt — de ahí `includes` y no `startsWith`, y las dos
    // aserciones nuevas que prueban dónde quedó cada cosa.
    assert.ok(
      segundoPedido.messages[1]!.content.startsWith('## Estado actual del recurso'),
      'el mensaje sintético tiene que empezar con el bloque del recurso actual (T1)',
    );
    assert.ok(
      segundoPedido.messages[1]!.content.includes('Revisión automática antes de entregarle el recurso al docente'),
      'el mensaje sintético tiene que llevar el preámbulo esperado, después del bloque del recurso',
    );
    assert.ok(
      segundoPedido.messages[1]!.content.includes('data-marca="a"'),
      'el HTML del primer pase tiene que viajar en el mensaje sintético (T1), no en el system prompt',
    );
    assert.ok(
      !segundoPedido.messages[0]!.content.includes('data-marca="a"'),
      'el HTML del primer pase NO puede viajar en el system prompt',
    );
    assert.ok(/1\.\s/.test(segundoPedido.messages[1]!.content) && /2\.\s/.test(segundoPedido.messages[1]!.content));
    assert.ok(
      !JSON.stringify(segundoPedido.messages).includes('ESCENA-A'),
      'el pedido del docente original NO puede viajar en la corrección',
    );
    assert.deepEqual(segundoPedido.tool_choice, { type: 'function', function: { name: 'update_resource_code' } });
    console.log('✔ escena A (3/6): el segundo pedido lleva el bloque del recurso + el mensaje sintético con los hallazgos, sin historial');

    // mock.llamadas[0] es el pedido de checklist (T16, siempre "fast"/"none"),
    // no el primer pase — ver la nota de arriba.
    const primerPedido = mock.llamadas[1]!.body as { reasoning_effort?: string };
    assert.equal(primerPedido.reasoning_effort, 'high', 'A fondo tiene que subir el razonamiento del primer pase');
    assert.equal(segundoPedido.reasoning_effort, 'none', 'la corrección tiene que ir SIEMPRE con razonamiento apagado');
    console.log('✔ escena A (4/6): razonamiento "high" en el primer pase, "none" en la corrección (mecánica, no creativa)');

    const proyectoTrasA = await prisma.project.findUniqueOrThrow({ where: { id: proyectoA.id } });
    assert.ok(proyectoTrasA.currentHtml.includes('data-marca="a-corregido"'), 'lo persistido tiene que ser la corrección');
    console.log('✔ escena A (5/6): el HTML persistido es el corregido');

    const doneA = eventos.find((e) => e.type === 'done')!;
    const deshacerA = await primePage.request.post(`${BASE_URL}/api/projects/${proyectoA.id}/undo`, {
      data: { messageId: doneA.messageId },
    });
    assert.equal(deshacerA.status(), 200, await deshacerA.text());
    const cuerpoDeshacerA = (await deshacerA.json()) as { currentHtml: string };
    assert.equal(cuerpoDeshacerA.currentHtml, DEFAULT_HTML, 'un solo deshacer tiene que volver al HTML de arranque');
    console.log('✔ escena A (6/6): un deshacer vuelve exacto al HTML de arranque');

    // ───────────────────────────────────────────────────────────
    // Escena B — Rápido con autoReviewForAll apagado: un solo pedido al
    // mock, sin corrección.
    // ───────────────────────────────────────────────────────────
    const proyectoB = await crearProyecto(primePage, 'T7 — Rápido', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlConHallazgos('b'), chunkDelayMs: 10, chunkBytes: 20_000 });
    const resultadoB = await enviarTurnoPorApi(primePage, {
      projectId: proyectoB.id,
      threadId: proyectoB.threadId,
      message: 'Armame algo simple (ESCENA-B)',
      modelId,
      speed: 'fast',
    });
    assert.equal(resultadoB.status, 200);
    // 2, no 1: checklist (T16, corre sin importar la velocidad del turno) +
    // el primer pase — sigue sin haber una TERCERA llamada (ninguna corrección).
    assert.equal(mock.llamadas.length, 2, 'Rápido sin autoReviewForAll no puede sumar una llamada de corrección');
    console.log('✔ escena B: prime + Rápido, autoReviewForAll apagado → checklist + primer pase, sin corrección');

    // ───────────────────────────────────────────────────────────
    // Escena C — docente normal (sin prime) con autoReviewForAll prendido:
    // la corrección SÍ corre.
    // ───────────────────────────────────────────────────────────
    await fijarSettings(adminPage, { primeEnabled: true, autoReviewForAll: true, deepModeForAll: false });

    const normalContext = await browser.newContext();
    const normalPage = await normalContext.newPage();
    await iniciarSesion(normalPage, { email: NORMAL_EMAIL, password: NORMAL_PASSWORD });

    const proyectoC = await crearProyecto(normalPage, 'T7 — para todos', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlConHallazgos('c'), chunkDelayMs: 10, chunkBytes: 20_000 });
    mock.programarRespuesta({ texto: '', html: htmlCorregido('c'), chunkDelayMs: 10, chunkBytes: 20_000 });
    const resultadoC = await enviarTurnoPorApi(normalPage, {
      projectId: proyectoC.id,
      threadId: proyectoC.threadId,
      message: 'Armame algo simple (ESCENA-C)',
      modelId,
      // Un docente sin prime no puede elegir velocidad: el servidor ignora
      // esto por completo. La corrección corre igual, por autoReviewForAll.
      speed: 'deep',
    });
    assert.equal(resultadoC.status, 200);
    // 3, no 2: checklist(0) + primer pase(1) + corrección(2).
    assert.equal(mock.llamadas.length, 3, 'un docente común con autoReviewForAll prendido SÍ recibe la corrección');
    const proyectoTrasC = await prisma.project.findUniqueOrThrow({ where: { id: proyectoC.id } });
    assert.ok(proyectoTrasC.currentHtml.includes('data-marca="c-corregido"'));
    console.log('✔ escena C: docente sin prime + autoReviewForAll → la corrección corre igual');

    // ───────────────────────────────────────────────────────────
    // Escena D — edición de un recurso EXISTENTE que ya tenía un emoji, sin
    // agregar ninguno nuevo: la revisión no dispara una segunda llamada.
    // ───────────────────────────────────────────────────────────
    // La escena C dejó `autoReviewForAll` prendido: se vuelve a apagar acá,
    // si no el turno 1 (Rápido) de esta escena también dispararía una
    // revisión y el punto de partida del turno 2 ya no sería el HTML exacto
    // que programa el mock.
    await fijarSettings(adminPage, { primeEnabled: true, autoReviewForAll: false, deepModeForAll: false });

    const proyectoD = await crearProyecto(primePage, 'T7 — sin nada nuevo', modelId);
    mock.llamadas.length = 0;
    // Turno 1 en Rápido (sin revisión): deja el recurso EXACTO como lo pide
    // el mock, sin que una corrección de este mismo turno complique el
    // punto de partida del turno 2.
    mock.programarRespuesta({ texto: '', html: htmlConEmoji('d', 'Versión original'), chunkDelayMs: 10, chunkBytes: 20_000 });
    await enviarTurnoPorApi(primePage, {
      projectId: proyectoD.id,
      threadId: proyectoD.threadId,
      message: 'Turno 1: creá algo simple (ESCENA-D-1)',
      modelId,
      speed: 'fast',
    });
    // 2, no 1: checklist(0, T16 — turno 1 SÍ es un recurso nuevo) + primer
    // pase(1).
    assert.equal(mock.llamadas.length, 2);

    // Turno 2, A fondo: mismo emoji, otro texto alrededor. Ya NO es un
    // recurso inicial (turno 1 ya lo cambió) — T16 no agrega checklist acá.
    mock.programarRespuesta({ texto: '', html: htmlConEmoji('d', 'Versión con un ajuste chico'), chunkDelayMs: 10, chunkBytes: 20_000 });
    const resultadoD = await enviarTurnoPorApi(primePage, {
      projectId: proyectoD.id,
      threadId: proyectoD.threadId,
      message: 'Turno 2: un ajuste chico, sin agregar nada nuevo (ESCENA-D-2)',
      modelId,
      speed: 'deep',
    });
    assert.equal(resultadoD.status, 200);
    // 3, no 2: checklist(0) + primer pase(1) del turno 1, + el primer pase
    // del turno 2(2) — turno 2 sigue sin sumar una corrección propia (sin
    // checklist, sin hallazgos nuevos).
    assert.equal(mock.llamadas.length, 3, 'turno 2 no puede sumar una llamada de corrección: no introdujo nada nuevo');
    console.log('✔ escena D: editar un recurso que ya tenía un emoji sin agregar otro nuevo → sin corrección');

    // ───────────────────────────────────────────────────────────
    // Escena E — la corrección falla (500 del mock): el primer pase queda
    // y el turno termina OK, sin ningún evento de error.
    // ───────────────────────────────────────────────────────────
    const proyectoE = await crearProyecto(primePage, 'T7 — corrección falla', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlConHallazgos('e'), chunkDelayMs: 10, chunkBytes: 20_000 });
    mock.programarRespuesta({ status: 500 });

    const eventosE: EventoSse[] = [];
    for await (const evento of streamCrudo(cookiePrime, {
      projectId: proyectoE.id,
      threadId: proyectoE.threadId,
      message: 'Armame algo simple (ESCENA-E)',
      model: modelId,
      speed: 'deep',
    })) {
      eventosE.push(evento);
    }

    // 3, no 2: checklist(0) + primer pase(1) + el intento de corrección(2).
    assert.equal(mock.llamadas.length, 3, 'la corrección se intenta igual, aunque falle');
    assert.equal(eventosE.filter((e) => e.type === 'error').length, 0, 'una corrección fallida no puede generar un error visible');
    const doneE = eventosE.find((e) => e.type === 'done');
    assert.ok(doneE, 'el turno tiene que terminar con "done" igual');
    assert.equal(doneE!.codeUpdated, true);
    assert.equal(doneE!.content, 'Actualicé el recurso.', 'el texto del turno sigue siendo el del primer pase');
    const proyectoTrasE = await prisma.project.findUniqueOrThrow({ where: { id: proyectoE.id } });
    assert.ok(proyectoTrasE.currentHtml.includes('data-marca="e"'), 'queda el primer pase, no una versión a medio corregir');
    console.log('✔ escena E: corrección con 500 → primer pase silenciosamente intacto, turno OK, sin error visible');

    // ───────────────────────────────────────────────────────────
    // Escena F — chequeo visual: "Revisando detalles" en pantalla, la vista
    // previa sigue mostrando el primer pase, una recarga en pleno "revisando"
    // también lo muestra, y al terminar se ve la corrección.
    //
    // El "reload" se hace desde una SEGUNDA pestaña (misma sesión, mismas
    // cookies) y NO con `primePage.reload()`: recargar la MISMA pestaña
    // cancela el `fetch()` en curso que abrió React (Workspace.tsx →
    // streamChat), y esa cancelación viaja hasta `request.signal` en el
    // servidor — el mismo mecanismo por el que "si el docente cierra la
    // pestaña a mitad de camino, lo generado hasta ahí queda guardado"
    // (comentario en el `finally` de stream.ts). Aplicado a la corrección
    // de T7, cancelarla ahí es exactamente "el docente canceló" — un caso
    // válido (el primer pase queda, en silencio), pero es OTRO chequeo, no
    // el de "una recarga simplemente MIRA el estado ya persistido sin tocar
    // el turno en curso". Una pestaña nueva lee el mismo proyecto sin pisar
    // el `fetch` de la primera.
    // ───────────────────────────────────────────────────────────
    const proyectoF = await crearProyecto(primePage, 'T7 — visual', modelId);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlConHallazgos('f'), chunkDelayMs: 10, chunkBytes: 20_000 });
    mock.programarRespuesta({ texto: '', html: htmlCorregido('f'), chunkDelayMs: 300, chunkBytes: 20 });

    await primePage.goto(`${BASE_URL}/app/project/${proyectoF.id}`, { waitUntil: 'load' });
    const campoMensaje = primePage.locator('textarea[placeholder="Preguntale a Kodu…"]');
    const botonEnviar = primePage.getByRole('button', { name: 'Enviar' });
    await campoMensaje.click();
    await campoMensaje.pressSequentially('Armame algo simple (ESCENA-F)', { delay: 10 });
    await botonEnviar.click();

    await primePage.getByText('Revisando detalles').waitFor({ timeout: 20_000 });
    const frenteFrame = (pagina: Page) => pagina.frameLocator('iframe[data-kodu-frente="true"]');
    await frenteFrame(primePage).locator('[data-marca="f"]').waitFor({ state: 'attached', timeout: 10_000 });
    await primePage.screenshot({ path: `${SCREENSHOT_DIR}/1-revisando-primer-pase-visible.png` });
    console.log('✔ escena F (1/3): "Revisando detalles" en pantalla, con el primer pase todavía visible');

    // Pestaña nueva, EN PLENO "revisando": tiene que mostrar el primer pase
    // (ya persistido de una), no una pantalla vacía ni la corrección — y el
    // turno de `primePage` sigue corriendo, intacto.
    const segundaPestana = await primeContext.newPage();
    await segundaPestana.goto(`${BASE_URL}/app/project/${proyectoF.id}`, { waitUntil: 'load' });
    await frenteFrame(segundaPestana).locator('[data-marca="f"]').waitFor({ state: 'attached', timeout: 10_000 });
    assert.equal(
      await frenteFrame(segundaPestana).locator('[data-marca="f-corregido"]').count(),
      0,
      'no puede haber saltado a la corrección',
    );
    await segundaPestana.close();
    console.log('✔ escena F (2/3): abrir el proyecto en otra pestaña durante la corrección muestra el primer pase persistido');

    await botonEnviar.waitFor({ state: 'visible', timeout: 30_000 });
    await frenteFrame(primePage).locator('[data-marca="f-corregido"]').waitFor({ state: 'attached', timeout: 10_000 });
    await primePage.screenshot({ path: `${SCREENSHOT_DIR}/2-despues-de-corregir.png` });
    console.log(`✔ escena F (3/3): al terminar se ve la corrección (capturas en ${SCREENSHOT_DIR})`);

    console.log('\n✔ e2e/t7-revision-automatica.ts: todas las comprobaciones pasaron');
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
      await fijarSettings(adminPage2, { primeEnabled: false, autoReviewForAll: false, deepModeForAll: false });
      await adminContext2.close();
      console.log('✔ limpieza: dialecto del mock restaurado; prime y "para todos" apagados');
    } catch (error) {
      console.error('[t7-revision-automatica] no se pudo restaurar el estado al final:', error);
    }

    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
await esperar(0); // deja que las últimas promesas de consola se asienten antes de salir
console.log('\n✔ e2e/t7-revision-automatica.ts: terminado');
