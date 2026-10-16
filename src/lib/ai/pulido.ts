/**
 * T15 (motor-claude, modo "haiku-pulido"): el paso EXTRA de "pulido visual"
 * — después del self-test/revisor de la generación inicial, UNA llamada a
 * Sonnet 5.5 que recibe la captura ya renderizada + el HTML actual + el
 * pedido del docente, y mejora SÓLO lo visual (paleta dentro del tema,
 * riqueza/profundidad de la ilustración, composición, tipografía, espaciado,
 * legibilidad de proyector) vía `edit_resource_code` — nunca lógica, texto
 * de contenido, ids de elementos, handlers ni `__koduPruebas`.
 *
 * Módulo deliberadamente REUSABLE y sin efectos de registro propios (no
 * llama `recordUsage`/`recordAiTrace`): el llamador (`/api/chat/pulir` hoy,
 * un futuro paso opcional del tier Haiku de `automatico` más adelante,
 * `experimentos/motor-claude/correr.ts` del lado del experimento) decide
 * cómo registrar el consumo y qué hacer con el resultado — esta función
 * sólo hace la llamada y aplica (o no) la edición. NUNCA reintenta: T15 pide
 * explícitamente "no correction loop for polish" — una sola pasada, y si
 * algo no sale bien, `aplicado: false` con el HTML original intacto.
 *
 * El self-test posterior y la decisión de revertir si falla NO viven acá:
 * eso necesita el navegador real (`__koduPruebas` corre en un iframe), así
 * que es trabajo del llamador — esta función es pura I/O con el motor,
 * nunca toca `Project.currentHtml`.
 */

import {
  requestCompletionStream,
  readCompletionStream,
  razonamientoRevisorVisual,
  type ChatMessage,
  type ContentPart,
  type ProviderConfig,
  type TokenUsage as MotorTokenUsage,
} from './provider.ts';
import { parseEditResourceArgs, EDIT_RESOURCE_CODE } from './tools.ts';
import { applyResourceEdits } from './edits.ts';
import { MAX_HTML_CHARS } from './prompt.ts';

/** 150s, mismo tope que una pasada del verificador (`verificar.ts`) — un
 *  modelo con razonamiento releyendo un documento entero puede tardar. */
const TIMEOUT_PULIDO_MS = 150_000;

export interface ResultadoPulido {
  /** `true` sólo si Sonnet llamó `edit_resource_code` Y la edición se pudo
   *  aplicar contra el HTML real sin ninguna falla de validación — en
   *  cualquier otro caso (texto plano, herramienta equivocada, truncado, `no_match`,
   *  `multiple_matches`, cero ediciones) queda en `false` y `html` es el
   *  original, byte a byte: "revert" es automático porque nunca se mutó nada. */
  aplicado: boolean;
  html: string;
  /** Motivo legible cuando `aplicado` es `false` — para loguear/medir, nunca
   *  para decidir nada (el llamador sólo mira `aplicado`). */
  motivo: string | null;
  usage: MotorTokenUsage | null;
  durationMs: number;
}

/**
 * `low`: mismo criterio que `razonamientoRevisorVisual` (T5) — es una
 * pasada ACOTADA (un solo tipo de mejora, un solo tool call esperado), no
 * una reescritura libre; `medium` costaría ~2-3x sin que el pedido necesite
 * más razonamiento que "mirar la imagen y decidir qué tocar".
 */
function razonamientoPulido(provider: ProviderConfig): Record<string, unknown> {
  return razonamientoRevisorVisual(provider);
}

function sistemaPulido(): string {
  return [
    'Sos un diseñador visual revisando un recurso educativo YA FUNCIONAL, generado por otro modelo.',
    'Tu ÚNICO trabajo es mejorar la calidad visual: paleta de color (dentro del tema ya elegido, sin cambiar el tema), riqueza y profundidad de la ilustración, composición, tipografía, espaciado, y legibilidad a la distancia de un proyector.',
    'PROHIBIDO, sin excepción: cambiar lógica, cambiar el texto del contenido educativo, cambiar o agregar ids de elementos, tocar handlers de eventos (onclick, addEventListener, etc.), o tocar nada dentro o cerca de `__koduPruebas`.',
    'Usá SIEMPRE edit_resource_code, nunca update_resource_code — ediciones puntuales, nunca reescribas el documento. Si no encontrás nada visual que valga la pena mejorar, no llames ninguna herramienta.',
  ].join('\n\n');
}

function contenidoUsuario(html: string, pedidoDocente: string, capturaDataUrl: string | string[] | null): string | ContentPart[] {
  const texto = [
    `Pedido original del docente: "${pedidoDocente}"`,
    '',
    'HTML actual del recurso (ya pasó el self-test):',
    '```html',
    html,
    '```',
  ].join('\n');

  const capturas = Array.isArray(capturaDataUrl) ? capturaDataUrl.filter(Boolean) : capturaDataUrl ? [capturaDataUrl] : [];
  if (capturas.length === 0) return texto;
  return [{ type: 'text', text: texto }, ...capturas.map((url): ContentPart => ({ type: 'image_url', image_url: { url } }))];
}

export async function pulirVisualmente(args: {
  html: string;
  pedidoDocente: string;
  /** Captura(s) JPEG ya renderizada(s) — mismo formato que
   *  `construirContenidoUsuarioVerificador` (T5): data URL(s), `null` si no
   *  hay (el pulido sigue de puro texto, sin ver el resultado). */
  capturaDataUrl: string | string[] | null;
  provider: ProviderConfig;
  signal?: AbortSignal;
}): Promise<ResultadoPulido> {
  const arranque = Date.now();
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), TIMEOUT_PULIDO_MS);
  const onAbortExterno = () => controlador.abort();
  args.signal?.addEventListener('abort', onAbortExterno, { once: true });

  const sinResultado = (motivo: string): ResultadoPulido => ({
    aplicado: false,
    html: args.html,
    motivo,
    usage: null,
    durationMs: Date.now() - arranque,
  });

  try {
    const messages: ChatMessage[] = [
      { role: 'system', content: sistemaPulido() },
      { role: 'user', content: contenidoUsuario(args.html, args.pedidoDocente, args.capturaDataUrl) },
    ];

    const respuesta = await requestCompletionStream({
      messages,
      provider: args.provider,
      signal: controlador.signal,
      razonamientoOverride: razonamientoPulido(args.provider),
      // Sólo edit_resource_code, forzado — nunca update_resource_code (T15:
      // "never changing ... via edit_resource_code" implica esa es la ÚNICA
      // herramienta aceptable acá).
      editsEnabled: true,
      soloEdicion: true,
      forzarHerramienta: true,
    });

    let toolName: string | null = null;
    let toolArgs = '';
    let truncated = false;
    let usage: MotorTokenUsage | null = null;

    for await (const event of readCompletionStream(respuesta, args.provider.apiFormat)) {
      if (event.type === 'tool') {
        toolName = event.name;
        toolArgs = event.arguments;
        truncated = event.truncated;
      } else if (event.type === 'usage') {
        usage = event.usage;
      }
    }

    if (!toolName || toolName !== EDIT_RESOURCE_CODE) {
      return { ...sinResultado('sin_tool_call'), usage };
    }
    if (truncated) {
      return { ...sinResultado('truncated'), usage };
    }

    const parsed = parseEditResourceArgs(toolArgs, truncated);
    if (!parsed.ok) {
      return { ...sinResultado(`parse_${parsed.reason}`), usage };
    }
    if (parsed.edits.length === 0) {
      return { ...sinResultado('sin_ediciones'), usage };
    }

    const aplicado = applyResourceEdits(args.html, parsed.edits, MAX_HTML_CHARS);
    if (!aplicado.ok) {
      return { ...sinResultado(`apply_${aplicado.reason}`), usage };
    }

    return { aplicado: true, html: aplicado.html, motivo: null, usage, durationMs: Date.now() - arranque };
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      return sinResultado('abort');
    }
    console.error('[pulido] la pasada de pulido visual falló:', error);
    return sinResultado('error');
  } finally {
    clearTimeout(timeout);
    args.signal?.removeEventListener('abort', onAbortExterno);
  }
}
