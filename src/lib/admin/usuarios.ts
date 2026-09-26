import { prisma } from '../db.ts';
import { Prisma } from '../../generated/prisma/client.ts';
import { dominioAutorizado } from '../auth/domains.ts';
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
 * `accesoIa` ya refleja los tres estados de design.md desde que
 * `aiAccessOverride` tiene columna real (M6): `true` -> "Sí · permiso
 * individual", `false` -> "No" (revocado, sin importar el dominio), `null`
 * -> depende de `dominioAutorizado()`.
 */

function textoAccesoIa(aiAccessOverride: boolean | null, autorizadoPorDominio: boolean): string {
  if (aiAccessOverride === true) return 'Sí · permiso individual';
  if (aiAccessOverride === false) return 'No';
  return autorizadoPorDominio ? 'Sí · por dominio' : 'No';
}

/**
 * Versión de una sola fila de `textoAccesoIa`, para cuando sólo hace falta
 * recalcular UN usuario (ej. la respuesta de `PATCH /api/admin/users/:id`
 * después de tocar el override) y no vale la pena traer toda la tabla.
 */
export async function accesoIaDeUsuario(email: string, aiAccessOverride: boolean | null): Promise<string> {
  const autorizadoPorDominio = aiAccessOverride === null ? await dominioAutorizado(email) : false;
  return textoAccesoIa(aiAccessOverride, autorizadoPorDominio);
}

export interface FilaUsuarioAdmin {
  id: string;
  name: string;
  email: string;
  esGoogle: boolean;
  role: 'DOCENTE' | 'ADMIN';
  /** El permiso individual crudo: lo necesita el menú de la fila para saber qué ítems mostrar. */
  aiAccessOverride: boolean | null;
  /** "Sí · por dominio" | "Sí · permiso individual" | "No" — la razón, no sólo el veredicto. */
  accesoIa: string;
  proyectos: number;
  tokens: number;
  /** Ya formateado: "≈ US$ 1,24" | "US$ 0,00" | "—". */
  costoDisplay: string;
  ultimaActividad: string;
}

/**
 * La tabla completa de `/admin/usuarios`, ordenada alfabéticamente por
 * nombre. Excluye a la cuenta de demo (M7, design.md §8): no es un docente
 * real, tiene su propia página (`/admin/demo`) con su propio consumo y su
 * propio tope, y listarla acá al lado de docentes de verdad — con "Rol:
 * Docente" y un botón "Hacer administrador" que jamás debería tocarla —
 * confundiría la tabla en vez de aclararla.
 */
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

  // `dominioAutorizado()` tiene su propia caché de 10s (domains.ts), así que
  // esto no es N consultas a la base: la primera llamada la llena y el resto
  // de la tabla la reusa en memoria.
  const filas = await Promise.all(
    usuarios.map(async (usuario) => {
      const uso = usoPorUsuario.get(usuario.id);
      const proyectoInfo = proyectosMapa.get(usuario.id);

      const ultimaActividadFecha = [uso?.ultima, proyectoInfo?._max.updatedAt]
        .filter((fecha): fecha is Date => fecha != null)
        .sort((a, b) => b.getTime() - a.getTime())[0];

      const autorizadoPorDominio =
        usuario.aiAccessOverride === null ? await dominioAutorizado(usuario.email) : false;

      return {
        id: usuario.id,
        name: usuario.name,
        email: usuario.email,
        esGoogle: usuario.googleId !== null,
        role: usuario.role,
        aiAccessOverride: usuario.aiAccessOverride,
        accesoIa: textoAccesoIa(usuario.aiAccessOverride, autorizadoPorDominio),
        proyectos: proyectoInfo?._count._all ?? 0,
        tokens: uso?.tokens ?? 0,
        costoDisplay: formatearCostoAdminUsd(uso === undefined ? null : uso.sinPrecio ? null : uso.costUsd.toString()),
        ultimaActividad: haceTiempo(ultimaActividadFecha ?? null),
      };
    }),
  );

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
    },
  });
  if (!usuario || usuario.isDemo) return null;

  const [{ tokens, costUsd }, proyectosCount, autorizadoPorDominio] = await Promise.all([
    costoTotalDeUsuario(usuario.id),
    prisma.project.count({ where: { userId: usuario.id } }),
    usuario.aiAccessOverride === null ? dominioAutorizado(usuario.email) : Promise.resolve(false),
  ]);

  return {
    id: usuario.id,
    name: usuario.name,
    email: usuario.email,
    esGoogle: usuario.googleId !== null,
    role: usuario.role,
    creadoDisplay: `se sumó el ${fechaLarga(usuario.createdAt)}`,
    accesoIa: textoAccesoIa(usuario.aiAccessOverride, autorizadoPorDominio),
    tokens,
    costoDisplay: formatearCostoAdminUsd(costUsd?.toString() ?? null),
    proyectosCount,
  };
}
