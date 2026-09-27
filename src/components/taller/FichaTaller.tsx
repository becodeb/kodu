import { useEffect, useRef } from 'react';
import { CAMPOS_FICHA, progresoFicha, type FichaIdea } from '../../lib/taller/ficha.ts';

/**
 * El panel "Tu idea" del Taller (odd/tasks/taller-de-ideas.md): la ficha que
 * se completa sola mientras se charla y, cuando existe, el pedido final
 * editable con el botón para crear el recurso.
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
  const progreso = progresoFicha(props.ficha);
  const completos = CAMPOS_FICHA.filter((campo) => props.ficha[campo.id]).length;
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
        <p className="text-xs font-semibold tracking-wide text-brand-600">Tu idea</p>
        <h2 className="font-display mt-0.5 text-lg text-ink-900">{props.titulo ?? 'Todavía sin nombre'}</h2>

        <div className="mt-3">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-sutil"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={CAMPOS_FICHA.length}
            aria-valuenow={completos}
            aria-label="Cuánto de la idea ya está definido"
          >
            <div
              className="h-full rounded-full bg-brand-600 transition-all duration-500"
              style={{ width: `${Math.round(progreso * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-ink-500">
            {props.pedido
              ? 'El pedido está listo.'
              : `${completos} de ${CAMPOS_FICHA.length} cosas definidas. Kodu te va preguntando el resto.`}
          </p>
        </div>
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
        {CAMPOS_FICHA.map((campo) => {
          const valor = props.ficha[campo.id];
          return (
            <div key={campo.id}>
              <dt className="text-xs font-semibold text-ink-700">{campo.etiqueta}</dt>
              <dd className={`mt-0.5 text-sm whitespace-pre-wrap ${valor ? 'text-ink-900' : 'text-ink-500'}`}>
                {valor ?? `Todavía no lo hablamos (${campo.ayuda.toLowerCase()}).`}
              </dd>
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
          <p className="mt-1.5 text-xs text-ink-500">
            Si preferís no seguir contestando, Kodu arma el pedido con lo que tiene y te avisa qué quedó sin
            definir.
          </p>
        </div>
      )}
    </div>
  );
}
