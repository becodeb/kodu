import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  ProviderError,
  requestCompletionStream,
  readCompletionStream,
  type ChatMessage,
  type ProviderConfig,
  type StreamEvent,
} from '../src/lib/ai/provider.ts';
import { RESOURCE_TOOLS, UPDATE_RESOURCE_CODE } from '../src/lib/ai/tools.ts';
import { iniciarMockProveedor } from './mock-proveedor.ts';

/**
 * Pruebas unitarias de la Responses API en `src/lib/ai/provider.ts` (T2 de
 * `odd/tasks/verificador.md`, ported de
 * `experimentos/razonamiento/proxy-responses.mjs`): el mapeo del pedido
 * (`aResponsesBody`/`aResponsesInput`, no exportadas — se prueban a través
 * de `requestCompletionStream` contra un servidor HTTP propio, mismo patrón
 * que `bodyDelPedido` en `e2e/unidad.ts`) y el parseo del SSE de vuelta
 * (`readCompletionStream(response, 'responses')`, contra `Response` fabricados
 * a mano — sin red — y un round trip real contra `e2e/mock-proveedor.ts`).
 *
 * `node:assert/strict` + `tsx`, sin test runner (no hay uno en este repo).
 * Ejecutar con: npx tsx e2e/unidad-responses.ts
 */

let fallas = 0;

async function prueba(nombre: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✔ ${nombre}`);
  } catch (error) {
    fallas++;
    console.error(`✖ ${nombre}`);
    console.error(`  ${(error as Error).message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Mapeo del pedido (aResponsesBody / aResponsesInput)
// ─────────────────────────────────────────────────────────────

function config(extra: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'x', label: 'x', apiKey: 'k', baseUrl: 'http://localhost:0', model: 'gpt-6-luna',
    apiFormat: 'responses', maxTokens: 2_000, userTokenLimit: 0, userTokenWindowHours: 0, maxInputChars: 1,
    supportsVision: false, reasoningEffort: 'high', reasoningParam: null,
    precios: null, ...extra,
  };
}

/**
 * Manda UN pedido con `requestCompletionStream` contra un servidor propio
 * que sólo devuelve `{url, body}` de lo que recibió, y contesta un
 * `response.completed` vacío — mismo patrón que `bodyDelPedido` en
 * `e2e/unidad.ts`, pero acá además se captura la URL para poder afirmar el
 * path `/v1/responses`.
 */
async function pedidoResponses(opts: {
  messages?: ChatMessage[];
  forzarHerramienta?: boolean;
  sinHerramientas?: boolean;
  razonamientoOverride?: Record<string, unknown> | null;
  maxTokensOverride?: number | null;
  providerExtra?: Partial<ProviderConfig>;
} = {}): Promise<{ url: string; body: Record<string, unknown> }> {
  let capturado: { url: string; body: Record<string, unknown> } | null = null;

  const server = createServer((req, res) => {
    const trozos: Buffer[] = [];
    req.on('data', (trozo: Buffer) => trozos.push(trozo));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(trozos).toString('utf8')) as Record<string, unknown>;
      } catch {
        body = {};
      }
      capturado = { url: req.url ?? '', body };
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      res.write(
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  try {
    const address = server.address();
    const puerto = address && typeof address === 'object' ? address.port : 0;
    const respuesta = await requestCompletionStream({
      messages: opts.messages ?? [{ role: 'user', content: 'hola' }],
      provider: config({ baseUrl: `http://127.0.0.1:${puerto}`, ...opts.providerExtra }),
      forzarHerramienta: opts.forzarHerramienta,
      sinHerramientas: opts.sinHerramientas,
      razonamientoOverride: opts.razonamientoOverride,
      maxTokensOverride: opts.maxTokensOverride,
    });
    // Se agota el body: si no, `server.close()` puede quedar esperando la
    // conexión keep-alive (mismo motivo que en `bodyDelPedido`).
    for await (const _chunk of respuesta.body as any) void _chunk;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  assert.ok(capturado, 'el servidor de prueba tiene que haber recibido el pedido');
  return capturado!;
}

await prueba('URL: apiFormat "responses" pega a /v1/responses, no a /v1/chat/completions', async () => {
  const { url } = await pedidoResponses();
  assert.equal(url, '/v1/responses');
});

await prueba('input: system/user(con imagen)/assistant(+tool_calls)/tool se mapean a la forma de Responses', async () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'sos un asistente' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'mirá esto' },
        { type: 'image_url', image_url: { url: 'https://example.com/x.png' } },
      ],
    },
    {
      role: 'assistant',
      content: 'ya lo hago',
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: UPDATE_RESOURCE_CODE, arguments: '{"html":"<html></html>"}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
  ];

  const { body } = await pedidoResponses({ messages, sinHerramientas: true });
  const input = body.input as Array<Record<string, unknown>>;

  assert.deepEqual(input[0], { role: 'system', content: 'sos un asistente' });
  assert.deepEqual(input[1], {
    role: 'user',
    content: [
      { type: 'input_text', text: 'mirá esto' },
      { type: 'input_image', image_url: 'https://example.com/x.png' },
    ],
  });
  assert.deepEqual(input[2], { role: 'assistant', content: 'ya lo hago' });
  assert.deepEqual(input[3], {
    type: 'function_call',
    call_id: 'call_1',
    name: UPDATE_RESOURCE_CODE,
    arguments: '{"html":"<html></html>"}',
  });
  assert.deepEqual(input[4], { type: 'function_call_output', call_id: 'call_1', output: 'ok' });
});

await prueba('input: un mensaje "user" con content string viaja tal cual, sin envolver en partes', async () => {
  const { body } = await pedidoResponses({ messages: [{ role: 'user', content: 'texto plano' }] });
  const input = body.input as Array<Record<string, unknown>>;
  assert.deepEqual(input[0], { role: 'user', content: 'texto plano' });
});

await prueba('tools/tool_choice: forzarHerramienta manda {type:"function", name} y las tools en forma plana', async () => {
  const { body } = await pedidoResponses({ forzarHerramienta: true });
  const tools = body.tools as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(tools) && tools.length === RESOURCE_TOOLS.length);
  assert.deepEqual(tools[0], {
    type: 'function',
    name: UPDATE_RESOURCE_CODE,
    description: RESOURCE_TOOLS[0]!.function.description,
    parameters: RESOURCE_TOOLS[0]!.function.parameters,
  });
  assert.deepEqual(body.tool_choice, { type: 'function', name: UPDATE_RESOURCE_CODE });
});

await prueba('tools/tool_choice: sin forzar, tool_choice es "auto"', async () => {
  const { body } = await pedidoResponses({});
  assert.equal(body.tool_choice, 'auto');
});

await prueba('sinHerramientas: OMITE "tools" y "tool_choice" enteras, igual que en Chat Completions', async () => {
  const { body } = await pedidoResponses({ sinHerramientas: true, forzarHerramienta: true });
  assert.ok(!('tools' in body), 'la clave "tools" no tiene que existir en absoluto');
  assert.ok(!('tool_choice' in body), 'la clave "tool_choice" no tiene que existir en absoluto');
});

await prueba('reasoning: none/low/high mapean tal cual, "max" cae a "high"', async () => {
  for (const [nivel, esperado] of [
    ['none', 'none'],
    ['low', 'low'],
    ['high', 'high'],
    ['max', 'high'],
  ] as const) {
    const { body } = await pedidoResponses({ providerExtra: { reasoningEffort: nivel, reasoningParam: 'reasoning_effort' } });
    assert.deepEqual(body.reasoning, { effort: esperado }, `nivel "${nivel}" tenía que mapear a "${esperado}"`);
  }
});

await prueba('reasoning: sin reasoningEffort configurado no manda la clave "reasoning"', async () => {
  const { body } = await pedidoResponses({ providerExtra: { reasoningEffort: null } });
  assert.ok(!('reasoning' in body));
});

await prueba('reasoning: razonamientoOverride con "medium" (T3, verificador) mapea a reasoning.effort "medium"', async () => {
  const { body } = await pedidoResponses({ razonamientoOverride: { reasoning_effort: 'medium' } });
  assert.deepEqual(body.reasoning, { effort: 'medium' });
});

await prueba('max_output_tokens: sale de provider.maxTokens, y maxTokensOverride lo pisa', async () => {
  const { body: b1 } = await pedidoResponses({ providerExtra: { maxTokens: 4_321 } });
  assert.equal(b1.max_output_tokens, 4_321);

  const { body: b2 } = await pedidoResponses({ providerExtra: { maxTokens: 4_321 }, maxTokensOverride: 111 });
  assert.equal(b2.max_output_tokens, 111);
});

await prueba('nunca manda "temperature" (los modelos de razonamiento de OpenAI la rechazan)', async () => {
  const { body } = await pedidoResponses({});
  assert.ok(!('temperature' in body));
});

await prueba('store:false, stream:true, model tal cual', async () => {
  const { body } = await pedidoResponses({ providerExtra: { model: 'gpt-6-luna' } });
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.model, 'gpt-6-luna');
});

// ─────────────────────────────────────────────────────────────
// Parseo del SSE de vuelta (readCompletionStream con apiFormat 'responses')
// Sin red: `Response` fabricado a mano con un `ReadableStream` propio.
// ─────────────────────────────────────────────────────────────

function respuestaSSE(payload: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
  return new Response(stream);
}

/** Concatena eventos "data: {...}" separados por línea en blanco y cierra
 *  con "[DONE]" — misma forma que manda la Responses API real. */
function sseDe(eventos: Array<Record<string, unknown>>): string {
  return eventos.map((evento) => `data: ${JSON.stringify(evento)}`).join('\n\n') + '\n\ndata: [DONE]\n\n';
}

async function recolectar(response: Response): Promise<StreamEvent[]> {
  const eventos: StreamEvent[] = [];
  for await (const evento of readCompletionStream(response, 'responses')) eventos.push(evento);
  return eventos;
}

await prueba('readCompletionStream (responses): response.output_text.delta produce "text"', async () => {
  const sse = sseDe([
    { type: 'response.output_text.delta', delta: 'Hola' },
    { type: 'response.output_text.delta', delta: ' mundo' },
    {
      type: 'response.completed',
      response: { usage: { input_tokens: 10, output_tokens: 2, input_tokens_details: { cached_tokens: 1 } } },
    },
  ]);

  const eventos = await recolectar(respuestaSSE(sse));

  assert.deepEqual(
    eventos.filter((e) => e.type === 'text'),
    [
      { type: 'text', delta: 'Hola' },
      { type: 'text', delta: ' mundo' },
    ],
  );
  assert.deepEqual(
    eventos.find((e) => e.type === 'usage'),
    { type: 'usage', usage: { promptTokens: 10, completionTokens: 2, cachedTokens: 1 } },
  );
  assert.deepEqual(eventos.find((e) => e.type === 'finish'), { type: 'finish', reason: 'stop' });
});

await prueba('readCompletionStream (responses): dos tool calls con deltas intercalados, cada uno con su propio índice', async () => {
  const sse = sseDe([
    { type: 'response.output_item.added', item: { id: 'item_a', type: 'function_call', name: 'fnA' } },
    { type: 'response.output_item.added', item: { id: 'item_b', type: 'function_call', name: 'fnB' } },
    { type: 'response.function_call_arguments.delta', item_id: 'item_a', delta: '{"x":' },
    { type: 'response.function_call_arguments.delta', item_id: 'item_b', delta: '{"y":' },
    { type: 'response.function_call_arguments.delta', item_id: 'item_a', delta: '1}' },
    { type: 'response.function_call_arguments.delta', item_id: 'item_b', delta: '2}' },
    { type: 'response.completed', response: { usage: { input_tokens: 5, output_tokens: 5 } } },
  ]);

  const eventos = await recolectar(respuestaSSE(sse));

  const inicios = eventos.filter((e) => e.type === 'tool_start');
  assert.equal(inicios.length, 1, 'sólo se anuncia el primer tool_start, mismo criterio que Chat Completions');
  assert.deepEqual(inicios[0], { type: 'tool_start', name: 'fnA' });

  const deltasA = eventos.filter((e) => e.type === 'tool_delta' && e.index === 0).map((e) => (e as any).delta);
  const deltasB = eventos.filter((e) => e.type === 'tool_delta' && e.index === 1).map((e) => (e as any).delta);
  assert.deepEqual(deltasA, ['{"x":', '1}']);
  assert.deepEqual(deltasB, ['{"y":', '2}']);

  assert.deepEqual(
    eventos.filter((e) => e.type === 'tool'),
    [
      { type: 'tool', name: 'fnA', arguments: '{"x":1}', truncated: false },
      { type: 'tool', name: 'fnB', arguments: '{"y":2}', truncated: false },
    ],
  );
});

await prueba('readCompletionStream (responses): response.incomplete marca finish "length" y el tool truncated', async () => {
  const sse = sseDe([
    { type: 'response.output_item.added', item: { id: 'item_a', type: 'function_call', name: UPDATE_RESOURCE_CODE } },
    { type: 'response.function_call_arguments.delta', item_id: 'item_a', delta: '{"html":"<html>' },
    { type: 'response.incomplete', response: { usage: { input_tokens: 1, output_tokens: 1 } } },
  ]);

  const eventos = await recolectar(respuestaSSE(sse));

  assert.deepEqual(eventos.find((e) => e.type === 'finish'), { type: 'finish', reason: 'length' });
  assert.deepEqual(eventos.find((e) => e.type === 'tool'), {
    type: 'tool',
    name: UPDATE_RESOURCE_CODE,
    arguments: '{"html":"<html>',
    truncated: true,
  });
});

await prueba('readCompletionStream (responses): un evento "error" tira ProviderError, nunca un final silencioso', async () => {
  const sse = `data: ${JSON.stringify({ type: 'error', message: 'algo se rompió' })}\n\ndata: [DONE]\n\n`;

  const eventos: StreamEvent[] = [];
  await assert.rejects(
    async () => {
      for await (const evento of readCompletionStream(respuestaSSE(sse), 'responses')) eventos.push(evento);
    },
    (error: unknown) => error instanceof ProviderError && /algo se rompió/.test((error as Error).message),
  );
  assert.equal(eventos.length, 0, 'nada tiene que haberse emitido antes del error en este caso');
});

await prueba('readCompletionStream (responses): response.failed tira ProviderError DESPUÉS de reportar el usage', async () => {
  const sse = sseDe([
    { type: 'response.output_text.delta', delta: 'algo' },
    {
      type: 'response.failed',
      response: { usage: { input_tokens: 3, output_tokens: 1 }, error: { message: 'la cuenta se quedó sin crédito' } },
    },
  ]);

  const eventos: StreamEvent[] = [];
  await assert.rejects(
    async () => {
      for await (const evento of readCompletionStream(respuestaSSE(sse), 'responses')) eventos.push(evento);
    },
    (error: unknown) => error instanceof ProviderError && /sin crédito/.test((error as Error).message),
  );
  assert.ok(eventos.some((e) => e.type === 'usage'), 'el usage tiene que reportarse ANTES del throw, no perderse');
  assert.ok(!eventos.some((e) => e.type === 'finish'), 'response.failed no es un final normal, no hay evento "finish"');
});

await prueba('readCompletionStream con apiFormat por defecto ("chat") sigue leyendo el dialecto de Chat Completions', async () => {
  // Regresión mínima: el segundo argumento es opcional y con Chat
  // Completions real (sin pasarlo) el parseo de siempre no puede romperse.
  const sse =
    'data: {"choices":[{"index":0,"delta":{"content":"hola"},"finish_reason":null}]}\n\n' +
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
    'data: [DONE]\n\n';
  const eventos: StreamEvent[] = [];
  for await (const evento of readCompletionStream(respuestaSSE(sse))) eventos.push(evento);
  assert.deepEqual(eventos[0], { type: 'text', delta: 'hola' });
  assert.deepEqual(eventos.find((e) => e.type === 'finish'), { type: 'finish', reason: 'stop' });
});

// ─────────────────────────────────────────────────────────────
// Round trip real contra e2e/mock-proveedor.ts (`/v1/responses`)
// ─────────────────────────────────────────────────────────────

await prueba('mock-proveedor /v1/responses: round trip completo con requestCompletionStream + readCompletionStream', async () => {
  const mock = await iniciarMockProveedor();
  try {
    mock.programarRespuestaResponses({
      texto: 'hola verificador',
      usage: { prompt_tokens: 42, completion_tokens: 7, cached_tokens: 0 },
    });

    const provider = config({ baseUrl: mock.url, reasoningEffort: null, reasoningParam: null });
    const respuesta = await requestCompletionStream({
      messages: [{ role: 'user', content: 'revisá este recurso' }],
      provider,
      sinHerramientas: true,
    });

    let texto = '';
    let usage: { promptTokens: number; completionTokens: number; cachedTokens: number } | null = null;
    let finishReason = '';
    for await (const event of readCompletionStream(respuesta, provider.apiFormat)) {
      if (event.type === 'text') texto += event.delta;
      else if (event.type === 'usage') usage = event.usage;
      else if (event.type === 'finish') finishReason = event.reason;
    }

    assert.equal(texto, 'hola verificador');
    assert.deepEqual(usage, { promptTokens: 42, completionTokens: 7, cachedTokens: 0 });
    assert.equal(finishReason, 'stop');
    assert.equal(mock.llamadas.length, 1);
    assert.equal((mock.llamadas[0]!.body as Record<string, unknown>).model, provider.model);
    assert.ok(
      !('tools' in (mock.llamadas[0]!.body as Record<string, unknown>)),
      'sinHerramientas: el mock tiene que haber recibido el pedido sin "tools"',
    );
  } finally {
    await mock.detener();
  }
});

await prueba('mock-proveedor /v1/responses: con tools + tool_choice forzado, contesta un function_call', async () => {
  const mock = await iniciarMockProveedor();
  try {
    mock.programarRespuestaResponses({});

    const provider = config({ baseUrl: mock.url, reasoningEffort: null, reasoningParam: null });
    const respuesta = await requestCompletionStream({
      messages: [{ role: 'user', content: 'armá el recurso' }],
      provider,
      forzarHerramienta: true,
    });

    let nombreHerramienta = '';
    let argumentos = '';
    for await (const event of readCompletionStream(respuesta, provider.apiFormat)) {
      if (event.type === 'tool') {
        nombreHerramienta = event.name;
        argumentos = event.arguments;
      }
    }

    assert.equal(nombreHerramienta, UPDATE_RESOURCE_CODE);
    assert.ok(argumentos.length > 0, 'tiene que haber llegado algún argumento');
    JSON.parse(argumentos); // no tira: el JSON default del mock es válido
  } finally {
    await mock.detener();
  }
});

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad-responses.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/unidad-responses.ts: todas las pruebas pasaron');
}
