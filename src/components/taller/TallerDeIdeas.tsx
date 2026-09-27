import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import StreamedText from '../workspace/StreamedText.tsx';
import PreguntasTaller from './PreguntasTaller.tsx';
import FichaTaller from './FichaTaller.tsx';
import { apiRequest, leerEventosSse } from '../../lib/client/api.ts';
import { armarRespuesta, type FichaIdea } from '../../lib/taller/ficha.ts';
import { NOMBRE_TALLER } from '../../lib/taller/prompt.ts';
import type { AdjuntoTallerCliente, EventoTaller, MensajeTaller, SesionTaller } from '../../lib/taller/tipos.ts';

/**
 * La charla del Taller de ideas (odd/tasks/taller-de-ideas.md): el chat a la
 * izquierda, con las preguntas de Kodu y sus respuestas para tocar, y la
 * ficha "Tu idea" a la derecha, que termina en el pedido y en "Crear mi
 * recurso". En el celular, chat y ficha son dos pestañas.
 */

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
  const hayElegidas = Object.values(elegidas).some((lista) => lista.length > 0);

  // Al abrir, directo al final (sin animación, que se corta si la página
  // todavía se está acomodando); después, suave mientras llega cada respuesta.
  const yaBajo = useRef(false);
  useEffect(() => {
    const contenedor = scroll.current;
    if (!contenedor) return;
    contenedor.scrollTo({ top: contenedor.scrollHeight, behavior: yaBajo.current ? 'smooth' : 'auto' });
    yaBajo.current = true;
  }, [mensajes.length, textoEnVivo, ocupado]);

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

    const texto = armarRespuesta(preguntasActivas, elegidas, borrador);
    if (!texto.trim()) return;

    setBorrador('');
    void enviar(texto, adjuntosPendientes);
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

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[32rem] flex-col lg:h-[calc(100dvh-9.5rem)]">
      <div className="mb-2 flex items-center gap-3">
        <a
          href="/app/taller"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-linea bg-superficie px-3 py-1 text-sm text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-600"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {NOMBRE_TALLER}
        </a>
        <p className="truncate text-sm text-ink-500">
          {props.sesion.mode === 'TOPIC' ? 'Tengo un tema, busco una idea' : 'Ya tengo una idea'}
        </p>
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

      <div className="kodu-card flex min-h-0 flex-1 overflow-hidden">
        {/* Charla */}
        <section
          className={`min-h-0 flex-1 flex-col border-linea lg:flex lg:border-r ${vistaMovil === 'charla' ? 'flex' : 'hidden'}`}
          aria-label="Charla con Kodu"
        >
          <div ref={scroll} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {mensajes.map((mensaje) => {
              const esUltimaIa = mensaje.id === idUltimaIa;
              return (
                <div key={mensaje.id} className={mensaje.role === 'user' ? 'ml-8' : 'mr-4 space-y-3'}>
                  {mensaje.content && (
                    <article
                      className={
                        mensaje.role === 'user'
                          ? 'rounded-xl bg-brand-600 px-3 py-2 text-sm whitespace-pre-wrap text-white'
                          : 'rounded-xl bg-sutil px-3 py-2 text-sm whitespace-pre-wrap text-ink-900'
                      }
                    >
                      {conNegritas(mensaje.content)}
                      {mensaje.attachments.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-xs opacity-80">
                          {mensaje.attachments.map((url) => (
                            <li key={url}>{nombreAdjunto(url)}</li>
                          ))}
                        </ul>
                      )}
                    </article>
                  )}

                  {mensaje.proposals.length > 0 && (
                    <ul className="grid gap-2" aria-label="Ideas que propuso Kodu">
                      {mensaje.proposals.map((idea) => (
                        <li key={idea.nombre} className="rounded-xl border border-linea bg-superficie p-3">
                          <p className="font-semibold text-ink-900">{idea.nombre}</p>
                          <p className="mt-1 text-sm text-ink-700">{idea.resumen}</p>
                          {idea.porQue && <p className="mt-1 text-sm text-ink-500">{idea.porQue}</p>}
                          {esUltimaIa && !soloLectura && (
                            <button
                              type="button"
                              disabled={ocupado}
                              onClick={() => void enviar(`Me quedo con la idea «${idea.nombre}».`, [])}
                              className="kodu-btn-ghost mt-2 px-3 py-1.5 text-sm"
                            >
                              Elegir esta idea
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {mensaje.role === 'assistant' && mensaje.questions.length > 0 && (
                    esUltimaIa && preguntasActivas.length > 0 ? (
                      <PreguntasTaller
                        preguntas={preguntasActivas}
                        elegidas={elegidas}
                        onElegir={elegir}
                        deshabilitado={ocupado}
                      />
                    ) : (
                      <ul className="space-y-0.5 px-1 text-xs text-ink-500">
                        {mensaje.questions.map((pregunta) => (
                          <li key={pregunta.texto}>{pregunta.texto}</li>
                        ))}
                      </ul>
                    )
                  )}
                </div>
              );
            })}

            {ocupado && textoEnVivo && (
              <article className="mr-4 rounded-xl bg-sutil px-3 py-2 text-sm whitespace-pre-wrap text-ink-900">
                <StreamedText text={textoEnVivo} render={conNegritas} />
              </article>
            )}

            {ocupado && !textoEnVivo && (
              <div className="flex items-center gap-2 px-1 text-sm text-ink-500" role="status">
                <ThinkingOrb state="composing" size={20} theme="auto" aria-label="" />
                {esperandoTurnoAnterior ? 'Kodu está terminando de contestar tu mensaje anterior…' : 'Kodu está pensando…'}
              </div>
            )}

            {aviso && <p className="px-1 text-xs text-ink-500" role="status">{aviso}</p>}

            {error && (
              <div role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
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
              <div className="rounded-xl border border-brand-300 bg-brand-50 p-3 text-sm text-ink-900 lg:hidden">
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
            <p className="border-t border-linea p-3 text-sm text-ink-500">
              Esta idea ya se convirtió en un recurso: la charla queda para consultar.{' '}
              <a href={`/app/project/${projectId}`} className="font-medium text-brand-600 hover:underline">
                Ir al recurso
              </a>
            </p>
          ) : (
            <form onSubmit={enviarDesdeElFormulario} className="space-y-2 border-t border-linea p-3">
              {adjuntosPendientes.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {adjuntosPendientes.map((adjunto) => (
                    <li
                      key={adjunto.id}
                      className="flex items-center gap-1 rounded-full bg-brand-50 px-2 py-1 text-xs text-brand-700"
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

              <label htmlFor="respuesta-taller" className="sr-only">
                Tu respuesta
              </label>
              <textarea
                id="respuesta-taller"
                value={borrador}
                onChange={(event) => setBorrador(event.target.value)}
                onKeyDown={alApretarTecla}
                rows={2}
                disabled={ocupado}
                placeholder={
                  preguntasActivas.some((pregunta) => pregunta.opciones.length > 0)
                    ? 'Tocá una respuesta de arriba, o escribí con tus palabras…'
                    : 'Escribí tu respuesta con tus palabras…'
                }
                className="kodu-input resize-none"
              />

              <div className="flex items-center gap-2">
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
                  className="kodu-btn-ghost px-3 py-2 text-sm"
                  title="Sumá una imagen o un PDF: una ficha de trabajo, una foto del pizarrón, un texto"
                >
                  {subiendo ? 'Subiendo…' : 'Adjuntar'}
                </button>
                <button
                  type="submit"
                  disabled={ocupado || (!hayElegidas && borrador.trim().length === 0)}
                  className="kodu-btn-primary flex-1"
                >
                  {ocupado ? 'Kodu está contestando…' : 'Enviar'}
                </button>
              </div>
            </form>
          )}
        </section>

        {/* Ficha */}
        <aside
          className={`min-h-0 w-full overflow-y-auto p-4 lg:block lg:w-[26rem] lg:shrink-0 ${vistaMovil === 'idea' ? 'block' : 'hidden'}`}
          aria-label="Tu idea"
        >
          {panelFicha}
        </aside>
      </div>
    </div>
  );
}
