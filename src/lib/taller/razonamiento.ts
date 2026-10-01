import { suscripcionIndividualVigente } from '../billing/creditos-servicio.ts';

/**
 * odd/tasks/ahorro-tokens.md (T2): the Taller de ideas runs with reasoning
 * forced off for personal accounts on the FREE individual plan. Paid
 * individual accounts and every organization member (there is no
 * organization-level FREE plan — only Individual plans have a FREE tier)
 * keep the engine's configured reasoning level, exactly like every other
 * caller of `src/lib/ai/provider.ts#razonamiento`.
 *
 * Split in two on purpose: `esTallerSinRazonamiento` is a PURE function
 * (unit-tested directly, no Prisma), `debeTallerDesactivarRazonamiento`
 * is the thin async wrapper that resolves "is there a vigente paid
 * subscription right now" from the database — the same resolver
 * `ensureGrants` already uses (`suscripcionIndividualVigente`), so the two
 * can never disagree about who is on FREE.
 */

export interface PlanDelUsuario {
  /** `null` = cuenta personal (sin organización). */
  organizationId: string | null;
  /** `true` si hoy tiene una suscripción Individual PAGA vigente. */
  tieneSuscripcionIndividualVigente: boolean;
}

/** La regla pura, sin Prisma: sólo una cuenta personal SIN plan Individual
 *  pago vigente (= FREE, "sin fila = FREE") apaga el razonamiento. */
export function esTallerSinRazonamiento(plan: PlanDelUsuario): boolean {
  if (plan.organizationId !== null) return false;
  return !plan.tieneSuscripcionIndividualVigente;
}

export interface UsuarioParaRazonamientoTaller {
  id: string;
  organizationId: string | null;
}

/** El resolver real, usado por `api/taller/[id]/turno.ts`. */
export async function debeTallerDesactivarRazonamiento(
  user: UsuarioParaRazonamientoTaller,
  now: Date = new Date(),
): Promise<boolean> {
  if (user.organizationId !== null) return false;

  const vigente = await suscripcionIndividualVigente(user.id, now);
  return esTallerSinRazonamiento({
    organizationId: user.organizationId,
    tieneSuscripcionIndividualVigente: vigente !== null,
  });
}
