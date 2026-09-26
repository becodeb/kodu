import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { fingerprintHtml } from '../src/lib/ai/revision-visual.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';
import type { BrowserContext, Page } from 'playwright';

/**
 * Chequeo de API de T3 (`odd/tasks/verificador.md`): `POST /api/chat/verificar`
 * y el insumo `problemasVerificador` de `POST /api/chat/autocorreccion`.
 *
 * Requiere la pila de desarrollo levantada (`docker compose up -d db`,
 * `npm run dev` en el puerto 3000) y el mock de `e2e/mock-proveedor.ts` — el
 * MISMO mock sirve `/v1/chat/completions` (el motor generador del proyecto,
 * reusando el `kodu-mock-t3` que ya dejaron T3/T8/T11/T12 de
 * `modo-prime`/`arnes-robustez`) y `/v1/responses` (el motor verificador,
 * una cuenta NUEVA propia de esta tarea, `apiFormat: 'responses'`).
 *
 * Corre con: npx tsx e2e/verificador-endpoint.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-t3-verificador@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const PROVIDER_GENERADOR_KIND = 'kodu-mock-t3';
const PROVIDER_GENERADOR_LABEL = 'Mock local (T3+, e2e/mock-proveedor.ts)';
const MODEL_GENERADOR_PROVIDER_MODEL = 'mock-t3';
const MODEL_GENERADOR_DISPLAY_NAME = 'Mock local (T3+)';

const PROVIDER_VERIFICADOR_KIND = 'kodu-mock-verificador-t3';
const PROVIDER_VERIFICADOR_LABEL = 'Mock local (T3, verificador, e2e/mock-proveedor.ts)';
const MODEL_VERIFICADOR_PROVIDER_MODEL = 'mock-verificador-t3';
const MODEL_VERIFICADOR_DISPLAY_NAME = 'Mock verificador (T3)';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

function documento(marca: string, extraHead = ''): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="pizarron">
${extraHead}
<title>T3 verificador ${marca}</title>
</head>
<body data-marca="${marca}">
  <h1>Practicá fracciones equivalentes</h1>
  <button id="reiniciar" type="button">Reiniciar</button>
  <script>function reiniciar(){}</script>
  <script data-kodu-pruebas>try{eval("window.__koduPruebas=[{id:'c1',prueba:async t=>({ok:true,detalle:''})}]")}catch(e){window.__koduPruebasError=String(e)}</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// Helpers (mismo patrón que e2e/t8-revision-visual.ts / t12-checklist-pruebas.ts)
// ─────────────────────────────────────────────────────────────

async function asegurarDocente(email: string, password: string, nombre: string): Promise<string> {
  const fila = await prisma.user.upsert({
    where: { email },
    update: { role: 'DOCENTE' },
    create: { email, name: nombre, role: 'DOCENTE', passwordHash: await hashPassword(password) },
    select: { id: true },
  });
  return fila.id;
}

/** El motor GENERADOR del proyecto (Chat Completions) — reusa la cuenta
 *  compartida `kodu-mock-t3` que ya dejaron otras tareas, mismo criterio
 *  que t8/t11/t12. */
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

/** El motor VERIFICADOR (Responses API): cuenta NUEVA, propia de T3 — nadie
 *  más la necesita, así que se crea de cero cada corrida (reusa si ya
 *  existe, para no acumular basura entre corridas sucesivas). Arranca SIN
 *  `isVerifier` — cada escena lo prende/apaga a propósito. */
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

  // Siempre arranca SIN isVerifier: la escena "desactivado" depende de esto.
  // Through the admin API, not Prisma: only the API calls invalidarCatalogo(),
  // and the server caches the catalog for 30 s (a previous suite may have
  // left the flag on in that cache).
  await fijarIsVerifier(adminPage, modelId, false);

  return modelId;
}

async function fijarIsVerifier(adminPage: Page, modelId: string, valor: boolean): Promise<void> {
  const respuesta = await adminPage.request.patch(`${BASE_URL}/api/admin/models/${modelId}`, {
    data: { isVerifier: valor },
  });
  assert.ok(respuesta.ok(), `PATCH isVerifier=${valor}: ${respuesta.status()} ${await respuesta.text()}`);
}

async function crearProyecto(page: Page, title: string, modelId: string): Promise<{ id: string; threadId: string }> {
  const creado = await page.request.post(`${BASE_URL}/api/projects`, { data: { title } });
  assert.equal(creado.status(), 200, `alta del proyecto "${title}": ${creado.status()} ${await creado.text()}`);
  const { project } = (await creado.json()) as { project: { id: string; threadId: string } };
  await prisma.project.update({ where: { id: project.id }, data: { aiModelId: modelId } });
  return project;
}

async function agregarMensajeDocente(threadId: string, contenido: string): Promise<void> {
  await prisma.chatMessage.create({ data: { threadId, role: 'user', content: contenido } });
}

async function fijarHtml(projectId: string, html: string): Promise<void> {
  await prisma.project.update({ where: { id: projectId }, data: { currentHtml: html } });
}

interface RespuestaVerificar {
  ok: boolean;
  estado: 'ok' | 'desactivado' | 'sin-cupo' | 'error';
  problemas?: Array<{ gravedad: string; tipo: string; que: string; como_reproducir: string; arreglo: string }>;
  pasadas?: number;
  fallidas?: number;
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
    /* algunos status (409, 422) no traen el shape de RespuestaVerificar */
  }
  return { status, body, texto };
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

interface RespuestaAutocorreccionInput {
  projectId: string;
  fingerprint: string;
  ronda: 1 | 2;
  problemasVerificador?: Array<{ gravedad: string; tipo: string; que: string; como_reproducir: string; arreglo: string }>;
}

async function pedirAutocorreccion(page: Page, args: RespuestaAutocorreccionInput): Promise<{ status: number; eventos: EventoSse[] }> {
  const respuesta = await page.request.post(`${BASE_URL}/api/chat/autocorreccion`, {
    data: {
      projectId: args.projectId,
      fingerprint: args.fingerprint,
      ronda: args.ronda,
      errores: [],
      reinicioOk: null,
      exitoVisibleAlInicio: false,
      diferencias: { textoQueFalta: [], textoQueSobra: [], controles: [] },
      ...(args.problemasVerificador ? { problemasVerificador: args.problemasVerificador } : {}),
    },
  });
  const status = respuesta.status();
  const texto = await respuesta.text();
  return { status, eventos: status === 200 ? eventosDe(texto) : [] };
}

interface CuerpoResponses {
  input?: Array<{ role: string; content: unknown }>;
  tools?: unknown;
  tool_choice?: unknown;
  reasoning?: { effort?: string };
}

interface CuerpoChat {
  messages?: Array<{ role: string; content: unknown }>;
}

async function proyectoActual(id: string): Promise<{ currentHtml: string }> {
  return prisma.project.findUniqueOrThrow({ where: { id }, select: { currentHtml: true } });
}

async function main(): Promise<void> {
  await asegurarDocente(DOCENTE_EMAIL, DOCENTE_PASSWORD, 'Docente E2E T3 (verificador)');

  const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
  console.log(`✔ mock-proveedor escuchando en ${mock.url}`);

  const browser = await abrirNavegador();
  let modelVerificadorId = '';
  const proyectosCreados: string[] = [];

  try {
    const adminContext: BrowserContext = await browser.newContext();
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
    // Proyecto A: las escenas de POST /api/chat/verificar.
    // ───────────────────────────────────────────────────────────
    const proyectoA = await crearProyecto(docentePage, 'T3 — verificador', modelGeneradorId);
    proyectosCreados.push(proyectoA.id);

    const PEDIDO_ORIGINAL = 'Necesito un simulador de fracciones equivalentes (VERIFICADOR-A)';
    await agregarMensajeDocente(proyectoA.threadId, PEDIDO_ORIGINAL);

    const htmlA = documento('a1');
    await fijarHtml(proyectoA.id, htmlA);
    const fingerprintA = fingerprintHtml(htmlA);

    // Escena 1 — sin motor verificador: "desactivado", CERO llamadas.
    mock.llamadas.length = 0;
    const respuestaDesactivada = await pedirVerificacion(docentePage, { projectId: proyectoA.id, fingerprint: fingerprintA, tipo: 'nuevo' });
    assert.equal(respuestaDesactivada.status, 200, respuestaDesactivada.texto);
    assert.equal(respuestaDesactivada.body?.estado, 'desactivado');
    assert.equal(mock.llamadas.length, 0, 'sin motor verificador, no se tiene que llamar a NADA');
    console.log('✔ escena 1: sin motor verificador → {estado:"desactivado"}, cero llamadas');

    // Prende el verificador para el resto de las escenas.
    await fijarIsVerifier(adminPage, modelVerificadorId, true);

    // Escena 2 — "nuevo": 2 pasadas en paralelo, se combinan.
    mock.llamadas.length = 0;
    mock.programarRespuestaResponses({
      texto: JSON.stringify({
        problemas: [
          {
            gravedad: 'alta',
            tipo: 'logica',
            que: 'El botón de reiniciar no vuelve el contador a cero',
            como_reproducir: 'Sumá 3 puntos, tocá "Reiniciar" y el contador sigue en 3',
            arreglo: 'Llamar a reiniciarContador() dentro de reiniciar()',
          },
        ],
      }),
    });
    mock.programarRespuestaResponses({
      texto: JSON.stringify({
        problemas: [
          {
            gravedad: 'media',
            tipo: 'contenido',
            que: 'La fecha de la Revolución de Mayo está mal en el paso 2',
            como_reproducir: 'Mirá el texto del paso 2: dice 1816 en vez de 1810',
            arreglo: 'Corregir la fecha a 1810',
          },
        ],
      }),
    });

    const respuestaNueva = await pedirVerificacion(docentePage, { projectId: proyectoA.id, fingerprint: fingerprintA, tipo: 'nuevo' });
    assert.equal(respuestaNueva.status, 200, respuestaNueva.texto);
    assert.equal(respuestaNueva.body?.estado, 'ok');
    assert.equal(respuestaNueva.body?.pasadas, 2);
    assert.equal(respuestaNueva.body?.fallidas, 0);
    assert.equal(respuestaNueva.body?.problemas?.length, 2, 'tipos y textos distintos: no se fusionan');
    assert.equal(respuestaNueva.body?.problemas?.[0]?.gravedad, 'alta', 'ordenado por gravedad, la más grave primero');
    assert.equal(mock.llamadas.length, 2, 'un recurso NUEVO dispara 2 pasadas en paralelo');
    console.log('✔ escena 2 (1/2): "nuevo" → estado ok, 2 pasadas, 2 problemas combinados y ordenados por gravedad');

    for (const llamada of mock.llamadas) {
      const cuerpo = llamada.body as CuerpoResponses;
      assert.ok(!('tools' in cuerpo), 'el verificador nunca ofrece herramientas (sinHerramientas)');
      assert.ok(!('tool_choice' in cuerpo), 'sin tools, tampoco puede haber tool_choice');
      assert.equal(cuerpo.reasoning?.effort, 'medium', 'razonamiento "medium" fijo para el verificador');

      const sistema = cuerpo.input?.[0]?.content;
      assert.equal(typeof sistema, 'string');
      assert.ok((sistema as string).includes('## Que funcione de verdad'), 'el prompt de sistema lleva las reglas del arnés');

      const usuario = cuerpo.input?.[1]?.content;
      assert.equal(typeof usuario, 'string');
      assert.ok((usuario as string).includes(PEDIDO_ORIGINAL), 'el pedido del docente viaja en el mensaje de usuario');
      assert.ok(!(usuario as string).includes('__koduPruebas'), 'el HTML plegado no puede traer el JSON de pruebas en claro');
      assert.ok((usuario as string).includes('<!-- pruebas automáticas plegadas -->'), 'las pruebas quedan plegadas a un comentario');
    }
    console.log('✔ escena 2 (2/2): sin tools/tool_choice, reasoning.effort "medium", HTML con las pruebas plegadas');

    const usosTrasNuevo = await prisma.tokenUsage.count({ where: { projectId: proyectoA.id } });
    assert.equal(usosTrasNuevo, 2, 'una fila de TokenUsage por pasada que devolvió usage');
    console.log('✔ escena 2: 2 TokenUsage (una por pasada)');

    // Escena 3 — "ajuste": 1 pasada, el pedido incluye el ÚLTIMO mensaje.
    const PEDIDO_AJUSTE = 'Ahora agregale un cronómetro visible (VERIFICADOR-A-AJUSTE)';
    await agregarMensajeDocente(proyectoA.threadId, PEDIDO_AJUSTE);

    mock.llamadas.length = 0;
    mock.programarRespuestaResponses({
      texto: JSON.stringify({
        problemas: [
          {
            gravedad: 'baja',
            tipo: 'uso',
            que: 'El botón del cronómetro es muy chico para tocar en el celular',
            como_reproducir: 'Abrí el recurso en una pantalla de celular e intentá tocarlo',
            arreglo: 'Agrandar el área táctil del botón',
          },
        ],
      }),
    });

    const respuestaAjuste = await pedirVerificacion(docentePage, { projectId: proyectoA.id, fingerprint: fingerprintA, tipo: 'ajuste' });
    assert.equal(respuestaAjuste.status, 200, respuestaAjuste.texto);
    assert.equal(respuestaAjuste.body?.estado, 'ok');
    assert.equal(respuestaAjuste.body?.pasadas, 1, 'un ajuste corre UNA sola pasada');
    assert.equal(mock.llamadas.length, 1);

    const cuerpoAjuste = mock.llamadas[0]!.body as CuerpoResponses;
    const usuarioAjuste = cuerpoAjuste.input?.[1]?.content as string;
    assert.ok(usuarioAjuste.includes(PEDIDO_ORIGINAL), 'el pedido ORIGINAL sigue viajando');
    assert.ok(usuarioAjuste.includes('## Último pedido (ajuste)'), 'un ajuste etiqueta el último pedido aparte');
    assert.ok(usuarioAjuste.includes(PEDIDO_AJUSTE), 'y cita el texto del último pedido');
    console.log('✔ escena 3: "ajuste" → 1 sola pasada, el pedido lleva el original + el último etiquetado');

    const usosTrasAjuste = await prisma.tokenUsage.count({ where: { projectId: proyectoA.id } });
    assert.equal(usosTrasAjuste, 3, '2 (nuevo) + 1 (ajuste)');

    // Escena 4 — huella vieja: 409, sin llamar a nada.
    mock.llamadas.length = 0;
    const respuesta409 = await pedirVerificacion(docentePage, { projectId: proyectoA.id, fingerprint: 'deadbeef', tipo: 'nuevo' });
    assert.equal(respuesta409.status, 409, respuesta409.texto);
    assert.equal(mock.llamadas.length, 0, 'con la huella desactualizada, el motor NUNCA se llama');
    console.log('✔ escena 4: huella vieja → 409, sin llamar al motor');

    // Escena 5 — el mock devuelve basura: "error", nunca un 500 ni un tirón.
    mock.llamadas.length = 0;
    mock.programarRespuestaResponses({ texto: 'esto no es JSON en absoluto, ni con problemas ni sin ellos' });
    const respuestaError = await pedirVerificacion(docentePage, { projectId: proyectoA.id, fingerprint: fingerprintA, tipo: 'ajuste' });
    assert.equal(respuestaError.status, 200, respuestaError.texto);
    assert.equal(respuestaError.body?.estado, 'error');
    assert.equal(mock.llamadas.length, 1);
    console.log('✔ escena 5: respuesta no parseable → {estado:"error"}, 200 (nunca un 500)');

    // ───────────────────────────────────────────────────────────
    // Proyecto B: POST /api/chat/autocorreccion con problemasVerificador.
    // ───────────────────────────────────────────────────────────
    const proyectoB = await crearProyecto(docentePage, 'T3 — autocorrección desde el verificador', modelGeneradorId);
    proyectosCreados.push(proyectoB.id);
    const htmlB = documento('b1');
    await fijarHtml(proyectoB.id, htmlB);
    const fingerprintB = fingerprintHtml(htmlB);

    const htmlCorregidoB = documento('b1-corregido');
    mock.llamadas.length = 0;
    mock.programarRespuesta({ texto: '', html: htmlCorregidoB, chunkDelayMs: 5, chunkBytes: 20_000 });

    const respuestaCorreccion = await pedirAutocorreccion(docentePage, {
      projectId: proyectoB.id,
      fingerprint: fingerprintB,
      ronda: 1,
      problemasVerificador: [
        {
          gravedad: 'alta',
          tipo: 'logica',
          que: 'QUE-ACCIONABLE-VERIFICADOR',
          como_reproducir: 'COMO-REPRODUCIR-ACCIONABLE-VERIFICADOR',
          arreglo: 'ARREGLO-ACCIONABLE-VERIFICADOR',
        },
        {
          gravedad: 'media',
          tipo: 'contenido',
          que: 'QUE-DE-CONTENIDO-VERIFICADOR',
          como_reproducir: 'COMO-REPRODUCIR-DE-CONTENIDO-VERIFICADOR',
          arreglo: 'ARREGLO-DE-CONTENIDO-VERIFICADOR',
        },
      ],
    });
    assert.equal(respuestaCorreccion.status, 200);
    const doneCorreccion = respuestaCorreccion.eventos.find((e) => e.type === 'done');
    assert.equal(doneCorreccion?.codeUpdated, true, 'la corrección tiene que haber aplicado el HTML nuevo');

    assert.equal(mock.llamadas.length, 1, 'una sola llamada al motor GENERADOR (Chat Completions), no al verificador');
    const cuerpoCorreccion = mock.llamadas[0]!.body as CuerpoChat;
    const mensajeCorreccion = cuerpoCorreccion.messages?.at(-1)?.content as string;
    assert.ok(mensajeCorreccion.includes('QUE-ACCIONABLE-VERIFICADOR'));
    assert.ok(mensajeCorreccion.includes('COMO-REPRODUCIR-ACCIONABLE-VERIFICADOR'));
    assert.ok(mensajeCorreccion.includes('ARREGLO-ACCIONABLE-VERIFICADOR'));
    assert.ok(!mensajeCorreccion.includes('QUE-DE-CONTENIDO-VERIFICADOR'), 'un problema "contenido" nunca puede colarse en la corrección');
    assert.ok(!mensajeCorreccion.includes('COMO-REPRODUCIR-DE-CONTENIDO-VERIFICADOR'));
    assert.ok(!mensajeCorreccion.includes('ARREGLO-DE-CONTENIDO-VERIFICADOR'));
    console.log('✔ escena 6 (1/2): autocorrección desde problemasVerificador — cita lo accionable, filtra "contenido"');

    const proyectoBTrasCorreccion = await proyectoActual(proyectoB.id);
    assert.ok(proyectoBTrasCorreccion.currentHtml.includes('data-marca="b1-corregido"'), 'el HTML corregido queda persistido');
    console.log('✔ escena 6 (2/2): Project.currentHtml queda con el HTML corregido');

    console.log('\n✔ e2e/verificador-endpoint.ts: todas las comprobaciones pasaron');
  } finally {
    try {
      // Nunca dejar el flag prendido en la base de dev (instrucción del
      // encargo): se apaga pase lo que pase, incluso si algo de arriba tiró.
      if (modelVerificadorId) {
        await prisma.aiModel.update({ where: { id: modelVerificadorId }, data: { isVerifier: false } }).catch(() => {});
      }
      for (const projectId of proyectosCreados) {
        await prisma.project.delete({ where: { id: projectId } }).catch(() => {});
      }
      console.log('✔ limpieza: isVerifier apagado, proyectos de prueba borrados');
    } catch (error) {
      console.error('[verificador-endpoint] no se pudo limpiar el estado al final:', error);
    }

    await browser.close();
    await mock.detener();
    await prisma.$disconnect();
  }
}

await main();
console.log('\n✔ e2e/verificador-endpoint.ts: terminado');
