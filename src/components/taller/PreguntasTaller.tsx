import type { PreguntaTaller } from '../../lib/taller/ficha.ts';

/**
 * Las preguntas de la última respuesta de Kodu, cada una con sus respuestas
 * para tocar (odd/tasks/taller-de-ideas.md). Tocar una respuesta la marca; se
 * mandan todas juntas con "Enviar", junto con lo que el docente escriba.
 * Tocar de nuevo la desmarca. En una pregunta de una sola respuesta, tocar
 * otra cambia la elegida.
 */
export default function PreguntasTaller(props: {
  preguntas: PreguntaTaller[];
  elegidas: Record<number, string[]>;
  onElegir: (indice: number, opcion: string) => void;
  deshabilitado: boolean;
}) {
  return (
    <div className="space-y-3" role="group" aria-label="Preguntas de Kodu">
      {props.preguntas.map((pregunta, indice) => {
        const elegidas = props.elegidas[indice] ?? [];
        const idTexto = `pregunta-taller-${indice}`;

        return (
          <div key={indice} className="rounded-xl border border-linea bg-superficie p-3">
            <p id={idTexto} className="text-sm font-semibold text-ink-900">
              {props.preguntas.length > 1 && <span className="mr-1 text-brand-600">{indice + 1}.</span>}
              {pregunta.texto}
            </p>

            {pregunta.opciones.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby={idTexto}>
                {pregunta.opciones.map((opcion) => {
                  const marcada = elegidas.includes(opcion);
                  return (
                    <button
                      key={opcion}
                      type="button"
                      aria-pressed={marcada}
                      disabled={props.deshabilitado}
                      onClick={() => props.onElegir(indice, opcion)}
                      className={`min-h-9 rounded-full border px-3 py-1.5 text-left text-sm transition-colors disabled:opacity-60 ${
                        marcada
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-linea bg-superficie text-ink-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700'
                      }`}
                    >
                      {opcion}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1 text-xs text-ink-500">Contestá escribiendo abajo.</p>
            )}

            {pregunta.multiple && pregunta.opciones.length > 0 && (
              <p className="mt-1.5 text-xs text-ink-500">Podés elegir más de una.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
