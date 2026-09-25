import type { Prisma } from '../../generated/prisma/client.ts';
import { getEnv } from '../env.ts';
import { RESOURCE_TOOLS, UPDATE_RESOURCE_CODE } from './tools.ts';

/**
 * Capa de proveedores de IA. El backend actúa de proxy seguro: las API keys
 * viven sólo acá (SPEC §1) y el navegador nunca las ve.
 *
 * Este módulo es sólo HTTP y SSE: hablar el dialecto OpenAI
 * (`/chat/completions` con `stream: true`) contra la config que le pasen.
 * QUÉ motor usar, en qué orden probarlos y de dónde sale la clave ya no es
 * cosa de acá — eso vive en `src/lib/ai/catalogo.ts`, que lee el catálogo
 * (`AiModel`) y arma el `ProviderConfig` que este módulo consume.
 */

/**
 * Valor histórico del viejo enum `ModelChoice` (`ALPHA`/`DEEPSEEK`/`MINIMAX`).
 * Sigue existiendo SOLO porque `TokenUsage.provider` y `Project.selectedModel`
 * (dato histórico, no leer) lo usan como tipo de columna — ningún código de
 * resolución en tiempo real vuelve a producir ni a consumir este valor.
 */
export type ModelChoice = 'ALPHA' | 'DEEPSEEK' | 'MINIMAX';

/** Lo que hace falta para pedirle un turno a un motor concreto. */
export interface ProviderConfig {
  /** El `id` de la fila `AiModel` que produjo esta config. */
  id: string;
  label: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  /** Tope de tokens por usuario. 0 = sin tope. */
  userTokenLimit: number;
  /** Ventana móvil sobre la que se mide el tope, en horas. 0 = desde siempre. */
  userTokenWindowHours: number;
  /** Largo máximo de un mensaje del docente, en caracteres. */
  maxInputChars: number;
  supportsVision: boolean;
  /**
   * Cuánto se le deja razonar antes de contestar, para los modelos que lo
   * soportan. `null` = no mandar el parámetro, que es lo que corresponde con
   * cualquier proveedor que no lo conozca: mandárselo a ciegas es un 400.
   */
  reasoningEffort: string | null;
  /** Con qué nombre viaja: "reasoning_effort" (default) o "thinking". */
  reasoningParam: string | null;
  /** `null` si a este motor le falta algún precio: nunca se inventa un costo. */
  precios: {
    input: Prisma.Decimal;
    output: Prisma.Decimal;
    cachedInput: Prisma.Decimal | null;
  } | null;
}

/**
 * Partes de un mensaje multimodal (formato OpenAI). Sólo se usan cuando
 * `AI_VISION` está prendido: un modelo de sólo texto rechaza el array con 400.
 */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

/**
 * Si ESTE motor puede leer imágenes. El catálogo ya trae `supportsVision` por
 * fila (algunos proveedores son sólo texto); acá se cruza además con el
 * apagador global `AI_VISION`, que sigue siendo un kill-switch operativo
 * independiente del catálogo.
 */
export function supportsVision(config: ProviderConfig): boolean {
  return config.supportsVision && getEnv().AI_VISION;
}

export class ProviderError extends Error {
  readonly status: number;
  /** true si conviene ofrecerle al docente reintentar con el otro proveedor. */
  readonly canFallback: boolean;

  constructor(message: string, status = 502, canFallback = true) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.canFallback = canFallback;
  }
}

/**
 * El proveedor rechazó la herramienta forzada, no el pedido.
 *
 * Los modelos de razonamiento ("thinking mode") sólo aceptan `tool_choice:
 * "auto"`: DeepSeek contesta 400 "Thinking mode does not support this
 * tool_choice". El pedido es válido en todo lo demás, así que no hay que
 * hacerlo fallar ni saltar al respaldo: alcanza con repetirlo sin la
 * obligación, que es lo único que sobra.
 */
export class ToolChoiceNoSoportado extends ProviderError {
  constructor(message: string) {
    super(message, 400, false);
    this.name = 'ToolChoiceNoSoportado';
  }
}

/**
 * Reintentos ante saturación del proveedor.
 *
 * El modelo gratuito estrangula bastante más los pedidos con imagen que los de
 * texto: medido, dos pedidos con imagen seguidos vuelven 429 mientras los de
 * texto de al lado pasan sin problema. El propio proveedor contesta "retry
 * shortly", asi que reintentar es exactamente lo que corresponde — y es mucho
 * mejor que hacerle reescribir el pedido al docente.
 *
 * Son 10 intentos en total (el primero más nueve esperas, ~102 s en el peor
 * caso). Recién cuando se agotan se toca el respaldo pago: la idea es que
 * DeepSeek se use lo menos posible, no que entre al primer tropiezo.
 */
const REINTENTOS = [
  2_000, 4_000, 6_000, 8_000, 10_000, 12_000, 15_000, 20_000, 25_000,
];

function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(new ProviderError('El pedido se canceló mientras esperaba al proveedor.', 499, false));
      },
      { once: true },
    );
  });
}

export async function requestCompletionStream(options: {
  messages: ChatMessage[];
  provider: ProviderConfig;
  signal?: AbortSignal;
  /** Se llama antes de cada espera, para poder avisarle al docente. */
  onReintento?: (intento: number, esperaMs: number) => void;
  /**
   * Obliga al modelo a llamar `update_resource_code` en vez de dejarlo elegir.
   * Se usa en el reintento, cuando en el primer pase prometió el cambio y no lo
   * hizo.
   */
  forzarHerramienta?: boolean;
  /**
   * T6 ("Velocidad Rápido / A fondo"): la velocidad efectiva de ESTE turno, ya
   * resuelta por `resolverVelocidadEfectiva` (`lib/ai/capacidades.ts`).
   * `null`/ausente = sin pisar nada, el razonamiento configurado de siempre.
   * Viaja como parámetro y no se resuelve acá adentro: este módulo no sabe
   * nada de usuarios ni de `AppSettings` (ver la nota sobre `catalogo.ts` más
   * arriba). Se reenvía tal cual en el reintento por `ToolChoiceNoSoportado`
   * y en cada saturación: es la misma velocidad durante todo el turno.
   */
  velocidad?: Speed | null;
  /**
   * T12 (round 3, `arnes-robustez`): anula `razonamientoEfectivo(provider,
   * velocidad)` con un objeto YA ARMADO. La autocorrección de la autoprueba
   * usa un nivel "low" que NO es parte del vocabulario `Speed` que ve el
   * docente (la tarea pide explícitamente no ensanchar `Speed` sólo para un
   * nivel interno) — ver `razonamientoCorreccion` más abajo. `undefined`/
   * `null` = comportamiento de siempre (`razonamientoEfectivo`).
   */
  razonamientoOverride?: Record<string, unknown> | null;
  /**
   * T16 (round 4, `arnes-robustez`): pisa `provider.maxTokens` para UNA
   * llamada puntual. El paso de checklist es texto corto (3 a 6 líneas), no
   * un documento HTML — dejarle el tope pensado para "recurso entero" sólo
   * arriesga que un modelo verborrágico se vaya de tema sin que nada lo
   * corte antes. `undefined`/`null` = `provider.maxTokens` de siempre.
   */
  maxTokensOverride?: number | null;
}): Promise<Response> {
  const { provider } = options;

  if (!provider.apiKey) {
    throw new ProviderError(
      `El servidor no tiene configurada la clave de ${provider.label}.`,
      503,
    );
  }

  const endpoint = `${provider.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;

  // La obligación de llamar la herramienta se puede aflojar sobre la marcha:
  // ver ToolChoiceNoSoportado. Es una sola vez, y no gasta ninguno de los
  // intentos reservados para la saturación.
  let forzar = options.forzarHerramienta ?? false;
  let yaAflojo = false;
  let saturaciones = 0;

  for (;;) {
    try {
      return await intentarUna(endpoint, {
        messages: options.messages,
        provider: options.provider,
        signal: options.signal,
        forzarHerramienta: forzar,
        velocidad: options.velocidad,
        razonamientoOverride: options.razonamientoOverride,
        maxTokensOverride: options.maxTokensOverride,
      });
    } catch (error) {
      if (error instanceof ToolChoiceNoSoportado && forzar && !yaAflojo) {
        console.warn(
          `[provider] ${provider.label} no acepta forzar la herramienta; se repite el pedido con tool_choice "auto".`,
        );
        forzar = false;
        yaAflojo = true;
        continue;
      }

      const saturado = error instanceof ProviderError && error.status === 429;
      if (!saturado || saturaciones >= REINTENTOS.length) throw error;

      const espera = REINTENTOS[saturaciones]!;
      saturaciones += 1;
      options.onReintento?.(saturaciones, espera);
      await esperar(espera, options.signal);
    }
  }
}

/**
 * El razonamiento, con el nombre que espera cada proveedor.
 *
 * No hay un parámetro universal: DeepSeek habla el dialecto OpenAI y toma
 * `reasoning_effort` con el nivel; MiniMax M3 toma `thinking: {type}`. Mandarle
 * el de uno al otro es un 400, así que el catálogo guarda cuál usa cada motor.
 *
 * Sin `reasoningEffort` cargado no se manda NADA, que es lo único seguro con un
 * proveedor cuyo dialecto no conocemos.
 */
export function razonamiento(provider: ProviderConfig): Record<string, unknown> {
  if (!provider.reasoningEffort) return {};

  if (provider.reasoningParam === 'thinking') {
    // MiniMax no tiene niveles: o piensa o no piensa. Cualquier nivel que no
    // sea "none" se interpreta como prendido.
    return { thinking: { type: provider.reasoningEffort === 'none' ? 'disabled' : 'enabled' } };
  }

  return { reasoning_effort: provider.reasoningEffort };
}

/** T6 ("Velocidad Rápido / A fondo"): lo que pidió el docente para ESTE
 *  turno, ya resuelto contra la capacidad (`resolverVelocidadEfectiva` en
 *  `lib/ai/capacidades.ts`). Vocabulario del proveedor/protocolo — el de
 *  `Capacidades.velocidadPorDefecto` es otro, en español, para el cliente. */
export type Speed = 'fast' | 'deep';

/** De menos a más razonamiento, en el vocabulario que ya usa `AiModel.reasoningEffort`. */
const NIVELES_RAZONAMIENTO = ['none', 'low', 'high', 'max'];

/**
 * El razonamiento de ESTE turno (T6), pisado por la velocidad efectiva en vez
 * del nivel que tiene configurado el motor. Mismo dialecto que `razonamiento()`
 * — el proveedor no cambia por elegir velocidad, sólo el nivel que se le pide.
 *
 * `velocidad` en `null` (nadie con `puedeElegirVelocidad`, o nada que
 * resolver): exactamente `razonamiento(provider)`, sin pisar nada — el
 * comportamiento de siempre para quien no tiene el permiso.
 *
 * Dialecto desconocido (`reasoningEffort` null, mismo gate que `razonamiento`):
 * tampoco se manda nada en ninguna velocidad — no hay ningún nivel "seguro"
 * que inventarle a un proveedor que no sabemos si lo acepta.
 */
export function razonamientoEfectivo(
  provider: ProviderConfig,
  velocidad: Speed | null,
): Record<string, unknown> {
  if (!velocidad || !provider.reasoningEffort) return razonamiento(provider);

  if (provider.reasoningParam === 'thinking') {
    // MiniMax no tiene niveles: Rápido apaga, A fondo prende, sin importar
    // qué nivel tenía configurado este motor.
    return { thinking: { type: velocidad === 'fast' ? 'disabled' : 'enabled' } };
  }

  if (velocidad === 'fast') return { reasoning_effort: 'none' };

  // A fondo: al menos "high", pero sin BAJAR un nivel más alto ya configurado
  // (decisiones del dueño: "el modelo caro no necesariamente es más lento" —
  // si ya estaba en "max", A fondo no lo achica a "high").
  const configurado = NIVELES_RAZONAMIENTO.indexOf(provider.reasoningEffort);
  const yaAlcanzaAlto = configurado >= NIVELES_RAZONAMIENTO.indexOf('high');
  return { reasoning_effort: yaAlcanzaAlto ? provider.reasoningEffort : 'high' };
}

/**
 * El razonamiento de la autocorrección de la autoprueba (T12, round 3 de
 * `arnes-robustez`): un nivel "low" interno, nunca expuesto al docente (no es
 * parte de `Speed`, ver el comentario de `razonamientoOverride` en
 * `requestCompletionStream`). Es una corrección mecánica y acotada —el
 * detalle exacto del error ya viaja en el prompt (`autoprueba.ts`,
 * `construirMensajeCorreccion`)—, así que no necesita el razonamiento "high"
 * de A fondo, pero sí un poco más que "none": a diferencia de la corrección
 * de T7/T8 (`velocidad: 'fast'`, razonamiento apagado del todo), acá el
 * modelo tiene que releer un mensaje de error real y ubicarlo en el código,
 * no sólo reescribir con una lista de reglas ya resueltas.
 *
 * Mismo dialecto que `razonamiento()`/`razonamientoEfectivo()`: sin
 * `reasoningEffort` cargado (dialecto desconocido) no se manda nada.
 */
export function razonamientoCorreccion(provider: ProviderConfig): Record<string, unknown> {
  if (!provider.reasoningEffort) return {};

  if (provider.reasoningParam === 'thinking') {
    // MiniMax no tiene niveles: cualquier nivel prendido alcanza para "low".
    return { thinking: { type: 'enabled' } };
  }

  return { reasoning_effort: 'low' };
}

async function intentarUna(
  endpoint: string,
  options: {
    messages: ChatMessage[];
    provider: ProviderConfig;
    signal?: AbortSignal;
    forzarHerramienta?: boolean;
    velocidad?: Speed | null;
    razonamientoOverride?: Record<string, unknown> | null;
    maxTokensOverride?: number | null;
  },
): Promise<Response> {
  const { provider } = options;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: options.messages,
        tools: RESOURCE_TOOLS,
        tool_choice: options.forzarHerramienta
          ? { type: 'function', function: { name: UPDATE_RESOURCE_CODE } }
          : 'auto',
        // Sólo viaja si el motor lo tiene configurado. Los proveedores que no
        // conocen el parámetro contestan 400 si se les manda, así que el
        // default (NULL en el catálogo) es no mandarlo.
        //
        // En DeepSeek va en 'none': armar un HTML es escritura larga, no
        // razonamiento. El thinking cobra tokens y latencia a cambio de poco,
        // rechaza el tool_choice forzado (ver ToolChoiceNoSoportado) e ignora
        // el temperature de acá abajo. T6: pisado por la velocidad efectiva
        // del turno cuando corresponde (`razonamientoEfectivo`); sin ella, es
        // exactamente `razonamiento(provider)` de siempre. T12:
        // `razonamientoOverride` (si vino) manda por encima de las dos — ver
        // el comentario en `requestCompletionStream`.
        ...(options.razonamientoOverride ?? razonamientoEfectivo(provider, options.velocidad ?? null)),
        stream: true,
        temperature: 0.6,
        // Sin esto la API aplica su default (4.096) y todo recurso que pase de
        // ~200 líneas vuelve cortado por la mitad. `maxTokensOverride` (T16)
        // pisa esto para una llamada puntual que no escribe un recurso.
        max_tokens: options.maxTokensOverride ?? provider.maxTokens,
        // Pide el conteo de tokens en el último chunk: es de dónde sale el
        // consumo que se registra por usuario.
        stream_options: { include_usage: true },
      }),
      signal: options.signal,
    });
  } catch (error) {
    throw new ProviderError(
      `No se pudo contactar a ${provider.label}: ${(error as Error).message}`,
    );
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');

    // El 429 se distingue del resto: no es una falla del pedido, es que el
    // proveedor está saturado y conviene volver a intentar.
    if (response.status === 429) {
      throw new ProviderError(
        `${provider.label} está saturado en este momento.`,
        429,
      );
    }

    // Un 400 que se queja del tool_choice no es un pedido mal armado: es un
    // modelo de razonamiento al que no se le puede imponer la herramienta.
    if (response.status === 400 && /tool_choice/i.test(detail)) {
      throw new ToolChoiceNoSoportado(
        `${provider.label} no acepta forzar la herramienta. ${detail.slice(0, 200)}`.trim(),
      );
    }

    throw new ProviderError(
      `${provider.label} respondió ${response.status}. ${detail.slice(0, 300)}`.trim(),
      502,
    );
  }

  return response;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  /**
   * Subconjunto de `promptTokens`, NO un adicional: el dialecto OpenAI cuenta
   * los tokens cacheados COMO PARTE del prompt. Restar antes de facturar es
   * responsabilidad de quien calcule el costo (ver design.md §6) — este
   * módulo sólo reporta lo que el proveedor mandó.
   */
  cachedTokens: number;
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  /** Primer indicio de que empezó a escribir código. Llega MUCHO antes que el
   *  tool call completo (que puede tardar minutos en un recurso grande), así que
   *  es lo único que permite avisarle al docente qué está pasando mientras tanto. */
  | { type: 'tool_start'; name: string }
  /**
   * Fragmento crudo de los `arguments` del tool call, según va llegando (T3,
   * "Progresivo" en odd/tasks/modo-prime.md: cada resultado parcial se
   * muestra apenas existe). `index` es el mismo índice que usa el proveedor
   * para identificar el tool call; `name` es el nombre conocido HASTA ESTE
   * momento (normalmente ya está, porque llega en el mismo delta que abre el
   * tool call). Quien consume esto decide qué hacer con cada uno —
   * `stream.ts` sólo reenvía los que corresponden a `update_resource_code`.
   */
  | { type: 'tool_delta'; index: number; name: string; delta: string }
  /** `truncated` avisa que el modelo llegó al tope de tokens con el tool call a
   *  medio escribir: el JSON de `arguments` está cortado y no se puede parsear. */
  | { type: 'tool'; name: string; arguments: string; truncated: boolean }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: string };

interface PendingToolCall {
  name: string;
  args: string;
}

/**
 * Convierte el SSE del proveedor en eventos ya digeridos.
 *
 * Tres detalles que rompen las implementaciones ingenuas:
 *  - los `arguments` del tool call llegan como fragmentos de string JSON
 *    repartidos entre muchos deltas, hay que acumularlos por `index`;
 *  - un chunk TCP puede cortar un evento por la mitad, así que se bufferea
 *    hasta encontrar el separador de eventos (`\n\n`);
 *  - hay gateways que emiten el SSE con CRLF, y entonces `\n\n` NUNCA aparece
 *    (la secuencia real es `\r\n\r\n`): sin normalizar, el stream entero queda
 *    en el buffer y el turno termina mudo. Por eso se normalizan los saltos.
 */
export async function* readCompletionStream(response: Response): AsyncGenerator<StreamEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const toolCalls = new Map<number, PendingToolCall>();

  let buffer = '';
  let finished = false;
  let finishReason = '';
  let announcedTool = false;

  function* flushToolCalls(): Generator<StreamEvent> {
    const truncated = finishReason === 'length';
    for (const [, call] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
      if (call.name) {
        yield { type: 'tool', name: call.name, arguments: call.args, truncated };
      }
    }
    toolCalls.clear();
  }

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;

      // Se normaliza el buffer completo (y no el chunk suelto) porque un `\r\n`
      // puede quedar partido justo en el corte entre dos chunks TCP.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');

      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const rawEvent = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf('\n\n');

        // Un evento SSE puede traer varias líneas `data:`; se concatenan.
        const payload = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('');

        if (!payload) continue;
        if (payload === '[DONE]') {
          finished = true;
          break;
        }

        let chunk: any;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue; // fragmento inválido: lo ignoramos en vez de cortar el stream
        }

        // El chunk del consumo viene sin `choices`, así que se lee antes de
        // descartar los chunks vacíos.
        if (chunk?.usage) {
          yield {
            type: 'usage',
            usage: {
              promptTokens: Number(chunk.usage.prompt_tokens ?? 0),
              completionTokens: Number(chunk.usage.completion_tokens ?? 0),
              // Subconjunto de prompt_tokens, no un extra (ver el comentario
              // en la interfaz TokenUsage más arriba).
              cachedTokens: Number(chunk.usage.prompt_tokens_details?.cached_tokens ?? 0),
            },
          };
        }

        const choice = chunk?.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta ?? {};

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          yield { type: 'text', delta: delta.content };
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const toolCall of delta.tool_calls) {
            const index = typeof toolCall.index === 'number' ? toolCall.index : 0;
            const pending = toolCalls.get(index) ?? { name: '', args: '' };

            if (toolCall.function?.name) pending.name = toolCall.function.name;

            if (!announcedTool && pending.name) {
              announcedTool = true;
              yield { type: 'tool_start', name: pending.name };
            }
            if (typeof toolCall.function?.arguments === 'string') {
              pending.args += toolCall.function.arguments;

              // El delta crudo (T3): se emite ADEMÁS del acumulado de
              // arriba, nunca en su reemplazo — `flushToolCalls` sigue
              // leyendo `pending.args` completo al final, así que este yield
              // no cambia en nada el comportamiento existente. Vacío no se
              // anuncia: no hay nada nuevo que mostrar y sólo ensuciaría el
              // SSE con frames sin contenido.
              if (toolCall.function.arguments.length > 0) {
                yield { type: 'tool_delta', index, name: pending.name, delta: toolCall.function.arguments };
              }
            }

            toolCalls.set(index, pending);
          }
        }

        if (choice.finish_reason) {
          // Se guarda ANTES de vaciar: `flushToolCalls` lo lee para marcar el
          // tool call como cortado cuando la razón es "length".
          finishReason = String(choice.finish_reason);
          yield* flushToolCalls();
          yield { type: 'finish', reason: finishReason };
        }
      }
    }

    // Si el proveedor cerró sin `finish_reason`, no perdemos el tool call.
    yield* flushToolCalls();
  } finally {
    reader.releaseLock();
  }
}
