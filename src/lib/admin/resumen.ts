import { prisma } from '../db.ts';
import { Prisma } from '../../generated/prisma/client.ts';
import { formatearCostoAdminUsd } from '../format/costo.ts';

/**
 * odd/tasks/admin-ui-redesign.md (T02): agregaciones para el resumen de
 * `/admin` (reemplaza el redirect a `/admin/usuarios`). Sigue el mismo
 * criterio de borde que `lib/admin/usuarios.ts`/`metricas.ts`: todo lo que
 * sale de acá ya está resuelto a `string`/`number` — nunca un
 * `Prisma.Decimal` cruza hacia `GraficoResumen.tsx` (isla `client:load`).
 *
 * Mismo criterio que `lib/ai/usage.ts` (`consumoDiarioDeUsuario`): se trae
 * la ventana completa con `findMany` y se agrega A MANO con `Map`, en vez de
 * `groupBy`+`_sum` — un `_sum` ignora en silencio las filas `costUsd: NULL`
 * (motor sin precio cargado) y el total terminaría MINTIENDO por defecto en
 * vez de marcarse "sin precio". Son dos consultas de ventana (60 días de
 * `TokenUsage`, 30 de `Project.updatedAt`) + una por tabla chica
 * (`User`/`AiModel`) — nunca una consulta por fila ni por día.
 *
 * "Activo" = tuvo al menos un turno de IA O tocó un recurso en la ventana —
 * el mismo criterio que ya usa `listarUsuariosAdmin` para "Última
 * actividad". Excluye siempre a la cuenta de demo (`isDemo`), igual que esa
 * función.
 */

function inicioDelDia(fecha: Date): Date {
  const copia = new Date(fecha);
  copia.setUTCHours(0, 0, 0, 0);
  return copia;
}

function restarDias(fecha: Date, dias: number): Date {
  const copia = new Date(fecha);
  copia.setUTCDate(copia.getUTCDate() - dias);
  return copia;
}

interface SumaConPrecio {
  tokens: number;
  costUsd: Prisma.Decimal;
  sinPrecio: boolean;
}

function sumaVacia(): SumaConPrecio {
  return { tokens: 0, costUsd: new Prisma.Decimal(0), sinPrecio: false };
}

function sumarFila(
  acumulado: SumaConPrecio,
  fila: { promptTokens: number; completionTokens: number; costUsd: Prisma.Decimal | null },
): void {
  acumulado.tokens += fila.promptTokens + fila.completionTokens;
  if (fila.costUsd === null) acumulado.sinPrecio = true;
  else acumulado.costUsd = acumulado.costUsd.add(fila.costUsd);
}

/** "≈ US$ 1,24" | "US$ 0,00" | "—", el mismo formato que ve un admin en toda otra pantalla. */
function costoDisplay(suma: SumaConPrecio): string {
  return formatearCostoAdminUsd(suma.sinPrecio ? null : suma.costUsd.toString());
}

export interface KpiDelta {
  /** `null` = sin ventana previa para comparar (ej. la plataforma tiene menos de 60 días). */
  porcentaje: number | null;
  /** `true` = subió, `false` = bajó, `null` = sin cambio o sin dato. */
  subio: boolean | null;
}

/** `null` cuando cualquiera de las dos ventanas tiene una fila sin precio: el
 *  costo mostrado ya es "—" (`costoDisplay`), así que un "↑76%" calculado
 *  sobre una suma incompleta mentiría al lado de ese "—". */
function delta(actual: number, previo: number, sinPrecio: boolean): KpiDelta {
  if (sinPrecio) return { porcentaje: null, subio: null };
  if (previo === 0) return { porcentaje: null, subio: actual > 0 ? true : null };
  const porcentaje = ((actual - previo) / previo) * 100;
  return { porcentaje, subio: porcentaje === 0 ? null : porcentaje > 0 };
}

export interface KpisResumen {
  docentesTotal: number;
  docentesActivos7: number;
  docentesActivos30: number;
  recursosTotal: number;
  recursosCreados30: number;
  publicadosEnGaleria: number;
  tokens30: number;
  costo30Display: string;
  deltaCosto30: KpiDelta;
}

export interface PuntoDiaResumen {
  /** `YYYY-MM-DD`, UTC. */
  fecha: string;
  tokens: number;
  costoUsd: number;
  /** `true` si alguna fila del día no tenía precio — el costo de ese día es un piso, no un total. */
  costoEsPiso: boolean;
  docentesActivos: number;
}

export interface FilaTopDocente {
  id: string;
  nombre: string;
  tokens: number;
  costoDisplay: string;
}

export interface FilaMotorResumen {
  etiqueta: string;
  tokens: number;
  costoDisplay: string;
}

export interface RecursoReciente {
  id: string;
  titulo: string;
  creadoDisplay: string;
  propietarioId: string;
  propietarioNombre: string;
}

export interface ResumenAdmin {
  kpis: KpisResumen;
  porDia: PuntoDiaResumen[];
  topDocentes: FilaTopDocente[];
  porMotor: FilaMotorResumen[];
  recursosRecientes: RecursoReciente[];
}

export async function resumenAdmin(ahora: Date = new Date()): Promise<ResumenAdmin> {
  const hoy = inicioDelDia(ahora);
  const desde30 = restarDias(hoy, 29);
  const desde7 = restarDias(hoy, 6);
  const desde60 = restarDias(hoy, 59);

  const [
    docentesTotal,
    filasTokenUsage,
    actualizacionesProyecto,
    recursosTotal,
    recursosCreados30,
    publicadosEnGaleria,
    recursosRecientesRaw,
    modelos,
  ] = await Promise.all([
    prisma.user.count({ where: { isDemo: false } }),
    prisma.tokenUsage.findMany({
      where: { createdAt: { gte: desde60 }, user: { isDemo: false } },
      select: { userId: true, promptTokens: true, completionTokens: true, costUsd: true, createdAt: true, aiModelId: true },
    }),
    prisma.project.findMany({
      where: { updatedAt: { gte: desde30 }, user: { isDemo: false } },
      select: { userId: true, updatedAt: true },
    }),
    prisma.project.count({ where: { user: { isDemo: false } } }),
    prisma.project.count({ where: { user: { isDemo: false }, createdAt: { gte: desde30 } } }),
    prisma.project.count({ where: { user: { isDemo: false }, isInGallery: true } }),
    prisma.project.findMany({
      where: { user: { isDemo: false } },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { id: true, title: true, createdAt: true, userId: true, user: { select: { name: true } } },
    }),
    prisma.aiModel.findMany({ select: { id: true, displayName: true } }),
  ]);

  // ---------------------------------------------------------------------
  // Split de la ventana de 60 días en "actual" (últimos 30) y "previa" (los
  // 30 anteriores a esos), para el delta de costo — mismo truco que
  // `TendenciaMetricas`/`metricas.ts`, pero día a día en vez de mes a mes.
  // ---------------------------------------------------------------------
  const sumaActual = sumaVacia();
  const sumaPrevia = sumaVacia();
  const activosActual = new Set<string>();
  const activos7 = new Set<string>();
  const porModeloActual = new Map<string | null, SumaConPrecio>();
  const porUsuarioActual = new Map<string, SumaConPrecio>();

  const porDiaMapa = new Map<string, { tokens: number; costUsd: Prisma.Decimal; sinPrecio: boolean; activos: Set<string> }>();
  for (let i = 0; i < 30; i++) {
    const dia = restarDias(hoy, 29 - i).toISOString().slice(0, 10);
    porDiaMapa.set(dia, { tokens: 0, costUsd: new Prisma.Decimal(0), sinPrecio: false, activos: new Set() });
  }

  for (const fila of filasTokenUsage) {
    if (fila.createdAt >= desde30) {
      sumarFila(sumaActual, fila);
      activosActual.add(fila.userId);
      if (fila.createdAt >= desde7) activos7.add(fila.userId);

      const previoModelo = porModeloActual.get(fila.aiModelId) ?? sumaVacia();
      sumarFila(previoModelo, fila);
      porModeloActual.set(fila.aiModelId, previoModelo);

      const previoUsuario = porUsuarioActual.get(fila.userId) ?? sumaVacia();
      sumarFila(previoUsuario, fila);
      porUsuarioActual.set(fila.userId, previoUsuario);

      const clave = fila.createdAt.toISOString().slice(0, 10);
      const dia = porDiaMapa.get(clave);
      if (dia) {
        const tokens = fila.promptTokens + fila.completionTokens;
        dia.tokens += tokens;
        if (fila.costUsd === null) dia.sinPrecio = true;
        else dia.costUsd = dia.costUsd.add(fila.costUsd);
        dia.activos.add(fila.userId);
      }
    } else {
      sumarFila(sumaPrevia, fila);
    }
  }

  for (const actualizacion of actualizacionesProyecto) {
    activosActual.add(actualizacion.userId);
    if (actualizacion.updatedAt >= desde7) activos7.add(actualizacion.userId);
    const clave = actualizacion.updatedAt.toISOString().slice(0, 10);
    porDiaMapa.get(clave)?.activos.add(actualizacion.userId);
  }

  const porDia: PuntoDiaResumen[] = Array.from(porDiaMapa.entries()).map(([fecha, datos]) => ({
    fecha,
    tokens: datos.tokens,
    costoUsd: Number(datos.costUsd.toString()),
    costoEsPiso: datos.sinPrecio,
    docentesActivos: datos.activos.size,
  }));

  const nombrePorModeloId = new Map(modelos.map((modelo) => [modelo.id, modelo.displayName]));
  const porMotor: FilaMotorResumen[] = Array.from(porModeloActual.entries())
    .map(([aiModelId, suma]) => ({
      etiqueta: aiModelId === null ? 'Histórico' : nombrePorModeloId.get(aiModelId) ?? 'Motor eliminado',
      tokens: suma.tokens,
      costoDisplay: costoDisplay(suma),
      _tokens: suma.tokens,
    }))
    .sort((a, b) => b._tokens - a._tokens)
    .map(({ etiqueta, tokens, costoDisplay: costo }) => ({ etiqueta, tokens, costoDisplay: costo }));

  const topIds = Array.from(porUsuarioActual.entries())
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .slice(0, 5)
    .map(([userId]) => userId);
  const docentesTop = topIds.length
    ? await prisma.user.findMany({ where: { id: { in: topIds } }, select: { id: true, name: true } })
    : [];
  const nombrePorDocenteId = new Map(docentesTop.map((docente) => [docente.id, docente.name]));
  const topDocentes: FilaTopDocente[] = topIds.map((id) => {
    const suma = porUsuarioActual.get(id)!;
    return { id, nombre: nombrePorDocenteId.get(id) ?? 'Docente eliminado', tokens: suma.tokens, costoDisplay: costoDisplay(suma) };
  });

  const recursosRecientes: RecursoReciente[] = recursosRecientesRaw.map((proyecto) => ({
    id: proyecto.id,
    titulo: proyecto.title,
    creadoDisplay: proyecto.createdAt.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }),
    propietarioId: proyecto.userId,
    propietarioNombre: proyecto.user.name,
  }));

  const kpis: KpisResumen = {
    docentesTotal,
    docentesActivos7: activos7.size,
    docentesActivos30: activosActual.size,
    recursosTotal,
    recursosCreados30,
    publicadosEnGaleria,
    tokens30: sumaActual.tokens,
    costo30Display: costoDisplay(sumaActual),
    deltaCosto30: delta(
      Number(sumaActual.costUsd.toString()),
      Number(sumaPrevia.costUsd.toString()),
      sumaActual.sinPrecio || sumaPrevia.sinPrecio,
    ),
  };

  return { kpis, porDia, topDocentes, porMotor, recursosRecientes };
}
