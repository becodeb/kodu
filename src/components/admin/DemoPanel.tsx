import { useState, type FormEvent } from 'react';
import { apiRequest } from '../../lib/client/api.ts';
import Interruptor from './Interruptor.tsx';
import type { ResumenDemo } from '../../lib/admin/demo.ts';

interface Props {
  initial: ResumenDemo;
}

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * `/admin/demo` (design.md §8; specs/demo-mode/spec.md).
 *
 * El interruptor y el tope viven en `AppSettings`, mutados vía
 * `/api/admin/settings`. El resto de la fila es sólo lectura del estado
 * actual de la cuenta compartida — no hay nada más que configurar acá: la
 * cuenta se crea sola la primera vez que se prende el interruptor.
 */
export default function DemoPanel({ initial }: Props) {
  const [resumen, setResumen] = useState(initial);
  const [tope, setTope] = useState(String(initial.demoTokenLimit));
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardandoToggle, setGuardandoToggle] = useState(false);
  const [guardandoTope, setGuardandoTope] = useState(false);
  const [reiniciando, setReiniciando] = useState(false);
  const [confirmandoPurga, setConfirmandoPurga] = useState(false);
  const [purgando, setPurgando] = useState(false);

  async function alternarDemo(activar: boolean) {
    setError(null);
    setAviso(null);
    setGuardandoToggle(true);
    const result = await apiRequest<{ settings: { demoEnabled: boolean } }>('/api/admin/settings', 'PATCH', {
      demoEnabled: activar,
    });
    setGuardandoToggle(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setResumen((actual) => ({
      ...actual,
      demoEnabled: result.data.settings.demoEnabled,
      cuentaExiste: activar || actual.cuentaExiste,
    }));
  }

  async function guardarTope(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setAviso(null);

    const numero = Number(tope);
    if (!Number.isFinite(numero) || numero <= 0) {
      setError('El tope tiene que ser un número mayor a cero.');
      return;
    }

    setGuardandoTope(true);
    const result = await apiRequest<{ settings: { demoTokenLimit: number } }>('/api/admin/settings', 'PATCH', {
      demoTokenLimit: Math.round(numero),
    });
    setGuardandoTope(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setResumen((actual) => ({ ...actual, demoTokenLimit: result.data.settings.demoTokenLimit }));
    setAviso('Tope guardado.');
  }

  async function reiniciarCiclo() {
    setError(null);
    setAviso(null);
    setReiniciando(true);
    const result = await apiRequest<{ settings: { demoCycleStartedAt: string } }>(
      '/api/admin/demo/reiniciar',
      'POST',
    );
    setReiniciando(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setResumen((actual) => ({
      ...actual,
      demoCycleStartedAt: result.data.settings.demoCycleStartedAt,
      consumoTokens: 0,
    }));
    setAviso('Ronda reiniciada: el tope vuelve a contar desde ahora.');
  }

  async function purgar() {
    setError(null);
    setAviso(null);
    setPurgando(true);
    const result = await apiRequest<{ cantidadBorrada: number }>('/api/admin/demo/recursos', 'DELETE');
    setPurgando(false);
    setConfirmandoPurga(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setResumen((actual) => ({ ...actual, cantidadRecursos: 0 }));
    setAviso(`Se borraron ${result.data.cantidadBorrada} recursos de la demo.`);
  }

  return (
    <div className="max-w-2xl space-y-6">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {aviso && (
        <p role="status" className="rounded-lg bg-sutil px-3 py-2 text-sm text-ink-700">
          {aviso}
        </p>
      )}

      <div className="kodu-card space-y-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-medium text-ink-900">Demo pública</p>
            <p className="mt-0.5 text-sm text-ink-500">
              {resumen.demoEnabled
                ? 'Prendida: /login muestra la entrada discreta a la demo, y la cuenta compartida puede usar la IA.'
                : 'Apagada: no hay ninguna entrada visible en /login, y la cuenta de demo no puede usar la IA en su próximo pedido.'}
            </p>
          </div>
          <Interruptor
            id="demo-toggle"
            checked={resumen.demoEnabled}
            disabled={guardandoToggle}
            onChange={(valor) => void alternarDemo(valor)}
            label="Demo pública"
            srOnly
          />
        </div>

        {resumen.cuentaExiste && (
          <dl className="grid grid-cols-2 gap-4 border-t border-linea pt-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-ink-500 uppercase">Consumo de la ronda</dt>
              <dd className="mt-1 tabular-nums text-ink-900">
                {resumen.consumoTokens.toLocaleString('es-AR')} / {resumen.demoTokenLimit.toLocaleString('es-AR')}{' '}
                tokens
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500 uppercase">Ronda empezó</dt>
              <dd className="mt-1 text-ink-900">{formatearFecha(resumen.demoCycleStartedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500 uppercase">Recursos de la demo</dt>
              <dd className="mt-1 tabular-nums text-ink-900">{resumen.cantidadRecursos.toLocaleString('es-AR')}</dd>
            </div>
          </dl>
        )}
      </div>

      <form onSubmit={guardarTope} className="kodu-card flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="kodu-label" htmlFor="tope">
            Tope de tokens por ronda
          </label>
          <input
            id="tope"
            type="number"
            min={1}
            step={1}
            disabled={guardandoTope}
            value={tope}
            onChange={(event) => setTope(event.target.value)}
            className="kodu-input"
          />
        </div>
        <button type="submit" disabled={guardandoTope} className="kodu-btn-primary shrink-0">
          Guardar tope
        </button>
      </form>

      <div className="kodu-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-ink-900">Reiniciar la ronda</p>
          <p className="mt-0.5 text-sm text-ink-500">
            Vuelve a habilitar el tope sin borrar nada de lo que la demo ya generó.
          </p>
        </div>
        <button
          type="button"
          disabled={reiniciando || !resumen.cuentaExiste}
          onClick={() => void reiniciarCiclo()}
          className="kodu-btn-ghost shrink-0"
        >
          Reiniciar ronda
        </button>
      </div>

      <div className="kodu-card space-y-3 border border-red-200 p-4">
        <div>
          <p className="font-medium text-ink-900">Purgar recursos de la demo</p>
          <p className="mt-0.5 text-sm text-ink-500">
            Borra los {resumen.cantidadRecursos} recursos publicados por la cuenta compartida de demo. Los
            recursos de docentes reales nunca se tocan. Esta acción no se puede deshacer.
          </p>
        </div>

        {!confirmandoPurga ? (
          <button
            type="button"
            disabled={resumen.cantidadRecursos === 0 || purgando}
            onClick={() => setConfirmandoPurga(true)}
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Purgar recursos de la demo
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-red-700">
              ¿Seguro? Se van a borrar {resumen.cantidadRecursos} recursos, sin vuelta atrás.
            </p>
            <button
              type="button"
              disabled={purgando}
              onClick={() => void purgar()}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
            >
              Sí, borrar
            </button>
            <button
              type="button"
              disabled={purgando}
              onClick={() => setConfirmandoPurga(false)}
              className="kodu-btn-ghost px-3 py-1.5 text-sm"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
