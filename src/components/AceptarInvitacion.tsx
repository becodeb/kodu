import { useState } from 'react';
import { apiRequest } from '../lib/client/api.ts';

interface Props {
  token: string;
  sedeName: string;
}

/**
 * odd/tasks/organizaciones.md (T4): botón "Unirme a <sede>" de
 * `/invitacion/[token]` para quien ya tiene sesión y puede aceptar (cuenta
 * personal, sin organización, no es la demo). Los otros estados (ya en esa
 * sede, en otra organización, demo) se resuelven del lado del servidor y ni
 * siquiera montan este componente — ver la página.
 */
export default function AceptarInvitacion({ token, sedeName }: Props) {
  const [pending, setPending] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string; esError: boolean } | null>(null);

  async function aceptar() {
    setPending(true);
    setMensaje(null);
    const resultado = await apiRequest('/api/invitaciones/aceptar', 'POST', { token });

    if (!resultado.ok) {
      setPending(false);
      setMensaje({ texto: resultado.error, esError: true });
      return;
    }
    window.location.href = '/app';
  }

  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <button type="button" onClick={aceptar} disabled={pending} className="kodu-btn-primary">
        {pending ? 'Uniéndote…' : `Unirme a ${sedeName}`}
      </button>
      {mensaje && (
        <p
          role={mensaje.esError ? 'alert' : undefined}
          className={`text-xs ${mensaje.esError ? 'text-red-600' : 'text-ink-500'}`}
        >
          {mensaje.texto}
        </p>
      )}
    </div>
  );
}
