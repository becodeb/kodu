import { useState } from 'react';

interface Props {
  modelos: string[];
}

/**
 * `/admin/trazas` (odd/tasks/ahorro-tokens.md, T4): exportar el detalle por
 * turno de IA, anonimizado, para que el dueño lo pueda mandar afuera y ver
 * cómo se usa la app en la práctica real. Un rango de fechas y dos filtros
 * opcionales (plan, motor); dos descargas (JSON/CSV) — nunca una tabla en
 * pantalla, esto es para exportar, no para mirar fila por fila acá.
 */
export default function TrazasPanel({ modelos }: Props) {
  const hoy = new Date().toISOString().slice(0, 10);
  const haceUnMes = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [desde, setDesde] = useState(haceUnMes);
  const [hasta, setHasta] = useState(hoy);
  const [plan, setPlan] = useState('');
  const [modelo, setModelo] = useState('');

  function urlExport(formato: 'csv' | 'json'): string {
    const params = new URLSearchParams();
    if (desde) params.set('desde', new Date(desde).toISOString());
    if (hasta) params.set('hasta', new Date(`${hasta}T23:59:59.999Z`).toISOString());
    if (plan) params.set('plan', plan);
    if (modelo) params.set('model', modelo);
    return `/api/admin/trazas.${formato}?${params.toString()}`;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-ink-900">Trazas de turnos de IA</h2>
        <p className="mt-1 text-sm text-ink-500">
          El export está anonimizado (docentes y organizaciones quedan como un pseudónimo estable, nunca su email ni
          su nombre) e incluye lo que cada docente le pidió a la IA en texto.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-linea bg-superficie p-4">
        <label className="flex flex-col gap-1 text-sm text-ink-700">
          Desde
          <input
            type="date"
            value={desde}
            onChange={(event) => setDesde(event.target.value)}
            className="rounded-lg border border-linea bg-superficie px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-700">
          Hasta
          <input
            type="date"
            value={hasta}
            onChange={(event) => setHasta(event.target.value)}
            className="rounded-lg border border-linea bg-superficie px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-700">
          Plan
          <select
            value={plan}
            onChange={(event) => setPlan(event.target.value)}
            className="rounded-lg border border-linea bg-superficie px-2 py-1"
          >
            <option value="">Todos</option>
            <option value="FREE">Gratis</option>
            <option value="INDIVIDUAL">Individual pago</option>
            <option value="ORG">Organización</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-700">
          Motor
          <select
            value={modelo}
            onChange={(event) => setModelo(event.target.value)}
            className="rounded-lg border border-linea bg-superficie px-2 py-1"
          >
            <option value="">Todos</option>
            {modelos.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex gap-3">
        <a href={urlExport('csv')} className="kodu-btn-ghost px-4 py-2 text-sm">
          Descargar CSV
        </a>
        <a href={urlExport('json')} className="kodu-btn-ghost px-4 py-2 text-sm">
          Descargar JSON
        </a>
      </div>
    </div>
  );
}
