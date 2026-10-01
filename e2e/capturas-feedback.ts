import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';

/**
 * odd/tasks/ahorro-tokens.md (T5): capturas de pantalla (desktop + mobile)
 * con la carita de feedback Y la pregunta inline visibles a la vez — las
 * dos aparecen juntas bajo el mensaje de la primera generación de un
 * recurso. Script de un solo uso, no parte de la batería de e2e normal.
 *
 * Corre con: npx tsx e2e/capturas-feedback.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-capturas@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_KIND = 'kodu-mock-capturas';
const PROVIDER_LABEL = 'Mock local (capturas-feedback, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-capturas';
const MODEL_DISPLAY_NAME = 'Mock local (capturas feedback)';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  await prisma.user.upsert({
    where: { email: DOCENTE_EMAIL },
    update: { role: 'DOCENTE' },
    create: {
      email: DOCENTE_EMAIL,
      name: 'Docente E2E capturas',
      role: 'DOCENTE',
      passwordHash: await hashPassword(DOCENTE_PASSWORD),
    },
  });

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  const browser = await abrirNavegador();

  try {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const proveedorExistente = await prisma.aiProvider.findFirst({ where: { kind: PROVIDER_KIND } });
    let providerId = proveedorExistente?.id ?? null;
    if (!providerId) {
      const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/providers`, {
        data: { kind: PROVIDER_KIND, label: PROVIDER_LABEL, baseUrl: mock.url, apiKey: 'clave-de-prueba-del-mock' },
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
          description: 'Mock de e2e/capturas-feedback.ts. No usar con docentes reales.',
          selectableByTeacher: true,
        },
      });
      assert.equal(respuesta.status(), 200, `alta del motor mock: ${respuesta.status()} ${await respuesta.text()}`);
      modelId = ((await respuesta.json()) as { motor: { id: string } }).motor.id;
    }

    const docenteContext = await browser.newContext();
    const page = await docenteContext.newPage();
    await iniciarSesion(page, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    const creado = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { title: 'Capturas — carita y pregunta' },
    });
    assert.equal(creado.status(), 200, `alta del proyecto: ${creado.status()} ${await creado.text()}`);
    const { project } = (await creado.json()) as { project: { id: string; threadId: string } };
    await prisma.project.update({ where: { id: project.id }, data: { aiModelId: modelId } });

    const htmlInicial =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Quiz</title></head>' +
      '<body>\n  <h1>Título del quiz</h1>\n  <p>Una consigna cualquiera para el aula.</p>\n</body></html>';
    mock.programarRespuesta({ texto: 'Listo, armé el quiz.', html: htmlInicial, chunkBytes: 5_000, chunkDelayMs: 5 });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE_URL}/app/project/${project.id}`, { waitUntil: 'load' });

    await page.evaluate(
      async ({ projectId, threadId, modelId: m }) => {
        const resp = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, threadId, message: 'Hacé un quiz corto', model: m }),
        });
        const reader = resp.body!.getReader();
        for (;;) {
          const { done } = await reader.read();
          if (done) break;
        }
      },
      { projectId: project.id, threadId: project.threadId, modelId },
    );

    // El turno ya terminó (el fetch de arriba esperó el stream completo) —
    // alcanza con recargar para que el chat traiga la carita y la pregunta
    // desde `project/[id].astro`, igual que al reabrir el proyecto.
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('text=¿Funciona bien?', { timeout: 15_000 });

    // Chromium headless clampea la altura real del viewport a ~500px sin
    // importar lo que se pida acá (trampa conocida) — `fullPage: true`
    // evita depender de esa altura: captura todo el documento, carita y
    // pregunta incluidas, sin importar dónde caiga el corte del viewport.
    await page.screenshot({ path: 'experimentos/feedback-capturas/desktop-1280x800.png', fullPage: true });
    console.log('✔ captura desktop guardada');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'experimentos/feedback-capturas/mobile-390.png', fullPage: true });
    console.log('✔ captura mobile guardada');

    console.log('\nListo.');
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
