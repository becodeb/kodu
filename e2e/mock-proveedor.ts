import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/**
 * Proveedor de IA simulado para los chequeos de integración de T3 en
 * adelante (odd/tasks/modo-prime.md). Sirve `/v1/chat/completions` con el
 * mismo dialecto SSE que espera `src/lib/ai/provider.ts`
 * (`readCompletionStream`): deltas de texto, un tool call
 * `update_resource_code` con sus `arguments` repartidos en chunks chicos y
 * demorados (para poder ver la vista previa progresiva en acción),
 * `finish_reason` y un chunk final de `usage`. Sin dependencias — sólo
 * `node:http` — porque este repo no tiene test runner (openspec/context.md)
 * y no hace falta traer nada para levantar un servidor HTTP.
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

export interface MockProveedor {
  url: string;
  puerto: number;
  /** Se va llenando en vivo: podés leerla en cualquier momento (no hace
   *  falta esperar a `detener()`). */
  llamadas: LlamadaRegistrada[];
  /** Encola una respuesta para el PRÓXIMO pedido que llegue (FIFO). Sin
   *  nada encolado, se usa la respuesta por defecto. */
  programarRespuesta(respuesta: RespuestaScript): void;
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

function chunkBase(id: string, modelo: string) {
  return { id, object: 'chat.completion.chunk' as const, created: Math.floor(Date.now() / 1000), model: modelo };
}

function escribirChunk(res: ServerResponse, chunk: unknown) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

async function manejarPedido(
  req: IncomingMessage,
  res: ServerResponse,
  llamadas: LlamadaRegistrada[],
  colaRespuestas: RespuestaScript[],
): Promise<void> {
  const crudo = await leerCuerpo(req);
  let body: Record<string, unknown>;
  try {
    body = crudo ? (JSON.parse(crudo) as Record<string, unknown>) : {};
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'mock-proveedor: el body no es JSON válido' } }));
    return;
  }

  llamadas.push({ recibidaEn: Date.now(), body });
  const script = colaRespuestas.shift() ?? RESPUESTA_POR_DEFECTO;

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
}

export async function iniciarMockProveedor(opciones: MockProveedorOpciones = {}): Promise<MockProveedor> {
  const puerto = opciones.puerto ?? PUERTO_POR_DEFECTO;
  const llamadas: LlamadaRegistrada[] = [];
  const colaRespuestas: RespuestaScript[] = [];

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/salud') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    if (req.method !== 'POST' || !req.url?.endsWith('/v1/chat/completions')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'mock-proveedor: ruta no encontrada' } }));
      return;
    }

    manejarPedido(req, res, llamadas, colaRespuestas).catch((error) => {
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
    programarRespuesta: (respuesta: RespuestaScript) => colaRespuestas.push(respuesta),
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
