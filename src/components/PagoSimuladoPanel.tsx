import { useState } from 'react';
import { apiRequest } from '../lib/client/api.ts';

interface Props {
  id: string;
  esSuscripcion: boolean;
  /** Ya resuelto (APPROVED/REJECTED) — no muestra los botones de resolver. */
  yaResuelto: boolean;
  esCancelado: boolean;
}

/**
 * odd/tasks/planes-y-cobros.md (T4): los botones de `/pago-simulado/[id]` —
 * "el flujo es idéntico" al real, ver el comentario de
 * `src/lib/billing/pasarela/simulado.ts`. Cada botón llama a
 * `POST /api/billing/pago-simulado/[id]/accion`, que arma la MISMA
 * notificación que produciría un webhook real y la aplica con
 * `aplicar.ts#procesarNotificacion`.
 */
export default function PagoSimuladoPanel({ id, esSuscripcion, yaResuelto, esCancelado }: Props) {
  const [pendiente, setPendiente] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function accionar(accion: 'aprobar' | 'rechazar' | 'renovacion_ok' | 'renovacion_fallida') {
    setPendiente(accion);
    setMensaje(null);
    const resultado = await apiRequest<{ applied: boolean; reason: string; backUrl?: string }>(
      `/api/billing/pago-simulado/${id}/accion`,
      'POST',
      { accion },
    );
    setPendiente(null);

    if (!resultado.ok) {
      setMensaje(`No se pudo: ${resultado.error}`);
      return;
    }
    if (!resultado.data.applied) {
      setMensaje(`No se aplicó (${resultado.data.reason}).`);
      return;
    }
    if (resultado.data.backUrl) {
      window.location.href = resultado.data.backUrl;
      return;
    }
    setMensaje('Listo — se simuló el cobro de renovación.');
  }

  if (esCancelado) {
    return <p className="text-sm text-ink-500">Esta suscripción simulada ya está cancelada.</p>;
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      {!yaResuelto && (
        <>
          <button
            type="button"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            disabled={pendiente !== null}
            onClick={() => accionar('aprobar')}
          >
            {pendiente === 'aprobar' ? 'Aprobando…' : 'Aprobar pago'}
          </button>
          <button
            type="button"
            className="rounded-lg border border-linea px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:border-ink-500 disabled:opacity-50"
            disabled={pendiente !== null}
            onClick={() => accionar('rechazar')}
          >
            {pendiente === 'rechazar' ? 'Rechazando…' : 'Rechazar pago'}
          </button>
        </>
      )}
      {esSuscripcion && yaResuelto && (
        <>
          <p className="text-xs text-ink-500">
            Este pago ya se resolvió. Podés simular un cobro de renovación de esta suscripción:
          </p>
          <button
            type="button"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            disabled={pendiente !== null}
            onClick={() => accionar('renovacion_ok')}
          >
            {pendiente === 'renovacion_ok' ? 'Simulando…' : 'Simular cobro de renovación'}
          </button>
          <button
            type="button"
            className="rounded-lg border border-linea px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:border-ink-500 disabled:opacity-50"
            disabled={pendiente !== null}
            onClick={() => accionar('renovacion_fallida')}
          >
            {pendiente === 'renovacion_fallida' ? 'Simulando…' : 'Simular cobro fallido'}
          </button>
        </>
      )}
      {mensaje && <p className="text-sm text-ink-600">{mensaje}</p>}
    </div>
  );
}
