interface ModoRapidoProps {
  activo: boolean;
  onChange: (activo: boolean) => void;
}

/**
 * Nov 2026: el docente ya no elige motor de IA. Elige si quiere el modo
 * rápido (Haiku, más veloz y un poco menos prolijo) o el normal, en el que
 * Kodu decide el motor (ver src/lib/billing/cuenta-gratuita.ts y el modo de
 * generación de /admin/generacion).
 */
export default function ModoRapido(props: ModoRapidoProps) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span id="modo-rapido-etiqueta" className="text-xs font-medium text-ink-900">
          ⚡ Modo rápido
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={props.activo}
          aria-labelledby="modo-rapido-etiqueta"
          aria-describedby="modo-rapido-ayuda"
          onClick={() => props.onChange(!props.activo)}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
            props.activo ? 'bg-brand-600' : 'bg-linea'
          }`}
        >
          <span
            aria-hidden="true"
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              props.activo ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      <p id="modo-rapido-ayuda" className="mt-1 text-[0.7rem] leading-snug text-ink-500">
        {props.activo
          ? 'Responde más rápido, pero el resultado puede salir un poco menos prolijo.'
          : 'Kodu elige el motor que mejor resultado da.'}
      </p>
    </div>
  );
}
