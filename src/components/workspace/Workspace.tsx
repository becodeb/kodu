import { useCallback, useEffect, useRef, useState } from 'react';
import ChatPanel from './ChatPanel.tsx';
import PreviewPanel, { type PreviewPanelHandle } from './PreviewPanel.tsx';
import FichaDialog from './FichaDialog.tsx';
import { apiRequest, streamAutocorreccion, streamChat, streamVisualReview, uploadFiles } from '../../lib/client/api.ts';
import { htmlParcialDeArgumentos } from '../../lib/client/html-parcial.ts';
import { ejecutarAutopruebaEnIframe, type ResultadoAutopruebaCliente } from '../../lib/client/autoprueba.ts';
import { guardarVelocidad, leerVelocidadGuardada } from '../../lib/client/velocidad.ts';
import { guardarVersiones, leerVersionesGuardado } from '../../lib/client/versiones.ts';
import { fingerprintHtml } from '../../lib/ai/revision-visual.ts';
import { necesitaCorreccion } from '../../lib/ai/autoprueba.ts';
import { esRecursoInicial } from '../../lib/ai/versiones.ts';
import type {
  AiPhase,
  CapacidadesEditor,
  MotorPublico,
  Speed,
  VersionEnCurso,
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
   * de `AppSettings` (ver `workspace-types.ts`). T6 ("Velocidad") ya lo
   * consume (`puedeElegirVelocidad`, `velocidadPorDefecto`); T9 ("Varias
   * versiones") va a leer `puedePedirVersiones` de acá cuando construya su
   * propio control.
   */
  capacidades: CapacidadesEditor;
}

/**
 * T9 ("Varias versiones al crear un recurso"): agrega/actualiza UN índice
 * dentro de la lista de progreso, sin mutar la anterior (React necesita una
 * referencia nueva para volver a renderizar) — pura, así que se puede probar
 * sin montar el componente. Ordenada por índice: como los tres "variant" de
 * anuncio (`ready: false`) pueden llegar en cualquier orden relativo a los
 * "listo" (`ready: true`) de otro índice, ordenar acá es lo que garantiza
 * que la fila de chips siempre se vea "1 · 2 · 3" y no según el orden de
 * llegada.
 */
function actualizarVersionEnCurso(
  actual: VersionEnCurso[] | null,
  index: 1 | 2 | 3,
  ready: boolean,
): VersionEnCurso[] {
  const lista = actual ? [...actual] : [];
  const indice = lista.findIndex((version) => version.index === index);
  if (indice >= 0) lista[indice] = { index, ready };
  else lista.push({ index, ready });
  return lista.sort((a, b) => a.index - b.index);
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

  /**
   * T6 ("Velocidad Rápido / A fondo"): arranca en el default de ESTA cuenta
   * (`velocidadPorDefecto`, nunca la palabra "prime") — el mismo valor en el
   * render del servidor y en la primera pasada del cliente, para no pelearse
   * con la hidratación. La preferencia guardada en este navegador (si la
   * hay) se aplica recién después, en el `useEffect` de abajo, que sólo
   * corre en el cliente.
   */
  const [speed, setSpeed] = useState<Speed>(props.capacidades.velocidadPorDefecto === 'a_fondo' ? 'deep' : 'fast');

  useEffect(() => {
    const guardada = leerVelocidadGuardada();
    if (guardada) setSpeed(guardada);
    // Sólo al montar: es la misma lectura de "preferencia de este navegador"
    // que hace `conTema` con el tema, una sola vez al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSpeedChange(nuevaVelocidad: Speed) {
    setSpeed(nuevaVelocidad);
    guardarVelocidad(nuevaVelocidad);
  }

  /**
   * T9 ("Varias versiones al crear un recurso"): apagado por default —a
   * diferencia de la velocidad, acá no hay un default que dependa de la
   * cuenta— y persistido por navegador (`client/versiones.ts`, mismo patrón
   * que T6). El interruptor sólo se OFRECE cuando además el recurso sigue
   * siendo el de arranque (`esRecursoInicial(html)`, recalculado en cada
   * render): server-side, `stream.ts` vuelve a cruzar las tres condiciones
   * igual, así que este estado nunca alcanza por sí solo para forzar nada.
   */
  const [versiones, setVersiones] = useState(false);

  useEffect(() => {
    if (leerVersionesGuardado()) setVersiones(true);
    // Sólo al montar, mismo criterio que la velocidad de arriba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleVersionesChange(activo: boolean) {
    setVersiones(activo);
    guardarVersiones(activo);
  }

  /**
   * T9: estado progresivo de un turno de versiones EN CURSO — `null` cuando
   * no hay ninguno. Se llena con los eventos `variant` del SSE (anuncio
   * `ready:false` apenas arranca, `ready:true` cuando cada una termina) y se
   * pliega en el mensaje final una vez que llega "done" — ver `handleSend`.
   */
  const [versionesEnCurso, setVersionesEnCurso] = useState<VersionEnCurso[] | null>(null);

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

  /**
   * T12 (round 3, "Autoprueba + autocorrección"): la autoprueba siguió
   * fallando después de las 2 rondas de corrección permitidas (o el
   * endpoint de corrección falló). Aviso discreto y NO bloqueante en el
   * panel de vista previa — se limpia solo apenas el HTML vuelve a cambiar
   * por cualquier vía (nuevo turno, deshacer, edición manual, cambio de
   * versión): ver los `setAutopruebaAdvertencia(false)` repartidos abajo.
   */
  const [autopruebaAdvertencia, setAutopruebaAdvertencia] = useState(false);

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

  /** T8 ("Revisión visual con captura"): para pedirle una captura a
   *  PreviewPanel desde `ejecutarRevisionVisual`, sin que ese componente
   *  tenga que saber nada de turnos ni de streaming. */
  const previewRef = useRef<PreviewPanelHandle>(null);

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
        setAutopruebaAdvertencia(false);
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
    // T12: un turno nuevo empieza de cero — el aviso de la autoprueba, si
    // había quedado uno del turno anterior, ya no aplica al recurso que
    // está por escribirse.
    setAutopruebaAdvertencia(false);
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
    // T8 ("Revisión visual con captura"): el HTML con el que terminó este
    // turno (el de "código" más reciente) y si el servidor ofreció mirarlo.
    // Se leen recién DESPUÉS del `for await`, nunca adentro: la revisión
    // visual arranca sólo una vez que el turno normal terminó del todo.
    let ultimoHtmlDelTurno: string | null = null;
    let ofreceRevisionVisual = false;

    /**
     * T9 ("Varias versiones al crear un recurso"): lo que este turno le pide
     * al servidor — capacidad Y el interruptor prendido Y el recurso
     * todavía en blanco. El servidor vuelve a cruzar las tres cosas con SUS
     * propios datos (`variantesEfectivas`, `stream.ts`): esto sólo decide si
     * vale la pena mandar `variants: 3`, nunca fuerza nada.
     */
    const pedirVersiones = props.capacidades.puedePedirVersiones && versiones && esRecursoInicial(html);
    // Progreso de las versiones de ESTE turno, si el servidor confirma que
    // corresponde (primer evento "variant") — plano y no sólo estado de
    // React por el mismo motivo que `cambioElHtml`/`ultimoHtmlDelTurno` de
    // arriba: hace falta leerlo de forma síncrona después del `for await`,
    // en el manejo de "done".
    let versionesDelTurno: VersionEnCurso[] | null = null;

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
          // T6: el servidor la ignora sin `puedeElegirVelocidad`, así que
          // siempre es seguro mandar la actual.
          speed,
          // T9: mismo criterio — el servidor la ignora sin las otras dos
          // condiciones, así que también es siempre seguro mandarla.
          variants: pedirVersiones ? 3 : undefined,
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
        } else if (event.type === 'phase') {
          // T7: por ahora sólo 'revisando'. La vista previa NO se toca acá
          // (sigue mostrando el último "code" recibido): esta pasada nunca
          // manda code_delta, sólo un "code" al final si corrige algo.
          setAiPhase(event.phase);
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
          // T8: mismo criterio, para tener a mano el HTML final del turno
          // sin depender del estado `html` (que además todavía no se pudo
          // haber vuelto a renderizar en este punto del loop).
          ultimoHtmlDelTurno = event.html;
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
        } else if (event.type === 'variant') {
          // T9 ("Varias versiones"): `ready: false` es el anuncio de que
          // este índice va a existir (las tres llegan juntas, apenas el
          // servidor confirma el turno de versiones); `ready: true` es que
          // ya terminó. Nunca se infiere esto del lado del cliente —server
          // confirmado, igual que `revisionVisualDisponible` en T8.
          versionesDelTurno = actualizarVersionEnCurso(versionesDelTurno, event.index, event.ready);
          setVersionesEnCurso(versionesDelTurno);
        } else if (event.type === 'error') {
          setError(event.message);
          setFailedMessage(message);
          if (event.fallbackModel && event.fallbackLabel) {
            setFallback({ model: event.fallbackModel, label: event.fallbackLabel });
          }
          if (event.registerUrl) setRegisterUrl(event.registerUrl);
        } else if (event.type === 'done') {
          // T9: las versiones que de verdad llegaron a existir — cualquier
          // índice que se haya quedado en `ready: false` (nunca llegó su
          // "variant" de `ready: true`) se descarta acá, nunca se ofrece un
          // chip para una versión que falló.
          const variantesListas = versionesDelTurno
            ?.filter((v) => v.ready)
            .map((v) => ({ index: v.index }));

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
              // T9: ausente (no `[]`) cuando este turno no ofreció ninguna
              // versión lista — mismo criterio que expone threads.ts tras
              // recargar, para que ChatPanel trate los dos casos igual.
              ...(variantesListas && variantesListas.length > 0
                ? { variants: variantesListas, chosenVariant: 1 }
                : {}),
            },
          ]);
          if (event.codeUpdated) flashNotice('Recurso actualizado');
          // T8: guardado para leer DESPUÉS del loop (ver más abajo) — nunca
          // se arranca la revisión visual desde acá adentro, el turno
          // normal tiene que terminar de escribir su mensaje primero.
          ofreceRevisionVisual = Boolean(event.revisionVisualDisponible);
        }
      }

      // T8 ("Revisión visual con captura"): el turno normal ya terminó
      // (mensaje guardado, "done" procesado) y el servidor dijo que
      // correspondía mirarlo. Sigue siendo EL MISMO turno para el docente:
      // `isStreaming`/`turnoDesde` no se tocan acá (siguen como están hasta
      // el `finally` de abajo), así que el compositor sigue deshabilitado,
      // "Detener" sigue andando y el cronómetro no se reinicia.
      let htmlParaAutoprueba = ultimoHtmlDelTurno;
      if (ofreceRevisionVisual && ultimoHtmlDelTurno) {
        htmlParaAutoprueba = await ejecutarRevisionVisual(ultimoHtmlDelTurno);
      }

      // T12 (round 3, "Autoprueba + autocorrección"): el ÚLTIMO chequeo
      // antes de soltarle el recurso al docente, después de la revisión
      // visual si corrió (es el gate final sobre lo que el docente ve de
      // verdad). Se salta en un turno de versiones (T9): la autoprueba
      // corre sobre UN HTML — con 3 versiones en paralelo no hay "el"
      // recurso vigente todavía hasta que el docente elige una, y
      // probarlas las 3 triplicaría costo y tiempo, mismo criterio que ya
      // usa T8 para excluir versiones de la revisión visual.
      if (cambioElHtml && !pedirVersiones && htmlParaAutoprueba) {
        await ejecutarAutopruebaYCorreccion(htmlParaAutoprueba);
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
      // T9: el progreso EN CURSO siempre se limpia acá — si el turno terminó
      // bien, ya quedó plegado en el mensaje nuevo (arriba, en "done"); si se
      // cortó por error o "Detener", no hay nada que ofrecer y no debe
      // quedar una fila pendiente colgada para el próximo turno.
      setVersionesEnCurso(null);
    }
  }

  /**
   * T8 ("Revisión visual con captura"): el paso final y opcional de un
   * turno "A fondo" que cambió el recurso con un motor que ve imágenes —
   * `handleSend` la llama después de procesar el "done" del turno normal,
   * sólo cuando ese "done" trajo `revisionVisualDisponible: true`.
   *
   * Discreta: nunca toca el chat (ni mensaje nuevo, ni error visible). Si
   * algo no sale bien — la captura falla, el servidor rechaza el pedido, el
   * docente aprieta "Detener" — se loguea y se sale en silencio, dejando el
   * HTML que ya había dejado el turno. `isStreaming`/`turnoDesde` los
   * maneja `handleSend` (no se tocan acá): para el docente sigue siendo el
   * mismo turno, con el mismo cronómetro.
   *
   * Devuelve el HTML con el que terminó (el corregido, o `htmlCapturado` tal
   * cual si no cambió nada): T12 la encadena para correr la autoprueba
   * sobre lo que el docente TERMINÓ viendo, no sobre lo que había antes de
   * la revisión visual.
   */
  async function ejecutarRevisionVisual(htmlCapturado: string): Promise<string> {
    setAiPhase('mirando');
    let htmlFinal = htmlCapturado;

    const capturado = await previewRef.current?.capturar({ formato: 'jpeg', calidad: 0.85, altoMax: 1_600 });
    if (!capturado || 'error' in capturado) {
      if (capturado) console.warn('[revisión visual] no se pudo capturar la vista previa:', capturado.error);
      return htmlFinal;
    }

    abortador.current = new AbortController();
    try {
      for await (const event of streamVisualReview(
        { projectId, dataUrl: capturado.dataUrl, fingerprint: fingerprintHtml(htmlCapturado) },
        abortador.current.signal,
      )) {
        if (event.type === 'code') {
          // Mismo tratamiento que un "code" del turno normal: la vista
          // previa cambia, la portada vieja queda marcada, y lo que el
          // docente hubiera escrito a mano ya quedó incorporado.
          setHtml(event.html);
          htmlFinal = event.html;
          codeEditedByTeacher.current = false;
          if (screenshotUrl) setPortadaVieja(true);
          flashNotice('Recurso actualizado');
        } else if (event.type === 'error') {
          // Nunca visible: el turno que trajo esta oferta ya había
          // terminado bien (ver el comentario grande de más arriba).
          console.warn('[revisión visual]', event.message);
        }
        // "done" no necesita hacer nada especial: sólo marca que terminó.
      }
    } catch (error) {
      // Un abort es el docente tocando "Detener" durante esta fase: se deja
      // el HTML del turno tal cual, sin ningún aviso.
      if ((error as Error)?.name !== 'AbortError') {
        console.warn('[revisión visual] se cortó la conexión:', error);
      }
    } finally {
      abortador.current = null;
    }

    return htmlFinal;
  }

  /**
   * T12 (round 3, "Autoprueba + autocorrección"): el último paso, opcional,
   * de un turno que cambió el recurso — `handleSend` la llama después de la
   * revisión visual de T8 (si corrió), sobre el HTML final de esa cadena.
   * Corre la autoprueba de T11 en un iframe oculto; si encuentra errores
   * reales o un reinicio roto, pide hasta 2 rondas de corrección puntual
   * (razonamiento "low", server-side) y vuelve a probar cada una.
   *
   * Discreta, mismo criterio que T8: nunca toca el chat. Si la autoprueba
   * no se pudo correr (timeout, "Detener") no hay NADA que avisar — no es
   * que el recurso esté mal, es que no se llegó a saber. El aviso discreto
   * en el panel de vista previa (`autopruebaAdvertencia`) es SÓLO para
   * "se probó y sigue fallando después de corregir dos veces".
   */
  async function ejecutarAutopruebaYCorreccion(htmlInicial: string): Promise<void> {
    const MAX_RONDAS_CORRECCION = 2;
    let htmlActual = htmlInicial;
    let rondasUsadas = 0;

    for (;;) {
      setAiPhase('probando');
      abortador.current = new AbortController();
      const resultado: ResultadoAutopruebaCliente | null = await ejecutarAutopruebaEnIframe(htmlActual, {
        signal: abortador.current.signal,
      });
      abortador.current = null;

      if (!resultado) return; // timeout o "Detener": no se pudo probar, nada que avisar.

      if (!necesitaCorreccion(resultado)) {
        setAutopruebaAdvertencia(false); // sano: por si quedaba un aviso de una ronda anterior de ESTE turno.
        return;
      }

      if (rondasUsadas >= MAX_RONDAS_CORRECCION) {
        setAutopruebaAdvertencia(true);
        return;
      }

      rondasUsadas++;
      setAiPhase('corrigiendo');
      abortador.current = new AbortController();

      let htmlCorregido: string | null = null;
      try {
        for await (const event of streamAutocorreccion(
          {
            projectId,
            fingerprint: fingerprintHtml(htmlActual),
            ronda: rondasUsadas as 1 | 2,
            errores: resultado.errores,
            reinicioOk: resultado.reinicioOk,
            exitoVisibleAlInicio: resultado.exitoVisibleAlInicio,
            diferencias: resultado.detalles.diferencias,
          },
          abortador.current.signal,
        )) {
          if (event.type === 'code') {
            // Mismo tratamiento que un "code" de la revisión visual: la
            // vista previa cambia, sin pasar por el chat.
            setHtml(event.html);
            htmlCorregido = event.html;
            codeEditedByTeacher.current = false;
            if (screenshotUrl) setPortadaVieja(true);
          } else if (event.type === 'error') {
            console.warn('[autoprueba] la corrección respondió con un error:', event.message);
          }
        }
      } catch (error) {
        abortador.current = null;
        // "Detener": se deja el recurso como estaba, sin aviso — el docente
        // cortó a propósito, no es una falla del recurso.
        if ((error as Error)?.name === 'AbortError') return;
        console.warn('[autoprueba] se cortó la conexión de la corrección:', error);
        setAutopruebaAdvertencia(true); // el endpoint falló: mismo tratamiento que "sigue fallando".
        return;
      }
      abortador.current = null;

      if (!htmlCorregido) {
        // El endpoint no aplicó nada (huella vencida, el modelo no devolvió
        // código, etc.): no hay un HTML nuevo para volver a probar.
        setAutopruebaAdvertencia(true);
        return;
      }

      htmlActual = htmlCorregido;
      // Vuelve al principio del for(;;): se re-prueba lo que acaba de corregir.
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
    setAutopruebaAdvertencia(false); // T12: deshacer cambió el recurso, cualquier aviso viejo ya no aplica.

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

  /**
   * T9 ("Varias versiones al crear un recurso"): activa la versión `index`
   * del mensaje `messageId`. Mismo patrón que `handleUndo` de arriba —
   * siempre confirma contra el servidor (nunca aplica el cambio a partir de
   * un HTML que ya tuviera en memoria): ni siquiera la versión 1, que ya se
   * vio completa por `code`, se aplica sin este viaje — así elegir siempre
   * queda persistido y consistente, sin un estado "elegido en el cliente
   * pero no en la base" posible.
   */
  async function handleElegirVersion(messageId: string, index: number) {
    const result = await apiRequest<{ html: string }>(`/api/projects/${projectId}/variant`, 'POST', {
      messageId,
      index,
    });

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setHtml(result.data.html);
    codeEditedByTeacher.current = false;
    if (screenshotUrl) setPortadaVieja(true);
    setAutopruebaAdvertencia(false); // T12: cambio de versión, cualquier aviso viejo ya no aplica.

    setMessages((current) =>
      current.map((existente) => (existente.id === messageId ? { ...existente, chosenVariant: index } : existente)),
    );
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
    // T5 (odd/tasks/responsive-celulares.md): 8.5rem en mobile porque el
    // `<main>` de esta página ahora usa `compactMobile` (padding chico), la
    // fila del "volver" y su margen — medido a 390×664, sin eso el composer
    // quedaba bajo el pliegue. En `lg` el `<main>` vuelve a `py-8` de
    // siempre, por eso ahí sigue siendo un valor distinto.
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-[28rem] flex-col lg:h-[calc(100dvh-8.5rem)]">
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
        puedeElegirVelocidad={props.capacidades.puedeElegirVelocidad}
        speed={speed}
        onSpeedChange={handleSpeedChange}
        puedePedirVersiones={props.capacidades.puedePedirVersiones}
        esRecursoInicial={esRecursoInicial(html)}
        versiones={versiones}
        onVersionesChange={handleVersionesChange}
        versionesEnCurso={versionesEnCurso}
        onElegirVersion={(messageId, index) => void handleElegirVersion(messageId, index)}
      />
      </div>

      <div className={`min-h-0 ${vistaMovil === 'recurso' ? 'flex' : 'hidden'} lg:flex`}>

      <PreviewPanel
        ref={previewRef}
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
          setAutopruebaAdvertencia(false); // T12: edición manual, cualquier aviso viejo ya no aplica.
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
        autopruebaAdvertencia={autopruebaAdvertencia}
      />
      </div>
      </div>
    </div>
  );
}
