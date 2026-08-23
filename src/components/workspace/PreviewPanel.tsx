import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { CAPTURE_REQUEST, CAPTURE_RESULT, buildPreviewDocument } from '../../lib/preview.ts';

const CodeEditor = lazy(() => import('./CodeEditor.tsx'));

interface PreviewPanelProps {
  html: string;
  onHtmlChange: (html: string) => void;
  publicUrl: string;
  title: string;
  description: string;
  onMetaChange: (meta: { title?: string; description?: string }) => void;
  isInGallery: boolean;
  onTogglePublish: (value: boolean) => void;
  screenshotUrl: string | null;
  onScreenshot: (dataUrl: string) => Promise<void>;
  onDeleteScreenshot: () => void;
  saving: boolean;
  notice: string | null;
}

type Tab = 'preview' | 'code';

const TABS: Array<[Tab, string]> = [
  ['preview', 'Vista previa'],
  ['code', 'Código'],
];

/** Panel derecho: visor, editor de código y ficha del recurso. */
export default function PreviewPanel(props: PreviewPanelProps) {
  const [tab, setTab] = useState<Tab>('preview');
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // El srcdoc se recalcula sólo cuando cambia el HTML: así el iframe no se
  // recarga al tipear en otros campos del panel.
  const srcDoc = useMemo(() => buildPreviewDocument(props.html), [props.html]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // El iframe es sandbox sin allow-same-origin: su origen es "null", así que
      // se valida por la ventana que emitió, no por el origen.
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!event.data || event.data.type !== CAPTURE_RESULT) return;

      setCapturing(false);

      if (event.data.error) {
        setCaptureError(String(event.data.error));
        return;
      }

      setCaptureError(null);
      void props.onScreenshot(String(event.data.dataUrl));
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [props]);

  function requestCapture() {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;

    setCapturing(true);
    setCaptureError(null);
    frame.postMessage({ type: CAPTURE_REQUEST }, '*');

    // Si el iframe no contesta (script bloqueado, sin internet), no dejamos el
    // botón colgado para siempre.
    window.setTimeout(() => setCapturing(false), 15_000);
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(props.publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-sutil">
      <header className="flex flex-wrap items-center gap-2 border-b border-linea bg-superficie px-3 py-2">
        <div className="flex rounded-lg bg-sutil p-0.5" role="tablist">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === value ? 'bg-superficie text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>


        {/* Portada y publicación viven acá arriba, al alcance de la mano y no
            escondidas en otra pestaña: son las dos cosas que uno toca justo
            cuando termina de mirar el recurso. */}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={requestCapture}
            disabled={capturing}
            className="kodu-btn-ghost px-2.5 py-1.5 text-xs"
            title="Guarda una foto de la vista previa como portada de la galería"
          >
            {capturing ? 'Capturando…' : props.screenshotUrl ? 'Cambiar portada' : 'Sacar portada'}
          </button>

          {props.screenshotUrl && (
            <button
              type="button"
              onClick={props.onDeleteScreenshot}
              className="px-1 text-xs text-ink-500 underline underline-offset-2 hover:text-red-600"
            >
              Quitar
            </button>
          )}

          <label
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-linea px-2.5 py-1.5 text-xs text-ink-700"
            title="Publicar en la galería institucional"
          >
            <input
              type="checkbox"
              checked={props.isInGallery}
              onChange={(event) => props.onTogglePublish(event.target.checked)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className={`flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                props.isInGallery ? 'bg-brand-600' : 'bg-linea'
              }`}
            >
              <span
                className={`h-3 w-3 rounded-full bg-superficie shadow-sm transition-transform ${
                  props.isInGallery ? 'translate-x-3' : 'translate-x-0'
                }`}
              />
            </span>
            <span className="hidden sm:inline">Publicar</span>
          </label>

          <button type="button" onClick={copyUrl} className="kodu-btn-ghost px-2.5 py-1.5 text-xs">
            {copied ? '¡Copiada!' : 'Copiar URL'}
          </button>
          <a
            href={props.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="kodu-btn-ghost px-2.5 py-1.5 text-xs"
          >
            Abrir
          </a>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {/* El iframe queda SIEMPRE montado y a tamaño completo; las otras
            pestañas se dibujan ENCIMA, opacas. Dos motivos:
             - desmontarlo reiniciaba el recurso al cambiar de pestaña (adiós al
               quiz que el docente estaba probando a medias);
             - esconderlo con `display:none` le saca el layout, y entonces la
               captura sale de 0×0. Tapado conserva sus medidas y se puede
               capturar desde la ficha.
            `inert` evita que se pueda tabular hacia algo que no se ve. */}
        <iframe
          ref={iframeRef}
          title="Vista previa del recurso"
          srcDoc={srcDoc}
          // Sin allow-same-origin: el recurso no puede tocar la sesión del docente.
          sandbox="allow-scripts allow-popups allow-forms allow-modals"
          className="absolute inset-0 h-full w-full border-0 bg-superficie"
          inert={tab !== 'preview'}
        />

        {tab === 'code' && (
          <div className="absolute inset-0 z-10 overflow-auto bg-sutil">
            <Suspense
              fallback={<p className="p-4 text-sm text-ink-500">Cargando editor de código…</p>}
            >
              <CodeEditor value={props.html} onChange={props.onHtmlChange} />
            </Suspense>
          </div>
        )}

      </div>

      {/* Nombre y descripcion se editan acá, a la vista, en vez de vivir en una
          pestaña aparte: son dos campos, no una pantalla. */}
      <footer className="border-t border-linea bg-superficie px-3 py-2">
        {captureError && (
          <p role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">
            {captureError}{' '}
            <button
              type="button"
              onClick={() => setCaptureError(null)}
              className="underline hover:text-red-800"
            >
              Entendido
            </button>
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={props.title}
            maxLength={120}
            aria-label="Título del recurso"
            placeholder="Nombre del recurso"
            onChange={(event) => props.onMetaChange({ title: event.target.value })}
            className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-ink-900 transition-colors hover:border-linea focus:border-brand-500 focus:bg-superficie focus:outline-none sm:w-56"
          />

          <input
            value={props.description}
            maxLength={400}
            aria-label="Descripción del recurso"
            placeholder="Descripción: qué enseña y para qué grado"
            onChange={(event) => props.onMetaChange({ description: event.target.value })}
            className="w-full flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-ink-700 transition-colors hover:border-linea focus:border-brand-500 focus:bg-superficie focus:outline-none"
          />

          <span className="shrink-0 text-xs text-ink-500">
            {props.saving ? 'Guardando…' : props.notice}
          </span>
        </div>
      </footer>

    </section>
  );
}
