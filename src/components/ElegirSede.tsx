import { useState } from 'react';
import { apiRequest } from '../lib/client/api.ts';

interface Sede {
  id: string;
  name: string;
}

interface Props {
  redName: string;
  sedes: Sede[];
}

/**
 * odd/tasks/organizaciones.md (T4, decisión del dueño — "Red con dominio
 * compartido"): selector de sede para quien entra por un dominio de una
 * NETWORK. Vive en `CuentaPersonal.astro` — el servidor ya resolvió que esta
 * cuenta es personal, confiable y de una red con sedes para elegir; acá sólo
 * falta que la persona toque una.
 */
export default function ElegirSede({ redName, sedes }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function elegir(sedeId: string) {
    setPending(sedeId);
    setError(null);
    const resultado = await apiRequest('/api/org/elegir-sede', 'POST', { organizationId: sedeId });

    if (!resultado.ok) {
      setPending(null);
      setError(resultado.error);
      return;
    }
    window.location.href = '/app';
  }

  return (
    <div className="mx-auto mt-6 max-w-sm text-left">
      <p className="text-center text-xs font-medium tracking-wide text-ink-500 uppercase">{redName}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {sedes.map((sede) => (
          <li key={sede.id}>
            <button
              type="button"
              onClick={() => elegir(sede.id)}
              disabled={pending !== null}
              className="w-full rounded-lg border border-linea px-4 py-2.5 text-sm font-medium text-ink-900 transition-colors hover:border-brand-600 disabled:opacity-60"
            >
              {pending === sede.id ? 'Uniéndote…' : sede.name}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-center text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
