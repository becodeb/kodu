import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import type {
  ModelChoice,
  WorkspaceAsset,
  WorkspaceMessage,
  WorkspaceThread,
} from '../../lib/workspace-types.ts';

interface ChatPanelProps {
  messages: WorkspaceMessage[];
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
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

/** Panel izquierdo del editor: control, historial y composición (SPEC §5.1). */
export default function ChatPanel(props: ChatPanelProps) {
  const [draft, setDraft] = useState('');
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
    }
  }

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) props.onAttach(files);
    event.target.value = '';
  }

  return (
    <section className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-white">
      <header className="space-y-3 border-b border-slate-200 p-3">
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

        <fieldset className="flex items-center gap-3 text-xs">
          <legend className="sr-only">Modelo de IA</legend>
          <span className="font-medium text-ink-700">Modelo:</span>
          {(['FLASH', 'PRO'] as const).map((option) => (
            <label key={option} className="flex cursor-pointer items-center gap-1.5 text-ink-700">
              <input
                type="radio"
                name="model"
                value={option}
                checked={props.model === option}
                onChange={() => props.onModelChange(option)}
                className="accent-brand-600"
              />
              {option === 'FLASH' ? 'Flash (rápido)' : 'Pro (razonamiento)'}
            </label>
          ))}
        </fieldset>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {props.messages.length === 0 && !props.isStreaming && (
          <p className="rounded-xl bg-slate-50 p-4 text-sm text-ink-500">
            Contale a la IA qué recurso necesitás. Por ejemplo:{' '}
            <em>“Un quiz de 5 preguntas sobre fracciones equivalentes para 5.º grado, con
            retroalimentación después de cada respuesta”.</em>
          </p>
        )}

        {props.messages.map((message) => (
          <article
            key={message.id}
            className={
              message.role === 'user'
                ? 'ml-6 rounded-xl bg-brand-600 px-3 py-2 text-sm whitespace-pre-wrap text-white'
                : 'mr-6 rounded-xl bg-slate-100 px-3 py-2 text-sm whitespace-pre-wrap text-ink-900'
            }
          >
            {message.content}
            {message.attachments.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs opacity-80">
                {message.attachments.map((url) => (
                  <li key={url}>📎 {url.split('/').pop()}</li>
                ))}
              </ul>
            )}
          </article>
        ))}

        {props.isStreaming && (
          <article className="mr-6 rounded-xl bg-slate-100 px-3 py-2 text-sm whitespace-pre-wrap text-ink-900">
            {props.streamingText || <span className="text-ink-500">Pensando…</span>}
          </article>
        )}

        {props.error && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {props.error}
          </p>
        )}
      </div>

      <form onSubmit={submit} className="space-y-2 border-t border-slate-200 p-3">
        {props.assets.length > 0 && (
          <details className="text-xs text-ink-500">
            <summary className="cursor-pointer">
              {props.assets.length} archivo(s) disponibles para la IA
            </summary>
            <ul className="mt-1 space-y-0.5">
              {props.assets.map((asset) => (
                <li key={asset.id}>
                  {asset.fileType === 'pdf' ? '📄' : '🖼️'} {asset.filename}
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
                {asset.fileType === 'pdf' ? '📄' : '🖼️'} {asset.filename}
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

        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          disabled={props.isStreaming}
          placeholder="Escribí un cambio…  (Enter envía, Shift+Enter salta de línea)"
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
            {props.uploading ? 'Subiendo…' : '📎 Adjuntar'}
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
