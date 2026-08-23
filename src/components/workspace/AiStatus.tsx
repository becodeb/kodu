import { useEffect, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import type { AiPhase } from '../../lib/workspace-types.ts';

/**
 * Señal de vida de la IA (thinking-orbs) con el texto animado de transitions.dev.
 *
 * Cada fase tiene su propia animación a propósito: el docente ve la diferencia
 * entre "todavía está pensando" y "ya está escribiendo el recurso" sin leer una
 * palabra, que es justo el rato en el que uno duda de si la app se colgó.
 *
 * El orbe es monocromo por diseño de la librería, así que el color de marca lo
 * pone el texto de al lado.
 */

const PHASES: Record<
  Exclude<AiPhase, 'idle'>,
  { state: 'connecting' | 'solving' | 'composing' | 'weaving'; label: string }
> = {
  uploading: { state: 'connecting', label: 'Subiendo tus archivos…' },
  thinking: { state: 'solving', label: 'Pensando cómo resolverlo…' },
  writing: { state: 'composing', label: 'Escribiéndote la respuesta…' },
  coding: { state: 'weaving', label: 'Armando el recurso…' },
};

/** Debe coincidir con --text-swap-dur en global.css. */
const SWAP_MS = 150;

interface AiStatusProps {
  phase: AiPhase;
  /** `inline` para el renglón de estado; `bubble` para la burbuja del chat. */
  variant?: 'inline' | 'bubble';
}

export default function AiStatus({ phase, variant = 'bubble' }: AiStatusProps) {
  const active = phase === 'idle' ? null : PHASES[phase];

  const [shown, setShown] = useState(active?.label ?? '');
  const textRef = useRef<HTMLSpanElement>(null);
  const timers = useRef<number[]>([]);

  /**
   * Secuencia de tres tiempos del swap: sale hacia arriba con blur, se cambia el
   * texto de golpe abajo (sin transición) y vuelve a su lugar animando.
   */
  useEffect(() => {
    const next = active?.label;
    if (!next || next === shown) return;

    const node = textRef.current;
    if (!node) {
      setShown(next);
      return;
    }

    node.classList.add('is-exit');

    const id = window.setTimeout(() => {
      setShown(next);
      node.classList.remove('is-exit');
      node.classList.add('is-enter-start');
      // Reflow forzado: sin esto el navegador agrupa el quitar/poner en un solo
      // cambio de estilo y el texto aparece de una, sin animación de entrada.
      void node.offsetWidth;
      node.classList.remove('is-enter-start');
    }, SWAP_MS);

    timers.current.push(id);
    return () => window.clearTimeout(id);
  }, [active?.label, shown]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  if (!active) return null;

  return (
    <div
      className={
        variant === 'bubble'
          ? 'flex items-center gap-2.5 text-sm text-ink-700'
          : 'flex items-center gap-2 text-xs text-ink-500'
      }
    >
      {/* La librería sólo trae dos tamaños afinados, 20 y 64: acá va siempre el
          de 20, que es el que se lee como parte de un renglón de texto. */}
      <ThinkingOrb state={active.state} size={20} theme="light" aria-label={active.label} />
      <span ref={textRef} className="t-text-swap">
        {shown}
      </span>
    </div>
  );
}
