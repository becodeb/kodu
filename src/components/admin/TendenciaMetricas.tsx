import { formatearCostoUsd } from '../../lib/format/costo.ts';

export interface PuntoTendenciaProps {
  etiquetaMes: string;
  /** Suma de los costos conocidos; un piso cuando `esPiso`. */
  costoUsd: number;
  /** Alguna fila del mes no tiene precio: se dibuja el piso con otro estilo y "≥". */
  esPiso: boolean;
  docentesActivos: number;
}

interface Props {
  /** Los últimos 6 meses, orden cronológico ascendente (el actual al final). */
  puntos: PuntoTendenciaProps[];
}

const ANCHO = 700;
const ALTO = 170;
const AREA_TOP = 20;
const AREA_ALTO = 104;
const AREA_BOTTOM = AREA_TOP + AREA_ALTO;

/**
 * "Costo total y docentes activos, últimos 6 meses" (odd/tasks/organizaciones.md
 * T7) — responde: ¿el gasto sube porque suben los docentes activos, o sube
 * por otra razón (más ajustes, un motor más caro)? Dos series sobre el
 * mismo eje X, cada una con su propia escala vertical (unidades distintas:
 * USD contra cantidad de personas) — comparar la FORMA de las dos curvas
 * importa acá, no el valor absoluto compartido de un eje.
 *
 * Mismo criterio de color que `GraficoBarras.tsx`: en tema oscuro
 * `global.css` redefine `brand-300` y `brand-600` con la MISMA luminosidad
 * (0.62), así que la segunda serie NO puede ser otro tono de la rampa de
 * marca — usa `carbon`, que `global.css` invierte a propósito entre temas
 * (negro sobre `superficie` clara, blanco sobre `superficie` oscura), así
 * que siempre contrasta contra las barras Y contra el fondo.
 *
 * Estático, sin `client:*` (igual que `GraficoColumnas`/`GraficoBarras`):
 * SVG servido por el propio `.astro`, tooltip nativo por `<title>`.
 */
export default function TendenciaMetricas({ puntos }: Props) {
  const maxCosto = Math.max(...puntos.map((p) => p.costoUsd), 0);
  const hayPisos = puntos.some((p) => p.esPiso);
  const textoCosto = (p: PuntoTendenciaProps) =>
    p.esPiso ? `≥ ${formatearCostoUsd(p.costoUsd)} (hay filas sin precio)` : formatearCostoUsd(p.costoUsd);
  const maxDocentes = Math.max(...puntos.map((p) => p.docentesActivos), 0);

  const n = puntos.length;
  const paso = ANCHO / n;
  const anchoBarra = Math.max(paso - 16, 1);

  const puntosLinea = puntos.map((punto, indice) => {
    const x = indice * paso + paso / 2;
    const y = maxDocentes > 0 ? AREA_BOTTOM - (punto.docentesActivos / maxDocentes) * AREA_ALTO : AREA_BOTTOM;
    return { x, y, punto };
  });

  return (
    <figure>
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} role="img" className="w-full">
        <title>
          {`Costo total y docentes activos, últimos ${n} meses: ${puntos
            .map(
              (p) =>
                `${p.etiquetaMes}, ${textoCosto(p)}, ${p.docentesActivos} docentes activos`,
            )
            .join('; ')}.`}
        </title>

        <line x1={0} y1={AREA_TOP} x2={ANCHO} y2={AREA_TOP} className="stroke-linea" strokeWidth={1} />
        <line x1={0} y1={AREA_BOTTOM} x2={ANCHO} y2={AREA_BOTTOM} className="stroke-linea" strokeWidth={1} />

        {/* Barras: costo total del mes. Un piso ("≥", falta algún precio) se
            dibuja con su altura conocida pero translúcido y con borde
            punteado, para que no se lea como exacto. */}
        {puntos.map((punto, indice) => {
          const x = indice * paso + (paso - anchoBarra) / 2;
          const altura = maxCosto > 0 ? (punto.costoUsd / maxCosto) * AREA_ALTO : 0;
          const y = AREA_BOTTOM - altura;
          return (
            <rect
              key={`barra-${punto.etiquetaMes}`}
              x={x}
              y={y}
              width={anchoBarra}
              height={altura}
              rx={2}
              className={punto.esPiso ? 'fill-brand-600 stroke-brand-600' : 'fill-brand-600'}
              fillOpacity={punto.esPiso ? 0.35 : 1}
              strokeDasharray={punto.esPiso ? '4 3' : undefined}
              strokeWidth={punto.esPiso ? 1.5 : 0}
            >
              <title>{`${punto.etiquetaMes}: ${textoCosto(punto)}`}</title>
            </rect>
          );
        })}

        {/* Línea: docentes activos del mes. */}
        <polyline
          points={puntosLinea.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          className="stroke-carbon"
          strokeWidth={2}
        />
        {puntosLinea.map(({ x, y, punto }) => (
          <circle key={`punto-${punto.etiquetaMes}`} cx={x} cy={y} r={3.5} className="fill-carbon">
            <title>{`${punto.etiquetaMes}: ${punto.docentesActivos} docentes activos`}</title>
          </circle>
        ))}

        {puntos.map((punto, indice) => (
          <text
            key={`fecha-${punto.etiquetaMes}`}
            x={indice * paso + paso / 2}
            y={AREA_BOTTOM + 18}
            textAnchor="middle"
            className="fill-ink-500 text-[10px]"
          >
            {punto.etiquetaMes.slice(0, 3)}
          </text>
        ))}
      </svg>

      <figcaption className="mt-2 flex flex-wrap items-center gap-4 text-xs text-ink-500">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-brand-600" /> Costo total
        </span>
        {hayPisos && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm border border-dashed border-brand-600 bg-brand-600/35" />{' '}
            Piso: hay filas sin precio
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-carbon" /> Docentes activos
        </span>
      </figcaption>

      {
        /* `table-layout: fixed` es necesario acá y no es redundante con
           `sr-only`: con el `table-layout: auto` por defecto, el ANCHO real
           de un <table> lo decide el contenido de sus celdas ("Docentes
           activos" es una cabecera larga) sin importar el `width: 1px` de
           `sr-only` — el elemento queda invisible pero su CAJA sigue tan
           ancha como pida el contenido, y ESA caja es la que desborda
           `document.documentElement.scrollWidth` a 360px (medido: sin este
           fix, 391px con esta tabla de 3 columnas; las de `GraficoColumnas`/
           `GraficoBarras`, de 2 columnas más angostas, no llegan a cruzar el
           umbral, por eso el bug no se veía ahí). */
      }
      <table className="sr-only" style={{ tableLayout: 'fixed' }}>
        <caption>Costo total y docentes activos, por mes</caption>
        <thead>
          <tr>
            <th>Mes</th>
            <th>Costo USD</th>
            <th>Docentes activos</th>
          </tr>
        </thead>
        <tbody>
          {puntos.map((punto) => (
            <tr key={punto.etiquetaMes}>
              <td>{punto.etiquetaMes}</td>
              <td>{textoCosto(punto)}</td>
              <td>{punto.docentesActivos}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
