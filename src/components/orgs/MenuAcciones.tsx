import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * Menú "⋯" de una fila (patrón WAI-ARIA "menu button").
 *
 * Se posiciona con `position: fixed` a partir del rectángulo del botón, no
 * `absolute` dentro de la fila: así ni un contenedor con `overflow` ni el borde
 * inferior de la pantalla lo recortan. Si abajo no entra, se abre hacia arriba.
 * Un resize, o un scroll que mueva el botón, lo cierra (el ancla se movió).
 *
 * Un `<details>` nativo (como el de `UsuariosTabla`) no sirve acá: no expone
 * `aria-haspopup`/`aria-expanded` ni devuelve el foco al botón al cerrar.
 */

export interface AccionMenu {
  id: string;
  etiqueta: string;
  onSelect?: () => void;
  /** Se ve pero no hace nada (sigue enfocable, para que se pueda leer el `titulo`). */
  deshabilitada?: boolean;
  /** Explica por qué está deshabilitada. */
  titulo?: string;
  /** Acción destructiva: en rojo. */
  peligrosa?: boolean;
  /** Línea separadora arriba (para aislar la acción destructiva). */
  separada?: boolean;
}

interface Props {
  /** Nombre accesible del botón, p. ej. "Acciones para Ana Pérez". */
  etiqueta: string;
  acciones: AccionMenu[];
}

const MARGEN = 8;
const SEPARACION = 4;

export default function MenuAcciones({ etiqueta, acciones }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [posicion, setPosicion] = useState<{ top: number; left: number } | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const anclaAlAbrir = useRef<{ top: number; left: number } | null>(null);
  const idMenu = useId();

  const cerrar = useCallback((devolverFoco: boolean) => {
    setAbierto(false);
    setPosicion(null);
    if (devolverFoco) boton.current?.focus();
  }, []);

  // Mientras `posicion` es null el menú se pinta invisible: sólo para medirlo.
  useLayoutEffect(() => {
    if (!abierto || !boton.current || !menu.current) return;
    const ancla = boton.current.getBoundingClientRect();
    const caja = menu.current.getBoundingClientRect();
    anclaAlAbrir.current = { top: ancla.top, left: ancla.left };
    let top = ancla.bottom + SEPARACION;
    if (top + caja.height > window.innerHeight - MARGEN) {
      top = Math.max(MARGEN, ancla.top - caja.height - SEPARACION);
    }
    const left = Math.max(MARGEN, Math.min(ancla.right - caja.width, window.innerWidth - caja.width - MARGEN));
    setPosicion({ top, left });
  }, [abierto]);

  const posicionado = posicion !== null;
  useEffect(() => {
    if (!abierto || !posicionado) return;
    const primero = menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    (primero ?? menu.current)?.focus({ preventScroll: true });
  }, [abierto, posicionado]);

  useEffect(() => {
    if (!abierto) return;
    function alPresionar(evento: PointerEvent) {
      const objetivo = evento.target as Node;
      if (menu.current?.contains(objetivo) || boton.current?.contains(objetivo)) return;
      cerrar(false);
    }
    function alTeclear(evento: globalThis.KeyboardEvent) {
      if (evento.key === 'Escape') {
        evento.stopPropagation();
        cerrar(true);
      }
    }
    function alCerrar() {
      cerrar(false);
    }
    // Un scroll sólo importa si movió el botón: el navegador entrega los
    // eventos de un scroll previo (p. ej. el que dejó el botón a la vista)
    // un frame tarde, ya con el menú abierto.
    function alScrollear(evento: Event) {
      if (evento.target instanceof Node && menu.current?.contains(evento.target)) return;
      const antes = anclaAlAbrir.current;
      const ahora = boton.current?.getBoundingClientRect();
      if (antes && ahora && Math.abs(ahora.top - antes.top) < 1 && Math.abs(ahora.left - antes.left) < 1) return;
      cerrar(false);
    }
    document.addEventListener('pointerdown', alPresionar);
    document.addEventListener('keydown', alTeclear);
    window.addEventListener('scroll', alScrollear, true);
    window.addEventListener('resize', alCerrar);
    return () => {
      document.removeEventListener('pointerdown', alPresionar);
      document.removeEventListener('keydown', alTeclear);
      window.removeEventListener('scroll', alScrollear, true);
      window.removeEventListener('resize', alCerrar);
    };
  }, [abierto, cerrar]);

  function alTeclearEnMenu(evento: KeyboardEvent<HTMLDivElement>) {
    if (evento.key === 'Tab') {
      cerrar(false);
      return;
    }
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const actual = items.indexOf(document.activeElement as HTMLElement);
    let destino: number | null = null;
    if (evento.key === 'ArrowDown') destino = (actual + 1) % items.length;
    else if (evento.key === 'ArrowUp') destino = (actual <= 0 ? items.length : actual) - 1;
    else if (evento.key === 'Home') destino = 0;
    else if (evento.key === 'End') destino = items.length - 1;
    if (destino === null) return;
    evento.preventDefault();
    items[destino]!.focus();
  }

  function elegir(accion: AccionMenu) {
    if (accion.deshabilitada) return;
    cerrar(true);
    accion.onSelect?.();
  }

  return (
    <>
      <button
        ref={boton}
        type="button"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined}
        aria-label={etiqueta}
        onClick={() => (abierto ? cerrar(true) : setAbierto(true))}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-sutil hover:text-ink-900 aria-expanded:bg-sutil aria-expanded:text-ink-900"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="3" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="8" cy="13" r="1.4" />
        </svg>
      </button>

      {abierto && (
        <div
          ref={menu}
          id={idMenu}
          role="menu"
          aria-label={etiqueta}
          tabIndex={-1}
          onKeyDown={alTeclearEnMenu}
          style={{ top: posicion?.top ?? 0, left: posicion?.left ?? 0, visibility: posicion ? 'visible' : 'hidden' }}
          className="kodu-card fixed z-50 w-60 max-w-[calc(100vw-16px)] p-1 text-left shadow-lg focus:outline-none"
        >
          {acciones.map((accion) => (
            <div key={accion.id} role="none">
              {accion.separada && <div role="separator" className="my-1 border-t border-linea" />}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={accion.deshabilitada ? true : undefined}
                title={accion.titulo}
                onClick={() => elegir(accion)}
                className={`block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-sutil focus:bg-sutil focus:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:bg-transparent ${
                  accion.peligrosa ? 'text-red-600' : 'text-ink-700'
                }`}
              >
                {accion.etiqueta}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
