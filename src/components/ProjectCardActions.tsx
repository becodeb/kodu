import { useState } from 'react';
import { apiRequest } from '../lib/client/api.ts';

interface ProjectCardActionsProps {
  projectId: string;
  title: string;
}

/** Borrar un recurso propio desde el panel, con confirmación. */
export default function ProjectCardActions({ projectId, title }: ProjectCardActionsProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`¿Borrar "${title}"? Se borran también sus conversaciones.`)) return;

    setPending(true);
    const result = await apiRequest(`/api/projects/${projectId}`, 'DELETE');

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }

    window.location.reload();
  }

  return (
    <>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="text-xs text-ink-500 underline hover:text-red-600"
      >
        {pending ? 'Borrando…' : 'Borrar'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </>
  );
}
