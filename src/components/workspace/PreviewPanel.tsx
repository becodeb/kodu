import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import ResourceSheet from './ResourceSheet.tsx';
import { CAPTURE_REQUEST, CAPTURE_RESULT, buildPreviewDocument } from '../../lib/preview.ts';

const CodeEditor = lazy(() => import('./CodeEditor.tsx'));

interface PreviewPanelProps {
  html: string;
  onHtmlChange: (html: string) => void;
  publicUrl: string;
  title: string;
  description: string;
  onMetaChange: (meta: { title?: string; description?: string }) => void;
  authorName: string;
  isInGallery: boolean;
  onTogglePublish: (value: boolean) => void;
  screenshotUrl: string | null;
  onScreenshot: (dataUrl: string) => Promise<void>;
  onDeleteScreenshot: () => void;
  saving: boolean;
  notice: string | null;
}

type Tab = 'preview' | 'code' | 'sheet';

const TABS: Array<[Tab, string]> = [
  ['preview', 'Vista previa'],
  ['code', 'Código'],
  ['sheet', 'Ficha'],
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
    <section className="flex h-full min-h-0 flex-col bg-sutil">
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


        <div className="ml-auto flex items-center gap-1.5">
          <code className="hidden max-w-[22rem] truncate rounded bg-sutil px-2 py-1 text-xs text-ink-500 lg:block">
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

        {tab === 'sheet' && (
          <div className="absolute inset-0 z-10">
            <ResourceSheet
              title={props.title}
              description={props.description}
              onMetaChange={props.onMetaChange}
              authorName={props.authorName}
              isInGallery={props.isInGallery}
              onTogglePublish={props.onTogglePublish}
              screenshotUrl={props.screenshotUrl}
              capturing={capturing}
              onCapture={requestCapture}
              onDeleteScreenshot={props.onDeleteScreenshot}
              captureError={captureError}
              onDismissCaptureError={() => setCaptureError(null)}
            />
          </div>
        )}
      </div>

      <footer className="flex min-h-9 items-center gap-3 border-t border-linea bg-superficie px-3 py-1.5 text-xs text-ink-500">
        <span className="truncate">
          {props.title.trim() || 'Recurso sin título'}
          {!props.description.trim() && (
            <>
              {' · '}
              <button
                type="button"
                onClick={() => setTab('sheet')}
                className="underline underline-offset-2 hover:text-brand-600"
              >
                agregale una descripción
              </button>
            </>
          )}
        </span>

        <span className="ml-auto shrink-0">{props.saving ? 'Guardando…' : props.notice}</span>
      </footer>
    </section>
  );
}
