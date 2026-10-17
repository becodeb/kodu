import 'dotenv/config';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { asegurarMotorDePresetSiFalta, invalidarMemoDeAutoprovision } from '../src/lib/ai/catalogo.ts';

/**
 * T16 (motor-claude, "automatico" en producción): pruebas de
 * `catalogo.ts#asegurarMotorDePresetSiFalta` contra una base DE VERDAD
 * (nunca mockeada: la función corre una transacción Prisma real) — una base
 * SCRATCH (`koduedu_autoprov`) creada, migrada y borrada por esta misma
 * prueba en el contenedor `kodu_db_dev`, nunca la base de desarrollo
 * compartida (`koduedu_claude`) — así una corrida fallida de esta prueba no
 * puede dejar basura ahí.
 *
 * Ejecutar con: npx tsx e2e/unidad-autoprovision.ts
 */

const DB_NAME = 'koduedu_autoprov';
const CONTENEDOR = 'kodu_db_dev';
const SCRATCH_URL = `postgresql://kodu:kodu@localhost:5432/${DB_NAME}?schema=public`;

let fallas = 0;

async function prueba(nombre: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✔ ${nombre}`);
  } catch (error) {
    fallas++;
    console.error(`✖ ${nombre}`);
    console.error(`  ${(error as Error).message}`);
  }
}

function psql(sql: string): void {
  execSync(`docker exec ${CONTENEDOR} psql -U kodu -d postgres -v ON_ERROR_STOP=1 -c "${sql}"`, { stdio: 'pipe' });
}

console.log(`Creando base scratch "${DB_NAME}" en ${CONTENEDOR}…`);
psql(`DROP DATABASE IF EXISTS ${DB_NAME}`); // por si una corrida anterior murió sin limpiar.
psql(`CREATE DATABASE ${DB_NAME}`);

console.log('Aplicando migraciones (prisma migrate deploy) contra la base scratch…');
execSync('npx prisma migrate deploy', {
  env: { ...process.env, DATABASE_URL: SCRATCH_URL },
  stdio: 'pipe',
});

const adapter = new PrismaPg({ connectionString: SCRATCH_URL });
const scratch = new PrismaClient({ adapter });

async function crearProveedorAnthropic(enabled: boolean): Promise<string> {
  const id = randomUUID();
  await scratch.aiProvider.create({
    data: {
      id,
      kind: `test-autoprov-${id.slice(0, 8)}`,
      label: 'Cuenta Anthropic de prueba (unidad-autoprovision)',
      baseUrl: 'https://api.anthropic.com',
      apiFormat: 'anthropic',
      enabled,
    },
  });
  return id;
}

try {
  await prueba('sin ninguna cuenta Anthropic habilitada: no crea nada', async () => {
    invalidarMemoDeAutoprovision('claude-haiku-5-5');
    await asegurarMotorDePresetSiFalta('claude-haiku-5-5', scratch);
    const fila = await scratch.aiModel.findFirst({ where: { presetKey: 'claude-haiku-5-5' } });
    assert.equal(fila, null, 'sin cuenta Anthropic, no debería existir ninguna fila para el preset');
  });

  let providerId: string | null = null;

  await prueba('con una cuenta Anthropic habilitada: crea el motor desde el preset', async () => {
    providerId = await crearProveedorAnthropic(true);
    invalidarMemoDeAutoprovision('claude-haiku-5-5');
    await asegurarMotorDePresetSiFalta('claude-haiku-5-5', scratch);

    const fila = await scratch.aiModel.findFirst({ where: { presetKey: 'claude-haiku-5-5' } });
    assert.ok(fila, 'tiene que haber creado una fila para claude-haiku-5-5');
    assert.equal(fila!.providerId, providerId, 'tiene que enlazarla a la cuenta Anthropic recién creada');
    assert.equal(fila!.providerModel, 'claude-haiku-5-5');
    assert.equal(fila!.enabled, true, 'enabled: true');
    assert.equal(fila!.selectableByTeacher, true, 'Haiku 5.5: seleccionable por el docente por default del preset');
    assert.equal(fila!.supportsVision, true, 'Haiku 5.5: con visión por default del preset (revisor visual)');
    assert.equal(fila!.isVerifier, false, 'nunca marca isVerifier solo');
    assert.equal(fila!.isDefault, false, 'nunca marca isDefault solo');
  });

  await prueba('Sonnet/Opus: selectableByTeacher queda en false (son premium)', async () => {
    invalidarMemoDeAutoprovision('claude-sonnet-5-5');
    invalidarMemoDeAutoprovision('claude-opus-5-5');
    await asegurarMotorDePresetSiFalta('claude-sonnet-5-5', scratch);
    await asegurarMotorDePresetSiFalta('claude-opus-5-5', scratch);

    const sonnet = await scratch.aiModel.findFirst({ where: { presetKey: 'claude-sonnet-5-5' } });
    const opus = await scratch.aiModel.findFirst({ where: { presetKey: 'claude-opus-5-5' } });
    assert.ok(sonnet, 'tiene que haber creado Sonnet');
    assert.ok(opus, 'tiene que haber creado Opus');
    assert.equal(sonnet!.selectableByTeacher, false, 'Sonnet: no seleccionable por el docente por default');
    assert.equal(opus!.selectableByTeacher, false, 'Opus: no seleccionable por el docente por default');
    assert.equal(sonnet!.supportsVision, false);
    assert.equal(sonnet!.isVerifier, false);
    assert.equal(sonnet!.isDefault, false);
  });

  await prueba('idempotente: una segunda llamada (sin memoización) no crea una fila duplicada', async () => {
    const antes = await scratch.aiModel.count({ where: { presetKey: 'claude-haiku-5-5' } });
    assert.equal(antes, 1, 'precondición: exactamente una fila de Haiku antes de la segunda llamada');

    invalidarMemoDeAutoprovision('claude-haiku-5-5'); // fuerza que vuelva a pegarle a la base, no a la memoización.
    await asegurarMotorDePresetSiFalta('claude-haiku-5-5', scratch);

    const despues = await scratch.aiModel.count({ where: { presetKey: 'claude-haiku-5-5' } });
    assert.equal(despues, 1, 'sigue habiendo exactamente una fila: la segunda llamada no duplicó nada');
  });

  await prueba('respeta una fila apagada a mano: no la revive ni crea otra', async () => {
    // Apaga la fila de Haiku que las pruebas de arriba crearon — simula al
    // admin apagándola a mano.
    await scratch.aiModel.updateMany({ where: { presetKey: 'claude-haiku-5-5' }, data: { enabled: false } });

    invalidarMemoDeAutoprovision('claude-haiku-5-5');
    await asegurarMotorDePresetSiFalta('claude-haiku-5-5', scratch);

    const filas = await scratch.aiModel.findMany({ where: { presetKey: 'claude-haiku-5-5' } });
    assert.equal(filas.length, 1, 'tiene que seguir habiendo una sola fila (no crea una segunda)');
    assert.equal(filas[0]!.enabled, false, 'la fila apagada a mano tiene que seguir apagada — nunca la revive');
  });

  await prueba('la memoización de proceso evita una segunda consulta incluso si la base cambiara', async () => {
    // Sin invalidar la memoización: aunque la fila de Opus ahora exista
    // (creada arriba), una llamada repetida para el mismo preset es un
    // no-op INMEDIATO (ni abre una transacción) — no hay forma de observar
    // esto desde afuera salvo que no tire y que el estado no cambie, que es
    // justo lo que se confirma acá.
    const antes = await scratch.aiModel.count({ where: { presetKey: 'claude-opus-5-5' } });
    await asegurarMotorDePresetSiFalta('claude-opus-5-5', scratch);
    const despues = await scratch.aiModel.count({ where: { presetKey: 'claude-opus-5-5' } });
    assert.equal(despues, antes, 'memoizado por proceso: no vuelve a tocar la base para el mismo preset');
  });
} finally {
  await scratch.$disconnect();
  console.log(`Borrando base scratch "${DB_NAME}"…`);
  try {
    psql(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  } catch (error) {
    console.error(`No se pudo borrar ${DB_NAME} — borrala a mano: ${(error as Error).message}`);
  }
}

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
} else {
  console.log('\nTodas las pruebas pasaron.');
}
