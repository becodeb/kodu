import { useState } from 'react';
import { apiRequest } from '../lib/client/api.ts';

interface DuplicateButtonProps {
  projectId: string;
  /** Si nadie inició sesión, mandamos a login en vez de fallar con un 401. */
  isLoggedIn: boolean;
}

/** "Duplicar en mi cuenta" de la galería (SPEC §5.3). */
export default function DuplicateButton({ projectId, isLoggedIn }: DuplicateButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function duplicate() {
    if (!isLoggedIn) {
      window.location.href = `/login?next=${encodeURIComponent('/gallery')}`;
      return;
    }

    setPending(true);
    setError(null);

    const result = await apiRequest<{ redirect: string }>(
      `/api/projects/${projectId}/duplicate`,
      'POST',
    );

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }

    window.location.href = result.data.redirect;
  }

  return (
    <>
      <button type="button" onClick={duplicate} disabled={pending} className="kodu-btn-ghost px-2.5 py-1.5 text-xs">
        {pending ? 'Duplicando…' : 'Duplicar'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </>
  );
}
