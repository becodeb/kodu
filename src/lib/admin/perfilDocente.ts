import { prisma } from '../db.ts';
import { obtenerUsuarioAdmin, type DetalleUsuarioAdmin } from './usuarios.ts';
import { consumoDiarioDeUsuario, consumoPorRecursoDeUsuario } from '../ai/usage.ts';
import { haceTiempo } from '../format/fecha.ts';

/**
 * odd/tasks/admin-ui-redesign.md (T04): agregaciones para la ficha de un
 * docente (`/admin/usuarios/[id]`). Reusa `obtenerUsuarioAdmin` para el
 * encabezado (mismos campos que ya mostraba T02/T03, nada reimplementado) y
 * agrega lo que la ficha nueva necesita: la fila de estadísticas con la
 * tendencia de 30 días, la grilla de recursos (con tokens por recurso para
 * poder ordenarla por consumo) y la última actividad.
 */

export interface RecursoPerfilDocente {
  id: string;
  title: string;
  updatedAtIso: string;
  updatedAtDisplay: string;
  isInGallery: boolean;
  likes: number;
  screenshotUrl: string | null;
  tokens: number;
}

export interface TendenciaTokens {
  actual: number;
  previo: number;
  /** `null` = sin ventana previa para comparar (docente con menos de 30 días
   *  de historia) — mismo criterio que `KpiDelta` en `admin/resumen.ts`. */
  porcentaje: number | null;
  subio: boolean | null;
}

function tendencia(actual: number, previo: number): TendenciaTokens {
  if (previo === 0) return { actual, previo, porcentaje: null, subio: actual > 0 ? true : null };
  const porcentaje = ((actual - previo) / previo) * 100;
  return { actual, previo, porcentaje, subio: porcentaje === 0 ? null : porcentaje > 0 };
}

export interface PerfilDocenteAdmin extends DetalleUsuarioAdmin {
  ultimaActividad: string;
  publicadosCount: number;
  tendenciaTokens30: TendenciaTokens;
  recursos: RecursoPerfilDocente[];
}

/** `null` si no existe, o si es la cuenta de demo (mismo criterio que
 *  `obtenerUsuarioAdmin`: esa cuenta no tiene ficha acá). */
export async function obtenerPerfilDocenteAdmin(id: string): Promise<PerfilDocenteAdmin | null> {
  const detalle = await obtenerUsuarioAdmin(id);
  if (!detalle) return null;

  const [proyectos, periodo60, tokensPorRecurso, ultimoTurno] = await Promise.all([
    prisma.project.findMany({
      where: { userId: id },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, updatedAt: true, isInGallery: true, screenshotUrl: true, _count: { select: { likes: true } } },
    }),
    // 60 días: los primeros 30 casilleros son la ventana PREVIA, los
    // últimos 30 la ACTUAL — evita una segunda consulta para el delta.
    consumoDiarioDeUsuario(id, 60),
    consumoPorRecursoDeUsuario(id),
    prisma.tokenUsage.findFirst({ where: { userId: id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);

  const tokensPorProyecto = new Map(tokensPorRecurso.filter((fila) => fila.projectId !== null).map((fila) => [fila.projectId!, fila.tokens]));

  const recursos: RecursoPerfilDocente[] = proyectos.map((proyecto) => ({
    id: proyecto.id,
    title: proyecto.title,
    updatedAtIso: proyecto.updatedAt.toISOString(),
    updatedAtDisplay: haceTiempo(proyecto.updatedAt),
    isInGallery: proyecto.isInGallery,
    likes: proyecto._count.likes,
    screenshotUrl: proyecto.screenshotUrl,
    tokens: tokensPorProyecto.get(proyecto.id) ?? 0,
  }));

  const tokensPrevios30 = periodo60.porDia.slice(0, 30).reduce((suma, dia) => suma + dia.tokens, 0);
  const tokensActual30 = periodo60.porDia.slice(30).reduce((suma, dia) => suma + dia.tokens, 0);

  const ultimaActividadFecha = [ultimoTurno?.createdAt, proyectos[0]?.updatedAt]
    .filter((fecha): fecha is Date => fecha != null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    ...detalle,
    ultimaActividad: haceTiempo(ultimaActividadFecha ?? null),
    publicadosCount: recursos.filter((recurso) => recurso.isInGallery).length,
    tendenciaTokens30: tendencia(tokensActual30, tokensPrevios30),
    recursos,
  };
}
