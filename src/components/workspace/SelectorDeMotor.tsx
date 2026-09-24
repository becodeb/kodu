import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { MotorPublico } from '../../lib/workspace-types.ts';

interface SelectorDeMotorProps {
  motores: MotorPublico[];
  model: string;
  onModelChange: (modelId: string) => void;
}

/**
 * El selector de motor del docente (design.md §8, spec `ai-model-catalog`
 * "Teacher-facing selector is a dropdown with hover description").
 *
 * La descripción "al pasar el mouse" se implementa como una descripción
 * SIEMPRE visible mientras la lista está abierta: un `title` es hover-only,
 * muerto en touch y no siempre anunciado por lectores de pantalla — esto es
 * un producto de proyector y tablet.
 */
export default function SelectorDeMotor(props: SelectorDeMotorProps) {
  const [abierto, setAbierto] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const seleccionado = props.motores.find((motor) => motor.id === props.model) ?? null;

  useEffect(() => {
    if (!abierto) return;

    function onPointerDown(event: PointerEvent) {
      if (!contenedorRef.current?.contains(event.target as Node)) setAbierto(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [abierto]);

  function abrir() {
    const indiceActual = props.motores.findIndex((motor) => motor.id === props.model);
    setActiveIndex(indiceActual >= 0 ? indiceActual : 0);
    setAbierto(true);
    // El foco se mueve a la lista recién montada, no en este mismo tick.
    window.setTimeout(() => listaRef.current?.focus(), 0);
  }

  function elegir(motor: MotorPublico) {
    props.onModelChange(motor.id);
    setAbierto(false);
    triggerRef.current?.focus();
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      abrir();
    }
  }

  function onListaKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((indice) => Math.min(indice + 1, props.motores.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((indice) => Math.max(indice - 1, 0));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(props.motores.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const motor = props.motores[activeIndex];
      if (motor) elegir(motor);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setAbierto(false);
      triggerRef.current?.focus();
    } else if (event.key === 'Tab') {
      setAbierto(false);
    }
  }

  return (
    <div ref={contenedorRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        id="selector-motor"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        onClick={() => (abierto ? setAbierto(false) : abrir())}
        onKeyDown={onTriggerKeyDown}
        className="kodu-input flex items-center justify-between py-1.5 text-xs"
      >
        <span className="font-medium text-ink-900">{seleccionado?.displayName ?? 'Elegir motor'}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="shrink-0 text-ink-500">
          <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {/* T5 (odd/tasks/responsive-celulares.md): en celular esta línea le
          come el alto al composer, que queda tapado bajo el pliegue; el
          desplegable ya repite la descripción de cada motor al abrirlo. */}
      <p className="mt-1.5 hidden text-[0.7rem] leading-snug text-ink-500 lg:block">
        {seleccionado?.description}
      </p>

      {abierto && (
        <ul
          ref={listaRef}
          role="listbox"
          tabIndex={-1}
          aria-labelledby="selector-motor"
          aria-activedescendant={props.motores[activeIndex] ? `opt-${props.motores[activeIndex].id}` : undefined}
          onKeyDown={onListaKeyDown}
          className="kodu-card absolute z-20 mt-1 w-full p-1 shadow-lg"
        >
          {props.motores.map((motor, indice) => (
            <li
              key={motor.id}
              id={`opt-${motor.id}`}
              role="option"
              aria-selected={motor.id === props.model}
              onMouseEnter={() => setActiveIndex(indice)}
              onClick={() => elegir(motor)}
              className={`min-h-10 cursor-pointer rounded-md px-2 py-1.5 transition-colors ${
                indice === activeIndex ? 'bg-sutil' : ''
              }`}
            >
              <p className="text-sm font-medium text-ink-900">{motor.displayName}</p>
              {motor.description && (
                <p className="text-[0.7rem] leading-snug text-ink-500">{motor.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
