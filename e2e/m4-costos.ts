import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, conTema, iniciarSesion } from './harness.ts';
import { CONSUMO_MEDIO, costoPorProyecto, recordUsage } from '../src/lib/ai/usage.ts';

/**
 * Verificación de slice M4: columnas de costo, snapshot congelado, y el
 * indicador de consumo del workspace (specs/ai-cost-accounting/spec.md).
 *
 * **No hay credenciales reales de ningún proveedor en este entorno** (ver
 * openspec/context.md): en vez de fingir un turno de chat completo, este
 * script escribe filas de `TokenUsage` DIRECTAMENTE con `recordUsage()` —
 * el mismo camino que usa `stream.ts` — y verifica la aritmética y el
 * renderizado sobre esos datos reales de la base.
 *
 * Corre con: npx tsx e2e/m4-costos.ts
 */

const DOCENTE_EMAIL = 'docente-e2e-m4@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';
const MARCA_MOTOR_PRUEBA = 'test-m4';
const PROVEEDOR_ID_PRUEBA = 'e2e-m4-provider';
const MODELO_HISTORICO = 'e2e-m4-modelo-historico';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

/** Cuenta de proveedor fija para los motores de prueba de este script (catalogo-de-proveedores). */
async function asegurarProveedorDePrueba(): Promise<void> {
  await prisma.aiProvider.upsert({
    where: { id: PROVEEDOR_ID_PRUEBA },
    update: {},
    create: {
      id: PROVEEDOR_ID_PRUEBA,
      kind: MARCA_MOTOR_PRUEBA,
      label: MARCA_MOTOR_PRUEBA,
      baseUrl: 'http://localhost:0',
    },
  });
}

async function asegurarDocenteDePrueba(): Promise<string> {
  const docente = await prisma.user.upsert({
    where: { email: DOCENTE_EMAIL },
    update: { role: 'DOCENTE' },
    create: {
      email: DOCENTE_EMAIL,
      name: 'Docente E2E M4',
      role: 'DOCENTE',
      passwordHash: await hashPassword(DOCENTE_PASSWORD),
    },
    select: { id: true },
  });
  return docente.id;
}

async function crearMotorConPrecio(opts: {
  input: string;
  output: string;
  cachedInput: string | null;
}): Promise<string> {
  const id = randomUUID();
  await prisma.aiModel.create({
    data: {
      id,
      providerId: PROVEEDOR_ID_PRUEBA,
      providerModel: `modelo-${id.slice(0, 8)}`,
      displayName: 'Motor E2E M4',
      enabled: true,
      selectableByTeacher: false,
      isDefault: false,
      priceInputPerMToken: opts.input,
      priceOutputPerMToken: opts.output,
      priceCachedInputPerMToken: opts.cachedInput,
    },
  });
  return id;
}

/** Un motor sin ningún precio cargado (las tres columnas quedan en NULL). */
async function crearMotorSinPrecio(): Promise<string> {
  const id = randomUUID();
  await prisma.aiModel.create({
    data: {
      id,
      providerId: PROVEEDOR_ID_PRUEBA,
      providerModel: `sin-precio-${id.slice(0, 8)}`,
      displayName: 'Motor E2E M4 sin precio',
      enabled: true,
      selectableByTeacher: false,
      isDefault: false,
    },
  });
  return id;
}

async function crearProyectoDePrueba(userId: string, titulo: string): Promise<string> {
  const proyecto = await prisma.project.create({
    data: { title: titulo, slug: `e2e-m4-${randomUUID()}`, userId },
    select: { id: true },
  });
  return proyecto.id;
}

async function limpiarEstado(docenteId: string): Promise<void> {
  await prisma.tokenUsage.deleteMany({ where: { userId: docenteId } });
  await prisma.project.deleteMany({ where: { userId: docenteId } });
  await prisma.aiModel.deleteMany({ where: { providerId: PROVEEDOR_ID_PRUEBA } });
}

async function main(): Promise<void> {
  await asegurarProveedorDePrueba();
  const docenteId = await asegurarDocenteDePrueba();
  await limpiarEstado(docenteId);

  try {
    // ───────────────────────────────────────────────────────────
    // 1. Un turno completo: la fila lleva projectId y un costo que coincide
    //    con la fórmula de design.md §6.
    // ───────────────────────────────────────────────────────────
    const motorPagoId = await crearMotorConPrecio({ input: '1', output: '2', cachedInput: '0.5' });
    const proyectoPagoId = await crearProyectoDePrueba(docenteId, 'Recurso E2E M4 — pago');

    await recordUsage({
      userId: docenteId,
      projectId: proyectoPagoId,
      aiModelId: motorPagoId,
      model: 'modelo-de-prueba',
      promptTokens: 1_000,
      cachedInputTokens: 200,
      completionTokens: 500,
      precios: {
        input: new Prisma.Decimal('1'),
        output: new Prisma.Decimal('2'),
        cachedInput: new Prisma.Decimal('0.5'),
      },
    });

    const filaPago = await prisma.tokenUsage.findFirstOrThrow({
      where: { projectId: proyectoPagoId },
    });
    assert.equal(filaPago.projectId, proyectoPagoId, 'la fila debe llevar el projectId del turno');
    // facturables = 1000 − 200 = 800; 800×1/1e6 + 200×0.5/1e6 + 500×2/1e6 = 0.0019
    const costoEsperado = new Prisma.Decimal('0.0019');
    assert.ok(
      filaPago.costUsd?.equals(costoEsperado),
      `esperaba costUsd=${costoEsperado.toString()}, dio ${filaPago.costUsd?.toString()}`,
    );
    console.log('✔ un turno completo escribe projectId y un costo que coincide con la fórmula');

    // ───────────────────────────────────────────────────────────
    // 2. Editar el precio del motor DESPUÉS no cambia el snapshot ya escrito.
    // ───────────────────────────────────────────────────────────
    await prisma.aiModel.update({ where: { id: motorPagoId }, data: { priceInputPerMToken: '999' } });
    const filaTrasEditar = await prisma.tokenUsage.findUniqueOrThrow({ where: { id: filaPago.id } });
    assert.ok(
      filaTrasEditar.costUsd?.equals(costoEsperado),
      'el costo congelado no debe cambiar cuando se edita el precio del motor después',
    );
    assert.ok(
      filaTrasEditar.priceInputSnapshot?.equals(new Prisma.Decimal('1')),
      'el snapshot de precio de entrada tampoco debe moverse',
    );
    console.log('✔ editar el precio de un motor no reescribe costos ya congelados');

    // ───────────────────────────────────────────────────────────
    // 3. Motor gratuito: costUsd = 0 (conocido), NUNCA null.
    // ───────────────────────────────────────────────────────────
    const motorGratisId = await crearMotorConPrecio({ input: '0', output: '0', cachedInput: '0' });
    const proyectoGratisId = await crearProyectoDePrueba(docenteId, 'Recurso E2E M4 — gratis');

    await recordUsage({
      userId: docenteId,
      projectId: proyectoGratisId,
      aiModelId: motorGratisId,
      model: 'modelo-gratis',
      promptTokens: 800,
      cachedInputTokens: 0,
      completionTokens: 400,
      precios: { input: new Prisma.Decimal('0'), output: new Prisma.Decimal('0'), cachedInput: new Prisma.Decimal('0') },
    });

    const filaGratis = await prisma.tokenUsage.findFirstOrThrow({ where: { projectId: proyectoGratisId } });
    assert.notEqual(filaGratis.costUsd, null, 'un motor gratuito tiene un costo CONOCIDO: cero, no "sin dato"');
    assert.ok(filaGratis.costUsd?.isZero(), 'el costo de un turno gratis debe ser exactamente 0');
    console.log('✔ un turno en un motor gratuito escribe costUsd = 0, nunca NULL');

    // ───────────────────────────────────────────────────────────
    // 4. Motor sin precio cargado: costUsd = NULL (desconocido, no cero).
    // ───────────────────────────────────────────────────────────
    const motorSinPrecioId = await crearMotorSinPrecio();
    const proyectoSinPrecioId = await crearProyectoDePrueba(docenteId, 'Recurso E2E M4 — sin precio');

    await recordUsage({
      userId: docenteId,
      projectId: proyectoSinPrecioId,
      aiModelId: motorSinPrecioId,
      model: 'modelo-sin-precio',
      promptTokens: 600,
      cachedInputTokens: 0,
      completionTokens: 300,
      precios: null,
    });

    const filaSinPrecio = await prisma.tokenUsage.findFirstOrThrow({ where: { projectId: proyectoSinPrecioId } });
    assert.equal(filaSinPrecio.costUsd, null, 'sin precios cargados el costo es desconocido, nunca inventado');
    assert.equal(filaSinPrecio.priceInputSnapshot, null);

    const consumoSinPrecio = await costoPorProyecto(proyectoSinPrecioId);
    assert.equal(consumoSinPrecio.tokens, 900, 'los tokens SÍ se conocen aunque el costo no');
    assert.equal(consumoSinPrecio.costUsd, null, 'costoPorProyecto no debe fabricar un total cuando el precio no se cargó');
    console.log('✔ un motor con precio sin cargar escribe costUsd NULL, y costoPorProyecto lo respeta (no lo inventa)');

    // ───────────────────────────────────────────────────────────
    // 5. Fila con forma "histórica" (como las de antes de esta migración):
    //    projectId/aiModelId/costUsd en NULL. Nada debe backfillearla ni
    //    atribuirle plata que nunca se calculó.
    // ───────────────────────────────────────────────────────────
    await prisma.tokenUsage.create({
      data: {
        userId: docenteId,
        provider: 'MINIMAX',
        model: MODELO_HISTORICO,
        promptTokens: 1_200,
        completionTokens: 600,
        // projectId, aiModelId, costUsd y los tres snapshots quedan en su
        // default: NULL. Así es exactamente una fila de antes de M4.
      },
    });
    const filaHistorica = await prisma.tokenUsage.findFirstOrThrow({ where: { model: MODELO_HISTORICO } });
    assert.equal(filaHistorica.projectId, null, 'una fila histórica no tiene recurso asociado');
    assert.equal(filaHistorica.aiModelId, null, 'una fila histórica no tiene motor del catálogo');
    assert.equal(filaHistorica.costUsd, null, 'una fila histórica nunca tiene un costo inventado');
    console.log('✔ una fila con forma histórica (sin projectId/aiModelId) queda con costUsd NULL — se renderiza "histórico", nunca $0');

    // ───────────────────────────────────────────────────────────
    // 6. Un recurso con consumo alto (para el nivel "medio" del indicador).
    // ───────────────────────────────────────────────────────────
    const proyectoMedioId = await crearProyectoDePrueba(docenteId, 'Recurso E2E M4 — consumo medio');
    await recordUsage({
      userId: docenteId,
      projectId: proyectoMedioId,
      aiModelId: motorGratisId,
      model: 'modelo-gratis',
      promptTokens: Math.ceil(CONSUMO_MEDIO * 0.7),
      cachedInputTokens: 0,
      completionTokens: Math.ceil(CONSUMO_MEDIO * 0.3),
      precios: { input: new Prisma.Decimal('0'), output: new Prisma.Decimal('0'), cachedInput: new Prisma.Decimal('0') },
    });
    console.log('✔ preparado un recurso con tokens por encima del corte de "Consumo medio"');

    // Recurso sin ningún turno: el indicador debe estar AUSENTE, nunca en "0".
    const proyectoVacioId = await crearProyectoDePrueba(docenteId, 'Recurso E2E M4 — sin uso');

    // ───────────────────────────────────────────────────────────
    // 7. El indicador en el workspace: nivel por defecto, revelado con mouse,
    //    tap y foco de teclado, en los dos temas. Ausente sin uso.
    // ───────────────────────────────────────────────────────────
    const browser = await abrirNavegador();
    try {
      const contexto = await browser.newContext();
      const page = await contexto.newPage();
      await iniciarSesion(page, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

      // La isla (`client:load`) puede tener su HTML en el DOM un instante
      // antes de que React termine de hidratarla: un hover/click/focus justo
      // en ese hueco no dispara nada (el <button> existe pero todavía no
      // tiene sus handlers). Se reintenta el gesto hasta que el popover
      // realmente aparezca/desaparezca — la misma trampa de hidratación que
      // e2e/m3-motores.ts ya documenta.
      async function revelarConReintento(gesto: () => Promise<void>): Promise<void> {
        await esperarHasta(async () => {
          await gesto();
          return (await page.locator('[role="status"]').count()) > 0;
        });
      }
      async function cerrarConReintento(gesto: () => Promise<void>): Promise<void> {
        await esperarHasta(async () => {
          await gesto();
          return (await page.locator('[role="status"]').count()) === 0;
        });
      }

      // 7.a — lectura por defecto: nivel cualitativo, sin moneda.
      await page.goto(`${BASE_URL}/app/project/${proyectoPagoId}`, { waitUntil: 'domcontentloaded' });
      const boton = page.getByRole('button', { name: /^Consumo (bajo|medio|alto)$/ });
      await boton.waitFor();
      const textoBoton = (await boton.textContent()) ?? '';
      assert.equal(textoBoton.trim(), 'Consumo bajo', 'un recurso con pocos tokens debe leer "Consumo bajo"');
      assert.ok(!textoBoton.includes('$'), 'la lectura por defecto no debe mostrar moneda');
      assert.ok(!/ficha/i.test(textoBoton), 'la copia del indicador no debe usar la palabra "ficha"');
      assert.equal(await page.locator('[role="status"]').count(), 0, 'el popover no debe estar abierto al cargar');
      console.log('✔ lectura por defecto: "Consumo bajo", sin moneda, sin la palabra "ficha"');

      // 7.b — hover revela tokens, nunca un monto (publicacion-likes-y-motores
      // le saca el USD al indicador para el docente: spec `ai-cost-accounting`
      // "No interaction reveals a dollar amount to a teacher").
      const popover = page.locator('[role="status"]');
      await revelarConReintento(() => boton.hover());
      const textoPopoverHover = (await popover.textContent()) ?? '';
      assert.match(textoPopoverHover, /tokens/i);
      assert.ok(!textoPopoverHover.includes('US$'), 'el popover no debe mostrar "US$"');
      assert.ok(!textoPopoverHover.includes('$'), 'el popover no debe mostrar ningún "$"');
      console.log('✔ el mouse (hover) revela tokens, nunca un monto en USD');

      await cerrarConReintento(() => page.mouse.move(0, 0));
      console.log('✔ alejar el mouse cierra el popover');

      // 7.c — tap/click también revela.
      await revelarConReintento(() => boton.click());
      console.log('✔ el tap/click también revela el popover');
      await cerrarConReintento(() => boton.blur());

      // 7.d — foco de teclado (sin mouse) revela, y Escape cierra.
      await revelarConReintento(() => boton.focus());
      console.log('✔ el foco de teclado revela el popover, sin usar el mouse');
      await page.keyboard.press('Enter');
      assert.equal(await popover.count(), 1, 'Enter sobre el botón enfocado no debería cerrar el popover');
      console.log('✔ Enter sobre el botón enfocado no rompe el popover (sigue revelado)');
      await cerrarConReintento(() => page.keyboard.press('Escape'));
      console.log('✔ Escape cierra el popover revelado por teclado');

      // 7.e — el mismo recorrido, en tema oscuro: tampoco hay monto acá.
      await conTema(page, 'dark');
      await boton.waitFor();
      await revelarConReintento(() => boton.focus());
      const textoPopoverDark = (await popover.textContent()) ?? '';
      assert.ok(!textoPopoverDark.includes('US$'), 'tampoco en tema oscuro debe verse "US$"');
      await cerrarConReintento(() => page.keyboard.press('Escape'));
      console.log('✔ el indicador funciona igual en tema oscuro (foco de teclado + revelado), sin monto');

      // 7.f — nivel "medio" en el recurso con más tokens.
      await page.goto(`${BASE_URL}/app/project/${proyectoMedioId}`, { waitUntil: 'domcontentloaded' });
      const botonMedio = page.getByRole('button', { name: /^Consumo (bajo|medio|alto)$/ });
      await botonMedio.waitFor();
      assert.equal((await botonMedio.textContent())?.trim(), 'Consumo medio');
      console.log('✔ un recurso con tokens por encima del corte muestra "Consumo medio"');

      // 7.g — motor sin precio: ya no hay ningún mensaje condicionado al
      // precio para el docente. El popover lee la MISMA línea estática que
      // en 7.b, sin importar si el motor tiene precio cargado o no — el
      // mensaje price-conditional que esto probaba ya no existe (Phase 8).
      await page.goto(`${BASE_URL}/app/project/${proyectoSinPrecioId}`, { waitUntil: 'domcontentloaded' });
      const botonSinPrecio = page.getByRole('button', { name: /^Consumo (bajo|medio|alto)$/ });
      await botonSinPrecio.waitFor();
      const popoverSinPrecio = page.locator('[role="status"]');
      await esperarHasta(async () => {
        await botonSinPrecio.hover();
        return (await popoverSinPrecio.count()) > 0;
      });
      const textoSinPrecio = (await popoverSinPrecio.textContent()) ?? '';
      assert.match(textoSinPrecio, /procesó la IA en este recurso/i);
      assert.ok(!textoSinPrecio.includes('US$'), 'un motor sin precio tampoco debe mostrar "US$"');
      assert.ok(!/sin precio/i.test(textoSinPrecio), 'ya no existe el aviso "sin precios": la línea es siempre la misma');
      console.log('✔ un motor sin precio cargado muestra la misma línea estática, sin ningún condicional de precio');

      // 7.h — sin ningún turno, el indicador está AUSENTE (nunca un "0").
      await page.goto(`${BASE_URL}/app/project/${proyectoVacioId}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('h1'); // la página cargó
      const sinIndicador = await page.getByRole('button', { name: /^Consumo (bajo|medio|alto)$/ }).count();
      assert.equal(sinIndicador, 0, 'un recurso sin ningún turno no debe mostrar el indicador');
      console.log('✔ un recurso sin uso no muestra ningún indicador (nunca "Consumo bajo" en $0)');

      await contexto.close();
    } finally {
      await browser.close();
    }
  } finally {
    await limpiarEstado(docenteId);
    await prisma.$disconnect();
  }
}

async function esperarHasta(condicion: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (await condicion()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('esperarHasta: la condición nunca se cumplió a tiempo');
}

main()
  .then(() => {
    console.log('\n✔ e2e/m4-costos.ts: todos los escenarios pasaron');
  })
  .catch((error) => {
    console.error('\n✖ e2e/m4-costos.ts falló:', error);
    process.exitCode = 1;
  });
