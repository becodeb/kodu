import { prisma } from '../db.ts';
import {
  agregarConsumo,
  agruparPorOrganizacion,
  agruparPorUsuario,
  cargarFilasConsumoDelMes,
  docentesHoyPorOrganizacion,
  etiquetaMes,
  type AgregadoConsumo,
} from '../metricas/consumo.ts';

/**
 * odd/tasks/organizaciones.md (T8): "Consumo" de `/org` — mismo loader/misma
 * agregación PURA de T7 (`src/lib/metricas/consumo.ts`), acotados a las sedes
 * del ALCANCE de quien mira (nunca "Sin organización", nunca otra sede ajena
 * — eso ya lo filtra `cargarFilasConsumoDelMes(mes, campusIds)` al recibir un
 * array en vez de `null`).
 *
 * Dos vistas posibles, ambas construidas sobre las MISMAS filas crudas (un
 * solo `cargarFilasConsumoDelMes` por pedido, nunca dos):
 *  - Una sola sede (`campusIds` de largo 1): sólo `porDocente`, `porCampus`
 *    queda `null` — no tiene sentido desglosar por sede cuando sólo hay una.
 *  - Toda una red (`campusIds` = las sedes de la red): `porCampus` además
 *    del desglose por docente — y ahí un docente que se movió A MITAD DE MES
 *    aparece en DOS filas (una por cada sede en la que tuvo consumo ESE mes),
 *    porque `TokenUsage.organizationId` queda CONGELADO al momento de la
 *    llamada (T1, "costo congelado por organización") — el docente no es la
 *    unidad de agrupación acá, el PAR (docente, sede-en-la-que-pagó) sí.
 */

export interface FilaConsumoDocentePanel {
  userId: string;
  nombre: string;
  email: string;
  /** La sede CONGELADA de estas filas — nunca la sede ACTUAL del docente
   *  (que puede ya ser otra, ver el comentario de arriba). */
  organizationId: string;
  organizationNombre: string;
  agregado: AgregadoConsumo;
}

export interface FilaConsumoCampusPanel {
  organizationId: string;
  nombre: string;
  agregado: AgregadoConsumo;
}

export interface ConsumoDelPanel {
  mes: string;
  etiquetaMes: string;
  /** `null` cuando `campusIds.length <= 1` (una sola sede: no hay nada que desglosar). */
  porCampus: FilaConsumoCampusPanel[] | null;
  porDocente: FilaConsumoDocentePanel[];
  total: AgregadoConsumo;
}

/**
 * `campusIds`: SIEMPRE sedes concretas (CAMPUS), nunca la red misma — el
 * llamador (la página) ya resolvió "toda la red" a la lista de sus sedes.
 */
export async function consumoDelPanel(campusIds: string[], mes: string): Promise<ConsumoDelPanel> {
  if (campusIds.length === 0) {
    return { mes, etiquetaMes: etiquetaMes(mes), porCampus: null, porDocente: [], total: agregarConsumo([]) };
  }

  const [filas, organizaciones] = await Promise.all([
    cargarFilasConsumoDelMes(mes, campusIds),
    prisma.organization.findMany({ where: { id: { in: campusIds } }, select: { id: true, name: true } }),
  ]);
  const nombreOrg = new Map(organizaciones.map((org) => [org.id, org.name]));

  const porOrganizacion = agruparPorOrganizacion(filas);

  const porDocente: FilaConsumoDocentePanel[] = [];
  const userIdsNecesarios = new Set<string>();
  for (const campusId of campusIds) {
    const filasDeLaSede = porOrganizacion.get(campusId) ?? [];
    const porUsuario = agruparPorUsuario(filasDeLaSede);
    for (const [userId, filasDelUsuario] of porUsuario) {
      userIdsNecesarios.add(userId);
      porDocente.push({
        userId,
        nombre: '',
        email: '',
        organizationId: campusId,
        organizationNombre: nombreOrg.get(campusId) ?? '—',
        agregado: agregarConsumo(filasDelUsuario),
      });
    }
  }

  const usuarios =
    userIdsNecesarios.size > 0
      ? await prisma.user.findMany({ where: { id: { in: [...userIdsNecesarios] } }, select: { id: true, name: true, email: true } })
      : [];
  const usuarioMapa = new Map(usuarios.map((u) => [u.id, u]));
  for (const fila of porDocente) {
    const usuario = usuarioMapa.get(fila.userId);
    fila.nombre = usuario?.name ?? '(cuenta borrada)';
    fila.email = usuario?.email ?? '—';
  }
  porDocente.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const porCampus: FilaConsumoCampusPanel[] | null =
    campusIds.length > 1
      ? campusIds
          .map((campusId) => ({
            organizationId: campusId,
            nombre: nombreOrg.get(campusId) ?? '—',
            agregado: agregarConsumo(porOrganizacion.get(campusId) ?? []),
          }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      : null;

  return { mes, etiquetaMes: etiquetaMes(mes), porCampus, porDocente, total: agregarConsumo(filas) };
}

/**
 * "Docentes hoy" de las sedes del alcance (membresía ACTUAL, sin demo): el
 * denominador de "X de Y docentes usaron Kodu". Para una red es la suma de
 * sus sedes — un docente pertenece a UNA sola sede, así que no se cuenta dos
 * veces.
 */
export async function docentesDelPanel(campusIds: string[]): Promise<number> {
  const porOrganizacion = await docentesHoyPorOrganizacion(campusIds);
  let total = 0;
  for (const cantidad of porOrganizacion.values()) total += cantidad;
  return total;
}

export interface PuntoSerieDelPanel {
  mes: string;
  recursosNuevos: number;
  docentesActivos: number;
}

/**
 * Serie mensual (uno por mes de `meses`, en el orden recibido) de recursos
 * nuevos y docentes activos, acotada a `campusIds` igual que `consumoDelPanel`
 * (el filtro vive en `cargarFilasConsumoDelMes`, nunca ve otra organización).
 * Un docente que usó Kodu en dos sedes de la red el mismo mes cuenta UNA vez.
 */
export async function serieDelPanel(campusIds: string[], meses: string[]): Promise<PuntoSerieDelPanel[]> {
  if (campusIds.length === 0) {
    return meses.map((mes) => ({ mes, recursosNuevos: 0, docentesActivos: 0 }));
  }
  return Promise.all(
    meses.map(async (mes) => {
      const { recursosNuevos, docentesActivos } = agregarConsumo(await cargarFilasConsumoDelMes(mes, campusIds));
      return { mes, recursosNuevos, docentesActivos };
    }),
  );
}
