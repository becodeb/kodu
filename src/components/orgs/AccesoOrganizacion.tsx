import { useState, type FormEvent } from 'react';
import { apiRequest } from '../../lib/client/api.ts';
import type { DetalleOrganizacion } from '../../lib/orgs/gestion.ts';
import type { InvitacionResumen, EstadoInvitacion } from '../../lib/orgs/invitaciones.ts';

/**
 * odd/tasks/organizaciones.md (T8): sección "Acceso" de `/org` — lista
 * blanca (alta/baja, reusa `gestion.ts` vía `/api/org/organizaciones/:id/
 * lista-blanca**`), enlaces de invitación (alta/listado/revocación, reusa
 * las APIS de T4 tal cual: `/api/org/invitaciones` y
 * `/api/org/invitaciones/:id/revocar` — esta sección es la PRIMERA interfaz
 * que las usa; T4 sólo había construido la API y la página pública de
 * aceptación) y dominios de sólo lectura (los administra el superadmin,
 * decisión de T6 que T8 no toca).
 */

const ETIQUETA_ESTADO: Record<EstadoInvitacion, string> = {
  activa: 'Activa',
  vencida: 'Vencida',
  agotada: 'Agotada',
  revocada: 'Revocada',
};

interface Props {
  organizationId: string;
  initialListaBlanca: DetalleOrganizacion['listaBlanca'];
  initialInvitaciones: InvitacionResumen[];
  dominios: DetalleOrganizacion['dominios'];
}

export default function AccesoOrganizacion(props: Props) {
  const { organizationId } = props;
  const [listaBlanca, setListaBlanca] = useState(props.initialListaBlanca);
  const [invitaciones, setInvitaciones] = useState(props.initialInvitaciones);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // ── Lista blanca ───────────────────────────────────────────
  const [nuevoEmail, setNuevoEmail] = useState('');

  async function agregarEmail(event: FormEvent) {
    event.preventDefault();
    if (!nuevoEmail.trim()) return;
    setPending(true);
    const result = await apiRequest<{ item: DetalleOrganizacion['listaBlanca'][number] }>(
      `/api/org/organizaciones/${organizationId}/lista-blanca`,
      'POST',
      { email: nuevoEmail.trim() },
    );
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setListaBlanca((actual) => [...actual, result.data.item]);
    setNuevoEmail('');
  }

  async function quitarEmail(id: string) {
    setPending(true);
    const result = await apiRequest(`/api/org/organizaciones/${organizationId}/lista-blanca/${id}`, 'DELETE', {});
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setListaBlanca((actual) => actual.filter((item) => item.id !== id));
  }

  // ── Invitaciones ───────────────────────────────────────────
  const [expiresAt, setExpiresAt] = useState('');
  const [maxUses, setMaxUses] = useState('');
  /** El token en claro sólo existe ACÁ, en memoria, un instante — nunca se
   *  guarda ni se vuelve a poder ver (mismo criterio que `invitaciones.ts`:
   *  la base sólo tiene el hash). Se pierde al cerrar el aviso o recargar. */
  const [enlaceNuevo, setEnlaceNuevo] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function crearInvitacion(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await apiRequest<{ url: string; invitacion: InvitacionResumen }>(
      '/api/org/invitaciones',
      'POST',
      {
        organizationId,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        maxUses: maxUses ? Number(maxUses) : null,
      },
    );
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setInvitaciones((actual) => [result.data.invitacion, ...actual]);
    setEnlaceNuevo(result.data.url);
    setCopiado(false);
    setExpiresAt('');
    setMaxUses('');
  }

  async function copiarEnlace() {
    if (!enlaceNuevo) return;
    try {
      await navigator.clipboard.writeText(enlaceNuevo);
      setCopiado(true);
    } catch {
      // Sin permiso de portapapeles (poco común, pero posible): el enlace
      // sigue visible y seleccionable a mano, no es un error bloqueante.
    }
  }

  async function revocar(invitacion: InvitacionResumen) {
    if (!window.confirm('¿Revocar este enlace de invitación? Nadie va a poder volver a usarlo.')) return;
    setPending(true);
    const result = await apiRequest(`/api/org/invitaciones/${invitacion.id}/revocar`, 'POST', {});
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setInvitaciones((actual) => actual.map((item) => (item.id === invitacion.id ? { ...item, estado: 'revocada' } : item)));
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <section className="kodu-card p-4">
        <h3 className="text-sm font-semibold text-ink-900">Lista blanca</h3>
        <p className="mt-1 text-xs text-ink-500">Une a un email puntual aunque su dominio no esté autorizado.</p>

        {listaBlanca.length > 0 && (
          <ul className="mt-3 divide-y divide-linea">
            {listaBlanca.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 break-all text-ink-700">{item.email}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void quitarEmail(item.id)}
                  className="kodu-btn-ghost px-2 py-1 text-xs text-red-600"
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={(event) => void agregarEmail(event)} className="mt-3 flex flex-wrap gap-2">
          <input
            value={nuevoEmail}
            onChange={(event) => setNuevoEmail(event.target.value)}
            placeholder="docente@ejemplo.com"
            type="email"
            className="kodu-input flex-1"
          />
          <button type="submit" disabled={pending} className="kodu-btn-primary text-sm">
            Agregar
          </button>
        </form>
      </section>

      <section className="kodu-card p-4">
        <h3 className="text-sm font-semibold text-ink-900">Enlaces de invitación</h3>
        <p className="mt-1 text-xs text-ink-500">
          Tener el enlace alcanza — no hace falta un email verificado para aceptarlo.
        </p>

        {enlaceNuevo && (
          <div className="mt-3 rounded-lg border border-brand-300 bg-sutil p-3 text-sm">
            <p className="font-medium text-ink-900">Enlace creado — copialo ahora, no se vuelve a mostrar.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-superficie px-2 py-1 text-xs text-ink-700">
                {enlaceNuevo}
              </code>
              <button type="button" onClick={() => void copiarEnlace()} className="kodu-btn-ghost text-xs">
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setEnlaceNuevo(null)}
              className="mt-2 text-xs text-ink-500 hover:text-ink-700"
            >
              Cerrar
            </button>
          </div>
        )}

        {invitaciones.length > 0 && (
          <ul className="mt-3 divide-y divide-linea">
            {invitaciones.map((invitacion) => (
              <li key={invitacion.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="text-ink-900">
                    {ETIQUETA_ESTADO[invitacion.estado]}
                    <span className="ml-1.5 text-xs text-ink-500">
                      · {invitacion.uses}
                      {invitacion.maxUses !== null ? ` / ${invitacion.maxUses}` : ''} usos
                      {invitacion.expiresAt && ` · vence ${new Date(invitacion.expiresAt).toLocaleDateString('es-AR')}`}
                    </span>
                  </p>
                </div>
                {invitacion.estado === 'activa' && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void revocar(invitacion)}
                    className="kodu-btn-ghost px-2 py-1 text-xs text-red-600"
                  >
                    Revocar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={(event) => void crearInvitacion(event)} className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="kodu-label" htmlFor="invitacion-vencimiento">
              Vencimiento (opcional)
            </label>
            <input
              id="invitacion-vencimiento"
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="kodu-input"
            />
          </div>
          <div>
            <label className="kodu-label" htmlFor="invitacion-cupo">
              Cupo (opcional)
            </label>
            <input
              id="invitacion-cupo"
              type="number"
              min={1}
              value={maxUses}
              onChange={(event) => setMaxUses(event.target.value)}
              className="kodu-input w-28"
            />
          </div>
          <button type="submit" disabled={pending} className="kodu-btn-primary text-sm">
            Crear enlace
          </button>
        </form>
      </section>

      <section className="kodu-card p-4">
        <h3 className="text-sm font-semibold text-ink-900">Dominios</h3>
        <p className="mt-1 text-xs text-ink-500">Los administra Kodu — escribinos si necesitás agregar o sacar uno.</p>
        {props.dominios.length > 0 ? (
          <ul className="mt-3 divide-y divide-linea">
            {props.dominios.map((dominio) => (
              <li key={dominio.id} className="py-2 text-sm">
                <span className="min-w-0 break-all font-mono text-ink-700">{dominio.pattern}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-500">Todavía no tiene ningún dominio.</p>
        )}
      </section>
    </div>
  );
}
