import { formatearTokensCompacto } from '../../lib/format/tokens.ts';

interface FilaModelo {
  etiqueta: string;
  tokens: number;
  /** Ya formateado por el caller: "≈ US$ 1,24" | "US$ 0,00" | "— histórico". */
  costoDisplay: string;
}

interface Props {
  /** Ordenadas de mayor a menor `tokens` (así viene `consumoPorUsuario`). */
  filas: FilaModelo[];
}

const ANCHO = 700;
const ALTO_BARRA = 28;

/** Cicla los tres colores que pide design.md, aunque haya más de tres motores. */
const PALETA = ['fill-brand-600', 'fill-brand-300', 'fill-brand-100'];

/**
 * "En qué motor se fue" (design.md — "The user detail view"). Responde: ¿qué
 * motor hace el trabajo, y cuál genera la factura? Suelen ser motores
 * distintos acá (el principal es gratuito, el de respaldo se paga), por eso
 * una sola barra lleva las dos cifras. Se rechazó una torta: dos o cuatro
 * porciones donde una tiene el 95% es ilegible, y la leyenda ocupa más lugar
 * que las barras.
 *
 * Igual que `GraficoColumnas`: SVG estático, sin `client:*`, tooltip nativo.
 * `filas` vacío → no se llega a renderizar; el caller muestra la frase
 * "Todavía no usó la IA." en su lugar. Un solo motor produce una barra a
 * todo el ancho — el mismo código, sin rama especial.
 */
export default function GraficoBarras({ filas }: Props) {
  if (filas.length === 0) return null;

  const total = filas.reduce((suma, fila) => suma + fila.tokens, 0);
  let acumulado = 0;

  return (
    <figure>
      <svg viewBox={`0 0 ${ANCHO} ${ALTO_BARRA}`} role="img" className="w-full">
        <title>
          {`En qué motor se fue el consumo: ${filas.map((fila) => `${fila.etiqueta}, ${fila.tokens.toLocaleString('es-AR')} tokens`).join('; ')}.`}
        </title>
        {filas.map((fila, indice) => {
          const ancho = total > 0 ? (fila.tokens / total) * ANCHO : 0;
          const x = acumulado;
          acumulado += ancho;
          return (
            <rect
              key={fila.etiqueta}
              x={x}
              y={0}
              width={ancho}
              height={ALTO_BARRA}
              rx={indice === 0 || indice === filas.length - 1 ? 4 : 0}
              className={PALETA[indice % PALETA.length]}
            >
              <title>{`${fila.etiqueta}: ${fila.tokens.toLocaleString('es-AR')} tokens, ${fila.costoDisplay}`}</title>
            </rect>
          );
        })}
      </svg>

      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {filas.map((fila, indice) => (
          <li key={fila.etiqueta} className="flex items-center gap-2 text-xs text-ink-700">
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${PALETA[indice % PALETA.length]}`}
            />
            <span className="font-medium text-ink-900">{fila.etiqueta}</span>
            <span className="text-ink-500">
              {formatearTokensCompacto(fila.tokens)} tokens · {fila.costoDisplay}
            </span>
          </li>
        ))}
      </ul>

      <table className="sr-only">
        <caption>En qué motor se fue el consumo</caption>
        <thead>
          <tr>
            <th>Motor</th>
            <th>Tokens</th>
            <th>Costo</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <tr key={fila.etiqueta}>
              <td>{fila.etiqueta}</td>
              <td>{fila.tokens}</td>
              <td>{fila.costoDisplay}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
