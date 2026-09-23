/**
 * Revisión automática del HTML que devuelve el modelo (T7,
 * odd/tasks/modo-prime.md — "Revisión automática (lint + una corrección) y
 * turnos progresivos"). Un lint mecánico, no otra llamada a IA: detecta lo
 * que Apéndice B le pide al modelo que NO haga (emojis, degradados, texto de
 * relleno, íconos inventados, scripts duplicados o bloqueados por la CSP de
 * `/p/[slug].ts`) y arma instrucciones puntuales para una única pasada de
 * corrección (`stream.ts` es quien hace esa llamada; este módulo sólo
 * detecta y redacta, nunca llama a un proveedor).
 *
 * Server-only (revisa el HTML antes de mostrarlo, nunca se manda al
 * cliente), pero módulo puro: nada de Prisma, nada de red, nada de estado —
 * sólo texto entrando, hallazgos saliendo. Así se prueba sin base de datos
 * (e2e/unidad-revision.ts, mismo patrón que e2e/unidad-kit.ts) y sin volver
 * a tocar ningún proveedor de IA. Importa `lucide-nombres.ts` (el Set de
 * íconos válidos) y `kit.ts` (`temaDe`, para `sin_tema`) — los dos también
 * puros — y nada más de este repo.
 *
 * ── "Sólo lo que este turno introdujo" ──
 * Con `anterior` (el HTML con el que arrancó el turno), cada regla se corre
 * dos veces —sobre `anterior` y sobre `html`— y sólo se informa lo que
 * AUMENTÓ: un emoji que el docente ya tenía en su recurso no dispara una
 * corrección que se lo toque (REGLA MÁS IMPORTANTE de prompt.ts: "se EDITA
 * lo que ya existe"). `anterior` en `null`/vacío es el caso "recurso
 * nuevo": ahí se informa TODO lo que hay en `html`, sin diff — es la
 * responsabilidad de quien llama (`stream.ts`) decidir si el HTML de arranque
 * de un proyecto (`DEFAULT_HTML`, sin tema ni contenido real) cuenta como
 * "anterior" real o como "todavía no hay nada": ese criterio vive del lado
 * del servidor (conoce `DEFAULT_HTML`), no acá.
 */

import { temaDe } from './kit.ts';
import { NOMBRES_LUCIDE } from './lucide-nombres.ts';
import { ALLOWED_CDNS } from '../cdn-allowlist.ts';

export type CodigoHallazgo =
  | 'emojis'
  | 'degradados'
  | 'sin_tema'
  | 'iconos_inexistentes'
  | 'kit_duplicado'
  | 'origen_bloqueado'
  | 'texto_largo'
  | 'relleno';

export interface Hallazgo {
  codigo: CodigoHallazgo;
  /** En español, dirigido al modelo (mismo tono que BASE_PROMPT: voseo, directo). */
  instruccion: string;
  /** Ejemplos concretos (emoji, nombres de ícono, orígenes, extractos…), hasta el tope de cada regla. */
  ejemplos?: string[];
}

export interface OpcionesRevision {
  /**
   * El HTML con el que arrancó ESTE turno. `null`/`undefined`/vacío = tratar
   * el recurso como NUEVO (se informa todo lo que hay en `html`, sin diff).
   */
  anterior?: string | null;
}

// ─────────────────────────────────────────────────────────────
// Utilidades de texto compartidas
// ─────────────────────────────────────────────────────────────

function quitarComentariosHtml(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, ' ');
}

/**
 * Valor de un atributo dentro del HTML crudo de UNA etiqueta ya recortada
 * (p. ej. `m[0]` de un `/<script\b[^>]*>/g`), tolerando comillas dobles,
 * simples o ninguna. Mismo patrón que `valorAtributo` en kit.ts, duplicado
 * a propósito: ese módulo no lo exporta (es un detalle interno suyo) y es
 * más simple repetir estas tres líneas que acoplar los dos módulos por una
 * función de nueve líneas.
 */
function valorAtributo(etiquetaHtml: string, nombre: string): string | null {
  const re = new RegExp(`(?:^|\\s)${nombre}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = re.exec(etiquetaHtml);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

function decodificarEntidadesBasicas(s: string): string {
  // No es un decodificador HTML completo (no hace falta: esto es sólo para
  // contar palabras y armar extractos legibles, no para volver a renderizar
  // nada) — cubre lo que un modelo escribe de verdad: &amp; en "profe &amp;
  // alumnos", &nbsp; de separación, y entidades numéricas ocasionales.
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

const ETIQUETAS_DE_BLOQUE =
  /<\/(p|div|li|h[1-6]|article|section|header|footer|button|td|th|blockquote|figcaption)>/gi;

/**
 * El texto que de verdad ve el alumno, separado en bloques (uno por
 * elemento de bloque habitual). Saca `<script>`, `<style>` y comentarios
 * ANTES de sacar las demás etiquetas — si no, el contenido de un `<script>`
 * (que no es texto para nadie) se cuela como si fuera un párrafo carísimo
 * de leer, y un `<style>` con selectores largos infla el conteo de palabras
 * de la nada.
 */
function bloquesDeTextoVisible(html: string): string[] {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // Un salto de línea al CERRAR una etiqueta de bloque habitual: así, al
  // sacar el resto de las etiquetas más abajo, cada bloque queda en su
  // propio renglón en vez de todo el documento pegado en una sola oración.
  s = s.replace(ETIQUETAS_DE_BLOQUE, '</$1>\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodificarEntidadesBasicas(s);

  return s
    .split('\n')
    .map((linea) => linea.replace(/\s+/g, ' ').trim())
    .filter((linea) => linea.length > 0);
}

/** Un extracto corto alrededor de una posición, para no citar el bloque entero en `ejemplos`. */
function contextoAlrededor(texto: string, desde: number, largo: number, radio = 30): string {
  const inicio = Math.max(0, desde - radio);
  const fin = Math.min(texto.length, desde + largo + radio);
  const prefijo = inicio > 0 ? '…' : '';
  const sufijo = fin < texto.length ? '…' : '';
  return (prefijo + texto.slice(inicio, fin).trim() + sufijo).replace(/\s+/g, ' ');
}

// ─────────────────────────────────────────────────────────────
// Cada regla: cuenta apariciones y junta ejemplos DISTINTOS, en orden de
// aparición. `total` es la cantidad cruda (apariciones, no ejemplos
// distintos) — es lo que se compara para decidir si "aumentó" en modo diff.
// ─────────────────────────────────────────────────────────────

interface Deteccion {
  total: number;
  distintos: string[];
}

const SIN_HALLAZGOS: Deteccion = { total: 0, distintos: [] };

/**
 * Emojis (Unicode Extended_Pictographic). `©`, `®` y `™` tienen esa misma
 * propiedad Unicode pero aparecen en prosa legítima (derechos, marcas) —no
 * son slop de IA— así que se excluyen explícitamente, igual que los dígitos
 * sueltos, `#` y `*` (las bases de las secuencias "keycap" 1️⃣/#️⃣/*️⃣: en
 * algunas tablas Unicode cuentan como Extended_Pictographic sueltas, y un
 * simple "3" en "el triple de 3" no es un emoji). Medido en este repo
 * (Node 24) los dígitos/#/* no matchean la propiedad de por sí, pero la
 * exclusión se deja igual: es barata y no depende de qué versión de ICU
 * termine corriendo en producción.
 */
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const EMOJI_EXCLUIDOS = new Set([
  '©', '®', '™', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '#', '*',
]);

function detectarEmojis(html: string): Deteccion {
  const sinComentarios = quitarComentariosHtml(html);
  const distintos: string[] = [];
  let total = 0;

  for (const m of sinComentarios.matchAll(EMOJI_RE)) {
    const caracter = m[0];
    if (EMOJI_EXCLUIDOS.has(caracter)) continue;
    total++;
    if (!distintos.includes(caracter)) distintos.push(caracter);
  }

  return total > 0 ? { total, distintos } : SIN_HALLAZGOS;
}

/**
 * Degradados: funciones CSS de gradiente dentro de `<style>`/`style=""`, y
 * las clases de Tailwind que arman lo mismo. Los `<linearGradient>`/
 * `<radialGradient>` de SVG (ilustración, no fondo) quedan afuera SOLOS: son
 * elementos de marcado, no aparecen nunca dentro de un `<style>` ni de un
 * atributo `style`, así que ninguna de las dos búsquedas los toca.
 */
const GRADIENTE_FUNCION_RE = /(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/gi;
const GRADIENTE_CLASE_RE =
  /\bbg-gradient-to-[trbl]{1,2}\b|\bbg-linear-[\w[\]%./-]+|\bbg-radial\b(?:-[\w[\]%./-]+)?/gi;

function bloquesDeStyle(html: string): string[] {
  const bloques: string[] = [];
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) bloques.push(m[1] ?? '');
  for (const m of html.matchAll(/\bstyle\s*=\s*"([^"]*)"|\bstyle\s*=\s*'([^']*)'/gi)) {
    bloques.push(m[1] ?? m[2] ?? '');
  }
  return bloques;
}

function detectarDegradados(html: string): Deteccion {
  const distintos: string[] = [];
  let total = 0;

  for (const bloque of bloquesDeStyle(html)) {
    for (const m of bloque.matchAll(GRADIENTE_FUNCION_RE)) {
      total++;
      const etiqueta = m[0].replace(/\s+/g, '');
      if (!distintos.includes(etiqueta)) distintos.push(etiqueta);
    }
  }

  // Las clases se buscan en TODO el html, no sólo en `class="..."`: el
  // modelo a veces las arma con JS (`el.className += ' bg-gradient-to-r'`).
  // Encontrar la clase como texto alcanza para avisar; no hace falta un
  // parser de DOM para esto.
  for (const m of html.matchAll(GRADIENTE_CLASE_RE)) {
    total++;
    if (!distintos.includes(m[0])) distintos.push(m[0]);
  }

  return total > 0 ? { total, distintos } : SIN_HALLAZGOS;
}

/** `data-lucide="nombre"` cuyo nombre no está en `NOMBRES_LUCIDE`. Sólo nombres literales en el HTML — uno armado en JS con una variable no se puede leer estáticamente. */
const DATA_LUCIDE_RE = /data-lucide\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

function detectarIconosInexistentes(html: string): Deteccion {
  const distintos: string[] = [];
  let total = 0;

  for (const m of html.matchAll(DATA_LUCIDE_RE)) {
    const nombre = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!nombre || NOMBRES_LUCIDE.has(nombre)) continue;
    total++;
    if (!distintos.includes(nombre)) distintos.push(nombre);
  }

  return total > 0 ? { total, distintos } : SIN_HALLAZGOS;
}

/**
 * Kit duplicado: el bloque canónico (T1/T2, `kit.ts`) ya trae Tailwind
 * configurado y Lucide — un `tailwind.config`, un script de
 * `cdn.tailwindcss.com` o uno de Lucide declarados POR FUERA de ese bloque
 * son del modelo repitiendo lo que el sistema ya puso (y en el caso de
 * `tailwind.config`, la segunda asignación PISA la paleta anclada del
 * tema). Los mismos delimitadores que `kit.ts` (`BLOQUE_PREFIJO`/
 * `BLOQUE_FIN`), duplicados a propósito: este módulo sólo necesita saber
 * DÓNDE está el bloque para excluirlo de la búsqueda, no validar que sea
 * byte a byte el canónico (eso ya lo hace `kit.ts`). Si el formato del
 * bloque cambia alguna vez, actualizar los dos lugares.
 */
const KIT_BLOQUE_INICIO = '<!-- kodu-kit:v1:inicio';
const KIT_BLOQUE_FIN = '<!-- kodu-kit:v1:fin -->';

function quitarBloqueKit(html: string): string {
  const desde = html.indexOf(KIT_BLOQUE_INICIO);
  if (desde === -1) return html;
  const hastaMarca = html.indexOf(KIT_BLOQUE_FIN, desde);
  if (hastaMarca === -1) return html;
  return html.slice(0, desde) + html.slice(hastaMarca + KIT_BLOQUE_FIN.length);
}

const TAILWIND_CONFIG_RE = /(?:window\.)?tailwind\.config\s*=/gi;
const TAILWIND_CDN_RE = /cdn\.tailwindcss\.com/gi;
const LUCIDE_CDN_RE = /cdn\.jsdelivr\.net\/npm\/lucide|unpkg\.com\/lucide/gi;

function detectarKitDuplicado(html: string): Deteccion {
  const fueraDelKit = quitarBloqueKit(html);
  const distintos: string[] = [];
  let total = 0;

  const agregar = (re: RegExp, etiqueta: string) => {
    for (const _m of fueraDelKit.matchAll(re)) {
      total++;
      if (!distintos.includes(etiqueta)) distintos.push(etiqueta);
    }
  };

  agregar(TAILWIND_CONFIG_RE, 'tailwind.config');
  agregar(TAILWIND_CDN_RE, 'script de cdn.tailwindcss.com');
  agregar(LUCIDE_CDN_RE, 'script de Lucide');

  return total > 0 ? { total, distintos } : SIN_HALLAZGOS;
}

/**
 * Orígenes https bloqueados por la CSP de `/p/[slug].ts` (script, hoja de
 * estilos o `@import`): comparación por ORIGEN exacto (`new URL(...).origin`),
 * nunca por "empieza con", para no colar un host parecido pero ajeno. Sólo
 * https: los relativos van al propio origen (siempre permitido) y `data:`/
 * `blob:` ya los cubre la CSP aparte.
 */
function detectarOrigenesBloqueados(html: string): Deteccion {
  const distintos: string[] = [];
  let total = 0;

  const registrar = (url: string | null) => {
    if (!url || !/^https:\/\//i.test(url)) return;
    let origen: string;
    try {
      origen = new URL(url).origin;
    } catch {
      return; // URL rota: no es este chequeo el que tiene que avisarlo
    }
    if (ALLOWED_CDNS.includes(origen)) return;
    total++;
    if (!distintos.includes(origen)) distintos.push(origen);
  };

  for (const m of html.matchAll(/<script\b[^>]*>/gi)) registrar(valorAtributo(m[0], 'src'));

  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (valorAtributo(m[0], 'rel') ?? '').toLowerCase();
    if (rel !== 'stylesheet') continue; // preconnect/preload/icon no cargan contenido bloqueable de la misma forma
    registrar(valorAtributo(m[0], 'href'));
  }

  for (const m of html.matchAll(/@import\s+(?:url\(\s*)?["']?(https:\/\/[^"')\s;]+)["']?\s*\)?/gi)) {
    registrar(m[1] ?? null);
  }

  return total > 0 ? { total, distintos } : SIN_HALLAZGOS;
}

/** Más de 45 palabras en un mismo bloque visible. Hasta 3 extractos cortos (las primeras palabras), nunca el bloque entero. */
function detectarTextoLargo(html: string): Deteccion {
  const distintos: string[] = [];
  let total = 0;

  for (const bloque of bloquesDeTextoVisible(html)) {
    const palabras = bloque.split(/\s+/).filter(Boolean);
    if (palabras.length <= 45) continue;
    total++;
    const extracto = `${palabras.slice(0, 14).join(' ')}…`;
    if (!distintos.includes(extracto)) distintos.push(extracto);
  }

  return total > 0 ? { total, distintos } : SIN_HALLAZGOS;
}

/**
 * Relleno pedagógico que Apéndice B prohíbe explícitamente: bienvenidas,
 * "Tip:", "Hecho con", "¿Sabías que…?". Cada PATRÓN (no cada aparición
 * puntual) es la unidad que se compara en modo diff — ver `soloLoNuevo` más
 * abajo: si el docente ya tenía un "Tip:" en su recurso, agregar OTRO no
 * dispara una corrección (que iría a tocar el que ya estaba, o generaría
 * ambigüedad sobre cuál).
 */
const PATRONES_RELLENO: readonly RegExp[] = [
  /¡?bienvenid[oa]s?\b/gi,
  /\btip\s*:/gi,
  /\bhecho con\b/gi,
  /¿?sab[ií]as que/gi,
];

function detectarRelleno(html: string): Deteccion {
  const texto = bloquesDeTextoVisible(html).join('\n');
  const distintos: string[] = [];
  let total = 0;

  for (const patron of PATRONES_RELLENO) {
    for (const m of texto.matchAll(patron)) {
      total++;
      const extracto = contextoAlrededor(texto, m.index ?? 0, m[0].length);
      if (!distintos.includes(extracto)) distintos.push(extracto);
    }
  }

  return total > 0 ? { total, distintos } : SIN_HALLAZGOS;
}

// ─────────────────────────────────────────────────────────────
// Instrucciones (español, voseo, dirigidas al modelo) e integración
// ─────────────────────────────────────────────────────────────

const INSTRUCCIONES: Record<CodigoHallazgo, string> = {
  emojis:
    'Usaste emojis. Sacalos: para un símbolo usá un ícono de Lucide (<i data-lucide="nombre">) y para un objeto dibujalo en SVG simple, como pide la sección "Diseño visual".',
  degradados:
    'Usaste un degradado. Cambialo por un color liso de los tokens del tema (fondo, superficie, acento, etc.): los degradados están prohibidos en fondos y textos.',
  sin_tema:
    'Este recurso no declaró tema del kit. Elegí uno según la materia y agregá <meta name="kodu-tema" content="ID"> en el <head> (pizarron, cuaderno, laboratorio, atlas, recreo, plano, noche o huerta).',
  iconos_inexistentes:
    'Usaste nombres de ícono que no existen en Lucide. Cambialos por nombres válidos, en inglés y kebab-case.',
  kit_duplicado:
    'Declaraste Tailwind o Lucide por tu cuenta, por fuera del bloque del kit. Sacá esa declaración: el kit ya los provee, y una segunda te pisa la paleta del tema.',
  origen_bloqueado:
    'Cargaste un recurso desde un origen que la versión publicada va a bloquear. Traelo de jsdelivr o unpkg, o sacalo si no es imprescindible.',
  texto_largo: 'Hay un bloque de texto demasiado largo para que un alumno lo lea de un vistazo. Acortalo a lo esencial.',
  relleno:
    'Hay texto de relleno (bienvenida, "Tip:", "¿Sabías que…?" o similar) que las reglas de diseño prohíben. Sacalo.',
};

/** Hasta cuántos ejemplos lleva cada hallazgo. `texto_largo` es la única con tope explícito en la tarea (3); el resto usa un default prudente para no inflar el mensaje de corrección. */
const TOPE_EJEMPLOS: Record<Exclude<CodigoHallazgo, 'sin_tema'>, number> = {
  emojis: 5,
  degradados: 5,
  iconos_inexistentes: 20,
  kit_duplicado: 5,
  origen_bloqueado: 10,
  texto_largo: 3,
  relleno: 5,
};

const DETECTORES: Record<Exclude<CodigoHallazgo, 'sin_tema'>, (html: string) => Deteccion> = {
  emojis: detectarEmojis,
  degradados: detectarDegradados,
  iconos_inexistentes: detectarIconosInexistentes,
  kit_duplicado: detectarKitDuplicado,
  origen_bloqueado: detectarOrigenesBloqueados,
  texto_largo: detectarTextoLargo,
  relleno: detectarRelleno,
};

/** Mismo orden que la lista de reglas de la tarea. Sólo cosmético (no hay ningún criterio de prioridad entre hallazgos), pero mantiene el mensaje de corrección legible y predecible turno a turno. */
const ORDEN_DETECTORES: readonly (keyof typeof DETECTORES)[] = [
  'emojis',
  'degradados',
  'iconos_inexistentes',
  'kit_duplicado',
  'origen_bloqueado',
  'texto_largo',
  'relleno',
];

/**
 * Sólo lo que AUMENTÓ entre `anterior` y `actual`: la cuenta es la
 * diferencia (nunca negativa) y los ejemplos son los distintos que
 * `anterior` no tenía. Si el total subió pero no hay ningún ejemplo
 * puntualmente nuevo (mismo emoji, más apariciones), se muestran los
 * ejemplos actuales igual — una corrección con ejemplos repetidos es mejor
 * que una sin ningún ejemplo.
 */
function soloLoNuevo(actual: Deteccion, previo: Deteccion): Deteccion {
  const totalNuevo = Math.max(0, actual.total - previo.total);
  if (totalNuevo <= 0) return SIN_HALLAZGOS;

  const distintosNuevos = actual.distintos.filter((item) => !previo.distintos.includes(item));
  return { total: totalNuevo, distintos: distintosNuevos.length > 0 ? distintosNuevos : actual.distintos };
}

/**
 * El lint completo (T7). `anterior` vacío/`null` = recurso nuevo: se
 * informa todo lo que hay en `html`. Con `anterior`, cada regla se corre
 * también sobre ese HTML previo y sólo se reporta el aumento (ver
 * `soloLoNuevo`) — así una corrección nunca termina tocando algo que el
 * docente ya tenía de antes.
 */
export function revisarHtml(html: string, opciones: OpcionesRevision = {}): Hallazgo[] {
  const anteriorTexto = opciones.anterior;
  const anterior = anteriorTexto != null && anteriorTexto.trim().length > 0 ? anteriorTexto : null;
  const hallazgos: Hallazgo[] = [];

  for (const codigo of ORDEN_DETECTORES) {
    // sin_tema va justo después de "degradados" en la lista de la tarea:
    // no tiene detector propio (no es un conteo, es "¿declaró tema o no?"),
    // así que se intercala acá en vez de vivir en `DETECTORES`.
    if (codigo === 'iconos_inexistentes' && anterior === null && temaDe(html) === null) {
      hallazgos.push({ codigo: 'sin_tema', instruccion: INSTRUCCIONES.sin_tema });
    }

    const detector = DETECTORES[codigo];
    const actual = detector(html);
    const efectivo = anterior === null ? actual : soloLoNuevo(actual, detector(anterior));
    if (efectivo.total <= 0) continue;

    hallazgos.push({
      codigo,
      instruccion: INSTRUCCIONES[codigo],
      ejemplos: efectivo.distintos.slice(0, TOPE_EJEMPLOS[codigo]),
    });
  }

  return hallazgos;
}
