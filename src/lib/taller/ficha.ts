/**
 * Taller de ideas (odd/tasks/taller-de-ideas.md): la ficha de la idea, las
 * preguntas con respuestas para tocar, las ideas propuestas, y la lectura del
 * bloque estructurado que la IA escribe al final de cada respuesta.
 *
 * Módulo isomórfico (sin Prisma, sin Node, sin `env.ts`): lo usan el servidor
 * (`/api/taller/[id]/turno`), el cliente (`TallerDeIdeas.tsx`, para pintar la
 * ficha y el progreso) y `e2e/unidad-taller.ts`, que lo prueba sin base de
 * datos. Mismo criterio que `ai/checklist.ts`.
 *
 * ── Por qué un bloque en el texto y no una herramienta ──
 * La IA contesta texto común (lo que el docente lee en la burbuja, que se ve
 * llegar en vivo) y al final agrega `<taller>{…json…}</taller>` con lo
 * estructurado. Así funciona igual con cualquier motor del catálogo, tenga o
 * no llamadas a herramientas, y sin pelearse con los modelos de razonamiento
 * que no aceptan forzar una herramienta (ver `ToolChoiceNoSoportado`). El
 * servidor corta el bloque del stream antes de que llegue al navegador.
 */

/** Los campos de la ficha "Tu idea", en el orden en que se muestran. */
export const CAMPOS_FICHA = [
  { id: 'tema', etiqueta: 'Tema', ayuda: 'Qué contenido vas a dar' },
  { id: 'nivel', etiqueta: 'Para quién', ayuda: 'Grado, año o edad del grupo' },
  { id: 'objetivo', etiqueta: 'Qué tienen que lograr', ayuda: 'Qué entienden o pueden hacer al terminar' },
  { id: 'idea', etiqueta: 'La herramienta', ayuda: 'Qué es, en una o dos frases' },
  { id: 'interaccion', etiqueta: 'Qué hacen los alumnos', ayuda: 'Qué tocan, mueven, eligen o prueban' },
  { id: 'pasos', etiqueta: 'Pasos o desafíos', ayuda: 'En qué orden, y cómo se avanza' },
  { id: 'devoluciones', etiqueta: 'Cuando aciertan o se equivocan', ayuda: 'Qué les muestra la herramienta' },
  { id: 'datos', etiqueta: 'Datos que tienen que estar bien', ayuda: 'Fechas, fórmulas, nombres exactos' },
  { id: 'estetica', etiqueta: 'Cómo se ve', ayuda: 'Estilo, colores, botones, pantallas' },
  { id: 'uso', etiqueta: 'Dónde se usa', ayuda: 'Proyector, tablet, celular; solos o en grupo' },
] as const;

export type CampoFicha = (typeof CAMPOS_FICHA)[number]['id'];

export type FichaIdea = Partial<Record<CampoFicha, string>>;

const IDS_CAMPOS = new Set<string>(CAMPOS_FICHA.map((campo) => campo.id));

export interface PreguntaTaller {
  texto: string;
  /** Respuestas sugeridas para tocar. Vacío = sólo se contesta escribiendo. */
  opciones: string[];
  /** Se puede elegir más de una respuesta. */
  multiple: boolean;
}

export interface IdeaPropuesta {
  nombre: string;
  /** Qué es y qué hacen los alumnos con ella. */
  resumen: string;
  /** Por qué ayuda a aprender ESE tema. */
  porQue: string;
}

/** Todo lo que la IA puede mandar en el bloque, ya validado. */
export interface DatosTaller {
  preguntas: PreguntaTaller[];
  ideas: IdeaPropuesta[];
  /** Sólo los campos que cambiaron en este turno. */
  ficha: FichaIdea;
  titulo: string | null;
  descripcion: string | null;
  pedido: string | null;
}

export const DATOS_VACIOS: DatosTaller = {
  preguntas: [],
  ideas: [],
  ficha: {},
  titulo: null,
  descripcion: null,
  pedido: null,
};

export const ETIQUETA_APERTURA = '<taller>';
export const ETIQUETA_CIERRE = '</taller>';

const MAX_PREGUNTAS = 3;
const MAX_OPCIONES = 5;
const MAX_IDEAS = 3;
const MAX_LARGO_OPCION = 120;
const MAX_LARGO_PREGUNTA = 300;
const MAX_LARGO_CAMPO = 1_500;
const MAX_LARGO_TITULO = 80;
const MAX_LARGO_DESCRIPCION = 300;
export const MAX_LARGO_PEDIDO = 20_000;

function texto(valor: unknown, maximo: number): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  if (!limpio) return null;
  return limpio.slice(0, maximo);
}

function leerPreguntas(valor: unknown): PreguntaTaller[] {
  if (!Array.isArray(valor)) return [];

  const preguntas: PreguntaTaller[] = [];
  for (const crudo of valor) {
    if (!crudo || typeof crudo !== 'object') continue;
    const objeto = crudo as Record<string, unknown>;
    const enunciado = texto(objeto.texto ?? objeto.pregunta, MAX_LARGO_PREGUNTA);
    if (!enunciado) continue;

    const opciones = Array.isArray(objeto.opciones)
      ? objeto.opciones
          .map((opcion) => texto(opcion, MAX_LARGO_OPCION))
          .filter((opcion): opcion is string => opcion !== null)
      : [];

    preguntas.push({
      texto: enunciado,
      // Sin repetidas: dos chips iguales confunden más de lo que ayudan.
      opciones: [...new Set(opciones)].slice(0, MAX_OPCIONES),
      multiple: objeto.multiple === true,
    });
    if (preguntas.length === MAX_PREGUNTAS) break;
  }
  return preguntas;
}

function leerIdeas(valor: unknown): IdeaPropuesta[] {
  if (!Array.isArray(valor)) return [];

  const ideas: IdeaPropuesta[] = [];
  for (const crudo of valor) {
    if (!crudo || typeof crudo !== 'object') continue;
    const objeto = crudo as Record<string, unknown>;
    const nombre = texto(objeto.nombre, MAX_LARGO_TITULO);
    const resumen = texto(objeto.resumen, MAX_LARGO_CAMPO);
    if (!nombre || !resumen) continue;

    ideas.push({ nombre, resumen, porQue: texto(objeto.por_que ?? objeto.porQue, MAX_LARGO_CAMPO) ?? '' });
    if (ideas.length === MAX_IDEAS) break;
  }
  return ideas;
}

function leerFicha(valor: unknown): FichaIdea {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return {};

  const ficha: FichaIdea = {};
  for (const [clave, crudo] of Object.entries(valor as Record<string, unknown>)) {
    if (!IDS_CAMPOS.has(clave)) continue;
    const valorCampo = texto(crudo, MAX_LARGO_CAMPO);
    if (valorCampo) ficha[clave as CampoFicha] = valorCampo;
  }
  return ficha;
}

/**
 * Del texto crudo del bloque a un objeto. Tolera lo que los modelos hacen en
 * la práctica: envolver el JSON en ```json, dejar texto antes de la llave o
 * una coma de más al final de una lista.
 */
function parsearJsonTolerante(crudo: string): unknown {
  const sinCercas = crudo.replace(/```(?:json)?/gi, '').trim();
  const desde = sinCercas.indexOf('{');
  const hasta = sinCercas.lastIndexOf('}');
  if (desde < 0 || hasta <= desde) return null;

  const candidato = sinCercas.slice(desde, hasta + 1);
  try {
    return JSON.parse(candidato);
  } catch {
    try {
      return JSON.parse(candidato.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

/** Saca los `<think>…</think>` que algunos modelos escriben en el texto. */
function sinPensamiento(texto: string): string {
  return texto.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
}

/**
 * Separa una respuesta completa de la IA en lo que se ve (la burbuja) y lo
 * estructurado. Nunca tira: si el bloque falta o viene roto, `datos` queda
 * vacío y `bloqueValido` en `false` (el turno se guarda igual, con el texto).
 */
export function separarRespuesta(respuesta: string): {
  visible: string;
  datos: DatosTaller;
  bloqueValido: boolean;
} {
  const limpio = sinPensamiento(respuesta);
  const desde = limpio.indexOf(ETIQUETA_APERTURA);

  if (desde < 0) {
    return { visible: limpio.trim(), datos: { ...DATOS_VACIOS }, bloqueValido: false };
  }

  const visible = limpio.slice(0, desde).trim();
  const resto = limpio.slice(desde + ETIQUETA_APERTURA.length);
  const hasta = resto.indexOf(ETIQUETA_CIERRE);
  const crudo = hasta >= 0 ? resto.slice(0, hasta) : resto;

  const objeto = parsearJsonTolerante(crudo);
  if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto)) {
    return { visible, datos: { ...DATOS_VACIOS }, bloqueValido: false };
  }

  const campos = objeto as Record<string, unknown>;
  return {
    visible,
    datos: {
      preguntas: leerPreguntas(campos.preguntas),
      ideas: leerIdeas(campos.ideas),
      ficha: leerFicha(campos.ficha),
      titulo: texto(campos.titulo, MAX_LARGO_TITULO),
      descripcion: texto(campos.descripcion, MAX_LARGO_DESCRIPCION),
      pedido: texto(campos.pedido, MAX_LARGO_PEDIDO),
    },
    bloqueValido: true,
  };
}

/**
 * Para el stream: cuánto del texto acumulado ya se puede mostrar sin riesgo
 * de mostrar el principio de `<taller>` (o de `<think>`). Se retiene la cola
 * que podría ser el comienzo de una etiqueta hasta que llegue el resto.
 */
export function prefijoVisible(acumulado: string): string {
  const limpio = sinPensamiento(acumulado);
  const desde = limpio.indexOf(ETIQUETA_APERTURA);
  if (desde >= 0) return limpio.slice(0, desde);

  // ¿La cola es un comienzo de "<taller>" o de "<think>"? Se retiene.
  const ultimoMenor = limpio.lastIndexOf('<');
  if (ultimoMenor >= 0) {
    const cola = limpio.slice(ultimoMenor);
    if (ETIQUETA_APERTURA.startsWith(cola) || '<think>'.startsWith(cola)) {
      return limpio.slice(0, ultimoMenor);
    }
  }
  return limpio;
}

/** Lee la ficha guardada (`IdeaSession.brief`). Nunca tira. */
export function leerFichaGuardada(json: string | null | undefined): FichaIdea {
  if (!json) return {};
  try {
    return leerFicha(JSON.parse(json));
  } catch {
    return {};
  }
}

export function leerPreguntasGuardadas(json: string | null | undefined): PreguntaTaller[] {
  if (!json) return [];
  try {
    return leerPreguntas(JSON.parse(json));
  } catch {
    return [];
  }
}

export function leerIdeasGuardadas(json: string | null | undefined): IdeaPropuesta[] {
  if (!json) return [];
  try {
    // `leerIdeas` ya acepta `porQue` (lo guardado) además de `por_que` (lo
    // que escribe el modelo).
    return leerIdeas(JSON.parse(json));
  } catch {
    return [];
  }
}

/** La ficha nueva: la anterior con los campos que llegaron en este turno encima. */
export function fusionarFicha(anterior: FichaIdea, cambios: FichaIdea): FichaIdea {
  return { ...anterior, ...cambios };
}

/** Cuántos campos de la ficha tienen algo, de 0 a 1. */
export function progresoFicha(ficha: FichaIdea): number {
  const completos = CAMPOS_FICHA.filter((campo) => (ficha[campo.id] ?? '').trim().length > 0).length;
  return completos / CAMPOS_FICHA.length;
}

/**
 * Lo que el docente contestó, tocando respuestas y escribiendo, armado como
 * un solo mensaje. Cada respuesta va con su pregunta al lado: el modelo
 * necesita saber a qué contesta cada cosa, y el docente lo ve igual en el
 * chat (así se lee lo que eligió aunque las preguntas ya no estén abajo).
 */
export function armarRespuesta(
  preguntas: PreguntaTaller[],
  elegidas: Record<number, string[]>,
  escrito: string,
): string {
  const partes: string[] = [];

  preguntas.forEach((pregunta, indice) => {
    const respuestas = elegidas[indice] ?? [];
    if (respuestas.length === 0) return;
    partes.push(`${pregunta.texto} → ${respuestas.join(', ')}`);
  });

  const libre = escrito.trim();
  if (libre) partes.push(libre);

  return partes.join('\n');
}

/** El nombre que se muestra en "Mis ideas" mientras la IA no propuso uno. */
export function nombreDeLaIdea(titulo: string | null, ficha: FichaIdea): string {
  return titulo ?? ficha.idea?.split(/[.:\n]/)[0]?.slice(0, 60) ?? ficha.tema?.slice(0, 60) ?? 'Idea sin nombre';
}
