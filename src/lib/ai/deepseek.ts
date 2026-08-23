import { getEnv } from '../env.ts';
import { RESOURCE_TOOLS } from './tools.ts';

/**
 * Cliente de DeepSeek. El backend actúa de proxy seguro: la API key vive sólo
 * acá (SPEC §1) y el navegador nunca la ve.
 *
 * El protocolo es el estándar OpenAI-compatible (`/chat/completions` con
 * `stream: true`), así que el parser de abajo sirve igual para cualquier
 * proveedor que hable ese dialecto.
 */

export type ModelChoice = 'FLASH' | 'PRO';

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

export function supportsVision(): boolean {
  return getEnv().AI_VISION;
}

export class DeepSeekError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'DeepSeekError';
    this.status = status;
  }
}

export function resolveModel(choice: ModelChoice): string {
  const env = getEnv();
  return choice === 'PRO' ? env.DEEPSEEK_MODEL_PRO : env.DEEPSEEK_MODEL_FLASH;
}

export function isConfigured(): boolean {
  return getEnv().DEEPSEEK_API_KEY.length > 0;
}

export async function requestCompletionStream(options: {
  messages: ChatMessage[];
  model: ModelChoice;
  signal?: AbortSignal;
}): Promise<Response> {
  const env = getEnv();

  if (!env.DEEPSEEK_API_KEY) {
    throw new DeepSeekError(
      'El servidor no tiene configurada la clave de DeepSeek (DEEPSEEK_API_KEY).',
      503,
    );
  }

  const endpoint = `${env.DEEPSEEK_BASE_URL.replace(/\/+$/, '')}/v1/chat/completions`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: resolveModel(options.model),
        messages: options.messages,
        tools: RESOURCE_TOOLS,
        tool_choice: 'auto',
        stream: true,
        temperature: 0.6,
        // Sin esto la API aplica su default (4.096) y todo recurso que pase de
        // ~200 líneas vuelve cortado por la mitad. Ver AI_MAX_TOKENS en env.ts.
        max_tokens: env.AI_MAX_TOKENS,
      }),
      signal: options.signal,
    });
  } catch (error) {
    throw new DeepSeekError(`No se pudo contactar a DeepSeek: ${(error as Error).message}`);
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw new DeepSeekError(
      `DeepSeek respondió ${response.status}. ${detail.slice(0, 300)}`.trim(),
      response.status === 401 ? 502 : 502,
    );
  }

  return response;
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
  | { type: 'finish'; reason: string };

interface PendingToolCall {
  name: string;
  args: string;
}

/**
 * Convierte el SSE de OpenAI/DeepSeek en eventos ya digeridos.
 *
 * Dos detalles que rompen las implementaciones ingenuas:
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
