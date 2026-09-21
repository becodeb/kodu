import { useId, useState, type FormEvent } from 'react';
import Modal from '../workspace/Modal.tsx';
import Interruptor from './Interruptor.tsx';
import { apiRequest } from '../../lib/client/api.ts';
import type { MotorAdmin } from '../../lib/admin/modelos.ts';
import type { ProveedorAdmin } from '../../lib/admin/proveedores.ts';

/**
 * Alta y edición de un motor (design.md — "The models list"; catalogo-de-proveedores
 * design.md §7 para el `<select>` de cuenta).
 *
 * Lo que vive en la FILA del panel (habilitar, default, orden) NO está acá:
 * el enable toggle y el radio de default se manejan directo desde
 * `ModelosPanel.tsx`, y el orden lo escriben el arrastre y las flechas. Este
 * diálogo es para todo lo demás: la cuenta de proveedor, el identificador, el
 * precio y los topes. La clave en sí ya no se toca acá — vive en la cuenta,
 * se edita desde `/admin/proveedores`.
 */

interface ModeloFormProps {
  /** `null` = alta de un motor nuevo. */
  motor: MotorAdmin | null;
  /** El resto del catálogo, para elegir un respaldo (nunca uno mismo). */
  otrosMotores: MotorAdmin[];
  /** El catálogo entero de cuentas de proveedor, para el `<select>` de abajo. */
  proveedores: ProveedorAdmin[];
  onGuardado: (motor: MotorAdmin) => void;
  onCerrar: () => void;
}

/**
 * Línea de vista previa: un turno típico —8.000 de entrada, 2.000 cacheados,
 * 4.000 de salida— con las tres tarifas que se están tipeando. Es la defensa
 * contra el error de unidad (por mil en vez de por millón, un factor de
 * 1000) que el registro de riesgos señala: sin esto es invisible hasta que un
 * total mensual se ve raro.
 */
function previewDePrecio(entrada: string, cacheada: string, salida: string): string | null {
  const precioEntrada = Number.parseFloat(entrada);
  const precioSalida = Number.parseFloat(salida);
  if (!Number.isFinite(precioEntrada) || !Number.isFinite(precioSalida)) return null;

  const precioCacheadaCruda = Number.parseFloat(cacheada);
  const precioCacheada = Number.isFinite(precioCacheadaCruda) ? precioCacheadaCruda : precioEntrada;

  const costo = (8_000 * precioEntrada + 2_000 * precioCacheada + 4_000 * precioSalida) / 1_000_000;
  const formateado = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(costo);

  return `Un turno típico —8.000 de entrada, 2.000 cacheados, 4.000 de salida— costaría ≈ US$ ${formateado}.`;
}

export default function ModeloForm(props: ModeloFormProps) {
  const { motor } = props;
  const idBase = useId();
  const sinProveedores = props.proveedores.length === 0;

  const [providerId, setProviderId] = useState(motor?.providerId ?? '');
  const [providerModel, setProviderModel] = useState(motor?.providerModel ?? '');
  const [displayName, setDisplayName] = useState(motor?.displayName ?? '');
  const [description, setDescription] = useState(motor?.description ?? '');
  const [adminNote, setAdminNote] = useState(motor?.adminNote ?? '');
  const [selectableByTeacher, setSelectableByTeacher] = useState(motor?.selectableByTeacher ?? true);
  const [supportsVision, setSupportsVision] = useState(motor?.supportsVision ?? false);
  const [maxOutputTokens, setMaxOutputTokens] = useState(String(motor?.maxOutputTokens ?? 131_072));
  const [reasoningEffort, setReasoningEffort] = useState(motor?.reasoningEffort ?? '');
  const [maxInputChars, setMaxInputChars] = useState(String(motor?.maxInputChars ?? 400_000));
  const [userTokenLimit, setUserTokenLimit] = useState(String(motor?.userTokenLimit ?? 0));
  const [fallbackModelId, setFallbackModelId] = useState(motor?.fallbackModelId ?? '');
  const [precioEntrada, setPrecioEntrada] = useState(motor?.priceInputPerMToken ?? '');
  const [precioCacheada, setPrecioCacheada] = useState(motor?.priceCachedInputPerMToken ?? '');
  const [precioSalida, setPrecioSalida] = useState(motor?.priceOutputPerMToken ?? '');

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = previewDePrecio(precioEntrada, precioCacheada, precioSalida);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!providerId || !providerModel.trim() || !displayName.trim()) {
      setError('Completá la cuenta, el identificador y el nombre.');
      return;
    }

    setPending(true);

    const payload: Record<string, unknown> = {
      providerId,
      providerModel: providerModel.trim(),
      displayName: displayName.trim(),
      description: description.trim() === '' ? null : description.trim(),
      adminNote: adminNote.trim() === '' ? null : adminNote.trim(),
      selectableByTeacher,
      supportsVision,
      maxOutputTokens: Number(maxOutputTokens),
      reasoningEffort: reasoningEffort === '' ? null : reasoningEffort,
      maxInputChars: Number(maxInputChars),
      userTokenLimit: Number(userTokenLimit),
      fallbackModelId: fallbackModelId === '' ? null : fallbackModelId,
      priceInputPerMToken: precioEntrada.trim() === '' ? null : Number(precioEntrada),
      priceCachedInputPerMToken: precioCacheada.trim() === '' ? null : Number(precioCacheada),
      priceOutputPerMToken: precioSalida.trim() === '' ? null : Number(precioSalida),
    };

    const result = motor
      ? await apiRequest<{ motor: MotorAdmin }>(`/api/admin/models/${motor.id}`, 'PATCH', payload)
      : await apiRequest<{ motor: MotorAdmin }>('/api/admin/models', 'POST', payload);

    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    props.onGuardado(result.data.motor);
  }

  return (
    <Modal
      abierto
      titulo={motor ? `Editar ${motor.displayName}` : 'Nuevo motor'}
      descripcion="La clave de la cuenta se edita desde /admin/proveedores, no acá."
      onCerrar={props.onCerrar}
      pie={
        <>
          <button type="button" onClick={props.onCerrar} className="kodu-btn-ghost text-sm">
            Cancelar
          </button>
          <button
            type="submit"
            form={`${idBase}-form`}
            disabled={pending || sinProveedores}
            className="kodu-btn-primary text-sm"
          >
            {pending ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id={`${idBase}-form`} onSubmit={submit} className="space-y-4">
        {sinProveedores && (
          <div className="kodu-card space-y-2 p-4 text-sm text-ink-700">
            <p>Todavía no hay ninguna cuenta de proveedor. Cargá una y volvé a crear el motor.</p>
            <a href="/admin/proveedores" className="kodu-btn-primary inline-block text-sm">
              Ir a Proveedores
            </a>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="kodu-label" htmlFor={`${idBase}-provider`}>
              Cuenta de proveedor
            </label>
            <select
              id={`${idBase}-provider`}
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              className="kodu-input"
              required
              disabled={sinProveedores}
            >
              <option value="">— Elegí una cuenta —</option>
              {props.proveedores.map((proveedor) => (
                <option key={proveedor.id} value={proveedor.id}>
                  {proveedor.label}
                  {proveedor.enabled ? '' : ' (apagada)'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="kodu-label" htmlFor={`${idBase}-providerModel`}>
              Identificador del modelo
            </label>
            <input
              id={`${idBase}-providerModel`}
              value={providerModel}
              onChange={(event) => setProviderModel(event.target.value)}
              placeholder="MiniMaxAI/MiniMax-M3"
              className="kodu-input"
              required
            />
          </div>
        </div>

        <div>
          <label className="kodu-label" htmlFor={`${idBase}-displayName`}>
            Nombre para el docente
          </label>
          <input
            id={`${idBase}-displayName`}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="MiniMax M3"
            className="kodu-input"
            required
          />
        </div>

        <div>
          <label className="kodu-label" htmlFor={`${idBase}-description`}>
            Descripción para el docente
          </label>
          <textarea
            id={`${idBase}-description`}
            value={description ?? ''}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            maxLength={300}
            placeholder="Una línea que aparece debajo del selector, en el chat."
            className="kodu-input resize-none"
          />
        </div>

        <div>
          <label className="kodu-label" htmlFor={`${idBase}-adminNote`}>
            Nota interna (el docente nunca la ve)
          </label>
          <textarea
            id={`${idBase}-adminNote`}
            value={adminNote ?? ''}
            onChange={(event) => setAdminNote(event.target.value)}
            rows={2}
            maxLength={1_000}
            className="kodu-input resize-none"
          />
        </div>

        <fieldset className="space-y-2 rounded-[10px] border border-linea p-3">
          <legend className="px-1 text-sm font-medium text-ink-700">
            Precio aproximado (USD por millón de tokens)
          </legend>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="kodu-label text-xs" htmlFor={`${idBase}-precioEntrada`}>
                Entrada (sin caché)
              </label>
              <input
                id={`${idBase}-precioEntrada`}
                inputMode="decimal"
                value={precioEntrada ?? ''}
                onChange={(event) => setPrecioEntrada(event.target.value)}
                placeholder="0,27"
                className="kodu-input"
              />
            </div>
            <div>
              <label className="kodu-label text-xs" htmlFor={`${idBase}-precioCacheada`}>
                Entrada cacheada
              </label>
              <input
                id={`${idBase}-precioCacheada`}
                inputMode="decimal"
                value={precioCacheada ?? ''}
                onChange={(event) => setPrecioCacheada(event.target.value)}
                placeholder="0,03"
                className="kodu-input"
              />
            </div>
            <div>
              <label className="kodu-label text-xs" htmlFor={`${idBase}-precioSalida`}>
                Salida
              </label>
              <input
                id={`${idBase}-precioSalida`}
                inputMode="decimal"
                value={precioSalida ?? ''}
                onChange={(event) => setPrecioSalida(event.target.value)}
                placeholder="1,10"
                className="kodu-input"
              />
            </div>
          </div>
          <p className="text-xs text-ink-500">
            Es una estimación. Algunos proveedores cobran distinto según la hora.
          </p>
          {preview && <p className="text-xs text-ink-700">{preview}</p>}
        </fieldset>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="kodu-label" htmlFor={`${idBase}-maxOutputTokens`}>
              Tokens máx. de salida
            </label>
            <input
              id={`${idBase}-maxOutputTokens`}
              type="number"
              min={1}
              value={maxOutputTokens}
              onChange={(event) => setMaxOutputTokens(event.target.value)}
              className="kodu-input"
            />
          </div>
          <div>
            <label className="kodu-label" htmlFor={`${idBase}-maxInputChars`}>
              Caracteres máx. de entrada
            </label>
            <input
              id={`${idBase}-maxInputChars`}
              type="number"
              min={1}
              value={maxInputChars}
              onChange={(event) => setMaxInputChars(event.target.value)}
              className="kodu-input"
            />
          </div>
          <div>
            <label className="kodu-label" htmlFor={`${idBase}-userTokenLimit`}>
              Tope por docente (0 = sin tope)
            </label>
            <input
              id={`${idBase}-userTokenLimit`}
              type="number"
              min={0}
              value={userTokenLimit}
              onChange={(event) => setUserTokenLimit(event.target.value)}
              className="kodu-input"
            />
          </div>
        </div>

        <div>
          <label className="kodu-label" htmlFor={`${idBase}-reasoningEffort`}>
            Razonamiento
          </label>
          <select
            id={`${idBase}-reasoningEffort`}
            value={reasoningEffort}
            onChange={(event) => setReasoningEffort(event.target.value)}
            className="kodu-input"
          >
            <option value="">No mandar el parámetro</option>
            <option value="none">Sin razonamiento</option>
            <option value="low">Bajo</option>
            <option value="high">Alto</option>
            <option value="max">Máximo</option>
          </select>
          <p className="mt-1 text-xs text-ink-500">
            Dejalo en «no mandar» salvo que sepas que el proveedor lo soporta: mandárselo a uno que
            no lo conoce devuelve un 400. Armar un recurso es escritura larga, no razonamiento, así
            que «sin razonamiento» suele salir más barato y más rápido.
          </p>
        </div>

        <div>
          <label className="kodu-label" htmlFor={`${idBase}-fallback`}>
            Motor de respaldo
          </label>
          <select
            id={`${idBase}-fallback`}
            value={fallbackModelId}
            onChange={(event) => setFallbackModelId(event.target.value)}
            className="kodu-input"
          >
            <option value="">— Sin respaldo —</option>
            {props.otrosMotores.map((otro) => (
              <option key={otro.id} value={otro.id}>
                {otro.displayName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-4">
          <Interruptor
            id={`${idBase}-selectable`}
            checked={selectableByTeacher}
            onChange={setSelectableByTeacher}
            label="Aparece en el selector del docente"
          />
          <Interruptor
            id={`${idBase}-vision`}
            checked={supportsVision}
            onChange={setSupportsVision}
            label="Admite imágenes (multimodal)"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
