import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, conTema, iniciarSesion } from './harness.ts';

/**
 * Verificación de slice M1: autorización por request + cascarón de /admin.
 *
 * Cubre los 4 escenarios de specs/request-authorization/spec.md:
 *  - anónimo → /admin/* redirige a login
 *  - DOCENTE → /admin/* redirigido, /api/admin/* 403 JSON
 *  - ADMIN → el cascarón renderiza en los dos temas
 *  - promoción en la base surte efecto en la siguiente request, sin login nuevo
 *
 * Corre con: npx tsx e2e/m1-admin-shell.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-m1@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function asegurarDocenteDePrueba(): Promise<string> {
  const docente = await prisma.user.upsert({
    where: { email: DOCENTE_EMAIL },
    update: { role: 'DOCENTE' },
    create: {
      email: DOCENTE_EMAIL,
      name: 'Docente E2E M1',
      role: 'DOCENTE',
      passwordHash: await hashPassword(DOCENTE_PASSWORD),
    },
    select: { id: true },
  });
  return docente.id;
}

async function main(): Promise<void> {
  const docenteId = await asegurarDocenteDePrueba();
  const browser = await abrirNavegador();

  try {
    // 1. Anónimo: /admin/* redirige a login, nunca 404 ni pantalla en blanco.
    {
      const contexto = await browser.newContext();
      const page = await contexto.newPage();
      const respuesta = await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });
      assert.ok(page.url().startsWith(`${BASE_URL}/login`), `esperaba /login, llegó a ${page.url()}`);
      assert.ok(respuesta && respuesta.status() < 400, `login no debería dar error (${respuesta?.status()})`);
      console.log('✔ anónimo: /admin redirige a /login');

      // Trampa del prefijo: /adminfoo NO es un prefijo protegido y no debe
      // capturarse — Astro debe responder su 404 normal, no /login.
      await page.goto(`${BASE_URL}/adminfoo`, { waitUntil: 'domcontentloaded' });
      assert.ok(!page.url().startsWith(`${BASE_URL}/login`), '/adminfoo no debería redirigir a /login');
      console.log('✔ anónimo: /adminfoo no queda capturado por el prefijo /admin');

      const respuestaApi = await page.request.get(`${BASE_URL}/api/adminx`);
      assert.notEqual(respuestaApi.status(), 401, '/api/adminx no debería devolver 401 (no es /api/admin)');
      console.log('✔ anónimo: /api/adminx no queda capturado por el prefijo /api/admin');

      await contexto.close();
    }

    // 2. DOCENTE: /admin/* redirigido a /app; /api/admin/* → 403 JSON.
    {
      const contexto = await browser.newContext();
      const page = await contexto.newPage();
      await iniciarSesion(page, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

      await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });
      assert.ok(page.url().startsWith(`${BASE_URL}/app`), `esperaba /app, llegó a ${page.url()}`);
      console.log('✔ DOCENTE: /admin redirige a /app (nunca 404, nunca blanco)');

      const respuestaGet = await page.request.get(`${BASE_URL}/api/admin/lo-que-sea`);
      assert.equal(respuestaGet.status(), 403, `esperaba 403, fue ${respuestaGet.status()}`);
      const cuerpoGet = (await respuestaGet.json()) as { ok: boolean };
      assert.equal(cuerpoGet.ok, false, 'el 403 de /api/admin debe ser JSON { ok: false }');
      console.log('✔ DOCENTE: GET /api/admin/* → 403 JSON');

      const respuestaPost = await page.request.post(`${BASE_URL}/api/admin/lo-que-sea`, { data: {} });
      assert.equal(respuestaPost.status(), 403, `esperaba 403, fue ${respuestaPost.status()}`);
      console.log('✔ DOCENTE: POST /api/admin/* → 403 JSON (nunca una redirección)');

      // Requirement "Non-admin prefixes are unaffected": /app sigue andando igual.
      const respuestaApp = await page.goto(`${BASE_URL}/app`, { waitUntil: 'domcontentloaded' });
      assert.equal(respuestaApp?.status(), 200, '/app para un DOCENTE debe seguir dando 200');
      console.log('✔ DOCENTE: /app no cambió de comportamiento');

      await contexto.close();
    }

    // 3. ADMIN: el cascarón renderiza en los dos temas.
    {
      const contexto = await browser.newContext();
      const page = await contexto.newPage();
      await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      const respuesta = await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });
      assert.ok(page.url().startsWith(`${BASE_URL}/admin/usuarios`), `esperaba /admin/usuarios, llegó a ${page.url()}`);
      assert.equal(respuesta?.status(), 200, `/admin/usuarios para ADMIN debe dar 200, dio ${respuesta?.status()}`);

      for (const tema of ['light', 'dark'] as const) {
        if (tema === 'dark') await conTema(page, 'dark');

        await page.waitForSelector('h1:has-text("Panel")');
        const pestañas = page.locator('nav[aria-label="Secciones del panel"] a');
        // 7: Docentes, Recursos, Proveedores, Motores, Generación, Dominios, Demo.
        await assertCantidad(pestañas, 7, `la fila de pestañas debe tener 7 links (tema ${tema})`);

        const pillPanel = page.locator('a[href="/admin"]', { hasText: 'Panel' });
        await assertVisible(pillPanel, `el nav debe mostrar el pill "Panel" para ADMIN (tema ${tema})`);

        if (tema === 'dark') {
          const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
          assert.equal(themeAttr, 'dark', 'data-theme debería quedar en "dark" tras conTema');
        }
        console.log(`✔ ADMIN: cascarón de /admin renderiza en tema ${tema}`);
      }

      // GET a /api/admin/* con rol ADMIN: el middleware deja pasar (no 401/403/503).
      // No hay endpoint real todavía (llega en M3), así que el 404 de Astro es
      // la confirmación honesta de "no bloqueado", no un 200 — eso se agrega
      // cuando exista una ruta real bajo /api/admin.
      const respuestaApi = await page.request.get(`${BASE_URL}/api/admin/lo-que-sea`);
      assert.ok(
        ![401, 403, 503].includes(respuestaApi.status()),
        `ADMIN no debería ser bloqueado por el middleware (status ${respuestaApi.status()})`,
      );
      console.log('✔ ADMIN: /api/admin/* pasa el middleware sin 401/403/503');

      await contexto.close();
    }

    // 4. Promoción mid-sesión: la próxima request ya es admin, sin login nuevo.
    {
      const contexto = await browser.newContext();
      const page = await contexto.newPage();
      await iniciarSesion(page, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

      await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });
      assert.ok(page.url().startsWith(`${BASE_URL}/app`), 'antes de la promoción, /admin debe rebotar a /app');

      await prisma.user.update({ where: { id: docenteId }, data: { role: 'ADMIN' } });

      // Misma cookie, mismo contexto de navegador: nunca se vuelve a loguear.
      const respuesta = await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });
      assert.ok(
        page.url().startsWith(`${BASE_URL}/admin/usuarios`),
        `tras la promoción, /admin debería entrar (llegó a ${page.url()})`,
      );
      assert.equal(respuesta?.status(), 200, 'tras la promoción, /admin/usuarios debe dar 200');
      console.log('✔ promoción en la base: la request siguiente ya entra como ADMIN, sin login nuevo');

      await contexto.close();
    }
  } finally {
    await browser.close();
    // Se deja al docente de prueba en rol DOCENTE para que el próximo corrida
    // arranque del mismo estado conocido.
    await prisma.user.update({ where: { id: docenteId }, data: { role: 'DOCENTE' } });
    await prisma.$disconnect();
  }
}

async function assertCantidad(locator: import('playwright').Locator, esperado: number, mensaje: string) {
  const cantidad = await locator.count();
  assert.equal(cantidad, esperado, `${mensaje} (encontró ${cantidad})`);
}

async function assertVisible(locator: import('playwright').Locator, mensaje: string) {
  const visible = await locator.first().isVisible();
  assert.ok(visible, mensaje);
}

main()
  .then(() => {
    console.log('\n✔ e2e/m1-admin-shell.ts: todos los escenarios pasaron');
  })
  .catch((error) => {
    console.error('\n✖ e2e/m1-admin-shell.ts falló:', error);
    process.exitCode = 1;
  });
