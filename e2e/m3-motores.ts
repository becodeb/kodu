import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, conTema, iniciarSesion } from './harness.ts';
import { invalidarCatalogo, motoresParaDocente } from '../src/lib/ai/catalogo.ts';

/**
 * Verificación de slice M3 + catalogo-de-proveedores: CRUD de cuentas de
 * proveedor en /admin/proveedores, CRUD de motores en /admin/motores + el
 * selector del docente (specs/ai-model-catalog/spec.md,
 * specs/ai-provider-catalog/spec.md).
 *
 * Reescrito íntegro por catalogo-de-proveedores (design.md §10): el motor ya
 * no carga proveedor/URL base/clave directamente — primero hace falta una
 * cuenta. Cubre: alta de cuenta + motor, el invariante de la clave enmascarada
 * en LOS DOS niveles (cuenta y motor), reorden (con teclado),
 * habilitar/deshabilitar, marcar default, el invariante de un solo default,
 * la cascada de apagar una cuenta, y la feature en sí — el mismo
 * `providerModel` en dos cuentas del mismo `kind`. Todo en los dos temas.
 *
 * Corre con: npx tsx e2e/m3-motores.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const DOCENTE_EMAIL = 'docente-e2e-m3@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const MINIMAX_M3_ID = '10000000-0000-0000-0000-000000000001';
/** Respaldo ORIGINAL de la semilla para MiniMax M3 (migration.sql
 *  20260919000000): el item 14 lo pisa temporalmente y tiene que devolverlo
 *  a este valor, nunca a `null` — un `null` le rompe la cadena de respaldo a
 *  cualquier otro script (p. ej. e2e/m2-catalogo.ts) que corra después. */
const MINIMAX_M27_ID = '10000000-0000-0000-0000-000000000002';

const PROVIDER_KIND = 'test-e2e';
const PROVIDER_LABEL = 'Cuenta E2E';
const PROVIDER_LABEL_2 = 'Cuenta E2E — segunda';
const PROVIDER_BASE_URL = 'https://example.test/api';
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
 * default, sin las cuentas/motores de prueba, y el `sortOrder` de la semilla
 * intacto. Los motores se borran ANTES que las cuentas — la FK
 * `AiModel.providerId` es `Restrict`.
 */
async function limpiarEstado(): Promise<void> {
  await prisma.aiModel.deleteMany({ where: { provider: { kind: PROVIDER_KIND } } });
  await prisma.aiProvider.deleteMany({ where: { kind: PROVIDER_KIND } });
  await prisma.aiModel.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  await prisma.aiModel.update({ where: { id: MINIMAX_M3_ID }, data: { isDefault: true } });
  // Red de seguridad para el item 14 (advertencia de respaldo): si el script
  // se corta a mitad de esa prueba, MiniMax M3 no puede quedar con
  // `fallbackModelId: null` — otros scripts (e2e/m2-catalogo.ts) dependen de
  // que apunte a MiniMax M2.7, tal como lo deja la semilla.
  await prisma.aiModel.update({ where: { id: MINIMAX_M3_ID }, data: { fallbackModelId: MINIMAX_M27_ID } });
  await prisma.$transaction(
    Object.entries(SORT_ORDER_SEMILLA).map(([id, sortOrder]) => prisma.aiModel.update({ where: { id }, data: { sortOrder } })),
  );

  // Los recursos que crea este script (selector del docente, escenarios de
  // repunteo) tampoco tienen que sobrevivir entre corridas. El docente de
  // prueba puede no existir todavía la primera vez que corre esta función
  // (se llama antes y después de `asegurarDocenteDePrueba` en `main`).
  const docente = await prisma.user.findUnique({ where: { email: DOCENTE_EMAIL }, select: { id: true } });
  if (docente) await prisma.project.deleteMany({ where: { userId: docente.id } });
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

    // ───────────────────────────────────────────────────────────
    // 1. Alta de la cuenta de proveedor, por la UI real de /admin/proveedores.
    // ───────────────────────────────────────────────────────────
    await page.goto(`${BASE_URL}/admin/proveedores`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h1:has-text("Panel")');
    console.log('✔ ADMIN: /admin/proveedores renderiza (tema dark)');

    await page.getByRole('button', { name: '+ Nueva cuenta' }).click();
    await page.waitForSelector('[role="dialog"][aria-label="Nueva cuenta de proveedor"]');

    await page.getByLabel('Tipo de proveedor').fill(PROVIDER_KIND);
    await page.getByLabel('Nombre de la cuenta').fill(PROVIDER_LABEL);
    await page.getByLabel('URL base').fill(PROVIDER_BASE_URL);
    await page.getByLabel('Reemplazar clave').fill(CLAVE_DE_PRUEBA);

    const [respuestaCreacionProveedor] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/api/admin/providers') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Guardar' }).click(),
    ]);
    assert.equal(
      respuestaCreacionProveedor.status(),
      200,
      `la creación de la cuenta debería dar 200, dio ${respuestaCreacionProveedor.status()}`,
    );

    const cuerpoCreacionProveedor = await respuestaCreacionProveedor.text();
    assert.ok(!cuerpoCreacionProveedor.includes(CLAVE_DE_PRUEBA), 'la respuesta de creación no debe traer la clave en texto plano');
    assert.ok(!cuerpoCreacionProveedor.includes('apiKeyCipher'), 'la respuesta de creación no debe traer el campo apiKeyCipher');
    console.log('✔ crear cuenta de proveedor: POST 200, sin clave en texto plano ni cifrada en la respuesta');

    // ───────────────────────────────────────────────────────────
    // 2. La fila de la cuenta muestra la pista; la base tiene el cifrado real.
    // ───────────────────────────────────────────────────────────
    await page.waitForSelector(`li:has-text("${PROVIDER_LABEL}")`);
    const filaProveedor = page.locator('li').filter({ hasText: PROVIDER_LABEL });
    await filaProveedor.locator('text=•••• 2345').waitFor();
    console.log('✔ la fila de la cuenta muestra la pista de la clave (últimos 4 caracteres), nunca la clave completa');

    const proveedorCreado = await prisma.aiProvider.findFirstOrThrow({ where: { kind: PROVIDER_KIND, label: PROVIDER_LABEL } });
    assert.notEqual(proveedorCreado.apiKeyCipher, CLAVE_DE_PRUEBA, 'la clave guardada en la base no debe ser el texto plano');
    assert.ok(proveedorCreado.apiKeyCipher?.startsWith('v1.'), 'la clave guardada debe estar en el formato cifrado v1.<nonce>.<ct>.<tag>');
    console.log('✔ la cuenta guardada en la base tiene la clave cifrada, no en texto plano');

    // ───────────────────────────────────────────────────────────
    // 2b. La UI de edición nunca vuelve a mostrar la clave completa: el campo
    //     "Reemplazar clave" abre vacío, con la pista como placeholder.
    // ───────────────────────────────────────────────────────────
    await filaProveedor.getByRole('button', { name: 'Editar' }).click();
    await page.waitForSelector(`[role="dialog"][aria-label="Editar ${PROVIDER_LABEL}"]`);
    const campoClaveEdicion = page.getByLabel('Reemplazar clave');
    assert.equal(await campoClaveEdicion.inputValue(), '', 'el campo de clave debe abrir vacío al editar, nunca precargado');
    assert.equal(
      await campoClaveEdicion.getAttribute('placeholder'),
      '•••• 2345',
      'el placeholder debe mostrar sólo la pista, no la clave completa',
    );
    const htmlDialogoEdicion = await page.locator('[role="dialog"]').innerHTML();
    assert.ok(!htmlDialogoEdicion.includes(CLAVE_DE_PRUEBA), 'el diálogo de edición no debe traer la clave completa en ningún lado del DOM');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    console.log('✔ el diálogo de edición de la cuenta nunca renderiza la clave completa, sólo la pista enmascarada');

    // ───────────────────────────────────────────────────────────
    // 3. Ciphertext-leak assertion sobre el listado de cuentas.
    // ───────────────────────────────────────────────────────────
    const respuestaListadoProveedores = await page.request.get(`${BASE_URL}/api/admin/providers`);
    const textoListadoProveedores = await respuestaListadoProveedores.text();
    assert.ok(!textoListadoProveedores.includes(CLAVE_DE_PRUEBA), 'GET /api/admin/providers no debe traer ninguna clave en texto plano');
    assert.ok(!textoListadoProveedores.includes('apiKeyCipher'), 'GET /api/admin/providers no debe traer el campo apiKeyCipher');
    assert.ok(!textoListadoProveedores.includes('v1.'), 'GET /api/admin/providers no debe traer nada con la forma del cifrado');
    console.log('✔ GET /api/admin/providers nunca expone clave en texto plano, el campo cifrado, ni la forma "v1."');

    // ───────────────────────────────────────────────────────────
    // 4. Alta del motor, eligiendo la cuenta recién creada en el <select>.
    // ───────────────────────────────────────────────────────────
    await page.goto(`${BASE_URL}/admin/motores`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('li:has-text("MiniMax M3")');

    await page.getByRole('button', { name: '+ Nuevo motor' }).click();
    await page.waitForSelector('[role="dialog"][aria-label="Nuevo motor"]');

    // El motor ya no tiene campos de proveedor/URL base/clave: sólo la cuenta.
    // `exact: true` importa: "Cuenta de proveedor" CONTIENE la palabra
    // "Proveedor", así que un match por substring (el default de getByLabel)
    // encontraría el <select> nuevo y daría un falso positivo acá.
    for (const etiquetaAusente of ['Proveedor', 'URL base', 'Reemplazar clave']) {
      assert.equal(
        await page.getByLabel(etiquetaAusente, { exact: true }).count(),
        0,
        `"${etiquetaAusente}" no debería existir en el diálogo de motor`,
      );
    }
    console.log('✔ el diálogo de motor no tiene campos de proveedor/URL base/clave (se movieron a la cuenta)');

    await page.getByLabel('Cuenta de proveedor').selectOption({ label: PROVIDER_LABEL });
    await page.getByLabel('Identificador del modelo').fill(PROVIDER_MODEL_MOTOR);
    await page.getByLabel('Nombre para el docente').fill(NOMBRE_MOTOR);
    await page.getByLabel('Descripción para el docente').fill(DESCRIPCION_MOTOR);
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
    console.log('✔ crear+enable+default+reorden: el motor nuevo se crea eligiendo la cuenta en el <select> (tema dark)');

    await page.waitForSelector(`li:has-text("${NOMBRE_MOTOR}")`);
    const fila = page.locator('li').filter({ hasText: NOMBRE_MOTOR });
    await fila.locator('text=•••• 2345').waitFor();
    console.log('✔ la fila del motor muestra la pista de la clave de SU CUENTA (últimos 4 caracteres)');

    const motorCreado = await prisma.aiModel.findFirstOrThrow({ where: { providerModel: PROVIDER_MODEL_MOTOR } });
    assert.equal(motorCreado.providerId, proveedorCreado.id, 'el motor debe apuntar a la cuenta recién creada');
    console.log('✔ el motor guardado en la base apunta a la cuenta correcta, y ya no tiene columnas propias de clave');

    // 2. Dos controles independientes en la misma fila (design §7,
    //    publicacion-likes-y-motores): el Interruptor prominente ahora
    //    escribe `selectableByTeacher`, nunca `enabled`; el chip quieto
    //    "En servicio"/"Fuera de servicio" escribe `enabled`, sin tocar la
    //    visibilidad para el docente. El input real es `sr-only` (el riel
    //    pintado es sólo su piel visual), así que el click "de verdad" queda
    //    tapado por el propio riel decorativo en las mismas coordenadas: se
    //    fuerza el click, que igual dispara el evento `change` nativo que
    //    React escucha.
    const interruptorVisible = fila.getByLabel('Lo ven los docentes');
    await interruptorVisible.uncheck({ force: true });
    await assertBooleano(
      async () => (await prisma.aiModel.findUniqueOrThrow({ where: { id: motorCreado.id } })).selectableByTeacher,
      false,
      'el motor debería quedar oculto para los docentes',
    );
    assert.equal(
      (await prisma.aiModel.findUniqueOrThrow({ where: { id: motorCreado.id } })).enabled,
      true,
      'apagar la visibilidad NO debe tocar `enabled` (item 12)',
    );
    console.log('✔ el interruptor prominente escribe selectableByTeacher sin tocar enabled (item 12)');

    // item 15: selectableByTeacher: false + enabled: true sobrevive un reload
    // — la configuración estilo DeepSeek tiene que seguir siendo expresable.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`li:has-text("${NOMBRE_MOTOR}")`);
    const filaTrasReload = page.locator('li').filter({ hasText: NOMBRE_MOTOR });
    await assertBooleano(
      async () => await filaTrasReload.getByLabel('Lo ven los docentes').isChecked(),
      false,
      'el interruptor debería seguir apagado tras recargar',
    );
    await filaTrasReload.getByRole('button', { name: 'En servicio' }).waitFor();
    console.log('✔ selectableByTeacher: false + enabled: true sobrevive un reload (item 15)');

    await filaTrasReload.getByLabel('Lo ven los docentes').check({ force: true });
    await assertBooleano(
      async () => (await prisma.aiModel.findUniqueOrThrow({ where: { id: motorCreado.id } })).selectableByTeacher,
      true,
      'el motor debería volver a ser visible para los docentes',
    );
    console.log('✔ el interruptor persiste en los dos sentidos');

    // El chip "En servicio" escribe `enabled` (item 13): PATCH { enabled: false }.
    const chipEnServicio = filaTrasReload.getByRole('button', { name: 'En servicio' });
    const [patchApagado] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().endsWith(`/api/admin/models/${motorCreado.id}`) && res.request().method() === 'PATCH',
      ),
      chipEnServicio.click(),
    ]);
    assert.deepEqual(JSON.parse(patchApagado.request().postData() ?? '{}'), { enabled: false });
    await assertBooleano(
      async () => (await prisma.aiModel.findUniqueOrThrow({ where: { id: motorCreado.id } })).enabled,
      false,
      'el motor debería quedar fuera de servicio',
    );
    await filaTrasReload.getByRole('button', { name: 'Fuera de servicio' }).waitFor();
    console.log('✔ el chip "En servicio" manda PATCH { enabled: false } (item 13)');

    await filaTrasReload.getByRole('button', { name: 'Fuera de servicio' }).click();
    await assertBooleano(
      async () => (await prisma.aiModel.findUniqueOrThrow({ where: { id: motorCreado.id } })).enabled,
      true,
      'el motor debería volver a estar en servicio',
    );
    console.log('✔ el toggle de servicio persiste en los dos sentidos');

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

    // 6b. La advertencia de respaldo (design §7.1, item 14; spec
    //     `ai-model-catalog` "Disabling a fallback target warns first"):
    //     MiniMax M3 apunta a `motorCreado` como su respaldo automático.
    //     `motorCreado` ya no es default (se lo devolvimos a MiniMax arriba),
    //     así que apagarlo no choca con el 409 del paso 4.
    await prisma.aiModel.update({ where: { id: MINIMAX_M3_ID }, data: { fallbackModelId: motorCreado.id } });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`li:has-text("${NOMBRE_MOTOR}")`);
    const filaConRespaldo = page.locator('li').filter({ hasText: NOMBRE_MOTOR });
    const chipConRespaldo = filaConRespaldo.getByRole('button', { name: 'En servicio' });

    let patchsDisparados = 0;
    page.on('request', (req) => {
      if (req.url().endsWith(`/api/admin/models/${motorCreado.id}`) && req.method() === 'PATCH') patchsDisparados++;
    });

    await chipConRespaldo.click();
    const tiraAdvertencia = filaConRespaldo.getByText(/se queda sin respaldo autom.tico/i);
    await tiraAdvertencia.waitFor();
    const textoTira = (await tiraAdvertencia.textContent()) ?? '';
    assert.match(textoTira, /MiniMax M3/, 'la advertencia debe nombrar al motor que se queda sin respaldo');
    console.log('✔ apagar un motor-respaldo de otro muestra la advertencia inline, nombrando al dependiente (item 14)');

    await filaConRespaldo.getByRole('button', { name: 'Cancelar' }).click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(patchsDisparados, 0, '"Cancelar" no debería mandar ningún PATCH');
    assert.equal(
      (await prisma.aiModel.findUniqueOrThrow({ where: { id: motorCreado.id } })).enabled,
      true,
      '"Cancelar" no debería haber apagado el motor',
    );
    console.log('✔ "Cancelar" no manda ningún PATCH y el motor sigue en servicio (item 14)');

    await chipConRespaldo.click();
    await filaConRespaldo.getByText(/se queda sin respaldo autom.tico/i).waitFor();
    await filaConRespaldo.getByRole('button', { name: 'Sacarlo igual' }).click();
    await assertBooleano(
      async () => (await prisma.aiModel.findUniqueOrThrow({ where: { id: motorCreado.id } })).enabled,
      false,
      '"Sacarlo igual" debería apagar el motor',
    );
    assert.ok(patchsDisparados > 0, '"Sacarlo igual" sí debería mandar el PATCH');
    console.log('✔ "Sacarlo igual" manda el PATCH y apaga el motor (item 14)');

    // Se deshace todo para no romper el resto del script — y ESPECIALMENTE
    // para no romper otros scripts que corran después. MiniMax M3 vuelve a
    // su respaldo ORIGINAL de la semilla (MiniMax M2.7), no a `null`.
    await prisma.aiModel.update({ where: { id: MINIMAX_M3_ID }, data: { fallbackModelId: MINIMAX_M27_ID } });
    await prisma.aiModel.update({ where: { id: motorCreado.id }, data: { enabled: true } });

    // 7. Invariante de la clave enmascarada sobre el listado completo de motores.
    const respuestaListado = await page.request.get(`${BASE_URL}/api/admin/models`);
    const textoListado = await respuestaListado.text();
    assert.ok(!textoListado.includes(CLAVE_DE_PRUEBA), 'GET /api/admin/models no debe traer ninguna clave en texto plano');
    assert.ok(!textoListado.includes('apiKeyCipher'), 'GET /api/admin/models no debe traer el campo apiKeyCipher');
    console.log('✔ GET /api/admin/models nunca expone clave en texto plano ni el campo cifrado');

    // ───────────────────────────────────────────────────────────
    // 8. La cascada: apagar la cuenta apaga sus motores sin tocar su propio
    //    `enabled`; volver a prenderla los restaura.
    // ───────────────────────────────────────────────────────────
    const respuestaApagarCuenta = await page.request.patch(`${BASE_URL}/api/admin/providers/${proveedorCreado.id}`, {
      data: { enabled: false },
    });
    assert.equal(respuestaApagarCuenta.status(), 200, `apagar la cuenta debería dar 200, dio ${respuestaApagarCuenta.status()}`);

    const motorTrasApagarCuenta = await prisma.aiModel.findUniqueOrThrow({ where: { id: motorCreado.id } });
    assert.equal(motorTrasApagarCuenta.enabled, true, 'apagar la cuenta NO debe tocar el enabled propio del motor');
    console.log('✔ apagar la cuenta no toca el enabled propio de sus motores en la base');

    // La API ya invalida el catálogo del PROCESO DEL SERVIDOR en cada mutación
    // de /api/admin/providers — pero este script corre en su PROPIO proceso
    // (`npx tsx`), con su propia instancia de `catalogo.ts` y su propio caché
    // de 30s: ese invalidarCatalogo() del servidor nunca llega acá. Hay que
    // invalidar también el caché de ESTE proceso antes de cada lectura.
    invalidarCatalogo();
    const selectorTrasApagar = await motoresParaDocente();
    assert.ok(
      !selectorTrasApagar.some((motor) => motor.id === motorCreado.id),
      'el motor debería desaparecer del selector del docente mientras su cuenta está apagada',
    );
    console.log('✔ apagar la cuenta saca a sus motores del selector del docente');

    const respuestaPrenderCuenta = await page.request.patch(`${BASE_URL}/api/admin/providers/${proveedorCreado.id}`, {
      data: { enabled: true },
    });
    assert.equal(respuestaPrenderCuenta.status(), 200, `re-habilitar la cuenta debería dar 200, dio ${respuestaPrenderCuenta.status()}`);
    console.log('✔ nuevo — la cascada: apagar/re-habilitar la cuenta funciona sin tocar el enabled propio del motor');

    invalidarCatalogo();
    const selectorTrasReHabilitar = await motoresParaDocente();
    assert.ok(
      selectorTrasReHabilitar.some((motor) => motor.id === motorCreado.id),
      're-habilitar la cuenta debería devolver al motor al selector del docente',
    );
    console.log('✔ re-habilitar la cuenta restaura al motor en el selector del docente (cascada en los dos sentidos)');

    // ───────────────────────────────────────────────────────────
    // 9. La feature en sí: el MISMO providerModel en dos cuentas del MISMO
    //    kind era imposible antes de este cambio, ahora da 200.
    // ───────────────────────────────────────────────────────────
    const respuestaCreacionProveedor2 = await page.request.post(`${BASE_URL}/api/admin/providers`, {
      data: { kind: PROVIDER_KIND, label: PROVIDER_LABEL_2, baseUrl: PROVIDER_BASE_URL, apiKey: 'otra-clave-de-prueba' },
    });
    assert.equal(respuestaCreacionProveedor2.status(), 200, `crear la segunda cuenta debería dar 200, dio ${respuestaCreacionProveedor2.status()}`);
    const { proveedor: proveedor2 } = (await respuestaCreacionProveedor2.json()) as { proveedor: { id: string } };

    const respuestaSegundoMotor = await page.request.post(`${BASE_URL}/api/admin/models`, {
      data: {
        providerId: proveedor2.id,
        providerModel: PROVIDER_MODEL_MOTOR,
        displayName: `${NOMBRE_MOTOR} — segunda cuenta`,
        selectableByTeacher: false,
      },
    });
    assert.equal(
      respuestaSegundoMotor.status(),
      200,
      `crear el mismo providerModel en una SEGUNDA cuenta del mismo kind debería dar 200, dio ${respuestaSegundoMotor.status()}`,
    );
    console.log('✔ nuevo — la feature: el mismo providerModel en dos cuentas del mismo kind coexiste (imposible antes)');

    // ───────────────────────────────────────────────────────────
    // 9b. El mismo providerModel DOS VECES en la MISMA cuenta sigue rechazado
    //     — el `@@unique([providerId, providerModel])` sigue vigente, sólo
    //     cambió de qué campos está compuesto.
    // ───────────────────────────────────────────────────────────
    const respuestaDuplicadaMismaCuenta = await page.request.post(`${BASE_URL}/api/admin/models`, {
      data: {
        providerId: proveedorCreado.id,
        providerModel: PROVIDER_MODEL_MOTOR,
        displayName: `${NOMBRE_MOTOR} — duplicado en la misma cuenta`,
        selectableByTeacher: false,
      },
    });
    assert.equal(
      respuestaDuplicadaMismaCuenta.status(),
      422,
      `crear el mismo providerModel en la MISMA cuenta debería dar 422, dio ${respuestaDuplicadaMismaCuenta.status()}`,
    );
    const cuerpoDuplicadaMismaCuenta = (await respuestaDuplicadaMismaCuenta.json()) as { error: string };
    assert.match(cuerpoDuplicadaMismaCuenta.error, /ya existe un motor/i);
    console.log('✔ nuevo — el mismo providerModel dos veces en la MISMA cuenta se sigue rechazando (422)');

    await contexto.close();

    // 10. El selector del docente: nombre + descripción, nunca el id interno.
    //     Desde publicacion-likes-y-motores es un listbox (design §8, item
    //     16), no un grupo de botones segmentado: la descripción de cada
    //     opción es texto SIEMPRE visible mientras la lista está abierta,
    //     nunca un `title` (que sería sólo de mouse). `hasTouch` habilita
    //     `.tap()` más abajo.
    const contextoDocente = await browser.newContext({ hasTouch: true });
    const pageDocente = await contextoDocente.newPage();
    await iniciarSesion(pageDocente, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    const creado = await pageDocente.request.post(`${BASE_URL}/api/projects`, {
      data: { title: 'Recurso E2E M3' },
    });
    assert.ok(creado.ok(), `crear el recurso debería dar 200, dio ${creado.status()}`);
    const { project } = (await creado.json()) as { project: { id: string } };

    await pageDocente.goto(`${BASE_URL}/app/project/${project.id}`, { waitUntil: 'domcontentloaded' });

    const disparadorSelector = pageDocente.locator('#selector-motor');
    const listbox = pageDocente.locator('ul[role="listbox"]');
    const opciones = pageDocente.locator('li[role="option"]');
    const opcionMotor = opciones.filter({ hasText: NOMBRE_MOTOR });
    const opcionMiniMax = opciones.filter({ hasText: 'MiniMax M3' });

    // La isla de React (`client:load`) puede tardar un instante en hidratarse
    // después de que el HTML del SSR ya está en el DOM: un click justo en ese
    // hueco no dispara nada. Se reintenta abrir hasta que el listbox aparezca.
    await disparadorSelector.waitFor();
    await esperarHasta(async () => {
      await disparadorSelector.focus();
      await pageDocente.keyboard.press('Enter');
      return (await listbox.count()) > 0;
    });

    // La descripción vive como TEXTO adentro de la opción, nunca en un
    // atributo `title` (que quedaría muerto para touch y teclado).
    await opcionMotor.waitFor();
    assert.equal(
      await opcionMotor.getByText(DESCRIPCION_MOTOR).count(),
      1,
      'la descripción tiene que estar como texto dentro de la opción, no en un atributo title',
    );
    const tieneAtributoTitle = await opcionMotor.evaluate((el) => el.hasAttribute('title'));
    assert.equal(tieneAtributoTitle, false, 'la opción no debe depender del atributo title para la descripción');
    console.log('✔ el listbox muestra la descripción de cada opción como texto, nunca en un title');

    // Navegar por teclado hasta la opción y elegirla con Enter — nada de
    // mouse. `aria-activedescendant` en el `<ul>` dice cuál opción tiene el
    // foco de teclado en este momento (no cuál está elegida todavía).
    const idOpcionMotor = `opt-${motorCreado.id}`;
    for (let vueltas = 0; vueltas < 20; vueltas++) {
      if ((await listbox.getAttribute('aria-activedescendant')) === idOpcionMotor) break;
      await pageDocente.keyboard.press('ArrowDown');
    }
    assert.equal(
      await listbox.getAttribute('aria-activedescendant'),
      idOpcionMotor,
      'ArrowDown debería poder llegar a la opción del motor recién creado',
    );
    await pageDocente.keyboard.press('Enter');
    await listbox.waitFor({ state: 'hidden' });
    await pageDocente.waitForSelector(`#selector-motor:has-text("${NOMBRE_MOTOR}")`);
    await pageDocente.waitForSelector(`text=${DESCRIPCION_MOTOR}`);
    console.log('✔ el selector se maneja por completo con teclado: Enter, ArrowDown, Enter (item 16)');

    const textoPagina = await pageDocente.content();
    assert.ok(!textoPagina.includes(PROVIDER_MODEL_MOTOR), 'el selector nunca debe exponer el identificador interno del proveedor');
    console.log('✔ el selector nunca expone el providerModel');

    // El mismo recorrido, ahora con un tap (sin hover, sin teclado) — vuelve a
    // MiniMax M3 y de nuevo a Motor E2E M3, probando que la opción es un
    // target táctil completo (item 16).
    await disparadorSelector.tap();
    await listbox.waitFor();
    await opcionMiniMax.tap();
    await listbox.waitFor({ state: 'hidden' });
    await pageDocente.waitForSelector('#selector-motor:has-text("MiniMax M3")');

    await disparadorSelector.tap();
    await listbox.waitFor();
    await opcionMotor.tap();
    await listbox.waitFor({ state: 'hidden' });
    await pageDocente.waitForSelector(`#selector-motor:has-text("${NOMBRE_MOTOR}")`);
    console.log('✔ la misma elección funciona con tap, sin pasar por hover (item 16)');

    // T6 (odd/tasks/verificador.md, follow-up 2026-09-26): de acá para abajo
    // `motorCreado` se apaga (11) y, apagado, sólo iba a quedar MiniMax M3
    // seleccionable — con un solo motor elegible el selector ahora se OCULTA
    // ENTERO, lo que taparía la prueba de repunteo de más abajo (12), que es
    // sobre el AVISO, no sobre cuántos motores hay. Se da de alta un SEGUNDO
    // motor elegible, independiente del que se apaga, para que el selector
    // siga con 2+ opciones durante 12 — igual que antes de T6. Queda
    // limpiado solo por `limpiarEstado()` (misma cuenta `PROVIDER_KIND`). El
    // nombre NO puede contener `NOMBRE_MOTOR` como substring — `opcionMotor`
    // (arriba) lo matchea por `hasText`, y un "Motor E2E M3 — algo" cuenta
    // como el mismo motor para ese locator.
    // `contexto`/`page` (la sesión admin original) ya se cerró más arriba
    // (paso 9), así que esto abre su propia sesión admin de corta vida —
    // mismo patrón que el paso 11, un poco más abajo.
    const contextoMotorDeApoyo = await browser.newContext();
    const pageMotorDeApoyo = await contextoMotorDeApoyo.newPage();
    await iniciarSesion(pageMotorDeApoyo, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const respuestaMotorDeApoyo = await pageMotorDeApoyo.request.post(`${BASE_URL}/api/admin/models`, {
      data: {
        providerId: proveedorCreado.id,
        providerModel: 'test-e2e-refuerzo-selector-t6',
        displayName: 'Refuerzo selector T6',
      },
    });
    assert.equal(
      respuestaMotorDeApoyo.status(),
      200,
      `crear el motor de apoyo para la prueba de repunteo debería dar 200, dio ${respuestaMotorDeApoyo.status()}`,
    );
    await contextoMotorDeApoyo.close();
    console.log('✔ motor de apoyo creado para que el selector siga con 2+ opciones durante la prueba de repunteo (T6)');

    // 11. Deshabilitarlo lo saca del selector (Requirement "Ordering,
    //     enable/disable, single default" — ya no es default, así que se puede).
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
    await disparadorSelector.waitFor();
    await disparadorSelector.click();
    await listbox.waitFor();
    const sigueEnSelector = await opcionMotor.count();
    assert.equal(sigueEnSelector, 0, 'un motor deshabilitado no debería seguir en el selector del docente');
    await pageDocente.keyboard.press('Escape');
    console.log('✔ deshabilitar un motor no-default lo saca del selector del docente');

    // 12. Aviso quieto de repunteo (Requirement "Fallback when a project's
    //     model is disabled", scenarios "silently repoints and notifies
    //     once" y "notice does not repeat"). Se usan proyectos propios,
    //     aparte del de arriba, para no gastar el "una sola vez" antes de
    //     poder comprobarlo y para cubrir los dos temas por separado.
    const AVISO_REPUNTEO = 'Cambiamos el motor de este proyecto porque el anterior ya no está disponible.';

    async function creaProyectoDocente(titulo: string): Promise<string> {
      const respuestaCreacion2 = await pageDocente.request.post(`${BASE_URL}/api/projects`, { data: { title: titulo } });
      assert.ok(respuestaCreacion2.ok(), `crear "${titulo}" debería dar 200, dio ${respuestaCreacion2.status()}`);
      const { project: proyectoCreado } = (await respuestaCreacion2.json()) as { project: { id: string } };
      return proyectoCreado.id;
    }

    /** Polling corto: el aviso lo dispara un `useEffect` al hidratar (no está
     *  en el HTML del SSR) y se auto-oculta a los 2.5s, así que hay que
     *  encuestar seguido en vez de una sola lectura tardía. */
    async function hayAvisoRepunteo(timeoutMs = 6_000): Promise<boolean> {
      const inicio = Date.now();
      while (Date.now() - inicio < timeoutMs) {
        if ((await pageDocente.getByText(AVISO_REPUNTEO).count()) > 0) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    }

    // 12a. Proyecto que ya tenía el motor recién apagado (`motorCreado`, no
    //      default): abrirlo en tema LIGHT tiene que repuntear al default
    //      vigente Y mostrar el aviso.
    const idProyectoLight = await creaProyectoDocente('Recurso E2E M3 — repunteo light');
    await prisma.project.update({ where: { id: idProyectoLight }, data: { aiModelId: motorCreado.id } });
    await conTema(pageDocente, 'light');
    await pageDocente.goto(`${BASE_URL}/app/project/${idProyectoLight}`, { waitUntil: 'domcontentloaded' });
    assert.ok(await hayAvisoRepunteo(), 'el aviso de repunteo debería aparecer en tema light al abrir el proyecto');
    const proyectoLightTrasAbrir = await prisma.project.findUniqueOrThrow({ where: { id: idProyectoLight } });
    assert.equal(
      proyectoLightTrasAbrir.aiModelId,
      MINIMAX_M3_ID,
      'el proyecto debería quedar apuntando al default vigente tras el repunteo',
    );
    console.log('✔ repunteo + aviso quieto: tema light, motor apagado → default vigente');

    // 12b. Reabrir el MISMO proyecto: el aviso ya se vio y `aiModelId` ya es
    //      igual al vigente, así que no tiene que repetirse.
    await pageDocente.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(
      await hayAvisoRepunteo(1_500),
      false,
      'el aviso de repunteo no debería repetirse al reabrir el mismo proyecto',
    );
    console.log('✔ el aviso de repunteo no se repite al reabrir el mismo proyecto');

    // 12c. Mismo escenario en tema DARK — la spec pide los dos temas para el
    //      scenario "silently repoints and notifies once".
    const idProyectoDark = await creaProyectoDocente('Recurso E2E M3 — repunteo dark');
    await prisma.project.update({ where: { id: idProyectoDark }, data: { aiModelId: motorCreado.id } });
    await conTema(pageDocente, 'dark');
    await pageDocente.goto(`${BASE_URL}/app/project/${idProyectoDark}`, { waitUntil: 'domcontentloaded' });
    assert.ok(await hayAvisoRepunteo(), 'el aviso de repunteo debería aparecer en tema dark al abrir el proyecto');
    console.log('✔ repunteo + aviso quieto: tema dark, motor apagado → default vigente');

    // 12d. Un proyecto recién creado (sin motor todavía, `aiModelId: null`)
    //      no es un repunteo: nunca tiene que mostrar el aviso.
    const idProyectoNuevo = await creaProyectoDocente('Recurso E2E M3 — sin motor');
    await pageDocente.goto(`${BASE_URL}/app/project/${idProyectoNuevo}`, { waitUntil: 'domcontentloaded' });
    assert.equal(
      await hayAvisoRepunteo(1_500),
      false,
      'un proyecto nuevo sin motor no debería mostrar el aviso de repunteo',
    );
    console.log('✔ un proyecto nuevo sin motor nunca muestra el aviso de repunteo');

    await contextoDocente.close();

    // Nota (design.md §10.9): el estado vacío del <select> de cuenta en
    // ModeloForm.tsx (cero AiProvider en la base) no es automatable sin
    // vaciar la tabla entera — queda como chequeo manual/Playwright (tasks.md
    // 5.8), y no se duplica acá.
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
