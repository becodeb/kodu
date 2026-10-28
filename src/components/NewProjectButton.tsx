import { useState } from 'react';
import { apiRequest } from '../lib/client/api.ts';
import Modal from './workspace/Modal.tsx';
import { NOMBRE_TALLER } from '../lib/taller/prompt.ts';
import { guardarPedidoDirecto } from '../lib/client/pedido-directo.ts';

/**
 * "Crear recurso": la acción principal de la barra y el ÚNICO punto de entrada
 * para crear en toda la app (antes había cuatro en Mis recursos: el link del
 * Taller en la barra, su tarjeta, este botón y el estado vacío).
 *
 * odd/tasks/taller-de-ideas.md: antes de crear, ofrece pensar la idea en el
 * Taller (recomendado) o escribir el pedido directo. El recurso recién se crea
 * al elegir "directo" — por el Taller se crea al final, con título y todo, así
 * no quedan borradores vacíos llamados "Nuevo Recurso".
 */
export default function NewProjectButton() {
  const [abierto, setAbierto] = useState(false);
  const [pending, setPending] = useState(false);
  const [pedido, setPedido] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function crearDirecto() {
    setPending(true);
    setError(null);

    const result = await apiRequest<{ redirect: string; project: { id: string } }>('/api/projects', 'POST', {
      title: 'Nuevo Recurso',
    });

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }

    // El editor lo manda solo al abrirse (Workspace.tsx), igual que el pedido
    // que llega del Taller: el docente no tiene que volver a escribirlo.
    if (pedido.trim()) guardarPedidoDirecto(result.data.project.id, pedido.trim());
    window.location.href = result.data.redirect;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        disabled={pending}
        aria-label="Crear recurso"
        className="kodu-cta max-sm:px-2.5 max-sm:py-2"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="max-sm:hidden">Crear recurso</span>
      </button>

      <Modal
        abierto={abierto}
        titulo="Crear un recurso"
        descripcion="Elegí cómo arrancar. Los dos caminos terminan en tu recurso, listo para probar y compartir."
        onCerrar={() => setAbierto(false)}
        ancho="ancho"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {/* La tarjeta recomendada se resalta, pero la acción es un botón de
              verdad abajo (como el de la otra opción): una tarjeta entera
              clickeable se leía como un cuadro de texto, no como algo para
              tocar. */}
          <div className="flex flex-col gap-3 rounded-2xl border-2 border-brand-600 bg-brand-50/50 p-5">
            <span className="flex items-center gap-2.5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
                </svg>
              </span>
              <span className="rounded-full bg-brand-600 px-2.5 py-1 text-xs font-bold text-white">Recomendado</span>
            </span>
            <span className="text-lg font-bold text-ink-900">Pensar la idea con Kodu</span>
            <span className="text-sm leading-relaxed text-ink-700">
              Te hace preguntas sobre tu clase, te propone ideas y arma el pedido completo por vos. Sirve aunque
              sólo tengas el tema.
            </span>
            {/* Primer botón del diálogo: el Modal le pone el foco al abrir, y
                tiene que ser el recomendado. */}
            <button
              type="button"
              onClick={() => (window.location.href = '/app/taller')}
              className="kodu-btn-primary mt-auto py-2.5"
            >
              Ir al {NOMBRE_TALLER}
            </button>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void crearDirecto();
            }}
            className="flex flex-col gap-3 rounded-2xl border border-linea p-5"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-sutil text-ink-700" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
              </svg>
            </span>
            <label htmlFor="pedido-directo" className="text-lg font-bold text-ink-900">
              Ya sé lo que quiero
            </label>
            <textarea
              id="pedido-directo"
              rows={4}
              value={pedido}
              onChange={(event) => setPedido(event.target.value)}
              placeholder="Escribilo acá y Kodu empieza a armarlo apenas entres al editor."
              className="kodu-input resize-none"
            />
            {/* Más callado que el del Taller: es el camino alternativo, no el
                recomendado. Mismo azul, pero sólo en el borde punteado. */}
            <button
              type="submit"
              disabled={pending}
              className="kodu-btn border-2 border-dashed border-brand-600 bg-transparent py-2.5 text-brand-700 hover:bg-brand-50/50"
            >
              {pending ? 'Creando…' : pedido.trim() ? 'Crear y abrir el editor' : 'Abrir el editor vacío'}
            </button>
          </form>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </Modal>
    </>
  );
}
