import { useState } from 'react';
import { apiRequest } from '../../lib/client/api.ts';
import { formatearCostoUsd } from '../../lib/format/costo.ts';
import type { ResumenUso, FilaUsoPorClave } from '../../lib/admin/uso.ts';

interface Props {
  initial: ResumenUso;
}

function usd(valor: number | null): string {
  return formatearCostoUsd(valor);
}

function pct(valor: number | null): string {
  if (valor === null) return '—';
  return `${Math.round(valor * 1000) / 10}%`;
}

function seg(valor: number | null): string {
  if (valor === null) return '—';
  return `${Math.round(valor)} s`;
}

function num(valor: number | null): string {
  if (valor === null) return '—';
  return valor.toLocaleString('es-AR', { maximumFractionDigits: 1 });
}

function fechaInput(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * `/admin/uso` (T11, motor-claude): lo que de verdad se usa — crédito, costo
 * y tiempo por modo/modelo, y comportamiento docente — dentro de un rango
 * (default: el ciclo de facturación vigente). Mismo patrón de isla que
 * `GeneracionPanel.tsx` (estado inicial del server, refresco por
 * `apiRequest`); las tablas usan `overflow-x-auto` en vez de un layout de
 * tarjetas aparte para celular (deliberado — "keep it simple" de la tarea,
 * son muchas columnas por tabla para duplicar en dos layouts cada una).
 */
export default function UsoPanel({ initial }: Props) {
  const [resumen, setResumen] = useState(initial);
  const [desde, setDesde] = useState(fechaInput(initial.rango.desdeIso));
  const [hasta, setHasta] = useState(fechaInput(initial.rango.hastaIso));
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryString = `desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`;

  async function aplicarRango() {
    setCargando(true);
    setError(null);
    const result = await apiRequest<{ resumen: ResumenUso }>(`/api/admin/uso.json?${queryString}`, 'GET');
    setCargando(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setResumen(result.data.resumen);
  }

  const credito = resumen.credito;
  const sobraCredito = credito.gastoCicloUsd >= credito.monthlyCreditUsd;
  const maxGastoDia = Math.max(...credito.gastoPorDia.map((p) => p.gastoUsd), 0.0001);

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-ink-900">Uso real</h2>
          <p className="mt-1 text-sm text-ink-500">
            Crédito, costo, tiempo, y cómo interactúan los docentes — {new Date(resumen.rango.desdeIso).toLocaleDateString('es-AR')} a{' '}
            {new Date(resumen.rango.hastaIso).toLocaleDateString('es-AR')}.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="kodu-label text-xs" htmlFor="uso-desde">
              Desde
            </label>
            <input id="uso-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="kodu-input" />
          </div>
          <div>
            <label className="kodu-label text-xs" htmlFor="uso-hasta">
              Hasta
            </label>
            <input id="uso-hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="kodu-input" />
          </div>
          <button type="button" className="kodu-btn-secondary text-sm" disabled={cargando} onClick={() => void aplicarRango()}>
            {cargando ? 'Cargando…' : 'Ver'}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <a href={`/api/admin/uso.json?${queryString}`} className="kodu-btn-secondary text-sm">
          Descargar JSON
        </a>
        <a href={`/api/admin/uso.csv?${queryString}`} className="kodu-btn-secondary text-sm">
          Descargar CSV
        </a>
      </div>

      {/* Crédito */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink-900">Crédito</h3>
        <div className={`kodu-card space-y-2 p-4 text-sm ${sobraCredito ? 'border-red-300 bg-red-50 text-red-800' : ''}`}>
          <p>
            Gastado este ciclo: <strong>{usd(credito.gastoCicloUsd)}</strong> de {usd(credito.monthlyCreditUsd)} · tope premium:{' '}
            {usd(credito.premiumUntilUsd)} · modo efectivo: <strong>{credito.modoEfectivo}</strong> · proyección al cierre:{' '}
            {usd(credito.proyeccionCierreUsd)}
          </p>
          <p className="text-xs text-ink-500">
            Ciclo: {new Date(credito.inicioIso).toLocaleDateString('es-AR')} a {new Date(credito.finIso).toLocaleDateString('es-AR')}.
          </p>
        </div>

        {credito.gastoPorDia.length > 0 && (
          <div className="kodu-card space-y-1 p-4">
            <p className="mb-2 text-xs font-medium text-ink-500 uppercase">Gasto por día (ciclo vigente)</p>
            <div className="space-y-1">
              {credito.gastoPorDia.map((punto) => (
                <div key={punto.fecha} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-ink-500">{punto.fecha.slice(5)}</span>
                  <div className="h-3 flex-1 rounded bg-sutil">
                    <div
                      className="h-3 rounded bg-brand-600"
                      style={{ width: `${Math.max((punto.gastoUsd / maxGastoDia) * 100, punto.gastoUsd > 0 ? 2 : 0)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-ink-700">{usd(punto.gastoUsd)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <TablaPorClave titulo="Por modo" filas={resumen.porModo} />
      <TablaPorClave titulo="Por modelo" filas={resumen.porModelo} />

      {/* Docentes */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink-900">Comportamiento docente</h3>
        <div className="kodu-card grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-3">
          <Metrica etiqueta="Docentes activos" valor={String(resumen.docentes.activos)} />
          <Metrica etiqueta="Recursos por docente (media)" valor={num(resumen.docentes.recursosCreadosPorDocenteMedia)} />
          <Metrica etiqueta="Ajustes por recurso (media)" valor={num(resumen.docentes.ajustesPorRecursoMedia)} />
          <Metrica etiqueta="Ajustes por recurso (p90)" valor={num(resumen.docentes.ajustesPorRecursoP90)} />
          <Metrica etiqueta="% recursos publicados" valor={pct(resumen.docentes.porcentajePublicados)} />
          <Metrica etiqueta="Señales de deshacer" valor={String(resumen.docentes.señalesDeshacer)} />
          <Metrica
            etiqueta="Caritas"
            valor={`${resumen.docentes.caritas.GOOD} buenas · ${resumen.docentes.caritas.NEUTRAL} neutras · ${resumen.docentes.caritas.BAD} malas`}
          />
          <Metrica etiqueta="Comentarios de feedback" valor={String(resumen.docentes.comentariosDeFeedback)} />
          <Metrica etiqueta="Sesión media (aprox.)" valor={resumen.docentes.duracionSesionMediaMin === null ? '—' : `${Math.round(resumen.docentes.duracionSesionMediaMin)} min`} />
        </div>
        <p className="text-xs text-ink-500">
          "Sesión media" es una aproximación (lapso entre el primer y el último turno de cada docente en cada día, cuando hubo más de uno) — no hay
          seguimiento de sesión real.
        </p>
      </section>

      {/* ¿Sobra crédito? */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink-900">¿Sobra crédito?</h3>
        <div className="kodu-card space-y-2 p-4 text-sm">
          <p>
            A este ritmo, se proyecta gastar <strong>{usd(resumen.sobraCredito.proyeccionCierreUsd)}</strong> este ciclo, contra{' '}
            {usd(credito.monthlyCreditUsd)} de crédito ({usd(resumen.sobraCredito.creditoRestanteUsd)} restante hoy).{' '}
            {resumen.sobraCredito.sobra ? 'Sobra crédito a este ritmo.' : 'No sobra crédito a este ritmo — ojo con subir de modo.'}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-linea text-xs tracking-wide text-ink-500 uppercase">
                  <th className="py-1.5 pr-3 font-medium">Modo</th>
                  <th className="py-1.5 px-3 text-right font-medium">Costo mensual estimado</th>
                  <th className="py-1.5 pl-3 font-medium">Fuente</th>
                </tr>
              </thead>
              <tbody>
                {resumen.sobraCredito.sugerencias.map((s) => (
                  <tr key={s.modo} className="border-b border-linea">
                    <td className="py-1.5 pr-3">{s.etiqueta}</td>
                    <td className="py-1.5 px-3 text-right">{usd(s.costoMensualEstimadoUsd)}</td>
                    <td className="py-1.5 pl-3 text-xs text-ink-500">{s.fuente === 'medido' ? 'medido en este rango' : 'constante del código'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function Metrica({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="text-xs text-ink-500">{etiqueta}</p>
      <p className="font-medium text-ink-900">{valor}</p>
    </div>
  );
}

function TablaPorClave({ titulo, filas }: { titulo: string; filas: FilaUsoPorClave[] }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-ink-900">{titulo}</h3>
      <div className="kodu-card overflow-x-auto p-4">
        {filas.length === 0 ? (
          <p className="text-sm text-ink-500">Sin turnos en este rango.</p>
        ) : (
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead>
              <tr className="border-b border-linea text-xs tracking-wide text-ink-500 uppercase">
                <th className="py-1.5 pr-3 font-medium">{titulo === 'Por modo' ? 'Modo' : 'Modelo'}</th>
                <th className="py-1.5 px-3 text-right font-medium">Turnos</th>
                <th className="py-1.5 px-3 text-right font-medium">Costo total</th>
                <th className="py-1.5 px-3 text-right font-medium">USD/creación</th>
                <th className="py-1.5 px-3 text-right font-medium">USD/ajuste</th>
                <th className="py-1.5 px-3 text-right font-medium">USD/recurso</th>
                <th className="py-1.5 px-3 text-right font-medium">Mediana creación</th>
                <th className="py-1.5 px-3 text-right font-medium">P90 creación</th>
                <th className="py-1.5 px-3 text-right font-medium">Mediana ajuste</th>
                <th className="py-1.5 px-3 text-right font-medium">Tasa corrección</th>
                <th className="py-1.5 px-3 text-right font-medium">Falla edición</th>
                <th className="py-1.5 px-3 text-right font-medium">Bandera roja</th>
                <th className="py-1.5 px-3 text-right font-medium">Tasa arreglo</th>
                <th className="py-1.5 pl-3 text-right font-medium">Fallos honestos</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((fila) => (
                <tr key={fila.clave} className="border-b border-linea">
                  <td className="py-1.5 pr-3 font-medium text-ink-900">{fila.etiqueta}</td>
                  <td className="py-1.5 px-3 text-right">{fila.turnos}</td>
                  <td className="py-1.5 px-3 text-right">{usd(fila.costoTotalUsd)}</td>
                  <td className="py-1.5 px-3 text-right">{usd(fila.costoPorCreacionUsd)}</td>
                  <td className="py-1.5 px-3 text-right">{usd(fila.costoPorAjusteUsd)}</td>
                  <td className="py-1.5 px-3 text-right">{usd(fila.costoPorRecursoUsd)}</td>
                  <td className="py-1.5 px-3 text-right">{seg(fila.segundosMedianaCreacion)}</td>
                  <td className="py-1.5 px-3 text-right">{seg(fila.segundosP90Creacion)}</td>
                  <td className="py-1.5 px-3 text-right">{seg(fila.segundosMedianaAjuste)}</td>
                  <td className="py-1.5 px-3 text-right">{pct(fila.tasaCorreccion)}</td>
                  <td className="py-1.5 px-3 text-right">{pct(fila.tasaFallaEdicion)}</td>
                  <td className="py-1.5 px-3 text-right">{pct(fila.tasaBanderaRoja)}</td>
                  <td className="py-1.5 px-3 text-right">{pct(fila.tasaArreglo)}</td>
                  <td className="py-1.5 pl-3 text-right">{fila.mensajesFalloHonesto}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
