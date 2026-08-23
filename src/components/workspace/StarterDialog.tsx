import { useState } from 'react';
import Modal from './Modal.tsx';
import type { Starter } from './starters.ts';

/**
 * Preguntas de un pedido de ejemplo.
 *
 * El preset suelto tenía un problema: metía en el campo un pedido de otra
 * persona, sobre un tema que no era el del docente, y había que reescribirlo
 * entero. Acá se le preguntan las tres o cuatro cosas que cambian de verdad
 * (tema, grado, cantidad) y con eso se arma el pedido completo.
 *
 * El texto se compone con una plantilla y NO con la IA: la plantilla ya produce
 * exactamente el pedido bien escrito que queremos, sin agregar una espera ni
 * una forma más de fallar antes de que el docente vea nada.
 */

interface StarterDialogProps {
  starter: Starter | null;
  onCerrar: () => void;
  onListo: (prompt: string) => void;
}

export default function StarterDialog({ starter, onCerrar, onListo }: StarterDialogProps) {
  const [valores, setValores] = useState<Record<string, string>>({});

  if (!starter) return null;

  const valor = (id: string) => valores[id] ?? starter.campos.find((c) => c.id === id)?.valorInicial ?? '';
  const completo = starter.campos.every((campo) => !campo.requerido || valor(campo.id).trim());

  return (
    <Modal
      abierto={starter !== null}
      titulo={starter.label}
      descripcion="Contestá esto y te armo el pedido. Después lo podés editar antes de enviarlo."
      onCerrar={onCerrar}
      pie={
        <>
          <button type="button" onClick={onCerrar} className="kodu-btn-ghost text-sm">
            Cancelar
          </button>
          <button
            type="button"
            disabled={!completo}
            onClick={() => {
              const datos = Object.fromEntries(starter.campos.map((c) => [c.id, valor(c.id).trim()]));
              onListo(starter.armarPrompt(datos));
              setValores({});
            }}
            className="kodu-btn-primary text-sm"
          >
            Armar el pedido
          </button>
        </>
      }
    >
      {starter.campos.map((campo) => (
        <div key={campo.id}>
          <label className="kodu-label" htmlFor={`campo-${campo.id}`}>
            {campo.etiqueta}
            {!campo.requerido && <span className="font-normal text-ink-500"> (opcional)</span>}
          </label>

          {campo.opciones ? (
            <select
              id={`campo-${campo.id}`}
              className="kodu-input"
              value={valor(campo.id)}
              onChange={(e) => setValores((v) => ({ ...v, [campo.id]: e.target.value }))}
            >
              {campo.opciones.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {opcion}
                </option>
              ))}
            </select>
          ) : campo.multilinea ? (
            <textarea
              id={`campo-${campo.id}`}
              className="kodu-input resize-none"
              rows={2}
              value={valor(campo.id)}
              placeholder={campo.placeholder}
              onChange={(e) => setValores((v) => ({ ...v, [campo.id]: e.target.value }))}
            />
          ) : (
            <input
              id={`campo-${campo.id}`}
              className="kodu-input"
              value={valor(campo.id)}
              placeholder={campo.placeholder}
              onChange={(e) => setValores((v) => ({ ...v, [campo.id]: e.target.value }))}
            />
          )}

          {campo.ayuda && <p className="mt-1.5 text-xs text-ink-500">{campo.ayuda}</p>}
        </div>
      ))}
    </Modal>
  );
}
