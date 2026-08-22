import { ThinkingOrb } from 'thinking-orbs';
import type { AiPhase } from '../../lib/workspace-types.ts';

/**
 * Señal de vida de la IA (thinking-orbs).
 *
 * Cada fase tiene su propia animación a propósito: el docente ve la diferencia
 * entre "todavía está pensando" y "ya está escribiendo el recurso" sin leer una
 * palabra, que es justo el rato en el que uno duda de si la app se colgó.
 *
 * El orbe es monocromo por diseño de la librería, así que se apoya en el texto
 * de al lado para el color de marca.
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

interface AiStatusProps {
  phase: AiPhase;
  /** `inline` para el renglón de estado; `bubble` para la burbuja del chat. */
  variant?: 'inline' | 'bubble';
}

export default function AiStatus({ phase, variant = 'bubble' }: AiStatusProps) {
  if (phase === 'idle') return null;

  const { state, label } = PHASES[phase];
  const size = variant === 'bubble' ? 64 : 20;

  return (
    <div
      className={
        variant === 'bubble'
          ? 'flex items-center gap-3 text-sm text-ink-700'
          : 'flex items-center gap-2 text-xs text-ink-500'
      }
    >
      <ThinkingOrb state={state} size={size} theme="light" aria-label={label} />
      <span className={variant === 'bubble' ? 'font-medium' : ''}>{label}</span>
    </div>
  );
}
