import { useState } from 'react';
import { apiRequest } from '../lib/client/api.ts';

/**
 * Habilita DeepSeek para un docente puntual.
 *
 * DeepSeek es el único motor que se paga por token, así que no se ofrece a
 * todos: acá el admin lo abre caso por caso. Optimista, con vuelta atrás si el
 * servidor rechaza, para que el toggle no mienta.
 */
export default function AdminDeepseekToggle({
  userId,
  inicial,
}: {
  userId: string;
  inicial: boolean;
}) {
  const [activo, setActivo] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(false);

  async function alternar() {
    const nuevo = !activo;
    setActivo(nuevo);
    setGuardando(true);
    setError(false);

    const result = await apiRequest('/api/admin/deepseek', 'POST', { userId, enabled: nuevo });
    setGuardando(false);

    if (!result.ok) {
      setActivo(!nuevo);
      setError(true);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void alternar()}
      disabled={guardando}
      aria-pressed={activo}
      title={activo ? 'DeepSeek habilitado' : 'DeepSeek deshabilitado'}
      className="inline-flex items-center gap-2 disabled:opacity-60"
    >
      <span
        aria-hidden="true"
        className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          activo ? 'bg-brand-600' : 'bg-linea'
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-superficie shadow-sm transition-transform ${
            activo ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
      <span className={`text-xs ${error ? 'text-red-600' : 'text-ink-500'}`}>
        {error ? 'no se pudo' : activo ? 'habilitado' : 'no'}
      </span>
    </button>
  );
}
