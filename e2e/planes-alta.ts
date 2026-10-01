import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { BASE_URL, abrirNavegador, conTema } from './harness.ts';
import type { Page } from 'playwright';

/**
 * odd/tasks/planes-y-cobros.md (T5): e2e del alta de instituciones por
 * cuenta propia (`/instituciones/alta`, `POST /api/instituciones/alta`,
 * `POST /api/instituciones/lead`).
 *
 * Maneja su propio ciclo de vida del dev server (mismo runbook que
 * `e2e/verificacion-email.ts`): FASE A corre con `BILLING_PROVIDER=simulado`
 * y SIN `RESEND_API_KEY` (toda cuenta nace verificada) — cubre todos los
 * escenarios salvo "cuenta con contraseña sin confirmar", que necesita
 * `hasResendApiKey() === true` para que `emailConfiable` tenga algo que
 * negar; eso es FASE B, con una key falsa y `RESEND_API_URL` apuntando a un
 * puerto sin nada escuchando (falla rápido, no hace falta levantar un mock
 * de verdad: el registro nunca depende de que el mail se mande).
 *
 * Corre con: KODU_BASE_URL=http://localhost:3200 npx tsx e2e/planes-alta.ts
 * (arranca y para el dev server él mismo — libre el puerto 3200 antes).
 */

const PORT = Number(new URL(BASE_URL).port || '3200');
const SUFIJO = randomUUID().slice(0, 8);
const DOCENTE_PASSWORD = 'Docente.E2E.Alta.2026';

const emailsCreados: string[] = [];
const organizacionesCreadas: string[] = [];
const leadsCreados: string[] = [];
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
// Ciclo de vida del dev server (ver el comentario grande de arriba)
// ─────────────────────────────────────────────────────────────

function pararDevServer(): void {
  try {
    execFileSync('npx', ['astro', 'dev', 'stop'], { stdio: 'pipe' });
  } catch {
    // No había ninguno corriendo.
  }
}

function arrancarDevServer(envExtra: Record<string, string>): void {
  execFileSync('npx', ['astro', 'dev', '--port', String(PORT), '--background'], {
    env: { ...process.env, PORT: String(PORT), BILLING_PROVIDER: 'simulado', ...envExtra },
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

interface Sesion {
  jar: Map<string, string>;
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function guardarCookies(jar: Map<string, string>, respuesta: Response): void {
  const setCookie = respuesta.headers.getSetCookie?.() ?? [];
  for (const cruda of setCookie) {
    const [par] = cruda.split(';');
    const [nombre, valor] = par.split('=');
    if (nombre) jar.set(nombre.trim(), valor ?? '');
  }
}

async function registrar(email: string, name = `Docente ${email.split('@')[0]}`): Promise<{ sesion: Sesion; body: any }> {
  emailsCreados.push(email);
  const jar = new Map<string, string>();
  const respuesta = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password: DOCENTE_PASSWORD }),
  });
  guardarCookies(jar, respuesta);
  const body = await respuesta.json();
  assert.equal(respuesta.status, 200, `registro de ${email} (dio ${respuesta.status}: ${JSON.stringify(body)})`);
  return { sesion: { jar }, body };
}

async function post(path: string, sesion: Sesion, data: unknown): Promise<{ status: number; body: any }> {
  const respuesta = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(sesion.jar) },
    body: JSON.stringify(data),
  });
  return { status: respuesta.status, body: await respuesta.json().catch(() => ({})) };
}

function dominioUnico(etiqueta: string): string {
  return `alta-${etiqueta}-${SUFIJO}.edu.ar`;
}

async function limpiar(): Promise<void> {
  for (const browser of browsersAbiertos) await browser.close().catch(() => {});

  const usuarios = await prisma.user.findMany({ where: { email: { in: emailsCreados } }, select: { id: true, organizationId: true } });
  const ids = usuarios.map((u) => u.id);
  const orgIdsDeUsuarios = usuarios.map((u) => u.organizationId).filter((id): id is string => !!id);

  if (ids.length > 0) {
    await prisma.organizationAdmin.deleteMany({ where: { userId: { in: ids } } });
    await prisma.individualSubscription.deleteMany({ where: { userId: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { in: emailsCreados } } });

  const todasLasOrgs = new Set([...organizacionesCreadas, ...orgIdsDeUsuarios]);
  // Las sedes de una red se borran antes que la red (parentId con onDelete SetNull
  // alcanzaría, pero preferimos dejar la base limpia de verdad).
  await prisma.organization.deleteMany({ where: { parentId: { in: [...todasLasOrgs] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [...todasLasOrgs] } } });

  if (leadsCreados.length > 0) {
    await prisma.institutionLead.deleteMany({ where: { id: { in: leadsCreados } } });
  }
}

// ─────────────────────────────────────────────────────────────
// FASE A — sin RESEND_API_KEY (toda cuenta nace verificada)
// ─────────────────────────────────────────────────────────────

async function faseA(): Promise<void> {
  await prueba('verificado crea un colegio: TRIAL, admin, dominio VERIFIED', async () => {
    const email = `creador-colegio-${SUFIJO}@${dominioUnico('colegio')}`;
    const { sesion, body } = await registrar(email);
    const nombre = `Colegio Alta E2E ${SUFIJO}`;

    const resultado = await post('/api/instituciones/alta', sesion, {
      institutionName: nombre,
      kind: 'CAMPUS',
      declaredStudents: 120,
      extraDomains: [],
      campuses: [],
    });
    assert.equal(resultado.status, 200, JSON.stringify(resultado.body));
    organizacionesCreadas.push(resultado.body.organizationId);

    const licencia = await prisma.organizationLicense.findUnique({ where: { organizationId: resultado.body.organizationId } });
    assert.equal(licencia?.status, 'TRIAL');
    assert.equal(licencia?.createdVia, 'SELF_SERVE');
    assert.equal(licencia?.declaredStudents, 120);
    assert.equal(licencia?.bandKey, 'PEQUENA');
    assert.equal(licencia?.reviewedAt, null);

    const admin = await prisma.organizationAdmin.findUnique({
      where: { userId_organizationId: { userId: body.user.id, organizationId: resultado.body.organizationId } },
    });
    assert.ok(admin, 'el creador tiene que quedar como admin de la organización');

    const miembro = await prisma.user.findUnique({ where: { id: body.user.id }, select: { organizationId: true } });
    assert.equal(miembro?.organizationId, resultado.body.organizationId);

    const dominio = await prisma.organizationDomain.findUnique({ where: { pattern: emailDominio(email) } });
    assert.equal(dominio?.status, 'VERIFIED');
  });

  await prueba('un docente que se registra con el dominio VERIFIED se une solo', async () => {
    const dominio = dominioUnico('join');
    const { sesion } = await registrar(`creador-join-${SUFIJO}@${dominio}`);
    const alta = await post('/api/instituciones/alta', sesion, {
      institutionName: `Colegio Join E2E ${SUFIJO}`,
      kind: 'CAMPUS',
      declaredStudents: 50,
      extraDomains: [],
      campuses: [],
    });
    assert.equal(alta.status, 200, JSON.stringify(alta.body));
    organizacionesCreadas.push(alta.body.organizationId);

    // El snapshot de resolución tiene 10s de caché — mismo criterio que
    // `e2e/planes-cobro.ts`: esperar antes de registrar al docente nuevo.
    await esperar(10_500);

    const { body: docente } = await registrar(`docente-join-${SUFIJO}@${dominio}`);
    assert.equal(docente.user.organizationId, alta.body.organizationId, 'el docente nuevo tiene que unirse por el dominio VERIFIED');
  });

  await prueba('un dominio extra queda PENDING y no une a nadie', async () => {
    const dominioCreador = dominioUnico('pending-creador');
    const dominioExtra = dominioUnico('pending-extra');
    const { sesion } = await registrar(`creador-pending-${SUFIJO}@${dominioCreador}`);
    const alta = await post('/api/instituciones/alta', sesion, {
      institutionName: `Colegio Pending E2E ${SUFIJO}`,
      kind: 'CAMPUS',
      declaredStudents: 60,
      extraDomains: [dominioExtra],
      campuses: [],
    });
    assert.equal(alta.status, 200, JSON.stringify(alta.body));
    organizacionesCreadas.push(alta.body.organizationId);
    assert.deepEqual(alta.body.pendingDomains, [dominioExtra]);

    const filaExtra = await prisma.organizationDomain.findUnique({ where: { pattern: dominioExtra } });
    assert.equal(filaExtra?.status, 'PENDING');

    await esperar(10_500);
    const { body: docente } = await registrar(`docente-pending-${SUFIJO}@${dominioExtra}`);
    assert.equal(docente.user.organizationId, null, 'un dominio PENDING no puede unir a nadie todavía');
  });

  await prueba('red con 2 sedes: cada una con su propia Organization CAMPUS', async () => {
    const dominioCreador = dominioUnico('red');
    const { sesion } = await registrar(`creador-red-${SUFIJO}@${dominioCreador}`);
    const alta = await post('/api/instituciones/alta', sesion, {
      institutionName: `Red Alta E2E ${SUFIJO}`,
      kind: 'NETWORK',
      declaredStudents: 400,
      extraDomains: [],
      campuses: [{ name: 'Sede Norte', domain: null }, { name: 'Sede Sur', domain: dominioUnico('sede-sur') }],
    });
    assert.equal(alta.status, 200, JSON.stringify(alta.body));
    organizacionesCreadas.push(alta.body.organizationId);

    const red = await prisma.organization.findUnique({ where: { id: alta.body.organizationId } });
    assert.equal(red?.kind, 'NETWORK');
    const sedes = await prisma.organization.findMany({ where: { parentId: alta.body.organizationId } });
    assert.equal(sedes.length, 2);
    assert.ok(sedes.every((s) => s.kind === 'CAMPUS'));

    const licencia = await prisma.organizationLicense.findUnique({ where: { organizationId: alta.body.organizationId } });
    assert.equal(licencia?.declaredStudents, 400);
    assert.equal(licencia?.bandKey, 'MEDIANA');
  });

  await prueba('un dominio público (gmail) es rechazado', async () => {
    const { sesion } = await registrar(`creador-gmail-${SUFIJO}@gmail.com`);
    const alta = await post('/api/instituciones/alta', sesion, {
      institutionName: 'Colegio Gmail E2E',
      kind: 'CAMPUS',
      declaredStudents: 100,
      extraDomains: [],
      campuses: [],
    });
    assert.equal(alta.status, 422);
    assert.equal(alta.body.reason, 'DOMINIO_PUBLICO');
    const org = await prisma.organization.findFirst({ where: { name: 'Colegio Gmail E2E' } });
    assert.equal(org, null, 'no se tiene que crear ninguna organización');
  });

  await prueba('un dominio ya usado por otra organización es rechazado', async () => {
    const dominioOcupado = dominioUnico('ocupado');
    const { sesion: sesionA } = await registrar(`creador-ocupado-a-${SUFIJO}@${dominioOcupado}`);
    const altaA = await post('/api/instituciones/alta', sesionA, {
      institutionName: `Colegio Ocupado A ${SUFIJO}`,
      kind: 'CAMPUS',
      declaredStudents: 50,
      extraDomains: [],
      campuses: [],
    });
    assert.equal(altaA.status, 200, JSON.stringify(altaA.body));
    organizacionesCreadas.push(altaA.body.organizationId);

    const { sesion: sesionB } = await registrar(`creador-ocupado-b-${SUFIJO}@${dominioUnico('ocupado-b')}`);
    const altaB = await post('/api/instituciones/alta', sesionB, {
      institutionName: `Colegio Ocupado B ${SUFIJO}`,
      kind: 'CAMPUS',
      declaredStudents: 50,
      extraDomains: [dominioOcupado],
      campuses: [],
    });
    assert.equal(altaB.status, 409);
    assert.equal(altaB.body.reason, 'DOMINIO_EN_USO');
  });

  await prueba('una cuenta que ya pertenece a una organización es rechazada', async () => {
    const dominio = dominioUnico('ya-org');
    const { sesion } = await registrar(`creador-ya-org-${SUFIJO}@${dominio}`);
    const primera = await post('/api/instituciones/alta', sesion, {
      institutionName: `Colegio Ya Org Primera ${SUFIJO}`,
      kind: 'CAMPUS',
      declaredStudents: 50,
      extraDomains: [],
      campuses: [],
    });
    assert.equal(primera.status, 200, JSON.stringify(primera.body));
    organizacionesCreadas.push(primera.body.organizationId);

    const segunda = await post('/api/instituciones/alta', sesion, {
      institutionName: 'Colegio Ya Org Segunda',
      kind: 'CAMPUS',
      declaredStudents: 50,
      extraDomains: [dominioUnico('ya-org-2')],
      campuses: [],
    });
    assert.equal(segunda.status, 409);
    assert.equal(segunda.body.reason, 'YA_EN_ORGANIZACION');
  });

  await prueba('matrícula por encima del umbral: Hablemos, sin crear organización', async () => {
    const { sesion } = await registrar(`creador-hablemos-${SUFIJO}@${dominioUnico('hablemos')}`);
    const alta = await post('/api/instituciones/alta', sesion, {
      institutionName: 'Red Hablemos E2E',
      kind: 'NETWORK',
      declaredStudents: 5000,
      extraDomains: [],
      campuses: [{ name: 'Sede 1', domain: null }],
    });
    assert.equal(alta.status, 422);
    assert.equal(alta.body.reason, 'HABLEMOS');
    const org = await prisma.organization.findFirst({ where: { name: 'Red Hablemos E2E' } });
    assert.equal(org, null);

    const lead = await post('/api/instituciones/lead', sesion, {
      institutionName: 'Red Hablemos E2E',
      contactName: 'Docente Hablemos',
      contactEmail: `creador-hablemos-${SUFIJO}@${dominioUnico('hablemos')}`,
      declaredStudents: 5000,
    });
    assert.equal(lead.status, 200, JSON.stringify(lead.body));
    leadsCreados.push(lead.body.id);

    const fila = await prisma.institutionLead.findUnique({ where: { id: lead.body.id } });
    assert.equal(fila?.declaredStudents, 5000);
    assert.equal(fila?.reviewedAt, null);
  });

  await prueba('la cola de revisión del superadmin incluye el alta recién creada', async () => {
    const { colaDeRevision } = await import('../src/lib/billing/revision.ts');
    const cola = await colaDeRevision();
    assert.ok(cola.length > 0, 'tiene que haber al menos una fila sin revisar (altas + leads de este script)');
    assert.ok(
      cola.some((item) => item.tipo === 'ALTA' && organizacionesCreadas.includes(item.organizationId ?? '')),
      'la cola tiene que listar las organizaciones de alta propia creadas en este script',
    );
    assert.ok(
      cola.some((item) => item.tipo === 'LEAD' && leadsCreados.includes(item.id)),
      'la cola tiene que listar los leads creados en este script',
    );
  });

  await prueba('una organización trial puede usar la IA (licencia vigente)', async () => {
    const { licenseAllowsAi } = await import('../src/lib/billing/acceso-licencia.ts');
    const dominio = dominioUnico('acceso-ia');
    const { sesion, body } = await registrar(`creador-acceso-${SUFIJO}@${dominio}`);
    const alta = await post('/api/instituciones/alta', sesion, {
      institutionName: `Colegio Acceso IA ${SUFIJO}`,
      kind: 'CAMPUS',
      declaredStudents: 50,
      extraDomains: [],
      campuses: [],
    });
    assert.equal(alta.status, 200, JSON.stringify(alta.body));
    organizacionesCreadas.push(alta.body.organizationId);

    const licencia = await prisma.organizationLicense.findUniqueOrThrow({ where: { organizationId: alta.body.organizationId } });
    const resultado = licenseAllowsAi(
      { status: licencia.status, trialEndsAt: licencia.trialEndsAt, graceEndsAt: licencia.graceEndsAt },
      new Date(),
    );
    assert.equal(resultado.allowed, true, 'un trial recién creado tiene que permitir usar la IA');
    assert.equal(resultado.reason, 'trial_vigente');
    void body;
  });
}

function emailDominio(email: string): string {
  return email.split('@')[1] ?? '';
}

// ─────────────────────────────────────────────────────────────
// Smoke de navegador (claro/oscuro) — T5: "leer las capturas y arreglar"
// ─────────────────────────────────────────────────────────────

async function capturarFormulario(): Promise<void> {
  const email = `creador-captura-${SUFIJO}@${dominioUnico('captura')}`;
  await registrar(email);

  const browser = await abrirNavegador();
  browsersAbiertos.push(browser);
  const context = await browser.newContext();
  const page: Page = await context.newPage();

  await page.request.post(`${BASE_URL}/api/auth/login`, { data: { email, password: DOCENTE_PASSWORD } });
  const dirCapturas =
    process.env.KODU_E2E_SCREENSHOT_DIR ??
    '/tmp/claude-1001/-home-opencode-projects/4e564770-3a74-51e8-8de7-1431f19bac6e/scratchpad';

  // `conTema` hace un `page.reload()`, que tira cualquier estado tipeado en
  // la isla React — hay que fijar el tema ANTES de llenar el formulario (y de
  // nuevo antes de la segunda captura, cada cambio de tema vuelve a recargar).
  await page.goto(`${BASE_URL}/instituciones/alta`);
  await conTema(page, 'light');
  await page.waitForSelector('#declared-students');
  await page.waitForTimeout(300); // la isla React (client:load) hidrata después del SSR
  await page.fill('#institution-name', 'Colegio San Martín');
  await page.fill('#declared-students', '150');
  await page.waitForTimeout(600); // debounce de la calculadora + el fetch del precio
  await page.screenshot({ path: `${dirCapturas}/planes-alta-claro.png`, fullPage: true });

  await conTema(page, 'dark');
  await page.waitForSelector('#declared-students');
  await page.waitForTimeout(300);
  await page.fill('#institution-name', 'Colegio San Martín');
  await page.fill('#declared-students', '150');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dirCapturas}/planes-alta-oscuro.png`, fullPage: true });

  await context.close();
}

// ─────────────────────────────────────────────────────────────
// FASE B — con RESEND_API_KEY (una cuenta con contraseña nace SIN verificar)
// ─────────────────────────────────────────────────────────────

async function faseB(): Promise<void> {
  await prueba('cuenta con contraseña sin confirmar: alta rechazada', async () => {
    const email = `creador-sin-verificar-${SUFIJO}@${dominioUnico('sin-verificar')}`;
    const { sesion } = await registrar(email);

    const fila = await prisma.user.findUnique({ where: { email }, select: { emailVerifiedAt: true } });
    assert.equal(fila?.emailVerifiedAt, null, 'con RESEND_API_KEY cargada, el registro con contraseña tiene que nacer sin verificar');

    const alta = await post('/api/instituciones/alta', sesion, {
      institutionName: 'Colegio Sin Verificar E2E',
      kind: 'CAMPUS',
      declaredStudents: 50,
      extraDomains: [],
      campuses: [],
    });
    assert.equal(alta.status, 403);
    assert.equal(alta.body.reason, 'EMAIL_SIN_VERIFICAR');
    const org = await prisma.organization.findFirst({ where: { name: 'Colegio Sin Verificar E2E' } });
    assert.equal(org, null);
  });
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  pararDevServer();
  arrancarDevServer({ RESEND_API_KEY: '', RESEND_FROM: '', RESEND_API_URL: '' });
  await esperarListo();

  try {
    await faseA();
    await capturarFormulario();
  } finally {
    // nada que limpiar entre fases: cada escenario usa emails únicos.
  }

  pararDevServer();
  arrancarDevServer({
    RESEND_API_KEY: 're_test_fake_key_planes_alta',
    RESEND_FROM: 'Kodu <no-responder@kodu.test>',
    RESEND_API_URL: 'http://localhost:4790', // nada escucha ahí: falla rápido, nunca bloquea el registro.
  });
  await esperarListo();

  try {
    await faseB();
  } finally {
    pararDevServer();
    arrancarDevServer({ RESEND_API_KEY: '', RESEND_FROM: '', RESEND_API_URL: '' });
    await esperarListo();
    await limpiar();
    await prisma.$disconnect();
  }

  console.log(fallas === 0 ? '\nTodo verde.' : `\n${fallas} prueba(s) fallaron.`);
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await limpiar().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
