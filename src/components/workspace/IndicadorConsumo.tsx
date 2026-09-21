import { useState } from 'react';
import type { NivelConsumo } from '../../lib/ai/usage.ts';

/**
 * El indicador de consumo del workspace (design.md — "The workspace cost
 * indicator", specs/ai-cost-accounting/spec.md — "Teacher-facing cost
 * indicator").
 *
 * Lectura por defecto: un nivel cualitativo ("Consumo bajo/medio/alto"), sin
 * moneda ni unidad inventada. El monto exacto en USD se revela con mouse,
 * toque O foco de teclado — nunca sólo con mouse, porque un `title` no anda
 * en touch y un `:hover` puro no es alcanzable por teclado. Por eso es un
 * `<button aria-expanded>`, no un `<span title>`.
 *
 * Prohibido acá: la palabra "ficha" (ya nombra la tarjeta título+descripción
 * del recurso y su pestaña del workspace — ver openspec/context.md).
 */

const ETIQUETAS: Record<NivelConsumo, string> = {
  bajo: 'Consumo bajo',
  medio: 'Consumo medio',
  alto: 'Consumo alto',
};

export interface IndicadorConsumoProps {
  tokens: number;
  nivel: NivelConsumo;
}

function formatearTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M tokens`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} k tokens`;
  }
  return `${tokens.toLocaleString('es-AR')} tokens`;
}

export default function IndicadorConsumo({ tokens, nivel }: IndicadorConsumoProps) {
  const [abierto, setAbierto] = useState(false);

  return (
    <div className="relative ml-auto shrink-0">
      <button
        type="button"
        aria-expanded={abierto}
        onMouseEnter={() => setAbierto(true)}
        onMouseLeave={() => setAbierto(false)}
        onFocus={() => setAbierto(true)}
        onBlur={() => setAbierto(false)}
        onClick={() => setAbierto(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setAbierto(false);
        }}
        className="rounded-full border border-linea bg-sutil px-2.5 py-1 text-xs text-ink-500 transition-colors hover:border-brand-300 hover:text-ink-700"
      >
        {ETIQUETAS[nivel]}
      </button>

      {abierto && (
        <div
          role="status"
          className="kodu-card absolute top-full right-0 z-10 mt-2 w-56 p-3 text-xs shadow-lg"
        >
          <p className="mb-1 font-medium text-ink-900">{formatearTokens(tokens)}</p>
          <p className="text-ink-500">Es cuánto texto procesó la IA en este recurso.</p>
        </div>
      )}
    </div>
  );
}
