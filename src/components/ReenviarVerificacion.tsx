import { useState } from 'react';
import { apiRequest } from '../lib/client/api.ts';

/**
 * odd/tasks/organizaciones.md (T3): botón de reenvío del mail de
 * verificación, dentro del cartel de "cuenta personal"
 * (`CuentaPersonal.astro`) cuando el motivo es el email sin confirmar. El
 * rate limit (1 por 60s) lo decide el servidor — acá sólo se refleja el
 * mensaje del 429, no se cuenta una espera propia.
 */
export default function ReenviarVerificacion() {
  const [pending, setPending] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string; esError: boolean } | null>(null);

  async function reenviar() {
    setPending(true);
    setMensaje(null);
    const resultado = await apiRequest('/api/auth/verificacion/reenviar', 'POST');
    setPending(false);

    if (!resultado.ok) {
      setMensaje({ texto: resultado.error, esError: true });
      return;
    }
    setMensaje({ texto: 'Te mandamos el enlace de nuevo. Revisá tu correo.', esError: false });
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={reenviar}
        disabled={pending}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? 'Mandando…' : 'Reenviar el correo'}
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
