import { useState } from 'react';
import { apiRequest } from '../../lib/client/api.ts';

interface Props {
  usuarioId: string;
  nombre: string;
  roleInicial: 'DOCENTE' | 'ADMIN';
  aiAccessOverrideInicial: boolean | null;
  accesoIaInicial: string;
}

/**
 * La pestaña "Cuenta" de la ficha de un docente (odd/tasks/admin-ui-redesign.md,
 * T04): las dos acciones que antes sólo vivían en el menú de la fila de
 * `/admin/usuarios` — rol y acceso a la IA —, ahora con una explicación de
 * qué significa cada estado y confirmación antes de promover a admin (una
 * acción que le da a alguien control sobre el resto de los docentes, no
 * algo para un clic accidental).
 */
export default function CuentaDocenteAdmin({ usuarioId, nombre, roleInicial, aiAccessOverrideInicial, accesoIaInicial }: Props) {
  const [role, setRole] = useState(roleInicial);
  const [override, setOverride] = useState(aiAccessOverrideInicial);
  const [accesoIa, setAccesoIa] = useState(accesoIaInicial);
  const [pendiente, setPendiente] = useState<'rol' | 'acceso' | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  async function cambiarRol() {
    const nuevoRol = role === 'ADMIN' ? 'DOCENTE' : 'ADMIN';
    if (nuevoRol === 'ADMIN') {
      const confirmado = window.confirm(
        `${nombre} va a poder administrar toda la plataforma: otros docentes, organizaciones, motores y facturación. ¿Confirmás?`,
      );
      if (!confirmado) return;
    }

    setMensaje(null);
    setPendiente('rol');
    const rolAnterior = role;
    setRole(nuevoRol); // optimista: se revierte si el servidor rechaza

    const result = await apiRequest<{ usuario: { id: string; role: 'DOCENTE' | 'ADMIN' } }>(
      `/api/admin/users/${usuarioId}`,
      'PATCH',
      { role: nuevoRol },
    );

    setPendiente(null);
    if (!result.ok) {
      setRole(rolAnterior);
      setMensaje({ tipo: 'error', texto: result.error });
      return;
    }
    setMensaje({ tipo: 'ok', texto: nuevoRol === 'ADMIN' ? 'Ahora es administrador.' : 'Ya no es administrador.' });
  }

  async function cambiarAcceso(nuevo: boolean | null) {
    setMensaje(null);
    setPendiente('acceso');

    const result = await apiRequest<{ usuario: { id: string; aiAccessOverride: boolean | null; accesoIa: string } }>(
      `/api/admin/users/${usuarioId}`,
      'PATCH',
      { aiAccessOverride: nuevo },
    );

    setPendiente(null);
    if (!result.ok) {
      setMensaje({ tipo: 'error', texto: result.error });
      return;
    }
    setOverride(result.data.usuario.aiAccessOverride);
    setAccesoIa(result.data.usuario.accesoIa);
    setMensaje({ tipo: 'ok', texto: `Acceso a la IA: ${result.data.usuario.accesoIa}.` });
  }

  return (
    <div className="space-y-6">
      {mensaje && (
        <p
          role="status"
          className={`admin-entra rounded-lg px-3 py-2 text-sm ${
            mensaje.tipo === 'ok' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {mensaje.texto}
        </p>
      )}

      <section className="kodu-card p-5">
        <h2 className="text-sm font-semibold text-ink-900">Rol</h2>
        <p className="mt-1 text-sm text-ink-500">
          {role === 'ADMIN'
            ? 'Es administrador: puede entrar a este panel y actuar sobre cualquier cuenta y recurso.'
            : 'Es docente: sólo puede ver y editar sus propios recursos.'}
        </p>
        <button
          type="button"
          disabled={pendiente === 'rol'}
          onClick={() => void cambiarRol()}
          className="kodu-btn-ghost mt-3 disabled:opacity-50"
        >
          {role === 'ADMIN' ? 'Quitar administrador' : 'Hacer administrador'}
        </button>
      </section>

      <section className="kodu-card p-5">
        <h2 className="text-sm font-semibold text-ink-900">Acceso a la IA</h2>
        <p className="mt-1 text-sm text-ink-500">Estado actual: {accesoIa}.</p>
        <div className="mt-3 space-y-2 text-sm">
          <label className="flex items-start gap-2.5">
            <input
              type="radio"
              name="acceso-ia"
              checked={override === null}
              disabled={pendiente === 'acceso'}
              onChange={() => void cambiarAcceso(null)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-ink-900">Por organización</span>
              <span className="block text-xs text-ink-500">Sigue la regla general de su organización (o de cuenta personal si no tiene una).</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5">
            <input
              type="radio"
              name="acceso-ia"
              checked={override === true}
              disabled={pendiente === 'acceso'}
              onChange={() => void cambiarAcceso(true)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-ink-900">Habilitada a mano</span>
              <span className="block text-xs text-ink-500">Puede usar la IA sin importar la regla de su organización.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5">
            <input
              type="radio"
              name="acceso-ia"
              checked={override === false}
              disabled={pendiente === 'acceso'}
              onChange={() => void cambiarAcceso(false)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-ink-900">Revocada a mano</span>
              <span className="block text-xs text-ink-500">No puede usar la IA, aunque su organización la habilite.</span>
            </span>
          </label>
        </div>
      </section>
    </div>
  );
}
