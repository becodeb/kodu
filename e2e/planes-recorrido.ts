import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO as PUERTO_MOCK_PROVEEDOR } from './mock-proveedor.ts';
import type { Page } from 'playwright';

/**
 * odd/tasks/planes-y-cobros.md (T9): el recorrido COMPLETO de un usuario real
 * — individual e institución — de punta a punta, clickeando lo que haría
 * alguien en el navegador (registro, calculadora de /precios, alta,
 * checkout/pago simulado, invitación de un docente, vencimiento de prueba).
 *
 * Complementa a los e2e de cada tarea (planes-acceso/alta/cobro/paginas/
 * superadmin/facturacion), que prueban cada pieza por separado: acá se
 * encadenan en el orden en que las vive una persona.
 *
 * Requiere la pila de este worktree LEVANTADA de antes (no arranca ni para el
 * dev server — mismo criterio que planes-acceso.ts/planes-cobro.ts/
 * planes-facturacion.ts):
 *   BILLING_PROVIDER=simulado INVOICE_PROVIDER=simulado PORT=3200 npm run dev
 * Corre con: KODU_BASE_URL=http://localhost:3200 npx tsx e2e/planes-recorrido.ts
 *
 * RESEND_API_KEY: este script asume que el dev server corre SIN ella (toda
 * cuenta nace verificada, "NO_PROVIDER") — igual que planes-alta.ts/
 * planes-paginas.ts/planes-superadmin.ts. Las invitaciones nunca mandan mail
 * (decisión del dueño, ver e2e/org-invitaciones.ts): no hace falta
 * e2e/mock-resend.ts para nada de este recorrido.
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_PASSWORD = 'Docente.E2E.Recorrido.2026';
const CUIT_VALIDO = '20-12345678-6';

const PROVIDER_KIND = 'kodu-mock-planes-recorrido';
const PROVIDER_LABEL = 'Mock local (planes-recorrido, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-planes-recorrido';
const MODEL_DISPLAY_NAME = 'Mock local (planes-recorrido)';

const SUFIJO = randomUUID().slice(0, 8);

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

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function nuevaPagina(): Promise<Page> {
  const browser = await abrirNavegador();
  browsersAbiertos.push(browser);
  return (await browser.newContext()).newPage();
}

async function registrarViaApi(page: Page, email: string, name = `Docente ${email.split('@')[0]}`): Promise<any> {
  emailsCreados.push(email);
  const respuesta = await page.request.post(`${BASE_URL}/api/auth/register`, {
    data: { name, email, password: DOCENTE_PASSWORD },
  });
  assert.equal(respuesta.status(), 200, `registro de ${email} (dio ${respuesta.status()}: ${await respuesta.text()})`);
  return respuesta.json();
}

async function accionarPagoSimulado(
  page: Page,
  checkoutUrl: string,
  accion: 'aprobar' | 'rechazar' = 'aprobar',
): Promise<{ ok: boolean; applied?: boolean; reason?: string; backUrl?: string }> {
  const id = checkoutUrl.split('/').pop()!;
  const respuesta = await page.request.post(`${BASE_URL}/api/billing/pago-simulado/${id}/accion`, { data: { accion } });
  const cuerpo = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: respuesta.ok() && cuerpo.ok === true, ...cuerpo } as any;
}

/** Clickea "Aprobar pago" en /pago-simulado/[id] como lo haría una persona. */
async function aprobarEnPantalla(page: Page): Promise<void> {
  await page.waitForURL('**/pago-simulado/**', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Aprobar' }).click();
  await page.waitForTimeout(600);
}

async function asegurarMotorMock(adminPage: Page, mockUrl: string): Promise<string> {
  const respuestaProveedor = await adminPage.request.post(`${BASE_URL}/api/admin/providers`, {
    data: { kind: PROVIDER_KIND, label: PROVIDER_LABEL, baseUrl: mockUrl, apiKey: 'clave-de-prueba-del-mock' },
  });
  assert.equal(respuestaProveedor.status(), 200, `alta del proveedor: ${await respuestaProveedor.text()}`);
  const providerId = ((await respuestaProveedor.json()) as { proveedor: { id: string } }).proveedor.id;

  const respuestaModelo = await adminPage.request.post(`${BASE_URL}/api/admin/models`, {
    data: {
      providerId,
      providerModel: MODEL_PROVIDER_MODEL,
      displayName: MODEL_DISPLAY_NAME,
      description: 'Proveedor simulado para e2e/planes-recorrido.ts. No usar con docentes reales.',
      selectableByTeacher: true,
    },
  });
  assert.equal(respuestaModelo.status(), 200, `alta del motor: ${await respuestaModelo.text()}`);
  const modelId = ((await respuestaModelo.json()) as { motor: { id: string } }).motor.id;

  // Sin precio cargado el motor nunca debita créditos (ver T2b) — este
  // recorrido necesita que el saldo baje de verdad al generar.
  await prisma.aiModel.update({
    where: { id: modelId },
    data: { priceInputPerMToken: 1, priceOutputPerMToken: 2, priceCachedInputPerMToken: 0.5 },
  });

  return modelId;
}

function htmlDePrueba(marca: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${marca}</title></head><body>${marca}</body></html>`;
}

async function balanceDe(userId: string): Promise<number> {
  const total = await prisma.creditLedgerEntry.aggregate({ where: { userId }, _sum: { delta: true } });
  return total._sum.delta ?? 0;
}

async function limpiar(): Promise<void> {
  const usuarios = await prisma.user.findMany({ where: { email: { in: emailsCreados } }, select: { id: true } });
  const ids = usuarios.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.payment.deleteMany({ where: { userId: { in: ids } } });
    await prisma.individualSubscription.deleteMany({ where: { userId: { in: ids } } });
    await prisma.creditLedgerEntry.deleteMany({ where: { userId: { in: ids } } });
    await prisma.organizationAdmin.deleteMany({ where: { userId: { in: ids } } });
    await prisma.chatMessage.deleteMany({ where: { thread: { project: { userId: { in: ids } } } } }).catch(() => {});
    await prisma.chatThread.deleteMany({ where: { project: { userId: { in: ids } } } }).catch(() => {});
    await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  }
  await prisma.payment.deleteMany({ where: { organizationId: { in: organizacionesCreadas } } });
  await prisma.user.deleteMany({ where: { email: { in: emailsCreados } } });
  for (const id of organizacionesCreadas) {
    await prisma.organization.deleteMany({ where: { parentId: id } });
    await prisma.organization.deleteMany({ where: { id } });
  }
  await prisma.aiModel.deleteMany({ where: { provider: { kind: PROVIDER_KIND } } });
  await prisma.aiProvider.deleteMany({ where: { kind: PROVIDER_KIND } });
}

// ═══════════════════════════════════════════════════════════════
// a. Individual
// ═══════════════════════════════════════════════════════════════

async function recorridoIndividual(modelId: string, mock: Awaited<ReturnType<typeof iniciarMockProveedor>>): Promise<void> {
  const email = `individual-recorrido-${SUFIJO}@afuera-recorrido-e2e.com`;
  const page = await nuevaPagina();
  const { user } = await registrarViaApi(page, email, 'Docente Individual Recorrido');

  await prueba('individual: una cuenta nueva arranca con créditos de bienvenida + del mes', async () => {
    // Un pedido cualquiera dispara `ensureGrants` (otorga bienvenida + mes).
    const r = await page.request.post(`${BASE_URL}/api/projects`, { data: { title: 'Recorrido — primer recurso' } });
    assert.equal(r.status(), 200, `debe poder crear un recurso con créditos gratis (dio ${r.status()}: ${await r.text()})`);
    const saldo = await balanceDe(user.id);
    assert.ok(saldo >= 100, `debe arrancar con al menos los 100 de bienvenida (dio ${saldo})`);
  });

  const { project } = (
    await (await page.request.post(`${BASE_URL}/api/projects`, { data: { title: 'Recorrido — recurso generado' } })).json()
  ) as { project: { id: string; threadId: string } };
  await prisma.project.update({ where: { id: project.id }, data: { aiModelId: modelId } });

  let saldoAntesDeGenerar = 0;
  await prueba('individual: genera un recurso con el proveedor mock y el saldo baja', async () => {
    saldoAntesDeGenerar = await balanceDe(user.id);
    mock.programarRespuesta({ html: htmlDePrueba('recorrido-individual'), chunkDelayMs: 2, chunkBytes: 20_000 });
    const turno = await page.request.post(`${BASE_URL}/api/chat/stream`, {
      data: { projectId: project.id, threadId: project.threadId, message: 'Necesito un juego simple (RECORRIDO)', model: modelId },
    });
    assert.equal(turno.status(), 200, `debe generar con créditos disponibles (dio ${turno.status()}: ${await turno.text()})`);
    const saldoDespues = await balanceDe(user.id);
    assert.ok(saldoDespues < saldoAntesDeGenerar, `el saldo debe bajar tras generar (antes=${saldoAntesDeGenerar}, después=${saldoDespues})`);
  });

  await prueba('individual: drenar el saldo a mano y ver "Te quedaste sin créditos" en el navegador', async () => {
    const saldoActual = await balanceDe(user.id);
    await prisma.creditLedgerEntry.create({ data: { userId: user.id, delta: -saldoActual, kind: 'ADJUSTMENT' } });
    assert.equal(await balanceDe(user.id), 0);

    const bloqueado = await page.request.post(`${BASE_URL}/api/projects`, { data: { title: 'No debería crearse' } });
    assert.equal(bloqueado.status(), 403, `sin créditos debe bloquear la creación (dio ${bloqueado.status()})`);
    const cuerpo = (await bloqueado.json()) as { reason?: string };
    assert.equal(cuerpo.reason, 'no_credits');

    await page.goto(`${BASE_URL}/app/project/${project.id}`);
    const texto = await page.textContent('body');
    assert.ok(texto?.includes('Te quedaste sin créditos'), 'la página del recurso debe mostrar el aviso de sin créditos');
  });

  await prueba('individual: /app/plan → "Pasate a Individual" → pago simulado aprobado → Plan Individual + créditos del plan + factura', async () => {
    await page.goto(`${BASE_URL}/app/plan`);
    const texto1 = await page.textContent('body');
    assert.ok(texto1?.includes('Plan Gratis'), 'antes de pagar debe mostrar "Plan Gratis"');

    const botonPasarseAIndividual = page.getByRole('button', { name: /Pasate a Individual/ });
    await botonPasarseAIndividual.waitFor({ timeout: 8_000 });
    await page.waitForTimeout(400); // la isla React (client:load) hidrata después del SSR
    await botonPasarseAIndividual.click();
    await aprobarEnPantalla(page);

    await page.goto(`${BASE_URL}/app/plan`);
    const texto2 = await page.textContent('body');
    assert.ok(texto2?.includes('Plan Individual'), 'tras aprobar debe mostrar "Plan Individual"');
    assert.ok(texto2?.includes('CAE'), 'la factura simulada debe quedar emitida y visible (CAE) en /app/plan');

    const sub = await prisma.individualSubscription.findUniqueOrThrow({ where: { userId: user.id } });
    assert.equal(sub.status, 'ACTIVE');

    // `otorgarTopeIndividual` (creditos-servicio.ts) completa el otorgamiento
    // de ESTE período hasta `monthlyCredits` de Individual — un "top-up" de
    // `monthlyCredits - otorgamientoOriginal`, no "sumale monthlyCredits al
    // saldo total". Como el paso anterior de este mismo recorrido vació el
    // saldo a mano (un `ADJUSTMENT` plano, no el vencimiento normal del mes),
    // el saldo final queda en `monthlyCredits(Individual) - monthlyCredits(Gratis)`
    // — se verifica contra el catálogo real en vez de un número fijo (T8,
    // odd/tasks/ahorro-tokens.md, cambió monthlyCredits(Individual) de 1.000
    // a 2.500), para no inventar un invariante que el código no promete.
    const [planFree, planIndividual] = await Promise.all([
      prisma.individualPlan.findUniqueOrThrow({ where: { key: 'FREE' }, select: { monthlyCredits: true } }),
      prisma.individualPlan.findUniqueOrThrow({ where: { key: 'INDIVIDUAL' }, select: { monthlyCredits: true } }),
    ]);
    const saldo = await balanceDe(user.id);
    const esperado = planIndividual.monthlyCredits - planFree.monthlyCredits;
    assert.equal(
      saldo,
      esperado,
      `el nivel de créditos debe reflejar el plan Individual (catálogo: Individual=${planIndividual.monthlyCredits}, ` +
        `Gratis=${planFree.monthlyCredits}, esperado=${esperado}, dio ${saldo})`,
    );
  });

  await prueba('individual: cancelar la suscripción mantiene "Plan Individual" hasta el fin del período', async () => {
    await page.goto(`${BASE_URL}/app/plan`);
    const botonCancelar = page.getByRole('button', { name: 'Cancelar suscripción' });
    await botonCancelar.waitFor({ timeout: 8_000 });
    await page.waitForTimeout(400); // la isla React (client:load) hidrata después del SSR
    page.once('dialog', (dialog) => dialog.accept());
    await botonCancelar.click();
    await page.waitForTimeout(500);

    const sub = await prisma.individualSubscription.findUniqueOrThrow({ where: { userId: user.id } });
    assert.equal(sub.status, 'ACTIVE', 'no se corta el acceso al cancelar: sigue ACTIVE hasta el fin del período');
    assert.equal(sub.cancelAtPeriodEnd, true);

    const texto = await page.textContent('body');
    assert.ok(texto?.includes('Plan Individual'), 'tras cancelar sigue mostrando "Plan Individual" hasta el fin del período');
  });
}

// ═══════════════════════════════════════════════════════════════
// b. Institución
// ═══════════════════════════════════════════════════════════════

async function recorridoInstitucion(adminPage: Page): Promise<{ orgId: string; dominio: string }> {
  const pagePrecios = await nuevaPagina();

  await prueba('institución: /precios → 450 alumnos → se resalta Mediana', async () => {
    await pagePrecios.goto(`${BASE_URL}/precios`);
    await pagePrecios.waitForSelector('#alumnos-input');
    await pagePrecios.fill('#alumnos-input', '450');
    await pagePrecios.dispatchEvent('#alumnos-input', 'input');
    await pagePrecios.waitForTimeout(200);
    const bandaMatcheada = await pagePrecios.evaluate(
      () => document.querySelector('.banda-card[data-match="true"]')?.getAttribute('data-band-key') ?? null,
    );
    assert.equal(bandaMatcheada, 'MEDIANA', 'con 450 alumnos la banda resaltada debe ser Mediana');
  });

  const dominio = `recorrido-${randomUUID().slice(0, 8)}.edu.ar`;
  let bodyCreador: any;

  await prueba('institución: "Probá 30 días gratis" → crear cuenta → formulario de alta (colegio, dominio extra)', async () => {
    await pagePrecios.locator('.alta-link[data-band-key="MEDIANA"]').click();
    await pagePrecios.waitForURL('**/instituciones/alta**', { timeout: 10_000 });
    assert.ok(pagePrecios.url().includes('alumnos=450'), `debe llevar la matrícula en la URL (vio ${pagePrecios.url()})`);

    // La página de alta sin sesión tiene DOS enlaces "Crear cuenta": el del
    // menú de arriba (`/register`, sin "next") y el de la tarjeta "Entrá
    // primero" (con el "next" de vuelta a esta alta) — hace falta éste último.
    await pagePrecios.locator('a[href^="/register?next="]').click();
    await pagePrecios.waitForURL('**/register**', { timeout: 10_000 });
    const email = `creador-recorrido-${SUFIJO}@${dominio}`;
    emailsCreados.push(email);
    await pagePrecios.fill('#name', 'Directora Recorrido');
    await pagePrecios.fill('#email', email);
    await pagePrecios.fill('#password', DOCENTE_PASSWORD);
    await pagePrecios.getByRole('button', { name: 'Crear cuenta' }).click();
    await pagePrecios.waitForURL('**/instituciones/alta**', { timeout: 10_000 });

    bodyCreador = { email };

    await pagePrecios.waitForSelector('#institution-name');
    await pagePrecios.waitForTimeout(300); // la isla React (client:load) hidrata después del SSR
    await pagePrecios.fill('#institution-name', `Colegio Recorrido E2E ${SUFIJO}`);
    const campoMatricula = pagePrecios.locator('#declared-students');
    await campoMatricula.fill('450');
    await pagePrecios.getByRole('button', { name: '+ Agregar otro dominio' }).click();
    const dominioExtra = `recorrido-extra-${randomUUID().slice(0, 8)}.edu.ar`;
    await pagePrecios.locator('input[placeholder="otraesecuela.edu.ar"]').fill(dominioExtra);
    await pagePrecios.waitForTimeout(500); // debounce de la calculadora de precio

    await pagePrecios.getByRole('button', { name: 'Empezar la prueba de 30 días' }).click();
    await pagePrecios.waitForURL('**/org**', { timeout: 10_000 });
  });

  const org = await prisma.organizationLicense.findFirstOrThrow({
    where: { organization: { name: `Colegio Recorrido E2E ${SUFIJO}` } },
    select: { organizationId: true, status: true, createdVia: true },
  });
  organizacionesCreadas.push(org.organizationId);
  assert.equal(org.status, 'TRIAL');
  assert.equal(org.createdVia, 'SELF_SERVE');

  await prisma.organizationAdmin.findFirstOrThrow({
    where: { organizationId: org.organizationId, user: { email: bodyCreador.email } },
  });

  // La invitación y el /org/plan necesitan que `organizacionParaEmail`
  // (resolucion.ts) ya vea el dominio del colegio recién creado — mismo
  // criterio de los 10s de caché que el resto de este cambio.
  console.log('… esperando 11s la caché de organizaciones del dev server…');
  await esperar(11_000);

  await prueba('institución: /org/plan muestra el estado de prueba', async () => {
    const creadorPage = await nuevaPagina();
    await iniciarSesion(creadorPage, { email: bodyCreador.email, password: DOCENTE_PASSWORD });
    // El alta redirige a `/org` (bienvenida) — el estado de la licencia
    // ("Prueba: N días restantes", `etiquetaEstado` en org/plan.astro) vive
    // en `/org/plan`, no en el panel general de `/org`.
    await creadorPage.goto(`${BASE_URL}/org/plan`);
    const texto = await creadorPage.textContent('body');
    assert.ok(texto?.includes('Prueba'), '/org/plan debe mostrar el estado de prueba');
  });

  let urlInvitacion = '';
  const emailDocenteInvitado = `docente-invitado-${SUFIJO}@afuera-recorrido-e2e.com`;
  await prueba('institución: invitar a un docente por email (enlace de invitación)', async () => {
    const creadorPage = await nuevaPagina();
    await iniciarSesion(creadorPage, { email: bodyCreador.email, password: DOCENTE_PASSWORD });
    const respuesta = await creadorPage.request.post(`${BASE_URL}/api/org/invitaciones`, {
      data: { organizationId: org.organizationId },
    });
    assert.equal(respuesta.status(), 200, await respuesta.text());
    const cuerpo = (await respuesta.json()) as { url: string };
    assert.ok(cuerpo.url.includes('/invitacion/'), 'debe dar un enlace de invitación');
    urlInvitacion = cuerpo.url;
  });

  await prueba('institución: el docente invitado acepta y puede generar', async () => {
    const docentePage = await nuevaPagina();
    await registrarViaApi(docentePage, emailDocenteInvitado, 'Docente Invitado Recorrido');
    // `url` que devuelve POST /api/org/invitaciones ya es ABSOLUTA
    // (`enlaceInvitacion`, invitaciones.ts, arma `PUBLIC_SITE_URL + /invitacion/...`)
    // — a diferencia de la `url` de un checkout, que es relativa.
    await docentePage.goto(urlInvitacion);
    const botonUnirme = docentePage.getByRole('button', { name: /^Unirme a/ });
    await botonUnirme.waitFor({ timeout: 8_000 });
    await docentePage.waitForTimeout(400); // la isla React (client:load) hidrata después del SSR
    await botonUnirme.click();
    await docentePage.waitForTimeout(500);

    const usuario = await prisma.user.findUniqueOrThrow({ where: { email: emailDocenteInvitado }, select: { organizationId: true } });
    assert.equal(usuario.organizationId, org.organizationId, 'el docente invitado debe unirse a la institución');

    const resultado = await docentePage.request.post(`${BASE_URL}/api/projects`, { data: { title: 'Recorrido — docente invitado' } });
    assert.equal(resultado.status(), 200, `el docente invitado debe poder generar bajo la licencia de la institución (dio ${resultado.status()}: ${await resultado.text()})`);
  });

  await prueba('institución: /org/plan — razón social, CUIT, condición de IVA, preview de "ciclo lectivo" y pago aprobado', async () => {
    const creadorPage = await nuevaPagina();
    await iniciarSesion(creadorPage, { email: bodyCreador.email, password: DOCENTE_PASSWORD });
    await creadorPage.goto(`${BASE_URL}/org/plan`);
    await creadorPage.waitForSelector('text=Hoy pagás', { timeout: 8_000 });

    await creadorPage.fill('#org-razon-social', `Colegio Recorrido E2E ${SUFIJO} SRL`);
    await creadorPage.fill('#org-cuit', CUIT_VALIDO);
    await creadorPage.selectOption('#org-iva', 'MONOTRIBUTO');

    const botonPagarCiclo = creadorPage.getByRole('button', { name: 'Pagar ciclo lectivo' });
    await botonPagarCiclo.waitFor({ timeout: 8_000 });
    await creadorPage.waitForTimeout(400);
    await botonPagarCiclo.click();
    await aprobarEnPantalla(creadorPage);

    const license = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: org.organizationId } });
    assert.equal(license.status, 'ACTIVE', 'la licencia debe quedar ACTIVE tras aprobar el pago');
    assert.equal(license.interval, 'CYCLE');

    const payment = await prisma.payment.findFirstOrThrow({ where: { organizationId: org.organizationId }, orderBy: { createdAt: 'desc' } });
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { paymentId: payment.id } });
    assert.equal(invoice.status, 'ISSUED', 'la factura simulada debe quedar emitida (CAE)');
    assert.ok(invoice.cae);
  });

  await prueba('superadmin: ve la institución en /admin/altas y la factura en /admin/facturacion', async () => {
    const htmlAltas = await (await adminPage.request.get(`${BASE_URL}/admin/altas`)).text();
    assert.ok(htmlAltas.includes(org.organizationId), 'la institución debe aparecer en la cola/listado de /admin/altas');

    const payment = await prisma.payment.findFirstOrThrow({ where: { organizationId: org.organizationId }, orderBy: { createdAt: 'desc' } });
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { paymentId: payment.id } });
    const htmlFacturacion = await (await adminPage.request.get(`${BASE_URL}/admin/facturacion`)).text();
    assert.ok(htmlFacturacion.includes(invoice.cae!), `el CAE ${invoice.cae} debe verse en /admin/facturacion`);
  });

  return { orgId: org.organizationId, dominio };
}

// ═══════════════════════════════════════════════════════════════
// c. Vencimiento de la prueba
// ═══════════════════════════════════════════════════════════════

async function recorridoVencimiento(): Promise<void> {
  const dominio = `recorrido-vencida-${randomUUID().slice(0, 8)}.edu.ar`;
  const org = await prisma.organization.create({ data: { name: `Colegio Recorrido Vencida E2E ${SUFIJO}`, kind: 'CAMPUS' }, select: { id: true } });
  organizacionesCreadas.push(org.id);
  await prisma.organizationDomain.create({ data: { organizationId: org.id, pattern: dominio } });
  await prisma.organizationLicense.create({
    data: { organizationId: org.id, status: 'TRIAL', declaredStudents: 100, trialEndsAt: new Date(Date.now() - 1 * 86_400_000) },
  });

  console.log('… esperando 11s la caché de organizaciones del dev server…');
  await esperar(11_000);

  const adminOrgPage = await nuevaPagina();
  const { user: adminOrgUser } = await registrarViaApi(adminOrgPage, `admin-vencida-${SUFIJO}@${dominio}`, 'Admin Vencida Recorrido');
  await prisma.organizationAdmin.create({ data: { userId: adminOrgUser.id, organizationId: org.id } });

  const docentePage = await nuevaPagina();
  await registrarViaApi(docentePage, `docente-vencida-${SUFIJO}@${dominio}`, 'Docente Vencida Recorrido');

  await prueba('vencimiento: la IA queda rechazada tanto para el docente como para quien administra', async () => {
    const rDocente = await docentePage.request.post(`${BASE_URL}/api/projects`, { data: { title: 'No debería crearse (docente)' } });
    assert.equal(rDocente.status(), 403, `al docente debe rechazarlo (dio ${rDocente.status()})`);

    const rAdmin = await adminOrgPage.request.post(`${BASE_URL}/api/projects`, { data: { title: 'No debería crearse (admin)' } });
    assert.equal(rAdmin.status(), 403, `al admin de la institución también debe rechazarlo (dio ${rAdmin.status()})`);
  });

  await prueba('vencimiento: el docente ve el aviso de solo lectura; quien administra ve "Contratá"', async () => {
    // Para ver el mensaje puntual hace falta un recurso ya existente — se
    // crea directo en la base (la API ya está bloqueada, como se probó arriba).
    const proyectoDocente = await prisma.project.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { email: `docente-vencida-${SUFIJO}@${dominio}` } })).id,
        title: 'Recurso previo a vencer',
        slug: `recorrido-vencida-docente-${randomUUID().slice(0, 8)}`,
      },
    });
    const proyectoAdmin = await prisma.project.create({
      data: {
        userId: adminOrgUser.id,
        title: 'Recurso previo a vencer (admin)',
        slug: `recorrido-vencida-admin-${randomUUID().slice(0, 8)}`,
      },
    });

    await docentePage.goto(`${BASE_URL}/app/project/${proyectoDocente.id}`);
    const textoDocente = await docentePage.textContent('body');
    assert.ok(
      textoDocente?.includes('institución no está activa'),
      'el docente (no admin de la institución) debe ver el aviso de solo lectura, sin pedirle que contrate',
    );

    await adminOrgPage.goto(`${BASE_URL}/app/project/${proyectoAdmin.id}`);
    const textoAdmin = await adminOrgPage.textContent('body');
    assert.ok(textoAdmin?.includes('Contratá'), 'quien administra la institución debe ver el llamado a contratar');

    await prisma.project.deleteMany({ where: { id: { in: [proyectoDocente.id, proyectoAdmin.id] } } });
  });

  await prueba('vencimiento: /org/plan ofrece contratar de nuevo (TRIAL vencido habilita "Pagar")', async () => {
    await adminOrgPage.goto(`${BASE_URL}/org/plan`);
    const texto = await adminOrgPage.textContent('body');
    assert.ok(texto?.includes('Pagar'), '/org/plan debe seguir ofreciendo contratar tras vencer la prueba');
  });
}

// ═══════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const mock = await iniciarMockProveedor({ puerto: PUERTO_MOCK_PROVEEDOR });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  try {
    const adminPage = await nuevaPagina();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const modelId = await asegurarMotorMock(adminPage, mock.url);

    console.log('\n── a. Individual ──────────────────────────────────────');
    await recorridoIndividual(modelId, mock);

    console.log('\n── b. Institución ─────────────────────────────────────');
    await recorridoInstitucion(adminPage);

    console.log('\n── c. Vencimiento de la prueba ────────────────────────');
    await recorridoVencimiento();

    if (fallas === 0) {
      console.log('\n✔ e2e/planes-recorrido.ts: todo el recorrido pasó');
    } else {
      console.error(`\n✖ e2e/planes-recorrido.ts: ${fallas} paso(s) fallaron`);
      process.exitCode = 1;
    }
  } finally {
    for (const browser of browsersAbiertos) await browser.close().catch(() => {});
    await mock.detener();
    await limpiar();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\n✖ e2e/planes-recorrido.ts falló:', error);
  process.exitCode = 1;
});
