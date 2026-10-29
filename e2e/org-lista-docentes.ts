import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, conTema, iniciarSesion } from './harness.ts';
import type { Frame, Locator, Page } from 'playwright';

/**
 * Lista de docentes de `/org`: lugar en la página, columnas, etiquetas
 * mínimas, menú "⋯" por fila (teclado, foco, no se recorta en la última fila),
 * búsqueda / filtro / orden, y que `/admin` (superadmin) conserve la columna
 * "Verificación". Fixture: un colegio standalone con su titular (admin con
 * facturación) y 9 docentes con distinta actividad.
 *
 * Corre con: KODU_BASE_URL=http://localhost:3300 npx tsx e2e/org-lista-docentes.ts
 * Capturas (opcionales): KODU_CAPTURAS_DIR=/ruta
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const PASSWORD = 'Docente.OrgLista.E2E.2026';
const SUFIJO = randomUUID().slice(0, 8);
const dominio = `orglista-e2e-${SUFIJO}.local`;
const correo = (alias: string) => `${alias}@${dominio}`;
const DIR_CAPTURAS = process.env.KODU_CAPTURAS_DIR ?? '';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const haceDias = (dias: number) => new Date(Date.now() - dias * 86_400_000);

/** nombre, alias de email, cantidad de recursos, días desde su último recurso (null = nunca), ¿admin? */
const DOCENTES: [string, string, number, number | null, boolean][] = [
  ['Lucía Acosta', 'lucia', 0, null, false],
  ['Bruno Benítez', 'bruno', 2, 3, true],
  ['Carla Cruz', 'carla', 5, 40, false],
  ['Diego Díaz', 'diego', 1, 0, false],
  ['Elena Estévez', 'elena', 3, 10, false],
  ['Fede Funes', 'fede', 0, null, false],
  ['Gabi Gómez', 'gabi', 4, 60, false],
  ['Hugo Herrera', 'hugo', 2, 20, false],
  ['Inés Iglesias', 'ines', 1, 5, false],
];
const TITULAR = { nombre: 'Titular Lista', alias: 'titular' };

async function limpiar(): Promise<void> {
  const usuarios = await prisma.user.findMany({ where: { email: { endsWith: `@${dominio}` } }, select: { id: true } });
  const ids = usuarios.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.project.deleteMany({ where: { userId: { in: ids } } });
    await prisma.organizationAdmin.deleteMany({ where: { userId: { in: ids } } });
  }
  await prisma.organizationExclusion.deleteMany({ where: { email: { endsWith: `@${dominio}` } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${dominio}` } } });
  await prisma.organizationLicense.deleteMany({ where: { organization: { name: { contains: SUFIJO } } } });
  await prisma.organization.deleteMany({ where: { name: { contains: SUFIJO } } });
}

async function entrarAIframe390(page: Page, url: string): Promise<{ frame: Frame; handle: import('playwright').ElementHandle }> {
  await page.setContent(
    `<!doctype html><html><body style="margin:0;padding:0;background:#0000"><iframe id="f" style="display:block;width:390px;height:4400px;border:0"></iframe></body></html>`,
  );
  const handle = (await page.$('#f'))!;
  await handle.evaluate((el: HTMLIFrameElement, src: string) => {
    el.src = src;
  }, url);
  const frame = await handle.contentFrame();
  if (!frame) throw new Error('no se pudo entrar al iframe de 390px');
  await frame.waitForLoadState('load');
  await frame.waitForSelector('h1, h2', { timeout: 5_000 });
  await frame.waitForLoadState('networkidle');
  return { frame, handle };
}

/** La isla tarda en hidratar en dev: escribir en la búsqueda y ver el conteo cambiar prueba que ya responde. */
async function esperarHidratacion(seccion: Locator): Promise<void> {
  const buscar = seccion.getByRole('searchbox', { name: /Buscar docente/ });
  await buscar.fill('zzz-hidratando');
  await seccion.getByRole('status').filter({ hasText: /^0 de / }).waitFor({ timeout: 15_000 });
  await buscar.fill('');
}

/** Nombres visibles de la lista, en el orden en que se ven (tabla en desktop, tarjetas en 390). */
async function nombres(ctx: Page | Frame): Promise<string[]> {
  const todos = ctx.locator('section:has(h2:text-is("Docentes")) :is(td, .kodu-card) p.font-medium');
  const visibles: string[] = [];
  for (const el of await todos.all()) {
    if (await el.isVisible()) visibles.push(((await el.textContent()) ?? '').trim());
  }
  return visibles;
}

async function main(): Promise<void> {
  await limpiar();
  const browser = await abrirNavegador();

  try {
    // ── Fixture ───────────────────────────────────────────────
    const colegio = await prisma.organization.create({ data: { name: `Colegio Lista E2E ${SUFIJO}`, kind: 'CAMPUS' } });
    const hash = await hashPassword(PASSWORD);
    const titular = await prisma.user.create({
      data: { email: correo(TITULAR.alias), name: TITULAR.nombre, role: 'DOCENTE', passwordHash: hash, organizationId: colegio.id },
    });
    await prisma.organizationAdmin.create({ data: { userId: titular.id, organizationId: colegio.id, canManageBilling: true } });
    await prisma.organizationLicense.create({
      data: { organizationId: colegio.id, status: 'TRIAL', declaredStudents: 100, trialEndsAt: new Date(Date.now() + 20 * 86_400_000) },
    });
    const idsDocentes: Record<string, string> = {};
    for (const [nombre, alias, recursos, dias, esAdmin] of DOCENTES) {
      const usuario = await prisma.user.create({
        data: { email: correo(alias), name: nombre, role: 'DOCENTE', passwordHash: hash, organizationId: colegio.id },
      });
      idsDocentes[alias] = usuario.id;
      if (esAdmin) await prisma.organizationAdmin.create({ data: { userId: usuario.id, organizationId: colegio.id } });
      for (let i = 0; i < recursos; i++) {
        // El más reciente de los recursos lleva la fecha de "última actividad".
        const cuando = haceDias((dias ?? 0) + i);
        await prisma.project.create({
          data: { userId: usuario.id, slug: `e2e-orglista-${randomUUID()}`, createdAt: cuando, updatedAt: cuando },
        });
      }
    }
    console.log('✔ 0. fixture: colegio con titular + 9 docentes (2 admins en total con el titular)');

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    if (process.env.KODU_DEBUG) {
      page.on('console', (m) => console.log('[console]', m.type(), m.text()));
      page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    }
    await iniciarSesion(page, { email: correo(TITULAR.alias), password: PASSWORD });
    await page.goto(`${BASE_URL}/org`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle'); // la isla (client:load) tiene que estar hidratada
    const seccion = page.locator('section:has(h2:text-is("Docentes"))');
    await seccion.waitFor({ state: 'visible' });
    await esperarHidratacion(seccion);

    // ── 1. La lista va abajo de todo ──────────────────────────
    const titulos = await page.locator('main h2').allTextContents();
    const ultimo = titulos.map((t) => t.trim()).filter(Boolean).at(-1);
    assert.equal(ultimo, 'Docentes', `la sección "Docentes" tiene que ser la última (los h2 son: ${titulos.join(' | ')})`);
    const yConsumo = (await page.locator('section:has(h2:text-is("Consumo"))').boundingBox())!.y;
    const yDocentes = (await seccion.boundingBox())!.y;
    assert.ok(yDocentes > yConsumo, 'Docentes queda debajo de Consumo');
    console.log('✔ 1. Docentes es la última sección, debajo de Consumo');

    // ── 2. Sin columna Verificación ni columna Admin ──────────
    const encabezados = (await seccion.locator('thead th').allTextContents()).map((t) => t.trim());
    assert.deepEqual(encabezados, ['Docente', 'Recursos', 'Última actividad', 'Acciones'], `encabezados de la tabla (llegó: ${encabezados.join(' | ')})`);
    assert.ok(!(await seccion.textContent())?.includes('Verificado'), 'ninguna fila dice "Verificado"');
    assert.ok(!(await seccion.textContent())?.includes('Sin verificar'), 'ni "Sin verificar"');
    // Etiquetas mínimas pegadas al nombre.
    const filaBruno = seccion.locator('tr', { hasText: correo('bruno') });
    assert.equal(await filaBruno.locator('span:text-is("admin")').count(), 1, 'un admin lleva la etiqueta mínima "admin"');
    const filaTitular = seccion.locator('tr', { hasText: correo(TITULAR.alias) });
    assert.equal(await filaTitular.locator('span:text-is("Facturación")').count(), 1, 'el titular lleva la etiqueta "Facturación"');
    const tamano = await filaBruno.locator('span:text-is("admin")').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(tamano <= 11, `la etiqueta admin es chica (font-size ${tamano}px)`);
    assert.equal(await seccion.locator('tr', { hasText: correo('carla') }).locator('span:text-is("admin")').count(), 0, 'un docente común no lleva etiqueta');
    console.log('✔ 2. sin columna Verificación / Admin; etiquetas "admin" y "Facturación" mínimas junto al nombre');

    // ── 3. Un solo botón por fila: el menú ⋯ ──────────────────
    for (const fila of await seccion.locator('tbody tr').all()) {
      assert.equal(await fila.getByRole('button').count(), 1, 'cada fila tiene un único botón (el menú ⋯)');
    }
    assert.equal(await seccion.getByRole('button', { name: /Dar de baja|Hacer admin|Sacar admin/ }).count(), 0, 'las acciones no están sueltas en la fila');

    const filaCarla = seccion.locator('tr', { hasText: correo('carla') });
    const botonCarla = filaCarla.getByRole('button', { name: 'Acciones para Carla Cruz' });
    assert.equal(await botonCarla.getAttribute('aria-haspopup'), 'menu');
    assert.equal(await botonCarla.getAttribute('aria-expanded'), 'false');
    await botonCarla.click();
    assert.equal(await botonCarla.getAttribute('aria-expanded'), 'true');
    const menu = page.getByRole('menu');
    await menu.waitFor({ state: 'visible' });
    assert.deepEqual(
      (await menu.getByRole('menuitem').allTextContents()).map((t) => t.trim()),
      ['Hacer admin', 'Dar de baja'],
      'docente común de un colegio standalone (sin mover): Hacer admin y Dar de baja',
    );
    const baja = menu.getByRole('menuitem', { name: 'Dar de baja' });
    assert.ok((await baja.getAttribute('class'))?.includes('text-red-600'), '"Dar de baja" va en rojo');
    assert.equal(await menu.getByRole('menuitem').last().textContent(), 'Dar de baja', 'y al final');
    // El foco entra al menú y las flechas lo recorren.
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Hacer admin', 'el foco cae en la primera acción');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Dar de baja');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Hacer admin', 'da la vuelta');
    // Escape cierra y el foco vuelve al botón.
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
    assert.equal(await botonCarla.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Acciones para Carla Cruz', 'el foco vuelve al botón');
    // Click afuera cierra.
    await botonCarla.click();
    await menu.waitFor({ state: 'visible' });
    await page.getByRole('heading', { name: 'Mi organización' }).click();
    await menu.waitFor({ state: 'detached' });
    // Abrir otro menú cierra el anterior.
    await botonCarla.click();
    await seccion.locator('tr', { hasText: correo('diego') }).getByRole('button').click();
    assert.equal(await page.getByRole('menu').count(), 1, 'nunca hay dos menús abiertos');
    await page.keyboard.press('Escape');
    console.log('✔ 3. un único ⋯ por fila: aria, foco, flechas, Escape, click afuera; "Dar de baja" rojo y al final');

    // ── 4. Última fila: el menú no se recorta ─────────────────
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);
    const nombresTodos = await nombres(page);
    const ultimaFila = seccion.locator('tbody tr').last();
    const botonUltima = ultimaFila.getByRole('button');
    await botonUltima.click();
    const menuUltima = page.getByRole('menu');
    await menuUltima.waitFor({ state: 'visible' });
    const cajaMenu = (await menuUltima.boundingBox())!;
    const cajaBoton = (await botonUltima.boundingBox())!;
    const alto = await page.evaluate(() => window.innerHeight);
    assert.ok(cajaMenu.y >= 0 && cajaMenu.y + cajaMenu.height <= alto, `el menú de la última fila entra en pantalla (y=${cajaMenu.y}, h=${cajaMenu.height}, vh=${alto})`);
    assert.ok(cajaMenu.y + cajaMenu.height <= cajaBoton.y + 1, 'y se abre hacia arriba cuando abajo no hay lugar');
    if (DIR_CAPTURAS) {
      mkdirSync(DIR_CAPTURAS, { recursive: true });
      await page.screenshot({ path: `${DIR_CAPTURAS}/menu-ultima-fila-desktop-light.png` });
    }
    await page.keyboard.press('Escape');
    console.log(`✔ 4. menú de la última fila (${nombresTodos.at(-1)}) visible completo, abre hacia arriba`);

    // ── 5. Búsqueda ───────────────────────────────────────────
    await page.evaluate(() => window.scrollTo(0, 0));
    const buscar = seccion.getByRole('searchbox', { name: /Buscar docente/ });
    const cuenta = seccion.getByRole('status');
    assert.equal((await cuenta.textContent())?.trim(), '10 de 10 docentes');
    await buscar.fill('INES');
    assert.deepEqual(await nombres(page), ['Inés Iglesias'], 'busca sin acentos ni mayúsculas ("INES" → Inés)');
    assert.equal((await cuenta.textContent())?.trim(), '1 de 10 docentes');
    await buscar.fill('lucia');
    assert.deepEqual(await nombres(page), ['Lucía Acosta']);
    await buscar.fill(`diego@${dominio}`);
    assert.deepEqual(await nombres(page), ['Diego Díaz'], 'busca por email');
    await buscar.fill('zzzz-nadie');
    assert.ok((await seccion.textContent())?.includes('Ningún docente coincide'), 'estado vacío amigable');
    assert.equal((await cuenta.textContent())?.trim(), '0 de 10 docentes');
    await seccion.getByRole('button', { name: 'Limpiar búsqueda y filtros' }).click();
    assert.equal(await buscar.inputValue(), '', 'limpiar vacía la búsqueda');
    assert.equal((await nombres(page)).length, 10, 'y vuelve la lista completa');
    console.log('✔ 5. búsqueda por nombre / email, sin acentos ni mayúsculas, con conteo y estado vacío');

    // ── 6. Filtros ────────────────────────────────────────────
    const filtro = seccion.getByLabel('Filtrar docentes');
    await filtro.selectOption({ label: 'Admins' });
    assert.deepEqual((await nombres(page)).sort(), ['Bruno Benítez', 'Titular Lista']);
    await filtro.selectOption({ label: 'Docentes' });
    assert.equal((await nombres(page)).length, 8);
    assert.ok(!(await nombres(page)).includes('Bruno Benítez'));
    await filtro.selectOption({ label: 'Sin actividad (30 días)' });
    // Nunca: Lucía, Fede, el titular. Más de 30 días: Carla (40), Gabi (60).
    assert.deepEqual((await nombres(page)).sort(), ['Carla Cruz', 'Fede Funes', 'Gabi Gómez', 'Lucía Acosta', 'Titular Lista']);
    await buscar.fill('gom');
    assert.deepEqual((await nombres(page)).sort(), ['Gabi Gómez'], 'el filtro y la búsqueda se combinan');
    await buscar.fill('');
    await filtro.selectOption({ label: 'Todos' });
    console.log('✔ 6. filtros Admins / Docentes / Sin actividad (y combinados con la búsqueda)');

    // ── 7. Orden ──────────────────────────────────────────────
    const orden = seccion.getByLabel('Ordenar docentes');
    assert.deepEqual((await nombres(page)).slice(0, 3), ['Bruno Benítez', 'Carla Cruz', 'Diego Díaz'], 'por defecto: Nombre A–Z');
    assert.equal((await nombres(page)).at(-1), 'Titular Lista');
    await orden.selectOption({ label: 'Más recursos' });
    assert.deepEqual((await nombres(page)).slice(0, 3), ['Carla Cruz', 'Gabi Gómez', 'Elena Estévez'], 'Más recursos: 5, 4, 3');
    await orden.selectOption({ label: 'Actividad más reciente' });
    assert.deepEqual((await nombres(page)).slice(0, 3), ['Diego Díaz', 'Bruno Benítez', 'Inés Iglesias'], 'Actividad: hoy, 3 días, 5 días');
    assert.deepEqual((await nombres(page)).slice(-3), ['Fede Funes', 'Lucía Acosta', 'Titular Lista'], 'quien nunca hizo nada, al final');
    await orden.selectOption({ label: 'Nombre (A–Z)' });
    console.log('✔ 7. orden: Nombre A–Z, Más recursos, Actividad más reciente');

    // ── 8. Acciones desde el menú ─────────────────────────────
    await seccion.getByLabel('Buscar docente por nombre o email').fill('hugo');
    const filaHugo = seccion.locator('tr', { hasText: correo('hugo') });
    await filaHugo.getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Hacer admin' }).click();
    await filaHugo.locator('span:text-is("admin")').waitFor({ state: 'visible', timeout: 5_000 });
    assert.ok(await prisma.organizationAdmin.findFirst({ where: { userId: idsDocentes.hugo!, organizationId: colegio.id } }), 'Hacer admin crea la fila en la base');
    await filaHugo.getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Sacar admin' }).waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    // El filtro conserva la búsqueda al cambiar de estado.
    assert.equal(await buscar.inputValue(), 'hugo');

    await buscar.fill('fede');
    page.once('dialog', (dialogo) => {
      assert.match(dialogo.message(), /¿Dar de baja a Fede Funes de Colegio Lista E2E/);
      void dialogo.dismiss();
    });
    await seccion.locator('tr', { hasText: correo('fede') }).getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Dar de baja' }).click();
    await page.waitForTimeout(300);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: idsDocentes.fede! } })).organizationId, colegio.id, 'cancelar la confirmación no da de baja');
    page.once('dialog', (dialogo) => void dialogo.accept());
    await seccion.locator('tr', { hasText: correo('fede') }).getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Dar de baja' }).click();
    await seccion.locator('tr', { hasText: correo('fede') }).waitFor({ state: 'detached', timeout: 5_000 });
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: idsDocentes.fede! } })).organizationId, null, 'aceptar da de baja');
    await buscar.fill('');
    assert.equal((await cuenta.textContent())?.trim(), '9 de 9 docentes', 'el conteo se actualiza');
    console.log('✔ 8. Hacer admin / Dar de baja (con confirmación) desde el menú');

    // ── 9. El superadmin sigue viendo la verificación en /admin ─
    const superadminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const superadmin = await superadminCtx.newPage();
    await iniciarSesion(superadmin, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await superadmin.goto(`${BASE_URL}/admin/organizaciones/${colegio.id}`, { waitUntil: 'domcontentloaded' });
    await superadmin.waitForLoadState('networkidle');
    const seccionAdmin = superadmin.locator('section:has(h2:text-is("Docentes"))');
    await seccionAdmin.waitFor({ state: 'visible' });
    await esperarHidratacion(seccionAdmin);
    assert.ok((await seccionAdmin.locator('thead th').allTextContents()).map((t) => t.trim()).includes('Verificación'), '/admin conserva la columna Verificación');
    assert.equal(await seccionAdmin.getByLabel('Buscar docente por nombre o email').count(), 1, 'y comparte la barra de búsqueda');
    await seccionAdmin.locator('tr', { hasText: correo('carla') }).getByRole('button', { name: /^Acciones para/ }).click();
    assert.deepEqual(
      (await superadmin.getByRole('menuitem').allTextContents()).map((t) => t.trim()),
      ['Hacer admin', 'Mover a otra sede', 'Dar de baja'],
      'el superadmin además puede mover',
    );
    await superadmin.keyboard.press('Escape');
    console.log('✔ 9. /admin/organizaciones/[id]: sigue mostrando Verificación, con el mismo menú y barra');

    // ── 10. Capturas y 390px ──────────────────────────────────
    for (const tema of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${BASE_URL}/org`, { waitUntil: 'domcontentloaded' });
      await conTema(page, tema);
      await page.waitForLoadState('networkidle');
      assert.ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `desktop ${tema}: sin scroll horizontal`);
      if (DIR_CAPTURAS) await seccion.screenshot({ path: `${DIR_CAPTURAS}/docentes-desktop-${tema}.png` });

      const { frame, handle } = await entrarAIframe390(page, `${BASE_URL}/org`);
      assert.ok(!(await frame.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `390px ${tema}: sin scroll horizontal`);
      const seccion390 = frame.locator('section:has(h2:text-is("Docentes"))');
      await esperarHidratacion(seccion390);
      assert.equal((await nombres(frame)).length, 9, '390px: una tarjeta por docente');
      assert.ok(!(await seccion390.textContent())?.includes('Verificación'), '390px: sin Verificación');
      if (DIR_CAPTURAS) await handle.screenshot({ path: `${DIR_CAPTURAS}/pagina-390-${tema}.png` });
      if (tema === 'dark') {
        // Menú de la última tarjeta con el alto de un celular real (780px).
        await handle.evaluate((el: HTMLIFrameElement) => {
          el.style.height = '780px';
        });
        await frame.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(150);
        const ultima = seccion390.locator('.kodu-card').last();
        await ultima.getByRole('button').click();
        const menu390 = frame.getByRole('menu');
        await menu390.waitFor({ state: 'visible' });
        const m = (await menu390.boundingBox())!;
        const marco = (await handle.boundingBox())!;
        assert.ok(m.x >= marco.x && m.x + m.width <= marco.x + 390, `390px: el menú no se sale por los costados (x=${m.x - marco.x}, w=${m.width})`);
        assert.ok(m.y >= marco.y && m.y + m.height <= marco.y + 780, '390px: el menú de la última tarjeta entra en pantalla');
        if (DIR_CAPTURAS) await handle.screenshot({ path: `${DIR_CAPTURAS}/menu-ultima-fila-390-dark.png` });
        await page.keyboard.press('Escape');
      }
    }
    console.log('✔ 10. 390px (claro y oscuro): sin scroll horizontal, tarjetas, sin Verificación, menú dentro de la pantalla');
  } finally {
    await browser.close();
    await limpiar();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
