import { prisma } from '../db.ts';
import { suscripcionIndividualVigente } from './creditos-servicio.ts';
import { asegurarMotorDePresetSiFalta, motorParaPresetYEsfuerzo } from '../ai/catalogo.ts';
import { HAIKU_LOW, type RoleSpec } from '../ai/modos-generacion.ts';
import type { ProviderConfig } from '../ai/provider.ts';

/**
 * Cuenta gratuita: docente con cuenta PERSONAL (sin institución), sin el plan
 * Individual pago vigente y sin acceso habilitado a mano por un admin.
 *
 * Decisión del dueño (nov 2026, nota en La Nación): la plataforma se anunció
 * como gratis y va a entrar mucha gente a probarla. Para que la primera
 * impresión sea buena sin que las pruebas se coman el presupuesto:
 *
 *  - Los PRIMEROS `RECURSOS_CON_SONNET` recursos de cada cuenta se crean con
 *    Sonnet 5.5, y se siguen ajustando con Sonnet (el motor con el que
 *    nacieron: Haiku ajusta mal código que escribió otro modelo).
 *  - Del siguiente en adelante, todo con Haiku 5.5.
 *  - El "modo rápido" del docente fuerza Haiku siempre (lo decide quien
 *    llama, antes de llegar acá).
 *
 * Los créditos de la cuenta siguen siendo el tope duro: un recurso con Sonnet
 * cuesta bastante más créditos, así que nadie gasta más de su saldo.
 */
export const RECURSOS_CON_SONNET = 2;

const SONNET_MEDIUM: RoleSpec = { presetKey: 'claude-sonnet-5-5', effort: 'medium' };

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

/** El motor del modo rápido: Haiku, para cualquier docente. */
export function motorModoRapido(): Promise<ProviderConfig | null> {
  return motorParaPresetYEsfuerzo(HAIKU_LOW);
}

/**
 * El motor de una cuenta gratuita para este turno (sin modo rápido).
 * `null` sólo si no hay ni Sonnet ni Haiku habilitados: quien llama sigue con
 * el camino de siempre.
 */
export async function motorParaCuentaGratuita(params: {
  userId: string;
  project: { id: string; creationModelId: string | null };
  esCreacion: boolean;
}): Promise<ProviderConfig | null> {
  const usarSonnet = params.esCreacion && !params.project.creationModelId
    ? (await prisma.project.count({
        where: { userId: params.userId, creationModelId: { not: null }, id: { not: params.project.id } },
      })) < RECURSOS_CON_SONNET
    : await nacioConSonnet(params.project.creationModelId);

  if (usarSonnet) {
    await asegurarMotorDePresetSiFalta(SONNET_MEDIUM.presetKey);
    const sonnet = await motorParaPresetYEsfuerzo(SONNET_MEDIUM);
    if (sonnet) return sonnet;
  }
  return motorParaPresetYEsfuerzo(HAIKU_LOW);
}

async function nacioConSonnet(creationModelId: string | null): Promise<boolean> {
  if (!creationModelId) return false;
  const fila = await prisma.aiModel.findUnique({ where: { id: creationModelId }, select: { presetKey: true } });
  return fila?.presetKey === SONNET_MEDIUM.presetKey;
}
