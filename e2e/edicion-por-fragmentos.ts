import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO, EDIT_RESOURCE_CODE } from './mock-proveedor.ts';

/**
 * odd/tasks/ahorro-tokens.md (T3a): chequeo de integración de
 * `edit_resource_code` contra `src/pages/api/chat/stream.ts`, con
 * `e2e/mock-proveedor.ts` haciendo de motor. Cubre:
 *
 *   1. Un turno de ajuste con el interruptor prendido, donde el mock
 *      responde con `edit_resource_code` y el reemplazo se aplica contra el
 *      HTML real (no contra lo que viajó en el prompt).
 *   2. Una edición que falla (find sin match): el servidor da UNA
 *      oportunidad de recuperación en el mismo turno (reusa el mecanismo de
 *      reintento de `stream.ts`) — acá se scriptea que esa segunda vuelta
 *      caiga a `update_resource_code` con el documento completo, y se
 *      verifica que el turno igual termina con código aplicado y
 *      `editMode = FRAGMENTS_FALLBACK`.
 *
 * Protocolo crudo (fetch + SSE) desde `page.evaluate`, mismo patrón que
 * `e2e/t3-vista-previa-progresiva.ts` — no hace falta UI para esto.
 *
 * Requiere la pila de desarrollo levantada en el puerto de `KODU_BASE_URL`
 * (o 3000 por defecto) contra la base indicada por `DATABASE_URL`.
 *
 * Corre con: npx tsx e2e/edicion-por-fragmentos.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-fragmentos@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_KIND = 'kodu-mock-fragmentos';
const PROVIDER_LABEL = 'Mock local (edicion-por-fragmentos, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-fragmentos';
const MODEL_DISPLAY_NAME = 'Mock local (edición por fragmentos)';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function asegurarDocenteDePrueba(): Promise<void> {
  await prisma.user.upsert({
    where: { email: DOCENTE_EMAIL },
    update: { role: 'DOCENTE' },
    create: {
      email: DOCENTE_EMAIL,
      name: 'Docente E2E edición por fragmentos',
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
        description: 'Mock de e2e/edicion-por-fragmentos.ts. No usar con docentes reales.',
        selectableByTeacher: true,
      },
    });
    assert.equal(respuesta.status(), 200, `alta del motor mock: ${respuesta.status()} ${await respuesta.text()}`);
    const cuerpo = (await respuesta.json()) as { motor: { id: string } };
    modelId = cuerpo.motor.id;
  }

  return { providerId, modelId };
}

/** Manda un turno a `/api/chat/stream` desde el navegador (cookie de sesión
 *  ya cargada) y devuelve la secuencia de eventos SSE digeridos. */
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

    // El interruptor global, prendido para este chequeo (T3a: viene OFF por
    // default en toda base existente — ver la migración).
    const patch = await adminPage.request.patch(`${BASE_URL}/api/admin/settings`, {
      data: { fragmentEditsEnabled: true },
    });
    assert.equal(patch.status(), 200, `prender fragmentEditsEnabled: ${patch.status()} ${await patch.text()}`);
    console.log('✔ fragmentEditsEnabled = true');

    const docenteContext = await browser.newContext();
    const page = await docenteContext.newPage();
    await iniciarSesion(page, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    const creado = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { title: 'T3a — edición por fragmentos' },
    });
    assert.equal(creado.status(), 200, `alta del proyecto: ${creado.status()} ${await creado.text()}`);
    const { project } = (await creado.json()) as { project: { id: string; threadId: string } };
    await prisma.project.update({ where: { id: project.id }, data: { aiModelId: modelId } });
    console.log(`✔ proyecto de prueba creado (${project.id})`);

    // `page.evaluate` necesita un documento con origen propio para que
    // `fetch('/api/...')` resuelva la URL relativa (mismo motivo que
    // `page.goto` antes del `evaluate` en t3-vista-previa-progresiva.ts).
    await page.goto(`${BASE_URL}/app/project/${project.id}`, { waitUntil: 'load' });

    // ───────────────────────────────────────────────────────────
    // Turno 1: generación inicial (recurso en blanco). NUNCA se ofrece
    // `edit_resource_code` acá — se arma con `update_resource_code`, con un
    // <h1> cuyo texto exacto se va a usar como `find` en el turno 2.
    // ───────────────────────────────────────────────────────────
    const htmlInicial =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="kodu-tema" content="cuaderno"><title>Quiz</title></head>' +
      '<body>\n  <h1>Título viejo del quiz</h1>\n  <p>Una consigna cualquiera.</p>\n</body></html>';

    mock.programarRespuesta({ texto: 'Dale, armo el quiz.', html: htmlInicial, chunkBytes: 5_000, chunkDelayMs: 5 });

    const turno1 = await mandarTurno(page, {
      projectId: project.id,
      threadId: project.threadId,
      modelId,
      mensaje: 'Hacé un quiz corto',
    });
    assert.ok(turno1.tipos.includes('code'), `turno 1 (generación) tiene que traer "code": ${turno1.tipos.join(', ')}`);
    assert.ok(turno1.tipos.includes('done'), `turno 1 tiene que terminar: ${turno1.tipos.join(', ')}`);

    const llamadaTurno1 = mock.llamadas[mock.llamadas.length - 1]!.body;
    const toolsTurno1 = (llamadaTurno1.tools as { function: { name: string } }[] | undefined) ?? [];
    assert.ok(
      !toolsTurno1.some((t) => t.function.name === EDIT_RESOURCE_CODE),
      'un recurso NUEVO nunca tiene que ofrecer edit_resource_code',
    );
    console.log('✔ turno 1 (generación): sólo update_resource_code ofrecida, recurso creado');

    // ───────────────────────────────────────────────────────────
    // Turno 2: ajuste exitoso por fragmentos. El mock responde con
    // edit_resource_code reemplazando el <h1> — se verifica que el HTML
    // final tiene el cambio Y conserva intacto el resto del documento
    // (la consigna, que la IA nunca vio en el "find").
    // ───────────────────────────────────────────────────────────
    mock.programarRespuesta({
      texto: 'Listo, cambié el título.',
      herramienta: EDIT_RESOURCE_CODE,
      edits: [{ find: '<h1>Título viejo del quiz</h1>', replace: '<h1>Título nuevo del quiz</h1>' }],
      chunkBytes: 5_000,
      chunkDelayMs: 5,
    });

    const turno2 = await mandarTurno(page, {
      projectId: project.id,
      threadId: project.threadId,
      modelId,
      mensaje: 'Cambiá el título a "Título nuevo del quiz"',
    });
    assert.ok(turno2.tipos.includes('code'), `turno 2 (edición) tiene que traer "code": ${turno2.tipos.join(', ')}`);
    assert.ok(turno2.tipos.includes('done'), `turno 2 tiene que terminar: ${turno2.tipos.join(', ')}`);

    const llamadaTurno2 = mock.llamadas[mock.llamadas.length - 1]!.body;
    const toolsTurno2 = (llamadaTurno2.tools as { function: { name: string } }[] | undefined) ?? [];
    assert.ok(
      toolsTurno2.some((t) => t.function.name === EDIT_RESOURCE_CODE),
      'un turno de AJUSTE con el interruptor prendido tiene que ofrecer edit_resource_code',
    );

    const eventoCodeTurno2 = [...turno2.eventos].reverse().find((e) => e.type === 'code') as { html: string };
    assert.ok(eventoCodeTurno2.html.includes('Título nuevo del quiz'), 'el HTML final tiene que traer el reemplazo');
    assert.ok(!eventoCodeTurno2.html.includes('Título viejo del quiz'), 'el título viejo no puede seguir ahí');
    assert.ok(
      eventoCodeTurno2.html.includes('Una consigna cualquiera.'),
      'el resto del documento (nunca tocado por el edit) tiene que seguir intacto',
    );
    console.log('✔ turno 2 (edición por fragmentos): aplicado contra el HTML real, resto del documento intacto');

    const proyectoTrasTurno2 = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.ok(proyectoTrasTurno2.currentHtml.includes('Título nuevo del quiz'), 'el HTML guardado tiene que reflejar la edición');

    const usageTurno2 = await prisma.tokenUsage.findFirst({
      where: { projectId: project.id, purpose: 'ADJUSTMENT' },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal(usageTurno2?.editMode, 'FRAGMENTS', `TokenUsage.editMode tiene que ser FRAGMENTS (vino: ${usageTurno2?.editMode})`);
    console.log('✔ TokenUsage.editMode = FRAGMENTS');

    // ───────────────────────────────────────────────────────────
    // Turno 3: la edición falla (find sin match) y el servidor da UNA
    // oportunidad de recuperación en el mismo turno — se scriptea que esa
    // segunda vuelta use update_resource_code (caída a reescritura
    // completa). El recurso NUNCA se toca con la primera edición fallida.
    // ───────────────────────────────────────────────────────────
    mock.programarRespuesta({
      texto: 'Te cambio el color.',
      herramienta: EDIT_RESOURCE_CODE,
      edits: [{ find: 'este texto no existe en el documento actual', replace: 'x' }],
      chunkBytes: 5_000,
      chunkDelayMs: 5,
    });
    const htmlRecuperado =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="kodu-tema" content="cuaderno"><title>Quiz</title></head>' +
      '<body>\n  <h1>Título recuperado por rewrite</h1>\n  <p>Una consigna cualquiera.</p>\n</body></html>';
    mock.programarRespuesta({
      texto: 'Listo, lo reescribí entero.',
      html: htmlRecuperado,
      chunkBytes: 5_000,
      chunkDelayMs: 5,
    });

    const htmlAntesDelTurno3 = (await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).currentHtml;

    const turno3 = await mandarTurno(page, {
      projectId: project.id,
      threadId: project.threadId,
      modelId,
      mensaje: 'Poné el título en rojo',
    });

    assert.ok(
      turno3.tipos.includes('notice'),
      `turno 3 tiene que avisar que reintenta la edición fallida: ${turno3.tipos.join(', ')}`,
    );
    assert.ok(turno3.tipos.includes('code'), `turno 3 tiene que terminar con código (recuperado): ${turno3.tipos.join(', ')}`);
    assert.ok(turno3.tipos.includes('done'), `turno 3 tiene que terminar: ${turno3.tipos.join(', ')}`);

    const eventoCodeTurno3 = [...turno3.eventos].reverse().find((e) => e.type === 'code') as { html: string };
    assert.ok(
      eventoCodeTurno3.html.includes('Título recuperado por rewrite'),
      'el turno 3 tiene que terminar con el HTML de la recuperación (rewrite), no con el de la edición fallida',
    );
    assert.notEqual(
      eventoCodeTurno3.html,
      htmlAntesDelTurno3,
      'el recurso SÍ tiene que cambiar al final (vía la recuperación), aunque la edición en sí haya fallado',
    );
    console.log('✔ turno 3 (edición fallida + recuperación): avisó, no perdió el turno, cayó a rewrite completo');

    const usageTurno3 = await prisma.tokenUsage.findFirst({
      where: { projectId: project.id, purpose: 'ADJUSTMENT' },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal(
      usageTurno3?.editMode,
      'FRAGMENTS_FALLBACK',
      `TokenUsage.editMode tiene que ser FRAGMENTS_FALLBACK (vino: ${usageTurno3?.editMode})`,
    );
    console.log('✔ TokenUsage.editMode = FRAGMENTS_FALLBACK');

    console.log(`\n✔ mock: ${mock.llamadas.length} pedidos recibidos en total`);
  } finally {
    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
console.log('\n✔ e2e/edicion-por-fragmentos.ts: todas las comprobaciones pasaron');
