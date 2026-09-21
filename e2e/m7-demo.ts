import 'dotenv/config';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Locator } from 'playwright';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, conTema, iniciarSesion } from './harness.ts';

/**
 * Verificación de slice M7: modo demo (design.md §8; specs/demo-mode/spec.md).
 *
 * Cubre, en orden:
 *  1. Con el interruptor apagado, /login no tiene ninguna entrada a la demo.
 *  2. Prenderlo la hace aparecer, en los dos temas.
 *  3. Seguir la entrada deja al visitante autenticado como la cuenta
 *     compartida de demo.
 *  4. La demo puede usar la IA (vía el mock local) y lo que genera se marca
 *     `createdByDemo`.
 *  5. Publicarlo a la galería (isInGallery) no le saca la marca.
 *  6. Un SEGUNDO visitante que entra por la misma puerta ve el recurso que
 *     dejó el primero — misma cuenta compartida.
 *  7. El tope de tokens de la demo (independiente del tope por motor) corta
 *     con el mensaje sobrio de invitación, con un link real a /register —
 *     probado en los dos temas, a través de la UI real del chat.
 *  8. Apagar el interruptor: la entrada desaparece, un turno YA en curso
 *     termina normal, el turno SIGUIENTE de la demo queda bloqueado sin
 *     volver a loguearse.
 *  9. El purgado masivo borra sólo lo creado por la demo — un recurso de un
 *     docente real no se toca.
 * 10. La cuenta de demo no aparece en /admin/usuarios (no es un docente).
 *
 * Las mutaciones de `AppSettings` pasan SIEMPRE por `/api/admin/settings`
 * (nunca por Prisma directo): esa ruta invalida la caché de 10s de
 * `settings.ts` en el MISMO proceso que corre `npm run dev` — un
 * `prisma.appSettings.update()` desde este script, que corre en OTRO
 * proceso, dejaría al servidor sirviendo el valor viejo hasta que expire la
 * caché. Mismo motivo para el motor de prueba, dado de alta vía
 * `/api/admin/models` (ver `catalogo.ts`, caché de 30s) — patrón idéntico al
 * de `e2e/m6-acceso.ts`.
 *
 * Corre con: npx tsx e2e/m7-demo.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';

const DOCENTE_REAL_EMAIL = 'docente-e2e-m7-real@kodu.local';
const DOCENTE_REAL_PASSWORD = 'Docente.E2E.2026';

const MARCA_MOTOR_PRUEBA = 'test-m7';
const CORRIDA = randomUUID().slice(0, 8);
const TITULO_RECURSO_DEMO = `Recurso E2E M7 ${CORRIDA}`;
const TITULO_RECURSO_REAL = `Recurso E2E M7 (docente real) ${CORRIDA}`;

const MENSAJE_INVITACION =
  'La demo ya usó todo el crédito de esta ronda. Si querés seguir armando recursos, creá tu cuenta: es gratis y tus recursos quedan guardados.';
const MENSAJE_CERRADA = 'La demo está cerrada por el momento.';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

// ───────────────────────────────────────────────────────────
// Proveedor de IA falso: mismo mecanismo que e2e/m6-acceso.ts, extendido con
// un `usage` configurable para poder escribir consumo real de TokenUsage sin
// depender de contar tokens de verdad.
// ───────────────────────────────────────────────────────────
interface MockProveedor {
  port: number;
  state: { retrasoMs: number; usage: { promptTokens: number; completionTokens: number } | null };
  cerrar: () => Promise<void>;
}

function iniciarMockProveedor(): Promise<MockProveedor> {
  return new Promise((resolve) => {
    const state: MockProveedor['state'] = { retrasoMs: 30, usage: null };
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', async () => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hola, esto es una respuesta de la demo.' } }] })}\n\n`,
        );
        await new Promise((r) => setTimeout(r, state.retrasoMs));

        const finalChunk: Record<string, unknown> = { choices: [{ delta: {}, finish_reason: 'stop' }] };
        if (state.usage) {
          finalChunk.usage = {
            prompt_tokens: state.usage.promptTokens,
            completion_tokens: state.usage.completionTokens,
            prompt_tokens_details: { cached_tokens: 0 },
          };
        }
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ port, state, cerrar: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

async function asegurarDocenteReal(): Promise<string> {
  const docente = await prisma.user.upsert({
    where: { email: DOCENTE_REAL_EMAIL },
    update: { role: 'DOCENTE' },
    create: {
      email: DOCENTE_REAL_EMAIL,
      name: 'Docente Real E2E M7',
      role: 'DOCENTE',
      passwordHash: await hashPassword(DOCENTE_REAL_PASSWORD),
    },
    select: { id: true },
  });
  return docente.id;
}

/** Alterna `AppSettings` vía la API de admin (nunca Prisma directo — ver el comentario de arriba). */
async function fijarSettings(datos: { demoEnabled?: boolean; demoTokenLimit?: number }): Promise<void> {
  const browser = await abrirNavegador();
  try {
    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const respuesta = await page.request.patch(`${BASE_URL}/api/admin/settings`, { data: datos });
    assert.ok(respuesta.ok(), `PATCH /api/admin/settings debe responder 200 (dio ${respuesta.status()})`);
    await contexto.close();
  } finally {
    await browser.close();
  }
}

/**
 * El mismo POST que el botón "Reiniciar la ronda" del panel: mueve
 * `demoCycleStartedAt` a "ahora" sin borrar una sola fila de `TokenUsage`.
 *
 * Va por la API y no por Prisma directo a propósito: el servidor de desarrollo
 * cachea `AppSettings` en proceso y sólo lo invalida desde sus propios
 * endpoints de mutación — una escritura desde este script, que es otro
 * proceso, le dejaría el valor viejo (misma trampa que documenta
 * `e2e/m6-acceso.ts`).
 */
async function reiniciarCicloDemo(): Promise<void> {
  const browser = await abrirNavegador();
  try {
    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const respuesta = await page.request.post(`${BASE_URL}/api/admin/demo/reiniciar`, { data: {} });
    assert.ok(
      respuesta.ok(),
      `POST /api/admin/demo/reiniciar debe responder 200 (dio ${respuesta.status()})`,
    );
    await contexto.close();
  } finally {
    await browser.close();
  }
}

/**
 * "Sigue la entrada": el mismo POST que el `<form>` discreto de login.astro
 * manda. `data: {}` fuerza `Content-Type: application/json` porque
 * `page.request` (a diferencia de un navegador real enviando el <form>) no
 * manda `Origin` en una request sin body — sin esto, `csrf.ts` lo trataría
 * como cross-origin (mismo sorteo de limitación del arnés que ya documenta
 * `e2e/m6-acceso.ts` para sus DELETE).
 */
async function entrarComoDemo(page: import('playwright').Page): Promise<void> {
  const respuesta = await page.request.post(`${BASE_URL}/api/auth/demo`, { data: {} });
  assert.ok(respuesta.ok(), `POST /api/auth/demo debe responder 200 (dio ${respuesta.status()})`);
}

async function esperarHasta(condicion: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (await condicion()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('esperarHasta: la condición nunca se cumplió a tiempo');
}

async function assertTexto(locator: Locator, patron: RegExp): Promise<void> {
  await esperarHasta(async () => {
    const texto = await locator.textContent({ timeout: 1_000 }).catch(() => null);
    return texto !== null && patron.test(texto.trim());
  });
}

async function limpiarEstado(): Promise<void> {
  // Recursos de la demo de ESTA corrida (identificados por título único) —
  // se limpian sin pasar por el purgado, así el script es idempotente aunque
  // la escena de purgado nunca llegue a correr (falla anterior).
  const proyectosDemo = await prisma.project.findMany({
    where: { title: { startsWith: 'Recurso E2E M7 ', contains: CORRIDA } },
    select: { id: true },
  });
  const idsDemo = proyectosDemo.map((p) => p.id);
  if (idsDemo.length > 0) {
    await prisma.chatMessage.deleteMany({ where: { thread: { projectId: { in: idsDemo } } } });
    await prisma.chatThread.deleteMany({ where: { projectId: { in: idsDemo } } });
    await prisma.project.deleteMany({ where: { id: { in: idsDemo } } });
  }

  const docenteReal = await prisma.user.findUnique({ where: { email: DOCENTE_REAL_EMAIL }, select: { id: true } });
  if (docenteReal) {
    await prisma.tokenUsage.deleteMany({ where: { userId: docenteReal.id } });
    await prisma.chatMessage.deleteMany({ where: { thread: { project: { userId: docenteReal.id } } } });
    await prisma.chatThread.deleteMany({ where: { project: { userId: docenteReal.id } } });
    await prisma.project.deleteMany({ where: { userId: docenteReal.id } });
  }
  await prisma.user.deleteMany({ where: { email: DOCENTE_REAL_EMAIL } });

  // El consumo simulado de la demo NO se borra: sumarlo al histórico de la
  // cuenta compartida es justo lo que la cuenta compartida está para hacer, y
  // el costo histórico tiene que sobrevivir.
  //
  // Pero sí hay que reiniciar la RONDA. Ese consumo cuenta contra
  // `demoTokenLimit` mientras siga dentro del ciclo abierto, así que sin esto
  // el script es idempotente dos o tres corridas y después falla para siempre
  // con 429 — que es exactamente lo que pasó: 225.000 tokens acumulados contra
  // un tope de 200.000. Reiniciar la ronda mueve el corte sin perder una sola
  // fila, igual que el botón del panel.
  await reiniciarCicloDemo();

  // Y se restaura lo que un admin configuró (design.md §9): el motor de prueba.
  await prisma.aiModel.deleteMany({ where: { provider: { kind: MARCA_MOTOR_PRUEBA } } });
  await prisma.aiProvider.deleteMany({ where: { kind: MARCA_MOTOR_PRUEBA } });
}

async function main(): Promise<void> {
  await limpiarEstado();

  const mock = await iniciarMockProveedor();
  let motorId = '';

  try {
    // Estado inicial conocido: apagada. No se asume el default de la
    // columna — se fuerza, así el primer chequeo (escena 1) es real.
    await fijarSettings({ demoEnabled: false });

    // ───────────────────────────────────────────────────────────
    // Preparación: motor de prueba (mock local) dado de alta por la API de
    // admin, y el docente real que prueba que el purgado no lo toca.
    // ───────────────────────────────────────────────────────────
    await asegurarDocenteReal();
    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
        const respuestaProveedor = await page.request.post(`${BASE_URL}/api/admin/providers`, {
          data: {
            kind: MARCA_MOTOR_PRUEBA,
            label: MARCA_MOTOR_PRUEBA,
            baseUrl: `http://127.0.0.1:${mock.port}`,
            apiKey: 'clave-de-prueba-m7',
          },
        });
        assert.ok(respuestaProveedor.ok(), `alta de la cuenta de prueba debe responder 200 (${respuestaProveedor.status()})`);
        const { proveedor } = (await respuestaProveedor.json()) as { proveedor: { id: string } };

        const respuesta = await page.request.post(`${BASE_URL}/api/admin/models`, {
          data: {
            providerId: proveedor.id,
            providerModel: 'm7-mock',
            displayName: 'Motor E2E M7 — mock local',
            selectableByTeacher: true,
          },
        });
        assert.ok(respuesta.ok(), `alta del motor de prueba debe responder 200 (${respuesta.status()})`);
        const cuerpo = (await respuesta.json()) as { motor: { id: string } };
        motorId = cuerpo.motor.id;
        await contexto.close();
      } finally {
        await browser.close();
      }
    }
    console.log('✔ preparado: motor de IA de prueba y docente real dados de alta');

    // ───────────────────────────────────────────────────────────
    // 1. Interruptor apagado: /login no tiene ninguna entrada a la demo, en
    //    los dos temas.
    // ───────────────────────────────────────────────────────────
    for (const tema of ['light', 'dark'] as const) {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
        if (tema === 'dark') await conTema(page, 'dark');
        const entrada = page.getByRole('button', { name: /Entrá a la demo/i });
        assert.equal(await entrada.count(), 0, `(${tema}) con la demo apagada, la entrada no debe existir en el DOM`);
        await contexto.close();
      } finally {
        await browser.close();
      }
    }
    console.log('✔ interruptor apagado: /login no muestra ninguna entrada a la demo (2 temas)');

    // ───────────────────────────────────────────────────────────
    // 2. Prenderlo la hace aparecer, discreta, en los dos temas.
    // ───────────────────────────────────────────────────────────
    await fijarSettings({ demoEnabled: true });

    for (const tema of ['light', 'dark'] as const) {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
        if (tema === 'dark') await conTema(page, 'dark');
        const entrada = page.getByRole('button', { name: /Entrá a la demo/i });
        await entrada.waitFor({ state: 'visible' });
        await contexto.close();
      } finally {
        await browser.close();
      }
    }
    console.log('✔ interruptor prendido: /login muestra la entrada discreta a la demo (2 temas)');

    const settingsActivas = await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
    assert.equal(settingsActivas.demoEnabled, true, 'AppSettings.demoEnabled debe quedar en true en la base');

    // ───────────────────────────────────────────────────────────
    // 3. Seguir la entrada deja al visitante autenticado como la cuenta de
    //    demo — una cuenta compartida real, no un stub.
    // ───────────────────────────────────────────────────────────
    const browserPrimerVisitante = await abrirNavegador();
    const contextoPrimero = await browserPrimerVisitante.newContext();
    const primerVisitante = await contextoPrimero.newPage();

    try {
      await entrarComoDemo(primerVisitante);
      console.log('✔ seguir la entrada autentica al visitante');

      const cuentaDemo = await prisma.user.findFirstOrThrow({ where: { isDemo: true } });
      assert.equal(cuentaDemo.role, 'DOCENTE', 'la cuenta de demo tiene que ser un rol DOCENTE ordinario');
      assert.equal(cuentaDemo.aiAccessOverride, true, 'la cuenta de demo entra con un grant explícito, no un atajo');
      console.log('✔ la cuenta compartida de demo existe en la base (isDemo=true, rol DOCENTE)');

      // Exactamente una fila con isDemo=true, aunque se llame a la creación
      // repetidas veces (asegurarCuentaDemo es idempotente + el índice único
      // parcial la protege de todos modos).
      const totalDemo = await prisma.user.count({ where: { isDemo: true } });
      assert.equal(totalDemo, 1, 'tiene que haber a lo sumo una cuenta de demo');

      // ───────────────────────────────────────────────────────────
      // 4. La demo puede usar la IA (mock local) — el turno resuelve, y el
      //    consumo se escribe con SU propio aiModelId/userId.
      // ───────────────────────────────────────────────────────────
      const creado = await primerVisitante.request.post(`${BASE_URL}/api/projects`, {
        data: { title: TITULO_RECURSO_DEMO },
      });
      assert.ok(creado.ok(), `crear un recurso como demo debe dar 200 (dio ${creado.status()})`);
      const { project } = (await creado.json()) as { project: { id: string; threadId: string } };

      await primerVisitante.request.patch(`${BASE_URL}/api/projects/${project.id}`, {
        data: { aiModelId: motorId },
      });

      const filaCreada = await prisma.project.findUniqueOrThrow({
        where: { id: project.id },
        select: { createdByDemo: true, userId: true },
      });
      assert.equal(filaCreada.createdByDemo, true, 'un recurso creado por la demo debe nacer marcado createdByDemo');
      assert.equal(filaCreada.userId, cuentaDemo.id, 'el recurso pertenece a la cuenta compartida de demo');
      console.log('✔ un recurso creado por la demo nace con createdByDemo=true');

      mock.state.usage = { promptTokens: 40_000, completionTokens: 5_000 };
      const turno = await primerVisitante.request.post(`${BASE_URL}/api/chat/stream`, {
        data: {
          projectId: project.id,
          threadId: project.threadId,
          message: '¿Existe algo nuevo hoy?',
          model: motorId,
        },
      });
      assert.equal(turno.status(), 200, `la demo debe poder usar la IA (dio ${turno.status()})`);
      const cuerpoTurno = await turno.text();
      assert.ok(cuerpoTurno.includes('"done"'), 'el turno de la demo debe terminar con su evento "done"');
      console.log('✔ la cuenta de demo puede usar la IA a través del pipeline real de streaming');

      const usoRegistrado = await prisma.tokenUsage.findFirst({
        where: { userId: cuentaDemo.id, aiModelId: motorId },
        orderBy: { createdAt: 'desc' },
      });
      assert.ok(usoRegistrado, 'el turno de la demo debe escribir su propia fila de TokenUsage');
      assert.equal(usoRegistrado!.promptTokens, 40_000);
      assert.equal(usoRegistrado!.completionTokens, 5_000);
      console.log('✔ el consumo de la demo se acumula contra SU propio tope, separado de cualquier otro usuario');

      // ───────────────────────────────────────────────────────────
      // 5. Publicar a la galería no le saca la marca createdByDemo.
      //
      // Este fixture nunca ejercita la captura real del iframe, así que se
      // escribe `screenshotUrl` directo por Prisma antes del PATCH: desde
      // publicacion-likes-y-motores, publicar sin portada da 422 (la
      // invariante del servidor, spec `resource-publishing`).
      // ───────────────────────────────────────────────────────────
      await prisma.project.update({
        where: { id: project.id },
        data: { screenshotUrl: 'https://example.com/demo-cover.png' },
      });

      const publicado = await primerVisitante.request.patch(`${BASE_URL}/api/projects/${project.id}`, {
        data: { isInGallery: true },
      });
      assert.ok(publicado.ok(), 'publicar a la galería debe responder 200');
      const filaPublicada = await prisma.project.findUniqueOrThrow({
        where: { id: project.id },
        select: { isInGallery: true, createdByDemo: true },
      });
      assert.equal(filaPublicada.isInGallery, true);
      assert.equal(filaPublicada.createdByDemo, true, 'publicar no borra la marca de origen');
      console.log('✔ la demo puede publicar a la galería, y el recurso sigue marcado createdByDemo');

      // ───────────────────────────────────────────────────────────
      // 6. Un SEGUNDO visitante, en otro navegador/contexto, entra por la
      //    misma puerta y ve el recurso que dejó el primero: es la MISMA
      //    cuenta, no una nueva por sesión.
      // ───────────────────────────────────────────────────────────
      const browserSegundoVisitante = await abrirNavegador();
      try {
        const contextoSegundo = await browserSegundoVisitante.newContext();
        const segundoVisitante = await contextoSegundo.newPage();
        await entrarComoDemo(segundoVisitante);

        const cuentaDemoOtraVez = await prisma.user.findFirstOrThrow({ where: { isDemo: true } });
        assert.equal(cuentaDemoOtraVez.id, cuentaDemo.id, 'un segundo login a la demo tiene que resolver a la MISMA cuenta');

        await segundoVisitante.goto(`${BASE_URL}/app`, { waitUntil: 'domcontentloaded' });
        await segundoVisitante.getByText(TITULO_RECURSO_DEMO, { exact: true }).waitFor({ timeout: 15_000 });
        console.log('✔ un segundo visitante que entra a la demo ve el recurso que dejó el primero');

        await contextoSegundo.close();
      } finally {
        await browserSegundoVisitante.close();
      }

      // ───────────────────────────────────────────────────────────
      // 7. El tope de tokens de la demo — la única protección real (no hay
      //    rate limiting en este repo) — corta con el mensaje sobrio de
      //    invitación y un link que de verdad funciona. Probado por la UI
      //    real del chat, en los dos temas.
      // ───────────────────────────────────────────────────────────
      await fijarSettings({ demoTokenLimit: 1_000 }); // ya hay 45.000 consumidos arriba: agotado de entrada.

      for (const tema of ['light', 'dark'] as const) {
        await primerVisitante.goto(`${BASE_URL}/app/project/${project.id}`, { waitUntil: 'domcontentloaded' });
        if (tema === 'dark') await conTema(primerVisitante, 'dark');
        await primerVisitante.waitForLoadState('networkidle').catch(() => {});

        // Trampa de la isla `client:load`: el HTML del SSR puede estar en el
        // DOM antes de que React hidrate. Se reintenta el envío completo
        // hasta que la respuesta realmente cambió de estado (el banner de
        // error aparece) — nunca se asume que el primer click alcanzó.
        const banner = primerVisitante.locator('[role="alert"] p');
        await esperarHasta(async () => {
          await primerVisitante.getByPlaceholder('Preguntale a Kodu…').fill('¿Puedo seguir generando?');
          await primerVisitante.getByRole('button', { name: 'Enviar' }).click({ timeout: 2_000 }).catch(() => {});
          const texto = await banner.textContent({ timeout: 1_500 }).catch(() => null);
          return texto !== null && texto.includes(MENSAJE_INVITACION);
        }, 30_000);
        console.log(`✔ (${tema}) tope agotado: mensaje sobrio de invitación, nunca un error crudo`);

        const linkRegistro = primerVisitante.getByRole('link', { name: 'Creá tu cuenta' });
        await linkRegistro.waitFor({ state: 'visible' });
        assert.equal(await linkRegistro.getAttribute('href'), '/register', 'el link tiene que apuntar de verdad a /register');
        console.log(`✔ (${tema}) el link de invitación es un <a href="/register"> real, no sólo texto`);
      }

      await fijarSettings({ demoTokenLimit: 200_000 }); // se repone para las escenas que siguen.

      // ───────────────────────────────────────────────────────────
      // 8. Apagar el interruptor: la entrada desaparece (ya probado en la
      //    forma "prendido" de la escena 2, el negativo es simétrico); un
      //    turno YA EN CURSO no se corta; el turno SIGUIENTE sí queda
      //    bloqueado, sin volver a loguearse — mismo mecanismo que la
      //    revocación de M6 (`e2e/m6-acceso.ts`, escena 7).
      // ───────────────────────────────────────────────────────────
      mock.state.usage = null;
      mock.state.retrasoMs = 1_500;
      const turnoEnCurso = primerVisitante.request.post(`${BASE_URL}/api/chat/stream`, {
        data: {
          projectId: project.id,
          threadId: project.threadId,
          message: '¿Sigue andando esto?',
          model: motorId,
        },
      });

      // Le da tiempo al server a recibir el pedido, pasar el gate (todavía
      // prendido en este instante) y arrancar a leer el mock ANTES de
      // apagar — así el apagado ocurre de verdad a mitad del turno.
      await new Promise((r) => setTimeout(r, 700));
      await fijarSettings({ demoEnabled: false });

      const respuestaEnCurso = await turnoEnCurso;
      assert.equal(
        respuestaEnCurso.status(),
        200,
        `el turno YA en curso no debe cortarse al apagar la demo (dio ${respuestaEnCurso.status()})`,
      );
      const cuerpoEnCurso = await respuestaEnCurso.text();
      assert.ok(cuerpoEnCurso.includes('"done"'), 'el turno en curso tiene que terminar normalmente, con su "done"');
      console.log('✔ apagar la demo a mitad de un turno no lo corta; termina normal');

      mock.state.retrasoMs = 30;
      const proximoTurno = await primerVisitante.request.post(`${BASE_URL}/api/chat/stream`, {
        data: {
          projectId: project.id,
          threadId: project.threadId,
          message: '¿Y ahora?',
          model: motorId,
        },
      });
      assert.equal(proximoTurno.status(), 403, `el turno SIGUIENTE, con la demo apagada, debe bloquearse (dio ${proximoTurno.status()})`);
      const cuerpoProximo = (await proximoTurno.json()) as { error?: string };
      assert.equal(cuerpoProximo.error, MENSAJE_CERRADA, 'el mensaje de bloqueo tiene que ser el literal de design.md');
      console.log('✔ el turno SIGUIENTE, con la demo ya apagada, queda bloqueado — sin volver a loguearse');

      // La entrada de /login desaparece de nuevo con el interruptor apagado.
      await primerVisitante.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
      const entradaApagada = primerVisitante.getByRole('button', { name: /Entrá a la demo/i });
      assert.equal(await entradaApagada.count(), 0, 'con la demo apagada de nuevo, la entrada tiene que desaparecer');
      console.log('✔ apagar el interruptor hace desaparecer la entrada de /login de nuevo');
    } finally {
      await contextoPrimero.close();
      await browserPrimerVisitante.close();
    }

    // ───────────────────────────────────────────────────────────
    // 9. El purgado masivo borra SÓLO lo creado por la demo.
    // ───────────────────────────────────────────────────────────
    const docenteRealId = (
      await prisma.user.findUniqueOrThrow({ where: { email: DOCENTE_REAL_EMAIL }, select: { id: true } })
    ).id;
    const recursoReal = await prisma.project.create({
      data: { userId: docenteRealId, title: TITULO_RECURSO_REAL, slug: `e2e-m7-real-${randomUUID()}` },
      select: { id: true },
    });

    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

        const respuestaConteo = await page.request.get(`${BASE_URL}/api/admin/demo/recursos`);
        assert.ok(respuestaConteo.ok());
        const { cantidad } = (await respuestaConteo.json()) as { cantidad: number };
        assert.ok(cantidad >= 1, 'antes de purgar tiene que haber al menos el recurso de esta corrida');

        const respuestaPurga = await page.request.delete(`${BASE_URL}/api/admin/demo/recursos`, { data: {} });
        assert.ok(respuestaPurga.ok(), `el purgado debe responder 200 (dio ${respuestaPurga.status()})`);
        const { cantidadBorrada } = (await respuestaPurga.json()) as { cantidadBorrada: number };
        assert.ok(cantidadBorrada >= 1, 'el purgado tiene que reportar al menos un recurso borrado');

        await contexto.close();
      } finally {
        await browser.close();
      }
    }

    const proyectoDemoTrasPurga = await prisma.project.findFirst({ where: { title: TITULO_RECURSO_DEMO } });
    assert.equal(proyectoDemoTrasPurga, null, 'el recurso de la demo tiene que haber desaparecido tras el purgado');

    const proyectoRealTrasPurga = await prisma.project.findUnique({ where: { id: recursoReal.id } });
    assert.ok(proyectoRealTrasPurga, 'el recurso de un docente REAL no se tiene que tocar');
    console.log('✔ el purgado masivo borra sólo recursos createdByDemo=true; un recurso real sobrevive');

    // ───────────────────────────────────────────────────────────
    // 10. La cuenta de demo no aparece en /admin/usuarios — tiene su propia
    //     página, listarla ahí confundiría la tabla de docentes.
    // ───────────────────────────────────────────────────────────
    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
        await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        const filaDemo = page.locator('tr', { hasText: 'demo@kodu.local' });
        assert.equal(await filaDemo.count(), 0, 'la cuenta de demo NO tiene que listarse en /admin/usuarios');
        await contexto.close();
      } finally {
        await browser.close();
      }
    }
    console.log('✔ la cuenta de demo no aparece en /admin/usuarios');

    // Refuerzo directo del intento de promoción, sin pasar por la UI: la
    // API tiene que rechazarlo aunque alguien le pegue al endpoint a mano.
    {
      const cuentaDemo = await prisma.user.findFirstOrThrow({ where: { isDemo: true } });
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
        const respuesta = await page.request.patch(`${BASE_URL}/api/admin/users/${cuentaDemo.id}`, {
          data: { role: 'ADMIN' },
        });
        assert.equal(respuesta.status(), 409, `promover a la demo a ADMIN debe rechazarse (dio ${respuesta.status()})`);
        await contexto.close();
      } finally {
        await browser.close();
      }
    }
    console.log('✔ la cuenta de demo no es promovible a ADMIN, ni siquiera pegándole directo al endpoint');

    // ───────────────────────────────────────────────────────────
    // 11. /admin/demo — el panel refleja el estado real, en los dos temas.
    // ───────────────────────────────────────────────────────────
    await fijarSettings({ demoEnabled: true });
    for (const tema of ['light', 'dark'] as const) {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
        await page.goto(`${BASE_URL}/admin/demo`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        if (tema === 'dark') await conTema(page, 'dark');

        const toggle = page.getByRole('checkbox', { name: 'Demo pública' });
        await esperarHasta(async () => (await toggle.isChecked()) === true, 15_000);
        console.log(`✔ (${tema}) /admin/demo refleja el interruptor prendido`);

        await contexto.close();
      } finally {
        await browser.close();
      }
    }
    await fijarSettings({ demoEnabled: false });

    console.log('\n✔ e2e/m7-demo.ts: todos los escenarios pasaron');
  } finally {
    await mock.cerrar();
    // Deja el interruptor apagado y el tope en su valor por defecto — el
    // resto (la cuenta de demo en sí, y su historial de consumo) persiste a
    // propósito: es exactamente el comportamiento que design.md pide.
    await fijarSettings({ demoEnabled: false, demoTokenLimit: 200_000 }).catch(() => {});
    await limpiarEstado();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\n✖ e2e/m7-demo.ts falló:', error);
  process.exitCode = 1;
});
