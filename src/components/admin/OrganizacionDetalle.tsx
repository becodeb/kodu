import { useState, type FormEvent } from 'react';
import Modal from '../workspace/Modal.tsx';
import MiembrosLista from '../orgs/MiembrosLista.tsx';
import { apiRequest } from '../../lib/client/api.ts';
import type {
  DetalleOrganizacion,
  MiembroOrganizacion,
  OrganizacionResumen,
  AdminDeOrganizacion,
} from '../../lib/orgs/gestion.ts';

/**
 * `/admin/organizaciones/[id]` (odd/tasks/organizaciones.md T6): renombrar,
 * archivar/reactivar, dominios, lista blanca (sólo CAMPUS), docentes (sólo
 * CAMPUS: mover/quitar) y admins de la organización (CAMPUS o NETWORK).
 *
 * Un solo componente para los dos `kind` (en vez de dos páginas): la
 * diferencia entre CAMPUS y NETWORK es sobre todo qué SECCIONES se muestran,
 * no un layout distinto — separarlo en dos archivos hubiera duplicado el
 * cascarón (header, dominios, admins) sin ganar claridad.
 */

interface Props {
  initialOrganizacion: DetalleOrganizacion;
  initialMiembros: MiembroOrganizacion[];
}

export default function OrganizacionDetalle(props: Props) {
  const [org, setOrg] = useState(props.initialOrganizacion);
  const [miembros, setMiembros] = useState(props.initialMiembros);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Rename inline.
  const [editandoNombre, setEditandoNombre] = useState(false);
  const [nombreBorrador, setNombreBorrador] = useState(org.name);

  // Altas de dominio/lista blanca.
  const [nuevoDominio, setNuevoDominio] = useState('');
  const [nuevoEmail, setNuevoEmail] = useState('');

  // Modal de "promover admin".
  const [promoviendo, setPromoviendo] = useState(false);
  const [sedeElegida, setSedeElegida] = useState<string>('');
  const [miembrosDeSede, setMiembrosDeSede] = useState<MiembroOrganizacion[] | null>(null);

  function reportarError(mensaje: string) {
    setError(mensaje);
  }

  // ── Renombrar ──────────────────────────────────────────────
  async function guardarNombre() {
    if (!nombreBorrador.trim() || nombreBorrador.trim() === org.name) {
      setEditandoNombre(false);
      setNombreBorrador(org.name);
      return;
    }
    setPending(true);
    const result = await apiRequest<{ organizacion: DetalleOrganizacion }>(
      `/api/admin/organizaciones/${org.id}`,
      'PATCH',
      { name: nombreBorrador.trim() },
    );
    setPending(false);
    if (!result.ok) {
      reportarError(result.error);
      return;
    }
    setOrg(result.data.organizacion);
    setEditandoNombre(false);
  }

  // ── Archivar / reactivar ───────────────────────────────────
  async function alternarArchivado() {
    const accion = org.archivada ? 'reactivar' : 'archivar';
    const consecuencia = org.archivada
      ? '¿Reactivar esta organización? Sus docentes van a poder volver a usar la IA.'
      : `¿Archivar «${org.name}»? Sus docentes pierden el acceso a la IA hasta que se reactive. El historial y los recursos no se tocan.`;
    if (!window.confirm(consecuencia)) return;

    setPending(true);
    const result = await apiRequest<{ organizacion: DetalleOrganizacion }>(
      `/api/admin/organizaciones/${org.id}`,
      'PATCH',
      { archived: !org.archivada },
    );
    setPending(false);
    if (!result.ok) {
      reportarError(`No se pudo ${accion}: ${result.error}`);
      return;
    }
    setOrg(result.data.organizacion);
  }

  // ── Dominios ───────────────────────────────────────────────
  async function agregarDominio(event: FormEvent) {
    event.preventDefault();
    if (!nuevoDominio.trim()) return;
    setPending(true);
    const result = await apiRequest<{ dominio: DetalleOrganizacion['dominios'][number] }>(
      `/api/admin/organizaciones/${org.id}/dominios`,
      'POST',
      { pattern: nuevoDominio.trim() },
    );
    setPending(false);
    if (!result.ok) {
      reportarError(result.error);
      return;
    }
    setOrg((actual) => ({ ...actual, dominios: [...actual.dominios, result.data.dominio] }));
    setNuevoDominio('');
  }

  async function quitarDominio(domainId: string) {
    setPending(true);
    const result = await apiRequest(`/api/admin/organizaciones/${org.id}/dominios/${domainId}`, 'DELETE');
    setPending(false);
    if (!result.ok) {
      reportarError(result.error);
      return;
    }
    setOrg((actual) => ({ ...actual, dominios: actual.dominios.filter((d) => d.id !== domainId) }));
  }

  // ── Lista blanca ───────────────────────────────────────────
  async function agregarEmail(event: FormEvent) {
    event.preventDefault();
    if (!nuevoEmail.trim()) return;
    setPending(true);
    const result = await apiRequest<{ item: DetalleOrganizacion['listaBlanca'][number] }>(
      `/api/admin/organizaciones/${org.id}/lista-blanca`,
      'POST',
      { email: nuevoEmail.trim() },
    );
    setPending(false);
    if (!result.ok) {
      reportarError(result.error);
      return;
    }
    setOrg((actual) => ({ ...actual, listaBlanca: [...actual.listaBlanca, result.data.item] }));
    setNuevoEmail('');
    // El alta puede haber unido a una cuenta personal existente — refresca
    // la lista de docentes para reflejarlo sin pedirle al admin que recargue.
    await recargarMiembros();
  }

  async function quitarEmail(id: string) {
    setPending(true);
    const result = await apiRequest(`/api/admin/organizaciones/${org.id}/lista-blanca/${id}`, 'DELETE');
    setPending(false);
    if (!result.ok) {
      reportarError(result.error);
      return;
    }
    setOrg((actual) => ({ ...actual, listaBlanca: actual.listaBlanca.filter((item) => item.id !== id) }));
  }

  // ── Docentes ───────────────────────────────────────────────
  async function recargarMiembros() {
    if (org.kind !== 'CAMPUS') return;
    const result = await apiRequest<{ miembros: MiembroOrganizacion[] }>(
      `/api/admin/organizaciones/${org.id}/miembros`,
    );
    if (result.ok) setMiembros(result.data.miembros);
  }

  // odd/tasks/organizaciones.md (T8): estos tres callbacks son EXACTAMENTE
  // lo que le pasa `<MiembrosLista>` compartido — la confirmación de "Dar de
  // baja" y el modal de "Mover" ya viven adentro del componente, acá sólo
  // queda pegarle a la API correcta y actualizar el estado local.
  async function quitarDocente(miembro: MiembroOrganizacion) {
    setPending(true);
    const result = await apiRequest(`/api/admin/organizaciones/${org.id}/miembros/${miembro.id}`, 'DELETE');
    setPending(false);
    if (!result.ok) {
      reportarError(result.error);
      return;
    }
    setMiembros((actuales) => actuales.filter((item) => item.id !== miembro.id));
    setOrg((actual) => ({ ...actual, miembros: Math.max(0, actual.miembros - 1) }));
  }

  async function cargarDestinosDocentes(): Promise<OrganizacionResumen[]> {
    const result = await apiRequest<{
      redes: Array<OrganizacionResumen & { sedes: OrganizacionResumen[] }>;
      standalone: OrganizacionResumen[];
    }>('/api/admin/organizaciones');
    if (!result.ok) {
      reportarError(result.error);
      return [];
    }
    return [...result.data.redes.flatMap((red) => red.sedes), ...result.data.standalone].filter(
      (sede) => sede.id !== org.id && !sede.archivada,
    );
  }

  async function moverDocente(miembro: MiembroOrganizacion, destinoCampusId: string) {
    setPending(true);
    const result = await apiRequest(`/api/admin/organizaciones/${org.id}/miembros/${miembro.id}`, 'PATCH', {
      destinoCampusId,
    });
    setPending(false);
    if (!result.ok) {
      reportarError(result.error);
      return;
    }
    setMiembros((actuales) => actuales.filter((item) => item.id !== miembro.id));
    setOrg((actual) => ({ ...actual, miembros: Math.max(0, actual.miembros - 1) }));
  }

  /** Toggle inline (Hacer admin/Sacar admin) de la fila del docente — DISTINTO
   *  del modal de "+ Promover" de la sección Admins de abajo: ese modal
   *  promueve al nivel de la organización que se está mirando (para una
   *  NETWORK, da admin de RED); esto de acá SIEMPRE promueve/degrada al nivel
   *  de ESTA sede (`org.id` es una CAMPUS en todo momento en el que esta
   *  lista se muestra — ver el `{org.kind === 'CAMPUS' && ...}` de abajo). */
  async function promoverDocenteInline(miembro: MiembroOrganizacion) {
    setPending(true);
    const result = await apiRequest(`/api/admin/organizaciones/${org.id}/admins`, 'POST', { userId: miembro.id });
    setPending(false);
    if (!result.ok) {
      reportarError(result.error);
      return;
    }
    setMiembros((actuales) => actuales.map((item) => (item.id === miembro.id ? { ...item, esAdmin: true } : item)));
    setOrg((actual) => ({
      ...actual,
      admins: actual.admins + 1,
      adminsLista: [...actual.adminsLista, { id: miembro.id, name: miembro.name, email: miembro.email }],
    }));
  }

  async function degradarDocenteInline(miembro: MiembroOrganizacion) {
    setPending(true);
    const result = await apiRequest(`/api/admin/organizaciones/${org.id}/admins/${miembro.id}`, 'DELETE');
    setPending(false);
    if (!result.ok) {
      reportarError(result.error);
      return;
    }
    setMiembros((actuales) => actuales.map((item) => (item.id === miembro.id ? { ...item, esAdmin: false } : item)));
    setOrg((actual) => ({
      ...actual,
      admins: Math.max(0, actual.admins - 1),
      adminsLista: actual.adminsLista.filter((item) => item.id !== miembro.id),
    }));
  }

  // ── Admins ─────────────────────────────────────────────────
  async function promover(miembro: { id: string; name: string; email: string }) {
    setPending(true);
    const result = await apiRequest(`/api/admin/organizaciones/${org.id}/admins`, 'POST', { userId: miembro.id });
    setPending(false);
    if (!result.ok) {
      reportarError(result.error);
      return;
    }
    setPromoviendo(false);
    setSedeElegida('');
    setMiembrosDeSede(null);
    setOrg((actual) => ({
      ...actual,
      admins: actual.admins + 1,
      adminsLista: [...actual.adminsLista, { id: miembro.id, name: miembro.name, email: miembro.email }],
    }));
    if (org.kind === 'CAMPUS') {
      setMiembros((actuales) => actuales.map((item) => (item.id === miembro.id ? { ...item, esAdmin: true } : item)));
    }
  }

  async function degradar(admin: AdminDeOrganizacion) {
    const confirmado = window.confirm(`¿Sacarle el rol de admin a ${admin.name} en ${org.name}?`);
    if (!confirmado) return;

    setPending(true);
    const result = await apiRequest(`/api/admin/organizaciones/${org.id}/admins/${admin.id}`, 'DELETE');
    setPending(false);
    if (!result.ok) {
      reportarError(result.error);
      return;
    }
    setOrg((actual) => ({
      ...actual,
      admins: Math.max(0, actual.admins - 1),
      adminsLista: actual.adminsLista.filter((item) => item.id !== admin.id),
    }));
  }

  async function elegirSedeParaPromover(sedeId: string) {
    setSedeElegida(sedeId);
    setMiembrosDeSede(null);
    if (!sedeId) return;
    const result = await apiRequest<{ miembros: MiembroOrganizacion[] }>(
      `/api/admin/organizaciones/${sedeId}/miembros`,
    );
    if (result.ok) setMiembrosDeSede(result.data.miembros);
  }

  const idsAdmin = new Set(org.adminsLista.map((a) => a.id));
  const miembrosPromovibles = miembros.filter((m) => !idsAdmin.has(m.id));

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <a href="/admin/organizaciones" className="text-xs text-ink-500 hover:text-brand-600">
          ← Organizaciones
        </a>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {editandoNombre ? (
            <div className="flex items-center gap-2">
              <input
                value={nombreBorrador}
                onChange={(event) => setNombreBorrador(event.target.value)}
                className="kodu-input"
                autoFocus
              />
              <button type="button" onClick={() => void guardarNombre()} disabled={pending} className="kodu-btn-primary text-sm">
                Guardar
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditandoNombre(false);
                  setNombreBorrador(org.name);
                }}
                className="kodu-btn-ghost text-sm"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <>
              <h1 className="font-display text-2xl font-bold text-ink-900">{org.name}</h1>
              <button type="button" onClick={() => setEditandoNombre(true)} className="kodu-btn-ghost px-2 py-1 text-xs">
                Renombrar
              </button>
            </>
          )}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500">
          <span>{org.kind === 'NETWORK' ? 'Red de colegios' : 'Colegio'}</span>
          {org.padre && (
            <>
              ·{' '}
              <a href={`/admin/organizaciones/${org.padre.id}`} className="hover:text-brand-600">
                Sede de {org.padre.name}
              </a>
            </>
          )}
          <span className={org.archivada ? 'text-ink-500' : 'text-brand-700'}>
            · {org.archivada ? 'Archivada' : 'Activa'}
          </span>
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <section className="kodu-card flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-ink-700">
          {org.miembros} docente{org.miembros === 1 ? '' : 's'} · {org.admins} admin{org.admins === 1 ? '' : 's'}
          {org.kind === 'NETWORK' && ` · ${org.sedes.length} sede${org.sedes.length === 1 ? '' : 's'}`}
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => void alternarArchivado()}
          className={
            org.archivada
              ? 'kodu-btn-primary text-sm'
              : 'rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100'
          }
        >
          {org.archivada ? 'Reactivar' : 'Archivar'}
        </button>
      </section>

      {org.kind === 'NETWORK' && (
        <section className="kodu-card p-4">
          <h2 className="text-sm font-semibold text-ink-900">Sedes</h2>
          {org.sedes.length === 0 ? (
            <p className="mt-3 text-sm text-ink-500">Todavía no tiene ninguna sede.</p>
          ) : (
            <ul className="mt-3 divide-y divide-linea">
              {org.sedes.map((sede) => (
                <li key={sede.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <a href={`/admin/organizaciones/${sede.id}`} className="text-ink-900 hover:text-brand-600">
                    {sede.name}
                  </a>
                  <span className="text-xs text-ink-500">
                    {sede.miembros} docente{sede.miembros === 1 ? '' : 's'} · {sede.archivada ? 'archivada' : 'activa'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="kodu-card p-4">
        <h2 className="text-sm font-semibold text-ink-900">Dominios</h2>
        <p className="mt-1 text-xs text-ink-500">
          {org.kind === 'NETWORK'
            ? 'Un dominio de red no une a nadie solo: quien entra por él elige su sede.'
            : 'Agregar un dominio une de inmediato a las cuentas personales de confianza que ya matcheen.'}
        </p>

        {org.dominios.length > 0 && (
          <ul className="mt-3 divide-y divide-linea">
            {org.dominios.map((dominio) => (
              <li key={dominio.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                {/* min-w-0 + break-all: un dominio es UNA palabra larga sin
                    espacios — sin esto, el flex item nunca se achica y
                    empuja overflow horizontal a la PÁGINA entera a 360px
                    (chromium-headless-500px-clamp.md lo hizo evidente). */}
                <span className="min-w-0 font-mono break-all text-ink-700">{dominio.pattern}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void quitarDominio(dominio.id)}
                  className="kodu-btn-ghost px-2 py-1 text-xs text-red-600"
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={(event) => void agregarDominio(event)} className="mt-3 flex flex-wrap gap-2">
          <input
            value={nuevoDominio}
            onChange={(event) => setNuevoDominio(event.target.value)}
            placeholder="escuela.edu.ar o *.edu.ar"
            className="kodu-input flex-1"
          />
          <button type="submit" disabled={pending} className="kodu-btn-primary text-sm">
            Agregar
          </button>
        </form>
      </section>

      {org.kind === 'CAMPUS' && (
        <section className="kodu-card p-4">
          <h2 className="text-sm font-semibold text-ink-900">Lista blanca</h2>
          <p className="mt-1 text-xs text-ink-500">Une a un email puntual aunque su dominio no esté autorizado.</p>

          {org.listaBlanca.length > 0 && (
            <ul className="mt-3 divide-y divide-linea">
              {org.listaBlanca.map((item) => (
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
      )}

      <section className="kodu-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-900">Admins</h2>
          <button type="button" onClick={() => setPromoviendo(true)} className="kodu-btn-ghost px-2 py-1 text-xs">
            + Promover
          </button>
        </div>

        {org.adminsLista.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">Todavía no tiene ningún admin.</p>
        ) : (
          <ul className="mt-3 divide-y divide-linea">
            {org.adminsLista.map((admin) => (
              <li key={admin.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 break-all">
                  <span className="text-ink-900">{admin.name}</span>{' '}
                  <span className="text-xs text-ink-500">{admin.email}</span>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void degradar(admin)}
                  className="kodu-btn-ghost px-2 py-1 text-xs text-red-600"
                >
                  Sacar admin
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {org.kind === 'CAMPUS' && (
        <section className="kodu-card p-4">
          <h2 className="text-sm font-semibold text-ink-900">Docentes</h2>
          <div className="mt-3">
            <MiembrosLista
              miembros={miembros}
              organizationNombre={org.name}
              pending={pending}
              puedeMover
              onPromover={promoverDocenteInline}
              onDegradar={degradarDocenteInline}
              onQuitar={quitarDocente}
              cargarDestinos={cargarDestinosDocentes}
              onMover={moverDocente}
            />
          </div>
        </section>
      )}

      {promoviendo && (
        <Modal
          abierto
          titulo="Promover admin"
          onCerrar={() => {
            setPromoviendo(false);
            setSedeElegida('');
            setMiembrosDeSede(null);
          }}
          pie={
            <button
              type="button"
              onClick={() => {
                setPromoviendo(false);
                setSedeElegida('');
                setMiembrosDeSede(null);
              }}
              className="kodu-btn-ghost text-sm"
            >
              Cerrar
            </button>
          }
        >
          {org.kind === 'CAMPUS' ? (
            miembrosPromovibles.length === 0 ? (
              <p className="text-sm text-ink-500">Todos los docentes de esta sede ya son admin.</p>
            ) : (
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {miembrosPromovibles.map((miembro) => (
                  <li key={miembro.id}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void promover(miembro)}
                      className="w-full rounded-md px-3 py-2 text-left text-sm text-ink-700 hover:bg-sutil"
                    >
                      {miembro.name} <span className="text-xs text-ink-500">{miembro.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="space-y-3">
              <div>
                <label className="kodu-label" htmlFor="promover-sede">
                  Elegí una sede
                </label>
                <select
                  id="promover-sede"
                  value={sedeElegida}
                  onChange={(event) => void elegirSedeParaPromover(event.target.value)}
                  className="kodu-input"
                >
                  <option value="">Elegí una sede…</option>
                  {org.sedes.map((sede) => (
                    <option key={sede.id} value={sede.id}>
                      {sede.name}
                    </option>
                  ))}
                </select>
              </div>

              {sedeElegida &&
                (miembrosDeSede === null ? (
                  <p className="text-sm text-ink-500">Cargando docentes…</p>
                ) : miembrosDeSede.filter((m) => !idsAdmin.has(m.id)).length === 0 ? (
                  <p className="text-sm text-ink-500">Todos los docentes de esa sede ya son admin.</p>
                ) : (
                  <ul className="max-h-56 space-y-1 overflow-y-auto">
                    {miembrosDeSede
                      .filter((m) => !idsAdmin.has(m.id))
                      .map((miembro) => (
                        <li key={miembro.id}>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => void promover(miembro)}
                            className="w-full rounded-md px-3 py-2 text-left text-sm text-ink-700 hover:bg-sutil"
                          >
                            {miembro.name} <span className="text-xs text-ink-500">{miembro.email}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
