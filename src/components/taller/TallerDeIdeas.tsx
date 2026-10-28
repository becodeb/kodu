import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import StreamedText from '../workspace/StreamedText.tsx';
import PreguntasTaller from './PreguntasTaller.tsx';
import FichaTaller from './FichaTaller.tsx';
import { apiRequest, leerEventosSse } from '../../lib/client/api.ts';
import { armarRespuestas, respuestaParaMostrar, type FichaIdea } from '../../lib/taller/ficha.ts';
import { NOMBRE_TALLER } from '../../lib/taller/prompt.ts';
import type { AdjuntoTallerCliente, EventoTaller, MensajeTaller, SesionTaller } from '../../lib/taller/tipos.ts';

/**
 * La charla del Taller de ideas (odd/tasks/taller-de-ideas.md): el chat a la
 * izquierda y, abajo, la pregunta que espera respuesta, sola y en foco (es a
 * la vez la caja para contestar). A la derecha, la ficha "Tu idea", que
 * termina en el pedido y en "Crear mi recurso". En el celular, chat y ficha
 * son dos pestañas.
 *
 * Kodu hace una pregunta por turno. Si un turno trae más de una (la apertura,
 * charlas guardadas antes de este cambio), igual salen de a una: se contestan
 * en orden y se mandan juntas con la última.
 */

/** Cuántas preguntas apunta a hacer Kodu antes del pedido (ver el prompt). */
const PREGUNTAS_ESPERADAS = 6;

const MENSAJE_ARMAR_PEDIDO = 'Ya está, armá el pedido con lo que tenemos.';
/** Mientras la IA termina un turno que quedó en camino (recarga, corte). */
const INTERVALO_ESPERA_MS = 3_000;
const MAX_ESPERAS = 100; // 5 minutos: más que el tope de un turno en el servidor.

/** Los `**...**` que se le escapen al modelo, en negrita (mismo criterio que ChatPanel). */
function conNegritas(texto: string) {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((trozo, indice) =>
    trozo.startsWith('**') && trozo.endsWith('**') && trozo.length > 4 ? (
      <strong key={indice} className="font-semibold">
        {trozo.slice(2, -2)}
      </strong>
    ) : (
      trozo
    ),
  );
}

export default function TallerDeIdeas(props: { sesion: SesionTaller; enCurso: boolean }) {
  const sesionId = props.sesion.id;

  const [mensajes, setMensajes] = useState<MensajeTaller[]>(props.sesion.messages);
  const [ficha, setFicha] = useState<FichaIdea>(props.sesion.brief);
  const [titulo, setTitulo] = useState<string | null>(props.sesion.title);
  const [pedido, setPedido] = useState<string | null>(props.sesion.finalPrompt);
  const [borradorPedido, setBorradorPedido] = useState(props.sesion.finalPrompt ?? '');
  const [estadoGuardado, setEstadoGuardado] = useState<'idle' | 'guardando' | 'guardado' | 'error'>('idle');
  const [projectId] = useState<string | null>(props.sesion.projectId);

  const [adjuntos, setAdjuntos] = useState<AdjuntoTallerCliente[]>(props.sesion.assets);
  const [adjuntosPendientes, setAdjuntosPendientes] = useState<AdjuntoTallerCliente[]>([]);
  const [subiendo, setSubiendo] = useState(false);

  const [borrador, setBorrador] = useState('');
  const [elegidas, setElegidas] = useState<Record<number, string[]>>({});
  /** "Otra respuesta" escrita a mano, por pregunta. */
  const [escritas, setEscritas] = useState<Record<number, string>>({});
  /** Qué pregunta del turno se está mostrando. */
  const [paso, setPaso] = useState(0);
  const [textoEnVivo, setTextoEnVivo] = useState('');
  const [ocupado, setOcupado] = useState(props.enCurso);
  const [esperandoTurnoAnterior, setEsperandoTurnoAnterior] = useState(props.enCurso);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallido, setFallido] = useState<{ texto: string; adjuntos: AdjuntoTallerCliente[] } | null>(null);
  const [creando, setCreando] = useState(false);
  const [vistaMovil, setVistaMovil] = useState<'charla' | 'idea'>('charla');
  /** Lo que se le lee a un lector de pantalla cuando llega una respuesta
   *  entera (no letra por letra mientras se escribe). */
  const [anuncio, setAnuncio] = useState('');

  const soloLectura = projectId !== null;
  const scroll = useRef<HTMLDivElement>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const temporizadorPedido = useRef<number | null>(null);
  const pedidoSinGuardar = useRef<string | null>(null);

  const ultimo = mensajes[mensajes.length - 1];
  const preguntasActivas =
    !soloLectura && !ocupado && ultimo?.role === 'assistant' ? ultimo.questions : [];
  const idUltimaIa = ultimo?.role === 'assistant' ? ultimo.id : null;
  const yaContesto = mensajes.some((mensaje) => mensaje.role === 'user');
  const respuestasDadas = mensajes.filter((mensaje) => mensaje.role === 'user').length;

  const preguntaActual = preguntasActivas[Math.min(paso, preguntasActivas.length - 1)] ?? null;
  const esUltimoPaso = paso >= preguntasActivas.length - 1;
  const contestada = (indice: number) =>
    (elegidas[indice]?.length ?? 0) > 0 || (escritas[indice] ?? '').trim().length > 0;
  const algunaContestada = preguntasActivas.some((_, indice) => contestada(indice));
  const numeroDePregunta = respuestasDadas + paso + 1;

  // Llegó otra respuesta de Kodu: se arranca de cero con sus preguntas.
  useEffect(() => {
    setPaso(0);
    setElegidas({});
    setEscritas({});
  }, [idUltimaIa]);

  // Al abrir, directo al final (sin animación, que se corta si la página
  // todavía se está acomodando); después, suave mientras llega cada respuesta.
  // En escritorio alto scrollea el chat; en el celular y en ventanas bajas
  // (variante `alto` de global.css) la página entera, así la pregunta de
  // abajo queda a la vista.
  const yaBajo = useRef(false);
  useEffect(() => {
    const contenedor = scroll.current;
    if (!contenedor) return;
    const comportamiento = yaBajo.current ? 'smooth' : 'auto';
    if (getComputedStyle(contenedor).overflowY === 'auto') {
      contenedor.scrollTo({ top: contenedor.scrollHeight, behavior: comportamiento });
    } else {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: comportamiento });
    }
    yaBajo.current = true;
  }, [mensajes.length, textoEnVivo, ocupado]);

  // Al pasar a la pregunta siguiente del mismo turno, que se vea entera
  // (puede tener más respuestas que la anterior).
  const panelPregunta = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (paso > 0) panelPregunta.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [paso]);

  // El título de la pestaña lo arma el servidor al cargar; cuando la IA le
  // pone nombre a la idea, se actualiza acá sin recargar.
  useEffect(() => {
    if (titulo) document.title = `${titulo} · ${NOMBRE_TALLER} · Kodu`;
  }, [titulo]);

  /** Trae la charla del servidor y la pone en pantalla tal cual. */
  const refrescar = useCallback(async (): Promise<boolean> => {
    const resultado = await apiRequest<{ session: SesionTaller; enCurso: boolean }>(`/api/taller/${sesionId}`);
    if (!resultado.ok) return false;

    const sesion = resultado.data.session;
    setMensajes(sesion.messages);
    setFicha(sesion.brief);
    setTitulo(sesion.title);
    setPedido(sesion.finalPrompt);
    if (pedidoSinGuardar.current === null) setBorradorPedido(sesion.finalPrompt ?? '');
    setAdjuntos(sesion.assets);
    return !resultado.data.enCurso;
  }, [sesionId]);

  /**
   * Hay una respuesta en camino que esta pestaña no está escuchando (se
   * recargó la página, o se cortó la conexión a mitad): el servidor la
   * termina y la guarda igual, así que alcanza con esperar y releer.
   */
  const esperarTurnoEnCurso = useCallback(async () => {
    setOcupado(true);
    setEsperandoTurnoAnterior(true);
    for (let intento = 0; intento < MAX_ESPERAS; intento++) {
      await new Promise((resolver) => window.setTimeout(resolver, INTERVALO_ESPERA_MS));
      if (await refrescar()) break;
    }
    setEsperandoTurnoAnterior(false);
    setOcupado(false);
  }, [refrescar]);

  useEffect(() => {
    if (props.enCurso) void esperarTurnoEnCurso();
    // Sólo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Guarda YA la edición a mano del pedido que esté esperando su turno. */
  const guardarPedidoPendiente = useCallback(async () => {
    if (temporizadorPedido.current) {
      window.clearTimeout(temporizadorPedido.current);
      temporizadorPedido.current = null;
    }
    const texto = pedidoSinGuardar.current;
    if (texto === null) return true;
    pedidoSinGuardar.current = null;
    if (!texto.trim()) return true;

    setEstadoGuardado('guardando');
    const resultado = await apiRequest(`/api/taller/${sesionId}`, 'PATCH', { finalPrompt: texto });
    setEstadoGuardado(resultado.ok ? 'guardado' : 'error');
    if (resultado.ok) setPedido(texto.trim());
    return resultado.ok;
  }, [sesionId]);

  function editarPedido(texto: string) {
    setBorradorPedido(texto);
    pedidoSinGuardar.current = texto;
    setEstadoGuardado('idle');
    if (temporizadorPedido.current) window.clearTimeout(temporizadorPedido.current);
    temporizadorPedido.current = window.setTimeout(() => void guardarPedidoPendiente(), 900);
  }

  useEffect(() => {
    return () => {
      if (temporizadorPedido.current) window.clearTimeout(temporizadorPedido.current);
    };
  }, []);

  function escribir(indice: number, texto: string) {
    setEscritas((actuales) => ({ ...actuales, [indice]: texto }));
  }

  function elegir(indice: number, opcion: string) {
    const pregunta = preguntasActivas[indice];
    if (!pregunta) return;

    setElegidas((actuales) => {
      const previas = actuales[indice] ?? [];
      const yaEstaba = previas.includes(opcion);
      const nuevas = pregunta.multiple
        ? yaEstaba
          ? previas.filter((previa) => previa !== opcion)
          : [...previas, opcion]
        : yaEstaba
          ? []
          : [opcion];
      return { ...actuales, [indice]: nuevas };
    });
  }

  async function enviar(texto: string, adjuntosDelMensaje: AdjuntoTallerCliente[]) {
    setError(null);
    setFallido(null);
    setAviso(null);
    setOcupado(true);
    setTextoEnVivo('');

    await guardarPedidoPendiente();

    const idLocal = `local-${Date.now()}`;
    setMensajes((actuales) => [
      ...actuales,
      {
        id: idLocal,
        role: 'user',
        content: texto,
        questions: [],
        proposals: [],
        attachments: adjuntosDelMensaje.map((adjunto) => adjunto.url),
      },
    ]);
    setElegidas({});
    setEscritas({});
    setPaso(0);
    setAdjuntosPendientes([]);

    const deshacerOptimista = (mensajeError: string) => {
      setMensajes((actuales) => actuales.filter((mensaje) => mensaje.id !== idLocal));
      setError(mensajeError);
      setFallido({ texto, adjuntos: adjuntosDelMensaje });
      setTextoEnVivo('');
    };

    let terminado = false;
    try {
      const respuesta = await fetch(`/api/taller/${sesionId}/turno`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: texto, attachmentUrls: adjuntosDelMensaje.map((adjunto) => adjunto.url) }),
      });

      if (!respuesta.ok || !respuesta.body) {
        const cuerpo = (await respuesta.json().catch(() => null)) as { error?: string } | null;
        deshacerOptimista(
          cuerpo?.error ??
            (respuesta.status === 401
              ? 'Se venció tu sesión. Volvé a entrar y probá de nuevo.'
              : 'No pude contestarte ahora. Probá de nuevo en un momento.'),
        );
        terminado = true;
        return;
      }

      for await (const crudo of leerEventosSse(respuesta)) {
        const evento = crudo as EventoTaller;

        if (evento.type === 'text') {
          setTextoEnVivo((actual) => actual + evento.delta);
        } else if (evento.type === 'notice') {
          setAviso(evento.message);
        } else if (evento.type === 'error') {
          deshacerOptimista(evento.message);
          terminado = true;
        } else if (evento.type === 'done') {
          terminado = true;
          setMensajes((actuales) => [
            ...actuales.filter((mensaje) => mensaje.id !== idLocal),
            evento.userMessage,
            evento.message,
          ]);
          setFicha(evento.brief);
          setTitulo(evento.title);
          if (evento.finalPrompt !== null && evento.finalPrompt !== pedido) {
            setBorradorPedido(evento.finalPrompt);
            pedidoSinGuardar.current = null;
            setEstadoGuardado('idle');
          }
          setPedido(evento.finalPrompt);
          setAnuncio(`Kodu respondió: ${evento.message.content}`);
          setTextoEnVivo('');
          setAviso(null);
        }
      }
    } catch {
      // Se cortó la conexión: el servidor sigue y guarda. Se espera abajo.
    } finally {
      setOcupado(false);
    }

    if (!terminado) {
      // La respuesta puede haber quedado en camino del lado del servidor.
      setTextoEnVivo('');
      setMensajes((actuales) => actuales.filter((mensaje) => mensaje.id !== idLocal));
      await esperarTurnoEnCurso();
    }
  }

  function enviarDesdeElFormulario(event?: FormEvent) {
    event?.preventDefault();
    if (ocupado || soloLectura) return;

    // Con preguntas: lo contestado en el panel. Sin preguntas (Kodu propuso
    // ideas, o el pedido ya está): lo que se escribió en la caja libre.
    const texto =
      preguntasActivas.length > 0 ? armarRespuestas(preguntasActivas, elegidas, escritas) : borrador.trim();
    if (!texto.trim()) return;

    setBorrador('');
    void enviar(texto, adjuntosPendientes);
  }

  /** El botón principal del panel: pasa a la pregunta siguiente o manda todo. */
  function avanzar() {
    if (ocupado) return;
    if (!esUltimoPaso) {
      if (contestada(paso)) setPaso(paso + 1);
      return;
    }
    if (algunaContestada) enviarDesdeElFormulario();
  }

  /** "Saltear": sigue sin contestar; en la última, manda lo que haya (o avisa que la salteó). */
  function saltear() {
    if (ocupado) return;
    if (!esUltimoPaso) {
      setPaso(paso + 1);
      return;
    }
    if (algunaContestada) enviarDesdeElFormulario();
    else void enviar('Prefiero saltear esta pregunta.', adjuntosPendientes);
  }

  function alApretarTecla(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter manda y Shift+Enter baja de línea, salvo en pantallas táctiles,
    // donde Enter tiene que poder bajar de línea (no hay Shift a mano).
    const tactil = window.matchMedia?.('(pointer: coarse)').matches;
    if (event.key === 'Enter' && !event.shiftKey && !tactil) {
      event.preventDefault();
      enviarDesdeElFormulario();
    }
  }

  async function subir(event: ChangeEvent<HTMLInputElement>) {
    const archivos = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (archivos.length === 0) return;

    setSubiendo(true);
    setError(null);
    const formulario = new FormData();
    for (const elegido of archivos) formulario.append('files', elegido);

    try {
      const respuesta = await fetch(`/api/taller/${sesionId}/adjuntos`, { method: 'POST', body: formulario });
      const cuerpo = (await respuesta.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        assets?: AdjuntoTallerCliente[];
      };
      if (!respuesta.ok || !cuerpo.ok || !cuerpo.assets) {
        setError(cuerpo.error ?? 'No se pudieron subir los archivos.');
      } else {
        setAdjuntos((actuales) => [...actuales, ...cuerpo.assets!]);
        setAdjuntosPendientes((actuales) => [...actuales, ...cuerpo.assets!]);
      }
    } catch {
      setError('No se pudo contactar al servidor.');
    } finally {
      setSubiendo(false);
    }
  }

  async function crearRecurso() {
    setCreando(true);
    setError(null);
    if (temporizadorPedido.current) window.clearTimeout(temporizadorPedido.current);
    pedidoSinGuardar.current = null;

    const resultado = await apiRequest<{ redirect: string }>(`/api/taller/${sesionId}/crear`, 'POST', {
      finalPrompt: borradorPedido,
    });
    if (!resultado.ok) {
      setError(resultado.error);
      setCreando(false);
      setVistaMovil('charla');
      return;
    }
    window.location.href = resultado.data.redirect;
  }

  const nombreAdjunto = (url: string) =>
    adjuntos.find((adjunto) => adjunto.url === url)?.filename ?? url.split('/').pop() ?? url;

  const panelFicha = (
    <FichaTaller
      ficha={ficha}
      titulo={titulo}
      pedido={pedido}
      borradorPedido={borradorPedido}
      onBorradorPedido={editarPedido}
      estadoGuardado={estadoGuardado}
      soloLectura={soloLectura}
      projectId={projectId}
      ocupado={ocupado}
      puedeArmarPedido={yaContesto}
      onArmarPedido={() => void enviar(MENSAJE_ARMAR_PEDIDO, [])}
      onCrear={() => void crearRecurso()}
      creando={creando}
    />
  );

  const iconoKodu = (
    <span
      aria-hidden="true"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-brand-600 text-white"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
      </svg>
    </span>
  );

  const botonAdjuntar = (
    <>
      <input
        ref={archivo}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
        onChange={(event) => void subir(event)}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => archivo.current?.click()}
        disabled={subiendo || ocupado}
        aria-label={subiendo ? 'Subiendo archivos' : 'Adjuntar una imagen o un PDF'}
        title="Sumá una imagen o un PDF: una ficha de trabajo, una foto del pizarrón, un texto"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-linea text-ink-500 transition-colors hover:border-ink-500 hover:text-ink-900 disabled:opacity-60"
      >
        {subiendo ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-linea border-t-brand-600" />
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7L10.2 17a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
          </svg>
        )}
      </button>
    </>
  );

  const flecha = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );

  return (
    <div className="flex flex-col alto:h-[calc(100dvh-9.5rem)] alto:min-h-[32rem]">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <a
          href="/app/taller"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-linea bg-superficie py-1.5 pr-3 pl-2 text-sm font-semibold text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-600"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          {NOMBRE_TALLER}
        </a>
        <p className="truncate text-sm font-semibold text-ink-500 max-sm:hidden">
          {props.sesion.mode === 'TOPIC' ? 'Tengo el tema' : 'Ya tengo la idea'}
        </p>

        {!soloLectura && !pedido && (
          <div className="ml-auto flex items-center gap-2.5 text-sm text-ink-500">
            {numeroDePregunta <= PREGUNTAS_ESPERADAS
              ? `Pregunta ${numeroDePregunta} de unas ${PREGUNTAS_ESPERADAS}`
              : `Pregunta ${numeroDePregunta}`}
            <span aria-hidden="true" className="flex gap-1 max-sm:hidden">
              {Array.from({ length: PREGUNTAS_ESPERADAS }, (_, indice) => (
                <span
                  key={indice}
                  className={`h-1.5 w-5 rounded-full ${
                    indice < numeroDePregunta - 1
                      ? 'bg-brand-600'
                      : indice === numeroDePregunta - 1
                        ? 'bg-brand-300'
                        : 'bg-linea'
                  }`}
                />
              ))}
            </span>
          </div>
        )}
      </div>

      {/* En el celular: dos pestañas. La de la idea avisa cuando el pedido está listo. */}
      <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-sutil p-1 lg:hidden" role="tablist">
        {(['charla', 'idea'] as const).map((vista) => (
          <button
            key={vista}
            type="button"
            role="tab"
            aria-selected={vistaMovil === vista}
            onClick={() => setVistaMovil(vista)}
            className={`relative rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              vistaMovil === vista ? 'bg-superficie text-ink-900 shadow-sm' : 'text-ink-500'
            }`}
          >
            {vista === 'charla' ? 'Charla' : 'Tu idea'}
            {vista === 'idea' && pedido && vistaMovil !== 'idea' && (
              <span className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-brand-600" aria-label="Pedido listo" />
            )}
          </button>
        ))}
      </div>

      <p className="sr-only" aria-live="polite">
        {anuncio}
      </p>

      <div className="flex items-start gap-5 alto:min-h-0 alto:flex-1 alto:items-stretch">
        {/* Charla */}
        <section
          className={`min-w-0 flex-1 flex-col lg:flex alto:min-h-0 ${vistaMovil === 'charla' ? 'flex' : 'hidden'}`}
          aria-label="Charla con Kodu"
        >
          <div ref={scroll} className="space-y-3 pr-1 pb-4 alto:min-h-0 alto:flex-1 alto:overflow-y-auto">
            {mensajes.map((mensaje, indiceMensaje) => {
              const esUltimaIa = mensaje.id === idUltimaIa;
              // El avatar de Kodu va en el primer mensaje de cada tanda suya.
              const conAvatar = mensaje.role === 'assistant' && mensajes[indiceMensaje - 1]?.role !== 'assistant';
              // Las preguntas que esperan respuesta están abajo, en el panel:
              // en el chat se muestran sólo las ya contestadas.
              const preguntasEnElChat =
                esUltimaIa && preguntasActivas.length > 0 ? [] : mensaje.questions;

              if (mensaje.role === 'user') {
                return (
                  <div key={mensaje.id} className="flex justify-end pl-10">
                    <article className="rounded-[18px] rounded-br-[4px] bg-brand-600 px-4 py-2.5 text-[15px] whitespace-pre-wrap text-white">
                      {respuestaParaMostrar(mensaje.content)}
                      {mensaje.attachments.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-xs opacity-80">
                          {mensaje.attachments.map((url) => (
                            <li key={url}>{nombreAdjunto(url)}</li>
                          ))}
                        </ul>
                      )}
                    </article>
                  </div>
                );
              }

              return (
                <div key={mensaje.id} className="flex items-start gap-2.5 pr-6">
                  {conAvatar ? iconoKodu : <span className="w-8 shrink-0" aria-hidden="true" />}
                  <div className="min-w-0 flex-1 space-y-2">
                    {mensaje.content && (
                      <article className="w-fit max-w-full rounded-[18px] rounded-tl-[4px] border border-linea bg-superficie px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-ink-700">
                        {conNegritas(mensaje.content)}
                      </article>
                    )}

                    {preguntasEnElChat.map((pregunta) => (
                      <p
                        key={pregunta.texto}
                        className="w-fit max-w-full rounded-[18px] border border-linea bg-superficie px-4 py-2.5 text-[15px] font-semibold text-ink-900"
                      >
                        {pregunta.texto}
                      </p>
                    ))}

                    {mensaje.proposals.length > 0 && (
                      <ul className="grid gap-2.5 sm:grid-cols-2" aria-label="Ideas que propuso Kodu">
                        {mensaje.proposals.map((idea) => (
                          <li key={idea.nombre} className="kodu-card flex flex-col rounded-2xl p-4">
                            <p className="font-bold text-ink-900">{idea.nombre}</p>
                            <p className="mt-1 text-sm text-ink-700">{idea.resumen}</p>
                            {idea.porQue && <p className="mt-1 text-sm text-ink-500">{idea.porQue}</p>}
                            {esUltimaIa && !soloLectura && (
                              <button
                                type="button"
                                disabled={ocupado}
                                onClick={() => void enviar(`Me quedo con la idea «${idea.nombre}».`, [])}
                                className="kodu-btn-primary mt-3 self-start px-3 py-2 text-sm"
                              >
                                Elegir esta idea
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}

            {ocupado && textoEnVivo && (
              <div className="flex items-start gap-2.5 pr-6">
                {mensajes[mensajes.length - 1]?.role === 'assistant' ? <span className="w-8 shrink-0" /> : iconoKodu}
                <article className="w-fit max-w-full rounded-[18px] rounded-tl-[4px] border border-linea bg-superficie px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-ink-700">
                  <StreamedText text={textoEnVivo} render={conNegritas} />
                </article>
              </div>
            )}

            {ocupado && !textoEnVivo && (
              <div className="flex items-center gap-2 pl-10 text-sm text-ink-500" role="status">
                <ThinkingOrb state="composing" size={20} theme="auto" aria-label="" />
                {esperandoTurnoAnterior ? 'Kodu está terminando de contestar tu mensaje anterior…' : 'Kodu está pensando…'}
              </div>
            )}

            {aviso && <p className="pl-10 text-xs text-ink-500" role="status">{aviso}</p>}

            {error && (
              <div role="alert" className="ml-10 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                <p>{error}</p>
                {fallido && (
                  <button
                    type="button"
                    onClick={() => void enviar(fallido.texto, fallido.adjuntos)}
                    disabled={ocupado}
                    className="mt-2 rounded-lg border border-red-200 bg-superficie px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                  >
                    Reintentar
                  </button>
                )}
              </div>
            )}

            {/* En el celular la ficha está en la otra pestaña: el pedido listo
                se avisa acá, donde está la atención. */}
            {pedido && !soloLectura && (
              <div className="ml-10 rounded-xl border border-brand-300 bg-brand-50 p-3 text-sm text-ink-900 lg:hidden">
                Tu pedido está listo.
                <button
                  type="button"
                  onClick={() => setVistaMovil('idea')}
                  className="ml-1 font-semibold text-brand-700 underline-offset-2 hover:underline"
                >
                  Revisalo y creá tu recurso
                </button>
              </div>
            )}
          </div>

          {soloLectura ? (
            <p className="kodu-card rounded-2xl p-4 text-sm text-ink-500">
              Esta idea ya se convirtió en un recurso: la charla queda para consultar.{' '}
              <a href={`/app/project/${projectId}`} className="font-semibold text-brand-600 hover:underline">
                Ir al recurso
              </a>
            </p>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (preguntaActual) avanzar();
                else enviarDesdeElFormulario();
              }}
              ref={panelPregunta}
              className={`flex shrink-0 flex-col gap-4 rounded-[20px] border-2 bg-superficie p-4 sm:p-5 ${
                preguntaActual
                  ? 'kodu-elev border-brand-600 shadow-[0_0_0_5px_var(--color-brand-50)]'
                  : 'border-linea'
              }`}
            >
              {/* La pregunta va siempre entera, sin scroll propio: con uno, las
                  últimas respuestas quedaban escondidas y nadie las encontraba. */}
              <div className="space-y-4">
              {preguntaActual ? (
                <PreguntasTaller
                  pregunta={preguntaActual}
                  numero={paso + 1}
                  total={preguntasActivas.length}
                  elegidas={elegidas[paso] ?? []}
                  escrita={escritas[paso] ?? ''}
                  onElegir={(opcion) => elegir(paso, opcion)}
                  onEscribir={(texto) => escribir(paso, texto)}
                  onEnter={avanzar}
                  deshabilitado={ocupado}
                />
              ) : (
                <>
                  <label htmlFor="respuesta-taller" className="sr-only">
                    Tu mensaje
                  </label>
                  <textarea
                    id="respuesta-taller"
                    value={borrador}
                    onChange={(event) => setBorrador(event.target.value)}
                    onKeyDown={alApretarTecla}
                    rows={2}
                    disabled={ocupado}
                    placeholder={ocupado ? 'Kodu está contestando…' : 'Escribile a Kodu…'}
                    className="kodu-input resize-none rounded-[14px] px-3.5 py-3 text-base"
                  />
                </>
              )}

              {adjuntosPendientes.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {adjuntosPendientes.map((adjunto) => (
                    <li
                      key={adjunto.id}
                      className="flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-700"
                    >
                      {adjunto.filename}
                      <button
                        type="button"
                        onClick={() =>
                          setAdjuntosPendientes((actuales) => actuales.filter((otro) => otro.id !== adjunto.id))
                        }
                        aria-label={`No mandar ${adjunto.filename} en este mensaje`}
                        className="text-brand-700/70 hover:text-brand-700"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {botonAdjuntar}
                {preguntaActual && paso > 0 && (
                  <button
                    type="button"
                    onClick={() => setPaso(paso - 1)}
                    disabled={ocupado}
                    className="h-11 px-2 text-sm font-semibold text-ink-500 transition-colors hover:text-ink-900"
                  >
                    Atrás
                  </button>
                )}
                {preguntaActual && (
                  <button
                    type="button"
                    onClick={saltear}
                    disabled={ocupado}
                    className="h-11 px-2 text-sm font-semibold text-ink-500 transition-colors hover:text-ink-900"
                  >
                    Saltear
                  </button>
                )}
                <button
                  type="submit"
                  disabled={
                    ocupado ||
                    (preguntaActual
                      ? esUltimoPaso
                        ? !algunaContestada
                        : !contestada(paso)
                      : borrador.trim().length === 0)
                  }
                  className="kodu-btn-primary ml-auto h-11 rounded-xl px-5"
                >
                  {ocupado
                    ? 'Kodu está contestando…'
                    : preguntaActual && !esUltimoPaso
                      ? 'Siguiente'
                      : preguntaActual?.multiple && (elegidas[paso]?.length ?? 0) > 0
                        ? `Responder · ${elegidas[paso]!.length} ${elegidas[paso]!.length === 1 ? 'elegida' : 'elegidas'}`
                        : preguntaActual
                          ? 'Responder'
                          : 'Enviar'}
                  {!ocupado && flecha}
                </button>
              </div>
            </form>
          )}
        </section>

        {/* Ficha */}
        <aside
          className={`kodu-card w-full rounded-[20px] p-5 lg:sticky lg:top-20 lg:block lg:w-[22rem] lg:shrink-0 alto:static alto:min-h-0 alto:overflow-y-auto ${vistaMovil === 'idea' ? 'block' : 'hidden'}`}
          aria-label="Tu idea"
        >
          {panelFicha}
        </aside>
      </div>
    </div>
  );
}
