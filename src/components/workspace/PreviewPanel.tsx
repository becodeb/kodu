import {
  Suspense,
  forwardRef,
  lazy,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CAPTURE_REQUEST, CAPTURE_RESULT, buildPreviewDocument, type OpcionesCaptura } from '../../lib/preview.ts';
import { aplicarKitConRedDeSeguridad, temaDe } from '../../lib/ai/kit.ts';
import { contarChecklistOk, type ItemChecklistConEstado } from '../../lib/client/checklist.ts';

const CodeEditor = lazy(() => import('./CodeEditor.tsx'));

/** T3, "Progresivo": a lo sumo un re-render del parcial por segundo. */
const PARTIAL_RENDER_MIN_MS = 1_000;
/** Margen para que el JIT de Tailwind del kit (corre solo, async, apenas
 *  carga el documento) ya haya pintado antes de mostrar el frame. */
const PARTIAL_SWAP_DELAY_MS = 150;

/**
 * T8 ("Revisión visual con captura"): margen antes de capturar para el
 * modelo, más largo que `PARTIAL_SWAP_DELAY_MS`. Ahí alcanza con esperar al
 * JIT de Tailwind (todo local); acá el documento FINAL también puede estar
 * esperando la hoja de Google Fonts del kit, que pide red — un texto en la
 * fuente del sistema en la captura le mentiría al modelo sobre cómo se ve
 * de verdad el recurso.
 */
const CAPTURE_SETTLE_MS = 600;
/** Cuánto se espera la respuesta del puente antes de rendirse. */
const CAPTURE_TIMEOUT_MS = 15_000;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export interface PreviewPanelHandle {
  /**
   * Pide una captura de la vista previa ACTUAL (T8): espera a que el
   * iframe haya cargado el HTML vigente más el margen de asentado, y
   * resuelve con el data URL o con un error — nunca tira. Independiente de
   * la captura de portada de más abajo (`pedirCaptura`): cada pedido lleva
   * su propio `id`, así que pueden estar los dos en el aire sin cruzarse.
   */
  capturar(opciones: OpcionesCaptura): Promise<{ dataUrl: string } | { error: string }>;
}

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
  /**
   * T12 (round 3, "Autoprueba + autocorrección"): la autoprueba automática
   * de este recurso siguió encontrando problemas después de las 2 rondas de
   * corrección permitidas. Discreto y NO bloqueante — el recurso se sigue
   * mostrando igual, esto es sólo una señal para que el docente sepa que
   * conviene revisarlo con más atención. Workspace.tsx lo limpia solo apenas
   * el HTML vuelve a cambiar (nuevo turno, deshacer, edición manual, cambio
   * de versión).
   */
  autopruebaAdvertencia?: boolean;
  /**
   * T18 (round 4, "checklist del docente"): el checklist vigente del
   * recurso, ya cruzado con el resultado de la última autoprueba (T17,
   * Workspace.tsx: `estadoDeChecklist`). `[]` cuando el recurso no tiene
   * checklist (viejo, o el paso T16 nunca corrió) — "Esto es lo que probé"
   * queda oculto entero en ese caso, nunca en "0 de 0".
   */
  checklist: ItemChecklistConEstado[];
}

type Tab = 'preview' | 'code';

/**
 * T18: un ícono chico por estado de ítem del checklist, mismo trazo que el
 * resto del editor (SVG a mano, `currentColor`, sin depender de Lucide en
 * React — ver `ChatPanel.tsx`). El color lo pone quien lo usa (vía
 * `className` del contenedor), acá sólo el dibujo.
 */
function IconoEstadoChecklist({ estado }: { estado: ItemChecklistConEstado['estado'] }) {
  if (estado === 'ok') {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 13l4.5 4.5L19 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (estado === 'falla') {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 3.5 22 20H2L12 3.5Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M12 10v4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="17.3" r="1" fill="currentColor" />
      </svg>
    );
  }
  if (estado === 'sinProbar') {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  // sinPrueba: un guion — "no hay nada que decir acá", ni bien ni mal.
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 12h12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

const TEXTO_ESTADO_CHECKLIST: Record<ItemChecklistConEstado['estado'], string> = {
  ok: 'Funciona',
  falla: 'Puede fallar',
  sinPrueba: 'Sin prueba automática',
  sinProbar: 'Se prueba después de cada cambio',
};

/** Color del ícono/texto de cada fila — discreto: sólo `falla` se despega
 *  del gris neutro de siempre (mismo rojo que ya usa el resto del editor
 *  para avisos, p. ej. el botón "Quitar" portada). */
const COLOR_ESTADO_CHECKLIST: Record<ItemChecklistConEstado['estado'], string> = {
  ok: 'text-ink-700',
  falla: 'text-red-600',
  sinPrueba: 'text-ink-500',
  sinProbar: 'text-ink-500',
};

const TABS: Array<[Tab, string]> = [
  ['preview', 'Vista previa'],
  ['code', 'Código'],
];

/** Panel derecho: visor, editor de código y ficha del recurso. */
const PreviewPanel = forwardRef<PreviewPanelHandle, PreviewPanelProps>(function PreviewPanel(props, ref) {
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
  // Espejo de `listo` en un ref (T8, `capturar` más abajo): esa función no
  // se vuelve a crear en cada render (ver `useCallback`/`useImperativeHandle`
  // al final), así que no puede cerrar sobre el `listo` de un render viejo —
  // necesita leer el valor VIGENTE en el momento en que la llaman, y eso es
  // exactamente para lo que sirve un ref.
  const listoRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<number | null>(null);
  // Contador compartido por los DOS pedidos de captura de este componente
  // (`pedirCaptura` para la portada, `capturar` para T8): cada uno arma su
  // propio `id` a partir de acá, así que aunque los dos estén en el aire a
  // la vez, cada uno reconoce SU respuesta y ninguno le roba la del otro.
  const proximoIdCapturaRef = useRef(0);
  // El `id` que espera el pedido de portada en curso, o `null`. El listener
  // de más abajo ignora cualquier `CAPTURE_RESULT` que no lo lleve — incluido
  // el de una captura de `capturar()` (T8) que esté corriendo al mismo tiempo.
  const pendingIdRef = useRef<string | null>(null);

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
  //
  // `aplicarKitConRedDeSeguridad` y no `aplicarKit` a secas (T11, "Red de
  // seguridad: tema por defecto"): es pura y barata, así que correrla acá
  // también no cuesta nada, y evita que la vista previa en vivo muestre un
  // instante de clases de Tailwind sin estilos (si el modelo todavía no
  // escribió el meta) para después "saltar" al tema por defecto recién
  // cuando el turno termina y el servidor aplica el mismo respaldo
  // (`aplicarKitAlTurno` en stream.ts) — la vista previa queda consistente
  // con lo que termina guardado.
  const kitParcial = useMemo(() => {
    if (props.partialHtml == null || !/<body[\s>]/i.test(props.partialHtml)) return null;
    return aplicarKitConRedDeSeguridad(props.partialHtml, { temaPrevio });
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
    listoRef.current = false;
  }, [srcDoc]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // El iframe es sandbox sin allow-same-origin: su origen es "null", así que
      // se valida por la ventana que emitió, no por el origen.
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!event.data || event.data.type !== CAPTURE_RESULT) return;
      // El `id` distingue ESTE pedido (portada) de cualquier otro que esté
      // en el aire al mismo tiempo (T8, `capturar()`): sin este chequeo, la
      // respuesta de una revisión visual terminaría subiéndose como si
      // fuera la portada del recurso.
      if (pendingIdRef.current === null || event.data.id !== pendingIdRef.current) return;
      pendingIdRef.current = null;

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
    const id = String(++proximoIdCapturaRef.current);
    pendingIdRef.current = id;
    setCapturing(true);
    setCapturingParaPublicar(publicar);
    setCaptureError(null);
    if (publicar) setPublicando(true);
    frame.postMessage({ type: CAPTURE_REQUEST, id }, '*');

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

  /**
   * T8 ("Revisión visual con captura"): captura ad-hoc para mandarle al
   * modelo, totalmente aparte del flujo de portada de arriba (propio `id`,
   * propio listener de una sola vez, sin tocar `capturing`/`captureError`/
   * `publicando`). Nunca tira: cualquier problema vuelve como `{ error }`.
   */
  const capturar = useCallback(
    async (opciones: OpcionesCaptura): Promise<{ dataUrl: string } | { error: string }> => {
      const limite = Date.now() + CAPTURE_TIMEOUT_MS;
      while (!listoRef.current) {
        if (Date.now() >= limite) return { error: 'La vista previa no terminó de cargar.' };
        await esperar(50);
      }

      // Margen de asentado (fuentes, JIT) ANTES de pedir la captura: ver el
      // comentario de CAPTURE_SETTLE_MS más arriba.
      await esperar(CAPTURE_SETTLE_MS);

      const frame = iframeRef.current?.contentWindow;
      if (!frame) return { error: 'La vista previa no está lista.' };

      return new Promise((resolve) => {
        const id = String(++proximoIdCapturaRef.current);

        const timeout = window.setTimeout(() => {
          window.removeEventListener('message', onMessage);
          resolve({ error: 'La captura tardó demasiado.' });
        }, CAPTURE_TIMEOUT_MS);

        function onMessage(event: MessageEvent) {
          if (event.source !== iframeRef.current?.contentWindow) return;
          if (!event.data || event.data.type !== CAPTURE_RESULT || event.data.id !== id) return;
          window.clearTimeout(timeout);
          window.removeEventListener('message', onMessage);
          if (event.data.error) resolve({ error: String(event.data.error) });
          else resolve({ dataUrl: String(event.data.dataUrl) });
        }

        window.addEventListener('message', onMessage);
        frame.postMessage({ type: CAPTURE_REQUEST, id, opciones }, '*');
      });
    },
    [],
  );

  useImperativeHandle(ref, () => ({ capturar }), [capturar]);

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
          onLoad={() => {
            setListo(true);
            listoRef.current = true;
          }}
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

        {/* T12 ("Autoprueba + autocorrección"): discreto a propósito — no es
            un error del docente ni bloquea nada, sólo una señal de que
            conviene mirar el recurso con más atención. Sin botón de cerrar:
            se limpia sola cuando el HTML vuelve a cambiar (ver Workspace.tsx). */}
        {props.autopruebaAdvertencia && (
          <p className="mb-2 rounded-lg bg-sutil px-3 py-1.5 text-xs text-ink-600">
            Probamos el recurso y algo puede no funcionar bien. Si lo notás, contalo en el chat.
          </p>
        )}

        {/* T18 (round 4, "checklist del docente"): "Esto es lo que probé" —
            discreto y PLEGADO por default (design decisions de la tarea: no
            tapa la vista previa), pero visible por default, sin bandera —
            sólo dice lo que se probó. Ausente entero sin checklist (nunca
            "0 de 0"). `<details>` da abrir/cerrar accesible por teclado sin
            armar el manejo de foco a mano — mismo patrón que la lista de
            adjuntos de ChatPanel. */}
        {props.checklist.length > 0 && (
          <details className="mb-2 rounded-lg bg-sutil px-3 py-1.5 text-xs text-ink-600">
            {/* Sin marcador propio: el triángulo nativo de `<summary>` ya es
                accesible y con foco visible en los tres navegadores, mismo
                criterio que la lista de adjuntos de ChatPanel. */}
            <summary className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1">
              Esto es lo que probé · {contarChecklistOk(props.checklist)} de {props.checklist.length}
            </summary>

            <ul className="mt-1.5 space-y-1.5">
              {props.checklist.map((item) => (
                <li key={item.id} className={`flex items-start gap-1.5 ${COLOR_ESTADO_CHECKLIST[item.estado]}`}>
                  <span className="mt-0.5 shrink-0">
                    <IconoEstadoChecklist estado={item.estado} />
                  </span>
                  <span>
                    <span className="sr-only">{TEXTO_ESTADO_CHECKLIST[item.estado]}: </span>
                    {item.texto}
                    {item.estado === 'falla' && item.detalle && (
                      <span className="block text-[0.7rem] text-ink-500">{item.detalle}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </details>
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
});

export default PreviewPanel;
