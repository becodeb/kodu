import { useEffect, useRef, useState } from 'react';

/**
 * Muestra el texto de la IA revelándolo de a poco.
 *
 * El stream no llega parejo: el proveedor manda ráfagas, así que sin esto el
 * texto aparece a los saltos, un párrafo entero de golpe. Acá se guarda cuánto
 * hay escrito y se avanza a ritmo propio hasta alcanzarlo, con una velocidad
 * proporcional a lo que falta: si se atrasa mucho, acelera; si va al día, se
 * mueve al ritmo de la lectura. Cuando el turno termina no queda texto colgado,
 * porque el objetivo deja de crecer y el revelado lo alcanza igual.
 */

/** Caracteres por segundo cuando está al día. */
const BASE_CPS = 90;

export default function StreamedText({
  text,
  render,
}: {
  text: string;
  /** Para que el que llama decida cómo pintar (negritas, saltos, etc.). */
  render: (visible: string) => React.ReactNode;
}) {
  const [visibles, setVisibles] = useState(0);
  const frame = useRef<number | null>(null);
  const ultimo = useRef<number>(0);

  useEffect(() => {
    function paso(ahora: number) {
      const delta = ultimo.current ? (ahora - ultimo.current) / 1000 : 0;
      ultimo.current = ahora;

      setVisibles((actual) => {
        if (actual >= text.length) return actual;

        // Cuanto más atrasado, más rápido: así una ráfaga grande no deja al
        // docente mirando cómo se escribe letra por letra durante un minuto.
        const atraso = text.length - actual;
        const cps = BASE_CPS + atraso * 2.5;
        return Math.min(text.length, actual + Math.max(1, Math.ceil(cps * delta)));
      });

      frame.current = requestAnimationFrame(paso);
    }

    frame.current = requestAnimationFrame(paso);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      ultimo.current = 0;
    };
  }, [text]);

  // Si el texto se reinicia (turno nuevo), el contador vuelve a cero.
  useEffect(() => {
    setVisibles((actual) => (actual > text.length ? 0 : actual));
  }, [text]);

  return <>{render(text.slice(0, visibles))}</>;
}
