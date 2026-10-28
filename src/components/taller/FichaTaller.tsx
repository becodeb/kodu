import { useEffect, useRef } from 'react';
import { CAMPOS_ESENCIALES, CAMPOS_FICHA, type FichaIdea } from '../../lib/taller/ficha.ts';

/**
 * El panel "Tu idea" del Taller (odd/tasks/taller-de-ideas.md): la ficha que
 * se completa sola mientras se charla y, cuando existe, el pedido final
 * editable con el botón para crear el recurso.
 *
 * Muestra siempre lo esencial (`CAMPOS_ESENCIALES`): lo ya hablado con una
 * tilde y su valor, lo que falta sólo con su nombre. Lo demás aparece recién
 * cuando se habló: diez renglones de "Todavía no lo hablamos" eran mucho para
 * leer y no decían nada.
 */
export default function FichaTaller(props: {
  ficha: FichaIdea;
  titulo: string | null;
  pedido: string | null;
  borradorPedido: string;
  onBorradorPedido: (texto: string) => void;
  estadoGuardado: 'idle' | 'guardando' | 'guardado' | 'error';
  soloLectura: boolean;
  projectId: string | null;
  ocupado: boolean;
  puedeArmarPedido: boolean;
  onArmarPedido: () => void;
  onCrear: () => void;
  creando: boolean;
}) {
  const tiene = (id: string) => (props.ficha[id as keyof FichaIdea] ?? '').trim().length > 0;
  const esenciales = CAMPOS_FICHA.filter((campo) => CAMPOS_ESENCIALES.includes(campo.id));
  const extras = CAMPOS_FICHA.filter((campo) => !CAMPOS_ESENCIALES.includes(campo.id) && tiene(campo.id));
  const completos = esenciales.filter((campo) => tiene(campo.id)).length;
  const areaPedido = useRef<HTMLTextAreaElement>(null);

  // El pedido crece con su contenido: un textarea de 4 líneas con scroll
  // propio adentro de un panel que ya scrollea es difícil de leer y editar.
  useEffect(() => {
    const area = areaPedido.current;
    if (!area) return;

    const ajustar = () => {
      area.style.height = 'auto';
      area.style.height = `${area.scrollHeight + 2}px`;
    };
    ajustar();

    // También cuando cambia el ancho: el panel puede estar oculto al montar
    // (pestaña "Tu idea" en el celular) o los estilos llegar después, y la
    // altura medida en ese momento no sirve.
    let anchoAnterior = area.clientWidth;
    const observador = new ResizeObserver(() => {
      if (area.clientWidth === anchoAnterior) return;
      anchoAnterior = area.clientWidth;
      ajustar();
    });
    observador.observe(area);
    return () => observador.disconnect();
  }, [props.borradorPedido]);

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl text-ink-900">Tu idea</h2>
          <span
            className="text-sm font-semibold text-brand-600"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={esenciales.length}
            aria-valuenow={completos}
            aria-label="Cuánto de lo esencial ya está definido"
          >
            {props.pedido ? 'Pedido listo' : `${completos} de ${esenciales.length}`}
          </span>
        </div>
        {props.titulo && <p className="mt-1 text-[15px] font-semibold text-ink-700">{props.titulo}</p>}
      </header>

      {props.pedido !== null && (
        <section aria-labelledby="titulo-pedido" className="rounded-xl border border-brand-300 bg-brand-50 p-3">
          <h3 id="titulo-pedido" className="text-sm font-semibold text-ink-900">
            Tu pedido
          </h3>
          <p className="mt-0.5 text-xs text-ink-700">
            {props.soloLectura
              ? 'Con este pedido se creó el recurso.'
              : 'Es lo que Kodu va a usar para crear tu herramienta. Cambiá lo que quieras acá mismo, o pedile cambios en la charla.'}
          </p>

          <label htmlFor="pedido-final" className="sr-only">
            Pedido final
          </label>
          <textarea
            id="pedido-final"
            ref={areaPedido}
            value={props.borradorPedido}
            onChange={(event) => props.onBorradorPedido(event.target.value)}
            readOnly={props.soloLectura}
            disabled={props.ocupado && !props.soloLectura}
            rows={8}
            className="kodu-input mt-2 min-h-40 resize-none text-sm leading-relaxed"
          />

          {!props.soloLectura && (
            <p className="mt-1 h-4 text-xs text-ink-500" aria-live="polite">
              {props.estadoGuardado === 'guardando'
                ? 'Guardando…'
                : props.estadoGuardado === 'guardado'
                  ? 'Guardado'
                  : props.estadoGuardado === 'error'
                    ? 'No se pudo guardar el cambio. Probá de nuevo.'
                    : ''}
            </p>
          )}

          {/* Pegado al pie del panel mientras se lee el pedido: un pedido
              completo es largo, y el botón no puede quedar escondido abajo. */}
          <div className="sticky -bottom-4 -mx-3 -mb-3 rounded-b-xl bg-brand-50 px-3 pt-2 pb-3">
            {props.soloLectura && props.projectId ? (
              <a href={`/app/project/${props.projectId}`} className="kodu-btn-primary w-full">
                Ir al recurso
              </a>
            ) : (
              <button
                type="button"
                onClick={props.onCrear}
                disabled={props.creando || props.ocupado || props.borradorPedido.trim().length === 0}
                className="kodu-btn-primary w-full"
              >
                {props.creando ? 'Abriendo el editor…' : 'Crear mi recurso'}
              </button>
            )}
          </div>
        </section>
      )}

      <dl className="space-y-3">
        {[...esenciales, ...extras].map((campo) => {
          const valor = props.ficha[campo.id];
          return (
            <div key={campo.id} className="flex items-start gap-3">
              {valor ? (
                <span
                  aria-hidden="true"
                  className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600 text-white"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12 5 5 9-10" />
                  </svg>
                </span>
              ) : (
                <span aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-dashed border-linea" />
              )}
              <div className="min-w-0">
                <dt className="text-sm font-semibold text-ink-500">{campo.etiqueta}</dt>
                {valor ? (
                  <dd className="mt-0.5 text-[15px] whitespace-pre-wrap text-ink-900">{valor}</dd>
                ) : (
                  <dd className="sr-only">Todavía no lo hablamos</dd>
                )}
              </div>
            </div>
          );
        })}
      </dl>

      {props.pedido === null && !props.soloLectura && (
        <div className="border-t border-linea pt-4">
          <button
            type="button"
            onClick={props.onArmarPedido}
            disabled={!props.puedeArmarPedido || props.ocupado}
            className="kodu-btn-ghost w-full"
          >
            Ya está, armá el pedido
          </button>
          <p className="mt-1.5 text-xs text-ink-500">Kodu completa lo que falte con buen criterio.</p>
        </div>
      )}
    </div>
  );
}
