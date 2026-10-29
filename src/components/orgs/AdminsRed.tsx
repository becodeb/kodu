import { useState } from 'react';
import { apiRequest } from '../../lib/client/api.ts';
import InsigniaFacturacion from './InsigniaFacturacion.tsx';
import type { AdminDeOrganizacion } from '../../lib/orgs/gestion.ts';

/**
 * odd/tasks/org-admin-facturacion.md: los admins de una RED en `/org`. La
 * vista de red no tiene lista de docentes (se administran por sede), así que
 * sin esto el titular de la facturación no tendría dónde ver ni repartir el
 * permiso. Sólo quien ya gestiona la facturación (`puedeGestionarFacturacion`)
 * ve el botón; el servidor lo vuelve a exigir (`fijarFacturacionAdmin`).
 */

interface Props {
  organizationId: string;
  initialAdmins: AdminDeOrganizacion[];
  puedeGestionarFacturacion: boolean;
}

export default function AdminsRed(props: Props) {
  const [admins, setAdmins] = useState(props.initialAdmins);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titulares = admins.filter((admin) => admin.canManageBilling).length;

  async function cambiar(admin: AdminDeOrganizacion, canManageBilling: boolean) {
    setPending(true);
    setError(null);
    const result = await apiRequest(`/api/org/organizaciones/${props.organizationId}/admins/${admin.id}`, 'PATCH', {
      canManageBilling,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAdmins((actuales) => actuales.map((item) => (item.id === admin.id ? { ...item, canManageBilling } : item)));
  }

  if (admins.length === 0) {
    return <p className="text-sm text-ink-500">Todavía no tiene ningún admin.</p>;
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <ul className="divide-y divide-linea">
        {admins.map((admin) => {
          const unico = admin.canManageBilling && titulares <= 1;
          return (
            <li key={admin.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-ink-900">{admin.name}</span>
                  {admin.canManageBilling && <InsigniaFacturacion />}
                </p>
                <p className="truncate text-xs text-ink-500">{admin.email}</p>
              </div>
              {props.puedeGestionarFacturacion && (
                <button
                  type="button"
                  disabled={pending || unico}
                  title={unico ? 'Tiene que quedar al menos un admin con facturación.' : undefined}
                  onClick={() => void cambiar(admin, !admin.canManageBilling)}
                  className="kodu-btn-ghost px-2 py-1 text-xs"
                >
                  {admin.canManageBilling ? 'Quitar facturación' : 'Dar facturación'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
