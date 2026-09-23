import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';

/**
 * Chequeo de navegador de T3 (odd/tasks/modo-prime.md, "Vista previa que se
 * arma mientras la IA escribe"). Requiere la pila de desarrollo levantada
 * (`docker compose up -d db`, `npm run dev` en el puerto 3000) y arranca su
 * PROPIO proveedor simulado (e2e/mock-proveedor.ts) en el puerto
 * `PUERTO_POR_DEFECTO`.
 *
 * Deja en la base de desarrollo un AiProvider + AiModel apuntando al mock
 * (kind "kodu-mock-t3") A PROPÓSITO: T4 en adelante los reusan para no tener
 * que cargar una key real de proveedor en cada chequeo de navegador. Es
 * idempotente — si ya existen (de una corrida anterior), los reusa tal cual.
 *
 * Corre con: npx tsx e2e/t3-vista-previa-progresiva.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-t3@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

/** Cuenta y motor mock que quedan en la base para que otras tareas los reusen. */
const PROVIDER_KIND = 'kodu-mock-t3';
const PROVIDER_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-t3';
const MODEL_DISPLAY_NAME = 'Mock local (T3+)';

const SCREENSHOT_DIR = '/tmp/kodu-t3';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function asegurarDocenteDePrueba(): Promise<void> {
  await prisma.user.upsert({
    where: { email: DOCENTE_EMAIL },
    update: { role: 'DOCENTE' },
    create: {
      email: DOCENTE_EMAIL,
      name: 'Docente E2E T3',
      role: 'DOCENTE',
      passwordHash: await hashPassword(DOCENTE_PASSWORD),
    },
  });
}

/**
 * Cuenta de proveedor + motor apuntando al mock, dados de alta por la API
 * real de admin (no a mano por Prisma): así `invalidarCatalogo()` corre en
 * el MISMO proceso que el server de desarrollo, que es el que tiene el
 * caché de 30s de `src/lib/ai/catalogo.ts` — crear la fila por fuera de la
 * API la dejaría invisible para el servidor hasta que el caché expire solo.
 *
 * Idempotente: si ya existen (de una corrida anterior), los reusa.
 */
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
    console.log(`✔ AiProvider mock creado (${providerId}, baseUrl=${mockUrl})`);
  } else {
    if (proveedorExistente!.baseUrl !== mockUrl) {
      console.warn(
        `⚠ AiProvider mock existente (${providerId}) apunta a "${proveedorExistente!.baseUrl}", no a "${mockUrl}". ` +
          'Si PUERTO_POR_DEFECTO cambió, actualizá la fila a mano (o borrala) antes de confiar en este chequeo.',
      );
    }
    console.log(`✔ AiProvider mock reusado (${providerId})`);
  }

  const modeloExistente = await prisma.aiModel.findFirst({ where: { providerId, providerModel: MODEL_PROVIDER_MODEL } });
  let modelId = modeloExistente?.id ?? null;

  if (!modelId) {
    const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/models`, {
      data: {
        providerId,
        providerModel: MODEL_PROVIDER_MODEL,
        displayName: MODEL_DISPLAY_NAME,
        description: 'Proveedor simulado (e2e/mock-proveedor.ts) para chequeos de navegador. No usar con docentes reales.',
        selectableByTeacher: true,
      },
    });
    assert.equal(respuesta.status(), 200, `alta del motor mock: ${respuesta.status()} ${await respuesta.text()}`);
    const cuerpo = (await respuesta.json()) as { motor: { id: string } };
    modelId = cuerpo.motor.id;
    console.log(`✔ AiModel mock creado (${modelId})`);
  } else {
    console.log(`✔ AiModel mock reusado (${modelId})`);
  }

  return { providerId, modelId };
}

async function main(): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await asegurarDocenteDePrueba();

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  const browser = await abrirNavegador();
  let modeloRotoId: string | null = null;

  try {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const { providerId, modelId } = await asegurarProveedorYMotorMock(adminPage, mock.url);

    const docenteContext = await browser.newContext();
    const page = await docenteContext.newPage();
    await iniciarSesion(page, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    // Proyecto nuevo, apuntado al motor mock directamente por Prisma: no
    // hace falta ejercitar el selector de motor para este chequeo (eso ya
    // lo cubre e2e/m3-motores.ts).
    const creado = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { title: 'T3 — vista previa progresiva' },
    });
    assert.equal(creado.status(), 200, `alta del proyecto: ${creado.status()} ${await creado.text()}`);
    const { project } = (await creado.json()) as { project: { id: string; threadId: string } };
    await prisma.project.update({ where: { id: project.id }, data: { aiModelId: modelId } });
    console.log(`✔ proyecto de prueba creado (${project.id}), motor = mock`);

    // ───────────────────────────────────────────────────────────
    // Escenario 1: generación normal — la vista previa se arma mientras la
    // IA todavía está escribiendo.
    // ───────────────────────────────────────────────────────────
    mock.programarRespuesta({ texto: 'Dale, te armo un quiz de la tabla del 7.' });

    await page.goto(`${BASE_URL}/app/project/${project.id}`, { waitUntil: 'load' });

    // `fill()` no dispara el `onChange` de React acá (probado: el valor
    // queda puesto en el DOM — `inputValue()` lo confirma — pero `draft`
    // en Workspace.tsx nunca se entera, y "Enviar" sigue deshabilitado).
    // `pressSequentially` simula tecla por tecla de verdad y sí lo dispara.
    const campoMensaje = page.locator('textarea[placeholder="Preguntale a Kodu…"]');
    const mensaje = 'Hacé un quiz de la tabla del 7';
    await campoMensaje.click();
    await campoMensaje.pressSequentially(mensaje, { delay: 10 });
    assert.equal(await campoMensaje.inputValue(), mensaje, 'no se pudo escribir el mensaje en el compositor');

    await page.getByRole('button', { name: 'Enviar' }).click();
    console.log('✔ turno enviado');

    const frenteFrame = () => page.frameLocator('iframe[data-kodu-frente="true"]');

    // ANTES del `code` final: el frame visible ya tiene que mostrar algo
    // del documento parcial (T3, punto 5 de la tarea: recién una vez que
    // hay `<body`, con el kit aplicado).
    await frenteFrame().locator('h1').waitFor({ state: 'attached', timeout: 12_000 });
    const h1Parcial = await frenteFrame().locator('h1').textContent();
    assert.ok(h1Parcial?.includes('Practicá'), `esperaba texto del parcial en el <h1>, vino: "${h1Parcial}"`);
    const tituloParcial = await frenteFrame().locator('title').textContent();
    assert.equal(
      tituloParcial,
      'Tabla del 7 — práctica',
      `el <title> del documento parcial tiene que verse ANTES de que termine el turno (vino: "${tituloParcial}")`,
    );
    console.log('✔ vista previa parcial visible ANTES de "code" (title/h1 del documento a medio escribir)');
    await page.screenshot({ path: `${SCREENSHOT_DIR}/1-parcial-temprano.png` });

    // Se deja avanzar (el documento entero tarda ~15-20s en streamear con
    // los tiempos por defecto del mock) y se saca una segunda foto.
    await page.waitForTimeout(7_000);
    const preguntasParcial = await frenteFrame().locator('[data-pregunta]').count();
    console.log(`✔ a los ~7s del envío, el parcial ya tiene ${preguntasParcial} pregunta(s) renderizadas`);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/2-parcial-avanzado.png` });

    // Fin del turno: el compositor se vuelve a habilitar (vuelve a decir
    // "Enviar") recién cuando `isStreaming` pasa a `false`.
    await page.getByRole('button', { name: 'Enviar' }).waitFor({ state: 'visible', timeout: 30_000 });
    console.log('✔ el turno terminó');

    // Vuelve al iframe de siempre (con el puente de captura), con el
    // documento COMPLETO y sus scripts corriendo — el contador "vivo" del
    // HTML de ejemplo tiene que estar avanzando.
    const finalFrame = () => page.frameLocator('iframe[data-kodu-frente="true"]');
    await finalFrame().locator('#kodu-mock-vivo').waitFor({ state: 'attached', timeout: 10_000 });
    await page.waitForTimeout(1_500); // le da tiempo al setInterval de tickear al menos una vez
    const tick = await finalFrame().locator('#kodu-mock-vivo').getAttribute('data-tick');
    assert.ok(
      tick !== null && Number(tick) >= 1,
      `esperaba que el contador "vivo" avanzara (scripts corriendo), data-tick="${tick}"`,
    );
    const h1Final = await finalFrame().locator('h1').textContent();
    assert.ok(h1Final?.includes('Practicá'), 'el documento final tiene que seguir mostrando el mismo recurso, ya completo');
    console.log(`✔ documento final visible, con scripts corriendo (contador "vivo" en data-tick="${tick}")`);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/3-final.png` });

    // ───────────────────────────────────────────────────────────
    // Escenario 2: `code_reset`. Se scriptea que el motor elegido falle con
    // un 500 (no 429: así falla de una, sin los reintentos por saturación)
    // y que el respaldo (el mismo mock) complete el turno. Se traza la
    // secuencia cruda del SSE desde la propia página (ya autenticada, con
    // fetch()) en vez de por la UI: bajo el control de flujo actual de
    // stream.ts ningún parcial visible llega a existir todavía cuando se
    // cambia de motor (el tool call recién arranca con el que SÍ responde),
    // así que lo verificable en este punto es que el servidor manda
    // "code_reset" en el lugar correcto y que el turno igual termina bien
    // — no una limpieza VISUAL de un parcial previo, que hoy no puede
    // llegar a existir ahí (ver el reporte final).
    // ───────────────────────────────────────────────────────────
    const altaRoto = await adminPage.request.post(`${BASE_URL}/api/admin/models`, {
      data: {
        providerId,
        providerModel: 'mock-t3-roto',
        displayName: 'Mock roto (T3, temporal)',
        description: 'Fila temporal para probar el salto de motor de respaldo. Se borra al final de este script.',
        selectableByTeacher: false,
        fallbackModelId: modelId,
      },
    });
    assert.equal(altaRoto.status(), 200, `alta del motor roto: ${altaRoto.status()} ${await altaRoto.text()}`);
    const { motor: motorRoto } = (await altaRoto.json()) as { motor: { id: string } };
    modeloRotoId = motorRoto.id;

    mock.programarRespuesta({ status: 500 });
    mock.programarRespuesta({
      html: '<!DOCTYPE html><html><head><meta name="kodu-tema" content="cuaderno"><title>ok</title></head><body><h1>ok</h1></body></html>',
      chunkBytes: 5_000,
      chunkDelayMs: 5,
    });

    const tipos = await page.evaluate(
      async ({ projectId, threadId, modelId: motorId, mensaje }) => {
        const resp = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, threadId, message: mensaje, model: motorId }),
        });
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const tiposVistos: string[] = [];
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
              tiposVistos.push((JSON.parse(data) as { type: string }).type);
            } catch {
              /* comentario de keepalive u otro fragmento no-JSON: se ignora */
            }
          }
        }
        return tiposVistos;
      },
      { projectId: project.id, threadId: project.threadId, modelId: motorRoto.id, mensaje: 'Hacé otro quiz' },
    );

    assert.ok(tipos.includes('code_reset'), `esperaba un "code_reset" en la secuencia: ${tipos.join(', ')}`);
    assert.ok(tipos.includes('done'), `el turno tiene que terminar igual, con el motor de respaldo: ${tipos.join(', ')}`);
    assert.ok(
      tipos.indexOf('code_reset') < tipos.lastIndexOf('code'),
      `"code_reset" tiene que llegar ANTES del "code" del motor de respaldo: ${tipos.join(', ')}`,
    );
    console.log(`✔ "code_reset" viaja al saltar al motor de respaldo (secuencia: ${tipos.join(' → ')})`);

    console.log(`\n✔ mock: ${mock.llamadas.length} pedidos recibidos en total`);
  } finally {
    if (modeloRotoId) await prisma.aiModel.delete({ where: { id: modeloRotoId } }).catch(() => {});
    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
console.log('\n✔ e2e/t3-vista-previa-progresiva.ts: todas las comprobaciones pasaron');
