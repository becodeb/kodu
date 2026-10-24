import { prisma } from '../db.ts';
import { Prisma } from '../../generated/prisma/client.ts';
import { organizacionActiva } from '../orgs/acceso.ts';
import { formatearCostoAdminUsd } from '../format/costo.ts';
import { fechaLarga, haceTiempo } from '../format/fecha.ts';
import { costoTotalDeUsuario } from '../ai/usage.ts';

/**
 * Agregados sobre `User` para `/admin/usuarios` (M5/M6, design.md — "The
 * users table" / "The user detail view"). Todo lo que sale de acá ya está
 * convertido a `string`/`number`/`boolean`: nada de `Prisma.Decimal` ni
 * `Date` cruza hacia `UsuariosTabla.tsx`, que es una isla `client:load`
 * (mismo borde que `modelos.ts` ya resuelve para el catálogo de motores).
 *
 * odd/tasks/organizaciones.md (T2): `accesoIa` ahora refleja la regla de
 * organización, no la de dominio (`AuthorizedDomain` ya no existe) — cuatro
 * razones nada más: `true` -> "Habilitado a mano", `false` -> "Revocado a
 * mano", `null` con una organización ACTIVA -> "Por organización", `null`
 * sin ella (o archivada) -> "Cuenta personal". `organizationName` viaja
 * aparte para que la tabla pueda mostrar la sede sin reimplementar nada.
 */

interface OrganizacionInfo {
  id: string;
  name: string;
  archivedAt: Date | null;
  parentArchivedAt: Date | null;
}

function textoAccesoIa(aiAccessOverride: boolean | null, org: OrganizacionInfo | null): string {
  if (aiAccessOverride === true) return 'Habilitado a mano';
  if (aiAccessOverride === false) return 'Revocado a mano';
  const activa = organizacionActiva(org ? { archivedAt: org.archivedAt, parent: { archivedAt: org.parentArchivedAt } } : null);
  return activa ? 'Por organización' : 'Cuenta personal';
}

async function cargarOrganizacionInfo(organizationId: string): Promise<OrganizacionInfo | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, archivedAt: true, parent: { select: { archivedAt: true } } },
  });
  if (!org) return null;
  return { id: org.id, name: org.name, archivedAt: org.archivedAt, parentArchivedAt: org.parent?.archivedAt ?? null };
}

/**
 * Versión de una sola fila de `textoAccesoIa`, para cuando sólo hace falta
 * recalcular UN usuario (ej. la respuesta de `PATCH /api/admin/users/:id`
 * después de tocar el override) y no vale la pena traer toda la tabla.
 */
export async function accesoIaDeUsuario(usuario: {
  aiAccessOverride: boolean | null;
  organizationId: string | null;
}): Promise<string> {
  const org = usuario.organizationId ? await cargarOrganizacionInfo(usuario.organizationId) : null;
  return textoAccesoIa(usuario.aiAccessOverride, org);
}

export interface FilaUsuarioAdmin {
  id: string;
  name: string;
  email: string;
  esGoogle: boolean;
  role: 'DOCENTE' | 'ADMIN';
  /** El permiso individual crudo: lo necesita el menú de la fila para saber qué ítems mostrar. */
  aiAccessOverride: boolean | null;
  /** "Habilitado a mano" | "Revocado a mano" | "Por organización" | "Cuenta personal". */
  accesoIa: string;
  /** `null` = cuenta personal, sin organización. */
  organizationName: string | null;
  /** odd/tasks/organizaciones.md (T6): para linkear a `/admin/organizaciones/[id]`. `null` junto con `organizationName`. */
  organizationId: string | null;
  proyectos: number;
  tokens: number;
  /** Ya formateado: "≈ US$ 1,24" | "US$ 0,00" | "—". */
  costoDisplay: string;
  /** Crudo, sólo para ordenar por consumo (`costoDisplay` es un string que
   *  no ordena bien). `null` = sin ningún turno o sin precio conocido. */
  costoUsdNumero: number | null;
  ultimaActividad: string;
  /** ISO o `null` ("Nunca") — T03: filtro "activos 7/30 días" y sort por
   *  actividad necesitan la fecha real, no sólo el texto relativo. */
  ultimaActividadIso: string | null;
  /** T03: 14 casilleros (más viejo → más nuevo), tokens por día — para la
   *  minicha sparkline de la fila. Se calcula de la MISMA pasada de
   *  `TokenUsage` que ya trae `usoPorUsuario` más abajo (ninguna consulta
   *  extra ni por fila). */
  sparkline: number[];
}

/**
 * La tabla completa de `/admin/usuarios`, ordenada alfabéticamente por
 * nombre. Excluye a la cuenta de demo (M7, design.md §8): no es un docente
 * real, tiene su propia página (`/admin/demo`) con su propio consumo y su
 * propio tope, y listarla acá al lado de docentes de verdad — con "Rol:
 * Docente" y un botón "Hacer administrador" que jamás debería tocarla —
 * confundiría la tabla en vez de aclararla.
 */
/** Días que cubre la sparkline de fila (T03). Fijo y chico a propósito: es
 *  una señal de "¿está subiendo o se apagó?", no un gráfico para leer cifras. */
const DIAS_SPARKLINE = 14;

export async function listarUsuariosAdmin(): Promise<FilaUsuarioAdmin[]> {
  const [usuarios, filasUso, proyectosPorUsuario] = await Promise.all([
    prisma.user.findMany({
      where: { isDemo: false },
      select: {
        id: true,
        name: true,
        email: true,
        googleId: true,
        role: true,
        aiAccessOverride: true,
        organizationId: true,
      },
    }),
    prisma.tokenUsage.findMany({
      select: { userId: true, promptTokens: true, completionTokens: true, costUsd: true, createdAt: true },
    }),
    prisma.project.groupBy({
      by: ['userId'],
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
  ]);

  const hoy = new Date();
  hoy.setUTCHours(0, 0, 0, 0);
  const desdeSparkline = new Date(hoy);
  desdeSparkline.setUTCDate(desdeSparkline.getUTCDate() - (DIAS_SPARKLINE - 1));

  const usoPorUsuario = new Map<
    string,
    { tokens: number; costUsd: Prisma.Decimal; sinPrecio: boolean; ultima: Date }
  >();
  // T03: misma pasada de `filasUso` — un arreglo de `DIAS_SPARKLINE`
  // casilleros por usuario, nada de consultas por fila.
  const sparklinePorUsuario = new Map<string, number[]>();
  for (const fila of filasUso) {
    const previo = usoPorUsuario.get(fila.userId) ?? {
      tokens: 0,
      costUsd: new Prisma.Decimal(0),
      sinPrecio: false,
      ultima: fila.createdAt,
    };
    previo.tokens += fila.promptTokens + fila.completionTokens;
    if (fila.costUsd === null) previo.sinPrecio = true;
    else previo.costUsd = previo.costUsd.add(fila.costUsd);
    if (fila.createdAt > previo.ultima) previo.ultima = fila.createdAt;
    usoPorUsuario.set(fila.userId, previo);

    if (fila.createdAt >= desdeSparkline) {
      const indice = Math.floor((fila.createdAt.getTime() - desdeSparkline.getTime()) / 86_400_000);
      if (indice >= 0 && indice < DIAS_SPARKLINE) {
        const casilleros = sparklinePorUsuario.get(fila.userId) ?? new Array(DIAS_SPARKLINE).fill(0);
        casilleros[indice] += fila.promptTokens + fila.completionTokens;
        sparklinePorUsuario.set(fila.userId, casilleros);
      }
    }
  }

  const proyectosMapa = new Map(proyectosPorUsuario.map((fila) => [fila.userId, fila]));

  // Un solo `findMany` para TODAS las organizaciones involucradas, no una
  // consulta por fila — el equivalente a la caché de 10s que
  // `dominioAutorizado()` tenía antes de T1/T2 (ya no existe: la reemplaza
  // este batch, más barato todavía porque no depende del reloj).
  const organizationIds = [...new Set(usuarios.map((u) => u.organizationId).filter((id): id is string => id !== null))];
  const organizaciones =
    organizationIds.length > 0
      ? await prisma.organization.findMany({
          where: { id: { in: organizationIds } },
          select: { id: true, name: true, archivedAt: true, parent: { select: { archivedAt: true } } },
        })
      : [];
  const organizacionesMapa = new Map<string, OrganizacionInfo>(
    organizaciones.map((org) => [
      org.id,
      { id: org.id, name: org.name, archivedAt: org.archivedAt, parentArchivedAt: org.parent?.archivedAt ?? null },
    ]),
  );

  const filas = usuarios.map((usuario) => {
    const uso = usoPorUsuario.get(usuario.id);
    const proyectoInfo = proyectosMapa.get(usuario.id);

    const ultimaActividadFecha = [uso?.ultima, proyectoInfo?._max.updatedAt]
      .filter((fecha): fecha is Date => fecha != null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    const org = usuario.organizationId ? (organizacionesMapa.get(usuario.organizationId) ?? null) : null;
    const costoUsdNumero =
      uso === undefined || uso.sinPrecio ? null : Number(uso.costUsd.toString());

    return {
      id: usuario.id,
      name: usuario.name,
      email: usuario.email,
      esGoogle: usuario.googleId !== null,
      role: usuario.role,
      aiAccessOverride: usuario.aiAccessOverride,
      accesoIa: textoAccesoIa(usuario.aiAccessOverride, org),
      organizationName: org?.name ?? null,
      organizationId: usuario.organizationId,
      proyectos: proyectoInfo?._count._all ?? 0,
      tokens: uso?.tokens ?? 0,
      costoDisplay: formatearCostoAdminUsd(uso === undefined ? null : uso.sinPrecio ? null : uso.costUsd.toString()),
      costoUsdNumero,
      ultimaActividad: haceTiempo(ultimaActividadFecha ?? null),
      ultimaActividadIso: ultimaActividadFecha ? ultimaActividadFecha.toISOString() : null,
      sparkline: sparklinePorUsuario.get(usuario.id) ?? new Array(DIAS_SPARKLINE).fill(0),
    };
  });

  return filas.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export interface DetalleUsuarioAdmin {
  id: string;
  name: string;
  email: string;
  esGoogle: boolean;
  role: 'DOCENTE' | 'ADMIN';
  /** "se sumó el 4 de marzo". */
  creadoDisplay: string;
  accesoIa: string;
  organizationName: string | null;
  organizationId: string | null;
  tokens: number;
  costoDisplay: string;
  proyectosCount: number;
}

/** El encabezado + trío de estadísticas del detalle de un docente. `null` si
 *  no existe O si es la cuenta de demo (ver `listarUsuariosAdmin`: no tiene
 *  ficha acá, vive en `/admin/demo`). */
export async function obtenerUsuarioAdmin(id: string): Promise<DetalleUsuarioAdmin | null> {
  const usuario = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      googleId: true,
      role: true,
      createdAt: true,
      aiAccessOverride: true,
      isDemo: true,
      organizationId: true,
    },
  });
  if (!usuario || usuario.isDemo) return null;

  const [{ tokens, costUsd }, proyectosCount, org] = await Promise.all([
    costoTotalDeUsuario(usuario.id),
    prisma.project.count({ where: { userId: usuario.id } }),
    usuario.organizationId ? cargarOrganizacionInfo(usuario.organizationId) : Promise.resolve(null),
  ]);

  return {
    id: usuario.id,
    name: usuario.name,
    email: usuario.email,
    esGoogle: usuario.googleId !== null,
    role: usuario.role,
    creadoDisplay: `se sumó el ${fechaLarga(usuario.createdAt)}`,
    accesoIa: textoAccesoIa(usuario.aiAccessOverride, org),
    organizationName: org?.name ?? null,
    organizationId: usuario.organizationId,
    tokens,
    costoDisplay: formatearCostoAdminUsd(costUsd?.toString() ?? null),
    proyectosCount,
  };
}
