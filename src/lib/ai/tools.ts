/**
 * Definición de la función que la IA invoca para actualizar el recurso (SPEC §4.1).
 *
 * Esta es la pieza que mantiene el chat limpio: el HTML nunca viaja en el texto
 * de la conversación, viaja como argumento de este tool call y va directo al iframe.
 */

export const UPDATE_RESOURCE_CODE = 'update_resource_code';

export const RESOURCE_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: UPDATE_RESOURCE_CODE,
      description:
        'Actualiza el código HTML completo autoportante del recurso interactivo que se muestra en el iframe.',
      parameters: {
        type: 'object',
        properties: {
          html: {
            type: 'string',
            description:
              'El documento HTML5 completo autoportante con CSS (Tailwind CDN) y JS embebido.',
          },
        },
        required: ['html'],
      },
    },
  },
];

export type ParsedResourceCode =
  | { ok: true; html: string }
  /**
   * `truncated`: el modelo se quedó sin tokens con el HTML a medio escribir.
   * `invalid`:   el JSON llegó mal formado por otro motivo.
   * `empty`:     vino un `html` vacío o demasiado corto para ser un documento.
   */
  | { ok: false; reason: 'truncated' | 'invalid' | 'empty' };

/**
 * Valida el argumento del tool call antes de tocar la base de datos.
 *
 * Un HTML cortado a la mitad NO se aplica: pisaría el recurso del docente con
 * un documento roto. Se distingue el corte por longitud del JSON inválido
 * porque son dos problemas distintos y el mensaje que ve el docente cambia.
 */
export function parseUpdateResourceArgs(
  rawArguments: string,
  truncated = false,
): ParsedResourceCode {
  let parsed: { html?: unknown };
  try {
    parsed = JSON.parse(rawArguments) as { html?: unknown };
  } catch {
    return { ok: false, reason: truncated ? 'truncated' : 'invalid' };
  }

  if (typeof parsed.html !== 'string') return { ok: false, reason: 'invalid' };

  const html = parsed.html.trim();
  if (html.length < 20) return { ok: false, reason: 'empty' };

  // El JSON puede cerrar bien y el documento venir cortado igual (el modelo
  // alcanzó el tope justo después de cerrar la comilla).
  if (truncated && !/<\/html\s*>\s*$/i.test(html)) return { ok: false, reason: 'truncated' };

  return { ok: true, html };
}
