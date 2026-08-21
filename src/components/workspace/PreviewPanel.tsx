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

/** Panel derecho: visor, editor de código y controles de publicación. */
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
    <section className="flex h-full min-h-0 flex-col bg-slate-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <div className="flex rounded-lg bg-slate-100 p-0.5" role="tablist">
          {(
            [
              ['preview', 'Vista previa'],
              ['code', 'Código'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === value ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <code className="hidden max-w-[22rem] truncate rounded bg-slate-100 px-2 py-1 text-xs text-ink-500 lg:block">
            {props.publicUrl}
          </code>
          <button type="button" onClick={copyUrl} className="kodu-btn-ghost px-2.5 py-1.5 text-xs">
            {copied ? '¡Copiada!' : 'Copiar URL'}
          </button>
          <a
            href={props.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="kodu-btn-ghost px-2.5 py-1.5 text-xs"
          >
            Abrir ↗
          </a>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {tab === 'preview' ? (
          <iframe
            ref={iframeRef}
            title="Vista previa del recurso"
            srcDoc={srcDoc}
            // Sin allow-same-origin: el recurso no puede tocar la sesión del docente.
            sandbox="allow-scripts allow-popups allow-forms allow-modals"
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <Suspense
            fallback={<p className="p-4 text-sm text-ink-500">Cargando editor de código…</p>}
          >
            <div className="h-full overflow-auto">
              <CodeEditor value={props.html} onChange={props.onHtmlChange} />
            </div>
          </Suspense>
        )}
      </div>

      <footer className="space-y-3 border-t border-slate-200 bg-white p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-ink-700">
            Título
            <input
              className="kodu-input mt-1 py-1.5 text-sm"
              value={props.title}
              onChange={(event) => props.onMetaChange({ title: event.target.value })}
            />
          </label>
          <label className="text-xs text-ink-700">
            Descripción (se ve en la galería)
            <input
              className="kodu-input mt-1 py-1.5 text-sm"
              value={props.description}
              placeholder="Ej.: Quiz de fracciones para 5.º grado"
              onChange={(event) => props.onMetaChange({ description: event.target.value })}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={requestCapture}
            disabled={capturing || tab !== 'preview'}
            className="kodu-btn-ghost text-sm"
            title={
              tab === 'preview' ? 'Genera una miniatura del recurso' : 'Volvé a la vista previa para capturar'
            }
          >
            {capturing ? 'Capturando…' : '📸 Tomar captura'}
          </button>

          {props.screenshotUrl && (
            <div className="flex items-center gap-2">
              <img
                src={props.screenshotUrl}
                alt="Captura del recurso"
                className="h-10 w-16 rounded border border-slate-200 object-cover"
              />
              <button
                type="button"
                onClick={props.onDeleteScreenshot}
                className="text-xs text-ink-500 underline hover:text-red-600"
              >
                Borrar
              </button>
            </div>
          )}

          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={props.isInGallery}
              onChange={(event) => props.onTogglePublish(event.target.checked)}
              className="h-4 w-4 accent-brand-600"
            />
            Publicar en la galería institucional
          </label>
        </div>

        {/* El error de captura y el aviso de guardado son independientes: si se
            mezclan en un solo renglón, un error viejo tapa el "Guardado". */}
        {captureError && (
          <p role="alert" className="text-xs text-red-600">
            {captureError}{' '}
            <button
              type="button"
              onClick={() => setCaptureError(null)}
              className="underline hover:text-red-700"
            >
              Entendido
            </button>
          </p>
        )}
        {(props.saving || props.notice) && (
          <p className="text-xs text-ink-500">{props.saving ? 'Guardando…' : props.notice}</p>
        )}
      </footer>
    </section>
  );
}
