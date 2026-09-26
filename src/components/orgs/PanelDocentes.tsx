import { useState } from 'react';
import { apiRequest } from '../../lib/client/api.ts';
import MiembrosLista, { type SedeDestino } from './MiembrosLista.tsx';
import type { MiembroOrganizacion } from '../../lib/orgs/gestion.ts';

/**
 * odd/tasks/organizaciones.md (T8): envoltorio de `<MiembrosLista>` para
 * `/org` — existe SÓLO porque Astro serializa las props de una isla
 * `client:load` a JSON (no se le puede pasar una función como
 * `cargarDestinos` directamente desde el `.astro`); acá adentro, ya en
 * React, sí se arman los callbacks. Espejo de lo que `OrganizacionDetalle.tsx`
 * hace inline para el superadmin, pero pegándole a `/api/org/**` en vez de
 * `/api/admin/organizaciones/**`.
 */

interface Props {
  organizationId: string;
  organizationNombre: string;
  initialMiembros: MiembroOrganizacion[];
  /** Sólo un admin de RED (o el superadmin visitando `/org`) puede mover. */
  puedeMover: boolean;
}

export default function PanelDocentes(props: Props) {
  const [miembros, setMiembros] = useState(props.initialMiembros);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function promover(miembro: MiembroOrganizacion) {
    setPending(true);
    const result = await apiRequest(`/api/org/organizaciones/${props.organizationId}/admins`, 'POST', {
      userId: miembro.id,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMiembros((actuales) => actuales.map((m) => (m.id === miembro.id ? { ...m, esAdmin: true } : m)));
  }

  async function degradar(miembro: MiembroOrganizacion) {
    setPending(true);
    const result = await apiRequest(`/api/org/organizaciones/${props.organizationId}/admins/${miembro.id}`, 'DELETE', {});
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMiembros((actuales) => actuales.map((m) => (m.id === miembro.id ? { ...m, esAdmin: false } : m)));
  }

  async function quitar(miembro: MiembroOrganizacion) {
    setPending(true);
    const result = await apiRequest(`/api/org/miembros/${miembro.id}`, 'DELETE', {});
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMiembros((actuales) => actuales.filter((m) => m.id !== miembro.id));
  }

  async function cargarDestinos(): Promise<SedeDestino[]> {
    const result = await apiRequest<{ sedes: SedeDestino[] }>('/api/org/sedes');
    if (!result.ok) {
      setError(result.error);
      return [];
    }
    return result.data.sedes.filter((sede) => sede.id !== props.organizationId);
  }

  async function mover(miembro: MiembroOrganizacion, destinoCampusId: string) {
    setPending(true);
    const result = await apiRequest(`/api/org/miembros/${miembro.id}`, 'PATCH', { destinoCampusId });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMiembros((actuales) => actuales.filter((m) => m.id !== miembro.id));
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <MiembrosLista
        miembros={miembros}
        organizationNombre={props.organizationNombre}
        pending={pending}
        puedeMover={props.puedeMover}
        onPromover={promover}
        onDegradar={degradar}
        onQuitar={quitar}
        cargarDestinos={props.puedeMover ? cargarDestinos : undefined}
        onMover={props.puedeMover ? mover : undefined}
      />
    </div>
  );
}
