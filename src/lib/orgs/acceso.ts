import { prisma } from '../db.ts';
import { licenseAllowsAi, type LicenciaParaAcceso, type RazonAcceso } from '../billing/acceso-licencia.ts';
import { balance, ensureGrants } from '../billing/creditos-servicio.ts';
import { proximaRenovacionEtiqueta } from '../billing/creditos.ts';
import { reconciliarLicenciaOrgVencida } from '../billing/vencimiento.ts';

/**
 * odd/tasks/organizaciones.md (T2) / odd/tasks/planes-y-cobros.md (T2/T3): la
 * regla de acceso a la IA, reemplaza a la basada en `AuthorizedDomain` (M6,
 * design.md §10 vieja). `src/lib/auth/domains.ts` re-exporta `puedeUsarLaIa`
 * bajo el mismo nombre e import path de siempre — así `chat/stream.ts`,
 * `verificar.ts` y `autocorreccion.ts` siguen compilando sin tocarlos.
 *
 * Tabla de verdad (fila nueva de T2/T3 en negrita):
 *
 * | aiAccessOverride | role       | resultado                                            |
 * |---|---|---|
 * | true  | *          | permitido, sin importar la organización (grant explícito) |
 * | false | *          | denegado, sin importar la organización (revocación explícita) |
 * | null  | ADMIN      | permitido (superadmin, decisión del dueño)           |
 * | null  | DOCENTE, organización activa | permitido sólo si la licencia de la organización RAÍZ lo permite (`licenseAllowsAi`, T3) |
 * | null  | DOCENTE, organización archivada | denegado (`org_archived`) |
 * | **null** | **DOCENTE, cuenta personal (sin organización)** | **permitido sólo si el saldo de créditos (T2, otorgado perezosamente por `ensureGrants`) es > 0** |
 *
 * La cuenta de demo (M7) queda fuera de toda organización a propósito y
 * sigue con `aiAccessOverride = true` fijo (`lib/demo.ts`), así que entra
 * siempre por la primera fila de la tabla — nunca llega a mirar
 * `organizationId`, créditos ni licencia.
 */

/**
 * Razón MÁQUINA de un resultado de acceso (T2/T3) — para que la UI muestre
 * el mensaje correcto sin repetir la lógica de arriba. Las que empiezan con
 * `license_` son literalmente `RazonAcceso` de `acceso-licencia.ts` con el
 * prefijo puesto (misma fuente de verdad, un solo lugar que decide el
 * vocabulario de la licencia).
 */
export type RazonAccesoIa =
  | 'override_true'
  | 'override_false'
  | 'admin'
  | 'org_archived'
  | 'license_missing'
  | `license_${RazonAcceso}`
  | 'has_credits'
  | 'no_credits';

export interface ResultadoAccesoIa {
  allowed: boolean;
  reason: RazonAccesoIa;
  /**
   * Sólo tiene sentido cuando `reason` es de organización/licencia: si quien
   * mira es admin de ESA organización raíz (decisión del dueño, T3: el
   * mensaje de "licencia no activa" es distinto para un admin de la
   * institución que para un docente miembro cualquiera).
   */
  esAdminOrg?: boolean;
}
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

/**
 * odd/tasks/planes-y-cobros.md (T3): licencia de la organización RAÍZ de
 * `organizationId` — la propia si no tiene padre, o la de su red si es una
 * sede (`Organization.parentId`, comentario de `OrganizationLicense` en
 * schema.prisma: "una sede de una red usa la licencia de su red").
 */
async function licenciaDeLaRaiz(
  organizationId: string,
  now: Date = new Date(),
): Promise<{ rootId: string; license: LicenciaParaAcceso | null; esAdminDeLaRaiz: (userId: string) => Promise<boolean> }> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { parentId: true },
  });
  const rootId = org?.parentId ?? organizationId;

  // T4b: antes de leer la licencia, reconciliar un vencimiento de CICLO sin
  // renovar (perezoso, mismo criterio que `ensureGrants` para créditos).
  await reconciliarLicenciaOrgVencida(rootId, now);

  const license = await prisma.organizationLicense.findUnique({
    where: { organizationId: rootId },
    select: { status: true, trialEndsAt: true, graceEndsAt: true, cancelAtPeriodEnd: true, currentPeriodEnd: true },
  });

  return {
    rootId,
    license,
    esAdminDeLaRaiz: async (userId: string) => {
      const fila = await prisma.organizationAdmin.findUnique({
        where: { userId_organizationId: { userId, organizationId: rootId } },
        select: { userId: true },
      });
      return fila !== null;
    },
  };
}

export async function resolverAccesoIa(
  user: UsuarioParaAcceso,
  now: Date = new Date(),
): Promise<ResultadoAccesoIa> {
  if (user.aiAccessOverride !== null) {
    return { allowed: user.aiAccessOverride, reason: user.aiAccessOverride ? 'override_true' : 'override_false' };
  }
  if (user.role === 'ADMIN') return { allowed: true, reason: 'admin' };

  let organizationId = user.organizationId;
  if (organizationId === undefined) {
    if (!user.id) return { allowed: false, reason: 'no_credits' };
    const fila = await prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } });
    organizationId = fila?.organizationId ?? null;
  }

  // Cuenta personal: T2, créditos.
  if (!organizationId) {
    if (!user.id) return { allowed: false, reason: 'no_credits' };
    await ensureGrants(user.id, now);
    const saldo = await balance(user.id);
    return saldo > 0 ? { allowed: true, reason: 'has_credits' } : { allowed: false, reason: 'no_credits' };
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { archivedAt: true, parent: { select: { archivedAt: true } } },
  });
  if (!organizacionActiva(org)) return { allowed: false, reason: 'org_archived' };

  const { rootId, license, esAdminDeLaRaiz } = await licenciaDeLaRaiz(organizationId, now);
  if (!license) {
    // T1 backfilleó MANUAL para toda organización de tope preexistente y
    // `crearOrganizacion` (gestion.ts) le pone MANUAL a cualquier alta nueva
    // del superadmin — una raíz sin licencia acá es un bug, nunca un estado
    // esperado. Fail-closed: nunca se trata como acceso libre.
    console.warn(
      `[billing] Organización raíz ${rootId} sin OrganizationLicense — acceso a la IA denegado (T1/T3 debieron haberla creado).`,
    );
    return { allowed: false, reason: 'license_missing', esAdminOrg: user.id ? await esAdminDeLaRaiz(user.id) : false };
  }

  const resultado = licenseAllowsAi(license, now);
  return {
    allowed: resultado.allowed,
    reason: `license_${resultado.reason}`,
    esAdminOrg: user.id ? await esAdminDeLaRaiz(user.id) : false,
  };
}

export async function puedeUsarLaIa(user: UsuarioParaAcceso): Promise<boolean> {
  return (await resolverAccesoIa(user)).allowed;
}

/**
 * odd/tasks/planes-y-cobros.md (T2/T3): el mensaje legible de un acceso
 * denegado — un solo lugar que traduce `RazonAccesoIa` a texto, para que
 * `chat/stream.ts`, `verificar.ts`, `autocorreccion.ts` y las pantallas de
 * `/app` digan siempre lo mismo. `esAdminOrg` sólo importa para las razones
 * de licencia (decisión del dueño: mensaje distinto para quien administra la
 * institución).
 */
export function mensajeAccesoIa(resultado: ResultadoAccesoIa, now: Date = new Date()): string {
  switch (resultado.reason) {
    case 'no_credits':
      return `Te quedaste sin créditos. Se renuevan el ${proximaRenovacionEtiqueta(now)} o pasate a Individual.`;
    case 'override_false':
      return 'Tu cuenta todavía no tiene habilitado el uso de la IA. Escribinos y lo vemos.';
    case 'org_archived':
      return 'Tu organización ya no está activa. Escribinos y lo vemos.';
    case 'license_missing':
      return 'Hubo un problema con la licencia de tu institución. Escribinos y lo vemos.';
    case 'license_trial_expirado':
    case 'license_trial_sin_fecha':
      return resultado.esAdminOrg
        ? 'Tu prueba terminó. Contratá para seguir usando la IA.'
        : 'La licencia de tu institución no está activa. Avisale a quien administra Kodu en tu institución.';
    case 'license_gracia_expirada':
    case 'license_gracia_sin_fecha':
    case 'license_read_only':
    case 'license_canceled':
      return resultado.esAdminOrg
        ? 'Tu licencia no está activa. Contratá para seguir usando la IA.'
        : 'La licencia de tu institución no está activa. Avisale a quien administra Kodu en tu institución.';
    default:
      // 'admin' | 'override_true' | 'has_credits' | 'license_active' |
      // 'license_manual' | 'license_trial_vigente' | 'license_gracia_vigente':
      // ninguna de estas se llega a mostrar (todas son `allowed: true`).
      return 'Tu cuenta todavía no tiene habilitado el uso de la IA. Escribinos y lo vemos.';
  }
}
