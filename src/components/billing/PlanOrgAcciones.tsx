import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/client/api.ts';

interface Props {
  licenseStatus: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'READ_ONLY' | 'CANCELED' | 'MANUAL';
  declaredStudents: number;
  legalName: string | null;
  cuit: string | null;
  /** T8: condición frente al IVA — obligatoria para contratar (CondicionIVAReceptorId, RG 5616). */
  ivaCondition: 'RESPONSABLE_INSCRIPTO' | 'EXENTO' | 'MONOTRIBUTO' | 'CONSUMIDOR_FINAL' | null;
  cancelAtPeriodEnd: boolean;
  /** Admin de la organización RAÍZ (puede editar y pagar) vs. admin de una
   *  sede nada más (sólo lectura — odd/tasks/planes-y-cobros.md T6). */
  soloLectura: boolean;
}

type Preview =
  | { estado: 'idle' }
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string }
  | { estado: 'hablemos' }
  | { estado: 'ok'; amountArs: number; periodStart: string; periodEnd: string; bandName: string };

const formateador = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const formateadorFecha = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * odd/tasks/planes-y-cobros.md (T6): las acciones de `/org/plan` —
 * matrícula editable (banda congelada hasta el próximo cobro), razón
 * social/CUIT, botones "Pagar mensual"/"Pagar ciclo lectivo" que muestran el
 * monto y período EXACTOS (`firstCharge`, vía `/api/billing/org/preview`)
 * antes de tocar pagar, y cancelar. Un admin de sede sin ser admin de la
 * RAÍZ ve todo esto en modo lectura (sin inputs ni botones de acción).
 */
const ETIQUETA_IVA: Record<NonNullable<Props['ivaCondition']>, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable inscripto',
  EXENTO: 'Exento',
  MONOTRIBUTO: 'Monotributo',
  CONSUMIDOR_FINAL: 'Consumidor final',
};

export default function PlanOrgAcciones({ licenseStatus, declaredStudents, legalName, cuit, ivaCondition, cancelAtPeriodEnd, soloLectura }: Props) {
  const [matricula, setMatricula] = useState(String(declaredStudents));
  const [razonSocial, setRazonSocial] = useState(legalName ?? '');
  const [cuitValue, setCuitValue] = useState(cuit ?? '');
  const [ivaConditionValue, setIvaConditionValue] = useState(ivaCondition ?? '');
  const [previewMensual, setPreviewMensual] = useState<Preview>({ estado: 'idle' });
  const [previewCiclo, setPreviewCiclo] = useState<Preview>({ estado: 'idle' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const puedeContratar = licenseStatus === 'TRIAL' || licenseStatus === 'READ_ONLY' || licenseStatus === 'CANCELED';
  const puedeCancelar = (licenseStatus === 'ACTIVE' || licenseStatus === 'PAST_DUE') && !cancelAtPeriodEnd;

  useEffect(() => {
    if (soloLectura || !puedeContratar) return;
    let cancelado = false;
    (async () => {
      setPreviewMensual({ estado: 'cargando' });
      setPreviewCiclo({ estado: 'cargando' });
      const [mensual, ciclo] = await Promise.all([
        apiRequest<{ amountArs: number; periodStart: string; periodEnd: string; bandName: string }>(
          '/api/billing/org/preview?interval=MONTHLY',
        ),
        apiRequest<{ amountArs: number; periodStart: string; periodEnd: string; bandName: string }>(
          '/api/billing/org/preview?interval=CYCLE',
        ),
      ]);
      if (cancelado) return;
      setPreviewMensual(mensual.ok ? { estado: 'ok', ...mensual.data } : { estado: 'error', mensaje: mensual.error });
      setPreviewCiclo(ciclo.ok ? { estado: 'ok', ...ciclo.data } : { estado: 'error', mensaje: ciclo.error });
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloLectura, puedeContratar, matricula]);

  async function guardarMatricula() {
    const n = Number(matricula);
    if (!Number.isInteger(n) || n < 1) {
      setError('La matrícula tiene que ser un número entero mayor a 0.');
      return;
    }
    setError(null);
    setPending(true);
    const resultado = await apiRequest<{ bandName?: string; monthlyPriceArs?: number; cyclePriceArs?: number; reason?: string }>(
      '/api/billing/org/matricula',
      'POST',
      { declaredStudents: n },
    );
    setPending(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    setAviso(
      resultado.data.reason === 'HABLEMOS'
        ? 'Esa matrícula es "Hablemos" — escribinos para armar una propuesta.'
        : `Guardado. Si esto te cambió de banda (ahora: ${resultado.data.bandName}), el precio nuevo aplica recién desde tu próximo cobro.`,
    );
  }

  async function pagar(interval: 'MONTHLY' | 'CYCLE') {
    if (!razonSocial.trim() || !cuitValue.trim() || !ivaConditionValue) {
      setError('Completá razón social, CUIT y condición frente al IVA antes de pagar.');
      return;
    }
    setError(null);
    setPending(true);
    const resultado = await apiRequest<{ url: string }>('/api/billing/org/checkout', 'POST', {
      interval,
      legalName: razonSocial,
      cuit: cuitValue,
      ivaCondition: ivaConditionValue,
    });
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
        'Tu institución sigue con acceso hasta el fin del período que ya pagaron. Después, la licencia queda cancelada. ¿Confirmás?',
      )
    ) {
      return;
    }
    setError(null);
    setPending(true);
    const resultado = await apiRequest('/api/billing/org/cancel', 'POST');
    setPending(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    window.location.reload();
  }

  function renderPreview(preview: Preview, label: string, interval: 'MONTHLY' | 'CYCLE') {
    if (preview.estado === 'idle' || preview.estado === 'cargando') {
      return (
        <div className="kodu-card flex flex-col gap-2 p-4">
          <h3 className="text-sm font-semibold text-ink-900">{label}</h3>
          <p className="text-sm text-ink-500">Calculando…</p>
        </div>
      );
    }
    if (preview.estado === 'error' || preview.estado === 'hablemos') {
      return (
        <div className="kodu-card flex flex-col gap-2 p-4">
          <h3 className="text-sm font-semibold text-ink-900">{label}</h3>
          <p className="text-sm text-ink-500">
            {preview.estado === 'hablemos' ? 'Tu matrícula es "Hablemos" — escribinos.' : preview.mensaje}
          </p>
        </div>
      );
    }
    return (
      <div className="kodu-card flex flex-col gap-2 p-4">
        <h3 className="text-sm font-semibold text-ink-900">{label}</h3>
        <p className="text-sm text-ink-700">
          Hoy pagás <strong>{formateador.format(preview.amountArs)}</strong> y cubre del{' '}
          {formateadorFecha.format(new Date(preview.periodStart))} al {formateadorFecha.format(new Date(preview.periodEnd))}.
        </p>
        <button type="button" className="kodu-btn kodu-btn-primary" disabled={pending} onClick={() => void pagar(interval)}>
          {interval === 'MONTHLY' ? 'Pagar mensual' : 'Pagar ciclo lectivo'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {aviso && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{aviso}</p>}

      <div>
        <label className="kodu-label" htmlFor="org-matricula">
          Matrícula declarada
        </label>
        <div className="flex gap-2">
          <input
            id="org-matricula"
            type="number"
            min={1}
            step={1}
            className="kodu-input max-w-[10rem]"
            value={matricula}
            disabled={soloLectura || pending}
            onChange={(e) => setMatricula(e.target.value)}
          />
          {!soloLectura && (
            <button type="button" className="kodu-btn kodu-btn-ghost" disabled={pending} onClick={() => void guardarMatricula()}>
              Guardar
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="kodu-label" htmlFor="org-razon-social">
            Razón social
          </label>
          <input
            id="org-razon-social"
            className="kodu-input"
            disabled={soloLectura || pending}
            value={razonSocial}
            onChange={(e) => setRazonSocial(e.target.value)}
            placeholder="Colegio San Martín S.R.L."
          />
        </div>
        <div>
          <label className="kodu-label" htmlFor="org-cuit">
            CUIT
          </label>
          <input
            id="org-cuit"
            className="kodu-input"
            disabled={soloLectura || pending}
            value={cuitValue}
            onChange={(e) => setCuitValue(e.target.value)}
            placeholder="20-12345678-3"
          />
        </div>
        <div>
          <label className="kodu-label" htmlFor="org-iva">
            Condición frente al IVA
          </label>
          <select
            id="org-iva"
            className="kodu-input"
            disabled={soloLectura || pending}
            value={ivaConditionValue}
            onChange={(e) => setIvaConditionValue(e.target.value as Props['ivaCondition'] & string)}
          >
            <option value="" disabled>
              Elegí una opción
            </option>
            {(Object.keys(ETIQUETA_IVA) as Array<keyof typeof ETIQUETA_IVA>).map((key) => (
              <option key={key} value={key}>
                {ETIQUETA_IVA[key]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-500">Hace falta para la Factura C (es un dato obligatorio de ARCA).</p>
        </div>
      </div>

      {soloLectura ? (
        <p className="text-sm text-ink-500">
          Sólo quien administra la institución entera puede editar estos datos y pagar.
        </p>
      ) : puedeContratar ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {renderPreview(previewMensual, 'Pagar mensual', 'MONTHLY')}
          {renderPreview(previewCiclo, 'Pagar ciclo lectivo', 'CYCLE')}
        </div>
      ) : puedeCancelar ? (
        <button type="button" className="kodu-btn kodu-btn-ghost" disabled={pending} onClick={() => void cancelar()}>
          Cancelar
        </button>
      ) : null}

      <p className="text-sm">
        <a href="/instituciones/alta" className="text-brand-600 hover:underline">
          Hablemos
        </a>
      </p>
    </div>
  );
}
