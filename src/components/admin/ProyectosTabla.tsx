import { useMemo, useState } from 'react';
import { apiRequest } from '../../lib/client/api.ts';
import type { FilaProyectoAdmin } from '../../lib/admin/proyectos.ts';

interface Props {
  initialProyectos: FilaProyectoAdmin[];
}

type Filtro = 'todos' | 'publicados' | 'privados' | 'demo';

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'publicados', etiqueta: 'En la galería' },
  { valor: 'privados', etiqueta: 'Privados' },
  { valor: 'demo', etiqueta: 'De la demo' },
];

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

/**
 * La tabla de `/admin/proyectos`: todos los recursos de la plataforma.
 *
 * No hace falta ninguna ruta nueva. `PATCH` y `DELETE` de
 * `/api/projects/[id]` ya pasan por `findProjectForActor`, que desde M8 deja
 * pasar a un ADMIN a cualquier recurso; acá sólo se las llama.
 *
 * Abrir un recurso lleva al workspace normal, no a una vista aparte: es el
 * mismo editor con el que trabaja el docente, y `BannerAdmin.astro` avisa
 * arriba que el recurso es de otro. Editar el original, no una copia.
 */
export default function ProyectosTabla({ initialProyectos }: Props) {
  const [proyectos, setProyectos] = useState(initialProyectos);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busqueda, setBusqueda] = useState('');

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return proyectos.filter((p) => {
      if (filtro === 'publicados' && !p.isInGallery) return false;
      if (filtro === 'privados' && p.isInGallery) return false;
      if (filtro === 'demo' && !p.createdByDemo) return false;
      if (texto === '') return true;
      return (
        p.title.toLowerCase().includes(texto) || p.duenoNombre.toLowerCase().includes(texto)
      );
    });
  }, [proyectos, filtro, busqueda]);

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-sutil p-0.5">
          {FILTROS.map((opcion) => (
            <button
              key={opcion.valor}
              type="button"
              aria-pressed={filtro === opcion.valor}
              onClick={() => setFiltro(opcion.valor)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filtro === opcion.valor
                  ? 'bg-superficie text-ink-900 shadow-sm'
                  : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              {opcion.etiqueta}
            </button>
          ))}
        </div>

        <div className="min-w-48 flex-1">
          <label className="sr-only" htmlFor="buscar-proyecto">
            Buscar por título o docente
          </label>
          <input
            id="buscar-proyecto"
            type="search"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
            placeholder="Buscar por título o docente…"
            className="kodu-input"
          />
        </div>

        <p className="text-xs text-ink-500">
          {visibles.length} de {proyectos.length}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {visibles.length === 0 ? (
        <div className="kodu-card p-10 text-center text-sm text-ink-500">
          {proyectos.length === 0
            ? 'Todavía no hay recursos en la plataforma.'
            : 'Ningún recurso coincide con lo que buscaste.'}
        </div>
      ) : (
        <div className="kodu-card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-linea text-xs text-ink-500 uppercase">
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
                    <a
                      href={`/app/project/${proyecto.id}`}
                      className="block font-medium text-ink-900 hover:text-brand-600"
                    >
                      {proyecto.title}
                    </a>
                    {proyecto.createdByDemo && (
                      <span className="text-xs text-ink-500">cuenta de demo</span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <a
                      href={`/admin/usuarios/${proyecto.duenoId}`}
                      className="text-ink-700 hover:text-brand-600"
                    >
                      {proyecto.duenoNombre}
                    </a>
                    {proyecto.ultimoAdmin && (
                      <span className="block text-xs text-ink-500">
                        editado por {proyecto.ultimoAdmin}
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <span className={proyecto.isInGallery ? 'text-ink-900' : 'text-ink-500'}>
                      {proyecto.isInGallery ? 'En la galería' : 'Privado'}
                    </span>
                    {!proyecto.tienePortada && (
                      <span className="block text-xs text-ink-500">sin portada</span>
                    )}
                    {proyecto.portadaVieja && (
                      <span className="block text-xs text-ink-500">portada desactualizada</span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right tabular-nums text-ink-700">
                    {proyecto.likes}
                  </td>

                  <td className="px-4 py-3 text-ink-500">{haceCuanto(proyecto.updatedAt)}</td>

                  <td className="px-4 py-3">
                    <details data-menu className="relative">
                      <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-ink-500 hover:text-ink-900">
                        <span aria-hidden="true">···</span>
                        <span className="sr-only">Acciones de {proyecto.title}</span>
                      </summary>
                      <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-linea bg-superficie p-1 shadow-lg">
                        <a
                          href={`/app/project/${proyecto.id}`}
                          className="block rounded-md px-3 py-2 text-sm text-ink-700 hover:bg-sutil"
                        >
                          Abrir y editar
                        </a>
                        {proyecto.isInGallery && (
                          <a
                            href={`/p/${proyecto.slug}`}
                            className="block rounded-md px-3 py-2 text-sm text-ink-700 hover:bg-sutil"
                          >
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
