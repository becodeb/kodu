import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/client/api.ts';
import Interruptor from './Interruptor.tsx';
import type { ResumenGeneracion } from '../../lib/admin/generacion.ts';

interface Props {
  initial: ResumenGeneracion;
}

/** Cada cuánto se refresca la caja "Gastado este ciclo…" sin que el admin
 *  tenga que recargar la página — el gasto cambia con cada turno real de
 *  los docentes, no sólo cuando alguien guarda algo en este panel. */
const REFRESCO_CICLO_MS = 20_000;

function formatoUsd(valor: number): string {
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor);
}

/**
 * `/admin/generacion` (T7, motor-claude): además del interruptor viejo de
 * "Varias versiones al crear" (generacion-simple-y-reanudable.md), ahora
 * vive acá el modo de generación activo, los dos motores de "personalizado",
 * las tres cifras del crédito mensual, y una caja viva con el gasto del
 * ciclo, el modo EFECTIVO (puede ser distinto del configurado si el crédito
 * ya se agotó) y la proyección al cierre.
 */
export default function GeneracionPanel({ initial }: Props) {
  const [resumen, setResumen] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function refrescarCiclo() {
    const result = await apiRequest<{ resumen: ResumenGeneracion }>('/api/admin/generacion', 'GET');
    if (result.ok) setResumen(result.data.resumen);
  }

  useEffect(() => {
    const id = window.setInterval(() => void refrescarCiclo(), REFRESCO_CICLO_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Hallazgo de revisión (motor-claude, pre-deploy): "Usar Haiku 5.5 como
   * revisor" — reusa el PATCH de admin de motores que ya existe
   * (`/api/admin/models/[id]`, el mismo que `ModeloForm.tsx`), nunca una
   * ruta nueva. Esa ruta ya respeta "a lo sumo un verificador" (baja
   * cualquier otro ANTES, en la misma transacción) — este botón sólo
   * decide A CUÁL motor apuntarle, con el candidato que ya trae el
   * resumen (`haikuParaVerificador`).
   */
  const [activandoVerificador, setActivandoVerificador] = useState(false);

  async function usarHaikuComoRevisor() {
    if (!resumen.haikuParaVerificador) return;
    setError(null);
    setActivandoVerificador(true);
    const result = await apiRequest(`/api/admin/models/${resumen.haikuParaVerificador.id}`, 'PATCH', {
      isVerifier: true,
    });
    setActivandoVerificador(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refrescarCiclo();
  }

  async function patchSettings(datos: Record<string, unknown>): Promise<boolean> {
    setError(null);
    setGuardando(true);
    const result = await apiRequest('/api/admin/settings', 'PATCH', datos);
    setGuardando(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    // Las tres cifras/el modo alteran el gasto/la proyección mostrados: se
    // relee el resumen entero (no sólo la fila cruda que devuelve el PATCH).
    await refrescarCiclo();
    return true;
  }

  async function guardarVersionesForAll(valor: boolean) {
    const anterior = resumen.versionsForAll;
    setResumen({ ...resumen, versionsForAll: valor });
    const okResult = await patchSettings({ versionsForAll: valor });
    if (!okResult) setResumen((actual) => ({ ...actual, versionsForAll: anterior }));
  }

  async function elegirModo(key: string) {
    const anterior = resumen.generationMode;
    setResumen({ ...resumen, generationMode: key });
    const okResult = await patchSettings({ generationMode: key });
    if (!okResult) setResumen((actual) => ({ ...actual, generationMode: anterior }));
  }

  async function elegirModeloPersonalizado(rol: 'creationModelId' | 'adjustmentModelId', valor: string) {
    const anterior = resumen[rol];
    setResumen({ ...resumen, [rol]: valor === '' ? null : valor });
    const okResult = await patchSettings({ [rol]: valor === '' ? null : valor });
    if (!okResult) setResumen((actual) => ({ ...actual, [rol]: anterior }));
  }

  // Los tres números del crédito se escriben como texto libre y se mandan
  // recién al perder el foco — mandar un PATCH por cada tecla tipeada
  // gastaría una escritura por dígito sin ninguna ganancia.
  const [monthlyCreditUsd, setMonthlyCreditUsd] = useState(resumen.monthlyCreditUsd);
  const [premiumUntilUsd, setPremiumUntilUsd] = useState(resumen.premiumUntilUsd);
  const [billingCycleDay, setBillingCycleDay] = useState(String(resumen.billingCycleDay));

  async function guardarCifraDeCredito(campo: 'monthlyCreditUsd' | 'premiumUntilUsd' | 'billingCycleDay', valorTexto: string) {
    const numero = Number(valorTexto.replace(',', '.'));
    if (!Number.isFinite(numero) || numero < 0) {
      setError('Ese número no es válido.');
      return;
    }
    await patchSettings({ [campo]: numero });
  }

  const modoActivo = resumen.modos.find((modo) => modo.key === resumen.generationMode) ?? null;
  const esPersonalizado = resumen.generationMode === 'personalizado';

  // Etiquetas por clave, derivadas de la misma lista que llena el <select> —
  // nunca un segundo literal que se pueda desincronizar del real.
  const etiquetaPorClave: Record<string, string> = { personalizado: 'Personalizado' };
  for (const modo of resumen.modos) etiquetaPorClave[modo.key] = modo.label;

  return (
    <div className="max-w-2xl space-y-8">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {!resumen.hayVerificadorUsable && (
        <div className="kodu-card space-y-2 border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">No hay ningún revisor visual activo</p>
          <p className="text-sm text-amber-800">
            Sin un motor marcado como verificador (o con el motor marcado apagado, o sin clave), los recursos se crean
            sin que nadie los revise después de la autoprueba.
          </p>
          {resumen.haikuParaVerificador ? (
            <button
              type="button"
              onClick={() => void usarHaikuComoRevisor()}
              disabled={activandoVerificador}
              className="kodu-btn-primary text-sm"
            >
              {activandoVerificador ? 'Activando…' : 'Usar Haiku 5.5 como revisor'}
            </button>
          ) : (
            <p className="text-sm text-amber-800">
              Cargá el preset de Claude Haiku 5.5 desde{' '}
              <a href="/admin/motores" className="underline">
                /admin/motores
              </a>{' '}
              para poder activarlo como revisor desde acá.
            </p>
          )}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">Modo de generación</h2>
        <div className="kodu-card space-y-3 p-4">
          <select
            id="modo-generacion"
            value={resumen.generationMode}
            onChange={(event) => void elegirModo(event.target.value)}
            disabled={guardando}
            className="kodu-input"
          >
            {resumen.modos.map((modo) => (
              <option key={modo.key} value={modo.key}>
                {modo.label}
              </option>
            ))}
            <option value="personalizado">Personalizado</option>
          </select>

          {esPersonalizado ? (
            <p className="text-sm text-ink-500">
              Elegís a mano qué motor crea y qué motor ajusta, de los habilitados en{' '}
              <a href="/admin/motores" className="text-brand-600 hover:underline">
                /admin/motores
              </a>
              .
            </p>
          ) : (
            modoActivo && (
              <div className="space-y-1.5">
                <p className="text-sm text-ink-700">{modoActivo.description}</p>
                <p className="text-xs text-ink-500">
                  Crear: {modoActivo.measuredCreation} · Ajustar: {modoActivo.measuredAdjustment}
                </p>
                {modoActivo.presetsFaltantes.length > 0 && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Falta configurar: {modoActivo.presetsFaltantes.join(', ')}. Mientras tanto, este modo se comporta
                    como el modo base. Cargalo desde{' '}
                    <a href="/admin/motores" className="underline">
                      /admin/motores
                    </a>
                    .
                  </p>
                )}
              </div>
            )
          )}

          {esPersonalizado && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="kodu-label text-xs" htmlFor="modo-creacion">
                  Motor para crear
                </label>
                <select
                  id="modo-creacion"
                  value={resumen.creationModelId ?? ''}
                  onChange={(event) => void elegirModeloPersonalizado('creationModelId', event.target.value)}
                  disabled={guardando}
                  className="kodu-input"
                >
                  <option value="">— Sin elegir (cae al modo base) —</option>
                  {resumen.modelosHabilitados.map((motor) => (
                    <option key={motor.id} value={motor.id}>
                      {motor.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="kodu-label text-xs" htmlFor="modo-ajuste">
                  Motor para ajustar
                </label>
                <select
                  id="modo-ajuste"
                  value={resumen.adjustmentModelId ?? ''}
                  onChange={(event) => void elegirModeloPersonalizado('adjustmentModelId', event.target.value)}
                  disabled={guardando}
                  className="kodu-input"
                >
                  <option value="">— Sin elegir (cae al modo base) —</option>
                  {resumen.modelosHabilitados.map((motor) => (
                    <option key={motor.id} value={motor.id}>
                      {motor.displayName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">Crédito mensual</h2>
        <div className="kodu-card grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <div>
            <label className="kodu-label text-xs" htmlFor="credito-mensual">
              Crédito incluido (USD/mes)
            </label>
            <input
              id="credito-mensual"
              inputMode="decimal"
              value={monthlyCreditUsd}
              onChange={(event) => setMonthlyCreditUsd(event.target.value)}
              onBlur={() => void guardarCifraDeCredito('monthlyCreditUsd', monthlyCreditUsd)}
              className="kodu-input"
            />
          </div>
          <div>
            <label className="kodu-label text-xs" htmlFor="tope-premium">
              Tope para modos premium (USD)
            </label>
            <input
              id="tope-premium"
              inputMode="decimal"
              value={premiumUntilUsd}
              onChange={(event) => setPremiumUntilUsd(event.target.value)}
              onBlur={() => void guardarCifraDeCredito('premiumUntilUsd', premiumUntilUsd)}
              className="kodu-input"
            />
          </div>
          <div>
            <label className="kodu-label text-xs" htmlFor="dia-de-corte">
              Día de corte del ciclo (1-28)
            </label>
            <input
              id="dia-de-corte"
              type="number"
              min={1}
              max={28}
              value={billingCycleDay}
              onChange={(event) => setBillingCycleDay(event.target.value)}
              onBlur={() => void guardarCifraDeCredito('billingCycleDay', billingCycleDay)}
              className="kodu-input"
            />
          </div>
        </div>
        <p className="text-xs text-ink-500">
          Al llegar al tope premium, cualquier modo que no sea "Haiku (recomendado)" —incluido
          Personalizado— se comporta como el modo base hasta el próximo corte. Al llegar al crédito
          incluido, se sigue trabajando en el modo base, pero la caja de abajo se pone en rojo.
        </p>

        <div
          className={`kodu-card space-y-1 p-4 text-sm ${
            resumen.ciclo.gastoUsd >= Number(resumen.monthlyCreditUsd) ? 'border-red-300 bg-red-50 text-red-800' : ''
          }`}
        >
          <p>
            Gastado este ciclo: <strong>USD {formatoUsd(resumen.ciclo.gastoUsd)}</strong> de USD{' '}
            {formatoUsd(Number(resumen.monthlyCreditUsd))} · modo efectivo:{' '}
            <strong>{etiquetaPorClave[resumen.ciclo.modoEfectivo] ?? resumen.ciclo.modoEfectivo}</strong> · proyección al
            cierre: USD {formatoUsd(resumen.ciclo.proyeccionUsd)}
          </p>
          {resumen.ciclo.gastoUsd >= Number(resumen.monthlyCreditUsd) && (
            <p className="font-medium">
              El crédito incluido se agotó; lo que siga se cobra aparte o se corta según la Console.
            </p>
          )}
          {resumen.ciclo.automatico && (
            <p className="text-ink-700">
              Hoy los recursos nuevos usan: <strong>{resumen.ciclo.automatico.tierEtiqueta}</strong> — porque{' '}
              {resumen.ciclo.automatico.razon}. Quedan {resumen.ciclo.automatico.diasRestantes.toFixed(1)} días del
              ciclo, crédito restante USD {formatoUsd(resumen.ciclo.automatico.creditoRestanteUsd)}, proyección de
              cierre USD {formatoUsd(resumen.ciclo.automatico.proyeccionCierreUsd)}.
            </p>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-ink-900">Varias versiones al crear</h2>
        <div className="kodu-card divide-y divide-linea">
          <div className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium text-ink-900">Varias versiones al crear</p>
              <p className="mt-0.5 text-sm text-ink-500">
                Permitir que los docentes activen 3 versiones en sus proyectos. Triplica el costo
                de cada generación en los proyectos donde lo activan, y todavía no está medido.
              </p>
            </div>
            <Interruptor
              id="versions-toggle"
              checked={resumen.versionsForAll}
              disabled={guardando}
              onChange={(valor) => void guardarVersionesForAll(valor)}
              label="Varias versiones para todos"
              srOnly
            />
          </div>
        </div>

        <p className="text-xs text-ink-500">
          La cuenta demo sigue con su propio tope de tokens (configurable en{' '}
          <a href="/admin/demo" className="text-brand-600 hover:underline">
            /admin/demo
          </a>
          ), sin nada extra.
        </p>
      </section>
    </div>
  );
}
