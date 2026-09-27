import { prisma } from '../db.ts';
import {
  agregarConsumo,
  agruparPorOrganizacion,
  agruparPorUsuario,
  cargarFilasConsumoDelMes,
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
