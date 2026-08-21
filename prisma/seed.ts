import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';

/**
 * Seed idempotente: crea la cuenta ADMIN inicial y las reglas globales base
 * que el SPEC (§4.2) inyecta en cada llamada a la IA.
 *
 * Ejecutar con: npm run db:seed
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const GLOBAL_RULES = [
  {
    title: 'Formato autoportante',
    content:
      'Devolvé SIEMPRE un documento HTML5 completo y autoportante en un solo archivo: <!DOCTYPE html>, <head> con <meta charset="UTF-8"> y viewport, y todo el CSS y JS embebido. Nunca uses imports de módulos locales, bundlers ni pasos de build.',
  },
  {
    title: 'Librerías permitidas por CDN',
    content:
      'Usá únicamente estas librerías, siempre por CDN: Tailwind CSS (cdn.tailwindcss.com), KaTeX para fórmulas matemáticas, Chart.js para gráficos, canvas-confetti para refuerzos positivos y Lucide Icons para iconografía. No incorpores otras dependencias externas.',
  },
  {
    title: 'Estándar pedagógico',
    content:
      'Las consignas deben ser claras y adecuadas al nivel indicado por el docente. Incluí retroalimentación inmediata en cada actividad (correcto/incorrecto con explicación breve) y evitá penalizaciones que desalienten al estudiante.',
  },
  {
    title: 'Accesibilidad y proyección',
    content:
      'Diseñá pensando en pizarras digitales y proyectores: tipografía grande y legible, contraste alto (mínimo WCAG AA), áreas táctiles amplias y layout responsive. Todo control interactivo debe ser operable por teclado y tener etiquetas accesibles.',
  },
  {
    title: 'Seguridad del script',
    content:
      'El recurso se renderiza dentro de un iframe aislado: no accedas a window.parent, document.cookie, localStorage de terceros ni hagas fetch a dominios externos que no sean los CDN permitidos.',
  },
];

async function main(): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
  const name = process.env.SEED_ADMIN_NAME ?? 'Administración KoduEdu';

  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN' },
    create: { email, name, role: 'ADMIN', passwordHash: await bcrypt.hash(password, 12) },
    select: { id: true, email: true },
  });
  console.log(`✔ Admin listo: ${admin.email}`);

  for (const rule of GLOBAL_RULES) {
    const existing = await prisma.customRule.findFirst({
      where: { title: rule.title, isGlobal: true },
      select: { id: true },
    });

    if (existing) {
      await prisma.customRule.update({ where: { id: existing.id }, data: { content: rule.content } });
    } else {
      await prisma.customRule.create({
        data: { ...rule, isGlobal: true, isActive: true, userId: null },
      });
    }
  }
  console.log(`✔ ${GLOBAL_RULES.length} reglas globales sincronizadas`);
}

main()
  .catch((error) => {
    console.error('✖ Seed falló:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
