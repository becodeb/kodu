import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { request, type APIRequestContext } from 'playwright';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { MARCADOR_SISTEMA_TALLER } from '../src/lib/taller/prompt.ts';
import { iniciarMockProveedor, PUERTO_POR_DEFECTO } from './mock-proveedor.ts';

/**
 * Taller de ideas de punta a punta (odd/tasks/taller-de-ideas.md), contra el
 * servidor de desarrollo y el proveedor simulado. Sin navegador: sólo HTTP
 * (el `APIRequestContext` de Playwright guarda la cookie de sesión).
 *
 * Cubre: las dos puertas, un turno con el bloque <taller> repartido en
 * pedazos (que nunca llegue al navegador como texto), ideas propuestas, el
 * pedido final, la edición a mano y su aviso al modelo, adjuntos (SVG
 * rechazado), un turno a la vez por charla, el consumo IDEATION sin
 * recurso, "Crear mi recurso" (título, adjuntos copiados, vínculo, sólo
 * lectura después), el pedido que el editor manda solo, y que otra cuenta
 * no pueda ver ni tocar la charla.
 *
 * Requiere la pila de desarrollo levantada (base + `npm run dev`). Corre con:
 *   npx tsx e2e/taller-de-ideas.ts
 * `KODU_BASE_URL` cambia el servidor (por defecto http://localhost:3000).
 */

const BASE_URL = process.env.KODU_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-taller@kodu.local';
const OTRO_EMAIL = 'otro-e2e-taller@kodu.local';
const PERSONAL_EMAIL = 'personal-e2e-taller@kodu.local';
const PASSWORD = 'Docente.E2E.2026';

const PROVIDER_KIND = 'kodu-mock-t3';
const MODEL_PROVIDER_MODEL = 'mock-t3';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }) });

let fallas = 0;
async function prueba(nombre: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✔ ${nombre}`);
  } catch (error) {
    fallas++;
    console.error(`✖ ${nombre}`);
    console.error(`  ${(error as Error).stack ?? (error as Error).message}`);
  }
}

async function contexto(email: string, password: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Origin: BASE_URL } });
  const respuesta = await ctx.post('/api/auth/login', { data: { email, password } });
  assert.equal(respuesta.status(), 200, `login de ${email}: ${respuesta.status()} ${await respuesta.text()}`);
  return ctx;
}

async function balanceDe(userId: string): Promise<number> {
  const total = await prisma.creditLedgerEntry.aggregate({ where: { userId }, _sum: { delta: true } });
  return total._sum.delta ?? 0;
}

async function asegurarUsuario(email: string, nombre: string, aiAccessOverride: boolean | null): Promise<string> {
  const fila = await prisma.user.upsert({
    where: { email },
    update: { role: 'DOCENTE', aiAccessOverride, organizationId: null },
    create: {
      email,
      name: nombre,
      role: 'DOCENTE',
      passwordHash: await hashPassword(PASSWORD),
      aiAccessOverride,
      emailVerifiedAt: new Date(),
      emailVerificationSource: 'NO_PROVIDER',
    },
    select: { id: true },
  });
  return fila.id;
}

/** El motor simulado, como motor PREDETERMINADO (el Taller usa siempre ése). */
async function asegurarMotorMockPorDefecto(admin: APIRequestContext, mockUrl: string): Promise<string> {
  let proveedor = await prisma.aiProvider.findFirst({ where: { kind: PROVIDER_KIND } });
  if (!proveedor) {
    const respuesta = await admin.post('/api/admin/providers', {
      data: { kind: PROVIDER_KIND, label: 'Mock local (e2e)', baseUrl: mockUrl, apiKey: 'clave-de-prueba-del-mock' },
    });
    assert.equal(respuesta.status(), 200, `alta de la cuenta mock: ${await respuesta.text()}`);
    const id = ((await respuesta.json()) as { proveedor: { id: string } }).proveedor.id;
    proveedor = await prisma.aiProvider.findUniqueOrThrow({ where: { id } });
  }

  let motor = await prisma.aiModel.findFirst({ where: { providerId: proveedor.id, providerModel: MODEL_PROVIDER_MODEL } });
  if (!motor) {
    const respuesta = await admin.post('/api/admin/models', {
      data: { providerId: proveedor.id, providerModel: MODEL_PROVIDER_MODEL, displayName: 'Mock local (e2e)', selectableByTeacher: true },
    });
    assert.equal(respuesta.status(), 200, `alta del motor mock: ${await respuesta.text()}`);
    const id = ((await respuesta.json()) as { motor: { id: string } }).motor.id;
    motor = await prisma.aiModel.findUniqueOrThrow({ where: { id } });
  }

  // odd/tasks/ahorro-tokens.md (T2): razonamiento configurado "high" a
  // propósito — así el turno siguiente puede afirmar que una cuenta FREE lo
  // recibe apagado ("none") y no "high".
  const patch = await admin.patch(`/api/admin/models/${motor.id}`, {
    data: { isDefault: true, enabled: true, reasoningEffort: 'high', reasoningParam: 'reasoning_effort' },
  });
  assert.equal(patch.status(), 200, `motor mock como default: ${await patch.text()}`);
  return motor.id;
}

interface Evento {
  type: string;
  delta?: string;
  message?: unknown;
  [clave: string]: unknown;
}

/** Manda un turno y devuelve todos los eventos del SSE. */
async function turno(ctx: APIRequestContext, sesionId: string, mensaje: string, attachmentUrls?: string[]) {
  const respuesta = await ctx.post(`/api/taller/${sesionId}/turno`, {
    data: { message: mensaje, attachmentUrls },
    timeout: 60_000,
  });
  if (respuesta.status() !== 200) return { status: respuesta.status(), eventos: [] as Evento[], cuerpo: await respuesta.text() };

  const eventos = (await respuesta.text())
    .split('\n\n')
    .map((bloque) => bloque.split('\n').filter((linea) => linea.startsWith('data:')).map((linea) => linea.slice(5).trim()).join(''))
    .filter(Boolean)
    .map((json) => JSON.parse(json) as Evento);
  return { status: 200, eventos, cuerpo: '' };
}

function respuestaTaller(visible: string, bloque: Record<string, unknown>): string {
  return `${visible}\n\n<taller>\n${JSON.stringify(bloque)}\n</taller>`;
}

const esDelTaller = (body: Record<string, unknown>) => {
  const mensajes = body.messages as Array<{ content: unknown }> | undefined;
  return typeof mensajes?.[0]?.content === 'string' && (mensajes[0]!.content as string).startsWith(MARCADOR_SISTEMA_TALLER);
};

// Un PNG de 1×1.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const mock = await iniciarMockProveedor({ puerto: PUERTO_POR_DEFECTO });
const mockUrl = `http://localhost:${PUERTO_POR_DEFECTO}`;

const docenteId = await asegurarUsuario(DOCENTE_EMAIL, 'Docente Taller E2E', true);
await asegurarUsuario(OTRO_EMAIL, 'Otra Docente E2E', true);
const personalId = await asegurarUsuario(PERSONAL_EMAIL, 'Cuenta Personal E2E', null);
await prisma.ideaSession.deleteMany({ where: { user: { email: { in: [DOCENTE_EMAIL, OTRO_EMAIL] } } } });
await prisma.project.deleteMany({ where: { user: { email: DOCENTE_EMAIL } } });
await prisma.tokenUsage.deleteMany({ where: { userId: docenteId } });
// odd/tasks/planes-y-cobros.md (T10): correr este script más de una vez no
// debe arrastrar el saldo de créditos de la cuenta personal de una corrida
// anterior — se arranca siempre desde cero, sin ningún movimiento.
await prisma.creditLedgerEntry.deleteMany({ where: { userId: personalId } });

const admin = await contexto(ADMIN_EMAIL, ADMIN_PASSWORD);
const motorId = await asegurarMotorMockPorDefecto(admin, mockUrl);
const docente = await contexto(DOCENTE_EMAIL, PASSWORD);
const otro = await contexto(OTRO_EMAIL, PASSWORD);
const personal = await contexto(PERSONAL_EMAIL, PASSWORD);

let sesionId = '';
let projectId = '';
let urlImagen = '';

await prueba('una cuenta personal CON créditos puede abrir el Taller', async () => {
  // odd/tasks/planes-y-cobros.md (T10, defecto encontrado por la otra
  // sesión): una cuenta personal sin organización ya no está bloqueada sin
  // más — tiene créditos (bienvenida + mensual del plan Gratis), y la regla
  // de acceso a la IA (`resolverAccesoIa`) la deja pasar mientras tenga
  // saldo. El Taller tiene que seguir EXACTAMENTE esa misma regla.
  const respuesta = await personal.post('/api/taller', { data: { mode: 'TOPIC' } });
  assert.equal(respuesta.status(), 200, await respuesta.text());
  const pagina = await personal.get('/app/taller', { maxRedirects: 0 });
  assert.equal(pagina.status(), 200);
});

await prueba('una cuenta personal SIN créditos no puede abrir el Taller', async () => {
  const saldoActual = await balanceDe(personalId);
  await prisma.creditLedgerEntry.create({ data: { userId: personalId, delta: -saldoActual, kind: 'ADJUSTMENT' } });
  assert.equal(await balanceDe(personalId), 0);

  const respuesta = await personal.post('/api/taller', { data: { mode: 'TOPIC' } });
  assert.equal(respuesta.status(), 403);
  const cuerpo = (await respuesta.json()) as { reason?: string; error?: string };
  assert.equal(cuerpo.reason, 'no_credits', 'la razón máquina debe ser no_credits, igual que el resto de la app');
  assert.ok(cuerpo.error?.includes('sin créditos'), 'el mensaje debe ser el real de "sin créditos", no el genérico viejo');

  const pagina = await personal.get('/app/taller', { maxRedirects: 0 });
  assert.equal(pagina.status(), 302);
});

await prueba('la puerta "tengo un tema" arranca con la pregunta fija, sin gastar IA', async () => {
  const llamadasAntes = mock.llamadas.length;
  const respuesta = await docente.post('/api/taller', { data: { mode: 'TOPIC' } });
  assert.equal(respuesta.status(), 200, await respuesta.text());
  const cuerpo = (await respuesta.json()) as { id: string; redirect: string };
  sesionId = cuerpo.id;
  assert.equal(cuerpo.redirect, `/app/taller/${sesionId}`);

  const estado = (await (await docente.get(`/api/taller/${sesionId}`)).json()) as {
    session: { messages: Array<{ role: string; questions: unknown[] }> };
  };
  assert.equal(estado.session.messages.length, 1);
  assert.equal(estado.session.messages[0]!.role, 'assistant');
  assert.equal(estado.session.messages[0]!.questions.length, 3);
  assert.equal(mock.llamadas.length, llamadasAntes, 'abrir una charla no le pega al proveedor');

  const pagina = await docente.get(`/app/taller/${sesionId}`);
  assert.equal(pagina.status(), 200);
  assert.ok((await pagina.text()).includes('Tu idea'));
});

await prueba('un turno: el bloque <taller> nunca llega como texto y la ficha se guarda', async () => {
  mock.programarRespuestaCondicional(esDelTaller, {
    llamarHerramienta: false,
    texto: respuestaTaller('Entonces vas a dar palancas en 6.º grado y les cuesta ver la fuerza.', {
      preguntas: [
        { texto: '¿Cómo la van a usar?', opciones: ['Proyector', 'Tablets'], multiple: false },
        { texto: '¿Qué tienen que poder hacer al final?', opciones: [], multiple: false },
      ],
      ficha: { tema: 'Palancas', nivel: '6.º grado' },
      ideas: [],
      titulo: null,
      descripcion: null,
      pedido: null,
    }),
    usage: { prompt_tokens: 1200, completion_tokens: 300 },
  });

  const { status, eventos, cuerpo } = await turno(docente, sesionId, '¿Qué tema vas a dar? → Palancas\n6.º grado');
  assert.equal(status, 200, cuerpo);

  const texto = eventos.filter((evento) => evento.type === 'text').map((evento) => evento.delta).join('');
  assert.ok(texto.includes('palancas en 6.º grado'), `texto recibido: ${texto}`);
  assert.ok(!texto.includes('<'), 'nada del bloque se filtró al texto en vivo');

  const done = eventos.find((evento) => evento.type === 'done') as unknown as {
    brief: Record<string, string>;
    message: { content: string; questions: unknown[] };
  };
  assert.ok(done, `eventos: ${JSON.stringify(eventos.map((evento) => evento.type))}`);
  assert.equal(done.brief.tema, 'Palancas');
  assert.equal(done.message.questions.length, 2);
  assert.ok(!done.message.content.includes('<taller>'));

  const ultimaLlamada = mock.llamadas.at(-1)!.body as {
    tools?: unknown;
    messages: Array<{ content: string }>;
    reasoning_effort?: string;
  };
  assert.equal(ultimaLlamada.tools, undefined, 'el Taller pide sin herramientas');
  assert.ok(ultimaLlamada.messages.at(-1)!.content.includes('Palancas'));

  // odd/tasks/ahorro-tokens.md (T2): DOCENTE_EMAIL es una cuenta PERSONAL sin
  // ninguna IndividualSubscription cargada ("sin fila = FREE") — el motor
  // está configurado en "high" (ver asegurarMotorMockPorDefecto), así que si
  // el pedido real llegó en "none" es porque el Taller apagó el razonamiento
  // para este docente, no porque el motor lo tuviera así de entrada.
  assert.equal(
    ultimaLlamada.reasoning_effort,
    'none',
    'una cuenta personal FREE tiene que mandar el turno del Taller con el razonamiento apagado',
  );

  const mensajes = await prisma.ideaMessage.findMany({ where: { sessionId: sesionId }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(
    mensajes.map((mensaje) => mensaje.role),
    ['assistant', 'user', 'assistant'],
  );
});

await prueba('el consumo queda como IDEATION, sin recurso', async () => {
  const filas = await prisma.tokenUsage.findMany({ where: { userId: docenteId } });
  assert.equal(filas.length, 1);
  assert.equal(filas[0]!.purpose, 'IDEATION');
  assert.equal(filas[0]!.projectId, null);
  assert.equal(filas[0]!.aiModelId, motorId);
  assert.equal(filas[0]!.forNewResource, null);
});

await prueba('las ideas propuestas se guardan con la respuesta', async () => {
  mock.programarRespuestaCondicional(esDelTaller, {
    llamarHerramienta: false,
    texto: respuestaTaller('Te propongo tres caminos bien distintos.', {
      preguntas: [{ texto: '¿Cuál te gusta más?', opciones: ['Balancín', 'Carretilla', 'Mostrame otras'] }],
      ficha: { objetivo: 'Que relacionen distancia y fuerza' },
      ideas: [
        { nombre: 'Balancín', resumen: 'Mueven pesas en un subibaja', por_que: 'Ven el equilibrio' },
        { nombre: 'Carretilla', resumen: 'Cargan y levantan', por_que: 'Sienten la fuerza' },
      ],
    }),
  });
  const { eventos } = await turno(docente, sesionId, '¿Cómo la van a usar? → Tablets');
  const done = eventos.find((evento) => evento.type === 'done') as unknown as { message: { proposals: unknown[] } };
  assert.equal(done.message.proposals.length, 2);
});

await prueba('un turno a la vez por charla: el segundo recibe 409', async () => {
  mock.programarRespuestaCondicional(esDelTaller, {
    llamarHerramienta: false,
    demoraInicialMs: 1_500,
    texto: respuestaTaller('Buenísimo, vamos con el balancín.', {
      preguntas: [{ texto: '¿Cuántos desafíos?', opciones: ['3', '5'] }],
      ficha: { idea: 'Un balancín con pesas' },
    }),
  });
  const primero = turno(docente, sesionId, 'Me quedo con la idea «Balancín».');
  await new Promise((resolver) => setTimeout(resolver, 300));
  const segundo = await turno(docente, sesionId, 'Otro mensaje a la vez');
  assert.equal(segundo.status, 409);
  const { status } = await primero;
  assert.equal(status, 200);
});

await prueba('adjuntos: una imagen entra, un SVG no', async () => {
  const bien = await docente.post(`/api/taller/${sesionId}/adjuntos`, {
    multipart: { files: { name: 'pizarron.png', mimeType: 'image/png', buffer: PNG_1x1 } },
  });
  assert.equal(bien.status(), 200, await bien.text());
  urlImagen = ((await bien.json()) as { assets: Array<{ url: string }> }).assets[0]!.url;

  const svg = await docente.post(`/api/taller/${sesionId}/adjuntos`, {
    multipart: { files: { name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') } },
  });
  assert.equal(svg.status(), 415);
});

await prueba('el pedido final se guarda con título y descripción', async () => {
  mock.programarRespuestaCondicional(esDelTaller, {
    llamarHerramienta: false,
    texto: respuestaTaller('Listo, armé el pedido.', {
      preguntas: [{ texto: '¿Querés cambiar algo?', opciones: ['Así está bien'] }],
      ficha: { pasos: '1. Equilibrar. 2. Mover el apoyo. 3. Predecir.' },
      titulo: 'Balancín de palancas',
      descripcion: 'Un simulador de palancas para 6.º grado.',
      pedido: 'Quiero un simulador de un balancín para 6.º grado.\nQué hacen:\n1. Mueven pesas.',
    }),
  });
  const { eventos } = await turno(docente, sesionId, '¿Cuántos desafíos? → 3', [urlImagen]);
  const done = eventos.find((evento) => evento.type === 'done') as unknown as { finalPrompt: string; title: string };
  assert.ok(done.finalPrompt.startsWith('Quiero un simulador'));
  assert.equal(done.title, 'Balancín de palancas');

  // La imagen adjunta quedó en el mensaje del docente.
  const docenteMsg = await prisma.ideaMessage.findFirst({
    where: { sessionId: sesionId, role: 'user' },
    orderBy: { createdAt: 'desc' },
  });
  assert.deepEqual(JSON.parse(docenteMsg!.attachments!), [urlImagen]);
});

await prueba('editar el pedido a mano se le avisa a la IA en el turno siguiente', async () => {
  const editado = 'Quiero un simulador de un balancín para 6.º grado, con pesas de colores.';
  const patch = await docente.patch(`/api/taller/${sesionId}`, { data: { finalPrompt: editado } });
  assert.equal(patch.status(), 200);
  assert.equal((await prisma.ideaSession.findUniqueOrThrow({ where: { id: sesionId } })).finalPromptEditedByTeacher, true);

  mock.programarRespuestaCondicional(esDelTaller, {
    llamarHerramienta: false,
    texto: respuestaTaller('Perfecto, lo dejo así.', { preguntas: [{ texto: '¿Algo más?', opciones: ['No'] }] }),
  });
  await turno(docente, sesionId, 'Nada más');
  const ultima = mock.llamadas.at(-1)!.body as { messages: Array<{ content: string }> };
  const contenido = ultima.messages.at(-1)!.content;
  assert.ok(contenido.includes('A MANO') && contenido.includes('pesas de colores'));

  const sesion = await prisma.ideaSession.findUniqueOrThrow({ where: { id: sesionId } });
  assert.equal(sesion.finalPromptEditedByTeacher, false);
  assert.equal(sesion.finalPrompt, editado, 'un turno sin pedido nuevo no pisa la edición');
});

await prueba('otra cuenta no puede ver ni tocar la charla', async () => {
  assert.equal((await otro.get(`/api/taller/${sesionId}`)).status(), 404);
  assert.equal((await otro.patch(`/api/taller/${sesionId}`, { data: { finalPrompt: 'x' } })).status(), 404);
  assert.equal((await turno(otro, sesionId, 'hola')).status, 404);
  assert.equal((await otro.post(`/api/taller/${sesionId}/crear`, { data: {} })).status(), 404);
  assert.equal((await otro.delete(`/api/taller/${sesionId}`)).status(), 404);
  const pagina = await otro.get(`/app/taller/${sesionId}`, { maxRedirects: 0 });
  assert.equal(pagina.status(), 302);
});

await prueba('"Crear mi recurso": recurso con título, adjuntos copiados y charla vinculada', async () => {
  const respuesta = await docente.post(`/api/taller/${sesionId}/crear`, {
    data: { finalPrompt: 'Quiero un simulador de un balancín para 6.º grado, con pesas de colores.' },
  });
  assert.equal(respuesta.status(), 200, await respuesta.text());
  const cuerpo = (await respuesta.json()) as { projectId: string; redirect: string };
  projectId = cuerpo.projectId;
  assert.equal(cuerpo.redirect, `/app/project/${projectId}`);

  const proyecto = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { assets: true } });
  assert.equal(proyecto.title, 'Balancín de palancas');
  assert.equal(proyecto.description, 'Un simulador de palancas para 6.º grado.');
  assert.ok(proyecto.slug.startsWith('balancin-de-palancas'), `slug: ${proyecto.slug}`);
  assert.deepEqual(proyecto.assets.map((asset) => asset.url), [urlImagen]);

  const sesion = await prisma.ideaSession.findUniqueOrThrow({ where: { id: sesionId } });
  assert.equal(sesion.projectId, projectId);

  // Otro clic: al mismo recurso, sin crear uno nuevo.
  const otraVez = await docente.post(`/api/taller/${sesionId}/crear`, { data: {} });
  assert.equal(((await otraVez.json()) as { redirect: string }).redirect, `/app/project/${projectId}`);
  assert.equal(await prisma.project.count({ where: { userId: docenteId } }), 1);
});

await prueba('con el recurso creado, la charla queda de sólo lectura', async () => {
  assert.equal((await turno(docente, sesionId, 'Un cambio más')).status, 409);
  assert.equal((await docente.patch(`/api/taller/${sesionId}`, { data: { finalPrompt: 'x' } })).status(), 409);
});

await prueba('el editor trae el pedido para mandarlo solo y el link a la charla', async () => {
  const html = await (await docente.get(`/app/project/${projectId}`)).text();
  assert.ok(html.includes('Ver cómo pensamos esta idea'));
  assert.ok(html.includes(`/app/taller/${sesionId}`));
  // Astro serializa las props de la isla: el pedido y la imagen viajan ahí.
  assert.ok(html.includes('pedidoInicial'));
  assert.ok(html.includes('pesas de colores'));

  // Un admin mirando el recurso ajeno no recibe el pedido ni el link.
  const htmlAdmin = await (await admin.get(`/app/project/${projectId}`)).text();
  assert.ok(!htmlAdmin.includes('Ver cómo pensamos esta idea'));
});

await prueba('la puerta "ya tengo una idea" abre con su propia pregunta', async () => {
  const respuesta = await docente.post('/api/taller', { data: { mode: 'IDEA' } });
  const { id } = (await respuesta.json()) as { id: string };
  const estado = (await (await docente.get(`/api/taller/${id}`)).json()) as {
    session: { mode: string; messages: Array<{ questions: Array<{ texto: string }> }> };
  };
  assert.equal(estado.session.mode, 'IDEA');
  assert.ok(estado.session.messages[0]!.questions[0]!.texto.includes('te imaginás'));

  assert.equal((await docente.delete(`/api/taller/${id}`)).status(), 200);
  assert.equal(await prisma.ideaSession.count({ where: { id } }), 0);
});

await prueba('"Mis ideas" lista la charla con su estado', async () => {
  const html = await (await docente.get('/app/taller')).text();
  assert.ok(html.includes('Balancín de palancas'));
  assert.ok(html.includes('Recurso creado'));
});

await Promise.all([admin.dispose(), docente.dispose(), otro.dispose(), personal.dispose()]);
await mock.detener();
await prisma.$disconnect();

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron`);
  process.exit(1);
}
console.log('\nTodas las pruebas del Taller de ideas pasaron');
