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
import type { ContentPart } from './provider.ts';
import type { BanderaRoja } from './turno-diff.ts';

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
// El pedido del docente: el primero + (si es un ajuste) el anterior + el último
// ─────────────────────────────────────────────────────────────

/**
 * Arma el texto de "pedido del docente" para el prompt: el pedido ORIGINAL
 * siempre, y — sólo para un ajuste — el pedido del TURNO ANTERIOR (si lo hay
 * y es distinto del original y del actual) y el ÚLTIMO pedido, cada uno
 * aparte y etiquetado, en orden cronológico. `actual` en `null` (turno de
 * creación, o un ajuste cuyo último mensaje ES el mismo que el original) deja
 * el pedido tal cual, sin mirar `anterior`.
 *
 * T4 round 4 (motor-claude): antes sólo viajaba el original + el último —
 * sin el pedido anterior, el revisor no podía juzgar si ESTE turno dejó sin
 * resolver (o directamente deshizo) lo que el docente pidió en el turno
 * previo, uno de los defectos más frecuentes de la evaluación ciega de
 * Haiku 5.5 (regresiones turno a turno).
 */
export function pedidoDocente(pedidoOriginal: string, actual: string | null, anterior?: string | null): string {
  if (!actual) return pedidoOriginal;
  const partes = [pedidoOriginal];
  if (anterior && anterior !== pedidoOriginal && anterior !== actual) {
    partes.push(`## Pedido del turno anterior\n${anterior}`);
  }
  partes.push(`## Último pedido (ajuste)\n${actual}`);
  return partes.join('\n\n');
}

// ─────────────────────────────────────────────────────────────
// El prompt: sistema + usuario (redacción verbatim del experimento)
// ─────────────────────────────────────────────────────────────

/**
 * T5 (motor-claude, revisor visual): sección extra del sistema SÓLO cuando
 * la pasada manda una captura de pantalla (`construirContenidoUsuarioVerificador`
 * con `capturaDataUrl`). Nunca reemplaza nada de la redacción verbatim de
 * arriba — se agrega al final, así una pasada sin imagen (el camino de
 * siempre, gpt-6-luna-style) queda byte a byte igual.
 *
 * T4 round 3 (motor-claude): calibración de gravedad. Medido contra Haiku
 * 5.5 real (smoke-revisor, round 2): 4 problemas por pasada revisada, CERO
 * en 'alta'/'media' — ni con una ilustración visiblemente chata (H2, "ciclo
 * del agua": formas lisas de un solo color, sin textura ni profundidad,
 * gotitas sin forma reconocible) ni con layouts correctos (D3, "media
 * mediana moda": un gráfico de puntos prolijo, sin problema real). El
 * contrato de arriba nunca definía bandas de gravedad con ejemplos —
 * "del más grave al menos grave" deja la banda entera a criterio del
 * modelo, y un modelo conservador por diseño ("no reportes gustos de
 * estilo") termina metiendo cualquier defecto visual en 'baja' por default.
 * Las bandas de abajo son ESPECÍFICAS de esta sección (no tocan la
 * redacción verbatim de la base): atadas a qué notaría un docente
 * proyectando el recurso en el aula, con los tres defectos que
 * `separarProblemasParaPanel`/`problemasAccionables` (gravedad != 'baja')
 * necesitan para disparar la corrección automática.
 */
const SECCION_REVISOR_VISUAL = `

Además del código, tenés una CAPTURA de cómo se ve el recurso renderizado de verdad. Mirala con atención y agregá a tu lista cualquiera de estos problemas que encuentres (mismo tope de 6, mismo orden por gravedad):
- Defectos visibles de layout o render: elementos superpuestos, texto cortado o ilegible, zonas vacías que no deberían estarlo, una ilustración rota o que no cargó.
- El pedido del docente no se cumplió, a simple vista (algo que pidió y no está, o se ve distinto a lo pedido).
- Mala calidad visual contra las reglas de "Diseño visual" del contrato de arriba: una ilustración plana o vacía en vez de tener profundidad tonal real, colores lavados, o un layout que no usa el espacio.

Cómo definir la GRAVEDAD de un problema visual — pensá en el docente proyectándolo en el pizarrón, no en el código:
- alta: lo que pidió el docente falta directamente en la captura, o el recurso se ve notoriamente roto al proyectarlo. Ejemplos: una etapa/elemento que el pedido pide y no aparece en absoluto; texto o un control clave cortado o tapado por otro elemento; una zona que debería tener contenido y está lisa/vacía.
- media: se puede usar, pero un docente notaría la falla de un vistazo. Ejemplos: una ilustración CHATA comparada con lo pedido (formas de un solo color plano, sin sombreado ni profundidad, donde el pedido esperaba una escena ilustrada — no una ilustración "fea", una que no es ilustración de verdad); dos elementos que se solapan parcialmente sin perder legibilidad; un ítem del pedido que está pero muy reducido o fuera de foco.
- baja: un detalle que casi nadie notaría proyectándolo (un margen levemente chico, un tono de color opinable). Reservá 'baja' para esto, NUNCA como default de "no estoy seguro de la gravedad".
Un defecto visual claro (ilustración chata o vacía contra lo pedido, contenido cortado o solapado, un ítem del pedido que falta) es tan accionable como un bug de lógica: va en 'alta' o 'media', nunca se degrada a 'baja' sólo porque el recurso "funciona".
Si la captura se ve bien y coincide con el código, no inventes un problema visual sólo para tener algo que decir.`;

/**
 * T4 round 4 (motor-claude): el contrato de abajo ya pide "incumplimientos
 * del pedido del docente" como punto 3, pero nada lo obligaba a chequear el
 * ÚLTIMO pedido PUNTO POR PUNTO, ni a tratar un cumplimiento PARCIAL (un
 * contador o total que quedó apuntando a la cantidad vieja, una escena que
 * no escaló aunque pedían agrandarla) tan en serio como si faltara entero.
 * Evidencia de la evaluación ciega de Haiku 5.5: el defecto más frecuente no
 * era "no hizo nada", era "hizo la mitad y lo dio por terminado" — justo lo
 * que una banda de gravedad conservadora (ver `SECCION_REVISOR_VISUAL`)
 * tiende a bajar a 'baja'. Se agrega SIEMPRE (con o sin captura, "nuevo" o
 * "ajuste"): no depende de la visión, un contador desactualizado se ve en
 * el código solo.
 */
const SECCION_PEDIDO_EXPLICITO = `

Antes de devolver tu lista, repasá el ÚLTIMO pedido del docente (la sección "## Último pedido (ajuste)", si existe) PUNTO POR PUNTO: para cada cosa concreta que pidió, confirmá en el código (y en la captura, si la tenés) que está hecha por completo. Si el pedido anterior aparece también ("## Pedido del turno anterior"), fijate además que este turno no lo haya dejado sin resolver o deshecho.
Un pedido cumplido a MEDIAS cuenta como no cumplido: un contador, total o mensaje final que sigue apuntando a la cantidad vieja después de agregar o quitar algo; una escena, ilustración o layout que no escaló aunque pedían "más grande" o "para proyectar"; cualquier otra parte del pedido ausente o a medio hacer. Eso es tipo "pedido" y gravedad "alta" — nunca "baja": a un docente que pidió algo y recibió la mitad no le sirve una devolución optimista.`;

/**
 * T4 round 6 (motor-claude): si el mensaje de usuario trae una sección
 * "## Diff estructural de este turno" (`resumenDiffParaRevisor`,
 * `turno-diff.ts`), esto le dice al modelo qué es y cómo usarla — evidencia
 * MEDIDA del propio código (no generada por una IA), para contrastar contra
 * el pedido en vez de confiar sólo en su propia lectura. Se agrega SIEMPRE
 * (igual que `SECCION_PEDIDO_EXPLICITO`): la sección de datos es opcional,
 * pero la instrucción de cómo leerla es estática.
 */
const SECCION_DIFF_ESTRUCTURAL = `
Si el mensaje trae una sección "## Diff estructural de este turno", es una medición directa del código (no una opinión de otra IA): caracteres de texto visible agregados/quitados, etiquetas que cambiaron de cantidad, controles interactivos antes/después y líneas de script cambiadas. Usala como evidencia dura: si el pedido es agregar algo y esa medición muestra casi nada de texto nuevo ni controles nuevos, el pedido NO está cumplido aunque el código "parezca" relacionado — reportalo tipo "pedido", gravedad "alta".`;

/** Puerto verbatim de `sistema()` en `experimentos/razonamiento/verificar.ts`,
 *  con `SECCION_PEDIDO_EXPLICITO` (T4 round 4) y `SECCION_DIFF_ESTRUCTURAL`
 *  (T4 round 6) agregadas siempre al final, y la sección visual de T5
 *  agregada DESPUÉS de esas cuando `conCaptura` es `true` — por default
 *  `false`. Ninguna de las tres toca la redacción verbatim de `base`. */
export function construirSistemaVerificador(reglas: string, opciones?: { conCaptura?: boolean }): string {
  const base = `Sos un revisor experto de recursos didácticos interactivos para escuelas argentinas. Un docente pidió un recurso y otra IA lo generó como un único documento HTML. Tu trabajo: encontrar los problemas CONCRETOS que un alumno o el docente se van a encontrar al usarlo en clase.

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

  const sistema = `${base}${SECCION_PEDIDO_EXPLICITO}\n${SECCION_DIFF_ESTRUCTURAL}`;
  return opciones?.conCaptura ? `${sistema}${SECCION_REVISOR_VISUAL}` : sistema;
}

/** Puerto verbatim de `usuario()` en `experimentos/razonamiento/verificar.ts`
 *  — la única diferencia es `htmlParaVerificador` en vez de `plegarKit` a
 *  secas (T3 pliega además las pruebas, ver más arriba), y el bloque
 *  opcional de diff estructural (T4 round 6, `resumenDiff`) pegado entre el
 *  pedido y el código — `null`/ausente (turno "nuevo", o sin snapshot de
 *  "antes" para diffear) deja el mensaje byte a byte igual al de siempre. */
export function construirUsuarioVerificador(pedido: string, html: string, resumenDiff?: string | null): string {
  const bloqueDiff = resumenDiff ? `\n\n## Diff estructural de este turno\n${resumenDiff}` : '';
  return `## Pedido del docente\n${pedido}${bloqueDiff}\n\n## Recurso generado\n\`\`\`html\n${htmlParaVerificador(html)}\n\`\`\``;
}

/**
 * T5 (motor-claude, revisor visual): el contenido del mensaje "user" para
 * una pasada con captura — un bloque de texto (`construirUsuarioVerificador`,
 * sin cambios) seguido del/los `image_url` de la captura, mismo vocabulario
 * `ContentPart` que ya usa `stream.ts` para adjuntos del docente. Sin
 * `capturaDataUrl`, devuelve el `string` de siempre (ningún motor sin
 * visión ve jamás un array de partes).
 *
 * T4 round 5 (motor-claude): ahora acepta UNA captura (string, de siempre) o
 * VARIAS (array — hasta 2, página larga partida en "arriba"/"abajo" por
 * `preview.ts`, ver `OpcionesCaptura.paginaCompleta`) — cada una se agrega
 * como su propio bloque `image_url`, en el mismo orden en que llegaron.
 */
export function construirContenidoUsuarioVerificador(
  pedido: string,
  html: string,
  capturaDataUrl?: string | string[] | null,
  resumenDiff?: string | null,
): string | ContentPart[] {
  const texto = construirUsuarioVerificador(pedido, html, resumenDiff);
  const capturas = Array.isArray(capturaDataUrl) ? capturaDataUrl.filter(Boolean) : capturaDataUrl ? [capturaDataUrl] : [];
  if (capturas.length === 0) return texto;
  return [
    { type: 'text', text: texto },
    ...capturas.map((url): ContentPart => ({ type: 'image_url', image_url: { url } })),
  ];
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

/** Frequent 3+ letter function words that would otherwise inflate overlap. */
const PALABRAS_VACIAS = new Set(
  'los las del que con para por una uno como pero aunque sin sus ese esa esta este cada mas muy desde hasta entre sobre tambien despues antes cuando donde mientras asi ademas'.split(
    ' ',
  ),
);

/** Content-word stems of a text: lowercase, accents and punctuation removed,
 *  function words dropped, each word cut to its first 5 letters so that
 *  "evalúan"/"evaluarlos" or "desafío"/"desafíos" match. Two passes of the
 *  same model describe one finding with different wording, so exact words
 *  are not enough. */
function palabrasDe(texto: string): Set<string> {
  return new Set(
    texto
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((palabra) => palabra.length > 2 && !PALABRAS_VACIAS.has(palabra))
      .map((palabra) => palabra.slice(0, 5)),
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

/** From which stem overlap of `que` two problems of the SAME `tipo` count as
 *  one finding reported by more than one pass. Calibrated on real
 *  gpt-6-luna output (T5, 2026-09-26): the paraphrased duplicates scored
 *  0.45 and 0.52, while distinct findings of the same resource scored 0.14
 *  or less. The previous 0.6 let both duplicates through. */
const UMBRAL_DUPLICADO = 0.4;

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
/**
 * T4 round 6 (motor-claude): convierte una `BanderaRoja` determinística
 * (`turno-diff.ts`) en un `Problema` con la MISMA forma que devuelve el
 * modelo — así se cuela por el camino de corrección existente
 * (`construirMensajeCorreccionVerificador` → `POST /api/chat/autocorreccion`
 * con `problemasVerificador`, el mismo endpoint que ya tiene la recuperación
 * de un intento fallido y la caída a reescritura completa de la ronda 5) sin
 * ningún código de corrección nuevo. `gravedad: 'alta'`/`tipo: 'pedido'`
 * siempre: una bandera roja es, por construcción, "el pedido no se cumplió".
 */
const EXPLICACION_MOTIVO: Record<BanderaRoja['motivo'], string> = {
  agregar_trivial: 'El pedido pedía agregar/sumar contenido y el cambio medido en el HTML es casi nulo',
  acortar_sin_achicar: 'El pedido pedía acortar/resumir y el contenido visible no se achicó',
  comentario_promesa_sin_contenido: 'El código agregó un comentario que promete contenido nuevo sin agregarlo de verdad',
};

export function problemaDeBanderaRoja(bandera: BanderaRoja, pedidoActual: string): Problema {
  const pedidoRecortado = pedidoActual.trim().slice(0, 300);
  return {
    gravedad: 'alta',
    tipo: 'pedido',
    que: `${EXPLICACION_MOTIVO[bandera.motivo]}. Último pedido: "${pedidoRecortado}".`,
    como_reproducir: bandera.detalle,
    arreglo:
      'Volvé a leer el último pedido del docente y agregá/quitá el contenido real que falta (texto, elementos, controles — no sólo un comentario o un contador). Si de verdad no se puede cumplir, decilo en el chat en vez de dar el cambio por hecho.',
  };
}

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
