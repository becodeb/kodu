import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/db.ts';
import { ensureGrants, balance, debitUsage } from '../src/lib/billing/creditos-servicio.ts';
import { monthlyGrantPeriodKey } from '../src/lib/billing/creditos.ts';

/**
 * odd/tasks/planes-y-cobros.md (T2): pruebas de `src/lib/billing/creditos-servicio.ts`
 * (el libro de créditos real, con la base `koduedu_planes`) — complementa a
 * `e2e/unidad-planes.ts` (T1, puro, sin base). Corre contra la base real
 * porque `ensureGrants` necesita el índice único de `CreditLedgerEntry` para
 * probar la idempotencia concurrente de verdad (una carrera simulada con dos
 * `Promise.all` no prueba nada si no hay una base atrás con el `@@unique`).
 *
 * Ejecutar con: npx tsx e2e/unidad-creditos.ts
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

const SUFIJO = randomUUID().slice(0, 8);
const usuariosCreados: string[] = [];

async function crearUsuario(email: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: `Docente créditos ${SUFIJO}`,
      email,
      passwordHash: 'no-hace-falta-para-esta-prueba',
      role: 'DOCENTE',
    },
    select: { id: true },
  });
  usuariosCreados.push(user.id);
  return user.id;
}

async function limpiar(): Promise<void> {
  if (usuariosCreados.length === 0) return;
  await prisma.creditLedgerEntry.deleteMany({ where: { userId: { in: usuariosCreados } } });
  await prisma.individualSubscription.deleteMany({ where: { userId: { in: usuariosCreados } } });
  await prisma.user.deleteMany({ where: { id: { in: usuariosCreados } } });
}

async function main(): Promise<void> {
  const free = await prisma.individualPlan.findUniqueOrThrow({ where: { key: 'FREE' } });
  const individual = await prisma.individualPlan.findUniqueOrThrow({ where: { key: 'INDIVIDUAL' } });
  const settings = await prisma.billingSettings.findUniqueOrThrow({ where: { id: 1 } });

  try {
    await prueba('ensureGrants: primera vez otorga bienvenida + otorgamiento del mes, saldo = welcome+monthly', async () => {
      const userId = await crearUsuario(`creditos-a-${SUFIJO}@e2e.test`);
      const ahora = new Date();
      await ensureGrants(userId, ahora);
      const saldo = await balance(userId);
      assert.equal(saldo, free.welcomeCredits + free.monthlyCredits);

      const filas = await prisma.creditLedgerEntry.findMany({ where: { userId } });
      assert.equal(filas.length, 2, 'una fila WELCOME + una MONTHLY_GRANT, nada más');
      assert.ok(filas.some((f) => f.kind === 'WELCOME' && f.delta === free.welcomeCredits));
      assert.ok(
        filas.some(
          (f) => f.kind === 'MONTHLY_GRANT' && f.delta === free.monthlyCredits && f.periodKey === monthlyGrantPeriodKey(ahora),
        ),
      );
    });

    await prueba('ensureGrants: idempotente — llamarlo de nuevo en el mismo período no duplica nada', async () => {
      const userId = await crearUsuario(`creditos-b-${SUFIJO}@e2e.test`);
      const ahora = new Date();
      await ensureGrants(userId, ahora);
      await ensureGrants(userId, ahora);
      await ensureGrants(userId, ahora);
      const filas = await prisma.creditLedgerEntry.findMany({ where: { userId } });
      assert.equal(filas.length, 2, 'tres llamadas seguidas siguen dejando sólo WELCOME + MONTHLY_GRANT');
    });

    await prueba('ensureGrants: concurrente en el mismo período no duplica ni el welcome ni el otorgamiento', async () => {
      const userId = await crearUsuario(`creditos-c-${SUFIJO}@e2e.test`);
      const ahora = new Date();
      await Promise.all([
        ensureGrants(userId, ahora),
        ensureGrants(userId, ahora),
        ensureGrants(userId, ahora),
        ensureGrants(userId, ahora),
        ensureGrants(userId, ahora),
      ]);
      const filas = await prisma.creditLedgerEntry.findMany({ where: { userId } });
      assert.equal(filas.length, 2, '5 llamadas concurrentes siguen dejando sólo 2 filas (la carrera la gana una sola)');
      const saldo = await balance(userId);
      assert.equal(saldo, free.welcomeCredits + free.monthlyCredits);
    });

    await prueba('bienvenida nunca vence: se conserva íntegra tras el rollover de mes', async () => {
      const userId = await crearUsuario(`creditos-d-${SUFIJO}@e2e.test`);
      const mesPasado = new Date('2026-01-15T12:00:00Z');
      await ensureGrants(userId, mesPasado);
      const saldoAntes = await balance(userId);
      assert.equal(saldoAntes, free.welcomeCredits + free.monthlyCredits);

      const mesSiguiente = new Date('2026-02-15T12:00:00Z');
      await ensureGrants(userId, mesSiguiente);

      const filas = await prisma.creditLedgerEntry.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
      const welcome = filas.find((f) => f.kind === 'WELCOME');
      assert.ok(welcome, 'la fila WELCOME sigue estando');
      assert.equal(welcome!.delta, free.welcomeCredits, 'la bienvenida nunca cambia de valor');

      const expiry = filas.find((f) => f.kind === 'EXPIRY');
      assert.ok(expiry, 'tiene que haber vencido el otorgamiento del mes anterior');
      assert.equal(expiry!.delta, -free.monthlyCredits, 'vence EXACTAMENTE el monto del otorgamiento anterior, sin usar');

      const saldoDespues = await balance(userId);
      // bienvenida + otorgamiento nuevo del mes (el viejo se venció completo).
      assert.equal(saldoDespues, free.welcomeCredits + free.monthlyCredits);
    });

    await prueba('rollover de mes: el vencimiento nunca va más allá de lo que quedaba (uso parcial)', async () => {
      const userId = await crearUsuario(`creditos-e-${SUFIJO}@e2e.test`);
      const mesPasado = new Date('2026-01-15T12:00:00Z');
      await ensureGrants(userId, mesPasado);

      // Gasta más que el otorgamiento mensual (deja sólo un resto de la bienvenida).
      const gastoTotal = free.monthlyCredits + 20;
      await prisma.creditLedgerEntry.create({
        data: { userId, delta: -gastoTotal, kind: 'USAGE' },
      });
      const saldoTrasGasto = await balance(userId);
      assert.equal(saldoTrasGasto, free.welcomeCredits - 20);

      const mesSiguiente = new Date('2026-02-15T12:00:00Z');
      await ensureGrants(userId, mesSiguiente);

      // El otorgamiento de enero (50) ya se gastó ENTERO (se gastaron 70) —
      // no queda nada suyo sin usar, así que no hay nada que vencer. La
      // bienvenida (y el resto del saldo) no se tocan.
      const expiry = await prisma.creditLedgerEntry.findFirst({ where: { userId, kind: 'EXPIRY' } });
      assert.equal(expiry, null, 'un otorgamiento ya gastado del todo no genera EXPIRY');

      const saldoFinal = await balance(userId);
      assert.equal(saldoFinal, saldoTrasGasto + free.monthlyCredits, 'el otorgamiento nuevo se suma, nada se vence');
    });

    await prueba('ensureGrants: con IndividualSubscription ACTIVE vigente otorga PLAN_GRANT, no MONTHLY_GRANT', async () => {
      const userId = await crearUsuario(`creditos-f-${SUFIJO}@e2e.test`);
      const ahora = new Date();
      const inicio = new Date(ahora.getTime() - 5 * 24 * 60 * 60 * 1000);
      const fin = new Date(ahora.getTime() + 25 * 24 * 60 * 60 * 1000);
      await prisma.individualSubscription.create({
        data: { userId, status: 'ACTIVE', interval: 'MONTHLY', currentPeriodStart: inicio, currentPeriodEnd: fin },
      });

      await ensureGrants(userId, ahora);
      const filas = await prisma.creditLedgerEntry.findMany({ where: { userId } });
      const grant = filas.find((f) => f.kind === 'PLAN_GRANT');
      assert.ok(grant, 'tiene que otorgar PLAN_GRANT, no MONTHLY_GRANT');
      assert.equal(grant!.delta, individual.monthlyCredits);
      assert.ok(!filas.some((f) => f.kind === 'MONTHLY_GRANT'), 'no debe otorgar también el de FREE');
    });

    await prueba('debitUsage: redondea hacia arriba con creditUsdValue real y descuenta del saldo', async () => {
      const userId = await crearUsuario(`creditos-g-${SUFIJO}@e2e.test`);
      const ahora = new Date();
      await ensureGrants(userId, ahora);
      const saldoInicial = await balance(userId);

      const tokenUsage = await prisma.tokenUsage.create({
        data: {
          userId,
          projectId: null,
          model: 'modelo-e2e',
          promptTokens: 100,
          cachedInputTokens: 0,
          completionTokens: 50,
          purpose: 'GENERATION',
        },
      });

      // Costo elegido para no caer justo en un múltiplo de creditUsdValue —
      // fuerza el redondeo hacia arriba (creditsForCost ya lo prueba puro en
      // unidad-planes.ts; acá se prueba que debitUsage lo aplica de verdad).
      const creditUsdValue = settings.creditUsdValue.toNumber();
      const costUsd = creditUsdValue * 3.2;
      const creditosEsperados = Math.ceil(costUsd / creditUsdValue); // 4

      await debitUsage(userId, tokenUsage.id, costUsd);

      const saldoFinal = await balance(userId);
      assert.equal(saldoFinal, saldoInicial - creditosEsperados);

      const debito = await prisma.creditLedgerEntry.findFirst({ where: { userId, kind: 'USAGE' } });
      assert.ok(debito);
      assert.equal(debito!.delta, -creditosEsperados);
      assert.equal(debito!.tokenUsageId, tokenUsage.id);

      await prisma.tokenUsage.delete({ where: { id: tokenUsage.id } });
    });

    await prueba('debitUsage: puede dejar el saldo en negativo (se acepta para el turno en curso)', async () => {
      const userId = await crearUsuario(`creditos-h-${SUFIJO}@e2e.test`);
      const ahora = new Date();
      await ensureGrants(userId, ahora);
      const saldoInicial = await balance(userId);

      const tokenUsage = await prisma.tokenUsage.create({
        data: {
          userId,
          projectId: null,
          model: 'modelo-e2e',
          promptTokens: 1,
          cachedInputTokens: 0,
          completionTokens: 1,
          purpose: 'GENERATION',
        },
      });

      const creditUsdValue = settings.creditUsdValue.toNumber();
      // Un costo bien por encima del saldo disponible.
      const costUsdEnorme = creditUsdValue * (saldoInicial + 500);
      await debitUsage(userId, tokenUsage.id, costUsdEnorme);

      const saldoFinal = await balance(userId);
      assert.ok(saldoFinal < 0, `el saldo debe quedar negativo (dio ${saldoFinal})`);

      await prisma.tokenUsage.delete({ where: { id: tokenUsage.id } });
    });

    console.log('\n✔ e2e/unidad-creditos.ts: todas las pruebas pasaron');
  } finally {
    await limpiar();
    await prisma.$disconnect();
  }

  if (fallas > 0) {
    console.error(`\n✖ ${fallas} prueba(s) fallaron`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('\n✖ e2e/unidad-creditos.ts falló:', error);
  process.exitCode = 1;
});
