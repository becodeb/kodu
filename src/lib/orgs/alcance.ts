import { prisma } from '../db.ts';
import { fail } from '../http.ts';
import { requireUser } from '../auth/guards.ts';
import type { SessionUser } from '../auth/session.ts';

/**
 * odd/tasks/organizaciones.md (T4): CHOKEPOINT único de autorización para
 * cualquier API de administración de organización — hoy sólo invitaciones
 * (T4), pero T6 (alta de colegio/red/sede, dominios, lista blanca, mover
 * docentes) y T8 (panel de la organización) tienen que pasar por acá
 * también, sin reinventar el criterio en cada ruta. Si el día de mañana
 * cambia "quién puede administrar qué", cambia UNA vez, en este archivo.
 *
 * Regla de negocio (decisión del dueño + T9 "aislamiento"):
 *  - El superadmin (`User.role === 'ADMIN'`) administra TODO, incluidas las
 *    organizaciones archivadas — nadie más puede tocar una archivada.
 *  - Un `OrganizationAdmin` de una `NETWORK` administra esa red y TODAS sus
 *    sedes (`CAMPUS` hijas) no archivadas.
 *  - Un `OrganizationAdmin` de una `CAMPUS` administra sólo esa sede.
 *  - Una fila de `OrganizationAdmin` sólo CUENTA si quien la tiene pertenece
 *    HOY a esa organización (si es una CAMPUS) o a una sede de esa red (si
 *    es una NETWORK) — un admin de una sede de la que ya se fue no arrastra
 *    el permiso, y un admin de una red que cambió de sede sigue sirviendo
 *    mientras la nueva sede sea de la MISMA red.
 *
 * Facturación (odd/tasks/org-admin-facturacion.md): administrar NO implica
 * ver ni pagar el plan. La licencia vive en la RAÍZ (red, o colegio
 * standalone) y sólo la gestiona el superadmin o quien tiene, en la fila de
 * `OrganizationAdmin` de esa raíz, `canManageBilling = true`
 * (`facturacionIds` / `puedeGestionarFacturacion` / `requireFreshOrgBilling`
 * son LA regla: ninguna página ni API la reimplementa). El flag en la fila de
 * una sede de una red no cuenta nunca.
 */

export interface AlcanceAdmin {
  esSuperadmin: boolean;
  /** ids de NETWORK que administra (ya filtradas por membresía y sin archivar). */
  redIds: Set<string>;
  /** ids de CAMPUS que administra, directo o heredado de una red (ídem). */
  campusIds: Set<string>;
  /**
   * ids de organizaciones RAÍZ (red, o colegio standalone) cuya facturación
   * gestiona: tiene la fila con `canManageBilling`, la fila CUENTA (mismo
   * criterio de arriba) y la organización es de tope. Siempre vacío para el
   * superadmin (que gestiona todas: mirar `esSuperadmin`).
   */
  facturacionIds: Set<string>;
}

interface ActorAlcance {
  id: string;
  role: 'DOCENTE' | 'ADMIN';
}

async function propioCampusYRed(userId: string): Promise<{ campusId: string | null; redId: string | null }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true, organization: { select: { parentId: true } } },
  });
  return {
    campusId: user?.organizationId ?? null,
    redId: user?.organization?.parentId ?? null,
  };
}

export async function alcanceDeAdmin(actor: ActorAlcance): Promise<AlcanceAdmin> {
  if (actor.role === 'ADMIN') {
    return { esSuperadmin: true, redIds: new Set(), campusIds: new Set(), facturacionIds: new Set() };
  }

  const [propio, filas] = await Promise.all([
    propioCampusYRed(actor.id),
    prisma.organizationAdmin.findMany({
      where: { userId: actor.id },
      select: {
        organizationId: true,
        canManageBilling: true,
        organization: { select: { kind: true, archivedAt: true, parentId: true } },
      },
    }),
  ]);

  const redIds = new Set<string>();
  const campusIds = new Set<string>();
  const facturacionIds = new Set<string>();

  for (const fila of filas) {
    // "Archivada = sólo superadmin" (decisión del dueño): una fila de
    // OrganizationAdmin sobre una organización archivada nunca alcanza acá,
    // ni siquiera para su propio dueño.
    if (fila.organization.archivedAt !== null) continue;

    let cuenta = false;
    if (fila.organization.kind === 'CAMPUS') {
      if (propio.campusId === fila.organizationId) {
        campusIds.add(fila.organizationId);
        cuenta = true;
      }
    } else if (propio.redId === fila.organizationId) {
      redIds.add(fila.organizationId);
      cuenta = true;
    }

    if (cuenta && fila.canManageBilling && fila.organization.parentId === null) {
      facturacionIds.add(fila.organizationId);
    }
  }

  if (redIds.size > 0) {
    const sedes = await prisma.organization.findMany({
      where: { parentId: { in: [...redIds] }, kind: 'CAMPUS', archivedAt: null },
      select: { id: true },
    });
    for (const sede of sedes) campusIds.add(sede.id);
  }

  return { esSuperadmin: false, redIds, campusIds, facturacionIds };
}

/**
 * ¿Puede `actor` administrar `organizationId` (una CAMPUS o una NETWORK)?
 * Relee la organización de la base para el chequeo de archivado — nunca se
 * confía en un dato de caché para decidir autorización.
 */
export async function puedeAdministrar(actor: ActorAlcance, organizationId: string): Promise<boolean> {
  const alcance = await alcanceDeAdmin(actor);
  if (alcance.esSuperadmin) return true;

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { archivedAt: true } });
  if (!org || org.archivedAt !== null) return false;

  return alcance.campusIds.has(organizationId) || alcance.redIds.has(organizationId);
}

/**
 * ¿Puede `actor` ver y gestionar la facturación (plan, matrícula, pagos,
 * cancelación, renovación) de `rootId`? `rootId` es la organización RAÍZ:
 * la red, o el colegio standalone. Superadmin, o un admin de esa raíz con
 * `canManageBilling`.
 */
export async function puedeGestionarFacturacion(actor: ActorAlcance, rootId: string): Promise<boolean> {
  const alcance = await alcanceDeAdmin(actor);
  return alcance.esSuperadmin || alcance.facturacionIds.has(rootId);
}

/** Las sedes (CAMPUS, no archivadas) que `actor` puede administrar — para ofrecerlas en un selector (T4/T6). */
export async function campusesAdministrables(
  actor: ActorAlcance,
): Promise<Array<{ id: string; name: string; parentId: string | null }>> {
  if (actor.role === 'ADMIN') {
    return prisma.organization.findMany({
      where: { kind: 'CAMPUS', archivedAt: null },
      select: { id: true, name: true, parentId: true },
      orderBy: { name: 'asc' },
    });
  }

  const alcance = await alcanceDeAdmin(actor);
  if (alcance.campusIds.size === 0) return [];

  return prisma.organization.findMany({
    where: { id: { in: [...alcance.campusIds] } },
    select: { id: true, name: true, parentId: true },
    orderBy: { name: 'asc' },
  });
}

/**
 * Guarda compartida por las páginas/APIs de `/org` y `/api/org` (T4/T6/T8):
 * exige sesión Y que esa sesión administre `organizationId`. 404 (no 403)
 * para una organización ajena — decisión de este cambio: no confirmarle a
 * quien adivina un id que esa organización existe.
 */
export async function requireOrgAdmin(
  locals: App.Locals,
  organizationId: string,
): Promise<SessionUser | Response> {
  const resultado = requireUser(locals);
  if (resultado instanceof Response) return resultado;

  const puede = await puedeAdministrar(resultado, organizationId);
  if (!puede) return fail('No encontramos esa organización.', 404);

  return resultado;
}

/**
 * Igual que `requireOrgAdmin`, más la identidad fresca que ya exige
 * `requireFreshAdmin` en /api/admin — toda mutación de organización pasa por
 * acá, nunca por la variante de sólo lectura.
 */
export async function requireFreshOrgAdmin(
  locals: App.Locals,
  organizationId: string,
): Promise<SessionUser | Response> {
  const resultado = await requireOrgAdmin(locals, organizationId);
  if (resultado instanceof Response) return resultado;

  if (!locals.identityFresh) {
    return fail('No pudimos confirmar tus permisos. Probá de nuevo en unos segundos.', 503);
  }
  return resultado;
}

/**
 * Guarda de TODA ruta `/api/billing/org/**`: `requireFreshOrgAdmin` + el
 * permiso de facturación de la raíz. Un admin sin facturación recibe
 * exactamente el mismo 404 que un extraño — la ruta no confirma que exista.
 */
export async function requireFreshOrgBilling(
  locals: App.Locals,
  rootId: string,
): Promise<SessionUser | Response> {
  const resultado = await requireFreshOrgAdmin(locals, rootId);
  if (resultado instanceof Response) return resultado;

  if (!(await puedeGestionarFacturacion(resultado, rootId))) {
    return fail('No encontramos esa organización.', 404);
  }
  return resultado;
}
