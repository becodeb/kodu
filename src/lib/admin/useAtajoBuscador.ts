import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Enfoca `ref` al apretar "/", salvo que ya se esté escribiendo en otro
 * control — compartido por `UsuariosTabla` y `ProyectosTabla`.
 *
 * Vive en su propio archivo (no adentro de `BuscadorAdmin.tsx`) a propósito:
 * un archivo `.tsx` que exporta un componente Y un hook rompe el límite que
 * React Fast Refresh espera (sólo componentes) — en dev eso se manifestó
 * como `_jsxDEV is not a function` al abrir `/admin/proyectos`, un error que
 * tumbaba la isla entera y dejaba la tabla sin filtrar ni interactiva.
 */
export function useAtajoBuscador(ref: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    function alTeclear(evento: KeyboardEvent) {
      if (evento.key !== '/') return;
      const activo = document.activeElement;
      const yaEscribiendo =
        activo instanceof HTMLInputElement || activo instanceof HTMLTextAreaElement || activo?.getAttribute('contenteditable') === 'true';
      if (yaEscribiendo) return;
      evento.preventDefault();
      ref.current?.focus();
    }
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [ref]);
}
