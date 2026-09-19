import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../../../src/generated/prisma/client.ts';
import { descifrar } from '../../../../../src/lib/crypto/secretos.ts';

/**
 * Rehearsal verify — catalogo-de-proveedores.
 *
 * Corre DESPUÉS de aplicar `migration.sql` hacia adelante sobre el DB
 * escratch ya sembrado por `seed.ts` (ver `README.md`). En este punto el
 * schema YA es el post-migración, así que el cliente Prisma generado del
 * repo (que refleja ese mismo schema) sirve tal cual.
 *
 * Verifica, contra Postgres real y con `descifrar()` real:
 *  - Caso (a) [gratis, del propio dato real del dev DB]: el grupo `gmi`
 *    (MiniMax M3 + M2.7, ambas sin clave antes de la migración) fold-ea en
 *    UNA cuenta, `id` = MIN(id) del grupo, sin cipher.
 *  - Caso (b): la única fila con clave queda como ancla; las 2 hermanas sin
 *    clave se cuelgan de ella; descifra con su propio `id` como AAD.
 *  - Caso (c): las 2 filas con clave NUNCA se fusionan — cada una es su
 *    propia cuenta, cada una descifra con su propio `id`.
 *  - Caso (d): las 2 filas con clave son cada una su propia cuenta (cada una
 *    descifra); las 2 sin clave caen en una TERCERA cuenta separada, sin
 *    clave — nunca se pegan a ninguna de las dos cuentas con clave.
 *  - Cero huérfanos: todo `AiModel.providerId` es NOT NULL (ya lo garantiza
 *    la propia migración con su `RAISE EXCEPTION`, pero se re-confirma acá).
 *
 * Uso: DATABASE_URL=postgresql://kodu:kodu@localhost:5432/koduedu_migration_test npx tsx openspec/changes/catalogo-de-proveedores/rehearsal/verify.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || !DATABASE_URL.includes('koduedu_migration_test')) {
  throw new Error('Este script sólo corre contra la base ESCRATCH koduedu_migration_test.');
}

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const GMI_MODELO_M3 = '10000000-0000-0000-0000-000000000001';
const GMI_MODELO_M27 = '10000000-0000-0000-0000-000000000002';

async function main(): Promise<void> {
  // ── Cero huérfanos.
  const huerfanos = await prisma.aiModel.count({ where: { providerId: null as unknown as string } }).catch(() => 0);
  // providerId es NOT NULL en el schema post-migración: si la migración no
  // hubiese cubierto todos los grupos, ya habría abortado con RAISE EXCEPTION
  // antes de llegar acá. Este count es un chequeo defensivo, no la única red.
  assert.equal(huerfanos, 0, 'no debería haber ningún AiModel sin providerId');
  console.log('✔ cero motores huérfanos (providerId NOT NULL en todos)');

  // ── Caso (a): grupo `gmi` real, ambas filas sin clave, comparten providerId.
  const m3 = await prisma.aiModel.findUniqueOrThrow({ where: { id: GMI_MODELO_M3 }, include: { provider: true } });
  const m27 = await prisma.aiModel.findUniqueOrThrow({ where: { id: GMI_MODELO_M27 }, include: { provider: true } });
  assert.equal(m3.providerId, m27.providerId, 'M3 y M2.7 deberían compartir la misma cuenta (grupo all-NULL)');
  assert.equal(m3.provider.id, GMI_MODELO_M3, 'el ancla del grupo all-NULL debe ser el MIN(id) del grupo');
  assert.equal(m3.provider.apiKeyCipher, null, 'el grupo all-NULL no debe tener cipher');
  console.log(`✔ caso (a): gmi folded a una cuenta (${m3.providerId}), sin clave`);

  // ── Caso (b): single-cipher.
  const anclaB = await prisma.aiModel.findFirstOrThrow({ where: { providerModel: 'rehearsal-b-anchor' }, include: { provider: true } });
  const hermanasB = await prisma.aiModel.findMany({ where: { providerModel: { in: ['rehearsal-b-sibling-1', 'rehearsal-b-sibling-2'] } } });
  assert.equal(anclaB.provider.id, anclaB.id, 'el ancla de un grupo single-cipher debe ser su propia fila');
  for (const hermana of hermanasB) {
    assert.equal(hermana.providerId, anclaB.provider.id, 'las hermanas sin clave deben colgar del ancla con clave');
  }
  const plainB = descifrar(anclaB.provider.apiKeyCipher!, anclaB.provider.id);
  assert.equal(plainB, 'clave-B-anchor-0001', 'el ancla del caso (b) debe descifrar a su clave original');
  console.log(`✔ caso (b): ancla ${anclaB.id} arrastra a sus 2 hermanas sin clave y descifra correcto`);

  // ── Caso (c): multi-cipher, nunca se fusiona.
  const c1 = await prisma.aiModel.findFirstOrThrow({ where: { providerModel: 'rehearsal-c-uno' }, include: { provider: true } });
  const c2 = await prisma.aiModel.findFirstOrThrow({ where: { providerModel: 'rehearsal-c-dos' }, include: { provider: true } });
  assert.notEqual(c1.providerId, c2.providerId, 'las 2 filas con clave del caso (c) NUNCA deben fusionarse');
  assert.equal(c1.provider.id, c1.id, 'cada fila con clave del caso (c) es su propia cuenta');
  assert.equal(c2.provider.id, c2.id, 'cada fila con clave del caso (c) es su propia cuenta');
  assert.equal(descifrar(c1.provider.apiKeyCipher!, c1.provider.id), 'clave-C-primera-0001');
  assert.equal(descifrar(c2.provider.apiKeyCipher!, c2.provider.id), 'clave-C-segunda-0002');
  console.log(`✔ caso (c): ${c1.id} y ${c2.id} nunca se fusionan, cada una descifra a su propia clave`);

  // ── Caso (d): split-group keyless.
  const d1 = await prisma.aiModel.findFirstOrThrow({ where: { providerModel: 'rehearsal-d-keyed-uno' }, include: { provider: true } });
  const d2 = await prisma.aiModel.findFirstOrThrow({ where: { providerModel: 'rehearsal-d-keyed-dos' }, include: { provider: true } });
  const dKeylessRows = await prisma.aiModel.findMany({
    where: { providerModel: { in: ['rehearsal-d-keyless-uno', 'rehearsal-d-keyless-dos'] } },
    include: { provider: true },
  });
  assert.equal(d1.provider.id, d1.id, 'd1 debe ser su propia cuenta');
  assert.equal(d2.provider.id, d2.id, 'd2 debe ser su propia cuenta');
  assert.notEqual(d1.providerId, d2.providerId, 'd1 y d2 no deben fusionarse entre sí');
  assert.equal(descifrar(d1.provider.apiKeyCipher!, d1.provider.id), 'clave-D-primera-0001');
  assert.equal(descifrar(d2.provider.apiKeyCipher!, d2.provider.id), 'clave-D-segunda-0002');
  const providerIdsKeyless = new Set(dKeylessRows.map((fila) => fila.providerId));
  assert.equal(providerIdsKeyless.size, 1, 'las 2 filas sin clave deben compartir UNA cuenta propia');
  const providerIdKeyless = [...providerIdsKeyless][0]!;
  assert.notEqual(providerIdKeyless, d1.providerId, 'las filas sin clave no deben caer en la cuenta de d1');
  assert.notEqual(providerIdKeyless, d2.providerId, 'las filas sin clave no deben caer en la cuenta de d2');
  const providerKeyless = await prisma.aiProvider.findUniqueOrThrow({ where: { id: providerIdKeyless } });
  assert.equal(providerKeyless.apiKeyCipher, null, 'la tercera cuenta (las sin clave) no debe tener cipher');
  console.log(
    `✔ caso (d): d1 (${d1.id}) y d2 (${d2.id}) cada una su propia cuenta; las 2 sin clave caen en una tercera cuenta separada (${providerIdKeyless}), sin clave`,
  );

  console.log('\n✔ rehearsal/verify.ts: los 4 grupos + cero huérfanos verificados contra Postgres real.');
}

main()
  .catch((error) => {
    console.error('\n✖ rehearsal/verify.ts falló:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
