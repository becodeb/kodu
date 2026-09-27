import { useState } from 'react';
import { apiRequest } from '../../lib/client/api.ts';
import type { ModoTaller } from '../../lib/taller/prompt.ts';

/**
 * Las dos puertas del Taller de ideas (odd/tasks/taller-de-ideas.md). Cada
 * una explica con palabras de docente para quién es, porque elegir mal no
 * rompe nada pero elegir bien hace que la primera pregunta ya sirva.
 */

const PUERTAS: Array<{ modo: ModoTaller; titulo: string; texto: string; ejemplo: string }> = [
  {
    modo: 'TOPIC',
    titulo: 'Tengo un tema, busco una idea',
    texto:
      'Sabés qué vas a dar, pero no se te ocurre qué herramienta usar. Kodu te pregunta por tu clase y por tus alumnos, y te propone ideas para que elijas.',
    ejemplo: '“Tengo que dar fracciones equivalentes en 4.º y no sé cómo hacerlo más concreto.”',
  },
  {
    modo: 'IDEA',
    titulo: 'Ya tengo una idea',
    texto:
      'Ya te imaginás la herramienta: un juego, un simulador, lo que sea. Contásela a Kodu con tus palabras y te ayuda a completarla y a pedirla bien, con todos los detalles.',
    ejemplo: '“Quiero un juego donde armen un circuito y vean si la lamparita se prende.”',
  },
];

export default function PuertasTaller(props: { mostrarAtajo?: boolean }) {
  const [pendiente, setPendiente] = useState<ModoTaller | 'directo' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function entrar(modo: ModoTaller) {
    setPendiente(modo);
    setError(null);
    const resultado = await apiRequest<{ redirect: string }>('/api/taller', 'POST', { mode: modo });
    if (!resultado.ok) {
      setError(resultado.error);
      setPendiente(null);
      return;
    }
    window.location.href = resultado.data.redirect;
  }

  async function directo() {
    setPendiente('directo');
    setError(null);
    const resultado = await apiRequest<{ redirect: string }>('/api/projects', 'POST', { title: 'Nuevo Recurso' });
    if (!resultado.ok) {
      setError(resultado.error);
      setPendiente(null);
      return;
    }
    window.location.href = resultado.data.redirect;
  }

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        {PUERTAS.map((puerta) => (
          <button
            key={puerta.modo}
            type="button"
            onClick={() => void entrar(puerta.modo)}
            disabled={pendiente !== null}
            className="kodu-card group flex flex-col items-start gap-3 p-5 text-left transition-colors hover:border-brand-300 disabled:opacity-60"
          >
            <span className="font-display text-lg text-ink-900 group-hover:text-brand-700">{puerta.titulo}</span>
            <span className="text-sm text-ink-700">{puerta.texto}</span>
            <span className="text-sm text-ink-500 italic">{puerta.ejemplo}</span>
            <span className="kodu-btn-primary mt-auto">
              {pendiente === puerta.modo ? 'Abriendo…' : 'Empezar por acá'}
            </span>
          </button>
        ))}
      </div>

      {props.mostrarAtajo && (
        <p className="mt-4 text-sm text-ink-500">
          ¿Ya sabés exactamente lo que querés pedir?{' '}
          <button
            type="button"
            onClick={() => void directo()}
            disabled={pendiente !== null}
            className="font-medium text-brand-600 underline-offset-2 hover:underline disabled:opacity-60"
          >
            {pendiente === 'directo' ? 'Creando…' : 'Ir directo a crear el recurso'}
          </button>
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
