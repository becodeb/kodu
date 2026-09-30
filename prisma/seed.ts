import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { getAllowedDomains } from '../src/lib/env.ts';

/**
 * Seed idempotente: crea la cuenta ADMIN inicial, las reglas globales base
 * que el SPEC (§4.2) inyecta en cada llamada a la IA, y siembra la
 * organización Reditinere con sus dominios (odd/tasks/organizaciones.md, T1/T2
 * — reemplaza a `AuthorizedDomain`/`ALLOWED_EMAIL_DOMAINS`, design.md §10
 * vieja). El id de Reditinere es el MISMO uuid fijo y literal que usó la
 * migración 20261010000000_organizaciones — así un despliegue existente (que
 * ya trae Reditinere de esa migración) no crea una segunda organización acá.
 *
 * Ejecutar con: npm run db:seed
 */

/** Mismo uuid fijo que prisma/migrations/20261010000000_organizaciones/migration.sql. */
const REDITINERE_ID = '7e00bcaa-9eab-4849-852e-8fc2806d1cbb';

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
      'Usá únicamente estas librerías, siempre por CDN desde jsdelivr o unpkg: KaTeX para fórmulas matemáticas, Chart.js para gráficos y canvas-confetti sólo al terminar una actividad. Tailwind CSS, las tipografías y los íconos Lucide ya vienen con el kit de KoduEdu (<meta name="kodu-tema">): no los cargues aparte. No incorpores otras dependencias externas.',
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

  const reditinere = await prisma.organization.upsert({
    where: { id: REDITINERE_ID },
    update: {},
    create: { id: REDITINERE_ID, name: 'Reditinere', kind: 'CAMPUS' },
    select: { id: true },
  });

  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN' },
    create: {
      email,
      name,
      role: 'ADMIN',
      passwordHash: await bcrypt.hash(password, 12),
      organizationId: reditinere.id,
      // El admin semilla entra por contraseña, sin Resend en un ambiente
      // recién creado: se toma como verificado, mismo criterio que
      // `register.ts` (odd/tasks/organizaciones.md, T2).
      emailVerifiedAt: new Date(),
      emailVerificationSource: 'NO_PROVIDER',
    },
    select: { id: true, email: true },
  });
  console.log(`✔ Admin listo: ${admin.email}`);

  const dominiosExistentes = await prisma.organizationDomain.count({ where: { organizationId: reditinere.id } });
  if (dominiosExistentes === 0) {
    const patrones = getAllowedDomains();
    if (patrones.length > 0) {
      await prisma.organizationDomain.createMany({
        data: patrones.map((pattern) => ({ pattern, organizationId: reditinere.id })),
        skipDuplicates: true,
      });
      console.log(`✔ ${patrones.length} dominio(s) de Reditinere sembrado(s) desde ALLOWED_EMAIL_DOMAINS`);
    } else {
      console.log('… ALLOWED_EMAIL_DOMAINS está vacía: no se sembró ningún dominio de Reditinere (lista abierta)');
    }
  } else {
    console.log(`… Reditinere ya tiene ${dominiosExistentes} dominio(s): no se resiembra`);
  }

  await seedCatalogoDePrecios();

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

/**
 * odd/tasks/planes-y-cobros.md (T1): catálogo de precios editable desde el
 * superadmin. Los montos de acá son PLACEHOLDER — el dueño los edita desde
 * `/admin` (T7) apenas defina precios reales; sólo importa que el catálogo
 * exista con una fila por banda/plan. `upsert` por `key` (única): correr el
 * seed de nuevo nunca pisa un precio que el superadmin ya haya cambiado a
 * mano — el `update: {}` no toca ninguna columna en una fila existente.
 */
async function seedCatalogoDePrecios(): Promise<void> {
  const bandas: Array<{
    key: 'PEQUENA' | 'MEDIANA' | 'GRANDE';
    name: string;
    minStudents: number;
    maxStudents: number;
    monthlyPriceArs: number;
    sortOrder: number;
  }> = [
    { key: 'PEQUENA', name: 'Pequeña', minStudents: 1, maxStudents: 300, monthlyPriceArs: 90_000, sortOrder: 0 },
    { key: 'MEDIANA', name: 'Mediana', minStudents: 301, maxStudents: 800, monthlyPriceArs: 180_000, sortOrder: 1 },
    { key: 'GRANDE', name: 'Grande', minStudents: 801, maxStudents: 1500, monthlyPriceArs: 350_000, sortOrder: 2 },
  ];

  for (const banda of bandas) {
    await prisma.institutionalBand.upsert({
      where: { key: banda.key },
      update: {},
      create: {
        key: banda.key,
        name: banda.name,
        minStudents: banda.minStudents,
        maxStudents: banda.maxStudents,
        // PLACEHOLDER (decisión del dueño: "los valores iniciales son de
        // ejemplo"). Default sugerido = 10 × mensual (el ciclo cuesta 10
        // cuotas, design.md), pero es una columna editable, no una cuenta
        // derivada — ver el comentario del modelo en schema.prisma.
        monthlyPriceArs: banda.monthlyPriceArs,
        cyclePriceArs: banda.monthlyPriceArs * 10,
        sortOrder: banda.sortOrder,
      },
    });
  }
  console.log(`✔ ${bandas.length} banda(s) institucional(es) sembrada(s) (precios PLACEHOLDER, editables en /admin)`);

  const planes: Array<{
    key: 'FREE' | 'INDIVIDUAL';
    name: string;
    monthlyPriceArs: number;
    annualPriceArs: number | null;
    monthlyCredits: number;
    welcomeCredits: number;
    sortOrder: number;
  }> = [
    { key: 'FREE', name: 'Gratis', monthlyPriceArs: 0, annualPriceArs: null, monthlyCredits: 50, welcomeCredits: 100, sortOrder: 0 },
    { key: 'INDIVIDUAL', name: 'Individual', monthlyPriceArs: 9_000, annualPriceArs: 90_000, monthlyCredits: 1_000, welcomeCredits: 0, sortOrder: 1 },
  ];

  for (const plan of planes) {
    await prisma.individualPlan.upsert({
      where: { key: plan.key },
      update: {},
      create: {
        key: plan.key,
        name: plan.name,
        monthlyPriceArs: plan.monthlyPriceArs,
        annualPriceArs: plan.annualPriceArs,
        monthlyCredits: plan.monthlyCredits,
        welcomeCredits: plan.welcomeCredits,
        sortOrder: plan.sortOrder,
      },
    });
  }
  console.log(`✔ ${planes.length} plan(es) individual(es) sembrado(s) (precios PLACEHOLDER, editables en /admin)`);

  // La migración 20261012000000_planes_y_cobros ya inserta esta fila (mismo
  // criterio que AppSettings): acá sólo se asegura que exista, sin pisar
  // nada que el superadmin ya haya cambiado.
  await prisma.billingSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      creditUsdValue: 0.0025,
      trialDays: 30,
      graceDays: 7,
      monotributoAnnualCapArs: null,
      hablemosThresholdStudents: 1500,
    },
  });
  console.log('✔ configuración de cobro (BillingSettings) verificada');
}

main()
  .catch((error) => {
    console.error('✖ Seed falló:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
