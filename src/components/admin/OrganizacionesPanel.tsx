import { useState } from 'react';
import OrganizacionForm from './OrganizacionForm.tsx';
import type { OrganizacionResumen } from '../../lib/orgs/gestion.ts';

/**
 * `/admin/organizaciones` (odd/tasks/organizaciones.md T6): redes con sus
 * sedes anidadas + colegios standalone. Sólo alta y navegación al detalle —
 * renombrar, archivar, dominios, lista blanca, docentes y admins viven en
 * `OrganizacionDetalle.tsx` (`/admin/organizaciones/[id]`).
 */

interface RedConSedes extends OrganizacionResumen {
  sedes: OrganizacionResumen[];
}

interface Props {
  initialRedes: RedConSedes[];
  initialStandalone: OrganizacionResumen[];
}

function Badge({ archivada }: { archivada: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        archivada ? 'bg-sutil text-ink-500' : 'bg-brand-50 text-brand-700'
      }`}
    >
      {archivada ? 'Archivada' : 'Activa'}
    </span>
  );
}

export default function OrganizacionesPanel(props: Props) {
  const [redes, setRedes] = useState(props.initialRedes);
  const [standalone, setStandalone] = useState(props.initialStandalone);
  const [formAbierto, setFormAbierto] = useState<'red' | 'colegio' | { redId: string; redName: string } | null>(
    null,
  );

  const redesActivas = redes.filter((red) => !red.archivada);

  function alCrear(organizacion: OrganizacionResumen) {
    if (organizacion.kind === 'NETWORK') {
      setRedes((actuales) => [...actuales, { ...organizacion, sedes: [] }].sort((a, b) => a.name.localeCompare(b.name, 'es')));
    } else if (organizacion.parentId) {
      setRedes((actuales) =>
        actuales.map((red) =>
          red.id === organizacion.parentId
            ? { ...red, sedes: [...red.sedes, organizacion].sort((a, b) => a.name.localeCompare(b.name, 'es')) }
            : red,
        ),
      );
    } else {
      setStandalone((actuales) => [...actuales, organizacion].sort((a, b) => a.name.localeCompare(b.name, 'es')));
    }
    setFormAbierto(null);
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-500">
          {redes.length} red{redes.length === 1 ? '' : 'es'} · {standalone.length} colegio
          {standalone.length === 1 ? '' : 's'} standalone.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setFormAbierto('red')} className="kodu-btn-ghost text-sm">
            + Nueva red
          </button>
          <button type="button" onClick={() => setFormAbierto('colegio')} className="kodu-btn-primary text-sm">
            + Nuevo colegio
          </button>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">Redes</h2>
        {redes.length === 0 ? (
          <div className="kodu-card p-6 text-sm text-ink-500">Todavía no hay ninguna red creada.</div>
        ) : (
          <ol className="space-y-3">
            {redes.map((red) => (
              <li key={red.id} className="kodu-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <a
                    href={`/admin/organizaciones/${red.id}`}
                    className="font-medium text-ink-900 hover:text-brand-600"
                  >
                    {red.name}
                  </a>
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span>
                      {red.sedes.length} sede{red.sedes.length === 1 ? '' : 's'} · {red.admins} admin
                      {red.admins === 1 ? '' : 's'}
                    </span>
                    <Badge archivada={red.archivada} />
                  </div>
                </div>

                {red.sedes.length > 0 && (
                  <ul className="mt-3 space-y-1.5 border-t border-linea pt-3 pl-3">
                    {red.sedes.map((sede) => (
                      <li key={sede.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <a href={`/admin/organizaciones/${sede.id}`} className="text-ink-700 hover:text-brand-600">
                          {sede.name}
                        </a>
                        <div className="flex items-center gap-2 text-xs text-ink-500">
                          <span>
                            {sede.miembros} docente{sede.miembros === 1 ? '' : 's'}
                          </span>
                          <Badge archivada={sede.archivada} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {!red.archivada && (
                  <button
                    type="button"
                    onClick={() => setFormAbierto({ redId: red.id, redName: red.name })}
                    className="kodu-btn-ghost mt-3 px-2 py-1 text-xs"
                  >
                    + Agregar sede
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">Colegios standalone</h2>
        {standalone.length === 0 ? (
          <div className="kodu-card p-6 text-sm text-ink-500">Todavía no hay ningún colegio standalone.</div>
        ) : (
          <ol className="kodu-card divide-y divide-linea">
            {standalone.map((org) => (
              <li key={org.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <a href={`/admin/organizaciones/${org.id}`} className="font-medium text-ink-900 hover:text-brand-600">
                  {org.name}
                </a>
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span>
                    {org.miembros} docente{org.miembros === 1 ? '' : 's'} · {org.admins} admin
                    {org.admins === 1 ? '' : 's'}
                  </span>
                  <Badge archivada={org.archivada} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {formAbierto === 'red' && (
        <OrganizacionForm kind="NETWORK" redesDisponibles={[]} onGuardado={alCrear} onCerrar={() => setFormAbierto(null)} />
      )}
      {formAbierto === 'colegio' && (
        <OrganizacionForm
          kind="CAMPUS"
          redesDisponibles={redesActivas}
          onGuardado={alCrear}
          onCerrar={() => setFormAbierto(null)}
        />
      )}
      {formAbierto !== null && typeof formAbierto === 'object' && (
        <OrganizacionForm
          kind="CAMPUS"
          redesDisponibles={redesActivas}
          redFija={{ id: formAbierto.redId, name: formAbierto.redName }}
          onGuardado={alCrear}
          onCerrar={() => setFormAbierto(null)}
        />
      )}
    </div>
  );
}
