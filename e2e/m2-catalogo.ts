import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, iniciarSesion } from './harness.ts';
import { cadenaDeMotores, invalidarCatalogo } from '../src/lib/ai/catalogo.ts';
import { cifrar } from '../src/lib/crypto/secretos.ts';

/**
 * Verificación de slice M2: catálogo de motores, cifrado, y el turno de un
 * docente resolviendo a través de él.
 *
 * **Estado de este entorno**: `AI_MINIMAX_API_KEY`/`AI_DEEPSEEK_API_KEY` están
 * vacías en `.env` (no hay credenciales reales de ningún proveedor acá), y la
 * semilla de M2 deja `apiKeyCipher` en NULL a propósito (design.md §3 — las
 * claves se cargan por el panel admin, que recién llega en M3). Por eso este
 * check no puede probar "la IA contestó de verdad": prueba que el pedido
 * resuelve el motor correcto, recorre la cadena, y falla de forma prolija y
 * persistida cuando ningún motor tiene clave — que es el comportamiento
 * correcto dado el estado real de este entorno, no un defecto.
 *
 * Corre con: npx tsx e2e/m2-catalogo.ts
 */

const DOCENTE_EMAIL = 'docente-e2e-m2@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const MINIMAX_M3_ID = '10000000-0000-0000-0000-000000000001';
const MINIMAX_M27_ID = '10000000-0000-0000-0000-000000000002';
/** Ambos motores de la semilla comparten esta cuenta (`gmi`), sin clave. */
const GMI_PROVIDER_ID = '10000000-0000-0000-0000-000000000001';
/** Cuenta de proveedor propia de este script, con clave, creada y borrada por el test. */
const PROVEEDOR_KEYED_ID = 'e2e-m2-provider-keyed';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function asegurarDocenteDePrueba(): Promise<string> {
  const docente = await prisma.user.upsert({
    where: { email: DOCENTE_EMAIL },
    update: { role: 'DOCENTE' },
    create: {
      email: DOCENTE_EMAIL,
      name: 'Docente E2E M2',
      role: 'DOCENTE',
      passwordHash: await hashPassword(DOCENTE_PASSWORD),
    },
    select: { id: true },
  });
  return docente.id;
}

async function main(): Promise<void> {
  await asegurarDocenteDePrueba();
  const browser = await abrirNavegador();

  try {
    // 1. Un docente abre un recurso nuevo: la página lo repuntúa al default
    //    vigente (MiniMax M3, el único con isDefault=true en la semilla) y lo
    //    persiste — sin que nadie haya tocado el enum viejo.
    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    await iniciarSesion(page, { email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD });

    const creado = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { title: 'Recurso E2E M2' },
    });
    assert.ok(creado.ok(), `crear el recurso debería dar 200, dio ${creado.status()}`);
    const { project } = (await creado.json()) as { project: { id: string; threadId: string } };

    await page.goto(`${BASE_URL}/app/project/${project.id}`, { waitUntil: 'domcontentloaded' });
    console.log('✔ el recurso nuevo abre en el editor sin errores');

    const filaProyecto = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { aiModelId: true },
    });
    assert.equal(
      filaProyecto.aiModelId,
      MINIMAX_M3_ID,
      'un recurso sin motor asignado debe repuntar al default de la semilla (MiniMax M3)',
    );
    console.log('✔ el recurso se asigna al motor por defecto sembrado (MiniMax M3) al abrirse');

    // El selector del chat muestra el motor por su nombre, nunca su id interno.
    // Desde publicacion-likes-y-motores el selector es un listbox
    // (`#selector-motor`, design §8), no el grupo de botones segmentado
    // anterior — el disparador cerrado ya muestra el `displayName` elegido.
    await page.waitForSelector('#selector-motor:has-text("MiniMax M3")');
    console.log('✔ el selector del chat muestra "MiniMax M3" como motor activo');

    // 2. Un docente manda un mensaje: el turno recorre la cadena de motores
    //    (los tres están sin clave en este entorno) y falla de forma prolija
    //    y persistida — no un cuelgue, no una excepción sin manejar.
    await page.getByPlaceholder('Preguntale a Kodu…').fill('Hacé una actividad de sumas para 2do grado.');
    await page.getByRole('button', { name: 'Enviar' }).click();

    const banner = page.locator('[role="alert"] p');
    await banner.waitFor({ timeout: 20_000 });
    const mensajeError = (await banner.textContent()) ?? '';
    assert.match(
      mensajeError,
      /no tiene configurada la clave|Ningún motor/i,
      `el error debería explicar la falta de clave, fue: "${mensajeError}"`,
    );
    console.log('✔ sin ninguna clave cargada, el turno falla de forma prolija (no un cuelgue)');

    const hilo = await prisma.chatThread.findFirstOrThrow({
      where: { projectId: project.id },
      select: { id: true },
    });
    const ultimoMensaje = await prisma.chatMessage.findFirst({
      where: { threadId: hilo.id, role: 'assistant' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(ultimoMensaje, 'el turno fallido igual tiene que quedar registrado en el hilo');
    assert.match(ultimoMensaje!.content, /No pude completar el pedido/);
    console.log('✔ el turno fallido queda persistido en el hilo (no se pierde silenciosamente)');

    const consumoRegistrado = await prisma.tokenUsage.count({ where: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: DOCENTE_EMAIL }, select: { id: true } })).id } });
    assert.equal(consumoRegistrado, 0, 'un turno que no gastó nada no debe escribir TokenUsage');
    console.log('✔ un turno sin tokens gastados no ensucia TokenUsage');

    await contexto.close();

    // 3. La cadena SALTEA un motor sin clave utilizable y usa el siguiente.
    //    Se prueba directo contra el catálogo (mismo módulo que usa stream.ts).
    //
    //    Re-expresado por catalogo-de-proveedores: antes, la clave vivía en la
    //    fila de `AiModel`, así que alcanzaba con setear `apiKeyCipher` en
    //    MiniMax M2.7 mientras M3 quedaba sin clave. Ahora la clave vive en la
    //    CUENTA (`AiProvider`), y la migración fusionó M3 y M2.7 en la MISMA
    //    cuenta `gmi` (ver migration.sql §2.2, caso all-NULL) — habilitar la
    //    clave en esa cuenta habilitaría a los dos motores a la vez, y el
    //    escenario "M2.7 con clave, M3 sin clave" dejaría de ser expresable.
    //    Se re-arma con dos cuentas: se crea una segunda cuenta CON clave
    //    (`PROVEEDOR_KEYED_ID`) y se re-apunta M2.7 a ella temporalmente,
    //    mientras M3 se queda en `gmi` (sin clave). El comportamiento bajo
    //    prueba — la cadena saltea un motor cuya cuenta no tiene clave
    //    utilizable y sigue con el siguiente — sigue siendo el mismo.
    await prisma.aiProvider.create({
      data: {
        id: PROVEEDOR_KEYED_ID,
        kind: 'test-e2e-m2',
        label: 'Cuenta E2E M2 (con clave)',
        baseUrl: 'http://localhost:0',
        apiKeyCipher: cifrar('clave-de-prueba-e2e', PROVEEDOR_KEYED_ID),
        enabled: true,
      },
    });
    await prisma.aiModel.update({
      where: { id: MINIMAX_M27_ID },
      data: { providerId: PROVEEDOR_KEYED_ID },
    });
    invalidarCatalogo();

    try {
      const cadena = await cadenaDeMotores(MINIMAX_M3_ID);
      assert.equal(cadena.length, 1, `esperaba que sólo M2.7 quede en la cadena (M3 sin clave, DeepSeek sin clave), dio ${cadena.length}`);
      assert.equal(cadena[0]!.id, MINIMAX_M27_ID, 'el motor cuya cuenta no tiene clave (M3) tiene que quedar afuera de la cadena');
      console.log('✔ un motor cuya cuenta no tiene clave utilizable queda afuera de la cadena; el siguiente con clave entra');
    } finally {
      await prisma.aiModel.update({ where: { id: MINIMAX_M27_ID }, data: { providerId: GMI_PROVIDER_ID } });
      await prisma.aiProvider.delete({ where: { id: PROVEEDOR_KEYED_ID } });
      invalidarCatalogo();
    }
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    console.log('\n✔ e2e/m2-catalogo.ts: todos los escenarios pasaron');
  })
  .catch((error) => {
    console.error('\n✖ e2e/m2-catalogo.ts falló:', error);
    process.exitCode = 1;
  });
