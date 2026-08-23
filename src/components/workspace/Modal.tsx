import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Diálogo modal con entrada y salida suaves.
 *
 * Se desmonta DESPUÉS de la animación de salida, no antes: si se quitara del
 * DOM al tocar cerrar, el cierre sería un corte seco y sólo se vería animar la
 * entrada. Por eso hay un estado intermedio "saliendo".
 *
 * Accesibilidad: cierra con Escape, atrapa el foco adentro mientras está
 * abierto y lo devuelve a donde estaba al cerrar.
 */

const DURACION_MS = 200;

interface ModalProps {
  abierto: boolean;
  titulo: string;
  descripcion?: string;
  onCerrar: () => void;
  /** Si false, no se puede cerrar tocando el fondo ni con Escape. */
  descartable?: boolean;
  children: ReactNode;
  pie?: ReactNode;
}

export default function Modal(props: ModalProps) {
  const [montado, setMontado] = useState(props.abierto);
  const [visible, setVisible] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const focoPrevio = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (props.abierto) {
      focoPrevio.current = document.activeElement as HTMLElement | null;
      setMontado(true);
      // Un frame de diferencia para que el navegador registre el estado inicial
      // y la transición tenga desde dónde salir.
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }

    setVisible(false);
    const id = window.setTimeout(() => {
      setMontado(false);
      focoPrevio.current?.focus?.();
    }, DURACION_MS);
    return () => window.clearTimeout(id);
  }, [props.abierto]);

  useEffect(() => {
    if (!montado) return;

    // El primer campo enfocado: el docente puede empezar a escribir de una.
    const primero = panel.current?.querySelector<HTMLElement>(
      'input, textarea, select, button:not([data-cerrar])',
    );
    primero?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && props.descartable !== false) {
        props.onCerrar();
        return;
      }

      if (event.key !== 'Tab' || !panel.current) return;

      const focusables = [
        ...panel.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusables.length === 0) return;

      const primeroF = focusables[0]!;
      const ultimo = focusables[focusables.length - 1]!;

      if (event.shiftKey && document.activeElement === primeroF) {
        event.preventDefault();
        ultimo.focus();
      } else if (!event.shiftKey && document.activeElement === ultimo) {
        event.preventDefault();
        primeroF.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [montado, props]);

  if (!montado) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={props.titulo}
    >
      <div
        className="absolute inset-0 bg-carbon/40 backdrop-blur-[2px]"
        onClick={() => props.descartable !== false && props.onCerrar()}
        aria-hidden="true"
      />

      <div
        ref={panel}
        className={`kodu-card relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden shadow-xl transition-all duration-200 ease-out ${
          visible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.98] opacity-0'
        }`}
      >
        <header className="border-b border-linea px-5 py-4">
          <h2 className="font-display text-lg text-ink-900">{props.titulo}</h2>
          {props.descripcion && <p className="mt-1 text-sm text-ink-500">{props.descripcion}</p>}
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">{props.children}</div>

        {props.pie && (
          <footer className="flex items-center justify-end gap-2 border-t border-linea px-5 py-3">
            {props.pie}
          </footer>
        )}
      </div>
    </div>
  );
}
