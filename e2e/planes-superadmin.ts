import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { BASE_URL, abrirNavegador, conTema, iniciarSesion } from './harness.ts';
import type { Page } from 'playwright';

/**
 * odd/tasks/planes-y-cobros.md (T7 + T4b): e2e del superadmin de cobros —
 * editor de precios, cola de revisión de altas, activación manual por
 * transferencia, el aviso del monotributo, y la renovación del ciclo
 * lectivo / plan Individual anual (T4b, que quedó sin e2e propio).
 *
 * Maneja su propio ciclo de vida del dev server (mismo runbook que
 * `e2e/planes-alta.ts` / `e2e/planes-paginas.ts`): BILLING_PROVIDER=simulado,
 * sin RESEND_API_KEY. Corre con:
 *   KODU_BASE_URL=http://localhost:3200 npx tsx e2e/planes-superadmin.ts
 */

const PORT = Number(new URL(BASE_URL).port || '3200');
const SUFIJO = randomUUID().slice(0, 8);
const PASSWORD = 'Docente.E2E.Superadmin.2026';
const CUIT_VALIDO = '20-12345678-6';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const emailsCreados: string[] = [];
const organizacionesCreadas: string[] = [];
const leadsCreados: string[] = [];
const browsersAbiertos: import('playwright').Browser[] = [];

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
    env: { ...process.env, PORT: String(PORT), BILLING_PROVIDER: 'simulado', RESEND_API_KEY: '', INTERNAL_CRON_SECRET: 'secreto-e2e-superadmin' },
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

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';

async function paginaAdmin(): Promise<Page> {
  const browser = await abrirNavegador();
  browsersAbiertos.push(browser);
  const page = await (await browser.newContext()).newPage();
  await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return page;
}

/** Crea una organización CAMPUS con licencia TRIAL + dominio ya VERIFIED, sin pasar por el alta propia. */
async function prepararOrg(declaredStudents: number, extra: Record<string, unknown> = {}): Promise<{ orgId: string; dominio: string }> {
  const dominio = `superadmin-${randomUUID().slice(0, 8)}.edu.ar`;
  const org = await prisma.organization.create({ data: { name: `Org superadmin E2E ${dominio}`, kind: 'CAMPUS' }, select: { id: true } });
  organizacionesCreadas.push(org.id);
  await prisma.organizationDomain.create({ data: { organizationId: org.id, pattern: dominio } });
  await prisma.organizationLicense.create({
    data: { organizationId: org.id, status: 'TRIAL', declaredStudents, trialEndsAt: new Date(Date.now() + 30 * 86_400_000), ...extra },
  });
  return { orgId: org.id, dominio };
}

async function registrarAdminDe(org: { orgId: string; dominio: string }): Promise<{ page: Page; userId: string }> {
  const { page, userId } = await registrar(`admin@${org.dominio}`);
  await prisma.organizationAdmin.create({ data: { userId, organizationId: org.orgId } });
  return { page, userId };
}

async function accionarPagoSimulado(page: Page, checkoutUrl: string, accion: string): Promise<{ ok: boolean; applied?: boolean; reason?: string }> {
  const id = checkoutUrl.split('/').pop()!;
  const respuesta = await page.request.post(`${BASE_URL}/api/billing/pago-simulado/${id}/accion`, { data: { accion } });
  const cuerpo = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: respuesta.ok() && cuerpo.ok === true, ...cuerpo } as { ok: boolean; applied?: boolean; reason?: string };
}

async function limpiar(): Promise<void> {
  const usuarios = await prisma.user.findMany({ where: { email: { in: emailsCreados } }, select: { id: true } });
  const ids = usuarios.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.renewalReminder.deleteMany({
      where: { OR: [{ subjectId: { in: await subIdsDeUsuarios(ids) } }] },
    }).catch(() => {});
    await prisma.payment.deleteMany({ where: { userId: { in: ids } } });
    await prisma.individualSubscription.deleteMany({ where: { userId: { in: ids } } });
    await prisma.creditLedgerEntry.deleteMany({ where: { userId: { in: ids } } });
    await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  }
  await prisma.billingAuditLog.deleteMany({ where: { entityId: 'catalogo', summary: { contains: 'E2E-SUPERADMIN' } } }).catch(() => {});
  await prisma.renewalReminder.deleteMany({ where: {} }).catch(() => {});
  await prisma.payment.deleteMany({ where: { organizationId: { in: organizacionesCreadas } } });
  await prisma.institutionLead.deleteMany({ where: { id: { in: leadsCreados } } });
  await prisma.user.deleteMany({ where: { email: { in: emailsCreados } } });
  for (const id of organizacionesCreadas) {
    await prisma.organization.deleteMany({ where: { id } });
  }
}

async function subIdsDeUsuarios(userIds: string[]): Promise<string[]> {
  const subs = await prisma.individualSubscription.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  return subs.map((s) => s.id);
}

const dirCapturas =
  process.env.KODU_E2E_SCREENSHOT_DIR ??
  '/tmp/claude-1001/-home-opencode-projects/4e564770-3a74-51e8-8de7-1431f19bac6e/scratchpad';

async function capturar(page: Page, url: string, nombre: string, esperaSelector: string): Promise<void> {
  for (const tema of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url);
    await conTema(page, tema);
    await page.waitForSelector(esperaSelector, { timeout: 10_000 });
    await page.waitForTimeout(400);
    const sinScroll = await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth + 1);
    assert.ok(sinScroll, `${nombre} (1280px, ${tema}): no debería scrollear horizontal`);
    await page.screenshot({ path: `${dirCapturas}/${nombre}-1280-${tema}.png`, fullPage: true });
  }
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    pararDevServer();
    arrancarDevServer();
    await esperarListo();

    const admin = await paginaAdmin();

    // ───────────────────────────────────────────────────────
    // 1. Autorización: no-superadmin fuera de TODAS las rutas nuevas.
    // ───────────────────────────────────────────────────────
    const prepDocente = await prepararOrg(100);
    console.log('… esperando 11s la caché de organizaciones del dev server…');
    await esperar(11_000);
    const docenteOrg = await registrarAdminDe(prepDocente); // admin de ORGANIZACIÓN, no superadmin
    const { page: docentePage } = await registrar(`sinorg-${SUFIJO}@afuera-superadmin-e2e.com`);

    const PAGINAS_ADMIN = ['/admin/precios', '/admin/altas', '/admin/facturacion'];
    const ENDPOINTS_ADMIN_BILLING: Array<{ method: 'GET' | 'POST' | 'PATCH'; url: string; data?: unknown }> = [
      { method: 'PATCH', url: '/api/admin/billing/precios', data: { bands: [], plans: [], settings: {} } },
      { method: 'POST', url: '/api/admin/billing/reintegro', data: { paymentId: 'x' } },
      { method: 'POST', url: '/api/admin/billing/altas/dominio', data: { domainId: 'x', accion: 'VERIFICAR' } },
      { method: 'POST', url: '/api/admin/billing/altas/lead', data: { leadId: 'x', accion: 'CONTACTED' } },
      { method: 'POST', url: '/api/admin/billing/altas/manual-activar', data: { organizationId: 'x', interval: 'MONTHLY', periodStart: '2026-01-01', periodEnd: '2026-02-01', amountArs: 1, paymentDate: '2026-01-01' } },
      { method: 'POST', url: '/api/admin/billing/altas/manual-estado', data: { organizationId: 'x', aManual: true } },
      { method: 'POST', url: '/api/admin/billing/altas/matricula', data: { organizationId: 'x', declaredStudents: 10 } },
      { method: 'POST', url: '/api/admin/billing/altas/prueba', data: { organizationId: 'x', dias: 5 } },
      { method: 'POST', url: '/api/admin/billing/altas/revisar', data: { organizationId: 'x' } },
      { method: 'POST', url: '/api/admin/billing/facturas/reintentar', data: { invoiceId: 'x' } },
    ];

    for (const actor of [
      { nombre: 'docente de organización (admin de org, no superadmin)', page: docenteOrg.page },
      { nombre: 'cuenta personal sin organización', page: docentePage },
    ]) {
      for (const ruta of PAGINAS_ADMIN) {
        await prueba(`${ruta}: ${actor.nombre} es redirigido (nunca ve la página)`, async () => {
          const respuesta = await actor.page.request.get(`${BASE_URL}${ruta}`, { maxRedirects: 0 }).catch((e) => e);
          const status = typeof respuesta?.status === 'function' ? respuesta.status() : 0;
          assert.ok([302, 303].includes(status), `esperaba un redirect (dio ${status})`);
        });
      }
      for (const endpoint of ENDPOINTS_ADMIN_BILLING) {
        await prueba(`${endpoint.url}: ${actor.nombre} recibe 403`, async () => {
          const respuesta = await actor.page.request.fetch(`${BASE_URL}${endpoint.url}`, {
            method: endpoint.method,
            data: endpoint.data as Record<string, unknown>,
          });
          assert.equal(respuesta.status(), 403, `dio ${respuesta.status()}: ${await respuesta.text()}`);
        });
      }
    }

    await prueba('cron de recordatorios: sin header, 401', async () => {
      const respuesta = await docentePage.request.post(`${BASE_URL}/api/internal/recordatorios-renovacion`, { data: {} });
      assert.equal(respuesta.status(), 401);
    });
    await prueba('cron de recordatorios: con secreto equivocado, 401', async () => {
      const respuesta = await docentePage.request.post(`${BASE_URL}/api/internal/recordatorios-renovacion`, {
        headers: { 'x-internal-secret': 'equivocado' },
        data: {},
      });
      assert.equal(respuesta.status(), 401);
    });

    // ───────────────────────────────────────────────────────
    // 2. /admin/precios — edición válida, auditoría, reflejo en /precios; rechazo de inválidos.
    // ───────────────────────────────────────────────────────
    const bandaOriginal = await prisma.institutionalBand.findUniqueOrThrow({ where: { key: 'PEQUENA' } });
    const planOriginal = await prisma.individualPlan.findUniqueOrThrow({ where: { key: 'INDIVIDUAL' } });
    const settingsOriginal = await prisma.billingSettings.findUniqueOrThrow({ where: { id: 1 } });

    function payloadPrecios(overrides: { monthlyPriceArs?: number } = {}) {
      return {
        bands: [
          { key: 'PEQUENA', name: 'Pequeña E2E-SUPERADMIN', monthlyPriceArs: overrides.monthlyPriceArs ?? bandaOriginal.monthlyPriceArs.toNumber() + 777, cyclePriceArs: bandaOriginal.cyclePriceArs.toNumber(), active: true },
          { key: 'MEDIANA', name: 'Mediana', monthlyPriceArs: 1, cyclePriceArs: 1, active: true },
          { key: 'GRANDE', name: 'Grande', monthlyPriceArs: 1, cyclePriceArs: 1, active: true },
        ],
        plans: [
          { key: 'FREE', name: 'Gratis', monthlyPriceArs: 0, annualPriceArs: null, monthlyCredits: 50, welcomeCredits: 100, active: true },
          { key: 'INDIVIDUAL', name: planOriginal.name, monthlyPriceArs: planOriginal.monthlyPriceArs.toNumber(), annualPriceArs: planOriginal.annualPriceArs?.toNumber() ?? 1, monthlyCredits: planOriginal.monthlyCredits, welcomeCredits: planOriginal.welcomeCredits, active: true },
        ],
        settings: {
          trialEnabled: settingsOriginal.trialEnabled,
          creditUsdValue: settingsOriginal.creditUsdValue.toNumber(),
          trialDays: settingsOriginal.trialDays,
          graceDays: settingsOriginal.graceDays,
          hablemosThresholdStudents: settingsOriginal.hablemosThresholdStudents,
          monotributoAnnualCapArs: settingsOriginal.monotributoAnnualCapArs?.toNumber() ?? null,
        },
      };
    }

    let precioNuevo = 0;
    await prueba('/admin/precios: una edición válida se guarda, audita y refleja en /precios', async () => {
      const payload = payloadPrecios();
      precioNuevo = payload.bands[0].monthlyPriceArs;
      const respuesta = await admin.request.fetch(`${BASE_URL}/api/admin/billing/precios`, { method: 'PATCH', data: payload });
      assert.equal(respuesta.status(), 200, await respuesta.text());

      const banda = await prisma.institutionalBand.findUniqueOrThrow({ where: { key: 'PEQUENA' } });
      assert.equal(banda.monthlyPriceArs.toNumber(), precioNuevo);

      const auditLog = await prisma.billingAuditLog.findFirst({ where: { entityType: 'precios' }, orderBy: { createdAt: 'desc' } });
      assert.ok(auditLog, 'debe quedar un BillingAuditLog');
      assert.ok(auditLog!.summary.includes('PEQUENA'), `el resumen debe mencionar la banda cambiada (dio "${auditLog!.summary}")`);
      assert.equal(auditLog!.actorEmail, (await prisma.user.findUniqueOrThrow({ where: { id: auditLog!.actorId } })).email);

      const html = await (await fetch(`${BASE_URL}/precios`)).text();
      const formateado = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(precioNuevo);
      assert.ok(html.includes(formateado) || html.includes(String(precioNuevo)), '/precios debe reflejar el precio nuevo');
    });

    await prueba('/admin/precios: precio de banda <= 0 se rechaza (422), sin tocar la base', async () => {
      const payload = payloadPrecios();
      payload.bands[0] = { ...payload.bands[0], monthlyPriceArs: 0 };
      const respuesta = await admin.request.fetch(`${BASE_URL}/api/admin/billing/precios`, { method: 'PATCH', data: payload });
      assert.equal(respuesta.status(), 422, await respuesta.text());
      const banda = await prisma.institutionalBand.findUniqueOrThrow({ where: { key: 'PEQUENA' } });
      assert.equal(banda.monthlyPriceArs.toNumber(), precioNuevo, 'no debe haber cambiado nada');
    });

    await prueba('/admin/precios: precio de ciclo negativo se rechaza (422)', async () => {
      const payload = payloadPrecios();
      payload.bands[0] = { ...payload.bands[0], cyclePriceArs: -10 };
      const respuesta = await admin.request.fetch(`${BASE_URL}/api/admin/billing/precios`, { method: 'PATCH', data: payload });
      assert.equal(respuesta.status(), 422, await respuesta.text());
    });

    await prueba('/admin/precios: créditos negativos en un plan se rechazan (422)', async () => {
      const payload = payloadPrecios();
      payload.plans[0] = { ...payload.plans[0], monthlyCredits: -5 };
      const respuesta = await admin.request.fetch(`${BASE_URL}/api/admin/billing/precios`, { method: 'PATCH', data: payload });
      assert.equal(respuesta.status(), 422, await respuesta.text());
    });

    await prueba('/admin/precios: umbral Hablemos en 0 se rechaza (422, mínimo 1)', async () => {
      const payload = payloadPrecios();
      payload.settings.hablemosThresholdStudents = 0;
      const respuesta = await admin.request.fetch(`${BASE_URL}/api/admin/billing/precios`, { method: 'PATCH', data: payload });
      assert.equal(respuesta.status(), 422, await respuesta.text());
    });

    await prueba('/admin/precios: tope del monotributo negativo se rechaza (422)', async () => {
      const payload = payloadPrecios();
      payload.settings.monotributoAnnualCapArs = -1;
      const respuesta = await admin.request.fetch(`${BASE_URL}/api/admin/billing/precios`, { method: 'PATCH', data: payload });
      assert.equal(respuesta.status(), 422, await respuesta.text());
    });

    // ───────────────────────────────────────────────────────
    // 3. /admin/altas — dominios, caché, matrícula, prueba, revisar, leads.
    // ───────────────────────────────────────────────────────
    const prepAlta = await prepararOrg(50, { createdVia: 'SELF_SERVE' });
    await prisma.organizationDomain.create({
      data: { organizationId: prepAlta.orgId, pattern: `extra-${prepAlta.dominio}`, status: 'PENDING' },
    });

    await prueba('/admin/altas: la institución de alta propia aparece en la cola', async () => {
      const respuesta = await admin.request.get(`${BASE_URL}/admin/altas`);
      assert.equal(respuesta.status(), 200);
      const html = await respuesta.text();
      assert.ok(html.includes(prepAlta.orgId), 'debe listar la organización pendiente de revisión');
    });

    const dominioPendiente = await prisma.organizationDomain.findFirstOrThrow({
      where: { organizationId: prepAlta.orgId, status: 'PENDING' },
    });

    await prueba('/admin/altas: verificar un dominio PENDING lo invalida en la caché — un docente nuevo con ese dominio se une al instante', async () => {
      const respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/altas/dominio`, {
        data: { domainId: dominioPendiente.id, accion: 'VERIFICAR' },
      });
      assert.equal(respuesta.status(), 200, await respuesta.text());

      const fila = await prisma.organizationDomain.findUniqueOrThrow({ where: { id: dominioPendiente.id } });
      assert.equal(fila.status, 'VERIFIED');

      // Sin esperar los 10s de la caché de `resolucion.ts`: si la verificación
      // no invalida la caché, este registro NO se uniría a la organización
      // (quedaría afuera, como cuenta personal) hasta que la caché expirara sola.
      const nuevaMaestra = await registrar(`nueva-maestra@${dominioPendiente.pattern}`);
      const filaNuevaMaestra = await prisma.user.findUniqueOrThrow({ where: { id: nuevaMaestra.userId }, select: { organizationId: true } });
      assert.equal(filaNuevaMaestra.organizationId, prepAlta.orgId, 'debe unirse a la organización de inmediato, sin esperar la caché de 10s');
    });

    await prueba('/admin/altas: eliminar un dominio lo saca de la organización', async () => {
      const extra = await prisma.organizationDomain.create({
        data: { organizationId: prepAlta.orgId, pattern: `borrar-${prepAlta.dominio}`, status: 'PENDING' },
      });
      const respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/altas/dominio`, {
        data: { domainId: extra.id, accion: 'ELIMINAR' },
      });
      assert.equal(respuesta.status(), 200, await respuesta.text());
      const fila = await prisma.organizationDomain.findUnique({ where: { id: extra.id } });
      assert.equal(fila, null);
    });

    await prueba('/admin/altas: editar la matrícula declarada mientras está en TRIAL actualiza la banda', async () => {
      const respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/altas/matricula`, {
        data: { organizationId: prepAlta.orgId, declaredStudents: 500 },
      });
      assert.equal(respuesta.status(), 200, await respuesta.text());
      const license = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: prepAlta.orgId } });
      assert.equal(license.declaredStudents, 500);
      assert.equal(license.bandKey, 'MEDIANA');
    });

    await prueba('/admin/altas: extender la prueba suma días a trialEndsAt', async () => {
      const antes = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: prepAlta.orgId } });
      const respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/altas/prueba`, {
        data: { organizationId: prepAlta.orgId, dias: 15 },
      });
      assert.equal(respuesta.status(), 200, await respuesta.text());
      const despues = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: prepAlta.orgId } });
      assert.equal(despues.trialEndsAt!.getTime() - antes.trialEndsAt!.getTime(), 15 * 86_400_000);
    });

    // T11: con `BillingSettings.trialEnabled = false` (el default), un alta
    // propia arranca en PENDING_PAYMENT, sin prueba — "Extender/dar prueba"
    // en /admin/altas es el único camino para que el superadmin le dé una
    // prueba A MANO a esa institución puntual.
    const prepSinPrueba = await prepararOrg(80, { createdVia: 'SELF_SERVE', status: 'PENDING_PAYMENT', trialEndsAt: null });

    await prueba('/admin/altas: "Extender/dar prueba" sobre PENDING_PAYMENT la pasa a TRIAL', async () => {
      const antes = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: prepSinPrueba.orgId } });
      assert.equal(antes.status, 'PENDING_PAYMENT');
      assert.equal(antes.trialEndsAt, null);

      const respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/altas/prueba`, {
        data: { organizationId: prepSinPrueba.orgId, dias: 15 },
      });
      assert.equal(respuesta.status(), 200, await respuesta.text());

      const despues = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: prepSinPrueba.orgId } });
      assert.equal(despues.status, 'TRIAL', 'el superadmin le dio una prueba a mano — pasa a TRIAL aunque el interruptor global siga apagado');
      assert.ok(despues.trialEndsAt, 'tiene que quedar con una fecha de fin de prueba');
      const diasOtorgados = Math.round((despues.trialEndsAt!.getTime() - Date.now()) / 86_400_000);
      assert.ok(diasOtorgados >= 14 && diasOtorgados <= 15, `debe otorgar ~15 días desde HOY, no "15 días más" sobre un trialEndsAt nulo (dio ${diasOtorgados})`);
    });

    await prueba('/admin/altas: extender una licencia que no está ni en prueba ni esperando una se rechaza (409)', async () => {
      const activa = await prepararOrg(80, { status: 'ACTIVE', trialEndsAt: null, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) });
      const respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/altas/prueba`, {
        data: { organizationId: activa.orgId, dias: 15 },
      });
      assert.equal(respuesta.status(), 409, await respuesta.text());
    });

    await prueba('/admin/altas: marcar revisada saca a la institución de la cola', async () => {
      const respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/altas/revisar`, {
        data: { organizationId: prepAlta.orgId },
      });
      assert.equal(respuesta.status(), 200, await respuesta.text());
      const html = await (await admin.request.get(`${BASE_URL}/admin/altas`)).text();
      assert.ok(!html.includes(`data-institucion="${prepAlta.orgId}"`), 'ya no debe aparecer en la cola');
    });

    const lead = await prisma.institutionLead.create({
      data: { institutionName: `Red Hablemos E2E ${SUFIJO}`, contactName: 'Contacto E2E', contactEmail: `lead-${SUFIJO}@hablemos-e2e.com`, declaredStudents: 5000 },
    });
    leadsCreados.push(lead.id);

    await prueba('/admin/altas: marcar un lead como contactado NO lo saca de la cola', async () => {
      const respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/altas/lead`, {
        data: { leadId: lead.id, accion: 'CONTACTED', note: 'Llamado E2E' },
      });
      assert.equal(respuesta.status(), 200, await respuesta.text());
      const fila = await prisma.institutionLead.findUniqueOrThrow({ where: { id: lead.id } });
      assert.equal(fila.status, 'CONTACTED');
      assert.equal(fila.reviewedAt, null, 'contactado no es lo mismo que cerrado');
    });

    await prueba('/admin/altas: cerrar un lead lo saca de la cola', async () => {
      const respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/altas/lead`, {
        data: { leadId: lead.id, accion: 'CLOSED', note: null },
      });
      assert.equal(respuesta.status(), 200, await respuesta.text());
      const fila = await prisma.institutionLead.findUniqueOrThrow({ where: { id: lead.id } });
      assert.equal(fila.status, 'CLOSED');
      assert.ok(fila.reviewedAt !== null);
    });

    // ───────────────────────────────────────────────────────
    // 4. Activación manual por transferencia, toggle MANUAL, reintegro.
    // ───────────────────────────────────────────────────────
    const prepManual = await prepararOrg(100);
    let paymentIdManual = '';

    await prueba('activación manual por transferencia: licencia ACTIVE, período correcto, provider MANUAL, factura PENDING', async () => {
      const periodStart = '2027-03-01';
      const periodEnd = '2028-02-29';
      const respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/altas/manual-activar`, {
        data: { organizationId: prepManual.orgId, interval: 'CYCLE', periodStart, periodEnd, amountArs: 500000, paymentDate: '2027-02-15' },
      });
      assert.equal(respuesta.status(), 200, await respuesta.text());
      const { paymentId } = (await respuesta.json()) as { paymentId: string };
      paymentIdManual = paymentId;

      const license = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: prepManual.orgId } });
      assert.equal(license.status, 'ACTIVE');
      assert.equal(license.interval, 'CYCLE');
      assert.equal(license.currentPeriodStart!.toISOString().slice(0, 10), periodStart);
      assert.equal(license.currentPeriodEnd!.toISOString().slice(0, 10), periodEnd);
      assert.equal(license.trialEndsAt, null);

      const pago = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      assert.equal(pago.provider, 'MANUAL');
      assert.equal(pago.status, 'APPROVED');
      assert.equal(pago.amountArs.toNumber(), 500000);

      // Esta activación manual no carga razón social/CUIT: con un facturador
      // CONFIGURADO (INVOICE_PROVIDER=simulado/arca — el caso de
      // `npm run test:cobros`, que también necesita INVOICE_PROVIDER=simulado
      // para planes-facturacion.ts/planes-recorrido.ts), `activarLicenciaManual
      // PorTransferencia` igual intenta emitir después de la transacción
      // (aplicar.ts) y esa emisión falla por falta de esos datos — nunca
      // bloquea la activación de la licencia, pero la factura queda FAILED en
      // vez de PENDING. Sin ningún facturador configurado (INVOICE_PROVIDER
      // vacío/"none"), `resolverFacturador()` da null y ni siquiera lo intenta:
      // ahí sí queda PENDING.
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { paymentId } });
      const hayFacturador = !!process.env.INVOICE_PROVIDER && process.env.INVOICE_PROVIDER !== 'none';
      if (hayFacturador) {
        assert.equal(invoice.status, 'FAILED', `sin razón social/CUIT cargados, la emisión automática debe fallar (dio ${invoice.status})`);
        assert.ok(invoice.lastError, 'debe guardar el motivo del fallo');
      } else {
        assert.equal(invoice.status, 'PENDING');
      }
    });

    await prueba('activación manual: período inválido (fin <= inicio) se rechaza', async () => {
      const respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/altas/manual-activar`, {
        data: { organizationId: prepManual.orgId, interval: 'MONTHLY', periodStart: '2027-05-01', periodEnd: '2027-04-01', amountArs: 1000, paymentDate: '2027-05-01' },
      });
      assert.equal(respuesta.status(), 422, await respuesta.text());
    });

    await prueba('toggle MANUAL: pasar a MANUAL y volver deja la licencia en ACTIVE (ya tenía período)', async () => {
      let respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/altas/manual-estado`, {
        data: { organizationId: prepManual.orgId, aManual: true },
      });
      assert.equal(respuesta.status(), 200, await respuesta.text());
      let license = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: prepManual.orgId } });
      assert.equal(license.status, 'MANUAL');

      respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/altas/manual-estado`, {
        data: { organizationId: prepManual.orgId, aManual: false },
      });
      assert.equal(respuesta.status(), 200, await respuesta.text());
      license = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: prepManual.orgId } });
      assert.equal(license.status, 'ACTIVE', 'con período ya cargado, vuelve a ACTIVE (no a TRIAL)');
    });

    await prueba('toggle MANUAL: pasar a MANUAL dos veces seguidas se rechaza (409)', async () => {
      await admin.request.post(`${BASE_URL}/api/admin/billing/altas/manual-estado`, { data: { organizationId: prepManual.orgId, aManual: true } });
      const respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/altas/manual-estado`, { data: { organizationId: prepManual.orgId, aManual: true } });
      assert.equal(respuesta.status(), 409, await respuesta.text());
      await admin.request.post(`${BASE_URL}/api/admin/billing/altas/manual-estado`, { data: { organizationId: prepManual.orgId, aManual: false } });
    });

    await prueba('marcar reintegro hecho: requiere refundRequested, no se puede marcar dos veces', async () => {
      let respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/reintegro`, { data: { paymentId: paymentIdManual } });
      assert.equal(respuesta.status(), 409, 'este pago no tiene reintegro pedido todavía');

      await prisma.payment.update({ where: { id: paymentIdManual }, data: { refundRequested: true } });
      respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/reintegro`, { data: { paymentId: paymentIdManual } });
      assert.equal(respuesta.status(), 200, await respuesta.text());
      const pago = await prisma.payment.findUniqueOrThrow({ where: { id: paymentIdManual } });
      assert.equal(pago.status, 'REFUNDED');
      assert.ok(pago.refundedAt);

      respuesta = await admin.request.post(`${BASE_URL}/api/admin/billing/reintegro`, { data: { paymentId: paymentIdManual } });
      assert.equal(respuesta.status(), 409, 'ya estaba marcado como hecho');
    });

    // ───────────────────────────────────────────────────────
    // 5. Monotributo — 70% y 90% del tope.
    // ───────────────────────────────────────────────────────
    const prepMonotributo = await prepararOrg(100, { status: 'ACTIVE', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000), bandKey: 'PEQUENA' });
    const CAP = 1_000_000;

    async function fijarMonotributo(porcentajeObjetivo: number): Promise<void> {
      await prisma.payment.deleteMany({ where: { organizationId: prepMonotributo.orgId } });
      await prisma.billingSettings.update({ where: { id: 1 }, data: { monotributoAnnualCapArs: CAP } });
      await prisma.payment.create({
        data: {
          organizationId: prepMonotributo.orgId,
          amountArs: CAP * porcentajeObjetivo,
          status: 'APPROVED',
          provider: 'MANUAL',
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 86_400_000),
        },
      });
    }

    await prueba('/admin/facturacion: al 90% del tope del monotributo, aviso fuerte y banner en AdminLayout', async () => {
      await fijarMonotributo(0.9);
      const html = await (await admin.request.get(`${BASE_URL}/admin/facturacion`)).text();
      assert.ok(html.includes('90%'), `debe mostrar 90% (buscado en el html)`);
      assert.ok(html.includes('acercando al tope del monotributo'), 'debe mostrar el aviso');

      const htmlAdmin = await (await admin.request.get(`${BASE_URL}/admin/precios`)).text();
      assert.ok(htmlAdmin.includes('aviso-monotributo'), 'el banner de AdminLayout debe aparecer en CUALQUIER página de /admin a partir del 90%');
    });

    await prueba('/admin/facturacion: al 70% del tope, aviso más leve, sin el banner global (sólo arranca en 90%)', async () => {
      await fijarMonotributo(0.7);
      const html = await (await admin.request.get(`${BASE_URL}/admin/facturacion`)).text();
      assert.ok(html.includes('70%'), 'debe mostrar 70%');
      assert.ok(html.includes('acercando al tope del monotributo'), 'debe mostrar igual un aviso (más leve) a partir del 70%');

      const htmlAdmin = await (await admin.request.get(`${BASE_URL}/admin/precios`)).text();
      assert.ok(!htmlAdmin.includes('aviso-monotributo'), 'el banner GLOBAL de AdminLayout sólo dispara al 90%, no al 70%');
    });

    await prisma.payment.deleteMany({ where: { organizationId: prepMonotributo.orgId } });
    await prisma.billingSettings.update({ where: { id: 1 }, data: { monotributoAnnualCapArs: settingsOriginal.monotributoAnnualCapArs } });

    // ───────────────────────────────────────────────────────
    // 6. Renovación T4b — ciclo institucional y anual individual.
    // ───────────────────────────────────────────────────────
    // Los dos dominios se crean juntos y se espera la caché de organizaciones
    // UNA sola vez antes de registrar a ninguno de los dos admins — mismo
    // criterio que `prepararOrg`/el comentario de `planes-cobro.ts`.
    const prepRenovOrg = await prepararOrg(100);
    const prepVencidaOrg = await prepararOrg(100);
    const periodEndOrgCercano = new Date(Date.now() + 20 * 86_400_000); // dentro de la ventana de 30 días
    const graceDays = settingsOriginal.graceDays;
    await prisma.organizationLicense.update({
      where: { organizationId: prepRenovOrg.orgId },
      data: { status: 'ACTIVE', interval: 'CYCLE', bandKey: 'PEQUENA', currentPeriodStart: new Date(Date.now() - 300 * 86_400_000), currentPeriodEnd: periodEndOrgCercano, trialEndsAt: null },
    });
    await prisma.organizationLicense.update({
      where: { organizationId: prepVencidaOrg.orgId },
      data: {
        status: 'ACTIVE',
        interval: 'CYCLE',
        bandKey: 'PEQUENA',
        currentPeriodStart: new Date(Date.now() - 400 * 86_400_000),
        currentPeriodEnd: new Date(Date.now() - (graceDays + 2) * 86_400_000),
        trialEndsAt: null,
      },
    });
    console.log('… esperando 11s la caché de organizaciones del dev server…');
    await esperar(11_000);
    const adminRenovOrg = await registrarAdminDe(prepRenovOrg);
    const adminVencidaOrg = await registrarAdminDe(prepVencidaOrg);

    await prueba('/org/plan: banner de renovación visible cuando faltan <= 30 días para el fin del ciclo', async () => {
      const html = await (await adminRenovOrg.page.request.get(`${BASE_URL}/org/plan`)).text();
      assert.ok(html.includes('data-renovacion-banner="org"'), 'debe mostrar el banner de renovación');
    });

    let urlRenovacionOrg = '';
    await prueba('org/renovar: pedir una renovación mientras otra sigue PENDING (sin pagar) se rechaza (409)', async () => {
      const r1 = await adminRenovOrg.page.request.post(`${BASE_URL}/api/billing/org/renovar`, { data: {} });
      assert.equal(r1.status(), 200, await r1.text());
      urlRenovacionOrg = ((await r1.json()) as { url: string }).url;

      const r2 = await adminRenovOrg.page.request.post(`${BASE_URL}/api/billing/org/renovar`, { data: {} });
      assert.equal(r2.status(), 409, await r2.text());
    });

    await prueba('org/renovar: el checkout extiende el período EXACTAMENTE un ciclo desde el día siguiente al vencimiento', async () => {
      const resultado = await accionarPagoSimulado(adminRenovOrg.page, urlRenovacionOrg, 'aprobar');
      assert.equal(resultado.applied, true, JSON.stringify(resultado));

      const license = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: prepRenovOrg.orgId } });
      assert.equal(license.currentPeriodStart!.getTime(), periodEndOrgCercano.getTime() + 1, 'el nuevo período arranca 1ms después del vencimiento anterior, nunca "hoy"');
      assert.ok(license.currentPeriodEnd!.getTime() > periodEndOrgCercano.getTime(), 'el período se extendió');
      assert.equal(license.status, 'ACTIVE');
    });

    await prueba('org/renovar: aprobar el MISMO pago dos veces no extiende el período de nuevo (idempotencia del webhook)', async () => {
      const antes = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: prepRenovOrg.orgId } });
      const resultado = await accionarPagoSimulado(adminRenovOrg.page, urlRenovacionOrg, 'aprobar');
      assert.equal(resultado.ok, false, 'el checkout ya no está PENDING, no se puede volver a aprobar');
      const despues = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: prepRenovOrg.orgId } });
      assert.equal(despues.currentPeriodEnd!.getTime(), antes.currentPeriodEnd!.getTime(), 'no debe haberse extendido una segunda vez');
    });

    await prueba('CYCLE institucional: pasado el vencimiento + gracia sin pagar, queda READ_ONLY', async () => {
      await adminVencidaOrg.page.request.get(`${BASE_URL}/org/plan`); // dispara la reconciliación perezosa
      const license = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: prepVencidaOrg.orgId } });
      assert.equal(license.status, 'READ_ONLY');
    });

    // ── Individual ANNUAL: suscribirse, renovar, idempotencia, vencer sin pagar -> FREE ──
    const indivAnual = await registrar(`individual-anual-${SUFIJO}@afuera-superadmin-e2e.com`);
    await prueba('individual ANNUAL: suscribirse y renovar extiende exactamente un año desde el vencimiento anterior', async () => {
      const checkout = await indivAnual.page.request.post(`${BASE_URL}/api/billing/individual/checkout`, { data: { interval: 'ANNUAL' } });
      assert.equal(checkout.status(), 200, await checkout.text());
      const { url } = (await checkout.json()) as { url: string };
      let resultado = await accionarPagoSimulado(indivAnual.page, url, 'aprobar');
      assert.equal(resultado.applied, true, JSON.stringify(resultado));

      const subInicial = await prisma.individualSubscription.findUniqueOrThrow({ where: { userId: indivAnual.userId } });
      // Acercamos el vencimiento a 20 días para entrar en la ventana del banner/renovación.
      const periodEndCercano = new Date(Date.now() + 20 * 86_400_000);
      await prisma.individualSubscription.update({ where: { id: subInicial.id }, data: { currentPeriodEnd: periodEndCercano } });

      const htmlPlan = await (await indivAnual.page.request.get(`${BASE_URL}/app/plan`)).text();
      assert.ok(htmlPlan.includes('data-renovacion-banner="individual"'), 'debe mostrar el banner en /app/plan');

      const renovar = await indivAnual.page.request.post(`${BASE_URL}/api/billing/individual/renovar`, { data: {} });
      assert.equal(renovar.status(), 200, await renovar.text());
      const { url: urlRenov } = (await renovar.json()) as { url: string };
      resultado = await accionarPagoSimulado(indivAnual.page, urlRenov, 'aprobar');
      assert.equal(resultado.applied, true, JSON.stringify(resultado));

      const subRenovada = await prisma.individualSubscription.findUniqueOrThrow({ where: { id: subInicial.id } });
      assert.equal(subRenovada.currentPeriodStart.getTime(), periodEndCercano.getTime(), 'el nuevo período arranca EXACTAMENTE donde terminó el anterior');
      const unAnioMs = subRenovada.currentPeriodEnd.getTime() - subRenovada.currentPeriodStart.getTime();
      assert.ok(unAnioMs > 360 * 86_400_000 && unAnioMs < 367 * 86_400_000, 'debe cubrir un año');

      // Replay: aprobar el mismo pago dos veces no debe extender de nuevo.
      const antes = subRenovada.currentPeriodEnd.getTime();
      const replay = await accionarPagoSimulado(indivAnual.page, urlRenov, 'aprobar');
      assert.equal(replay.ok, false, 'el checkout ya no está pendiente');
      const despuesReplay = await prisma.individualSubscription.findUniqueOrThrow({ where: { id: subInicial.id } });
      assert.equal(despuesReplay.currentPeriodEnd.getTime(), antes, 'no debe haberse extendido una segunda vez');
    });

    await prueba('individual ANNUAL: pasado el vencimiento sin pagar, vuelve a FREE', async () => {
      const indivVencido = await registrar(`individual-vencido-${SUFIJO}@afuera-superadmin-e2e.com`);
      const checkout = await indivVencido.page.request.post(`${BASE_URL}/api/billing/individual/checkout`, { data: { interval: 'ANNUAL' } });
      const { url } = (await checkout.json()) as { url: string };
      await accionarPagoSimulado(indivVencido.page, url, 'aprobar');

      await prisma.individualSubscription.update({
        where: { userId: indivVencido.userId },
        data: { currentPeriodEnd: new Date(Date.now() - 5 * 86_400_000) },
      });

      await indivVencido.page.request.get(`${BASE_URL}/app/plan`); // dispara la reconciliación perezosa
      const sub = await prisma.individualSubscription.findUniqueOrThrow({ where: { userId: indivVencido.userId } });
      assert.equal(sub.status, 'CANCELED', '"sin fila ACTIVE" = FREE, ver creditos-servicio.ts');
    });

    // ───────────────────────────────────────────────────────
    // 7. Recordatorio de renovación — idempotente desde el cron interno.
    // ───────────────────────────────────────────────────────
    const prepRecordatorio = await prepararOrg(100);
    const periodEndAviso = new Date(Date.now() + 25 * 86_400_000); // dentro de los 30 días de aviso
    await prisma.organizationLicense.update({
      where: { organizationId: prepRecordatorio.orgId },
      data: { status: 'ACTIVE', interval: 'CYCLE', bandKey: 'PEQUENA', currentPeriodStart: new Date(), currentPeriodEnd: periodEndAviso, trialEndsAt: null },
    });

    await prueba('cron de recordatorios: con el secreto correcto, registra el aviso; llamarlo dos veces no lo duplica', async () => {
      const r1 = await docentePage.request.post(`${BASE_URL}/api/internal/recordatorios-renovacion`, {
        headers: { 'x-internal-secret': 'secreto-e2e-superadmin' },
        data: {},
      });
      assert.equal(r1.status(), 200, await r1.text());

      const antes = await prisma.renewalReminder.count({ where: { subjectId: (await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: prepRecordatorio.orgId } })).id } });
      assert.ok(antes >= 1, 'debe haber registrado al menos un aviso (30 días)');

      const r2 = await docentePage.request.post(`${BASE_URL}/api/internal/recordatorios-renovacion`, {
        headers: { 'x-internal-secret': 'secreto-e2e-superadmin' },
        data: {},
      });
      assert.equal(r2.status(), 200, await r2.text());
      const despues = await prisma.renewalReminder.count({ where: { subjectId: (await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: prepRecordatorio.orgId } })).id } });
      assert.equal(despues, antes, 'una segunda llamada al cron no debe duplicar el aviso ya registrado para este período');
    });

    // ───────────────────────────────────────────────────────
    // 8. Capturas 1280 claro/oscuro de las tres páginas nuevas.
    // ───────────────────────────────────────────────────────
    await prueba('capturas: /admin/precios, /admin/altas, /admin/facturacion a 1280 claro/oscuro, sin scroll horizontal', async () => {
      await capturar(admin, `${BASE_URL}/admin/precios`, 'admin-precios', '#form-precios');
      await capturar(admin, `${BASE_URL}/admin/altas`, 'admin-altas', 'h1');
      await capturar(admin, `${BASE_URL}/admin/facturacion`, 'admin-facturacion', 'h1');
    });

    console.log('\n✔ e2e/planes-superadmin.ts: todos los escenarios pasaron');
  } finally {
    for (const browser of browsersAbiertos) await browser.close().catch(() => {});
    await limpiar();
    await prisma.$disconnect();
    pararDevServer();
  }

  if (fallas > 0) {
    console.error(`\n✖ e2e/planes-superadmin.ts: ${fallas} prueba(s) fallaron`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('\n✖ e2e/planes-superadmin.ts falló:', error);
  process.exitCode = 1;
});
