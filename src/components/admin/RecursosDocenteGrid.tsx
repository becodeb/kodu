import { useEffect, useMemo, useState } from 'react';

// A teacher can have hundreds of resources; render them in pages so the
// profile stays short on mobile.
const TAMANO_PAGINA = 24;
import { formatearTokensCompacto } from '../../lib/format/tokens.ts';
import { tonoPorId } from '../../lib/admin/avatar.ts';

export interface RecursoGridProps {
  id: string;
  title: string;
  updatedAtIso: string;
  updatedAtDisplay: string;
  isInGallery: boolean;
  likes: number;
  screenshotUrl: string | null;
  tokens: number;
}

interface Props {
  recursos: RecursoGridProps[];
}

type Filtro = 'todos' | 'publicados' | 'privados';
type Orden = 'recientes' | 'consumo';

/**
 * La pestaña "Recursos" de la ficha de un docente (odd/tasks/admin-ui-redesign.md,
 * T04). Mismo criterio de filtro del lado del cliente que `UsuariosTabla`/
 * `ProyectosTabla`: la cantidad de recursos de UN docente nunca justifica un
 * viaje al servidor por cada tecla o cada clic en un filtro.
 *
 * Abrir un recurso lleva al workspace normal (`/app/project/:id`), el mismo
 * editor del docente — `findProjectForActor` (M8) ya deja pasar a un admin,
 * y `BannerAdmin.astro` avisa ahí que es un recurso ajeno.
 */
export default function RecursosDocenteGrid({ recursos }: Props) {
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState<Orden>('recientes');
  const [mostrados, setMostrados] = useState(TAMANO_PAGINA);

  useEffect(() => setMostrados(TAMANO_PAGINA), [filtro, busqueda, orden]);

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    let lista = recursos.filter((recurso) => {
      if (filtro === 'publicados' && !recurso.isInGallery) return false;
      if (filtro === 'privados' && recurso.isInGallery) return false;
      if (texto && !recurso.title.toLowerCase().includes(texto)) return false;
      return true;
    });
    lista = [...lista].sort((a, b) =>
      orden === 'consumo' ? b.tokens - a.tokens : new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime(),
    );
    return lista;
  }, [recursos, filtro, busqueda, orden]);

  if (recursos.length === 0) {
    return (
      <div className="kodu-card p-10 text-center text-sm text-ink-500">
        Todavía no creó ningún recurso.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-sutil p-0.5">
          {(
            [
              { valor: 'todos', etiqueta: 'Todos' },
              { valor: 'publicados', etiqueta: 'Publicados' },
              { valor: 'privados', etiqueta: 'Privados' },
            ] as const
          ).map((opcion) => (
            <button
              key={opcion.valor}
              type="button"
              aria-pressed={filtro === opcion.valor}
              onClick={() => setFiltro(opcion.valor)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filtro === opcion.valor ? 'bg-superficie text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              {opcion.etiqueta}
            </button>
          ))}
        </div>

        <input
          type="search"
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
          placeholder="Buscar por título…"
          aria-label="Buscar recurso por título"
          className="kodu-input min-w-40 flex-1"
        />

        <select
          aria-label="Ordenar recursos"
          value={orden}
          onChange={(evento) => setOrden(evento.target.value as Orden)}
          className="kodu-input w-auto text-sm"
        >
          <option value="recientes">Más recientes</option>
          <option value="consumo">Más consumo</option>
        </select>

        <p className="text-xs text-ink-500">
          {visibles.length} de {recursos.length}
        </p>
      </div>

      {visibles.length === 0 ? (
        <div className="kodu-card p-10 text-center text-sm text-ink-500">Ningún recurso coincide con lo que buscaste.</div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.slice(0, mostrados).map((recurso) => (
            <li key={recurso.id} className="kodu-card flex flex-col overflow-hidden">
              <a href={`/app/project/${recurso.id}`} className="block">
                {recurso.screenshotUrl ? (
                  <img
                    src={recurso.screenshotUrl}
                    alt={`Captura de ${recurso.title}`}
                    className="h-32 w-full border-b border-linea object-cover object-top"
                    loading="lazy"
                  />
                ) : (
                  // Sin captura: antes era un bloque gris de 128px con una
                  // sola letra (parent review, polish #4) — una banda baja y
                  // con un patrón de rayas derivado del id (mismo criterio
                  // que `tonoPorId`: una cuenta/un recurso siempre cae en el
                  // mismo tono, así no "parpadea" al reordenar la grilla).
                  <div
                    aria-hidden="true"
                    className={`relative flex h-14 w-full items-center justify-center overflow-hidden border-b border-linea ${tonoPorId(recurso.id)}`}
                  >
                    <div
                      className="absolute inset-0 opacity-40"
                      style={{
                        backgroundImage:
                          'repeating-linear-gradient(135deg, currentColor 0, currentColor 1px, transparent 1px, transparent 9px)',
                      }}
                    />
                    <span className="relative font-display text-sm">
                      {recurso.title.trim().charAt(0).toUpperCase() || '?'}
                    </span>
                  </div>
                )}
              </a>
              <div className="flex flex-1 flex-col gap-1.5 p-3.5">
                <a href={`/app/project/${recurso.id}`} className="truncate font-medium text-ink-900 hover:text-brand-600">
                  {recurso.title}
                </a>
                <div className="mt-auto flex items-center justify-between gap-2 text-xs text-ink-500">
                  <span className={recurso.isInGallery ? 'text-ink-700' : 'text-ink-500'}>
                    {recurso.isInGallery ? 'Publicado' : 'Privado'}
                  </span>
                  <span>{recurso.updatedAtDisplay}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-ink-500">
                  <span>{formatearTokensCompacto(recurso.tokens)} tokens</span>
                  <span>
                    {recurso.likes} {recurso.likes === 1 ? 'like' : 'likes'}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {visibles.length > mostrados && (
        <div className="flex justify-center pt-2">
          <button type="button" className="kodu-btn kodu-btn-ghost" onClick={() => setMostrados((n) => n + TAMANO_PAGINA)}>
            Mostrar {Math.min(TAMANO_PAGINA, visibles.length - mostrados)} más ({visibles.length - mostrados} restantes)
          </button>
        </div>
      )}
    </div>
  );
}
