import { prisma } from '../db.ts';
import type { ModelChoice } from './provider.ts';

/**
 * Registro de tokens por usuario y proveedor.
 *
 * Sirve para dos cosas distintas: hacer cumplir el tope del proveedor pago
 * (antes de gastar, no después) y poder mirar quién consume cuánto sin tener
 * que entrar a la consola del proveedor.
 */

export interface UsageRecord {
  userId: string;
  provider: ModelChoice;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export async function recordUsage(record: UsageRecord): Promise<void> {
  // Un turno que no gastó nada no se registra: ensucia la tabla y no aporta.
  if (record.promptTokens <= 0 && record.completionTokens <= 0) return;

  await prisma.tokenUsage.create({ data: record });
}

/** Tokens acumulados por un usuario en un proveedor (prompt + respuesta). */
export async function consumedTokens(userId: string, provider: ModelChoice): Promise<number> {
  const total = await prisma.tokenUsage.aggregate({
    where: { userId, provider },
    _sum: { promptTokens: true, completionTokens: true },
  });

  return (total._sum.promptTokens ?? 0) + (total._sum.completionTokens ?? 0);
}

export interface UsageByUser {
  userId: string;
  name: string;
  email: string;
  provider: ModelChoice;
  promptTokens: number;
  completionTokens: number;
  total: number;
  turnos: number;
}

/** Consumo agrupado por usuario y proveedor, para el panel de administración. */
export async function usageByUser(): Promise<UsageByUser[]> {
  const [grupos, usuarios] = await Promise.all([
    prisma.tokenUsage.groupBy({
      by: ['userId', 'provider'],
      _sum: { promptTokens: true, completionTokens: true },
      _count: { _all: true },
    }),
    prisma.user.findMany({ select: { id: true, name: true, email: true } }),
  ]);

  const porId = new Map(usuarios.map((u) => [u.id, u]));

  return grupos
    .map((grupo) => {
      const promptTokens = grupo._sum.promptTokens ?? 0;
      const completionTokens = grupo._sum.completionTokens ?? 0;
      const usuario = porId.get(grupo.userId);

      return {
        userId: grupo.userId,
        name: usuario?.name ?? '(usuario borrado)',
        email: usuario?.email ?? '',
        provider: grupo.provider as ModelChoice,
        promptTokens,
        completionTokens,
        total: promptTokens + completionTokens,
        turnos: grupo._count._all,
      };
    })
    .sort((a, b) => b.total - a.total);
}
