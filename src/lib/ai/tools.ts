/**
 * Definición de la función que la IA invoca para actualizar el recurso (SPEC §4.1).
 *
 * Esta es la pieza que mantiene el chat limpio: el HTML nunca viaja en el texto
 * de la conversación, viaja como argumento de este tool call y va directo al iframe.
 */

export const UPDATE_RESOURCE_CODE = 'update_resource_code';

/**
 * Forma común de una definición de tool call (dialecto Chat Completions,
 * `{type:'function', function:{...}}`), para que `provider.ts` pueda tener un
 * solo tipo de array con `UPDATE_RESOURCE_CODE` y `EDIT_RESOURCE_CODE` juntos
 * sin que TypeScript los vea como dos literales incompatibles (T3a).
 */
export interface AiTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const RESOURCE_TOOLS: AiTool[] = [
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
              'El documento HTML5 completo autoportante, con CSS y JS embebido. Declará el tema del kit en el <head> con <meta name="kodu-tema" content="ID">: el sistema agrega Tailwind configurado, tipografías e íconos por vos.',
          },
        },
        required: ['html'],
      },
    },
  },
];

/**
 * odd/tasks/ahorro-tokens.md (T3a): segunda herramienta, ofrecida sólo en
 * turnos de AJUSTE (nunca para un recurso nuevo) cuando el interruptor
 * global está prendido (ver `src/lib/settings.ts`,
 * `AppSettings.fragmentEditsEnabled`). En vez del documento completo, el
 * modelo manda una lista de reemplazos puntuales: cada `find` tiene que
 * aparecer EXACTAMENTE una vez en el HTML real guardado, y la aplicación es
 * todo-o-nada (`applyResourceEdits`, en `./edits.ts`) — si cualquiera falla,
 * el recurso no se toca.
 */
export const EDIT_RESOURCE_CODE = 'edit_resource_code';

export const EDIT_RESOURCE_TOOL: AiTool = {
  type: 'function' as const,
  function: {
    name: EDIT_RESOURCE_CODE,
    description:
      'Edita el HTML actual del recurso aplicando una lista de reemplazos de texto puntuales, sin reescribir el documento entero. Preferila para cambios localizados (un texto, un color, una función). Usá update_resource_code cuando el pedido reestructura el recurso o cuando el cambio toca más o menos un tercio del documento o más. Cada "find" tiene que ser una copia EXACTA (mismos espacios y saltos de línea) de un fragmento que aparece UNA SOLA VEZ en el HTML actual: si alguno no matchea exactamente una vez, no se aplica NINGÚN cambio.',
    parameters: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          description: 'Reemplazos a aplicar. Cada find tiene que ser único en el documento actual.',
          items: {
            type: 'object',
            properties: {
              find: {
                type: 'string',
                description:
                  'Texto EXACTO a buscar en el HTML actual, copiado literal del documento (mismos espacios y saltos de línea). Tiene que aparecer una sola vez.',
              },
              replace: {
                type: 'string',
                description: 'Texto que reemplaza al find encontrado.',
              },
            },
            required: ['find', 'replace'],
          },
        },
      },
      required: ['edits'],
    },
  },
};

export interface RawResourceEdit {
  find: string;
  replace: string;
}

export type ParsedResourceEdits =
  | { ok: true; edits: RawResourceEdit[] }
  /** Mismo vocabulario que `ParsedResourceCode`: `empty` acá es "sin ediciones". */
  | { ok: false; reason: 'truncated' | 'invalid' | 'empty' };

/**
 * Valida el argumento de `edit_resource_code` ANTES de tocar el HTML. No
 * aplica nada: eso es trabajo de `applyResourceEdits` (`./edits.ts`), que
 * además necesita el HTML real contra el que matchear.
 */
export function parseEditResourceArgs(rawArguments: string, truncated = false): ParsedResourceEdits {
  let parsed: { edits?: unknown };
  try {
    parsed = JSON.parse(rawArguments) as { edits?: unknown };
  } catch {
    return { ok: false, reason: truncated ? 'truncated' : 'invalid' };
  }

  if (!Array.isArray(parsed.edits)) return { ok: false, reason: 'invalid' };
  if (parsed.edits.length === 0) return { ok: false, reason: 'empty' };

  const edits: RawResourceEdit[] = [];
  for (const raw of parsed.edits) {
    if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'invalid' };
    const { find, replace } = raw as { find?: unknown; replace?: unknown };
    if (typeof find !== 'string' || find.length === 0) return { ok: false, reason: 'invalid' };
    if (typeof replace !== 'string') return { ok: false, reason: 'invalid' };
    edits.push({ find, replace });
  }

  return { ok: true, edits };
}

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
