import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, conTema, iniciarSesion } from './harness.ts';

/**
 * Verificación de slice M3: CRUD de motores en /admin/motores + selector del
 * docente (specs/ai-model-catalog/spec.md).
 *
 * Cubre: alta, reorden (con teclado), habilitar/deshabilitar, marcar default,
 * el invariante de un solo default, el invariante de la clave enmascarada
 * (nunca texto plano ni cifrado en una respuesta), y el selector del docente
 * mostrando nombre + descripción. Todo en los dos temas.
 *
 * Corre con: npx tsx e2e/m3-motores.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-m3@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const MINIMAX_M3_ID = '10000000-0000-0000-0000-000000000001';

const CLAVE_DE_PRUEBA = 'clave-secreta-de-prueba-12345';
const NOMBRE_MOTOR = 'Motor E2E M3';
const PROVIDER_MODEL_MOTOR = 'test-e2e-model-1';
const DESCRIPCION_MOTOR = 'Motor de prueba para el checklist E2E de M3.';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function asegurarDocenteDePrueba(): Promise<void> {
  await prisma.user.upsert({
    where: { email: DOCENTE_EMAIL },
    update: { role: 'DOCENTE' },
    create: {
      email: DOCENTE_EMAIL,
      name: 'Docente E2E M3',
      role: 'DOCENTE',
      passwordHash: await hashPassword(DOCENTE_PASSWORD),
    },
  });
}

/** Los 4 `sortOrder` originales de la semilla (migration.sql), UUID → posición. */
const SORT_ORDER_SEMILLA: Record<string, number> = {
  '10000000-0000-0000-0000-000000000001': 0, // MiniMax M3
  '10000000-0000-0000-0000-000000000002': 1, // MiniMax M2.7
  '10000000-0000-0000-0000-000000000003': 2, // DeepSeek
  '10000000-0000-0000-0000-000000000004': 3, // Alpha
};

/**
 * Vuelve todo al estado con el que corren m1/m2: MiniMax M3 como único
 * default, sin el motor de prueba, y el `sortOrder` de la semilla intacto
 * (el reorden por teclado de este script lo corre; sin este reset quedaría
 * un hueco permanente en la numeración tras cada corrida).
 */
async function limpiarEstado(): Promise<void> {
  await prisma.aiModel.deleteMany({ where: { providerModel: PROVIDER_MODEL_MOTOR } });
  await prisma.aiModel.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  await prisma.aiModel.update({ where: { id: MINIMAX_M3_ID }, data: { isDefault: true } });
  await prisma.$transaction(
    Object.entries(SORT_ORDER_SEMILLA).map(([id, sortOrder]) => prisma.aiModel.update({ where: { id }, data: { sortOrder } })),
  );
}

async function main(): Promise<void> {
  await asegurarDocenteDePrueba();
  await limpiarEstado();
  const browser = await abrirNavegador();

  try {
    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    await page.goto(`${BASE_URL}/admin/motores`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h1:has-text("Panel")');
    await page.waitForSelector('li:has-text("MiniMax M3")');
    console.log('✔ ADMIN: /admin/motores renderiza el listado sembrado (tema light)');

    // El resto de la creación y edición corre en tema oscuro, para probar
    // el modal y el panel en los dos temas sin duplicar todo el script.
    await conTema(page, 'dark');
    await page.waitForSelector('li:has-text("MiniMax M3")');
    console.log('✔ ADMIN: el listado sigue andando en tema dark');

    // 1. Alta de un motor nuevo, por la UI real (no por API directa).
    await page.getByRole('button', { name: '+ Nuevo motor' }).click();
    await page.waitForSelector('[role="dialog"][aria-label="Nuevo motor"]');

    await page.getByLabel('Proveedor').fill('test-e2e');
    await page.getByLabel('Identificador del modelo').fill(PROVIDER_MODEL_MOTOR);
    await page.getByLabel('Nombre para el docente').fill(NOMBRE_MOTOR);
    await page.getByLabel('Descripción para el docente').fill(DESCRIPCION_MOTOR);
    await page.getByLabel('URL base').fill('https://example.test/api');
    await page.getByLabel('Reemplazar clave').fill(CLAVE_DE_PRUEBA);
    await page.getByLabel('Entrada (sin caché)').fill('0.5');
    await page.getByLabel('Salida', { exact: true }).fill('1.5');

    const [respuestaCreacion] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/api/admin/models') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Guardar' }).click(),
    ]);
    assert.equal(respuestaCreacion.status(), 200, `la creación debería dar 200, dio ${respuestaCreacion.status()}`);

    const cuerpoCreacion = await respuestaCreacion.text();
    assert.ok(!cuerpoCreacion.includes(CLAVE_DE_PRUEBA), 'la respuesta de creación no debe traer la clave en texto plano');
    assert.ok(!cuerpoCreacion.includes('apiKeyCipher'), 'la respuesta de creación no debe traer el campo apiKeyCipher');
    console.log('✔ crear+enable+default+reorden: el motor nuevo se crea desde el formulario (tema dark)');

    await page.waitForSelector(`li:has-text("${NOMBRE_MOTOR}")`);
    const fila = page.locator('li').filter({ hasText: NOMBRE_MOTOR });
    await fila.locator('text=•••• 2345').waitFor();
    console.log('✔ la fila nueva muestra la pista de la clave (últimos 4 caracteres), nunca la clave completa');

    const motorCreado = await prisma.aiModel.findFirstOrThrow({ where: { providerModel: PROVIDER_MODEL_MOTOR } });
    assert.notEqual(motorCreado.apiKeyCipher, CLAVE_DE_PRUEBA, 'la clave guardada en la base no debe ser el texto plano');
    assert.ok(motorCreado.apiKeyCipher?.startsWith('v1.'), 'la clave guardada debe estar en el formato cifrado v1.<nonce>.<ct>.<tag>');
    console.log('✔ la fila guardada en la base tiene la clave cifrada, no en texto plano');

    // 2. Habilitar/deshabilitar (sobre un motor que todavía no es default).
    // El input real es `sr-only` (el riel pintado es sólo su piel visual), así
    // que el click "de verdad" queda tapado por el propio riel decorativo en
    // las mismas coordenadas: se fuerza el click, que igual dispara el evento
    // `change` nativo que React escucha.
    const toggleHabilitado = fila.getByLabel('Habilitado');
    await toggleHabilitado.uncheck({ force: true });
    await assertBooleano(async () => (await prisma.aiModel.findUniqueOrThrow({ where: { id: motorCreado.id } })).enabled, false, 'el motor debería quedar deshabilitado');
    await toggleHabilitado.check({ force: true });
    await assertBooleano(async () => (await prisma.aiModel.findUniqueOrThrow({ where: { id: motorCreado.id } })).enabled, true, 'el motor debería volver a estar habilitado');
    console.log('✔ el toggle de habilitado persiste en los dos sentidos');

    // 3. Marcarlo como default: el índice único parcial permite a lo sumo uno.
    await fila.getByLabel(`Marcar ${NOMBRE_MOTOR} como motor por defecto`).check();
    await esperarHasta(async () => (await prisma.aiModel.findUniqueOrThrow({ where: { id: motorCreado.id } })).isDefault === true);
    const defaults = await prisma.aiModel.findMany({ where: { isDefault: true } });
    assert.equal(defaults.length, 1, `debería haber exactamente un default, hay ${defaults.length}`);
    assert.equal(defaults[0]!.id, motorCreado.id, 'el nuevo default debería ser el motor recién creado');
    console.log('✔ setear un nuevo default desmarca el anterior (invariante de un solo default)');

    // 4. Ahora que es default, apagarlo tiene que ser rechazado con 409 — ni
    //    por API directa ni por el toggle de la fila.
    const respuestaRechazo = await page.request.patch(`${BASE_URL}/api/admin/models/${motorCreado.id}`, {
      data: { enabled: false },
    });
    assert.equal(respuestaRechazo.status(), 409, `apagar el default debería dar 409, dio ${respuestaRechazo.status()}`);
    const cuerpoRechazo = (await respuestaRechazo.json()) as { error: string };
    assert.match(cuerpoRechazo.error, /predeterminado/i);
    const siguePrendido = (await prisma.aiModel.findUniqueOrThrow({ where: { id: motorCreado.id } })).enabled;
    assert.equal(siguePrendido, true, 'el intento rechazado no debería haber apagado el motor');
    console.log('✔ deshabilitar el motor por defecto se rechaza (409) y el motor sigue habilitado');

    // 5. Reorden por teclado: flecha arriba en el handle mueve una posición.
    const filasAntes = await prisma.aiModel.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true } });
    const indiceAntes = filasAntes.findIndex((m) => m.id === motorCreado.id);
    assert.ok(indiceAntes > 0, 'el motor recién creado debería tener al menos una fila arriba para poder subir');

    const anuncio = page.locator('[aria-live="polite"]');
    await fila.getByRole('button', { name: `Mover ${NOMBRE_MOTOR}` }).press('ArrowUp');
    await esperarHasta(async () => {
      const filas2 = await prisma.aiModel.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true } });
      return filas2.findIndex((m) => m.id === motorCreado.id) === indiceAntes - 1;
    });
    const textoAnuncio = (await anuncio.textContent()) ?? '';
    assert.match(textoAnuncio, new RegExp(`${NOMBRE_MOTOR}, posición ${indiceAntes} de \\d+`));
    console.log('✔ ArrowUp en el handle sube una posición y lo anuncia en la región aria-live');

    // 6. Volver a MiniMax M3 como default, EN TEMA LIGHT esta vez (para cubrir
    //    el flujo entero en los dos temas, no sólo el alta).
    await conTema(page, 'light');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`li:has-text("${NOMBRE_MOTOR}")`);
    const filaMiniMax = page.locator('li').filter({ hasText: 'MiniMax M3' });
    await filaMiniMax.getByLabel('Marcar MiniMax M3 como motor por defecto').check();
    await esperarHasta(async () => (await prisma.aiModel.findUniqueOrThrow({ where: { id: MINIMAX_M3_ID } })).isDefault === true);
    console.log('✔ ADMIN: /admin/motores sigue funcional en tema light (persistencia tras recargar)');

    // 7. Invariante de la clave enmascarada sobre el listado completo.
    const respuestaListado = await page.request.get(`${BASE_URL}/api/admin/models`);
    const textoListado = await respuestaListado.text();
    assert.ok(!textoListado.includes(CLAVE_DE_PRUEBA), 'GET /api/admin/models no debe traer ninguna clave en texto plano');
    assert.ok(!textoListado.includes('apiKeyCipher'), 'GET /api/admin/models no debe traer el campo apiKeyCipher');
    console.log('✔ GET /api/admin/models nunca expone clave en texto plano ni el campo cifrado');

    await contexto.close();

    // 8. El selector del docente: nombre + descripción, nunca el id interno.
    const contextoDocente = await browser.newContext();
    const pageDocente = await contextoDocente.newPage();
    await iniciarSesion(pageDocente, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    const creado = await pageDocente.request.post(`${BASE_URL}/api/projects`, {
      data: { title: 'Recurso E2E M3' },
    });
    assert.ok(creado.ok(), `crear el recurso debería dar 200, dio ${creado.status()}`);
    const { project } = (await creado.json()) as { project: { id: string } };

    await pageDocente.goto(`${BASE_URL}/app/project/${project.id}`, { waitUntil: 'domcontentloaded' });

    // La isla de React (`client:load`) puede tardar un instante en hidratarse
    // después de que el HTML del SSR ya está en el DOM: un click justo en ese
    // hueco no dispara nada (el <button> existe pero todavía no tiene su
    // onClick). Se reintenta el click hasta que el estado realmente cambie.
    const botonSelector = pageDocente.getByRole('button', { name: NOMBRE_MOTOR });
    await botonSelector.waitFor();
    await esperarHasta(async () => {
      await botonSelector.click();
      return (await botonSelector.getAttribute('aria-pressed')) === 'true';
    });
    await pageDocente.waitForSelector(`button[aria-pressed="true"]:has-text("${NOMBRE_MOTOR}")`);
    await pageDocente.waitForSelector(`text=${DESCRIPCION_MOTOR}`);
    console.log('✔ el selector del docente muestra nombre + descripción del motor recién creado');

    const textoPagina = await pageDocente.content();
    assert.ok(!textoPagina.includes(PROVIDER_MODEL_MOTOR), 'el selector nunca debe exponer el identificador interno del proveedor');
    console.log('✔ el selector nunca expone el providerModel');

    // 9. Deshabilitarlo lo saca del selector (Requirement "Ordering,
    //    enable/disable, single default" — ya no es default, así que se puede).
    const respuestaApagado = await pageDocente.request.patch(`${BASE_URL}/api/admin/models/${motorCreado.id}`, {
      data: { enabled: false },
    });
    // El docente no tiene permisos de admin: esta request debería fallar con
    // 403, así que se apaga con una sesión de ADMIN en su lugar.
    assert.equal(respuestaApagado.status(), 403, 'un docente no debería poder pegarle a /api/admin/models');

    const contextoAdmin2 = await browser.newContext();
    const pageAdmin2 = await contextoAdmin2.newPage();
    await iniciarSesion(pageAdmin2, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const respuestaApagadoAdmin = await pageAdmin2.request.patch(`${BASE_URL}/api/admin/models/${motorCreado.id}`, {
      data: { enabled: false },
    });
    assert.equal(respuestaApagadoAdmin.status(), 200, `apagar un motor no-default debería dar 200, dio ${respuestaApagadoAdmin.status()}`);
    await contextoAdmin2.close();

    await pageDocente.reload({ waitUntil: 'domcontentloaded' });
    // Acotado al <fieldset> del selector de motor: el toggle de tema del
    // menú de perfil también tiene aria-pressed, pero vive escondido dentro
    // de un <details> cerrado y nunca queda "visible" para esta espera.
    await pageDocente.waitForSelector('fieldset button[aria-pressed]');
    const sigueEnSelector = await pageDocente.getByRole('button', { name: NOMBRE_MOTOR }).count();
    assert.equal(sigueEnSelector, 0, 'un motor deshabilitado no debería seguir en el selector del docente');
    console.log('✔ deshabilitar un motor no-default lo saca del selector del docente');

    await contextoDocente.close();
  } finally {
    await browser.close();
    await limpiarEstado();
    await prisma.$disconnect();
  }
}

async function esperarHasta(condicion: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (await condicion()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('esperarHasta: la condición nunca se cumplió a tiempo');
}

async function assertBooleano(
  leer: () => Promise<boolean>,
  esperado: boolean,
  mensaje: string,
  timeoutMs = 5_000,
): Promise<void> {
  const inicio = Date.now();
  let ultimo: boolean | null = null;
  while (Date.now() - inicio < timeoutMs) {
    ultimo = await leer();
    if (ultimo === esperado) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ultimo, esperado, mensaje);
}

main()
  .then(() => {
    console.log('\n✔ e2e/m3-motores.ts: todos los escenarios pasaron');
  })
  .catch((error) => {
    console.error('\n✖ e2e/m3-motores.ts falló:', error);
    process.exitCode = 1;
  });
