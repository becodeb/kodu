import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma, type UsagePurpose } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, conTema, iniciarSesion } from './harness.ts';
import { consumoDelPanel, docentesDelPanel, serieDelPanel } from '../src/lib/orgs/panel.ts';
import type { Frame, Page } from 'playwright';

/**
 * Verificación de T8 (odd/tasks/organizaciones.md): panel de la organización
 * (`/org`).
 *
 * Fixture: una red N (E2E OrgPanel) con dos sedes N1/N2, más una sede
 * standalone S (para probar aislamiento fuera de la red). `adminN1` es admin
 * de N1 únicamente; `adminRed` es admin de N. `profeA` sólo tiene actividad
 * en N1; `profeMovido` tiene una fila de TokenUsage en N1 (ANTES de
 * moverse) y otra en N2 (DESPUÉS, con costo NULL) — mismo mes, para probar
 * que el costo queda congelado en la sede donde se pagó (T1/T5) tanto en el
 * agregado por sede como en el desglose por docente.
 *
 * Mes de fixture aislado ("2026-02"): el resto de la base de esta worktree
 * sólo tiene actividad de 2026-01 (T7) y 2026-09 (T1-T6), así que ninguna
 * fila ajena contamina las cifras calculadas a mano.
 *
 * Corre con: KODU_BASE_URL=http://localhost:3100 npx tsx e2e/org-panel.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const PASSWORD = 'Docente.OrgPanel.E2E.2026';
const MES_FIXTURE = '2026-02';

const SUFIJO = randomUUID().slice(0, 8);
const EMAIL_ADMIN_N1 = `admin-n1-orgpanel-e2e-${SUFIJO}@orgpanel-e2e.local`;
const EMAIL_ADMIN_RED = `admin-red-orgpanel-e2e-${SUFIJO}@orgpanel-e2e.local`;
const EMAIL_PROFE_A = `profe-a-orgpanel-e2e-${SUFIJO}@orgpanel-e2e.local`;
const EMAIL_PROFE_MOVIDO = `profe-movido-orgpanel-e2e-${SUFIJO}@orgpanel-e2e.local`;
const EMAIL_PROFE_PLANO = `profe-plano-orgpanel-e2e-${SUFIJO}@orgpanel-e2e.local`;
const EMAIL_PROFE_S = `profe-s-orgpanel-e2e-${SUFIJO}@orgpanel-e2e.local`;
const EMAIL_WHITELIST = `nuevo-whitelist-orgpanel-e2e-${SUFIJO}@afuera-orgpanel-e2e.local`;
const TITULO_RECURSO_SECRETO = `Recurso secreto OrgPanel ${SUFIJO}`;

const TODOS_LOS_EMAILS = [
  EMAIL_ADMIN_N1,
  EMAIL_ADMIN_RED,
  EMAIL_PROFE_A,
  EMAIL_PROFE_MOVIDO,
  EMAIL_PROFE_PLANO,
  EMAIL_PROFE_S,
  EMAIL_WHITELIST,
];

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

function d(valor: string): Prisma.Decimal {
  return new Prisma.Decimal(valor);
}

const orgIds = { red: '', n1: '', n2: '', standalone: '' };
const userIds: Record<string, string> = {};

async function limpiarEstado(): Promise<void> {
  const usuarios = await prisma.user.findMany({ where: { email: { in: TODOS_LOS_EMAILS } }, select: { id: true } });
  const ids = usuarios.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.tokenUsage.deleteMany({ where: { userId: { in: ids } } });
    await prisma.project.deleteMany({ where: { userId: { in: ids } } });
    await prisma.organizationAdmin.deleteMany({ where: { userId: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { in: TODOS_LOS_EMAILS } } });
  await prisma.organizationAllowedEmail.deleteMany({ where: { email: EMAIL_WHITELIST } });
  await prisma.organization.deleteMany({ where: { name: { contains: SUFIJO } } });
}

async function crearUsuario(email: string, nombre: string, organizationId: string | null): Promise<string> {
  const fila = await prisma.user.upsert({
    where: { email },
    update: { role: 'DOCENTE', organizationId, passwordHash: await hashPassword(PASSWORD) },
    create: { email, name: nombre, role: 'DOCENTE', passwordHash: await hashPassword(PASSWORD), organizationId },
    select: { id: true },
  });
  return fila.id;
}

async function crearProyecto(userId: string, title?: string): Promise<string> {
  const proyecto = await prisma.project.create({
    data: { userId, slug: `e2e-orgpanel-${randomUUID()}`, ...(title ? { title } : {}) },
    select: { id: true },
  });
  return proyecto.id;
}

interface FilaSembrada {
  userId: string;
  organizationId: string;
  purpose: UsagePurpose;
  forNewResource: boolean;
  projectId: string;
  costUsd: string | null;
  createdAt: Date;
}

async function sembrarFila(fila: FilaSembrada): Promise<void> {
  await prisma.tokenUsage.create({
    data: {
      userId: fila.userId,
      organizationId: fila.organizationId,
      purpose: fila.purpose,
      forNewResource: fila.forNewResource,
      projectId: fila.projectId,
      model: 'e2e-orgpanel',
      promptTokens: 100,
      completionTokens: 40,
      cachedInputTokens: 0,
      costUsd: fila.costUsd === null ? null : d(fila.costUsd),
      createdAt: fila.createdAt,
    },
  });
}

function fechaFixture(diaMes: string): Date {
  return new Date(`${MES_FIXTURE}-${diaMes}T12:00:00-03:00`);
}

// ─────────────────────────────────────────────────────────────
// 390px vía iframe (chromium-headless-500px-clamp.md) — mismo arnés que
// admin-organizaciones.ts / admin-metricas.ts.
// ─────────────────────────────────────────────────────────────

async function entrarAIframe390(page: Page, url: string): Promise<{ frame: Frame; handle: import('playwright').ElementHandle }> {
  await page.setContent(
    `<!doctype html><html><body style="margin:0;padding:0;background:#0000"><iframe id="f" style="display:block;width:390px;height:3900px;border:0"></iframe></body></html>`,
  );
  const handle = (await page.$('#f'))!;
  await handle.evaluate((el: HTMLIFrameElement, src: string) => {
    el.src = src;
  }, url);
  const frame = await handle.contentFrame();
  if (!frame) throw new Error('no se pudo entrar al iframe de 390px');
  await frame.waitForLoadState('load');
  await frame.waitForSelector('h1, h2', { timeout: 5_000 });
  await frame.waitForTimeout(300);
  return { frame, handle };
}

async function sinOverflowHorizontal(evaluable: Page | Frame, mensaje: string): Promise<void> {
  const overflow = await evaluable.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.ok(!overflow, mensaje);
}

const DIR_CAPTURAS = process.env.KODU_CAPTURAS_DIR ?? '/tmp/kodu-e2e-org-panel';
mkdirSync(DIR_CAPTURAS, { recursive: true });

async function capturarResponsive(page: Page, ruta: string, etiqueta: string): Promise<void> {
  const url = `${BASE_URL}${ruta}`;

  for (const tema of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await conTema(page, tema);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${DIR_CAPTURAS}/${etiqueta}-desktop-${tema}.png` });
    await sinOverflowHorizontal(page, `${etiqueta} (desktop, ${tema}): no debería scrollear horizontal`);

    const { frame, handle } = await entrarAIframe390(page, url);
    await handle.screenshot({ path: `${DIR_CAPTURAS}/${etiqueta}-390-${tema}.png` });
    await sinOverflowHorizontal(frame, `${etiqueta} (390px, ${tema}): no debería scrollear horizontal`);
  }
}

async function main(): Promise<void> {
  await limpiarEstado();
  const browser = await abrirNavegador();

  try {
    // ───────────────────────────────────────────────────────────
    // 1. Fixture: red N (sedes N1/N2) + standalone S.
    // ───────────────────────────────────────────────────────────
    const red = await prisma.organization.create({ data: { name: `Red OrgPanel E2E ${SUFIJO}`, kind: 'NETWORK' } });
    const n1 = await prisma.organization.create({ data: { name: `Sede N1 OrgPanel E2E ${SUFIJO}`, kind: 'CAMPUS', parentId: red.id } });
    const n2 = await prisma.organization.create({ data: { name: `Sede N2 OrgPanel E2E ${SUFIJO}`, kind: 'CAMPUS', parentId: red.id } });
    const standalone = await prisma.organization.create({ data: { name: `Sede S OrgPanel E2E ${SUFIJO}`, kind: 'CAMPUS' } });
    orgIds.red = red.id;
    orgIds.n1 = n1.id;
    orgIds.n2 = n2.id;
    orgIds.standalone = standalone.id;

    userIds.adminN1 = await crearUsuario(EMAIL_ADMIN_N1, 'Admin N1 OrgPanel', n1.id);
    userIds.adminRed = await crearUsuario(EMAIL_ADMIN_RED, 'Admin Red OrgPanel', n1.id);
    userIds.profeA = await crearUsuario(EMAIL_PROFE_A, 'Profe A OrgPanel', n1.id);
    userIds.profeMovido = await crearUsuario(EMAIL_PROFE_MOVIDO, 'Profe Movido OrgPanel', n1.id); // se mueve a N2 abajo
    userIds.profePlano = await crearUsuario(EMAIL_PROFE_PLANO, 'Profe Plano OrgPanel', n1.id);
    userIds.profeS = await crearUsuario(EMAIL_PROFE_S, 'Profe S OrgPanel', standalone.id);

    await prisma.organizationAdmin.create({ data: { userId: userIds.adminN1, organizationId: n1.id } });
    await prisma.organizationAdmin.create({ data: { userId: userIds.adminRed, organizationId: red.id } });
    console.log('✔ 1. red con sedes N1/N2 + standalone S, admins y docentes creados');

    // ───────────────────────────────────────────────────────────
    // 2. Consumo: profeA sólo en N1; profeMovido en N1 ANTES de moverse y
    //    en N2 DESPUÉS (costo NULL) — mismo mes de fixture.
    // ───────────────────────────────────────────────────────────
    const projA = await crearProyecto(userIds.profeA);
    const projMAntes = await crearProyecto(userIds.profeMovido);
    await sembrarFila({ userId: userIds.profeA, organizationId: n1.id, purpose: 'GENERATION', forNewResource: true, projectId: projA, costUsd: '0.02', createdAt: fechaFixture('05') });
    await sembrarFila({ userId: userIds.profeA, organizationId: n1.id, purpose: 'ADJUSTMENT', forNewResource: false, projectId: projA, costUsd: '0.01', createdAt: fechaFixture('06') });
    await sembrarFila({ userId: userIds.profeMovido, organizationId: n1.id, purpose: 'GENERATION', forNewResource: true, projectId: projMAntes, costUsd: '0.03', createdAt: fechaFixture('10') });

    // Se mueve DE VERDAD (organizationId actual pasa a N2) y genera consumo
    // NUEVO ya en N2 — la fila vieja de N1 no se toca (T1: "costo congelado").
    await prisma.user.update({ where: { id: userIds.profeMovido }, data: { organizationId: n2.id } });
    const projMDespues = await crearProyecto(userIds.profeMovido);
    await sembrarFila({ userId: userIds.profeMovido, organizationId: n2.id, purpose: 'ADJUSTMENT', forNewResource: false, projectId: projMDespues, costUsd: null, createdAt: fechaFixture('20') });

    // Recurso "secreto": nunca debería aparecer en el HTML de /org (conteos, no contenido).
    await crearProyecto(userIds.profeA, TITULO_RECURSO_SECRETO);
    console.log('✔ 2. TokenUsage sembrado: N1 exacto (0.06), N2 con un NULL (piso "≥ US$ 0,00")');

    // ───────────────────────────────────────────────────────────
    // 3. `consumoDelPanel` (función pura de agregación + carga, sin
    //    navegador): cifras calculadas a mano.
    // ───────────────────────────────────────────────────────────
    const consumoN1 = await consumoDelPanel([n1.id], MES_FIXTURE);
    assert.equal(consumoN1.porCampus, null, 'una sola sede: no hay desglose por sede');
    assert.equal(consumoN1.porDocente.length, 2, 'N1: profeA + profeMovido (fila de ANTES de moverse)');
    assert.equal(consumoN1.total.costoTotal.suma.toString(), '0.06', '0.02+0.01+0.03');
    assert.equal(consumoN1.total.costoTotal.filasSinPrecio, 0, 'N1 no tiene ninguna fila sin precio');
    const filaMovidoEnN1 = consumoN1.porDocente.find((f) => f.userId === userIds.profeMovido)!;
    assert.equal(filaMovidoEnN1.agregado.costoTotal.suma.toString(), '0.03', 'el costo de profeMovido en N1 queda CONGELADO en 0.03');

    const consumoN2 = await consumoDelPanel([n2.id], MES_FIXTURE);
    assert.equal(consumoN2.porDocente.length, 1, 'N2: sólo profeMovido, después de moverse');
    assert.equal(consumoN2.total.costoTotal.filasSinPrecio, 1, 'N2 tiene la fila de costo NULL');
    assert.equal(consumoN2.total.costoTotal.suma.toString(), '0', 'N2: la única fila es NULL, nunca se suma como 0 real');

    const consumoRed = await consumoDelPanel([n1.id, n2.id], MES_FIXTURE);
    assert.ok(consumoRed.porCampus, 'red (2+ sedes): sí hay desglose por sede');
    assert.equal(consumoRed.porCampus!.length, 2);
    assert.equal(consumoRed.porDocente.length, 3, 'red: profeA(N1) + profeMovido(N1) + profeMovido(N2) — el PAR (docente,sede) es la fila');
    assert.equal(consumoRed.total.docentesActivos, 2, 'total de red: profeA + profeMovido, cada uno UNA vez (no 3)');
    assert.equal(consumoRed.total.costoTotal.suma.toString(), '0.06', 'total de red: 0.06 (N1 exacto + N2 nulo)');
    assert.equal(consumoRed.total.costoTotal.filasSinPrecio, 1);
    // Adopción + serie (T-uso-docentes): Y = docentes ACTUALES de las sedes del
    // alcance (N1: adminN1, adminRed, profeA, profePlano; N2: profeMovido).
    assert.equal(await docentesDelPanel([n1.id]), 4, 'N1 tiene 4 docentes hoy');
    assert.equal(await docentesDelPanel([n2.id]), 1, 'N2 tiene 1 docente hoy (profeMovido)');
    assert.equal(await docentesDelPanel([n1.id, n2.id]), 5, 'la red suma sus sedes');
    assert.equal(await docentesDelPanel([]), 0);

    const mesesSerie = ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', MES_FIXTURE];
    const serieN1 = await serieDelPanel([n1.id], mesesSerie);
    assert.deepEqual(serieN1.map((p) => p.mes), mesesSerie, 'la serie respeta el orden pedido');
    assert.deepEqual(serieN1.at(-1), { mes: MES_FIXTURE, recursosNuevos: 2, docentesActivos: 2 }, 'N1 en el mes de fixture: 2 recursos, 2 docentes');
    assert.ok(serieN1.slice(0, -1).every((p) => p.recursosNuevos === 0 && p.docentesActivos === 0), 'N1: los meses sin uso quedan en 0');
    const serieRed = await serieDelPanel([n1.id, n2.id], mesesSerie);
    assert.deepEqual(serieRed.at(-1), { mes: MES_FIXTURE, recursosNuevos: 2, docentesActivos: 2 }, 'red: profeMovido cuenta UNA vez aunque esté en dos sedes');
    const serieN2 = await serieDelPanel([n2.id], mesesSerie);
    assert.deepEqual(serieN2.at(-1), { mes: MES_FIXTURE, recursosNuevos: 0, docentesActivos: 1 }, 'N2: sólo un ajuste, 0 recursos nuevos');
    assert.deepEqual(await serieDelPanel([], mesesSerie), mesesSerie.map((mes) => ({ mes, recursosNuevos: 0, docentesActivos: 0 })));
    console.log('✔ 3. consumoDelPanel: sede única (sin desglose), sede con NULL (piso), red (desglose + par docente-sede + total único)');

    // ───────────────────────────────────────────────────────────
    // 4. Navegador: sesiones por actor.
    // ───────────────────────────────────────────────────────────
    const adminN1Ctx = await browser.newContext();
    const adminN1 = await adminN1Ctx.newPage();
    await iniciarSesion(adminN1, { email: EMAIL_ADMIN_N1, password: PASSWORD });

    const adminRedCtx = await browser.newContext();
    const adminRed = await adminRedCtx.newPage();
    await iniciarSesion(adminRed, { email: EMAIL_ADMIN_RED, password: PASSWORD });

    const planoCtx = await browser.newContext();
    const plano = await planoCtx.newPage();
    await iniciarSesion(plano, { email: EMAIL_PROFE_PLANO, password: PASSWORD });

    const superadminCtx = await browser.newContext();
    const superadmin = await superadminCtx.newPage();
    await iniciarSesion(superadmin, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    // ───────────────────────────────────────────────────────────
    // 5. Header: visible para los dos admins, ausente para un docente plano.
    // ───────────────────────────────────────────────────────────
    await adminN1.goto(`${BASE_URL}/app`, { waitUntil: 'domcontentloaded' });
    await assert.doesNotReject(() => adminN1.waitForSelector('a[href="/org"]', { state: 'attached', timeout: 3_000 }), 'adminN1 debe ver el link "Mi organización"');

    await adminRed.goto(`${BASE_URL}/app`, { waitUntil: 'domcontentloaded' });
    await assert.doesNotReject(() => adminRed.waitForSelector('a[href="/org"]', { state: 'attached', timeout: 3_000 }), 'adminRed debe ver el link "Mi organización"');

    await plano.goto(`${BASE_URL}/app`, { waitUntil: 'domcontentloaded' });
    const linkOrgPlano = await plano.$('a[href="/org"]');
    assert.equal(linkOrgPlano, null, 'un docente plano NO debe ver el link "Mi organización"');
    console.log('✔ 5. el link de header aparece para los dos admins y no para un docente plano');

    // ───────────────────────────────────────────────────────────
    // 6. Un docente plano que entra a `/org` a mano vuelve a `/app`.
    // ───────────────────────────────────────────────────────────
    await plano.goto(`${BASE_URL}/org`, { waitUntil: 'domcontentloaded' });
    assert.ok(plano.url().endsWith('/app'), `docente plano en /org debe terminar en /app (quedó en ${plano.url()})`);
    console.log('✔ 6. /org redirige a /app para quien no administra ninguna organización');

    // ───────────────────────────────────────────────────────────
    // 7. `/org` de adminN1: sólo ve a N1 (sin selector de sedes: no es admin
    //    de red), sin el título del recurso secreto en el HTML.
    // ───────────────────────────────────────────────────────────
    await adminN1.goto(`${BASE_URL}/org`, { waitUntil: 'domcontentloaded' });
    await adminN1.waitForSelector('h1:has-text("Mi organización")');
    const htmlN1 = await adminN1.content();
    assert.ok(htmlN1.includes(`Sede N1 OrgPanel E2E ${SUFIJO}`), 'adminN1 debe ver el nombre de su propia sede');
    assert.ok(!htmlN1.includes(`Sede N2 OrgPanel E2E ${SUFIJO}`), 'adminN1 NO debe ver ninguna mención a N2 (sin selector de red)');
    assert.ok(!htmlN1.includes(TITULO_RECURSO_SECRETO), 'el título de un recurso NUNCA debe aparecer en /org — sólo conteos');
    assert.ok(htmlN1.includes('Profe A OrgPanel'), 'adminN1 debe ver a profeA en su lista de docentes');
    assert.ok(!htmlN1.includes('Profe S OrgPanel'), 'adminN1 NO debe ver a profeS (sede ajena)');

    // El panel muestra RECURSOS, no tokens ni plata: ni columnas ni valores.
    await adminN1.goto(`${BASE_URL}/org?mes=${MES_FIXTURE}`, { waitUntil: 'domcontentloaded' });
    const consumoN1Texto = (await adminN1.locator('section:has(h2:text-is("Consumo"))').textContent()) ?? '';
    assert.match(consumoN1Texto, /2\s*de\s*4\s*docentes usaron Kodu en febrero de 2026/, `línea de adopción de N1 (llegó: ${consumoN1Texto.slice(0, 160)})`);
    assert.match(consumoN1Texto, /Últimos 6 meses/, 'el gráfico de 6 meses está');
    assert.equal(await adminN1.locator('section:has(h2:text-is("Consumo")) ol > li').count(), 6, 'el gráfico tiene 6 meses');
    assert.ok(!/tokens|costo|US\$|≥/i.test(consumoN1Texto), 'el Consumo de /org no muestra tokens ni costo');
    assert.match(consumoN1Texto, /Recursos nuevos/);
    assert.match(consumoN1Texto, /Ajustes/);
    assert.match(consumoN1Texto, /Turnos/);
    console.log('✔ 7b. /org (Consumo): adopción "2 de 4", gráfico de 6 meses, sin tokens ni costo');
    console.log('✔ 7. /org de un admin de sede: sólo su sede, sin selector de red, sin filtrar título de recursos');

    // ───────────────────────────────────────────────────────────
    // 8. `/org?sede=<red>` de adminRed: "Toda la red" con desglose por sede
    //    y ambas filas de profeMovido (N1 y N2) visibles.
    // ───────────────────────────────────────────────────────────
    await adminRed.goto(`${BASE_URL}/org?sede=${red.id}`, { waitUntil: 'domcontentloaded' });
    await adminRed.waitForSelector('h1:has-text("Mi organización")');
    const htmlRed = await adminRed.content();
    assert.ok(htmlRed.includes(`Sede N1 OrgPanel E2E ${SUFIJO}`) && htmlRed.includes(`Sede N2 OrgPanel E2E ${SUFIJO}`), 'admin de red debe ver las dos sedes en el desglose');
    assert.ok(!htmlRed.includes(`Sede S OrgPanel E2E ${SUFIJO}`), 'admin de red NO debe ver la sede standalone (no es de su red)');
    assert.ok(!htmlRed.includes(TITULO_RECURSO_SECRETO), 'tampoco acá debería filtrar el título del recurso');
    await adminRed.goto(`${BASE_URL}/org?sede=${red.id}&mes=${MES_FIXTURE}`, { waitUntil: 'domcontentloaded' });
    const consumoRedTexto = (await adminRed.locator('section:has(h2:text-is("Consumo"))').textContent()) ?? '';
    assert.match(consumoRedTexto, /2\s*de\s*5\s*docentes usaron Kodu en febrero de 2026/, `adopción de la red: suma de sus sedes (llegó: ${consumoRedTexto.slice(0, 160)})`);
    assert.ok(!/tokens|costo|US\$|≥/i.test(consumoRedTexto), 'la vista de red tampoco muestra tokens ni costo');
    console.log('✔ 8. /org?sede=<red> de un admin de red: desglose por sede, sin la sede ajena, sin filtrar título');

    // ───────────────────────────────────────────────────────────
    // 9. Aislamiento por id adivinado: adminN1 no puede tocar N2 ni S — ni
    //    la página (404) ni las APIs de miembros/lista blanca/invitaciones.
    // ───────────────────────────────────────────────────────────
    const respuestaPaginaN2 = await adminN1.request.get(`${BASE_URL}/org?sede=${n2.id}`);
    assert.equal(respuestaPaginaN2.status(), 404, `adminN1 en /org?sede=<N2> debe dar 404 (dio ${respuestaPaginaN2.status()})`);
    const respuestaPaginaS = await adminN1.request.get(`${BASE_URL}/org?sede=${standalone.id}`);
    assert.equal(respuestaPaginaS.status(), 404, `adminN1 en /org?sede=<S> debe dar 404 (dio ${respuestaPaginaS.status()})`);

    const respuestaMiembrosN2 = await adminN1.request.get(`${BASE_URL}/api/org/organizaciones/${n2.id}/miembros`);
    assert.equal(respuestaMiembrosN2.status(), 404, `GET miembros de N2 debe dar 404 (dio ${respuestaMiembrosN2.status()})`);

    const respuestaWhitelistN2 = await adminN1.request.post(`${BASE_URL}/api/org/organizaciones/${n2.id}/lista-blanca`, {
      data: { email: 'no-deberia-entrar@afuera.com' },
    });
    assert.equal(respuestaWhitelistN2.status(), 404, `POST lista blanca de N2 debe dar 404 (dio ${respuestaWhitelistN2.status()})`);

    const respuestaInvitacionesN2 = await adminN1.request.get(`${BASE_URL}/api/org/invitaciones?organizationId=${n2.id}`);
    assert.equal(respuestaInvitacionesN2.status(), 404, `GET invitaciones de N2 debe dar 404 (dio ${respuestaInvitacionesN2.status()})`);

    // Mover a profeS (sede S, totalmente ajena) hacia N1: adminN1 administra
    // el DESTINO pero no el ORIGEN — igual tiene que dar 404.
    const respuestaMoverAjeno = await adminN1.request.patch(`${BASE_URL}/api/org/miembros/${userIds.profeS}`, {
      data: { destinoCampusId: n1.id },
    });
    assert.equal(respuestaMoverAjeno.status(), 404, `mover a un docente de una sede ajena debe dar 404 (dio ${respuestaMoverAjeno.status()})`);
    console.log('✔ 9. adminN1 recibe 404 en página y APIs de N2/S, incluso con ids adivinados y moviendo hacia adentro');

    // ───────────────────────────────────────────────────────────
    // 10. Lista blanca, invitación (creada, mostrada UNA vez, listada sin
    //     token, revocada), promover/degradar, mover y baja — todo desde
    //     adminN1 sobre SU sede (N1).
    // ───────────────────────────────────────────────────────────
    const respuestaWhitelist = await adminN1.request.post(`${BASE_URL}/api/org/organizaciones/${n1.id}/lista-blanca`, {
      data: { email: EMAIL_WHITELIST },
    });
    assert.equal(respuestaWhitelist.status(), 200, `agregar a la lista blanca debe dar 200 (dio ${respuestaWhitelist.status()})`);
    console.log('✔ 10a. adminN1 agrega un email a la lista blanca de N1');

    const respuestaCrearInvitacion = await adminN1.request.post(`${BASE_URL}/api/org/invitaciones`, {
      data: { organizationId: n1.id, expiresAt: null, maxUses: 5 },
    });
    assert.equal(respuestaCrearInvitacion.status(), 200, `crear invitación debe dar 200 (dio ${respuestaCrearInvitacion.status()})`);
    const cuerpoInvitacion = (await respuestaCrearInvitacion.json()) as { url: string; invitacion: { id: string } };
    assert.match(cuerpoInvitacion.url, /\/invitacion\//, 'la respuesta de creación trae la URL con el token en claro');

    const respuestaListado = await adminN1.request.get(`${BASE_URL}/api/org/invitaciones?organizationId=${n1.id}`);
    const cuerpoListado = (await respuestaListado.json()) as { invitaciones: Array<Record<string, unknown>> };
    const filaListada = cuerpoListado.invitaciones.find((f) => f.id === cuerpoInvitacion.invitacion.id);
    assert.ok(filaListada, 'la invitación recién creada aparece en el listado');
    assert.ok(!('url' in filaListada!) && !('tokenHash' in filaListada!), 'el listado NUNCA trae la URL ni el hash del token');
    console.log('✔ 10b. el enlace de invitación se devuelve UNA vez al crear; el listado nunca repite la URL ni el token');

    const respuestaRevocar = await adminN1.request.post(`${BASE_URL}/api/org/invitaciones/${cuerpoInvitacion.invitacion.id}/revocar`, { data: {} });
    assert.equal(respuestaRevocar.status(), 200, `revocar debe dar 200 (dio ${respuestaRevocar.status()})`);
    console.log('✔ 10c. adminN1 revoca su propia invitación');

    const respuestaPromover = await adminN1.request.post(`${BASE_URL}/api/org/organizaciones/${n1.id}/admins`, {
      data: { userId: userIds.profePlano },
    });
    assert.equal(respuestaPromover.status(), 200, `promover a profePlano debe dar 200 (dio ${respuestaPromover.status()})`);
    const filaAdminPromovido = await prisma.organizationAdmin.findUnique({
      where: { userId_organizationId: { userId: userIds.profePlano, organizationId: n1.id } },
    });
    assert.ok(filaAdminPromovido, 'promover debe crear la fila de OrganizationAdmin');

    const respuestaDegradar = await adminN1.request.delete(`${BASE_URL}/api/org/organizaciones/${n1.id}/admins/${userIds.profePlano}`, { data: {} });
    assert.equal(respuestaDegradar.status(), 200, `degradar debe dar 200 (dio ${respuestaDegradar.status()})`);
    console.log('✔ 10d. adminN1 promueve y degrada a profePlano como admin de N1');

    // Último admin: adminN1 es el único admin de N1 (profePlano ya fue
    // degradado arriba) — no puede sacarse a sí mismo.
    const respuestaAutoDegradar = await adminN1.request.delete(`${BASE_URL}/api/org/organizaciones/${n1.id}/admins/${userIds.adminN1}`, { data: {} });
    assert.equal(respuestaAutoDegradar.status(), 409, `único admin autodegradándose debe dar 409 (dio ${respuestaAutoDegradar.status()})`);
    console.log('✔ 10e. el único admin de N1 no puede sacarse a sí mismo (409)');

    // Mover: adminN1 (sólo admin de sede, no de red) NO puede mover a nadie
    // (no administra ningún destino distinto de N1); adminRed sí puede.
    const respuestaMoverSinRed = await adminN1.request.patch(`${BASE_URL}/api/org/miembros/${userIds.profePlano}`, {
      data: { destinoCampusId: n2.id },
    });
    assert.equal(respuestaMoverSinRed.status(), 404, `adminN1 (sin red) no administra N2 como destino: 404 (dio ${respuestaMoverSinRed.status()})`);

    const respuestaMoverConRed = await adminRed.request.patch(`${BASE_URL}/api/org/miembros/${userIds.profePlano}`, {
      data: { destinoCampusId: n2.id },
    });
    assert.equal(respuestaMoverConRed.status(), 200, `adminRed sí puede mover entre sedes de SU red (dio ${respuestaMoverConRed.status()})`);
    const profePlanoTrasMover = await prisma.user.findUnique({ where: { id: userIds.profePlano }, select: { organizationId: true } });
    assert.equal(profePlanoTrasMover?.organizationId, n2.id, 'profePlano debe quedar en N2 tras el move');
    console.log('✔ 10f. mover exige administrar la RED (adminN1 no puede, adminRed sí)');

    const respuestaBaja = await adminRed.request.delete(`${BASE_URL}/api/org/miembros/${userIds.profePlano}`, { data: {} });
    assert.equal(respuestaBaja.status(), 200, `baja debe dar 200 (dio ${respuestaBaja.status()})`);
    const profePlanoTrasBaja = await prisma.user.findUnique({ where: { id: userIds.profePlano }, select: { organizationId: true } });
    assert.equal(profePlanoTrasBaja?.organizationId, null, 'la baja debe dejar a profePlano como cuenta personal');
    console.log('✔ 10g. adminRed da de baja a profePlano (queda cuenta personal)');

    // ───────────────────────────────────────────────────────────
    // 11. Capturas: /org (adminN1), /org?sede=<red> (adminRed, Toda la red),
    //     y el detalle de superadmin con el componente de miembros nuevo.
    // ───────────────────────────────────────────────────────────
    await capturarResponsive(adminN1, `/org?mes=${MES_FIXTURE}`, 'org-campus');
    await capturarResponsive(adminRed, `/org?sede=${red.id}&mes=${MES_FIXTURE}`, 'org-red');
    await capturarResponsive(superadmin, `/admin/organizaciones/${n1.id}`, 'admin-detalle-miembros');
    console.log('✔ 11. capturas de /org (admin de sede), /org?sede=<red> (admin de red) y el detalle de superadmin, sin overflow');
  } finally {
    await browser.close();
    await limpiarEstado();
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    console.log('\n✔ e2e/org-panel.ts: todos los escenarios pasaron');
  })
  .catch((error) => {
    console.error('\n✖ e2e/org-panel.ts falló:', error);
    process.exitCode = 1;
  });
