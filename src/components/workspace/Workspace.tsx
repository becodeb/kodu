import { useCallback, useEffect, useRef, useState } from 'react';
import ChatPanel from './ChatPanel.tsx';
import PreviewPanel from './PreviewPanel.tsx';
import FichaDialog from './FichaDialog.tsx';
import { apiRequest, streamChat, uploadFiles } from '../../lib/client/api.ts';
import { htmlParcialDeArgumentos } from '../../lib/client/html-parcial.ts';
import type {
  AiPhase,
  CapacidadesEditor,
  MotorPublico,
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
  /** Motores habilitados y elegibles por un docente, ya en orden de catálogo. */
  motoresDisponibles: MotorPublico[];
  /**
   * Aviso quieto para mostrar una sola vez al abrir la página (por ahora,
   * sólo el repunteo de motor apagado — spec `ai-model-catalog`,
   * "Fallback when a project's model is disabled"). `null` cuando no hay
   * nada que avisar. Reusa el mismo `flashNotice` que "Guardado" o los
   * avisos del chat: no es un modal ni una alarma.
   */
  initialNotice: string | null;
  /**
   * T5 (odd/tasks/modo-prime.md): lo único que este docente puede hacer que
   * un docente común no puede — nunca la palabra "prime" ni ninguna bandera
   * de `AppSettings` (ver `workspace-types.ts`). Todavía sin consumir acá:
   * T6 ("Velocidad") y T9 ("Varias versiones") van a leer esto (o pasarlo a
   * `ChatPanel`) cuando construyan sus propios controles.
   */
  capacidades: CapacidadesEditor;
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
  // El recurso cambió después de la última portada (design §6). Semilla del
  // SSR; de acá en más sólo la mueve el contenido: la IA devolviendo código,
  // una edición manual, o una nueva captura.
  const [portadaVieja, setPortadaVieja] = useState(props.project.portadaVieja);
  const [model, setModel] = useState<string>(props.project.aiModelId);

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

  /**
   * HTML parcial del recurso mientras la IA todavía lo está escribiendo (T3,
   * "Progresivo"): se deriva de los `code_delta` acumulados con
   * `htmlParcialDeArgumentos`. `null` cuando no hay ningún turno escribiendo
   * código en este momento — PreviewPanel usa esto para decidir si mostrar el
   * iframe de doble búfer o el HTML ya confirmado.
   */
  const [partialHtml, setPartialHtml] = useState<string | null>(null);

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

  /** Para poder cortar el turno desde el botón "Detener". */
  const abortador = useRef<AbortController | null>(null);
  const resumeTimer = useRef<number | null>(null);

  /** Cuándo arrancó el turno en curso (epoch ms), para el cronómetro. */
  const [turnoDesde, setTurnoDesde] = useState<number | null>(null);

  /**
   * Qué panel se ve en pantallas chicas.
   *
   * Apilados no entran: en un celular el visor quedaba con 77 px de alto, o sea
   * el recurso no se veía. Abajo de `lg` se muestra uno u otro a pantalla
   * completa y se conmuta; de `lg` para arriba conviven como siempre.
   */
  const [vistaMovil, setVistaMovil] = useState<'chat' | 'recurso'>('chat');

  /**
   * Último pedido, para el botón de reintentar. La conexión con el motor de IA
   * se corta cada tanto por motivos ajenos al docente (proxy, red, límite del
   * proveedor); obligarlo a reescribir el mensaje era castigarlo por eso.
   */
  const [failedMessage, setFailedMessage] = useState<string | null>(null);

  /** Otro motor sugerido cuando el elegido falló. */
  const [fallback, setFallback] = useState<{ model: string; label: string } | null>(null);
  /** Llega cuando la demo agota su tope (M7): un link real, no sólo texto. */
  const [registerUrl, setRegisterUrl] = useState<string | null>(null);

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

  /**
   * El aviso de repunteo de motor (o cualquier otro aviso de "una sola vez al
   * abrir") lo calcula el servidor en el frontmatter de la página, porque ahí
   * es donde se sabe si `aiModelId` cambió. Acá sólo se dispara una vez al
   * montar — no en cada cambio de `props`, porque la página no vuelve a
   * evaluar el frontmatter sin una recarga completa.
   */
  useEffect(() => {
    if (props.initialNotice) flashNotice(props.initialNotice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // 450 intentos × 4 s = 30 minutos. Estaba en 6 y era MUY poco: un recurso
    // grande tarda 15 o 20 minutos, así que el editor se rendía y avisaba que
    // habia fallado justo cuando el turno estaba por terminar bien.
    const MAX_INTENTOS = 450;

    setAiPhase('thinking');
    setIsStreaming(true);
    // El turno arrancó cuando se guardó el mensaje del docente, no ahora: si no,
    // al recargar el cronómetro volvía a cero y mentía sobre la espera real.
    setTurnoDesde(ultimo.createdAt ?? Date.now());

    const timer = window.setInterval(() => {
      if (cancelado) return;

      if (++intentos > MAX_INTENTOS) {
        window.clearInterval(timer);
        resumeTimer.current = null;
        setIsStreaming(false);
        setAiPhase('idle');
        setTurnoDesde(null);
        // No se ofrece reenviar: el turno puede seguir corriendo en el servidor
        // y mandarlo de nuevo duplicaría el trabajo. Recargar es lo correcto.
        setError(
          'Después de 30 minutos todavía no llegó la respuesta. Si el recurso era muy grande puede seguir generándose: recargá la página en un rato para ver si llegó.',
        );
        return;
      }

      void apiRequest<{ messages: WorkspaceMessage[]; currentHtml: string }>(
        `/api/projects/${projectId}/threads?threadId=${encodeURIComponent(activeThreadId)}`,
      ).then((result) => {
        if (cancelado || !result.ok) return;

        const llegoRespuesta = result.data.messages.at(-1)?.role === 'assistant';
        if (!llegoRespuesta) return;

        window.clearInterval(timer);
        resumeTimer.current = null;
        setMessages(result.data.messages);
        setHtml(result.data.currentHtml);
        setIsStreaming(false);
        setAiPhase('idle');
        setTurnoDesde(null);
        flashNotice('Llegó la respuesta que había quedado en camino');
      });
    }, 4_000);
    resumeTimer.current = timer;

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
    setRegisterUrl(null);
    setTurnoDesde(Date.now());
    setIsStreaming(true);
    setAiPhase('thinking');
    setStreamingText('');

    // Sincroniza cualquier edición manual pendiente antes de que la IA lea el
    // HTML: el prompt se arma en el servidor con `project.currentHtml`.
    await flushSave();

    const attachmentUrls = pendingAssets.map((asset) => asset.url);

    // Id provisorio: todavía no existe la fila del lado del servidor. Se
    // reemplaza por el id real (T4) apenas llega "done" — sin eso, un
    // "Deshacer" posterior sobre ESTE turno nunca podría reconocer a este
    // mensaje puntual en pantalla (el id que compara `undoneMessageIds` no
    // sería el mismo que quedó acá).
    const localUserMessageId = `local-${Date.now()}`;

    // En un reintento el mensaje ya está en la lista: repetirlo haría creer que
    // se mandó dos veces.
    if (!isRetry) {
      setMessages((current) => [
        ...current,
        { id: localUserMessageId, role: 'user', content: message, attachments: attachmentUrls },
      ]);
    }
    setPendingAssets([]);

    let assistantText = '';
    // Buffer crudo de los `code_delta` del turno en curso (T3): se acumula
    // acá y se decodifica en cada tanda, igual que `assistantText` de abajo
    // con el texto — no hace falta guardarlo en un estado, sólo lo que ya se
    // pudo decodificar de él (`partialHtml`).
    let rawArgsBuffer = '';
    // T4 ("Deshacer cambios de la IA"): el HTML con el que arranca ESTE
    // turno, para saber en vivo (sin esperar a la próxima carga del hilo) si
    // terminó cambiando el recurso — mismo criterio que usa el servidor para
    // decidir si crea una instantánea. Sólo importa el ÚLTIMO "code" que
    // llegue: por eso se reasigna entero en vez de acumularse con `||`.
    const htmlAlInicioDelTurno = html;
    let cambioElHtml = false;

    try {
      abortador.current = new AbortController();

      for await (const event of streamChat(
        {
          projectId,
          threadId: activeThreadId,
          message,
          model,
          attachmentUrls: attachmentUrls.length > 0 ? attachmentUrls : undefined,
          codeEditedByTeacher: codeEditedByTeacher.current,
        },
        abortador.current.signal,
      )) {
        if (event.type === 'text') {
          assistantText += event.delta;
          setStreamingText(assistantText);
          setAiPhase('writing');
        } else if (event.type === 'notice') {
          // No es un error: el turno sigue vivo, sólo está esperando.
          flashNotice(event.message);
        } else if (event.type === 'code_start') {
          // Llega apenas arranca el tool call. Sin esto el chat seguía diciendo
          // "escribiéndote la respuesta" durante todo el rato en que en realidad
          // ya estaba armando el código.
          setAiPhase('coding');
        } else if (event.type === 'code_delta') {
          // T3: se va armando la vista previa mientras la IA todavía escribe.
          rawArgsBuffer += event.delta;
          setPartialHtml(htmlParcialDeArgumentos(rawArgsBuffer));
        } else if (event.type === 'code_reset') {
          // El parcial que se venía mostrando quedó obsoleto (reintento,
          // cambio de motor, re-pedido forzado): se tira y se espera uno nuevo.
          rawArgsBuffer = '';
          setPartialHtml(null);
        } else if (event.type === 'code') {
          // El código nunca entra al chat: va derecho al visor.
          setHtml(event.html);
          // T4: se recalcula en cada "code" del turno (reintento, salto de
          // motor); sólo el último importa, igual que `html` mismo.
          cambioElHtml = event.html !== htmlAlInicioDelTurno;
          setAiPhase('coding');
          // La versión de la IA pasa a ser la vigente: lo que el docente había
          // escrito a mano ya quedó incorporado en este HTML.
          codeEditedByTeacher.current = false;
          // La IA cambió el recurso: si ya había portada, quedó vieja (design §6).
          if (screenshotUrl) setPortadaVieja(true);
          // El HTML final reemplaza al parcial: PreviewPanel vuelve al iframe
          // de siempre (con el puente de captura incluido).
          rawArgsBuffer = '';
          setPartialHtml(null);
        } else if (event.type === 'error') {
          setError(event.message);
          setFailedMessage(message);
          if (event.fallbackModel && event.fallbackLabel) {
            setFallback({ model: event.fallbackModel, label: event.fallbackLabel });
          }
          if (event.registerUrl) setRegisterUrl(event.registerUrl);
        } else if (event.type === 'done') {
          setMessages((current) => [
            // T4: el mensaje del docente pasa a tener su id REAL — de acá en
            // más, un "Deshacer" que lo marque en `undoneMessageIds` lo va a
            // poder encontrar. En un reintento no hay ningún `local-...` que
            // reemplazar (esta llamada nunca agregó uno) y el `map` no toca
            // nada, así que es un no-op seguro en ese caso.
            ...current.map((existente) =>
              existente.id === localUserMessageId ? { ...existente, id: event.userMessageId } : existente,
            ),
            {
              id: event.messageId,
              role: 'assistant',
              content: event.content,
              attachments: [],
              // Si este turno cambió el recurso, el servidor le creó
              // instantánea (mismo criterio, ver stream.ts) — se puede
              // ofrecer para deshacer sin esperar a releer el hilo.
              canUndo: cambioElHtml,
            },
          ]);
          if (event.codeUpdated) flashNotice('Recurso actualizado');
        }
      }
    } catch (error) {
      // Un abort es el docente tocando "Detener": no es una falla que reportar.
      if ((error as Error)?.name !== 'AbortError') {
        setError('Se cortó la conexión con el servidor.');
        setFailedMessage(message);
      }
    } finally {
      abortador.current = null;
      setIsStreaming(false);
      setAiPhase('idle');
      setStreamingText('');
      setTurnoDesde(null);
      // Red de seguridad (T3): cubre `done` sin `code` previo, error y abort
      // — los otros dos casos (`code`, `code_reset`) ya lo limpiaron arriba,
      // así que esto es un no-op en esos casos.
      setPartialHtml(null);
    }
  }

  /**
   * Corta el turno en curso.
   *
   * Además de abortar el pedido, deja constancia en el hilo: si el último
   * mensaje sigue siendo el del docente, cada recarga vuelve a ponerse a
   * esperar la misma respuesta que ya no va a llegar, y no hay forma de salir.
   */
  async function handleStop() {
    abortador.current?.abort();
    abortador.current = null;

    if (resumeTimer.current) {
      window.clearInterval(resumeTimer.current);
      resumeTimer.current = null;
    }

    setIsStreaming(false);
    setAiPhase('idle');
    setStreamingText('');
    setTurnoDesde(null);

    const result = await apiRequest<{ messageId?: string; content?: string }>(
      '/api/chat/cancel',
      'POST',
      { projectId, threadId: activeThreadId },
    );

    if (result.ok && result.data.messageId && result.data.content) {
      setMessages((current) => [
        ...current,
        { id: result.data.messageId!, role: 'assistant', content: result.data.content!, attachments: [] },
      ]);
    }
  }

  /**
   * Deshace el turno de la IA que cerró `messageId` (T4). `ChatPanel` sólo
   * ofrece el botón en el más nuevo deshacible (`mensajeParaDeshacer`), así
   * que acá no hace falta volver a decidir cuál es.
   */
  async function handleUndo(messageId: string) {
    // Si el docente tocó el código a mano DESPUÉS de este turno, deshacer se
    // lo lleva puesto: se avisa antes de mandar el pedido, no después.
    if (
      codeEditedByTeacher.current &&
      !window.confirm('Vas a perder los cambios que hiciste a mano en el código después de este pedido.')
    ) {
      return;
    }

    const result = await apiRequest<{ currentHtml: string; undoneMessageIds: string[] }>(
      `/api/projects/${projectId}/undo`,
      'POST',
      { messageId },
    );

    if (!result.ok) {
      setError(result.error);
      return;
    }

    // Se aplica igual que el código que manda la IA (no como una edición a
    // mano vía `onHtmlChange`): si no, el PRÓXIMO turno vería
    // `codeEditedByTeacher: true` sin que el docente haya tocado nada.
    setHtml(result.data.currentHtml);
    codeEditedByTeacher.current = false;
    if (screenshotUrl) setPortadaVieja(true);

    const ahora = Date.now();
    setMessages((current) =>
      current.map((message) =>
        result.data.undoneMessageIds.includes(message.id)
          ? { ...message, undoneAt: ahora, canUndo: false }
          : message,
      ),
    );

    flashNotice('Deshecho');
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

  /**
   * Único escritor de la secuencia de captura (design §3.2, §3.3): guarda la
   * portada y, sólo cuando `opciones.publicar` lo pide, sigue con el PATCH
   * que publica. El switch de PreviewPanel nunca se mueve hasta que esto
   * termina — ver `publicando` allá.
   */
  async function handleScreenshot(dataUrl: string, opciones?: { publicar?: boolean }) {
    setSaving(true);
    const guardada = await apiRequest<{ screenshotUrl: string }>(
      `/api/projects/${projectId}/screenshot`,
      'POST',
      { dataUrl },
    );
    setSaving(false);

    if (!guardada.ok) {
      setError(guardada.error);
      return;
    }

    setScreenshotUrl(guardada.data.screenshotUrl);
    setPortadaVieja(false);

    if (!opciones?.publicar) {
      flashNotice('Portada guardada');
      return;
    }

    if (await patchProject({ isInGallery: true })) {
      setIsInGallery(true);
      flashNotice('Publicado en la galería');
    }
    // patchProject ya dejó el error en pantalla si falló; el switch queda
    // como estaba, nunca se mueve optimistamente.
  }

  /** Sólo despublica: un PATCH, un gesto, sin captura (design §3.2). */
  function handleDespublicar() {
    setIsInGallery(false);
    void patchProject({ isInGallery: false }).then((okResult) => {
      if (okResult) flashNotice('Quitado de la galería');
    });
  }

  async function handleDeleteScreenshot() {
    const result = await apiRequest<{ screenshotUrl: null; despublicado: boolean }>(
      `/api/projects/${projectId}/screenshot`,
      'DELETE',
    );
    if (result.ok) {
      setScreenshotUrl(null);
      if (result.data.despublicado) {
        setIsInGallery(false);
        flashNotice('Portada borrada. El recurso salió de la galería.');
      } else {
        flashNotice('Captura borrada');
      }
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[28rem] flex-col lg:h-[calc(100dvh-8.5rem)]">
      {/* Conmutador de pantallas chicas. */}
      <div className="mb-2 flex rounded-lg bg-sutil p-0.5 lg:hidden" role="tablist">
        {(
          [
            ['chat', 'Chat'],
            ['recurso', 'Recurso'],
          ] as const
        ).map(([valor, etiqueta]) => (
          <button
            key={valor}
            type="button"
            role="tab"
            aria-selected={vistaMovil === valor}
            onClick={() => setVistaMovil(valor)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              vistaMovil === valor ? 'bg-superficie text-ink-900 shadow-sm' : 'text-ink-500'
            }`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-2xl border border-linea bg-superficie shadow-sm lg:grid-cols-[minmax(18rem,24rem)_1fr]">
      <FichaDialog
        abierto={fichaAbierta}
        tituloInicial={props.project.title}
        onOmitir={() => setFichaAbierta(false)}
        onGuardar={(datos) => {
          setFichaAbierta(false);
          setTitle(datos.title);
          setDescription(datos.description);
          void patchProject({
            title: datos.title,
            description: datos.description || null,
          }).then((okResult) => {
            if (okResult) flashNotice('Ficha guardada');
          });
        }}
      />

      <div className={`min-h-0 ${vistaMovil === 'chat' ? 'flex' : 'hidden'} lg:flex`}>
      <ChatPanel
        messages={messages}
        streamingText={streamingText}
        isStreaming={isStreaming}
        aiPhase={aiPhase}
        turnoDesde={turnoDesde}
        onDetener={() => void handleStop()}
        error={error}
        canRetry={failedMessage !== null && !isStreaming}
        onRetry={() => {
          if (failedMessage) void handleSend(failedMessage, true);
        }}
        fallbackLabel={fallback && !isStreaming ? fallback.label : null}
        registerUrl={registerUrl && !isStreaming ? registerUrl : null}
        onUseFallback={() => {
          if (!fallback || !failedMessage) return;
          // Se cambia el modelo del proyecto Y se reintenta: si sólo se cambiara
          // el selector, el docente tendría que volver a mandar el mensaje.
          setModel(fallback.model);
          void patchProject({ aiModelId: fallback.model }, true);
          const pedido = failedMessage;
          setFallback(null);
          void handleSend(pedido, true);
        }}
        model={model}
        motoresDisponibles={props.motoresDisponibles}
        onModelChange={(value) => {
          setModel(value);
          void patchProject({ aiModelId: value }, true);
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
        onUndo={(messageId) => void handleUndo(messageId)}
      />
      </div>

      <div className={`min-h-0 ${vistaMovil === 'recurso' ? 'flex' : 'hidden'} lg:flex`}>

      <PreviewPanel
        html={html}
        partialHtml={partialHtml}
        onHtmlChange={(value) => {
          setHtml(value);
          // Sólo llega acá la edición manual: el HTML que manda la IA se aplica
          // con setHtml directo, sin pasar por este callback.
          codeEditedByTeacher.current = true;
          // El docente cambió el recurso a mano: si ya había portada, quedó
          // vieja (design §6).
          if (screenshotUrl) setPortadaVieja(true);
          scheduleSave({ currentHtml: value });
        }}
        publicUrl={publicUrl}
        title={title}
        description={description}
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
        onDespublicar={handleDespublicar}
        onAntesDePublicar={flushSave}
        screenshotUrl={screenshotUrl}
        onScreenshot={handleScreenshot}
        onDeleteScreenshot={() => void handleDeleteScreenshot()}
        portadaVieja={portadaVieja}
        saving={saving}
        notice={notice}
      />
      </div>
      </div>
    </div>
  );
}
