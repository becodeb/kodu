import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/db.ts';
import { cadenaDeMotores, invalidarCatalogo } from '../src/lib/ai/catalogo.ts';
import { ClaveInvalida, cifrar, descifrar } from '../src/lib/crypto/secretos.ts';

/**
 * Pruebas unitarias sin test runner (no hay uno en este repo — ver context.md).
 * `node:assert/strict` + `tsx`, exit code no-cero si algo falla.
 *
 * Ejecutar con: npx tsx e2e/unidad.ts
 */

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

// ─────────────────────────────────────────────────────────────
// Cifrado (src/lib/crypto/secretos.ts)
// ─────────────────────────────────────────────────────────────

await prueba('cifrar/descifrar: ida y vuelta con el mismo AAD', () => {
  const original = 'sk-una-clave-de-prueba-cualquiera';
  const aad = randomUUID();

  const cifrado = cifrar(original, aad);
  assert.match(cifrado, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'formato v1.<nonce>.<ct>.<tag>');
  assert.notEqual(cifrado, original, 'el valor guardado no puede ser el texto plano');

  const recuperado = descifrar(cifrado, aad);
  assert.equal(recuperado, original);
});

await prueba('descifrar: un AAD distinto (ciphertext copiado a otra fila) rechaza', () => {
  const aadOriginal = randomUUID();
  const aadDeOtraFila = randomUUID();
  const cifrado = cifrar('otra-clave-de-prueba', aadOriginal);

  assert.throws(() => descifrar(cifrado, aadDeOtraFila), ClaveInvalida);
});

// ─────────────────────────────────────────────────────────────
// Catálogo: caminata de la cadena de respaldo (src/lib/ai/catalogo.ts)
// ─────────────────────────────────────────────────────────────

/** Fila mínima de AiModel para las pruebas de abajo, con clave utilizable. */
async function crearMotorDePrueba(opts: {
  providerModel: string;
  fallbackModelId?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await prisma.aiModel.create({
    data: {
      id,
      provider: 'test-unidad',
      providerModel: opts.providerModel,
      displayName: `Prueba ${opts.providerModel}`,
      baseUrl: 'http://localhost:0',
      apiKeyCipher: cifrar('clave-de-prueba', id),
      enabled: true,
      selectableByTeacher: false,
      isDefault: false,
      fallbackModelId: opts.fallbackModelId ?? null,
    },
  });
  return id;
}

async function limpiarMotoresDePrueba(): Promise<void> {
  // Primero se sueltan los fallbackModelId (la FK es ON DELETE SET NULL, pero
  // mejor no depender del orden de borrado entre filas que se referencian
  // entre sí).
  await prisma.aiModel.updateMany({ where: { provider: 'test-unidad' }, data: { fallbackModelId: null } });
  await prisma.aiModel.deleteMany({ where: { provider: 'test-unidad' } });
  invalidarCatalogo();
}

await prueba('cadenaDeMotores: un ciclo A→B→A no cuelga y corta en 2', async () => {
  await limpiarMotoresDePrueba();
  try {
    const idA = await crearMotorDePrueba({ providerModel: 'ciclo-a' });
    const idB = await crearMotorDePrueba({ providerModel: 'ciclo-b', fallbackModelId: idA });
    await prisma.aiModel.update({ where: { id: idA }, data: { fallbackModelId: idB } });
    invalidarCatalogo();

    const cadena = await cadenaDeMotores(idA);

    assert.equal(cadena.length, 2, 'el ciclo tiene que cortar apenas se repite un id, no seguir para siempre');
    assert.deepEqual(
      cadena.map((motor) => motor.id),
      [idA, idB],
    );
  } finally {
    await limpiarMotoresDePrueba();
  }
});

await prueba('cadenaDeMotores: el tope de 3 eslabones se respeta aunque la cadena siga', async () => {
  await limpiarMotoresDePrueba();
  try {
    const idE = await crearMotorDePrueba({ providerModel: 'cap-e' });
    const idD = await crearMotorDePrueba({ providerModel: 'cap-d', fallbackModelId: idE });
    const idC = await crearMotorDePrueba({ providerModel: 'cap-c', fallbackModelId: idD });
    const idB = await crearMotorDePrueba({ providerModel: 'cap-b', fallbackModelId: idC });
    const idA = await crearMotorDePrueba({ providerModel: 'cap-a', fallbackModelId: idB });
    invalidarCatalogo();

    const cadena = await cadenaDeMotores(idA);

    assert.equal(cadena.length, 3, 'la cadena tiene 5 eslabones posibles; el tope duro es 3');
    assert.deepEqual(
      cadena.map((motor) => motor.id),
      [idA, idB, idC],
    );
  } finally {
    await limpiarMotoresDePrueba();
  }
});

await prisma.$disconnect();

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/unidad.ts: todas las pruebas pasaron');
}
