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

/**
 * Rescata el documento HTML cuando el modelo lo escribió en el texto en vez de
 * llamar a la herramienta.
 *
 * No es lo que debería pasar —el contrato es que el código viaje por
 * `update_resource_code`— pero pasa: hay modelos que anuncian el cambio, pegan
 * el HTML en la respuesta y nunca llaman la función. Perder ese trabajo y
 * dejar el recurso intacto es peor que aceptarlo.
 *
 * Se exige un documento COMPLETO (de `<!DOCTYPE` o `<html` hasta `</html>`)
 * justamente para no aplicar un fragmento suelto que rompería el recurso.
 */
export function rescatarHtmlDelTexto(texto: string): { html: string; resto: string } | null {
  const enBloque = /```(?:html)?\s*(<(?:!doctype|html)[\s\S]*?<\/html\s*>)\s*```/i.exec(texto);
  const suelto = /(<(?:!doctype|html)[\s\S]*?<\/html\s*>)/i.exec(texto);
  const encontrado = enBloque ?? suelto;

  if (!encontrado) return null;

  const html = encontrado[1]!.trim();
  if (html.length < 200) return null;

  // El texto que queda es lo que va al chat: el código nunca se muestra ahí.
  const resto = texto.replace(encontrado[0]!, '').replace(/\n{3,}/g, '\n\n').trim();

  return { html, resto };
}
