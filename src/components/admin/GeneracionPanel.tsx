import { useState } from 'react';
import { apiRequest } from '../../lib/client/api.ts';
import Interruptor from './Interruptor.tsx';
import type { ResumenGeneracion } from '../../lib/admin/generacion.ts';

interface Props {
  initial: ResumenGeneracion;
}

/**
 * `/admin/generacion` (odd/tasks/generacion-simple-y-reanudable.md, T1): tras
 * sacar el modo de calidad discreto y los interruptores nunca medidos con ganancia
 * real (velocidad elegible, revisión automática "para todos", motores
 * exclusivos), sólo queda este interruptor — permite que los docentes
 * activen "3 versiones" en sus propios proyectos (T2, opt-in por proyecto).
 */
export default function GeneracionPanel({ initial }: Props) {
  const [resumen, setResumen] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardarVersionesForAll(valor: boolean) {
    setError(null);
    setGuardando(true);
    const anterior = resumen.versionsForAll;
    setResumen({ ...resumen, versionsForAll: valor });

    const result = await apiRequest<{ settings: { versionsForAll: boolean } }>('/api/admin/settings', 'PATCH', {
      versionsForAll: valor,
    });

    setGuardando(false);
    if (!result.ok) {
      setResumen({ ...resumen, versionsForAll: anterior });
      setError(result.error);
    }
  }

  async function guardarFragmentEditsEnabled(valor: boolean) {
    setError(null);
    setGuardando(true);
    const anterior = resumen.fragmentEditsEnabled;
    setResumen({ ...resumen, fragmentEditsEnabled: valor });

    const result = await apiRequest<{ settings: { fragmentEditsEnabled: boolean } }>('/api/admin/settings', 'PATCH', {
      fragmentEditsEnabled: valor,
    });

    setGuardando(false);
    if (!result.ok) {
      setResumen({ ...resumen, fragmentEditsEnabled: anterior });
      setError(result.error);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <section className="space-y-4">
        <div className="kodu-card divide-y divide-linea">
          <div className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium text-ink-900">Varias versiones al crear</p>
              <p className="mt-0.5 text-sm text-ink-500">
                Permitir que los docentes activen 3 versiones en sus proyectos. Triplica el costo
                de cada generación en los proyectos donde lo activan, y todavía no está medido.
              </p>
            </div>
            <Interruptor
              id="versions-toggle"
              checked={resumen.versionsForAll}
              disabled={guardando}
              onChange={(valor) => void guardarVersionesForAll(valor)}
              label="Varias versiones para todos"
              srOnly
            />
          </div>
        </div>

        <div className="kodu-card divide-y divide-linea">
          <div className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium text-ink-900">Edición por fragmentos en ajustes</p>
              <p className="mt-0.5 text-sm text-ink-500">
                En vez de reescribir el documento entero en cada ajuste o corrección, el motor edita
                sólo lo que cambia. Reduce el costo de salida de un ajuste; medido en{' '}
                odd/tasks/ahorro-tokens.md (T3b) antes de activarlo para todos.
              </p>
            </div>
            <Interruptor
              id="fragment-edits-toggle"
              checked={resumen.fragmentEditsEnabled}
              disabled={guardando}
              onChange={(valor) => void guardarFragmentEditsEnabled(valor)}
              label="Edición por fragmentos"
              srOnly
            />
          </div>
        </div>

        <p className="text-xs text-ink-500">
          La cuenta demo sigue con su propio tope de tokens (configurable en{' '}
          <a href="/admin/demo" className="text-brand-600 hover:underline">
            /admin/demo
          </a>
          ), sin nada extra.
        </p>
      </section>
    </div>
  );
}
