import { prisma } from '../db.ts';
import { suscripcionIndividualVigente } from './creditos-servicio.ts';

/**
 * Cuenta gratuita: docente con cuenta PERSONAL (sin institución), sin el plan
 * Individual pago vigente y sin acceso habilitado a mano por un admin.
 *
 * Decisión del dueño (nov 2026, nota en La Nación): la plataforma se anunció
 * como gratis y va a entrar mucha gente a probarla. Para que esas pruebas no
 * se coman el presupuesto, una cuenta gratuita crea y ajusta SIEMPRE con
 * Claude Haiku 5.5 (el motor económico), sin importar el modo de generación
 * global ni el motor que haya elegido en el selector. Las instituciones y el
 * plan Individual no cambian.
 */
export interface UsuarioParaCuentaGratuita {
  id: string;
  role?: 'DOCENTE' | 'ADMIN';
  aiAccessOverride: boolean | null;
  isDemo?: boolean;
  /** `undefined` = no se sabe (se relee de la base). */
  organizationId?: string | null;
}

export async function esCuentaGratuita(user: UsuarioParaCuentaGratuita, now: Date = new Date()): Promise<boolean> {
  if (user.role === 'ADMIN') return false;
  if (user.aiAccessOverride !== null) return false;
  if (user.isDemo) return false;

  let organizationId = user.organizationId;
  if (organizationId === undefined) {
    const fila = await prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } });
    organizationId = fila?.organizationId ?? null;
  }
  if (organizationId) return false;

  return (await suscripcionIndividualVigente(user.id, now)) === null;
}
