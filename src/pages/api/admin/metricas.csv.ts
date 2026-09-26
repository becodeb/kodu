import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/auth/guards.ts';
import { fail } from '../../../lib/http.ts';
import { metricasDelMes, type FilaMetricasOrganizacion } from '../../../lib/admin/metricas.ts';
import { mesActualBA, ultimosMeses } from '../../../lib/metricas/consumo.ts';

/**
 * `GET /api/admin/metricas.csv?mes=YYYY-MM` (odd/tasks/organizaciones.md T7):
 * una fila por organización (más "Sin organización" y "Total"), NÚMEROS
 * CRUDOS con punto decimal — a propósito, no el "≥ US$ 1,23" que muestra la
 * página: quien abre esto en una planilla quiere sumar y filtrar, no leer un
 * piso ya redondeado. La incertidumbre de un costo con filas sin precio se
 * lleva a una columna aparte ("Filas sin precio"), nunca escondida adentro
 * del número.
 *
 * Explícitamente `requireAdmin` acá, aunque el middleware YA lo exige en
 * todo `/api/admin/**`: es una descarga de datos (no una pantalla que un
 * DOCENTE vería redirigida antes de llegar), así que se lo confirma dos
 * veces por las dudas, mismo espíritu que `gestion.ts` vuelve a confirmar
 * "es superadmin" aunque el middleware ya filtró.
 */

function celdaCsv(valor: string | number): string {
  const texto = String(valor);
  if (/[",\n]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

function filaCsv(valores: Array<string | number>): string {
  return valores.map(celdaCsv).join(',');
}

const ENCABEZADO = [
  'Organización',
  'Tipo',
  'Docentes hoy',
  'Docentes activos',
  'Recursos nuevos',
  'Ajustes',
  'Turnos',
  'Tokens',
  'Tokens cacheados',
  'Costo USD (piso)',
  'Filas sin precio',
  'Costo promedio por recurso nuevo',
  'Costo promedio por ajuste',
  'Costo por docente activo',
];

const ETIQUETA_TIPO: Record<FilaMetricasOrganizacion['tipo'], string> = {
  NETWORK: 'Red',
  CAMPUS: 'Sede',
  SIN_ORGANIZACION: 'Sin organización',
};

function filaADatos(fila: FilaMetricasOrganizacion): Array<string | number> {
  const a = fila.agregado;
  return [
    fila.nivel === 1 ? `  ${fila.nombre}` : fila.nombre,
    fila.nombre === 'Total' ? 'Total' : ETIQUETA_TIPO[fila.tipo],
    fila.docentesHoy,
    a.docentesActivos,
    a.recursosNuevos,
    a.ajustes,
    a.turnos,
    a.tokens,
    a.tokensCacheados,
    a.costoTotal.suma.toString(),
    a.costoTotal.filasSinPrecio,
    a.costoPromedioRecursoNuevo.promedio?.toString() ?? '',
    a.costoPromedioAjuste.promedio?.toString() ?? '',
    a.costoPorDocenteActivo.promedio?.toString() ?? '',
  ];
}

export const GET: APIRoute = async ({ url, locals }) => {
  const actor = requireAdmin(locals);
  if (actor instanceof Response) return actor;

  const mesesDisponibles = ultimosMeses(12);
  const mesPedido = url.searchParams.get('mes');
  const mes = mesPedido && mesesDisponibles.includes(mesPedido) ? mesPedido : mesActualBA();
  if (mesPedido && !mesesDisponibles.includes(mesPedido)) {
    return fail('Mes inválido: usá el formato YYYY-MM, dentro de los últimos 12 meses.', 422);
  }

  const datos = await metricasDelMes(mes);
  const filas = [...datos.filas, datos.total];

  const lineas = [filaCsv(ENCABEZADO), ...filas.map((fila) => filaCsv(filaADatos(fila)))];
  const csv = `${lineas.join('\r\n')}\r\n`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kodu-metricas-${mes}.csv"`,
    },
  });
};
