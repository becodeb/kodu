interface ResourceSheetProps {
  title: string;
  description: string;
  onMetaChange: (meta: { title?: string; description?: string }) => void;
  authorName: string;
  isInGallery: boolean;
  onTogglePublish: (value: boolean) => void;
  screenshotUrl: string | null;
  capturing: boolean;
  onCapture: () => void;
  onDeleteScreenshot: () => void;
  captureError: string | null;
  onDismissCaptureError: () => void;
}

/** Tope de la descripción, igual al del schema del PATCH. */
const DESCRIPTION_MAX = 400;

/**
 * Pestaña "Ficha": nombre, portada y publicación del recurso.
 *
 * Antes esto era una fila de controles sueltos apretada abajo del visor, y no
 * se entendía para qué servía cada uno ni por qué estaban juntos. Lo que los une
 * es una sola pregunta —cómo llega este recurso a otro docente— así que la
 * pantalla la contesta mostrando en vivo la tarjeta que se va a ver en la
 * galería: el título, la descripción y la portada dejan de ser campos de un
 * formulario y pasan a ser partes de algo reconocible.
 */
export default function ResourceSheet(props: ResourceSheetProps) {
  const remaining = DESCRIPTION_MAX - props.description.length;

  return (
    <div className="h-full overflow-y-auto bg-lienzo">
      <div className="mx-auto grid max-w-4xl gap-6 p-5 lg:grid-cols-[1fr_20rem] lg:p-6">
        <div className="space-y-5">
          <header>
            <h2 className="font-display text-lg text-ink-900">Ficha del recurso</h2>
            <p className="mt-1 text-sm text-ink-500">
              Así es como tus colegas van a encontrar y reconocer este recurso.
            </p>
          </header>

          <div className="kodu-card p-4">
            <label className="kodu-label" htmlFor="ficha-titulo">
              Título
            </label>
            <input
              id="ficha-titulo"
              className="kodu-input"
              value={props.title}
              maxLength={120}
              onChange={(event) => props.onMetaChange({ title: event.target.value })}
            />
            <p className="mt-1.5 text-xs text-ink-500">
              El nombre con el que se va a listar. Concreto funciona mejor que ingenioso.
            </p>
          </div>

          <div className="kodu-card p-4">
            <label className="kodu-label" htmlFor="ficha-descripcion">
              Descripción
            </label>
            <textarea
              id="ficha-descripcion"
              className="kodu-input resize-none"
              rows={3}
              maxLength={DESCRIPTION_MAX}
              value={props.description}
              placeholder="Ej.: Quiz de 5 preguntas sobre fracciones equivalentes, con corrección inmediata. Pensado para 5.º grado."
              onChange={(event) => props.onMetaChange({ description: event.target.value })}
            />
            <div className="mt-1.5 flex items-baseline justify-between gap-3">
              <p className="text-xs text-ink-500">Qué enseña y para qué grado, en una o dos frases.</p>
              <span
                className={`shrink-0 text-xs tabular-nums ${
                  remaining < 40 ? 'text-brand-600' : 'text-ink-500'
                }`}
              >
                {remaining}
              </span>
            </div>
          </div>

          <div className="kodu-card p-4">
            <p className="kodu-label">Portada</p>
            <p className="mb-3 text-xs text-ink-500">
              Una foto de la vista previa, tal como se ve ahora. Es la imagen de la tarjeta.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={props.onCapture} disabled={props.capturing} className="kodu-btn-ghost text-sm">
                {props.capturing
                  ? 'Capturando…'
                  : props.screenshotUrl
                    ? 'Sacar otra'
                    : 'Tomar captura'}
              </button>

              {props.screenshotUrl && (
                <button
                  type="button"
                  onClick={props.onDeleteScreenshot}
                  className="text-sm text-ink-500 underline underline-offset-2 hover:text-red-600"
                >
                  Quitar portada
                </button>
              )}
            </div>

            {props.captureError && (
              <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {props.captureError}{' '}
                <button
                  type="button"
                  onClick={props.onDismissCaptureError}
                  className="underline hover:text-red-800"
                >
                  Entendido
                </button>
              </p>
            )}
          </div>

          {/* La publicación va última y se ve distinta al resto: es la única
              acción de esta pantalla que cambia quién puede ver el recurso. */}
          <div
            className={`rounded-[10px] border p-4 transition-colors ${
              props.isInGallery ? 'border-brand-300 bg-brand-50' : 'border-linea bg-superficie'
            }`}
          >
            {/* El riel y el círculo se pintan desde el estado de React y no con
                `peer-checked`: el input está `sr-only` y depender de la cascada
                para algo tan visible se rompe callado. Acá si el estado cambia,
                el switch cambia. */}
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={props.isInGallery}
                onChange={(event) => props.onTogglePublish(event.target.checked)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  props.isInGallery ? 'bg-brand-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`h-5 w-5 rounded-full bg-superficie shadow-sm transition-transform ${
                    props.isInGallery ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </span>

              <span>
                <span className="block text-sm font-semibold text-ink-900">
                  Publicar en la galería institucional
                </span>
                <span className="mt-0.5 block text-xs text-ink-500">
                  {props.isInGallery
                    ? 'Cualquier docente de la red puede verlo, proyectarlo y duplicarlo para adaptarlo.'
                    : 'Por ahora es tuyo: sólo lo ve quien tenga el link directo.'}
                </span>
              </span>
            </label>
          </div>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <p className="mb-2 text-xs font-medium tracking-wide text-ink-500 uppercase">
            {props.isInGallery ? 'Se ve así en la galería' : 'Se vería así en la galería'}
          </p>

          {/* Réplica de la tarjeta de gallery.astro: si cambia una, cambia la otra. */}
          <div className="kodu-card flex flex-col overflow-hidden">
            {props.screenshotUrl ? (
              <img
                src={props.screenshotUrl}
                alt="Portada del recurso"
                className="h-32 w-full border-b border-linea object-cover object-top"
              />
            ) : (
              <div className="grid h-32 w-full place-items-center border-b border-linea bg-sutil px-4 text-center text-xs text-ink-500">
                Sin portada todavía
              </div>
            )}

            <div className="p-4">
              <h3 className="font-semibold break-words text-ink-900">
                {props.title.trim() || 'Recurso sin título'}
              </h3>
              <p className="mt-0.5 text-xs text-ink-500">por {props.authorName}</p>

              {props.description.trim() ? (
                <p className="mt-2 line-clamp-3 text-sm text-ink-700">{props.description}</p>
              ) : (
                <p className="mt-2 text-sm text-ink-500 italic">Sin descripción</p>
              )}
            </div>
          </div>

          <p className="mt-3 text-xs text-ink-500">
            Se guarda solo mientras escribís.
          </p>
        </aside>
      </div>
    </div>
  );
}
