import { prisma } from '../db.ts';
import { Prisma } from '../../generated/prisma/client.ts';
import { creditsForCost, monthlyGrantPeriodKey, WELCOME_PERIOD_KEY } from './creditos.ts';

/**
 * odd/tasks/planes-y-cobros.md (T2): el libro de créditos de un docente
 * individual, del lado de Prisma. `src/lib/billing/creditos.ts` (T1) tiene
 * las reglas PURAS (cuánto vale un crédito, la llave de período); acá viven
 * las lecturas/escrituras reales sobre `CreditLedgerEntry`.
 *
 * SOLO tiene sentido para una cuenta PERSONAL (`User.organizationId === null`,
 * rol DOCENTE) — quien llama decide eso, este módulo no lo vuelve a chequear.
 */

/** Fila mínima de `IndividualPlan` que hace falta acá. */
interface PlanParaCreditos {
  monthlyCredits: number;
  welcomeCredits: number;
}

async function planFree(): Promise<PlanParaCreditos> {
  const plan = await prisma.individualPlan.findUniqueOrThrow({
    where: { key: 'FREE' },
    select: { monthlyCredits: true, welcomeCredits: true },
  });
  return plan;
}

/**
 * La suscripción Individual paga, sólo si está VIGENTE en `now` (cubre la
 * fecha). Una suscripción vencida o cancelada no cuenta — el docente cae de
 * nuevo al otorgamiento FREE ese mes (decisión de diseño: sin fila = FREE).
 */
async function suscripcionIndividualVigente(
  userId: string,
  now: Date,
): Promise<{ monthlyCredits: number } | null> {
  const sub = await prisma.individualSubscription.findUnique({
    where: { userId },
    select: { status: true, currentPeriodStart: true, currentPeriodEnd: true },
  });
  if (!sub) return null;
  if (sub.status !== 'ACTIVE') return null;
  if (now.getTime() < sub.currentPeriodStart.getTime() || now.getTime() > sub.currentPeriodEnd.getTime()) {
    return null;
  }
  const plan = await prisma.individualPlan.findUniqueOrThrow({
    where: { key: 'INDIVIDUAL' },
    select: { monthlyCredits: true },
  });
  return { monthlyCredits: plan.monthlyCredits };
}

/**
 * Otorga (si hace falta) la bienvenida y el otorgamiento mensual del período
 * de `now`. Idempotente y seguro ante llamadas concurrentes:
 *
 * - La bienvenida (`WELCOME`, `periodKey = 'once'`) se intenta insertar una
 *   sola vez; el índice único `[userId, kind, periodKey]` (T1) hace que un
 *   segundo intento choque (`P2002`), que se atrapa y se ignora.
 * - El otorgamiento mensual (`MONTHLY_GRANT`/`PLAN_GRANT`, `periodKey =
 *   "YYYY-MM"`) se otorga dentro de una transacción que también vence lo que
 *   haya quedado sin usar del otorgamiento mensual ANTERIOR (nunca la
 *   bienvenida): la EXPIRY y el GRANT nuevo se insertan juntos; si dos
 *   pedidos concurrentes entran a la vez, sólo uno gana el índice único del
 *   GRANT y la transacción del perdedor se revierte entera (incluida su
 *   EXPIRY) — nunca se vence dos veces el mismo saldo.
 */
export async function ensureGrants(userId: string, now: Date): Promise<void> {
  const free = await planFree();

  // Bienvenida: única para siempre, nunca vence.
  if (free.welcomeCredits > 0) {
    try {
      await prisma.creditLedgerEntry.create({
        data: { userId, delta: free.welcomeCredits, kind: 'WELCOME', periodKey: WELCOME_PERIOD_KEY },
      });
    } catch (error) {
      if (!esViolacionDeUnico(error)) throw error;
    }
  }

  const periodKey = monthlyGrantPeriodKey(now);
  const individual = await suscripcionIndividualVigente(userId, now);
  const kind = individual ? 'PLAN_GRANT' : 'MONTHLY_GRANT';
  const monthlyCredits = individual ? individual.monthlyCredits : free.monthlyCredits;

  // Ya otorgado este período (con cualquiera de los dos tipos) — nada que
  // hacer. Chequeo fuera de la transacción: el caso común (ya otorgado) no
  // paga el costo de abrir una transacción.
  const yaOtorgado = await prisma.creditLedgerEntry.findFirst({
    where: { userId, periodKey, kind: { in: ['MONTHLY_GRANT', 'PLAN_GRANT'] } },
    select: { id: true },
  });
  if (yaOtorgado) return;

  try {
    await prisma.$transaction(async (tx) => {
      // Vencer lo que quedó SIN USAR del otorgamiento mensual anterior
      // (nunca la bienvenida): se busca el último MONTHLY_GRANT/PLAN_GRANT
      // que no sea de ESTE período, y cuánto se gastó (USAGE/ADJUSTMENT
      // negativo) DESDE que se otorgó — eso es lo que queda de cara. Si ya
      // se gastó su monto entero (o más), no queda nada que vencer: la
      // bienvenida y cualquier otro saldo NO se tocan acá.
      const ultimoOtorgamiento = await tx.creditLedgerEntry.findFirst({
        where: { userId, kind: { in: ['MONTHLY_GRANT', 'PLAN_GRANT'] }, periodKey: { not: periodKey } },
        orderBy: { createdAt: 'desc' },
        select: { delta: true, createdAt: true },
      });

      if (ultimoOtorgamiento && ultimoOtorgamiento.delta > 0) {
        const gastadoDespues = await tx.creditLedgerEntry.aggregate({
          where: { userId, createdAt: { gt: ultimoOtorgamiento.createdAt }, delta: { lt: 0 } },
          _sum: { delta: true },
        });
        const gastado = Math.abs(gastadoDespues._sum.delta ?? 0);
        const leftover = Math.max(0, ultimoOtorgamiento.delta - gastado);

        // Tope defensivo: nunca vencer más allá de lo que hay en el saldo
        // total ("nunca negativo más allá de lo que quedaba", decisión de
        // diseño) — en la práctica `leftover` ya no debería superarlo.
        const saldo = await saldoEnTx(tx, userId);
        const aVencer = Math.max(0, Math.min(leftover, saldo));
        if (aVencer > 0) {
          await tx.creditLedgerEntry.create({
            data: { userId, delta: -aVencer, kind: 'EXPIRY', periodKey: null },
          });
        }
      }

      await tx.creditLedgerEntry.create({
        data: { userId, delta: monthlyCredits, kind, periodKey },
      });
    });
  } catch (error) {
    // Otro pedido concurrente ganó la carrera del GRANT de este período: la
    // transacción entera (incluida su EXPIRY) ya se revirtió sola. No-op.
    if (!esViolacionDeUnico(error)) throw error;
  }
}

function esViolacionDeUnico(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function saldoEnTx(tx: TxClient, userId: string): Promise<number> {
  const total = await tx.creditLedgerEntry.aggregate({ where: { userId }, _sum: { delta: true } });
  return total._sum.delta ?? 0;
}

/** Saldo actual (suma de todos los movimientos) — no otorga nada por sí solo. */
export async function balance(userId: string): Promise<number> {
  const total = await prisma.creditLedgerEntry.aggregate({ where: { userId }, _sum: { delta: true } });
  return total._sum.delta ?? 0;
}

/**
 * Débito por el costo real de un turno. Asegura primero los otorgamientos
 * del período (para que un débito nunca corra contra un saldo desactualizado
 * de un mes anterior sin reponer), y recién después descuenta.
 *
 * Puede dejar el saldo en negativo para ESTE turno en curso (decisión del
 * dueño/diseño) — el próximo pedido queda bloqueado por `resolverAccesoIa`
 * al ver `balance <= 0`.
 */
export async function debitUsage(userId: string, tokenUsageId: string, costUsd: number): Promise<void> {
  await ensureGrants(userId, new Date());

  const settings = await prisma.billingSettings.findUniqueOrThrow({ where: { id: 1 } });
  const creditos = creditsForCost(costUsd, settings.creditUsdValue.toNumber());
  if (creditos <= 0) return;

  await prisma.creditLedgerEntry.create({
    data: { userId, delta: -creditos, kind: 'USAGE', tokenUsageId },
  });
}
