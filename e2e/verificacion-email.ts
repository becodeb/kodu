import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { BASE_URL } from './harness.ts';
import { iniciarMockResend, PUERTO_POR_DEFECTO as PUERTO_MOCK_RESEND } from './mock-resend.ts';

/**
 * Verificación de T3 (odd/tasks/organizaciones.md): mail de verificación de
 * email por Resend, con fallback sin key. Cubre, en orden:
 *
 *  (a) CON key + mock: el registro deja al docente sin verificar y PERSONAL
 *      aunque su dominio matchee una CAMPUS activa (no se une hasta
 *      confirmar); el mock recibió exactamente un correo con el enlace.
 *  (b) Seguir el enlace verifica (source EMAIL) y une a la organización.
 *  (c) Reusar el mismo enlace falla.
 *  (d) Un token vencido (expiresAt en el pasado, puesto a mano) falla.
 *  (e) Reenviar antes de 60s da 429; reenviar después de "rebobinar" el
 *      `createdAt` del token da 200 y un mail nuevo.
 *  (f) El header `Authorization` llevó la key, y la key NUNCA aparece en el
 *      log del dev server (`.astro/dev.log`).
 *  (g) SIN key: el registro verifica de una (NO_PROVIDER) y se une por
 *      dominio; `/admin` muestra el aviso. CON key (fase A) el aviso no
 *      aparece.
 *
 * Runbook (por qué el script arranca y para el dev server él mismo): el
 * fallback sin Resend se decide en `src/lib/env.ts#getEnv()`, cacheado por
 * PROCESO — sólo un reinicio del dev server hace que una corrida con
 * `RESEND_API_KEY` y la siguiente sin ella lean entornos distintos. Se usa
 * `npx astro dev --background`/`stop` (el dev server de este repo YA corre
 * como daemon, ver odd/tasks/organizaciones.md — confirmado con
 * `npx astro dev status`) en vez de pedirle a quien corre esto que reinicie
 * a mano entre las dos fases.
 *
 * Corre con: KODU_BASE_URL=http://localhost:3100 npx tsx e2e/verificacion-email.ts
 * (el script arranca y para el dev server SOLO — no hace falta tenerlo
 * corriendo antes; sí hace falta que el puerto 3100 y el mock 4791 estén
 * libres, confirmado con `ss -ltn`).
 */

const PORT = Number(new URL(BASE_URL).port || '3100');
const LOG_FILE = new URL('../.astro/dev.log', import.meta.url).pathname;

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_PASSWORD = 'Docente.Verif.2026';
const RESEND_KEY_FALSA = 're_test_fake_key_no_es_real';

const AVISO_ADMIN_TEXTO = 'La verificación de email está apagada';
const TEXTO_CONFIRMADO = 'confirmamos tu email';
const TEXTO_ENLACE_INVALIDO = 'Este enlace no es válido';

const SUFIJO = randomUUID().slice(0, 8);
const DOMINIO_CAMPUS = `verif-email-e2e-${SUFIJO}.edu.ar`;
const EMAIL_DOMINIO = `docente-verif-a@${DOMINIO_CAMPUS}`;
const EMAIL_EXPIRAR = `docente-verif-b-expirar-${SUFIJO}@afuera-verif-e2e.com`;
const EMAIL_REENVIO = `docente-verif-c-reenvio-${SUFIJO}@afuera-verif-e2e.com`;
const EMAIL_SIN_KEY = `docente-verif-d@${DOMINIO_CAMPUS}`;

const TODOS_LOS_EMAILS = [EMAIL_DOMINIO, EMAIL_EXPIRAR, EMAIL_REENVIO, EMAIL_SIN_KEY];

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const fixtureIds = { campus: '' };

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function crearFixtures(): Promise<void> {
  const campus = await prisma.organization.create({
    data: { name: `Campus Verif E2E ${SUFIJO}`, kind: 'CAMPUS' },
    select: { id: true },
  });
  fixtureIds.campus = campus.id;
  await prisma.organizationDomain.create({ data: { organizationId: campus.id, pattern: DOMINIO_CAMPUS } });
}

async function limpiarEstado(): Promise<void> {
  const usuarios = await prisma.user.findMany({ where: { email: { in: TODOS_LOS_EMAILS } }, select: { id: true } });
  const ids = usuarios.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { in: TODOS_LOS_EMAILS } } });
  if (fixtureIds.campus) await prisma.organization.deleteMany({ where: { id: fixtureIds.campus } });
}

// ─────────────────────────────────────────────────────────────
// Ciclo de vida del dev server (daemon de Astro — ver el comentario grande)
// ─────────────────────────────────────────────────────────────

function pararDevServer(): void {
  try {
    execFileSync('npx', ['astro', 'dev', 'stop'], { stdio: 'pipe' });
  } catch {
    // No había ninguno corriendo: no es un error para este script.
  }
}

function arrancarDevServer(envExtra: Record<string, string>): void {
  execFileSync('npx', ['astro', 'dev', '--port', String(PORT), '--background'], {
    env: { ...process.env, PORT: String(PORT), ...envExtra },
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
  throw new Error(`El dev server no respondió en ${BASE_URL} después de ${timeoutMs}ms`);
}

// ─────────────────────────────────────────────────────────────
// Cliente HTTP minimo con cookie jar manual (sin Playwright: este chequeo
// sólo pega endpoints y lee HTML servido, no ejercita nada del lado del
// cliente que necesite un browser real).
// ─────────────────────────────────────────────────────────────

interface Sesion {
  cookie: string | null;
}

function nuevaSesion(): Sesion {
  return { cookie: null };
}

function guardarCookie(sesion: Sesion, respuesta: Response): void {
  const cookies = respuesta.headers.getSetCookie?.() ?? [];
  const deSesion = cookies.find((c) => c.startsWith('kodu_session='));
  if (deSesion) sesion.cookie = deSesion.split(';')[0]!;
}

async function post(path: string, body: unknown, sesion?: Sesion): Promise<Response> {
  const respuesta = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sesion?.cookie ? { Cookie: sesion.cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  if (sesion) guardarCookie(sesion, respuesta);
  return respuesta;
}

async function get(path: string, sesion?: Sesion): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    headers: sesion?.cookie ? { Cookie: sesion.cookie } : {},
  });
}

async function registrar(email: string): Promise<{ sesion: Sesion; body: any }> {
  const sesion = nuevaSesion();
  const respuesta = await post('/api/auth/register', { name: `Docente ${email.split('@')[0]}`, email, password: DOCENTE_PASSWORD }, sesion);
  assert.equal(respuesta.status, 200, `registro de ${email} debe responder 200 (dio ${respuesta.status})`);
  const body = await respuesta.json();
  return { sesion, body };
}

function extraerToken(texto: string): string {
  const match = texto.match(/verificar-email\?token=([^"&\s]+)/);
  assert.ok(match, `el correo debe incluir un enlace a /verificar-email?token=... (vio: ${texto.slice(0, 300)})`);
  return decodeURIComponent(match![1]!);
}

async function main(): Promise<void> {
  pararDevServer();
  await limpiarEstado();
  await crearFixtures();

  const mock = await iniciarMockResend({ puerto: PUERTO_MOCK_RESEND });

  try {
    // ═══════════════════════════════════════════════════════════
    // FASE A — con RESEND_API_KEY + mock local
    // ═══════════════════════════════════════════════════════════
    arrancarDevServer({
      RESEND_API_KEY: RESEND_KEY_FALSA,
      RESEND_FROM: 'Kodu <no-reply@kodu.test>',
      RESEND_API_URL: mock.url,
    });
    await esperarListo();
    // Ventana de la caché de 10s de `organizacionParaEmail` (igual que
    // org-acceso.ts): el dev server recién arrancado no tiene nada cacheado
    // todavía en el primer pedido, así que no hace falta esperar acá — pero
    // sí conviene una espera chica para que el server termine de asentarse.
    await esperar(500);

    // ───────────────────────────────────────────────────────────
    // a. Registro con un email de dominio de CAMPUS: queda SIN verificar y
    //    PERSONAL (no se une aunque el dominio matchee).
    // ───────────────────────────────────────────────────────────
    const { body: bodyDominio } = await registrar(EMAIL_DOMINIO);
    assert.equal(bodyDominio.user.organizationId, null, 'sin confirmar el email, no debe unirse aunque el dominio matchee');

    const userDominio = await prisma.user.findUniqueOrThrow({
      where: { email: EMAIL_DOMINIO },
      select: { id: true, emailVerifiedAt: true, emailVerificationSource: true },
    });
    assert.equal(userDominio.emailVerifiedAt, null, 'con Resend configurado, el registro debe quedar sin verificar');
    assert.equal(userDominio.emailVerificationSource, null, 'sin verificar todavía no tiene source');
    console.log('✔ a. registro con Resend configurado: sin verificar, personal (no se une por dominio)');

    // ───────────────────────────────────────────────────────────
    // b. El mock recibió exactamente un correo a ese email, con el enlace.
    // ───────────────────────────────────────────────────────────
    const llamadasAlDominio = mock.llamadas.filter((l) => l.body.to === EMAIL_DOMINIO);
    assert.equal(llamadasAlDominio.length, 1, `debe mandarse exactamente un correo al registrarse (mandó ${llamadasAlDominio.length})`);
    const primerCorreo = llamadasAlDominio[0]!;
    assert.ok(primerCorreo.body.html?.includes('/verificar-email?token='), 'el HTML del correo debe traer el enlace de verificación');
    const tokenDominio = extraerToken(primerCorreo.body.html!);
    console.log('✔ b. el mock recibió exactamente un correo, con el enlace de verificación');

    // ───────────────────────────────────────────────────────────
    // c. Seguir el enlace verifica (source EMAIL) y une a la organización.
    // ───────────────────────────────────────────────────────────
    const respuestaVerificar = await get(`/verificar-email?token=${encodeURIComponent(tokenDominio)}`);
    assert.equal(respuestaVerificar.status, 200, 'la página de verificación debe responder 200');
    const htmlVerificar = await respuestaVerificar.text();
    assert.ok(htmlVerificar.includes(TEXTO_CONFIRMADO), `debe mostrar la pantalla de éxito (vio: ${htmlVerificar.slice(0, 200)})`);

    const userVerificado = await prisma.user.findUniqueOrThrow({
      where: { id: userDominio.id },
      select: { emailVerifiedAt: true, emailVerificationSource: true, organizationId: true },
    });
    assert.ok(userVerificado.emailVerifiedAt !== null, 'debe quedar verificado');
    assert.equal(userVerificado.emailVerificationSource, 'EMAIL', 'el source debe ser EMAIL');
    assert.equal(userVerificado.organizationId, fixtureIds.campus, '"unirse ocurre en el momento": al verificar, se une a la CAMPUS de su dominio');
    console.log('✔ c. seguir el enlace verifica (source EMAIL) y une a la organización de su dominio');

    // ───────────────────────────────────────────────────────────
    // d. Reusar el mismo enlace falla.
    // ───────────────────────────────────────────────────────────
    const respuestaReuso = await get(`/verificar-email?token=${encodeURIComponent(tokenDominio)}`);
    const htmlReuso = await respuestaReuso.text();
    assert.ok(htmlReuso.includes(TEXTO_ENLACE_INVALIDO), 'reusar el enlace debe mostrar el cartel de enlace inválido');
    console.log('✔ d. reusar el mismo enlace falla');

    // ───────────────────────────────────────────────────────────
    // e. Un token vencido falla.
    // ───────────────────────────────────────────────────────────
    const { body: bodyExpirar } = await registrar(EMAIL_EXPIRAR);
    assert.equal(bodyExpirar.user.organizationId, null, 'debe quedar personal (email fuera de cualquier organización)');
    const llamadasExpirar = mock.llamadas.filter((l) => l.body.to === EMAIL_EXPIRAR);
    assert.equal(llamadasExpirar.length, 1, 'debe mandarse un correo también para este registro');
    const tokenExpirar = extraerToken(llamadasExpirar[0]!.body.html!);

    const userExpirar = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_EXPIRAR }, select: { id: true } });
    await prisma.emailVerificationToken.updateMany({
      where: { userId: userExpirar.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const respuestaVencido = await get(`/verificar-email?token=${encodeURIComponent(tokenExpirar)}`);
    const htmlVencido = await respuestaVencido.text();
    assert.ok(htmlVencido.includes(TEXTO_ENLACE_INVALIDO), 'un token vencido debe mostrar el cartel de enlace inválido');
    console.log('✔ e. un token vencido (expiresAt en el pasado) falla');

    // ───────────────────────────────────────────────────────────
    // f. Reenviar antes de 60s da 429; "rebobinar" createdAt y reenviar de
    //    nuevo da 200 y un correo nuevo.
    // ───────────────────────────────────────────────────────────
    const { sesion: sesionReenvio } = await registrar(EMAIL_REENVIO);
    const llamadasReenvioIniciales = mock.llamadas.filter((l) => l.body.to === EMAIL_REENVIO).length;
    assert.equal(llamadasReenvioIniciales, 1, 'el registro ya mandó el primer correo');

    const respuesta429 = await post('/api/auth/verificacion/reenviar', {}, sesionReenvio);
    assert.equal(respuesta429.status, 429, `reenviar antes de 60s debe dar 429 (dio ${respuesta429.status})`);
    const cuerpo429 = (await respuesta429.json()) as { esperarSegundos?: number };
    assert.ok(typeof cuerpo429.esperarSegundos === 'number' && cuerpo429.esperarSegundos > 0, 'el 429 debe traer esperarSegundos > 0');

    const userReenvio = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_REENVIO }, select: { id: true } });
    await prisma.emailVerificationToken.updateMany({
      where: { userId: userReenvio.id },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });

    const respuesta200 = await post('/api/auth/verificacion/reenviar', {}, sesionReenvio);
    assert.equal(respuesta200.status, 200, `reenviar después de rebobinar createdAt debe dar 200 (dio ${respuesta200.status})`);
    const llamadasReenvioTrasRebobinar = mock.llamadas.filter((l) => l.body.to === EMAIL_REENVIO).length;
    assert.equal(llamadasReenvioTrasRebobinar, 2, 'rebobinar createdAt y reenviar debe mandar un correo NUEVO');
    console.log('✔ f. reenviar antes de 60s da 429; tras rebobinar createdAt, 200 y un correo nuevo');

    // ───────────────────────────────────────────────────────────
    // g. El header Authorization llevó la key; la key nunca aparece en el
    //    log del dev server.
    // ───────────────────────────────────────────────────────────
    assert.ok(mock.llamadas.length >= 4, 'debe haber al menos 4 llamadas al mock a esta altura');
    for (const llamada of mock.llamadas) {
      assert.equal(llamada.authorization, `Bearer ${RESEND_KEY_FALSA}`, 'cada pedido a Resend debe llevar la key en Authorization');
    }
    const logDevServer = readFileSync(LOG_FILE, 'utf8');
    assert.ok(!logDevServer.includes(RESEND_KEY_FALSA), 'la key de Resend nunca debe aparecer en el log del dev server');
    console.log('✔ g. el header Authorization llevó la key; la key nunca aparece en el log del dev server');

    // ───────────────────────────────────────────────────────────
    // h. Con la key cargada, /admin NO muestra el aviso.
    // ───────────────────────────────────────────────────────────
    const sesionAdminConKey = nuevaSesion();
    const loginAdminConKey = await post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, sesionAdminConKey);
    assert.equal(loginAdminConKey.status, 200, `login del admin (fase con key) debe responder 200 (dio ${loginAdminConKey.status})`);
    const htmlAdminConKey = await (await get('/admin/usuarios', sesionAdminConKey)).text();
    assert.ok(!htmlAdminConKey.includes(AVISO_ADMIN_TEXTO), 'con RESEND_API_KEY cargada, /admin no debe mostrar el aviso');
    console.log('✔ h. con la key cargada, /admin no muestra el aviso');

    pararDevServer();

    // ═══════════════════════════════════════════════════════════
    // FASE B — sin RESEND_API_KEY (fallback)
    // ═══════════════════════════════════════════════════════════
    arrancarDevServer({ RESEND_API_KEY: '', RESEND_FROM: '', RESEND_API_URL: '' });
    await esperarListo();
    await esperar(500);

    const { body: bodySinKey } = await registrar(EMAIL_SIN_KEY);
    assert.equal(bodySinKey.user.organizationId, fixtureIds.campus, 'sin key, debe unirse por dominio de una');
    const userSinKey = await prisma.user.findUniqueOrThrow({
      where: { email: EMAIL_SIN_KEY },
      select: { emailVerifiedAt: true, emailVerificationSource: true },
    });
    assert.ok(userSinKey.emailVerifiedAt !== null, 'sin key, debe quedar verificado de una');
    assert.equal(userSinKey.emailVerificationSource, 'NO_PROVIDER', 'sin key, el source debe ser NO_PROVIDER');
    console.log('✔ i. sin RESEND_API_KEY: verificado NO_PROVIDER, se une por dominio');

    const llamadasSinKey = mock.llamadas.filter((l) => l.body.to === EMAIL_SIN_KEY);
    assert.equal(llamadasSinKey.length, 0, 'sin key, no debe mandarse ningún correo');

    const sesionAdminSinKey = nuevaSesion();
    const loginAdminSinKey = await post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, sesionAdminSinKey);
    assert.equal(loginAdminSinKey.status, 200, `login del admin (fase sin key) debe responder 200 (dio ${loginAdminSinKey.status})`);
    const htmlAdminSinKey = await (await get('/admin/usuarios', sesionAdminSinKey)).text();
    assert.ok(htmlAdminSinKey.includes(AVISO_ADMIN_TEXTO), 'sin RESEND_API_KEY, /admin debe mostrar el aviso');
    console.log('✔ j. sin la key, /admin muestra el aviso');

    console.log('\n✔ e2e/verificacion-email.ts: todos los escenarios pasaron');
  } finally {
    pararDevServer();
    await mock.detener();
    await limpiarEstado();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\n✖ e2e/verificacion-email.ts falló:', error);
  process.exitCode = 1;
});
