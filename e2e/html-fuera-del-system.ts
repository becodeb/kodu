import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';
import { MARCADOR_SISTEMA_CHECKLIST } from '../src/lib/ai/checklist.ts';
import type { Page } from 'playwright';

/**
 * Prueba de T1 ("html-fuera-del-system", odd/tasks/html-fuera-del-system.md):
 * a través de CUATRO turnos seguidos en el mismo proyecto, donde el HTML
 * cambia en cada uno, se comprueba contra lo que el mock realmente recibió
 * (`mock.llamadas[i].body`) que:
 *
 *   1. El mensaje de sistema es idéntico byte a byte entre turnos del mismo
 *      "régimen" (ambos con la guía de preguntas tempranas, o ambos sin
 *      ella — el cambio de régimen en sí es un comportamiento previo a T1,
 *      no lo que se está probando acá).
 *   2. El mensaje de sistema NUNCA lleva el HTML del recurso.
 *   3. El ÚLTIMO mensaje de usuario de cada pedido SÍ lleva el HTML —
 *      exactamente el que tenía el recurso ANTES de ese turno.
 *   4. Ningún mensaje del historial (ni el de sistema, ni los de turnos
 *      anteriores) lleva HTML: lo persistido en ChatMessage sigue siendo el
 *      texto crudo del docente.
 *
 * Reusa el AiProvider/AiModel mock que dejó T3 (kind "kodu-mock-t3"), mismo
 * patrón que e2e/t7-revision-automatica.ts. Requiere la pila de desarrollo
 * levantada (`docker compose up -d db`, `npm run dev` en el puerto 3000).
 *
 * Corre con: npx tsx e2e/html-fuera-del-system.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-html-fuera-del-system@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_KIND = 'kodu-mock-t3';
const PROVIDER_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-t3';
const MODEL_DISPLAY_NAME = 'Mock local (T3+)';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const MARCA_ESTADO_RECURSO = '## Estado actual del recurso';

function htmlConMarca(marca: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="pizarron">
<title>html-fuera-del-system ${marca}</title>
</head>
<body data-marca="${marca}">
  <h1>Turno ${marca}</h1>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// Helpers (mismo patrón que e2e/t7-revision-automatica.ts)
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
): Promise<{ status: number; done: EventoSse | null }> {
  const resp = await page.request.post(`${BASE_URL}/api/chat/stream`, {
    data: { projectId: args.projectId, threadId: args.threadId, message: args.message, model: args.modelId },
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

interface PedidoMock {
  messages: Array<{ role: string; content: unknown }>;
}

/** T16 (round 4, "checklist del docente"): el turno 1 (`proyecto` es nuevo,
 *  `esRecursoInicial`) manda su propio pedido de checklist ANTES del turno
 *  principal — hay que poder sacarlo de `mock.llamadas` para que
 *  `pedidos[i]` siga significando "el turno i+1", como antes de T16. */
function esPedidoDeChecklist(body: Record<string, unknown>): boolean {
  const mensajes = (body as { messages?: Array<{ role: string; content: unknown }> }).messages;
  const sistema = mensajes?.[0];
  return typeof sistema?.content === 'string' && sistema.content.includes(MARCADOR_SISTEMA_CHECKLIST);
}

async function main(): Promise<void> {
  const docenteId = await asegurarDocente(DOCENTE_EMAIL, DOCENTE_PASSWORD, 'Docente E2E T1 (html-fuera-del-system)');

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  const browser = await abrirNavegador();

  try {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const modelId = await asegurarMotorMock(adminPage, mock.url);
    console.log(`✔ motor mock listo (${modelId})`);

    // Rápido, sin revisión automática ni versiones: UN pedido al mock por
    // turno, para que `mock.llamadas[i]` sea exactamente el turno `i`.
    await fijarSettings(adminPage, { primeEnabled: false, autoReviewForAll: false, deepModeForAll: false });

    const docenteContext = await browser.newContext();
    const docentePage = await docenteContext.newPage();
    await iniciarSesion(docentePage, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    const proyecto = await crearProyecto(docentePage, 'T1 — html fuera del system', modelId);
    mock.llamadas.length = 0;

    // Cuatro turnos, HTML distinto en cada uno. Los primeros dos caen dentro
    // de la ventana de "preguntas tempranas" (turnosPrevios 0 y 1, ambos
    // <= TURNOS_TEMPRANOS); los últimos dos caen afuera (turnosPrevios 2 y
    // 3) — comparar sólo DENTRO de un mismo régimen aísla lo que T1 cambia
    // de lo que ya cambiaba antes (la guía de preguntas desaparece del turno
    // 2 al 3, y eso NO es lo que se está probando acá).
    for (const [indice, marca] of ['t1', 't2', 't3', 't4'].entries()) {
      mock.programarRespuesta({ texto: `Listo, turno ${marca}.`, html: htmlConMarca(marca), chunkDelayMs: 5, chunkBytes: 5_000 });
      const resultado = await enviarTurnoPorApi(docentePage, {
        projectId: proyecto.id,
        threadId: proyecto.threadId,
        message: `Turno ${indice + 1}: armá algo simple (HTML-FUERA-DEL-SYSTEM-${marca.toUpperCase()})`,
        modelId,
      });
      assert.equal(resultado.status, 200, `turno ${marca}: el pedido tiene que responder 200`);
      // T16: el turno 1 (índice 0) es la creación del recurso y suma un
      // pedido de checklist PROPIO además del turno principal — desde ahí
      // en más, el offset de +1 se arrastra igual en cada turno posterior
      // (ninguno de los otros tres es "recurso inicial", así que no suman
      // un checklist propio): total acumulado = índice + 2, no índice + 1.
      assert.equal(
        mock.llamadas.length,
        indice + 2,
        `turno ${marca}: tiene que sumar exactamente un pedido al mock (más el checklist único del turno 1)`,
      );
    }
    console.log('✔ 4 turnos completados, un pedido al mock por turno (más el checklist único del turno 1)');

    // T16: se saca el pedido de checklist para que `pedidos[i]` siga
    // significando "el turno i+1", exactamente como antes de T16.
    const pedidos = mock.llamadas
      .filter((llamada) => !esPedidoDeChecklist(llamada.body))
      .map((llamada) => llamada.body as unknown as PedidoMock);
    assert.equal(pedidos.length, 4, 'después de sacar el checklist, tienen que quedar los 4 turnos principales');

    // ── 1. Mensaje de sistema idéntico byte a byte dentro de cada régimen ──
    assert.equal(pedidos[0]!.messages[0]!.role, 'system');
    assert.equal(
      pedidos[0]!.messages[0]!.content,
      pedidos[1]!.messages[0]!.content,
      'turnos 1 y 2 (ambos con la guía de preguntas tempranas) tienen que llevar el MISMO system prompt',
    );
    assert.equal(
      pedidos[2]!.messages[0]!.content,
      pedidos[3]!.messages[0]!.content,
      'turnos 3 y 4 (ambos sin la guía) tienen que llevar el MISMO system prompt',
    );
    console.log('✔ (1/4) system prompt idéntico byte a byte entre turnos del mismo régimen (cache de prefijo estable)');

    // ── 2. El mensaje de sistema NUNCA lleva el HTML del recurso ───────────
    for (const [i, pedido] of pedidos.entries()) {
      const sistema = pedido.messages[0]!.content as string;
      assert.ok(!sistema.includes(MARCA_ESTADO_RECURSO), `turno ${i + 1}: el system prompt no puede llevar "${MARCA_ESTADO_RECURSO}"`);
      assert.ok(!sistema.includes('data-marca='), `turno ${i + 1}: el system prompt no puede llevar el HTML del recurso`);
    }
    console.log('✔ (2/4) el system prompt nunca lleva el HTML del recurso, en ningún turno');

    // ── 3. El ÚLTIMO mensaje de usuario SÍ lleva el HTML — el de ANTES de ese turno ──
    // Turno 1 arranca con el HTML de arranque del proyecto (sin data-marca);
    // del turno 2 en adelante, cada pedido tiene que llevar el HTML que dejó
    // el turno anterior.
    const marcasEsperadasPorTurno = [null, 't1', 't2', 't3'];
    for (const [i, pedido] of pedidos.entries()) {
      const ultimo = pedido.messages.at(-1)!;
      assert.equal(ultimo.role, 'user', `turno ${i + 1}: el último mensaje tiene que ser del usuario`);
      const contenido = ultimo.content as string;
      assert.ok(contenido.includes(MARCA_ESTADO_RECURSO), `turno ${i + 1}: el último mensaje de usuario tiene que llevar "${MARCA_ESTADO_RECURSO}"`);
      assert.ok(
        contenido.startsWith(MARCA_ESTADO_RECURSO),
        `turno ${i + 1}: el bloque del recurso tiene que ir ANTES del texto del docente`,
      );
      assert.ok(
        contenido.includes(`HTML-FUERA-DEL-SYSTEM-${['t1', 't2', 't3', 't4'][i]!.toUpperCase()}`),
        `turno ${i + 1}: el texto del docente tiene que seguir viajando, después del bloque del recurso`,
      );
      const marcaEsperada = marcasEsperadasPorTurno[i];
      if (marcaEsperada) {
        assert.ok(
          contenido.includes(`data-marca="${marcaEsperada}"`),
          `turno ${i + 1}: tiene que llevar el HTML que dejó el turno anterior (data-marca="${marcaEsperada}")`,
        );
      } else {
        assert.ok(!contenido.includes('data-marca='), 'turno 1: todavía no hay HTML generado por un turno anterior');
      }
    }
    console.log('✔ (3/4) el último mensaje de usuario lleva el bloque del recurso ANTES del texto del docente, con el HTML correcto');

    // ── 4. Nada del historial (ni mensajes previos, ni persistido) lleva HTML ──
    for (const [i, pedido] of pedidos.entries()) {
      const historial = pedido.messages.slice(1, -1); // sin system, sin el turno actual
      for (const entrada of historial) {
        const texto = entrada.content as string;
        assert.ok(!texto.includes('data-marca='), `turno ${i + 1}: un mensaje del historial no puede llevar HTML`);
        assert.ok(!texto.includes(MARCA_ESTADO_RECURSO), `turno ${i + 1}: un mensaje del historial no puede llevar el bloque del recurso`);
      }
    }

    const mensajesPersistidos = await prisma.chatMessage.findMany({
      where: { threadId: proyecto.threadId, role: 'user' },
      orderBy: { createdAt: 'asc' },
      select: { content: true },
    });
    assert.equal(mensajesPersistidos.length, 4);
    for (const [i, fila] of mensajesPersistidos.entries()) {
      assert.ok(!fila.content.includes(MARCA_ESTADO_RECURSO), `el mensaje persistido del turno ${i + 1} no puede llevar el bloque del recurso`);
      assert.ok(!fila.content.includes('data-marca='), `el mensaje persistido del turno ${i + 1} no puede llevar HTML`);
      assert.equal(
        fila.content,
        `Turno ${i + 1}: armá algo simple (HTML-FUERA-DEL-SYSTEM-${['t1', 't2', 't3', 't4'][i]!.toUpperCase()})`,
        `el mensaje persistido del turno ${i + 1} tiene que ser EXACTO el texto crudo del docente`,
      );
    }
    console.log('✔ (4/4) el historial (en vivo y persistido) nunca lleva HTML: sólo el texto crudo del docente');

    console.log('\n✔ e2e/html-fuera-del-system.ts: todas las comprobaciones pasaron');
  } finally {
    // Mismo criterio que e2e/t7-revision-automatica.ts: no se borra el
    // proyecto/hilo de prueba (queda como cualquier otro dato de e2e en la
    // base de desarrollo), sólo se apaga lo que se prendió para el chequeo.
    try {
      const adminContext2 = await browser.newContext();
      const adminPage2 = await adminContext2.newPage();
      await iniciarSesion(adminPage2, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await fijarSettings(adminPage2, { primeEnabled: false, autoReviewForAll: false, deepModeForAll: false });
      await adminContext2.close();
    } catch (error) {
      console.error('[html-fuera-del-system] no se pudo restaurar settings al final:', error);
    }
    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
console.log('\n✔ e2e/html-fuera-del-system.ts: terminado');
