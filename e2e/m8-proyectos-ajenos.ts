import 'dotenv/config';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, conTema, iniciarSesion } from './harness.ts';

/**
 * Verificación de slice M8: acceso cruzado de un admin a un recurso ajeno
 * (design.md §7 — "Admin bypass of project ownership";
 * specs/admin-project-access/spec.md).
 *
 * Cubre, en orden:
 *  1. Un ADMIN abre el recurso de OTRO docente, lo prompea (vía el mock
 *     local, mismo mecanismo que e2e/m6-acceso.ts y e2e/m7-demo.ts) y
 *     guarda una edición manual de código — las dos formas de "editar" que
 *     tiene el workspace.
 *  2. El banner de "estás trabajando en un recurso ajeno" se ve en el
 *     recurso ajeno, en los dos temas, y NO aparece en un recurso PROPIO
 *     del mismo admin.
 *  3. La marca de atribución es durable y la ve el dueño: la burbuja del
 *     chat que escribió el admin, y la tarjeta del recurso en /app.
 *  4. Un DOCENTE (ni dueño ni admin) sigue rechazado en los 9 call sites
 *     reales de `findProjectForActor` (el bloque más importante: es la
 *     regresión que un bypass mal alcanzado rompería primero).
 *  5. La cuenta de demo (M7) es un DOCENTE ordinario para este chequeo:
 *     no gana ningún poder cruzado.
 *  6. El enlace desde /admin/usuarios/[id] ahora ABRE el recurso, no
 *     redirige a /app (e2e/m5-usuarios.ts tenía el negativo de esto antes
 *     de M8; se actualizó ahí también).
 *
 * Corre con: npx tsx e2e/m8-proyectos-ajenos.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';

const DOCENTE_PASSWORD = 'Docente.E2E.2026';
const EMAIL_DUENIO = 'docente-e2e-m8-duenio@kodu.local';
const EMAIL_AJENO = 'docente-e2e-m8-ajeno@kodu.local';

const MARCA_MOTOR_PRUEBA = 'test-m8';
const CORRIDA = randomUUID().slice(0, 8);
const TITULO_RECURSO_DUENIO = `Recurso E2E M8 (dueño) ${CORRIDA}`;
const TITULO_RECURSO_ADMIN = `Recurso E2E M8 (admin, propio) ${CORRIDA}`;

const REFUSAL = 'El recurso no existe o no es tuyo.';
const TEXTO_BANNER = 'Estás trabajando en un recurso de';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

// ───────────────────────────────────────────────────────────
// Proveedor de IA falso: mismo mecanismo que e2e/m6-acceso.ts y
// e2e/m7-demo.ts, extendido para devolver un tool call real de
// `update_resource_code` cuando hace falta probar que "prompt the AI"
// genera código de verdad, no sólo texto.
// ───────────────────────────────────────────────────────────
interface MockProveedor {
  port: number;
  state: { html: string | null };
  cerrar: () => Promise<void>;
}

function iniciarMockProveedor(): Promise<MockProveedor> {
  return new Promise((resolve) => {
    const state: MockProveedor['state'] = { html: null };
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', async () => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        if (state.html) {
          // Un solo chunk con el tool call completo: alcanza para probar el
          // camino de "se aplicó código nuevo" sin simular streaming de a
          // pedacitos, que acá no es lo que se está probando.
          res.write(
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          name: 'update_resource_code',
                          arguments: JSON.stringify({ html: state.html }),
                        },
                      },
                    ],
                  },
                },
              ],
            })}\n\n`,
          );
        } else {
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hola, esto es una respuesta de prueba.' } }] })}\n\n`,
          );
        }

        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
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

async function asegurarDocente(email: string, name: string): Promise<string> {
  const docente = await prisma.user.upsert({
    where: { email },
    update: { role: 'DOCENTE' },
    create: { email, name, role: 'DOCENTE', passwordHash: await hashPassword(DOCENTE_PASSWORD) },
    select: { id: true },
  });
  return docente.id;
}

async function crearProyecto(userId: string, titulo: string): Promise<{ id: string; threadId: string }> {
  const proyecto = await prisma.project.create({
    data: {
      title: titulo,
      slug: `e2e-m8-${randomUUID()}`,
      userId,
      threads: { create: { title: 'Conversación' } },
    },
    include: { threads: true },
  });
  return { id: proyecto.id, threadId: proyecto.threads[0]!.id };
}

/** Alterna `AppSettings` vía la API de admin, igual que e2e/m7-demo.ts (nunca Prisma directo). */
async function fijarSettings(datos: { demoEnabled?: boolean }): Promise<void> {
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

async function limpiarEstado(): Promise<void> {
  const proyectos = await prisma.project.findMany({
    where: { title: { contains: CORRIDA } },
    select: { id: true },
  });
  const ids = proyectos.map((p) => p.id);
  if (ids.length > 0) {
    await prisma.chatMessage.deleteMany({ where: { thread: { projectId: { in: ids } } } });
    await prisma.chatThread.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.project.deleteMany({ where: { id: { in: ids } } });
  }

  await prisma.user.deleteMany({ where: { email: { in: [EMAIL_DUENIO, EMAIL_AJENO] } } });
  await prisma.aiModel.deleteMany({ where: { provider: MARCA_MOTOR_PRUEBA } });
}

async function main(): Promise<void> {
  await limpiarEstado();

  const mock = await iniciarMockProveedor();

  try {
    await fijarSettings({ demoEnabled: false });

    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN_EMAIL },
      select: { id: true, name: true },
    });
    const duenioId = await asegurarDocente(EMAIL_DUENIO, 'Docente Dueño E2E M8');
    await asegurarDocente(EMAIL_AJENO, 'Docente Ajeno E2E M8');

    const recursoAjeno = await crearProyecto(duenioId, TITULO_RECURSO_DUENIO);
    const recursoPropioDelAdmin = await crearProyecto(admin.id, TITULO_RECURSO_ADMIN);

    // Motor de prueba (mock local), dado de alta por la API de admin — mismo
    // patrón que e2e/m6-acceso.ts y e2e/m7-demo.ts.
    let motorId = '';
    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
        const respuesta = await page.request.post(`${BASE_URL}/api/admin/models`, {
          data: {
            provider: MARCA_MOTOR_PRUEBA,
            providerModel: 'm8-mock',
            displayName: 'Motor E2E M8 — mock local',
            baseUrl: `http://127.0.0.1:${mock.port}`,
            apiKey: 'clave-de-prueba-m8',
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
    console.log('✔ preparado: docente dueño, docente ajeno, recursos y motor de prueba');

    const browserAdmin = await abrirNavegador();
    const contextoAdmin = await browserAdmin.newContext();
    const pageAdmin = await contextoAdmin.newPage();

    try {
      await iniciarSesion(pageAdmin, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      // ───────────────────────────────────────────────────────────
      // 1. El admin ABRE el recurso ajeno (Playwright real, no sólo la API).
      // ───────────────────────────────────────────────────────────
      await pageAdmin.goto(`${BASE_URL}/app/project/${recursoAjeno.id}`, { waitUntil: 'domcontentloaded' });
      await pageAdmin.waitForSelector('h1');
      assert.equal(
        (await pageAdmin.locator('h1').first().textContent())?.trim(),
        TITULO_RECURSO_DUENIO,
        'el admin tiene que poder ABRIR el recurso ajeno, no rebotar a /app',
      );
      console.log('✔ 1. un admin puede abrir el recurso de otro docente');

      // ───────────────────────────────────────────────────────────
      // 2. El banner se ve, en los dos temas, nombrando al dueño.
      // ───────────────────────────────────────────────────────────
      for (const tema of ['light', 'dark'] as const) {
        if (tema === 'dark') await conTema(pageAdmin, 'dark');
        const banner = pageAdmin.locator('[role="status"]').filter({ hasText: TEXTO_BANNER });
        await banner.waitFor({ state: 'visible' });
        await assertContiene(banner, 'Docente Dueño E2E M8');
        console.log(`✔ 2. (${tema}) el banner de "recurso ajeno" es visible y nombra al dueño`);
      }
      await conTema(pageAdmin, 'light');

      // ───────────────────────────────────────────────────────────
      // Banner AUSENTE en un recurso PROPIO del mismo admin.
      // ───────────────────────────────────────────────────────────
      await pageAdmin.goto(`${BASE_URL}/app/project/${recursoPropioDelAdmin.id}`, {
        waitUntil: 'domcontentloaded',
      });
      await pageAdmin.waitForSelector('h1');
      const bannerEnRecursoPropio = pageAdmin.locator('[role="status"]').filter({ hasText: TEXTO_BANNER });
      assert.equal(
        await bannerEnRecursoPropio.count(),
        0,
        'el banner NO tiene que aparecer en un recurso del propio admin',
      );
      console.log('✔ 2b. el banner NO aparece en un recurso propio del admin');

      // ───────────────────────────────────────────────────────────
      // 3. El admin prompea la IA sobre el recurso ajeno (mock local): se
      //    genera un recurso como lo haría para el dueño, y el turno del
      //    docente (el mensaje "user") queda atribuido al admin — nunca la
      //    respuesta de la IA.
      // ───────────────────────────────────────────────────────────
      const HTML_GENERADO =
        '<!DOCTYPE html><html><body><p>Generado por el admin en un recurso ajeno (M8)</p></body></html>';
      mock.state.html = HTML_GENERADO;

      const turno = await pageAdmin.request.post(`${BASE_URL}/api/chat/stream`, {
        data: {
          projectId: recursoAjeno.id,
          threadId: recursoAjeno.threadId,
          message: 'Cambiá el título del recurso',
          model: motorId,
        },
      });
      assert.equal(turno.status(), 200, `el admin tiene que poder prompear un recurso ajeno (dio ${turno.status()})`);
      const cuerpoTurno = await turno.text();
      assert.ok(cuerpoTurno.includes('"done"'), 'el turno tiene que terminar con su evento "done"');
      assert.ok(cuerpoTurno.includes('"code"'), 'el turno tiene que aplicar código, como lo haría para el dueño');
      console.log('✔ 3. el admin prompea la IA en el recurso ajeno y se genera un recurso de verdad');

      const proyectoTrasElTurno = await prisma.project.findUniqueOrThrow({
        where: { id: recursoAjeno.id },
        select: { currentHtml: true, lastAdminActorId: true, lastAdminActionAt: true },
      });
      assert.equal(proyectoTrasElTurno.currentHtml, HTML_GENERADO, 'el HTML generado tiene que aplicarse de verdad');
      assert.equal(proyectoTrasElTurno.lastAdminActorId, admin.id, 'el Project tiene que marcar al admin actuante');
      assert.ok(proyectoTrasElTurno.lastAdminActionAt, 'lastAdminActionAt tiene que quedar seteado');
      console.log('✔ la marca lastAdminActorId/lastAdminActionAt queda en el Project tras el turno');

      const mensajesDelHilo = await prisma.chatMessage.findMany({
        where: { threadId: recursoAjeno.threadId },
        orderBy: { createdAt: 'asc' },
        select: { role: true, authorUserId: true },
      });
      const mensajeDocente = mensajesDelHilo.find((m) => m.role === 'user');
      const mensajeAsistente = mensajesDelHilo.find((m) => m.role === 'assistant');
      assert.equal(mensajeDocente?.authorUserId, admin.id, 'el mensaje "user" tiene que quedar atribuido al admin');
      assert.equal(
        mensajeAsistente?.authorUserId ?? null,
        null,
        'la respuesta de la IA no la "escribió" nadie: nunca lleva authorUserId',
      );
      console.log('✔ el mensaje del docente (admin) queda atribuido; la respuesta de la IA no');

      // ───────────────────────────────────────────────────────────
      // El admin también guarda una edición MANUAL de código (la otra forma
      // de "editar" que tiene el workspace, sin pasar por la IA).
      // ───────────────────────────────────────────────────────────
      const HTML_EDITADO_A_MANO =
        '<!DOCTYPE html><html><body><p>Editado a mano por el admin (M8)</p></body></html>';
      const antesDeGuardar = proyectoTrasElTurno.lastAdminActionAt!.getTime();
      await new Promise((r) => setTimeout(r, 20)); // asegura un timestamp estrictamente posterior

      const guardado = await pageAdmin.request.patch(`${BASE_URL}/api/projects/${recursoAjeno.id}`, {
        data: { currentHtml: HTML_EDITADO_A_MANO },
      });
      assert.ok(guardado.ok(), `el admin tiene que poder guardar una edición manual (dio ${guardado.status()})`);

      const proyectoTrasElGuardado = await prisma.project.findUniqueOrThrow({
        where: { id: recursoAjeno.id },
        select: { currentHtml: true, lastAdminActorId: true, lastAdminActionAt: true },
      });
      assert.equal(proyectoTrasElGuardado.currentHtml, HTML_EDITADO_A_MANO, 'el PATCH manual tiene que aplicarse');
      assert.equal(proyectoTrasElGuardado.lastAdminActorId, admin.id);
      assert.ok(
        proyectoTrasElGuardado.lastAdminActionAt!.getTime() > antesDeGuardar,
        'la marca se refresca en cada mutación admin, no sólo la primera vez',
      );
      console.log('✔ el admin puede guardar una edición manual de código en el recurso ajeno');

      await contextoAdmin.close();
    } finally {
      await browserAdmin.close();
    }

    // ───────────────────────────────────────────────────────────
    // 4. La marca es durable y la ve el DUEÑO: la burbuja atribuida y la
    //    tarjeta en /app.
    // ───────────────────────────────────────────────────────────
    {
      const browserDuenio = await abrirNavegador();
      try {
        const contextoDuenio = await browserDuenio.newContext();
        const pageDuenio = await contextoDuenio.newPage();
        await iniciarSesion(pageDuenio, { email: EMAIL_DUENIO, password: DOCENTE_PASSWORD });

        await pageDuenio.goto(`${BASE_URL}/app/project/${recursoAjeno.id}`, { waitUntil: 'domcontentloaded' });
        await pageDuenio.waitForSelector('h1');
        const etiquetaAutor = pageDuenio.getByText(`${admin.name} (administración)`);
        await etiquetaAutor.waitFor({ state: 'visible' });
        console.log('✔ 4. el dueño ve, en la burbuja, que ese turno lo escribió el admin');

        // Sin banner: el dueño está en SU PROPIO recurso.
        const bannerParaElDueño = pageDuenio.locator('[role="status"]').filter({ hasText: TEXTO_BANNER });
        assert.equal(await bannerParaElDueño.count(), 0, 'el dueño nunca ve el banner en su propio recurso');

        await pageDuenio.goto(`${BASE_URL}/app`, { waitUntil: 'domcontentloaded' });
        await pageDuenio.waitForLoadState('networkidle').catch(() => {});
        const marcaEnLaTarjeta = pageDuenio.getByText('Editado por administración', { exact: false });
        await marcaEnLaTarjeta.waitFor({ state: 'visible' });
        console.log('✔ la tarjeta del recurso en /app muestra "Editado por administración"');

        await contextoDuenio.close();
      } finally {
        await browserDuenio.close();
      }
    }

    // ───────────────────────────────────────────────────────────
    // 5. Un DOCENTE que NO es ni el dueño ni admin sigue rechazado en TODOS
    //    los call sites reales de findProjectForActor — la regresión que
    //    más importa. `data: {}` en los que no llevan payload real: sin
    //    eso, page.request no manda Origin en un POST/DELETE sin body y
    //    csrf.ts lo trata como cross-origin (mismo hallazgo de e2e/m6 y m7).
    // ───────────────────────────────────────────────────────────
    {
      const browserAjeno = await abrirNavegador();
      try {
        const contextoAjeno = await browserAjeno.newContext();
        const pageAjeno = await contextoAjeno.newPage();
        await iniciarSesion(pageAjeno, { email: EMAIL_AJENO, password: DOCENTE_PASSWORD });

        await assertRechazado(
          'PATCH /api/projects/:id',
          pageAjeno.request.patch(`${BASE_URL}/api/projects/${recursoAjeno.id}`, {
            data: { title: 'Intento ajeno' },
          }),
        );

        await assertRechazado(
          'POST /api/projects/:id/threads',
          pageAjeno.request.post(`${BASE_URL}/api/projects/${recursoAjeno.id}/threads`, { data: {} }),
        );

        await assertRechazado(
          'GET /api/projects/:id/threads',
          pageAjeno.request.get(`${BASE_URL}/api/projects/${recursoAjeno.id}/threads`),
        );

        await assertRechazado(
          'POST /api/projects/:id/screenshot',
          pageAjeno.request.post(`${BASE_URL}/api/projects/${recursoAjeno.id}/screenshot`, { data: {} }),
        );

        await assertRechazado(
          'DELETE /api/projects/:id/screenshot',
          pageAjeno.request.delete(`${BASE_URL}/api/projects/${recursoAjeno.id}/screenshot`, { data: {} }),
        );

        await assertRechazado(
          'POST /api/uploads',
          pageAjeno.request.post(`${BASE_URL}/api/uploads`, {
            multipart: { projectId: recursoAjeno.id },
            headers: { Origin: BASE_URL },
          }),
        );

        await assertRechazado(
          'POST /api/chat/cancel',
          pageAjeno.request.post(`${BASE_URL}/api/chat/cancel`, {
            data: { projectId: recursoAjeno.id, threadId: 'thread-inexistente' },
          }),
        );

        await assertRechazado(
          'POST /api/chat/stream',
          pageAjeno.request.post(`${BASE_URL}/api/chat/stream`, {
            data: { projectId: recursoAjeno.id, threadId: 'thread-inexistente', message: 'hola' },
          }),
        );

        // DELETE al final: si por error NO se hubiera rechazado, mejor que
        // sea la última llamada (no rompe las siete anteriores para nadie
        // que corra esto de nuevo con el mismo recurso).
        await assertRechazado(
          'DELETE /api/projects/:id',
          pageAjeno.request.delete(`${BASE_URL}/api/projects/${recursoAjeno.id}`, { data: {} }),
        );

        const sigueExistiendo = await prisma.project.findUnique({ where: { id: recursoAjeno.id } });
        assert.ok(sigueExistiendo, 'el DELETE rechazado NO tiene que haber borrado el recurso');
        console.log('✔ 5. un docente ajeno queda rechazado en los 9 call sites reales — el recurso sigue intacto');

        await contextoAjeno.close();
      } finally {
        await browserAjeno.close();
      }
    }

    // ───────────────────────────────────────────────────────────
    // 6. La cuenta de demo (M7) es un DOCENTE ordinario para este chequeo:
    //    gana CERO poder cruzado, aunque su aiAccessOverride sea true.
    // ───────────────────────────────────────────────────────────
    await fijarSettings({ demoEnabled: true });
    try {
      const browserDemo = await abrirNavegador();
      try {
        const contextoDemo = await browserDemo.newContext();
        const pageDemo = await contextoDemo.newPage();
        await entrarComoDemo(pageDemo);

        const cuentaDemo = await prisma.user.findFirstOrThrow({ where: { isDemo: true }, select: { role: true } });
        assert.equal(cuentaDemo.role, 'DOCENTE', 'la demo tiene que seguir siendo role DOCENTE, nunca ADMIN');

        await assertRechazado(
          'PATCH /api/projects/:id (demo)',
          pageDemo.request.patch(`${BASE_URL}/api/projects/${recursoAjeno.id}`, { data: { title: 'Intento demo' } }),
        );
        await assertRechazado(
          'POST /api/chat/stream (demo)',
          pageDemo.request.post(`${BASE_URL}/api/chat/stream`, {
            data: { projectId: recursoAjeno.id, threadId: 'thread-inexistente', message: 'hola' },
          }),
        );

        await contextoDemo.close();
      } finally {
        await browserDemo.close();
      }
      console.log('✔ 6. la cuenta de demo no gana ningún poder cruzado sobre recursos ajenos');
    } finally {
      await fijarSettings({ demoEnabled: false });
    }

    // ───────────────────────────────────────────────────────────
    // 7. El enlace desde /admin/usuarios/[id] ahora ABRE el recurso.
    // ───────────────────────────────────────────────────────────
    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
        await page.goto(`${BASE_URL}/admin/usuarios/${duenioId}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('h1');

        const enlace = page.locator(`a[href="/app/project/${recursoAjeno.id}"]`);
        await enlace.waitFor();
        await enlace.click();
        await page.waitForURL(`${BASE_URL}/app/project/${recursoAjeno.id}`, { timeout: 10_000 });
        await page.waitForSelector('h1');
        assert.equal(
          (await page.locator('h1').first().textContent())?.trim(),
          TITULO_RECURSO_DUENIO,
          'el enlace tiene que abrir el recurso de verdad, no rebotar a /app',
        );
        console.log('✔ 7. el enlace de /admin/usuarios/[id] ahora abre el recurso en vez de rebotar a /app');

        await contexto.close();
      } finally {
        await browser.close();
      }
    }

    console.log('\n✔ e2e/m8-proyectos-ajenos.ts: todos los escenarios pasaron');
  } finally {
    await mock.cerrar();
    await fijarSettings({ demoEnabled: false }).catch(() => {});
    await limpiarEstado();
    await prisma.$disconnect();
  }
}

async function assertContiene(locator: import('playwright').Locator, esperado: string): Promise<void> {
  const texto = await locator.textContent();
  assert.ok(texto?.includes(esperado), `se esperaba que el texto incluyera "${esperado}", vino: "${texto}"`);
}

/** Pide una ruta gateada por `findProjectForActor` y confirma el rechazo exacto del spec. */
async function assertRechazado(
  etiqueta: string,
  pedido: Promise<import('playwright').APIResponse>,
): Promise<void> {
  const respuesta = await pedido;
  assert.equal(respuesta.status(), 404, `${etiqueta}: un docente ajeno tiene que recibir 404 (dio ${respuesta.status()})`);
  const cuerpo = (await respuesta.json().catch(() => null)) as { error?: string } | null;
  assert.equal(cuerpo?.error, REFUSAL, `${etiqueta}: el mensaje de rechazo tiene que ser el literal del spec`);
}

main().catch((error) => {
  console.error('\n✖ e2e/m8-proyectos-ajenos.ts falló:', error);
  process.exitCode = 1;
});
