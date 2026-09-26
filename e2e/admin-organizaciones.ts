import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { abrirNavegador, BASE_URL, conTema } from './harness.ts';
import { degradarAdmin, GestionError } from '../src/lib/orgs/gestion.ts';
import type { Frame, Page } from 'playwright';

/**
 * Verificación de T6 (odd/tasks/organizaciones.md): superadmin —
 * organizaciones. La mayor parte corre a nivel API (fetch a través de
 * `page.request`, mismo cookie jar que la sesión del navegador — como
 * `org-acceso.ts`, no como el fetch manual de `org-invitaciones.ts`); el
 * final abre `/admin/organizaciones` y un detalle en el navegador para las
 * capturas.
 *
 * Historias de fixture (para no repetir setup por cada aserción):
 *
 *  RED (con dominio compartido)
 *  ├── campusA (dominio propio DOMINIO_A)
 *  └── campusB (sin dominio propio — se une por lista blanca)
 *  standalone (colegio suelto, para probar unicidad de dominio)
 *
 *  "Storyline A" (campusA, dominio): personalA se une por dominio al
 *  agregarlo, se lo da de baja (exclusión), NO vuelve a entrar por ese mismo
 *  dominio, y vuelve a entrar cuando se lo re-agrega a la lista blanca (que
 *  además borra la exclusión).
 *
 *  "Storyline B" (campusB, lista blanca + admin + mover): personalB se une
 *  por lista blanca, crea un recurso, es promovido y degradado admin, se
 *  mueve a campusA con un TokenUsage histórico ya congelado en campusB, y
 *  se lo da de baja desde campusA — proyecto y TokenUsage viejo intactos.
 *
 * Corre con: KODU_BASE_URL=http://localhost:3100 npx tsx e2e/admin-organizaciones.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const PASSWORD = 'Docente.OrgsAdmin.E2E.2026';

const SUFIJO = randomUUID().slice(0, 8);
const DOMINIO_A = `campus-a-orgsadmin-e2e-${SUFIJO}.edu.ar`;

const EMAIL_PERSONAL_A = `personal-a-orgsadmin-e2e@${DOMINIO_A}`;
const EMAIL_PERSONAL_B = `personal-b-orgsadmin-e2e-${SUFIJO}@afuera-orgsadmin-e2e.com`;
const EMAIL_ORG_ADMIN_DOCENTE = `org-admin-docente-orgsadmin-e2e@${DOMINIO_A}`;
const EMAIL_DOCENTE_PLANO = `docente-plano-orgsadmin-e2e@${DOMINIO_A}`;
const EMAIL_ARCHIVAR = `archivar-orgsadmin-e2e@${DOMINIO_A}`;

const TODOS_LOS_EMAILS = [
  EMAIL_PERSONAL_A,
  EMAIL_PERSONAL_B,
  EMAIL_ORG_ADMIN_DOCENTE,
  EMAIL_DOCENTE_PLANO,
  EMAIL_ARCHIVAR,
];

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const orgIds = { red: '', campusA: '', campusB: '', standalone: '' };
const emailsDeRed: string[] = [];

async function limpiarEstado(): Promise<void> {
  const todosLosEmails = [...TODOS_LOS_EMAILS, ...emailsDeRed];
  const usuarios = await prisma.user.findMany({ where: { email: { in: todosLosEmails } }, select: { id: true } });
  const ids = usuarios.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.tokenUsage.deleteMany({ where: { userId: { in: ids } } });
    await prisma.chatMessage.deleteMany({ where: { thread: { project: { userId: { in: ids } } } } });
    await prisma.chatThread.deleteMany({ where: { project: { userId: { in: ids } } } });
    await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { in: todosLosEmails } } });

  // Las organizaciones se crean por la API en el propio escenario 1; acá sólo
  // queda limpiar lo que haya sobrevivido de una corrida anterior interrumpida.
  await prisma.organization.deleteMany({ where: { name: { contains: SUFIJO } } });
}

// ─────────────────────────────────────────────────────────────
// Helpers HTTP (comparten cookie jar con `page`/`page.request`, como
// org-acceso.ts) y helpers de fixture.
// ─────────────────────────────────────────────────────────────

async function registrar(page: Page, email: string): Promise<{ id: string; organizationId: string | null }> {
  const respuesta = await page.request.post(`${BASE_URL}/api/auth/register`, {
    data: { name: `Docente ${email.split('@')[0]}`, email, password: PASSWORD },
  });
  assert.equal(respuesta.status(), 200, `registro de ${email} debe dar 200 (dio ${respuesta.status()})`);
  const body = (await respuesta.json()) as { user: { id: string; organizationId: string | null } };
  return body.user;
}

async function login(page: Page, email: string): Promise<{ id: string; organizationId: string | null }> {
  const respuesta = await page.request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password: PASSWORD },
  });
  assert.equal(respuesta.status(), 200, `login de ${email} debe dar 200 (dio ${respuesta.status()})`);
  const body = (await respuesta.json()) as { user: { id: string; organizationId: string | null } };
  return body.user;
}

async function crearOrganizacion(
  page: Page,
  datos: { name: string; kind: 'CAMPUS' | 'NETWORK'; parentId?: string | null },
): Promise<{ id: string; kind: string; parentId: string | null }> {
  const respuesta = await page.request.post(`${BASE_URL}/api/admin/organizaciones`, { data: datos });
  assert.equal(respuesta.status(), 200, `crear "${datos.name}" debe dar 200 (dio ${respuesta.status()})`);
  const body = (await respuesta.json()) as { organizacion: { id: string; kind: string; parentId: string | null } };
  return body.organizacion;
}

async function main(): Promise<void> {
  await limpiarEstado();

  const browser = await abrirNavegador();

  // Un contexto (= cookie jar) POR IDENTIDAD: `page.request` comparte cookies
  // con `page` DENTRO de un mismo contexto, así que reusar el contexto del
  // superadmin para registrar a un docente pisaría su cookie de sesión con
  // la del docente recién registrado — cada actor necesita el suyo.
  const superadminCtx = await browser.newContext();
  const superadmin = await superadminCtx.newPage();
  const loginSuperadmin = await superadmin.request.post(`${BASE_URL}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  assert.equal(loginSuperadmin.status(), 200, `login del superadmin debe dar 200 (dio ${loginSuperadmin.status()})`);

  const aPage = await (await browser.newContext()).newPage();
  const bPage = await (await browser.newContext()).newPage();
  const redPickerPage = await (await browser.newContext()).newPage();
  const archPage = await (await browser.newContext()).newPage();
  const planoPage = await (await browser.newContext()).newPage();
  const orgAdminPage = await (await browser.newContext()).newPage();

  try {
    // ───────────────────────────────────────────────────────────
    // 1. El superadmin crea una red con dos sedes y un colegio standalone.
    // ───────────────────────────────────────────────────────────
    const red = await crearOrganizacion(superadmin, { name: `Red OrgsAdmin E2E ${SUFIJO}`, kind: 'NETWORK' });
    orgIds.red = red.id;
    const campusA = await crearOrganizacion(superadmin, {
      name: `Campus A OrgsAdmin E2E ${SUFIJO}`,
      kind: 'CAMPUS',
      parentId: red.id,
    });
    orgIds.campusA = campusA.id;
    const campusB = await crearOrganizacion(superadmin, {
      name: `Campus B OrgsAdmin E2E ${SUFIJO}`,
      kind: 'CAMPUS',
      parentId: red.id,
    });
    orgIds.campusB = campusB.id;
    const standalone = await crearOrganizacion(superadmin, {
      name: `Standalone OrgsAdmin E2E ${SUFIJO}`,
      kind: 'CAMPUS',
    });
    orgIds.standalone = standalone.id;
    assert.equal(campusA.parentId, red.id, 'campusA debe colgar de la red');
    assert.equal(campusB.parentId, red.id, 'campusB debe colgar de la red');
    assert.equal(standalone.parentId, null, 'el standalone no debe tener red');
    console.log('✔ 1. red con dos sedes + colegio standalone creados');

    // ───────────────────────────────────────────────────────────
    // 2. Registrar personalA ANTES de que exista el dominio de campusA:
    //    tiene que quedar personal (nadie reclama ese dominio todavía).
    // ───────────────────────────────────────────────────────────
    const personalA = await registrar(aPage, EMAIL_PERSONAL_A);
    assert.equal(personalA.organizationId, null, 'personalA debe quedar personal antes de que exista el dominio');

    // Agregar el dominio de campusA une de inmediato a personalA (decisión de T6).
    const respuestaDominioA = await superadmin.request.post(
      `${BASE_URL}/api/admin/organizaciones/${campusA.id}/dominios`,
      { data: { pattern: DOMINIO_A } },
    );
    assert.equal(respuestaDominioA.status(), 200, `agregar el dominio de A debe dar 200 (dio ${respuestaDominioA.status()})`);
    const personalATrasDominio = await prisma.user.findUnique({ where: { id: personalA.id }, select: { organizationId: true } });
    assert.equal(
      personalATrasDominio?.organizationId,
      campusA.id,
      'agregar un dominio de campus debe unir de inmediato a la cuenta personal que ya matcheaba',
    );
    console.log('✔ 2. agregar un dominio de campus une de inmediato a la cuenta personal existente');

    // ───────────────────────────────────────────────────────────
    // 3. Dominio de la RED: una registración nueva queda personal (picker).
    // ───────────────────────────────────────────────────────────
    const DOMINIO_RED = `red-orgsadmin-e2e-${SUFIJO}.edu.ar`;
    const respuestaDominioRed = await superadmin.request.post(
      `${BASE_URL}/api/admin/organizaciones/${red.id}/dominios`,
      { data: { pattern: DOMINIO_RED } },
    );
    assert.equal(respuestaDominioRed.status(), 200, `agregar el dominio de la red debe dar 200 (dio ${respuestaDominioRed.status()})`);

    const emailRedNuevo = `nuevo-en-red-orgsadmin-e2e-${SUFIJO}@${DOMINIO_RED}`;
    emailsDeRed.push(emailRedNuevo);
    const nuevoEnRed = await registrar(redPickerPage, emailRedNuevo);
    assert.equal(
      nuevoEnRed.organizationId,
      null,
      'un dominio de RED no une a nadie solo: una registración nueva queda personal (picker)',
    );
    console.log('✔ 3. un dominio de red deja personal a una registración nueva (picker, no auto-join)');

    // ───────────────────────────────────────────────────────────
    // 4. Unicidad de dominio (409) y patrón inválido.
    // ───────────────────────────────────────────────────────────
    const respuestaDuplicado = await superadmin.request.post(
      `${BASE_URL}/api/admin/organizaciones/${standalone.id}/dominios`,
      { data: { pattern: DOMINIO_A } },
    );
    assert.equal(respuestaDuplicado.status(), 409, `dominio duplicado debe dar 409 (dio ${respuestaDuplicado.status()})`);
    console.log('✔ 4a. un dominio ya usado por otra organización da 409');

    const respuestaInvalida = await superadmin.request.post(
      `${BASE_URL}/api/admin/organizaciones/${standalone.id}/dominios`,
      { data: { pattern: 'no es un dominio!!' } },
    );
    // El repo usa 422 para TODA falla de validación (zod y GestionError, ver
    // providers/index.ts, users/[id].ts) — se asume esa misma convención acá
    // en vez del "400" textual del reparto de la tarea, para no introducir
    // una única ruta con un código de error distinto al resto del panel.
    assert.equal(respuestaInvalida.status(), 422, `patrón inválido debe rechazarse (dio ${respuestaInvalida.status()})`);
    console.log('✔ 4b. un patrón de dominio inválido se rechaza (422, convención del repo)');

    // ───────────────────────────────────────────────────────────
    // 5. Lista blanca: une de inmediato a una cuenta personal existente.
    // ───────────────────────────────────────────────────────────
    const personalB = await registrar(bPage, EMAIL_PERSONAL_B);
    assert.equal(personalB.organizationId, null, 'personalB debe quedar personal (dominio ajeno a todo)');

    const respuestaWhitelist = await superadmin.request.post(
      `${BASE_URL}/api/admin/organizaciones/${campusB.id}/lista-blanca`,
      { data: { email: EMAIL_PERSONAL_B } },
    );
    assert.equal(respuestaWhitelist.status(), 200, `agregar a la lista blanca debe dar 200 (dio ${respuestaWhitelist.status()})`);
    const personalBTrasWhitelist = await prisma.user.findUnique({ where: { id: personalB.id }, select: { organizationId: true } });
    assert.equal(personalBTrasWhitelist?.organizationId, campusB.id, 'agregar a la lista blanca debe unir de inmediato');
    console.log('✔ 5. agregar un email a la lista blanca une de inmediato a la cuenta personal existente');

    // ───────────────────────────────────────────────────────────
    // 6. Storyline B: recurso, promover/degradar admin, mover de sede
    //    conservando el TokenUsage viejo, y baja final (purga TODAS sus
    //    filas de OrganizationAdmin, incluida una de una sede de la que ya
    //    se había ido).
    // ───────────────────────────────────────────────────────────
    const respuestaProyecto = await bPage.request.post(`${BASE_URL}/api/projects`, { data: { title: 'Recurso Storyline B' } });
    assert.equal(respuestaProyecto.status(), 200, `personalB debe poder crear un recurso (dio ${respuestaProyecto.status()})`);
    const { project } = (await respuestaProyecto.json()) as { project: { id: string } };

    const respuestaPromoverB = await superadmin.request.post(`${BASE_URL}/api/admin/organizaciones/${campusB.id}/admins`, {
      data: { userId: personalB.id },
    });
    assert.equal(respuestaPromoverB.status(), 200, `promover a personalB debe dar 200 (dio ${respuestaPromoverB.status()})`);
    let filaAdminB = await prisma.organizationAdmin.findUnique({
      where: { userId_organizationId: { userId: personalB.id, organizationId: campusB.id } },
    });
    assert.ok(filaAdminB, 'promover debe crear la fila de OrganizationAdmin');

    // `data: {}` fuerza un Content-Type: application/json (isFormLike=false
    // en csrf.ts) — un DELETE sin cuerpo no manda Content-Type y cae en la
    // rama que exige un Origin same-origin, que `page.request` no manda solo.
    const respuestaDegradarB = await superadmin.request.delete(
      `${BASE_URL}/api/admin/organizaciones/${campusB.id}/admins/${personalB.id}`,
      { data: {} },
    );
    assert.equal(respuestaDegradarB.status(), 200, `degradar a personalB debe dar 200 (dio ${respuestaDegradarB.status()})`);
    filaAdminB = await prisma.organizationAdmin.findUnique({
      where: { userId_organizationId: { userId: personalB.id, organizationId: campusB.id } },
    });
    assert.equal(filaAdminB, null, 'degradar debe borrar la fila de OrganizationAdmin');
    console.log('✔ 6a. promover y degradar admin (fila de OrganizationAdmin creada y borrada)');

    // Se lo vuelve a promover en campusB (va a quedar COLGADA cuando se
    // mueva a campusA — sirve para probar que la baja final purga TODAS sus
    // filas, no sólo la de su sede actual).
    await superadmin.request.post(`${BASE_URL}/api/admin/organizaciones/${campusB.id}/admins`, { data: { userId: personalB.id } });

    const tokenUsageViejo = await prisma.tokenUsage.create({
      data: { userId: personalB.id, model: 'e2e-storyline-b', organizationId: campusB.id, projectId: project.id },
      select: { id: true },
    });

    const respuestaMover = await superadmin.request.patch(
      `${BASE_URL}/api/admin/organizaciones/${campusB.id}/miembros/${personalB.id}`,
      { data: { destinoCampusId: campusA.id } },
    );
    assert.equal(respuestaMover.status(), 200, `mover a personalB debe dar 200 (dio ${respuestaMover.status()})`);

    const personalBTrasMover = await prisma.user.findUnique({ where: { id: personalB.id }, select: { organizationId: true } });
    assert.equal(personalBTrasMover?.organizationId, campusA.id, 'personalB debe quedar en campusA tras moverlo');

    const tokenUsageTrasMover = await prisma.tokenUsage.findUnique({ where: { id: tokenUsageViejo.id }, select: { organizationId: true } });
    assert.equal(
      tokenUsageTrasMover?.organizationId,
      campusB.id,
      'el TokenUsage histórico tiene que quedar CONGELADO en campusB, aunque la persona ya se haya movido',
    );
    console.log('✔ 6b. mover de sede conserva el organizationId congelado del TokenUsage viejo');

    // Se lo promueve también en su sede NUEVA (campusA), para confirmar que
    // la baja de abajo purga las DOS filas (la colgada de campusB y la de
    // campusA), no sólo la de la organización por la que se lo dio de baja.
    await superadmin.request.post(`${BASE_URL}/api/admin/organizaciones/${campusA.id}/admins`, { data: { userId: personalB.id } });

    const respuestaBajaB = await superadmin.request.delete(
      `${BASE_URL}/api/admin/organizaciones/${campusA.id}/miembros/${personalB.id}`,
      { data: {} },
    );
    assert.equal(respuestaBajaB.status(), 200, `dar de baja a personalB debe dar 200 (dio ${respuestaBajaB.status()})`);

    const personalBTrasBaja = await prisma.user.findUnique({ where: { id: personalB.id }, select: { organizationId: true } });
    assert.equal(personalBTrasBaja?.organizationId, null, 'la baja debe dejar a personalB como cuenta personal');

    const filasAdminBTrasBaja = await prisma.organizationAdmin.count({ where: { userId: personalB.id } });
    assert.equal(filasAdminBTrasBaja, 0, 'la baja debe purgar TODAS las filas de OrganizationAdmin, incluida la colgada');

    const exclusionCampusA = await prisma.organizationExclusion.findUnique({
      where: { organizationId_email: { organizationId: campusA.id, email: EMAIL_PERSONAL_B } },
    });
    assert.ok(exclusionCampusA, 'la baja debe dejar una exclusión de campusA');

    const proyectoTrasBaja = await prisma.project.findUnique({ where: { id: project.id }, select: { id: true } });
    assert.ok(proyectoTrasBaja, 'el recurso de personalB no se borra al darlo de baja');
    console.log('✔ 6c. la baja deja cuenta personal, purga TODAS las filas de admin, crea la exclusión y conserva el recurso');

    // ───────────────────────────────────────────────────────────
    // 7. Storyline A: la baja de personalA (por dominio) no lo deja
    //    volver a entrar por ESE MISMO dominio; re-agregarlo a la lista
    //    blanca sí lo reune y borra la exclusión.
    // ───────────────────────────────────────────────────────────
    const respuestaBajaA = await superadmin.request.delete(
      `${BASE_URL}/api/admin/organizaciones/${campusA.id}/miembros/${personalA.id}`,
      { data: {} },
    );
    assert.equal(respuestaBajaA.status(), 200, `dar de baja a personalA debe dar 200 (dio ${respuestaBajaA.status()})`);
    const personalATrasBaja = await prisma.user.findUnique({ where: { id: personalA.id }, select: { organizationId: true } });
    assert.equal(personalATrasBaja?.organizationId, null, 'la baja debe dejar a personalA como cuenta personal');

    const personalATrasLogin = await login(aPage, EMAIL_PERSONAL_A);
    assert.equal(
      personalATrasLogin.organizationId,
      null,
      'personalA NO debe volver a unirse por el mismo dominio del que se lo dio de baja',
    );
    console.log('✔ 7a. quien fue dado de baja no vuelve a entrar por el mismo dominio');

    const respuestaReWhitelistA = await superadmin.request.post(
      `${BASE_URL}/api/admin/organizaciones/${campusA.id}/lista-blanca`,
      { data: { email: EMAIL_PERSONAL_A } },
    );
    assert.equal(respuestaReWhitelistA.status(), 200, `re-agregar a personalA a la lista blanca debe dar 200 (dio ${respuestaReWhitelistA.status()})`);
    const personalATrasReWhitelist = await prisma.user.findUnique({ where: { id: personalA.id }, select: { organizationId: true } });
    assert.equal(personalATrasReWhitelist?.organizationId, campusA.id, 're-agregar a la lista blanca debe reunir de inmediato');
    const exclusionCampusATrasReWhitelist = await prisma.organizationExclusion.findUnique({
      where: { organizationId_email: { organizationId: campusA.id, email: EMAIL_PERSONAL_A } },
    });
    assert.equal(exclusionCampusATrasReWhitelist, null, 're-agregar a la lista blanca debe borrar la exclusión');
    console.log('✔ 7b. re-agregar a la lista blanca reune y borra la exclusión');

    // ───────────────────────────────────────────────────────────
    // 8. Archivar corta el acceso a la IA de sus miembros; reactivar lo
    //    devuelve.
    // ───────────────────────────────────────────────────────────
    const docenteArchivar = await registrar(archPage, EMAIL_ARCHIVAR);
    assert.equal(docenteArchivar.organizationId, campusA.id, 'docenteArchivar debe unirse a campusA por dominio');

    const antesDeArchivar = await archPage.request.post(`${BASE_URL}/api/projects`, { data: { title: 'Antes de archivar' } });
    assert.equal(antesDeArchivar.status(), 200, `con campusA activa debe poder crear (dio ${antesDeArchivar.status()})`);

    const respuestaArchivar = await superadmin.request.patch(`${BASE_URL}/api/admin/organizaciones/${campusA.id}`, {
      data: { archived: true },
    });
    assert.equal(respuestaArchivar.status(), 200, `archivar campusA debe dar 200 (dio ${respuestaArchivar.status()})`);

    const duranteArchivada = await archPage.request.post(`${BASE_URL}/api/projects`, { data: { title: 'Durante archivada' } });
    assert.equal(duranteArchivada.status(), 403, `con campusA archivada debe dar 403 (dio ${duranteArchivada.status()})`);

    const respuestaReactivar = await superadmin.request.patch(`${BASE_URL}/api/admin/organizaciones/${campusA.id}`, {
      data: { archived: false },
    });
    assert.equal(respuestaReactivar.status(), 200, `reactivar campusA debe dar 200 (dio ${respuestaReactivar.status()})`);

    const trasReactivar = await archPage.request.post(`${BASE_URL}/api/projects`, { data: { title: 'Tras reactivar' } });
    assert.equal(trasReactivar.status(), 200, `con campusA reactivada debe poder crear de nuevo (dio ${trasReactivar.status()})`);
    console.log('✔ 8. archivar corta el acceso a la IA de sus miembros; reactivar lo devuelve');

    // ───────────────────────────────────────────────────────────
    // 9. Un DOCENTE plano y un "admin de organización" (rol DOCENTE con una
    //    fila de OrganizationAdmin) reciben 403 en TODA ruta de
    //    /api/admin/organizaciones — las gatea el middleware por ROL, antes
    //    de que gestion.ts vuelva a confirmar nada. Reusar esas rutas desde
    //    un admin de organización real (no superadmin) es T8, fuera de
    //    alcance acá.
    // ───────────────────────────────────────────────────────────
    const docentePlano = await registrar(planoPage, EMAIL_DOCENTE_PLANO);

    const orgAdminDocente = await registrar(orgAdminPage, EMAIL_ORG_ADMIN_DOCENTE);
    await prisma.organizationAdmin.create({ data: { userId: orgAdminDocente.id, organizationId: campusA.id } });

    for (const [etiqueta, actorPage] of [
      ['docente plano', planoPage],
      ['admin de organización (no superadmin)', orgAdminPage],
    ] as const) {
      const respuestaGet = await actorPage.request.get(`${BASE_URL}/api/admin/organizaciones`);
      assert.equal(respuestaGet.status(), 403, `${etiqueta}: GET /organizaciones debe dar 403 (dio ${respuestaGet.status()})`);

      const respuestaGetDetalle = await actorPage.request.get(`${BASE_URL}/api/admin/organizaciones/${campusA.id}`);
      assert.equal(respuestaGetDetalle.status(), 403, `${etiqueta}: GET detalle debe dar 403 (dio ${respuestaGetDetalle.status()})`);

      const respuestaPost = await actorPage.request.post(`${BASE_URL}/api/admin/organizaciones`, {
        data: { name: 'no debería crearse', kind: 'CAMPUS' },
      });
      assert.equal(respuestaPost.status(), 403, `${etiqueta}: POST debe dar 403 (dio ${respuestaPost.status()})`);
    }
    console.log('✔ 9. un docente plano y un admin de organización (no superadmin) reciben 403 en toda ruta admin/organizaciones');

    // ───────────────────────────────────────────────────────────
    // 10. "Último admin" (rama de gestion.ts que la ruta HTTP de T6 no
    //     ejercita — sólo la reusa T8 desde `/api/org/*`): llamada DIRECTA
    //     a `degradarAdmin` impersonando al propio org-admin, no vía HTTP.
    // ───────────────────────────────────────────────────────────
    const soloAdminActor = { id: orgAdminDocente.id, role: 'DOCENTE' as const };
    await assert.rejects(
      () => degradarAdmin(soloAdminActor, campusA.id, orgAdminDocente.id),
      (error: unknown) => {
        assert.ok(error instanceof GestionError, 'debe ser un GestionError');
        assert.equal((error as GestionError).status, 409, 'último admin autodegradándose debe dar 409');
        return true;
      },
      'el único admin de una organización no puede sacarse a sí mismo',
    );

    // Con un segundo admin, sí puede.
    await prisma.organizationAdmin.create({ data: { userId: docentePlano.id, organizationId: campusA.id } });
    await degradarAdmin(soloAdminActor, campusA.id, orgAdminDocente.id);
    const filaTrasSegundoAdmin = await prisma.organizationAdmin.findUnique({
      where: { userId_organizationId: { userId: orgAdminDocente.id, organizationId: campusA.id } },
    });
    assert.equal(filaTrasSegundoAdmin, null, 'con un segundo admin, sacarse a sí mismo debe funcionar');
    console.log('✔ 10. un admin no puede sacarse si es el último, pero sí puede con un segundo admin (llamada directa a gestion.ts)');

    // ───────────────────────────────────────────────────────────
    // 11. Navegador: /admin/organizaciones y un detalle, en los dos temas y
    //     en desktop y 360px (iframe: Chromium headless clampea ventanas
    //     debajo de 500px, ver chromium-headless-500px-clamp.md).
    // ───────────────────────────────────────────────────────────
    await capturarResponsive(superadmin, '/admin/organizaciones', 'lista');
    await capturarResponsive(superadmin, `/admin/organizaciones/${red.id}`, 'detalle-red');
    await capturarResponsive(superadmin, `/admin/organizaciones/${campusA.id}`, 'detalle-campus');
    console.log('✔ 11. capturas de /admin/organizaciones y un par de detalles en los dos temas, desktop y 360px, sin overflow');
  } finally {
    await browser.close();
    await limpiarEstado();
    await prisma.$disconnect();
  }
}

// ─────────────────────────────────────────────────────────────
// 360px: Chromium headless clampea el viewport de la VENTANA por debajo de
// 500px (chromium-headless-500px-clamp.md), así que en vez de
// `setViewportSize(360, …)` se aloja la página en un <iframe style="width:
// 360px"> de una página-arnés servida por `page.setContent`, apuntando al
// mismo origen ya logueado — el localStorage del tema, seteado en el origen
// real con `conTema` ANTES de armar el arnés, se comparte porque es la
// MISMA partición de storage del contexto, no algo atado al documento de
// arriba.
// ─────────────────────────────────────────────────────────────

async function entrarAIframe360(page: Page, url: string): Promise<{ frame: Frame; handle: import('playwright').ElementHandle }> {
  await page.setContent(
    `<!doctype html><html><body style="margin:0;padding:0;background:#0000"><iframe id="f" style="display:block;width:360px;height:3400px;border:0"></iframe></body></html>`,
  );
  const handle = (await page.$('#f'))!;
  await handle.evaluate((el: HTMLIFrameElement, src: string) => {
    el.src = src;
  }, url);
  const frame = await handle.contentFrame();
  if (!frame) throw new Error('no se pudo entrar al iframe de 360px');
  await frame.waitForLoadState('load');
  // Espera un elemento concreto (no sólo un timeout fijo): la isla React
  // (client:load) hidrata después de "load", y un timeout solo a veces
  // capturaba la pantalla ANTES de que pintara nada (se vio una captura en
  // blanco en una corrida real).
  await frame.waitForSelector('h1, h2', { timeout: 5_000 });
  await frame.waitForTimeout(300);
  return { frame, handle };
}

async function sinOverflowHorizontal(evaluable: Page | Frame, mensaje: string): Promise<void> {
  const overflow = await evaluable.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.ok(!overflow, mensaje);
}

async function capturarResponsive(page: Page, ruta: string, etiqueta: string): Promise<void> {
  const url = `${BASE_URL}${ruta}`;
  const dir = '/tmp/claude-1001/-home-opencode-projects/559ab3ac-5ab1-58a2-813b-6a7d83cae4e4/scratchpad/t6';

  for (const tema of ['light', 'dark'] as const) {
    // Desktop.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (tema === 'dark') await conTema(page, 'dark');
    else await conTema(page, 'light');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${dir}/${etiqueta}-desktop-${tema}.png` });
    await sinOverflowHorizontal(page, `${etiqueta} (desktop, ${tema}): no debería scrollear horizontal`);

    // 360px, vía iframe (el tema ya quedó en localStorage del origen real).
    const { frame, handle } = await entrarAIframe360(page, url);
    // La captura sale ANTES de la aserción a propósito: si algo desborda,
    // la imagen queda igual para poder mirarla.
    await handle.screenshot({ path: `${dir}/${etiqueta}-360-${tema}.png` });
    await sinOverflowHorizontal(frame, `${etiqueta} (360px, ${tema}): no debería scrollear horizontal`);
  }
}

main()
  .then(() => {
    console.log('\n✔ e2e/admin-organizaciones.ts: todos los escenarios pasaron');
  })
  .catch((error) => {
    console.error('\n✖ e2e/admin-organizaciones.ts falló:', error);
    process.exitCode = 1;
  });
