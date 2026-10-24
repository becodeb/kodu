import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../lib/client/api.ts';
import type { FilaUsuarioAdmin } from '../../lib/admin/usuarios.ts';
import { inicialesAvatar, tonoPorId } from '../../lib/admin/avatar.ts';
import BuscadorAdmin, { useAtajoBuscador } from './BuscadorAdmin.tsx';

interface Props {
  initialUsuarios: FilaUsuarioAdmin[];
}

/**
 * La tabla de `/admin/usuarios` (odd/tasks/admin-ui-redesign.md, T03;
 * design.md — "The users table"; specs/ai-access-control/spec.md — "Per-user
 * override precedence").
 *
 * T01/T02 ya dejaban la lista estática (sin búsqueda, filtro ni orden) — T03
 * agrega las tres cosas TODAS del lado del cliente: la plataforma tiene
 * decenas de docentes, no miles, así que filtrar/ordenar el arreglo que ya
 * trajo el SSR es más simple y más rápido que ir y volver al servidor por
 * cada tecla. El estado vive sincronizado con la URL (`history.replaceState`,
 * nunca una navegación real) para que recargar o volver atrás reproduzca
 * exactamente la misma vista.
 *
 * El menú de acciones reusa `[data-menu]` de `BaseLayout.astro:126` — un
 * `<details>` nativo, foco/apertura/cierre por teclado sin ninguna línea de
 * JS propia (ver el comentario que ya dejó M1 en ese script).
 */

type FiltroRol = 'todos' | 'DOCENTE' | 'ADMIN';
type FiltroAcceso = 'todos' | 'Habilitado a mano' | 'Revocado a mano' | 'Por organización' | 'Cuenta personal';
type FiltroActividad = 'todos' | '7' | '30' | 'nunca';
type Campo = 'name' | 'proyectos' | 'tokens' | 'ultimaActividad';
type Direccion = 'asc' | 'desc';

interface EstadoFiltros {
  busqueda: string;
  rol: FiltroRol;
  acceso: FiltroAcceso;
  organizacion: string; // '' = todas, 'personal' = sin organización, sino el nombre
  actividad: FiltroActividad;
  campo: Campo;
  direccion: Direccion;
}

const ESTADO_DEFAULT: EstadoFiltros = {
  busqueda: '',
  rol: 'todos',
  acceso: 'todos',
  organizacion: '',
  actividad: 'todos',
  campo: 'name',
  direccion: 'asc',
};

function leerEstadoDeUrl(): EstadoFiltros {
  if (typeof window === 'undefined') return ESTADO_DEFAULT;
  const params = new URLSearchParams(window.location.search);
  return {
    busqueda: params.get('q') ?? '',
    rol: (params.get('rol') as FiltroRol) ?? 'todos',
    acceso: (params.get('acceso') as FiltroAcceso) ?? 'todos',
    organizacion: params.get('org') ?? '',
    actividad: (params.get('actividad') as FiltroActividad) ?? 'todos',
    campo: (params.get('orden') as Campo) ?? 'name',
    direccion: (params.get('dir') as Direccion) ?? 'asc',
  };
}

/** Escribe el estado en la URL sin navegar — la única forma de que "volver
 *  atrás" y "recargar" reproduzcan la misma vista sin pedirle nada al
 *  servidor (esta tabla filtra/ordena un arreglo que ya está en memoria). */
function escribirEstadoEnUrl(estado: EstadoFiltros): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams();
  if (estado.busqueda) params.set('q', estado.busqueda);
  if (estado.rol !== 'todos') params.set('rol', estado.rol);
  if (estado.acceso !== 'todos') params.set('acceso', estado.acceso);
  if (estado.organizacion) params.set('org', estado.organizacion);
  if (estado.actividad !== 'todos') params.set('actividad', estado.actividad);
  if (estado.campo !== 'name') params.set('orden', estado.campo);
  if (estado.direccion !== 'asc') params.set('dir', estado.direccion);
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState(null, '', url);
}

function Avatar({ id, nombre }: { id: string; nombre: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${tonoPorId(id)}`}
    >
      {inicialesAvatar(nombre)}
    </span>
  );
}

/** Mini sparkline de 14 días, puramente decorativa (el detalle del docente
 *  tiene el gráfico de verdad) — por eso sin `role="img"` propio ni tooltip:
 *  el `title` nativo alcanza, y no hay nada que un lector de pantalla deba
 *  anunciar fila por fila además del número de tokens que ya lee la celda. */
function Sparkline({ valores }: { valores: number[] }) {
  const max = Math.max(...valores, 1);
  const total = valores.reduce((suma, v) => suma + v, 0);
  if (total === 0) return null;
  const ancho = 56;
  const alto = 20;
  const paso = ancho / valores.length;
  const anchoBarra = Math.max(paso - 1.5, 1);
  return (
    <svg
      viewBox={`0 0 ${ancho} ${alto}`}
      width={ancho}
      height={alto}
      className="shrink-0 opacity-80"
      aria-hidden="true"
    >
      {valores.map((valor, indice) => {
        const altura = (valor / max) * alto;
        return (
          <rect
            key={indice}
            x={indice * paso}
            y={alto - altura}
            width={anchoBarra}
            height={Math.max(altura, valor > 0 ? 1 : 0)}
            className="fill-brand-600"
            fillOpacity={0.55}
          />
        );
      })}
    </svg>
  );
}

/**
 * Una cabecera de columna ordenable. Las columnas que NO ordenan (Rol,
 * Organización, Acceso a la IA, USD) quedan como `<th>` planos al lado — el
 * orden de columnas en sí mismo no cambió respecto de T02 (e2e/m5-usuarios.ts
 * lee celdas por índice), sólo se le agregó el botón a cuatro de ellas.
 */
function CabeceraOrdenable({
  campo,
  etiqueta,
  alinear,
  estado,
  onClick,
}: {
  campo: Campo;
  etiqueta: string;
  alinear?: 'right';
  estado: EstadoFiltros;
  onClick: (campo: Campo) => void;
}) {
  const activa = estado.campo === campo;
  return (
    <th
      aria-sort={activa ? (estado.direccion === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-4 py-3 font-medium ${alinear === 'right' ? 'text-right' : ''}`}
    >
      <button
        type="button"
        onClick={() => onClick(campo)}
        className={`inline-flex items-center gap-1 hover:text-ink-900 ${activa ? 'text-ink-900' : ''}`}
      >
        {etiqueta}
        {activa && <span aria-hidden="true">{estado.direccion === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}

/** El estado de acceso a la IA como pastilla compacta de una sola línea —
 *  antes era texto corrido y "Por organización" rompía en dos renglones en
 *  la columna angosta (parent review, polish #2). */
function PildoraAcceso({ valor }: { valor: FilaUsuarioAdmin['accesoIa'] }) {
  return (
    <span className="inline-flex items-center rounded-full bg-sutil px-2 py-0.5 text-xs whitespace-nowrap text-ink-700">
      {valor}
    </span>
  );
}

function ultimaActividadOrdenMs(usuario: FilaUsuarioAdmin): number {
  return usuario.ultimaActividadIso ? new Date(usuario.ultimaActividadIso).getTime() : -Infinity;
}

function actividadDesde(usuario: FilaUsuarioAdmin, dias: number): boolean {
  if (!usuario.ultimaActividadIso) return false;
  const limite = Date.now() - dias * 24 * 60 * 60 * 1000;
  return new Date(usuario.ultimaActividadIso).getTime() >= limite;
}

export default function UsuariosTabla({ initialUsuarios }: Props) {
  const [usuarios, setUsuarios] = useState(initialUsuarios);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoFiltros>(() => leerEstadoDeUrl());
  const [terminoDebounced, setTerminoDebounced] = useState(estado.busqueda);
  const inputBusquedaRef = useRef<HTMLInputElement | null>(null);

  // Debounce de la búsqueda: 150ms sin tipear antes de filtrar — bastante
  // corto porque filtrar el arreglo ya en memoria es barato, pero evita
  // recalcular en cada tecla de un nombre largo.
  useEffect(() => {
    const id = setTimeout(() => setTerminoDebounced(estado.busqueda), 150);
    return () => clearTimeout(id);
  }, [estado.busqueda]);

  useEffect(() => {
    escribirEstadoEnUrl({ ...estado, busqueda: terminoDebounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado.rol, estado.acceso, estado.organizacion, estado.actividad, estado.campo, estado.direccion, terminoDebounced]);

  useAtajoBuscador(inputBusquedaRef);

  const organizaciones = useMemo(() => {
    const nombres = new Set<string>();
    for (const usuario of usuarios) if (usuario.organizationName) nombres.add(usuario.organizationName);
    return Array.from(nombres).sort((a, b) => a.localeCompare(b, 'es'));
  }, [usuarios]);

  const filtrados = useMemo(() => {
    const texto = terminoDebounced.trim().toLowerCase();
    let visibles = usuarios.filter((usuario) => {
      if (estado.rol !== 'todos' && usuario.role !== estado.rol) return false;
      if (estado.acceso !== 'todos' && usuario.accesoIa !== estado.acceso) return false;
      if (estado.organizacion === 'personal' && usuario.organizationName) return false;
      if (estado.organizacion && estado.organizacion !== 'personal' && usuario.organizationName !== estado.organizacion) return false;
      if (estado.actividad === '7' && !actividadDesde(usuario, 7)) return false;
      if (estado.actividad === '30' && !actividadDesde(usuario, 30)) return false;
      if (estado.actividad === 'nunca' && usuario.ultimaActividadIso !== null) return false;
      if (texto && !usuario.name.toLowerCase().includes(texto) && !usuario.email.toLowerCase().includes(texto)) return false;
      return true;
    });

    const signo = estado.direccion === 'asc' ? 1 : -1;
    visibles = [...visibles].sort((a, b) => {
      if (estado.campo === 'name') return signo * a.name.localeCompare(b.name, 'es');
      if (estado.campo === 'proyectos') return signo * (a.proyectos - b.proyectos);
      if (estado.campo === 'tokens') return signo * (a.tokens - b.tokens);
      return signo * (ultimaActividadOrdenMs(a) - ultimaActividadOrdenMs(b));
    });

    return visibles;
  }, [usuarios, estado.rol, estado.acceso, estado.organizacion, estado.actividad, estado.campo, estado.direccion, terminoDebounced]);

  const hayFiltrosActivos =
    estado.busqueda !== '' ||
    estado.rol !== 'todos' ||
    estado.acceso !== 'todos' ||
    estado.organizacion !== '' ||
    estado.actividad !== 'todos';

  function limpiarFiltros() {
    setEstado({ ...ESTADO_DEFAULT, campo: estado.campo, direccion: estado.direccion });
  }

  function alternarOrden(campo: Campo) {
    setEstado((actual) =>
      actual.campo === campo
        ? { ...actual, direccion: actual.direccion === 'asc' ? 'desc' : 'asc' }
        : { ...actual, campo, direccion: 'asc' },
    );
  }

  async function alternarRol(usuario: FilaUsuarioAdmin) {
    setError(null);
    setPendingId(usuario.id);
    const nuevoRol = usuario.role === 'ADMIN' ? 'DOCENTE' : 'ADMIN';

    const result = await apiRequest<{ usuario: { id: string; role: 'DOCENTE' | 'ADMIN' } }>(
      `/api/admin/users/${usuario.id}`,
      'PATCH',
      { role: nuevoRol },
    );

    setPendingId(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setUsuarios((actuales) =>
      actuales.map((item) => (item.id === usuario.id ? { ...item, role: result.data.usuario.role } : item)),
    );
  }

  /**
   * `aiAccessOverride` es de tres estados y el `null` es un valor explícito
   * ("volver a la regla del dominio"), así que el body siempre manda la
   * clave — nunca se omite para "no tocar nada" (ver `[id].ts`). El backend
   * devuelve `accesoIa` ya recalculado (incluida la regla de la organización cuando
   * corresponde), así que acá no se reimplementa esa lógica.
   */
  async function fijarAccesoIa(usuario: FilaUsuarioAdmin, nuevo: boolean | null) {
    setError(null);
    setPendingId(usuario.id);

    const result = await apiRequest<{
      usuario: { id: string; aiAccessOverride: boolean | null; accesoIa: string };
    }>(`/api/admin/users/${usuario.id}`, 'PATCH', { aiAccessOverride: nuevo });

    setPendingId(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    const { aiAccessOverride, accesoIa } = result.data.usuario;
    setUsuarios((actuales) =>
      actuales.map((item) => (item.id === usuario.id ? { ...item, aiAccessOverride, accesoIa } : item)),
    );
  }

  function alHacerClicEnFila(evento: React.MouseEvent<HTMLElement>, id: string) {
    const objetivo = evento.target as HTMLElement;
    if (objetivo.closest('a, button, [data-menu]')) return;
    window.location.href = `/admin/usuarios/${id}`;
  }

  function MenuAcciones({ usuario }: { usuario: FilaUsuarioAdmin }) {
    return (
      <details className="relative inline-block text-left" data-menu>
        <summary
          className="cursor-pointer list-none rounded-md px-2 py-1 text-ink-500 hover:bg-sutil"
          aria-label={`Acciones para ${usuario.name}`}
        >
          ⋯
        </summary>
        <div className="kodu-card absolute right-0 z-50 mt-1 w-56 overflow-hidden p-1 shadow-lg">
          <button
            type="button"
            disabled={pendingId === usuario.id}
            onClick={() => void alternarRol(usuario)}
            className="block w-full rounded-md px-3 py-2 text-left text-ink-700 hover:bg-sutil disabled:opacity-50"
          >
            {usuario.role === 'ADMIN' ? 'Quitar administrador' : 'Hacer administrador'}
          </button>
          {usuario.aiAccessOverride !== true && (
            <button
              type="button"
              disabled={pendingId === usuario.id}
              onClick={() => void fijarAccesoIa(usuario, true)}
              className="block w-full rounded-md px-3 py-2 text-left text-ink-700 hover:bg-sutil disabled:opacity-50"
            >
              Habilitar la IA
            </button>
          )}
          {usuario.aiAccessOverride !== false && (
            <button
              type="button"
              disabled={pendingId === usuario.id}
              onClick={() => void fijarAccesoIa(usuario, false)}
              className="block w-full rounded-md px-3 py-2 text-left text-ink-700 hover:bg-sutil disabled:opacity-50"
            >
              Bloquear la IA
            </button>
          )}
          {usuario.aiAccessOverride !== null && (
            <button
              type="button"
              disabled={pendingId === usuario.id}
              onClick={() => void fijarAccesoIa(usuario, null)}
              className="block w-full rounded-md px-3 py-2 text-left text-ink-700 hover:bg-sutil disabled:opacity-50"
            >
              Volver a la regla de la organización
            </button>
          )}
          <a href={`/admin/usuarios/${usuario.id}`} className="block rounded-md px-3 py-2 text-ink-700 hover:bg-sutil">
            Ver ficha
          </a>
        </div>
      </details>
    );
  }

  if (usuarios.length === 0) {
    return (
      <div className="kodu-card p-10 text-center text-sm text-ink-500">
        Todavía no hay ningún docente registrado.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <BuscadorAdmin
          id="buscar-docente"
          label="Buscar por nombre o email"
          value={estado.busqueda}
          onChange={(valor) => setEstado((actual) => ({ ...actual, busqueda: valor }))}
          placeholder="Buscar por nombre o email…"
          inputRef={inputBusquedaRef}
        />

        <select
          aria-label="Filtrar por rol"
          value={estado.rol}
          onChange={(evento) => setEstado((actual) => ({ ...actual, rol: evento.target.value as FiltroRol }))}
          className="kodu-input w-auto text-sm"
        >
          <option value="todos">Todos los roles</option>
          <option value="DOCENTE">Docentes</option>
          <option value="ADMIN">Admins</option>
        </select>

        <select
          aria-label="Filtrar por acceso a la IA"
          value={estado.acceso}
          onChange={(evento) => setEstado((actual) => ({ ...actual, acceso: evento.target.value as FiltroAcceso }))}
          className="kodu-input w-auto text-sm"
        >
          <option value="todos">Cualquier acceso a la IA</option>
          <option value="Habilitado a mano">Habilitado a mano</option>
          <option value="Revocado a mano">Revocado a mano</option>
          <option value="Por organización">Por organización</option>
          <option value="Cuenta personal">Cuenta personal</option>
        </select>

        <select
          aria-label="Filtrar por organización"
          value={estado.organizacion}
          onChange={(evento) => setEstado((actual) => ({ ...actual, organizacion: evento.target.value }))}
          className="kodu-input w-auto text-sm"
        >
          <option value="">Todas las organizaciones</option>
          <option value="personal">Cuenta personal</option>
          {organizaciones.map((nombre) => (
            <option key={nombre} value={nombre}>
              {nombre}
            </option>
          ))}
        </select>

        <select
          aria-label="Filtrar por actividad"
          value={estado.actividad}
          onChange={(evento) => setEstado((actual) => ({ ...actual, actividad: evento.target.value as FiltroActividad }))}
          className="kodu-input w-auto text-sm"
        >
          <option value="todos">Cualquier actividad</option>
          <option value="7">Activos en 7 días</option>
          <option value="30">Activos en 30 días</option>
          <option value="nunca">Nunca</option>
        </select>

        <p className="text-xs text-ink-500">
          {filtrados.length} de {usuarios.length} docentes
        </p>

        {hayFiltrosActivos && (
          <button type="button" onClick={limpiarFiltros} className="text-xs text-brand-600 hover:underline">
            Limpiar filtros
          </button>
        )}
      </div>

      {filtrados.length === 0 ? (
        <div className="kodu-card p-10 text-center text-sm text-ink-500">
          <p>Ningún docente coincide con estos filtros.</p>
          <button type="button" onClick={limpiarFiltros} className="mt-3 text-sm text-brand-600 hover:underline">
            Limpiar filtros
          </button>
        </div>
      ) : (
        <>
          {/* Escritorio: tabla. Las columnas y el texto de cada celda son
              exactamente los que ya cubre e2e/m5-usuarios.ts. */}
          <div className="kodu-card relative hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-linea text-xs text-ink-500">
                <tr>
                  <CabeceraOrdenable campo="name" etiqueta="Docente" estado={estado} onClick={alternarOrden} />
                  <th className="px-4 py-3 font-medium">Rol</th>
                  <th className="px-4 py-3 font-medium">Organización</th>
                  <th className="px-4 py-3 font-medium">Acceso a la IA</th>
                  <CabeceraOrdenable campo="proyectos" etiqueta="Recursos" alinear="right" estado={estado} onClick={alternarOrden} />
                  <CabeceraOrdenable campo="tokens" etiqueta="Tokens" alinear="right" estado={estado} onClick={alternarOrden} />
                  <th className="px-4 py-3 text-right font-medium">USD</th>
                  <CabeceraOrdenable campo="ultimaActividad" etiqueta="Última actividad" estado={estado} onClick={alternarOrden} />
                  <th className="px-4 py-3">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((usuario) => (
                  <tr
                    key={usuario.id}
                    onClick={(evento) => alHacerClicEnFila(evento, usuario.id)}
                    className="cursor-pointer border-b border-linea last:border-0 hover:bg-sutil/60"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar id={usuario.id} nombre={usuario.name} />
                        <div className="min-w-0">
                          <a
                            href={`/admin/usuarios/${usuario.id}`}
                            className="flex items-center gap-1.5 font-medium text-ink-900 hover:text-brand-600"
                          >
                            {usuario.name}
                          </a>
                          <span className="flex items-center gap-1.5 text-xs text-ink-500">
                            {usuario.email}
                            {usuario.esGoogle && (
                              <span
                                title="Inició sesión con Google"
                                aria-label="Cuenta de Google"
                                className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-linea text-[9px] leading-none text-ink-500"
                              >
                                G
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-700">{usuario.role === 'ADMIN' ? 'Admin' : 'Docente'}</td>
                    <td className="px-4 py-3 text-ink-700">
                      {usuario.organizationName && usuario.organizationId ? (
                        <a href={`/admin/organizaciones/${usuario.organizationId}`} className="hover:text-brand-600">
                          {usuario.organizationName}
                        </a>
                      ) : (
                        'Cuenta personal'
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-700">
                      <PildoraAcceso valor={usuario.accesoIa} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-700">{usuario.proyectos}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-700">
                      <div className="flex items-center justify-end gap-2">
                        <Sparkline valores={usuario.sparkline} />
                        <span>{usuario.tokens.toLocaleString('es-AR')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums text-ink-900">
                      {usuario.costoDisplay}
                    </td>
                    <td className="px-4 py-3 text-ink-500">{usuario.ultimaActividad}</td>
                    <td className="px-4 py-3 text-right">
                      <MenuAcciones usuario={usuario} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Celular: tarjetas apiladas, mismos datos. */}
          <ul className="space-y-2 md:hidden">
            {filtrados.map((usuario) => (
              <li
                key={usuario.id}
                onClick={(evento) => alHacerClicEnFila(evento, usuario.id)}
                className="kodu-card cursor-pointer p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Avatar id={usuario.id} nombre={usuario.name} />
                    <div className="min-w-0">
                      <a href={`/admin/usuarios/${usuario.id}`} className="font-medium text-ink-900 hover:text-brand-600">
                        {usuario.name}
                      </a>
                      <p className="flex items-center gap-1.5 text-xs text-ink-500">
                        {usuario.email}
                        {usuario.esGoogle && (
                          <span
                            aria-label="Cuenta de Google"
                            className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-linea text-[9px] leading-none text-ink-500"
                          >
                            G
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <MenuAcciones usuario={usuario} />
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-xs">
                  <dt className="text-ink-500">Rol</dt>
                  <dd className="text-right text-ink-700">{usuario.role === 'ADMIN' ? 'Admin' : 'Docente'}</dd>
                  <dt className="text-ink-500">Organización</dt>
                  <dd className="text-right text-ink-700">{usuario.organizationName ?? 'Cuenta personal'}</dd>
                  <dt className="text-ink-500">Acceso a la IA</dt>
                  <dd className="text-right text-ink-700">
                    <PildoraAcceso valor={usuario.accesoIa} />
                  </dd>
                  <dt className="text-ink-500">Recursos</dt>
                  <dd className="text-right tabular-nums text-ink-700">{usuario.proyectos}</dd>
                  <dt className="text-ink-500">Consumo</dt>
                  <dd className="text-right tabular-nums text-ink-700">
                    {usuario.tokens.toLocaleString('es-AR')} tokens · {usuario.costoDisplay}
                  </dd>
                  <dt className="text-ink-500">Última actividad</dt>
                  <dd className="text-right text-ink-700">{usuario.ultimaActividad}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
