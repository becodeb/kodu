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

/** Valida el argumento del tool call antes de tocar la base de datos. */
export function parseUpdateResourceArgs(rawArguments: string): string | null {
  try {
    const parsed = JSON.parse(rawArguments) as { html?: unknown };
    if (typeof parsed.html !== 'string') return null;

    const html = parsed.html.trim();
    if (html.length < 20) return null;

    return html;
  } catch {
    return null;
  }
}
