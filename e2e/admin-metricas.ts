import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma, type UsagePurpose } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, conTema, iniciarSesion } from './harness.ts';
import { agregarConsumo, docentesHoySinOrganizacion, type FilaConsumoCruda } from '../src/lib/metricas/consumo.ts';
import { metricasDelMes } from '../src/lib/admin/metricas.ts';
import type { Frame, Page } from 'playwright';

/**
 * Verificación de T7 (odd/tasks/organizaciones.md): superadmin — métricas de
 * precio.
 *
 * Dos partes:
 *  1. `agregarConsumo` (PURA, sin base) con filas armadas a mano — cubre las
 *     dos filas GENERATION de un mismo proyecto (no duplica "recursos
 *     nuevos"), una fila con costo NULL (nunca se suma como 0) y una fila
 *     histórica con `purpose: null` ("sin clasificar").
 *  2. Una organización nueva (red con 2 sedes + un colegio suelto) sembrada
 *     en el mes "2026-01" — un mes SIN NINGUNA otra fila en toda la base
 *     compartida (`koduedu_orgs` sólo tiene actividad de septiembre 2026 de
 *     otros e2e), así que el total agregado de ESE mes es exactamente la
 *     suma de esta fixture, sin ruido ajeno. La ÚNICA cifra que sí tiene
 *     ruido ambiente es "Docentes hoy" de "Sin organización"/Total
 *     (membresía ACTUAL, no depende del mes: hay cuentas personales de
 *     e2e anteriores) — para esa, se toma una foto ANTES de sembrar y se
 *     compara contra foto+delta, nunca un número absoluto adivinado.
 *
 * Corre con: KODU_BASE_URL=http://localhost:3100 npx tsx e2e/admin-metricas.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const PASSWORD = 'Docente.Metricas.E2E.2026';

const SUFIJO = randomUUID().slice(0, 8);
const MES_FIXTURE = '2026-01'; // aislado: toda la TokenUsage real de esta base es de 2026-09.
const MES_FRONTERA_AGO = '2026-08';
const MES_FRONTERA_SEP = '2026-09';

const EMAIL_PROFE_A = `profe-a-metricas-e2e-${SUFIJO}@metricas-e2e.local`;
const EMAIL_PROFE_B = `profe-b-metricas-e2e-${SUFIJO}@metricas-e2e.local`;
const EMAIL_PROFE_MOVIDO = `profe-movido-metricas-e2e-${SUFIJO}@metricas-e2e.local`;
const EMAIL_PROFE_STANDALONE = `profe-standalone-metricas-e2e-${SUFIJO}@metricas-e2e.local`;
const EMAIL_PROFE_PERSONAL = `profe-personal-metricas-e2e-${SUFIJO}@metricas-e2e.local`;
const EMAIL_PROFE_FRONTERA = `profe-frontera-metricas-e2e-${SUFIJO}@metricas-e2e.local`;
const EMAIL_DOCENTE_PLANO = `docente-plano-metricas-e2e-${SUFIJO}@metricas-e2e.local`;
const EMAIL_ORG_ADMIN = `org-admin-metricas-e2e-${SUFIJO}@metricas-e2e.local`;

const TODOS_LOS_EMAILS = [
  EMAIL_PROFE_A,
  EMAIL_PROFE_B,
  EMAIL_PROFE_MOVIDO,
  EMAIL_PROFE_STANDALONE,
  EMAIL_PROFE_PERSONAL,
  EMAIL_PROFE_FRONTERA,
  EMAIL_DOCENTE_PLANO,
  EMAIL_ORG_ADMIN,
];

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

function d(valor: string): Prisma.Decimal {
  return new Prisma.Decimal(valor);
}

// ─────────────────────────────────────────────────────────────
// Parte 1: `agregarConsumo` pura, sin base.
// ─────────────────────────────────────────────────────────────

function filaPrueba(datos: {
  userId: string;
  purpose: UsagePurpose | null;
  forNewResource: boolean | null;
  projectId: string | null;
  promptTokens: number;
  completionTokens: number;
  cachedInputTokens: number;
  costUsd: Prisma.Decimal | null;
}): FilaConsumoCruda {
  return { organizationId: 'org-prueba-pura', ...datos };
}

function pruebaAgregarConsumo(): void {
  /**
   * Aritmética a mano:
   *  - Dos filas GENERATION del MISMO proyecto p1 (turno inicial + reintento
   *    tras un turno fallido, T5: "el primer turno fallido deja el HTML por
   *    defecto y el siguiente vuelve a ser GENERATION") → recursosNuevos = 1
   *    proyecto distinto, no 2.
   *  - Una fila ADJUSTMENT con costo NULL: nunca se suma como si fuera 0.
   *  - Una fila histórica (`purpose: null`, `forNewResource: null`): cuenta
   *    en tokens/costo, no en turnos/recursos/ajustes, y queda "sin atribuir".
   *
   *  costoTotal   = 0.02 + 0.02 + 0.01 + 0.01(histórica) = 0.06, 1 fila sin precio (la ADJUSTMENT null)
   *  costoPromedioRecursoNuevo = (0.02+0.02) / 1 recurso nuevo = 0.04
   *  costoPromedioAjuste       = 0.01 (fila conocida) / 2 ajustes = 0.005, 1 fila sin precio
   *  costoPorDocenteActivo     = 0.06 / 2 docentes activos = 0.03, 1 fila sin precio
   *  tokens = (100+50) + (80+40) + (60+20) + (40+10) + (20+5) = 425
   *  tokensCacheados = 10 + 5 + 0 + 0 + 0 = 15
   */
  const filas: FilaConsumoCruda[] = [
    filaPrueba({ userId: 'u1', purpose: 'GENERATION', forNewResource: true, projectId: 'p1', promptTokens: 100, completionTokens: 50, cachedInputTokens: 10, costUsd: d('0.02') }),
    filaPrueba({ userId: 'u1', purpose: 'GENERATION', forNewResource: true, projectId: 'p1', promptTokens: 80, completionTokens: 40, cachedInputTokens: 5, costUsd: d('0.02') }),
    filaPrueba({ userId: 'u1', purpose: 'ADJUSTMENT', forNewResource: false, projectId: 'p1', promptTokens: 60, completionTokens: 20, cachedInputTokens: 0, costUsd: d('0.01') }),
    filaPrueba({ userId: 'u2', purpose: 'ADJUSTMENT', forNewResource: false, projectId: 'p1', promptTokens: 40, completionTokens: 10, cachedInputTokens: 0, costUsd: null }),
    filaPrueba({ userId: 'u2', purpose: null, forNewResource: null, projectId: null, promptTokens: 20, completionTokens: 5, cachedInputTokens: 0, costUsd: d('0.01') }),
  ];

  const agregado = agregarConsumo(filas);

  assert.equal(agregado.docentesActivos, 2, 'u1 + u2');
  assert.equal(agregado.recursosNuevos, 1, 'las dos filas GENERATION son del mismo proyecto p1');
  assert.equal(agregado.ajustes, 2);
  assert.equal(agregado.turnos, 4, '2 GENERATION + 2 ADJUSTMENT; la fila histórica no es un turno');
  assert.equal(agregado.tokens, 425);
  assert.equal(agregado.tokensCacheados, 15);

  assert.equal(agregado.costoTotal.suma.toString(), '0.06');
  assert.equal(agregado.costoTotal.filasSinPrecio, 1, 'la fila ADJUSTMENT sin costo nunca se suma como 0');

  const paso = (p: UsagePurpose | null) => agregado.costoPorPaso.find((f) => f.purpose === p)!;
  assert.equal(paso('GENERATION').filas, 2);
  assert.equal(paso('GENERATION').costo.suma.toString(), '0.04');
  assert.equal(paso('GENERATION').costo.filasSinPrecio, 0);
  assert.equal(paso('ADJUSTMENT').filas, 2);
  assert.equal(paso('ADJUSTMENT').costo.suma.toString(), '0.01');
  assert.equal(paso('ADJUSTMENT').costo.filasSinPrecio, 1);
  assert.equal(paso(null).filas, 1, '"Sin clasificar": la fila histórica');
  assert.equal(paso(null).costo.suma.toString(), '0.01');

  assert.equal(agregado.costoPromedioRecursoNuevo.promedio?.toString(), '0.04');
  assert.equal(agregado.costoPromedioRecursoNuevo.filasSinPrecio, 0);
  assert.equal(agregado.costoPromedioAjuste.promedio?.toString(), '0.005');
  assert.equal(agregado.costoPromedioAjuste.filasSinPrecio, 1);
  assert.equal(agregado.filasSinAtribuir, 1, 'la fila histórica: forNewResource null');
  assert.equal(agregado.costoPorDocenteActivo.promedio?.toString(), '0.03');
  assert.equal(agregado.costoPorDocenteActivo.filasSinPrecio, 1);

  // Grupo vacío: nunca se divide por cero, nunca se muestra un promedio inventado.
  const vacio = agregarConsumo([]);
  assert.equal(vacio.docentesActivos, 0);
  assert.equal(vacio.costoTotal.suma.toString(), '0');
  assert.equal(vacio.costoTotal.filasSinPrecio, 0);
  assert.equal(vacio.costoPromedioRecursoNuevo.promedio, null);
  assert.equal(vacio.costoPorDocenteActivo.promedio, null);

  console.log('✔ 1. agregarConsumo (pura): proyecto distinto, costo NULL, fila histórica y grupo vacío');
}

// ─────────────────────────────────────────────────────────────
// Parte 2: fixture de base + navegador.
// ─────────────────────────────────────────────────────────────

const orgIds = { red: '', campusA: '', campusB: '', standalone: '', frontera: '' };
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
  await prisma.organization.deleteMany({ where: { name: { contains: SUFIJO } } });
}

async function crearUsuario(email: string, nombre: string, organizationId: string | null): Promise<string> {
  const fila = await prisma.user.upsert({
    where: { email },
    update: { role: 'DOCENTE', organizationId, passwordHash: await hashPassword(PASSWORD) },
    create: { email, name: nombre, role: 'DOCENTE', passwordHash: await hashPassword(PASSWORD), organizationId },
    select: { id: true },
  });
  return fila.id;
}

/** `TokenUsage.projectId` es una FK real — no alcanza con un string suelto
 *  como "proj-a", hace falta un `Project` de verdad (el borrado en cascada de
 *  `limpiarEstado` ya lo cubre vía `userId`). */
async function crearProyecto(userId: string): Promise<string> {
  const proyecto = await prisma.project.create({ data: { userId, slug: `e2e-metricas-${randomUUID()}` }, select: { id: true } });
  return proyecto.id;
}

interface FilaSembrada {
  userId: string;
  organizationId: string | null;
  purpose: UsagePurpose | null;
  forNewResource: boolean | null;
  projectId: string | null;
  promptTokens: number;
  completionTokens: number;
  cachedInputTokens: number;
  costUsd: string | null;
  createdAt: Date;
}

async function sembrarFila(fila: FilaSembrada): Promise<void> {
  await prisma.tokenUsage.create({
    data: {
      userId: fila.userId,
      organizationId: fila.organizationId,
      purpose: fila.purpose,
      forNewResource: fila.forNewResource,
      projectId: fila.projectId,
      model: 'e2e-metricas',
      promptTokens: fila.promptTokens,
      completionTokens: fila.completionTokens,
      cachedInputTokens: fila.cachedInputTokens,
      costUsd: fila.costUsd === null ? null : d(fila.costUsd),
      createdAt: fila.createdAt,
    },
  });
}

function fechaFixture(diaMes: string): Date {
  return new Date(`${MES_FIXTURE}-${diaMes}T12:00:00-03:00`);
}

async function main(): Promise<void> {
  pruebaAgregarConsumo();

  await limpiarEstado();

  // TODO lo que sigue (siembra + navegador) va dentro de este único
  // try/finally: si la siembra fallara a mitad de camino (p. ej. una FK), el
  // `finally` igual limpia — de lo contrario una fixture a medio sembrar
  // queda huérfana para siempre (el SUFIJO de la corrida siguiente es otro,
  // así que `limpiarEstado()` de esa corrida nunca la encuentra).
  try {
    await sembrarYVerificar();
  } finally {
    await limpiarEstado();
    await prisma.$disconnect();
  }
}

async function sembrarYVerificar(): Promise<void> {
  // Fotos ANTES de sembrar nada — "Docentes hoy" es membresía ACTUAL, así
  // que las cuentas personales de e2e anteriores (m1, org-invitaciones, etc.)
  // ya suman acá; se compara delta, nunca un número absoluto.
  const baselineSinOrg = await docentesHoySinOrganizacion();
  const baselineTotal = (await metricasDelMes(MES_FIXTURE)).total.docentesHoy;

  const red = await prisma.organization.create({ data: { name: `Red E2E Métricas ${SUFIJO}`, kind: 'NETWORK' } });
  const campusA = await prisma.organization.create({ data: { name: `Sede A E2E Métricas ${SUFIJO}`, kind: 'CAMPUS', parentId: red.id } });
  const campusB = await prisma.organization.create({ data: { name: `Sede B E2E Métricas ${SUFIJO}`, kind: 'CAMPUS', parentId: red.id } });
  const standalone = await prisma.organization.create({ data: { name: `Colegio Suelto E2E Métricas ${SUFIJO}`, kind: 'CAMPUS' } });
  const frontera = await prisma.organization.create({ data: { name: `Sede Frontera E2E Métricas ${SUFIJO}`, kind: 'CAMPUS' } });
  orgIds.red = red.id;
  orgIds.campusA = campusA.id;
  orgIds.campusB = campusB.id;
  orgIds.standalone = standalone.id;
  orgIds.frontera = frontera.id;

  userIds.profeA = await crearUsuario(EMAIL_PROFE_A, 'Profe A Métricas', campusA.id);
  userIds.profeB = await crearUsuario(EMAIL_PROFE_B, 'Profe B Métricas', campusB.id);
  userIds.profeMovido = await crearUsuario(EMAIL_PROFE_MOVIDO, 'Profe Movido Métricas', campusA.id); // YA está en A
  userIds.profeStandalone = await crearUsuario(EMAIL_PROFE_STANDALONE, 'Profe Standalone Métricas', standalone.id);
  userIds.profePersonal = await crearUsuario(EMAIL_PROFE_PERSONAL, 'Profe Personal Métricas', null);
  userIds.profeFrontera = await crearUsuario(EMAIL_PROFE_FRONTERA, 'Profe Frontera Métricas', frontera.id);
  // Personales a propósito (NO en campusA): sólo hacen falta para probar el
  // 403/redirect de la sección 6, y así no ensucian el "Docentes hoy" de
  // campusA que ya se calculó a mano arriba. La fila de OrganizationAdmin sí
  // apunta a campusA — alcanza para simular "ni siquiera un admin de
  // organización real entra acá", aunque esta página no llame a `alcance.ts`
  // (es superadmin-only por rol, sin excepción para admins de organización).
  userIds.docentePlano = await crearUsuario(EMAIL_DOCENTE_PLANO, 'Docente Plano Métricas', null);
  userIds.orgAdmin = await crearUsuario(EMAIL_ORG_ADMIN, 'Org Admin Métricas', null);
  await prisma.organizationAdmin.create({ data: { userId: userIds.orgAdmin, organizationId: campusA.id } });

  // `TokenUsage.projectId` es una FK real: un proyecto por "recurso" distinto
  // de la fixture (proj-a lo comparten A1/A2/A3/A4 a propósito — es EL MISMO
  // recurso, dos turnos GENERATION incluidos).
  const projA = await crearProyecto(userIds.profeA);
  const projM = await crearProyecto(userIds.profeMovido);
  const projB = await crearProyecto(userIds.profeB);
  const projM0 = await crearProyecto(userIds.profeMovido);
  const projP = await crearProyecto(userIds.profePersonal);
  const projFrontera = await crearProyecto(userIds.profeFrontera);

  // ───────────────────────────────────────────────────────────
  // CampusA, mes 2026-01 (aislado): 6 filas.
  //  A1/A4: GENERATION, mismo proyecto projA (2ª = reintento) → 1 recurso nuevo.
  //  A2:    ADJUSTMENT con costo conocido.
  //  A3:    ADJUSTMENT con costo NULL.
  //  A5:    histórica (purpose null).
  //  M1:    profeMovido, GENERATION, YA congelado en campusA (post-mudanza).
  // ───────────────────────────────────────────────────────────
  await sembrarFila({ userId: userIds.profeA, organizationId: campusA.id, purpose: 'GENERATION', forNewResource: true, projectId: projA, promptTokens: 1000, completionTokens: 400, cachedInputTokens: 100, costUsd: '0.02', createdAt: fechaFixture('15') });
  await sembrarFila({ userId: userIds.profeA, organizationId: campusA.id, purpose: 'ADJUSTMENT', forNewResource: false, projectId: projA, promptTokens: 500, completionTokens: 150, cachedInputTokens: 50, costUsd: '0.01', createdAt: fechaFixture('16') });
  await sembrarFila({ userId: userIds.profeA, organizationId: campusA.id, purpose: 'ADJUSTMENT', forNewResource: false, projectId: projA, promptTokens: 300, completionTokens: 100, cachedInputTokens: 0, costUsd: null, createdAt: fechaFixture('17') });
  await sembrarFila({ userId: userIds.profeA, organizationId: campusA.id, purpose: 'GENERATION', forNewResource: true, projectId: projA, promptTokens: 800, completionTokens: 300, cachedInputTokens: 80, costUsd: '0.02', createdAt: fechaFixture('18') });
  await sembrarFila({ userId: userIds.profeA, organizationId: campusA.id, purpose: null, forNewResource: null, projectId: null, promptTokens: 200, completionTokens: 100, cachedInputTokens: 0, costUsd: '0.01', createdAt: fechaFixture('19') });
  await sembrarFila({ userId: userIds.profeMovido, organizationId: campusA.id, purpose: 'GENERATION', forNewResource: true, projectId: projM, promptTokens: 600, completionTokens: 200, cachedInputTokens: 0, costUsd: '0.04', createdAt: fechaFixture('20') });

  // ───────────────────────────────────────────────────────────
  // CampusB: B1 (profeB) + M0 (profeMovido, ANTES de mudarse — congelado en
  // B aunque HOY su organizationId ya sea campusA): docentesActivos de
  // campusB incluye a profeMovido, docentesHoy de campusB NO (ya se fue).
  // ───────────────────────────────────────────────────────────
  await sembrarFila({ userId: userIds.profeB, organizationId: campusB.id, purpose: 'ADJUSTMENT', forNewResource: false, projectId: projB, promptTokens: 400, completionTokens: 100, cachedInputTokens: 0, costUsd: '0.03', createdAt: fechaFixture('10') });
  await sembrarFila({ userId: userIds.profeMovido, organizationId: campusB.id, purpose: 'ADJUSTMENT', forNewResource: false, projectId: projM0, promptTokens: 250, completionTokens: 50, cachedInputTokens: 0, costUsd: '0.01', createdAt: fechaFixture('05') });

  // Sin organización.
  await sembrarFila({ userId: userIds.profePersonal, organizationId: null, purpose: 'ADJUSTMENT', forNewResource: false, projectId: projP, promptTokens: 100, completionTokens: 50, cachedInputTokens: 0, costUsd: '0.01', createdAt: fechaFixture('12') });

  // ───────────────────────────────────────────────────────────
  // Frontera: un turno a las 23:30 (Argentina) del 31/8 pertenece a AGOSTO;
  // uno a las 00:30 del 1/9 pertenece a SEPTIEMBRE — el mismo docente, el
  // mismo proyecto, otra sede aislada (no contamina campusA/B/Total del mes
  // de la fixture, que es 2026-01).
  // ───────────────────────────────────────────────────────────
  await sembrarFila({
    userId: userIds.profeFrontera,
    organizationId: frontera.id,
    purpose: 'GENERATION',
    forNewResource: true,
    projectId: projFrontera,
    promptTokens: 100,
    completionTokens: 50,
    cachedInputTokens: 0,
    costUsd: '0.05',
    createdAt: new Date('2026-08-31T23:30:00-03:00'),
  });
  await sembrarFila({
    userId: userIds.profeFrontera,
    organizationId: frontera.id,
    purpose: 'ADJUSTMENT',
    forNewResource: false,
    projectId: projFrontera,
    promptTokens: 60,
    completionTokens: 20,
    cachedInputTokens: 0,
    costUsd: '0.02',
    createdAt: new Date('2026-09-01T00:30:00-03:00'),
  });

  const browser = await abrirNavegador();

  try {
    // ───────────────────────────────────────────────────────────
    // 2. Contexto superadmin.
    // ───────────────────────────────────────────────────────────
    const superadminCtx = await browser.newContext();
    const superadmin = await superadminCtx.newPage();
    await iniciarSesion(superadmin, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    // ───────────────────────────────────────────────────────────
    // 3. `/admin/metricas?mes=2026-01`: valores renderizados de campusA
    //    (con "≥", el signo de piso), campusB (sin "≥") y Total (delta de
    //    "Docentes hoy" contra la foto tomada antes de sembrar).
    // ───────────────────────────────────────────────────────────
    await superadmin.goto(`${BASE_URL}/admin/metricas?mes=${MES_FIXTURE}`, { waitUntil: 'domcontentloaded' });
    await superadmin.waitForSelector('h2:has-text("Métricas de precio")');

    // `[data-fila-nombre]` exacto, no `hasText` (substring): el detalle de
    // CUALQUIER fila con tokens dice "... de N totales.", que contiene
    // "total" como subcadena — un hasText suelto para "Total" caía en la
    // primera fila con consumo, nunca en la fila Total real.
    const filaTexto = async (nombre: string): Promise<string> => {
      const fila = superadmin.locator(`#tabla-metricas > tbody > tr[data-fila-nombre="${nombre}"]`);
      return (await fila.innerText()).replace(/\s+/g, ' ').trim();
    };

    const textoA = await filaTexto(`Sede A E2E Métricas ${SUFIJO}`);
    assert.ok(textoA.includes('≥ US$ 0,10'), `campusA debe mostrar el piso "≥ US$ 0,10" (dio: ${textoA})`);
    // Docentes hoy 2, activos 2, recursos nuevos 2, ajustes 2, turnos 5 (ver comentario de siembra).
    assert.match(textoA, /↳ Sede A E2E Métricas [a-z0-9]+ 2 2 2 2 5/, `columnas de campusA (dio: ${textoA})`);

    const textoB = await filaTexto(`Sede B E2E Métricas ${SUFIJO}`);
    assert.ok(!textoB.includes('≥'), `campusB no tiene filas sin precio, no debería llevar "≥" (dio: ${textoB})`);
    assert.ok(textoB.includes('US$ 0,04'), `campusB: costo exacto 0.03+0.01 (dio: ${textoB})`);
    assert.match(textoB, /↳ Sede B E2E Métricas [a-z0-9]+ 1 2 0 2 2/, `columnas de campusB: docentesHoy=1 (profeMovido ya se fue), activos=2 (dio: ${textoB})`);

    const textoStandalone = await filaTexto(`Colegio Suelto E2E Métricas ${SUFIJO}`);
    assert.match(textoStandalone, / 1 0 0 0 0 /, `standalone sin actividad: docentesHoy=1, el resto 0 (dio: ${textoStandalone})`);
    assert.ok(textoStandalone.includes('US$ 0,00'), `standalone sin actividad: costo exacto US$ 0,00 (dio: ${textoStandalone})`);

    // "Sin organización" y "Total" agregan MEMBRESÍA ACTUAL de toda la base
    // compartida (nunca filtrada por mes) — profePersonal, docentePlano y
    // orgAdmin son las TRES cuentas personales nuevas de esta fixture, así
    // que el delta sobre la foto previa es +3, no +1.
    const textoSinOrg = await filaTexto('Sin organización');
    const docentesHoySinOrgEsperado = baselineSinOrg + 3;
    assert.match(
      textoSinOrg,
      new RegExp(`^Sin organización ${docentesHoySinOrgEsperado} `),
      `Sin organización.docentesHoy debe ser el delta sobre la foto previa (esperaba ${docentesHoySinOrgEsperado}, dio: ${textoSinOrg})`,
    );

    const textoTotal = await filaTexto('Total');
    const docentesHoyTotalEsperado =
      baselineTotal + 2 /* campusA: profeA + profeMovido */ + 1 /* campusB: profeB */ + 1 /* standalone */ + 1 /* frontera: profeFrontera */ + 3; /* sin org: profePersonal + docentePlano + orgAdmin */
    assert.match(
      textoTotal,
      new RegExp(`^Total ${docentesHoyTotalEsperado} `),
      `Total.docentesHoy debe ser el delta sobre la foto previa (esperaba ${docentesHoyTotalEsperado}, dio: ${textoTotal})`,
    );
    assert.ok(textoTotal.includes('≥ US$ 0,15'), `Total: 0.10(A)+0.04(B)+0.01(sin org) = 0.15, con piso (dio: ${textoTotal})`);
    console.log('✔ 2-3. valores renderizados de campusA (con "≥"), campusB (sin "≥"), standalone, "Sin organización" y Total (delta)');

    // ───────────────────────────────────────────────────────────
    // 4. Frontera de mes: en agosto sólo entra la fila de las 23:30 (Argentina)
    //    del 31/8; en septiembre sólo la de las 00:30 del 1/9.
    // ───────────────────────────────────────────────────────────
    const nombreFrontera = `Sede Frontera E2E Métricas ${SUFIJO}`;

    await superadmin.goto(`${BASE_URL}/admin/metricas?mes=${MES_FRONTERA_AGO}`, { waitUntil: 'domcontentloaded' });
    const textoFronteraAgo = (
      await superadmin.locator(`#tabla-metricas > tbody > tr[data-fila-nombre="${nombreFrontera}"]`).innerText()
    ).replace(/\s+/g, ' ');
    assert.match(textoFronteraAgo, / 1 1 1 0 1 /, `agosto: sólo la fila de las 23:30 del 31/8 — 1 activo, 1 recurso nuevo, 0 ajustes, 1 turno (dio: ${textoFronteraAgo})`);

    await superadmin.goto(`${BASE_URL}/admin/metricas?mes=${MES_FRONTERA_SEP}`, { waitUntil: 'domcontentloaded' });
    const textoFronteraSep = (
      await superadmin.locator(`#tabla-metricas > tbody > tr[data-fila-nombre="${nombreFrontera}"]`).innerText()
    ).replace(/\s+/g, ' ');
    assert.match(textoFronteraSep, / 1 1 0 1 1 /, `septiembre: sólo la fila de las 00:30 del 1/9 — 0 recursos nuevos, 1 ajuste, 1 turno (dio: ${textoFronteraSep})`);
    console.log('✔ 4. frontera de mes en huso de Argentina: 31/8 23:30 → agosto, 1/9 00:30 → septiembre');

    // ───────────────────────────────────────────────────────────
    // 5. CSV: números crudos (punto decimal), incluido el 0.005 exacto que
    //    la UI redondea a "≥ US$ 0,0050".
    // ───────────────────────────────────────────────────────────
    const respuestaCsv = await superadmin.request.get(`${BASE_URL}/api/admin/metricas.csv?mes=${MES_FIXTURE}`);
    assert.equal(respuestaCsv.status(), 200, `CSV debe dar 200 (dio ${respuestaCsv.status()})`);
    assert.match(respuestaCsv.headers()['content-type'] ?? '', /text\/csv/, 'Content-Type debe ser text/csv');
    const csv = await respuestaCsv.text();
    const lineaA = csv.split('\r\n').find((l) => l.includes(`Sede A E2E Métricas ${SUFIJO}`));
    assert.ok(lineaA, 'el CSV debe tener una línea para campusA');
    const columnasA = lineaA!.split(',');
    assert.equal(columnasA[9], '0.1', `costo crudo de campusA: 0.02+0.01+0.02+0.04 (dio ${columnasA[9]})`); // Decimal.toString() de 0.10 es "0.1"
    assert.equal(columnasA[11], '0.04', 'promedio crudo por recurso nuevo');
    assert.equal(columnasA[12], '0.005', 'promedio crudo por ajuste: el 0.005 exacto, sin redondear');
    console.log('✔ 5. CSV: números crudos con punto decimal, sin el redondeo de la UI');

    // ───────────────────────────────────────────────────────────
    // 6. DOCENTE plano y admin de organización (no superadmin): la PÁGINA
    //    redirige (nunca 404, nunca blanco); la API de CSV da 403 JSON —
    //    mismo contrato que m1-admin-shell.ts.
    // ───────────────────────────────────────────────────────────
    for (const [etiqueta, email] of [
      ['docente plano', EMAIL_DOCENTE_PLANO],
      ['admin de organización (no superadmin)', EMAIL_ORG_ADMIN],
    ] as const) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await iniciarSesion(page, { email, password: PASSWORD });

      await page.goto(`${BASE_URL}/admin/metricas`, { waitUntil: 'domcontentloaded' });
      assert.ok(!page.url().includes('/admin/metricas'), `${etiqueta}: /admin/metricas debe redirigir (quedó en ${page.url()})`);

      const respuestaCsvAjena = await page.request.get(`${BASE_URL}/api/admin/metricas.csv?mes=${MES_FIXTURE}`);
      assert.equal(respuestaCsvAjena.status(), 403, `${etiqueta}: GET del CSV debe dar 403 (dio ${respuestaCsvAjena.status()})`);
      const cuerpo = (await respuestaCsvAjena.json()) as { ok: boolean };
      assert.equal(cuerpo.ok, false, `${etiqueta}: el 403 del CSV debe ser JSON { ok: false }`);

      await ctx.close();
    }
    console.log('✔ 6. docente plano y admin de organización (no superadmin): página redirige, CSV 403 JSON');

    // ───────────────────────────────────────────────────────────
    // 7. Navegador: /admin/metricas en los dos temas, desktop y 360px
    //    (iframe: Chromium headless clampea ventanas debajo de 500px), sin
    //    overflow horizontal de página.
    // ───────────────────────────────────────────────────────────
    await capturarResponsive(superadmin, `/admin/metricas?mes=${MES_FIXTURE}`, 'metricas');
    console.log('✔ 7. capturas de /admin/metricas en los dos temas, desktop y 360px, sin overflow');
  } finally {
    // limpiarEstado() y prisma.$disconnect() los hace el finally de main().
    await browser.close();
  }
}

// ─────────────────────────────────────────────────────────────
// 360px (mismo arnés que e2e/admin-organizaciones.ts): Chromium headless
// clampea el viewport de la VENTANA por debajo de 500px, así que se aloja la
// página en un <iframe style="width: 360px"> de una página-arnés.
// ─────────────────────────────────────────────────────────────

async function entrarAIframe360(page: Page, url: string): Promise<{ frame: Frame; handle: import('playwright').ElementHandle }> {
  await page.setContent(
    `<!doctype html><html><body style="margin:0;padding:0;background:#0000"><iframe id="f" style="display:block;width:360px;height:4200px;border:0"></iframe></body></html>`,
  );
  const handle = (await page.$('#f'))!;
  await handle.evaluate((el: HTMLIFrameElement, src: string) => {
    el.src = src;
  }, url);
  const frame = await handle.contentFrame();
  if (!frame) throw new Error('no se pudo entrar al iframe de 360px');
  await frame.waitForLoadState('load');
  await frame.waitForSelector('h2', { timeout: 5_000 });
  await frame.waitForTimeout(300);
  return { frame, handle };
}

async function sinOverflowHorizontal(evaluable: Page | Frame, mensaje: string): Promise<void> {
  const overflow = await evaluable.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.ok(!overflow, mensaje);
}

async function capturarResponsive(page: Page, ruta: string, etiqueta: string): Promise<void> {
  const url = `${BASE_URL}${ruta}`;
  const dir = '/tmp/claude-1001/-home-opencode-projects/559ab3ac-5ab1-58a2-813b-6a7d83cae4e4/scratchpad/t7';

  for (const tema of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await conTema(page, tema);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${dir}/${etiqueta}-desktop-${tema}.png`, fullPage: true });
    await sinOverflowHorizontal(page, `${etiqueta} (desktop, ${tema}): no debería scrollear horizontal`);

    const { frame, handle } = await entrarAIframe360(page, url);
    await handle.screenshot({ path: `${dir}/${etiqueta}-360-${tema}.png` });
    await sinOverflowHorizontal(frame, `${etiqueta} (360px, ${tema}): no debería scrollear horizontal`);
  }
}

main()
  .then(() => {
    console.log('\n✔ e2e/admin-metricas.ts: todos los escenarios pasaron');
  })
  .catch((error) => {
    console.error('\n✖ e2e/admin-metricas.ts falló:', error);
    process.exitCode = 1;
  });
