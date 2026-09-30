import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';
import type { Page } from 'playwright';

/**
 * odd/tasks/planes-y-cobros.md (T2/T3): acceso a la IA por créditos
 * individuales (T2) y por estado de la licencia institucional (T3) —
 * `resolverAccesoIa` (src/lib/orgs/acceso.ts), llamado desde `POST
 * /api/projects` y `POST /api/chat/stream`.
 *
 * Complementa a `e2e/unidad-creditos.ts` (T2, reglas del libro de créditos
 * sin servidor) y a `e2e/unidad-planes.ts` (T1, `licenseAllowsAi` puro): acá
 * se prueba el CHOKEPOINT completo, contra el servidor real, con cuentas y
 * organizaciones de verdad.
 *
 * Requiere la pila de desarrollo de este worktree levantada (`PORT=3200 npm
 * run dev`, base `koduedu_planes`) y el mock de `e2e/mock-proveedor.ts` en
 * 4790 libre.
 *
 * Corre con: KODU_BASE_URL=http://localhost:3200 npx tsx e2e/planes-acceso.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_KIND = 'kodu-mock-planes-acceso';
const PROVIDER_LABEL = 'Mock local (planes-acceso, e2e/mock-proveedor.ts)';
const MODEL_PROVIDER_MODEL = 'mock-planes-acceso';
const MODEL_DISPLAY_NAME = 'Mock local (planes-acceso)';

const SUFIJO = randomUUID().slice(0, 8);

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const emailsCreados: string[] = [];
const organizacionesCreadas: string[] = [];

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registrar(email: string): Promise<{ page: Page; body: any; browser: import('playwright').Browser }> {
  emailsCreados.push(email);
  const browser = await abrirNavegador();
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  const respuesta = await page.request.post(`${BASE_URL}/api/auth/register`, {
    data: { name: `Docente ${email.split('@')[0]}`, email, password: DOCENTE_PASSWORD },
  });
  assert.equal(respuesta.status(), 200, `registro de ${email} debe responder 200 (dio ${respuesta.status()})`);
  const body = await respuesta.json();
  return { page, body, browser };
}

async function crearProyecto(page: Page, title: string): Promise<import('playwright').APIResponse> {
  return page.request.post(`${BASE_URL}/api/projects`, { data: { title } });
}

interface LicenciaDePrueba {
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'READ_ONLY' | 'CANCELED' | 'MANUAL';
  declaredStudents: number;
  trialEndsAt?: Date;
  graceEndsAt?: Date;
  createdVia?: 'SELF_SERVE' | 'MANUAL';
}

/** Organización de tope (CAMPUS o NETWORK) con dominio propio y la licencia
 *  que pida el escenario. */
async function crearOrgConLicencia(
  nombre: string,
  dominio: string,
  kind: 'CAMPUS' | 'NETWORK',
  licencia: LicenciaDePrueba,
): Promise<string> {
  const org = await prisma.organization.create({ data: { name: nombre, kind }, select: { id: true } });
  organizacionesCreadas.push(org.id);
  await prisma.organizationDomain.create({ data: { organizationId: org.id, pattern: dominio } });
  await prisma.organizationLicense.create({ data: { organizationId: org.id, ...licencia } });
  return org.id;
}

async function limpiar(): Promise<void> {
  const usuarios = await prisma.user.findMany({ where: { email: { in: emailsCreados } }, select: { id: true } });
  const ids = usuarios.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.creditLedgerEntry.deleteMany({ where: { userId: { in: ids } } });
    await prisma.tokenUsage.deleteMany({ where: { userId: { in: ids } } });
    await prisma.chatMessage.deleteMany({ where: { thread: { project: { userId: { in: ids } } } } });
    await prisma.chatThread.deleteMany({ where: { project: { userId: { in: ids } } } });
    await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { in: emailsCreados } } });
  for (const id of organizacionesCreadas) {
    await prisma.organization.deleteMany({ where: { id } });
  }
  await prisma.aiModel.deleteMany({ where: { provider: { kind: PROVIDER_KIND } } });
  await prisma.aiProvider.deleteMany({ where: { kind: PROVIDER_KIND } });
}

async function asegurarMotor(adminPage: Page, mockUrl: string): Promise<string> {
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
      description: 'Proveedor simulado para e2e/planes-acceso.ts. No usar con docentes reales.',
      selectableByTeacher: true,
    },
  });
  assert.equal(respuestaModelo.status(), 200, `alta del motor: ${await respuestaModelo.text()}`);
  const modelId = ((await respuestaModelo.json()) as { motor: { id: string } }).motor.id;

  // Sin precio cargado, `recordUsage`/`calcularCostoTurno` NUNCA inventan un
  // costo (costUsd queda null) — y sin costUsd conocido, T2 no debita nada
  // (mismo criterio "nunca se inventa un costo"). Este escenario necesita un
  // costo real para probar que el saldo baja.
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

async function main(): Promise<void> {
  const browsersAbiertos: import('playwright').Browser[] = [];
  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  try {
    const admin = await abrirNavegador();
    browsersAbiertos.push(admin);
    const adminContexto = await admin.newContext();
    const adminPage = await adminContexto.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const modelId = await asegurarMotor(adminPage, mock.url);

    // ───────────────────────────────────────────────────────────
    // 1. Cuenta personal CON créditos: genera de verdad y el saldo baja.
    // ───────────────────────────────────────────────────────────
    {
      const email = `personal-credito-${SUFIJO}@afuera-planes-e2e.com`;
      const { page, body, browser } = await registrar(email);
      browsersAbiertos.push(browser);

      const respuestaProyecto = await crearProyecto(page, 'Recurso E2E créditos');
      assert.equal(respuestaProyecto.status(), 200, `debe poder crear un recurso con créditos gratis (dio ${respuestaProyecto.status()})`);
      const { project } = (await respuestaProyecto.json()) as { project: { id: string; threadId: string } };
      await prisma.project.update({ where: { id: project.id }, data: { aiModelId: modelId } });

      const saldoAntes = await balanceDe(body.user.id);
      assert.ok(saldoAntes > 0, 'una cuenta nueva debe arrancar con créditos gratis (bienvenida + mensual)');

      mock.programarRespuesta({ html: htmlDePrueba('gen-planes-acceso'), chunkDelayMs: 2, chunkBytes: 20_000 });
      const turno = await page.request.post(`${BASE_URL}/api/chat/stream`, {
        data: { projectId: project.id, threadId: project.threadId, message: 'Necesito un juego simple (PLANES-ACCESO)', model: modelId },
      });
      assert.equal(turno.status(), 200, `el turno debe generar con créditos disponibles (dio ${turno.status()}: ${await turno.text()})`);

      const saldoDespues = await balanceDe(body.user.id);
      assert.ok(saldoDespues < saldoAntes, `el saldo debe bajar tras generar (antes=${saldoAntes}, después=${saldoDespues})`);
      const debito = await prisma.creditLedgerEntry.findFirst({ where: { userId: body.user.id, kind: 'USAGE' } });
      assert.ok(debito, 'debe quedar un movimiento USAGE');
      console.log('✔ 1. cuenta personal con créditos: genera y el saldo baja');
    }

    // ───────────────────────────────────────────────────────────
    // 2. Cuenta personal SIN créditos: bloqueada con NO_CREDITS.
    // ───────────────────────────────────────────────────────────
    {
      const email = `personal-sin-credito-${SUFIJO}@afuera-planes-e2e.com`;
      const { page, body, browser } = await registrar(email);
      browsersAbiertos.push(browser);

      // Primero una request cualquiera para que `ensureGrants` otorgue lo de
      // siempre; después se lo deja en 0 a mano (ajuste manual, como T7).
      await crearProyecto(page, 'Recurso E2E sin créditos (se borra)').then((r) => r.json());
      const saldoActual = await balanceDe(body.user.id);
      await prisma.creditLedgerEntry.create({ data: { userId: body.user.id, delta: -saldoActual, kind: 'ADJUSTMENT' } });
      assert.equal(await balanceDe(body.user.id), 0);

      const respuesta = await crearProyecto(page, 'Recurso E2E sin créditos');
      assert.equal(respuesta.status(), 403, `sin créditos debe bloquear (dio ${respuesta.status()})`);
      const cuerpo = (await respuesta.json()) as { reason?: string };
      assert.equal(cuerpo.reason, 'no_credits', 'la razón máquina debe ser no_credits');
      console.log('✔ 2. cuenta personal sin créditos: bloqueada con reason=no_credits');
    }

    // Ventana de la caché de 10s de `organizacionParaEmail` (resolucion.ts):
    // todos los dominios de organización de este script se crean ANTES de
    // registrar cualquier cuenta que dependa de ellos, así que una sola
    // espera alcanza para todos los escenarios de abajo.
    const dominioTrialVigente = `trial-vigente-${SUFIJO}.edu.ar`;
    const dominioTrialVencido = `trial-vencido-${SUFIJO}.edu.ar`;
    const dominioGraciaVigente = `gracia-vigente-${SUFIJO}.edu.ar`;
    const dominioGraciaVencida = `gracia-vencida-${SUFIJO}.edu.ar`;
    const dominioManual = `manual-${SUFIJO}.edu.ar`;
    const dominioRed = `red-licencia-${SUFIJO}.edu.ar`;

    const ahora = Date.now();
    const DIA_MS = 24 * 60 * 60 * 1000;

    await crearOrgConLicencia(`Trial vigente E2E ${SUFIJO}`, dominioTrialVigente, 'CAMPUS', {
      status: 'TRIAL',
      declaredStudents: 100,
      trialEndsAt: new Date(ahora + 10 * DIA_MS),
    });
    await crearOrgConLicencia(`Trial vencido E2E ${SUFIJO}`, dominioTrialVencido, 'CAMPUS', {
      status: 'TRIAL',
      declaredStudents: 100,
      trialEndsAt: new Date(ahora - 1 * DIA_MS),
    });
    await crearOrgConLicencia(`Gracia vigente E2E ${SUFIJO}`, dominioGraciaVigente, 'CAMPUS', {
      status: 'PAST_DUE',
      declaredStudents: 100,
      graceEndsAt: new Date(ahora + 3 * DIA_MS),
    });
    await crearOrgConLicencia(`Gracia vencida E2E ${SUFIJO}`, dominioGraciaVencida, 'CAMPUS', {
      status: 'PAST_DUE',
      declaredStudents: 100,
      graceEndsAt: new Date(ahora - 1 * DIA_MS),
    });
    await crearOrgConLicencia(`Manual E2E ${SUFIJO}`, dominioManual, 'CAMPUS', {
      status: 'MANUAL',
      declaredStudents: 0,
      createdVia: 'MANUAL',
    });
    const redId = await crearOrgConLicencia(`Red con licencia E2E ${SUFIJO}`, dominioRed, 'NETWORK', {
      status: 'ACTIVE',
      declaredStudents: 500,
    });
    const sedeDeLaRed = await prisma.organization.create({
      data: { name: `Sede de la red con licencia E2E ${SUFIJO}`, kind: 'CAMPUS', parentId: redId },
      select: { id: true },
    });
    organizacionesCreadas.push(sedeDeLaRed.id);
    const dominioSedeDeLaRed = `sede-de-red-licencia-${SUFIJO}.edu.ar`;
    await prisma.organizationDomain.create({ data: { organizationId: sedeDeLaRed.id, pattern: dominioSedeDeLaRed } });

    console.log('… esperando 11s la caché de organizaciones del dev server…');
    await esperar(11_000);

    const escenariosOrg: Array<{ n: string; email: string; statusEsperado: number; razonPrefijo?: string }> = [
      { n: '3. TRIAL vigente: permitido', email: `docente-a@${dominioTrialVigente}`, statusEsperado: 200 },
      { n: '4. TRIAL vencido: bloqueado', email: `docente-b@${dominioTrialVencido}`, statusEsperado: 403, razonPrefijo: 'license_trial' },
      { n: '5. PAST_DUE dentro de la gracia: permitido', email: `docente-c@${dominioGraciaVigente}`, statusEsperado: 200 },
      { n: '6. PAST_DUE fuera de la gracia: bloqueado', email: `docente-d@${dominioGraciaVencida}`, statusEsperado: 403, razonPrefijo: 'license_gracia' },
      { n: '7. MANUAL: siempre permitido', email: `docente-e@${dominioManual}`, statusEsperado: 200 },
      { n: '8. sede de una red: usa la licencia de la red (ACTIVE)', email: `docente-f@${dominioSedeDeLaRed}`, statusEsperado: 200 },
    ];

    for (const escenario of escenariosOrg) {
      const { page, body, browser } = await registrar(escenario.email);
      browsersAbiertos.push(browser);
      assert.notEqual(body.user.organizationId, null, `${escenario.email} debe unirse a una organización por dominio`);

      const respuesta = await crearProyecto(page, `Recurso E2E — ${escenario.n}`);
      assert.equal(
        respuesta.status(),
        escenario.statusEsperado,
        `${escenario.n} (dio ${respuesta.status()}, esperaba ${escenario.statusEsperado})`,
      );
      if (escenario.razonPrefijo) {
        const cuerpo = (await respuesta.json()) as { reason?: string };
        assert.ok(
          cuerpo.reason?.startsWith(escenario.razonPrefijo),
          `razón esperada con prefijo "${escenario.razonPrefijo}", dio "${cuerpo.reason}"`,
        );
      }
      console.log(`✔ ${escenario.n}`);
    }

    console.log('\n✔ e2e/planes-acceso.ts: todos los escenarios pasaron');
  } finally {
    for (const browser of browsersAbiertos) {
      await browser.close().catch(() => {});
    }
    await mock.detener();
    await limpiar();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\n✖ e2e/planes-acceso.ts falló:', error);
  process.exitCode = 1;
});
