import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { BASE_URL } from './harness.ts';

/**
 * Verificación de T9 (odd/tasks/organizaciones.md): aislamiento.
 *
 * Postura ADVERSARIAL: se intenta activamente que un admin de organización
 * vea o mute datos de otra, y que un docente plano o una cuenta personal
 * lleguen a algo administrativo. Regla del dueño: "el admin de una
 * organización NUNCA ve datos de otra". Los recursos de los docentes (título,
 * prompts, HTML) nunca son visibles para un admin de organización — sólo
 * conteos (T8, decisión del dueño).
 *
 * Fetch + cookie jar manual (mismo criterio que org-invitaciones.ts y
 * verificacion-email.ts) — nada de esto necesita un navegador real, y en la
 * Raspberry cada Chromium que no hace falta es RAM que no sobra.
 *
 * Fixture (una red A con dos sedes hermanas + una sede standalone B):
 *
 *   redA
 *   ├── campusA1  (adminA1 la administra; adminRedA también, vía la red)
 *   └── campusA2  (SÓLO adminRedA la administra — hermana de A1)
 *   campusB  (standalone, ajena por completo a la red A; adminB la administra)
 *
 * Actores además de los admins/docentes de cada sede:
 *  - superadmin (seed, SEED_ADMIN_EMAIL/PASSWORD)
 *  - adminA2Ajeno: pertenece HOY a A1, pero tiene una fila de OrganizationAdmin
 *    sobre A2 que NO CUENTA (alcance.ts: sólo cuenta si pertenece a esa sede
 *    o a una sede de esa red) — tiene que sacar 404 en A2 igual que cualquiera.
 *  - adminFormerA1: admin de A1 al que se le borra el poder A MITAD del test,
 *    con la MISMA cookie de sesión — tiene que perder acceso en el próximo
 *    pedido, sin re-login (identidad fresca releída de la base).
 *  - personal: cuenta personal (sin organización, dominio que no matchea nada).
 *  - anónimo: sin cookie de sesión.
 *
 * Corre con: KODU_BASE_URL=http://localhost:3100 npx tsx e2e/aislamiento-organizaciones.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const PASSWORD = 'Docente.Aislamiento.E2E.2026';
const MES_FIXTURE = '2026-03';

const SUFIJO = randomUUID().slice(0, 8);
const DOMINIO = `aislamiento-e2e-${SUFIJO}.local`;

const EMAIL_ADMIN_A1 = `admin-a1-aislamiento-e2e-${SUFIJO}@${DOMINIO}`;
const EMAIL_ADMIN_RED_A = `admin-red-a-aislamiento-e2e-${SUFIJO}@${DOMINIO}`;
const EMAIL_ADMIN_B = `admin-b-aislamiento-e2e-${SUFIJO}@${DOMINIO}`;
const EMAIL_TEACHER_A1 = `docente-a1-aislamiento-e2e-${SUFIJO}@${DOMINIO}`;
const EMAIL_TEACHER_A2 = `docente-a2-aislamiento-e2e-${SUFIJO}@${DOMINIO}`;
const EMAIL_TEACHER_B = `docente-b-aislamiento-e2e-${SUFIJO}@${DOMINIO}`;
const EMAIL_ADMIN_A2_AJENO = `admin-a2-ajeno-aislamiento-e2e-${SUFIJO}@${DOMINIO}`;
const EMAIL_ADMIN_FORMER_A1 = `admin-former-a1-aislamiento-e2e-${SUFIJO}@${DOMINIO}`;
const EMAIL_PERSONAL = `personal-aislamiento-e2e-${SUFIJO}@afuera-aislamiento-e2e.com`;
const EMAIL_WHITELIST_STEAL = EMAIL_TEACHER_B; // el "robo" de lista blanca apunta al email de un miembro AJENO real.

const TODOS_LOS_EMAILS = [
  EMAIL_ADMIN_A1,
  EMAIL_ADMIN_RED_A,
  EMAIL_ADMIN_B,
  EMAIL_TEACHER_A1,
  EMAIL_TEACHER_A2,
  EMAIL_TEACHER_B,
  EMAIL_ADMIN_A2_AJENO,
  EMAIL_ADMIN_FORMER_A1,
  EMAIL_PERSONAL,
];

const TITULO_SECRETO_A1 = `TITULO-SECRETO-A1-${SUFIJO}`;
const TITULO_SECRETO_A2 = `TITULO-SECRETO-A2-${SUFIJO}`;
const TITULO_SECRETO_B = `TITULO-SECRETO-B-${SUFIJO}`;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

function d(valor: string): Prisma.Decimal {
  return new Prisma.Decimal(valor);
}

// ─────────────────────────────────────────────────────────────
// 1. Descubrimiento de rutas: cualquier ruta nueva sin expectativa rompe la
//    suite (odd/tasks/organizaciones.md T9, punto 1 del pedido).
// ─────────────────────────────────────────────────────────────

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.join(AQUI, '..', 'src', 'pages');

function listarArchivos(dirRelativo: string): string[] {
  const abs = path.join(PAGES_DIR, dirRelativo);
  const resultado: string[] = [];
  function recorrer(actual: string): void {
    for (const entrada of readdirSync(actual, { withFileTypes: true })) {
      const ruta = path.join(actual, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else if (/\.(ts|astro)$/.test(entrada.name)) resultado.push(ruta);
    }
  }
  recorrer(abs);
  return resultado;
}

function metodosDeArchivo(abs: string): string[] {
  if (abs.endsWith('.astro')) return ['PAGE'];
  const contenido = readFileSync(abs, 'utf8');
  const metodos = new Set<string>();
  for (const m of contenido.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)) metodos.add(m[1]!);
  return [...metodos];
}

function patronDesdeArchivo(abs: string): string {
  const rel = path.relative(PAGES_DIR, abs).replace(/\\/g, '/');
  let sinExt = rel.replace(/\.(ts|astro)$/, '');
  if (sinExt === 'index') sinExt = '';
  else if (sinExt.endsWith('/index')) sinExt = sinExt.slice(0, -'/index'.length);
  return `/${sinExt}`;
}

interface RutaDescubierta {
  metodo: string;
  patron: string;
  archivo: string;
}

function descubrirRutas(dirs: string[]): RutaDescubierta[] {
  const resultado: RutaDescubierta[] = [];
  for (const dir of dirs) {
    for (const archivo of listarArchivos(dir)) {
      const patron = patronDesdeArchivo(archivo);
      for (const metodo of metodosDeArchivo(archivo)) {
        resultado.push({ metodo, patron, archivo: path.relative(path.join(AQUI, '..'), archivo) });
      }
    }
  }
  return resultado;
}

/**
 * Tabla de expectativas: TODA ruta que descubra el escaneo de arriba tiene
 * que tener una entrada acá — si mañana aparece una ruta nueva bajo
 * api/org, api/admin, api/invitaciones, /org o /admin sin pasar por acá, la
 * suite se rompe ANTES de correr un solo escenario (en vez de quedar
 * silenciosamente sin cubrir).
 */
const RUTAS_ESPERADAS = new Set<string>([
  // api/org
  'POST /api/org/elegir-sede',
  'POST /api/org/invitaciones/[id]/revocar',
  'GET /api/org/invitaciones',
  'POST /api/org/invitaciones',
  'DELETE /api/org/miembros/[userId]',
  'PATCH /api/org/miembros/[userId]',
  'POST /api/org/organizaciones/[id]/admins',
  'DELETE /api/org/organizaciones/[id]/admins/[userId]',
  'DELETE /api/org/organizaciones/[id]/lista-blanca/[emailId]',
  'GET /api/org/organizaciones/[id]/lista-blanca',
  'POST /api/org/organizaciones/[id]/lista-blanca',
  'GET /api/org/organizaciones/[id]/miembros',
  'GET /api/org/sedes',
  // api/admin/organizaciones
  'GET /api/admin/organizaciones',
  'POST /api/admin/organizaciones',
  'GET /api/admin/organizaciones/[id]',
  'PATCH /api/admin/organizaciones/[id]',
  'GET /api/admin/organizaciones/[id]/dominios',
  'POST /api/admin/organizaciones/[id]/dominios',
  'DELETE /api/admin/organizaciones/[id]/dominios/[domainId]',
  'POST /api/admin/organizaciones/[id]/admins',
  'DELETE /api/admin/organizaciones/[id]/admins/[userId]',
  'GET /api/admin/organizaciones/[id]/lista-blanca',
  'POST /api/admin/organizaciones/[id]/lista-blanca',
  'DELETE /api/admin/organizaciones/[id]/lista-blanca/[emailId]',
  'GET /api/admin/organizaciones/[id]/miembros',
  'DELETE /api/admin/organizaciones/[id]/miembros/[userId]',
  'PATCH /api/admin/organizaciones/[id]/miembros/[userId]',
  // resto de api/admin (gateado en bloque por el middleware, no por T9 —
  // igual entran al escaneo porque "route files under ... src/pages/api/admin")
  'GET /api/admin/demo/recursos',
  'DELETE /api/admin/demo/recursos',
  'POST /api/admin/demo/reiniciar',
  'GET /api/admin/metricas.csv',
  'PATCH /api/admin/models/[id]',
  'GET /api/admin/models',
  'POST /api/admin/models',
  'PATCH /api/admin/models/orden',
  'PATCH /api/admin/providers/[id]',
  'GET /api/admin/providers',
  'POST /api/admin/providers',
  'PATCH /api/admin/settings',
  'GET /api/admin/users/[id]/consumo',
  'PATCH /api/admin/users/[id]',
  // api/invitaciones
  'POST /api/invitaciones/aceptar',
  // páginas
  'PAGE /org',
  'PAGE /admin',
  'PAGE /admin/demo',
  'PAGE /admin/generacion',
  'PAGE /admin/metricas',
  'PAGE /admin/motores',
  'PAGE /admin/organizaciones',
  'PAGE /admin/organizaciones/[id]',
  'PAGE /admin/proveedores',
  'PAGE /admin/proyectos',
  'PAGE /admin/usuarios',
  'PAGE /admin/usuarios/[id]',
]);

/** Rutas de `/api/admin/**` que NO son de organizaciones — cualquier rol no-ADMIN
 *  tiene que sacar 403 en bloque (el middleware las gatea a todas por igual,
 *  nunca llegan a su propio handler). Se usan placeholders para los `[id]`. */
const RUTAS_ADMIN_GENERICAS = [...RUTAS_ESPERADAS].filter(
  (r) => r.startsWith('GET /api/admin/') || r.startsWith('POST /api/admin/') || r.startsWith('PATCH /api/admin/') || r.startsWith('DELETE /api/admin/'),
).filter((r) => !r.includes('/api/admin/organizaciones'));

const PAGINAS_ADMIN_GENERICAS = [...RUTAS_ESPERADAS].filter(
  (r) => r.startsWith('PAGE /admin/') && !r.includes('/admin/organizaciones'),
);

function conPlaceholders(patron: string): string {
  return patron.replace(/\[[^\]]+\]/g, 'placeholder-id');
}

// ─────────────────────────────────────────────────────────────
// 2. Cliente HTTP mínimo con cookie jar manual (mismo criterio que
//    e2e/org-invitaciones.ts / e2e/verificacion-email.ts).
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

async function peticion(
  metodo: string,
  ruta: string,
  body: unknown,
  sesion?: Sesion,
  headersExtra?: Record<string, string>,
): Promise<Response> {
  const headers: Record<string, string> = { ...headersExtra };
  if (body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (sesion?.cookie) headers['Cookie'] = sesion.cookie;

  const respuesta = await fetch(`${BASE_URL}${ruta}`, {
    method: metodo,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    redirect: 'manual',
  });
  if (sesion) guardarCookie(sesion, respuesta);
  return respuesta;
}

const get = (ruta: string, sesion?: Sesion) => peticion('GET', ruta, undefined, sesion);
const post = (ruta: string, body: unknown, sesion?: Sesion) => peticion('POST', ruta, body ?? {}, sesion);
const patch = (ruta: string, body: unknown, sesion?: Sesion) => peticion('PATCH', ruta, body ?? {}, sesion);
const del = (ruta: string, body: unknown, sesion?: Sesion) => peticion('DELETE', ruta, body ?? {}, sesion);

async function iniciarSesion(email: string, password: string): Promise<Sesion> {
  const sesion = nuevaSesion();
  const respuesta = await post('/api/auth/login', { email, password }, sesion);
  assert.equal(respuesta.status, 200, `login de ${email} debe dar 200 (dio ${respuesta.status}: ${await respuesta.text()})`);
  return sesion;
}

/** Sigue UN redirect manual y devuelve a dónde apuntaba (para afirmar "termina en /app", "termina en /login"). */
function ubicacion(respuesta: Response): string | null {
  return respuesta.headers.get('location');
}

// ─────────────────────────────────────────────────────────────
// 3. Fixtures.
// ─────────────────────────────────────────────────────────────

const orgIds = { redA: '', campusA1: '', campusA2: '', campusB: '' };
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
  await prisma.organizationAllowedEmail.deleteMany({ where: { email: { contains: `aislamiento-e2e-${SUFIJO}` } } });
  await prisma.organizationInvite.deleteMany({ where: { organization: { name: { contains: SUFIJO } } } });
  await prisma.organization.deleteMany({ where: { name: { contains: SUFIJO } } });
}

async function crearUsuario(email: string, nombre: string, organizationId: string | null): Promise<string> {
  const fila = await prisma.user.upsert({
    where: { email },
    update: { role: 'DOCENTE', organizationId, passwordHash: await hashPassword(PASSWORD) },
    create: {
      email,
      name: nombre,
      role: 'DOCENTE',
      passwordHash: await hashPassword(PASSWORD),
      organizationId,
      emailVerifiedAt: new Date(),
      emailVerificationSource: 'NO_PROVIDER',
    },
    select: { id: true },
  });
  return fila.id;
}

async function crearProyecto(userId: string, title: string): Promise<string> {
  const proyecto = await prisma.project.create({
    data: { userId, title, slug: `e2e-aislamiento-${randomUUID()}` },
    select: { id: true },
  });
  return proyecto.id;
}

function fechaFixture(diaMes: string): Date {
  return new Date(`${MES_FIXTURE}-${diaMes}T12:00:00-03:00`);
}

async function sembrarConsumo(userId: string, organizationId: string, projectId: string, costo: string): Promise<void> {
  await prisma.tokenUsage.create({
    data: {
      userId,
      organizationId,
      projectId,
      purpose: 'GENERATION',
      forNewResource: true,
      model: 'e2e-aislamiento',
      promptTokens: 100,
      completionTokens: 40,
      cachedInputTokens: 0,
      costUsd: d(costo),
      createdAt: fechaFixture('10'),
    },
  });
}

async function main(): Promise<void> {
  // ── 1. Descubrimiento: falla ANTES de tocar nada si hay una ruta sin cubrir. ──
  const descubiertas = descubrirRutas(['api/org', 'api/admin', 'api/invitaciones', 'org', 'admin']);
  const sinCubrir = descubiertas.filter((r) => !RUTAS_ESPERADAS.has(`${r.metodo} ${r.patron}`));
  assert.equal(
    sinCubrir.length,
    0,
    `rutas descubiertas sin expectativa en la tabla (agregalas a RUTAS_ESPERADAS): ${sinCubrir
      .map((r) => `${r.metodo} ${r.patron} (${r.archivo})`)
      .join(', ')}`,
  );
  console.log(`✔ 1. descubrimiento de rutas: ${descubiertas.length} combinaciones método×ruta, todas cubiertas en la tabla`);

  await limpiarEstado();

  let totalCasosMatriz = 0;
  const contarCaso = () => {
    totalCasosMatriz += 1;
  };

  try {
    // ───────────────────────────────────────────────────────────
    // 2. Fixture: red A (sedes A1/A2 hermanas) + sede standalone B.
    // ───────────────────────────────────────────────────────────
    const redA = await prisma.organization.create({ data: { name: `Red A Aislamiento E2E ${SUFIJO}`, kind: 'NETWORK' } });
    const campusA1 = await prisma.organization.create({ data: { name: `Sede A1 Aislamiento E2E ${SUFIJO}`, kind: 'CAMPUS', parentId: redA.id } });
    const campusA2 = await prisma.organization.create({ data: { name: `Sede A2 Aislamiento E2E ${SUFIJO}`, kind: 'CAMPUS', parentId: redA.id } });
    const campusB = await prisma.organization.create({ data: { name: `Sede B Aislamiento E2E ${SUFIJO}`, kind: 'CAMPUS' } });
    orgIds.redA = redA.id;
    orgIds.campusA1 = campusA1.id;
    orgIds.campusA2 = campusA2.id;
    orgIds.campusB = campusB.id;

    userIds.adminA1 = await crearUsuario(EMAIL_ADMIN_A1, 'Admin A1', campusA1.id);
    userIds.adminRedA = await crearUsuario(EMAIL_ADMIN_RED_A, 'Admin Red A', campusA1.id);
    userIds.adminB = await crearUsuario(EMAIL_ADMIN_B, 'Admin B', campusB.id);
    userIds.teacherA1 = await crearUsuario(EMAIL_TEACHER_A1, 'Docente A1', campusA1.id);
    userIds.teacherA2 = await crearUsuario(EMAIL_TEACHER_A2, 'Docente A2', campusA2.id);
    userIds.teacherB = await crearUsuario(EMAIL_TEACHER_B, 'Docente B', campusB.id);
    userIds.adminA2Ajeno = await crearUsuario(EMAIL_ADMIN_A2_AJENO, 'Admin A2 Ajeno', campusA1.id);
    userIds.adminFormerA1 = await crearUsuario(EMAIL_ADMIN_FORMER_A1, 'Admin Former A1', campusA1.id);
    userIds.personal = await crearUsuario(EMAIL_PERSONAL, 'Cuenta Personal', null);

    await prisma.organizationAdmin.create({ data: { userId: userIds.adminA1, organizationId: campusA1.id } });
    await prisma.organizationAdmin.create({ data: { userId: userIds.adminRedA, organizationId: redA.id } });
    await prisma.organizationAdmin.create({ data: { userId: userIds.adminB, organizationId: campusB.id } });
    // Fila que NO cuenta: adminA2Ajeno pertenece HOY a A1, no a A2 (alcance.ts).
    await prisma.organizationAdmin.create({ data: { userId: userIds.adminA2Ajeno, organizationId: campusA2.id } });
    await prisma.organizationAdmin.create({ data: { userId: userIds.adminFormerA1, organizationId: campusA1.id } });

    const projA1 = await crearProyecto(userIds.teacherA1, TITULO_SECRETO_A1);
    const projA2 = await crearProyecto(userIds.teacherA2, TITULO_SECRETO_A2);
    const projB = await crearProyecto(userIds.teacherB, TITULO_SECRETO_B);
    await sembrarConsumo(userIds.teacherA1, campusA1.id, projA1, '0.05');
    await sembrarConsumo(userIds.teacherA2, campusA2.id, projA2, '0.07');
    await sembrarConsumo(userIds.teacherB, campusB.id, projB, '0.09');

    // Invitación existente de A2 (creada directo en base, para probar que
    // adminA1 no puede ni siquiera REVOCARLA) y de B.
    const invitacionA1 = await prisma.organizationInvite.create({
      data: { organizationId: campusA1.id, tokenHash: `hash-a1-${SUFIJO}`, createdById: userIds.adminA1 },
      select: { id: true },
    });
    const invitacionA2 = await prisma.organizationInvite.create({
      data: { organizationId: campusA2.id, tokenHash: `hash-a2-${SUFIJO}`, createdById: userIds.adminRedA },
      select: { id: true },
    });
    const invitacionB = await prisma.organizationInvite.create({
      data: { organizationId: campusB.id, tokenHash: `hash-b-${SUFIJO}`, createdById: userIds.adminB },
      select: { id: true },
    });
    void invitacionB;
    // Entrada de lista blanca existente en B, para que adminA1 intente borrarla.
    const whitelistB = await prisma.organizationAllowedEmail.create({
      data: { organizationId: campusB.id, email: `ya-en-lista-b-${SUFIJO}@afuera.com`, createdById: userIds.adminB },
      select: { id: true },
    });

    console.log('✔ 2. fixture: red A (A1/A2 hermanas) + sede B, 9 cuentas, 3 recursos "secretos", consumo sembrado');

    // ───────────────────────────────────────────────────────────
    // 3. Sesiones.
    // ───────────────────────────────────────────────────────────
    const superadmin = await iniciarSesion(ADMIN_EMAIL, ADMIN_PASSWORD);
    const adminA1 = await iniciarSesion(EMAIL_ADMIN_A1, PASSWORD);
    const adminRedA = await iniciarSesion(EMAIL_ADMIN_RED_A, PASSWORD);
    const adminB = await iniciarSesion(EMAIL_ADMIN_B, PASSWORD);
    const teacherA1 = await iniciarSesion(EMAIL_TEACHER_A1, PASSWORD);
    const adminA2Ajeno = await iniciarSesion(EMAIL_ADMIN_A2_AJENO, PASSWORD);
    const adminFormerA1 = await iniciarSesion(EMAIL_ADMIN_FORMER_A1, PASSWORD);
    const personal = await iniciarSesion(EMAIL_PERSONAL, PASSWORD);
    const anonimo = undefined; // sin cookie

    console.log('✔ 3. 8 sesiones abiertas (+ anónimo, sin cookie)');

    // ───────────────────────────────────────────────────────────
    // 4. Anónimo: TODA ruta gateada de /api/org, /api/admin y las páginas
    //    /org, /admin/** tiene que rechazar sin sesión.
    // ───────────────────────────────────────────────────────────
    for (const clave of RUTAS_ESPERADAS) {
      const [metodo, patronCrudo] = clave.split(' ') as [string, string];
      const patron = conPlaceholders(patronCrudo);
      contarCaso();

      if (metodo === 'PAGE') {
        const r = await get(patron);
        assert.ok([301, 302, 303, 307].includes(r.status), `anónimo en PAGE ${patron} debe redirigir (dio ${r.status})`);
        assert.ok(ubicacion(r)?.includes('/login'), `anónimo en PAGE ${patron} debe ir a /login (fue a ${ubicacion(r)})`);
        continue;
      }

      const r =
        metodo === 'GET'
          ? await get(patron)
          : metodo === 'POST'
            ? await post(patron, {})
            : metodo === 'PATCH'
              ? await patch(patron, {})
              : await del(patron, {});
      assert.equal(r.status, 401, `anónimo en ${metodo} ${patron} debe dar 401 (dio ${r.status})`);
    }
    console.log(`✔ 4. anónimo: las ${RUTAS_ESPERADAS.size} combinaciones método×ruta descubiertas rechazan sin sesión`);

    // ───────────────────────────────────────────────────────────
    // 5. Docente plano (teacherA1) y admin de organización (adminA1) contra
    //    TODA ruta de /api/admin/** y /admin/** que NO es de organizaciones:
    //    el middleware las gatea en bloque por rol, nunca llegan a su propio
    //    handler — un admin de organización sigue siendo role DOCENTE.
    // ───────────────────────────────────────────────────────────
    for (const actor of [teacherA1, adminA1]) {
      for (const clave of RUTAS_ADMIN_GENERICAS) {
        const [metodo, patronCrudo] = clave.split(' ') as [string, string];
        const patron = conPlaceholders(patronCrudo);
        contarCaso();
        const r =
          metodo === 'GET'
            ? await get(patron, actor)
            : metodo === 'POST'
              ? await post(patron, {}, actor)
              : metodo === 'PATCH'
                ? await patch(patron, {}, actor)
                : await del(patron, {}, actor);
        assert.equal(r.status, 403, `docente/org-admin en ${metodo} ${patron} debe dar 403 (dio ${r.status})`);
      }
      for (const clave of PAGINAS_ADMIN_GENERICAS) {
        const patron = conPlaceholders(clave.split(' ')[1]!);
        contarCaso();
        const r = await get(patron, actor);
        assert.ok([301, 302, 303, 307].includes(r.status), `docente/org-admin en PAGE ${patron} debe redirigir (dio ${r.status})`);
        assert.ok(ubicacion(r)?.endsWith('/app'), `docente/org-admin en PAGE ${patron} debe ir a /app (fue a ${ubicacion(r)})`);
      }
    }
    console.log(
      `✔ 5. docente plano y admin de organización: ${RUTAS_ADMIN_GENERICAS.length} APIs + ${PAGINAS_ADMIN_GENERICAS.length} páginas de /admin no-organizaciones, bloqueadas por rol para ambos`,
    );

    // ───────────────────────────────────────────────────────────
    // 6. Un docente plano no entra a /org.
    // ───────────────────────────────────────────────────────────
    {
      const r = await get('/org', teacherA1);
      assert.ok([301, 302, 303, 307].includes(r.status), `docente plano en /org debe redirigir (dio ${r.status})`);
      assert.ok(ubicacion(r)?.endsWith('/app'), `docente plano en /org debe ir a /app (fue a ${ubicacion(r)})`);
      contarCaso();
    }
    console.log('✔ 6. docente plano en /org: redirige a /app');

    // ───────────────────────────────────────────────────────────
    // 7. adminA1 (sólo administra A1): ids adivinados de A2 (hermana) y B
    //    (ajena) en TODA la superficie de /api/org — página, miembros,
    //    lista blanca, invitaciones (incluida revocar una existente),
    //    admins, mover. Todo 404, y se confirma que la base no cambió.
    // ───────────────────────────────────────────────────────────
    for (const [nombreOrg, orgId] of [
      ['A2 (hermana)', campusA2.id],
      ['B (ajena)', campusB.id],
    ] as const) {
      const rPagina = await get(`/org?sede=${orgId}`, adminA1);
      assert.equal(rPagina.status, 404, `adminA1 en /org?sede=${nombreOrg} debe dar 404 (dio ${rPagina.status})`);
      contarCaso();

      const rMiembros = await get(`/api/org/organizaciones/${orgId}/miembros`, adminA1);
      assert.equal(rMiembros.status, 404, `GET miembros de ${nombreOrg} debe dar 404 (dio ${rMiembros.status})`);
      contarCaso();

      const rListaGet = await get(`/api/org/organizaciones/${orgId}/lista-blanca`, adminA1);
      assert.equal(rListaGet.status, 404, `GET lista blanca de ${nombreOrg} debe dar 404 (dio ${rListaGet.status})`);
      contarCaso();

      const conteoListaAntes = await prisma.organizationAllowedEmail.count({ where: { organizationId: orgId } });
      const rListaPost = await post(`/api/org/organizaciones/${orgId}/lista-blanca`, { email: `intruso-${randomUUID()}@afuera.com` }, adminA1);
      assert.equal(rListaPost.status, 404, `POST lista blanca de ${nombreOrg} debe dar 404 (dio ${rListaPost.status})`);
      const conteoListaDespues = await prisma.organizationAllowedEmail.count({ where: { organizationId: orgId } });
      assert.equal(conteoListaDespues, conteoListaAntes, `POST lista blanca de ${nombreOrg} NO debe crear nada`);
      contarCaso();

      const rInvGet = await get(`/api/org/invitaciones?organizationId=${orgId}`, adminA1);
      assert.equal(rInvGet.status, 404, `GET invitaciones de ${nombreOrg} debe dar 404 (dio ${rInvGet.status})`);
      contarCaso();

      const rInvPost = await post('/api/org/invitaciones', { organizationId: orgId }, adminA1);
      assert.equal(rInvPost.status, 404, `POST invitación para ${nombreOrg} debe dar 404 (dio ${rInvPost.status})`);
      contarCaso();

      const conteoAdminsAntes = await prisma.organizationAdmin.count({ where: { organizationId: orgId } });
      const rAdminPost = await post(`/api/org/organizaciones/${orgId}/admins`, { userId: userIds.teacherA1 }, adminA1);
      assert.equal(rAdminPost.status, 404, `POST admins de ${nombreOrg} debe dar 404 (dio ${rAdminPost.status})`);
      const conteoAdminsDespues = await prisma.organizationAdmin.count({ where: { organizationId: orgId } });
      assert.equal(conteoAdminsDespues, conteoAdminsAntes, `POST admins de ${nombreOrg} NO debe crear ninguna fila de OrganizationAdmin`);
      contarCaso();
    }

    // adminA1 tampoco llega a la superficie SUPERADMIN de organizaciones
    // (/api/admin/organizaciones/**): el middleware la gatea por ROL, antes
    // de que gestion.ts mire si administra A1 o no.
    {
      const r = await get(`/api/admin/organizaciones/${campusA1.id}/miembros`, adminA1);
      assert.equal(r.status, 403, `adminA1 en /api/admin/organizaciones/[A1]/miembros (superadmin-only) debe dar 403 (dio ${r.status})`);
      contarCaso();
      const rPagina = await get(`/admin/organizaciones/${campusA1.id}`, adminA1);
      assert.ok([301, 302, 303, 307].includes(rPagina.status), `adminA1 en /admin/organizaciones/[A1] debe redirigir (dio ${rPagina.status})`);
      assert.ok(ubicacion(rPagina)?.endsWith('/app'), `adminA1 en /admin/organizaciones/[A1] debe ir a /app (fue a ${ubicacion(rPagina)})`);
      contarCaso();
    }

    // Revocar la invitación EXISTENTE de A2 (creada directo en base): 404,
    // nunca se confía en el organizationId del body/URL — se autoriza contra
    // la organización REAL de la invitación.
    {
      const r = await post(`/api/org/invitaciones/${invitacionA2.id}/revocar`, {}, adminA1);
      assert.equal(r.status, 404, `adminA1 revocando la invitación de A2 debe dar 404 (dio ${r.status})`);
      const fila = await prisma.organizationInvite.findUnique({ where: { id: invitacionA2.id }, select: { revokedAt: true } });
      assert.equal(fila?.revokedAt, null, 'la invitación de A2 NO debe quedar revocada');
      contarCaso();
    }
    // Borrar la entrada de lista blanca EXISTENTE de B: 404, sigue viva.
    {
      const r = await del(`/api/org/organizaciones/${campusB.id}/lista-blanca/${whitelistB.id}`, {}, adminA1);
      assert.equal(r.status, 404, `adminA1 borrando la lista blanca de B debe dar 404 (dio ${r.status})`);
      const fila = await prisma.organizationAllowedEmail.findUnique({ where: { id: whitelistB.id } });
      assert.ok(fila, 'la entrada de lista blanca de B NO debe borrarse');
      contarCaso();
    }
    // Degradar al admin REAL de B: 404, sigue siendo admin.
    {
      const r = await del(`/api/org/organizaciones/${campusB.id}/admins/${userIds.adminB}`, {}, adminA1);
      assert.equal(r.status, 404, `adminA1 degradando al admin de B debe dar 404 (dio ${r.status})`);
      const fila = await prisma.organizationAdmin.findUnique({ where: { userId_organizationId: { userId: userIds.adminB, organizationId: campusB.id } } });
      assert.ok(fila, 'adminB debe seguir siendo admin de B');
      contarCaso();
    }
    // Mover a un docente de una sede TOTALMENTE ajena (B) hacia adentro
    // (A1): adminA1 administra el DESTINO pero no el ORIGEN — 404 igual.
    {
      const r = await patch(`/api/org/miembros/${userIds.teacherB}`, { destinoCampusId: campusA1.id }, adminA1);
      assert.equal(r.status, 404, `mover a teacherB (origen ajeno) hacia A1 debe dar 404 (dio ${r.status})`);
      const fila = await prisma.user.findUnique({ where: { id: userIds.teacherB }, select: { organizationId: true } });
      assert.equal(fila?.organizationId, campusB.id, 'teacherB debe seguir en B');
      contarCaso();
    }
    // Baja de un docente ajeno (teacherA2, sede hermana, admin de sede sin red).
    {
      const r = await del(`/api/org/miembros/${userIds.teacherA2}`, {}, adminA1);
      assert.equal(r.status, 404, `adminA1 dando de baja a teacherA2 (A2) debe dar 404 (dio ${r.status})`);
      const fila = await prisma.user.findUnique({ where: { id: userIds.teacherA2 }, select: { organizationId: true } });
      assert.equal(fila?.organizationId, campusA2.id, 'teacherA2 debe seguir en A2');
      contarCaso();
    }
    console.log('✔ 7. adminA1 (sólo campus): 404 en TODA la superficie de /api/org contra A2 (hermana) y B (ajena), base sin cambios');

    // ───────────────────────────────────────────────────────────
    // 8. adminRedA (administra toda la red A): A1 y A2 sí, B sigue ajena.
    // ───────────────────────────────────────────────────────────
    {
      const rB = await get(`/org?sede=${campusB.id}`, adminRedA);
      assert.equal(rB.status, 404, `adminRedA en /org?sede=B debe dar 404 (dio ${rB.status})`);
      contarCaso();

      const rInvB = await post('/api/org/invitaciones', { organizationId: campusB.id }, adminRedA);
      assert.equal(rInvB.status, 404, `adminRedA creando invitación para B debe dar 404 (dio ${rInvB.status})`);
      contarCaso();

      const rListaB = await post(`/api/org/organizaciones/${campusB.id}/lista-blanca`, { email: `otro-${randomUUID()}@afuera.com` }, adminRedA);
      assert.equal(rListaB.status, 404, `adminRedA agregando a la lista blanca de B debe dar 404 (dio ${rListaB.status})`);
      contarCaso();

      // Mover DENTRO de la red sí funciona (A1 -> A2); mover desde B (ajena) no.
      const rMoverDentro = await patch(`/api/org/miembros/${userIds.teacherA1}`, { destinoCampusId: campusA2.id }, adminRedA);
      assert.equal(rMoverDentro.status, 200, `adminRedA moviendo A1->A2 (dentro de su red) debe dar 200 (dio ${rMoverDentro.status})`);
      const filaMovida = await prisma.user.findUnique({ where: { id: userIds.teacherA1 }, select: { organizationId: true } });
      assert.equal(filaMovida?.organizationId, campusA2.id, 'teacherA1 debe quedar en A2 tras el move');
      // se lo devuelve a A1 para no romper el resto de las aserciones de este archivo.
      await prisma.user.update({ where: { id: userIds.teacherA1 }, data: { organizationId: campusA1.id } });
      contarCaso();

      const rMoverDesdeB = await patch(`/api/org/miembros/${userIds.teacherB}`, { destinoCampusId: campusA1.id }, adminRedA);
      assert.equal(rMoverDesdeB.status, 404, `adminRedA moviendo desde B (ajena) debe dar 404 (dio ${rMoverDesdeB.status})`);
      contarCaso();
    }
    console.log('✔ 8. adminRedA: administra A1+A2 (mover incluido), B sigue 404 en toda la superficie');

    // ───────────────────────────────────────────────────────────
    // 9. Fila de OrganizationAdmin que no cuenta: adminA2Ajeno tiene una fila
    //    sobre A2 pero pertenece HOY a A1 — tiene que sacar 404 en A2 igual
    //    que cualquier extraño, en TODA la API. Como esa fila es su ÚNICO
    //    reclamo administrativo, su `alcanceDeAdmin` queda VACÍO del todo —
    //    la guarda de página de /org (`org/index.astro`) redirige a /app
    //    ANTES de mirar el `?sede=` (mismo camino que un docente plano, ver
    //    punto 6); el 404 puntual de esa organización se confirma contra la
    //    API, que sí autoriza directo contra `?sede=A2` sin ese atajo previo.
    // ───────────────────────────────────────────────────────────
    {
      const r = await get(`/api/org/organizaciones/${campusA2.id}/miembros`, adminA2Ajeno);
      assert.equal(r.status, 404, `adminA2Ajeno (no pertenece a A2) debe dar 404 en miembros de A2 (dio ${r.status})`);
      contarCaso();

      const rLista = await get(`/api/org/organizaciones/${campusA2.id}/lista-blanca`, adminA2Ajeno);
      assert.equal(rLista.status, 404, `adminA2Ajeno debe dar 404 en lista blanca de A2 (dio ${rLista.status})`);
      contarCaso();

      const rInv = await get(`/api/org/invitaciones?organizationId=${campusA2.id}`, adminA2Ajeno);
      assert.equal(rInv.status, 404, `adminA2Ajeno debe dar 404 en invitaciones de A2 (dio ${rInv.status})`);
      contarCaso();

      // Alcance totalmente vacío (su única fila de OrganizationAdmin no
      // cuenta): la página redirige a /app igual que un docente sin ningún
      // poder administrativo, sin importar el `?sede=` pedido.
      const rPagina = await get(`/org?sede=${campusA2.id}`, adminA2Ajeno);
      assert.ok([301, 302, 303, 307].includes(rPagina.status), `adminA2Ajeno en /org?sede=A2 debe redirigir (dio ${rPagina.status})`);
      assert.ok(ubicacion(rPagina)?.endsWith('/app'), `adminA2Ajeno en /org?sede=A2 debe ir a /app (fue a ${ubicacion(rPagina)})`);
      contarCaso();
    }
    console.log('✔ 9. una fila de OrganizationAdmin sobre una organización a la que ya no pertenece no cuenta (404 en toda la API; /org redirige a /app)');

    // ───────────────────────────────────────────────────────────
    // 10. Admin dado de baja A MITAD del test, MISMA cookie: pierde el
    //     poder en el próximo pedido, sin re-login (identidad fresca).
    // ───────────────────────────────────────────────────────────
    {
      const rAntes = await get(`/api/org/organizaciones/${campusA1.id}/miembros`, adminFormerA1);
      assert.equal(rAntes.status, 200, `adminFormerA1 con poder debe dar 200 ANTES de la baja (dio ${rAntes.status})`);
      contarCaso();

      // Baja real: sale de la organización (gestion.ts borra sus filas de
      // OrganizationAdmin como parte de quitarMiembro) — la MISMA cookie sigue viva.
      await prisma.$transaction([
        prisma.user.update({ where: { id: userIds.adminFormerA1 }, data: { organizationId: null } }),
        prisma.organizationAdmin.deleteMany({ where: { userId: userIds.adminFormerA1 } }),
      ]);

      const rDespues = await get(`/api/org/organizaciones/${campusA1.id}/miembros`, adminFormerA1);
      assert.equal(rDespues.status, 404, `adminFormerA1 SIN re-login, tras la baja, debe dar 404 (dio ${rDespues.status})`);
      contarCaso();

      const rPagina = await get('/org', adminFormerA1);
      assert.ok([301, 302, 303, 307].includes(rPagina.status), `adminFormerA1 en /org tras la baja debe redirigir (dio ${rPagina.status})`);
      assert.ok(ubicacion(rPagina)?.endsWith('/app'), `adminFormerA1 en /org tras la baja debe ir a /app (fue a ${ubicacion(rPagina)})`);
      contarCaso();
    }
    console.log('✔ 10. dar de baja a un admin surte efecto en el PRÓXIMO pedido de la misma cookie, sin re-login');

    // ───────────────────────────────────────────────────────────
    // 11. Filtración de contenido: /org y las APIs GET de adminA1 nunca
    //     traen títulos de recurso (ni el propio ni el ajeno) ni
    //     nombres/emails de docentes ajenos.
    // ───────────────────────────────────────────────────────────
    {
      const rPagina = await get(`/org?sede=${campusA1.id}`, adminA1);
      assert.equal(rPagina.status, 200, `/org de adminA1 debe dar 200 (dio ${rPagina.status})`);
      const html = await rPagina.text();
      assert.ok(!html.includes(TITULO_SECRETO_A1), 'el título del recurso de SU PROPIO docente no debe aparecer (conteos, no contenido)');
      assert.ok(!html.includes(TITULO_SECRETO_A2), 'el título del recurso de A2 no debe aparecer');
      assert.ok(!html.includes(TITULO_SECRETO_B), 'el título del recurso de B no debe aparecer');
      assert.ok(!html.includes('Docente A2'), 'el nombre de un docente de A2 no debe aparecer');
      assert.ok(!html.includes('Docente B'), 'el nombre de un docente de B no debe aparecer');
      assert.ok(!html.includes(EMAIL_TEACHER_A2), 'el email de un docente de A2 no debe aparecer');
      assert.ok(!html.includes(EMAIL_TEACHER_B), 'el email de un docente de B no debe aparecer');
      assert.ok(html.includes('Docente A1'), 'adminA1 sí debe ver a SU propio docente en la lista');
      contarCaso();

      const rMiembros = await get(`/api/org/organizaciones/${campusA1.id}/miembros`, adminA1);
      const cuerpoMiembros = await rMiembros.text();
      assert.ok(!cuerpoMiembros.includes(TITULO_SECRETO_A1), 'el JSON de miembros nunca trae el título de un recurso');
      contarCaso();
    }
    console.log('✔ 11. /org y GET miembros: sin título de recurso (propio ni ajeno) ni datos de docentes de otra sede');

    // ───────────────────────────────────────────────────────────
    // 12. Consumo de /org: sólo filas de la sede propia — comparado contra
    //     una suma independiente en base filtrada por organizationId.
    // ───────────────────────────────────────────────────────────
    {
      const sumaRealA1 = await prisma.tokenUsage.aggregate({
        where: { organizationId: campusA1.id, createdAt: { gte: new Date(`${MES_FIXTURE}-01T00:00:00-03:00`), lt: new Date(`${MES_FIXTURE}-28T00:00:00-03:00`) } },
        _sum: { costUsd: true },
      });
      assert.equal(sumaRealA1._sum.costUsd?.toString(), '0.05', 'suma real de A1 en el mes de fixture: sólo la fila de teacherA1 (0.05)');

      const rPagina = await get(`/org?sede=${campusA1.id}&mes=${MES_FIXTURE}`, adminA1);
      const html = await rPagina.text();
      // Formato real de formatearSumaUsd/formatearCostoUsd (locale es-AR,
      // prefijo "US$ "): se busca la cifra RENDERIZADA, no una subcadena
      // numérica suelta — "0.09"/"0,09" sueltos matchean por accidente con
      // valores oklch del CSS embebido (--color-brand-100: oklch(0.34 0.12
      // 273.2) trae un "0.09" que no tiene nada que ver con plata).
      assert.ok(html.includes('US$ 0,05'), '/org de adminA1 debe mostrar el costo de SU sede (US$ 0,05)');
      assert.ok(!html.includes('US$ 0,07'), '/org de adminA1 NO debe traer el costo de A2 (US$ 0,07)');
      assert.ok(!html.includes('US$ 0,09'), '/org de adminA1 NO debe traer el costo de B (US$ 0,09)');
      contarCaso();
    }
    console.log('✔ 12. consumo de /org: coincide con la suma real filtrada por organizationId, sin mezclar sedes ajenas');

    // ───────────────────────────────────────────────────────────
    // 13. Métricas de precio: un admin de organización NUNCA llega — ni la
    //     página ni el CSV (son superadmin-only, ya cubierto en el punto 5
    //     genérico; acá se confirma explícitamente por nombre).
    // ───────────────────────────────────────────────────────────
    {
      const rPagina = await get('/admin/metricas', adminA1);
      assert.ok([301, 302, 303, 307].includes(rPagina.status), `adminA1 en /admin/metricas debe redirigir (dio ${rPagina.status})`);
      const rCsv = await get('/api/admin/metricas.csv', adminA1);
      assert.equal(rCsv.status, 403, `adminA1 pidiendo el CSV de métricas debe dar 403 (dio ${rCsv.status})`);
      contarCaso();
    }
    console.log('✔ 13. adminA1 no llega ni a /admin/metricas ni a su CSV');

    // ───────────────────────────────────────────────────────────
    // 14. Escalamiento: adminA1 promueve/mueve/roba dentro de SU PROPIA
    //     sede (A1) donde SÍ administra, para separar "no autorizado" de
    //     "reglas de negocio" — y el robo de lista blanca de un email ajeno.
    // ───────────────────────────────────────────────────────────
    {
      // "Robar" a teacherB (miembro real de B) agregando su email a la
      // lista blanca de A1: la fila se crea (agregarEmailListaBlanca no
      // rechaza el alta), pero teacherB NO se mueve — sólo une cuentas
      // PERSONALES (organizationId: null), y teacherB no lo es.
      const rWhitelist = await post(`/api/org/organizaciones/${campusA1.id}/lista-blanca`, { email: EMAIL_WHITELIST_STEAL }, adminA1);
      assert.equal(rWhitelist.status, 200, `agregar el email de teacherB a la lista blanca de A1 debe dar 200 (dio ${rWhitelist.status})`);
      const teacherBTrasWhitelist = await prisma.user.findUnique({ where: { id: userIds.teacherB }, select: { organizationId: true } });
      assert.equal(teacherBTrasWhitelist?.organizationId, campusB.id, 'teacherB NO debe moverse: un docente pertenece a UNA sola organización');
      contarCaso();
    }
    console.log('✔ 14. agregar a la lista blanca el email de un miembro ajeno no lo "roba" (sigue en su sede real)');

    // ───────────────────────────────────────────────────────────
    // 15. Docente plano llamando cada mutación de /api/org/** con SU PROPIA
    //     sede (A1) en el body/URL — no alcanza con pertenecer, hace falta
    //     administrar.
    // ───────────────────────────────────────────────────────────
    {
      const conteoAdminsAntes = await prisma.organizationAdmin.count({ where: { organizationId: campusA1.id } });
      const conteoListaAntes = await prisma.organizationAllowedEmail.count({ where: { organizationId: campusA1.id } });

      const intentos: Array<{ nombre: string; llamar: () => Promise<Response> }> = [
        { nombre: 'crear invitación', llamar: () => post('/api/org/invitaciones', { organizationId: campusA1.id }, teacherA1) },
        { nombre: 'listar invitaciones', llamar: () => get(`/api/org/invitaciones?organizationId=${campusA1.id}`, teacherA1) },
        { nombre: 'revocar invitación existente de su propia sede', llamar: () => post(`/api/org/invitaciones/${invitacionA1.id}/revocar`, {}, teacherA1) },
        { nombre: 'baja de sí mismo', llamar: () => del(`/api/org/miembros/${userIds.teacherA1}`, {}, teacherA1) },
        { nombre: 'moverse a sí mismo', llamar: () => patch(`/api/org/miembros/${userIds.teacherA1}`, { destinoCampusId: campusA1.id }, teacherA1) },
        { nombre: 'promoverse a sí mismo admin', llamar: () => post(`/api/org/organizaciones/${campusA1.id}/admins`, { userId: userIds.teacherA1 }, teacherA1) },
        { nombre: 'degradar al admin real', llamar: () => del(`/api/org/organizaciones/${campusA1.id}/admins/${userIds.adminA1}`, {}, teacherA1) },
        { nombre: 'agregar a la lista blanca', llamar: () => post(`/api/org/organizaciones/${campusA1.id}/lista-blanca`, { email: `plano-${randomUUID()}@afuera.com` }, teacherA1) },
        { nombre: 'leer lista blanca', llamar: () => get(`/api/org/organizaciones/${campusA1.id}/lista-blanca`, teacherA1) },
        { nombre: 'leer miembros', llamar: () => get(`/api/org/organizaciones/${campusA1.id}/miembros`, teacherA1) },
      ];

      for (const intento of intentos) {
        const r = await intento.llamar();
        assert.equal(r.status, 404, `docente plano — "${intento.nombre}" sobre su PROPIA sede debe dar 404 (dio ${r.status})`);
        contarCaso();
      }

      const conteoAdminsDespues = await prisma.organizationAdmin.count({ where: { organizationId: campusA1.id } });
      const conteoListaDespues = await prisma.organizationAllowedEmail.count({ where: { organizationId: campusA1.id } });
      assert.equal(conteoAdminsDespues, conteoAdminsAntes, 'ningún intento del docente plano debe cambiar los admins de A1');
      assert.equal(conteoListaDespues, conteoListaAntes, 'ningún intento del docente plano debe cambiar la lista blanca de A1');
    }
    console.log('✔ 15. docente plano: las 10 mutaciones de /api/org/** sobre su propia sede dan 404, base sin cambios');

    // ───────────────────────────────────────────────────────────
    // 16. Cuenta personal: `elegir-sede` con un id que no corresponde a su
    //     email (no matchea ningún dominio) — 422, nunca se une.
    // ───────────────────────────────────────────────────────────
    {
      const r = await post('/api/org/elegir-sede', { organizationId: campusA1.id }, personal);
      assert.equal(r.status, 422, `cuenta personal eligiendo una sede que no le corresponde debe dar 422 (dio ${r.status})`);
      const fila = await prisma.user.findUnique({ where: { id: userIds.personal }, select: { organizationId: true } });
      assert.equal(fila?.organizationId, null, 'la cuenta personal NO debe unirse a nada');
      contarCaso();

      const rOrg = await get('/org', personal);
      assert.ok([301, 302, 303, 307].includes(rOrg.status), `cuenta personal en /org debe redirigir (dio ${rOrg.status})`);
      assert.ok(ubicacion(rOrg)?.endsWith('/app'), `cuenta personal en /org debe ir a /app (fue a ${ubicacion(rOrg)})`);
      contarCaso();
    }
    console.log('✔ 16. cuenta personal: elegir-sede fuera de su dominio da 422 y nunca la une; /org redirige a /app');

    // ───────────────────────────────────────────────────────────
    // 17. `/api/projects/[id]`: un admin de organización sigue siendo
    //     role DOCENTE para `findProjectForActor` — NUNCA el bypass de
    //     superadmin (M8). PATCH y DELETE sobre el recurso de SU PROPIO
    //     docente (misma sede que administra) dan 404, no 200/403.
    // ───────────────────────────────────────────────────────────
    {
      const proyectoAntes = await prisma.project.findUnique({ where: { id: projA1 }, select: { title: true } });

      const rPatch = await patch(`/api/projects/${projA1}`, { title: 'hackeado' }, adminA1);
      assert.equal(rPatch.status, 404, `adminA1 haciendo PATCH al recurso de teacherA1 debe dar 404 (dio ${rPatch.status})`);
      const proyectoTrasPatch = await prisma.project.findUnique({ where: { id: projA1 }, select: { title: true } });
      assert.equal(proyectoTrasPatch?.title, proyectoAntes?.title, 'el título del recurso NO debe cambiar');
      contarCaso();

      const rThreads = await get(`/api/projects/${projA1}/threads`, adminA1);
      assert.equal(rThreads.status, 404, `adminA1 leyendo los hilos del recurso de teacherA1 debe dar 404 (dio ${rThreads.status})`);
      contarCaso();

      const rDelete = await del(`/api/projects/${projA1}`, {}, adminA1);
      assert.equal(rDelete.status, 404, `adminA1 haciendo DELETE al recurso de teacherA1 debe dar 404 (dio ${rDelete.status})`);
      const sigueExistiendo = await prisma.project.findUnique({ where: { id: projA1 }, select: { id: true } });
      assert.ok(sigueExistiendo, 'el recurso de teacherA1 NO debe borrarse');
      contarCaso();

      // Superadmin sí puede (M8, bypass a propósito) — control positivo para
      // no confundir "nunca 200" con "el filtro de actor.role está roto".
      const rSuper = await get(`/api/projects/${projA1}/threads`, superadmin);
      assert.equal(rSuper.status, 200, `superadmin SÍ puede leer un recurso ajeno (M8) (dio ${rSuper.status})`);
      contarCaso();
    }
    console.log('✔ 17. /api/projects/[id]: un admin de organización NUNCA alcanza el bypass de superadmin (PATCH/DELETE/threads: 404)');

    // ───────────────────────────────────────────────────────────
    // 18. CSRF: un POST cross-origin tipo formulario a una API mutadora de
    //     /api/org/** se rechaza, con o sin sesión válida.
    // ───────────────────────────────────────────────────────────
    {
      const r = await peticion(
        'POST',
        `/api/org/organizaciones/${campusA1.id}/lista-blanca`,
        'email=csrf-hole%40evil.example',
        adminA1,
        { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example.test' },
      );
      assert.equal(r.status, 403, `POST cross-origin tipo formulario a /api/org/** debe dar 403 (dio ${r.status})`);
      contarCaso();

      const conteo = await prisma.organizationAllowedEmail.count({ where: { email: 'csrf-hole@evil.example' } });
      assert.equal(conteo, 0, 'el POST cross-origin NUNCA debe crear la entrada de lista blanca');
    }
    console.log('✔ 18. POST cross-origin tipo formulario a /api/org/** rechazado (403), nunca llega al handler');
  } finally {
    await limpiarEstado();
    await prisma.$disconnect();
  }

  console.log(`\n✔ matriz cubierta: ${descubiertas.length} rutas descubiertas × expectativa, ${totalCasosMatriz} casos de actor/escenario evaluados`);
}

main()
  .then(() => {
    console.log('\n✔ e2e/aislamiento-organizaciones.ts: todos los escenarios pasaron');
  })
  .catch((error) => {
    console.error('\n✖ e2e/aislamiento-organizaciones.ts falló:', error);
    process.exitCode = 1;
  });
