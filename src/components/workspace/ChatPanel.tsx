import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import AiStatus from './AiStatus.tsx';
import StreamedText from './StreamedText.tsx';
import StarterDialog from './StarterDialog.tsx';
import { STARTERS, type Starter } from './starters.ts';
import { MODELOS } from '../../lib/workspace-types.ts';
import type {
  AiPhase,
  ModelChoice,
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
  model: ModelChoice;
  onModelChange: (model: ModelChoice) => void;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  return (
    <section className="flex h-full min-h-0 w-full flex-col border-linea bg-superficie lg:border-r">
      <StarterDialog
        starter={starterAbierto}
        onCerrar={() => setStarterAbierto(null)}
        onListo={(prompt) => {
          setStarterAbierto(null);
          setDraft(prompt);
        }}
      />
      <header className="space-y-3 border-b border-linea p-3">
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

        {/* Toggle de proveedor. El aviso del cupo va a la vista y no escondido
            en un tooltip: elegir el modelo pago sin saber que se gasta plata es
            justo la clase de sorpresa que no queremos darle a nadie. */}
        <fieldset className="space-y-1.5">
          <legend className="sr-only">Modelo de IA</legend>

          <div className="flex rounded-lg bg-sutil p-0.5">
            {MODELOS.map((opcion) => (
              <button
                key={opcion.value}
                type="button"
                aria-pressed={props.model === opcion.value}
                onClick={() => props.onModelChange(opcion.value)}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  props.model === opcion.value
                    ? 'bg-superficie text-ink-900 shadow-sm'
                    : 'text-ink-500 hover:text-ink-700'
                }`}
              >
                {opcion.nombre}
              </button>
            ))}
          </div>

          <p className="text-[0.7rem] leading-snug text-ink-500">
            {MODELOS.find((opcion) => opcion.value === props.model)?.detalle}
          </p>
        </fieldset>
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

        {props.messages.map((message) => (
          <article
            key={message.id}
            className={
              message.role === 'user'
                ? 'ml-6 rounded-xl bg-brand-600 px-3 py-2 text-sm whitespace-pre-wrap text-white'
                : 'mr-6 rounded-xl bg-sutil px-3 py-2 text-sm whitespace-pre-wrap text-ink-900'
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
        ))}

        {/* La burbuja aparece recién cuando hay algo que leer. Mientras tanto el
            estado vive abajo, sobre el blanco, y no como una caja gris vacía. */}
        {props.isStreaming && props.streamingText.length > 0 && (
          <article className="mr-6 rounded-xl bg-sutil px-3 py-2 text-sm whitespace-pre-wrap text-ink-900">
            <StreamedText text={props.streamingText} render={renderRich} />
          </article>
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

        {props.pendingAssets.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {props.pendingAssets.map((asset) => (
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
            ))}
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
