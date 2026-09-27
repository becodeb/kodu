import { prisma } from '../db.ts';

/**
 * odd/tasks/organizaciones.md (T2): la nueva regla de acceso a la IA,
 * reemplaza a la basada en `AuthorizedDomain` (M6, design.md §10 vieja).
 * `src/lib/auth/domains.ts` re-exporta esta misma función bajo el mismo
 * nombre e import path de siempre — así `chat/stream.ts`, `verificar.ts` y
 * `autocorreccion.ts` siguen andando sin tocarlos (otra sesión está
 * cambiando `stream.ts` en paralelo, feat/generacion-simple-y-reanudable).
 *
 * | aiAccessOverride | role       | resultado                                            |
 * |---|---|---|
 * | true  | *          | permitido, sin importar la organización (grant explícito) |
 * | false | *          | denegado, sin importar la organización (revocación explícita) |
 * | null  | ADMIN      | permitido (superadmin, decisión del dueño)           |
 * | null  | DOCENTE    | permitido sólo con una organización ACTIVA (ella y su red, si tiene, sin archivar); si no, cuenta personal → denegado |
 *
 * La cuenta de demo (M7) queda fuera de toda organización a propósito y
 * sigue con `aiAccessOverride = true` fijo (`lib/demo.ts`), así que entra
 * siempre por la primera fila de la tabla — nunca llega a mirar
 * `organizationId`.
 */
export interface UsuarioParaAcceso {
  /** Sólo hace falta si `organizationId` no viene (relectura de compatibilidad). */
  id?: string;
  aiAccessOverride: boolean | null;
  role?: 'DOCENTE' | 'ADMIN';
  /** `undefined` = no se pasó (se relee de la base por `id`); `null` = cuenta personal, sin organización. */
  organizationId?: string | null;
}

interface OrganizacionParaAcceso {
  archivedAt: Date | null;
  parent?: { archivedAt: Date | null } | null;
}

/**
 * Ni la organización ni su red (si es una sede de una) están dadas de baja.
 * Exportada para que `admin/usuarios.ts` calcule el MISMO criterio al
 * mostrar la razón de acceso — un solo lugar que decide qué es "activa".
 */
export function organizacionActiva(org: OrganizacionParaAcceso | null): boolean {
  if (!org) return false;
  if (org.archivedAt !== null) return false;
  if (org.parent && org.parent.archivedAt !== null) return false;
  return true;
}

export async function puedeUsarLaIa(user: UsuarioParaAcceso): Promise<boolean> {
  if (user.aiAccessOverride !== null) return user.aiAccessOverride;
  if (user.role === 'ADMIN') return true;

  let organizationId = user.organizationId;
  if (organizationId === undefined) {
    if (!user.id) return false;
    const fila = await prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } });
    organizationId = fila?.organizationId ?? null;
  }
  if (!organizationId) return false;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { archivedAt: true, parent: { select: { archivedAt: true } } },
  });
  return organizacionActiva(org);
}
