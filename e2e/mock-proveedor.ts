import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { MARCADOR_SISTEMA_CHECKLIST } from '../src/lib/ai/checklist.ts';

/**
 * Proveedor de IA simulado para los chequeos de integración de T3 en
 * adelante (odd/tasks/modo-prime.md). Sirve `/v1/chat/completions` con el
 * mismo dialecto SSE que espera `src/lib/ai/provider.ts`
 * (`readCompletionStream`): deltas de texto, un tool call
 * `update_resource_code` con sus `arguments` repartidos en chunks chicos y
 * demorados (para poder ver la vista previa progresiva en acción),
 * `finish_reason` y un chunk final de `usage`. Sin dependencias externas —
 * sólo `node:http` — porque este repo no tiene test runner
 * (openspec/context.md) y no hace falta traer nada para levantar un
 * servidor HTTP. El único import propio (`MARCADOR_SISTEMA_CHECKLIST`) es
 * un string puro, no arrastra nada.
 *
 * T16 (round 4, "checklist del docente"): el paso de checklist de
 * `stream.ts` manda su PROPIO pedido, ANTES del pedido principal de
 * cualquier turno de creación, con un system prompt reconocible por
 * `MARCADOR_SISTEMA_CHECKLIST`. Se responde APARTE de las colas
 * FIFO/condicional de abajo (ver `manejarPedido`): si no, se comería el
 * próximo `programarRespuesta` de cualquier script viejo que no sabe que
 * este pedido existe (t7, t8, t11…), y el turno principal terminaría
 * cayendo al HTML de ejemplo por defecto en vez de lo que ese script
 * programó. Un script que sí quiera controlar la respuesta del checklist
 * puede usar `programarRespuestaCondicional` matcheando ese mismo
 * marcador: se revisa primero, así que gana sobre este default.
 *
 * Para apuntar un AiProvider/AiModel de desarrollo acá: `baseUrl` =
 * `http://127.0.0.1:<puerto>` (SIN `/v1/chat/completions` — eso lo agrega
 * `provider.ts`: `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`) y
 * cualquier `apiKey` (no se valida). El puerto por defecto es
 * `PUERTO_POR_DEFECTO`.
 *
 * Uso típico desde otro script de `e2e/`:
 *   const mock = await iniciarMockProveedor();
 *   mock.programarRespuesta({ html: '...', chunkDelayMs: 50 });
 *   // ... crear el AiProvider/AiModel apuntando a mock.url, mandar el turno ...
 *   assert.equal(mock.llamadas.length, 1);
 *   await mock.detener();
 *
 * También corre solo: `npx tsx e2e/mock-proveedor.ts` lo deja escuchando
 * hasta Ctrl+C, para probar a mano contra un AiProvider ya cargado.
 */

export const PUERTO_POR_DEFECTO = 4790;

export const UPDATE_RESOURCE_CODE = 'update_resource_code';

/** Lo que ve la app en cada pedido (`messages`, `model`, `tools`, `tool_choice`, …). */
export interface LlamadaRegistrada {
  recibidaEn: number;
  body: Record<string, unknown>;
  /**
   * T4 (odd/tasks/generacion-simple-y-reanudable.md): `true` si la conexión
   * se cerró ANTES de que este mock terminara de responder normalmente (sea
   * por `cortarEnFraccion`, o porque el que llamaba abortó su propio fetch —
   * el caso que le importa a T4: verificar que "Detener" corta la conexión
   * del SERVIDOR de kodu con el proveedor, no sólo la del navegador con
   * kodu). `false` mientras la respuesta sigue en curso o ya terminó sola.
   */
  cortadoTemprano: boolean;
}

export interface UsageScript {
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens?: number;
}

/** Una respuesta programada para UN pedido. Campo por campo, todo opcional:
 *  lo que no se especifica sale del default (una respuesta normal y
 *  exitosa con `htmlDeEjemplo()`). */
export interface RespuestaScript {
  /** HTTP status alternativo (429, 500, …) en vez de una respuesta en
   *  streaming — para simular un proveedor caído o saturado. */
  status?: number;
  /** Demora antes de mandar el primer byte, en ms (latencia del proveedor). */
  demoraInicialMs?: number;
  /** Texto que "dice" antes/durante el tool call. */
  texto?: string;
  /** Si es `false`, nunca llama a `update_resource_code` (para ejercitar el
   *  rescate de HTML en el texto, o el re-pedido forzado). Default: true. */
  llamarHerramienta?: boolean;
  /** El HTML del argumento `html`. Default: `htmlDeEjemplo()` (~15 KB). */
  html?: string;
  /** Tamaño de cada chunk de `arguments`, en bytes. */
  chunkBytes?: number;
  /** Demora entre chunks de `arguments`, en ms. Con los defaults, un
   *  documento de ~15 KB tarda entre 10 y 20 segundos en terminar. */
  chunkDelayMs?: number;
  /** Si está entre 0 y 1 (exclusive), corta la conexión a esa fracción del
   *  tool call — sin `finish_reason` ni `usage`, como una caída de red real.
   *  Para ejercitar reintentos/`code_reset` del lado del cliente. */
  cortarEnFraccion?: number;
  finishReason?: string;
  usage?: UsageScript;
}

/**
 * T9 ("Varias versiones al crear un recurso"): una respuesta elegida por el
 * CONTENIDO del pedido (`match`), no por orden de llegada — las tres
 * llamadas de un turno de versiones salen casi juntas y pueden llegar en
 * cualquier orden, así que un FIFO no alcanza para saber cuál es la 1, la 2
 * o la 3. `match` recibe el `body` completo (mismo objeto que ve la app:
 * `messages`, `model`, `tools`, `tool_choice`), típicamente para buscar la
 * directiva de esa versión en el system prompt (`body.messages[0].content`).
 */
export interface RespuestaCondicional {
  match: (body: Record<string, unknown>) => boolean;
  respuesta: RespuestaScript;
}

/**
 * T2 (verificador): una respuesta programada para `/v1/responses`, el
 * dialecto de la Responses API que habla un `AiProvider` con
 * `apiFormat: 'responses'` (`src/lib/ai/provider.ts`, `readCompletionStream`
 * con el segundo argumento en `'responses'`). Deliberadamente más chica que
 * `RespuestaScript`: no ejercita vista previa progresiva (nadie la necesita
 * todavía en este dialecto) ni las colas condicionales/checklist de arriba
 * — sólo lo que hace falta para que T3/T4 puedan e2e un motor verificador:
 * texto de una sola vez, y un `function_call` cuando el pedido ofrece
 * `tools` con un `tool_choice` que fuerza una en particular (igual que el
 * default de la cola de Chat Completions llama la herramienta, PERO acá no
 * hay default implícito: sin `tools`/`tool_choice` forzado en el pedido, NO
 * hay function_call, sea cual sea el script — un verificador manda
 * `sinHerramientas`, así que nunca corresponde inventarle uno).
 */
export interface RespuestaResponsesScript {
  /** HTTP status alternativo (429, 500, …) en vez de streaming. */
  status?: number;
  /** Demora antes del primer byte, en ms. */
  demoraInicialMs?: number;
  /** Texto de `response.output_text.delta`. Default: un JSON vacío de
   *  "sin hallazgos", útil como default no vacío para un verificador. */
  texto?: string;
  /** Los `arguments` (JSON crudo) de la función forzada, si el pedido la
   *  fuerza. Default: `{"html": htmlDeEjemplo(2000)}`. */
  argumentosFuncion?: string;
  /** `response.completed` (default), `response.incomplete` (truncado) o
   *  `response.failed`. */
  finishReason?: 'completed' | 'incomplete' | 'failed';
  /** Mensaje de `response.failed`, o del evento `error` si `viaErrorEvent`. */
  errorMessage?: string;
  /** En vez de terminar con `response.failed`, corta con un evento
   *  `type: 'error'` a mitad de stream (sin `response.completed` después) —
   *  el otro camino de error que puede mandar la Responses API real. */
  viaErrorEvent?: boolean;
  usage?: UsageScript;
}

export interface MockProveedor {
  url: string;
  puerto: number;
  /** Se va llenando en vivo: podés leerla en cualquier momento (no hace
   *  falta esperar a `detener()`). */
  llamadas: LlamadaRegistrada[];
  /**
   * T22 (round 5, `arnes-robustez`): prende o apaga, en caliente, el modo
   * "ansioso con la herramienta" — imita un modelo que, apenas ve `tools` +
   * `tool_choice: 'auto'` (o `tool_choice` ausente, que el dialecto OpenAI
   * trata igual), prefiere llamar la herramienta en vez de contestar texto.
   * Con el modo prendido, CUALQUIER pedido en esa forma recibe un tool call
   * `update_resource_code` en vez de la respuesta que le tocaría — incluido
   * el pedido de checklist (T16), que en el flujo normal esquiva las dos
   * colas por `MARCADOR_SISTEMA_CHECKLIST` (ver `manejarPedido`). Un pedido
   * SIN `tools` (el checklist después de T20) sigue su camino de siempre.
   * Apagado por defecto: los scripts viejos no se enteran de que esto
   * existe. Reproduce, de punta a punta contra este mock, el defecto real
   * medido contra DeepSeek (odd/tasks/arnes-robustez.md, "Round 5 fix").
   */
  establecerAnsiosoConHerramienta(activar: boolean): void;
  /** Encola una respuesta para el PRÓXIMO pedido que llegue (FIFO). Sin
   *  nada encolado, se usa la respuesta por defecto. */
  programarRespuesta(respuesta: RespuestaScript): void;
  /**
   * Igual que `programarRespuesta`, pero la respuesta se elige por el
   * CONTENIDO del pedido, no por orden de llegada (ver `RespuestaCondicional`
   * más arriba). Se revisa ANTES que la cola FIFO, en el orden en que se
   * programaron cada una; la primera que matchea se consume y se saca de la
   * cola (no vuelve a aplicar a un pedido futuro). Si ninguna condicional
   * matchea, se sigue con el comportamiento de siempre
   * (`programarRespuesta`/la respuesta por defecto) — así los scripts viejos
   * que sólo usan `programarRespuesta` no se enteran de que esto existe.
   */
  programarRespuestaCondicional(
    match: (body: Record<string, unknown>) => boolean,
    respuesta: RespuestaScript,
  ): void;
  /** T2 (verificador): igual que `programarRespuesta`, pero para el FIFO
   *  aparte de `/v1/responses` — ver `RespuestaResponsesScript`. */
  programarRespuestaResponses(respuesta: RespuestaResponsesScript): void;
  detener(): Promise<void>;
}

const CHUNK_BYTES_DEFECTO = 96;
const CHUNK_DELAY_MS_DEFECTO = 90;
const RESPUESTA_POR_DEFECTO: RespuestaScript = {};

// ─────────────────────────────────────────────────────────────
// HTML de ejemplo: ~15 KB, con el meta del kit y JS que hace algo real
// (un contador vivo y una devolución al elegir una opción), para poder
// comprobar en el chequeo de navegador que "las escrituras corren".
// ─────────────────────────────────────────────────────────────

/** Determinista a propósito (nada de `Math.random`): mismo `n` da siempre
 *  el mismo orden de opciones, así el HTML de ejemplo es reproducible. */
function rotar<T>(valores: T[], n: number): T[] {
  const corte = n % valores.length;
  return [...valores.slice(corte), ...valores.slice(0, corte)];
}

function tarjetaPregunta(n: number): string {
  const correcta = 7 * n;
  const distractores = [correcta - 7, correcta + 7, correcta + 1, correcta - 1].filter(
    (valor) => valor > 0 && valor !== correcta,
  );
  const opciones = rotar([correcta, ...distractores.slice(0, 3)], n);
  const letras = ['A', 'B', 'C', 'D'] as const;
  const correctaLetra = letras[opciones.indexOf(correcta)];

  const botones = opciones
    .map(
      (valor, indice) =>
        `<button type="button" data-opcion="${letras[indice]}" class="rounded-lg border border-linea bg-fondo px-3 py-2 text-tinta transition-colors hover:bg-suave/20">${valor}</button>`,
    )
    .join('\n      ');

  return `    <article data-pregunta data-correcta="${correctaLetra}" class="rounded-xl border border-linea bg-superficie p-4">
      <p class="text-lg text-tinta"><i data-lucide="calculator" class="lucide"></i> 7 &times; ${n} = ?</p>
      <div class="mt-3 grid grid-cols-4 gap-2">
      ${botones}
      </div>
      <p data-devolucion class="mt-2 min-h-5 text-sm text-suave"></p>
    </article>`;
}

/** Genera un documento HTML válido de aproximadamente `objetivoBytes`,
 *  repitiendo tarjetas de la tabla del 7 hasta llegar al tamaño. */
export function htmlDeEjemplo(objetivoBytes = 15_000): string {
  const tarjetas: string[] = [];
  let n = 1;
  while (tarjetas.join('\n').length < objetivoBytes) {
    tarjetas.push(tarjetaPregunta(n));
    n++;
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="kodu-tema" content="pizarron">
<!-- plan: tema=pizarron | estructura=preguntas | lo central=practicar la tabla del 7 -->
<title>Tabla del 7 — práctica</title>
</head>
<body>
  <header class="mx-auto max-w-2xl px-4 py-6">
    <h1 class="font-display text-2xl text-tinta">Practicá la tabla del 7</h1>
    <p class="mt-1 text-suave">Elegí la respuesta correcta en cada pregunta.</p>
  </header>
  <main class="mx-auto max-w-2xl space-y-4 px-4 pb-10">
${tarjetas.join('\n')}
  </main>
  <p id="kodu-mock-vivo" data-tick="0" class="fixed bottom-2 right-2 rounded-full bg-superficie px-3 py-1 text-xs text-suave shadow">vivo: 0</p>
  <script>
  (function () {
    var i = 0;
    var el = document.getElementById('kodu-mock-vivo');
    setInterval(function () {
      i++;
      if (el) { el.textContent = 'vivo: ' + i; el.setAttribute('data-tick', String(i)); }
    }, 1000);

    document.querySelectorAll('[data-opcion]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var tarjeta = boton.closest('[data-pregunta]');
        if (!tarjeta) return;
        var correcta = boton.getAttribute('data-opcion') === tarjeta.getAttribute('data-correcta');
        var devolucion = tarjeta.querySelector('[data-devolucion]');
        if (devolucion) devolucion.textContent = correcta ? 'Correcto.' : 'De nuevo.';
      });
    });
  })();
  <\/script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// Servidor
// ─────────────────────────────────────────────────────────────

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function leerCuerpo(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const trozos: Buffer[] = [];
    req.on('data', (trozo: Buffer) => trozos.push(trozo));
    req.on('end', () => resolve(Buffer.concat(trozos).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * T4: engancha el ciclo de vida real de la conexión ANTES de leer el body
 * (`leerCuerpo`, más abajo) — probado a mano: si el listener de `req.on
 * ('close', …)` se registra DESPUÉS de que el body ya terminó de leerse
 * (`req` ya emitió su propio `'end'`), Node puede no volver a emitirlo (el
 * cierre real de la conexión, más tarde, no dispara nada porque el listener
 * llegó tarde). Por eso esto se llama apenas arranca el handler, sobre un
 * tracker propio — recién cuando se conoce el `body` (después de
 * `leerCuerpo`) se cuelga ese tracker de la `LlamadaRegistrada` que se
 * empuja a la cola, vía el getter de abajo.
 *
 * `res.on('finish', …)` marca "terminó sola" (cualquier salida normal del
 * handler, sea cual sea el script); si `req` se cierra ANTES de eso,
 * `cortadoTemprano` queda en `true`. Nunca al revés (`res.destroy()` de
 * `cortarEnFraccion` también cuenta, a propósito: es OTRA forma de "no llegó
 * a terminar sola").
 */
function seguirCierreTemprano(req: IncomingMessage, res: ServerResponse): { cortadoTemprano: boolean } {
  const seguimiento = { cortadoTemprano: false };
  let terminoSola = false;
  res.on('finish', () => {
    terminoSola = true;
  });
  req.on('close', () => {
    if (!terminoSola) seguimiento.cortadoTemprano = true;
  });
  return seguimiento;
}

function chunkBase(id: string, modelo: string) {
  return { id, object: 'chat.completion.chunk' as const, created: Math.floor(Date.now() / 1000), model: modelo };
}

function escribirChunk(res: ServerResponse, chunk: unknown) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

/**
 * Respuesta de checklist por defecto (T16): texto plano, sin tool call —
 * `parsearChecklist` (`src/lib/ai/checklist.ts`) sólo lee líneas que
 * empiezan con "- ". Da un checklist real y no vacío a propósito: así
 * cualquier chequeo end-to-end que corra CONTRA este mock por defecto (sin
 * programar nada a mano) ejercita el camino completo — evento `checklist`,
 * bloque en el último mensaje de usuario, columna persistida — en vez de
 * "sin checklist" por una respuesta vacía.
 */
async function responderChecklistPorDefecto(res: ServerResponse, id: string, modelo: string): Promise<void> {
  const lineas = [
    '- Si arrastro el punto a 3/4, el texto muestra 3/4.',
    '- Tocar "Reiniciar" borra el mensaje de la ronda anterior.',
    '- Con 0 aciertos no aparece el festejo.',
  ];

  for (const linea of lineas) {
    escribirChunk(res, {
      ...chunkBase(id, modelo),
      choices: [{ index: 0, delta: { content: `${linea}\n` }, finish_reason: null }],
    });
    await esperar(20);
  }

  escribirChunk(res, { ...chunkBase(id, modelo), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  escribirChunk(res, {
    ...chunkBase(id, modelo),
    choices: [],
    usage: { prompt_tokens: 300, completion_tokens: 60, prompt_tokens_details: { cached_tokens: 0 } },
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

/**
 * T22 ("ansioso con la herramienta"): la respuesta de un modelo que, con
 * `tools` ofrecidas en modo libre, prefiere llamar `update_resource_code`
 * en vez de contestar texto. No hace falta un HTML grande ni troceado
 * lento (esto no ejercita la vista previa progresiva) — un tool call de una
 * sola tanda, ya completo, alcanza para reproducir el defecto: el llamador
 * ve `finish_reason: 'tool_calls'` y ningún delta de texto.
 */
async function responderConHerramientaAnsiosa(res: ServerResponse, id: string, modelo: string): Promise<void> {
  const argumentos = JSON.stringify({ html: htmlDeEjemplo(2_000) });

  escribirChunk(res, {
    ...chunkBase(id, modelo),
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, id: `call_${id}`, type: 'function', function: { name: UPDATE_RESOURCE_CODE, arguments: '' } },
          ],
        },
        finish_reason: null,
      },
    ],
  });
  escribirChunk(res, {
    ...chunkBase(id, modelo),
    choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: argumentos } }] }, finish_reason: null }],
  });
  escribirChunk(res, { ...chunkBase(id, modelo), choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  escribirChunk(res, {
    ...chunkBase(id, modelo),
    choices: [],
    usage: { prompt_tokens: 200, completion_tokens: 90, prompt_tokens_details: { cached_tokens: 0 } },
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

function escribirEventoResponses(res: ServerResponse, type: string, extra: Record<string, unknown> = {}) {
  res.write(`data: ${JSON.stringify({ type, ...extra })}\n\n`);
}

/**
 * T2 (verificador): si el pedido ofrece `tools` Y las fuerza con
 * `tool_choice: {type:'function', name}` (`aResponsesBody` en
 * `provider.ts` sólo manda esa forma o `'auto'`, nunca un string suelto
 * salvo `'auto'`), devuelve el nombre forzado. `'auto'` o sin `tools`: sin
 * function_call — mismo criterio que documenta `RespuestaResponsesScript`.
 */
function funcionForzadaDelPedido(body: Record<string, unknown>): string | null {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (tools.length === 0) return null;
  const toolChoice = body.tool_choice;
  if (toolChoice && typeof toolChoice === 'object' && (toolChoice as Record<string, unknown>).type === 'function') {
    const nombre = (toolChoice as Record<string, unknown>).name;
    return typeof nombre === 'string' ? nombre : UPDATE_RESOURCE_CODE;
  }
  return null;
}

/**
 * T2 (verificador): el handler de `/v1/responses` — ver
 * `RespuestaResponsesScript` para lo que puede scriptear un test.
 */
async function manejarPedidoResponses(
  req: IncomingMessage,
  res: ServerResponse,
  llamadas: LlamadaRegistrada[],
  colaRespuestas: RespuestaResponsesScript[],
): Promise<void> {
  const seguimiento = seguirCierreTemprano(req, res);
  const crudo = await leerCuerpo(req);
  let body: Record<string, unknown>;
  try {
    body = crudo ? (JSON.parse(crudo) as Record<string, unknown>) : {};
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'mock-proveedor: el body no es JSON válido' } }));
    return;
  }

  llamadas.push({
    recibidaEn: Date.now(),
    body,
    get cortadoTemprano() {
      return seguimiento.cortadoTemprano;
    },
  });

  const script = colaRespuestas.shift() ?? {};

  if (script.status && script.status !== 200) {
    res.writeHead(script.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `mock-proveedor: status ${script.status} scripteado` } }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const id = `resp-${Date.now()}-${llamadas.length}`;

  if (script.demoraInicialMs) await esperar(script.demoraInicialMs);

  if (script.viaErrorEvent) {
    // Corte de red/error de la Responses API a mitad de stream: nunca llega
    // `response.completed` después de esto — `readResponsesStream`
    // (`provider.ts`) tiene que tirar acá, no devolver un turno vacío.
    escribirEventoResponses(res, 'error', { message: script.errorMessage ?? 'mock-proveedor: error scripteado' });
    res.end();
    return;
  }

  // Una sola tanda alcanza: este dialecto no ejercita vista previa
  // progresiva (a diferencia de `/v1/chat/completions` arriba).
  const texto = script.texto ?? '{"problemas":[]}';
  escribirEventoResponses(res, 'response.output_text.delta', { delta: texto });

  const nombreFuncion = funcionForzadaDelPedido(body);
  if (nombreFuncion) {
    const itemId = `item_${id}`;
    escribirEventoResponses(res, 'response.output_item.added', {
      item: { id: itemId, type: 'function_call', call_id: `call_${id}`, name: nombreFuncion },
    });
    const argumentos = script.argumentosFuncion ?? JSON.stringify({ html: htmlDeEjemplo(2_000) });
    escribirEventoResponses(res, 'response.function_call_arguments.delta', { item_id: itemId, delta: argumentos });
  }

  const usage = script.usage ?? { prompt_tokens: 500, completion_tokens: 150, cached_tokens: 0 };
  const tipoFinal = script.finishReason ?? 'completed';
  escribirEventoResponses(res, `response.${tipoFinal}`, {
    response: {
      usage: {
        input_tokens: usage.prompt_tokens,
        output_tokens: usage.completion_tokens,
        input_tokens_details: { cached_tokens: usage.cached_tokens ?? 0 },
      },
      ...(tipoFinal === 'failed'
        ? { error: { message: script.errorMessage ?? 'mock-proveedor: response.failed scripteado' } }
        : {}),
    },
  });

  res.write('data: [DONE]\n\n');
  res.end();
}

async function manejarPedido(
  req: IncomingMessage,
  res: ServerResponse,
  llamadas: LlamadaRegistrada[],
  colaRespuestas: RespuestaScript[],
  colaCondicional: RespuestaCondicional[],
  estado: { ansiosoConHerramienta: boolean },
): Promise<void> {
  const seguimiento = seguirCierreTemprano(req, res);
  const crudo = await leerCuerpo(req);
  let body: Record<string, unknown>;
  try {
    body = crudo ? (JSON.parse(crudo) as Record<string, unknown>) : {};
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'mock-proveedor: el body no es JSON válido' } }));
    return;
  }

  llamadas.push({
    recibidaEn: Date.now(),
    body,
    get cortadoTemprano() {
      return seguimiento.cortadoTemprano;
    },
  });

  // T22: en modo "ansioso con la herramienta", CUALQUIER pedido que ofrezca
  // `tools` en modo libre (`tool_choice: 'auto'` o ausente — el dialecto
  // OpenAI trata las dos formas igual) recibe un tool call, ANTES de mirar
  // la cola condicional, el marcador de checklist o el FIFO — ninguno de
  // esos decide nada para este pedido. Un pedido sin `tools` (el checklist,
  // después de T20) sigue de largo hacia el camino de siempre.
  const toolsOfrecidas = Array.isArray(body.tools) && body.tools.length > 0;
  const eligeLibremente = body.tool_choice === 'auto' || body.tool_choice === undefined;
  if (estado.ansiosoConHerramienta && toolsOfrecidas && eligeLibremente) {
    const id = `mock-${Date.now()}-${llamadas.length}`;
    const modelo = typeof body.model === 'string' ? body.model : 'mock-model';
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    await responderConHerramientaAnsiosa(res, id, modelo);
    return;
  }

  // T9: se prueba primero la cola condicional (por contenido) y recién si
  // ninguna matchea se cae al FIFO de siempre — ver `programarRespuestaCondicional`.
  const indiceCondicional = colaCondicional.findIndex((entrada) => {
    try {
      return entrada.match(body);
    } catch {
      return false; // un `match` que tira no cuenta como matcheado
    }
  });

  // T16: el pedido de checklist se reconoce ANTES de tocar ninguna de las
  // dos colas — sólo cuando además nadie programó una condicional a propósito
  // para él (si programaron una, gana esa, como con cualquier otro pedido).
  const mensajes = Array.isArray(body.messages) ? (body.messages as Array<Record<string, unknown>>) : [];
  const esPedidoDeChecklist =
    indiceCondicional === -1 &&
    typeof mensajes[0]?.content === 'string' &&
    (mensajes[0]!.content as string).includes(MARCADOR_SISTEMA_CHECKLIST);

  if (esPedidoDeChecklist) {
    const id = `mock-${Date.now()}-${llamadas.length}`;
    const modelo = typeof body.model === 'string' ? body.model : 'mock-model';
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    await responderChecklistPorDefecto(res, id, modelo);
    return;
  }

  const script =
    indiceCondicional !== -1
      ? colaCondicional.splice(indiceCondicional, 1)[0]!.respuesta
      : (colaRespuestas.shift() ?? RESPUESTA_POR_DEFECTO);

  if (script.status && script.status !== 200) {
    res.writeHead(script.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `mock-proveedor: status ${script.status} scripteado` } }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const id = `mock-${Date.now()}-${llamadas.length}`;
  const modelo = typeof body.model === 'string' ? body.model : 'mock-model';

  if (script.demoraInicialMs) await esperar(script.demoraInicialMs);

  // Texto, repartido en unas pocas tandas (no una por palabra: alcanza con
  // que se vea que llega en varios pedazos).
  const texto = script.texto ?? 'Dale, te armo el recurso. Un momento…';
  const palabras = texto.split(' ');
  for (let i = 0; i < palabras.length; i += 3) {
    const trozo = palabras.slice(i, i + 3).join(' ') + (i + 3 < palabras.length ? ' ' : '');
    escribirChunk(res, {
      ...chunkBase(id, modelo),
      choices: [{ index: 0, delta: { content: trozo }, finish_reason: null }],
    });
    await esperar(60);
  }

  const llamarHerramienta = script.llamarHerramienta ?? true;

  if (llamarHerramienta) {
    const html = script.html ?? htmlDeEjemplo();
    const argumentos = JSON.stringify({ html });
    const chunkBytes = script.chunkBytes ?? CHUNK_BYTES_DEFECTO;
    const chunkDelayMs = script.chunkDelayMs ?? CHUNK_DELAY_MS_DEFECTO;

    // Primer delta: abre el tool call con el nombre y el id (como hacen los
    // proveedores reales), `arguments` vacío todavía.
    escribirChunk(res, {
      ...chunkBase(id, modelo),
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, id: `call_${id}`, type: 'function', function: { name: UPDATE_RESOURCE_CODE, arguments: '' } },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    await esperar(chunkDelayMs);

    const totalChunks = Math.max(1, Math.ceil(argumentos.length / chunkBytes));
    const cortarEn =
      script.cortarEnFraccion != null && script.cortarEnFraccion > 0 && script.cortarEnFraccion < 1
        ? Math.max(1, Math.min(totalChunks - 1, Math.round(totalChunks * script.cortarEnFraccion)))
        : null;

    for (let i = 0; i < totalChunks; i++) {
      if (cortarEn != null && i >= cortarEn) {
        // Corte de red simulado: nunca llega `finish_reason` ni `usage`.
        res.destroy();
        return;
      }

      const trozo = argumentos.slice(i * chunkBytes, (i + 1) * chunkBytes);
      escribirChunk(res, {
        ...chunkBase(id, modelo),
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: trozo } }] }, finish_reason: null }],
      });
      await esperar(chunkDelayMs);
    }
  }

  escribirChunk(res, {
    ...chunkBase(id, modelo),
    choices: [{ index: 0, delta: {}, finish_reason: script.finishReason ?? (llamarHerramienta ? 'tool_calls' : 'stop') }],
  });

  const usage = script.usage ?? { prompt_tokens: 800, completion_tokens: 4_200, cached_tokens: 0 };
  escribirChunk(res, {
    ...chunkBase(id, modelo),
    choices: [],
    usage: {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      prompt_tokens_details: { cached_tokens: usage.cached_tokens ?? 0 },
    },
  });

  res.write('data: [DONE]\n\n');
  res.end();
}

export interface MockProveedorOpciones {
  puerto?: number;
  /** T22: arranca directamente en modo "ansioso con la herramienta" — ver
   *  `establecerAnsiosoConHerramienta`. Default: apagado (comportamiento
   *  de siempre). También se puede prender/apagar después, en caliente. */
  ansiosoConHerramienta?: boolean;
}

export async function iniciarMockProveedor(opciones: MockProveedorOpciones = {}): Promise<MockProveedor> {
  const puerto = opciones.puerto ?? PUERTO_POR_DEFECTO;
  const llamadas: LlamadaRegistrada[] = [];
  const colaRespuestas: RespuestaScript[] = [];
  const colaCondicional: RespuestaCondicional[] = [];
  const colaRespuestasResponses: RespuestaResponsesScript[] = [];
  const estado = { ansiosoConHerramienta: opciones.ansiosoConHerramienta ?? false };

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/salud') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    // T2 (verificador): dialecto aparte, cola aparte — ver
    // `manejarPedidoResponses`/`RespuestaResponsesScript`.
    if (req.method === 'POST' && req.url?.endsWith('/v1/responses')) {
      manejarPedidoResponses(req, res, llamadas, colaRespuestasResponses).catch((error) => {
        console.error('[mock-proveedor] error atendiendo el pedido de /v1/responses:', error);
        try {
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'mock-proveedor: error interno' } }));
        } catch {
          /* la conexión ya se había cortado */
        }
      });
      return;
    }

    if (req.method !== 'POST' || !req.url?.endsWith('/v1/chat/completions')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'mock-proveedor: ruta no encontrada' } }));
      return;
    }

    manejarPedido(req, res, llamadas, colaRespuestas, colaCondicional, estado).catch((error) => {
      console.error('[mock-proveedor] error atendiendo el pedido:', error);
      try {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'mock-proveedor: error interno' } }));
      } catch {
        /* la conexión ya se había cortado */
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(puerto, '127.0.0.1', () => resolve());
  });

  return {
    url: `http://127.0.0.1:${puerto}`,
    puerto,
    llamadas,
    establecerAnsiosoConHerramienta: (activar: boolean) => {
      estado.ansiosoConHerramienta = activar;
    },
    programarRespuesta: (respuesta: RespuestaScript) => colaRespuestas.push(respuesta),
    programarRespuestaCondicional: (match, respuesta) => colaCondicional.push({ match, respuesta }),
    programarRespuestaResponses: (respuesta: RespuestaResponsesScript) => colaRespuestasResponses.push(respuesta),
    detener: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

// Corrida directa: `npx tsx e2e/mock-proveedor.ts`.
const esEntradaPrincipal = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (esEntradaPrincipal) {
  const mock = await iniciarMockProveedor();
  console.log(`[mock-proveedor] escuchando en ${mock.url}`);
  console.log(`[mock-proveedor] AiProvider: baseUrl = ${mock.url} (sin /v1/chat/completions), cualquier apiKey.`);
  console.log('[mock-proveedor] Ctrl+C para cortar.');
}
