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
 * Verificación de slice M6: acceso a la IA por dominio (en la base, no en el
 * env), con permiso individual de admin encima (design.md §10;
 * specs/ai-access-control/spec.md; specs/app-settings/spec.md).
 *
 * Cubre, en orden:
 *  1. Registro y login abiertos a cualquier dominio (ya no gatean).
 *  2. Bloqueo del USO de la IA para un dominio no autorizado, con el mensaje
 *     legible del spec.
 *  3. Un grant de admin habilita a ese mismo usuario.
 *  4. Una revocación bloquea a un usuario de un dominio SÍ autorizado.
 *  5. Lista vacía = todo el mundo puede usar la IA.
 *  6. El comodín `*.edu.ar` matchea un subdominio.
 *  7. Una revocación NO corta un turno ya en curso; sólo el próximo.
 *  8. UI de `/admin/dominios` (alta, baja, copy vacío/no-vacío), 2 temas.
 *  9. UI de `/admin/usuarios`: columna de 3 estados + menú, 2 temas.
 *
 * Las mutaciones de `AuthorizedDomain` pasan SIEMPRE por
 * `/api/admin/domains` (nunca por Prisma directo): esa ruta invalida la
 * caché de 10s de `domains.ts` en el MISMO proceso que corre el server de
 * `npm run dev` — un `prisma.authorizedDomain.create()` desde este script,
 * que corre en OTRO proceso, dejaría al servidor sirviendo la lista vieja
 * hasta que expire la caché. Mismo motivo para crear el motor de prueba vía
 * `/api/admin/models` en vez de `prisma.aiModel.create()` directo (ver
 * `catalogo.ts`, caché de 30s).
 *
 * Corre con: npx tsx e2e/m6-acceso.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';

const DOCENTE_PASSWORD = 'Docente.E2E.2026';

/** Dominio que SÍ va a estar en la lista blanca durante el test. */
const DOMINIO_LISTADO = 'escuela-e2e-m6.edu.ar';
/** Comodín: matchea cualquier subdominio de "edu.ar", no el propio "edu.ar". */
const DOMINIO_COMODIN = '*.edu.ar';

const EMAIL_NO_LISTADO = 'docente-e2e-m6-no-listado@afuera-m6.com';
const EMAIL_LISTADO = `docente-e2e-m6-listado@${DOMINIO_LISTADO}`;
const EMAIL_COMODIN = 'docente-e2e-m6-comodin@sub.edu.ar';
const EMAIL_VACIA = 'docente-e2e-m6-vacia@sin-restriccion-m6.com';
const EMAIL_INSTREAM = 'docente-e2e-m6-instream@sin-restriccion-m6.com';
const EMAIL_MENU = 'docente-e2e-m6-menu@sin-restriccion-m6.com';

const TODOS_LOS_EMAILS = [
  EMAIL_NO_LISTADO,
  EMAIL_LISTADO,
  EMAIL_COMODIN,
  EMAIL_VACIA,
  EMAIL_INSTREAM,
  EMAIL_MENU,
];

const REFUSAL = 'Tu cuenta todavía no tiene habilitado el uso de la IA. Escribinos y lo vemos.';
const MARCA_MOTOR_PRUEBA = 'test-m6';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

// ───────────────────────────────────────────────────────────
// Proveedor de IA falso: un server HTTP local que habla el mismo dialecto
// SSE que `provider.ts` espera (`readCompletionStream`). El mensaje de
// prueba es SIEMPRE una pregunta ("¿…?"), así `pideCambio()` en stream.ts
// da `false` y nunca se fuerza el tool call `update_resource_code` — el
// mock sólo necesita mandar texto, no ensamblar un tool call válido.
// ───────────────────────────────────────────────────────────
interface MockProveedor {
  port: number;
  state: { retrasoMs: number };
  cerrar: () => Promise<void>;
}

function iniciarMockProveedor(): Promise<MockProveedor> {
  return new Promise((resolve) => {
    const state = { retrasoMs: 30 };
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', async () => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hola, ' } }] })}\n\n`);
        await new Promise((r) => setTimeout(r, state.retrasoMs));
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'esto sigue en curso.' } }] })}\n\n`,
        );
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

async function asegurarDocenteListo(email: string, opts: { role?: 'DOCENTE' | 'ADMIN' } = {}) {
  return prisma.user.upsert({
    where: { email },
    update: { role: opts.role ?? 'DOCENTE', aiAccessOverride: null },
    create: {
      email,
      name: `Docente ${email.split('@')[0]}`,
      role: opts.role ?? 'DOCENTE',
      passwordHash: await hashPassword(DOCENTE_PASSWORD),
    },
    select: { id: true },
  });
}

async function crearProyectoConHilo(userId: string): Promise<{ projectId: string; threadId: string }> {
  const project = await prisma.project.create({
    data: { userId, title: 'Recurso E2E M6', slug: `e2e-m6-${randomUUID()}` },
    select: { id: true },
  });
  const thread = await prisma.chatThread.create({
    data: { projectId: project.id, title: 'Hilo E2E M6' },
    select: { id: true },
  });
  return { projectId: project.id, threadId: thread.id };
}

async function limpiarEstado(): Promise<void> {
  const usuarios = await prisma.user.findMany({
    where: { email: { in: TODOS_LOS_EMAILS } },
    select: { id: true },
  });
  const ids = usuarios.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.tokenUsage.deleteMany({ where: { userId: { in: ids } } });
    await prisma.chatMessage.deleteMany({ where: { thread: { project: { userId: { in: ids } } } } });
    await prisma.chatThread.deleteMany({ where: { project: { userId: { in: ids } } } });
    await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { in: TODOS_LOS_EMAILS } } });
  await prisma.aiModel.deleteMany({ where: { provider: MARCA_MOTOR_PRUEBA } });
  await prisma.authorizedDomain.deleteMany({ where: { pattern: { in: [DOMINIO_LISTADO, DOMINIO_COMODIN] } } });
}

async function assertTexto(locator: Locator, patron: RegExp): Promise<void> {
  await esperarHasta(async () => {
    const texto = await locator.textContent({ timeout: 1_000 }).catch(() => null);
    return texto !== null && patron.test(texto.trim());
  });
}

async function esperarHasta(condicion: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (await condicion()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('esperarHasta: la condición nunca se cumplió a tiempo');
}

async function main(): Promise<void> {
  await limpiarEstado();

  const mock = await iniciarMockProveedor();

  try {
    // ───────────────────────────────────────────────────────────
    // Motor de prueba, dado de alta por la API de admin (para que
    // `catalogo.ts` lo vea sin esperar los 30s de su caché).
    // ───────────────────────────────────────────────────────────
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
            providerModel: 'm6-mock',
            displayName: 'Motor E2E M6 — mock local',
            baseUrl: `http://127.0.0.1:${mock.port}`,
            apiKey: 'clave-de-prueba-m6',
            selectableByTeacher: false,
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
    console.log('✔ preparado: motor de IA de prueba dado de alta por la API de admin');

    // ───────────────────────────────────────────────────────────
    // Dominio autorizado + comodín, dados de alta por la API de admin.
    // ───────────────────────────────────────────────────────────
    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

        const respuestaListado = await page.request.post(`${BASE_URL}/api/admin/domains`, {
          data: { pattern: DOMINIO_LISTADO, note: 'E2E M6' },
        });
        assert.ok(respuestaListado.ok(), `alta de ${DOMINIO_LISTADO} debe responder 200`);

        const respuestaComodin = await page.request.post(`${BASE_URL}/api/admin/domains`, {
          data: { pattern: DOMINIO_COMODIN, note: 'E2E M6' },
        });
        assert.ok(respuestaComodin.ok(), `alta de ${DOMINIO_COMODIN} debe responder 200`);

        await contexto.close();
      } finally {
        await browser.close();
      }
    }
    console.log(`✔ preparado: lista blanca con "${DOMINIO_LISTADO}" y "${DOMINIO_COMODIN}"`);

    // ───────────────────────────────────────────────────────────
    // 1. Registro abierto: un dominio que NO está en la lista blanca igual
    //    puede registrarse Y loguearse (specs/ai-access-control/spec.md —
    //    "Unauthorized-domain user can register").
    // ───────────────────────────────────────────────────────────
    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();

        const respuestaRegistro = await page.request.post(`${BASE_URL}/api/auth/register`, {
          data: { name: 'Docente sin dominio listado', email: EMAIL_NO_LISTADO, password: DOCENTE_PASSWORD },
        });
        assert.equal(
          respuestaRegistro.status(),
          200,
          `el registro con dominio no listado debe responder 200 (dio ${respuestaRegistro.status()})`,
        );
        console.log('✔ registro: un dominio no listado puede crear una cuenta');

        await contexto.close();
      } finally {
        await browser.close();
      }
    }

    // Login, también abierto.
    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        const respuestaLogin = await page.request.post(`${BASE_URL}/api/auth/login`, {
          data: { email: EMAIL_NO_LISTADO, password: DOCENTE_PASSWORD },
        });
        assert.equal(
          respuestaLogin.status(),
          200,
          `el login con dominio no listado debe responder 200 (dio ${respuestaLogin.status()})`,
        );
        console.log('✔ login: la misma cuenta, con el mismo dominio no listado, puede entrar');
        await contexto.close();
      } finally {
        await browser.close();
      }
    }

    const usuarioNoListado = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_NO_LISTADO } });
    const { projectId: projNoListado, threadId: hiloNoListado } = await crearProyectoConHilo(
      usuarioNoListado.id,
    );

    // ───────────────────────────────────────────────────────────
    // 2. Ese mismo usuario, sin override, queda bloqueado del USO de la IA
    //    (no del login) — con el mensaje legible del spec, no un 403 pelado.
    // ───────────────────────────────────────────────────────────
    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: EMAIL_NO_LISTADO, password: DOCENTE_PASSWORD });

        const respuesta = await page.request.post(`${BASE_URL}/api/chat/stream`, {
          data: { projectId: projNoListado, threadId: hiloNoListado, message: '¿Existe algo nuevo hoy?', model: motorId },
        });
        assert.equal(respuesta.status(), 403, `dominio no listado + sin override debe dar 403 (dio ${respuesta.status()})`);
        const cuerpo = (await respuesta.json()) as { error?: string };
        assert.equal(cuerpo.error, REFUSAL, 'el mensaje de rechazo debe ser el literal del spec');

        await contexto.close();
      } finally {
        await browser.close();
      }
    }
    console.log('✔ uso de la IA: dominio no listado y sin override → 403 con el mensaje legible del spec');

    // ───────────────────────────────────────────────────────────
    // 3. Un grant de admin habilita a ese usuario, sin importar el dominio.
    // ───────────────────────────────────────────────────────────
    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
        const respuestaPatch = await page.request.patch(`${BASE_URL}/api/admin/users/${usuarioNoListado.id}`, {
          data: { aiAccessOverride: true },
        });
        assert.ok(respuestaPatch.ok(), 'el grant de acceso debe responder 200');
        const cuerpoPatch = (await respuestaPatch.json()) as { usuario: { accesoIa: string } };
        assert.equal(cuerpoPatch.usuario.accesoIa, 'Sí · permiso individual', 'el texto debe reflejar el grant');
        await contexto.close();
      } finally {
        await browser.close();
      }
    }

    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: EMAIL_NO_LISTADO, password: DOCENTE_PASSWORD });

        const respuesta = await page.request.post(`${BASE_URL}/api/chat/stream`, {
          data: { projectId: projNoListado, threadId: hiloNoListado, message: '¿Existe algo nuevo hoy?', model: motorId },
        });
        assert.equal(respuesta.status(), 200, `con el grant debería responder 200 (dio ${respuesta.status()})`);

        await contexto.close();
      } finally {
        await browser.close();
      }
    }
    console.log('✔ uso de la IA: el grant de admin habilita a un usuario de dominio no listado, en su próximo turno');

    // ───────────────────────────────────────────────────────────
    // 4. Un usuario de un dominio SÍ listado queda bloqueado si un admin lo
    //    revoca explícitamente — la revocación pisa al dominio.
    // ───────────────────────────────────────────────────────────
    const usuarioListado = await asegurarDocenteListo(EMAIL_LISTADO);
    const { projectId: projListado, threadId: hiloListado } = await crearProyectoConHilo(usuarioListado.id);

    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: EMAIL_LISTADO, password: DOCENTE_PASSWORD });

        const respuestaAntes = await page.request.post(`${BASE_URL}/api/chat/stream`, {
          data: { projectId: projListado, threadId: hiloListado, message: '¿Existe algo nuevo hoy?', model: motorId },
        });
        assert.equal(
          respuestaAntes.status(),
          200,
          `dominio listado, sin override: debería pasar (dio ${respuestaAntes.status()})`,
        );

        await contexto.close();
      } finally {
        await browser.close();
      }
    }
    console.log('✔ uso de la IA: dominio listado, sin override → permitido por la regla del dominio');

    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
        const respuestaPatch = await page.request.patch(`${BASE_URL}/api/admin/users/${usuarioListado.id}`, {
          data: { aiAccessOverride: false },
        });
        assert.ok(respuestaPatch.ok(), 'la revocación debe responder 200');
        await contexto.close();
      } finally {
        await browser.close();
      }
    }

    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: EMAIL_LISTADO, password: DOCENTE_PASSWORD });

        const respuestaDespues = await page.request.post(`${BASE_URL}/api/chat/stream`, {
          data: { projectId: projListado, threadId: hiloListado, message: '¿Existe algo nuevo hoy?', model: motorId },
        });
        assert.equal(
          respuestaDespues.status(),
          403,
          `revocado en un dominio listado: debe dar 403 (dio ${respuestaDespues.status()})`,
        );
        const cuerpo = (await respuestaDespues.json()) as { error?: string };
        assert.equal(cuerpo.error, REFUSAL, 'mismo mensaje legible al revocar');

        await contexto.close();
      } finally {
        await browser.close();
      }
    }
    console.log('✔ uso de la IA: la revocación de admin bloquea a un usuario de dominio listado, sin importar el dominio');

    // ───────────────────────────────────────────────────────────
    // 5. Lista vacía = todo el mundo puede usar la IA. Se saca la lista
    //    entera un instante (vía API, invalida la caché en el proceso del
    //    server) y se la repone después.
    // ───────────────────────────────────────────────────────────
    const usuarioVacia = await asegurarDocenteListo(EMAIL_VACIA);
    const { projectId: projVacia, threadId: hiloVacia } = await crearProyectoConHilo(usuarioVacia.id);

    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

        const respuestaGet = await page.request.get(`${BASE_URL}/api/admin/domains`);
        const { dominios } = (await respuestaGet.json()) as {
          dominios: Array<{ id: string; pattern: string }>;
        };
        for (const dominio of dominios) {
          // `data: {}` fuerza `Content-Type: application/json`: sin body, el
          // DELETE de `page.request` (a diferencia de un `fetch` real de
          // navegador) no manda `Origin`, y `csrf.ts` lo trataría como
          // cross-origin sin ese header. JSON queda exento del chequeo (ver
          // `csrf.ts`), así que esto sortea una limitación del arnés, no un
          // bug de la app real.
          const del = await page.request.delete(`${BASE_URL}/api/admin/domains/${dominio.id}`, { data: {} });
          assert.ok(del.ok(), `borrar ${dominio.pattern} debe responder 200`);
        }

        await contexto.close();
      } finally {
        await browser.close();
      }
    }

    try {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: EMAIL_VACIA, password: DOCENTE_PASSWORD });

        const respuesta = await page.request.post(`${BASE_URL}/api/chat/stream`, {
          data: { projectId: projVacia, threadId: hiloVacia, message: '¿Existe algo nuevo hoy?', model: motorId },
        });
        assert.equal(
          respuesta.status(),
          200,
          `lista vacía: cualquier dominio debería pasar (dio ${respuesta.status()})`,
        );

        await contexto.close();
      } finally {
        await browser.close();
      }
      console.log('✔ uso de la IA: lista de dominios vacía → todo el mundo puede usar la IA');
    } finally {
      // Se repone la lista para las escenas que siguen (comodín, UI).
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
        await page.request.post(`${BASE_URL}/api/admin/domains`, {
          data: { pattern: DOMINIO_LISTADO, note: 'E2E M6' },
        });
        await page.request.post(`${BASE_URL}/api/admin/domains`, {
          data: { pattern: DOMINIO_COMODIN, note: 'E2E M6' },
        });
        await contexto.close();
      } finally {
        await browser.close();
      }
    }

    // ───────────────────────────────────────────────────────────
    // 6. El comodín `*.edu.ar` matchea un subdominio, pero NO el dominio
    //    desnudo — se prueba sólo el caso positivo (specs/ai-access-control
    //    pide el subdominio; la asimetría ya está cubierta por el matcher
    //    portado literal en domains.ts).
    // ───────────────────────────────────────────────────────────
    const usuarioComodin = await asegurarDocenteListo(EMAIL_COMODIN);
    const { projectId: projComodin, threadId: hiloComodin } = await crearProyectoConHilo(usuarioComodin.id);

    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: EMAIL_COMODIN, password: DOCENTE_PASSWORD });

        const respuesta = await page.request.post(`${BASE_URL}/api/chat/stream`, {
          data: { projectId: projComodin, threadId: hiloComodin, message: '¿Existe algo nuevo hoy?', model: motorId },
        });
        assert.equal(
          respuesta.status(),
          200,
          `"*.edu.ar" debería matchear "sub.edu.ar" (dio ${respuesta.status()})`,
        );

        await contexto.close();
      } finally {
        await browser.close();
      }
    }
    console.log('✔ uso de la IA: el comodín "*.edu.ar" matchea un subdominio real');

    // ───────────────────────────────────────────────────────────
    // 7. Un turno ya en curso no se corta al revocar; el PRÓXIMO sí queda
    //    bloqueado (specs/ai-access-control/spec.md — "Revocation applies
    //    to the next turn"). El mock retrasa su segundo chunk 1.5s para que
    //    haya una ventana real donde el turno sigue abierto cuando se
    //    revoca.
    // ───────────────────────────────────────────────────────────
    const usuarioInstream = await asegurarDocenteListo(EMAIL_INSTREAM);
    const { projectId: projInstream, threadId: hiloInstream } = await crearProyectoConHilo(usuarioInstream.id);

    {
      // El browser de admin se abre y loguea ANTES de arrancar el turno: un
      // `chromium.launch()` a mitad de camino es pesado (CPU + IO) y puede
      // estancar el event loop más que la ventana de la revocación, con lo
      // que la revocación terminaría llegando ANTES de que el gate del
      // primer pedido siquiera lo leyera — justo lo que este caso NO quiere
      // probar. Con los dos browsers ya arriba, sólo queda un `fetch`.
      const browser = await abrirNavegador();
      const browserAdmin = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: EMAIL_INSTREAM, password: DOCENTE_PASSWORD });

        const contextoAdmin = await browserAdmin.newContext();
        const pageAdmin = await contextoAdmin.newPage();
        await iniciarSesion(pageAdmin, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

        // A esta altura del script la lista blanca ya está repuesta
        // (escenas 5-6) y el dominio de este usuario no está en ella, así
        // que hace falta un grant explícito para arrancar en estado
        // habilitado — si no, el primer pedido ya daría 403 y la escena no
        // probaría nada sobre el turno en curso.
        const respuestaGrant = await pageAdmin.request.patch(
          `${BASE_URL}/api/admin/users/${usuarioInstream.id}`,
          { data: { aiAccessOverride: true } },
        );
        assert.ok(respuestaGrant.ok(), 'el grant previo al turno en curso debe responder 200');

        mock.state.retrasoMs = 1_500;
        const turnoEnCurso = page.request.post(`${BASE_URL}/api/chat/stream`, {
          data: { projectId: projInstream, threadId: hiloInstream, message: '¿Existe algo nuevo hoy?', model: motorId },
        });

        // Le da tiempo al server a recibir el pedido, pasar el gate (ya
        // habilitado en ese momento) y arrancar a leer el primer chunk del
        // mock ANTES de revocar — así la revocación ocurre de verdad a
        // mitad del turno, no antes de que arranque.
        await new Promise((r) => setTimeout(r, 700));

        const respuestaRevocacion = await pageAdmin.request.patch(
          `${BASE_URL}/api/admin/users/${usuarioInstream.id}`,
          { data: { aiAccessOverride: false } },
        );
        assert.ok(respuestaRevocacion.ok(), 'la revocación en pleno turno debe responder 200');
        await contextoAdmin.close();

        const respuestaEnCurso = await turnoEnCurso;
        assert.equal(
          respuestaEnCurso.status(),
          200,
          `el turno YA en curso no debe cortarse por la revocación (dio ${respuestaEnCurso.status()})`,
        );
        const cuerpoStream = await respuestaEnCurso.text();
        assert.ok(cuerpoStream.includes('"done"'), 'el turno en curso debe terminar normalmente, con su "done"');
        console.log('✔ turno en curso: revocar a mitad de camino no lo corta, termina normal');

        mock.state.retrasoMs = 30;
        const proximoTurno = await page.request.post(`${BASE_URL}/api/chat/stream`, {
          data: { projectId: projInstream, threadId: hiloInstream, message: '¿Existe algo distinto ahora?', model: motorId },
        });
        assert.equal(
          proximoTurno.status(),
          403,
          `el turno SIGUIENTE, ya revocado, debe bloquearse (dio ${proximoTurno.status()})`,
        );
        console.log('✔ próximo turno: bloqueado, tal como pide el spec ("revocation applies to the next turn")');

        await contexto.close();
      } finally {
        await browser.close();
        await browserAdmin.close();
      }
    }

    // ───────────────────────────────────────────────────────────
    // 8. UI de /admin/dominios: alta, baja, y el copy exacto según haya o
    //    no filas — en los dos temas.
    // ───────────────────────────────────────────────────────────
    for (const tema of ['light', 'dark'] as const) {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
        await page.goto(`${BASE_URL}/admin/dominios`, { waitUntil: 'domcontentloaded' });
        // Le da tiempo al bundle de la isla a terminar de llegar antes de
        // arrancar a interactuar — en un dev server compartido y cargado,
        // la red (Vite sirviendo/compilando el módulo) puede tardar más que
        // la hidratación en sí.
        await page.waitForLoadState('networkidle').catch(() => {});
        if (tema === 'dark') await conTema(page, 'dark');

        // Hoy la lista tiene 2 filas (repuestas en la escena 5).
        await assertTexto(page.locator('body'), /Solo estos dominios pueden usar la IA/);
        await page.getByText(DOMINIO_LISTADO, { exact: true }).waitFor();

        const patronNuevo = `nuevo-e2e-m6-${tema}.edu.ar`;
        const botonAgregar = page.getByRole('button', { name: 'Agregar dominio' });
        // Trampa de la isla `client:load`: el HTML del SSR ya está en el DOM
        // antes de que React hidrate y ate el `onChange` — un `fill()` en
        // esa ventana pisa el `value` del input pero nunca actualiza el
        // estado de React, así que el botón se queda deshabilitado para
        // siempre. Se reintenta el `fill()` hasta que el botón reacciona.
        // Timeout largo: puede ser la primera vez en esta corrida que Vite
        // compila la isla `client:load` de `/admin/dominios`, y eso —no la
        // hidratación en sí— es lo que de verdad puede tardar unos segundos
        // en un dev server con muchos procesos concurrentes.
        await esperarHasta(async () => {
          await page.getByLabel('Dominio').fill(patronNuevo);
          return !(await botonAgregar.isDisabled());
        }, 45_000);
        await botonAgregar.click();
        await esperarHasta(async () => (await page.getByText(patronNuevo).count()) > 0);
        console.log(`✔ /admin/dominios (${tema}): agregar un dominio lo refleja en la lista sin recargar`);

        // Lo saca de nuevo: el botón "Quitar" de esa fila. Mismo reintento:
        // un click que cae antes de que la isla hidrate se pierde en
        // silencio.
        const fila = page.locator('li', { hasText: patronNuevo });
        await esperarHasta(async () => {
          await fila.getByRole('button', { name: 'Quitar' }).click({ timeout: 1_000 }).catch(() => {});
          return (await page.getByText(patronNuevo).count()) === 0;
        });
        console.log(`✔ /admin/dominios (${tema}): quitar un dominio lo saca de la lista sin recargar`);

        await contexto.close();
      } finally {
        await browser.close();
      }
    }

    // Copy de lista vacía, una sola vez (no depende del tema).
    {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

        const respuestaGet = await page.request.get(`${BASE_URL}/api/admin/domains`);
        const { dominios } = (await respuestaGet.json()) as { dominios: Array<{ id: string }> };
        for (const dominio of dominios) {
          await page.request.delete(`${BASE_URL}/api/admin/domains/${dominio.id}`, { data: {} });
        }

        await page.goto(`${BASE_URL}/admin/dominios`, { waitUntil: 'domcontentloaded' });
        await assertTexto(
          page.locator('body'),
          /La lista está vacía: cualquier docente registrado puede usar la IA\./,
        );
        console.log('✔ /admin/dominios: el copy de lista vacía es el literal de design.md');

        // Se repone para dejar el resto del entorno como estaba.
        await page.request.post(`${BASE_URL}/api/admin/domains`, {
          data: { pattern: DOMINIO_LISTADO, note: 'E2E M6' },
        });
        await page.request.post(`${BASE_URL}/api/admin/domains`, {
          data: { pattern: DOMINIO_COMODIN, note: 'E2E M6' },
        });

        await contexto.close();
      } finally {
        await browser.close();
      }
    }

    // ───────────────────────────────────────────────────────────
    // 9. UI de /admin/usuarios: la columna de 3 estados y el menú tri-estado
    //    ("Habilitar la IA" / "Bloquear la IA" / "Volver a la regla del
    //    dominio"), en los dos temas.
    // ───────────────────────────────────────────────────────────
    await asegurarDocenteListo(EMAIL_MENU);

    for (const tema of ['light', 'dark'] as const) {
      const browser = await abrirNavegador();
      try {
        const contexto = await browser.newContext();
        const page = await contexto.newPage();
        await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
        await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        if (tema === 'dark') await conTema(page, 'dark');

        const fila = page.locator('tr', { hasText: EMAIL_MENU });
        await fila.waitFor();

        // Estado inicial: null + lista no vacía + dominio no listado ⇒ "No".
        await assertTexto(fila.locator('td').nth(2), /^No$/);

        const abrirMenu = () => fila.locator('summary').click();

        // "Habilitar la IA" — no está mientras aiAccessOverride === true, así
        // que su sola presencia después del click confirma el cambio de
        // estado (mismo espíritu que el reintento de M5: reintenta el CLICK
        // completo hasta que la isla ya hidrató y el estado cambió — nunca
        // asume que el primer click alcanzó, porque `client:load` puede
        // todavía no haber atado el handler).
        // Timeout largo en el primer intento: primera vez que esta corrida
        // renderiza `/admin/usuarios` en el navegador, así que puede incluir
        // la compilación de la isla por Vite, no sólo la hidratación.
        await esperarHasta(async () => {
          await abrirMenu();
          const boton = fila.getByRole('button', { name: 'Habilitar la IA' });
          if ((await boton.count()) === 0) return false;
          await boton.click();
          return true;
        }, 45_000);
        await assertTexto(fila.locator('td').nth(2), /Sí · permiso individual/);
        console.log(`✔ /admin/usuarios (${tema}): "Habilitar la IA" pasa la columna a "Sí · permiso individual"`);

        await esperarHasta(async () => {
          await abrirMenu();
          const boton = fila.getByRole('button', { name: 'Bloquear la IA' });
          if ((await boton.count()) === 0) return false;
          await boton.click();
          return true;
        });
        await assertTexto(fila.locator('td').nth(2), /^No$/);
        console.log(`✔ /admin/usuarios (${tema}): "Bloquear la IA" pasa la columna a "No"`);

        await esperarHasta(async () => {
          await abrirMenu();
          const boton = fila.getByRole('button', { name: 'Volver a la regla del dominio' });
          if ((await boton.count()) === 0) return false;
          await boton.click();
          return true;
        });
        // Vuelve a null; con la lista no vacía y el dominio de prueba no
        // listado, la regla de dominio también da "No" — el punto de esta
        // aserción es que la escritura respondió 200 y la fila no se rompió,
        // no distinguir "No" de "No" (eso ya lo prueban las escenas 2-4 por
        // API, con datos que sí distinguen los dos motivos).
        await assertTexto(fila.locator('td').nth(2), /^No$/);
        console.log(`✔ /admin/usuarios (${tema}): "Volver a la regla del dominio" no rompe la fila`);

        await contexto.close();
      } finally {
        await browser.close();
      }
    }

    console.log('\n✔ e2e/m6-acceso.ts: todos los escenarios pasaron');
  } finally {
    await mock.cerrar();
    await limpiarEstado();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\n✖ e2e/m6-acceso.ts falló:', error);
  process.exitCode = 1;
});
