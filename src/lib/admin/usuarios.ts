import { prisma } from '../db.ts';
import { Prisma } from '../../generated/prisma/client.ts';
import { isAllowedDomain } from '../auth/domains.ts';
import { formatearCostoAdminUsd } from '../format/costo.ts';
import { fechaLarga, haceTiempo } from '../format/fecha.ts';
import { costoTotalDeUsuario } from '../ai/usage.ts';

/**
 * Agregados sobre `User` para `/admin/usuarios` (M5, design.md — "The users
 * table" / "The user detail view"). Todo lo que sale de acá ya está
 * convertido a `string`/`number`/`boolean`: nada de `Prisma.Decimal` ni
 * `Date` cruza hacia `UsuariosTabla.tsx`, que es una isla `client:load`
 * (mismo borde que `modelos.ts` ya resuelve para el catálogo de motores).
 *
 * **`aiAccessOverride` queda afuera a propósito.** `src/lib/auth/session.ts`
 * y `src/middleware.ts` ya documentan que esa columna todavía no existe —
 * llega con la migración de M6 — y hasta entonces no hay ningún permiso
 * INDIVIDUAL que grabar ni leer. Por eso "Acceso a la IA" acá sólo puede
 * distinguir dos de los tres estados que describe design.md
 * ("Sí · por dominio" / "No"): el tercero ("Sí · permiso individual")
 * no tiene ningún dato real detrás todavía. Es la misma clase de dependencia
 * cruzada entre milestones que tasks.md ya marca explícitamente para 5.8 y
 * M8 — acá no estaba escrita, así que queda documentada acá.
 */

export interface FilaUsuarioAdmin {
  id: string;
  name: string;
  email: string;
  esGoogle: boolean;
  role: 'DOCENTE' | 'ADMIN';
  /** "Sí · por dominio" | "No" — ver la nota de arriba. */
  accesoIa: string;
  proyectos: number;
  tokens: number;
  /** Ya formateado: "≈ US$ 1,24" | "US$ 0,00" | "—". */
  costoDisplay: string;
  ultimaActividad: string;
}

/** La tabla completa de `/admin/usuarios`, ordenada alfabéticamente por nombre. */
export async function listarUsuariosAdmin(): Promise<FilaUsuarioAdmin[]> {
  const [usuarios, filasUso, proyectosPorUsuario] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, name: true, email: true, googleId: true, role: true },
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

  const usoPorUsuario = new Map<
    string,
    { tokens: number; costUsd: Prisma.Decimal; sinPrecio: boolean; ultima: Date }
  >();
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
  }

  const proyectosMapa = new Map(proyectosPorUsuario.map((fila) => [fila.userId, fila]));

  return usuarios
    .map((usuario) => {
      const uso = usoPorUsuario.get(usuario.id);
      const proyectoInfo = proyectosMapa.get(usuario.id);

      const ultimaActividadFecha = [uso?.ultima, proyectoInfo?._max.updatedAt]
        .filter((fecha): fecha is Date => fecha != null)
        .sort((a, b) => b.getTime() - a.getTime())[0];

      return {
        id: usuario.id,
        name: usuario.name,
        email: usuario.email,
        esGoogle: usuario.googleId !== null,
        role: usuario.role,
        accesoIa: isAllowedDomain(usuario.email) ? 'Sí · por dominio' : 'No',
        proyectos: proyectoInfo?._count._all ?? 0,
        tokens: uso?.tokens ?? 0,
        costoDisplay: formatearCostoAdminUsd(uso === undefined ? null : uso.sinPrecio ? null : uso.costUsd.toString()),
        ultimaActividad: haceTiempo(ultimaActividadFecha ?? null),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
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
  tokens: number;
  costoDisplay: string;
  proyectosCount: number;
}

/** El encabezado + trío de estadísticas del detalle de un docente. `null` si no existe. */
export async function obtenerUsuarioAdmin(id: string): Promise<DetalleUsuarioAdmin | null> {
  const usuario = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, googleId: true, role: true, createdAt: true },
  });
  if (!usuario) return null;

  const [{ tokens, costUsd }, proyectosCount] = await Promise.all([
    costoTotalDeUsuario(usuario.id),
    prisma.project.count({ where: { userId: usuario.id } }),
  ]);

  return {
    id: usuario.id,
    name: usuario.name,
    email: usuario.email,
    esGoogle: usuario.googleId !== null,
    role: usuario.role,
    creadoDisplay: `se sumó el ${fechaLarga(usuario.createdAt)}`,
    accesoIa: isAllowedDomain(usuario.email) ? 'Sí · por dominio' : 'No',
    tokens,
    costoDisplay: formatearCostoAdminUsd(costUsd?.toString() ?? null),
    proyectosCount,
  };
}
