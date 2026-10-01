import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';

/**
 * odd/tasks/ahorro-tokens.md (T4/T5): chequeo de integración de la traza por
 * turno y el feedback del docente contra `src/pages/api/chat/stream.ts`,
 * con `e2e/mock-proveedor.ts` haciendo de motor. Cubre:
 *
 *   1. Generación + ajuste: cada turno deja una fila `AiTrace` (GENERATION /
 *      ADJUSTMENT), vinculada al `ChatMessage` y al `TokenUsage` del turno.
 *   2. Señal implícita (a): un mensaje "no funciona" después del ajuste
 *      marca la traza del turno ANTERIOR como `suspectedDefect`.
 *   3. La carita de feedback, guardada vía `POST /api/projects/:id/feedback`
 *      (la misma ruta que usa la UI).
 *   4. El export de admin (`/api/admin/trazas.json`) trae esas filas
 *      pseudonimizadas — nunca el email del docente.
 *
 * Mismo protocolo crudo (fetch + SSE desde `page.evaluate`) que
 * `e2e/edicion-por-fragmentos.ts`. Requiere la pila de desarrollo levantada
 * en el puerto de `KODU_BASE_URL` (o 3000) contra `DATABASE_URL`.
 *
 * Corre con: npx tsx e2e/feedback-y-trazas.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-feedback@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_KIND = 'kodu-mock-feedback';
const PROVIDER_LABEL = 'Mock local (feedback-y-trazas, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-feedback';
const MODEL_DISPLAY_NAME = 'Mock local (feedback y trazas)';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function asegurarDocenteDePrueba(): Promise<void> {
  await prisma.user.upsert({
    where: { email: DOCENTE_EMAIL },
    update: { role: 'DOCENTE' },
    create: {
      email: DOCENTE_EMAIL,
      name: 'Docente E2E feedback',
      role: 'DOCENTE',
      passwordHash: await hashPassword(DOCENTE_PASSWORD),
    },
  });
}

async function asegurarProveedorYMotorMock(
  adminPage: import('playwright').Page,
  mockUrl: string,
): Promise<{ providerId: string; modelId: string }> {
  const proveedorExistente = await prisma.aiProvider.findFirst({ where: { kind: PROVIDER_KIND } });
  let providerId = proveedorExistente?.id ?? null;

  if (!providerId) {
    const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/providers`, {
      data: { kind: PROVIDER_KIND, label: PROVIDER_LABEL, baseUrl: mockUrl, apiKey: 'clave-de-prueba-del-mock' },
    });
    assert.equal(respuesta.status(), 200, `alta de la cuenta mock: ${respuesta.status()} ${await respuesta.text()}`);
    const cuerpo = (await respuesta.json()) as { proveedor: { id: string } };
    providerId = cuerpo.proveedor.id;
  }

  const modeloExistente = await prisma.aiModel.findFirst({ where: { providerId, providerModel: MODEL_PROVIDER_MODEL } });
  let modelId = modeloExistente?.id ?? null;

  if (!modelId) {
    const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/models`, {
      data: {
        providerId,
        providerModel: MODEL_PROVIDER_MODEL,
        displayName: MODEL_DISPLAY_NAME,
        description: 'Mock de e2e/feedback-y-trazas.ts. No usar con docentes reales.',
        selectableByTeacher: true,
      },
    });
    assert.equal(respuesta.status(), 200, `alta del motor mock: ${respuesta.status()} ${await respuesta.text()}`);
    const cuerpo = (await respuesta.json()) as { motor: { id: string } };
    modelId = cuerpo.motor.id;
  }

  return { providerId, modelId };
}

async function mandarTurno(
  page: import('playwright').Page,
  args: { projectId: string; threadId: string; modelId: string; mensaje: string },
): Promise<{ tipos: string[]; eventos: Record<string, unknown>[] }> {
  return page.evaluate(async ({ projectId, threadId, modelId, mensaje }) => {
    const resp = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, threadId, message: mensaje, model: modelId }),
    });
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const eventos: Record<string, unknown>[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separador = buffer.indexOf('\n\n');
      while (separador !== -1) {
        const crudo = buffer.slice(0, separador);
        buffer = buffer.slice(separador + 2);
        separador = buffer.indexOf('\n\n');
        const data = crudo
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('');
        if (!data || data === '[DONE]') continue;
        try {
          eventos.push(JSON.parse(data) as Record<string, unknown>);
        } catch {
          /* comentario de keepalive: se ignora */
        }
      }
    }
    return { tipos: eventos.map((e) => e.type as string), eventos };
  }, args);
}

async function main(): Promise<void> {
  await asegurarDocenteDePrueba();

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  const browser = await abrirNavegador();

  try {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const { modelId } = await asegurarProveedorYMotorMock(adminPage, mock.url);

    const docenteContext = await browser.newContext();
    const page = await docenteContext.newPage();
    await iniciarSesion(page, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    const creado = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { title: 'T4/T5 — trazas y feedback' },
    });
    assert.equal(creado.status(), 200, `alta del proyecto: ${creado.status()} ${await creado.text()}`);
    const { project } = (await creado.json()) as { project: { id: string; threadId: string } };
    await prisma.project.update({ where: { id: project.id }, data: { aiModelId: modelId } });
    console.log(`✔ proyecto de prueba creado (${project.id})`);

    await page.goto(`${BASE_URL}/app/project/${project.id}`, { waitUntil: 'load' });

    // ───────────────────────────────────────────────────────────
    // Turno 1: generación inicial. Primera generación del recurso -> tiene
    // que traer `feedbackPrompt: 'FUNCIONA'` en el "done" (T5).
    // ───────────────────────────────────────────────────────────
    const htmlInicial =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Quiz</title></head>' +
      '<body>\n  <h1>Título del quiz</h1>\n  <p>Una consigna cualquiera.</p>\n</body></html>';

    mock.programarRespuesta({ texto: 'Dale, armo el quiz.', html: htmlInicial, chunkBytes: 5_000, chunkDelayMs: 5 });

    const turno1 = await mandarTurno(page, {
      projectId: project.id,
      threadId: project.threadId,
      modelId,
      mensaje: 'Hacé un quiz corto',
    });
    assert.ok(turno1.tipos.includes('code'), `turno 1 tiene que traer "code": ${turno1.tipos.join(', ')}`);
    const doneTurno1 = [...turno1.eventos].reverse().find((e) => e.type === 'done') as {
      messageId: string;
      feedbackPrompt?: string;
    };
    assert.equal(doneTurno1.feedbackPrompt, 'FUNCIONA', 'la primera generación tiene que ofrecer la pregunta FUNCIONA');
    console.log('✔ turno 1 (generación): feedbackPrompt = FUNCIONA');

    const trazaTurno1 = await prisma.aiTrace.findUnique({ where: { chatMessageId: doneTurno1.messageId } });
    assert.ok(trazaTurno1, 'turno 1 tiene que haber dejado una AiTrace');
    assert.equal(trazaTurno1!.turnKind, 'GENERATION');
    assert.equal(trazaTurno1!.requestText, 'Hacé un quiz corto');
    assert.ok(trazaTurno1!.tokenUsageId, 'la traza tiene que estar vinculada a un TokenUsage');
    console.log('✔ AiTrace del turno 1: GENERATION, con tokenUsageId y requestText');

    // ───────────────────────────────────────────────────────────
    // Turno 2: ajuste (reescritura completa, sin fragmentos prendidos).
    // ───────────────────────────────────────────────────────────
    const htmlAjustado = htmlInicial.replace('Título del quiz', 'Título ajustado del quiz');
    mock.programarRespuesta({ texto: 'Listo.', html: htmlAjustado, chunkBytes: 5_000, chunkDelayMs: 5 });

    const turno2 = await mandarTurno(page, {
      projectId: project.id,
      threadId: project.threadId,
      modelId,
      mensaje: 'Cambiá el título',
    });
    const doneTurno2 = [...turno2.eventos].reverse().find((e) => e.type === 'done') as { messageId: string };
    assert.ok(doneTurno2.messageId, 'turno 2 tiene que terminar con un messageId');

    const trazaTurno2 = await prisma.aiTrace.findUnique({ where: { chatMessageId: doneTurno2.messageId } });
    assert.ok(trazaTurno2, 'turno 2 tiene que haber dejado una AiTrace');
    assert.equal(trazaTurno2!.turnKind, 'ADJUSTMENT');
    assert.equal(trazaTurno2!.editOutcome, 'FULL');
    console.log('✔ AiTrace del turno 2: ADJUSTMENT, editOutcome FULL');

    // ───────────────────────────────────────────────────────────
    // Turno 3: "no funciona" — señal implícita (a) sobre la traza del
    // turno 2 (el turno ANTERIOR que de verdad cerró). No importa cómo
    // responda el mock a este turno 3, sólo lo que dispara ANTES de
    // llamarlo.
    // ───────────────────────────────────────────────────────────
    mock.programarRespuesta({ texto: 'A ver, lo reviso.', llamarHerramienta: false });

    await mandarTurno(page, {
      projectId: project.id,
      threadId: project.threadId,
      modelId,
      mensaje: 'No funciona, arreglalo',
    });

    const trazaTurno2TrasDefecto = await prisma.aiTrace.findUniqueOrThrow({ where: { id: trazaTurno2!.id } });
    assert.equal(trazaTurno2TrasDefecto.suspectedDefect, true, 'la traza del turno 2 tiene que quedar suspectedDefect');
    assert.equal(trazaTurno2TrasDefecto.suspectedDefectPhrase, 'no funciona');
    console.log('✔ señal implícita (a): turno 2 marcado suspectedDefect = true, frase "no funciona"');

    // ───────────────────────────────────────────────────────────
    // Carita de feedback sobre el turno 1, vía la misma API que usa la UI.
    // ───────────────────────────────────────────────────────────
    const feedback = await page.request.post(`${BASE_URL}/api/projects/${project.id}/feedback`, {
      data: { messageId: doneTurno1.messageId, faceRating: 'GOOD' },
    });
    assert.equal(feedback.status(), 200, `POST feedback: ${feedback.status()} ${await feedback.text()}`);

    const trazaTurno1TrasFeedback = await prisma.aiTrace.findUniqueOrThrow({ where: { id: trazaTurno1!.id } });
    assert.equal(trazaTurno1TrasFeedback.faceRating, 'GOOD');
    console.log('✔ carita de feedback guardada vía POST /api/projects/:id/feedback');

    // ───────────────────────────────────────────────────────────
    // Export de admin: JSON, sin fecha (todo), y nunca el email del docente.
    // ───────────────────────────────────────────────────────────
    const exportResp = await adminPage.request.get(`${BASE_URL}/api/admin/trazas.json`);
    assert.equal(exportResp.status(), 200, `GET trazas.json: ${exportResp.status()}`);
    const textoExport = await exportResp.text();
    assert.ok(!textoExport.includes(DOCENTE_EMAIL), 'el export nunca puede traer el email del docente');

    const filas = JSON.parse(textoExport) as Array<{ traceId: string; userPseudo: string; faceRating: string | null }>;
    const filaTurno1 = filas.find((f) => f.traceId === trazaTurno1!.id);
    const filaTurno2 = filas.find((f) => f.traceId === trazaTurno2!.id);
    assert.ok(filaTurno1, 'el export tiene que incluir la traza del turno 1');
    assert.ok(filaTurno2, 'el export tiene que incluir la traza del turno 2');
    assert.equal(filaTurno1!.faceRating, 'GOOD');
    assert.ok(filaTurno1!.userPseudo.startsWith('docente_'), 'el pseudónimo tiene el prefijo esperado');
    console.log('✔ export de admin: incluye las dos trazas, pseudonimizado, sin email');

    console.log('\nTodas las pruebas pasaron.');
  } finally {
    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
