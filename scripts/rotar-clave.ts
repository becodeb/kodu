import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { cifrarConClaveHex, descifrarConClaveHex } from '../src/lib/crypto/secretos.ts';

/**
 * Rotación de `KODU_ENCRYPTION_KEY`.
 *
 * Descifra cada `AiModel.apiKeyCipher` con `KODU_ENCRYPTION_KEY_OLD` y lo
 * vuelve a cifrar con `KODU_ENCRYPTION_KEY`, todo en una sola transacción: o
 * rotan todas las filas o no rota ninguna, nunca un catálogo a medio migrar.
 *
 * Re-cifrar en cada lectura (en vez de un script aparte) se descartó a
 * propósito (design.md §4): la lectura pasa por el camino caliente del chat,
 * y una escritura escondida ahí es la clase de efecto secundario que
 * sorprende a alguien a las 2am.
 *
 * Ejecutar con: npx tsx scripts/rotar-clave.ts
 */

const claveVieja = process.env.KODU_ENCRYPTION_KEY_OLD ?? '';
const claveNueva = process.env.KODU_ENCRYPTION_KEY ?? '';

async function main(): Promise<void> {
  if (!claveVieja || !claveNueva) {
    throw new Error(
      'Hacen falta KODU_ENCRYPTION_KEY_OLD (la clave con la que están cifradas hoy) y ' +
        'KODU_ENCRYPTION_KEY (la nueva) en el entorno.',
    );
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
  const prisma = new PrismaClient({ adapter });

  try {
    const filas = await prisma.aiModel.findMany({
      where: { apiKeyCipher: { not: null } },
      select: { id: true, displayName: true, apiKeyCipher: true },
    });

    if (filas.length === 0) {
      console.log('✔ Ningún motor tiene clave cargada: nada para rotar.');
      return;
    }

    const reescrituras = filas.map((fila) => {
      // El AAD es el `id` de la fila (ver secretos.ts): no cambia con la
      // rotación, sólo cambia la clave de cifrado.
      const textoPlano = descifrarConClaveHex(fila.apiKeyCipher!, fila.id, claveVieja);
      const nuevoCipher = cifrarConClaveHex(textoPlano, fila.id, claveNueva);
      return { id: fila.id, displayName: fila.displayName, nuevoCipher };
    });

    await prisma.$transaction(
      reescrituras.map((fila) =>
        prisma.aiModel.update({ where: { id: fila.id }, data: { apiKeyCipher: fila.nuevoCipher } }),
      ),
    );

    console.log(`✔ ${reescrituras.length} clave(s) rotada(s): ${reescrituras.map((f) => f.displayName).join(', ')}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('✖ Rotación falló:', error);
  process.exitCode = 1;
});
