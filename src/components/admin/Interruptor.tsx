/**
 * El riel-y-perilla de `BaseLayout.astro:147-156` (el toggle de modo oscuro),
 * llevado a un componente React controlado para que el panel admin lo pueda
 * reusar: acá (habilitar/deshabilitar un motor) y en el toggle de la demo (M7).
 *
 * Es un `<input type="checkbox">` real con `sr-only`: el foco, el Enter/Espacio
 * y el anuncio a un lector de pantalla salen gratis del elemento nativo — el
 * riel pintado es sólo la piel.
 */

interface InterruptorProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Texto que acompaña el riel. Si no hace falta texto visible, pasar `srOnly`. */
  label: string;
  /** El texto no se ve (pero sigue anunciándose), para usos como una celda de tabla. */
  srOnly?: boolean;
  id?: string;
  disabled?: boolean;
}

export default function Interruptor(props: InterruptorProps) {
  return (
    <label
      htmlFor={props.id}
      className={`inline-flex items-center gap-2 ${
        props.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      }`}
    >
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          props.checked ? 'bg-brand-600' : 'bg-linea'
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-superficie shadow-sm transition-transform ${
            props.checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
      <span className={props.srOnly ? 'sr-only' : 'text-sm text-ink-700'}>{props.label}</span>
    </label>
  );
}
