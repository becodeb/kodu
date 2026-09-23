import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { CAPTURE_REQUEST, CAPTURE_RESULT, buildPreviewDocument } from '../../lib/preview.ts';
import { aplicarKit, temaDe } from '../../lib/ai/kit.ts';

const CodeEditor = lazy(() => import('./CodeEditor.tsx'));

/** T3, "Progresivo": a lo sumo un re-render del parcial por segundo. */
const PARTIAL_RENDER_MIN_MS = 1_000;
/** Margen para que el JIT de Tailwind del kit (corre solo, async, apenas
 *  carga el documento) ya haya pintado antes de mostrar el frame. */
const PARTIAL_SWAP_DELAY_MS = 150;

interface PreviewPanelProps {
  html: string;
  /** HTML parcial del turno en curso (T3), ya decodificado pero SIN el kit
   *  aplicado — este componente aplica el kit y decide cuándo mostrarlo.
   *  `null` cuando no hay ningún turno escribiendo código. */
  partialHtml: string | null;
  onHtmlChange: (html: string) => void;
  publicUrl: string;
  title: string;
  description: string;
  onMetaChange: (meta: { title?: string; description?: string }) => void;
  isInGallery: boolean;
  /** Sólo despublica. Publicar entra por la secuencia de captura de abajo. */
  onDespublicar: () => void;
  /** Vacía el guardado pendiente antes de capturar (design §3.2): si no, la
   *  portada retrata código que todavía no se guardó. */
  onAntesDePublicar: () => Promise<void>;
  screenshotUrl: string | null;
  /** `publicar: true` = la captura fue pedida para publicar. */
  onScreenshot: (dataUrl: string, opciones?: { publicar?: boolean }) => Promise<void>;
  onDeleteScreenshot: () => void;
  /** El recurso cambió después de la última portada (design §6). */
  portadaVieja: boolean;
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
  // Cuál de los dos gatillos (portada sola, o portada-para-publicar) disparó
  // la captura en curso: los dos comparten el mismo iframe, así que sólo uno
  // corre a la vez, pero cada botón necesita saber si es el suyo.
  const [capturingParaPublicar, setCapturingParaPublicar] = useState(false);
  // Vive desde el click hasta que TODA la secuencia (captura + POST + PATCH)
  // termina, no sólo la captura: el switch no se mueve optimistamente
  // (design §3.2), así que mientras esto es true queda deshabilitado con
  // "Publicando…", sin importar en qué paso de la cadena esté.
  const [publicando, setPublicando] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // El iframe renderizó al menos una vez con el HTML actual. Sin esto la
  // captura puede salir de un documento en blanco.
  const [listo, setListo] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<number | null>(null);

  // El srcdoc se recalcula sólo cuando cambia el HTML: así el iframe no se
  // recarga al tipear en otros campos del panel.
  const srcDoc = useMemo(() => buildPreviewDocument(props.html), [props.html]);

  // ───────────────────────────────────────────────────────────
  // T3: vista previa que se arma mientras la IA escribe ("Progresivo" en
  // Decisiones del dueño). Doble búfer de dos iframes ocultos-uno-visible-uno:
  // el HTML parcial se carga SIEMPRE en el que no se ve, y sólo se muestra
  // una vez que cargó — así el frame visible nunca muestra un documento a
  // medio pintar. Cuando llega el HTML final, se vuelve al iframe de siempre
  // (con el puente de captura, sin tocar nada de lo de arriba).
  // ───────────────────────────────────────────────────────────

  // El tema previo (T2, mismo criterio que `aplicarKitAlTurno` en
  // stream.ts): si el parcial todavía no declaró su propio tema, se usa el
  // que ya tenía el recurso antes de este turno como respaldo.
  const temaPrevio = useMemo(() => temaDe(props.html), [props.html]);

  // El kit recién se aplica (y se empieza a mostrar) una vez que hay `<body`:
  // antes de eso el documento no tiene nada para pintar todavía.
  const kitParcial = useMemo(() => {
    if (props.partialHtml == null || !/<body[\s>]/i.test(props.partialHtml)) return null;
    return aplicarKit(props.partialHtml, { temaPrevio });
  }, [props.partialHtml, temaPrevio]);

  const hayParcial = props.partialHtml != null;

  const [dobleBufer, setDobleBufer] = useState<{ frente: 0 | 1; srcDocs: [string, string] }>({
    frente: 0,
    srcDocs: ['', ''],
  });
  const ultimoRenderRef = useRef(0);
  const ultimoValorRef = useRef<string | null>(null);
  const timerParcialRef = useRef<number | null>(null);
  const swapTimerRef = useRef<number | null>(null);

  // Throttle de a lo sumo un render por segundo, quedándose con el ÚLTIMO
  // valor (no el primero) cuando llegan varios mientras se espera. La
  // primera vez dispara enseguida (borde de arranque: `ultimoRenderRef`
  // arranca en 0, así que "pasaron más de 1000ms" es cierto de entrada) —
  // quedarse en blanco un segundo entero apenas hay algo que mostrar se ve
  // peor que un re-render de más.
  useEffect(() => {
    ultimoValorRef.current = kitParcial;
    if (kitParcial == null) return;

    function disparar() {
      ultimoRenderRef.current = Date.now();
      timerParcialRef.current = null;
      const valor = ultimoValorRef.current;
      if (valor == null) return;

      setDobleBufer((actual) => {
        const detras: 0 | 1 = actual.frente === 0 ? 1 : 0;
        const srcDocs: [string, string] = [...actual.srcDocs];
        srcDocs[detras] = valor;
        return { ...actual, srcDocs };
      });
    }

    const transcurrido = Date.now() - ultimoRenderRef.current;
    if (transcurrido >= PARTIAL_RENDER_MIN_MS) {
      disparar();
    } else if (timerParcialRef.current == null) {
      timerParcialRef.current = window.setTimeout(disparar, PARTIAL_RENDER_MIN_MS - transcurrido);
    }
    // Si ya hay un timer pendiente no hace falta programar otro: cuando
    // dispare, lee `ultimoValorRef.current`, que para entonces ya tiene este
    // valor más nuevo.
  }, [kitParcial]);

  // Turno nuevo o recién terminado: se limpia el búfer entero, para no
  // arrastrar el HTML de un turno viejo ni un timer colgado al siguiente.
  useEffect(() => {
    if (hayParcial) return;
    setDobleBufer({ frente: 0, srcDocs: ['', ''] });
    ultimoRenderRef.current = 0;
    ultimoValorRef.current = null;
    if (timerParcialRef.current != null) {
      window.clearTimeout(timerParcialRef.current);
      timerParcialRef.current = null;
    }
    if (swapTimerRef.current != null) {
      window.clearTimeout(swapTimerRef.current);
      swapTimerRef.current = null;
    }
  }, [hayParcial]);

  useEffect(() => {
    return () => {
      if (timerParcialRef.current != null) window.clearTimeout(timerParcialRef.current);
      if (swapTimerRef.current != null) window.clearTimeout(swapTimerRef.current);
    };
  }, []);

  /**
   * El frame de atrás terminó de cargar: se muestra, con un margen corto para
   * que el JIT de Tailwind del kit (corre solo, async, apenas carga el
   * documento) ya haya pintado — sin esto se ve un flash sin estilos apenas
   * se muestra. `contenido` viene del render que armó ESTE `onLoad`: si está
   * vacío es el placeholder inicial (todo iframe con `srcDoc=""` dispara
   * "load" igual), no hay nada que mostrar todavía.
   */
  function alCargarParcial(indice: 0 | 1, contenido: string) {
    return () => {
      if (!contenido) return;
      if (swapTimerRef.current != null) window.clearTimeout(swapTimerRef.current);
      swapTimerRef.current = window.setTimeout(() => {
        swapTimerRef.current = null;
        setDobleBufer((actual) => (actual.frente === indice ? actual : { ...actual, frente: indice }));
      }, PARTIAL_SWAP_DELAY_MS);
    };
  }

  // Recién se muestra el doble búfer una vez que el frame de adelante tiene
  // contenido real: si no, con el turno recién arrancado (buffer todavía
  // `['','']`) se vería un iframe en blanco tapando al de siempre.
  const parcialListoParaMostrar = hayParcial && dobleBufer.srcDocs[dobleBufer.frente] !== '';

  // Un HTML nuevo es un documento nuevo por renderizar: hasta que no llegue
  // su propio "load", una captura saldría del documento anterior o de uno en
  // blanco.
  useEffect(() => {
    setListo(false);
  }, [srcDoc]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // El iframe es sandbox sin allow-same-origin: su origen es "null", así que
      // se valida por la ventana que emitió, no por el origen.
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!event.data || event.data.type !== CAPTURE_RESULT) return;

      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setCapturing(false);

      if (event.data.error) {
        setCaptureError(String(event.data.error));
        if (capturingParaPublicar) setPublicando(false);
        return;
      }

      setCaptureError(null);
      const publicar = capturingParaPublicar;
      void props
        .onScreenshot(String(event.data.dataUrl), publicar ? { publicar: true } : undefined)
        .finally(() => {
          if (publicar) setPublicando(false);
        });
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [props, capturingParaPublicar]);

  function pedirCaptura(opciones?: { publicar?: boolean }) {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;

    const publicar = !!opciones?.publicar;
    setCapturing(true);
    setCapturingParaPublicar(publicar);
    setCaptureError(null);
    if (publicar) setPublicando(true);
    frame.postMessage({ type: CAPTURE_REQUEST }, '*');

    // Si el iframe no contesta (script bloqueado, sin internet), no dejamos el
    // botón colgado para siempre: se levanta como un error reintentable, no
    // como un apagado silencioso.
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setCapturing(false);
      setCaptureError('La captura tardó demasiado. Probá de nuevo.');
      if (publicar) setPublicando(false);
    }, 15_000);
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
            onClick={() => pedirCaptura()}
            disabled={capturing}
            className="kodu-btn-ghost relative px-2.5 py-1.5 text-xs"
            title={
              props.portadaVieja
                ? 'El recurso cambió después de la última portada.'
                : 'Guarda una foto de la vista previa como portada de la galería'
            }
          >
            {capturing && !capturingParaPublicar
              ? 'Capturando…'
              : props.portadaVieja
                ? 'Actualizar portada'
                : props.screenshotUrl
                  ? 'Cambiar portada'
                  : 'Sacar portada'}
            {props.portadaVieja && (
              <>
                <span
                  aria-hidden="true"
                  className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-brand-600"
                />
                <span className="sr-only">La portada quedó desactualizada.</span>
              </>
            )}
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
            title={props.isInGallery ? 'Publicado en la galería' : 'Publicar en la galería institucional'}
          >
            <input
              type="checkbox"
              checked={props.isInGallery}
              disabled={publicando || (!props.isInGallery && !listo)}
              aria-busy={publicando}
              onChange={(event) => {
                if (event.target.checked) {
                  setPublicando(true);
                  void props.onAntesDePublicar().then(() => pedirCaptura({ publicar: true }));
                } else {
                  props.onDespublicar();
                }
              }}
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
            <span className="hidden sm:inline">{publicando ? 'Publicando…' : 'Publicar'}</span>
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
          onLoad={() => setListo(true)}
          // Sin allow-same-origin: el recurso no puede tocar la sesión del docente.
          sandbox="allow-scripts allow-popups allow-forms allow-modals"
          data-kodu-frente={parcialListoParaMostrar ? 'false' : 'true'}
          className={`absolute inset-0 h-full w-full border-0 bg-superficie ${
            parcialListoParaMostrar ? 'pointer-events-none opacity-0' : ''
          }`}
          inert={tab !== 'preview' || parcialListoParaMostrar}
        />

        {/* T3: doble búfer para la vista previa que se arma mientras la IA
            escribe. Dos iframes SIN el puente de captura (preview.ts) y con
            sandbox más chico: un script a medio escribir puede tirar errores
            sueltos y acá se ignoran a propósito — nada escucha `message` de
            estos frames. Ocupan el mismo lugar que el iframe de arriba
            (mismo `absolute inset-0`), así que alternar entre los tres no
            mueve el layout del panel. */}
        {([0, 1] as const).map((indice) => {
          const esFrente = parcialListoParaMostrar && dobleBufer.frente === indice;
          return (
            <iframe
              key={indice}
              title={`Vista previa parcial ${indice + 1}`}
              srcDoc={dobleBufer.srcDocs[indice]}
              onLoad={alCargarParcial(indice, dobleBufer.srcDocs[indice])}
              sandbox="allow-scripts"
              data-kodu-frente={esFrente ? 'true' : 'false'}
              className={`absolute inset-0 h-full w-full border-0 bg-superficie ${
                esFrente ? '' : 'pointer-events-none opacity-0'
              }`}
              inert={tab !== 'preview' || !esFrente}
            />
          );
        })}

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
