import { useState } from 'react';

/**
 * odd/tasks/ahorro-tokens.md (T5): la carita de feedback bajo una respuesta
 * de la IA que cambió el recurso, y la pregunta inline ocasional del chat.
 * Nada acá es modal: la carita es un tap discreto en línea, y la pregunta
 * es una burbuja chica más — igual que cualquier otro mensaje del chat,
 * nunca un diálogo que tape nada.
 */

export type FaceRating = 'GOOD' | 'NEUTRAL' | 'BAD';
export type TipoPreguntaFeedback = 'FUNCIONA' | 'VISUAL';
export type RespuestaPregunta = 'SI' | 'MAS_O_MENOS' | 'NO';

interface FeedbackTurnoProps {
  faceRating: FaceRating | null | undefined;
  onRate: (rating: FaceRating) => void;
  onComment: (comment: string) => void;
}

const CARAS: Array<{ valor: FaceRating; titulo: string; path: string }> = [
  // Boca sonriendo / recta / triste — mismo trazo (stroke currentColor,
  // strokeWidth 2) que el ícono de "Deshacer" de acá al lado.
  { valor: 'GOOD', titulo: 'Anduvo bien', path: 'M8 14s1.5 2 4 2 4-2 4-2' },
  { valor: 'NEUTRAL', titulo: 'Más o menos', path: 'M8 15h8' },
  { valor: 'BAD', titulo: 'No anduvo', path: 'M8 16s1.5-2 4-2 4 2 4 2' },
];

export function FeedbackTurno(props: FeedbackTurnoProps) {
  const [comentario, setComentario] = useState('');
  const [comentarioEnviado, setComentarioEnviado] = useState(false);

  return (
    <div className="mt-1 flex items-center gap-1 px-1">
      {CARAS.map((cara) => {
        const activa = props.faceRating === cara.valor;
        return (
          <button
            key={cara.valor}
            type="button"
            title={cara.titulo}
            onClick={() => props.onRate(cara.valor)}
            className={
              'rounded-full p-1 transition-colors ' +
              (activa ? 'bg-brand-100 text-brand-700' : 'text-ink-500 hover:bg-sutil hover:text-ink-700')
            }
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
              <circle cx="9" cy="10" r="1" fill="currentColor" />
              <circle cx="15" cy="10" r="1" fill="currentColor" />
              <path d={cara.path} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        );
      })}

      {/* Sólo después de tocar la carita mala, y sólo hasta mandarlo (o
          ignorarlo — es completamente opcional, "ignorable by design"). */}
      {props.faceRating === 'BAD' && !comentarioEnviado && (
        <form
          className="ml-1 flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (comentario.trim()) props.onComment(comentario.trim());
            setComentarioEnviado(true);
          }}
        >
          <input
            type="text"
            value={comentario}
            onChange={(event) => setComentario(event.target.value)}
            placeholder="¿Qué falló? (opcional)"
            maxLength={500}
            className="w-40 rounded-full border border-linea bg-superficie px-2 py-0.5 text-xs text-ink-900 placeholder:text-ink-500"
          />
          <button type="submit" className="text-xs text-brand-700 hover:underline">
            Mandar
          </button>
        </form>
      )}
    </div>
  );
}

interface PreguntaFeedbackProps {
  tipo: TipoPreguntaFeedback;
  onResponder: (respuesta: RespuestaPregunta) => void;
  onNoPreguntarMas: () => void;
}

const TEXTO_PREGUNTA: Record<TipoPreguntaFeedback, string> = {
  FUNCIONA: '¿Funciona bien?',
  VISUAL: '¿Te gusta cómo se ve?',
};

/** La pregunta inline — una burbuja más del chat, nunca un modal. */
export function PreguntaFeedback(props: PreguntaFeedbackProps) {
  return (
    <div className="mr-6 mt-1.5 rounded-xl bg-sutil px-3 py-2 text-sm text-ink-900">
      <p>{TEXTO_PREGUNTA[props.tipo]}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {(['SI', 'MAS_O_MENOS', 'NO'] as const).map((respuesta) => (
          <button
            key={respuesta}
            type="button"
            onClick={() => props.onResponder(respuesta)}
            className="kodu-btn-ghost px-2.5 py-1 text-xs"
          >
            {respuesta === 'SI' ? 'Sí' : respuesta === 'MAS_O_MENOS' ? 'Más o menos' : 'No'}
          </button>
        ))}
        <button type="button" onClick={props.onNoPreguntarMas} className="ml-1 text-xs text-ink-500 hover:underline">
          No preguntar más
        </button>
      </div>
    </div>
  );
}
