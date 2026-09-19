import { useState, type FormEvent } from 'react';
import { apiRequest } from '../../lib/client/api.ts';
import type { FilaDominioAdmin } from '../../lib/admin/dominios.ts';

interface Props {
  initialDominios: FilaDominioAdmin[];
}

/**
 * `/admin/dominios` (design.md §10; specs/ai-access-control/spec.md —
 * "Authorized domains live in the database").
 *
 * No es una lista de motores con orden ni default: es una lista blanca
 * simple, alta y baja. El significado de la lista vacía no queda en la
 * cabeza de nadie — está escrito debajo de la lista, copia literal de
 * design.md.
 */
export default function DominiosPanel({ initialDominios }: Props) {
  const [dominios, setDominios] = useState(initialDominios);
  const [pattern, setPattern] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [borrandoId, setBorrandoId] = useState<string | null>(null);

  async function agregar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setGuardando(true);

    const result = await apiRequest<{ dominios: FilaDominioAdmin[] }>('/api/admin/domains', 'POST', {
      pattern,
      note: note.trim() === '' ? null : note.trim(),
    });

    setGuardando(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setDominios(result.data.dominios);
    setPattern('');
    setNote('');
  }

  async function borrar(dominio: FilaDominioAdmin) {
    setError(null);
    setBorrandoId(dominio.id);

    const result = await apiRequest(`/api/admin/domains/${dominio.id}`, 'DELETE');

    setBorrandoId(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setDominios((actuales) => actuales.filter((item) => item.id !== dominio.id));
  }

  return (
    <div className="max-w-2xl space-y-6">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={agregar} className="kodu-card flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="kodu-label" htmlFor="pattern">
            Dominio
          </label>
          <input
            id="pattern"
            name="pattern"
            type="text"
            required
            disabled={guardando}
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            className="kodu-input"
            placeholder="escuela.edu.ar o *.edu.ar"
          />
        </div>
        <div className="flex-1">
          <label className="kodu-label" htmlFor="note">
            Nota (opcional)
          </label>
          <input
            id="note"
            name="note"
            type="text"
            disabled={guardando}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="kodu-input"
            placeholder="Para qué escuela es"
          />
        </div>
        <button type="submit" disabled={guardando || pattern.trim() === ''} className="kodu-btn-primary shrink-0">
          Agregar dominio
        </button>
      </form>

      <div className="kodu-card overflow-hidden">
        {dominios.length === 0 ? (
          <div className="p-10 text-center text-sm text-ink-500">Todavía no agregaste ningún dominio.</div>
        ) : (
          <ul className="divide-y divide-linea">
            {dominios.map((dominio) => (
              <li key={dominio.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium text-ink-900">{dominio.pattern}</p>
                  <p className="text-xs text-ink-500">
                    {dominio.note ? `${dominio.note} · ` : ''}
                    {dominio.agregadoDisplay}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={borrandoId === dominio.id}
                  onClick={() => void borrar(dominio)}
                  className="kodu-btn-ghost shrink-0 px-3 py-1.5 text-xs"
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-sm text-ink-500">
        {dominios.length === 0
          ? 'La lista está vacía: cualquier docente registrado puede usar la IA.'
          : 'Solo estos dominios pueden usar la IA. El resto necesita un permiso individual.'}
      </p>
    </div>
  );
}
