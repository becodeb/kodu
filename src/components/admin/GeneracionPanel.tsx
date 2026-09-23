import { useState } from 'react';
import { apiRequest } from '../../lib/client/api.ts';
import Interruptor from './Interruptor.tsx';
import type { CuentaMarcada, ResumenGeneracion } from '../../lib/admin/generacion.ts';

interface Props {
  initial: ResumenGeneracion;
}

type CampoBooleano = 'primeEnabled' | 'autoReviewForAll' | 'deepModeForAll' | 'versionsForAll';

/**
 * `/admin/generacion` (T5, odd/tasks/modo-prime.md — "Modo prime y funciones
 * para todos").
 *
 * Dos secciones separadas a propósito, mismo espíritu que las decisiones del
 * dueño: "Modo prime" es la capa 2 (discreta, no encarece para nadie que no
 * la tenga); "Para todos" son los tres interruptores de la capa 1 que SÍ
 * multiplican el gasto de API si un admin los prende. Cada uno de esos tres
 * lleva su costo HONESTO en una línea — nunca "puede salir más caro", el
 * motivo concreto.
 */
export default function GeneracionPanel({ initial }: Props) {
  const [resumen, setResumen] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<CampoBooleano | null>(null);
  const [desmarcando, setDesmarcando] = useState<string | null>(null);

  async function guardarAjuste(campo: CampoBooleano, valor: boolean) {
    setError(null);
    setGuardando(campo);
    const anterior = resumen[campo];
    setResumen((actual) => ({ ...actual, [campo]: valor }));

    const result = await apiRequest<{ settings: Record<CampoBooleano, boolean> }>('/api/admin/settings', 'PATCH', {
      [campo]: valor,
    });

    setGuardando(null);
    if (!result.ok) {
      setResumen((actual) => ({ ...actual, [campo]: anterior }));
      setError(result.error);
    }
  }

  async function desmarcar(cuenta: CuentaMarcada) {
    setError(null);
    setDesmarcando(cuenta.id);

    const result = await apiRequest(`/api/admin/users/${cuenta.id}`, 'PATCH', { primeAccess: false });

    setDesmarcando(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setResumen((actual) => ({
      ...actual,
      cuentasMarcadas: actual.cuentasMarcadas.filter((item) => item.id !== cuenta.id),
    }));
  }

  return (
    <div className="max-w-2xl space-y-8">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <section className="space-y-4">
        <div>
          <h2 className="font-display text-lg text-ink-900">Modo prime</h2>
          <p className="mt-1 text-sm text-ink-500">
            Más calidad sin importar el costo, para demos importantes. Discreto: un docente sin
            prime no nota que existe.
          </p>
        </div>

        <div className="kodu-card space-y-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-ink-900">Interruptor general</p>
              <p className="mt-0.5 text-sm text-ink-500">
                {resumen.primeEnabled
                  ? 'Prendido: los admins, la cuenta demo y las cuentas marcadas abajo tienen prime.'
                  : 'Apagado: nadie tiene prime, aunque esté marcado o sea admin.'}
              </p>
            </div>
            <Interruptor
              id="prime-toggle"
              checked={resumen.primeEnabled}
              disabled={guardando === 'primeEnabled'}
              onChange={(valor) => void guardarAjuste('primeEnabled', valor)}
              label="Modo prime"
              srOnly
            />
          </div>

          <dl className="grid grid-cols-1 gap-3 border-t border-linea pt-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-ink-500 uppercase">Quién lo tiene</dt>
              <dd className="mt-1 text-ink-700">Admins, la cuenta demo, y las cuentas marcadas abajo.</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500 uppercase">Qué desbloquea</dt>
              <dd className="mt-1 text-ink-700">
                Elegir velocidad (Rápido / A fondo), pedir varias versiones al crear, y motores
                exclusivos de prime.
              </dd>
            </div>
          </dl>
        </div>

        <div className="kodu-card overflow-hidden">
          {resumen.cuentasMarcadas.length === 0 ? (
            <p className="p-4 text-sm text-ink-500">
              Todavía no marcaste ninguna cuenta. Marcá una desde su ficha en{' '}
              <a href="/admin/usuarios" className="text-brand-600 hover:underline">
                /admin/usuarios
              </a>
              .
            </p>
          ) : (
            <>
              <ul className="divide-y divide-linea">
                {resumen.cuentasMarcadas.map((cuenta) => (
                  <li key={cuenta.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="font-medium text-ink-900">{cuenta.name}</p>
                      <p className="text-xs text-ink-500">{cuenta.email}</p>
                    </div>
                    <button
                      type="button"
                      disabled={desmarcando === cuenta.id}
                      onClick={() => void desmarcar(cuenta)}
                      className="kodu-btn-ghost shrink-0 px-3 py-1.5 text-xs"
                    >
                      Desmarcar
                    </button>
                  </li>
                ))}
              </ul>
              <p className="border-t border-linea px-4 py-3 text-xs text-ink-500">
                Para marcar más cuentas, entrá a la ficha de cada docente en{' '}
                <a href="/admin/usuarios" className="text-brand-600 hover:underline">
                  /admin/usuarios
                </a>
                .
              </p>
            </>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="font-display text-lg text-ink-900">Para todos</h2>
          <p className="mt-1 text-sm text-ink-500">
            Lo que no encarece va para todos directamente, sin interruptor. Estos tres SÍ
            multiplican el gasto de API si los prendés — activalos a medida que haya más
            presupuesto.
          </p>
        </div>

        <div className="kodu-card divide-y divide-linea">
          <div className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium text-ink-900">Revisión automática</p>
              <p className="mt-0.5 text-sm text-ink-500">
                Suma una pasada extra de revisión en los turnos que la necesitan.
              </p>
            </div>
            <Interruptor
              id="auto-review-toggle"
              checked={resumen.autoReviewForAll}
              disabled={guardando === 'autoReviewForAll'}
              onChange={(valor) => void guardarAjuste('autoReviewForAll', valor)}
              label="Revisión automática para todos"
              srOnly
            />
          </div>

          <div className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium text-ink-900">Velocidad "A fondo"</p>
              <p className="mt-0.5 text-sm text-ink-500">
                Razona antes de escribir y revisa después: multiplica varias veces los tokens de
                un turno.
              </p>
            </div>
            <Interruptor
              id="deep-mode-toggle"
              checked={resumen.deepModeForAll}
              disabled={guardando === 'deepModeForAll'}
              onChange={(valor) => void guardarAjuste('deepModeForAll', valor)}
              label='"A fondo" para todos'
              srOnly
            />
          </div>

          <div className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium text-ink-900">Varias versiones al crear</p>
              <p className="mt-0.5 text-sm text-ink-500">
                Multiplica el primer turno por la cantidad de versiones pedidas.
              </p>
            </div>
            <Interruptor
              id="versions-toggle"
              checked={resumen.versionsForAll}
              disabled={guardando === 'versionsForAll'}
              onChange={(valor) => void guardarAjuste('versionsForAll', valor)}
              label="Varias versiones para todos"
              srOnly
            />
          </div>
        </div>

        <p className="text-xs text-ink-500">
          La cuenta demo sigue con su propio tope de tokens (configurable en{' '}
          <a href="/admin/demo" className="text-brand-600 hover:underline">
            /admin/demo
          </a>
          ), y con prime lo gasta más rápido.
        </p>
      </section>
    </div>
  );
}
