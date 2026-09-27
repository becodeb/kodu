import { useState } from 'react';
import { apiRequest } from '../lib/client/api.ts';
import Modal from './workspace/Modal.tsx';
import { NOMBRE_TALLER } from '../lib/taller/prompt.ts';

/**
 * Botón "Nuevo recurso" del panel del docente.
 *
 * odd/tasks/taller-de-ideas.md: antes de crear, ofrece pensar la idea en el
 * Taller (recomendado) o ir directo al editor. El recurso recién se crea al
 * elegir "directo" — por el Taller se crea al final, con título y todo, así
 * no quedan borradores vacíos llamados "Nuevo Recurso".
 */
export default function NewProjectButton() {
  const [abierto, setAbierto] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crearDirecto() {
    setPending(true);
    setError(null);

    const result = await apiRequest<{ redirect: string }>('/api/projects', 'POST', {
      title: 'Nuevo Recurso',
    });

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }

    window.location.href = result.data.redirect;
  }

  return (
    <>
      <div className="text-right">
        <button type="button" onClick={() => setAbierto(true)} disabled={pending} className="kodu-btn-primary">
          {pending ? 'Creando…' : '+ Nuevo recurso'}
        </button>
      </div>

      {/* Afuera del div alineado a la derecha: si no, el modal hereda el
          text-right y el título queda corrido. */}

      <Modal
        abierto={abierto}
        titulo="¿Cómo querés empezar?"
        descripcion="Las dos llegan al mismo lugar: tu herramienta, lista para probar y compartir."
        onCerrar={() => setAbierto(false)}
      >
        {/* Botón y no link: el Modal pone el foco en el primer botón, y
            el recomendado tiene que ser el que queda enfocado. */}
        <button
          type="button"
          onClick={() => (window.location.href = '/app/taller')}
          className="block w-full rounded-xl border-2 border-brand-600 bg-brand-50 p-4 text-left transition-colors hover:bg-brand-100"
        >
          <span className="flex items-center gap-2">
            <span className="font-semibold text-ink-900">Pensar la idea primero</span>
            <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">Recomendado</span>
          </span>
          <span className="mt-1 block text-sm text-ink-700">
            En el {NOMBRE_TALLER}, Kodu te hace preguntas sobre tu clase, te ayuda a darle forma a la idea y arma el
            pedido completo por vos. Sirve tanto si tenés sólo el tema como si ya te imaginás la herramienta.
          </span>
        </button>

        <button
          type="button"
          onClick={() => void crearDirecto()}
          disabled={pending}
          className="block w-full rounded-xl border border-linea p-4 text-left transition-colors hover:border-ink-500 disabled:opacity-60"
        >
          <span className="font-semibold text-ink-900">{pending ? 'Creando…' : 'Ir directo a crear'}</span>
          <span className="mt-1 block text-sm text-ink-700">
            Si ya sabés exactamente lo que querés, escribíselo a Kodu y empezá a ver tu recurso enseguida.
          </span>
        </button>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </Modal>
    </>
  );
}
