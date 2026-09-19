import { prisma } from './db.ts';
import { leerAppSettings } from './settings.ts';
import type { User } from '../generated/prisma/client.ts';

/**
 * La cuenta compartida de demo (design.md §8; specs/demo-mode/spec.md).
 *
 * Una sola fila para siempre (índice único parcial `User_un_solo_demo`,
 * migración 20260922000000), creada de forma perezosa la primera vez que
 * el interruptor pasa a `true` — nunca en la migración, para que su
 * `createdAt` signifique algo real (cuándo arrancó la demo, no cuándo se
 * desplegó el código).
 */

export const DEMO_EMAIL = 'demo@kodu.local';
export const DEMO_NAME = 'Cuenta de demostración';

/**
 * Crea la cuenta si todavía no existe y la devuelve; si ya existe, la
 * devuelve tal cual (idempotente — se puede llamar en cada `PATCH` que
 * prenda el interruptor sin duplicar nada, el índice único la protege de
 * todos modos).
 *
 * `aiAccessOverride: true` desde el alta, a propósito: el email de la demo
 * (`demo@kodu.local`) no va a estar en la lista de ningún admin, así que sin
 * este grant explícito la regla de dominio de M6 (`puedeUsarLaIa` en
 * `auth/domains.ts`) la dejaría afuera apenas hubiera una sola fila en
 * `AuthorizedDomain`. Esto COMPONE con esa regla en vez de esquivarla: la
 * demo entra por el mismo mecanismo de grant individual que cualquier
 * docente al que un admin le habilita el acceso a mano — no hay un atajo
 * paralelo. El apagado real de la demo no toca este campo: pasa por
 * `AppSettings.demoEnabled`, chequeado aparte en `chat/stream.ts`.
 */
export async function asegurarCuentaDemo(): Promise<User> {
  const existente = await prisma.user.findFirst({ where: { isDemo: true } });
  if (existente) return existente;

  return prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: DEMO_NAME,
      role: 'DOCENTE',
      isDemo: true,
      aiAccessOverride: true,
      passwordHash: null,
      googleId: null,
    },
  });
}

export async function buscarCuentaDemo(): Promise<{ id: string } | null> {
  return prisma.user.findFirst({ where: { isDemo: true }, select: { id: true } });
}

/**
 * Tokens consumidos por la cuenta de demo en el ciclo ACTUAL
 * (`AppSettings.demoCycleStartedAt` en adelante), sumados en TODOS los
 * motores — a diferencia de `consumedTokens` en `usage.ts` (por motor), este
 * tope es global a la cuenta compartida (design.md §8; specs/demo-mode/spec.md
 * — "Token ceiling is the only cap"). Un reinicio de ronda mueve
 * `demoCycleStartedAt` a "ahora" sin borrar ninguna fila de `TokenUsage`, así
 * que el historial de costo sobrevive; sólo lo que cuenta para el tope
 * cambia.
 */
export async function consumoDeLaDemo(): Promise<number> {
  const cuenta = await buscarCuentaDemo();
  if (!cuenta) return 0;

  const settings = await leerAppSettings();
  const total = await prisma.tokenUsage.aggregate({
    where: { userId: cuenta.id, createdAt: { gte: settings.demoCycleStartedAt } },
    _sum: { promptTokens: true, completionTokens: true },
  });

  return (total._sum.promptTokens ?? 0) + (total._sum.completionTokens ?? 0);
}
