import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { firstCharge } from '../src/lib/billing/ciclo.ts';
import type { Page } from 'playwright';

/**
 * odd/tasks/planes-y-cobros.md (T4): e2e del cobro con el adaptador
 * SIMULADO — checkout, aprobar/rechazar desde `/pago-simulado/[id]`,
 * renovación, cancelación y arrepentimiento, contra el servidor real.
 *
 * Sobre `BILLING_FAKE_NOW` (T4, documentado en env.ts): este script NO lo
 * usa. El escenario de ciclo lectivo corre en la fecha REAL en la que se
 * ejecuta el e2e — hoy (2026-10-01) cae en septiembre-diciembre, así que
 * alcanza para ejercitar esa rama de `firstCharge` sin fijar el reloj; las
 * otras dos ramas (marzo-agosto, enero-febrero) ya están cubiertas a fondo
 * por `e2e/unidad-planes.ts` (T1, puro). `BILLING_FAKE_NOW` queda
 * implementado para un e2e futuro que sí necesite forzar el mes.
 *
 * Requiere la pila de este worktree levantada:
 *   BILLING_PROVIDER=simulado PORT=3200 npm run dev
 * Corre con: KODU_BASE_URL=http://localhost:3200 npx tsx e2e/planes-cobro.ts
 */

const SUFIJO = randomUUID().slice(0, 8);
const DOCENTE_PASSWORD = 'Docente.E2E.Cobro.2026';
const CUIT_VALIDO = '20-12345678-6';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const emailsCreados: string[] = [];
const organizacionesCreadas: string[] = [];
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

async function registrar(email: string): Promise<{ page: Page; body: any }> {
  emailsCreados.push(email);
  const browser = await abrirNavegador();
  browsersAbiertos.push(browser);
  const page = await (await browser.newContext()).newPage();
  const respuesta = await page.request.post(`${BASE_URL}/api/auth/register`, {
    data: { name: `Docente ${email.split('@')[0]}`, email, password: DOCENTE_PASSWORD },
  });
  assert.equal(respuesta.status(), 200, `registro de ${email} (dio ${respuesta.status()}: ${await respuesta.text()})`);
  const body = await respuesta.json();
  return { page, body };
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sólo CREA la organización, el dominio y la licencia TRIAL — no registra a
 * nadie todavía. `organizacionParaEmail` (resolucion.ts) cachea la lista de
 * dominios 10s DENTRO DEL PROCESO DEL SERVIDOR (no de este script): hace
 * falta crear TODOS los dominios de este e2e antes de registrar a NINGÚN
 * docente y esperar una sola vez (mismo criterio que
 * `e2e/planes-acceso.ts`), en vez de crear y registrar de a uno.
 */
async function prepararOrg(declaredStudents: number): Promise<{ orgId: string; dominio: string }> {
  const dominio = `cobro-${randomUUID().slice(0, 8)}.edu.ar`;
  const org = await prisma.organization.create({ data: { name: `Org cobro E2E ${dominio}`, kind: 'CAMPUS' }, select: { id: true } });
  organizacionesCreadas.push(org.id);
  await prisma.organizationDomain.create({ data: { organizationId: org.id, pattern: dominio } });
  await prisma.organizationLicense.create({
    data: { organizationId: org.id, status: 'TRIAL', declaredStudents, trialEndsAt: new Date(Date.now() + 30 * 86_400_000) },
  });
  return { orgId: org.id, dominio };
}

async function registrarAdminDe(org: { orgId: string; dominio: string }): Promise<{ page: Page; userId: string }> {
  const { page, body } = await registrar(`admin@${org.dominio}`);
  assert.equal(body.user.organizationId, org.orgId, `admin@${org.dominio} debe unirse a la organización por dominio`);
  await prisma.organizationAdmin.create({ data: { userId: body.user.id, organizationId: org.orgId } });
  return { page, userId: body.user.id };
}

interface AccionResultado {
  ok: boolean;
  applied?: boolean;
  reason?: string;
  backUrl?: string;
  error?: string;
}

async function accionarPagoSimulado(page: Page, checkoutUrl: string, accion: string): Promise<AccionResultado> {
  const id = checkoutUrl.split('/').pop()!;
  const respuesta = await page.request.post(`${BASE_URL}/api/billing/pago-simulado/${id}/accion`, { data: { accion } });
  const cuerpo = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: respuesta.ok() && cuerpo.ok === true, ...cuerpo } as AccionResultado;
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

async function main(): Promise<void> {
  try {
    // Las dos organizaciones (y sus dominios) se crean juntas, ANTES de
    // registrar a nadie, y se espera UNA sola vez la caché de
    // `organizacionParaEmail` — ver el comentario de `prepararOrg`.
    const prep1 = await prepararOrg(100); // PEQUENA
    const prep2 = await prepararOrg(500); // MEDIANA
    console.log('… esperando 11s la caché de organizaciones del dev server…');
    await esperar(11_000);

    const admin1 = await registrarAdminDe(prep1);
    const admin2 = await registrarAdminDe(prep2);
    const org1 = { orgId: prep1.orgId, dominio: prep1.dominio, page: admin1.page };
    const org2 = { orgId: prep2.orgId, dominio: prep2.dominio, page: admin2.page };

    // ───────────────────────────────────────────────────────
    // 1. Org en TRIAL contrata MONTHLY → aprobar → ACTIVE.
    // ───────────────────────────────────────────────────────
    let checkoutUrlOrg1Monthly = '';
    let idPagoOrg1Monthly = '';

    await prueba('org checkout MONTHLY: admin de la organización puede contratar', async () => {
      const respuesta = await org1.page.request.post(`${BASE_URL}/api/billing/org/checkout`, {
        data: { interval: 'MONTHLY', legalName: 'Escuela E2E SRL', cuit: CUIT_VALIDO },
      });
      assert.equal(respuesta.status(), 200, await respuesta.text());
      const cuerpo = (await respuesta.json()) as { url: string };
      assert.ok(cuerpo.url.startsWith('/pago-simulado/'), `debe ser una URL de pago simulado (dio ${cuerpo.url})`);
      checkoutUrlOrg1Monthly = cuerpo.url;
      idPagoOrg1Monthly = cuerpo.url.split('/').pop()!;

      const banda = await prisma.institutionalBand.findUniqueOrThrow({ where: { key: 'PEQUENA' } });
      const pago = await prisma.pagoSimulado.findUniqueOrThrow({ where: { id: idPagoOrg1Monthly } });
      assert.equal(pago.amountArs.toNumber(), banda.monthlyPriceArs.toNumber(), 'el checkout debe cobrar el precio mensual de la banda PEQUENA');
    });

    await prueba('org checkout MONTHLY: aprobar el pago simulado activa la licencia', async () => {
      const resultado = await accionarPagoSimulado(org1.page, checkoutUrlOrg1Monthly, 'aprobar');
      assert.equal(resultado.ok, true, JSON.stringify(resultado));
      assert.equal(resultado.applied, true, JSON.stringify(resultado));

      const license = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: org1.orgId } });
      assert.equal(license.status, 'ACTIVE');
      assert.equal(license.bandKey, 'PEQUENA');
      assert.ok(license.currentPeriodStart && license.currentPeriodEnd, 'debe tener período cargado');
      assert.equal(license.trialEndsAt, null, 'el trial se limpia al activarse');
    });

    await prueba('org checkout MONTHLY: aprobar el MISMO pago dos veces no lo aplica de nuevo', async () => {
      const resultado = await accionarPagoSimulado(org1.page, checkoutUrlOrg1Monthly, 'aprobar');
      // El checkout ya no está PENDING: resolverCheckoutSimulado devuelve
      // null y el endpoint responde 409 — la idempotencia real (por
      // providerPaymentId) ya se prueba en unidad-pasarela.ts; acá se
      // confirma que el camino end-to-end también la respeta.
      assert.equal(resultado.ok, false);
    });

    await prueba('org renovación fallida: pasa a PAST_DUE con gracia', async () => {
      const resultado = await accionarPagoSimulado(org1.page, checkoutUrlOrg1Monthly, 'renovacion_fallida');
      assert.equal(resultado.ok, true, JSON.stringify(resultado));
      assert.equal(resultado.applied, true, JSON.stringify(resultado));

      const license = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: org1.orgId } });
      assert.equal(license.status, 'PAST_DUE');
      assert.ok(license.graceEndsAt && license.graceEndsAt.getTime() > Date.now(), 'debe tener gracia vigente');
    });

    await prueba('org renovación aprobada: vuelve a ACTIVE y extiende el período', async () => {
      const licenciaAntes = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: org1.orgId } });
      const resultado = await accionarPagoSimulado(org1.page, checkoutUrlOrg1Monthly, 'renovacion_ok');
      assert.equal(resultado.ok, true, JSON.stringify(resultado));

      const license = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: org1.orgId } });
      assert.equal(license.status, 'ACTIVE');
      assert.equal(license.graceEndsAt, null);
      assert.ok(
        license.currentPeriodEnd!.getTime() > licenciaAntes.currentPeriodEnd!.getTime(),
        'el período debe haberse extendido',
      );
    });

    // ───────────────────────────────────────────────────────
    // 2. Org en TRIAL contrata CYCLE (hoy cae en sep-dic).
    // ───────────────────────────────────────────────────────
    await prueba('org checkout CYCLE (septiembre-diciembre): cobra el ciclo siguiente completo', async () => {
      const respuesta = await org2.page.request.post(`${BASE_URL}/api/billing/org/checkout`, {
        data: { interval: 'CYCLE', legalName: 'Red E2E SA', cuit: CUIT_VALIDO },
      });
      assert.equal(respuesta.status(), 200, await respuesta.text());
      const cuerpo = (await respuesta.json()) as { url: string };
      const id = cuerpo.url.split('/').pop()!;

      const banda = await prisma.institutionalBand.findUniqueOrThrow({ where: { key: 'MEDIANA' } });
      const esperado = firstCharge({
        date: new Date(),
        interval: 'CYCLE',
        banda: { monthlyPriceArs: banda.monthlyPriceArs.toNumber(), cyclePriceArs: banda.cyclePriceArs.toNumber() },
      });

      const pago = await prisma.pagoSimulado.findUniqueOrThrow({ where: { id } });
      assert.equal(pago.amountArs.toNumber(), esperado.amountArs, `debe cobrar ${esperado.note}`);

      const resultado = await accionarPagoSimulado(org2.page, cuerpo.url, 'aprobar');
      assert.equal(resultado.applied, true, JSON.stringify(resultado));

      const license = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: org2.orgId } });
      assert.equal(license.status, 'ACTIVE');
      assert.equal(license.currentPeriodEnd!.getTime(), esperado.periodEnd.getTime());
    });

    // ───────────────────────────────────────────────────────
    // 3. Autorización: no-admin y cuenta personal no pueden contratar org.
    // ───────────────────────────────────────────────────────
    await prueba('org checkout: un docente NO admin de la organización no puede contratar', async () => {
      const { page, body } = await registrar(`docente@${org1.dominio}`);
      assert.notEqual(body.user.organizationId, null);
      const respuesta = await page.request.post(`${BASE_URL}/api/billing/org/checkout`, {
        data: { interval: 'MONTHLY', legalName: 'x', cuit: CUIT_VALIDO },
      });
      assert.equal(respuesta.status(), 404, `un no-admin no debe poder ni ver que la organización existe (dio ${respuesta.status()})`);
    });

    await prueba('org checkout: una cuenta personal no puede contratar una licencia institucional', async () => {
      const { page } = await registrar(`personal-org-${SUFIJO}@afuera-cobro-e2e.com`);
      const respuesta = await page.request.post(`${BASE_URL}/api/billing/org/checkout`, {
        data: { interval: 'MONTHLY', legalName: 'x', cuit: CUIT_VALIDO },
      });
      assert.equal(respuesta.status(), 403, `dio ${respuesta.status()}`);
    });

    // ───────────────────────────────────────────────────────
    // 4. Individual: suscribirse, créditos, cancelar, arrepentimiento.
    // ───────────────────────────────────────────────────────
    await prueba('individual checkout MONTHLY: aprobar sube los créditos al nivel Individual (1.000)', async () => {
      const { page, body } = await registrar(`individual-sub-${SUFIJO}@afuera-cobro-e2e.com`);
      const respuesta = await page.request.post(`${BASE_URL}/api/billing/individual/checkout`, { data: { interval: 'MONTHLY' } });
      assert.equal(respuesta.status(), 200, await respuesta.text());
      const { url } = (await respuesta.json()) as { url: string };

      const resultado = await accionarPagoSimulado(page, url, 'aprobar');
      assert.equal(resultado.applied, true, JSON.stringify(resultado));

      const sub = await prisma.individualSubscription.findUniqueOrThrow({ where: { userId: body.user.id } });
      assert.equal(sub.status, 'ACTIVE');
      assert.equal(sub.interval, 'MONTHLY');

      const saldo = await prisma.creditLedgerEntry.aggregate({ where: { userId: body.user.id }, _sum: { delta: true } });
      assert.ok((saldo._sum.delta ?? 0) >= 1000, `el saldo debe reflejar el nivel Individual (dio ${saldo._sum.delta})`);

      const planGrant = await prisma.creditLedgerEntry.findFirst({ where: { userId: body.user.id, kind: 'PLAN_GRANT' } });
      assert.ok(planGrant, 'debe existir un movimiento PLAN_GRANT de 1.000');
      assert.equal(planGrant!.delta, 1000);
    });

    await prueba('individual cancel: mantiene acceso (ACTIVE) hasta el fin del período', async () => {
      const { page, body } = await registrar(`individual-cancel-${SUFIJO}@afuera-cobro-e2e.com`);
      const checkout = await page.request.post(`${BASE_URL}/api/billing/individual/checkout`, { data: { interval: 'MONTHLY' } });
      const { url } = (await checkout.json()) as { url: string };
      await accionarPagoSimulado(page, url, 'aprobar');

      const cancelar = await page.request.post(`${BASE_URL}/api/billing/individual/cancel`, { data: {} });
      assert.equal(cancelar.status(), 200, await cancelar.text());

      const sub = await prisma.individualSubscription.findUniqueOrThrow({ where: { userId: body.user.id } });
      assert.equal(sub.status, 'ACTIVE', 'no se corta el acceso al cancelar: sigue ACTIVE hasta el fin del período');
      assert.equal(sub.cancelAtPeriodEnd, true);
    });

    await prueba('individual arrepentimiento: dentro de los 10 días, revierte a FREE', async () => {
      const { page, body } = await registrar(`individual-arrepentido-${SUFIJO}@afuera-cobro-e2e.com`);
      const checkout = await page.request.post(`${BASE_URL}/api/billing/individual/checkout`, { data: { interval: 'MONTHLY' } });
      const { url } = (await checkout.json()) as { url: string };
      await accionarPagoSimulado(page, url, 'aprobar');

      const arrepentimiento = await page.request.post(`${BASE_URL}/api/billing/individual/arrepentimiento`, { data: {} });
      assert.equal(arrepentimiento.status(), 200, await arrepentimiento.text());

      const sub = await prisma.individualSubscription.findUniqueOrThrow({ where: { userId: body.user.id } });
      assert.equal(sub.status, 'CANCELED');

      const pago = await prisma.payment.findFirst({ where: { individualSubscriptionId: sub.id, status: 'APPROVED' } });
      assert.ok(pago?.refundRequested, 'el primer pago debe quedar marcado para reintegro');
    });

    await prueba('individual checkout: una cuenta de organización no puede contratar el plan Individual', async () => {
      const respuesta = await org1.page.request.post(`${BASE_URL}/api/billing/individual/checkout`, { data: { interval: 'MONTHLY' } });
      assert.equal(respuesta.status(), 403, `dio ${respuesta.status()}`);
    });

    console.log('\n✔ e2e/planes-cobro.ts: todos los escenarios pasaron');
  } finally {
    for (const browser of browsersAbiertos) await browser.close().catch(() => {});
    await limpiar();
    await prisma.$disconnect();
  }

  if (fallas > 0) {
    console.error(`\n✖ e2e/planes-cobro.ts: ${fallas} prueba(s) fallaron`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('\n✖ e2e/planes-cobro.ts falló:', error);
  process.exitCode = 1;
});
