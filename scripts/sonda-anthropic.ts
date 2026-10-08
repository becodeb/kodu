/**
 * T1 (motor-claude): sonda real contra la Messages API de Anthropic, SIN
 * tocar la base de datos — arma un `ProviderConfig` a mano (ver el
 * instructivo de la tarea) y pega directo a `requestCompletionStream`/
 * `readCompletionStream`, igual que un caller real.
 *
 * Uso:
 *   set -a; . ~/.credentials/anthropic-kodu.env; set +a
 *   npx tsx scripts/sonda-anthropic.ts
 *
 * Gasto esperado: unos pocos centavos de USD (Haiku 5.5 barato + un pedido
 * chico a Sonnet 5.5 con max_tokens:300). Nunca reintenta en loop.
 */

import {
  requestCompletionStream,
  readCompletionStream,
  razonamiento,
  razonamientoNulo,
  type ChatMessage,
  type ProviderConfig,
  type StreamEvent,
} from '../src/lib/ai/provider.ts';
import { calcularCostoTurno } from '../src/lib/ai/usage.ts';
import { buildSystemPrompt } from '../src/lib/ai/prompt.ts';
import { Prisma } from '../src/generated/prisma/client.ts';

const apiKeyEnv = process.env.ANTHROPIC_KODU_API_KEY;
if (!apiKeyEnv) {
  console.error('Falta ANTHROPIC_KODU_API_KEY en el entorno (cargá ~/.credentials/anthropic-kodu.env primero).');
  process.exit(1);
}
// Función en vez de const: `process.exit` no estrecha el tipo adentro de los
// closures declarados más abajo (`configHaiku` etc.), así que se re-lee acá.
const apiKey: string = apiKeyEnv;

function configHaiku(): ProviderConfig {
  return {
    id: 'sonda-haiku-5-5',
    label: 'Claude Haiku 5.5 (sonda)',
    apiKey,
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-haiku-5-5',
    maxTokens: 4_000,
    apiFormat: 'anthropic',
    userTokenLimit: 0,
    userTokenWindowHours: 0,
    maxInputChars: 400_000,
    supportsVision: false,
    reasoningEffort: 'low',
    reasoningParam: 'effort',
    precios: {
      // Precios reales de Claude Haiku 5.5 (prompts ≤100K): 0.10/0.50 por
      // MTok, cache read 0.01, cache write 1.25x el de entrada (0.125).
      input: new Prisma.Decimal(0.1),
      output: new Prisma.Decimal(0.5),
      cachedInput: new Prisma.Decimal(0.01),
      cacheWrite: new Prisma.Decimal(0.125),
    },
    schedule: null,
  };
}

function configSonnetForzado(): ProviderConfig {
  return { ...configHaiku(), id: 'sonda-sonnet-5-5', label: 'Claude Sonnet 5.5 (sonda)', model: 'claude-sonnet-5-5' };
}

const SYSTEM_PROMPT = buildSystemPrompt({
  globalRules: [],
  userRules: [],
  assets: [],
  canSeeImages: false,
  turnosPrevios: 5, // >2: sin el bloque de "preguntas tempranas", prompt estable.
  herramientaForzada: false,
});

const PEDIDO_DOCENTE = 'Una tarjeta que diga Hola con un botón que cambie el color';

interface UsagePlano {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
}

async function consumirStream(
  response: Awaited<ReturnType<typeof requestCompletionStream>>,
): Promise<{ texto: string; toolRecibido: boolean; toolName: string; htmlLen: number; usage: UsagePlano | null }> {
  let texto = '';
  let toolRecibido = false;
  let toolName = '';
  let htmlLen = 0;
  let usage: UsagePlano | null = null;

  for await (const event of readCompletionStream(response, 'anthropic')) {
    if (event.type === 'text') texto += event.delta;
    if (event.type === 'tool_start') {
      toolRecibido = true;
      toolName = event.name;
    }
    if (event.type === 'tool') {
      toolRecibido = true;
      toolName = event.name;
      try {
        const parsed = JSON.parse(event.arguments) as { html?: string };
        htmlLen = parsed.html?.length ?? 0;
      } catch {
        htmlLen = -1; // JSON no parseable — se reporta igual, no se tira la sonda.
      }
    }
    if (event.type === 'usage') usage = event.usage;
  }

  return { texto, toolRecibido, toolName, htmlLen, usage };
}

async function llamadaConHerramienta(etiqueta: string, provider: ProviderConfig): Promise<void> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: PEDIDO_DOCENTE },
  ];

  const response = await requestCompletionStream({
    messages,
    provider,
    razonamientoOverride: razonamiento(provider),
  });

  const { toolRecibido, toolName, htmlLen, usage } = await consumirStream(response);

  console.log(`\n[${etiqueta}] tool call recibido: ${toolRecibido} (${toolName})`);
  console.log(`[${etiqueta}] html length: ${htmlLen}`);
  if (usage) {
    console.log(
      `[${etiqueta}] usage: input=${usage.promptTokens} cache_read=${usage.cachedTokens} cache_creation=${usage.cacheWriteTokens} output=${usage.completionTokens}`,
    );
    const costo = calcularCostoTurno(usage.promptTokens, usage.cachedTokens, usage.completionTokens, provider.precios, usage.cacheWriteTokens);
    console.log(`[${etiqueta}] costUsd: ${costo.costUsd?.toString() ?? 'null'}`);
    return;
  }
  console.log(`[${etiqueta}] usage: ninguno (no se recibió evento de consumo)`);
}

async function llamadaSinHerramientas(): Promise<void> {
  const provider = configHaiku();
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Dame un checklist de 4 a 6 ítems para este pedido, sin tocar el recurso: ${PEDIDO_DOCENTE}` },
  ];

  const response = await requestCompletionStream({
    messages,
    provider,
    sinHerramientas: true,
    razonamientoOverride: razonamientoNulo(provider),
    maxTokensOverride: 300,
  });

  let texto = '';
  let usage: UsagePlano | null = null;
  for await (const event of readCompletionStream(response, 'anthropic')) {
    if (event.type === 'text') texto += event.delta;
    if (event.type === 'usage') usage = event.usage;
  }

  console.log(`\n[sinHerramientas/checklist] texto (primeros 200 chars): ${texto.slice(0, 200).replace(/\n/g, ' | ')}`);
  console.log(`[sinHerramientas/checklist] usage: ${JSON.stringify(usage)}`);
}

async function forzarToolChoiceEnSonnet(): Promise<void> {
  const provider = configSonnetForzado();
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: 'Un contador simple que suma de uno en uno.' },
  ];

  const response = await requestCompletionStream({
    messages,
    provider,
    forzarHerramienta: true,
    maxTokensOverride: 300,
    razonamientoOverride: razonamiento(provider),
  });

  const { toolRecibido, toolName } = await consumirStream(response);
  console.log(
    `\n[forzarHerramienta/sonnet-5-5] completó sin 400 — degradación a 'auto' (si hizo falta) funcionó. tool recibido: ${toolRecibido} (${toolName})`,
  );
}

async function main() {
  console.log('=== Sonda Anthropic (motor-claude, T1) ===');

  console.log('\n--- Llamada 1 (con herramienta, cache MISS esperado) ---');
  await llamadaConHerramienta('llamada 1', configHaiku());

  console.log('\n--- Llamada 2 (mismo prompt, cache HIT esperado: cache_read > 0) ---');
  await llamadaConHerramienta('llamada 2', configHaiku());

  console.log('\n--- Llamada sin herramientas (checklist) ---');
  await llamadaSinHerramientas();

  console.log('\n--- Forced tool_choice contra Sonnet 5.5 (prueba de degradación) ---');
  await forzarToolChoiceEnSonnet();

  console.log('\n=== Fin de la sonda ===');
}

main().catch((error) => {
  console.error('[sonda-anthropic] falló:', error);
  process.exit(1);
});
