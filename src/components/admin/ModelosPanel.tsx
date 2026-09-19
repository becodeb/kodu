import { useState, type DragEvent, type KeyboardEvent } from 'react';
import Interruptor from './Interruptor.tsx';
import ModeloForm from './ModeloForm.tsx';
import { apiRequest } from '../../lib/client/api.ts';
import type { MotorAdmin } from '../../lib/admin/modelos.ts';

interface ModelosPanelProps {
  initialMotores: MotorAdmin[];
}

/**
 * El listado de motores de `/admin/motores` (design.md — "The models list").
 *
 * Es una lista de motores que un admin ajusta, no un dashboard: una fila por
 * motor, sin tarjetas de estadísticas ni grilla. El único elemento con
 * boldness es el botón "+ Nuevo motor".
 */
export default function ModelosPanel(props: ModelosPanelProps) {
  const [motores, setMotores] = useState(props.initialMotores);
  const [formAbierto, setFormAbierto] = useState<MotorAdmin | 'nuevo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState('');
  const [arrastrandoId, setArrastrandoId] = useState<string | null>(null);

  function formatearPrecio(motor: MotorAdmin): string {
    if (motor.priceInputPerMToken === null && motor.priceOutputPerMToken === null) {
      return 'Sin precio cargado';
    }
    const entrada = motor.priceInputPerMToken ?? '—';
    const salida = motor.priceOutputPerMToken ?? '—';
    return `in ${entrada} / out ${salida}`;
  }

  /** Escribe el orden nuevo en el servidor; si falla, vuelve al orden anterior. */
  async function aplicarOrden(anterior: MotorAdmin[], nuevo: MotorAdmin[], movido: MotorAdmin, posicion: number) {
    setMotores(nuevo);
    setAnuncio(`${movido.displayName}, posición ${posicion + 1} de ${nuevo.length}`);

    const result = await apiRequest<{ motores: MotorAdmin[] }>('/api/admin/models/orden', 'PATCH', {
      ids: nuevo.map((motor) => motor.id),
    });

    if (!result.ok) {
      setMotores(anterior);
      setError(result.error);
    }
  }

  function moverPorTeclado(id: string, direccion: -1 | 1) {
    const indice = motores.findIndex((motor) => motor.id === id);
    const destino = indice + direccion;
    if (destino < 0 || destino >= motores.length) return;

    const nuevo = [...motores];
    const [movido] = nuevo.splice(indice, 1);
    nuevo.splice(destino, 0, movido!);
    void aplicarOrden(motores, nuevo, movido!, destino);
  }

  function onHandleKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moverPorTeclado(id, -1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moverPorTeclado(id, 1);
    }
  }

  function onDragStart(id: string) {
    setArrastrandoId(id);
  }

  function onDropSobre(event: DragEvent, destinoId: string) {
    event.preventDefault();
    const origenId = arrastrandoId;
    setArrastrandoId(null);
    if (!origenId || origenId === destinoId) return;

    const indiceOrigen = motores.findIndex((motor) => motor.id === origenId);
    const indiceDestino = motores.findIndex((motor) => motor.id === destinoId);
    if (indiceOrigen === -1 || indiceDestino === -1) return;

    const nuevo = [...motores];
    const [movido] = nuevo.splice(indiceOrigen, 1);
    nuevo.splice(indiceDestino, 0, movido!);
    void aplicarOrden(motores, nuevo, movido!, indiceDestino);
  }

  async function toggleEnabled(motor: MotorAdmin, valor: boolean) {
    setError(null);
    const anterior = motores;
    setMotores((actuales) => actuales.map((item) => (item.id === motor.id ? { ...item, enabled: valor } : item)));

    const result = await apiRequest<{ motor: MotorAdmin }>(`/api/admin/models/${motor.id}`, 'PATCH', {
      enabled: valor,
    });

    if (!result.ok) {
      setMotores(anterior);
      setError(result.error);
    }
  }

  async function marcarComoDefault(motor: MotorAdmin) {
    if (motor.isDefault) return;
    setError(null);
    const anterior = motores;
    setMotores((actuales) => actuales.map((item) => ({ ...item, isDefault: item.id === motor.id })));

    const result = await apiRequest<{ motor: MotorAdmin }>(`/api/admin/models/${motor.id}`, 'PATCH', {
      isDefault: true,
    });

    if (!result.ok) {
      setMotores(anterior);
      setError(result.error);
    }
  }

  function alGuardar(motorGuardado: MotorAdmin) {
    setMotores((actuales) => {
      const existe = actuales.some((item) => item.id === motorGuardado.id);
      if (existe) return actuales.map((item) => (item.id === motorGuardado.id ? motorGuardado : item));
      return [...actuales, motorGuardado].sort((a, b) => a.sortOrder - b.sortOrder);
    });
    setFormAbierto(null);
  }

  const motorEnEdicion = formAbierto === 'nuevo' || formAbierto === null ? null : formAbierto;
  const otrosMotores = motorEnEdicion
    ? motores.filter((motor) => motor.id !== motorEnEdicion.id)
    : motores;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-500">
          {motores.length} motor{motores.length === 1 ? '' : 'es'} configurado{motores.length === 1 ? '' : 's'}.
        </p>
        <button type="button" onClick={() => setFormAbierto('nuevo')} className="kodu-btn-primary text-sm">
          + Nuevo motor
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div aria-live="polite" className="sr-only">
        {anuncio}
      </div>

      {motores.length === 0 ? (
        <div className="kodu-card p-10 text-center text-sm text-ink-500">
          Todavía no hay ningún motor configurado.
        </div>
      ) : (
        <ol className="space-y-2">
          {motores.map((motor, indice) => (
            <li
              key={motor.id}
              className={`kodu-card flex flex-wrap items-center gap-3 p-3 transition-opacity ${
                arrastrandoId === motor.id ? 'opacity-50' : ''
              }`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDropSobre(event, motor.id)}
            >
              <button
                type="button"
                draggable
                onDragStart={() => onDragStart(motor.id)}
                onDragEnd={() => setArrastrandoId(null)}
                onKeyDown={(event) => onHandleKeyDown(event, motor.id)}
                aria-label={`Mover ${motor.displayName}`}
                title="Arrastrar, o usar las flechas arriba/abajo"
                className="shrink-0 cursor-grab rounded px-1.5 py-1 text-ink-500 hover:bg-sutil active:cursor-grabbing"
              >
                ⠿
              </button>

              <span className="w-5 shrink-0 text-right text-sm tabular-nums text-ink-500">{indice + 1}</span>

              <div className="min-w-40 flex-1">
                <p className="font-medium text-ink-900">{motor.displayName}</p>
                <p className="text-xs text-ink-500">
                  {motor.provider} · {motor.providerModel}
                </p>
              </div>

              <span className="w-28 shrink-0 text-xs text-ink-500">
                {motor.tieneClave ? `•••• ${motor.apiKeyHint ?? ''}` : 'Sin clave'}
              </span>

              <span className="w-40 shrink-0 text-xs tabular-nums text-ink-500">{formatearPrecio(motor)}</span>

              <Interruptor
                checked={motor.enabled}
                onChange={(valor) => void toggleEnabled(motor, valor)}
                label="Habilitado"
                srOnly
                id={`enabled-${motor.id}`}
              />

              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-ink-700">
                <input
                  type="radio"
                  name="motor-default"
                  checked={motor.isDefault}
                  onChange={() => void marcarComoDefault(motor)}
                  aria-label={`Marcar ${motor.displayName} como motor por defecto`}
                  className="h-3.5 w-3.5 accent-brand-600"
                />
                default
              </label>

              <button
                type="button"
                onClick={() => setFormAbierto(motor)}
                className="kodu-btn-ghost shrink-0 px-3 py-1.5 text-xs"
              >
                Editar
              </button>
            </li>
          ))}
        </ol>
      )}

      {formAbierto && (
        <ModeloForm
          motor={motorEnEdicion}
          otrosMotores={otrosMotores}
          onGuardado={alGuardar}
          onCerrar={() => setFormAbierto(null)}
        />
      )}
    </div>
  );
}
