import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../db.ts';
import { getEnv } from '../env.ts';
import { normalizeEmail } from '../auth/domains.ts';
import { invalidarCacheOrganizaciones } from './resolucion.ts';

/**
 * odd/tasks/organizaciones.md (T4): enlace de invitación a una CAMPUS —
 * emisión, listado, revocación y aceptación. Mismo criterio de hash que
 * `orgs/verificacion.ts` (nunca se guarda el token en claro, sólo su sha256,
 * ver el comentario de `OrganizationInvite` en el schema) — se duplica acá
 * en vez de compartir un helper porque las dos tablas tienen su propio
 * vencimiento y el repo ya tiene ese mismo precedente entre los dos archivos.
 *
 * "El enlace de invitación nunca exige email verificado" (decisión del
 * dueño): a diferencia de `unirSiCorresponde`, `aceptarInvitacion` NUNCA
 * llama a `emailConfiable` — tener el enlace es la prueba.
 */

function hashToken(tokenPlano: string): string {
  return createHash('sha256').update(tokenPlano).digest('hex');
}

function generarTokenPlano(): string {
  return randomBytes(32).toString('base64url');
}

function enlaceInvitacion(tokenPlano: string): string {
  const base = getEnv().PUBLIC_SITE_URL.replace(/\/+$/, '');
  return `${base}/invitacion/${encodeURIComponent(tokenPlano)}`;
}

export type EstadoInvitacion = 'activa' | 'vencida' | 'agotada' | 'revocada';

function estadoDeInvitacion(fila: {
  revokedAt: Date | null;
  expiresAt: Date | null;
  uses: number;
  maxUses: number | null;
}): EstadoInvitacion {
  if (fila.revokedAt !== null) return 'revocada';
  if (fila.expiresAt !== null && fila.expiresAt.getTime() < Date.now()) return 'vencida';
  if (fila.maxUses !== null && fila.uses >= fila.maxUses) return 'agotada';
  return 'activa';
}

export interface InvitacionResumen {
  id: string;
  estado: EstadoInvitacion;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  createdAt: string;
  /** Nunca el token — sólo se devuelve una vez, en `crearInvitacion` (T4). */
  createdByNombre: string | null;
}

type FilaInvitacion = {
  id: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  uses: number;
  maxUses: number | null;
  createdAt: Date;
  createdBy: { name: string } | null;
};

function serializar(fila: FilaInvitacion): InvitacionResumen {
  return {
    id: fila.id,
    estado: estadoDeInvitacion(fila),
    uses: fila.uses,
    maxUses: fila.maxUses,
    expiresAt: fila.expiresAt?.toISOString() ?? null,
    createdAt: fila.createdAt.toISOString(),
    createdByNombre: fila.createdBy?.name ?? null,
  };
}

/** Crea una invitación para `organizationId` (SIEMPRE una CAMPUS — lo valida el llamador, T4). */
export async function crearInvitacion(
  organizationId: string,
  opts: { expiresAt: Date | null; maxUses: number | null },
  createdById: string,
): Promise<{ url: string; invitacion: InvitacionResumen }> {
  const tokenPlano = generarTokenPlano();
  const tokenHash = hashToken(tokenPlano);

  const fila = await prisma.organizationInvite.create({
    data: {
      organizationId,
      tokenHash,
      expiresAt: opts.expiresAt,
      maxUses: opts.maxUses,
      createdById,
    },
    include: { createdBy: { select: { name: true } } },
  });

  return { url: enlaceInvitacion(tokenPlano), invitacion: serializar(fila) };
}

export async function listarInvitaciones(organizationId: string): Promise<InvitacionResumen[]> {
  const filas = await prisma.organizationInvite.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { name: true } } },
  });
  return filas.map(serializar);
}

/**
 * Para revocar: el llamador SIEMPRE tiene que autorizar contra la
 * organización REAL de esta fila (nunca contra un `organizationId` que
 * mande el body/la URL — odd/tasks/organizaciones.md T4).
 */
export async function invitacionPorId(id: string): Promise<{ id: string; organizationId: string } | null> {
  return prisma.organizationInvite.findUnique({
    where: { id },
    select: { id: true, organizationId: true },
  });
}

export async function revocarInvitacion(id: string): Promise<void> {
  // `updateMany` (no `update`) para que revocar una invitación ya revocada
  // sea un no-op silencioso en vez de un error — el admin pudo haber
  // apretado el botón dos veces (doble click, dos pestañas).
  await prisma.organizationInvite.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export type ResolucionInvitacionPublica =
  | { valida: true; organizacion: { id: string; name: string }; red: { name: string } | null }
  | { valida: false };

/**
 * Para la página pública `/invitacion/[token]` (T4): nunca revela POR QUÉ un
 * enlace no sirve (desconocido/vencido/agotado/revocado/organización
 * archivada) — un solo resultado "no válida" para los cinco motivos, mismo
 * criterio que `verificarToken` en verificacion.ts.
 */
export async function resolverInvitacionPublica(tokenPlano: string): Promise<ResolucionInvitacionPublica> {
  const tokenHash = hashToken(tokenPlano);
  const fila = await prisma.organizationInvite.findUnique({
    where: { tokenHash },
    select: {
      revokedAt: true,
      expiresAt: true,
      uses: true,
      maxUses: true,
      organization: {
        select: {
          id: true,
          name: true,
          archivedAt: true,
          parent: { select: { name: true, archivedAt: true } },
        },
      },
    },
  });
  if (!fila) return { valida: false };
  if (estadoDeInvitacion(fila) !== 'activa') return { valida: false };
  if (fila.organization.archivedAt !== null) return { valida: false };
  if (fila.organization.parent && fila.organization.parent.archivedAt !== null) return { valida: false };

  return {
    valida: true,
    organizacion: { id: fila.organization.id, name: fila.organization.name },
    red: fila.organization.parent ? { name: fila.organization.parent.name } : null,
  };
}

export type ResultadoAceptarInvitacion =
  | { ok: true }
  | { ok: false; motivo: 'invalida' }
  | { ok: false; motivo: 'demo' }
  | { ok: false; motivo: 'ya_en_esa_sede' }
  | { ok: false; motivo: 'ya_en_otra_organizacion'; organizacion: string };

/**
 * Acepta una invitación para `userId`. Consumo race-safe: un UPDATE atómico
 * (mismo criterio del cupo/vencimiento/revocación/archivado que
 * `resolverInvitacionPublica`, más el archivado de la RED si la sede
 * pertenece a una) y la asignación de `organizationId` en la MISMA
 * transacción — si el UPDATE no afecta ninguna fila (cupo agotado por otra
 * corrida concurrente, revocada o vencida justo ahora, o la organización se
 * archivó en el medio) no se toca al usuario.
 *
 * El UPDATE toma el lock de fila de ESTA invitación antes de reevaluar su
 * condición: dos aceptaciones concurrentes de un cupo `maxUses = 1` se
 * serializan ahí — la segunda corre después de que la primera confirma
 * `uses = 1` y ya no matchea `uses < maxUses`, así que afecta 0 filas.
 */
export async function aceptarInvitacion(tokenPlano: string, userId: string): Promise<ResultadoAceptarInvitacion> {
  const tokenHash = hashToken(tokenPlano);

  const invitacion = await prisma.organizationInvite.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      organizationId: true,
      revokedAt: true,
      expiresAt: true,
      uses: true,
      maxUses: true,
      organization: { select: { archivedAt: true, parent: { select: { archivedAt: true } } } },
    },
  });
  if (!invitacion) return { ok: false, motivo: 'invalida' };
  if (estadoDeInvitacion(invitacion) !== 'activa') return { ok: false, motivo: 'invalida' };
  if (invitacion.organization.archivedAt !== null) return { ok: false, motivo: 'invalida' };
  if (invitacion.organization.parent && invitacion.organization.parent.archivedAt !== null) {
    return { ok: false, motivo: 'invalida' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, organizationId: true, isDemo: true, organization: { select: { name: true } } },
  });
  if (!user) return { ok: false, motivo: 'invalida' };
  // "La demo queda fuera de toda organización" (decisión del dueño).
  if (user.isDemo) return { ok: false, motivo: 'demo' };
  if (user.organizationId === invitacion.organizationId) return { ok: false, motivo: 'ya_en_esa_sede' };
  // "Un docente pertenece a UNA sola organización" (decisión del dueño): no
  // se consume el cupo de nadie por un pedido que iba a fallar igual.
  if (user.organizationId !== null) {
    return { ok: false, motivo: 'ya_en_otra_organizacion', organizacion: user.organization?.name ?? 'otra organización' };
  }

  // Sentinel para abortar la transacción (rollback del uses+1 incluido) sin
  // que el llamador vea una excepción real — Prisma reencapsula lo que sea
  // que tire el callback de `$transaction`, así que un `instanceof` propio
  // alcanza para distinguir "hubo una carrera" de un error de verdad.
  class CarreraDeAceptacion extends Error {}

  try {
    await prisma.$transaction(async (tx) => {
      const filasAfectadas = await tx.$executeRaw`
        UPDATE "OrganizationInvite" AS inv
        SET "uses" = inv."uses" + 1
        FROM "Organization" AS org
        LEFT JOIN "Organization" AS red ON red."id" = org."parentId"
        WHERE inv."id" = ${invitacion.id}
          AND inv."organizationId" = org."id"
          AND inv."revokedAt" IS NULL
          AND (inv."expiresAt" IS NULL OR inv."expiresAt" > now())
          AND (inv."maxUses" IS NULL OR inv."uses" < inv."maxUses")
          AND org."archivedAt" IS NULL
          AND (red."id" IS NULL OR red."archivedAt" IS NULL)
      `;
      if (filasAfectadas === 0) throw new CarreraDeAceptacion();

      // Guardia de la MISMA carrera del lado del usuario: si entre el
      // chequeo de arriba y acá se coló otra membresía (otra pestaña, otro
      // enlace), se aborta TODO — incluido el uses+1 recién hecho — con el
      // rollback de la transacción.
      const usuarioActualizado = await tx.user.updateMany({
        where: { id: userId, organizationId: null },
        data: { organizationId: invitacion.organizationId },
      });
      if (usuarioActualizado.count === 0) throw new CarreraDeAceptacion();

      // T6 (decisión técnica de T5): "aceptar una invitación borra la
      // exclusión para esa CAMPUS" — explícito y GANA a una baja anterior,
      // así que quien fue dado de baja puede volver a entrar con un enlace
      // nuevo aunque su dominio siga bloqueado para él.
      await tx.organizationExclusion.deleteMany({
        where: { organizationId: invitacion.organizationId, email: normalizeEmail(user.email) },
      });
    });
  } catch (error) {
    if (error instanceof CarreraDeAceptacion) return { ok: false, motivo: 'invalida' };
    throw error;
  }

  // Fuera de la transacción a propósito (misma razón que unirSiCorresponde):
  // invalidar la caché no necesita el commit confirmado en el mismo tick, y
  // encadenarla adentro sólo agregaría una espera a la respuesta HTTP.
  invalidarCacheOrganizaciones();

  return { ok: true };
}
