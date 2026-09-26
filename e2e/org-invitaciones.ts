import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { BASE_URL } from './harness.ts';

/**
 * Verificación de T4 (odd/tasks/organizaciones.md): invitaciones y elección
 * de sede. Sin Playwright (fetch + cookie jar manual, mismo criterio que
 * e2e/verificacion-email.ts) — no hace falta un navegador real para pegarle
 * a APIs y leer HTML servido, y en la Raspberry cada browser que no hace
 * falta es RAM que no sobra.
 *
 * No arranca el dev server (a diferencia de verificacion-email.ts): las
 * invitaciones NUNCA exigen `RESEND_API_KEY` (decisión del dueño — "el
 * enlace de invitación nunca exige email verificado"), así que corre igual
 * que org-acceso.ts, contra el dev server que ya esté corriendo.
 *
 * Fixtures (una red con dos sedes hermanas + una organización ajena):
 *
 *   redN
 *   ├── campusA1  (sede administrada por adminCampus y por adminRed)
 *   └── campusA2  (sede HERMANA de A1 — sólo adminRed puede administrarla)
 *
 *   campusAjena  (standalone, sin relación con redN — también la sede
 *                "propia" de adminSinPertenecer, el caso de la fila de
 *                OrganizationAdmin que no cuenta por no pertenecer)
 *
 * Corre con: KODU_BASE_URL=http://localhost:3100 npx tsx e2e/org-invitaciones.ts
 */

const DOCENTE_PASSWORD = 'Docente.Inv.E2E.2026';

const MENSAJE_GENERICO = 'Este enlace ya no sirve, pedile uno nuevo a tu colegio.';

const SUFIJO = randomUUID().slice(0, 8);

const DOMINIO_A1 = `sede-a1-inv-e2e-${SUFIJO}.edu.ar`;
const DOMINIO_AJENA = `ajena-inv-e2e-${SUFIJO}.edu.ar`;
const DOMINIO_RED = `red-inv-e2e-${SUFIJO}.edu.ar`;

const EMAIL_ADMIN_CAMPUS = `admin-campus-inv-e2e@${DOMINIO_A1}`;
const EMAIL_ADMIN_RED = `admin-red-inv-e2e@${DOMINIO_A1}`;
const EMAIL_DOCENTE_PLANO = `docente-plano-inv-e2e@${DOMINIO_A1}`;
const EMAIL_ADMIN_SIN_PERTENECER = `admin-sin-pertenecer-inv-e2e@${DOMINIO_AJENA}`;

const TODOS_LOS_EMAILS_FIJOS = [
  EMAIL_ADMIN_CAMPUS,
  EMAIL_ADMIN_RED,
  EMAIL_DOCENTE_PLANO,
  EMAIL_ADMIN_SIN_PERTENECER,
];

// Emails de aceptación: se generan por escenario para no chocar entre sí.
const emailsDeAceptacion: string[] = [];
function nuevoEmailEnDominio(etiqueta: string, dominio: string): string {
  const email = `${etiqueta}-${randomUUID().slice(0, 8)}@${dominio}`;
  emailsDeAceptacion.push(email);
  return email;
}
function nuevoEmailPersonal(etiqueta: string): string {
  return nuevoEmailEnDominio(etiqueta, 'afuera-inv-e2e.com');
}
function nuevoEmailRed(etiqueta: string): string {
  return nuevoEmailEnDominio(etiqueta, DOMINIO_RED);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const fixtureIds = { red: '', campusA1: '', campusA2: '', campusAjena: '' };

async function crearFixtures(): Promise<void> {
  const red = await prisma.organization.create({ data: { name: `Red Inv E2E ${SUFIJO}`, kind: 'NETWORK' } });
  fixtureIds.red = red.id;
  await prisma.organizationDomain.create({ data: { organizationId: red.id, pattern: DOMINIO_RED } });

  const campusA1 = await prisma.organization.create({
    data: { name: `Sede A1 Inv E2E ${SUFIJO}`, kind: 'CAMPUS', parentId: red.id },
  });
  fixtureIds.campusA1 = campusA1.id;
  await prisma.organizationDomain.create({ data: { organizationId: campusA1.id, pattern: DOMINIO_A1 } });

  const campusA2 = await prisma.organization.create({
    data: { name: `Sede A2 Inv E2E ${SUFIJO}`, kind: 'CAMPUS', parentId: red.id },
  });
  fixtureIds.campusA2 = campusA2.id;

  const campusAjena = await prisma.organization.create({
    data: { name: `Ajena Inv E2E ${SUFIJO}`, kind: 'CAMPUS' },
  });
  fixtureIds.campusAjena = campusAjena.id;
  await prisma.organizationDomain.create({ data: { organizationId: campusAjena.id, pattern: DOMINIO_AJENA } });
}

async function limpiarEstado(): Promise<void> {
  const todosLosEmails = [...TODOS_LOS_EMAILS_FIJOS, ...emailsDeAceptacion];
  const usuarios = await prisma.user.findMany({ where: { email: { in: todosLosEmails } }, select: { id: true } });
  const ids = usuarios.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { in: todosLosEmails } } });

  for (const id of [fixtureIds.campusA1, fixtureIds.campusA2, fixtureIds.campusAjena, fixtureIds.red]) {
    if (id) await prisma.organization.deleteMany({ where: { id } });
  }
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────
// Cliente HTTP minimo con cookie jar manual (mismo criterio que
// e2e/verificacion-email.ts).
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
  const respuesta = await fetch(`${BASE_URL}${path}`, {
    headers: sesion?.cookie ? { Cookie: sesion.cookie } : {},
  });
  if (sesion) guardarCookie(sesion, respuesta);
  return respuesta;
}

async function registrar(email: string): Promise<{ sesion: Sesion; body: any }> {
  const sesion = nuevaSesion();
  const respuesta = await post(
    '/api/auth/register',
    { name: `Docente ${email.split('@')[0]}`, email, password: DOCENTE_PASSWORD },
    sesion,
  );
  assert.equal(respuesta.status, 200, `registro de ${email} debe responder 200 (dio ${respuesta.status})`);
  const body = await respuesta.json();
  return { sesion, body };
}

async function darRolAdmin(userId: string, organizationId: string): Promise<void> {
  await prisma.organizationAdmin.create({ data: { userId, organizationId } });
}

async function main(): Promise<void> {
  await limpiarEstado();
  await crearFixtures();

  // Ventana de la caché de 10s de `organizacionParaEmail` (resolucion.ts) —
  // mismo motivo que org-acceso.ts: los dominios recién creados tienen que
  // verse reflejados antes de registrar contra ellos.
  console.log('… esperando 11s la caché de organizaciones del dev server…');
  await esperar(11_000);

  try {
    // ───────────────────────────────────────────────────────────
    // Setup: admin de campus (A1), admin de red, docente plano (los tres
    // pertenecen a A1 por dominio) y un admin cuya fila de OrganizationAdmin
    // NO cuenta (pertenece a la organización AJENA, no a A1).
    // ───────────────────────────────────────────────────────────
    const { sesion: sesionAdminCampus, body: bodyAdminCampus } = await registrar(EMAIL_ADMIN_CAMPUS);
    assert.equal(bodyAdminCampus.user.organizationId, fixtureIds.campusA1, 'adminCampus debe unirse a A1 por dominio');
    await darRolAdmin(bodyAdminCampus.user.id, fixtureIds.campusA1);

    const { sesion: sesionAdminRed, body: bodyAdminRed } = await registrar(EMAIL_ADMIN_RED);
    assert.equal(bodyAdminRed.user.organizationId, fixtureIds.campusA1, 'adminRed debe unirse a A1 por dominio');
    await darRolAdmin(bodyAdminRed.user.id, fixtureIds.red);

    const { sesion: sesionDocentePlano, body: bodyDocentePlano } = await registrar(EMAIL_DOCENTE_PLANO);
    assert.equal(bodyDocentePlano.user.organizationId, fixtureIds.campusA1, 'docentePlano debe unirse a A1 por dominio');

    const { sesion: sesionAdminSinPertenecer, body: bodyAdminSinPertenecer } = await registrar(
      EMAIL_ADMIN_SIN_PERTENECER,
    );
    assert.equal(
      bodyAdminSinPertenecer.user.organizationId,
      fixtureIds.campusAjena,
      'adminSinPertenecer debe unirse a la organización AJENA por dominio',
    );
    // Fila de OrganizationAdmin sobre A1 — pero esta cuenta pertenece a la
    // AJENA, no a A1: tiene que quedar sin efecto (odd/tasks/organizaciones.md T4).
    await darRolAdmin(bodyAdminSinPertenecer.user.id, fixtureIds.campusA1);

    console.log('✔ setup: admin de campus, admin de red, docente plano y admin-sin-pertenecer listos');

    // ───────────────────────────────────────────────────────────
    // 1. Campus admin de A1 NO puede crear/listar invitaciones para la sede
    //    HERMANA A2 ni para la organización AJENA (404).
    // ───────────────────────────────────────────────────────────
    {
      const crearParaA2 = await post('/api/org/invitaciones', { organizationId: fixtureIds.campusA2 }, sesionAdminCampus);
      assert.equal(crearParaA2.status, 404, `admin de A1 creando para A2 (hermana) debe dar 404 (dio ${crearParaA2.status})`);

      const listarA2 = await get(`/api/org/invitaciones?organizationId=${fixtureIds.campusA2}`, sesionAdminCampus);
      assert.equal(listarA2.status, 404, `admin de A1 listando A2 (hermana) debe dar 404 (dio ${listarA2.status})`);

      const crearParaAjena = await post(
        '/api/org/invitaciones',
        { organizationId: fixtureIds.campusAjena },
        sesionAdminCampus,
      );
      assert.equal(
        crearParaAjena.status,
        404,
        `admin de A1 creando para la organización ajena debe dar 404 (dio ${crearParaAjena.status})`,
      );
      console.log('✔ 1. admin de campus (A1) no administra la sede hermana A2 ni la organización ajena');
    }

    // ───────────────────────────────────────────────────────────
    // 2. Un docente plano (sin ninguna fila de OrganizationAdmin) no puede
    //    crear invitaciones (403/404).
    // ───────────────────────────────────────────────────────────
    {
      const respuesta = await post('/api/org/invitaciones', { organizationId: fixtureIds.campusA1 }, sesionDocentePlano);
      assert.ok(
        respuesta.status === 403 || respuesta.status === 404,
        `un docente plano debe recibir 403/404 (dio ${respuesta.status})`,
      );
      console.log('✔ 2. un docente plano (sin fila de OrganizationAdmin) no puede crear invitaciones');
    }

    // ───────────────────────────────────────────────────────────
    // 3. Una fila de OrganizationAdmin sobre A1 de alguien que NO pertenece
    //    a A1 (pertenece a la organización ajena) no otorga nada.
    // ───────────────────────────────────────────────────────────
    {
      const respuesta = await post(
        '/api/org/invitaciones',
        { organizationId: fixtureIds.campusA1 },
        sesionAdminSinPertenecer,
      );
      assert.equal(
        respuesta.status,
        404,
        `una fila de OrganizationAdmin de quien no pertenece a esa sede no debe otorgar nada (dio ${respuesta.status})`,
      );
      console.log('✔ 3. una fila de OrganizationAdmin de quien no pertenece a esa sede no otorga nada');
    }

    // ───────────────────────────────────────────────────────────
    // 4. El admin de la RED sí puede crear/listar/revocar invitaciones para
    //    CUALQUIERA de sus sedes (A1 y A2, hermanas entre sí).
    // ───────────────────────────────────────────────────────────
    let tokenInvitacionA1 = '';
    let idInvitacionA1 = '';
    {
      const crearA1 = await post('/api/org/invitaciones', { organizationId: fixtureIds.campusA1 }, sesionAdminRed);
      assert.equal(crearA1.status, 200, `admin de red creando para A1 debe dar 200 (dio ${crearA1.status})`);
      const cuerpoA1 = await crearA1.json();
      assert.ok(cuerpoA1.url.includes('/invitacion/'), 'la url de invitación debe apuntar a /invitacion/<token>');
      tokenInvitacionA1 = cuerpoA1.url.split('/invitacion/')[1];
      idInvitacionA1 = cuerpoA1.invitacion.id;
      assert.equal(cuerpoA1.invitacion.estado, 'activa', 'una invitación recién creada debe estar activa');

      const crearA2 = await post('/api/org/invitaciones', { organizationId: fixtureIds.campusA2 }, sesionAdminRed);
      assert.equal(crearA2.status, 200, `admin de red creando para A2 debe dar 200 (dio ${crearA2.status})`);

      const listarA1 = await get(`/api/org/invitaciones?organizationId=${fixtureIds.campusA1}`, sesionAdminRed);
      assert.equal(listarA1.status, 200, 'admin de red debe poder listar A1');
      const cuerpoListarA1 = await listarA1.json();
      assert.ok(
        cuerpoListarA1.invitaciones.some((i: any) => i.id === idInvitacionA1),
        'el listado de A1 debe incluir la invitación recién creada',
      );

      const revocarA2 = await post(
        `/api/org/invitaciones/${(await crearA2.json()).invitacion.id}/revocar`,
        {},
        sesionAdminRed,
      );
      assert.equal(revocarA2.status, 200, `admin de red revocando A2 debe dar 200 (dio ${revocarA2.status})`);
      console.log('✔ 4. el admin de la red crea/lista/revoca invitaciones para cualquiera de sus sedes');
    }

    // ───────────────────────────────────────────────────────────
    // 5. El admin de A1 SÍ puede revocar una invitación DE A1 — pero nunca
    //    confiando en un organizationId ajeno en el body (revocar.ts carga
    //    la invitación real y autoriza contra ESA organización).
    // ───────────────────────────────────────────────────────────
    {
      const crear = await post('/api/org/invitaciones', { organizationId: fixtureIds.campusA1 }, sesionAdminCampus);
      assert.equal(crear.status, 200, 'admin de A1 debe poder crear una invitación para su propia sede');
      const { invitacion } = await crear.json();

      const revocarAjeno = await post(`/api/org/invitaciones/${invitacion.id}/revocar`, {}, sesionAdminSinPertenecer);
      assert.equal(
        revocarAjeno.status,
        404,
        `quien no administra A1 no debe poder revocar su invitación (dio ${revocarAjeno.status})`,
      );

      const revocar = await post(`/api/org/invitaciones/${invitacion.id}/revocar`, {}, sesionAdminCampus);
      assert.equal(revocar.status, 200, 'admin de A1 debe poder revocar su propia invitación');

      const listar = await get(`/api/org/invitaciones?organizationId=${fixtureIds.campusA1}`, sesionAdminCampus);
      const { invitaciones } = await listar.json();
      const revocada = invitaciones.find((i: any) => i.id === invitacion.id);
      assert.equal(revocada.estado, 'revocada', 'tras revocar, el listado debe mostrar estado "revocada"');
      console.log('✔ 5. el admin de A1 revoca su propia invitación; un tercero no puede');
    }

    // ═══════════════════════════════════════════════════════════
    // Aceptación de invitaciones
    // ═══════════════════════════════════════════════════════════

    // ───────────────────────────────────────────────────────────
    // 6. Un usuario nuevo (personal) acepta la invitación de A1 → se une.
    // ───────────────────────────────────────────────────────────
    {
      const { sesion, body } = await registrar(nuevoEmailPersonal('acepta-a1'));
      assert.equal(body.user.organizationId, null, 'debe registrarse como cuenta personal');

      const aceptar = await post('/api/invitaciones/aceptar', { token: tokenInvitacionA1 }, sesion);
      assert.equal(aceptar.status, 200, `aceptar una invitación válida debe dar 200 (dio ${aceptar.status})`);

      const usuario = await prisma.user.findUniqueOrThrow({ where: { id: body.user.id }, select: { organizationId: true } });
      assert.equal(usuario.organizationId, fixtureIds.campusA1, 'debe unirse a A1 al aceptar la invitación');

      const invitacion = await prisma.organizationInvite.findUniqueOrThrow({ where: { id: idInvitacionA1 } });
      assert.equal(invitacion.uses, 1, 'aceptar debe incrementar "uses" a 1');
      console.log('✔ 6. un usuario nuevo (personal) acepta la invitación de A1 y se une');
    }

    // ───────────────────────────────────────────────────────────
    // 7. maxUses = 1: el segundo usuario recibe el error genérico y queda
    //    personal; "uses" no pasa de 1.
    // ───────────────────────────────────────────────────────────
    let tokenMaxUsesUno = '';
    let idInvitacionMaxUsesUno = '';
    {
      const crear = await post(
        '/api/org/invitaciones',
        { organizationId: fixtureIds.campusA1, maxUses: 1 },
        sesionAdminCampus,
      );
      assert.equal(crear.status, 200, 'crear una invitación con maxUses=1 debe dar 200');
      const { url, invitacion } = await crear.json();
      tokenMaxUsesUno = url.split('/invitacion/')[1];
      idInvitacionMaxUsesUno = invitacion.id;

      const { sesion: sesionPrimero } = await registrar(nuevoEmailPersonal('maxuses-primero'));
      const primero = await post('/api/invitaciones/aceptar', { token: tokenMaxUsesUno }, sesionPrimero);
      assert.equal(primero.status, 200, 'el primer aceptador de maxUses=1 debe entrar');

      const { sesion: sesionSegundo, body: bodySegundo } = await registrar(nuevoEmailPersonal('maxuses-segundo'));
      const segundo = await post('/api/invitaciones/aceptar', { token: tokenMaxUsesUno }, sesionSegundo);
      assert.equal(segundo.status, 410, `el segundo aceptador de maxUses=1 debe recibir el error genérico (dio ${segundo.status})`);
      const cuerpoSegundo = await segundo.json();
      assert.equal(cuerpoSegundo.error, MENSAJE_GENERICO, 'el mensaje debe ser el literal genérico del spec');

      const usuarioSegundo = await prisma.user.findUniqueOrThrow({
        where: { id: bodySegundo.user.id },
        select: { organizationId: true },
      });
      assert.equal(usuarioSegundo.organizationId, null, 'el segundo aceptador debe quedar personal');

      const invitacionFinal = await prisma.organizationInvite.findUniqueOrThrow({ where: { id: idInvitacionMaxUsesUno } });
      assert.equal(invitacionFinal.uses, 1, 'un cupo de 1 nunca debe pasar de "uses"=1');
      console.log('✔ 7. maxUses=1: el segundo aceptador recibe el error genérico y "uses" no pasa de 1');
    }

    // ───────────────────────────────────────────────────────────
    // 8. Un token vencido da el error genérico.
    // ───────────────────────────────────────────────────────────
    {
      const crear = await post(
        '/api/org/invitaciones',
        { organizationId: fixtureIds.campusA1, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() },
        sesionAdminCampus,
      );
      assert.equal(crear.status, 200, 'crear con un vencimiento futuro debe dar 200');
      const { url, invitacion } = await crear.json();
      const token = url.split('/invitacion/')[1];

      await prisma.organizationInvite.update({
        where: { id: invitacion.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      const { sesion } = await registrar(nuevoEmailPersonal('vencida'));
      const respuesta = await post('/api/invitaciones/aceptar', { token }, sesion);
      assert.equal(respuesta.status, 410, `un token vencido debe dar el error genérico (dio ${respuesta.status})`);
      const cuerpo = await respuesta.json();
      assert.equal(cuerpo.error, MENSAJE_GENERICO, 'el mensaje debe ser el literal genérico del spec');
      console.log('✔ 8. un token vencido da el error genérico');
    }

    // ───────────────────────────────────────────────────────────
    // 9. Una invitación revocada da el error genérico.
    // ───────────────────────────────────────────────────────────
    {
      const crear = await post('/api/org/invitaciones', { organizationId: fixtureIds.campusA1 }, sesionAdminCampus);
      const { url, invitacion } = await crear.json();
      const token = url.split('/invitacion/')[1];

      const revocar = await post(`/api/org/invitaciones/${invitacion.id}/revocar`, {}, sesionAdminCampus);
      assert.equal(revocar.status, 200, 'revocar debe dar 200');

      const { sesion } = await registrar(nuevoEmailPersonal('revocada'));
      const respuesta = await post('/api/invitaciones/aceptar', { token }, sesion);
      assert.equal(respuesta.status, 410, `una invitación revocada debe dar el error genérico (dio ${respuesta.status})`);
      const cuerpo = await respuesta.json();
      assert.equal(cuerpo.error, MENSAJE_GENERICO, 'el mensaje debe ser el literal genérico del spec');
      console.log('✔ 9. una invitación revocada da el error genérico');
    }

    // ───────────────────────────────────────────────────────────
    // 10. Un usuario que ya pertenece a la sede AJENA (campus B) no puede
    //     aceptar la invitación de A1; la invitación no se consume.
    // ───────────────────────────────────────────────────────────
    {
      const crear = await post('/api/org/invitaciones', { organizationId: fixtureIds.campusA1 }, sesionAdminCampus);
      const { url, invitacion } = await crear.json();
      const token = url.split('/invitacion/')[1];

      // Ya pertenece a la organización AJENA (por dominio, al registrarse).
      const { sesion } = await registrar(nuevoEmailEnDominio('ya-en-otra', DOMINIO_AJENA));
      const respuesta = await post('/api/invitaciones/aceptar', { token }, sesion);
      assert.equal(
        respuesta.status,
        409,
        `un usuario ya en otra organización no debe poder aceptar (dio ${respuesta.status})`,
      );
      const cuerpo = await respuesta.json();
      assert.equal(cuerpo.motivo, 'ya_en_otra_organizacion', 'el motivo debe ser "ya_en_otra_organizacion"');

      const invitacionFinal = await prisma.organizationInvite.findUniqueOrThrow({ where: { id: invitacion.id } });
      assert.equal(invitacionFinal.uses, 0, 'la invitación NO debe consumirse por un intento rechazado');
      console.log('✔ 10. un usuario ya en otra organización no puede aceptar; la invitación no se consume');
    }

    // ───────────────────────────────────────────────────────────
    // 11. La página pública, sin sesión, muestra el nombre de la sede y el
    //     enlace de registro con "next"; "next=//evil.com" y
    //     "next=https://evil.com" se ignoran.
    // ───────────────────────────────────────────────────────────
    {
      const crear = await post('/api/org/invitaciones', { organizationId: fixtureIds.campusA1 }, sesionAdminCampus);
      const { url } = await crear.json();
      const token = url.split('/invitacion/')[1];

      const pagina = await get(`/invitacion/${token}`);
      assert.equal(pagina.status, 200, 'la página pública de una invitación válida debe dar 200');
      const html = await pagina.text();
      assert.ok(html.includes('Sede A1 Inv E2E'), `la página debe mostrar el nombre de la sede (vio: ${html.slice(0, 300)})`);
      assert.ok(html.includes('Red Inv E2E'), 'la página debe mostrar el nombre de la red');
      const nextEsperado = `next=${encodeURIComponent(`/invitacion/${token}`)}`;
      assert.ok(html.includes(`/register?${nextEsperado}`), 'debe traer el enlace de registro con "next"');
      assert.ok(html.includes(`/login?${nextEsperado}`), 'debe traer el enlace de login con "next"');

      const paginaMalNext1 = await get(`/register?next=${encodeURIComponent('//evil.com')}`);
      const htmlMalNext1 = await paginaMalNext1.text();
      assert.ok(!htmlMalNext1.includes('evil.com'), '"next=//evil.com" debe ignorarse (nunca debe aparecer en la página)');

      const paginaMalNext2 = await get(`/register?next=${encodeURIComponent('https://evil.com')}`);
      const htmlMalNext2 = await paginaMalNext2.text();
      assert.ok(!htmlMalNext2.includes('evil.com'), '"next=https://evil.com" debe ignorarse (nunca debe aparecer en la página)');

      // El navegador normaliza "\" a "/": "/\evil.com" termina siendo "//evil.com".
      for (const bypass of ['/\\evil.com', '/\t/evil.com']) {
        const pagina = await get(`/login?next=${encodeURIComponent(bypass)}`);
        const html = await pagina.text();
        assert.ok(!html.includes('evil.com'), `"next=${JSON.stringify(bypass)}" debe ignorarse en /login`);
      }
      console.log('✔ 11. la página pública muestra la sede/red y el enlace con "next"; los next ajenos se ignoran');
    }

    // ───────────────────────────────────────────────────────────
    // 12. Registrarse a través del "next" de una invitación y después
    //     aceptarla funciona (el "next" es sólo del lado del cliente: el
    //     registro no lo necesita, y la sesión ya alcanza para aceptar).
    // ───────────────────────────────────────────────────────────
    {
      const crear = await post('/api/org/invitaciones', { organizationId: fixtureIds.campusA1 }, sesionAdminCampus);
      const { url, invitacion } = await crear.json();
      const token = url.split('/invitacion/')[1];

      const email = nuevoEmailPersonal('via-next');
      const sesion = nuevaSesion();
      const respuestaRegistro = await post(
        `/api/auth/register`, // el "next" vive en la URL de la página, no en este endpoint
        { name: 'Docente Via Next', email, password: DOCENTE_PASSWORD },
        sesion,
      );
      assert.equal(respuestaRegistro.status, 200, 'registrarse (llegando desde el link con next) debe dar 200');

      const paginaLogueado = await get(`/invitacion/${token}`, sesion);
      const htmlLogueado = await paginaLogueado.text();
      assert.ok(htmlLogueado.includes(`Unirme a Sede A1`), 'con sesión y sin organización, debe ofrecer el botón de unirse');

      const aceptar = await post('/api/invitaciones/aceptar', { token }, sesion);
      assert.equal(aceptar.status, 200, 'aceptar tras registrarse vía el link con next debe dar 200');
      console.log('✔ 12. registrarse vía el link con "next" y después aceptar la invitación funciona');
    }

    // ═══════════════════════════════════════════════════════════
    // Selector de sede (picker) — dominio de la RED
    // ═══════════════════════════════════════════════════════════

    // ───────────────────────────────────────────────────────────
    // 13. Un email de la red elige A1 (una sede de SU red) → se une.
    // ───────────────────────────────────────────────────────────
    {
      const { sesion, body } = await registrar(nuevoEmailRed('picker-a1'));
      assert.equal(body.user.organizationId, null, 'un dominio de red no une sola a ninguna sede (T2, sigue valiendo en T4)');

      const respuesta = await post('/api/org/elegir-sede', { organizationId: fixtureIds.campusA1 }, sesion);
      assert.equal(respuesta.status, 200, `elegir una sede de la propia red debe dar 200 (dio ${respuesta.status})`);

      const usuario = await prisma.user.findUniqueOrThrow({ where: { id: body.user.id }, select: { organizationId: true } });
      assert.equal(usuario.organizationId, fixtureIds.campusA1, 'debe unirse a la sede elegida');
      console.log('✔ 13. un email de la red elige una sede de SU red y se une');
    }

    // ───────────────────────────────────────────────────────────
    // 14. Elegir una sede de OTRA red (o sin red) se rechaza.
    // ───────────────────────────────────────────────────────────
    {
      const { sesion, body } = await registrar(nuevoEmailRed('picker-otra-red'));
      assert.equal(body.user.organizationId, null, 'debe quedar personal, pendiente de elegir');

      const respuesta = await post('/api/org/elegir-sede', { organizationId: fixtureIds.campusAjena }, sesion);
      assert.equal(
        respuesta.status,
        422,
        `elegir una sede que no pertenece a la propia red debe rechazarse (dio ${respuesta.status})`,
      );

      const usuario = await prisma.user.findUniqueOrThrow({ where: { id: body.user.id }, select: { organizationId: true } });
      assert.equal(usuario.organizationId, null, 'no debe haberse unido a nada');
      console.log('✔ 14. elegir una sede de otra red se rechaza; la cuenta sigue personal');
    }

    // ───────────────────────────────────────────────────────────
    // 15. Elegir una sede cuando la cuenta YA pertenece a una organización
    //     se rechaza (un docente pertenece a UNA sola — decisión del dueño).
    // ───────────────────────────────────────────────────────────
    {
      const respuesta = await post('/api/org/elegir-sede', { organizationId: fixtureIds.campusA2 }, sesionAdminCampus);
      assert.equal(
        respuesta.status,
        409,
        `elegir una sede ya perteneciendo a una organización debe rechazarse (dio ${respuesta.status})`,
      );
      console.log('✔ 15. elegir sede con una organización ya asignada se rechaza');
    }

    // ═══════════════════════════════════════════════════════════
    // 16. Concurrencia: dos aceptaciones en paralelo de un cupo maxUses=1 —
    //     exactamente una se une.
    // ═══════════════════════════════════════════════════════════
    {
      const crear = await post(
        '/api/org/invitaciones',
        { organizationId: fixtureIds.campusA1, maxUses: 1 },
        sesionAdminCampus,
      );
      const { url, invitacion } = await crear.json();
      const token = url.split('/invitacion/')[1];

      const { sesion: sesionUno, body: bodyUno } = await registrar(nuevoEmailPersonal('concurrencia-uno'));
      const { sesion: sesionDos, body: bodyDos } = await registrar(nuevoEmailPersonal('concurrencia-dos'));

      const [respuestaUno, respuestaDos] = await Promise.all([
        post('/api/invitaciones/aceptar', { token }, sesionUno),
        post('/api/invitaciones/aceptar', { token }, sesionDos),
      ]);

      const estados = [respuestaUno.status, respuestaDos.status].sort();
      assert.deepEqual(estados, [200, 410], `de dos aceptaciones concurrentes, una debe ganar y la otra perder (dio ${estados})`);

      const invitacionFinal = await prisma.organizationInvite.findUniqueOrThrow({ where: { id: invitacion.id } });
      assert.equal(invitacionFinal.uses, 1, 'exactamente una aceptación concurrente debe contar');

      const [usuarioUno, usuarioDos] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: bodyUno.user.id }, select: { organizationId: true } }),
        prisma.user.findUniqueOrThrow({ where: { id: bodyDos.user.id }, select: { organizationId: true } }),
      ]);
      const organizacionesFinales = [usuarioUno.organizationId, usuarioDos.organizationId];
      const cuantosSeUnieron = organizacionesFinales.filter((id) => id === fixtureIds.campusA1).length;
      assert.equal(cuantosSeUnieron, 1, 'exactamente uno de los dos usuarios debe haberse unido');
      console.log('✔ 16. dos aceptaciones concurrentes de un cupo de 1: exactamente una gana');
    }

    console.log('\n✔ e2e/org-invitaciones.ts: todos los escenarios pasaron');
  } finally {
    await limpiarEstado();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\n✖ e2e/org-invitaciones.ts falló:', error);
  process.exitCode = 1;
});
