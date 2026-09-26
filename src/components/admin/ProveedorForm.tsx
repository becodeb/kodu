import { useId, useState, type FormEvent } from 'react';
import Modal from '../workspace/Modal.tsx';
import Interruptor from './Interruptor.tsx';
import { apiRequest } from '../../lib/client/api.ts';
import type { ProveedorAdmin } from '../../lib/admin/proveedores.ts';

/**
 * Alta y edición de una cuenta de proveedor (catalogo-de-proveedores design.md §7).
 *
 * Sólo `kind`, `label`, `baseUrl` y la clave — no hay orden, no hay default,
 * no hay motores acá: eso vive en `ModeloForm.tsx`.
 */

interface ProveedorFormProps {
  /** `null` = alta de una cuenta nueva. */
  proveedor: ProveedorAdmin | null;
  onGuardado: (proveedor: ProveedorAdmin) => void;
  onCerrar: () => void;
}

export default function ProveedorForm(props: ProveedorFormProps) {
  const { proveedor } = props;
  const idBase = useId();

  const [kind, setKind] = useState(proveedor?.kind ?? '');
  const [label, setLabel] = useState(proveedor?.label ?? '');
  const [baseUrl, setBaseUrl] = useState(proveedor?.baseUrl ?? '');
  const [apiFormat, setApiFormat] = useState(proveedor?.apiFormat ?? 'chat');
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(proveedor?.enabled ?? true);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!kind.trim() || !label.trim() || !baseUrl.trim()) {
      setError('Completá el tipo, el nombre y la URL base.');
      return;
    }

    setPending(true);

    const payload: Record<string, unknown> = {
      kind: kind.trim(),
      label: label.trim(),
      baseUrl: baseUrl.trim(),
      apiFormat,
    };
    if (proveedor) payload.enabled = enabled;
    if (apiKey.trim() !== '') payload.apiKey = apiKey.trim();

    const result = proveedor
      ? await apiRequest<{ proveedor: ProveedorAdmin }>(`/api/admin/providers/${proveedor.id}`, 'PATCH', payload)
      : await apiRequest<{ proveedor: ProveedorAdmin }>('/api/admin/providers', 'POST', payload);

    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    props.onGuardado(result.data.proveedor);
  }

  return (
    <Modal
      abierto
      titulo={proveedor ? `Editar ${proveedor.label}` : 'Nueva cuenta de proveedor'}
      descripcion="Los campos con clave nunca vuelven a mostrar el valor cargado."
      onCerrar={props.onCerrar}
      pie={
        <>
          <button type="button" onClick={props.onCerrar} className="kodu-btn-ghost text-sm">
            Cancelar
          </button>
          <button type="submit" form={`${idBase}-form`} disabled={pending} className="kodu-btn-primary text-sm">
            {pending ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id={`${idBase}-form`} onSubmit={submit} className="space-y-4">
        <div>
          <label className="kodu-label" htmlFor={`${idBase}-kind`}>
            Tipo de proveedor
          </label>
          <input
            id={`${idBase}-kind`}
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            placeholder="gmi"
            className="kodu-input"
            required
          />
        </div>

        <div>
          <label className="kodu-label" htmlFor={`${idBase}-label`}>
            Nombre de la cuenta
          </label>
          <input
            id={`${idBase}-label`}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="GMI — cuenta de la escuela"
            className="kodu-input"
            required
          />
        </div>

        <div>
          <label className="kodu-label" htmlFor={`${idBase}-baseUrl`}>
            URL base
          </label>
          <input
            id={`${idBase}-baseUrl`}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.gmi-serving.com"
            className="kodu-input"
            required
          />
        </div>

        <div>
          <label className="kodu-label" htmlFor={`${idBase}-apiFormat`}>
            Formato de API
          </label>
          <select
            id={`${idBase}-apiFormat`}
            value={apiFormat}
            onChange={(event) => setApiFormat(event.target.value)}
            className="kodu-input"
          >
            <option value="chat">Chat Completions (la mayoría)</option>
            <option value="responses">Responses (OpenAI)</option>
          </select>
          <p className="mt-1 text-xs text-ink-500">
            Los modelos de razonamiento de OpenAI (como gpt-6-luna) sólo aceptan herramientas junto con
            razonamiento a través de Responses.
          </p>
        </div>

        <div>
          <label className="kodu-label" htmlFor={`${idBase}-apiKey`}>
            Reemplazar clave
          </label>
          <input
            id={`${idBase}-apiKey`}
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={proveedor?.tieneClave ? `•••• ${proveedor.apiKeyHint ?? ''}` : 'Sin clave'}
            className="kodu-input"
          />
          <p className="mt-1 text-xs text-ink-500">
            Dejalo vacío para no tocar la clave guardada. Nunca se vuelve a mostrar acá.
          </p>
        </div>

        {proveedor && (
          <Interruptor id={`${idBase}-enabled`} checked={enabled} onChange={setEnabled} label="Cuenta habilitada" />
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
