import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Locator } from 'playwright';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, conTema, iniciarSesion } from './harness.ts';
import { calcularCostoTurno, type Precios } from '../src/lib/ai/usage.ts';

/**
 * Verificación de slice M5: tabla de docentes + menú de fila + detalle de
 * usuario con gráficos SVG (specs/admin-users/spec.md).
 *
 * **No hay credenciales reales de ningún proveedor en este entorno** (mismo
 * motivo que e2e/m4-costos.ts): las filas de `TokenUsage` se escriben
 * directamente, con `createdAt` corrido a mano para poblar los últimos 30
 * días, reusando `calcularCostoTurno` (la misma aritmética que `stream.ts`)
 * en vez de duplicarla.
 *
 * **`aiAccessOverride` no se prueba acá.** M5 lo dejó afuera a propósito —
 * esa columna todavía no existe, ver `src/lib/admin/usuarios.ts` — así que
 * "Acceso a la IA" sólo puede leer "Sí · por dominio" en este entorno
 * (`ALLOWED_EMAIL_DOMAINS` vacío ⇒ todo dominio entra).
 *
 * **La escena 5.8 ("abrir un recurso ajeno")** verifica sólo que el enlace
 * exista, apunte al id correcto y abra el recurso — el bypass de propiedad
 * en sí (prompt, edición, banner, atribución) es M8 y se cubre entero en
 * `e2e/m8-proyectos-ajenos.ts`, no acá.
 *
 * Corre con: npx tsx e2e/m5-usuarios.ts
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';

const DOCENTE_PASSWORD = 'Docente.E2E.2026';
const EMAIL_MULTI = 'docente-e2e-m5-multi@kodu.local';
const EMAIL_UNO = 'docente-e2e-m5-uno@kodu.local';
const EMAIL_VACIO = 'docente-e2e-m5-vacio@kodu.local';
const EMAIL_GRATIS = 'docente-e2e-m5-gratis@kodu.local';
const EMAIL_SIN_PRECIO = 'docente-e2e-m5-sinprecio@kodu.local';
const EMAIL_PROMOVER = 'docente-e2e-m5-promover@kodu.local';
const EMAIL_ADMIN_SOLO = 'admin-e2e-m5-solo@kodu.local';

const TODOS_LOS_EMAILS = [
  EMAIL_MULTI,
  EMAIL_UNO,
  EMAIL_VACIO,
  EMAIL_GRATIS,
  EMAIL_SIN_PRECIO,
  EMAIL_PROMOVER,
  EMAIL_ADMIN_SOLO,
];

const MARCA_MOTOR_PRUEBA = 'test-m5';
const MODELO_HISTORICO = 'e2e-m5-modelo-historico';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function asegurarDocentes(): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const email of TODOS_LOS_EMAILS) {
    const usuario = await prisma.user.upsert({
      where: { email },
      update: { role: 'DOCENTE' },
      create: {
        email,
        name: `Docente ${email.split('@')[0]}`,
        role: 'DOCENTE',
        passwordHash: await hashPassword(DOCENTE_PASSWORD),
      },
      select: { id: true },
    });
    ids[email] = usuario.id;
  }
  return ids;
}

async function crearMotorConPrecio(opts: { input: string; output: string }): Promise<string> {
  const id = randomUUID();
  await prisma.aiModel.create({
    data: {
      id,
      provider: MARCA_MOTOR_PRUEBA,
      providerModel: `modelo-${id.slice(0, 8)}`,
      displayName: 'Motor E2E M5 — pago',
      baseUrl: 'http://localhost:0',
      enabled: true,
      selectableByTeacher: false,
      priceInputPerMToken: opts.input,
      priceOutputPerMToken: opts.output,
    },
  });
  return id;
}

async function crearMotorGratis(): Promise<string> {
  const id = randomUUID();
  await prisma.aiModel.create({
    data: {
      id,
      provider: MARCA_MOTOR_PRUEBA,
      providerModel: `gratis-${id.slice(0, 8)}`,
      displayName: 'Motor E2E M5 — gratis',
      baseUrl: 'http://localhost:0',
      enabled: true,
      selectableByTeacher: false,
      priceInputPerMToken: '0',
      priceOutputPerMToken: '0',
    },
  });
  return id;
}

async function crearMotorSinPrecio(): Promise<string> {
  const id = randomUUID();
  await prisma.aiModel.create({
    data: {
      id,
      provider: MARCA_MOTOR_PRUEBA,
      providerModel: `sinprecio-${id.slice(0, 8)}`,
      displayName: 'Motor E2E M5 — sin precio',
      baseUrl: 'http://localhost:0',
      enabled: true,
      selectableByTeacher: false,
    },
  });
  return id;
}

async function crearProyecto(userId: string, titulo: string): Promise<string> {
  const proyecto = await prisma.project.create({
    data: { title: titulo, slug: `e2e-m5-${randomUUID()}`, userId },
    select: { id: true },
  });
  return proyecto.id;
}

/** Escribe una fila de `TokenUsage` con `createdAt` corrido `diasAtras` días,
 *  reusando `calcularCostoTurno` (la misma aritmética de producción). */
async function crearTurno(opts: {
  userId: string;
  projectId: string | null;
  aiModelId: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  precios: Precios | null;
  diasAtras: number;
}): Promise<void> {
  const costo = calcularCostoTurno(opts.promptTokens, 0, opts.completionTokens, opts.precios);
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() - opts.diasAtras);

  await prisma.tokenUsage.create({
    data: {
      userId: opts.userId,
      projectId: opts.projectId,
      aiModelId: opts.aiModelId,
      model: opts.model,
      promptTokens: opts.promptTokens,
      cachedInputTokens: 0,
      completionTokens: opts.completionTokens,
      costUsd: costo.costUsd,
      priceInputSnapshot: costo.priceInputSnapshot,
      priceOutputSnapshot: costo.priceOutputSnapshot,
      priceCachedInputSnapshot: costo.priceCachedInputSnapshot,
      createdAt: fecha,
    },
  });
}

async function limpiarEstado(ids: Record<string, string>): Promise<void> {
  const userIds = Object.values(ids);
  await prisma.tokenUsage.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.project.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.aiModel.deleteMany({ where: { provider: MARCA_MOTOR_PRUEBA } });
  // El de "único admin" nunca debe quedar ADMIN entre corridas.
  await prisma.user.updateMany({ where: { email: EMAIL_ADMIN_SOLO }, data: { role: 'DOCENTE' } });
}

async function main(): Promise<void> {
  const ids = await asegurarDocentes();
  await limpiarEstado(ids);

  try {
    // ───────────────────────────────────────────────────────────
    // Datos de prueba: un motor pago, uno gratuito, uno sin precio cargado.
    // ───────────────────────────────────────────────────────────
    const motorPagoId = await crearMotorConPrecio({ input: '10', output: '20' });
    const preciosPago: Precios = {
      input: new Prisma.Decimal('10'),
      output: new Prisma.Decimal('20'),
      cachedInput: null,
    };
    const motorGratisId = await crearMotorGratis();
    const preciosGratis: Precios = {
      input: new Prisma.Decimal('0'),
      output: new Prisma.Decimal('0'),
      cachedInput: null,
    };
    const motorSinPrecioId = await crearMotorSinPrecio();

    // MULTI: 3 días distintos, 2 motores, costo real conocido y positivo.
    const proyectoMultiId = await crearProyecto(ids[EMAIL_MULTI]!, 'Recurso E2E M5 — multi');
    await crearTurno({
      userId: ids[EMAIL_MULTI]!,
      projectId: proyectoMultiId,
      aiModelId: motorPagoId,
      model: 'modelo-pago',
      promptTokens: 10_000,
      completionTokens: 5_000,
      precios: preciosPago,
      diasAtras: 20,
    });
    await crearTurno({
      userId: ids[EMAIL_MULTI]!,
      projectId: proyectoMultiId,
      aiModelId: motorGratisId,
      model: 'modelo-gratis',
      promptTokens: 2_000,
      completionTokens: 1_000,
      precios: preciosGratis,
      diasAtras: 5,
    });
    await crearTurno({
      userId: ids[EMAIL_MULTI]!,
      projectId: proyectoMultiId,
      aiModelId: motorPagoId,
      model: 'modelo-pago',
      promptTokens: 5_000,
      completionTokens: 2_500,
      precios: preciosPago,
      diasAtras: 2,
    });
    // Total: 25.500 tokens, costo 0,30 (0,20 + 0,10), positivo — nunca "gratis".
    console.log('✔ preparado: docente con consumo multi-día y multi-motor');

    // UNO: un solo turno, un solo día dentro de la ventana de 30 días.
    const proyectoUnoId = await crearProyecto(ids[EMAIL_UNO]!, 'Recurso E2E M5 — un turno');
    await crearTurno({
      userId: ids[EMAIL_UNO]!,
      projectId: proyectoUnoId,
      aiModelId: motorPagoId,
      model: 'modelo-pago',
      promptTokens: 1_000,
      completionTokens: 500,
      precios: preciosPago,
      diasAtras: 3,
    });
    console.log('✔ preparado: docente con un solo turno (un solo día con datos)');

    // VACÍO: un recurso, ningún turno — "todavía no usó la IA".
    await crearProyecto(ids[EMAIL_VACIO]!, 'Recurso E2E M5 — sin uso');
    console.log('✔ preparado: docente con un recurso pero sin ningún turno');

    // GRATIS: dos días, siempre el motor gratuito — costo CONOCIDO en cero.
    const proyectoGratisId = await crearProyecto(ids[EMAIL_GRATIS]!, 'Recurso E2E M5 — todo gratis');
    await crearTurno({
      userId: ids[EMAIL_GRATIS]!,
      projectId: proyectoGratisId,
      aiModelId: motorGratisId,
      model: 'modelo-gratis',
      promptTokens: 3_000,
      completionTokens: 1_000,
      precios: preciosGratis,
      diasAtras: 10,
    });
    await crearTurno({
      userId: ids[EMAIL_GRATIS]!,
      projectId: proyectoGratisId,
      aiModelId: motorGratisId,
      model: 'modelo-gratis',
      promptTokens: 2_000,
      completionTokens: 500,
      precios: preciosGratis,
      diasAtras: 1,
    });
    console.log('✔ preparado: docente con consumo, siempre en el motor gratuito');

    // SIN PRECIO: un turno en un motor sin precio cargado (dentro de la
    // ventana) + una fila con forma histórica bien vieja (fuera de la
    // ventana, sólo la ve el gráfico de barras, que es de todo el tiempo).
    const proyectoSinPrecioId = await crearProyecto(ids[EMAIL_SIN_PRECIO]!, 'Recurso E2E M5 — sin precio');
    await crearTurno({
      userId: ids[EMAIL_SIN_PRECIO]!,
      projectId: proyectoSinPrecioId,
      aiModelId: motorSinPrecioId,
      model: 'modelo-sin-precio',
      promptTokens: 800,
      completionTokens: 400,
      precios: null,
      diasAtras: 1,
    });
    await prisma.tokenUsage.create({
      data: {
        userId: ids[EMAIL_SIN_PRECIO]!,
        provider: 'MINIMAX',
        model: MODELO_HISTORICO,
        promptTokens: 1_500,
        completionTokens: 700,
        createdAt: (() => {
          const fecha = new Date();
          fecha.setUTCDate(fecha.getUTCDate() - 60);
          return fecha;
        })(),
      },
    });
    console.log('✔ preparado: docente con un motor sin precio + una fila histórica');

    // ───────────────────────────────────────────────────────────
    // La tabla, en tema claro.
    // ───────────────────────────────────────────────────────────
    const browser = await abrirNavegador();
    try {
      const contexto = await browser.newContext();
      const page = await contexto.newPage();
      await iniciarSesion(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('th:has-text("Docente")');

      async function celdas(email: string): Promise<string[]> {
        const fila = page.locator('tr', { hasText: email });
        await fila.waitFor();
        const textos = await fila.locator('td').allTextContents();
        return textos.map((t) => t.trim().replace(/\s+/g, ' '));
      }

      // MULTI: rol, acceso, recursos, tokens, USD, última actividad.
      const filaMulti = await celdas(EMAIL_MULTI);
      assert.match(filaMulti[1]!, /Docente/);
      assert.match(filaMulti[2]!, /Sí · por dominio/);
      assert.equal(filaMulti[3], '1', 'un recurso creado');
      assert.equal(filaMulti[4], '25.500', 'tokens acumulados de los 3 turnos');
      assert.match(filaMulti[5]!, /^≈ US\$ 0,30$/, 'costo positivo real, con el prefijo de aproximación');
      assert.notEqual(filaMulti[6], 'Nunca');
      console.log('✔ tabla: fila multi-día/multi-motor con los 6 campos correctos');

      // UNO: costo también positivo y marcado como aproximado.
      const filaUno = await celdas(EMAIL_UNO);
      assert.equal(filaUno[4], '1.500');
      assert.match(filaUno[5]!, /^≈ US\$/);
      console.log('✔ tabla: fila de un solo turno');

      // VACÍO: nunca "US$ 0,00" para algo que jamás corrió; tokens en 0.
      const filaVacio = await celdas(EMAIL_VACIO);
      assert.equal(filaVacio[3], '1', 'tiene un recurso aunque nunca lo usó');
      assert.equal(filaVacio[4], '0');
      assert.equal(filaVacio[5], '—', 'sin ningún turno, el costo es desconocido, no gratis');
      console.log('✔ tabla: fila sin ningún turno muestra "—", nunca "US$ 0,00"');

      // GRATIS: costo CONOCIDO en cero, sin el prefijo "≈" (no es una estimación).
      const filaGratis = await celdas(EMAIL_GRATIS);
      assert.equal(filaGratis[4], '6.500');
      assert.equal(filaGratis[5], 'US$ 0,00', 'motor gratuito: costo cero conocido, sin "≈"');
      console.log('✔ tabla: fila 100% gratuita muestra "US$ 0,00" exacto, sin aproximar');

      // SIN PRECIO: hay uso real, pero el precio nunca se cargó → "—", nunca $0.
      const filaSinPrecio = await celdas(EMAIL_SIN_PRECIO);
      assert.notEqual(filaSinPrecio[4], '0', 'sí hubo tokens');
      assert.equal(filaSinPrecio[5], '—', 'motor sin precio cargado: desconocido, no "US$ 0,00"');
      console.log('✔ tabla: motor sin precio cargado nunca se confunde con "gratis"');

      // PROMOVER: nunca tuvo actividad ni recursos.
      const filaPromover = await celdas(EMAIL_PROMOVER);
      assert.equal(filaPromover[3], '0');
      assert.equal(filaPromover[6], 'Nunca', 'sin recursos ni turnos, la actividad es "Nunca"');
      console.log('✔ tabla: docente sin ningún recurso ni turno muestra "Nunca"');

      // ───────────────────────────────────────────────────────────
      // El mismo listado, en tema oscuro (no se repiten las 6 filas: alcanza
      // con confirmar que las cifras clave sobreviven el cambio de tema).
      // ───────────────────────────────────────────────────────────
      await conTema(page, 'dark');
      await page.waitForSelector('th:has-text("Docente")');
      const filaMultiDark = await celdas(EMAIL_MULTI);
      assert.equal(filaMultiDark[4], '25.500');
      assert.match(filaMultiDark[5]!, /^≈ US\$ 0,30$/);
      const filaGratisDark = await celdas(EMAIL_GRATIS);
      assert.equal(filaGratisDark[5], 'US$ 0,00');
      console.log('✔ tabla: las mismas cifras se sostienen en tema oscuro');

      // ───────────────────────────────────────────────────────────
      // Detalle de usuario: MULTI (grilla de 30 columnas + barra apilada).
      // ───────────────────────────────────────────────────────────
      await page.goto(`${BASE_URL}/admin/usuarios/${ids[EMAIL_MULTI]}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('h1');
      const textoDetalleMulti = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
      assert.match(textoDetalleMulti, /25,5 k/, 'trío de estadísticas: tokens compactos');
      assert.match(textoDetalleMulti, /≈ US\$ 0,30/, 'trío de estadísticas: costo aproximado');
      assert.equal(await page.locator('svg[role="img"]').count(), 2, 'los dos gráficos están presentes');
      console.log('✔ detalle: docente multi-día/multi-motor renderiza ambos gráficos con sus cifras');

      // UNO: la columna única, sin eje.
      await page.goto(`${BASE_URL}/admin/usuarios/${ids[EMAIL_UNO]}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('h1');
      const svgColumnasUno = page.locator('svg[role="img"]').first();
      assert.equal(await svgColumnasUno.locator('rect').count(), 1, 'un solo turno: una sola columna, sin grilla de 30');
      console.log('✔ detalle: un solo turno renderiza una única columna, no una grilla vacía');

      // VACÍO: la frase, nunca un gráfico roto.
      await page.goto(`${BASE_URL}/admin/usuarios/${ids[EMAIL_VACIO]}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('h1');
      const textoDetalleVacio = await page.locator('main').innerText();
      assert.match(textoDetalleVacio, /Todavía no usó la IA\./);
      assert.equal(await page.locator('svg[role="img"]').count(), 0, 'sin uso, no se dibuja ningún gráfico');
      console.log('✔ detalle: sin ningún turno, la frase reemplaza a los dos gráficos (nunca uno vacío)');

      // GRATIS: el subtítulo aclara "todo con el motor sin costo", no "sin datos".
      await page.goto(`${BASE_URL}/admin/usuarios/${ids[EMAIL_GRATIS]}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('h1');
      const textoDetalleGratis = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
      assert.match(textoDetalleGratis, /todo con el motor sin costo/);
      assert.equal(await page.locator('svg[role="img"]').count(), 2, 'todo gratuito igual dibuja los dos gráficos');
      console.log('✔ detalle: consumo 100% gratuito se lee como tal, no como "sin actividad"');

      // SIN PRECIO: la fila histórica se etiqueta "— histórico" en la leyenda.
      await page.goto(`${BASE_URL}/admin/usuarios/${ids[EMAIL_SIN_PRECIO]}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('h1');
      const textoDetalleSinPrecio = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
      assert.match(textoDetalleSinPrecio, /— histórico/);
      console.log('✔ detalle: la fila histórica (fuera de la ventana de 30 días) se etiqueta en la barra, sin inventarle costo');

      // 5.8 — el enlace al recurso existe, apunta al id correcto, y AHORA
      // (M8 ya en main — ver e2e/m8-proyectos-ajenos.ts para la cobertura
      // completa del bypass) abrirlo como admin abre el recurso de verdad,
      // no rebotar a /app.
      const enlaceRecurso = page.locator(`a[href="/app/project/${proyectoSinPrecioId}"]`);
      await enlaceRecurso.waitFor();
      await enlaceRecurso.click();
      await page.waitForURL(`${BASE_URL}/app/project/${proyectoSinPrecioId}`, { timeout: 10_000 });
      await page.waitForSelector('h1');
      console.log('✔ detalle: el enlace al recurso existe y, como admin, ABRE el recurso ajeno (M8)');

      // ───────────────────────────────────────────────────────────
      // Menú de fila, sólo con teclado: Tab (simulado con foco directo) →
      // Enter abre, Tab entra al primer ítem, Enter lo activa.
      // ───────────────────────────────────────────────────────────
      await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(`${BASE_URL}/admin/usuarios`);
      await page.waitForSelector('th:has-text("Docente")');

      const filaPromoverEl = page.locator('tr', { hasText: EMAIL_PROMOVER });
      const detallePromover = filaPromoverEl.locator('details');
      const resumenPromover = filaPromoverEl.locator('summary');

      // La isla `client:load` puede tener su HTML en el DOM antes de que
      // React termine de hidratarla — mismo hueco que ya documentan
      // e2e/m3-motores.ts y e2e/m4-costos.ts. Se reintenta hasta que el rol
      // realmente cambió en la base, no hasta que la UI "parece" haberlo
      // hecho.
      await esperarHasta(async () => {
        // Se chequea ANTES de tocar el teclado: si un intento anterior ya
        // promovió (el `fetch` del click resolvió recién después de que este
        // mismo bucle reintentó), repetir la secuencia acá volvería a abrir
        // un `<details>` que a esta altura ya lee "Quitar administrador" y lo
        // demovería de nuevo. Una vez que la base ya dice ADMIN, no se vuelve
        // a tocar la UI.
        const antes = await prisma.user.findUniqueOrThrow({ where: { id: ids[EMAIL_PROMOVER] } });
        if (antes.role === 'ADMIN') return true;

        await resumenPromover.focus();
        // Si un intento previo YA abrió el panel pero el clic sobre el botón
        // no llegó a tiempo (React todavía sin hidratar), un Enter más sobre
        // el `<summary>` enfocado lo CERRARÍA en vez de abrirlo, y el Tab que
        // sigue escaparía hacia el nombre de la fila siguiente — que es un
        // enlace, así que un Enter ahí navegaría a OTRO docente por completo.
        // Por eso sólo se presiona Enter para abrir cuando de verdad está
        // cerrado.
        const abierto = await detallePromover.evaluate((el) => (el as HTMLDetailsElement).open);
        if (!abierto) await page.keyboard.press('Enter');
        await page.keyboard.press('Tab'); // entra al primer botón del menú
        await page.keyboard.press('Enter'); // "Hacer administrador"
        await page.waitForTimeout(300); // le da tiempo al fetch del click a resolver

        const despues = await prisma.user.findUniqueOrThrow({ where: { id: ids[EMAIL_PROMOVER] } });
        return despues.role === 'ADMIN';
      });
      console.log('✔ menú de fila: Tab→Enter, totalmente por teclado, promovió al docente a administrador');

      // Cierra cualquier menú que haya quedado abierto por los reintentos
      // anteriores antes de leer la celda — el panel abierto no le cambia el
      // texto a la fila, pero cerrarlo deja la lectura sin ambigüedad.
      await page.keyboard.press('Escape');

      const filaPromoverTrasPromover = filaPromoverEl.locator('td').nth(1);
      await assertTexto(filaPromoverTrasPromover, /Admin/);
      console.log('✔ menú de fila: la tabla refleja el nuevo rol sin recargar la página');

      await contexto.close();
    } finally {
      await browser.close();
    }

    // ───────────────────────────────────────────────────────────
    // "La promoción rige en el PRÓXIMO pedido": se inicia sesión ANTES de
    // promover (cookie vieja, con rol DOCENTE adentro del JWT) y se confirma
    // que /admin ya no rebota, sin volver a loguearse (specs/admin-users —
    // "Promotion takes effect on the user's next request").
    // ───────────────────────────────────────────────────────────
    await prisma.user.update({ where: { id: ids[EMAIL_PROMOVER] }, data: { role: 'DOCENTE' } });

    const browser2 = await abrirNavegador();
    try {
      const contexto2 = await browser2.newContext();
      const pagePromovido = await contexto2.newPage();
      await iniciarSesion(pagePromovido, { email: EMAIL_PROMOVER, password: DOCENTE_PASSWORD });

      await pagePromovido.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });
      assert.equal(new URL(pagePromovido.url()).pathname, '/app', 'todavía DOCENTE: /admin rebota a /app');

      // Un admin de verdad promueve por API (no hace falta repetir el menú:
      // ya se probó que el menú llama a esta misma ruta más arriba).
      const contextoAdmin = await browser2.newContext();
      const pageAdmin = await contextoAdmin.newPage();
      await iniciarSesion(pageAdmin, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      const respuestaPromocion = await pageAdmin.request.patch(
        `${BASE_URL}/api/admin/users/${ids[EMAIL_PROMOVER]}`,
        { data: { role: 'ADMIN' } },
      );
      assert.ok(respuestaPromocion.ok(), 'la promoción por API debe responder 200');
      await contextoAdmin.close();

      // MISMA cookie que al principio de este bloque: nunca se volvió a
      // loguear `pagePromovido`. `/admin` en sí mismo siempre redirige a
      // `/admin/usuarios` (la pestaña por defecto, `admin/index.astro`) —
      // lo que importa acá es que el middleware YA NO lo mande a `/app`.
      await pagePromovido.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });
      assert.equal(
        new URL(pagePromovido.url()).pathname,
        '/admin/usuarios',
        'ya ADMIN en la base: el próximo pedido de la MISMA sesión ya no rebota a /app',
      );
      await pagePromovido.waitForSelector('h1:has-text("Panel")');
      console.log('✔ la promoción rige en el próximo pedido, con la cookie vieja, sin volver a loguearse');

      await contexto2.close();
    } finally {
      await browser2.close();
    }

    await prisma.user.update({ where: { id: ids[EMAIL_PROMOVER] }, data: { role: 'DOCENTE' } });

    // ───────────────────────────────────────────────────────────
    // El único administrador no se puede bajar (409, el mensaje literal del
    // spec). Se baja a DOCENTE a todo admin real MENOS uno de prueba
    // dedicado, se intenta la baja, y se restaura todo en el `finally`.
    // ───────────────────────────────────────────────────────────
    const adminsReales = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    await prisma.user.updateMany({ where: { role: 'ADMIN' }, data: { role: 'DOCENTE' } });
    await prisma.user.update({ where: { id: ids[EMAIL_ADMIN_SOLO] }, data: { role: 'ADMIN' } });

    try {
      const browser3 = await abrirNavegador();
      try {
        const contexto3 = await browser3.newContext();
        const pageSolo = await contexto3.newPage();
        await iniciarSesion(pageSolo, { email: EMAIL_ADMIN_SOLO, password: DOCENTE_PASSWORD });

        const respuesta = await pageSolo.request.patch(`${BASE_URL}/api/admin/users/${ids[EMAIL_ADMIN_SOLO]}`, {
          data: { role: 'DOCENTE' },
        });
        assert.equal(respuesta.status(), 409, 'bajar al único admin debe responder 409');
        const cuerpo = (await respuesta.json()) as { error?: string };
        assert.equal(
          cuerpo.error,
          'Sos el único administrador. Nombrá a otro antes de sacarte el rol.',
          'el mensaje debe ser el literal del spec',
        );

        await contexto3.close();
      } finally {
        await browser3.close();
      }
      console.log('✔ API: bajar al único administrador responde 409 con el mensaje del spec');
    } finally {
      // Restaurar SIEMPRE, pase lo que pase arriba.
      await prisma.user.update({ where: { id: ids[EMAIL_ADMIN_SOLO] }, data: { role: 'DOCENTE' } });
      await prisma.$transaction(
        adminsReales.map((admin) => prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } })),
      );
    }

    // ───────────────────────────────────────────────────────────
    // Ningún paquete de gráficos se agregó a package.json.
    // ───────────────────────────────────────────────────────────
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf-8'),
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    const TERMINOS_DE_GRAFICOS = ['chart', 'recharts', 'd3', 'victory', 'nivo', 'apexchart', 'plotly'];
    const todasLasDependencias = [
      ...Object.keys(packageJson.dependencies),
      ...Object.keys(packageJson.devDependencies),
    ];
    const sospechosas = todasLasDependencias.filter((nombre) =>
      TERMINOS_DE_GRAFICOS.some((termino) => nombre.toLowerCase().includes(termino)),
    );
    assert.deepEqual(sospechosas, [], `no debería haber ninguna dependencia de gráficos: ${sospechosas.join(', ')}`);
    console.log('✔ package.json: no se agregó ninguna dependencia de gráficos');
  } finally {
    await limpiarEstado(ids);
    await prisma.$disconnect();
  }
}

async function assertTexto(locator: Locator, patron: RegExp): Promise<void> {
  // `timeout` corto para que CADA lectura falle rápido y sea `esperarHasta`
  // quien reintente — si se usara el timeout por defecto de Playwright (30s)
  // dentro de la condición, un solo intento agotaría todo el presupuesto de
  // `esperarHasta` sin darle ninguna vuelta más al bucle.
  await esperarHasta(async () => {
    const texto = await locator.textContent({ timeout: 1_000 }).catch(() => null);
    return texto !== null && patron.test(texto.trim());
  });
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
    console.log('\n✔ e2e/m5-usuarios.ts: todos los escenarios pasaron');
  })
  .catch((error) => {
    console.error('\n✖ e2e/m5-usuarios.ts falló:', error);
    process.exitCode = 1;
  });
