import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import { getEnv } from './env.ts';

/**
 * Cliente Prisma unico por proceso.
 *
 * Prisma 7 no habla directo con la base: usa un *driver adapter* (aca `pg`) y el
 * query compiler. La URL ya no vive en schema.prisma, se pasa en runtime.
 *
 * El singleton en `globalThis` evita agotar el pool de conexiones cuando Vite
 * recarga modulos en desarrollo.
 */
function createPrismaClient(): PrismaClient {
  const env = getEnv();
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

const globalForPrisma = globalThis as unknown as { __koduPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__koduPrisma ?? createPrismaClient();

if (getEnv().NODE_ENV !== 'production') {
  globalForPrisma.__koduPrisma = prisma;
}
