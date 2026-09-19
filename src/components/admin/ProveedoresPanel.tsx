import { useState } from 'react';
import Interruptor from './Interruptor.tsx';
import ProveedorForm from './ProveedorForm.tsx';
import { apiRequest } from '../../lib/client/api.ts';
import type { ProveedorAdmin } from '../../lib/admin/proveedores.ts';

interface ProveedoresPanelProps {
  initialProveedores: ProveedorAdmin[];
}

/**
 * El listado de cuentas de proveedor de `/admin/proveedores`
 * (catalogo-de-proveedores design.md §7).
 *
 * Una lista de filas, como `ModelosPanel`, pero sin arrastre, sin orden y sin
 * radio de default: una cuenta no tiene ninguna de esas tres cosas.
 */
export default function ProveedoresPanel(props: ProveedoresPanelProps) {
  const [proveedores, setProveedores] = useState(props.initialProveedores);
  const [formAbierto, setFormAbierto] = useState<ProveedorAdmin | 'nuevo' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleEnabled(proveedor: ProveedorAdmin, valor: boolean) {
    setError(null);
    const anterior = proveedores;
    setProveedores((actuales) => actuales.map((item) => (item.id === proveedor.id ? { ...item, enabled: valor } : item)));

    const result = await apiRequest<{ proveedor: ProveedorAdmin }>(`/api/admin/providers/${proveedor.id}`, 'PATCH', {
      enabled: valor,
    });

    if (!result.ok) {
      setProveedores(anterior);
      setError(result.error);
    }
  }

  function alGuardar(proveedorGuardado: ProveedorAdmin) {
    setProveedores((actuales) => {
      const existe = actuales.some((item) => item.id === proveedorGuardado.id);
      if (existe) return actuales.map((item) => (item.id === proveedorGuardado.id ? proveedorGuardado : item));
      return [...actuales, proveedorGuardado].sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label),
      );
    });
    setFormAbierto(null);
  }

  const proveedorEnEdicion = formAbierto === 'nuevo' || formAbierto === null ? null : formAbierto;

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-500">
          {proveedores.length} cuenta{proveedores.length === 1 ? '' : 's'} de proveedor configurada
          {proveedores.length === 1 ? '' : 's'}.
        </p>
        <button type="button" onClick={() => setFormAbierto('nuevo')} className="kodu-btn-primary text-sm">
          + Nueva cuenta
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {proveedores.length === 0 ? (
        <div className="kodu-card p-10 text-center text-sm text-ink-500">
          Todavía no hay ninguna cuenta de proveedor configurada.
        </div>
      ) : (
        <ol className="space-y-2">
          {proveedores.map((proveedor) => (
            <li key={proveedor.id} className="kodu-card flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-40 flex-1">
                  <p className="font-medium text-ink-900">{proveedor.label}</p>
                  <p className="text-xs text-ink-500">
                    {proveedor.kind} · {proveedor.baseUrl}
                  </p>
                </div>

                <span className="w-28 shrink-0 text-xs text-ink-500">
                  {proveedor.tieneClave ? `•••• ${proveedor.apiKeyHint ?? ''}` : 'Sin clave'}
                </span>

                <span className="w-24 shrink-0 text-xs tabular-nums text-ink-500">
                  {proveedor.motores ?? 0} motor{proveedor.motores === 1 ? '' : 'es'}
                </span>

                <Interruptor
                  checked={proveedor.enabled}
                  onChange={(valor) => void toggleEnabled(proveedor, valor)}
                  label="Habilitada"
                  srOnly
                  id={`enabled-${proveedor.id}`}
                />

                <button
                  type="button"
                  onClick={() => setFormAbierto(proveedor)}
                  className="kodu-btn-ghost shrink-0 px-3 py-1.5 text-xs"
                >
                  Editar
                </button>
              </div>

              {!proveedor.enabled && (proveedor.motores ?? 0) > 0 && (
                <p className="text-xs text-ink-500">
                  Esta cuenta está apagada: sus {proveedor.motores} motor{proveedor.motores === 1 ? '' : 'es'} no se
                  ofrece{proveedor.motores === 1 ? '' : 'n'}.
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      {formAbierto && (
        <ProveedorForm proveedor={proveedorEnEdicion} onGuardado={alGuardar} onCerrar={() => setFormAbierto(null)} />
      )}
    </div>
  );
}
