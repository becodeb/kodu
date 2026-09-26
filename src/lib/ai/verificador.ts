/**
 * Verificador (T3, `odd/tasks/verificador.md`): un motor MÁS INTELIGENTE lee
 * el pedido del docente + el HTML generado y devuelve problemas concretos,
 * después de la autoprueba (`autoprueba.ts`), sin bloquear el chat — corre
 * en `POST /api/chat/verificar`.
 *
 * Puerto de `experimentos/razonamiento/verificar.ts` (`sistema`, `usuario`,
 * `parsear`): la REDACCIÓN del prompt es contenido de producto, medida en
 * los ensayos documentados en `RESULTADOS-modelos.md` — se copia palabra por
 * palabra, no se "mejora" acá. Lo que sí es nuevo de T3:
 *  - el HTML que se manda folds además cualquier
 *    `<script data-kodu-pruebas>` a un comentario corto (el verificador no
 *    tiene que leer el JSON envuelto en `eval(...)` que dejó T1 —
 *    `aislarPruebasKit` en `kit.ts` — y esa cadena no aporta nada a la
 *    revisión: son las pruebas ya escondidas del alumno);
 *  - cada problema se valida/normaliza (T3 no puede confiar ciegamente en
 *    que el modelo devuelva el JSON exacto que pide el prompt);
 *  - `unirPasadas` combina dos pasadas en paralelo (un recurso NUEVO) en una
 *    sola lista, sin duplicados.
 *
 * Módulo isomórfico (sin Prisma, sin Node, sin `env.ts`) — mismo criterio
 * que `autoprueba.ts`/`checklist.ts`: `POST /api/chat/verificar` es el único
 * que de verdad llama al modelo; `e2e/unidad-verificador.ts` prueba todo lo
 * de acá sin base de datos.
 */

import { plegarKit } from './kit.ts';
import { reglasDelArnes } from './prompt.ts';

// ─────────────────────────────────────────────────────────────
// El problema: tipo + validación/normalización de lo que devuelve el modelo
// ─────────────────────────────────────────────────────────────

export type GravedadProblema = 'alta' | 'media' | 'baja';
export type TipoProblema = 'logica' | 'contenido' | 'pedido' | 'uso';

export interface Problema {
  gravedad: GravedadProblema;
  tipo: TipoProblema;
  que: string;
  como_reproducir: string;
  arreglo: string;
}

const GRAVEDADES: ReadonlySet<string> = new Set<GravedadProblema>(['alta', 'media', 'baja']);
const TIPOS: ReadonlySet<string> = new Set<TipoProblema>(['logica', 'contenido', 'pedido', 'uso']);

/** Tope de cada campo de texto — mismo orden de magnitud que el resto del
 *  archivo (`ErrorAutoprueba.mensaje` 300, `ResultadoPrueba.detalle` 200),
 *  algo más alto porque acá un campo describe un problema completo, no una
 *  sola línea de error. */
const MAX_CAMPO_TEXTO = 400;

export const MAX_PROBLEMAS = 6;

/** `string` no vacío tras recortar espacios, truncado a `MAX_CAMPO_TEXTO`
 *  (nunca RECHAZADO por ser largo: se seguiría perdiendo un problema real
 *  por un modelo verborrágico en un solo campo). `null` si no es un string
 *  utilizable (falta, no es string, o queda vacío tras el trim). */
function normalizarCampoTexto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const recortado = valor.trim();
  if (!recortado) return null;
  return recortado.length > MAX_CAMPO_TEXTO ? recortado.slice(0, MAX_CAMPO_TEXTO) : recortado;
}

/**
 * Un `unknown` (una entrada cruda de `problemas[]`, ya sea del JSON que
 * devolvió el modelo, o del body de `POST /api/chat/autocorreccion` con
 * `problemasVerificador`) a un `Problema` válido, o `null` si hay que
 * descartarla entera: `gravedad`/`tipo` fuera del vocabulario cerrado, o
 * cualquiera de los tres campos de texto vacío/no-string. Nunca tira.
 */
export function normalizarProblema(valor: unknown): Problema | null {
  if (!valor || typeof valor !== 'object') return null;
  const registro = valor as Record<string, unknown>;

  if (typeof registro.gravedad !== 'string' || !GRAVEDADES.has(registro.gravedad)) return null;
  if (typeof registro.tipo !== 'string' || !TIPOS.has(registro.tipo)) return null;

  const que = normalizarCampoTexto(registro.que);
  const comoReproducir = normalizarCampoTexto(registro.como_reproducir);
  const arreglo = normalizarCampoTexto(registro.arreglo);
  if (!que || !comoReproducir || !arreglo) return null;

  return {
    gravedad: registro.gravedad as GravedadProblema,
    tipo: registro.tipo as TipoProblema,
    que,
    como_reproducir: comoReproducir,
    arreglo,
  };
}

// ─────────────────────────────────────────────────────────────
// El HTML que ve el verificador: kit plegado + pruebas plegadas
// ─────────────────────────────────────────────────────────────

/** Cualquier `<script data-kodu-pruebas>…</script>` (lo haya envuelto
 *  `aislarPruebasKit` en `eval(JSON.stringify(...))`, o esté crudo) — el
 *  verificador no necesita leer esas pruebas: son invisibles para el
 *  alumno, y el texto envuelto en `eval("...")` no le aporta nada a una
 *  revisión de lógica/contenido, sólo ruido. Mismo criterio de "plegar en un
 *  comentario corto" que `plegarKit` usa para el bloque canónico. */
const SCRIPT_PRUEBAS_RE = /<script\b[^>]*\bdata-kodu-pruebas\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const COMENTARIO_PRUEBAS_PLEGADAS = '<!-- pruebas automáticas plegadas -->';

/** El HTML tal como lo ve el verificador: kit canónico plegado
 *  (`plegarKit`, igual que en el prompt del generador) y, además, cualquier
 *  `<script data-kodu-pruebas>` plegado a un comentario de una línea. */
export function htmlParaVerificador(html: string): string {
  return plegarKit(html).replace(SCRIPT_PRUEBAS_RE, COMENTARIO_PRUEBAS_PLEGADAS);
}

// ─────────────────────────────────────────────────────────────
// El pedido del docente: el primer pedido + (si es un ajuste) el último
// ─────────────────────────────────────────────────────────────

/** Arma el texto de "pedido del docente" para el prompt: el pedido
 *  ORIGINAL siempre, y — sólo para un ajuste — el ÚLTIMO pedido aparte,
 *  etiquetado. `ajuste` en `null` (turno de creación, o un ajuste cuyo
 *  último mensaje ES el mismo que el original) deja el pedido tal cual. */
export function pedidoDocente(pedidoOriginal: string, ajuste: string | null): string {
  if (!ajuste) return pedidoOriginal;
  return `${pedidoOriginal}\n\n## Último pedido (ajuste)\n${ajuste}`;
}

// ─────────────────────────────────────────────────────────────
// El prompt: sistema + usuario (redacción verbatim del experimento)
// ─────────────────────────────────────────────────────────────

/** Puerto verbatim de `sistema()` en `experimentos/razonamiento/verificar.ts`. */
export function construirSistemaVerificador(reglas: string): string {
  return `Sos un revisor experto de recursos didácticos interactivos para escuelas argentinas. Un docente pidió un recurso y otra IA lo generó como un único documento HTML. Tu trabajo: encontrar los problemas CONCRETOS que un alumno o el docente se van a encontrar al usarlo en clase.

Qué buscar, en este orden:
1. Lógica rota o casos borde: cálculos mal hechos, estados que no se reinician, logros o puntajes que se pueden trabar o inflar, acciones que se disparan cuando no deberían (doble clic, teclado durante una pausa o transición), pantallas a las que se llega de forma incorrecta.
2. Errores de contenido: datos, fechas, roles, definiciones o fórmulas incorrectas para el tema y el nivel.
3. Incumplimientos del pedido del docente.
4. Problemas de uso serios (algo que no se ve, no se puede tocar o confunde).

Reglas:
- Leé el código de verdad y seguí la ejecución paso a paso. Cada problema tiene que poder reproducirse: decí qué hace el alumno y qué pasa.
- No reportes gustos de estilo, mejoras opcionales ni "podría ser más claro". No inventes: si no estás seguro de que es un problema, no lo pongas.
- Si el recurso está bien, devolvé una lista vacía. Eso es un resultado válido y esperado.
- Como mucho 6 problemas, del más grave al menos grave.
- El bloque del kit está plegado en un comentario: \`window.kodu\` existe y funciona como se documenta abajo. \`window.__koduPruebas\` son pruebas automáticas invisibles para el alumno.

Contrato que el generador debía cumplir (usalo como referencia, no como lista para tachar):
${reglas}

Respondé SOLO con JSON, sin texto antes ni después:
{"problemas":[{"gravedad":"alta|media|baja","tipo":"logica|contenido|pedido|uso","que":"...","como_reproducir":"...","arreglo":"..."}]}`;
}

/** Puerto verbatim de `usuario()` en `experimentos/razonamiento/verificar.ts`
 *  — la única diferencia es `htmlParaVerificador` en vez de `plegarKit` a
 *  secas (T3 pliega además las pruebas, ver más arriba). */
export function construirUsuarioVerificador(pedido: string, html: string): string {
  return `## Pedido del docente\n${pedido}\n\n## Recurso generado\n\`\`\`html\n${htmlParaVerificador(html)}\n\`\`\``;
}

/** `reglasDelArnes` vive en `prompt.ts` (T3 la agregó ahí, ver ese archivo);
 *  se re-exporta acá para que `POST /api/chat/verificar` importe todo lo
 *  del verificador de un solo módulo. */
export { reglasDelArnes };

// ─────────────────────────────────────────────────────────────
// Parseo de la respuesta del modelo
// ─────────────────────────────────────────────────────────────

/** Puerto de `parsear()` del experimento: JSON crudo, JSON dentro de una
 *  cerca ```json…```, o con texto alrededor — la MISMA heurística
 *  (probar el texto tal cual, y una segunda vez sin la cerca de código, y
 *  en cada uno recortar del primer `{` al último `}`). `null` si ninguna de
 *  las dos formas da un `{"problemas": [...]}` parseable. */
function parsearBruto(texto: string): { problemas: unknown[] } | null {
  const sinCerca = texto
    .replace(/^[\s\S]*?```(?:json)?\s*/i, (m) => (texto.includes('```') ? '' : m))
    .replace(/```[\s\S]*$/, '');

  for (const candidato of [texto, sinCerca]) {
    const i = candidato.indexOf('{');
    const j = candidato.lastIndexOf('}');
    if (i < 0 || j < i) continue;
    try {
      const v = JSON.parse(candidato.slice(i, j + 1));
      if (Array.isArray(v?.problemas)) return v as { problemas: unknown[] };
    } catch {
      /* se prueba la siguiente forma */
    }
  }
  return null;
}

/**
 * El texto crudo de una pasada del verificador a `{problemas}` — `null` si
 * no se pudo encontrar ni un `{"problemas": [...]}` parseable (respuesta
 * vacía, cortada, o que ignoró el formato pedido). Con JSON válido pero
 * entradas individuales inválidas, esas entradas se DESCARTAN
 * (`normalizarProblema`) y el resto de la lista se conserva — nunca se
 * invalida la pasada entera por un solo ítem mal formado. Tope de
 * `MAX_PROBLEMAS`, aunque el modelo ya lo tiene pedido en el prompt.
 */
export function parsearVerificacion(texto: string): { problemas: Problema[] } | null {
  const bruto = parsearBruto(texto);
  if (!bruto) return null;

  const problemas = bruto.problemas
    .map(normalizarProblema)
    .filter((problema): problema is Problema => problema !== null)
    .slice(0, MAX_PROBLEMAS);

  return { problemas };
}

// ─────────────────────────────────────────────────────────────
// Unir pasadas (un recurso NUEVO corre 2 en paralelo)
// ─────────────────────────────────────────────────────────────

const ORDEN_GRAVEDAD: Record<GravedadProblema, number> = { alta: 0, media: 1, baja: 2 };

/** Palabras "de contenido" de un texto: en minúsculas, sin puntuación, sin
 *  las de 2 letras o menos (artículos, preposiciones cortas) — para que la
 *  comparación de solapamiento no la decidan "el", "de", "un". */
function palabrasDe(texto: string): Set<string> {
  return new Set(
    texto
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((palabra) => palabra.length > 2),
  );
}

/** Fracción de la más chica de las dos bolsas de palabras que aparece
 *  también en la otra (0 a 1). Contra el tamaño de la más CHICA (no la
 *  unión ni la más grande): dos frases de largo muy distinto que hablan de
 *  lo mismo ("el botón no reinicia" vs. "el botón de reiniciar, al
 *  tocarlo, no vuelve el contador a cero") tienen que seguir pareciendo
 *  duplicadas. */
function solapamiento(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let comunes = 0;
  for (const palabra of a) {
    if (b.has(palabra)) comunes++;
  }
  return comunes / Math.min(a.size, b.size);
}

/** A partir de qué solapamiento de palabras de `que` dos problemas del
 *  MISMO `tipo` se tratan como el mismo hallazgo, reportado por más de una
 *  pasada. Calibrado a ojo: alto a propósito (dos problemas DISTINTOS del
 *  mismo tipo casi nunca comparten más del 60% de sus palabras de "que"). */
const UMBRAL_DUPLICADO = 0.6;

/**
 * Combina las listas de una o más pasadas en una sola (T3: un recurso NUEVO
 * corre 2 pasadas en paralelo, un ajuste corre 1 — con una sola pasada esto
 * es simplemente esa lista, ordenada y recortada):
 *  - unión de todos los problemas de todas las listas;
 *  - dos problemas del MISMO `tipo` cuyo `que` solapa por encima de
 *    `UMBRAL_DUPLICADO` se tratan como el MISMO hallazgo — se conserva sólo
 *    el más grave de los dos (a igual gravedad, el que ya estaba: el orden
 *    de iteración no importa para el resultado final más allá de eso);
 *  - orden final por gravedad (alta primero), tope `MAX_PROBLEMAS`.
 */
export function unirPasadas(listas: Problema[][]): Problema[] {
  const conservados: Array<{ problema: Problema; palabrasQue: Set<string> }> = [];

  for (const problema of listas.flat()) {
    const palabrasQue = palabrasDe(problema.que);
    const indiceExistente = conservados.findIndex(
      (candidato) =>
        candidato.problema.tipo === problema.tipo &&
        solapamiento(candidato.palabrasQue, palabrasQue) >= UMBRAL_DUPLICADO,
    );

    if (indiceExistente === -1) {
      conservados.push({ problema, palabrasQue });
      continue;
    }

    const existente = conservados[indiceExistente]!;
    if (ORDEN_GRAVEDAD[problema.gravedad] < ORDEN_GRAVEDAD[existente.problema.gravedad]) {
      conservados[indiceExistente] = { problema, palabrasQue };
    }
  }

  return conservados
    .map((c) => c.problema)
    .sort((a, b) => ORDEN_GRAVEDAD[a.gravedad] - ORDEN_GRAVEDAD[b.gravedad])
    .slice(0, MAX_PROBLEMAS);
}

// ─────────────────────────────────────────────────────────────
// Corrección a partir de problemas del verificador (item 4 de T3)
// ─────────────────────────────────────────────────────────────

/** Los problemas de `tipo: 'contenido'` nunca se auto-corrigen (son
 *  informativos para el docente: un dato, fecha o fórmula equivocada no es
 *  algo que la IA deba "arreglar" sola sin que el docente lo confirme —
 *  T4, fuera del alcance de esta tarea, es quien los muestra aparte como
 *  "Revisá este dato"). Esta función es la ÚNICA puerta por la que esos
 *  problemas podrían colarse en un mensaje de corrección, así que filtra
 *  acá, no en quien la llama. */
export function problemasAccionables(problemas: Problema[]): Problema[] {
  return problemas.filter((problema) => problema.tipo !== 'contenido');
}

/**
 * El mensaje de corrección a partir de problemas del verificador (item 4:
 * `POST /api/chat/autocorreccion` con `problemasVerificador` en el body, en
 * vez de los campos de la autoprueba). Corto y en español, mismo tono que
 * `construirMensajeCorreccion` (`autoprueba.ts`) pero sin su aparato de
 * líneas de origen citadas: acá no hay un error de ejecución con línea y
 * columna, sólo la descripción del revisor.
 */
export function construirMensajeCorreccionVerificador(problemas: Problema[]): string {
  const accionables = problemasAccionables(problemas);

  const partes: string[] = ['Un revisor encontró estos problemas en el recurso. Arreglalos sin cambiar nada más:'];
  accionables.forEach((problema, indice) => {
    partes.push(`${indice + 1}. ${problema.que}`);
    partes.push(`   Cómo reproducirlo: ${problema.como_reproducir}`);
    partes.push(`   Arreglo sugerido: ${problema.arreglo}`);
  });

  return partes.join('\n');
}
