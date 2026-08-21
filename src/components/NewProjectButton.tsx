import { useState } from 'react';
import { apiRequest } from '../lib/client/api.ts';

/** Botón "Nuevo recurso" del panel del docente: crea el proyecto y entra al editor. */
export default function NewProjectButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setPending(true);
    setError(null);

    const result = await apiRequest<{ redirect: string }>('/api/projects', 'POST', {
      title: 'Nuevo Recurso',
    });

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }

    window.location.href = result.data.redirect;
  }

  return (
    <div className="text-right">
      <button type="button" onClick={create} disabled={pending} className="kodu-btn-primary">
        {pending ? 'Creando…' : '+ Nuevo recurso'}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
