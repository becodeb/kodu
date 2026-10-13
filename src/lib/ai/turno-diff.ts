/**
 * T4 round 6 (motor-claude, `odd/tasks/motor-claude.md`): "¿este turno de
 * AJUSTE hizo lo que pidieron?" — un chequeo DETERMINÍSTICO, independiente
 * del modelo, que compara el HTML de ANTES y de DESPUÉS de un turno contra
 * el texto del pedido.
 *
 * Por qué hace falta (medido en la ronda 5, real Haiku 5.5): "al final
 * agregá 3 preguntas" no agregó ninguna pregunta — sólo un comentario ("las
 * preguntas de repaso se agregan abajo") y una barra vacía — y NI la
 * autoprueba NI el revisor visual (con captura real) lo marcaron. Esto
 * complementa al revisor (`verificador.ts`): un chequeo barato, sin
 * ambigüedad de modelo, para la clase de defecto más chata de todas
 * ("prometió y no hizo").
 *
 * Isomórfico (sin Node/Prisma/DOM), mismo criterio que `autoprueba.ts`: todo
 * regex/string, para poder testearlo sin stack levantado y para que
 * `POST /api/chat/verificar` lo use directo sobre HTML real.
 *
 * Deliberadamente NO es un diff real (no hay librería de diff en el
 * proyecto y no hace falta una): todas las medidas de abajo son
 * APROXIMACIONES baratas por multiset de palabras/líneas/etiquetas,
 * suficientes para distinguir "pasó algo de contenido real" de "casi no
 * cambió nada" — el umbral de las banderas está pensado para eso, no para
 * un diff pixel-perfecto.
 */

// ─────────────────────────────────────────────────────────────
// Texto visible: sacar <script>/<style>, tags, y normalizar espacio
// ─────────────────────────────────────────────────────────────

const SCRIPT_O_STYLE_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const TAG_RE = /<[^>]+>/g;

function textoVisible(html: string): string {
  return html
    .replace(SCRIPT_O_STYLE_RE, ' ')
    .replace(TAG_RE, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(texto: string): string[] {
  return texto.length > 0 ? texto.split(' ') : [];
}

function multiset(lista: string[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const item of lista) mapa.set(item, (mapa.get(item) ?? 0) + 1);
  return mapa;
}

/**
 * Los elementos de `despues` que aparecen MÁS veces que en `antes` — sólo el
 * EXCESO, no la lista entera — una aproximación barata a "qué es realmente
 * nuevo", robusta a que el mismo contenido se haya reordenado (reordenar no
 * cuenta como "agregar"). Sirve igual para palabras que para líneas: no le
 * importa qué representa cada string.
 */
function excesoSobre(antes: string[], despues: string[]): string[] {
  const freqAntes = multiset(antes);
  const usados = new Map<string, number>();
  const exceso: string[] = [];
  for (const item of despues) {
    const disponibles = freqAntes.get(item) ?? 0;
    const yaUsados = usados.get(item) ?? 0;
    if (yaUsados < disponibles) {
      usados.set(item, yaUsados + 1);
    } else {
      exceso.push(item);
    }
  }
  return exceso;
}

// ─────────────────────────────────────────────────────────────
// Elementos por etiqueta y controles interactivos
// ─────────────────────────────────────────────────────────────

const TAG_ABIERTA_RE = /<([a-zA-Z][a-zA-Z0-9]*)\b/g;

function contarTags(html: string): Map<string, number> {
  const conteo = new Map<string, number>();
  for (const coincidencia of html.matchAll(TAG_ABIERTA_RE)) {
    const tag = coincidencia[1]!.toLowerCase();
    conteo.set(tag, (conteo.get(tag) ?? 0) + 1);
  }
  return conteo;
}

const TAGS_INTERACTIVOS = ['input', 'button', 'select', 'textarea'];

// ─────────────────────────────────────────────────────────────
// Líneas de <script> cambiadas
// ─────────────────────────────────────────────────────────────

const SCRIPT_CONTENIDO_RE = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;

function extraerScripts(html: string): string {
  let salida = '';
  for (const coincidencia of html.matchAll(SCRIPT_CONTENIDO_RE)) salida += `${coincidencia[1]}\n`;
  return salida;
}

function lineasNoVacias(texto: string): string[] {
  return texto
    .split('\n')
    .map((linea) => linea.trim())
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────
// Comentarios HTML que "prometen" contenido sin darlo
// ─────────────────────────────────────────────────────────────

const COMENTARIO_RE = /<!--([\s\S]*?)-->/g;
const PATRON_PROMESA_RE =
  /(se agregan?\s+(abajo|m[aá]s abajo|al final|m[aá]s adelante)|todo:|ac[aá]\s+van|falta agregar|pendiente de agregar)/i;

function extraerComentarios(html: string): string[] {
  return Array.from(html.matchAll(COMENTARIO_RE), (coincidencia) => coincidencia[1]!.trim());
}

// ─────────────────────────────────────────────────────────────
// El diff compacto
// ─────────────────────────────────────────────────────────────

export interface DiffTurno {
  /** Caracteres de texto VISIBLE (sin tags/scripts/estilos) de más en
   *  `despues` respecto de `antes` — aproximado (ver cabecera del archivo). */
  charsVisibleAgregados: number;
  charsVisibleQuitados: number;
  /** Delta de ocurrencias por etiqueta, SOLO las que cambiaron (tag en
   *  minúscula → delta, p.ej. `{button: 2, p: -1}`). */
  elementosPorTag: Record<string, number>;
  interactivosAntes: number;
  interactivosDespues: number;
  /** Líneas dentro de cualquier `<script>` que aparecen de más en un lado o
   *  en el otro (agregadas + quitadas) — no es un diff de líneas de verdad,
   *  sólo cuenta cuánto "se movió" el código. */
  lineasScriptCambiadas: number;
  /** Comentarios HTML nuevos en `despues` (ausentes en `antes`) que
   *  "prometen" contenido ("se agregan abajo", "TODO", "acá van", …). */
  comentariosPromesaNuevos: string[];
}

export function computarDiffTurno(htmlAntes: string, htmlDespues: string): DiffTurno {
  const palabrasAntes = tokens(textoVisible(htmlAntes));
  const palabrasDespues = tokens(textoVisible(htmlDespues));
  const agregadas = excesoSobre(palabrasAntes, palabrasDespues);
  const quitadas = excesoSobre(palabrasDespues, palabrasAntes);

  const tagsAntes = contarTags(htmlAntes);
  const tagsDespues = contarTags(htmlDespues);
  const elementosPorTag: Record<string, number> = {};
  for (const tag of new Set([...tagsAntes.keys(), ...tagsDespues.keys()])) {
    const delta = (tagsDespues.get(tag) ?? 0) - (tagsAntes.get(tag) ?? 0);
    if (delta !== 0) elementosPorTag[tag] = delta;
  }

  const interactivosAntes = TAGS_INTERACTIVOS.reduce((acc, tag) => acc + (tagsAntes.get(tag) ?? 0), 0);
  const interactivosDespues = TAGS_INTERACTIVOS.reduce((acc, tag) => acc + (tagsDespues.get(tag) ?? 0), 0);

  const lineasAntes = lineasNoVacias(extraerScripts(htmlAntes));
  const lineasDespues = lineasNoVacias(extraerScripts(htmlDespues));
  const lineasCambiadas = excesoSobre(lineasAntes, lineasDespues).length + excesoSobre(lineasDespues, lineasAntes).length;

  const comentariosAntes = new Set(extraerComentarios(htmlAntes));
  const comentariosPromesaNuevos = extraerComentarios(htmlDespues).filter(
    (comentario) => !comentariosAntes.has(comentario) && PATRON_PROMESA_RE.test(comentario),
  );

  return {
    charsVisibleAgregados: agregadas.join(' ').length,
    charsVisibleQuitados: quitadas.join(' ').length,
    elementosPorTag,
    interactivosAntes,
    interactivosDespues,
    lineasScriptCambiadas: lineasCambiadas,
    comentariosPromesaNuevos,
  };
}

// ─────────────────────────────────────────────────────────────
// Banderas rojas determinísticas (pedido vs. diff)
// ─────────────────────────────────────────────────────────────

export type MotivoBanderaRoja = 'agregar_trivial' | 'acortar_sin_achicar' | 'comentario_promesa_sin_contenido';

export interface BanderaRoja {
  motivo: MotivoBanderaRoja;
  detalle: string;
}

function sinAcentos(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/** Lista EXACTA del task brief (round 6, goal A): "agregá", "sumá", "añadí",
 *  "incorporá", "poné", "agregar" — normalizadas sin acento. */
const CLAVES_AGREGAR = ['agrega', 'suma', 'anadi', 'incorpora', 'pone'];
/** Lista EXACTA del task brief: "más corto", "acortá", "resumí", "menos". */
const CLAVES_ACORTAR = ['mas corto', 'acorta', 'resumi'];

function contieneClave(textoNormalizado: string, clave: string): boolean {
  if (clave.includes(' ')) return textoNormalizado.includes(clave);
  // Sin límite al final: "agrega" también tiene que matchear "agregar",
  // "agregale", "agregaron" — todas la misma intención. Límite al PRINCIPIO
  // sí, para no matchear en medio de otra palabra (p.ej. "despone").
  return new RegExp(`\\b${clave}`, 'u').test(textoNormalizado);
}

function pidioAgregar(pedidoNormalizado: string): boolean {
  return CLAVES_AGREGAR.some((clave) => contieneClave(pedidoNormalizado, clave));
}

function pidioAcortar(pedidoNormalizado: string): boolean {
  return (
    CLAVES_ACORTAR.some((clave) => contieneClave(pedidoNormalizado, clave)) ||
    /\bmenos\b/u.test(pedidoNormalizado)
  );
}

/** Ningún control INTERACTIVO nuevo (input/button/select/textarea) — a
 *  propósito NO mira etiquetas genéricas (`elementosPorTag`): un `<div>` o
 *  un `<p>` nuevo pero vacío (como el de la ronda 5: un contenedor "barra"
 *  sin nada adentro) no es "contenido agregado", así que no debería blindear
 *  la bandera. */
function sinControlesNuevos(diff: DiffTurno): boolean {
  return diff.interactivosDespues <= diff.interactivosAntes;
}

/** Umbral de "texto visible nuevo" por debajo del cual un pedido de agregar
 *  se considera incumplido — el propio brief sugiere "< 80 caracteres" como
 *  punto de partida. */
export const UMBRAL_TEXTO_TRIVIAL = 80;

/**
 * Las banderas rojas DETERMINÍSTICAS de este turno — nunca más de una por
 * motivo. `pedidoActual` es el ÚLTIMO pedido del docente (sólo ese turno,
 * no el histórico combinado): matchear contra el histórico completo
 * dispararía banderas por pedidos de turnos anteriores ya resueltos.
 */
export function detectarBanderasRojas(pedidoActual: string, diff: DiffTurno): BanderaRoja[] {
  const normalizado = sinAcentos(pedidoActual);
  const banderas: BanderaRoja[] = [];

  const agregarPedido = pidioAgregar(normalizado);
  const sinNovedades = sinControlesNuevos(diff);

  if (agregarPedido && diff.charsVisibleAgregados < UMBRAL_TEXTO_TRIVIAL && sinNovedades) {
    banderas.push({
      motivo: 'agregar_trivial',
      detalle: `El pedido pide agregar/sumar contenido, pero el diff mide sólo ${diff.charsVisibleAgregados} caracteres de texto visible nuevo y ningún elemento interactivo o etiqueta nueva.`,
    });
  }

  if (pidioAcortar(normalizado) && diff.charsVisibleQuitados <= diff.charsVisibleAgregados) {
    banderas.push({
      motivo: 'acortar_sin_achicar',
      detalle: `El pedido pide acortar/resumir, pero el diff no muestra que se haya quitado contenido real (quitado: ${diff.charsVisibleQuitados} caracteres visibles, agregado: ${diff.charsVisibleAgregados}).`,
    });
  }

  if (diff.comentariosPromesaNuevos.length > 0 && diff.charsVisibleAgregados < UMBRAL_TEXTO_TRIVIAL && sinNovedades) {
    banderas.push({
      motivo: 'comentario_promesa_sin_contenido',
      detalle: `El código agregó un comentario que promete contenido ("${diff.comentariosPromesaNuevos[0]}") sin texto ni elementos nuevos que lo respalden.`,
    });
  }

  return banderas;
}

// ─────────────────────────────────────────────────────────────
// Para el revisor visual: ¿qué se mide, en texto?
// ─────────────────────────────────────────────────────────────

/**
 * El mismo diff, en texto compacto para pegar en el prompt del revisor
 * (`verificador.ts`) — evidencia MEDIDA, no generada por un modelo, para que
 * el revisor pueda contrastar "¿este cambio implementa cada ítem pedido?"
 * contra un número, no sólo contra su propia lectura del código.
 */
export function resumenDiffParaRevisor(diff: DiffTurno): string {
  const tags = Object.entries(diff.elementosPorTag)
    .map(([tag, delta]) => `${tag} ${delta > 0 ? '+' : ''}${delta}`)
    .join(', ');
  const partes = [
    `Texto visible: +${diff.charsVisibleAgregados} / -${diff.charsVisibleQuitados} caracteres.`,
    `Etiquetas con cambio de cantidad: ${tags || 'ninguna'}.`,
    `Controles interactivos (input/button/select/textarea): ${diff.interactivosAntes} → ${diff.interactivosDespues}.`,
    `Líneas de <script> cambiadas: ${diff.lineasScriptCambiadas}.`,
  ];
  if (diff.comentariosPromesaNuevos.length > 0) {
    partes.push(`Comentarios nuevos que prometen contenido: ${diff.comentariosPromesaNuevos.map((c) => `"${c}"`).join(', ')}.`);
  }
  return partes.join('\n');
}
