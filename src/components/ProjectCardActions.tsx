import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/client/api.ts';

interface ProjectCardActionsProps {
  projectId: string;
  title: string;
}

/**
 * Borrar un recurso propio, con la confirmación adentro del propio botón.
 *
 * En reposo es sólo un tacho. Al pasar por encima se ensancha y muestra
 * "Borrar": el gesto de acercarse ya explica qué va a pasar, sin robarle una
 * fila entera a la tarjeta ni abrir un `confirm()` del navegador.
 *
 * Crece hacia la IZQUIERDA porque está anclado al borde derecho: si se abriera
 * hacia el otro lado empujaría la tarjeta y todo se movería al pasar el mouse.
 *
 * El primer clic arma, el segundo confirma. Así un roce no borra nada, y el que
 * quiere borrar lo hace con dos toques sin cambiar de contexto.
 */
export default function ProjectCardActions({ projectId, title }: ProjectCardActionsProps) {
  const [armado, setArmado] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);

  // Si el docente se va a otra parte, el botón se desarma solo: dejarlo cargado
  // es dejar una trampa.
  useEffect(() => {
    if (!armado) return;

    function afuera(event: MouseEvent) {
      if (!contenedor.current?.contains(event.target as Node)) setArmado(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') setArmado(false);
    }

    const timer = window.setTimeout(() => setArmado(false), 4_000);
    document.addEventListener('click', afuera);
    document.addEventListener('keydown', escape);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('click', afuera);
      document.removeEventListener('keydown', escape);
    };
  }, [armado]);

  async function borrar() {
    if (!armado) {
      setArmado(true);
      return;
    }

    setPending(true);
    const result = await apiRequest(`/api/projects/${projectId}`, 'DELETE');

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      setArmado(false);
      return;
    }

    window.location.reload();
  }

  const etiqueta = pending ? 'Borrando' : armado ? '¿Seguro?' : 'Borrar';

  return (
    <div ref={contenedor} className="flex items-center justify-end gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}

      <button
        type="button"
        onClick={borrar}
        disabled={pending}
        aria-label={`Borrar ${title}`}
        className={`group/borrar flex h-8 items-center justify-end overflow-hidden rounded-full transition-all duration-200 ease-out disabled:opacity-60 ${
          armado
            ? 'w-[6.5rem] bg-red-600 text-white'
            : 'w-8 bg-red-50 text-red-600 hover:w-[6rem] hover:bg-red-100'
        }`}
      >
        {/* El texto ocupa lugar sólo cuando el botón ya se ensanchó, así no
            asoma a medio camino ni fuerza el ancho antes de tiempo. */}
        <span
          className={`overflow-hidden text-xs font-semibold whitespace-nowrap transition-all duration-200 ${
            armado ? 'max-w-[4.5rem] pl-3 opacity-100' : 'max-w-0 opacity-0 group-hover/borrar:max-w-[4rem] group-hover/borrar:pl-3 group-hover/borrar:opacity-100'
          }`}
        >
          {etiqueta}
        </span>

        <span className="grid h-8 w-8 shrink-0 place-items-center">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2.5 4h11M6.5 4V2.75c0-.41.34-.75.75-.75h1.5c.41 0 .75.34.75.75V4M12.5 4l-.6 8.4a1.25 1.25 0 0 1-1.25 1.1H5.35a1.25 1.25 0 0 1-1.25-1.1L3.5 4M6.75 6.75v4M9.25 6.75v4"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
    </div>
  );
}
