import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { fingerprintHtml } from '../src/lib/ai/fingerprint.ts';
import { recordUsage } from '../src/lib/ai/usage.ts';
import { asegurarCuentaDemo } from '../src/lib/demo.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';
import type { Page } from 'playwright';

/**
 * Chequeo de T5 (`odd/tasks/organizaciones.md`): `recordUsage` calcula
 * `purpose`, la sede (`organizationId`, congelada al momento de la llamada)
 * y `forNewResource` (directo para GENERATION/ADJUSTMENT/CHECKLIST/
 * EXTRA_VERSION, heredado para CORRECTION/VERIFICATION de la última fila
 * GENERATION/ADJUSTMENT del mismo proyecto y docente).
 *
 * Requiere la pila de desarrollo de ESTE worktree levantada (`PORT=3100 npm
 * run dev`, base `koduedu_orgs`) y el mock de `e2e/mock-proveedor.ts` en
 * 4790 — compartido con la sesión de `feat/generacion-simple-y-reanudable`,
 * así que antes de levantarlo hay que confirmar que el puerto está libre
 * (`ss -ltn | rg ':4790 '`).
 *
 * Reusa el patrón de `e2e/t12-checklist-pruebas.ts` (motor generador
 * "kodu-mock-t3"), `e2e/t2-versiones-por-proyecto.ts`/`t9-varias-versiones.ts`
 * (turno crudo por `page.request.post('/api/chat/stream')`, sin manejar el
 * `<textarea>`) y `e2e/verificador-endpoint.ts` (motor verificador dedicado
 * vía Responses API, `POST /api/chat/verificar` y `POST
 * /api/chat/autocorreccion` crudos).
 *
 * Corre con: KODU_BASE_URL=http://localhost:3100 npx tsx e2e/consumo-proposito.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-consumo-proposito@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_GENERADOR_KIND = 'kodu-mock-t3';
const PROVIDER_GENERADOR_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_GENERADOR_PROVIDER_MODEL = 'mock-t3';
const MODEL_GENERADOR_DISPLAY_NAME = 'Mock local (T3+)';

const PROVIDER_VERIFICADOR_KIND = 'kodu-mock-consumo-proposito-verificador';
const PROVIDER_VERIFICADOR_LABEL = 'Mock local (consumo-proposito, verificador, e2e/mock-proveedor.ts)';
const MODEL_VERIFICADOR_PROVIDER_MODEL = 'mock-consumo-proposito-verificador';
const MODEL_VERIFICADOR_DISPLAY_NAME = 'Mock verificador (consumo-proposito)';

const ORG_A_NAME = 'Colegio E2E Consumo Propósito A';
const ORG_B_NAME = 'Colegio E2E Consumo Propósito B';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

function htmlDePrueba(marca: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="pizarron">
<title>Consumo propósito ${marca}</title>
</head>
<body data-marca="${marca}">
  <h1>Recurso ${marca}</h1>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// Helpers (mismo patrón que e2e/t12-checklist-pruebas.ts, t2/t9 y
// verificador-endpoint.ts).
// ─────────────────────────────────────────────────────────────

async function asegurarDocente(email: string, password: string, nombre: string, organizationId: string): Promise<string> {
  const fila = await prisma.user.upsert({
    where: { email },
    // Reasignado a orgA en CADA corrida: una corrida anterior puede haber
    // dejado al docente en orgB (escena 7) — sin esto, una corrida repetida
    // arrancaría con el estado equivocado.
    update: { role: 'DOCENTE', organizationId, aiAccessOverride: null },
    create: { email, name: nombre, role: 'DOCENTE', passwordHash: await hashPassword(password), organizationId },
    select: { id: true },
  });
  return fila.id;
}

async function asegurarMotorGenerador(adminPage: Page, mockUrl: string): Promise<string> {
  const proveedorExistente = await prisma.aiProvider.findFirst({
    where: { kind: PROVIDER_GENERADOR_KIND, enabled: true, apiKeyCipher: { not: null } },
    orderBy: { id: 'asc' },
  });
  let providerId = proveedorExistente?.id ?? null;

  if (!providerId) {
    const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/providers`, {
      data: { kind: PROVIDER_GENERADOR_KIND, label: PROVIDER_GENERADOR_LABEL, baseUrl: mockUrl, apiKey: 'clave-de-prueba-del-mock' },
    });
    assert.equal(respuesta.status(), 200, `alta de la cuenta generadora: ${respuesta.status()} ${await respuesta.text()}`);
    providerId = ((await respuesta.json()) as { proveedor: { id: string } }).proveedor.id;
  }

  const modeloExistente = await prisma.aiModel.findFirst({
    where: { providerId, providerModel: MODEL_GENERADOR_PROVIDER_MODEL, enabled: true },
    orderBy: { id: 'asc' },
  });
  let modelId = modeloExistente?.id ?? null;

  if (!modelId) {
    const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/models`, {
      data: {
        providerId,
        providerModel: MODEL_GENERADOR_PROVIDER_MODEL,
        displayName: MODEL_GENERADOR_DISPLAY_NAME,
        description: 'Proveedor simulado para chequeos de navegador. No usar con docentes reales.',
        selectableByTeacher: true,
      },
    });
    assert.equal(respuesta.status(), 200, `alta del motor generador: ${respuesta.status()} ${await respuesta.text()}`);
    modelId = ((await respuesta.json()) as { motor: { id: string } }).motor.id;
  } else if (!modeloExistente!.selectableByTeacher || !modeloExistente!.enabled) {
    await prisma.aiModel.update({ where: { id: modelId }, data: { selectableByTeacher: true, enabled: true } });
  }

  return modelId;
}

/** Motor VERIFICADOR (Responses API), cuenta dedicada de esta tarea — mismo
 *  patrón que `asegurarMotorVerificador` de `verificador-endpoint.ts`.
 *  Arranca SIN `isVerifier`; cada escena lo prende/apaga a propósito. */
async function asegurarMotorVerificador(adminPage: Page, mockUrl: string): Promise<string> {
  let proveedor = await prisma.aiProvider.findFirst({
    where: { kind: PROVIDER_VERIFICADOR_KIND, enabled: true, apiKeyCipher: { not: null }, apiFormat: 'responses' },
    orderBy: { id: 'asc' },
  });

  if (!proveedor) {
    const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/providers`, {
      data: {
        kind: PROVIDER_VERIFICADOR_KIND,
        label: PROVIDER_VERIFICADOR_LABEL,
        baseUrl: mockUrl,
        apiFormat: 'responses',
        apiKey: 'clave-de-prueba-del-mock-verificador',
      },
    });
    assert.equal(respuesta.status(), 200, `alta de la cuenta verificadora: ${respuesta.status()} ${await respuesta.text()}`);
    const { proveedor: creado } = (await respuesta.json()) as { proveedor: { id: string } };
    proveedor = await prisma.aiProvider.findUniqueOrThrow({ where: { id: creado.id } });
  }

  const modeloExistente = await prisma.aiModel.findFirst({
    where: { providerId: proveedor.id, providerModel: MODEL_VERIFICADOR_PROVIDER_MODEL },
  });
  let modelId = modeloExistente?.id ?? null;

  if (!modelId) {
    const respuesta = await adminPage.request.post(`${BASE_URL}/api/admin/models`, {
      data: {
        providerId: proveedor.id,
        providerModel: MODEL_VERIFICADOR_PROVIDER_MODEL,
        displayName: MODEL_VERIFICADOR_DISPLAY_NAME,
        description: 'Motor verificador simulado. No usar con docentes reales.',
        selectableByTeacher: false,
        reasoningEffort: 'high',
        reasoningParam: 'reasoning_effort',
      },
    });
    assert.equal(respuesta.status(), 200, `alta del motor verificador: ${respuesta.status()} ${await respuesta.text()}`);
    modelId = ((await respuesta.json()) as { motor: { id: string } }).motor.id;
  } else if (!modeloExistente!.enabled) {
    await prisma.aiModel.update({ where: { id: modelId }, data: { enabled: true } });
  }

  await fijarIsVerifier(adminPage, modelId, false);
  return modelId;
}

async function fijarIsVerifier(adminPage: Page, modelId: string, valor: boolean): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/models/${modelId}`, { data: { isVerifier: valor } });
  assert.ok(respuesta.ok(), `PATCH isVerifier=${valor}: ${respuesta.status()} ${await respuesta.text()}`);
}

async function fijarVersionsForAll(adminPage: Page, valor: boolean): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/settings`, { data: { versionsForAll: valor } });
  assert.ok(respuesta.ok(), `PATCH /api/admin/settings versionsForAll=${valor}: ${respuesta.status()} ${await respuesta.text()}`);
}

async function habilitarVersionesEnProyecto(page: Page, projectId: string): Promise<void> {
  const resp = await page.request.patch(`${BASE_URL}/api/projects/${projectId}`, { data: { versionsEnabled: true } });
  assert.equal(resp.status(), 200, `habilitar versiones en el proyecto: ${resp.status()} ${await resp.text()}`);
}

async function crearProyecto(page: Page, title: string, modelId: string): Promise<{ id: string; threadId: string }> {
  const creado = await page.request.post(`${BASE_URL}/api/projects`, { data: { title } });
  assert.equal(creado.status(), 200, `alta del proyecto "${title}": ${creado.status()} ${await creado.text()}`);
  const { project } = (await creado.json()) as { project: { id: string; threadId: string } };
  await prisma.project.update({ where: { id: project.id }, data: { aiModelId: modelId } });
  return project;
}

async function proyectoActual(id: string): Promise<{ currentHtml: string }> {
  return prisma.project.findUniqueOrThrow({ where: { id }, select: { currentHtml: true } });
}

interface EventoSse {
  type: string;
  [key: string]: unknown;
}

function eventosDe(cuerpoSse: string): EventoSse[] {
  return cuerpoSse
    .split('\n\n')
    .map((bloque) =>
      bloque
        .split('\n')
        .filter((linea) => linea.startsWith('data:'))
        .map((linea) => linea.slice(5).trim())
        .join(''),
    )
    .filter((linea) => linea && linea !== '[DONE]')
    .map((linea) => {
      try {
        return JSON.parse(linea) as EventoSse;
      } catch {
        return null;
      }
    })
    .filter((evento): evento is EventoSse => evento !== null);
}

/** Manda un turno por la API cruda (sin tocar el `<textarea>`) — mismo
 *  helper que t2/t9. */
async function enviarTurnoCrudo(
  page: Page,
  args: { projectId: string; threadId: string; message: string; modelId: string; variants?: 3 },
): Promise<{ status: number; eventos: EventoSse[] }> {
  const resp = await page.request.post(`${BASE_URL}/api/chat/stream`, {
    data: {
      projectId: args.projectId,
      threadId: args.threadId,
      message: args.message,
      model: args.modelId,
      ...(args.variants ? { variants: args.variants } : {}),
    },
  });
  const status = resp.status();
  const eventos = status === 200 ? eventosDe(await resp.text()) : [];
  return { status, eventos };
}

/** Matchea el pedido de UNA versión por la directiva que `directivaDeVersion`
 *  suma al system prompt — mismo criterio que t2/t9. */
function matchVersion(indice: 1 | 2 | 3) {
  const fragmento = indice === 1 ? 'una sola oración' : indice === 2 ? 'Priorizá lo visual' : 'Priorizá el juego';
  return (body: Record<string, unknown>) => {
    const mensajes = body.messages as Array<{ role: string; content: unknown }> | undefined;
    const sistema = mensajes?.[0];
    return typeof sistema?.content === 'string' && sistema.content.includes(fragmento);
  };
}

interface RespuestaVerificar {
  ok: boolean;
  estado: 'ok' | 'desactivado' | 'sin-cupo' | 'error';
}

async function pedirVerificacion(
  page: Page,
  args: { projectId: string; fingerprint: string; tipo: 'nuevo' | 'ajuste' },
): Promise<{ status: number; body: RespuestaVerificar | null; texto: string }> {
  const respuesta = await page.request.post(`${BASE_URL}/api/chat/verificar`, { data: args });
  const status = respuesta.status();
  const texto = await respuesta.text();
  let body: RespuestaVerificar | null = null;
  try {
    body = JSON.parse(texto) as RespuestaVerificar;
  } catch {
    /* algunos status no traen el shape de RespuestaVerificar */
  }
  return { status, body, texto };
}

async function pedirAutocorreccion(
  page: Page,
  args: { projectId: string; fingerprint: string; ronda: 1 | 2 },
): Promise<{ status: number; eventos: EventoSse[] }> {
  const respuesta = await page.request.post(`${BASE_URL}/api/chat/autocorreccion`, {
    data: {
      projectId: args.projectId,
      fingerprint: args.fingerprint,
      ronda: args.ronda,
      errores: [],
      reinicioOk: null,
      exitoVisibleAlInicio: false,
      diferencias: { textoQueFalta: [], textoQueSobra: [], controles: [] },
    },
  });
  const status = respuesta.status();
  const texto = await respuesta.text();
  return { status, eventos: status === 200 ? eventosDe(texto) : [] };
}

async function main(): Promise<void> {
  const [orgA, orgB] = await Promise.all([
    prisma.organization.create({ data: { name: ORG_A_NAME, kind: 'CAMPUS' } }),
    prisma.organization.create({ data: { name: ORG_B_NAME, kind: 'CAMPUS' } }),
  ]);
  // odd/tasks/planes-y-cobros.md (T3): sin licencia, resolverAccesoIa deniega
  // con `license_missing` (fail-closed) — estas organizaciones de prueba
  // necesitan una MANUAL activa, igual que cualquier organización
  // preexistente (T1), para poder generar con la IA en este script.
  await prisma.organizationLicense.createMany({
    data: [
      { organizationId: orgA.id, status: 'MANUAL', declaredStudents: 0, createdVia: 'MANUAL' },
      { organizationId: orgB.id, status: 'MANUAL', declaredStudents: 0, createdVia: 'MANUAL' },
    ],
  });
  console.log(`✔ dos organizaciones CAMPUS de prueba creadas (${orgA.id}, ${orgB.id})`);

  const docenteId = await asegurarDocente(DOCENTE_EMAIL, DOCENTE_PASSWORD, 'Docente E2E (consumo-proposito)', orgA.id);

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  const browser = await abrirNavegador();
  let modelVerificadorId = '';
  const proyectosCreados: string[] = [];

  try {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await iniciarSesion(adminPage, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const modelGeneradorId = await asegurarMotorGenerador(adminPage, mock.url);
    console.log(`✔ motor generador listo (${modelGeneradorId})`);
    modelVerificadorId = await asegurarMotorVerificador(adminPage, mock.url);
    console.log(`✔ motor verificador listo, sin isVerifier todavía (${modelVerificadorId})`);

    const docenteContext = await browser.newContext();
    const docentePage = await docenteContext.newPage();
    await iniciarSesion(docentePage, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    // ───────────────────────────────────────────────────────────
    // 1 — primer turno de un proyecto NUEVO: GENERATION + CHECKLIST,
    //     los dos con forNewResource=true y la sede vigente del docente.
    // ───────────────────────────────────────────────────────────
    const proyecto1 = await crearProyecto(docentePage, 'Consumo — generación', modelGeneradorId);
    proyectosCreados.push(proyecto1.id);

    mock.llamadas.length = 0;
    mock.programarRespuesta({ html: htmlDePrueba('gen1'), chunkDelayMs: 5, chunkBytes: 20_000 });
    const turno1 = await enviarTurnoCrudo(docentePage, {
      projectId: proyecto1.id,
      threadId: proyecto1.threadId,
      message: 'Necesito un juego simple de sumas (CONSUMO-GEN)',
      modelId: modelGeneradorId,
    });
    assert.equal(turno1.status, 200, JSON.stringify(turno1));
    assert.equal(mock.llamadas.length, 2, 'recurso nuevo: checklist + turno principal');

    const filasProyecto1 = await prisma.tokenUsage.findMany({ where: { projectId: proyecto1.id } });
    assert.equal(filasProyecto1.length, 2, 'TokenUsage: 1 GENERATION + 1 CHECKLIST');
    const filaGen1 = filasProyecto1.find((f) => f.purpose === 'GENERATION');
    const filaChecklist1 = filasProyecto1.find((f) => f.purpose === 'CHECKLIST');
    assert.ok(filaGen1, 'tiene que haber una fila GENERATION');
    assert.ok(filaChecklist1, 'tiene que haber una fila CHECKLIST');
    assert.equal(filaGen1!.forNewResource, true, 'GENERATION: forNewResource=true');
    assert.equal(filaGen1!.organizationId, orgA.id, 'GENERATION: la sede vigente del docente');
    assert.equal(filaChecklist1!.forNewResource, true, 'CHECKLIST: forNewResource=true (recurso nuevo)');
    assert.equal(filaChecklist1!.organizationId, orgA.id, 'CHECKLIST: la sede vigente del docente');
    console.log('✔ 1: turno de creación → GENERATION + CHECKLIST, forNewResource=true, sede=orgA');

    // ───────────────────────────────────────────────────────────
    // 2 — verificación justo después del turno de creación: VERIFICATION
    //     hereda forNewResource=true de la última fila GENERATION.
    // ───────────────────────────────────────────────────────────
    await fijarIsVerifier(adminPage, modelVerificadorId, true);

    const proyecto1TrasGen = await proyectoActual(proyecto1.id);
    const fingerprintGen1 = fingerprintHtml(proyecto1TrasGen.currentHtml);

    mock.llamadas.length = 0;
    mock.programarRespuestaResponses({ texto: JSON.stringify({ problemas: [] }) });
    mock.programarRespuestaResponses({ texto: JSON.stringify({ problemas: [] }) });
    const verif1 = await pedirVerificacion(docentePage, { projectId: proyecto1.id, fingerprint: fingerprintGen1, tipo: 'nuevo' });
    assert.equal(verif1.status, 200, verif1.texto);
    assert.equal(verif1.body?.estado, 'ok', verif1.texto);

    const filasVerif1 = await prisma.tokenUsage.findMany({ where: { projectId: proyecto1.id, purpose: 'VERIFICATION' } });
    assert.equal(filasVerif1.length, 2, 'un recurso nuevo dispara 2 pasadas del verificador, cada una su fila');
    for (const fila of filasVerif1) {
      assert.equal(fila.forNewResource, true, 'VERIFICATION tras un turno de creación hereda forNewResource=true');
      assert.equal(fila.organizationId, orgA.id);
    }
    console.log('✔ 2: VERIFICATION tras la creación hereda forNewResource=true, sede=orgA');

    // ───────────────────────────────────────────────────────────
    // 3 — segundo turno del MISMO proyecto (ajuste): ADJUSTMENT,
    //     forNewResource=false, sin checklist.
    // ───────────────────────────────────────────────────────────
    mock.llamadas.length = 0;
    mock.programarRespuesta({ html: htmlDePrueba('adj1'), chunkDelayMs: 5, chunkBytes: 20_000 });
    const turno2 = await enviarTurnoCrudo(docentePage, {
      projectId: proyecto1.id,
      threadId: proyecto1.threadId,
      message: 'Cambiale el título a "Sumas para 2do grado" (CONSUMO-ADJ)',
      modelId: modelGeneradorId,
    });
    assert.equal(turno2.status, 200, JSON.stringify(turno2));
    assert.equal(mock.llamadas.length, 1, 'ajuste: sin checklist, sólo el turno principal');

    const filaAdj1 = await prisma.tokenUsage.findFirstOrThrow({ where: { projectId: proyecto1.id, purpose: 'ADJUSTMENT' } });
    assert.equal(filaAdj1.forNewResource, false, 'ADJUSTMENT: forNewResource=false');
    assert.equal(filaAdj1.organizationId, orgA.id);
    console.log('✔ 3: turno de ajuste → ADJUSTMENT, forNewResource=false, sede=orgA');

    // ───────────────────────────────────────────────────────────
    // 4 — autocorrección justo después del ajuste: CORRECTION hereda
    //     forNewResource=false de la última fila ADJUSTMENT.
    // ───────────────────────────────────────────────────────────
    const proyecto1TrasAjuste = await proyectoActual(proyecto1.id);
    const fingerprintAjuste = fingerprintHtml(proyecto1TrasAjuste.currentHtml);

    mock.llamadas.length = 0;
    mock.programarRespuesta({ html: htmlDePrueba('corr1'), chunkDelayMs: 5, chunkBytes: 20_000 });
    const correccion1 = await pedirAutocorreccion(docentePage, { projectId: proyecto1.id, fingerprint: fingerprintAjuste, ronda: 1 });
    assert.equal(correccion1.status, 200, JSON.stringify(correccion1));

    const filaCorr1 = await prisma.tokenUsage.findFirstOrThrow({ where: { projectId: proyecto1.id, purpose: 'CORRECTION' } });
    assert.equal(filaCorr1.forNewResource, false, 'CORRECTION tras un ajuste hereda forNewResource=false');
    assert.equal(filaCorr1.organizationId, orgA.id);
    console.log('✔ 4: CORRECTION tras un ajuste hereda forNewResource=false, sede=orgA');

    // ───────────────────────────────────────────────────────────
    // 5 — otro proyecto: autocorrección justo después de SU turno de
    //     creación: CORRECTION hereda forNewResource=true.
    // ───────────────────────────────────────────────────────────
    const proyecto2 = await crearProyecto(docentePage, 'Consumo — corrección tras creación', modelGeneradorId);
    proyectosCreados.push(proyecto2.id);

    mock.llamadas.length = 0;
    mock.programarRespuesta({ html: htmlDePrueba('gen2'), chunkDelayMs: 5, chunkBytes: 20_000 });
    const turno3 = await enviarTurnoCrudo(docentePage, {
      projectId: proyecto2.id,
      threadId: proyecto2.threadId,
      message: 'Necesito otro juego de restas (CONSUMO-GEN2)',
      modelId: modelGeneradorId,
    });
    assert.equal(turno3.status, 200, JSON.stringify(turno3));

    const proyecto2TrasGen = await proyectoActual(proyecto2.id);
    const fingerprintGen2 = fingerprintHtml(proyecto2TrasGen.currentHtml);

    mock.llamadas.length = 0;
    mock.programarRespuesta({ html: htmlDePrueba('corr2'), chunkDelayMs: 5, chunkBytes: 20_000 });
    const correccion2 = await pedirAutocorreccion(docentePage, { projectId: proyecto2.id, fingerprint: fingerprintGen2, ronda: 1 });
    assert.equal(correccion2.status, 200, JSON.stringify(correccion2));

    const filaCorr2 = await prisma.tokenUsage.findFirstOrThrow({ where: { projectId: proyecto2.id, purpose: 'CORRECTION' } });
    assert.equal(filaCorr2.forNewResource, true, 'CORRECTION tras un turno de creación hereda forNewResource=true');
    assert.equal(filaCorr2.organizationId, orgA.id);
    console.log('✔ 5: CORRECTION tras un turno de creación (otro proyecto) hereda forNewResource=true');

    await fijarIsVerifier(adminPage, modelVerificadorId, false);

    // ───────────────────────────────────────────────────────────
    // 6 — versiones extra al crear un recurso: EXTRA_VERSION (v2 y v3)
    //     con forNewResource=true directo, no heredado.
    // ───────────────────────────────────────────────────────────
    await fijarVersionsForAll(adminPage, true);
    const proyecto3 = await crearProyecto(docentePage, 'Consumo — versiones extra', modelGeneradorId);
    proyectosCreados.push(proyecto3.id);
    await habilitarVersionesEnProyecto(docentePage, proyecto3.id);

    mock.llamadas.length = 0;
    mock.programarRespuestaCondicional(matchVersion(1), { html: htmlDePrueba('v1'), chunkDelayMs: 5, chunkBytes: 5_000 });
    mock.programarRespuestaCondicional(matchVersion(2), { html: htmlDePrueba('v2'), chunkDelayMs: 5, chunkBytes: 5_000 });
    mock.programarRespuestaCondicional(matchVersion(3), { html: htmlDePrueba('v3'), chunkDelayMs: 5, chunkBytes: 5_000 });
    const turno4 = await enviarTurnoCrudo(docentePage, {
      projectId: proyecto3.id,
      threadId: proyecto3.threadId,
      message: 'Necesito un juego con variantes (CONSUMO-VER)',
      modelId: modelGeneradorId,
      variants: 3,
    });
    assert.equal(turno4.status, 200, JSON.stringify(turno4));
    assert.equal(mock.llamadas.length, 4, 'checklist + 3 versiones');

    const filasExtra = await prisma.tokenUsage.findMany({ where: { projectId: proyecto3.id, purpose: 'EXTRA_VERSION' } });
    assert.equal(filasExtra.length, 2, 'v2 y v3 registran su propia fila EXTRA_VERSION (v1 es la GENERATION principal)');
    for (const fila of filasExtra) {
      assert.equal(fila.forNewResource, true, 'EXTRA_VERSION: forNewResource=true, directo');
      assert.equal(fila.organizationId, orgA.id);
    }
    const filaGen3 = await prisma.tokenUsage.findFirstOrThrow({ where: { projectId: proyecto3.id, purpose: 'GENERATION' } });
    assert.equal(filaGen3.forNewResource, true);
    await fijarVersionsForAll(adminPage, false);
    console.log('✔ 6: v2 y v3 → EXTRA_VERSION, forNewResource=true directo (no heredado)');

    // ───────────────────────────────────────────────────────────
    // 7 — costo congelado por sede: mover al docente a otra organización
    //     no reescribe las filas viejas; las filas nuevas usan la sede nueva.
    // ───────────────────────────────────────────────────────────
    await prisma.user.update({ where: { id: docenteId }, data: { organizationId: orgB.id } });

    const proyecto4 = await crearProyecto(docentePage, 'Consumo — otra sede', modelGeneradorId);
    proyectosCreados.push(proyecto4.id);
    mock.llamadas.length = 0;
    mock.programarRespuesta({ html: htmlDePrueba('sedeB'), chunkDelayMs: 5, chunkBytes: 20_000 });
    const turno5 = await enviarTurnoCrudo(docentePage, {
      projectId: proyecto4.id,
      threadId: proyecto4.threadId,
      message: 'Necesito un tercer juego de multiplicaciones (CONSUMO-SEDE-B)',
      modelId: modelGeneradorId,
    });
    assert.equal(turno5.status, 200, JSON.stringify(turno5));

    const filaSedeB = await prisma.tokenUsage.findFirstOrThrow({ where: { projectId: proyecto4.id, purpose: 'GENERATION' } });
    assert.equal(filaSedeB.organizationId, orgB.id, 'una fila escrita DESPUÉS de mover de sede usa la sede NUEVA');

    const filaGen1Relectura = await prisma.tokenUsage.findUniqueOrThrow({ where: { id: filaGen1!.id } });
    assert.equal(filaGen1Relectura.organizationId, orgA.id, 'mover de sede NO reescribe filas viejas: quedan donde se pagó');
    console.log('✔ 7: costo congelado por sede — filas viejas intactas (orgA), filas nuevas con la sede nueva (orgB)');

    // ───────────────────────────────────────────────────────────
    // 8 — la demo (sin organización): organizationId siempre NULL. A nivel
    //     unitario, directo contra recordUsage — la demo es una cuenta
    //     compartida real y este chequeo no maneja su UI.
    // ───────────────────────────────────────────────────────────
    const demo = await asegurarCuentaDemo();
    const proyectoDemo = await prisma.project.create({
      data: { title: 'Consumo — demo', slug: `e2e-consumo-proposito-demo-${randomUUID()}`, userId: demo.id },
      select: { id: true },
    });
    proyectosCreados.push(proyectoDemo.id);

    await recordUsage({
      userId: demo.id,
      projectId: proyectoDemo.id,
      aiModelId: modelGeneradorId,
      model: 'modelo-de-prueba-demo',
      promptTokens: 500,
      cachedInputTokens: 0,
      completionTokens: 100,
      precios: null,
      purpose: 'GENERATION',
    });
    const filaDemo = await prisma.tokenUsage.findFirstOrThrow({ where: { projectId: proyectoDemo.id } });
    assert.equal(filaDemo.organizationId, null, 'la demo (sin organización) siempre escribe organizationId NULL');
    console.log('✔ 8: la cuenta de demo escribe organizationId NULL (nivel unitario, vía recordUsage)');

    console.log('\n✔ e2e/consumo-proposito.ts: todas las comprobaciones pasaron');
  } finally {
    try {
      const adminContext2 = await browser.newContext();
      const adminPage2 = await adminContext2.newPage();
      await iniciarSesion(adminPage2, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      if (modelVerificadorId) await fijarIsVerifier(adminPage2, modelVerificadorId, false);
      await fijarVersionsForAll(adminPage2, false);
      await adminContext2.close();
      console.log('✔ limpieza: isVerifier apagado, versionsForAll apagado');
    } catch (error) {
      console.error('[consumo-proposito] no se pudo restaurar el estado de admin al final:', error);
    }

    try {
      await prisma.tokenUsage.deleteMany({ where: { OR: [{ userId: docenteId }, { projectId: { in: proyectosCreados } }] } });
      for (const projectId of proyectosCreados) {
        await prisma.project.delete({ where: { id: projectId } }).catch(() => {});
      }
      // Las dos organizaciones de prueba: borrarlas deja `User.organizationId`
      // (onDelete: SetNull) en NULL — no hace falta mover al docente antes.
      await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
      console.log('✔ limpieza: TokenUsage/proyectos de prueba y las 2 organizaciones borrados');
    } catch (error) {
      console.error('[consumo-proposito] no se pudo limpiar el estado al final:', error);
    }

    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
console.log('\n✔ e2e/consumo-proposito.ts: terminado');
