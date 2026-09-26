import { prisma } from '../db.ts';
import {
  agregarConsumo,
  agruparPorOrganizacion,
  cargarFilasConsumoDelMes,
  docentesHoyPorOrganizacion,
  docentesHoySinOrganizacion,
  etiquetaMes,
  ultimosMeses,
  type AgregadoConsumo,
  type FilaConsumoCruda,
  type PromedioConDudas,
  type SumaUsd,
} from '../metricas/consumo.ts';
import { formatearCostoUsd } from '../format/costo.ts';

/**
 * odd/tasks/organizaciones.md (T7): forma de "por organización y mes" lista
 * para `/admin/metricas` — arma el árbol (redes con sus sedes, colegios
 * sueltos, "Sin organización", Total) sobre `src/lib/metricas/consumo.ts`,
 * que hace la cuenta pero no sabe nada de tablas ni de árboles.
 *
 * `/admin/metricas.astro` es SIN `client:*` (como `usuarios/[id].astro`):
 * el selector de mes es un `<form method="get">` normal, el detalle por
 * organización es un `<details>` nativo, y el único componente de React
 * (`TendenciaMetricas.tsx`) es SVG estático — no hay ningún estado que
 * justifique hidratar nada. Igual borde que `src/lib/admin/usuarios.ts`:
 * todo lo que sale de acá para el `.astro` ya está resuelto a
 * `string`/`number` donde puede hacer falta (un `Prisma.Decimal` nunca
 * debería cruzar hacia una isla, aunque acá no haya ninguna).
 */

/** Español de cada `UsagePurpose`, en el orden fijo de `consumo.ts`; `null` =
 *  "Sin clasificar" (histórico, de antes de T1). */
export const ETIQUETA_PROPOSITO: Record<string, string> = {
  GENERATION: 'Generación',
  ADJUSTMENT: 'Ajuste',
  CHECKLIST: 'Checklist',
  CORRECTION: 'Corrección',
  VERIFICATION: 'Verificación',
  EXTRA_VERSION: 'Versión extra',
};

export interface FilaMetricasOrganizacion {
  /** `null` para "Sin organización" — nunca se linkea a `/admin/organizaciones/[id]`. */
  id: string | null;
  nombre: string;
  tipo: 'NETWORK' | 'CAMPUS' | 'SIN_ORGANIZACION';
  /** Para la indentación: una sede de una red va a nivel 1. */
  nivel: 0 | 1;
  /** El costo congelado de una organización archivada sigue contando — sólo
   *  se pierde el acceso a la IA (T6), nunca el historial. Se muestra para
   *  que no sorprenda ver costo en una fila que ya no administra nadie. */
  archivada: boolean;
  docentesHoy: number;
  agregado: AgregadoConsumo;
}

export interface MetricasDelMes {
  mes: string;
  etiquetaMes: string;
  filas: FilaMetricasOrganizacion[];
  total: FilaMetricasOrganizacion;
}

/** El árbol completo de métricas para un mes — `/admin/metricas` (T7, superadmin-only). */
export async function metricasDelMes(mes: string): Promise<MetricasDelMes> {
  const [organizaciones, filasDelMes] = await Promise.all([
    prisma.organization.findMany({
      select: { id: true, name: true, kind: true, parentId: true, archivedAt: true },
      orderBy: { name: 'asc' },
    }),
    cargarFilasConsumoDelMes(mes, null),
  ]);

  const porOrganizacion = agruparPorOrganizacion(filasDelMes);
  const campusIds = organizaciones.filter((org) => org.kind === 'CAMPUS').map((org) => org.id);
  const [docentesHoyCampus, docentesHoySinOrg] = await Promise.all([
    docentesHoyPorOrganizacion(campusIds),
    docentesHoySinOrganizacion(),
  ]);

  const redes = organizaciones.filter((org) => org.kind === 'NETWORK');
  const standalone = organizaciones.filter((org) => org.kind === 'CAMPUS' && org.parentId === null);

  const filas: FilaMetricasOrganizacion[] = [];

  for (const red of redes) {
    const sedes = organizaciones.filter((org) => org.kind === 'CAMPUS' && org.parentId === red.id);
    const filasDeLaRed: FilaConsumoCruda[] = sedes.flatMap((sede) => porOrganizacion.get(sede.id) ?? []);
    const docentesHoyRed = sedes.reduce((suma, sede) => suma + (docentesHoyCampus.get(sede.id) ?? 0), 0);

    filas.push({
      id: red.id,
      nombre: red.name,
      tipo: 'NETWORK',
      nivel: 0,
      archivada: red.archivedAt !== null,
      docentesHoy: docentesHoyRed,
      agregado: agregarConsumo(filasDeLaRed),
    });

    for (const sede of sedes) {
      filas.push({
        id: sede.id,
        nombre: sede.name,
        tipo: 'CAMPUS',
        nivel: 1,
        archivada: sede.archivedAt !== null,
        docentesHoy: docentesHoyCampus.get(sede.id) ?? 0,
        agregado: agregarConsumo(porOrganizacion.get(sede.id) ?? []),
      });
    }
  }

  for (const campus of standalone) {
    filas.push({
      id: campus.id,
      nombre: campus.name,
      tipo: 'CAMPUS',
      nivel: 0,
      archivada: campus.archivedAt !== null,
      docentesHoy: docentesHoyCampus.get(campus.id) ?? 0,
      agregado: agregarConsumo(porOrganizacion.get(campus.id) ?? []),
    });
  }

  filas.push({
    id: null,
    nombre: 'Sin organización',
    tipo: 'SIN_ORGANIZACION',
    nivel: 0,
    archivada: false,
    docentesHoy: docentesHoySinOrg,
    agregado: agregarConsumo(porOrganizacion.get(null) ?? []),
  });

  const total: FilaMetricasOrganizacion = {
    id: null,
    nombre: 'Total',
    tipo: 'SIN_ORGANIZACION',
    nivel: 0,
    archivada: false,
    docentesHoy: campusIds.reduce((suma, id) => suma + (docentesHoyCampus.get(id) ?? 0), 0) + docentesHoySinOrg,
    agregado: agregarConsumo(filasDelMes),
  };

  return { mes, etiquetaMes: etiquetaMes(mes), filas, total };
}

/** Los últimos `cantidad` meses (6 por defecto) para el gráfico de
 *  tendencia: costo total y docentes activos, orden cronológico ascendente. */
export interface PuntoTendencia {
  mes: string;
  etiquetaMes: string;
  /** `null` si alguna fila del mes no tiene precio conocido — mismo criterio todo-o-nada. */
  costoUsd: number | null;
  docentesActivos: number;
}

export async function tendenciaMensual(mesReferencia: string, cantidad = 6): Promise<PuntoTendencia[]> {
  const meses = ultimosMeses(cantidad, mesReferencia);
  return Promise.all(
    meses.map(async (mes) => {
      const filas = await cargarFilasConsumoDelMes(mes, null);
      const agregado = agregarConsumo(filas);
      return {
        mes,
        etiquetaMes: etiquetaMes(mes),
        costoUsd: agregado.costoTotal.filasSinPrecio > 0 ? null : Number(agregado.costoTotal.suma.toString()),
        docentesActivos: agregado.docentesActivos,
      };
    }),
  );
}

/**
 * `SumaUsd`/`PromedioConDudas` (`consumo.ts`) → texto, mismo prefijo "≥" que
 * pide T7: una suma o un promedio con alguna fila sin precio conocido NUNCA
 * se muestra como si fuera exacta.
 */
export function formatearSumaUsd(suma: SumaUsd): string {
  const base = formatearCostoUsd(suma.suma.toString());
  return suma.filasSinPrecio > 0 ? `≥ ${base}` : base;
}

export function formatearPromedio(promedio: PromedioConDudas): string {
  if (promedio.promedio === null) return '—';
  const base = formatearCostoUsd(promedio.promedio.toString());
  return promedio.filasSinPrecio > 0 ? `≥ ${base}` : base;
}
