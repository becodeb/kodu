import { useCallback, useEffect, useRef, useState } from 'react';
import ChatPanel from './ChatPanel.tsx';
import PreviewPanel from './PreviewPanel.tsx';
import FichaDialog from './FichaDialog.tsx';
import { apiRequest, streamChat, uploadFiles } from '../../lib/client/api.ts';
import type {
  AiPhase,
  ModelChoice,
  WorkspaceAsset,
  WorkspaceMessage,
  WorkspaceProject,
  WorkspaceThread,
} from '../../lib/workspace-types.ts';

interface WorkspaceProps {
  project: WorkspaceProject;
  threads: WorkspaceThread[];
  activeThreadId: string;
  messages: WorkspaceMessage[];
  assets: WorkspaceAsset[];
  siteUrl: string;
  /** Nombre del docente, para previsualizar la tarjeta de la galería. */
  authorName: string;
}

/**
 * Editor completo (SPEC §5.1): chat a la izquierda, visor/código a la derecha.
 *
 * Toda la escritura pasa por la API con guardado optimista: la UI refleja el
 * cambio al instante y el PATCH viaja con debounce para no pegarle a la base en
 * cada tecla.
 */
export default function Workspace(props: WorkspaceProps) {
  const projectId = props.project.id;

  const [html, setHtml] = useState(props.project.currentHtml);
  const [title, setTitle] = useState(props.project.title);
  const [description, setDescription] = useState(props.project.description ?? '');
  const [isInGallery, setIsInGallery] = useState(props.project.isInGallery);
  const [screenshotUrl, setScreenshotUrl] = useState(props.project.screenshotUrl);
  const [model, setModel] = useState<ModelChoice>(props.project.selectedModel);

  const [threads, setThreads] = useState(props.threads);
  const [activeThreadId, setActiveThreadId] = useState(props.activeThreadId);
  const [messages, setMessages] = useState(props.messages);

  const [assets, setAssets] = useState(props.assets);
  const [pendingAssets, setPendingAssets] = useState<WorkspaceAsset[]>([]);
  const [uploading, setUploading] = useState(false);

  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [aiPhase, setAiPhase] = useState<AiPhase>('idle');
  const [error, setError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const saveTimer = useRef<number | null>(null);
  const pendingSave = useRef<Record<string, unknown> | null>(null);
  const publicUrl = `${props.siteUrl.replace(/\/+$/, '')}/p/${props.project.slug}`;

  /**
   * Marca que el docente escribió o pegó código a mano en la pestaña "Código".
   * Viaja en el próximo pedido para que el prompt le avise a la IA que ESA
   * versión manda sobre la que ella generó; se limpia cuando la IA devuelve
   * código nuevo, que a partir de ahí pasa a ser la versión vigente.
   */
  const codeEditedByTeacher = useRef(false);

  /**
   * Último pedido, para el botón de reintentar. La conexión con el motor de IA
   * se corta cada tanto por motivos ajenos al docente (proxy, red, límite del
   * proveedor); obligarlo a reescribir el mensaje era castigarlo por eso.
   */
  const [failedMessage, setFailedMessage] = useState<string | null>(null);

  /** Otro proveedor sugerido cuando el elegido falló. */
  const [fallback, setFallback] = useState<{ model: ModelChoice; label: string } | null>(null);

  /**
   * La ficha se pide al abrir un recurso recién creado: título y descripción
   * son lo que lo hace encontrable, y pedírselos al final —cuando el docente ya
   * consiguió lo que quería— es asegurarse de que queden vacíos.
   */
  const [fichaAbierta, setFichaAbierta] = useState(
    props.messages.length === 0 && props.project.title === 'Nuevo Recurso',
  );

  const flashNotice = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 2_500);
  }, []);

  const patchProject = useCallback(
    async (data: Record<string, unknown>, quiet = false) => {
      if (!quiet) setSaving(true);
      const result = await apiRequest(`/api/projects/${projectId}`, 'PATCH', data);
      if (!quiet) setSaving(false);

      if (!result.ok) {
        setError(result.error);
        return false;
      }
      return true;
    },
    [projectId],
  );

  /**
   * Agrupa las ediciones seguidas (tipear en el código o el título) en un PATCH.
   *
   * Los cambios se ACUMULAN en `pendingSave`: si no, editar el título y la
   * descripción con menos de 700 ms de diferencia haría que el segundo pisara al
   * primero y se perdiera un campo.
   */
  const scheduleSave = useCallback(
    (data: Record<string, unknown>) => {
      pendingSave.current = { ...(pendingSave.current ?? {}), ...data };

      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        const payload = pendingSave.current;
        pendingSave.current = null;
        saveTimer.current = null;
        if (!payload) return;

        void patchProject(payload).then((okResult) => {
          if (okResult) flashNotice('Guardado');
        });
      }, 700);
    },
    [patchProject, flashNotice],
  );

  /**
   * Fuerza el guardado pendiente antes de hablar con la IA: el prompt se arma en
   * el servidor con `project.currentHtml`, así que una edición manual sin
   * sincronizar haría que la IA trabaje sobre código viejo.
   */
  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    const payload = pendingSave.current;
    pendingSave.current = null;
    if (payload) await patchProject(payload, true);
  }, [patchProject]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  /**
   * Si el docente cierra la pestaña o navega dentro de la ventana del debounce,
   * el cambio se perdía. `keepalive` deja que el request sobreviva a la
   * navegación (tope de 64 KB de body, alcanza de sobra para título y
   * descripción; el código, si es grande, ya se guardó en el ciclo normal).
   */
  useEffect(() => {
    function flushOnExit() {
      const payload = pendingSave.current;
      if (!payload) return;

      pendingSave.current = null;
      void fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    }

    window.addEventListener('pagehide', flushOnExit);
    return () => window.removeEventListener('pagehide', flushOnExit);
  }, [projectId]);

  /**
   * Retoma un turno que quedó corriendo en el servidor.
   *
   * El turno NO se cancela al recargar: el servidor lo termina y guarda igual
   * (ver el `finally` de /api/chat/stream). Lo que se perdía era el aviso, y el
   * docente quedaba mirando una pantalla que parecía muerta sin saber que en dos
   * minutos iba a estar la respuesta. Acá se detecta que el último mensaje del
   * hilo es suyo y se espera la respuesta, consultando cada tanto.
   */
  useEffect(() => {
    const ultimo = props.messages[props.messages.length - 1];
    if (!ultimo || ultimo.role !== 'user') return;

    let cancelado = false;
    let intentos = 0;
    // 90 intentos × 4 s ≈ 6 minutos: más que el turno más lento que vimos.
    const MAX_INTENTOS = 90;

    setAiPhase('thinking');
    setIsStreaming(true);

    const timer = window.setInterval(() => {
      if (cancelado) return;

      if (++intentos > MAX_INTENTOS) {
        window.clearInterval(timer);
        setIsStreaming(false);
        setAiPhase('idle');
        setError('El turno anterior tardó demasiado. Podés volver a mandarlo.');
        setFailedMessage(ultimo.content);
        return;
      }

      void apiRequest<{ messages: WorkspaceMessage[]; currentHtml: string }>(
        `/api/projects/${projectId}/threads?threadId=${encodeURIComponent(activeThreadId)}`,
      ).then((result) => {
        if (cancelado || !result.ok) return;

        const llegoRespuesta = result.data.messages.at(-1)?.role === 'assistant';
        if (!llegoRespuesta) return;

        window.clearInterval(timer);
        setMessages(result.data.messages);
        setHtml(result.data.currentHtml);
        setIsStreaming(false);
        setAiPhase('idle');
        flashNotice('Llegó la respuesta que había quedado en camino');
      });
    }, 4_000);

    return () => {
      cancelado = true;
      window.clearInterval(timer);
    };
    // Sólo al montar: es la reanudación después de recargar la página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSend(message: string, isRetry = false) {
    setError(null);
    setFailedMessage(null);
    setFallback(null);
    setIsStreaming(true);
    setAiPhase('thinking');
    setStreamingText('');

    // Sincroniza cualquier edición manual pendiente antes de que la IA lea el
    // HTML: el prompt se arma en el servidor con `project.currentHtml`.
    await flushSave();

    const attachmentUrls = pendingAssets.map((asset) => asset.url);

    // En un reintento el mensaje ya está en la lista: repetirlo haría creer que
    // se mandó dos veces.
    if (!isRetry) {
      setMessages((current) => [
        ...current,
        { id: `local-${Date.now()}`, role: 'user', content: message, attachments: attachmentUrls },
      ]);
    }
    setPendingAssets([]);

    let assistantText = '';

    try {
      for await (const event of streamChat({
        projectId,
        threadId: activeThreadId,
        message,
        model,
        attachmentUrls: attachmentUrls.length > 0 ? attachmentUrls : undefined,
        codeEditedByTeacher: codeEditedByTeacher.current,
      })) {
        if (event.type === 'text') {
          assistantText += event.delta;
          setStreamingText(assistantText);
          setAiPhase('writing');
        } else if (event.type === 'code_start') {
          // Llega apenas arranca el tool call. Sin esto el chat seguía diciendo
          // "escribiéndote la respuesta" durante todo el rato en que en realidad
          // ya estaba armando el código.
          setAiPhase('coding');
        } else if (event.type === 'code') {
          // El código nunca entra al chat: va derecho al visor.
          setHtml(event.html);
          setAiPhase('coding');
          // La versión de la IA pasa a ser la vigente: lo que el docente había
          // escrito a mano ya quedó incorporado en este HTML.
          codeEditedByTeacher.current = false;
        } else if (event.type === 'error') {
          setError(event.message);
          setFailedMessage(message);
          if (event.fallbackModel && event.fallbackLabel) {
            setFallback({ model: event.fallbackModel, label: event.fallbackLabel });
          }
        } else if (event.type === 'done') {
          setMessages((current) => [
            ...current,
            { id: event.messageId, role: 'assistant', content: event.content, attachments: [] },
          ]);
          if (event.codeUpdated) flashNotice('Recurso actualizado');
        }
      }
    } catch {
      setError('Se cortó la conexión con el servidor.');
      setFailedMessage(message);
    } finally {
      setIsStreaming(false);
      setAiPhase('idle');
      setStreamingText('');
    }
  }

  async function handleNewThread() {
    const result = await apiRequest<{ thread: WorkspaceThread }>(
      `/api/projects/${projectId}/threads`,
      'POST',
      {},
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setThreads((current) => [...current, result.data.thread]);
    setActiveThreadId(result.data.thread.id);
    setMessages([]);
  }

  async function handleThreadChange(threadId: string) {
    setActiveThreadId(threadId);
    setMessages([]);

    const result = await apiRequest<{ messages: WorkspaceMessage[] }>(
      `/api/projects/${projectId}/threads?threadId=${encodeURIComponent(threadId)}`,
    );
    if (result.ok) setMessages(result.data.messages);
    else setError(result.error);
  }

  async function handleAttach(files: File[]) {
    setUploading(true);
    setAiPhase('uploading');
    const result = await uploadFiles(projectId, files);
    setUploading(false);
    setAiPhase('idle');

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setAssets((current) => [...current, ...result.data.assets]);
    setPendingAssets((current) => [...current, ...result.data.assets]);
  }

  async function handleScreenshot(dataUrl: string) {
    setSaving(true);
    const result = await apiRequest<{ screenshotUrl: string }>(
      `/api/projects/${projectId}/screenshot`,
      'POST',
      { dataUrl },
    );
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setScreenshotUrl(result.data.screenshotUrl);
    flashNotice('Captura guardada');
  }

  async function handleDeleteScreenshot() {
    const result = await apiRequest(`/api/projects/${projectId}/screenshot`, 'DELETE');
    if (result.ok) {
      setScreenshotUrl(null);
      flashNotice('Captura borrada');
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="grid h-[calc(100vh-8.5rem)] min-h-[32rem] grid-cols-1 overflow-hidden rounded-2xl border border-linea bg-superficie shadow-sm lg:grid-cols-[minmax(20rem,26rem)_1fr]">
      <FichaDialog
        abierto={fichaAbierta}
        tituloInicial={props.project.title}
        onOmitir={() => setFichaAbierta(false)}
        onGuardar={(datos) => {
          setFichaAbierta(false);
          setTitle(datos.title);
          setDescription(datos.description);
          setIsInGallery(datos.isInGallery);
          void patchProject({
            title: datos.title,
            description: datos.description || null,
            isInGallery: datos.isInGallery,
          }).then((okResult) => {
            if (okResult) flashNotice('Ficha guardada');
          });
        }}
      />

      <ChatPanel
        messages={messages}
        streamingText={streamingText}
        isStreaming={isStreaming}
        aiPhase={aiPhase}
        error={error}
        canRetry={failedMessage !== null && !isStreaming}
        onRetry={() => {
          if (failedMessage) void handleSend(failedMessage, true);
        }}
        fallbackLabel={fallback && !isStreaming ? fallback.label : null}
        onUseFallback={() => {
          if (!fallback || !failedMessage) return;
          // Se cambia el modelo del proyecto Y se reintenta: si sólo se cambiara
          // el selector, el docente tendría que volver a mandar el mensaje.
          setModel(fallback.model);
          void patchProject({ selectedModel: fallback.model }, true);
          const pedido = failedMessage;
          setFallback(null);
          void handleSend(pedido, true);
        }}
        model={model}
        onModelChange={(value) => {
          setModel(value);
          void patchProject({ selectedModel: value }, true);
        }}
        threads={threads}
        activeThreadId={activeThreadId}
        onThreadChange={(id) => void handleThreadChange(id)}
        onNewThread={() => void handleNewThread()}
        assets={assets}
        pendingAssets={pendingAssets}
        uploading={uploading}
        onAttach={(files) => void handleAttach(files)}
        onRemovePending={(assetId) =>
          setPendingAssets((current) => current.filter((asset) => asset.id !== assetId))
        }
        onSend={(message) => void handleSend(message)}
      />

      <PreviewPanel
        html={html}
        onHtmlChange={(value) => {
          setHtml(value);
          // Sólo llega acá la edición manual: el HTML que manda la IA se aplica
          // con setHtml directo, sin pasar por este callback.
          codeEditedByTeacher.current = true;
          scheduleSave({ currentHtml: value });
        }}
        publicUrl={publicUrl}
        title={title}
        description={description}
        authorName={props.authorName}
        onMetaChange={(meta) => {
          if (meta.title !== undefined) {
            setTitle(meta.title);
            // El PATCH rechaza el título vacío: si lo mandáramos, borrar para
            // reescribir tiraría un error que el docente no provocó.
            if (meta.title.trim()) scheduleSave({ title: meta.title });
          }
          if (meta.description !== undefined) {
            setDescription(meta.description);
            scheduleSave({ description: meta.description });
          }
        }}
        isInGallery={isInGallery}
        onTogglePublish={(value) => {
          setIsInGallery(value);
          void patchProject({ isInGallery: value }).then((okResult) => {
            if (okResult) flashNotice(value ? 'Publicado en la galería' : 'Quitado de la galería');
          });
        }}
        screenshotUrl={screenshotUrl}
        onScreenshot={handleScreenshot}
        onDeleteScreenshot={() => void handleDeleteScreenshot()}
        saving={saving}
        notice={notice}
      />
    </div>
  );
}
