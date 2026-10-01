import { prisma } from '../db.ts';

/**
 * odd/tasks/planes-y-cobros.md (T5): la cola de revisión del superadmin —
 * licencias de alta propia sin confirmar (`createdVia: 'SELF_SERVE'`,
 * `reviewedAt: null`) y contactos "Hablemos" sin contactar
 * (`InstitutionLead.reviewedAt: null`). Esta tarea sólo expone la
 * CONSULTA + el conteo (entrada en `/admin`, lista con link a
 * `/admin/organizaciones/[id]`); la pantalla para confirmar dominios y
 * matrícula, o marcar un lead como contactado, es T7.
 */

export interface ItemColaRevision {
  tipo: 'ALTA' | 'LEAD';
  id: string;
  /** Para `tipo: 'ALTA'`: el id de la organización, para armar el link. */
  organizationId: string | null;
  nombre: string;
  declaredStudents: number | null;
  createdAt: Date;
}

export async function colaDeRevision(): Promise<ItemColaRevision[]> {
  const [licencias, leads] = await Promise.all([
    prisma.organizationLicense.findMany({
      where: { createdVia: 'SELF_SERVE', reviewedAt: null },
      select: { organizationId: true, declaredStudents: true, createdAt: true, organization: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.institutionLead.findMany({
      where: { reviewedAt: null },
      select: { id: true, institutionName: true, declaredStudents: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const items: ItemColaRevision[] = [
    ...licencias.map((fila) => ({
      tipo: 'ALTA' as const,
      id: fila.organizationId,
      organizationId: fila.organizationId,
      nombre: fila.organization.name,
      declaredStudents: fila.declaredStudents,
      createdAt: fila.createdAt,
    })),
    ...leads.map((fila) => ({
      tipo: 'LEAD' as const,
      id: fila.id,
      organizationId: null,
      nombre: fila.institutionName,
      declaredStudents: fila.declaredStudents,
      createdAt: fila.createdAt,
    })),
  ];

  items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return items;
}

export async function contarColaDeRevision(): Promise<number> {
  const [a, b] = await Promise.all([
    prisma.organizationLicense.count({ where: { createdVia: 'SELF_SERVE', reviewedAt: null } }),
    prisma.institutionLead.count({ where: { reviewedAt: null } }),
  ]);
  return a + b;
}
