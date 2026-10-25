import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../lib/client/api.ts';
import type { FilaProyectoAdmin } from '../../lib/admin/proyectos.ts';
import { tonoPorId } from '../../lib/admin/avatar.ts';
import BuscadorAdmin from './BuscadorAdmin.tsx';
import { useAtajoBuscador } from '../../lib/admin/useAtajoBuscador.ts';

interface Props {
  initialProyectos: FilaProyectoAdmin[];
}

type Estado = 'todos' | 'publicados' | 'privados' | 'demo';
type Orden = 'recientes' | 'likes' | 'titulo';

const ESTADOS: { valor: Estado; etiqueta: string }[] = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'publicados', etiqueta: 'En la galería' },
  { valor: 'privados', etiqueta: 'Privados' },
  { valor: 'demo', etiqueta: 'De la demo' },
];

interface EstadoFiltros {
  busqueda: string;
  estado: Estado;
  duenoId: string; // '' = todos
  orden: Orden;
}

const ESTADO_DEFAULT: EstadoFiltros = { busqueda: '', estado: 'todos', duenoId: '', orden: 'recientes' };

function leerEstadoDeUrl(): EstadoFiltros {
  if (typeof window === 'undefined') return ESTADO_DEFAULT;
  const params = new URLSearchParams(window.location.search);
  return {
    busqueda: params.get('q') ?? '',
    estado: (params.get('estado') as Estado) ?? 'todos',
    duenoId: params.get('dueno') ?? '',
    orden: (params.get('orden') as Orden) ?? 'recientes',
  };
}

/** Mismo criterio que `UsuariosTabla`: la URL refleja el filtro sin navegar,
 *  para que compartir el link o recargar reproduzca la misma vista. */
function escribirEstadoEnUrl(estado: EstadoFiltros): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams();
  if (estado.busqueda) params.set('q', estado.busqueda);
  if (estado.estado !== 'todos') params.set('estado', estado.estado);
  if (estado.duenoId) params.set('dueno', estado.duenoId);
  if (estado.orden !== 'recientes') params.set('orden', estado.orden);
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState(null, '', url);
}

function haceCuanto(iso: string): string {
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutos < 1) return 'recién';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias < 30) return `hace ${dias} d`;
  return new Date(iso).toLocaleDateString('es-AR');
}

/** La miniatura de la columna "Recurso": la captura si existe, o si no un
 *  bloque chico con el mismo tono por id que ya usa la ficha del docente
 *  (`tonoPorId`) — nunca el gris genérico. */
function Portada({ proyecto }: { proyecto: FilaProyectoAdmin }) {
  if (proyecto.screenshotUrl) {
    return (
      <img
        src={proyecto.screenshotUrl}
        alt=""
        aria-hidden="true"
        className="h-10 w-10 shrink-0 rounded-md border border-linea object-cover"
        loading="lazy"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md font-display text-sm ${tonoPorId(proyecto.id)}`}
    >
      {proyecto.title.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/**
 * La tabla de `/admin/proyectos`: todos los recursos de la plataforma.
 *
 * T05 (odd/tasks/admin-ui-redesign.md) le agrega filtro por docente, orden,
 * estado sincronizado a la URL (mismo criterio que `UsuariosTabla`, T03) y
 * una variante apilada para celular — T02 sólo había dejado filtro de estado
 * + búsqueda, siempre en tabla.
 *
 * No hace falta ninguna ruta nueva. `PATCH` y `DELETE` de
 * `/api/projects/[id]` ya pasan por `findProjectForActor`, que desde M8 deja
 * pasar a un ADMIN a cualquier proyecto; acá sólo se las llama.
 *
 * Abrir un recurso lleva al workspace normal, no a una vista aparte: es el
 * mismo editor con el que trabaja el docente, y `BannerAdmin.astro` avisa
 * arriba que el recurso es de otro. Editar el original, no una copia.
 */
export default function ProyectosTabla({ initialProyectos }: Props) {
  const [proyectos, setProyectos] = useState(initialProyectos);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoFiltros>(() => leerEstadoDeUrl());
  const [terminoDebounced, setTerminoDebounced] = useState(estado.busqueda);
  const inputBusquedaRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setTerminoDebounced(estado.busqueda), 150);
    return () => clearTimeout(id);
  }, [estado.busqueda]);

  useEffect(() => {
    escribirEstadoEnUrl({ ...estado, busqueda: terminoDebounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado.estado, estado.duenoId, estado.orden, terminoDebounced]);

  useAtajoBuscador(inputBusquedaRef);

  // Docentes con al menos un recurso, para el filtro — no hace falta pedirle
  // nada aparte al servidor: ya está en la misma lista.
  const duenos = useMemo(() => {
    const porId = new Map<string, string>();
    for (const p of proyectos) porId.set(p.duenoId, p.duenoNombre);
    return Array.from(porId, ([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [proyectos]);

  const visibles = useMemo(() => {
    const texto = terminoDebounced.trim().toLowerCase();
    let lista = proyectos.filter((p) => {
      if (estado.estado === 'publicados' && !p.isInGallery) return false;
      if (estado.estado === 'privados' && p.isInGallery) return false;
      if (estado.estado === 'demo' && !p.createdByDemo) return false;
      if (estado.duenoId && p.duenoId !== estado.duenoId) return false;
      if (texto && !p.title.toLowerCase().includes(texto) && !p.duenoNombre.toLowerCase().includes(texto)) return false;
      return true;
    });

    lista = [...lista].sort((a, b) => {
      if (estado.orden === 'likes') return b.likes - a.likes;
      if (estado.orden === 'titulo') return a.title.localeCompare(b.title, 'es');
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return lista;
  }, [proyectos, estado.estado, estado.duenoId, estado.orden, terminoDebounced]);

  const hayFiltrosActivos = estado.busqueda !== '' || estado.estado !== 'todos' || estado.duenoId !== '';

  function limpiarFiltros() {
    setEstado({ ...ESTADO_DEFAULT, orden: estado.orden });
  }

  async function alternarGaleria(proyecto: FilaProyectoAdmin) {
    setError(null);
    setPendingId(proyecto.id);

    const result = await apiRequest(`/api/projects/${proyecto.id}`, 'PATCH', {
      isInGallery: !proyecto.isInGallery,
    });

    setPendingId(null);

    if (!result.ok) {
      // El caso esperado: publicar un recurso sin portada lo rechaza el
      // servidor (specs/resource-publishing). El mensaje ya lo explica.
      setError(result.error);
      return;
    }

    setProyectos((actuales) =>
      actuales.map((p) => (p.id === proyecto.id ? { ...p, isInGallery: !p.isInGallery } : p)),
    );
  }

  async function borrar(proyecto: FilaProyectoAdmin) {
    const confirmado = window.confirm(
      `Vas a borrar «${proyecto.title}», de ${proyecto.duenoNombre}.\n\n` +
        'Se borra el recurso, sus conversaciones y sus archivos subidos. No se puede deshacer.\n\n' +
        'Si sólo querés sacarlo de la galería, cerrá esto y usá «Sacar de la galería».',
    );
    if (!confirmado) return;

    setError(null);
    setPendingId(proyecto.id);

    const result = await apiRequest(`/api/projects/${proyecto.id}`, 'DELETE');

    setPendingId(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setProyectos((actuales) => actuales.filter((p) => p.id !== proyecto.id));
  }

  function MenuAcciones({ proyecto }: { proyecto: FilaProyectoAdmin }) {
    return (
      <details data-menu className="relative">
        <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-ink-500 hover:text-ink-900">
          <span aria-hidden="true">···</span>
          <span className="sr-only">Acciones de {proyecto.title}</span>
        </summary>
        <div className="kodu-card absolute right-0 z-10 mt-1 w-56 overflow-hidden p-1 shadow-lg">
          <a href={`/app/project/${proyecto.id}`} className="block rounded-md px-3 py-2 text-sm text-ink-700 hover:bg-sutil">
            Abrir y editar
          </a>
          {proyecto.isInGallery && (
            <a href={`/p/${proyecto.slug}`} className="block rounded-md px-3 py-2 text-sm text-ink-700 hover:bg-sutil">
              Ver como lo ve el público
            </a>
          )}
          <button
            type="button"
            disabled={pendingId === proyecto.id}
            onClick={() => void alternarGaleria(proyecto)}
            className="block w-full rounded-md px-3 py-2 text-left text-sm text-ink-700 hover:bg-sutil disabled:opacity-50"
          >
            {proyecto.isInGallery ? 'Sacar de la galería' : 'Publicar en la galería'}
          </button>
          <button
            type="button"
            disabled={pendingId === proyecto.id}
            onClick={() => void borrar(proyecto)}
            className="block w-full rounded-md px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Borrar el recurso
          </button>
        </div>
      </details>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-sutil p-0.5">
          {ESTADOS.map((opcion) => (
            <button
              key={opcion.valor}
              type="button"
              aria-pressed={estado.estado === opcion.valor}
              onClick={() => setEstado((actual) => ({ ...actual, estado: opcion.valor }))}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                estado.estado === opcion.valor ? 'bg-superficie text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              {opcion.etiqueta}
            </button>
          ))}
        </div>

        <BuscadorAdmin
          id="buscar-proyecto"
          label="Buscar por título o docente"
          value={estado.busqueda}
          onChange={(valor) => setEstado((actual) => ({ ...actual, busqueda: valor }))}
          placeholder="Buscar por título o docente…"
          inputRef={inputBusquedaRef}
        />

        <select
          aria-label="Filtrar por docente"
          value={estado.duenoId}
          onChange={(evento) => setEstado((actual) => ({ ...actual, duenoId: evento.target.value }))}
          className="kodu-input w-auto text-sm"
        >
          <option value="">Todos los docentes</option>
          {duenos.map((dueno) => (
            <option key={dueno.id} value={dueno.id}>
              {dueno.nombre}
            </option>
          ))}
        </select>

        <select
          aria-label="Ordenar recursos"
          value={estado.orden}
          onChange={(evento) => setEstado((actual) => ({ ...actual, orden: evento.target.value as Orden }))}
          className="kodu-input w-auto text-sm"
        >
          <option value="recientes">Más recientes</option>
          <option value="likes">Más likes</option>
          <option value="titulo">Título</option>
        </select>

        <p className="text-xs text-ink-500">
          {visibles.length} de {proyectos.length}
        </p>

        {hayFiltrosActivos && (
          <button type="button" onClick={limpiarFiltros} className="text-xs text-brand-600 hover:underline">
            Limpiar filtros
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {visibles.length === 0 ? (
        <div className="kodu-card p-10 text-center text-sm text-ink-500">
          {proyectos.length === 0 ? (
            'Todavía no hay recursos en la plataforma.'
          ) : (
            <>
              <p>Ningún recurso coincide con estos filtros.</p>
              <button type="button" onClick={limpiarFiltros} className="mt-3 text-sm text-brand-600 hover:underline">
                Limpiar filtros
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Escritorio: tabla. */}
          <div className="kodu-card relative hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-linea text-xs text-ink-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Recurso</th>
                  <th className="px-4 py-3 font-medium">Docente</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 text-right font-medium">Likes</th>
                  <th className="px-4 py-3 font-medium">Última edición</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((proyecto) => (
                  <tr key={proyecto.id} className="border-b border-linea last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Portada proyecto={proyecto} />
                        <div className="min-w-0">
                          <a href={`/app/project/${proyecto.id}`} className="block font-medium text-ink-900 hover:text-brand-600">
                            {proyecto.title}
                          </a>
                          {proyecto.createdByDemo && <span className="text-xs text-ink-500">cuenta de demo</span>}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <a href={`/admin/usuarios/${proyecto.duenoId}`} className="text-ink-700 hover:text-brand-600">
                        {proyecto.duenoNombre}
                      </a>
                      {proyecto.ultimoAdmin && (
                        <span className="block text-xs text-ink-500">editado por {proyecto.ultimoAdmin}</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <span className={proyecto.isInGallery ? 'text-ink-900' : 'text-ink-500'}>
                        {proyecto.isInGallery ? 'En la galería' : 'Privado'}
                      </span>
                      {!proyecto.tienePortada && <span className="block text-xs text-ink-500">sin portada</span>}
                      {proyecto.portadaVieja && <span className="block text-xs text-ink-500">portada desactualizada</span>}
                    </td>

                    <td className="px-4 py-3 text-right tabular-nums text-ink-700">{proyecto.likes}</td>

                    <td className="px-4 py-3 whitespace-nowrap text-ink-500">{haceCuanto(proyecto.updatedAt)}</td>

                    <td className="px-4 py-3">
                      <MenuAcciones proyecto={proyecto} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Celular: tarjetas apiladas, mismos datos. */}
          <ul className="space-y-2 md:hidden">
            {visibles.map((proyecto) => (
              <li key={proyecto.id} className="kodu-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Portada proyecto={proyecto} />
                    <div className="min-w-0">
                      <a href={`/app/project/${proyecto.id}`} className="font-medium text-ink-900 hover:text-brand-600">
                        {proyecto.title}
                      </a>
                      <p className="text-xs text-ink-500">
                        <a href={`/admin/usuarios/${proyecto.duenoId}`} className="hover:text-brand-600">
                          {proyecto.duenoNombre}
                        </a>
                      </p>
                    </div>
                  </div>
                  <MenuAcciones proyecto={proyecto} />
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-xs">
                  <dt className="text-ink-500">Estado</dt>
                  <dd className="text-right text-ink-700">
                    {proyecto.isInGallery ? 'En la galería' : 'Privado'}
                    {!proyecto.tienePortada && ' · sin portada'}
                  </dd>
                  <dt className="text-ink-500">Likes</dt>
                  <dd className="text-right tabular-nums text-ink-700">{proyecto.likes}</dd>
                  <dt className="text-ink-500">Última edición</dt>
                  <dd className="text-right text-ink-700">{haceCuanto(proyecto.updatedAt)}</dd>
                  {proyecto.createdByDemo && (
                    <>
                      <dt className="text-ink-500">Origen</dt>
                      <dd className="text-right text-ink-700">cuenta de demo</dd>
                    </>
                  )}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
