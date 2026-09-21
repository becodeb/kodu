import { useState } from 'react';
import { apiRequest } from '../lib/client/api.ts';

interface BotonLikeProps {
  projectId: string;
  /** Para el `aria-label`: "Me gusta {title}". */
  title: string;
  inicial: number;
  likeadoInicial: boolean;
  /** Si nadie inició sesión, mandamos a login en vez de fallar con un 401. */
  isLoggedIn: boolean;
}

/** El corazón de la galería (design.md §5, spec `gallery-likes`). */
export default function BotonLike({ projectId, title, inicial, likeadoInicial, isLoggedIn }: BotonLikeProps) {
  const [likeado, setLikeado] = useState(likeadoInicial);
  const [cuenta, setCuenta] = useState(inicial);
  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function alternar() {
    if (!isLoggedIn) {
      window.location.href = `/login?next=${encodeURIComponent('/gallery')}`;
      return;
    }

    // Optimista, con rollback si el servidor lo rechaza.
    const previoLikeado = likeado;
    const previaCuenta = cuenta;
    const nuevoLikeado = !likeado;

    setLikeado(nuevoLikeado);
    setCuenta((valor) => valor + (nuevoLikeado ? 1 : -1));
    setPendiente(true);
    setError(null);

    const result = await apiRequest<{ liked: boolean; likes: number }>(
      `/api/projects/${projectId}/like`,
      nuevoLikeado ? 'POST' : 'DELETE',
    );

    setPendiente(false);

    if (!result.ok) {
      setLikeado(previoLikeado);
      setCuenta(previaCuenta);
      setError(result.error);
      return;
    }

    setLikeado(result.data.liked);
    setCuenta(result.data.likes);
  }

  const etiqueta = isLoggedIn
    ? likeado
      ? `Quitar mi me gusta de ${title}`
      : `Me gusta ${title}`
    : 'Iniciá sesión para dar me gusta';

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => void alternar()}
        disabled={pendiente}
        aria-pressed={isLoggedIn ? likeado : undefined}
        aria-label={etiqueta}
        className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-xs tabular-nums transition-colors ${
          likeado ? 'text-red-600 hover:bg-sutil' : 'text-ink-500 hover:bg-sutil hover:text-ink-700'
        }`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          aria-hidden="true"
          fill={likeado ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path
            d="M8 13.6 2.7 8.2a3.15 3.15 0 0 1 4.45-4.45L8 4.6l.85-.85A3.15 3.15 0 0 1 13.3 8.2Z"
            strokeLinejoin="round"
          />
        </svg>
        {cuenta}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </span>
  );
}
