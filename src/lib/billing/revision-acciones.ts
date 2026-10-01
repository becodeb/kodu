import { prisma } from '../db.ts';
import { invalidarCacheOrganizaciones } from '../orgs/resolucion.ts';
import { bandForStudents } from './bandas.ts';
import type { ResultadoAccion } from './aplicar.ts';

/**
 * odd/tasks/planes-y-cobros.md (T7): las acciones de `/admin/altas` — todo
 * lo que T5 dejó para "la pantalla para confirmar dominios y matrícula, o
 * marcar un lead como contactado, es T7" (comentario de `revision.ts`).
 */

export interface DetalleParaRevision {
  organizationId: string;
  nombre: string;
  kind: 'CAMPUS' | 'NETWORK';
  declaredStudents: number;
  bandKey: string | null;
  /** T11: `PENDING_PAYMENT` cuando el alta pasó con la prueba APAGADA — sin
   *  esto en la UI, el superadmin no podría distinguir "en prueba" de
   *  "esperando pago". */
  status: string;
  trialEndsAt: Date | null;
  createdAt: Date;
  reviewedAt: Date | null;
  creadorEmail: string | null;
  dominios: Array<{ id: string; pattern: string; status: 'VERIFIED' | 'PENDING' }>;
}

export async function detalleParaRevision(organizationId: string): Promise<DetalleParaRevision | null> {
  const license = await prisma.organizationLicense.findUnique({
    where: { organizationId },
    select: { declaredStudents: true, bandKey: true, status: true, trialEndsAt: true, createdAt: true, reviewedAt: true },
  });
  if (!license) return null;

  const [org, dominios, admin] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, kind: true } }),
    prisma.organizationDomain.findMany({
      where: { organizationId },
      select: { id: true, pattern: true, status: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.organizationAdmin.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: { user: { select: { email: true } } },
    }),
  ]);

  return {
    organizationId,
    nombre: org.name,
    kind: org.kind as 'CAMPUS' | 'NETWORK',
    declaredStudents: license.declaredStudents,
    bandKey: license.bandKey,
    status: license.status,
    trialEndsAt: license.trialEndsAt,
    createdAt: license.createdAt,
    reviewedAt: license.reviewedAt,
    creadorEmail: admin?.user.email ?? null,
    dominios,
  };
}

export async function verificarDominio(domainId: string): Promise<ResultadoAccion<{ pattern: string }>> {
  const dominio = await prisma.organizationDomain.findUnique({ where: { id: domainId } });
  if (!dominio) return { ok: false, status: 404, message: 'No encontramos ese dominio.' };
  await prisma.organizationDomain.update({ where: { id: domainId }, data: { status: 'VERIFIED' } });
  // T5 comentario: "la resolución por dominio ignora dominios PENDING" — el
  // caché de 10s de `resolucion.ts` puede tener guardado el "no encontrado"
  // de antes de verificar; sin invalidar, un docente que ya tiene ese
  // dominio tendría que esperar hasta 10s para unirse.
  invalidarCacheOrganizaciones();
  return { ok: true, data: { pattern: dominio.pattern } };
}

export async function eliminarDominio(domainId: string): Promise<ResultadoAccion<{ pattern: string }>> {
  const dominio = await prisma.organizationDomain.findUnique({ where: { id: domainId } });
  if (!dominio) return { ok: false, status: 404, message: 'No encontramos ese dominio.' };
  await prisma.organizationDomain.delete({ where: { id: domainId } });
  invalidarCacheOrganizaciones();
  return { ok: true, data: { pattern: dominio.pattern } };
}

export async function editarMatriculaDeclarada(
  organizationId: string,
  declaredStudents: number,
): Promise<ResultadoAccion<{ declaredStudents: number; bandKey: string | null }>> {
  const license = await prisma.organizationLicense.findUnique({ where: { organizationId } });
  if (!license) return { ok: false, status: 404, message: 'No encontramos la licencia de esta institución.' };

  const cfg = await prisma.billingSettings.findUniqueOrThrow({ where: { id: 1 } });
  const banda = bandForStudents(declaredStudents, cfg.hablemosThresholdStudents);
  if (banda.kind === 'invalid') return { ok: false, status: 422, message: `Matrícula inválida: ${banda.reason}.` };

  // Decisión de esta tarea: editar la matrícula declarada actualiza la banda
  // SÓLO si la licencia todavía no tiene un período contratado (TRIAL o
  // MANUAL sin período) — una licencia ACTIVE ya cobró con la banda vieja
  // congelada (mismo criterio que "un cambio de precio no mueve licencias ya
  // contratadas"); el cambio de matrícula ahí se aplica recién en la próxima
  // renovación, cuando `aplicarPrimerCobroOrg`/`aplicarRenovacion` recalculan
  // la banda con `declaredStudents` ya actualizado.
  const bandKey = banda.kind === 'band' ? banda.key : null;
  await prisma.organizationLicense.update({
    where: { id: license.id },
    data: { declaredStudents, ...(license.status === 'TRIAL' || license.status === 'MANUAL' ? { bandKey } : {}) },
  });

  return { ok: true, data: { declaredStudents, bandKey } };
}

export async function marcarRevisada(organizationId: string): Promise<ResultadoAccion<{ reviewedAt: Date }>> {
  const license = await prisma.organizationLicense.findUnique({ where: { organizationId } });
  if (!license) return { ok: false, status: 404, message: 'No encontramos la licencia de esta institución.' };
  const reviewedAt = new Date();
  await prisma.organizationLicense.update({ where: { id: license.id }, data: { reviewedAt } });
  return { ok: true, data: { reviewedAt } };
}

/**
 * odd/tasks/planes-y-cobros.md (T7/T11): "Extender prueba" en `/admin/altas`.
 * Dos casos:
 *
 * - `TRIAL` vigente: extiende `trialEndsAt` por `dias` más (comportamiento de
 *   siempre).
 * - `PENDING_PAYMENT` (T11: alta con la prueba apagada globalmente): el
 *   superadmin le da una prueba A MANO — pasa a `TRIAL` con `trialEndsAt =
 *   ahora + dias`. Es el único camino para que esa institución tenga prueba
 *   mientras `BillingSettings.trialEnabled` siga apagado.
 *
 * Cualquier otro estado (ACTIVE, PAST_DUE, READ_ONLY, CANCELED, MANUAL) se
 * rechaza — no tiene sentido "extender" una licencia que no está ni en
 * prueba ni esperando una.
 */
export async function extenderPrueba(organizationId: string, dias: number): Promise<ResultadoAccion<{ trialEndsAt: Date }>> {
  if (!Number.isInteger(dias) || dias <= 0) return { ok: false, status: 422, message: 'Los días tienen que ser un entero positivo.' };

  const license = await prisma.organizationLicense.findUnique({ where: { organizationId } });
  if (!license) return { ok: false, status: 404, message: 'No encontramos la licencia de esta institución.' };

  if (license.status === 'PENDING_PAYMENT') {
    const trialEndsAt = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
    await prisma.organizationLicense.update({ where: { id: license.id }, data: { status: 'TRIAL', trialEndsAt } });
    return { ok: true, data: { trialEndsAt } };
  }

  if (license.status !== 'TRIAL' || !license.trialEndsAt) {
    return { ok: false, status: 409, message: 'Sólo se puede extender (o dar de alta) una prueba.' };
  }

  const trialEndsAt = new Date(license.trialEndsAt.getTime() + dias * 24 * 60 * 60 * 1000);
  await prisma.organizationLicense.update({ where: { id: license.id }, data: { trialEndsAt } });
  return { ok: true, data: { trialEndsAt } };
}

export async function marcarLead(
  leadId: string,
  accion: 'CONTACTED' | 'CLOSED',
  note: string | null,
): Promise<ResultadoAccion<{ status: 'CONTACTED' | 'CLOSED' }>> {
  const lead = await prisma.institutionLead.findUnique({ where: { id: leadId } });
  if (!lead) return { ok: false, status: 404, message: 'No encontramos ese contacto.' };

  await prisma.institutionLead.update({
    where: { id: leadId },
    data: {
      status: accion,
      note: note?.trim() || lead.note,
      // "contactado" NO saca al lead de la cola (reviewedAt sigue null);
      // "cerrado" sí la saca — mismo criterio documentado en el schema.
      reviewedAt: accion === 'CLOSED' ? new Date() : lead.reviewedAt,
    },
  });

  return { ok: true, data: { status: accion } };
}
