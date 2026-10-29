import { useRef, useState } from 'react';
import { ANCHO_CHAT_INICIAL, ANCHO_CHAT_MIN, ANCHO_RECURSO_MIN } from '../../lib/client/ancho-chat.ts';

const PASO_TECLADO = 32;
/** Dos toques en la manija dentro de este margen = volver al ancho de siempre. */
const DOBLE_TOQUE_MS = 350;

interface DivisorChatProps {
  ancho: number;
  onCambio: (ancho: number) => void;
  /** La grilla que contiene chat y recurso: de ahí salen el borde izquierdo y
   *  el ancho total para acotar el arrastre. */
  contenedor: HTMLElement | null;
}

function acotar(ancho: number, contenedor: HTMLElement | null): number {
  const maximo = contenedor ? contenedor.clientWidth - ANCHO_RECURSO_MIN : Number.POSITIVE_INFINITY;
  return Math.round(Math.max(ANCHO_CHAT_MIN, Math.min(ancho, maximo)));
}

/**
 * Manija para arrastrar el borde entre el chat y la vista previa (sólo en
 * pantallas grandes; en el celular son pestañas). Mientras se arrastra, una
 * capa transparente tapa la pantalla: sin ella, al pasar por encima del
 * iframe del recurso, el iframe se queda con los eventos del puntero y el
 * arrastre se corta. Doble toque vuelve al ancho de siempre: se detecta en
 * `pointerdown` y no con `onDoubleClick`, porque esa misma capa recibe el
 * `pointerup` y el navegador nunca le entrega el `dblclick` a la manija.
 */
export default function DivisorChat({ ancho, onCambio, contenedor }: DivisorChatProps) {
  const [arrastrando, setArrastrando] = useState(false);
  const ultimoToqueRef = useRef(0);

  function empezar(event: React.PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    const ahora = event.timeStamp;
    if (ahora - ultimoToqueRef.current < DOBLE_TOQUE_MS) {
      ultimoToqueRef.current = 0;
      onCambio(acotar(ANCHO_CHAT_INICIAL, contenedor));
      return;
    }
    ultimoToqueRef.current = ahora;
    setArrastrando(true);
    const izquierda = contenedor?.getBoundingClientRect().left ?? 0;

    function mover(e: PointerEvent) {
      onCambio(acotar(e.clientX - izquierda, contenedor));
    }
    function terminar() {
      setArrastrando(false);
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', terminar);
      window.removeEventListener('pointercancel', terminar);
    }
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', terminar);
    window.addEventListener('pointercancel', terminar);
  }

  function conTeclado(event: React.KeyboardEvent) {
    if (event.key === 'ArrowLeft') onCambio(acotar(ancho - PASO_TECLADO, contenedor));
    else if (event.key === 'ArrowRight') onCambio(acotar(ancho + PASO_TECLADO, contenedor));
    else return;
    event.preventDefault();
  }

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Ancho del chat"
        aria-valuenow={ancho}
        tabIndex={0}
        title="Arrastrá para cambiar el ancho del chat (doble clic: volver al original)"
        onPointerDown={empezar}
        onKeyDown={conTeclado}
        className="group absolute inset-y-0 -right-1.5 z-20 hidden w-3 cursor-col-resize touch-none focus-visible:outline-none lg:block"
      >
        <span
          className={`absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors ${
            arrastrando ? 'bg-brand-500' : 'bg-transparent group-hover:bg-brand-300 group-focus-visible:bg-brand-500'
          }`}
        />
      </div>
      {arrastrando && <div aria-hidden="true" className="fixed inset-0 z-50 cursor-col-resize" />}
    </>
  );
}
