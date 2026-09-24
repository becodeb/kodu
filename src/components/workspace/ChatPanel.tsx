import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import AiStatus from './AiStatus.tsx';
import StreamedText from './StreamedText.tsx';
import StarterDialog from './StarterDialog.tsx';
import SelectorDeMotor from './SelectorDeMotor.tsx';
import { STARTERS, type Starter } from './starters.ts';
import { mensajeParaDeshacer } from '../../lib/client/undo.ts';
import { mensajeParaVersiones } from '../../lib/client/versiones.ts';
import type {
  AiPhase,
  MotorPublico,
  Speed,
  VersionEnCurso,
  WorkspaceAsset,
  WorkspaceMessage,
  WorkspaceThread,
} from '../../lib/workspace-types.ts';

interface ChatPanelProps {
  messages: WorkspaceMessage[];
  streamingText: string;
  isStreaming: boolean;
  aiPhase: AiPhase;
  /** Epoch ms de arranque del turno, para el cronómetro. */
  turnoDesde: number | null;
  onDetener: () => void;
  error: string | null;
  /** Hay un pedido fallido que se puede volver a mandar tal cual. */
  canRetry: boolean;
  onRetry: () => void;
  /** Nombre del otro proveedor cuando el elegido falló y se puede redirigir. */
  fallbackLabel: string | null;
  onUseFallback: () => void;
  /** Llega cuando la demo agota su tope (M7): un link real a /register. */
  registerUrl: string | null;
  /** El `id` del `AiModel` vigente. */
  model: string;
  motoresDisponibles: MotorPublico[];
  onModelChange: (modelId: string) => void;
  threads: WorkspaceThread[];
  activeThreadId: string;
  onThreadChange: (threadId: string) => void;
  onNewThread: () => void;
  assets: WorkspaceAsset[];
  pendingAssets: WorkspaceAsset[];
  uploading: boolean;
  onAttach: (files: File[]) => void;
  onRemovePending: (assetId: string) => void;
  onSend: (message: string) => void;
  /** T4: deshace el turno que cerró el mensaje "assistant" con este id. */
  onUndo: (messageId: string) => void;
  /** T6 ("Velocidad Rápido / A fondo"): sólo quien lo tiene ve el control. */
  puedeElegirVelocidad: boolean;
  speed: Speed;
  onSpeedChange: (speed: Speed) => void;
  /**
   * T9 ("Varias versiones al crear un recurso"): el interruptor sólo se
   * ofrece con las dos condiciones juntas — el permiso Y el recurso todavía
   * en blanco (crear, no editar).
   */
  puedePedirVersiones: boolean;
  esRecursoInicial: boolean;
  versiones: boolean;
  onVersionesChange: (activo: boolean) => void;
  /** T9: progreso del turno de versiones EN CURSO — `null` si no hay uno. */
  versionesEnCurso: VersionEnCurso[] | null;
  /** T9: elige la versión `index` del mensaje `messageId`. */
  onElegirVersion: (messageId: string, index: number) => void;
}

/**
 * T9: la fila de chips "Versión 1 · 2 · 3" — usada tanto para el progreso EN
 * CURSO (todavía sin mensaje: `activa` fija en 1, `onElegir` ausente, nada
 * es clickeable) como para el mensaje ya cerrado (`onElegir` presente,
 * clickeable en cualquier índice que exista). Chica y muda a propósito
 * (decisiones del dueño, "Discreto"): nunca la palabra "prime".
 */
function FilaVersiones(props: {
  variantes: Array<{ index: number; ready: boolean }>;
  activa: number | null;
  onElegir: ((index: number) => void) | null;
}) {
  return (
    <div
      role="group"
      aria-label="Versiones generadas"
      className="mt-1 flex flex-wrap items-center gap-1 px-1 text-xs text-ink-500"
    >
      <span>Versión</span>
      {props.variantes.map((variante, posicion) => {
        const esActiva = props.activa === variante.index;
        const clicable = variante.ready && props.onElegir !== null;

        return (
          <span key={variante.index} className="inline-flex items-center gap-1">
            {posicion > 0 && <span aria-hidden="true">·</span>}
            <button
              type="button"
              disabled={!clicable}
              aria-pressed={esActiva}
              onClick={clicable ? () => props.onElegir!(variante.index) : undefined}
              className={`rounded-full border px-2 py-0.5 font-medium transition-colors ${
                esActiva
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : variante.ready
                    ? 'border-linea bg-superficie text-ink-700 hover:border-brand-300 hover:text-brand-700'
                    : 'border-transparent text-ink-500/50'
              }`}
            >
              {variante.index}
              {!variante.ready && <span className="sr-only"> (generando)</span>}
            </button>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Convierte los `**...**` que escribe el modelo en negritas de verdad.
 *
 * No es un parser de Markdown: es lo mínimo para que el docente no vea
 * asteriscos sueltos, que era lo único que se colaba en la práctica. El resto
 * del texto se respeta tal cual, con sus saltos de línea.
 */
function renderRich(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, index) =>
    chunk.startsWith('**') && chunk.endsWith('**') && chunk.length > 4 ? (
      <strong key={index} className="font-semibold">
        {chunk.slice(2, -2)}
      </strong>
    ) : (
      chunk
    ),
  );
}


/** Panel izquierdo del editor: control, historial y composición (SPEC §5.1). */
export default function ChatPanel(props: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [starterAbierto, setStarterAbierto] = useState<Starter | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // T4: el único mensaje que puede ofrecer "Deshacer" ahora mismo — nunca
  // mientras hay un turno corriendo, aunque técnicamente ya sea deshacible.
  const idParaDeshacer = props.isStreaming ? null : mensajeParaDeshacer(props.messages);

  // T9: el único mensaje que puede mostrar la fila de chips ahora mismo —
  // a diferencia de "Deshacer", acá SÍ importa mientras `isStreaming` es
  // `true` (el próximo turno ya la tapa: ver `mensajeParaVersiones`).
  const idParaVersiones = mensajeParaVersiones(props.messages);

  // Autoscroll mientras llega el stream.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [props.messages.length, props.streamingText]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || props.isStreaming) return;

    props.onSend(text);
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envía, Shift+Enter hace salto de línea.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit(event as unknown as FormEvent);
      return;
    }

    // Flecha arriba con el campo vacío: trae el último pedido, como en una
    // terminal. Sólo con el campo vacío, para no pisar lo que se está tipeando.
    if (event.key === 'ArrowUp' && draft.length === 0) {
      const ultimo = [...props.messages].reverse().find((m) => m.role === 'user');
      if (ultimo) {
        event.preventDefault();
        setDraft(ultimo.content);
      }
    }
  }

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) props.onAttach(files);
    event.target.value = '';
  }

  /** Deja pasar sólo lo que el servidor acepta, para no pedir un 415 al pedo. */
  function admitidos(files: File[]): File[] {
    return files.filter((file) => file.type.startsWith('image/') || file.type === 'application/pdf');
  }

  /**
   * Pegar con Ctrl+V.
   *
   * Una captura de pantalla no llega como archivo con nombre: viene en
   * `clipboardData.files` (o entre los `items`) con el nombre vacío o genérico.
   * Por eso se filtra por tipo y no por extensión, y sólo se corta el pegado
   * cuando efectivamente había una imagen — si no, se deja pegar el texto.
   */
  function onPaste(event: React.ClipboardEvent) {
    if (props.uploading || props.isStreaming) return;

    const desdeFiles = Array.from(event.clipboardData?.files ?? []);
    const desdeItems = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    const candidatos = admitidos(desdeFiles.length > 0 ? desdeFiles : desdeItems);
    if (candidatos.length === 0) return;

    event.preventDefault();
    props.onAttach(candidatos);
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setArrastrando(false);
    if (props.uploading || props.isStreaming) return;

    const candidatos = admitidos(Array.from(event.dataTransfer?.files ?? []));
    if (candidatos.length > 0) props.onAttach(candidatos);
  }

  function onDragOver(event: React.DragEvent) {
    // Sin esto el navegador abre el archivo en una pestaña nueva.
    if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
    event.preventDefault();
    if (!arrastrando) setArrastrando(true);
  }

  return (
    <section
      className="relative flex h-full min-h-0 w-full flex-col border-linea bg-superficie lg:border-r"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        // Sólo cuando el puntero sale de la sección entera, no al pasar de un
        // hijo a otro: si no, el cartel parpadea mientras se arrastra por encima.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setArrastrando(false);
      }}
    >
      {arrastrando && (
        <div className="pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-xl border-2 border-dashed border-brand-500 bg-brand-50/90">
          <p className="text-sm font-semibold text-brand-700">Soltá acá para adjuntar</p>
        </div>
      )}
      <StarterDialog
        starter={starterAbierto}
        onCerrar={() => setStarterAbierto(null)}
        onListo={(prompt) => {
          setStarterAbierto(null);
          setDraft(prompt);
        }}
      />
      <header className="space-y-2 border-b border-linea p-2 lg:space-y-3 lg:p-3">
        <div className="flex items-center gap-2">
          <select
            value={props.activeThreadId}
            onChange={(event) => props.onThreadChange(event.target.value)}
            className="kodu-input py-1.5 text-xs"
            aria-label="Hilo de conversación"
          >
            {props.threads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.title}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={props.onNewThread}
            className="kodu-btn-ghost shrink-0 px-2.5 py-1.5 text-xs"
            title="Empezar una conversación nueva sin perder el código"
          >
            + Nuevo chat
          </button>
        </div>

        {/* Selector de motor: un desplegable con la descripción siempre visible
            mientras está abierto, no un `title` sólo de mouse (design §8). */}
        <SelectorDeMotor
          motores={props.motoresDisponibles}
          model={props.model}
          onModelChange={props.onModelChange}
        />
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {props.messages.length === 0 && !props.isStreaming && (
          /* El docente que abre esto por primera vez no sabe qué se le puede
             pedir a la IA ni con cuánto detalle. En vez de explicárselo, se le
             dan tres pedidos escritos como conviene escribirlos: toca uno, lo
             ve completo en el campo de abajo y lo edita. */
          <div className="space-y-4 px-1 py-6 text-center">
            <div className="flex justify-center">
              <ThinkingOrb state="breathing" size={64} theme="auto" aria-label="" />
            </div>

            <div>
              <p className="font-display text-base text-ink-900">¿Qué vas a dar hoy?</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-ink-500">
                Contame el tema y el grado. Cuanto más concreto, mejor sale.
              </p>
            </div>

            <ul className="space-y-1.5 text-left">
              {STARTERS.map((starter) => (
                <li key={starter.label}>
                  <button
                    type="button"
                    onClick={() => setStarterAbierto(starter)}
                    className="w-full rounded-xl border border-linea bg-superficie px-3 py-2.5 text-sm text-ink-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                  >
                    {starter.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {props.messages.map((message) => {
          // T4: el par que deshizo un "Deshacer" (el pedido y la respuesta
          // de ESE turno) sigue a la vista, pero apagado — no desaparece, no
          // es un secreto, es historia vieja.
          const deshecho = message.undoneAt != null;

          return (
            <div key={message.id} className={message.role === 'user' ? 'ml-6' : 'mr-6'}>
              {/* M8 (design.md §7): marca durable de que este turno lo escribió un
                  admin, no el docente dueño del recurso. Ausente en el caso normal. */}
              {message.authorName && (
                <p className="mb-0.5 px-1 text-xs text-ink-500">{message.authorName} (administración)</p>
              )}
              <article
                className={
                  (message.role === 'user'
                    ? 'rounded-xl bg-brand-600 px-3 py-2 text-sm whitespace-pre-wrap text-white'
                    : 'rounded-xl bg-sutil px-3 py-2 text-sm whitespace-pre-wrap text-ink-900') +
                  (deshecho ? ' opacity-50' : '')
                }
              >
                {renderRich(message.content)}
                {message.attachments.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs opacity-80">
                    {message.attachments.map((url) => (
                      <li key={url}>{url.split('/').pop()}</li>
                    ))}
                  </ul>
                )}
              </article>

              {deshecho && <p className="mt-0.5 px-1 text-xs text-ink-500">Deshecho</p>}

              {/* Sólo en el mensaje más nuevo que todavía se puede deshacer
                  (T4), y sólo cuando no hay ningún turno corriendo: un click
                  a mitad de un pedido nuevo no tiene "antes" claro al que
                  volver. */}
              {message.id === idParaDeshacer && (
                <button
                  type="button"
                  onClick={() => props.onUndo(message.id)}
                  className="kodu-btn-ghost mt-1 px-2.5 py-1.5 text-xs"
                  title="Deshacer este cambio de la IA"
                >
                  {/* El trazo es `undo-2` de Lucide: una flecha que vuelve, no
                      el "Enter" que se leía con el trazo anterior. */}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Deshacer
                </button>
              )}

              {/* T9 ("Varias versiones al crear un recurso"): sólo en el
                  mensaje "assistant" de un turno de versiones, y sólo
                  mientras sigue siendo el último de la lista (ver
                  `mensajeParaVersiones` — desaparece apenas el docente manda
                  el próximo mensaje, la elección queda hecha). */}
              {message.id === idParaVersiones && message.variants && (
                <FilaVersiones
                  variantes={message.variants.map((variante) => ({ index: variante.index, ready: true }))}
                  activa={message.chosenVariant ?? 1}
                  onElegir={(index) => props.onElegirVersion(message.id, index)}
                />
              )}
            </div>
          );
        })}

        {/* La burbuja aparece recién cuando hay algo que leer. Mientras tanto el
            estado vive abajo, sobre el blanco, y no como una caja gris vacía. */}
        {props.isStreaming && props.streamingText.length > 0 && (
          <article className="mr-6 rounded-xl bg-sutil px-3 py-2 text-sm whitespace-pre-wrap text-ink-900">
            <StreamedText text={props.streamingText} render={renderRich} />
          </article>
        )}

        {/* T9: progreso de un turno de versiones EN CURSO — todavía no hay
            mensaje "assistant" al que colgarle la fila de arriba (recién
            existe cuando el turno entero termina), así que se muestra
            aparte, con las mismas chips pero ninguna clickeable. */}
        {props.isStreaming && props.versionesEnCurso && props.versionesEnCurso.length > 0 && (
          <div className="mr-6">
            <FilaVersiones variantes={props.versionesEnCurso} activa={1} onElegir={null} />
          </div>
        )}

        {props.error && (
          <div role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            <p>{props.error}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {props.canRetry && (
                <button
                  type="button"
                  onClick={props.onRetry}
                  className="rounded-lg border border-red-200 bg-superficie px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                >
                  Reintentar
                </button>
              )}
              {props.fallbackLabel && (
                <button
                  type="button"
                  onClick={props.onUseFallback}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                >
                  Probar con {props.fallbackLabel}
                </button>
              )}
              {props.registerUrl && (
                <a
                  href={props.registerUrl}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                >
                  Creá tu cuenta
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="space-y-2 border-t border-linea p-3">
        {/* El estado acompaña todo el turno, al lado de donde se escribe. */}
        {props.aiPhase !== 'idle' && (
          <AiStatus
            phase={props.aiPhase}
            variant="inline"
            desde={props.turnoDesde}
            // T6: el control queda deshabilitado mientras corre el turno, así
            // que `props.speed` no puede haber cambiado desde que arrancó —
            // es la velocidad de ESTE turno, no la de un próximo pedido.
            aFondo={props.puedeElegirVelocidad && props.speed === 'deep'}
            onDetener={props.onDetener}
          />
        )}

        {props.assets.length > 0 && (
          <details className="text-xs text-ink-500">
            <summary className="cursor-pointer">
              {props.assets.length} archivo(s) disponibles para la IA
            </summary>
            <ul className="mt-1 space-y-0.5">
              {props.assets.map((asset) => (
                <li key={asset.id}>
                  {asset.filename}
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* Vista previa de lo que se va a mandar. Con las imágenes se ve la
            miniatura y no el nombre: un archivo pegado del portapapeles se llama
            "image.png" y ese nombre no le dice nada a nadie. */}
        {props.pendingAssets.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {props.pendingAssets.map((asset) =>
              asset.fileType === 'image' ? (
                <li key={asset.id} className="group/adjunto relative">
                  <img
                    src={asset.url}
                    alt={asset.filename}
                    className="h-16 w-16 rounded-lg border border-linea object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => props.onRemovePending(asset.id)}
                    aria-label={`Quitar ${asset.filename} de este mensaje`}
                    className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-carbon text-xs text-lienzo shadow-sm"
                  >
                    ✕
                  </button>
                </li>
              ) : (
                <li
                  key={asset.id}
                  className="flex items-center gap-1 rounded-full bg-brand-50 px-2 py-1 text-xs text-brand-700"
                >
                  {asset.filename}
                  <button
                    type="button"
                    onClick={() => props.onRemovePending(asset.id)}
                    className="text-brand-700/70 hover:text-brand-700"
                    aria-label={`Quitar ${asset.filename} de este mensaje`}
                  >
                    ✕
                  </button>
                </li>
              ),
            )}
          </ul>
        )}

        {/* Un pedido largo no se rechaza, pero conviene avisar: con mucho texto
            el modelo tarda bastante mas y el docente no tiene por que atar ese
            cabo solo cuando la respuesta no llega. */}
        {draft.length > 4_000 && (
          <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
            Pedido largo ({draft.length.toLocaleString('es-AR')} caracteres). Entra sin problema,
            pero la respuesta puede tardar varios minutos.
          </p>
        )}

        <textarea
          onPaste={onPaste}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          disabled={props.isStreaming}
          placeholder="Preguntale a Kodu…"
          className="kodu-input resize-none"
        />

        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf"
            onChange={onFiles}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={props.uploading || props.isStreaming}
            className="kodu-btn-ghost px-3 py-2 text-sm"
            title="Adjuntar imágenes o PDFs"
          >
            {props.uploading ? 'Subiendo…' : 'Adjuntar'}
          </button>

          {/* T6 ("Velocidad Rápido / A fondo"): discreto a propósito — sólo
              íconos (el `title` explica cada uno), sin la palabra "prime" ni
              ningún cartel. Ausente por completo sin el permiso: un docente
              sin prime ni "A fondo para todos" no ve nada acá. */}
          {props.puedeElegirVelocidad && (
            <div
              role="group"
              aria-label="Velocidad de la respuesta"
              className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-linea bg-superficie p-1"
            >
              <button
                type="button"
                aria-pressed={props.speed === 'fast'}
                disabled={props.isStreaming}
                onClick={() => props.onSpeedChange('fast')}
                title="Rápido: responde directo."
                className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${
                  props.speed === 'fast'
                    ? 'bg-brand-600 text-white'
                    : 'text-ink-500 hover:bg-sutil hover:text-ink-900'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M14 2 6 13h5l-1 9 8-11h-5Z" fill="currentColor" />
                </svg>
                <span className="sr-only">Rápido</span>
              </button>
              <button
                type="button"
                aria-pressed={props.speed === 'deep'}
                disabled={props.isStreaming}
                onClick={() => props.onSpeedChange('deep')}
                title="A fondo: piensa antes de escribir y revisa el resultado; tarda más."
                className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${
                  props.speed === 'deep'
                    ? 'bg-brand-600 text-white'
                    : 'text-ink-500 hover:bg-sutil hover:text-ink-900'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="9.5" cy="9.5" r="6.5" stroke="currentColor" strokeWidth="2" />
                  <path d="M14.5 14.5 20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <span className="sr-only">A fondo</span>
              </button>
            </div>
          )}

          {/* T9 ("Varias versiones al crear un recurso"): compacto, mismo
              criterio de discreción que la velocidad de arriba — sólo
              íconos, con un "×3" chico cuando está prendido, sin la palabra
              "prime". Ausente salvo con las dos condiciones juntas: el
              permiso Y el recurso todavía en blanco (crear, no editar). */}
          {props.puedePedirVersiones && props.esRecursoInicial && (
            <button
              type="button"
              aria-pressed={props.versiones}
              disabled={props.isStreaming}
              onClick={() => props.onVersionesChange(!props.versiones)}
              title="Varias versiones: arma tres propuestas distintas para que elijas una"
              className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-1.5 text-xs font-semibold transition-colors ${
                props.versiones
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-linea bg-superficie text-ink-500 hover:bg-sutil hover:text-ink-900'
              }`}
            >
              {/* Mismo trazo que `copy` de Lucide: dos rectángulos
                  superpuestos ("varias copias distintas"). */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M5 15V5a2 2 0 0 1 2-2h10"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {props.versiones && <span>×3</span>}
              <span className="sr-only">Varias versiones</span>
            </button>
          )}

          <button
            type="submit"
            disabled={props.isStreaming || draft.trim().length === 0}
            className="kodu-btn-primary flex-1"
          >
            {props.isStreaming ? 'Generando…' : 'Enviar'}
          </button>
        </div>
      </form>
    </section>
  );
}
