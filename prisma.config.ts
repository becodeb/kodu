import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 ya no lee .env automaticamente: lo cargamos nosotros arriba.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
