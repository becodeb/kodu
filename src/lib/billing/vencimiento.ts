import { prisma } from '../db.ts';

/**
 * odd/tasks/planes-y-cobros.md (T4b): el ciclo lectivo institucional y el
 * plan Individual anual se cobran como pago ÚNICO (`aplicar.ts`, ver la nota
 * sobre `frequency: 12` de Mercado Pago) — a diferencia de MONTHLY, nadie
 * les avisa automáticamente "este período terminó sin que paguen" (no hay
 * webhook recurrente). Este módulo es ese aviso, aplicado perezosamente
 * (mismo patrón que `ensureGrants` en `creditos-servicio.ts`: se llama desde
 * cada lectura relevante, nunca desde un cron) la primera vez que alguien
 * mira el estado de la licencia/suscripción después de que `currentPeriodEnd`
 * ya pasó sin una renovación aprobada.
 *
 * Reglas del dueño (T4b): CYCLE → se comporta como vencida (sólo lectura)
 * con 7 días de gracia (el mismo `BillingSettings.graceDays` que ya usa
 * PAST_DUE); ANNUAL → vuelve a FREE (ninguna fila de `IndividualSubscription`
 * en estado ACTIVE = FREE, ver `creditos-servicio.ts#suscripcionIndividualVigente`).
 *
 * MONTHLY se deja afuera a propósito: ese intervalo SÍ tiene un webhook
 * recurrente de Mercado Pago (`aplicar.ts#aplicarRenovacion`) que ya decide
 * PAST_DUE ante un pago fallido — reconciliar acá también lo pisaría con un
 * criterio distinto (basado en fecha, no en el pago real) sin necesidad.
 */

export async function reconciliarLicenciaOrgVencida(organizationId: string, now: Date): Promise<void> {
  const license = await prisma.organizationLicense.findUnique({ where: { organizationId } });
  if (!license) return;
  if (license.interval !== 'CYCLE') return;
  if (license.status !== 'ACTIVE' && license.status !== 'PAST_DUE') return;
  if (!license.currentPeriodEnd) return;
  if (now.getTime() <= license.currentPeriodEnd.getTime()) return;
  // Cancelación pedida: `acceso-licencia.ts` ya la trata como CANCELED en
  // lectura; no hace falta (ni corresponde) moverla a PAST_DUE/READ_ONLY acá.
  if (license.cancelAtPeriodEnd) return;

  const cfg = await prisma.billingSettings.findUniqueOrThrow({ where: { id: 1 } });
  const graceEndsAt = new Date(license.currentPeriodEnd.getTime() + cfg.graceDays * 24 * 60 * 60 * 1000);

  if (now.getTime() <= graceEndsAt.getTime()) {
    if (license.status === 'PAST_DUE') return;
    await prisma.organizationLicense.update({ where: { id: license.id }, data: { status: 'PAST_DUE', graceEndsAt } });
    return;
  }

  // En este punto `status` sólo puede ser ACTIVE o PAST_DUE (early-return más
  // arriba) — cualquiera de los dos, pasado el fin de la gracia, pasa a
  // READ_ONLY.
  await prisma.organizationLicense.update({ where: { id: license.id }, data: { status: 'READ_ONLY' } });
}

/** Vuelve una suscripción Individual ANUAL vencida a FREE (borra el estado
 *  ACTIVE; "sin fila ACTIVE" ya es FREE en todo el resto del código). */
export async function reconciliarSuscripcionIndividualVencida(userId: string, now: Date): Promise<void> {
  const sub = await prisma.individualSubscription.findUnique({ where: { userId } });
  if (!sub || sub.status !== 'ACTIVE') return;
  if (sub.interval !== 'ANNUAL') return;
  if (now.getTime() <= sub.currentPeriodEnd.getTime()) return;
  if (sub.cancelAtPeriodEnd) return; // ya la trata como vencida el resto del código.

  await prisma.individualSubscription.update({ where: { id: sub.id }, data: { status: 'CANCELED' } });
}
