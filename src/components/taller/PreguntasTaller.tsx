import type { KeyboardEvent } from 'react';
import type { PreguntaTaller } from '../../lib/taller/ficha.ts';

/**
 * La pregunta de Kodu que está esperando respuesta, sola y en foco
 * (odd/tasks/taller-de-ideas.md), al estilo de cuando Claude Code te pregunta
 * algo: las respuestas en filas, la recomendada marcada, y siempre una fila
 * para escribir la tuya.
 *
 * Se nota de entrada qué tipo de pregunta es: marca redonda y "Elegí una"
 * cuando las respuestas se excluyen; marca cuadrada y "Podés elegir varias"
 * cuando no. Sin respuestas sugeridas, es un cuadro para escribir.
 */

function IconoLapiz({ tamano = 14 }: { tamano?: number }) {
  return (
    <svg width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

export default function PreguntasTaller(props: {
  pregunta: PreguntaTaller;
  /** "1 de 2" cuando un mismo turno trae más de una pregunta (charlas viejas, la apertura). */
  numero: number;
  total: number;
  elegidas: string[];
  escrita: string;
  onElegir: (opcion: string) => void;
  onEscribir: (texto: string) => void;
  /** Enter en el campo de texto: avanza o responde, igual que el botón principal. */
  onEnter: () => void;
  deshabilitado: boolean;
}) {
  const { pregunta } = props;
  const conOpciones = pregunta.opciones.length > 0;
  const idTitulo = 'pregunta-taller-actual';

  function alApretarTecla(event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) {
    // Enter responde y Shift+Enter baja de línea, salvo en pantallas táctiles,
    // donde Enter tiene que poder bajar de línea (no hay Shift a mano).
    const tactil = window.matchMedia?.('(pointer: coarse)').matches;
    if (event.key === 'Enter' && !event.shiftKey && !tactil) {
      event.preventDefault();
      props.onEnter();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id={idTitulo} className="min-w-0 flex-[1_1_16rem] text-lg leading-snug font-bold text-ink-900 sm:text-xl">
          {props.total > 1 && (
            <span className="mr-2 text-sm font-semibold text-brand-600">
              {props.numero} de {props.total}
            </span>
          )}
          {pregunta.texto}
        </h2>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-sutil px-2.5 py-1 text-xs font-semibold text-ink-700">
          {!conOpciones ? (
            <IconoLapiz tamano={12} />
          ) : (
            <span
              aria-hidden="true"
              className={`h-3 w-3 border-2 border-current ${pregunta.multiple ? 'rounded-[3px]' : 'rounded-full'}`}
            />
          )}
          {!conOpciones ? 'Escribí tu respuesta' : pregunta.multiple ? 'Podés elegir varias' : 'Elegí una'}
        </span>
      </div>

      {conOpciones ? (
        <div className="space-y-2" role={pregunta.multiple ? 'group' : 'radiogroup'} aria-labelledby={idTitulo}>
          {pregunta.opciones.map((opcion, indice) => {
            const marcada = props.elegidas.includes(opcion);
            const recomendada = pregunta.recomendada === indice;
            return (
              <button
                key={opcion}
                type="button"
                role={pregunta.multiple ? 'checkbox' : 'radio'}
                aria-checked={marcada}
                disabled={props.deshabilitado}
                onClick={() => props.onElegir(opcion)}
                className={`flex min-h-12 w-full items-center gap-3.5 rounded-[14px] border-[1.5px] px-3.5 py-2.5 text-left transition-colors disabled:opacity-60 ${
                  marcada ? 'border-brand-600 bg-brand-50' : 'border-linea hover:border-brand-300'
                }`}
              >
                {pregunta.multiple ? (
                  <span
                    aria-hidden="true"
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 text-white ${
                      marcada ? 'border-brand-600 bg-brand-600' : 'border-linea'
                    }`}
                  >
                    {marcada && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m5 12 5 5 9-10" />
                      </svg>
                    )}
                  </span>
                ) : (
                  <span
                    aria-hidden="true"
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
                      marcada ? 'border-brand-600' : 'border-linea'
                    }`}
                  >
                    {marcada && <span className="h-2.5 w-2.5 rounded-full bg-brand-600" />}
                  </span>
                )}
                <span className="flex-1 text-[15px] font-medium text-ink-900 sm:text-base">{opcion}</span>
                {recomendada && (
                  <span className="shrink-0 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">
                    Recomendada
                  </span>
                )}
              </button>
            );
          })}

          <label className="flex min-h-12 items-center gap-3.5 rounded-[14px] border-[1.5px] border-dashed border-linea px-3.5 text-ink-500 focus-within:border-brand-300">
            <span className="grid h-5 w-5 shrink-0 place-items-center">
              <IconoLapiz tamano={16} />
            </span>
            <span className="sr-only">Otra respuesta</span>
            <input
              type="text"
              value={props.escrita}
              onChange={(event) => props.onEscribir(event.target.value)}
              onKeyDown={alApretarTecla}
              disabled={props.deshabilitado}
              placeholder="Otra respuesta: escribila con tus palabras"
              className="min-w-0 flex-1 bg-transparent py-3 text-[15px] text-ink-900 outline-none placeholder:text-ink-500 sm:text-base"
            />
          </label>
        </div>
      ) : (
        <>
          <label htmlFor="respuesta-escrita" className="sr-only">
            Tu respuesta
          </label>
          <textarea
            id="respuesta-escrita"
            value={props.escrita}
            onChange={(event) => props.onEscribir(event.target.value)}
            onKeyDown={alApretarTecla}
            disabled={props.deshabilitado}
            rows={3}
            autoFocus
            placeholder="Escribí tu respuesta con tus palabras…"
            className="kodu-input resize-none rounded-[14px] px-3.5 py-3 text-base"
          />
        </>
      )}
    </div>
  );
}
