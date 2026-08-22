/**
 * Armado del contexto que se manda a DeepSeek en cada turno (SPEC §4.2).
 *
 * Orden de concatenación:
 *   1. System prompt base (formato, librerías por CDN, seguridad)
 *   2. Reglas globales activas (las cargan los ADMIN)
 *   3. Reglas activas del docente
 *   4. Assets subidos (imágenes con su URL pública, texto extraído de PDFs)
 *   5. Estado actual del recurso
 * El historial del ChatThread se agrega aparte, como mensajes.
 */

export interface RuleContext {
  title: string;
  content: string;
}

export interface AssetContext {
  filename: string;
  url: string;
  fileType: string;
  extractedText?: string | null;
}

export interface PromptContext {
  globalRules: RuleContext[];
  userRules: RuleContext[];
  assets: AssetContext[];
  currentHtml: string;
  projectTitle: string;
  /** true si el modelo configurado puede VER las imágenes adjuntas. */
  canSeeImages: boolean;
  /** true si el docente tocó el código a mano desde la última respuesta de la IA. */
  htmlEditedByTeacher: boolean;
}

/** Tope del HTML que viaja en el prompt, para no reventar la ventana de contexto. */
const MAX_HTML_CHARS = 60_000;
const MAX_PDF_CHARS = 12_000;

const BASE_PROMPT = `Sos el motor de generación de KoduEdu, una plataforma donde docentes sin conocimientos técnicos crean recursos didácticos interactivos (quizzes, simuladores, calculadoras, flashcards) conversando en español rioplatense.

## Cómo respondés
- Explicá en el chat, en dos o tres oraciones, qué construiste o qué cambiaste. Tono claro y cercano, sin jerga técnica.
- NUNCA pegues código en el texto de la conversación. El código va siempre por la función \`update_resource_code\`.
- Llamá a \`update_resource_code\` cada vez que crees o modifiques el recurso, con el documento HTML COMPLETO (no fragmentos ni diffs).
- Si el pedido es una duda o un comentario que no cambia el recurso, respondé sólo con texto y no llames a la función.
- SIEMPRE escribí al menos una oración de texto, aunque el pedido sea confuso, no lo entiendas o no puedas resolverlo. Nunca termines un turno en silencio: si algo no te cierra, preguntá.
- Si no podés hacer lo que te piden, decilo con claridad y ofrecé la alternativa más cercana.

## Formato del recurso
- Un único documento HTML5 autoportante: \`<!DOCTYPE html>\`, \`<head>\` con \`<meta charset="UTF-8">\` y viewport, todo el CSS y el JS embebidos.
- Sin imports de módulos locales, sin bundlers, sin pasos de build, sin frameworks que requieran compilación.
- Partí siempre del código actual del recurso y modificá lo mínimo necesario: no rehagas de cero lo que ya funciona.

## Librerías permitidas (sólo por CDN)
- Tailwind CSS: https://cdn.tailwindcss.com
- KaTeX (fórmulas matemáticas): https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css y katex.min.js + auto-render
- Chart.js (gráficos): https://cdn.jsdelivr.net/npm/chart.js
- canvas-confetti (refuerzo positivo): https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js
- Lucide Icons: https://unpkg.com/lucide@latest/dist/umd/lucide.js
No uses ninguna otra dependencia externa.

## Seguridad y contexto de ejecución
El recurso corre dentro de un iframe aislado. No accedas a \`window.parent\`, \`document.cookie\` ni a almacenamiento de terceros, y no hagas \`fetch\` a dominios que no sean los CDN de la lista.

## Calidad pedagógica
- Consignas claras y adecuadas al nivel que indique el docente.
- Retroalimentación inmediata en cada actividad: correcto/incorrecto con una explicación breve.
- Pensado para proyector y pizarra digital: tipografía grande, contraste alto (mínimo WCAG AA), áreas táctiles amplias, layout responsive.
- Todo control interactivo debe ser operable por teclado y tener etiquetas accesibles.`;

function renderRules(title: string, rules: RuleContext[]): string {
  if (rules.length === 0) return '';

  const items = rules
    .map((rule) => `- **${rule.title}**: ${rule.content.trim()}`)
    .join('\n');

  return `\n\n## ${title}\n${items}`;
}

function renderAssets(assets: AssetContext[], canSeeImages: boolean): string {
  if (assets.length === 0) return '';

  const images = assets.filter((asset) => asset.fileType === 'image');
  const pdfs = assets.filter((asset) => asset.fileType === 'pdf');

  let section = '\n\n## Archivos que subió el docente';

  if (images.length > 0) {
    section += '\n\n### Imágenes disponibles\n';
    section += canSeeImages
      ? 'Las imágenes adjuntas al mensaje te llegan y las estás viendo. Insertalas en el recurso con `<img src="URL">` usando estas URLs, que son públicas y estables:\n'
      : // Sin esto el modelo cree que "ve" la imagen porque le llega el nombre, y
        // termina o inventando o devolviendo un turno vacío.
        'IMPORTANTE: NO podés ver el contenido de estas imágenes, sólo conocés su nombre y su URL. ' +
        'Si el docente te pide algo que depende de lo que se ve en la imagen ("que se parezca a esto", ' +
        '"copiá estos colores"), NO adivines: pedile en el chat que te la describa en dos o tres frases ' +
        '(colores, estilo, qué elementos tiene). Igual podés insertarlas en el recurso con `<img src="URL">`:\n';
    section += images.map((img) => `- \`${img.url}\` — ${img.filename}`).join('\n');
  }

  if (pdfs.length > 0) {
    section += '\n\n### Texto extraído de PDFs adjuntos';
    for (const pdf of pdfs) {
      const text = (pdf.extractedText ?? '').trim();
      section += `\n\n#### ${pdf.filename}\n`;
      section += text
        ? text.slice(0, MAX_PDF_CHARS) + (text.length > MAX_PDF_CHARS ? '\n[…texto truncado]' : '')
        : '[No se pudo extraer texto de este PDF]';
    }
  }

  return section;
}

function renderCurrentHtml(
  currentHtml: string,
  projectTitle: string,
  htmlEditedByTeacher: boolean,
): string {
  const wasCut = currentHtml.length > MAX_HTML_CHARS;
  const body = wasCut
    ? `${currentHtml.slice(0, MAX_HTML_CHARS)}\n<!-- …código truncado por longitud -->`
    : currentHtml;

  let section = `\n\n## Estado actual del recurso "${projectTitle}"\n`;

  // El docente puede pegar o escribir HTML en la pestaña "Código". Ese texto ya
  // está acá abajo, pero hay que decirlo explícitamente: si no, el modelo sigue
  // razonando sobre la versión que él mismo generó en el turno anterior.
  section += htmlEditedByTeacher
    ? 'ATENCIÓN: el docente editó o pegó este código A MANO después de tu última respuesta. Esta versión es la buena y manda sobre cualquier cosa que hayas generado antes. Leela con atención, respetá lo que escribió y construí a partir de ACÁ.\n'
    : 'Este es el HTML que se está mostrando ahora mismo en el iframe. Modificalo a partir de acá.\n';

  if (wasCut) {
    // Rehacer un documento a partir de una versión cortada le borra al docente
    // todo lo que quedó afuera del recorte, casi siempre el <script> del final.
    section +=
      '\nEste documento es tan largo que hubo que recortarlo para mostrártelo: lo que sigue NO es el archivo completo. No lo reescribas entero, porque perderías la parte que no ves. Hacé el cambio más acotado posible y, si el pedido toca la zona recortada, decíselo al docente y pedile que te pegue esa parte en el chat.\n';
  }

  return `${section}\n\`\`\`html\n${body}\n\`\`\``;
}

export function buildSystemPrompt(context: PromptContext): string {
  return [
    BASE_PROMPT,
    renderRules('Reglas institucionales (obligatorias)', context.globalRules),
    renderRules('Preferencias de este docente', context.userRules),
    renderAssets(context.assets, context.canSeeImages),
    renderCurrentHtml(context.currentHtml, context.projectTitle, context.htmlEditedByTeacher),
  ].join('');
}
