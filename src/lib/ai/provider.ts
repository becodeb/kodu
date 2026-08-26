import { getEnv } from '../env.ts';
import { RESOURCE_TOOLS, UPDATE_RESOURCE_CODE } from './tools.ts';

/**
 * Capa de proveedores de IA. El backend actúa de proxy seguro: las API keys
 * viven sólo acá (SPEC §1) y el navegador nunca las ve.
 *
 * El motor de trabajo es MINIMAX (MiniMax M3 por GMI Cloud): gratuito, con
 * contexto largo y multimodal.
 *
 * DEEPSEEK queda BAJO LLAVE: no se ofrece en la interfaz y ningún docente puede
 * elegirlo. Se usa solo, y únicamente, cuando MiniMax agota sus reintentos —
 * es el paracaídas, no una opción. Se paga por token, así que abrirlo como
 * opción es abrir la canilla.
 *
 * ALPHA quedó fuera de servicio (dejó de ser gratuito). El valor sigue en el
 * enum porque hay recursos y consumo histórico que lo referencian, pero ya no
 * se ofrece ni se resuelve: los proyectos que lo tenían se migraron a MiniMax.
 *
 * Todos hablan el dialecto OpenAI (`/chat/completions` con `stream: true`), así
 * que el parser de abajo sirve para cualquiera y para el que venga después.
 */

export type ModelChoice = 'ALPHA' | 'DEEPSEEK' | 'MINIMAX';

/** Lo que un docente puede elegir. DeepSeek NO está: es sólo el respaldo. */
export const MODEL_CHOICES: ModelChoice[] = ['MINIMAX'];

/** El motor por defecto de toda la plataforma. */
export const MODELO_PRINCIPAL: ModelChoice = 'MINIMAX';

/** El respaldo automático, que nadie elige a mano. */
export const MODELO_RESPALDO: ModelChoice = 'DEEPSEEK';

/**
 * Un docente sólo puede pedir lo que está en MODEL_CHOICES. Cualquier otra cosa
 * —un proyecto viejo guardado con ALPHA, o alguien probando con DEEPSEEK en el
 * body del pedido— cae al principal.
 */
export function normalizarEleccion(choice: ModelChoice | null | undefined): ModelChoice {
  return choice && MODEL_CHOICES.includes(choice) ? choice : MODELO_PRINCIPAL;
}

export interface ProviderConfig {
  choice: ModelChoice;
  label: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  /** Tope de tokens por usuario. 0 = sin tope. */
  userTokenLimit: number;
  /** Largo máximo de un mensaje del docente, en caracteres. */
  maxInputChars: number;
}

export function resolveProvider(choice: ModelChoice): ProviderConfig {
  const env = getEnv();

  if (choice === 'MINIMAX') {
    return {
      choice,
      label: 'MiniMax M3',
      apiKey: env.AI_MINIMAX_API_KEY,
      baseUrl: env.AI_MINIMAX_BASE_URL,
      model: env.AI_MINIMAX_MODEL,
      maxTokens: env.AI_MINIMAX_MAX_TOKENS,
      userTokenLimit: env.AI_MINIMAX_USER_TOKEN_LIMIT,
      maxInputChars: env.AI_MINIMAX_MAX_INPUT_CHARS,
    };
  }

  if (choice === 'DEEPSEEK') {
    return {
      choice,
      label: 'DeepSeek',
      apiKey: env.AI_DEEPSEEK_API_KEY,
      baseUrl: env.AI_DEEPSEEK_BASE_URL,
      model: env.AI_DEEPSEEK_MODEL,
      maxTokens: env.AI_DEEPSEEK_MAX_TOKENS,
      userTokenLimit: env.AI_DEEPSEEK_USER_TOKEN_LIMIT,
      maxInputChars: env.AI_DEEPSEEK_MAX_INPUT_CHARS,
    };
  }

  // ALPHA ya no se sirve: cualquier cosa que no sea DeepSeek cae en MiniMax.
  return {
    choice: 'MINIMAX',
    label: 'MiniMax M3',
    apiKey: env.AI_MINIMAX_API_KEY,
    baseUrl: env.AI_MINIMAX_BASE_URL,
    model: env.AI_MINIMAX_MODEL,
    maxTokens: env.AI_MINIMAX_MAX_TOKENS,
    userTokenLimit: env.AI_MINIMAX_USER_TOKEN_LIMIT,
    maxInputChars: env.AI_MINIMAX_MAX_INPUT_CHARS,
  };
}

/** El respaldo cuando el motor principal no da más. */
export function alternateChoice(choice: ModelChoice): ModelChoice {
  return choice === MODELO_RESPALDO ? MODELO_PRINCIPAL : MODELO_RESPALDO;
}

export function isChoiceConfigured(choice: ModelChoice): boolean {
  return resolveProvider(choice).apiKey.length > 0;
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

export function supportsVision(choice: ModelChoice): boolean {
  // MiniMax M3 lee imágenes. DeepSeek es sólo texto: mandarle partes
  // `image_url` hace que la API conteste 400 y se caiga el turno.
  return choice !== 'DEEPSEEK' && getEnv().AI_VISION;
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
}): Promise<Response> {
  const { provider } = options;

  if (!provider.apiKey) {
    throw new ProviderError(
      `El servidor no tiene configurada la clave de ${provider.label}.`,
      503,
    );
  }

  const endpoint = `${provider.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;

  for (let intento = 0; ; intento++) {
    try {
      return await intentarUna(endpoint, options);
    } catch (error) {
      const saturado = error instanceof ProviderError && error.status === 429;
      if (!saturado || intento >= REINTENTOS.length) throw error;

      const espera = REINTENTOS[intento]!;
      options.onReintento?.(intento + 1, espera);
      await esperar(espera, options.signal);
    }
  }
}

async function intentarUna(
  endpoint: string,
  options: {
    messages: ChatMessage[];
    provider: ProviderConfig;
    signal?: AbortSignal;
    forzarHerramienta?: boolean;
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
        stream: true,
        temperature: 0.6,
        // Sin esto la API aplica su default (4.096) y todo recurso que pase de
        // ~200 líneas vuelve cortado por la mitad.
        max_tokens: provider.maxTokens,
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
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  /** Primer indicio de que empezó a escribir código. Llega MUCHO antes que el
   *  tool call completo (que puede tardar minutos en un recurso grande), así que
   *  es lo único que permite avisarle al docente qué está pasando mientras tanto. */
  | { type: 'tool_start'; name: string }
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
