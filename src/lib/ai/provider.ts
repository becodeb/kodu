import Anthropic from '@anthropic-ai/sdk';
import type { Stream } from '@anthropic-ai/sdk/core/streaming';
import type {
  MessageCreateParamsStreaming,
  MessageParam,
  ContentBlockParam,
  Tool as AnthropicToolDef,
  ToolChoice as AnthropicToolChoice,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import type { Prisma } from '../../generated/prisma/client.ts';
import { getEnv } from '../env.ts';
import { RESOURCE_TOOLS, UPDATE_RESOURCE_CODE, EDIT_RESOURCE_CODE, EDIT_RESOURCE_TOOL, type AiTool } from './tools.ts';
import type { PriceSchedule } from './pricing.ts';

/**
 * T1 (motor-claude): el stream crudo que devuelve el SDK de Anthropic
 * (`client.messages.create({..., stream:true})`) para una llamada en curso.
 * No es un `fetch` Response — es la pieza que `readCompletionStream` itera
 * cuando `apiFormat === 'anthropic'`, mismo rol que la `Response` del
 * dialecto OpenAI para las otras dos.
 */
export type AnthropicRawStream = Stream<RawMessageStreamEvent>;

/**
 * Lo que devuelve `requestCompletionStream`: una `Response` HTTP de verdad
 * para chat/responses, o el stream crudo del SDK para `anthropic`. Todo
 * llamador que sólo reenvía esto a `readCompletionStream` (que ya sabe
 * distinguir por `apiFormat`) puede tipar su variable local con esto en vez
 * de `Response` a secas.
 */
export type CompletionHandle = Response | AnthropicRawStream;

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

/**
 * T2 (verificador): "chat" (Chat Completions, el dialecto de siempre) o
 * "responses" (OpenAI Responses API — la única que combina function tools
 * con razonamiento para gpt-6-luna), o "anthropic" (T1, `motor-claude`: la
 * Messages API nativa de Anthropic — único dialecto que soporta prompt
 * caching de verdad, efecto "effort" con thinking adaptativo y el precio de
 * escritura de cache). Viene de `AiProvider.apiFormat` (catalogo.ts), no de
 * `AiModel`: es la cuenta entera la que habla un dialecto u otro, no un
 * motor puntual.
 */
export type ApiFormat = 'chat' | 'responses' | 'anthropic';

/** Lo que hace falta para pedirle un turno a un motor concreto. */
export interface ProviderConfig {
  /** El `id` de la fila `AiModel` que produjo esta config. */
  id: string;
  label: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  /** T2: campo requerido — no hay default acá, el catálogo (o el test que
   *  arme un `ProviderConfig` a mano) siempre lo manda explícito. */
  apiFormat: ApiFormat;
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
  /** Con qué nombre viaja: "reasoning_effort" (default), "thinking", o
   *  "effort" (T1, `motor-claude`: Anthropic — `thinking:{type:'adaptive'}` +
   *  `output_config:{effort}`, nunca el `budget_tokens` viejo). */
  reasoningParam: string | null;
  /** `null` si a este motor le falta algún precio: nunca se inventa un costo. */
  precios: {
    input: Prisma.Decimal;
    output: Prisma.Decimal;
    cachedInput: Prisma.Decimal | null;
    /** T1 (motor-claude): tarifa de escritura de cache (`AiModel.priceCacheWritePerMToken`).
     *  `null`/`undefined` = sin cargar — ver el default en `usage.ts`. */
    cacheWrite?: Prisma.Decimal | null;
  } | null;
  /** odd/tasks/ahorro-tokens.md (T1): `null` = no time-of-day schedule, the
   *  flat `precios` above always applies (today's behavior). */
  schedule: PriceSchedule | null;
}

/**
 * Partes de un mensaje multimodal (formato OpenAI). Sólo se usan cuando
 * `AI_VISION` está prendido: un modelo de sólo texto rechaza el array con 400.
 */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  /**
   * T2 (verificador): sólo tiene sentido con `role: 'assistant'`, mismo
   * shape que el `tool_calls` de una respuesta real de Chat Completions.
   * Ningún llamador de esta app arma HOY un historial con tool round-trip
   * (cada turno llama la herramienta una vez y termina, nunca se le
   * devuelve el resultado como mensaje 'tool' para que siga la conversación)
   * — existe para que `aResponsesBody` (más abajo) tenga a qué traducir si
   * eso cambia, sin quedar corto contra la forma real de Chat Completions.
   */
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  /** T2: sólo con `role: 'tool'` — a qué `tool_calls[].id` responde. */
  tool_call_id?: string;
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
   * T12 (round 3, `arnes-robustez`): anula `razonamiento(provider)` con un
   * objeto YA ARMADO — usan esto la autocorrección de la autoprueba ("low",
   * `razonamientoCorreccion`), el verificador ("medium",
   * `razonamientoVerificador`) y el checklist ("none", `razonamientoNulo`),
   * ninguno de los tres expuesto al docente. `undefined`/`null` =
   * comportamiento de siempre (`razonamiento(provider)`: exactamente el
   * `reasoningEffort` configurado en el motor, sin pisar nada).
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
  /**
   * T20 (round 5, `arnes-robustez`): para una llamada AUXILIAR que nunca
   * escribe el recurso (hoy sólo el checklist, `generarChecklist` en
   * `stream.ts`), el pedido no manda NI `tools` NI `tool_choice` — se
   * OMITEN las dos claves entero, no `tool_choice: 'none'`. Medido contra
   * DeepSeek real: con `tools: RESOURCE_TOOLS` + `tool_choice: 'auto'` y
   * razonamiento `none`, el modelo llamó `update_resource_code` y se puso a
   * escribir HTML en vez de texto — 8 de 8 pedidos reales de checklist. Sin
   * `tools` el mismo pedido devolvió 6 ítems en 188 tokens. Incompatible con
   * `forzarHerramienta`: si viene `true` junto con `sinHerramientas: true`,
   * `sinHerramientas` GANA y `forzarHerramienta` se ignora — no tiene
   * sentido "forzar" una herramienta que ni se ofrece, y una llamada que ya
   * pide "sin herramientas" es por definición una llamada que no escribe el
   * recurso. `undefined`/`false` = comportamiento de siempre (`tools` +
   * `tool_choice` según `forzarHerramienta`).
   */
  sinHerramientas?: boolean;
  /**
   * odd/tasks/ahorro-tokens.md (T3a/T6): además de `update_resource_code`,
   * ofrece `edit_resource_code` (edición por fragmentos). Sólo tiene sentido
   * en un turno de AJUSTE — nunca para un recurso nuevo (`stream.ts`/
   * `autocorreccion.ts` deciden eso antes de llamar acá). Con
   * `forzarHerramienta: true` y `editsEnabled: true` (y `soloEdicion` en
   * `false`), `tool_choice` pasa a `'required'` (cualquiera de las dos, no
   * una en particular) — eso es SÓLO la recuperación de una edición fallida
   * (ver `soloEdicion`). `undefined`/`false` = comportamiento de siempre.
   */
  editsEnabled?: boolean;
  /**
   * odd/tasks/ahorro-tokens.md (T6): el primer intento de un turno de
   * AJUSTE ofrece ÚNICAMENTE `edit_resource_code` (`tools` trae una sola
   * entrada y `tool_choice` la nombra por nombre, nunca `'required'`) — tras
   * la evaluación ciega (T3c), fragmentos es el único camino de edición, y
   * `update_resource_code` queda reservado para un recurso nuevo o para la
   * única recuperación tras una edición fallida en el mismo turno (esa
   * recuperación manda `editsEnabled: true, soloEdicion: false` para volver
   * a ofrecer las dos). Sin efecto si `editsEnabled` es `false`.
   */
  soloEdicion?: boolean;
}): Promise<Response | AnthropicRawStream> {
  const { provider } = options;

  if (!provider.apiKey) {
    throw new ProviderError(
      `El servidor no tiene configurada la clave de ${provider.label}.`,
      503,
    );
  }

  // T2: la Responses API vive en otro path del mismo `baseUrl` — el resto de
  // la cadena de reintentos (429, tool_choice no soportado) no cambia según
  // el formato, así que sólo el path se bifurca acá.
  const endpoint = `${provider.baseUrl.replace(/\/+$/, '')}/v1/${provider.apiFormat === 'responses' ? 'responses' : 'chat/completions'}`;

  // La obligación de llamar la herramienta se puede aflojar sobre la marcha:
  // ver ToolChoiceNoSoportado. Es una sola vez, y no gasta ninguno de los
  // intentos reservados para la saturación.
  //
  // T20: `sinHerramientas` gana por encima de `forzarHerramienta` — ver el
  // comentario de `sinHerramientas` más arriba. No tiene sentido "aflojar"
  // una obligación que nunca se mandó.
  const sinHerramientas = options.sinHerramientas ?? false;
  let forzar = !sinHerramientas && (options.forzarHerramienta ?? false);
  let yaAflojo = false;
  let saturaciones = 0;

  for (;;) {
    try {
      return await intentarUna(endpoint, {
        messages: options.messages,
        provider: options.provider,
        signal: options.signal,
        forzarHerramienta: forzar,
        razonamientoOverride: options.razonamientoOverride,
        maxTokensOverride: options.maxTokensOverride,
        sinHerramientas,
        editsEnabled: options.editsEnabled ?? false,
        soloEdicion: options.soloEdicion ?? false,
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

  // T1 (motor-claude): vocabulario intermedio — `anthropicRazonamientoBody`
  // (más abajo) es quien lo traduce a `thinking`/`output_config` de verdad,
  // porque esa traducción depende del MODELO (Haiku acepta `disabled`,
  // Sonnet/Opus no) y acá sólo tenemos el `ProviderConfig`.
  if (provider.reasoningParam === 'effort') {
    return { effort: provider.reasoningEffort };
  }

  return { reasoning_effort: provider.reasoningEffort };
}

/**
 * El razonamiento "none" fijo del paso de checklist (T16/T20,
 * `arnes-robustez`), sin importar el nivel configurado en el motor. Nunca
 * expuesto al docente — es un paso auxiliar corto, no una elección de
 * velocidad (odd/tasks/generacion-simple-y-reanudable.md sacó por completo la
 * noción de velocidad elegible por el docente; generación y ajustes usan
 * exactamente `razonamiento(provider)`, el nivel que el motor tiene
 * configurado, sin pisar nada).
 *
 * Mismo dialecto que `razonamiento()`: sin `reasoningEffort` cargado
 * (dialecto desconocido) no se manda nada.
 */
export function razonamientoNulo(provider: ProviderConfig): Record<string, unknown> {
  if (!provider.reasoningEffort) return {};

  if (provider.reasoningParam === 'thinking') {
    return { thinking: { type: 'disabled' } };
  }

  if (provider.reasoningParam === 'effort') {
    return { effort: 'none' };
  }

  return { reasoning_effort: 'none' };
}

/**
 * El razonamiento de la autocorrección de la autoprueba (T12, round 3 de
 * `arnes-robustez`): un nivel "low" interno, nunca expuesto al docente. Es
 * una corrección mecánica y acotada —el detalle exacto del error ya viaja en
 * el prompt (`autoprueba.ts`, `construirMensajeCorreccion`)—, así que no
 * necesita el "high" que trae un motor bien configurado, pero sí un poco más
 * que "none": el modelo tiene que releer un mensaje de error real y ubicarlo
 * en el código, no sólo reescribir con una lista de reglas ya resueltas.
 *
 * Mismo dialecto que `razonamiento()`: sin `reasoningEffort` cargado
 * (dialecto desconocido) no se manda nada.
 */
export function razonamientoCorreccion(provider: ProviderConfig): Record<string, unknown> {
  if (!provider.reasoningEffort) return {};

  if (provider.reasoningParam === 'thinking') {
    // MiniMax no tiene niveles: cualquier nivel prendido alcanza para "low".
    return { thinking: { type: 'enabled' } };
  }

  if (provider.reasoningParam === 'effort') {
    return { effort: 'low' };
  }

  return { reasoning_effort: 'low' };
}

/**
 * El razonamiento del verificador (T3, `odd/tasks/verificador.md`): "medium"
 * fijo, sin importar el nivel configurado en el motor ni el "low" de
 * `razonamientoCorreccion`. A diferencia de la corrección mecánica de la autoprueba (el error exacto
 * ya viaja en el prompt), un revisor tiene que releer el HTML entero y
 * razonar sobre lógica/contenido/pedido desde cero.
 *
 * Mismo dialecto que el resto de este archivo: sin `reasoningEffort`
 * cargado (proveedor de dialecto desconocido) no se manda nada. MiniMax no
 * tiene niveles — mismo criterio que `razonamientoCorreccion`: cualquier
 * nivel prendido alcanza para "medium" (`thinking: {type: 'enabled'}`).
 */
export function razonamientoVerificador(provider: ProviderConfig): Record<string, unknown> {
  if (!provider.reasoningEffort) return {};

  if (provider.reasoningParam === 'thinking') {
    return { thinking: { type: 'enabled' } };
  }

  if (provider.reasoningParam === 'effort') {
    return { effort: 'medium' };
  }

  return { reasoning_effort: 'medium' };
}

/**
 * T5 (motor-claude): el razonamiento del revisor VISUAL — "low" fijo, a
 * propósito más bajo que el "medium" de `razonamientoVerificador` de
 * arriba. Esta pasada tiene una sola mirada muy concreta (lo que se VE en
 * una captura + el contrato ya resumido en el prompt), no una relectura de
 * lógica/contenido desde cero como el revisor de sólo texto — y el
 * presupuesto de tiempo de esta pasada (odd/tasks/motor-claude.md, T5) es
 * mucho más chico. Mismo dialecto defensivo que el resto del archivo.
 */
export function razonamientoRevisorVisual(provider: ProviderConfig): Record<string, unknown> {
  if (!provider.reasoningEffort) return {};

  if (provider.reasoningParam === 'thinking') {
    return { thinking: { type: 'enabled' } };
  }

  if (provider.reasoningParam === 'effort') {
    return { effort: 'low' };
  }

  return { reasoning_effort: 'low' };
}

/**
 * De los niveles que puede tener `AiModel.reasoningEffort` (y el nivel
 * "medium" interno que sólo usa `razonamientoOverride`, T3 del verificador)
 * al vocabulario de `reasoning.effort` en la Responses API. `max` ya no es un
 * nivel que la app produzca (la migración `20261006000000_quitar_prime` lo
 * bajó a `high` en el catálogo), pero el mapeo se deja igual como red de
 * seguridad ante cualquier dato viejo que todavía lo tenga guardado — nunca
 * se inventa un nivel nuevo.
 */
const NIVEL_RESPONSES: Record<string, string> = {
  none: 'none',
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'high',
};

/**
 * Traduce el objeto que ya arma `razonamiento()`/`razonamientoEfectivo()`
 * (dialecto Chat Completions: `{reasoning_effort: nivel}`, o si el motor
 * fuera MiniMax `{thinking: {...}}`) al de la Responses API:
 * `{reasoning: {effort}}`. Un motor `apiFormat: 'responses'` es siempre
 * OpenAI (la única API que combina tools con razonamiento), así que el
 * único dialecto de entrada que puede llegar acá es `reasoning_effort` —
 * cualquier otra forma (o el objeto vacío de un motor sin razonamiento
 * configurado) no manda nada, mismo criterio de "no inventarle un parámetro
 * a un proveedor" que ya sigue `razonamiento()`.
 */
function razonamientoParaResponses(chatReasoning: Record<string, unknown>): Record<string, unknown> {
  const nivel = chatReasoning.reasoning_effort;
  if (typeof nivel !== 'string') return {};
  return { reasoning: { effort: NIVEL_RESPONSES[nivel] ?? nivel } };
}

/** El texto plano de un `content` de `ChatMessage`, ignorando las partes de
 *  imagen — mismo criterio que `texto()` en `proxy-responses.mjs`. */
function textoDeContenido(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content.map((parte) => (parte.type === 'text' ? parte.text : '')).join('');
}

/** El `content` de un mensaje 'user' en la forma que espera `input` de la
 *  Responses API: string tal cual, o partes `input_text`/`input_image`. */
function partesDeContenido(content: string | ContentPart[]): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content;
  return content.map((parte) =>
    parte.type === 'image_url'
      ? { type: 'input_image', image_url: parte.image_url.url }
      : { type: 'input_text', text: parte.text },
  );
}

/**
 * `messages` (dialecto Chat Completions) a `input` (Responses API), ported
 * de `aResponses` en `experimentos/razonamiento/proxy-responses.mjs`:
 * system → `{role:'system'}`, user → partes `input_text`/`input_image`,
 * assistant (texto + `tool_calls`) → texto suelto más un `function_call` por
 * cada llamada, `tool` → `function_call_output`. Ver el comentario de
 * `tool_calls`/`tool_call_id` en `ChatMessage` más arriba: hoy ningún
 * llamador arma un mensaje 'tool' o un 'assistant' con `tool_calls`, pero el
 * mapeo los soporta igual.
 */
function aResponsesInput(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  for (const mensaje of messages) {
    if (mensaje.role === 'system') {
      input.push({ role: 'system', content: textoDeContenido(mensaje.content) });
    } else if (mensaje.role === 'user') {
      input.push({ role: 'user', content: partesDeContenido(mensaje.content) });
    } else if (mensaje.role === 'assistant') {
      const texto = textoDeContenido(mensaje.content);
      if (texto) input.push({ role: 'assistant', content: texto });
      for (const llamada of mensaje.tool_calls ?? []) {
        input.push({
          type: 'function_call',
          call_id: llamada.id,
          name: llamada.function.name,
          arguments: llamada.function.arguments ?? '',
        });
      }
    } else if (mensaje.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: mensaje.tool_call_id ?? '',
        output: textoDeContenido(mensaje.content),
      });
    }
  }
  return input;
}

/**
 * El body de un pedido a `/v1/responses` (T2, `apiFormat: 'responses'`).
 * `forzarHerramienta`/`sinHerramientas` ya llegan resueltos por el llamador
 * (`requestCompletionStream` ya aplicó "sinHerramientas gana" antes de
 * pasarlos para acá) — acá sólo falta decidir si la clave `tools`/
 * `tool_choice` viaja o no, igual que en el body de Chat Completions.
 * Nunca manda `temperature` (los modelos de razonamiento de OpenAI la
 * rechazan) y siempre `store: false` (nada de este turno se guarda del lado
 * de OpenAI).
 */
/**
 * odd/tasks/ahorro-tokens.md (T3a/T6): las herramientas de escritura del
 * recurso a ofrecer este pedido. `soloEdicion` (T6) manda primero: el
 * primer intento de un AJUSTE ofrece ÚNICAMENTE `EDIT_RESOURCE_TOOL`. Si
 * no, `RESOURCE_TOOLS` siempre, más `EDIT_RESOURCE_TOOL` cuando
 * `editsEnabled` (hoy sólo la recuperación de una edición fallida, ver el
 * comentario de `soloEdicion` en `requestCompletionStream`).
 */
function herramientasDeEscritura(editsEnabled: boolean, soloEdicion: boolean): AiTool[] {
  if (soloEdicion) return [EDIT_RESOURCE_TOOL];
  return editsEnabled ? [...RESOURCE_TOOLS, EDIT_RESOURCE_TOOL] : RESOURCE_TOOLS;
}

/**
 * `soloEdicion` fuerza `edit_resource_code` por nombre — es la única
 * herramienta ofrecida, así que nombrarla no le saca nada al modelo. Forzar
 * con las DOS herramientas ofrecidas (`editsEnabled` sin `soloEdicion`) usa
 * `'required'` (cualquiera de las dos, no un nombre fijo) — forzar
 * `update_resource_code` por nombre ahí le sacaría al modelo la posibilidad
 * de resolver con fragmentos. Sin ninguna de las dos, siempre
 * `update_resource_code` por nombre (recurso nuevo).
 */
function eleccionForzada(
  editsEnabled: boolean,
  soloEdicion: boolean,
): 'required' | { type: 'function'; function: { name: string } } {
  if (soloEdicion) return { type: 'function', function: { name: EDIT_RESOURCE_CODE } };
  return editsEnabled ? 'required' : { type: 'function', function: { name: UPDATE_RESOURCE_CODE } };
}

function aResponsesBody(options: {
  provider: ProviderConfig;
  messages: ChatMessage[];
  forzarHerramienta: boolean;
  sinHerramientas: boolean;
  editsEnabled: boolean;
  soloEdicion: boolean;
  razonamiento: Record<string, unknown>;
  maxTokens: number;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.provider.model,
    input: aResponsesInput(options.messages),
    store: false,
    stream: true,
  };

  if (!options.sinHerramientas) {
    body.tools = herramientasDeEscritura(options.editsEnabled, options.soloEdicion).map((tool) => ({
      type: 'function' as const,
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    }));
    body.tool_choice = options.forzarHerramienta
      ? options.soloEdicion
        ? { type: 'function', name: EDIT_RESOURCE_CODE }
        : options.editsEnabled
          ? 'required'
          : { type: 'function', name: UPDATE_RESOURCE_CODE }
      : 'auto';
  }

  Object.assign(body, razonamientoParaResponses(options.razonamiento));

  // Mismo motivo que `max_tokens` en Chat Completions: sin esto la API
  // aplica su propio default y un recurso grande vuelve cortado a la mitad.
  body.max_output_tokens = options.maxTokens;

  return body;
}

/**
 * T1 (motor-claude): el `content` de un mensaje `user`/`assistant`/`tool`
 * (dialecto Chat Completions) a bloques de contenido de la Messages API de
 * Anthropic. `image_url` con una data URL (`data:<mime>;base64,<...>`) se
 * traduce a un bloque `image` en base64 — es la forma en que todo este
 * archivo ya recibe las imágenes (ver `readImageAsDataUrl` del lado del
 * llamador); una URL http(s) sin ese prefijo se manda como `source: {type:
 * 'url'}` igual, por si algún día deja de ser siempre base64.
 */
function aAnthropicUserContent(content: string | ContentPart[]): string | ContentBlockParam[] {
  if (typeof content === 'string') return content;
  return content.map((parte): ContentBlockParam => {
    if (parte.type === 'text') return { type: 'text', text: parte.text };

    const dataUrl = /^data:([^;]+);base64,([\s\S]+)$/.exec(parte.image_url.url);
    if (dataUrl) {
      return {
        type: 'image',
        source: { type: 'base64', media_type: dataUrl[1] as never, data: dataUrl[2]! },
      };
    }
    return { type: 'image', source: { type: 'url', url: parte.image_url.url } };
  });
}

/**
 * `messages` (dialecto Chat Completions) a `{system, messages}` de la
 * Messages API: el mensaje `system` sale del top-level `system` (nunca va
 * adentro de `messages`, a diferencia de Chat Completions); `tool_calls` del
 * asistente se vuelven bloques `tool_use`; un mensaje `tool` se vuelve un
 * bloque `tool_result` DENTRO de un mensaje `user` — fusionado con el
 * anterior si ya era una tanda de `tool_result` consecutiva (la API exige
 * que todos los resultados de una misma tanda de tool calls paralelos viajen
 * en un solo mensaje `user`, nunca repartidos).
 *
 * El `system` vuelve como un array de UN bloque con `cache_control:
 * {type:'ephemeral'}` — alcanza con esa única marca porque el orden de
 * render de la API es `tools` → `system` → `messages`: un breakpoint en el
 * bloque de `system` ya cachea los `tools` que vinieron antes.
 */
/**
 * T7 (motor-claude, nota "cross-model"): exportada SOLO para
 * `e2e/unidad-mensajes-anthropic.ts` — confirma que un historial con un turno
 * `assistant` nunca produce un bloque `thinking` hacia la Messages API. No
 * hay ningún camino de código que PUEDA hacerlo: `ChatMessage` (el tipo
 * intermedio que arma esta función) no tiene ningún campo para guardar un
 * bloque de razonamiento, y `readCompletionStream` (más abajo, dialecto
 * Anthropic) ignora `thinking_delta`/`signature_delta`/`citations_delta` al
 * leer la respuesta — nunca llegan a guardarse en el historial de
 * `ChatMessage` de la base, así que cambiar de modelo entre turnos (T7,
 * modos de generación) nunca reenvía el razonamiento de OTRO modelo.
 */
export function aAnthropicMessages(messages: ChatMessage[]): {
  system?: Array<{ type: 'text'; text: string; cache_control: { type: 'ephemeral' } }>;
  messages: MessageParam[];
} {
  let systemText = '';
  const out: MessageParam[] = [];

  for (const mensaje of messages) {
    if (mensaje.role === 'system') {
      systemText += (systemText ? '\n\n' : '') + textoDeContenido(mensaje.content);
      continue;
    }

    if (mensaje.role === 'user') {
      out.push({ role: 'user', content: aAnthropicUserContent(mensaje.content) });
      continue;
    }

    if (mensaje.role === 'assistant') {
      const bloques: ContentBlockParam[] = [];
      const texto = textoDeContenido(mensaje.content);
      if (texto) bloques.push({ type: 'text', text: texto });
      for (const llamada of mensaje.tool_calls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(llamada.function.arguments || '{}');
        } catch {
          input = {};
        }
        bloques.push({ type: 'tool_use', id: llamada.id, name: llamada.function.name, input });
      }
      out.push({ role: 'assistant', content: bloques.length > 0 ? bloques : texto });
      continue;
    }

    if (mensaje.role === 'tool') {
      const bloque: ContentBlockParam = {
        type: 'tool_result',
        tool_use_id: mensaje.tool_call_id ?? '',
        content: textoDeContenido(mensaje.content),
      };
      const ultimo = out[out.length - 1];
      const ultimoEsTandaDeResultados =
        ultimo?.role === 'user' &&
        Array.isArray(ultimo.content) &&
        ultimo.content.length > 0 &&
        ultimo.content.every((b) => (b as { type?: string }).type === 'tool_result');
      if (ultimoEsTandaDeResultados) {
        (ultimo!.content as ContentBlockParam[]).push(bloque);
      } else {
        out.push({ role: 'user', content: [bloque] });
      }
    }
  }

  return {
    system: systemText ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }] : undefined,
    messages: out,
  };
}

/** `AiTool[]` (dialecto Chat Completions) a `Tool[]` de Anthropic.
 *  `strict: true` sólo cuando el schema ya trae `additionalProperties:false`
 *  Y `required` (ver tools.ts) — "donde el schema lo permite", nunca
 *  forzado: un schema que no cumple eso se manda sin `strict`, nunca se le
 *  inventa la propiedad. */
function aAnthropicTools(tools: AiTool[]): AnthropicToolDef[] {
  return tools.map((tool) => {
    const schema = tool.function.parameters as {
      type?: string;
      properties?: unknown;
      required?: unknown;
      additionalProperties?: unknown;
    };
    const esEstricto = schema.additionalProperties === false && Array.isArray(schema.required);
    return {
      name: tool.function.name,
      description: tool.function.description,
      input_schema: schema as AnthropicToolDef['input_schema'],
      ...(esEstricto ? { strict: true as const } : {}),
    };
  });
}

/** Mismo criterio que `eleccionForzada` (dialecto OpenAI) pero con el
 *  vocabulario de `tool_choice` de Anthropic: `{type:'tool', name}` para una
 *  herramienta puntual, `{type:'any'}` para "cualquiera de las ofrecidas". */
function eleccionForzadaAnthropic(editsEnabled: boolean, soloEdicion: boolean): AnthropicToolChoice {
  if (soloEdicion) return { type: 'tool', name: EDIT_RESOURCE_CODE };
  return editsEnabled ? { type: 'any' } : { type: 'tool', name: UPDATE_RESOURCE_CODE };
}

/**
 * Traduce el vocabulario intermedio que ya arman `razonamiento()` y
 * compañía para `reasoningParam === 'effort'` (`{effort: nivel}`) al cuerpo
 * real de la Messages API: `thinking` + `output_config.effort`.
 *
 * La razón de que esto viva separado de `razonamiento()` es que la
 * traducción depende del MODELO, no sólo del nivel: sólo Haiku 5.5 acepta
 * `thinking:{type:'disabled'}` — Sonnet 5.5 y Opus 5.5 contestan 400 con eso,
 * así que ahí "none" se manda como `effort:'low'` en su lugar (instrucción
 * explícita de motor-claude, no un invento de este archivo). Nunca manda
 * `budget_tokens`, `temperature`, `top_p` ni `top_k` — esos cuatro quedan
 * fuera del body entero de Anthropic en este archivo.
 */
function anthropicRazonamientoBody(provider: ProviderConfig, chatReasoning: Record<string, unknown>): Record<string, unknown> {
  const nivel = chatReasoning.effort;
  if (typeof nivel !== 'string') return {};

  const esHaiku = provider.model.includes('haiku');

  if (nivel === 'none') {
    if (esHaiku) return { thinking: { type: 'disabled' } };
    return { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } };
  }

  return { thinking: { type: 'adaptive' }, output_config: { effort: nivel } };
}

/**
 * El body de un pedido a la Messages API de Anthropic (T1,
 * `apiFormat: 'anthropic'`). Mismo criterio que `aResponsesBody`: quien
 * llama ya resolvió "sinHerramientas gana por encima de forzarHerramienta"
 * antes de pasar para acá.
 */
function aAnthropicBody(options: {
  provider: ProviderConfig;
  messages: ChatMessage[];
  forzarHerramienta: boolean;
  sinHerramientas: boolean;
  editsEnabled: boolean;
  soloEdicion: boolean;
  razonamiento: Record<string, unknown>;
  maxTokens: number;
}): MessageCreateParamsStreaming {
  const { system, messages } = aAnthropicMessages(options.messages);

  const body: MessageCreateParamsStreaming = {
    model: options.provider.model,
    max_tokens: options.maxTokens,
    messages,
    stream: true,
  };
  if (system) body.system = system;

  if (!options.sinHerramientas) {
    body.tools = aAnthropicTools(herramientasDeEscritura(options.editsEnabled, options.soloEdicion));
    body.tool_choice = options.forzarHerramienta
      ? eleccionForzadaAnthropic(options.editsEnabled, options.soloEdicion)
      : { type: 'auto' };
  }

  Object.assign(body, anthropicRazonamientoBody(options.provider, options.razonamiento));

  return body;
}

/**
 * Igual rol que `intentarUna` (fetch + chequeo de errores) pero contra el
 * SDK de Anthropic en vez de `fetch` crudo — la Messages API no habla el
 * dialecto Chat Completions, así que no hay endpoint HTTP común que
 * reutilizar. Devuelve el stream crudo del SDK (`AnthropicRawStream`), que
 * `readCompletionStream` sabe iterar cuando `apiFormat === 'anthropic'`.
 *
 * Mapeo de errores — mismo propósito que el bloque de `!response.ok` de
 * `intentarUna`, pero con las clases tipadas del SDK en vez de un status
 * HTTP crudo:
 *  - 400 que menciona `tool_choice` → `ToolChoiceNoSoportado` (reutiliza EL
 *    MISMO mecanismo de aflojar a "auto" que ya existe en
 *    `requestCompletionStream`, no uno nuevo);
 *  - `RateLimitError` (429) y sobrecarga (529 "overloaded") y
 *    `APIConnectionError` (de red) → `ProviderError` con `status: 429`, para
 *    que el MISMO bucle de reintentos de `requestCompletionStream` los
 *    reintente — no hay un camino de reintento paralelo;
 *  - cualquier otro `APIError` → `ProviderError` con el status real.
 */
async function intentarUnaAnthropic(options: {
  messages: ChatMessage[];
  provider: ProviderConfig;
  signal?: AbortSignal;
  forzarHerramienta?: boolean;
  razonamientoOverride?: Record<string, unknown> | null;
  maxTokensOverride?: number | null;
  sinHerramientas?: boolean;
  editsEnabled?: boolean;
  soloEdicion?: boolean;
}): Promise<AnthropicRawStream> {
  const { provider } = options;

  // Hallazgo de revisión (motor-claude, pre-deploy): el SDK reintenta por su
  // cuenta (default `maxRetries: 2`, 408/409/429/5xx + errores de red) ANTES
  // de que el error llegue hasta el `catch` de abajo — pero `stream.ts` ya
  // tiene su propio bucle de reintentos (429/529 se re-lanzan como
  // `ProviderError` con `status: 429` para ESE bucle, más arriba en este
  // archivo). Con el SDK reintentando también, una saturación sostenida
  // multiplica la espera (reintentos del SDK × reintentos de la app) sin que
  // ninguno de los dos lados lo sepa. `maxRetries: 0` deja el reintento
  // enteramente del lado de la app, que es el único que decide cuándo pasar
  // al siguiente proveedor de la cadena.
  const client = new Anthropic({
    apiKey: provider.apiKey,
    baseURL: provider.baseUrl || undefined,
    maxRetries: 0,
  });

  const body = aAnthropicBody({
    provider,
    messages: options.messages,
    forzarHerramienta: options.forzarHerramienta ?? false,
    sinHerramientas: options.sinHerramientas ?? false,
    editsEnabled: options.editsEnabled ?? false,
    soloEdicion: options.soloEdicion ?? false,
    razonamiento: options.razonamientoOverride ?? razonamiento(provider),
    maxTokens: options.maxTokensOverride ?? provider.maxTokens,
  });

  try {
    return await client.messages.create(body, { signal: options.signal });
  } catch (error) {
    if (error instanceof Anthropic.BadRequestError && /tool_choice/i.test(error.message)) {
      throw new ToolChoiceNoSoportado(
        `${provider.label} no acepta forzar la herramienta. ${error.message.slice(0, 200)}`.trim(),
      );
    }

    if (error instanceof Anthropic.RateLimitError) {
      throw new ProviderError(`${provider.label} está saturado en este momento.`, 429);
    }

    if (error instanceof Anthropic.APIConnectionError) {
      throw new ProviderError(`No se pudo contactar a ${provider.label}: ${error.message}`);
    }

    if (error instanceof Anthropic.APIError) {
      const status = typeof error.status === 'number' ? error.status : 502;
      // 529 "overloaded" (y cualquier otro 5xx): mismo tratamiento que un
      // 429 — es saturación del proveedor, no un pedido mal armado, así que
      // entra al mismo camino de reintentos.
      if (status === 529 || status >= 500) {
        throw new ProviderError(`${provider.label} está saturado en este momento (${status}).`, 429);
      }
      throw new ProviderError(`${provider.label} respondió ${status}. ${error.message.slice(0, 300)}`.trim(), status);
    }

    throw new ProviderError(`No se pudo contactar a ${provider.label}: ${(error as Error).message}`);
  }
}

async function intentarUna(
  endpoint: string,
  options: {
    messages: ChatMessage[];
    provider: ProviderConfig;
    signal?: AbortSignal;
    forzarHerramienta?: boolean;
    razonamientoOverride?: Record<string, unknown> | null;
    maxTokensOverride?: number | null;
    sinHerramientas?: boolean;
    editsEnabled?: boolean;
    soloEdicion?: boolean;
  },
): Promise<Response | AnthropicRawStream> {
  const { provider } = options;

  // T1: la Messages API de Anthropic no comparte NADA del dialecto HTTP de
  // Chat Completions/Responses (no es `fetch` + JSON, es el SDK) — se
  // bifurca ANTES de armar el `endpoint`/`cuerpo` de acá abajo, que nunca
  // llega a usarse en este camino.
  if (provider.apiFormat === 'anthropic') {
    return intentarUnaAnthropic(options);
  }

  // T2: la Responses API habla un dialecto de body enteramente distinto
  // (`input` en vez de `messages`, `reasoning.effort` en vez de
  // `reasoning_effort`/`thinking`, `max_output_tokens`, sin `temperature`) —
  // ver `aResponsesBody` más arriba. El resto de esta función (fetch,
  // manejo de errores, 429, `tool_choice` no soportado) es idéntico para los
  // dos formatos: el detalle de la respuesta HTTP se sigue leyendo como
  // texto plano y el mismo regex de `tool_choice` sirve para las dos APIs.
  const cuerpo =
    provider.apiFormat === 'responses'
      ? aResponsesBody({
          provider,
          messages: options.messages,
          forzarHerramienta: options.forzarHerramienta ?? false,
          sinHerramientas: options.sinHerramientas ?? false,
          editsEnabled: options.editsEnabled ?? false,
          soloEdicion: options.soloEdicion ?? false,
          razonamiento: options.razonamientoOverride ?? razonamiento(provider),
          maxTokens: options.maxTokensOverride ?? provider.maxTokens,
        })
      : {
          model: provider.model,
          messages: options.messages,
          // T20: una llamada auxiliar que nunca escribe el recurso (hoy sólo
          // el checklist) no manda NI `tools` NI `tool_choice` — `undefined`
          // hace que `JSON.stringify` OMITA la clave entera, que es lo que
          // hizo falta contra DeepSeek (`tool_choice: 'none'` no alcanza: el
          // proveedor sigue viendo `tools` y puede llamarla igual).
          tools: options.sinHerramientas
            ? undefined
            : herramientasDeEscritura(options.editsEnabled ?? false, options.soloEdicion ?? false),
          tool_choice: options.sinHerramientas
            ? undefined
            : options.forzarHerramienta
              ? eleccionForzada(options.editsEnabled ?? false, options.soloEdicion ?? false)
              : 'auto',
          // Sólo viaja si el motor lo tiene configurado. Los proveedores que no
          // conocen el parámetro contestan 400 si se les manda, así que el
          // default (NULL en el catálogo) es no mandarlo.
          //
          // En DeepSeek va en 'none': armar un HTML es escritura larga, no
          // razonamiento. El thinking cobra tokens y latencia a cambio de poco,
          // y rechaza el tool_choice forzado (ver ToolChoiceNoSoportado) e
          // ignora el temperature de acá abajo. Generación y ajustes usan
          // exactamente `razonamiento(provider)`: el nivel configurado en el
          // motor, sin pisar nada — `razonamientoOverride` (checklist,
          // corrección, verificador) manda por encima cuando vino, ver el
          // comentario en `requestCompletionStream`.
          ...(options.razonamientoOverride ?? razonamiento(provider)),
          stream: true,
          temperature: 0.6,
          // Sin esto la API aplica su default (4.096) y todo recurso que pase de
          // ~200 líneas vuelve cortado por la mitad. `maxTokensOverride` (T16)
          // pisa esto para una llamada puntual que no escribe un recurso.
          max_tokens: options.maxTokensOverride ?? provider.maxTokens,
          // Pide el conteo de tokens en el último chunk: es de dónde sale el
          // consumo que se registra por usuario.
          stream_options: { include_usage: true },
        };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(cuerpo),
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
  /**
   * T1 (motor-claude): tokens de ESCRITURA al cache (`cache_creation_input_tokens`
   * de Anthropic). NO es un subconjunto de `promptTokens` — a diferencia de
   * `cachedTokens`, Anthropic cuenta el input "nuevo", el leído de cache y el
   * escrito al cache como TRES baldes separados (`promptTokens` acá ya es la
   * suma de los tres, ver `readAnthropicStream`). Siempre 0 para chat/responses.
   */
  cacheWriteTokens: number;
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  /** Primer indicio de que empezó a escribir código. Llega MUCHO antes que el
   *  tool call completo (que puede tardar minutos en un recurso grande), así que
   *  es lo único que permite avisarle al docente qué está pasando mientras tanto. */
  | { type: 'tool_start'; name: string }
  /**
   * Fragmento crudo de los `arguments` del tool call, según va llegando (T3,
   * "Progresivo": cada resultado parcial se muestra apenas existe). `index`
   * es el mismo índice que usa el proveedor
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
export async function* readCompletionStream(
  response: Response | AnthropicRawStream,
  apiFormat: ApiFormat = 'chat',
): AsyncGenerator<StreamEvent> {
  // T2/T1: mismo `StreamEvent` de salida, dialecto de entrada completamente
  // distinto según el formato — ver `readResponsesStream` y
  // `readAnthropicStream` más abajo. El default 'chat' es a propósito: todo
  // llamador viejo (y todo test viejo) que no sabe que este segundo
  // parámetro existe sigue viendo el comportamiento de siempre, byte a byte.
  if (apiFormat === 'responses') {
    yield* readResponsesStream(response as Response);
    return;
  }

  if (apiFormat === 'anthropic') {
    yield* readAnthropicStream(response as AnthropicRawStream);
    return;
  }

  const reader = (response as Response).body!.getReader();
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
              cacheWriteTokens: 0, // T1: dialecto OpenAI, nunca reporta escritura de cache.

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

/**
 * Igual que `readCompletionStream` pero para el SSE de la Responses API (T2,
 * `apiFormat: 'responses'`): mismo `StreamEvent` de salida, dialecto de
 * eventos totalmente distinto — ported de la mitad de streaming de
 * `experimentos/razonamiento/proxy-responses.mjs`.
 *
 * Tres detalles que no tiene Chat Completions:
 *  - los tool calls se identifican por `item_id`/`call_id` (un string), no
 *    por un `index` numérico — se arma acá el mismo índice incremental que
 *    ya espera el resto de la app (`tool_delta.index`);
 *  - el consumo (`usage`) viaja adentro de `response.completed` /
 *    `response.incomplete` / `response.failed`, nunca en un chunk aparte;
 *  - un `type: 'error'` o `response.failed` a mitad de stream NO es un final
 *    silencioso: Chat Completions nunca deja pasar un error hasta acá (lo
 *    corta antes, por status HTTP, en `intentarUna`) — así que quien itera
 *    este generador nunca antes vio un throw DESPUÉS de haber recibido texto.
 *    Es la única manera de no devolverle al docente un turno vacío como si
 *    hubiese salido bien.
 */
async function* readResponsesStream(response: Response): AsyncGenerator<StreamEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  // `item_id` (Responses) → índice incremental (lo que espera `tool_delta`/
  // `tool_start` del resto de la app, igual que el `index` de Chat Completions).
  const indicePorItem = new Map<string, number>();
  const nombrePorIndice = new Map<number, string>();
  const argsPorIndice = new Map<number, string>();
  let announcedTool = false;

  let buffer = '';
  let doneReading = false;
  let terminalVisto = false;

  function* flush(truncated: boolean): Generator<StreamEvent> {
    for (const [indice, nombre] of [...nombrePorIndice.entries()].sort((a, b) => a[0] - b[0])) {
      if (nombre) yield { type: 'tool', name: nombre, arguments: argsPorIndice.get(indice) ?? '', truncated };
    }
    nombrePorIndice.clear();
    argsPorIndice.clear();
  }

  try {
    while (!doneReading) {
      const { done, value } = await reader.read();
      if (done) break;

      // Mismo motivo que en `readCompletionStream`: se normaliza el buffer
      // completo, no el chunk suelto, porque un `\r\n` puede quedar partido
      // justo en el corte entre dos chunks TCP.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');

      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const rawEvent = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf('\n\n');

        const payload = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('');

        if (!payload) continue;
        if (payload === '[DONE]') {
          doneReading = true;
          break;
        }

        let ev: Record<string, any>;
        try {
          ev = JSON.parse(payload);
        } catch {
          continue; // fragmento inválido: se ignora en vez de cortar el stream
        }

        switch (ev.type) {
          case 'response.output_text.delta':
            if (typeof ev.delta === 'string' && ev.delta.length > 0) {
              yield { type: 'text', delta: ev.delta };
            }
            break;

          case 'response.output_item.added':
            if (ev.item?.type === 'function_call') {
              const indice = indicePorItem.size;
              indicePorItem.set(ev.item.id, indice);
              nombrePorIndice.set(indice, ev.item.name ?? '');
              argsPorIndice.set(indice, '');
              if (!announcedTool && ev.item.name) {
                announcedTool = true;
                yield { type: 'tool_start', name: ev.item.name };
              }
            }
            break;

          case 'response.function_call_arguments.delta': {
            if (typeof ev.delta !== 'string') break;
            const indice = indicePorItem.get(ev.item_id) ?? 0;
            const nombre = nombrePorIndice.get(indice) ?? '';
            argsPorIndice.set(indice, (argsPorIndice.get(indice) ?? '') + ev.delta);
            if (ev.delta.length > 0) {
              yield { type: 'tool_delta', index: indice, name: nombre, delta: ev.delta };
            }
            break;
          }

          case 'response.completed':
          case 'response.incomplete':
          case 'response.failed': {
            terminalVisto = true;

            const usage = ev.response?.usage;
            if (usage) {
              yield {
                type: 'usage',
                usage: {
                  promptTokens: Number(usage.input_tokens ?? 0),
                  completionTokens: Number(usage.output_tokens ?? 0),
                  // Subconjunto de promptTokens, no un extra — mismo
                  // comentario que en la interfaz `TokenUsage` más arriba.
                  cachedTokens: Number(usage.input_tokens_details?.cached_tokens ?? 0),
                  cacheWriteTokens: 0, // T1: dialecto OpenAI, nunca reporta escritura de cache.

                },
              };
            }

            if (ev.type === 'response.failed') {
              const detalle =
                typeof ev.response?.error?.message === 'string'
                  ? ev.response.error.message
                  : 'La Responses API devolvió response.failed.';
              throw new ProviderError(detalle);
            }

            const finishReason = ev.type === 'response.incomplete' ? 'length' : nombrePorIndice.size > 0 ? 'tool_calls' : 'stop';
            yield* flush(finishReason === 'length');
            yield { type: 'finish', reason: finishReason };
            break;
          }

          case 'error': {
            const detalle =
              typeof ev.message === 'string'
                ? ev.message
                : typeof ev.error?.message === 'string'
                  ? ev.error.message
                  : 'La Responses API mandó un evento de error.';
            throw new ProviderError(detalle);
          }

          default:
            break; // resúmenes de razonamiento y demás eventos: se ignoran a propósito
        }
      }
    }

    // Si el proveedor cerró sin ningún response.completed/incomplete/failed,
    // no perdemos el tool call ya acumulado — mismo criterio que
    // `readCompletionStream`.
    if (!terminalVisto) yield* flush(false);
  } finally {
    reader.releaseLock();
  }
}

/**
 * Igual rol que `readResponsesStream` pero para el stream crudo del SDK de
 * Anthropic (T1, `apiFormat: 'anthropic'`): mismo `StreamEvent` de salida,
 * dialecto de eventos totalmente distinto de entrada.
 *
 * Tres detalles que no tienen los otros dos dialectos:
 *  - los tool calls se identifican por el `index` NUMÉRICO del content
 *    block (igual que Chat Completions, a diferencia de la Responses API
 *    que usa un `item_id` string) — no hace falta mapear nada;
 *  - el consumo final (`usage`) viaja en `message_delta`, YA ACUMULADO
 *    (`input_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens`/
 *    `output_tokens` cubren el turno entero, no un delta) — se lee una sola
 *    vez, al final;
 *  - Anthropic reporta tres baldes de "entrada" por separado
 *    (`input_tokens` nuevo, `cache_read_input_tokens`, y
 *    `cache_creation_input_tokens`) en vez de uno solo con un subconjunto
 *    cacheado — `promptTokens` acá es la SUMA de los tres (instrucción
 *    explícita de motor-claude: "promptTokens = input_tokens +
 *    cache_read_input_tokens + cache_creation_input_tokens"), para que
 *    `usage.ts` siga pudiendo tratar `promptTokens` como "todo lo que se
 *    mandó de entrada" sin importar el proveedor.
 */
async function* readAnthropicStream(stream: AnthropicRawStream): AsyncGenerator<StreamEvent> {
  const nombrePorIndice = new Map<number, string>();
  const argsPorIndice = new Map<number, string>();
  let announcedTool = false;
  let modeloDeEsteTurno = '';

  function* flush(truncated: boolean): Generator<StreamEvent> {
    for (const [indice, nombre] of [...nombrePorIndice.entries()].sort((a, b) => a[0] - b[0])) {
      if (nombre) yield { type: 'tool', name: nombre, arguments: argsPorIndice.get(indice) ?? '', truncated };
    }
    nombrePorIndice.clear();
    argsPorIndice.clear();
  }

  try {
    for await (const ev of stream) {
      switch (ev.type) {
        case 'message_start':
          modeloDeEsteTurno = ev.message.model;
          break;

        case 'content_block_start':
          if (ev.content_block.type === 'tool_use') {
            nombrePorIndice.set(ev.index, ev.content_block.name);
            argsPorIndice.set(ev.index, '');
            if (!announcedTool) {
              announcedTool = true;
              yield { type: 'tool_start', name: ev.content_block.name };
            }
          }
          break;

        case 'content_block_delta':
          if (ev.delta.type === 'text_delta') {
            if (ev.delta.text.length > 0) yield { type: 'text', delta: ev.delta.text };
          } else if (ev.delta.type === 'input_json_delta') {
            const nombre = nombrePorIndice.get(ev.index) ?? '';
            argsPorIndice.set(ev.index, (argsPorIndice.get(ev.index) ?? '') + ev.delta.partial_json);
            if (ev.delta.partial_json.length > 0) {
              yield { type: 'tool_delta', index: ev.index, name: nombre, delta: ev.delta.partial_json };
            }
          }
          // `thinking_delta`/`signature_delta`/`citations_delta`: se ignoran
          // a propósito, mismo criterio que los resúmenes de razonamiento de
          // la Responses API.
          break;

        case 'message_delta': {
          const usage = ev.usage;
          const promptTokens =
            Number(usage.input_tokens ?? 0) +
            Number(usage.cache_read_input_tokens ?? 0) +
            Number(usage.cache_creation_input_tokens ?? 0);
          const cachedTokens = Number(usage.cache_read_input_tokens ?? 0);
          const cacheWriteTokens = Number(usage.cache_creation_input_tokens ?? 0);

          // motor-claude: guardia de prompt largo en Haiku — sólo logueo,
          // nunca corta el turno. El tope (100K) es el punto a partir del
          // cual Haiku 5.5 pasa a cobrar 5x.
          if (modeloDeEsteTurno.includes('haiku') && promptTokens > 100_000) {
            console.warn(
              `[provider] turno de Haiku con prompt de ${promptTokens} tokens (>100K): a partir de ahí el motor cobra 5x.`,
            );
          }

          yield {
            type: 'usage',
            usage: { promptTokens, completionTokens: Number(usage.output_tokens ?? 0), cachedTokens, cacheWriteTokens },
          };

          const stopReason = ev.delta.stop_reason;
          if (stopReason === 'refusal') {
            console.warn('[provider] Anthropic devolvió stop_reason "refusal" (clasificador de seguridad).');
          }
          const finishReason =
            stopReason === 'tool_use'
              ? 'tool_calls'
              : stopReason === 'max_tokens'
                ? 'length'
                : 'stop';
          yield* flush(finishReason === 'length');
          yield { type: 'finish', reason: finishReason };
          break;
        }

        default:
          break; // 'content_block_stop'/'message_stop': nada que hacer, ya se emitió todo arriba.
      }
    }
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      throw new ProviderError(`Anthropic falló a mitad de stream: ${error.message}`);
    }
    throw error;
  }
}
