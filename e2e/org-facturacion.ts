import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, conTema, iniciarSesion } from './harness.ts';
import type { Frame, Page } from 'playwright';

/**
 * Verificación de odd/tasks/org-admin-facturacion.md: "Admin" vs "Admin con
 * facturación".
 *
 * Fixture (todo con el sufijo de la corrida, se borra al empezar y al final):
 *  - Colegio standalone S: `titular` (admin CON facturación, el creador),
 *    `coord` (docente que el titular promueve a admin), `profe` (docente).
 *  - Red N con sedes N1/N2: `redTitular` (admin de N con facturación, docente
 *    de N1), `redCoord` (admin de N sin facturación, docente de N1),
 *    `sedeAdmin` (admin sólo de N1), `profeN2` (docente de N2).
 *  - Colegio standalone S2 sin ningún admin (alta del primer admin por el
 *    superadmin).
 *
 * Corre con: KODU_BASE_URL=http://localhost:3300 npx tsx e2e/org-facturacion.ts
 * Capturas (opcionales): KODU_CAPTURAS_DIR=/ruta
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const PASSWORD = 'Docente.OrgFact.E2E.2026';

const SUFIJO = randomUUID().slice(0, 8);
const correo = (alias: string) => `${alias}-orgfact-e2e-${SUFIJO}@orgfact-e2e.local`;
const EMAILS = {
  titular: correo('titular'),
  coord: correo('coord'),
  profe: correo('profe'),
  redTitular: correo('red-titular'),
  redCoord: correo('red-coord'),
  sedeAdmin: correo('sede-admin'),
  profeN2: correo('profe-n2'),
  s2Profe: correo('s2-profe'),
  s2Profe2: correo('s2-profe2'),
};

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const ids: Record<string, string> = {};
const orgs = { s: '', red: '', n1: '', n2: '', s2: '' };

async function limpiarEstado(): Promise<void> {
  const usuarios = await prisma.user.findMany({ where: { email: { in: Object.values(EMAILS) } }, select: { id: true } });
  const userIds = usuarios.map((u) => u.id);
  if (userIds.length > 0) await prisma.organizationAdmin.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
  await prisma.organization.deleteMany({ where: { name: { contains: SUFIJO }, parentId: { not: null } } });
  await prisma.organization.deleteMany({ where: { name: { contains: SUFIJO } } });
}

async function crearUsuario(alias: keyof typeof EMAILS, nombre: string, organizationId: string): Promise<void> {
  const fila = await prisma.user.create({
    data: { email: EMAILS[alias], name: nombre, role: 'DOCENTE', passwordHash: await hashPassword(PASSWORD), organizationId },
    select: { id: true },
  });
  ids[alias] = fila.id;
}

async function crearLicencia(organizationId: string): Promise<void> {
  await prisma.organizationLicense.create({
    data: { organizationId, status: 'TRIAL', declaredStudents: 100, trialEndsAt: new Date(Date.now() + 20 * 86_400_000) },
  });
}

async function filaAdmin(alias: string, organizationId: string) {
  return prisma.organizationAdmin.findUnique({
    where: { userId_organizationId: { userId: ids[alias]!, organizationId } },
    select: { canManageBilling: true },
  });
}

interface Respuesta {
  status: number;
  json: Record<string, unknown>;
  location: string | null;
}

async function llamar(page: Page, metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', ruta: string, data?: unknown): Promise<Respuesta> {
  const respuesta = await page.request.fetch(`${BASE_URL}${ruta}`, {
    method: metodo,
    // Astro rechaza un DELETE/POST sin body como "form submission" cross-site:
    // el cliente real (apiRequest) manda siempre JSON, acá también.
    ...(metodo === 'GET' ? {} : { data: data ?? {} }),
    maxRedirects: 0,
  });
  const json = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: respuesta.status(), json, location: respuesta.headers()['location'] ?? null };
}

async function sesion(browser: Awaited<ReturnType<typeof abrirNavegador>>, email: string, password = PASSWORD): Promise<Page> {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  await iniciarSesion(page, { email, password });
  return page;
}

async function html(page: Page, ruta: string): Promise<string> {
  return (await page.request.get(`${BASE_URL}${ruta}`)).text();
}

/** Las 5 rutas de facturación: ninguna debe dejar pasar a quien no es titular. */
async function rutasDeFacturacion(page: Page): Promise<Respuesta[]> {
  return [
    await llamar(page, 'GET', '/api/billing/org/preview?interval=MONTHLY'),
    await llamar(page, 'POST', '/api/billing/org/matricula', { declaredStudents: 120 }),
    await llamar(page, 'POST', '/api/billing/org/checkout', {
      interval: 'MONTHLY',
      legalName: 'Escuela E2E SRL',
      cuit: '20123456786',
      ivaCondition: 'MONOTRIBUTO',
    }),
    await llamar(page, 'POST', '/api/billing/org/cancel', {}),
    await llamar(page, 'POST', '/api/billing/org/renovar', {}),
  ];
}

const DIR_CAPTURAS = process.env.KODU_CAPTURAS_DIR ?? '';

async function entrarAIframe390(page: Page, url: string): Promise<{ frame: Frame; handle: import('playwright').ElementHandle }> {
  await page.setContent(
    `<!doctype html><html><body style="margin:0;padding:0;background:#0000"><iframe id="f" style="display:block;width:390px;height:3200px;border:0"></iframe></body></html>`,
  );
  const handle = (await page.$('#f'))!;
  await handle.evaluate((el: HTMLIFrameElement, src: string) => {
    el.src = src;
  }, url);
  const frame = await handle.contentFrame();
  if (!frame) throw new Error('no se pudo entrar al iframe de 390px');
  await frame.waitForLoadState('load');
  await frame.waitForSelector('h1, h2', { timeout: 5_000 });
  await frame.waitForTimeout(500);
  return { frame, handle };
}

async function capturar(page: Page, ruta: string, etiqueta: string): Promise<void> {
  if (!DIR_CAPTURAS) return;
  mkdirSync(DIR_CAPTURAS, { recursive: true });
  const url = `${BASE_URL}${ruta}`;
  for (const [tema, ancho] of [['light', 1280], ['dark', 390]] as const) {
    if (ancho === 1280) {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await conTema(page, tema);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${DIR_CAPTURAS}/${etiqueta}-desktop-${tema}.png`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.ok(!overflow, `${etiqueta} (desktop): sin scroll horizontal`);
    } else {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await conTema(page, tema);
      const { frame, handle } = await entrarAIframe390(page, url);
      await handle.screenshot({ path: `${DIR_CAPTURAS}/${etiqueta}-390-${tema}.png` });
      const overflow = await frame.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.ok(!overflow, `${etiqueta} (390px): sin scroll horizontal`);
    }
  }
}

async function main(): Promise<void> {
  await limpiarEstado();
  const browser = await abrirNavegador();

  try {
    // ── Fixture ──────────────────────────────────────────────
    const s = await prisma.organization.create({ data: { name: `Colegio S OrgFact ${SUFIJO}`, kind: 'CAMPUS' } });
    const red = await prisma.organization.create({ data: { name: `Red OrgFact ${SUFIJO}`, kind: 'NETWORK' } });
    const n1 = await prisma.organization.create({ data: { name: `Sede N1 OrgFact ${SUFIJO}`, kind: 'CAMPUS', parentId: red.id } });
    const n2 = await prisma.organization.create({ data: { name: `Sede N2 OrgFact ${SUFIJO}`, kind: 'CAMPUS', parentId: red.id } });
    const s2 = await prisma.organization.create({ data: { name: `Colegio S2 OrgFact ${SUFIJO}`, kind: 'CAMPUS' } });
    Object.assign(orgs, { s: s.id, red: red.id, n1: n1.id, n2: n2.id, s2: s2.id });
    await crearLicencia(s.id);
    await crearLicencia(red.id);
    await crearLicencia(s2.id);

    await crearUsuario('titular', 'Titular OrgFact', s.id);
    await crearUsuario('coord', 'Coordinadora OrgFact', s.id);
    await crearUsuario('profe', 'Profe OrgFact', s.id);
    await crearUsuario('redTitular', 'Titular Red OrgFact', n1.id);
    await crearUsuario('redCoord', 'Coordinadora Red OrgFact', n1.id);
    await crearUsuario('sedeAdmin', 'Admin Sede OrgFact', n1.id);
    await crearUsuario('profeN2', 'Profe N2 OrgFact', n2.id);
    await crearUsuario('s2Profe', 'Profe S2 OrgFact', s2.id);
    await crearUsuario('s2Profe2', 'Profe S2b OrgFact', s2.id);

    await prisma.organizationAdmin.create({ data: { userId: ids.titular!, organizationId: s.id, canManageBilling: true } });
    await prisma.organizationAdmin.create({ data: { userId: ids.redTitular!, organizationId: red.id, canManageBilling: true } });
    await prisma.organizationAdmin.create({ data: { userId: ids.redCoord!, organizationId: red.id } });
    await prisma.organizationAdmin.create({ data: { userId: ids.sedeAdmin!, organizationId: n1.id } });
    console.log('✔ 0. fixture: colegio S, red N (N1/N2), colegio S2 sin admins');

    const titular = await sesion(browser, EMAILS.titular);
    const coord = await sesion(browser, EMAILS.coord);
    const superadmin = await sesion(browser, ADMIN_EMAIL, ADMIN_PASSWORD);

    // ── 1. El titular lo ve y lo usa todo ────────────────────
    const planTitular = await html(titular, '/org/plan');
    assert.ok(planTitular.includes('Matrícula y facturación'), 'el titular debe ver /org/plan completo');
    const orgTitular = await html(titular, '/org');
    assert.ok(orgTitular.includes('Plan y facturación'), 'el titular ve el link a Plan y facturación');
    const previewTitular = await llamar(titular, 'GET', '/api/billing/org/preview?interval=MONTHLY');
    assert.equal(previewTitular.status, 200, `el titular llama a /api/billing/org/preview (llegó ${previewTitular.status}: ${JSON.stringify(previewTitular.json)})`);
    const matriculaTitular = await llamar(titular, 'POST', '/api/billing/org/matricula', { declaredStudents: 100 });
    assert.equal(matriculaTitular.status, 200, 'el titular llama a /api/billing/org/matricula');
    console.log('✔ 1. el creador ve /org/plan, el link y puede llamar a la API de facturación');

    // ── 2. Promoción: el coordinador NO nace con facturación ─
    const promo = await llamar(titular, 'POST', `/api/org/organizaciones/${s.id}/admins`, { userId: ids.coord });
    assert.equal(promo.status, 200);
    assert.equal(promo.json.canManageBilling, false, 'promover por un admin nunca da facturación');
    assert.equal((await filaAdmin('coord', s.id))?.canManageBilling, false);
    console.log('✔ 2. promover a admin crea canManageBilling = false');

    // ── 3. El coordinador no ve nada de facturación ──────────
    const orgCoord = await html(coord, '/org');
    assert.ok(orgCoord.includes('Mi organización'), 'el coordinador sigue siendo admin: ve /org');
    assert.ok(!orgCoord.includes('Plan y facturación'), 'el coordinador NO ve el link a Plan y facturación');
    assert.ok(!orgCoord.includes('href="/org/plan"'), 'ningún enlace a /org/plan (tampoco el del header)');
    const planCoord = await llamar(coord, 'GET', '/org/plan');
    assert.equal(planCoord.status, 302, '/org/plan redirige al coordinador');
    assert.ok(planCoord.location?.endsWith('/app'), `... a /app, igual que a un extraño (fue a ${planCoord.location})`);
    const extrano = await sesion(browser, EMAILS.profe);
    const planExtrano = await llamar(extrano, 'GET', '/org/plan');
    assert.equal(planExtrano.status, planCoord.status, 'mismo status que un extraño');
    assert.equal(planExtrano.location, planCoord.location, 'mismo destino que un extraño');
    const coordApi = await rutasDeFacturacion(coord);
    const extranoApi = await rutasDeFacturacion(extrano);
    coordApi.forEach((respuesta, i) => {
      assert.equal(respuesta.status, 404, `API de facturación #${i}: el coordinador recibe 404 (llegó ${respuesta.status})`);
      assert.deepEqual(respuesta.json, extranoApi[i]!.json, `API #${i}: misma respuesta que un extraño`);
      assert.equal(extranoApi[i]!.status, 404);
    });
    console.log('✔ 3. el coordinador: sin link, /org/plan redirige y las 5 APIs de facturación dan 404 (= extraño)');

    // ── 4. Protección del titular (servidor) ─────────────────
    const demote = await llamar(coord, 'DELETE', `/api/org/organizaciones/${s.id}/admins/${ids.titular}`);
    assert.equal(demote.status, 403, 'el coordinador no puede sacarle el admin al titular');
    const baja = await llamar(coord, 'DELETE', `/api/org/miembros/${ids.titular}`);
    assert.equal(baja.status, 403, 'ni darlo de baja');
    const sebaja = await llamar(coord, 'PATCH', `/api/org/organizaciones/${s.id}/admins/${ids.coord}`, { canManageBilling: true });
    assert.equal(sebaja.status, 403, 'ni darse facturación a sí mismo');
    const quitaTitular = await llamar(coord, 'PATCH', `/api/org/organizaciones/${s.id}/admins/${ids.titular}`, { canManageBilling: false });
    assert.equal(quitaTitular.status, 403, 'ni quitársela al titular');
    assert.equal((await filaAdmin('titular', s.id))?.canManageBilling, true, 'el titular sigue intacto');
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: ids.titular! } })).organizationId, s.id, 'y sigue en su sede');
    console.log('✔ 4. el coordinador no puede sacar admin, dar de baja ni tocar la facturación del titular (403)');

    // ── 5. UI del coordinador: insignia, sin botones sobre el titular ─
    await coord.setViewportSize({ width: 1280, height: 900 });
    await coord.goto(`${BASE_URL}/org`, { waitUntil: 'domcontentloaded' });
    const filaTitular = coord.locator('tr', { hasText: EMAILS.titular });
    await filaTitular.waitFor({ state: 'visible' });
    assert.ok((await filaTitular.textContent())?.includes('Facturación'), 'el titular lleva la insignia "Facturación"');
    assert.equal(await filaTitular.getByRole('button').count(), 0, 'el coordinador no ve ningún botón sobre el titular');
    const filaProfe = coord.locator('tr', { hasText: EMAILS.profe });
    assert.ok((await filaProfe.getByRole('button', { name: 'Dar de baja' }).count()) === 1, 'sí ve "Dar de baja" sobre un docente común');
    assert.equal(await coord.getByRole('button', { name: /facturación/i }).count(), 0, 'el coordinador no ve el control Dar/Quitar facturación');
    console.log('✔ 5. UI del coordinador: insignia en el titular y sus botones ocultos');

    // ── 6. El titular reparte y la última no se puede quitar ─
    const soloTitular = await llamar(titular, 'PATCH', `/api/org/organizaciones/${s.id}/admins/${ids.titular}`, { canManageBilling: false });
    assert.equal(soloTitular.status, 409, 'no se puede quitar el último titular');
    assert.match(String(soloTitular.json.error), /al menos un admin con facturación/);
    const soloDemote = await llamar(titular, 'DELETE', `/api/org/organizaciones/${s.id}/admins/${ids.titular}`);
    assert.equal(soloDemote.status, 409, `ni sacarse el admin siendo el último titular (${JSON.stringify(soloDemote.json)})`);
    const soloBaja = await llamar(titular, 'DELETE', `/api/org/miembros/${ids.titular}`);
    assert.equal(soloBaja.status, 409, 'ni darse de baja');
    const mal = await llamar(titular, 'PATCH', `/api/org/organizaciones/${s.id}/admins/${ids.coord}`, { canManageBilling: 'si' });
    assert.equal(mal.status, 422, 'el body tiene que ser JSON con un booleano');
    const noAdmin = await llamar(titular, 'PATCH', `/api/org/organizaciones/${s.id}/admins/${ids.profe}`, { canManageBilling: true });
    assert.equal(noAdmin.status, 404, 'el destino tiene que ser admin de la raíz');
    assert.equal((await filaAdmin('profe', s.id)), null, 'y no se lo crea de rebote');
    const sedeDeRed = await llamar(titular, 'PATCH', `/api/org/organizaciones/${n1.id}/admins/${ids.sedeAdmin}`, { canManageBilling: true });
    assert.equal(sedeDeRed.status, 404, 'un titular ajeno no puede tocar otra institución (404)');

    const otorga = await llamar(titular, 'PATCH', `/api/org/organizaciones/${s.id}/admins/${ids.coord}`, { canManageBilling: true });
    assert.equal(otorga.status, 200);
    assert.equal((await filaAdmin('coord', s.id))?.canManageBilling, true);
    console.log('✔ 6. el titular no puede quedarse sin titular; valida body y destino; otorga facturación');

    // ── 7. Ahora el coordinador sí la ve ─────────────────────
    assert.ok((await html(coord, '/org/plan')).includes('Matrícula y facturación'), 'con facturación, /org/plan abre');
    assert.ok((await html(coord, '/org')).includes('Plan y facturación'), 'y aparece el link');
    const coordApi2 = await llamar(coord, 'GET', '/api/billing/org/preview?interval=MONTHLY');
    assert.equal(coordApi2.status, 200, 'y la API responde');

    // Con dos titulares, cualquiera puede quitarle a otro; el último sigue protegido.
    const coordQuitaTitular = await llamar(coord, 'PATCH', `/api/org/organizaciones/${s.id}/admins/${ids.titular}`, { canManageBilling: false });
    assert.equal(coordQuitaTitular.status, 200, 'un titular puede quitarle la facturación a otro si queda alguien');
    const coordSola = await llamar(coord, 'PATCH', `/api/org/organizaciones/${s.id}/admins/${ids.coord}`, { canManageBilling: false });
    assert.equal(coordSola.status, 409, 'ahora la coordinadora es la última: no se la puede quitar');
    // El ex titular quedó como admin común: ya no ve el plan y no puede tocar a la titular.
    assert.equal((await llamar(titular, 'GET', '/org/plan')).status, 302, 'el ex titular ya no entra al plan');
    assert.equal((await llamar(titular, 'DELETE', `/api/org/organizaciones/${s.id}/admins/${ids.coord}`)).status, 403, 'ni puede sacarle el admin');
    const devuelve = await llamar(coord, 'PATCH', `/api/org/organizaciones/${s.id}/admins/${ids.titular}`, { canManageBilling: true });
    assert.equal(devuelve.status, 200, 'la coordinadora le devuelve la facturación');
    console.log('✔ 7. con facturación entra al plan y a la API; el último titular sigue protegido; se puede devolver');

    // ── 8. UI del titular: control de facturación en la lista ─
    await titular.setViewportSize({ width: 1280, height: 900 });
    await titular.goto(`${BASE_URL}/org`, { waitUntil: 'domcontentloaded' });
    await titular.waitForLoadState('networkidle'); // la isla (client:load) tiene que estar hidratada
    const filaCoord = titular.locator('tr', { hasText: EMAILS.coord });
    await filaCoord.waitFor({ state: 'visible' });
    await filaCoord.getByRole('button', { name: 'Quitar facturación' }).click();
    await filaCoord.getByRole('button', { name: 'Dar facturación' }).waitFor({ state: 'visible', timeout: 5_000 });
    assert.equal((await filaAdmin('coord', s.id))?.canManageBilling, false, 'el botón quita la facturación en la base');
    await filaCoord.getByRole('button', { name: 'Dar facturación' }).click();
    await filaCoord.getByRole('button', { name: 'Quitar facturación' }).waitFor({ state: 'visible', timeout: 5_000 });
    assert.equal((await filaAdmin('coord', s.id))?.canManageBilling, true, 'y la vuelve a dar');
    console.log('✔ 8. UI del titular: Dar/Quitar facturación funciona');

    // ── 9. Red: el titular de la red es docente de N1 ────────
    const redTitular = await sesion(browser, EMAILS.redTitular);
    const redCoord = await sesion(browser, EMAILS.redCoord);
    const sedeAdmin = await sesion(browser, EMAILS.sedeAdmin);

    const redTitularHtml = await html(redTitular, '/org');
    assert.ok(redTitularHtml.includes('Plan y facturación'), 'el titular de la red ve el link');
    assert.ok(redTitularHtml.includes('Admins de la red'), 'y la lista de admins de la red');
    const redCoordHtml = await html(redCoord, `/org?sede=${red.id}`);
    assert.ok(redCoordHtml.includes('Admins de la red'), 'el admin de red sin facturación ve la lista de admins');
    assert.ok(redCoordHtml.includes('Ve y gestiona el plan'), '... con la insignia del titular');
    assert.ok(!redCoordHtml.includes('Plan y facturación'), '... pero no el link al plan');
    assert.equal((await llamar(redCoord, 'GET', '/org/plan')).status, 302);
    assert.equal((await llamar(redCoord, 'GET', `/org/plan?sede=${n1.id}`)).status, 302);
    assert.equal((await llamar(sedeAdmin, 'GET', `/org/plan?sede=${n1.id}`)).status, 302, 'un admin de sede ya no ve el plan ni en lectura');
    assert.equal((await llamar(sedeAdmin, 'GET', `/org/plan?sede=${n2.id}`)).status, 404, 'y una sede ajena sigue dando 404');
    for (const [alias, pagina] of [['admin de red sin facturación', redCoord], ['admin de sede', sedeAdmin]] as const) {
      (await rutasDeFacturacion(pagina)).forEach((respuesta, i) => assert.equal(respuesta.status, 404, `${alias}: API de facturación #${i} da 404`));
    }
    const previewRed = await llamar(redTitular, 'GET', '/api/billing/org/preview?interval=MONTHLY');
    assert.equal(previewRed.status, 200, `el titular de la red pasa la guarda de la API (llegó ${previewRed.status})`);
    console.log('✔ 9. red: ni el admin de red sin facturación ni el de sede ven el plan; el titular de red sí');

    // Protección del titular de red, mirado desde una sede y desde la red.
    const moverTitular = await llamar(redCoord, 'PATCH', `/api/org/miembros/${ids.redTitular}`, { destinoCampusId: n2.id });
    assert.equal(moverTitular.status, 403, 'un admin de red sin facturación no puede mover al titular');
    assert.equal((await llamar(redCoord, 'DELETE', `/api/org/miembros/${ids.redTitular}`)).status, 403, 'ni darlo de baja');
    assert.equal((await llamar(redCoord, 'DELETE', `/api/org/organizaciones/${red.id}/admins/${ids.redTitular}`)).status, 403, 'ni sacarle el admin de la red');
    assert.equal((await llamar(sedeAdmin, 'DELETE', `/api/org/miembros/${ids.redTitular}`)).status, 403, 'el admin de la sede N1 tampoco puede darlo de baja de N1');
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: ids.redTitular! } })).organizationId, n1.id, 'el titular de red sigue en N1');

    await sedeAdmin.setViewportSize({ width: 1280, height: 900 });
    await sedeAdmin.goto(`${BASE_URL}/org?sede=${n1.id}`, { waitUntil: 'domcontentloaded' });
    const filaRedTitular = sedeAdmin.locator('tr', { hasText: EMAILS.redTitular });
    await filaRedTitular.waitFor({ state: 'visible' });
    assert.ok((await filaRedTitular.textContent())?.includes('Facturación'), 'el titular de la red lleva la insignia en la lista de N1');
    assert.equal(await filaRedTitular.getByRole('button').count(), 0, 'y el admin de sede no ve botones sobre él');
    assert.ok((await sedeAdmin.locator('tr', { hasText: EMAILS.redCoord }).getByRole('button', { name: 'Dar de baja' }).count()) === 1, 'pero sí sobre un docente común');
    console.log('✔ 10. el titular de la red está protegido (API y UI) también desde la lista de una sede');

    // El titular de red reparte desde la vista de la red.
    await redTitular.setViewportSize({ width: 1280, height: 900 });
    await redTitular.goto(`${BASE_URL}/org?sede=${red.id}`, { waitUntil: 'domcontentloaded' });
    await redTitular.waitForLoadState('networkidle'); // la isla (client:load) tiene que estar hidratada
    const itemRedCoord = redTitular.locator('li', { hasText: EMAILS.redCoord });
    await itemRedCoord.getByRole('button', { name: 'Dar facturación' }).click();
    await itemRedCoord.getByRole('button', { name: 'Quitar facturación' }).waitFor({ state: 'visible', timeout: 5_000 });
    assert.equal((await filaAdmin('redCoord', red.id))?.canManageBilling, true);
    assert.equal((await llamar(redCoord, 'GET', '/org/plan')).status, 200, 'la admin de red ahora ve el plan');
    assert.equal((await llamar(redCoord, 'GET', '/api/billing/org/preview?interval=MONTHLY')).status, 200);
    const unicoRed = await llamar(redCoord, 'PATCH', `/api/org/organizaciones/${red.id}/admins/${ids.redCoord}`, { canManageBilling: false });
    assert.equal(unicoRed.status, 200, 'con dos titulares se puede quitar una');
    console.log('✔ 11. el titular de la red reparte la facturación desde la vista de red');
    // (dejamos a redCoord sin facturación otra vez: el último vuelve a estar protegido)

    // ── 12. Superadmin: el primer admin de una raíz recibe facturación ─
    const primero = await llamar(superadmin, 'POST', `/api/admin/organizaciones/${s2.id}/admins`, { userId: ids.s2Profe });
    assert.equal(primero.status, 200);
    assert.equal(primero.json.canManageBilling, true, 'el primer admin que nombra el superadmin recibe la facturación');
    const segundo = await llamar(superadmin, 'POST', `/api/admin/organizaciones/${s2.id}/admins`, { userId: ids.s2Profe2 });
    assert.equal(segundo.json.canManageBilling, false, 'el segundo ya no');
    const sedeDeRedPromo = await llamar(superadmin, 'POST', `/api/admin/organizaciones/${n2.id}/admins`, { userId: ids.profeN2 });
    assert.equal(sedeDeRedPromo.json.canManageBilling, false, 'una sede de una red nunca recibe facturación (vive en la raíz)');

    // El detalle del superadmin muestra la insignia.
    await superadmin.setViewportSize({ width: 1280, height: 900 });
    await superadmin.goto(`${BASE_URL}/admin/organizaciones/${s2.id}`, { waitUntil: 'domcontentloaded' });
    const itemS2 = superadmin.locator('li', { hasText: EMAILS.s2Profe });
    await itemS2.first().waitFor({ state: 'visible' });
    assert.ok((await itemS2.first().textContent())?.includes('Facturación'), 'el superadmin ve la insignia en la lista de admins');
    const itemS2b = superadmin.locator('li', { hasText: EMAILS.s2Profe2 });
    assert.ok(!(await itemS2b.first().textContent())?.includes('Facturación'), 'y no en el admin común');
    console.log('✔ 12. superadmin: el primer admin de una raíz recibe facturación, el resto no; insignia en /admin');

    // ── 13. Capturas ─────────────────────────────────────────
    await capturar(titular, '/org', 'org-titular');
    await capturar(coord, '/org', 'org-coordinador-con-facturacion');
    await prisma.organizationAdmin.update({
      where: { userId_organizationId: { userId: ids.coord!, organizationId: s.id } },
      data: { canManageBilling: false },
    });
    await capturar(coord, '/org', 'org-coordinador');
    await capturar(redTitular, `/org?sede=${red.id}`, 'org-red-titular');
    await capturar(redCoord, `/org?sede=${red.id}`, 'org-red-coordinador');
    if (DIR_CAPTURAS) console.log(`✔ 13. capturas en ${DIR_CAPTURAS}`);
  } finally {
    await browser.close();
    await limpiarEstado();
    await prisma.$disconnect();
  }
  console.log('\n✅ org-facturacion: todo OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
