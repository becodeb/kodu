import type { RefObject } from 'react';

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (valor: string) => void;
  placeholder: string;
  inputRef: RefObject<HTMLInputElement | null>;
  className?: string;
}

/**
 * El buscador de `UsuariosTabla`/`ProyectosTabla`: antes el atajo de teclado
 * vivía en el placeholder ("Buscar por nombre o email… (atajo: /)") y a
 * 1440px ya quedaba truncado ("…(a"), parent review (polish #3). Ahora el
 * placeholder dice sólo qué busca, y el atajo es un `<kbd>` visible adentro
 * del input — mismo lugar que cualquier buscador con atajo (el de GitHub,
 * por ejemplo), nunca texto que compite con el propio placeholder.
 */
export default function BuscadorAdmin({ id, label, value, onChange, placeholder, inputRef, className }: Props) {
  return (
    <div className={`relative min-w-48 flex-1 ${className ?? ''}`}>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        type="search"
        value={value}
        onChange={(evento) => onChange(evento.target.value)}
        placeholder={placeholder}
        className="kodu-input pr-8"
      />
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-linea bg-sutil px-1.5 py-0.5 text-[10px] font-medium text-ink-500"
      >
        /
      </kbd>
    </div>
  );
}
