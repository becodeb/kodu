import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { cifrar } from '../../../../../src/lib/crypto/secretos.ts';

/**
 * Rehearsal seed — catalogo-de-proveedores.
 *
 * Corre contra el DB ESCRATCH (`koduedu_migration_test`), YA REVERTIDO al
 * schema pre-migración por `migration_down.sql` (ver `README.md` de esta
 * carpeta para la secuencia completa). En ese punto `AiModel` todavía tiene
 * las columnas viejas (`provider`, `baseUrl`, `apiKeyCipher`, `apiKeyHint`),
 * pero el cliente Prisma generado de este repo YA refleja el schema nuevo
 * (post-migración) — por eso este script inserta con SQL crudo en vez de
 * `prisma.aiModel.create()`, igual que hizo el batch anterior.
 *
 * Siembra los grupos (b), (c) y (d) del design.md §2.2 con cifrado REAL
 * (`cifrar()`, la misma función que usa el panel admin) — el grupo (a) sale
 * gratis del propio dato real del dev DB (el grupo `gmi`, que la migración
 * hacia adelante ya trató una vez y el down-migration acaba de revertir).
 *
 * Uso: DATABASE_URL=postgresql://kodu:kodu@localhost:5432/koduedu_migration_test npx tsx openspec/changes/catalogo-de-proveedores/rehearsal/seed.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || !DATABASE_URL.includes('koduedu_migration_test')) {
  throw new Error(
    'Este script sólo corre contra la base ESCRATCH koduedu_migration_test — ' +
      'seteá DATABASE_URL apuntando ahí antes de correrlo. No tocar el dev DB real.',
  );
}

const client = new Client({ connectionString: DATABASE_URL });

async function insertarMotor(opts: {
  id: string;
  provider: string;
  baseUrl: string;
  apiKeyCipher: string | null;
  apiKeyHint: string | null;
  providerModel: string;
}): Promise<void> {
  await client.query(
    `INSERT INTO "AiModel"
       ("id", "provider", "baseUrl", "apiKeyCipher", "apiKeyHint", "providerModel", "displayName",
        "enabled", "selectableByTeacher", "isDefault", "sortOrder",
        "maxOutputTokens", "maxInputChars", "supportsVision", "userTokenLimit",
        "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, false, false,
             (SELECT COALESCE(MAX("sortOrder"), 0) + 1 FROM "AiModel"),
             65536, 400000, false, 0, now(), now())`,
    [opts.id, opts.provider, opts.baseUrl, opts.apiKeyCipher, opts.apiKeyHint, opts.providerModel, `Rehearsal ${opts.providerModel}`],
  );
}

function pista(clave: string): string {
  return clave.slice(-4);
}

async function main(): Promise<void> {
  await client.connect();

  // ── Caso (b): single-cipher — 1 fila con clave + 2 sin clave, mismo (provider, baseUrl).
  const bAnchorId = randomUUID();
  const claveB = 'clave-B-anchor-0001';
  await insertarMotor({
    id: bAnchorId,
    provider: 'rehearsal-b',
    baseUrl: 'http://rehearsal-b.test',
    apiKeyCipher: cifrar(claveB, bAnchorId),
    apiKeyHint: pista(claveB),
    providerModel: 'rehearsal-b-anchor',
  });
  await insertarMotor({
    id: randomUUID(),
    provider: 'rehearsal-b',
    baseUrl: 'http://rehearsal-b.test',
    apiKeyCipher: null,
    apiKeyHint: null,
    providerModel: 'rehearsal-b-sibling-1',
  });
  await insertarMotor({
    id: randomUUID(),
    provider: 'rehearsal-b',
    baseUrl: 'http://rehearsal-b.test',
    apiKeyCipher: null,
    apiKeyHint: null,
    providerModel: 'rehearsal-b-sibling-2',
  });
  console.log(`✔ caso (b) sembrado: ancla ${bAnchorId}, 2 hermanas sin clave`);

  // ── Caso (c): multi-cipher — 2 filas, cada una con su propia clave real distinta.
  const c1Id = randomUUID();
  const c2Id = randomUUID();
  const claveC1 = 'clave-C-primera-0001';
  const claveC2 = 'clave-C-segunda-0002';
  await insertarMotor({
    id: c1Id,
    provider: 'rehearsal-c',
    baseUrl: 'http://rehearsal-c.test',
    apiKeyCipher: cifrar(claveC1, c1Id),
    apiKeyHint: pista(claveC1),
    providerModel: 'rehearsal-c-uno',
  });
  await insertarMotor({
    id: c2Id,
    provider: 'rehearsal-c',
    baseUrl: 'http://rehearsal-c.test',
    apiKeyCipher: cifrar(claveC2, c2Id),
    apiKeyHint: pista(claveC2),
    providerModel: 'rehearsal-c-dos',
  });
  console.log(`✔ caso (c) sembrado: ${c1Id} y ${c2Id}, cada una con su propia clave`);

  // ── Caso (d): split-group keyless — 2 filas CON clave (distinta cada una) +
  //    2 filas SIN clave, todas en el mismo (provider, baseUrl).
  const d1Id = randomUUID();
  const d2Id = randomUUID();
  const claveD1 = 'clave-D-primera-0001';
  const claveD2 = 'clave-D-segunda-0002';
  await insertarMotor({
    id: d1Id,
    provider: 'rehearsal-d',
    baseUrl: 'http://rehearsal-d.test',
    apiKeyCipher: cifrar(claveD1, d1Id),
    apiKeyHint: pista(claveD1),
    providerModel: 'rehearsal-d-keyed-uno',
  });
  await insertarMotor({
    id: d2Id,
    provider: 'rehearsal-d',
    baseUrl: 'http://rehearsal-d.test',
    apiKeyCipher: cifrar(claveD2, d2Id),
    apiKeyHint: pista(claveD2),
    providerModel: 'rehearsal-d-keyed-dos',
  });
  await insertarMotor({
    id: randomUUID(),
    provider: 'rehearsal-d',
    baseUrl: 'http://rehearsal-d.test',
    apiKeyCipher: null,
    apiKeyHint: null,
    providerModel: 'rehearsal-d-keyless-uno',
  });
  await insertarMotor({
    id: randomUUID(),
    provider: 'rehearsal-d',
    baseUrl: 'http://rehearsal-d.test',
    apiKeyCipher: null,
    apiKeyHint: null,
    providerModel: 'rehearsal-d-keyless-dos',
  });
  console.log(`✔ caso (d) sembrado: ${d1Id} y ${d2Id} con clave, 2 hermanas sin clave`);

  console.log('\n✔ rehearsal/seed.ts: los 3 grupos (b, c, d) quedaron sembrados con cifrado real.');
}

main()
  .catch((error) => {
    console.error('\n✖ rehearsal/seed.ts falló:', error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
