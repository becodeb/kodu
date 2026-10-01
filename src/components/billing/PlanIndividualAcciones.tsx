import { useState } from 'react';
import { apiRequest } from '../../lib/client/api.ts';

interface Props {
  /** Hay una `IndividualSubscription` con `status === 'ACTIVE'`. */
  suscripcionActiva: boolean;
  cancelAtPeriodEnd: boolean;
  /** Dentro de los 10 días del primer pago aprobado de la suscripción actual. */
  puedeArrepentirse: boolean;
  monthlyPriceArs: number;
  annualPriceArs: number | null;
}

const formateador = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

/**
 * odd/tasks/planes-y-cobros.md (T6): las acciones de `/app/plan` — contratar
 * (elige mensual/anual y llama al checkout), cancelar (confirma antes, explica
 * que sigue con acceso hasta el fin del período) y, sólo dentro de los 10
 * días del primer pago, el botón de arrepentimiento (revierte a Gratis ya
 * mismo, no "al fin del período" — por eso lleva su propia confirmación).
 */
export default function PlanIndividualAcciones({
  suscripcionActiva,
  cancelAtPeriodEnd,
  puedeArrepentirse,
  monthlyPriceArs,
  annualPriceArs,
}: Props) {
  const [interval, setInterval_] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function contratar() {
    setError(null);
    setPending(true);
    const resultado = await apiRequest<{ url: string }>('/api/billing/individual/checkout', 'POST', { interval });
    setPending(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    window.location.href = resultado.data.url;
  }

  async function cancelar() {
    if (
      !window.confirm(
        'Vas a seguir con acceso al plan Individual hasta el fin del período que ya pagaste. Después, tu cuenta vuelve a Gratis. ¿Confirmás?',
      )
    ) {
      return;
    }
    setError(null);
    setPending(true);
    const resultado = await apiRequest('/api/billing/individual/cancel', 'POST');
    setPending(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    window.location.reload();
  }

  async function arrepentirse() {
    if (
      !window.confirm(
        'Esto cancela tu plan Individual YA MISMO (no al fin del período) y volvés a Gratis. ¿Confirmás el arrepentimiento?',
      )
    ) {
      return;
    }
    setError(null);
    setPending(true);
    const resultado = await apiRequest('/api/billing/individual/arrepentimiento', 'POST');
    setPending(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    window.location.reload();
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {suscripcionActiva ? (
        <div className="flex flex-wrap gap-2">
          {!cancelAtPeriodEnd && (
            <button type="button" className="kodu-btn kodu-btn-ghost" disabled={pending} onClick={() => void cancelar()}>
              Cancelar suscripción
            </button>
          )}
          {puedeArrepentirse && (
            <button type="button" className="kodu-btn kodu-btn-ghost" disabled={pending} onClick={() => void arrepentirse()}>
              Botón de arrepentimiento
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-linea bg-sutil p-1 text-sm">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 font-semibold ${interval === 'MONTHLY' ? 'bg-superficie text-brand-700 shadow-sm' : 'text-ink-500'}`}
              onClick={() => setInterval_('MONTHLY')}
              disabled={pending}
            >
              Mensual · {formateador.format(monthlyPriceArs)}
            </button>
            {annualPriceArs !== null && (
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 font-semibold ${interval === 'ANNUAL' ? 'bg-superficie text-brand-700 shadow-sm' : 'text-ink-500'}`}
                onClick={() => setInterval_('ANNUAL')}
                disabled={pending}
              >
                Anual · {formateador.format(annualPriceArs)}
              </button>
            )}
          </div>
          <button type="button" className="kodu-btn kodu-btn-primary" disabled={pending} onClick={() => void contratar()}>
            {pending ? 'Redirigiendo…' : 'Pasate a Individual'}
          </button>
        </div>
      )}
    </div>
  );
}
