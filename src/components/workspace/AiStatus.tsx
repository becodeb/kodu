import { useEffect, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import type { AiPhase } from '../../lib/workspace-types.ts';

/**
 * Señal de vida de la IA: orbe, qué está haciendo, y hace cuánto.
 *
 * Cada fase tiene su propia animación a propósito: el docente ve la diferencia
 * entre "todavía está pensando" y "ya está escribiendo el recurso" sin leer una
 * palabra, que es justo el rato en el que uno duda de si la app se colgó.
 *
 * El texto NO entra ni sale con una transición: se escribe una vez y se queda.
 * El único movimiento es el brillo que lo recorre de izquierda a derecha, que
 * ya alcanza para que no parezca congelado; hacerlo aparecer y desaparecer en
 * cada cambio de fase daba sensación de parpadeo. El cronómetro completa la
 * idea: mientras el número sube, está vivo.
 */

const PHASES: Record<
  Exclude<AiPhase, 'idle'>,
  { state: 'connecting' | 'solving' | 'composing' | 'weaving'; label: string }
> = {
  uploading: { state: 'connecting', label: 'Subiendo tus archivos' },
  thinking: { state: 'solving', label: 'Pensando cómo resolverlo' },
  writing: { state: 'composing', label: 'Escribiéndote la respuesta' },
  coding: { state: 'weaving', label: 'Armando el recurso' },
};

function formatearTiempo(segundos: number): string {
  if (segundos < 60) return `${segundos}s`;
  const minutos = Math.floor(segundos / 60);
  return `${minutos}:${String(segundos % 60).padStart(2, '0')}`;
}

interface AiStatusProps {
  phase: AiPhase;
  /** `inline` para el renglón de estado; `bubble` para la burbuja del chat. */
  variant?: 'inline' | 'bubble';
  /**
   * Cuándo arrancó el turno, en epoch ms. Lo pone quien lo sabe de verdad: al
   * recargar la página, el turno puede llevar veinte minutos corriendo y contar
   * desde cero mostraría un tiempo que no es.
   */
  desde?: number | null;
  onDetener?: () => void;
}

export default function AiStatus({ phase, variant = 'bubble', desde, onDetener }: AiStatusProps) {
  const activo = phase === 'idle' ? null : PHASES[phase];

  const [segundos, setSegundos] = useState(0);
  // El cronómetro mide el TURNO entero, no cada fase: al docente le importa
  // hace cuánto está esperando, no hace cuánto lleva escribiendo el código.
  const arranque = useRef<number | null>(null);

  useEffect(() => {
    if (phase === 'idle') {
      arranque.current = null;
      setSegundos(0);
      return;
    }

    if (desde) arranque.current = desde;
    else if (arranque.current === null) arranque.current = Date.now();

    const tick = () => {
      if (arranque.current !== null) {
        setSegundos(Math.floor((Date.now() - arranque.current) / 1000));
      }
    };

    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [phase, desde]);

  if (!activo) return null;

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
      <ThinkingOrb state={activo.state} size={20} theme="auto" aria-label={activo.label} />

      <span className="t-shimmer">{activo.label}</span>

      <span className="tabular-nums text-ink-500 opacity-70" aria-hidden="true">
        {formatearTiempo(segundos)}
      </span>

      {onDetener && (
        <button
          type="button"
          onClick={onDetener}
          className="ml-auto shrink-0 rounded-md border border-linea px-2 py-0.5 text-xs font-medium text-ink-700 transition-colors hover:border-red-300 hover:text-red-600"
        >
          Detener
        </button>
      )}
    </div>
  );
}
