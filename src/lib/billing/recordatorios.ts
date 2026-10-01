import { prisma } from '../db.ts';
import { Prisma } from '../../generated/prisma/client.ts';
import { hasResendApiKey } from '../env.ts';
import { enviarEmail } from '../email/resend.ts';

/**
 * odd/tasks/planes-y-cobros.md (T4b): el mail de "tu ciclo/plan termina
 * pronto", a 30 y 7 días del fin del período, para CYCLE institucional y
 * ANNUAL individual (los dos intervalos de pago único — ver la nota en
 * `aplicar.ts` sobre por qué no hay cobro recurrente real para ellos).
 *
 * Disparo PEREZOSO (mismo criterio que `ensureGrants`/`vencimiento.ts`): se
 * llama desde cualquier lectura de página relevante o desde un endpoint
 * interno que un cron puede pegarle (`/api/internal/recordatorios-renovacion`,
 * protegido por secreto — ver ese archivo). No hace falta que se llame
 * exactamente el día 30 o el día 7: mientras falten <= N días, intenta
 * registrar el aviso de N días; el índice único de `RenewalReminder`
 * (`[subject, subjectId, periodEnd, daysBefore]`) es lo que lo hace
 * idempotente — si ya se mandó para ESTE `periodEnd`, el segundo intento
 * choca y no se manda de nuevo. Una renovación mueve `currentPeriodEnd`, así
 * que el aviso del período SIGUIENTE puede mandarse de nuevo sin problema.
 */

const DIAS_AVISO = [30, 7] as const;
const UN_DIA_MS = 24 * 60 * 60 * 1000;

function esViolacionDeUnico(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function intentarRegistrar(
  subject: 'ORG_LICENSE' | 'INDIVIDUAL_SUB',
  subjectId: string,
  periodEnd: Date,
  daysBefore: number,
): Promise<boolean> {
  try {
    await prisma.renewalReminder.create({ data: { subject, subjectId, periodEnd, daysBefore } });
    return true;
  } catch (error) {
    if (esViolacionDeUnico(error)) return false;
    throw error;
  }
}

export interface ResultadoRecordatorios {
  enviados: number;
}

export async function enviarRecordatoriosDeRenovacion(now: Date = new Date()): Promise<ResultadoRecordatorios> {
  let enviados = 0;
  const horizonte = new Date(now.getTime() + DIAS_AVISO[0] * UN_DIA_MS);

  const licencias = await prisma.organizationLicense.findMany({
    where: {
      interval: 'CYCLE',
      status: { in: ['ACTIVE', 'PAST_DUE'] },
      cancelAtPeriodEnd: false,
      currentPeriodEnd: { gte: now, lte: horizonte },
    },
    select: { id: true, organizationId: true, currentPeriodEnd: true, organization: { select: { name: true } } },
  });

  for (const licencia of licencias) {
    const diasRestantes = Math.ceil((licencia.currentPeriodEnd!.getTime() - now.getTime()) / UN_DIA_MS);
    for (const dias of DIAS_AVISO) {
      if (diasRestantes > dias) continue;
      const registrado = await intentarRegistrar('ORG_LICENSE', licencia.id, licencia.currentPeriodEnd!, dias);
      if (!registrado || !hasResendApiKey()) continue;

      const admins = await prisma.organizationAdmin.findMany({
        where: { organizationId: licencia.organizationId },
        select: { user: { select: { email: true } } },
      });
      const siguienteAno = licencia.currentPeriodEnd!.getUTCFullYear() + 1;
      const fecha = licencia.currentPeriodEnd!.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' });
      for (const { user } of admins) {
        await enviarEmail({
          to: user.email,
          subject: `${licencia.organization.name}: tu ciclo lectivo termina el ${fecha}`,
          text: `Tu ciclo lectivo termina el ${fecha}. Pagá el ciclo ${siguienteAno} para seguir sin cortes, desde /org/plan.`,
          html: `<p>Tu ciclo lectivo termina el ${fecha}. Pagá el ciclo ${siguienteAno} para seguir sin cortes, desde <a href="/org/plan">/org/plan</a>.</p>`,
        });
        enviados++;
      }
    }
  }

  const suscripciones = await prisma.individualSubscription.findMany({
    where: {
      interval: 'ANNUAL',
      status: 'ACTIVE',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: { gte: now, lte: horizonte },
    },
    select: { id: true, userId: true, currentPeriodEnd: true, user: { select: { email: true } } },
  });

  for (const sub of suscripciones) {
    const diasRestantes = Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / UN_DIA_MS);
    for (const dias of DIAS_AVISO) {
      if (diasRestantes > dias) continue;
      const registrado = await intentarRegistrar('INDIVIDUAL_SUB', sub.id, sub.currentPeriodEnd, dias);
      if (!registrado || !hasResendApiKey()) continue;

      const fecha = sub.currentPeriodEnd.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' });
      await enviarEmail({
        to: sub.user.email,
        subject: `Tu plan Individual de Kodu termina el ${fecha}`,
        text: `Tu plan Individual anual termina el ${fecha}. Pagá la renovación para seguir sin cortes, desde /app/plan.`,
        html: `<p>Tu plan Individual anual termina el ${fecha}. Pagá la renovación para seguir sin cortes, desde <a href="/app/plan">/app/plan</a>.</p>`,
      });
      enviados++;
    }
  }

  return { enviados };
}
