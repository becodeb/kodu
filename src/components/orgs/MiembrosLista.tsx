import { useState } from 'react';
import Modal from '../workspace/Modal.tsx';
import type { MiembroOrganizacion } from '../../lib/orgs/gestion.ts';
import { haceTiempo } from '../../lib/format/fecha.ts';

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
  /** Sólo hace falta si `puedeMover`. */
  cargarDestinos?: () => Promise<SedeDestino[]>;
  onMover?: (miembro: MiembroOrganizacion, destinoCampusId: string) => void | Promise<void>;
}

export default function MiembrosLista(props: MiembrosListaProps) {
  const { miembros, organizationNombre, pending, puedeMover } = props;
  const [moviendo, setMoviendo] = useState<MiembroOrganizacion | null>(null);
  const [destinos, setDestinos] = useState<SedeDestino[] | null>(null);

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

  if (miembros.length === 0) {
    return <p className="text-sm text-ink-500">Todavía no tiene ningún docente.</p>;
  }

  return (
    <>
      {/* Tabla — sólo `sm:` en adelante (ver comentario de arriba). */}
      <div className="hidden sm:block">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[30%]" />
            <col className="w-[18%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[8%]" />
            <col className="w-[18%]" />
          </colgroup>
          <thead className="border-b border-linea text-xs text-ink-500 uppercase">
            <tr>
              <th className="truncate py-2 pr-2 font-medium">Docente</th>
              <th className="truncate py-2 pr-2 font-medium">Verificación</th>
              <th className="truncate py-2 pr-2 text-right font-medium">Recursos</th>
              <th className="truncate py-2 pr-2 font-medium">Última actividad</th>
              <th className="truncate py-2 pr-2 font-medium">Admin</th>
              <th className="py-2 text-right font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {miembros.map((miembro) => (
              <tr key={miembro.id} className="border-b border-linea last:border-0 align-top">
                <td className="py-2 pr-2">
                  <p className="truncate font-medium text-ink-900" title={miembro.name}>
                    {miembro.name}
                  </p>
                  <p className="truncate text-xs text-ink-500" title={miembro.email}>
                    {miembro.email}
                  </p>
                </td>
                <td className="py-2 pr-2 text-xs text-ink-700">{verificacionLabel(miembro.emailVerificationSource)}</td>
                <td className="py-2 pr-2 text-right tabular-nums text-ink-700">{miembro.recursos}</td>
                <td className="py-2 pr-2 text-xs text-ink-700">{haceTiempo(miembro.ultimaActividad)}</td>
                <td className="py-2 pr-2 text-ink-700">
                  {miembro.esAdmin ? (
                    <span className="rounded-full bg-sutil px-2 py-0.5 text-xs font-medium text-brand-700">Admin</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="py-2 text-right">
                  <div className="flex flex-col items-end gap-1">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void (miembro.esAdmin ? props.onDegradar(miembro) : props.onPromover(miembro))}
                      className="kodu-btn-ghost px-2 py-1 text-xs"
                    >
                      {miembro.esAdmin ? 'Sacar admin' : 'Hacer admin'}
                    </button>
                    {puedeMover && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => void abrirMover(miembro)}
                        className="kodu-btn-ghost px-2 py-1 text-xs"
                      >
                        Mover
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => quitar(miembro)}
                      className="kodu-btn-ghost px-2 py-1 text-xs text-red-600"
                    >
                      Dar de baja
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tarjetas — sólo debajo de `sm:`. Nada de tabla acá: no hay ancho de
          columna que pueda desbordar la página a 360px. */}
      <div className="space-y-3 sm:hidden">
        {miembros.map((miembro) => (
          <div key={miembro.id} className="kodu-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink-900">{miembro.name}</p>
                <p className="truncate text-xs text-ink-500">{miembro.email}</p>
              </div>
              {miembro.esAdmin && (
                <span className="shrink-0 rounded-full bg-sutil px-2 py-0.5 text-xs font-medium text-brand-700">
                  Admin
                </span>
              )}
            </div>

            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-700">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-500">Verificación</dt>
                <dd className="text-right">{verificacionLabel(miembro.emailVerificationSource)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-500">Recursos</dt>
                <dd className="tabular-nums">{miembro.recursos}</dd>
              </div>
              <div className="col-span-2 flex justify-between gap-2">
                <dt className="text-ink-500">Última actividad</dt>
                <dd>{haceTiempo(miembro.ultimaActividad)}</dd>
              </div>
            </dl>

            <div className="mt-3 flex flex-col gap-1.5">
              <button
                type="button"
                disabled={pending}
                onClick={() => void (miembro.esAdmin ? props.onDegradar(miembro) : props.onPromover(miembro))}
                className="kodu-btn-ghost w-full text-xs"
              >
                {miembro.esAdmin ? 'Sacar admin' : 'Hacer admin'}
              </button>
              {puedeMover && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void abrirMover(miembro)}
                  className="kodu-btn-ghost w-full text-xs"
                >
                  Mover a otra sede
                </button>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => quitar(miembro)}
                className="kodu-btn-ghost w-full text-xs text-red-600"
              >
                Dar de baja
              </button>
            </div>
          </div>
        ))}
      </div>

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
