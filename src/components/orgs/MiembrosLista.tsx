import { useMemo, useState } from 'react';
import Modal from '../workspace/Modal.tsx';
import type { MiembroOrganizacion } from '../../lib/orgs/gestion.ts';
import { haceTiempo } from '../../lib/format/fecha.ts';
import {
  filtrarYOrdenar,
  type FiltroMiembros,
  type OrdenMiembros,
} from '../../lib/orgs/filtrarMiembros.ts';
import InsigniaFacturacion from './InsigniaFacturacion.tsx';
import MenuAcciones, { type AccionMenu } from './MenuAcciones.tsx';

/**
 * Deliberadamente MÁS CHICO que `OrganizacionResumen` (gestion.ts): esto sólo
 * necesita mostrar un nombre y devolver un id — el admin de organización
 * (`/org`) los saca de `campusesAdministrables` (alcance.ts, sólo
 * `{id,name,parentId}`), el superadmin (`OrganizacionDetalle.tsx`) de un
 * `OrganizacionResumen` completo. Un `SedeDestino[]` sigue siendo
 * asignable acá (subtipado estructural), así que ningún llamador existente
 * cambia.
 */
export interface SedeDestino {
  id: string;
  name: string;
}

/**
 * odd/tasks/organizaciones.md (T8): lista de docentes de UNA sede (CAMPUS),
 * compartida entre `/admin/organizaciones/[id]` (superadmin,
 * `OrganizacionDetalle.tsx`) y `/org` (admin de organización, T8) — la
 * "deuda para T8" de T6: a 360px la tabla vieja truncaba nombres y "Dar de
 * baja" quedaba en 3 renglones. Acá se resuelve con dos layouts, nunca los
 * dos visibles a la vez (mismo criterio que `/admin/metricas`): tarjetas
 * abajo de `sm:`, tabla arriba.
 *
 * Container/presentational: este componente NO sabe a qué API le pega — sólo
 * dispara callbacks (`onPromover`/`onDegradar`/`onQuitar`/`onMover`) que cada
 * página implementa con su propio cliente HTTP (los dos árboles de rutas,
 * `/api/admin/organizaciones/**` y `/api/org/**`, tienen formas parecidas
 * pero no idénticas). Lo único que SÍ vive acá, para que sea IDÉNTICO en las
 * dos pantallas, es el texto de la confirmación de "Dar de baja" (el dueño lo
 * pidió textual en el reparto de T8) y el modal de "Mover a otra sede" —
 * `cargarDestinos` es la única pieza que varía entre contextos.
 *
 * La lista es una herramienta de consulta más que de edición, así que lo que
 * pesa es encontrar a alguien: barra de búsqueda / filtro / orden arriba
 * (`filtrarMiembros.ts`) y, por fila, UN solo menú "⋯" con las acciones
 * (`MenuAcciones`). "admin" y "Facturación" son etiquetas mínimas pegadas al
 * nombre, no una columna.
 */

export function verificacionLabel(fuente: MiembroOrganizacion['emailVerificationSource']): string {
  if (fuente === 'GOOGLE') return 'Verificado (Google)';
  if (fuente === 'EMAIL') return 'Verificado (email)';
  if (fuente === 'NO_PROVIDER') return 'Sin verificar (sin Resend)';
  return 'Sin verificar';
}

function mensajeBaja(miembro: MiembroOrganizacion, organizationNombre: string): string {
  return (
    `¿Dar de baja a ${miembro.name} de ${organizationNombre}?\n\n` +
    'Su cuenta pasa a ser personal y pierde acceso a la IA. Sus recursos se conservan. ' +
    'No va a poder volver a unirse por el dominio de esta sede (sí por una invitación o si se lo agrega de nuevo a la lista blanca).'
  );
}

export interface MiembrosListaProps {
  miembros: MiembroOrganizacion[];
  organizationNombre: string;
  pending: boolean;
  /** Sólo un admin de RED (o el superadmin) puede mover docentes entre sedes. */
  puedeMover: boolean;
  onPromover: (miembro: MiembroOrganizacion) => void | Promise<void>;
  onDegradar: (miembro: MiembroOrganizacion) => void | Promise<void>;
  /** Ya confirmado por ESTE componente (ver `mensajeBaja`) — el llamador no vuelve a preguntar. */
  onQuitar: (miembro: MiembroOrganizacion) => void | Promise<void>;
  /**
   * odd/tasks/org-admin-facturacion.md: ¿quien mira gestiona la facturación?
   * Si NO, el titular de la facturación (insignia "Facturación") queda
   * protegido: sin "Sacar admin", "Mover" ni "Dar de baja" (el servidor lo
   * vuelve a exigir). Por defecto sí: el superadmin no tiene restricción.
   */
  puedeGestionarFacturacion?: boolean;
  /** Si viene, un admin de la raíz muestra "Dar/Quitar facturación". Sólo para quien la gestiona. */
  onFacturacion?: (miembro: MiembroOrganizacion, canManageBilling: boolean) => void | Promise<void>;
  /** Sólo hace falta si `puedeMover`. */
  cargarDestinos?: () => Promise<SedeDestino[]>;
  onMover?: (miembro: MiembroOrganizacion, destinoCampusId: string) => void | Promise<void>;
  /**
   * Muestra la columna "Verificación". El admin de organización no la necesita
   * (por eso es opt-in); el superadmin, en `/admin`, sí.
   */
  mostrarVerificacion?: boolean;
}

const FILTROS: { valor: FiltroMiembros; etiqueta: string }[] = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'admins', etiqueta: 'Admins' },
  { valor: 'docentes', etiqueta: 'Docentes' },
  { valor: 'inactivos', etiqueta: 'Sin actividad (30 días)' },
];

const ORDENES: { valor: OrdenMiembros; etiqueta: string }[] = [
  { valor: 'nombre', etiqueta: 'Nombre (A–Z)' },
  { valor: 'recursos', etiqueta: 'Más recursos' },
  { valor: 'actividad', etiqueta: 'Actividad más reciente' },
];

/** Etiqueta mínima, a propósito: el nombre manda, esto es sólo una pista. */
function EtiquetaAdmin() {
  return (
    <span className="shrink-0 rounded border border-linea px-1 text-[10px] leading-4 font-medium text-ink-500">admin</span>
  );
}

function Etiquetas({ miembro }: { miembro: MiembroOrganizacion }) {
  if (!miembro.esAdmin && !miembro.facturacion) return null;
  return (
    <>
      {miembro.esAdmin && <EtiquetaAdmin />}
      {miembro.facturacion && <InsigniaFacturacion compacta />}
    </>
  );
}

export default function MiembrosLista(props: MiembrosListaProps) {
  const { miembros, organizationNombre, pending, puedeMover } = props;
  const puedeGestionarFacturacion = props.puedeGestionarFacturacion ?? true;
  const mostrarVerificacion = props.mostrarVerificacion ?? false;
  const titulares = miembros.filter((m) => m.esAdmin && m.facturacion).length;
  const [moviendo, setMoviendo] = useState<MiembroOrganizacion | null>(null);
  const [destinos, setDestinos] = useState<SedeDestino[] | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<FiltroMiembros>('todos');
  const [orden, setOrden] = useState<OrdenMiembros>('nombre');

  const visibles = useMemo(
    () => filtrarYOrdenar(miembros, { busqueda, filtro, orden }),
    [miembros, busqueda, filtro, orden],
  );
  const hayConsulta = busqueda.trim() !== '' || filtro !== 'todos';

  async function abrirMover(miembro: MiembroOrganizacion) {
    setMoviendo(miembro);
    setDestinos(null);
    if (!props.cargarDestinos) return;
    const lista = await props.cargarDestinos();
    setDestinos(lista);
  }

  async function confirmarMover(destinoCampusId: string) {
    if (!moviendo || !props.onMover) return;
    await props.onMover(moviendo, destinoCampusId);
    setMoviendo(null);
    setDestinos(null);
  }

  function quitar(miembro: MiembroOrganizacion) {
    if (!window.confirm(mensajeBaja(miembro, organizationNombre))) return;
    void props.onQuitar(miembro);
  }

  /** Titular de la facturación que quien mira no puede tocar. */
  function protegido(miembro: MiembroOrganizacion): boolean {
    return miembro.facturacion && !puedeGestionarFacturacion;
  }

  /** Las acciones de UNA fila, con las mismas reglas de siempre: lo que no corresponde no se ofrece. */
  function accionesDe(miembro: MiembroOrganizacion): AccionMenu[] {
    if (protegido(miembro)) {
      return [{ id: 'protegido', etiqueta: 'Sólo otro admin con facturación puede cambiarlo.', deshabilitada: true }];
    }
    const acciones: AccionMenu[] = [
      {
        id: 'admin',
        etiqueta: miembro.esAdmin ? 'Sacar admin' : 'Hacer admin',
        deshabilitada: pending,
        onSelect: () => void (miembro.esAdmin ? props.onDegradar(miembro) : props.onPromover(miembro)),
      },
    ];
    if (props.onFacturacion && miembro.esAdmin) {
      const unico = miembro.facturacion && titulares <= 1;
      acciones.push({
        id: 'facturacion',
        etiqueta: miembro.facturacion ? 'Quitar facturación' : 'Dar facturación',
        deshabilitada: pending || unico,
        titulo: unico ? 'Tiene que quedar al menos un admin con facturación.' : undefined,
        onSelect: () => void props.onFacturacion!(miembro, !miembro.facturacion),
      });
    }
    if (puedeMover) {
      acciones.push({ id: 'mover', etiqueta: 'Mover a otra sede', deshabilitada: pending, onSelect: () => void abrirMover(miembro) });
    }
    acciones.push({
      id: 'baja',
      etiqueta: 'Dar de baja',
      peligrosa: true,
      separada: true,
      deshabilitada: pending,
      onSelect: () => quitar(miembro),
    });
    return acciones;
  }

  function limpiar() {
    setBusqueda('');
    setFiltro('todos');
  }

  if (miembros.length === 0) {
    return <p className="text-sm text-ink-500">Todavía no tiene ningún docente.</p>;
  }

  return (
    <>
      <div className="mb-3 space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="search"
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            placeholder="Buscar por nombre o email"
            aria-label="Buscar docente por nombre o email"
            autoComplete="off"
            className="kodu-input min-w-0 sm:flex-1"
          />
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <select
              value={filtro}
              onChange={(evento) => setFiltro(evento.target.value as FiltroMiembros)}
              aria-label="Filtrar docentes"
              className="kodu-input min-w-0 sm:w-auto"
            >
              {FILTROS.map((f) => (
                <option key={f.valor} value={f.valor}>
                  {f.etiqueta}
                </option>
              ))}
            </select>
            <select
              value={orden}
              onChange={(evento) => setOrden(evento.target.value as OrdenMiembros)}
              aria-label="Ordenar docentes"
              className="kodu-input min-w-0 sm:w-auto"
            >
              {ORDENES.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p role="status" className="text-xs text-ink-500">
          {visibles.length} de {miembros.length} {miembros.length === 1 ? 'docente' : 'docentes'}
        </p>
      </div>

      {visibles.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-linea p-6 text-center">
          <p className="text-sm text-ink-700">Ningún docente coincide con lo que buscás.</p>
          {hayConsulta && (
            <button type="button" onClick={limpiar} className="kodu-btn-ghost mt-3 px-3 py-1.5 text-xs">
              Limpiar búsqueda y filtros
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Tabla — sólo `sm:` en adelante (ver comentario de arriba). */}
          <div className="hidden sm:block">
            <table className="w-full table-fixed text-left text-sm">
              <colgroup>
                <col />
                {mostrarVerificacion && <col className="w-44" />}
                <col className="w-24" />
                <col className="w-40" />
                <col className="w-12" />
              </colgroup>
              <thead className="border-b border-linea text-xs text-ink-500 uppercase">
                <tr>
                  <th className="truncate py-2 pr-2 font-medium">Docente</th>
                  {mostrarVerificacion && <th className="truncate py-2 pr-2 font-medium">Verificación</th>}
                  <th className="truncate py-2 pr-2 text-right font-medium">Recursos</th>
                  <th className="truncate py-2 pr-2 pl-4 font-medium">Última actividad</th>
                  <th className="py-2 text-right font-medium">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((miembro) => (
                  <tr key={miembro.id} className="border-b border-linea last:border-0 align-middle">
                    <td className="py-2 pr-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <p className="truncate font-medium text-ink-900" title={miembro.name}>
                          {miembro.name}
                        </p>
                        <Etiquetas miembro={miembro} />
                      </div>
                      <p className="truncate text-xs text-ink-500" title={miembro.email}>
                        {miembro.email}
                      </p>
                    </td>
                    {mostrarVerificacion && (
                      <td className="py-2 pr-2 text-xs text-ink-700">{verificacionLabel(miembro.emailVerificationSource)}</td>
                    )}
                    <td className="py-2 pr-2 text-right tabular-nums text-ink-700">{miembro.recursos}</td>
                    <td className="py-2 pr-2 pl-4 text-xs text-ink-700">{haceTiempo(miembro.ultimaActividad)}</td>
                    <td className="py-2 text-right">
                      <MenuAcciones etiqueta={`Acciones para ${miembro.name}`} acciones={accionesDe(miembro)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tarjetas — sólo debajo de `sm:`. Nada de tabla acá: no hay ancho de
              columna que pueda desbordar la página a 360px. */}
          <div className="space-y-2 sm:hidden">
            {visibles.map((miembro) => (
              <div key={miembro.id} className="kodu-card py-2 pr-1.5 pl-3">
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0 pt-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate font-medium text-ink-900">{miembro.name}</p>
                      <Etiquetas miembro={miembro} />
                    </div>
                    <p className="truncate text-xs text-ink-500">{miembro.email}</p>
                  </div>
                  <MenuAcciones etiqueta={`Acciones para ${miembro.name}`} acciones={accionesDe(miembro)} />
                </div>

                <dl className="mt-1 mr-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-700">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-500">Recursos</dt>
                    <dd className="tabular-nums">{miembro.recursos}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-500">Actividad</dt>
                    <dd>{haceTiempo(miembro.ultimaActividad)}</dd>
                  </div>
                  {mostrarVerificacion && (
                    <div className="col-span-2 flex justify-between gap-2">
                      <dt className="text-ink-500">Verificación</dt>
                      <dd className="text-right">{verificacionLabel(miembro.emailVerificationSource)}</dd>
                    </div>
                  )}
                </dl>
              </div>
            ))}
          </div>
        </>
      )}

      {moviendo && (
        <Modal
          abierto
          titulo="Mover a otra sede"
          descripcion="El historial de consumo ya registrado queda donde se pagó — sólo cambia la sede actual."
          onCerrar={() => {
            setMoviendo(null);
            setDestinos(null);
          }}
          pie={
            <button
              type="button"
              onClick={() => {
                setMoviendo(null);
                setDestinos(null);
              }}
              className="kodu-btn-ghost text-sm"
            >
              Cancelar
            </button>
          }
        >
          {destinos === null ? (
            <p className="text-sm text-ink-500">Cargando sedes…</p>
          ) : destinos.length === 0 ? (
            <p className="text-sm text-ink-500">No hay otra sede disponible.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {destinos.map((sede) => (
                <li key={sede.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void confirmarMover(sede.id)}
                    className="w-full rounded-md px-3 py-2 text-left text-sm text-ink-700 hover:bg-sutil"
                  >
                    {sede.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </>
  );
}
