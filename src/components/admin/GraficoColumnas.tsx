import { formatearTokensCompacto } from '../../lib/format/tokens.ts';

interface DiaConsumo {
  /** `YYYY-MM-DD`. */
  fecha: string;
  tokens: number;
}

interface Props {
  /** La ventana completa (30 casilleros, uno por día, orden ascendente). */
  porDia: DiaConsumo[];
  /** Ya armado por el caller (`.astro`) — ver `usuarios/[id].astro`. */
  subtitulo: string;
}

const ANCHO = 700;
const ALTO = 160;
const AREA_TOP = 16;
const AREA_ALTO = 104;
const AREA_BOTTOM = AREA_TOP + AREA_ALTO;

function formatearFecha(iso: string, opciones: Intl.DateTimeFormatOptions): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-AR', { timeZone: 'UTC', ...opciones });
}

/**
 * "Consumo de los últimos 30 días" (design.md — "The user detail view").
 * Responde: ¿esta persona está usando cada vez más la IA, o la probó una
 * vez en marzo? Por eso son columnas y no una línea — una línea interpola
 * entre días y sugiere uso que no ocurrió.
 *
 * Renderizada SIN `client:*` desde el `.astro` que la usa: es puro SVG
 * estático, el tooltip nativo (`<title>`) no necesita JavaScript, así que no
 * hay ninguna razón para hidratarla ni para que cargue React en el cliente.
 *
 * Estados, todos explícitos (nunca un gráfico que parece roto):
 * - `porDia` vacío → no se llega a renderizar este componente; el caller
 *   muestra la frase "Todavía no usó la IA." en su lugar.
 * - Un solo día con datos dentro de la ventana → una sola columna, su fecha
 *   debajo, sin eje ni grilla (nada para comparar).
 * - Todo gratuito (tokens > 0, costo == 0) → se dibuja igual (las columnas
 *   son ALTURA DE TOKENS, no de dólares); el subtítulo lo aclara.
 */
export default function GraficoColumnas({ porDia, subtitulo }: Props) {
  if (porDia.length === 0) return null;

  const diasConDatos = porDia.filter((dia) => dia.tokens > 0);

  if (diasConDatos.length === 1) {
    const [unico] = diasConDatos;
    const anchoBarra = 80;
    const x = ANCHO / 2 - anchoBarra / 2;
    const alturaBarra = AREA_ALTO * 0.7;
    const y = AREA_BOTTOM - alturaBarra;
    const etiquetaFecha = formatearFecha(unico!.fecha, { day: 'numeric', month: 'long' });

    return (
      <figure>
        <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} role="img" className="w-full">
          <title>{`Consumo de los últimos 30 días: un solo día con actividad, ${etiquetaFecha}, ${unico!.tokens.toLocaleString('es-AR')} tokens.`}</title>
          <rect x={x} y={y} width={anchoBarra} height={alturaBarra} rx={4} className="fill-brand-600">
            <title>{`${etiquetaFecha}: ${unico!.tokens.toLocaleString('es-AR')} tokens`}</title>
          </rect>
          <text
            x={ANCHO / 2}
            y={y - 8}
            textAnchor="middle"
            className="fill-ink-700 text-[13px] font-medium"
          >
            {formatearTokensCompacto(unico!.tokens)}
          </text>
          <text
            x={ANCHO / 2}
            y={AREA_BOTTOM + 18}
            textAnchor="middle"
            className="fill-ink-500 text-[11px]"
          >
            {etiquetaFecha}
          </text>
        </svg>
        <figcaption className="mt-1 text-xs text-ink-500">{subtitulo}</figcaption>
        <table className="sr-only">
          <caption>Consumo de los últimos 30 días, por día</caption>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tokens</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{etiquetaFecha}</td>
              <td>{unico!.tokens}</td>
            </tr>
          </tbody>
        </table>
      </figure>
    );
  }

  const max = Math.max(...porDia.map((dia) => dia.tokens), 0);
  const n = porDia.length;
  const paso = ANCHO / n;
  const anchoBarra = Math.max(paso - 4, 1);

  return (
    <figure>
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} role="img" className="w-full">
        <title>{`Consumo de los últimos 30 días, columna por día. Máximo: ${formatearTokensCompacto(max)} tokens.`}</title>

        {max > 0 && (
          <>
            <line
              x1={0}
              y1={AREA_TOP}
              x2={ANCHO}
              y2={AREA_TOP}
              className="stroke-linea"
              strokeWidth={1}
            />
            <text x={0} y={AREA_TOP - 4} className="fill-ink-500 text-[10px]">
              {formatearTokensCompacto(max)}
            </text>
          </>
        )}

        {porDia.map((dia, indice) => {
          const alturaBarra = max > 0 ? (dia.tokens / max) * AREA_ALTO : 0;
          const x = indice * paso + 2;
          const y = AREA_BOTTOM - alturaBarra;
          return (
            <rect
              key={dia.fecha}
              x={x}
              y={y}
              width={anchoBarra}
              height={alturaBarra}
              className="fill-brand-600"
            >
              <title>{`${formatearFecha(dia.fecha, { day: 'numeric', month: 'short' })}: ${dia.tokens.toLocaleString('es-AR')} tokens`}</title>
            </rect>
          );
        })}

        <text x={0} y={AREA_BOTTOM + 18} className="fill-ink-500 text-[11px]">
          {formatearFecha(porDia[0]!.fecha, { day: 'numeric', month: 'short' })}
        </text>
        <text x={ANCHO} y={AREA_BOTTOM + 18} textAnchor="end" className="fill-ink-500 text-[11px]">
          {formatearFecha(porDia[n - 1]!.fecha, { day: 'numeric', month: 'short' })}
        </text>
      </svg>
      <figcaption className="mt-1 text-xs text-ink-500">{subtitulo}</figcaption>
      <table className="sr-only">
        <caption>Consumo de los últimos 30 días, por día</caption>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Tokens</th>
          </tr>
        </thead>
        <tbody>
          {porDia.map((dia) => (
            <tr key={dia.fecha}>
              <td>{dia.fecha}</td>
              <td>{dia.tokens}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
