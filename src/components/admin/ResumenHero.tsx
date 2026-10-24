import { useEffect, useMemo, useRef, useState } from 'react';
import { formatearTokensCompacto } from '../../lib/format/tokens.ts';

/**
 * odd/tasks/admin-ui-redesign.md (T02): el héroe de `/admin` — la fila de
 * KPIs + el gráfico de los últimos 30 días, como UN SOLO componente
 * `client:load`. Van juntos a propósito (frontend-design: "a single
 * orchestrated moment lands better than scattered effects"): si cada pieza
 * hidratara por separado, cada una entraría en un instante distinto según
 * cuándo termine de montarse, y dejaría de leerse como una sola entrada.
 *
 * El gráfico es SVG a mano, igual criterio que `GraficoColumnas.tsx`: un
 * solo color de marca (brand-600), nunca una librería. A diferencia de esos
 * (estáticos, sin `client:*`), este necesita estado de React: el toggle de
 * serie, el tooltip por foco/hover, y la entrada orquestada — así que sí
 * hidrata.
 */

export interface KpisResumenProps {
  docentesTotal: number;
  docentesActivos7: number;
  docentesActivos30: number;
  recursosTotal: number;
  recursosCreados30: number;
  publicadosEnGaleria: number;
  tokens30: number;
  costo30Display: string;
  deltaCosto30: { porcentaje: number | null; subio: boolean | null };
}

export interface PuntoDiaProps {
  fecha: string;
  tokens: number;
  costoUsd: number;
  costoEsPiso: boolean;
  docentesActivos: number;
}

interface Props {
  kpis: KpisResumenProps;
  porDia: PuntoDiaProps[];
}

type Serie = 'tokens' | 'costo' | 'docentes';

const ANCHO = 760;
const ALTO = 220;
const AREA_TOP = 28;
const AREA_ALTO = 140;
const AREA_BOTTOM = AREA_TOP + AREA_ALTO;

function formatearFecha(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-AR', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  });
}

function formatearCosto(valor: number, esPiso: boolean): string {
  const texto = `US$ ${valor.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return esPiso ? `≥ ${texto}` : texto;
}

function prefiereMenosMovimiento(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Cuenta de 0 al valor final en ~900ms (ease-out), o salta directo si el
 *  visitante pidió menos movimiento. */
function useContador(valorFinal: number, activar: boolean): number {
  const [valor, setValor] = useState(activar ? 0 : valorFinal);
  useEffect(() => {
    if (!activar) {
      setValor(valorFinal);
      return;
    }
    if (prefiereMenosMovimiento()) {
      setValor(valorFinal);
      return;
    }
    let cancelado = false;
    const inicio = performance.now();
    const duracionMs = 900;
    function paso(ahora: number) {
      if (cancelado) return;
      const t = Math.min(1, (ahora - inicio) / duracionMs);
      const avance = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValor(Math.round(valorFinal * avance));
      if (t < 1) requestAnimationFrame(paso);
    }
    const id = requestAnimationFrame(paso);
    return () => {
      cancelado = true;
      void id;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valorFinal, activar]);
  return valor;
}

interface KpiTileProps {
  href: string;
  etiqueta: string;
  valor: number;
  sufijo?: string;
  secundario?: string;
  activar: boolean;
}

function KpiTile({ href, etiqueta, valor, sufijo, secundario, activar }: KpiTileProps) {
  const contado = useContador(valor, activar);
  return (
    <a
      href={href}
      className="admin-entra kodu-card flex flex-col gap-0.5 px-4 py-3 transition-colors hover:border-ink-500"
    >
      <span className="text-xs text-ink-500">{etiqueta}</span>
      <span className="font-display text-2xl text-ink-900 tabular-nums">
        {contado.toLocaleString('es-AR')}
        {sufijo && <span className="ml-1 text-sm font-normal text-ink-500">{sufijo}</span>}
      </span>
      {secundario && <span className="text-xs text-ink-500">{secundario}</span>}
    </a>
  );
}

const SERIES: { clave: Serie; etiqueta: string }[] = [
  { clave: 'tokens', etiqueta: 'Tokens' },
  { clave: 'costo', etiqueta: 'Costo' },
  { clave: 'docentes', etiqueta: 'Docentes activos' },
];

export default function ResumenHero({ kpis, porDia }: Props) {
  const [serie, setSerie] = useState<Serie>('tokens');
  const [activo, setActivo] = useState<number | null>(null);
  const [entrado, setEntrado] = useState(false);
  const huboDatos = porDia.some((dia) => dia.tokens > 0);

  useEffect(() => {
    // Un solo disparo, en el próximo frame: así el navegador ya pintó el
    // estado "en reposo" (barras en 0) antes de animar hacia el final, en
    // vez de que la primera pintura ya llegue con todo dibujado.
    const id = requestAnimationFrame(() => setEntrado(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const valores = useMemo(
    () =>
      porDia.map((dia) => {
        if (serie === 'tokens') return dia.tokens;
        if (serie === 'costo') return dia.costoUsd;
        return dia.docentesActivos;
      }),
    [porDia, serie],
  );
  const max = Math.max(...valores, 0);
  const n = porDia.length;
  const paso = ANCHO / n;
  const anchoBarra = Math.max(paso - 6, 1);

  const etiquetaValor = (indice: number): string => {
    const dia = porDia[indice]!;
    if (serie === 'tokens') return `${dia.tokens.toLocaleString('es-AR')} tokens`;
    if (serie === 'costo') return formatearCosto(dia.costoUsd, dia.costoEsPiso);
    return `${dia.docentesActivos} ${dia.docentesActivos === 1 ? 'docente activo' : 'docentes activos'}`;
  };

  const diaActivo = activo !== null ? porDia[activo] : null;

  return (
    <section>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile href="/admin/usuarios" etiqueta="Docentes" valor={kpis.docentesTotal} activar={entrado} />
        <KpiTile
          href="/admin/usuarios"
          etiqueta="Activos (30 días)"
          valor={kpis.docentesActivos30}
          secundario={`${kpis.docentesActivos7} en los últimos 7`}
          activar={entrado}
        />
        <KpiTile href="/admin/proyectos" etiqueta="Recursos" valor={kpis.recursosTotal} activar={entrado} />
        <KpiTile href="/admin/proyectos" etiqueta="Creados (30 días)" valor={kpis.recursosCreados30} activar={entrado} />
        <KpiTile href="/gallery" etiqueta="En la galería" valor={kpis.publicadosEnGaleria} activar={entrado} />
        <a
          href="/admin/uso"
          className="admin-entra kodu-card flex flex-col gap-0.5 px-4 py-3 transition-colors hover:border-ink-500"
        >
          <span className="text-xs text-ink-500">Costo (30 días)</span>
          <span className="font-display text-2xl text-ink-900 tabular-nums">{kpis.costo30Display}</span>
          <span className="text-xs text-ink-500">
            {kpis.deltaCosto30.porcentaje === null
              ? `${formatearTokensCompacto(kpis.tokens30)} tokens`
              : `${kpis.deltaCosto30.subio ? '↑' : '↓'} ${Math.abs(kpis.deltaCosto30.porcentaje).toFixed(0)}% vs. los 30 días previos`}
          </span>
        </a>
      </div>

      <div className="admin-entra-demorado kodu-card mt-6 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-ink-900">Últimos 30 días</h2>
            <p className="text-sm text-ink-500">Tocá o enfocá una columna para ver el día exacto.</p>
          </div>
          <div className="flex gap-0.5 rounded-lg bg-sutil p-0.5 text-sm" role="group" aria-label="Elegir serie del gráfico">
            {SERIES.map((opcion) => (
              <button
                key={opcion.clave}
                type="button"
                aria-pressed={serie === opcion.clave}
                onClick={() => setSerie(opcion.clave)}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  serie === opcion.clave ? 'bg-superficie text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
                }`}
              >
                {opcion.etiqueta}
              </button>
            ))}
          </div>
        </div>

        {!huboDatos ? (
          <p className="rounded-lg bg-sutil px-4 py-8 text-center text-sm text-ink-500">
            Todavía no hay consumo registrado en los últimos 30 días.
          </p>
        ) : (
          <div className="relative">
            <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} role="img" className="w-full" aria-label={`${SERIES.find((s) => s.clave === serie)!.etiqueta} por día, últimos 30 días`}>
              {max > 0 && (
                <line x1={0} y1={AREA_TOP} x2={ANCHO} y2={AREA_TOP} className="stroke-linea" strokeWidth={1} />
              )}
              {porDia.map((dia, indice) => {
                const valor = valores[indice]!;
                const alturaFinal = max > 0 ? (valor / max) * AREA_ALTO : 0;
                const altura = entrado || prefiereMenosMovimiento() ? alturaFinal : 0;
                const x = indice * paso + (paso - anchoBarra) / 2;
                const y = AREA_BOTTOM - altura;
                const esActivo = activo === indice;
                return (
                  <g key={dia.fecha}>
                    <rect
                      x={x}
                      y={y}
                      width={anchoBarra}
                      height={altura}
                      rx={3}
                      className="fill-brand-600 transition-[height,y]"
                      style={{ transitionDuration: '620ms', transitionTimingFunction: 'cubic-bezier(0.16,1,0.3,1)', transitionDelay: `${Math.min(indice * 10, 260)}ms` }}
                      fillOpacity={esActivo ? 1 : 0.85}
                    />
                    {/* Zona de interacción a todo el alto: más fácil de acertar con el mouse y el único foco tabulable por día (navegación con flechas = Tab normal). */}
                    <rect
                      x={indice * paso}
                      y={AREA_TOP}
                      width={paso}
                      height={AREA_ALTO}
                      fill="transparent"
                      tabIndex={0}
                      role="img"
                      aria-label={`${formatearFecha(dia.fecha)}: ${etiquetaValor(indice)}`}
                      onMouseEnter={() => setActivo(indice)}
                      onMouseLeave={() => setActivo(null)}
                      onFocus={() => setActivo(indice)}
                      onBlur={() => setActivo(null)}
                      className="outline-none focus-visible:fill-brand-600/10"
                    />
                  </g>
                );
              })}
              <text x={0} y={AREA_BOTTOM + 20} className="fill-ink-500 text-[11px]">
                {formatearFecha(porDia[0]!.fecha)}
              </text>
              <text x={ANCHO} y={AREA_BOTTOM + 20} textAnchor="end" className="fill-ink-500 text-[11px]">
                {formatearFecha(porDia[n - 1]!.fecha)}
              </text>
            </svg>

            {diaActivo && (
              <div
                className="pointer-events-none absolute top-0 rounded-lg border border-linea bg-superficie px-3 py-2 text-xs shadow-lg"
                style={{ left: `${Math.min(92, Math.max(0, (activo! / n) * 100))}%` }}
              >
                <p className="font-medium text-ink-900">{formatearFecha(diaActivo.fecha)}</p>
                <p className="text-ink-500">{etiquetaValor(activo!)}</p>
              </div>
            )}
          </div>
        )}

        <table className="sr-only">
          <caption>Serie diaria de los últimos 30 días</caption>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tokens</th>
              <th>Costo (USD)</th>
              <th>Docentes activos</th>
            </tr>
          </thead>
          <tbody>
            {porDia.map((dia) => (
              <tr key={dia.fecha}>
                <td>{dia.fecha}</td>
                <td>{dia.tokens}</td>
                <td>{dia.costoUsd}</td>
                <td>{dia.docentesActivos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
