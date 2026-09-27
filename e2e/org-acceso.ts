import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';

/**
 * Verificación de T2 (odd/tasks/organizaciones.md): acceso a la IA por
 * organización (reemplaza a e2e/m6-acceso.ts, que probaba la vieja
 * `AuthorizedDomain` — T1 la borró del todo, así que ese script ya no podía
 * compilar). Cubre, en orden:
 *
 *  1. Registro con un email de un dominio de una CAMPUS activa: se une sola
 *     ("unirse ocurre en el momento") y puede crear un recurso.
 *  2. Registro con un email personal: queda sin organización, no puede crear
 *     un recurso (403 con el mensaje legible) y ve la pantalla de "Cuenta
 *     personal" en /app.
 *  3. Un email en la lista blanca de una CAMPUS se une aunque su DOMINIO no
 *     esté autorizado.
 *  4. `aiAccessOverride = false` deniega aunque la cuenta esté en una
 *     organización activa; `aiAccessOverride = true` habilita a una cuenta
 *     personal, sin organización.
 *  5. Una organización archivada DESPUÉS de que alguien se unió le corta el
 *     acceso en la próxima request — sin mover a nadie de organización.
 *  6. Un dominio de una NETWORK deja a la cuenta personal (el picker de sede
 *     es T4; acá sólo se expone la resolución).
 *
 * `organizacionParaEmail` (src/lib/orgs/resolucion.ts) cachea 10s, igual que
 * la vieja `dominioAutorizado`: los dominios/emails de prueba se crean por
 * Prisma directo ANTES de arrancar los escenarios, y el script espera esa
 * ventana una sola vez (no hay forma de invalidar esa caché desde OTRO
 * proceso — el dev server y este script son procesos separados).
 * `puedeUsarLaIa` (src/lib/orgs/acceso.ts) en cambio NO cachea el estado de
 * archivado de una organización — por diseño, para que archivar corte el
 * acceso en la request siguiente sin esperar nada.
 *
 * Corre con: KODU_BASE_URL=http://localhost:3100 npx tsx e2e/org-acceso.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const REFUSAL = 'Tu cuenta todavía no tiene habilitado el uso de la IA. Escribinos y lo vemos.';
const CUENTA_PERSONAL_TEXTO = 'Tu cuenta es personal';

// Sufijo único por corrida: nada de esto debería sobrevivir un `finally`,
// pero un sufijo fijo evitaría choques si una corrida anterior quedó sucia.
const SUFIJO = randomUUID().slice(0, 8);

const DOMINIO_CAMPUS = `escuela-org-e2e-${SUFIJO}.edu.ar`;
const DOMINIO_RED = `red-org-e2e-${SUFIJO}.edu.ar`;
const DOMINIO_ARCHIVAR = `archivar-org-e2e-${SUFIJO}.edu.ar`;

const EMAIL_DOMINIO = `docente-a@${DOMINIO_CAMPUS}`;
const EMAIL_PERSONAL = `docente-b-personal-${SUFIJO}@afuera-org-e2e.com`;
const EMAIL_LISTA = `docente-c-lista-${SUFIJO}@afuera-org-e2e.com`;
const EMAIL_OVERRIDE_FALSE = `docente-d-override-false@${DOMINIO_CAMPUS}`;
const EMAIL_OVERRIDE_TRUE = `docente-e-override-true-${SUFIJO}@afuera-org-e2e.com`;
const EMAIL_ARCHIVAR = `docente-f-archivar@${DOMINIO_ARCHIVAR}`;
const EMAIL_RED = `docente-g-red@${DOMINIO_RED}`;

const TODOS_LOS_EMAILS = [
  EMAIL_DOMINIO,
  EMAIL_PERSONAL,
  EMAIL_LISTA,
  EMAIL_OVERRIDE_FALSE,
  EMAIL_OVERRIDE_TRUE,
  EMAIL_ARCHIVAR,
  EMAIL_RED,
];

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const fixtureIds = { campus: '', red: '', sedeDeLaRed: '', archivar: '' };

async function crearFixtures(): Promise<void> {
  const campus = await prisma.organization.create({
    data: { name: `Campus E2E ${SUFIJO}`, kind: 'CAMPUS' },
    select: { id: true },
  });
  fixtureIds.campus = campus.id;
  await prisma.organizationDomain.create({ data: { organizationId: campus.id, pattern: DOMINIO_CAMPUS } });
  await prisma.organizationAllowedEmail.create({ data: { organizationId: campus.id, email: EMAIL_LISTA } });

  const red = await prisma.organization.create({
    data: { name: `Red E2E ${SUFIJO}`, kind: 'NETWORK' },
    select: { id: true },
  });
  fixtureIds.red = red.id;
  await prisma.organizationDomain.create({ data: { organizationId: red.id, pattern: DOMINIO_RED } });
  const sede = await prisma.organization.create({
    data: { name: `Sede de la red E2E ${SUFIJO}`, kind: 'CAMPUS', parentId: red.id },
    select: { id: true },
  });
  fixtureIds.sedeDeLaRed = sede.id;

  const archivar = await prisma.organization.create({
    data: { name: `Para archivar E2E ${SUFIJO}`, kind: 'CAMPUS' },
    select: { id: true },
  });
  fixtureIds.archivar = archivar.id;
  await prisma.organizationDomain.create({ data: { organizationId: archivar.id, pattern: DOMINIO_ARCHIVAR } });
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

  // Borrar la organización cascadea sus dominios y su lista blanca (FKs
  // onDelete: Cascade, ver prisma/schema.prisma) — no hace falta borrarlos
  // aparte. La sede de la red se borra ANTES que la red por prolijidad
  // (su FK a la red es SetNull, así que el orden no es obligatorio).
  for (const id of [fixtureIds.sedeDeLaRed, fixtureIds.red, fixtureIds.campus, fixtureIds.archivar]) {
    if (id) await prisma.organization.deleteMany({ where: { id } });
  }
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registrar(email: string): Promise<{ page: import('playwright').Page; body: any }> {
  const browser = await abrirNavegador();
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  const respuesta = await page.request.post(`${BASE_URL}/api/auth/register`, {
    data: { name: `Docente ${email.split('@')[0]}`, email, password: DOCENTE_PASSWORD },
  });
  assert.equal(respuesta.status(), 200, `registro de ${email} debe responder 200 (dio ${respuesta.status()})`);
  const body = await respuesta.json();
  // El browser queda cerrado por el llamador; se devuelve para que cada
  // escenario pueda reusar la MISMA cookie de sesión sin loguearse nuevo.
  return { page, body };
}

async function crearProyecto(page: import('playwright').Page): Promise<import('playwright').APIResponse> {
  return page.request.post(`${BASE_URL}/api/projects`, { data: { title: 'Recurso E2E organizaciones' } });
}

async function main(): Promise<void> {
  await limpiarEstado();
  await crearFixtures();

  // Ventana de la caché de 10s de `organizacionParaEmail` (resolucion.ts):
  // el dev server puede haber cacheado "sin dominios/sin lista blanca" en
  // algún pedido anterior a que este script creara los fixtures de arriba.
  console.log('… esperando 11s la caché de organizaciones del dev server…');
  await esperar(11_000);

  const browsersAbiertos: import('playwright').Browser[] = [];

  try {
    // ───────────────────────────────────────────────────────────
    // 1. Dominio de una CAMPUS activa: se une sola y puede crear un recurso.
    // ───────────────────────────────────────────────────────────
    {
      const { page, body } = await registrar(EMAIL_DOMINIO);
      browsersAbiertos.push(page.context().browser()!);
      assert.equal(
        body.user.organizationId,
        fixtureIds.campus,
        'un email de un dominio autorizado debe unirse a esa organización al registrarse',
      );
      const respuestaProyecto = await crearProyecto(page);
      assert.equal(
        respuestaProyecto.status(),
        200,
        `crear un recurso ya en una organización activa debe responder 200 (dio ${respuestaProyecto.status()})`,
      );
      console.log('✔ 1. dominio de una CAMPUS activa: se une sola y puede crear un recurso');
    }

    // ───────────────────────────────────────────────────────────
    // 2. Email personal: sin organización, no puede crear un recurso, ve la
    //    pantalla de cuenta personal en /app.
    // ───────────────────────────────────────────────────────────
    {
      const { page, body } = await registrar(EMAIL_PERSONAL);
      browsersAbiertos.push(page.context().browser()!);
      assert.equal(body.user.organizationId, null, 'un email sin organización debe quedar personal');

      const respuestaProyecto = await crearProyecto(page);
      assert.equal(
        respuestaProyecto.status(),
        403,
        `una cuenta personal no debe poder crear un recurso (dio ${respuestaProyecto.status()})`,
      );
      const cuerpo = (await respuestaProyecto.json()) as { error?: string };
      assert.equal(cuerpo.error, REFUSAL, 'el mensaje de rechazo debe ser el literal del spec de acceso a la IA');

      await page.goto(`${BASE_URL}/app`, { waitUntil: 'domcontentloaded' });
      const texto = await page.locator('body').textContent();
      assert.ok(
        texto?.includes(CUENTA_PERSONAL_TEXTO),
        `/app debe mostrar la pantalla de cuenta personal (vio: ${texto?.slice(0, 200)})`,
      );
      console.log('✔ 2. email personal: sin organización, sin crear recursos, /app muestra "cuenta personal"');
    }

    // ───────────────────────────────────────────────────────────
    // 3. Lista blanca: se une aunque el DOMINIO del email no esté autorizado.
    // ───────────────────────────────────────────────────────────
    {
      const { page, body } = await registrar(EMAIL_LISTA);
      browsersAbiertos.push(page.context().browser()!);
      assert.equal(
        body.user.organizationId,
        fixtureIds.campus,
        'un email en la lista blanca debe unirse aunque su dominio no esté autorizado',
      );
      const respuestaProyecto = await crearProyecto(page);
      assert.equal(respuestaProyecto.status(), 200, 'la lista blanca debe habilitar la creación de recursos');
      console.log('✔ 3. lista blanca: se une aunque el dominio del email no esté autorizado');
    }

    // ───────────────────────────────────────────────────────────
    // 4a. `aiAccessOverride = false` deniega aunque la organización esté activa.
    // ───────────────────────────────────────────────────────────
    {
      const { page, body } = await registrar(EMAIL_OVERRIDE_FALSE);
      browsersAbiertos.push(page.context().browser()!);
      assert.equal(body.user.organizationId, fixtureIds.campus, 'debe unirse a la CAMPUS por su dominio');

      const admin = await abrirNavegador();
      try {
        const contextoAdmin = await admin.newContext();
        const pageAdmin = await contextoAdmin.newPage();
        await iniciarSesion(pageAdmin, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
        const respuestaPatch = await pageAdmin.request.patch(`${BASE_URL}/api/admin/users/${body.user.id}`, {
          data: { aiAccessOverride: false },
        });
        assert.ok(respuestaPatch.ok(), 'la revocación debe responder 200');
        await contextoAdmin.close();
      } finally {
        await admin.close();
      }

      const respuestaProyecto = await crearProyecto(page);
      assert.equal(
        respuestaProyecto.status(),
        403,
        `override=false debe denegar aunque la organización esté activa (dio ${respuestaProyecto.status()})`,
      );
      console.log('✔ 4a. aiAccessOverride=false deniega aunque la organización esté activa');
    }

    // ───────────────────────────────────────────────────────────
    // 4b. `aiAccessOverride = true` habilita a una cuenta personal, sin
    //     organización.
    // ───────────────────────────────────────────────────────────
    {
      const { page, body } = await registrar(EMAIL_OVERRIDE_TRUE);
      browsersAbiertos.push(page.context().browser()!);
      assert.equal(body.user.organizationId, null, 'debe quedar personal (email fuera de cualquier organización)');

      const admin = await abrirNavegador();
      try {
        const contextoAdmin = await admin.newContext();
        const pageAdmin = await contextoAdmin.newPage();
        await iniciarSesion(pageAdmin, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
        const respuestaPatch = await pageAdmin.request.patch(`${BASE_URL}/api/admin/users/${body.user.id}`, {
          data: { aiAccessOverride: true },
        });
        assert.ok(respuestaPatch.ok(), 'el grant debe responder 200');
        await contextoAdmin.close();
      } finally {
        await admin.close();
      }

      const respuestaProyecto = await crearProyecto(page);
      assert.equal(
        respuestaProyecto.status(),
        200,
        `override=true debe habilitar sin organización (dio ${respuestaProyecto.status()})`,
      );
      console.log('✔ 4b. aiAccessOverride=true habilita a una cuenta personal, sin organización');
    }

    // ───────────────────────────────────────────────────────────
    // 5. Archivar la organización DESPUÉS de unirse corta el acceso en la
    //    próxima request — sin mover a nadie de organización.
    // ───────────────────────────────────────────────────────────
    {
      const { page, body } = await registrar(EMAIL_ARCHIVAR);
      browsersAbiertos.push(page.context().browser()!);
      assert.equal(body.user.organizationId, fixtureIds.archivar, 'debe unirse a la organización activa');

      const antes = await crearProyecto(page);
      assert.equal(antes.status(), 200, 'antes de archivar, debe poder crear un recurso');

      await prisma.organization.update({ where: { id: fixtureIds.archivar }, data: { archivedAt: new Date() } });

      const despues = await crearProyecto(page);
      assert.equal(
        despues.status(),
        403,
        `archivar la organización debe cortar el acceso en la próxima request (dio ${despues.status()})`,
      );

      // El recurso que ya tenía no se borra, pero el editor tampoco se abre:
      // la URL directa rebota a /app, que muestra la pantalla de cuenta personal.
      const { project: proyectoPrevio } = await antes.json();
      const editor = await page.request.get(`${BASE_URL}/app/project/${proyectoPrevio.id}`, { maxRedirects: 0 });
      assert.equal(editor.status(), 302, 'una cuenta personal no debe abrir el editor de un recurso propio');
      assert.equal(editor.headers()['location'], '/app', 'el editor debe rebotar a /app');
      assert.ok(
        await prisma.project.findUnique({ where: { id: proyectoPrevio.id }, select: { id: true } }),
        'el recurso de una cuenta que quedó personal no se borra',
      );

      const usuarioTrasArchivar = await prisma.user.findUniqueOrThrow({
        where: { id: body.user.id },
        select: { organizationId: true },
      });
      assert.equal(
        usuarioTrasArchivar.organizationId,
        fixtureIds.archivar,
        'archivar la organización NO debe mover a nadie de organización — sólo corta el acceso',
      );
      console.log('✔ 5. archivar la organización corta el acceso en la próxima request, sin mover a nadie');
    }

    // ───────────────────────────────────────────────────────────
    // 6. Dominio de una NETWORK: la cuenta queda personal (picker de sede es
    //    T4; acá sólo se expone la resolución).
    // ───────────────────────────────────────────────────────────
    {
      const { page, body } = await registrar(EMAIL_RED);
      browsersAbiertos.push(page.context().browser()!);
      assert.equal(
        body.user.organizationId,
        null,
        'un dominio de red no debe unir sola a ninguna sede — queda personal hasta elegir (T4)',
      );
      const respuestaProyecto = await crearProyecto(page);
      assert.equal(respuestaProyecto.status(), 403, 'sigue siendo una cuenta personal: no puede crear recursos');
      console.log('✔ 6. dominio de una NETWORK: la cuenta queda personal, pendiente del picker de sede (T4)');
    }

    console.log('\n✔ e2e/org-acceso.ts: todos los escenarios pasaron');
  } finally {
    for (const browser of browsersAbiertos) {
      await browser.close().catch(() => {});
    }
    await limpiarEstado();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\n✖ e2e/org-acceso.ts falló:', error);
  process.exitCode = 1;
});
