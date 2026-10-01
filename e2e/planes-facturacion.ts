import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { MARCADOR_FORZAR_FALLO_SIMULADO } from '../src/lib/billing/facturador/tipos.ts';
import type { Page } from 'playwright';

/**
 * odd/tasks/planes-y-cobros.md (T8): e2e de facturación contra el servidor
 * real, con el adaptador SIMULADO (`FacturadorSimulado`) — nunca pega contra
 * ARCA.
 *
 * Requiere la pila de este worktree levantada:
 *   BILLING_PROVIDER=simulado INVOICE_PROVIDER=simulado PORT=3200 npm run dev
 * Corre con: KODU_BASE_URL=http://localhost:3200 npx tsx e2e/planes-facturacion.ts
 */

const SUFIJO = randomUUID().slice(0, 8);
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

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';

async function paginaAdmin(): Promise<Page> {
  const browser = await abrirNavegador();
  browsersAbiertos.push(browser);
  const page = await (await browser.newContext()).newPage();
  await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return page;
}

async function registrar(email: string): Promise<{ page: Page; body: any }> {
  emailsCreados.push(email);
  const browser = await abrirNavegador();
  browsersAbiertos.push(browser);
  const page = await (await browser.newContext()).newPage();
  const respuesta = await page.request.post(`${BASE_URL}/api/auth/register`, {
    data: { name: `Docente ${email.split('@')[0]}`, email, password: 'Docente.E2E.Factura.2026' },
  });
  assert.equal(respuesta.status(), 200, `registro de ${email} (dio ${respuesta.status()}: ${await respuesta.text()})`);
  const body = await respuesta.json();
  return { page, body };
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function prepararOrg(declaredStudents: number): Promise<{ orgId: string; dominio: string }> {
  const dominio = `factura-${randomUUID().slice(0, 8)}.edu.ar`;
  const org = await prisma.organization.create({ data: { name: `Org factura E2E ${dominio}`, kind: 'CAMPUS' }, select: { id: true } });
  organizacionesCreadas.push(org.id);
  await prisma.organizationDomain.create({ data: { organizationId: org.id, pattern: dominio } });
  await prisma.organizationLicense.create({
    data: { organizationId: org.id, status: 'TRIAL', declaredStudents, trialEndsAt: new Date(Date.now() + 30 * 86_400_000) },
  });
  return { orgId: org.id, dominio };
}

async function registrarAdminDe(org: { orgId: string; dominio: string }): Promise<{ page: Page; userId: string }> {
  const { page, body } = await registrar(`admin@${org.dominio}`);
  await prisma.organizationAdmin.create({ data: { userId: body.user.id, organizationId: org.orgId } });
  return { page, userId: body.user.id };
}

async function accionarPagoSimulado(page: Page, checkoutUrl: string, accion: string): Promise<{ ok: boolean; applied?: boolean; reason?: string }> {
  const id = checkoutUrl.split('/').pop()!;
  const respuesta = await page.request.post(`${BASE_URL}/api/billing/pago-simulado/${id}/accion`, { data: { accion } });
  const cuerpo = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: respuesta.ok() && cuerpo.ok === true, ...cuerpo } as { ok: boolean; applied?: boolean; reason?: string };
}

async function reintentarFactura(adminPage: Page, invoiceId: string): Promise<{ status: number; body: any }> {
  const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/billing/facturas/reintentar`, { data: { invoiceId } });
  return { status: respuesta.status(), body: await respuesta.json().catch(() => ({})) };
}

async function limpiar(): Promise<void> {
  const usuarios = await prisma.user.findMany({ where: { email: { in: emailsCreados } }, select: { id: true } });
  const ids = usuarios.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.payment.deleteMany({ where: { userId: { in: ids } } });
    await prisma.individualSubscription.deleteMany({ where: { userId: { in: ids } } });
    await prisma.creditLedgerEntry.deleteMany({ where: { userId: { in: ids } } });
  }
  await prisma.payment.deleteMany({ where: { organizationId: { in: organizacionesCreadas } } });
  await prisma.user.deleteMany({ where: { email: { in: emailsCreados } } });
  for (const id of organizacionesCreadas) {
    await prisma.organization.deleteMany({ where: { id } });
  }
}

/**
 * `resolverFacturador()` sin servidor: comprueba, en un proceso aparte con
 * `INVOICE_PROVIDER` SIN cargar y `NODE_ENV=production`, que no hay forma de
 * terminar con un adaptador real — "nunca se inventa un CAE en producción"
 * (T8). No hace falta el dev server para esto: es resolución de
 * configuración pura.
 */
async function facturadorApagadoEnProduccionSinConfigurar(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const codigo = `
      import { resolverFacturador } from './src/lib/billing/facturador/index.ts';
      const resultado = resolverFacturador();
      process.stdout.write(JSON.stringify({ esNull: resultado === null }));
    `;
    const proceso = spawn('npx', ['tsx', '--eval', codigo], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        INVOICE_PROVIDER: '',
        AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e-facturacion-auth-secret-00000000000000000000',
      },
      cwd: process.cwd(),
    });
    let out = '';
    let err = '';
    proceso.stdout.on('data', (d) => (out += String(d)));
    proceso.stderr.on('data', (d) => (err += String(d)));
    proceso.on('error', reject);
    proceso.on('close', (code) => {
      if (code !== 0) return reject(new Error(`child falló (${code}): ${err}`));
      try {
        resolve((JSON.parse(out) as { esNull: boolean }).esNull);
      } catch {
        reject(new Error(`salida inesperada: ${out} / ${err}`));
      }
    });
  });
}

async function main(): Promise<void> {
  try {
    await prueba('config: INVOICE_PROVIDER sin cargar en producción nunca resuelve un adaptador real', async () => {
      const esNull = await facturadorApagadoEnProduccionSinConfigurar();
      assert.equal(esNull, true, 'resolverFacturador() debe dar null (facturación apagada), nunca inventar un CAE');
    });

    const prep1 = await prepararOrg(100);
    const prep2 = await prepararOrg(100);
    const prep3 = await prepararOrg(100);
    console.log('… esperando 11s la caché de organizaciones del dev server…');
    await esperar(11_000);

    const org1 = { ...prep1, ...(await registrarAdminDe(prep1)) };
    const org2 = { ...prep2, ...(await registrarAdminDe(prep2)) };
    const org3 = { ...prep3, ...(await registrarAdminDe(prep3)) };
    const adminPage = await paginaAdmin();

    // ───────────────────────────────────────────────────────
    // 1. Pago institucional aprobado → factura ISSUED con CAE, de una.
    // ───────────────────────────────────────────────────────
    await prueba('pago institucional aprobado: la factura queda ISSUED con CAE, sin reintentar nada', async () => {
      const checkout = await org1.page.request.post(`${BASE_URL}/api/billing/org/checkout`, {
        data: { interval: 'MONTHLY', legalName: 'Escuela Factura E2E SRL', cuit: CUIT_VALIDO, ivaCondition: 'MONOTRIBUTO' },
      });
      assert.equal(checkout.status(), 200, await checkout.text());
      const { url } = (await checkout.json()) as { url: string };
      const resultado = await accionarPagoSimulado(org1.page, url, 'aprobar');
      assert.equal(resultado.applied, true, JSON.stringify(resultado));

      const payment = await prisma.payment.findFirst({ where: { organizationId: org1.orgId }, orderBy: { createdAt: 'desc' } });
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { paymentId: payment!.id } });
      assert.equal(invoice.status, 'ISSUED');
      assert.ok(invoice.cae, 'debe tener CAE');
      assert.ok(invoice.number, 'debe tener número');
      assert.equal(invoice.condicionIvaReceptorId, 6, 'MONOTRIBUTO → CondicionIVAReceptorId 6');
      assert.equal(invoice.recipientDocType, 'CUIT');
    });

    // ───────────────────────────────────────────────────────
    // 2. Fallo forzado → FAILED; reintento desde el admin → ISSUED.
    // ───────────────────────────────────────────────────────
    let invoiceId2 = '';
    await prueba('pago institucional con fallo forzado: la factura queda FAILED con lastError y attempts', async () => {
      const checkout = await org2.page.request.post(`${BASE_URL}/api/billing/org/checkout`, {
        data: {
          interval: 'MONTHLY',
          legalName: `Escuela Fallo ${MARCADOR_FORZAR_FALLO_SIMULADO}`,
          cuit: CUIT_VALIDO,
          ivaCondition: 'EXENTO',
        },
      });
      const { url } = (await checkout.json()) as { url: string };
      const resultado = await accionarPagoSimulado(org2.page, url, 'aprobar');
      assert.equal(resultado.applied, true, JSON.stringify(resultado));

      const payment = await prisma.payment.findFirst({ where: { organizationId: org2.orgId }, orderBy: { createdAt: 'desc' } });
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { paymentId: payment!.id } });
      assert.equal(invoice.status, 'FAILED');
      assert.ok(invoice.lastError, 'debe guardar el motivo del fallo');
      assert.equal(invoice.attempts, 1);
      invoiceId2 = invoice.id;
    });

    await prueba('reintentar desde /admin/facturacion: con el marcador sacado, la factura pasa a ISSUED', async () => {
      await prisma.organizationLicense.update({ where: { organizationId: org2.orgId }, data: { legalName: 'Escuela Fallo (ya sin marcador) SRL' } });
      const { status, body } = await reintentarFactura(adminPage, invoiceId2);
      assert.equal(status, 200, JSON.stringify(body));
      assert.equal(body.status, 'ISSUED');

      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId2 } });
      assert.equal(invoice.status, 'ISSUED');
      assert.ok(invoice.cae);
    });

    // ───────────────────────────────────────────────────────
    // 3. Doble reintento concurrente: emite UNA sola vez.
    // ───────────────────────────────────────────────────────
    let invoiceId3 = '';
    await prueba('preparar org3 con una factura FAILED para el reintento concurrente', async () => {
      const checkout = await org3.page.request.post(`${BASE_URL}/api/billing/org/checkout`, {
        data: {
          interval: 'MONTHLY',
          legalName: `Escuela Concurrente ${MARCADOR_FORZAR_FALLO_SIMULADO}`,
          cuit: CUIT_VALIDO,
          ivaCondition: 'RESPONSABLE_INSCRIPTO',
        },
      });
      const { url } = (await checkout.json()) as { url: string };
      await accionarPagoSimulado(org3.page, url, 'aprobar');
      const payment = await prisma.payment.findFirst({ where: { organizationId: org3.orgId }, orderBy: { createdAt: 'desc' } });
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { paymentId: payment!.id } });
      assert.equal(invoice.status, 'FAILED');
      invoiceId3 = invoice.id;
      await prisma.organizationLicense.update({ where: { organizationId: org3.orgId }, data: { legalName: 'Escuela Concurrente (sin marcador) SRL' } });
    });

    await prueba('dos reintentos concurrentes: sólo uno emite, el otro ve 409', async () => {
      const [r1, r2] = await Promise.all([reintentarFactura(adminPage, invoiceId3), reintentarFactura(adminPage, invoiceId3)]);
      const estados = [r1.status, r2.status].sort();
      assert.deepEqual(estados, [200, 409], `uno debe ganar el lock (200) y el otro verlo ocupado (409) — dio ${JSON.stringify([r1, r2])}`);

      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId3 } });
      assert.equal(invoice.status, 'ISSUED');
      assert.equal(invoice.attempts, 1, 'sólo el intento forzado-fallido original cuenta; el reintento ganador no suma otro attempt de más');
    });

    // ───────────────────────────────────────────────────────
    // 4. Pago individual → consumidor final.
    // ───────────────────────────────────────────────────────
    await prueba('pago individual aprobado: factura consumidor final (DocTipo DNI, CondicionIVAReceptorId 5)', async () => {
      const { page, body } = await registrar(`individual-factura-${SUFIJO}@afuera-factura-e2e.com`);
      const checkout = await page.request.post(`${BASE_URL}/api/billing/individual/checkout`, { data: { interval: 'MONTHLY' } });
      const { url } = (await checkout.json()) as { url: string };
      const resultado = await accionarPagoSimulado(page, url, 'aprobar');
      assert.equal(resultado.applied, true, JSON.stringify(resultado));

      const payment = await prisma.payment.findFirstOrThrow({ where: { userId: body.user.id } });
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { paymentId: payment.id } });
      assert.equal(invoice.status, 'ISSUED');
      assert.equal(invoice.recipientDocType, 'DNI');
      assert.equal(invoice.condicionIvaReceptorId, 5, 'consumidor final → CondicionIVAReceptorId 5');
    });

    // ───────────────────────────────────────────────────────
    // 5. /admin/facturacion muestra la factura emitida con su CAE.
    // ───────────────────────────────────────────────────────
    await prueba('/admin/facturacion lista el CAE de una factura emitida', async () => {
      await adminPage.goto(`${BASE_URL}/admin/facturacion`);
      const payment = await prisma.payment.findFirst({ where: { organizationId: org1.orgId } });
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { paymentId: payment!.id } });
      const texto = await adminPage.textContent('body');
      assert.ok(texto?.includes(invoice.cae!), `la página debería mostrar el CAE ${invoice.cae}`);
    });
  } finally {
    await Promise.all(browsersAbiertos.map((b) => b.close()));
    await limpiar();
    await prisma.$disconnect();
  }

  if (fallas > 0) {
    console.error(`\n${fallas} prueba(s) fallaron.`);
    process.exit(1);
  } else {
    console.log('\nTodas las pruebas de planes-facturacion pasaron.');
  }
}

await main();
