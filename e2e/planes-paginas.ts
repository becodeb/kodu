import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { BASE_URL, abrirNavegador, conTema } from './harness.ts';
import type { Page } from 'playwright';

/**
 * odd/tasks/planes-y-cobros.md (T6): e2e de las páginas de precios y plan —
 * `/precios`, `/app/plan`, `/org/plan`. Maneja su propio ciclo de vida del
 * dev server (mismo runbook que `e2e/planes-alta.ts`): BILLING_PROVIDER=simulado,
 * sin RESEND_API_KEY (toda cuenta nace verificada).
 *
 * Corre con: KODU_BASE_URL=http://localhost:3200 npx tsx e2e/planes-paginas.ts
 */

const PORT = Number(new URL(BASE_URL).port || '3200');
const SUFIJO = randomUUID().slice(0, 8);
const PASSWORD = 'Docente.E2E.Paginas.2026';
const CUIT_VALIDO = '20-12345678-6';

const emailsCreados: string[] = [];
const organizacionesCreadas: string[] = [];
const browsersAbiertos: import('playwright').Browser[] = [];

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

let fallas = 0;
async function prueba(nombre: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✔ ${nombre}`);
  } catch (error) {
    fallas++;
    console.error(`✖ ${nombre}`);
    console.error(`  ${(error as Error).stack ?? error}`);
  }
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────
// Ciclo de vida del dev server
// ─────────────────────────────────────────────────────────────

function pararDevServer(): void {
  try {
    execFileSync('npx', ['astro', 'dev', 'stop'], { stdio: 'pipe' });
  } catch {
    // No había ninguno corriendo.
  }
}

function arrancarDevServer(): void {
  execFileSync('npx', ['astro', 'dev', '--port', String(PORT), '--background'], {
    env: { ...process.env, PORT: String(PORT), BILLING_PROVIDER: 'simulado', RESEND_API_KEY: '' },
    stdio: 'pipe',
  });
}

async function esperarListo(timeoutMs = 20_000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    try {
      const respuesta = await fetch(`${BASE_URL}/login`);
      if (respuesta.ok) return;
    } catch {
      // todavía no levantó
    }
    await esperar(300);
  }
  throw new Error('El dev server no respondió a tiempo.');
}

// ─────────────────────────────────────────────────────────────
// Helpers de dominio
// ─────────────────────────────────────────────────────────────

async function registrar(email: string): Promise<{ page: Page; userId: string }> {
  emailsCreados.push(email);
  const browser = await abrirNavegador();
  browsersAbiertos.push(browser);
  const page = await (await browser.newContext()).newPage();
  const respuesta = await page.request.post(`${BASE_URL}/api/auth/register`, {
    data: { name: `Docente ${email.split('@')[0]}`, email, password: PASSWORD },
  });
  assert.equal(respuesta.status(), 200, `registro de ${email} (dio ${respuesta.status()}: ${await respuesta.text()})`);
  const body = (await respuesta.json()) as { user: { id: string } };
  return { page, userId: body.user.id };
}

async function prepararOrgTrial(declaredStudents: number): Promise<{ orgId: string; dominio: string }> {
  const dominio = `paginas-${randomUUID().slice(0, 8)}.edu.ar`;
  const org = await prisma.organization.create({ data: { name: `Org páginas E2E ${dominio}`, kind: 'CAMPUS' }, select: { id: true } });
  organizacionesCreadas.push(org.id);
  await prisma.organizationDomain.create({ data: { organizationId: org.id, pattern: dominio } });
  await prisma.organizationLicense.create({
    data: { organizationId: org.id, status: 'TRIAL', declaredStudents, trialEndsAt: new Date(Date.now() + 30 * 86_400_000) },
  });
  return { orgId: org.id, dominio };
}

async function accionarPagoSimulado(page: Page, checkoutUrl: string, accion: string): Promise<{ ok: boolean; applied?: boolean }> {
  const id = checkoutUrl.split('/').pop()!;
  const respuesta = await page.request.post(`${BASE_URL}/api/billing/pago-simulado/${id}/accion`, { data: { accion } });
  const cuerpo = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: respuesta.ok() && cuerpo.ok === true, applied: cuerpo.applied as boolean | undefined };
}

async function limpiar(): Promise<void> {
  const usuarios = await prisma.user.findMany({ where: { email: { in: emailsCreados } }, select: { id: true } });
  const ids = usuarios.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.payment.deleteMany({ where: { userId: { in: ids } } });
    await prisma.individualSubscription.deleteMany({ where: { userId: { in: ids } } });
    await prisma.creditLedgerEntry.deleteMany({ where: { userId: { in: ids } } });
    await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  }
  await prisma.payment.deleteMany({ where: { organizationId: { in: organizacionesCreadas } } });
  await prisma.user.deleteMany({ where: { email: { in: emailsCreados } } });
  for (const id of organizacionesCreadas) {
    await prisma.organization.deleteMany({ where: { id } });
  }
}

const dirCapturas =
  process.env.KODU_E2E_SCREENSHOT_DIR ??
  '/tmp/claude-1001/-home-opencode-projects/4e564770-3a74-51e8-8de7-1431f19bac6e/scratchpad';

async function capturar(page: Page, url: string, nombre: string, esperaSelector: string): Promise<void> {
  for (const ancho of [1280, 390]) {
    for (const tema of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: ancho, height: 900 });
      await page.goto(url);
      await conTema(page, tema);
      await page.waitForSelector(esperaSelector, { timeout: 10_000 });
      await page.waitForTimeout(400);
      const sinScroll = await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth + 1);
      assert.ok(sinScroll, `${nombre} (${ancho}px, ${tema}): no debería scrollear horizontal`);
      await page.screenshot({ path: `${dirCapturas}/${nombre}-${ancho}-${tema}.png`, fullPage: true });
    }
  }
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    pararDevServer();
    arrancarDevServer();
    await esperarListo();

    // ───────────────────────────────────────────────────────
    // /precios — catálogo de verdad, calculadora, CTA.
    // ───────────────────────────────────────────────────────
    const bandaOriginal = await prisma.institutionalBand.findUniqueOrThrow({ where: { key: 'MEDIANA' } });

    await prueba('/precios: muestra el precio de la banda tal cual está en la base', async () => {
      const html = await (await fetch(`${BASE_URL}/precios`)).text();
      const formateado = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(bandaOriginal.monthlyPriceArs.toNumber());
      assert.ok(html.includes(formateado) || html.includes(String(bandaOriginal.monthlyPriceArs)), 'debe reflejar el precio del catálogo');
    });

    await prueba('/precios: cambiar un precio en la base se refleja en el render', async () => {
      const nuevoPrecio = bandaOriginal.monthlyPriceArs.toNumber() + 1234;
      await prisma.institutionalBand.update({ where: { key: 'MEDIANA' }, data: { monthlyPriceArs: nuevoPrecio } });
      const html = await (await fetch(`${BASE_URL}/precios`)).text();
      const formateado = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(nuevoPrecio);
      assert.ok(html.includes(formateado), `debe reflejar el precio nuevo (${formateado})`);
      // restaurar
      await prisma.institutionalBand.update({ where: { key: 'MEDIANA' }, data: { monthlyPriceArs: bandaOriginal.monthlyPriceArs } });
    });

    const browserPrecios = await abrirNavegador();
    browsersAbiertos.push(browserPrecios);
    const pagePrecios = await (await browserPrecios.newContext()).newPage();
    await pagePrecios.goto(`${BASE_URL}/precios`);
    await pagePrecios.waitForSelector('#alumnos-input');

    async function bandaSeleccionada(n: number): Promise<string | null> {
      await pagePrecios.fill('#alumnos-input', String(n));
      await pagePrecios.dispatchEvent('#alumnos-input', 'input');
      await pagePrecios.waitForTimeout(150);
      return pagePrecios.evaluate(() => document.querySelector('.banda-card[data-match="true"]')?.getAttribute('data-band-key') ?? null);
    }

    await prueba('/precios: calculadora elige PEQUENA para 300 alumnos', async () => {
      assert.equal(await bandaSeleccionada(300), 'PEQUENA');
    });
    await prueba('/precios: calculadora elige MEDIANA para 301 alumnos', async () => {
      assert.equal(await bandaSeleccionada(301), 'MEDIANA');
    });
    await prueba('/precios: calculadora elige Hablemos para 1501 alumnos', async () => {
      assert.equal(await bandaSeleccionada(1501), 'HABLEMOS');
    });
    await prueba('/precios: el CTA de la banda matcheada lleva ?alumnos=N', async () => {
      await bandaSeleccionada(301);
      const href = await pagePrecios.evaluate(() => document.querySelector('.alta-link[data-band-key="MEDIANA"]')?.getAttribute('href'));
      assert.equal(href, '/instituciones/alta?alumnos=301');
    });

    // ───────────────────────────────────────────────────────
    // /app/plan — cuenta personal, checkout, miembro de org.
    // ───────────────────────────────────────────────────────
    const emailPersonal = `personal-${SUFIJO}@gmail.com`;
    const personal = await registrar(emailPersonal);

    await prueba('/app/plan: cuenta personal ve el plan Gratis', async () => {
      await personal.page.goto(`${BASE_URL}/app/plan`);
      const texto = await personal.page.textContent('body');
      assert.ok(texto?.includes('Plan Gratis'), 'debe mostrar "Plan Gratis"');
    });

    await prueba('/app/plan: contratar Individual (mensual, simulado) y volver mostrando Individual', async () => {
      await personal.page.goto(`${BASE_URL}/app/plan`);
      await personal.page.getByRole('button', { name: /Pasate a Individual/ }).waitFor({ timeout: 8_000 });
      await personal.page.getByRole('button', { name: /Pasate a Individual/ }).click();
      await personal.page.waitForURL('**/pago-simulado/**', { timeout: 10_000 });
      await personal.page.getByRole('button', { name: 'Aprobar' }).click();
      await personal.page.waitForTimeout(500);
      await personal.page.goto(`${BASE_URL}/app/plan`);
      const texto = await personal.page.textContent('body');
      assert.ok(texto?.includes('Plan Individual'), 'debe mostrar "Plan Individual" tras aprobar el pago');
    });

    const emailMiembro = `miembro-${SUFIJO}@paginas-miembro-${SUFIJO}.edu.ar`;
    const orgMiembro = await prepararOrgTrial(50);
    await prisma.organizationDomain.updateMany({ where: { organizationId: orgMiembro.orgId }, data: { pattern: `paginas-miembro-${SUFIJO}.edu.ar` } });
    console.log('… esperando 11s la caché de organizaciones del dev server…');
    await esperar(11_000);
    const miembro = await registrar(emailMiembro);

    await prueba('/app/plan: un miembro de organización ve "tu institución te cubre"', async () => {
      assert.notEqual(await prisma.user.findUniqueOrThrow({ where: { id: miembro.userId }, select: { organizationId: true } }).then((u) => u.organizationId), null);
      await miembro.page.goto(`${BASE_URL}/app/plan`);
      const texto = await miembro.page.textContent('body');
      assert.ok(texto?.includes('institución te cubre'), 'debe mostrar el cartel de cobertura institucional');
    });

    // ───────────────────────────────────────────────────────
    // /org/plan — admin TRIAL (preview + pago), admin de sede (lectura).
    // ───────────────────────────────────────────────────────
    const orgAdminTrial = await prepararOrgTrial(500); // MEDIANA
    console.log('… esperando 11s la caché de organizaciones del dev server…');
    await esperar(11_000);

    const { page: adminPage, userId: adminUserId } = await registrar(`admin@${orgAdminTrial.dominio}`);
    emailsCreados.push(`admin@${orgAdminTrial.dominio}`);
    await prisma.organizationAdmin.create({ data: { userId: adminUserId, organizationId: orgAdminTrial.orgId } });

    await prueba('/org/plan: admin TRIAL ve el estado de prueba y la vista previa de firstCharge', async () => {
      await adminPage.goto(`${BASE_URL}/org/plan`);
      await adminPage.waitForSelector('text=Prueba', { timeout: 8_000 });
      await adminPage.waitForSelector('text=Hoy pagás', { timeout: 8_000 });
    });

    await prueba('/org/plan: completa un pago simulado mensual y queda ACTIVA', async () => {
      await adminPage.fill('#org-razon-social', 'Escuela E2E SRL');
      await adminPage.fill('#org-cuit', CUIT_VALIDO);
      await adminPage.getByRole('button', { name: 'Pagar mensual' }).click();
      await adminPage.waitForURL('**/pago-simulado/**', { timeout: 10_000 });
      await adminPage.getByRole('button', { name: 'Aprobar' }).click();
      await adminPage.waitForTimeout(500);
      const license = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: orgAdminTrial.orgId } });
      assert.equal(license.status, 'ACTIVE');
    });

    // Admin de UNA sede (sin ser admin de la red) — sólo lectura.
    const red = await prisma.organization.create({ data: { name: `Red páginas E2E ${SUFIJO}`, kind: 'NETWORK' }, select: { id: true } });
    organizacionesCreadas.push(red.id);
    await prisma.organizationLicense.create({
      data: { organizationId: red.id, status: 'TRIAL', declaredStudents: 200, trialEndsAt: new Date(Date.now() + 30 * 86_400_000) },
    });
    const sede = await prisma.organization.create({ data: { name: `Sede páginas E2E ${SUFIJO}`, kind: 'CAMPUS', parentId: red.id }, select: { id: true } });
    const dominioSede = `paginas-sede-${SUFIJO}.edu.ar`;
    await prisma.organizationDomain.create({ data: { organizationId: sede.id, pattern: dominioSede } });
    console.log('… esperando 11s la caché de organizaciones del dev server…');
    await esperar(11_000);
    const { page: sedeAdminPage, userId: sedeAdminId } = await registrar(`admin@${dominioSede}`);
    emailsCreados.push(`admin@${dominioSede}`);
    await prisma.organizationAdmin.create({ data: { userId: sedeAdminId, organizationId: sede.id } });

    await prueba('/org/plan: un admin de sede (no de la red) ve todo en modo lectura, sin botón de pagar', async () => {
      await sedeAdminPage.goto(`${BASE_URL}/org/plan?sede=${sede.id}`);
      await sedeAdminPage.waitForTimeout(400);
      const texto = await sedeAdminPage.textContent('body');
      assert.ok(texto?.includes('administrador de una sede'), 'debe avisar que está en modo lectura');
      const hayBotonPagar = await sedeAdminPage.evaluate(() => Array.from(document.querySelectorAll('button')).some((b) => b.textContent?.includes('Pagar')));
      assert.equal(hayBotonPagar, false, 'un admin de sede no debe ver botones de pagar');
    });

    // ───────────────────────────────────────────────────────
    // Capturas (claro/oscuro, 1280/390) — T6: "leerlas y arreglar lo que se vea mal".
    // ───────────────────────────────────────────────────────
    await capturar(pagePrecios, `${BASE_URL}/precios`, 'planes-precios', '#alumnos-input');
    await capturar(personal.page, `${BASE_URL}/app/plan`, 'planes-app-plan', 'h1');
    await capturar(adminPage, `${BASE_URL}/org/plan`, 'planes-org-plan', 'h1');

    if (fallas > 0) {
      console.error(`\n${fallas} prueba(s) fallaron.`);
      process.exitCode = 1;
    } else {
      console.log('\n✔ e2e/planes-paginas.ts: todas las pruebas pasaron');
    }
  } finally {
    await limpiar();
    for (const browser of browsersAbiertos) await browser.close().catch(() => {});
    pararDevServer();
    await prisma.$disconnect();
  }
}

void main();
