/**
 * Puente entre el iframe de vista previa y la app.
 *
 * El iframe se monta con `sandbox="allow-scripts"` y SIN `allow-same-origin`,
 * así que su origen es `null` y el padre no puede leer su DOM. Para la captura
 * (SPEC §5.2) inyectamos este script y hablamos por postMessage: el iframe
 * rasteriza su propio contenido y devuelve un data URL.
 *
 * Se usa `html-to-image` y NO `html2canvas` (el SPEC admite cualquiera de los
 * dos): html2canvas clona el documento dentro de un iframe hijo y en un
 * documento de origen `null` eso explota con
 * "Blocked a frame with origin null from accessing a cross-origin frame".
 * html-to-image serializa a SVG/foreignObject sin crear iframes, así que no
 * necesitamos aflojar el sandbox — que es lo que mantiene al recurso generado
 * lejos de la sesión del docente.
 *
 * Ojo: este puente se inyecta SÓLO en la vista previa del editor. La página
 * pública /p/[slug] sirve el HTML del docente tal cual, sin este bridge; lo
 * único que puede agregarle es un `<meta name="viewport">` de respaldo si al
 * HTML le faltaba (odd/tasks/responsive-celulares.md, T2).
 *
 * El mismo puente admite otras opciones de captura (JPEG en vez de WebP, sin
 * bajar el ancho, con tope de ALTO en vez de tope de ancho) por si algún
 * llamador futuro las necesita. `CAPTURE_REQUEST` acepta `id` (para que
 * quien pidió la captura reconozca SU respuesta si hubiera más de un pedido
 * en el aire) y `opciones`; sin ninguno de los dos, el resultado es BYTE A
 * BYTE el de siempre (portada de galería).
 */

export const CAPTURE_REQUEST = '__kodu_capture_request__';
export const CAPTURE_RESULT = '__kodu_capture_result__';
export const PREVIEW_READY = '__kodu_preview_ready__';

const HTML_TO_IMAGE_CDN = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.js';

/** Ancho al que se normaliza la captura de portada antes de guardarla. */
const SNAPSHOT_WIDTH = 900;

/** Opciones de una captura pedida por `postMessage`. Todas opcionales: sin
 *  ninguna, el resultado es el de siempre (portada de galería). */
export interface OpcionesCaptura {
  /** `'webp'` (default, portada) o `'jpeg'`. */
  formato?: 'webp' | 'jpeg';
  /** 0–1. Default 0.85 en los dos formatos. */
  calidad?: number;
  /**
   * Tope de ALTO en píxeles. Con esto puesto, el ancho NO se toca (se manda
   * tal cual lo ve el docente) y sólo se achica si hace falta para respetar
   * este tope, conservando la proporción. Sin esto, se usa el
   * comportamiento de siempre: bajar el ancho a `SNAPSHOT_WIDTH`.
   */
  altoMax?: number;
  /**
   * T5 (motor-claude, revisor visual): ancho al que se normaliza la
   * captura, en vez del `SNAPSHOT_WIDTH` fijo de la portada de galería. Sin
   * efecto si `altoMax` también está puesto (`altoMax` manda, mismo orden
   * que antes). Ignorado si no es un número positivo.
   */
  anchoMax?: number;
  /**
   * T4 round 5 (motor-claude): captura la página ENTERA (alto real del
   * documento, `scrollHeight` — no sólo lo que entra en el viewport) en vez
   * del alto de ventana de siempre. Nace porque un pedido "agregá X al
   * final" puede quedar fuera del primer viewport (1280×800) y el revisor
   * nunca lo ve. Con esto puesto, el resultado llega SIEMPRE como
   * `dataUrls` (array, nunca `dataUrl`): 1 elemento si el documento entra
   * en `ALTO_TOPE_PAGINA_COMPLETA` px, 2 ("arriba"/"abajo", recortados del
   * mismo render sin re-renderizar) si es más alto — nunca más de 2, para
   * no disparar el costo de tokens de imagen sin límite. Sin esto, el
   * comportamiento es BYTE A BYTE el de siempre (`dataUrl` único, alto de
   * ventana).
   */
  paginaCompleta?: boolean;
}

/** Tope de alto (del render original, antes de escalar) para la captura de
 *  página completa. Por encima de esto se reparte en dos imágenes en vez de
 *  una sola cada vez más angosta/ilegible al escalar a `anchoMax`. */
const ALTO_TOPE_PAGINA_COMPLETA = 3000;

const BRIDGE = `<script data-kodu-bridge>
(function () {
  function post(message) { try { parent.postMessage(message, '*'); } catch (e) {} }

  function withLibrary(done) {
    if (window.htmlToImage) return done();
    var tag = document.createElement('script');
    tag.src = '${HTML_TO_IMAGE_CDN}';
    tag.crossOrigin = 'anonymous';
    tag.onload = function () {
      if (window.htmlToImage) done();
      else post({ type: '${CAPTURE_RESULT}', error: 'No se pudo inicializar el capturador de pantalla.' });
    };
    tag.onerror = function () {
      post({ type: '${CAPTURE_RESULT}', error: 'No se pudo cargar el capturador de pantalla (¿hay conexión a internet?).' });
    };
    document.head.appendChild(tag);
  }

  window.addEventListener('message', function (event) {
    if (!event.data || event.data.type !== '${CAPTURE_REQUEST}') return;

    var id = event.data.id;
    var opciones = event.data.opciones || {};

    withLibrary(function () {
      // Capturamos el alto de la ventana, no el del contenido: si el recurso es
      // corto, una imagen de 900x70 recortada en la tarjeta de la galería queda
      // con un zoom absurdo. Esto es "lo que se ve en pantalla".
      // T4 round 5: con 'paginaCompleta', en cambio, se quiere justo lo
      // contrario — el alto REAL del documento, aunque sea más que la
      // ventana, para no perder contenido agregado más abajo del fold.
      var width = document.documentElement.clientWidth || document.body.scrollWidth;
      var height = opciones.paginaCompleta
        ? Math.max(document.documentElement.scrollHeight || 0, document.body.scrollHeight || 0, 1)
        : Math.max(document.documentElement.clientHeight || 0, 1);

      // El fondo real del recurso, NO blanco fijo. Forzar blanco daba capturas
      // con los colores cambiados en todo recurso de fondo oscuro: el body suele
      // ser transparente y el color lo pone <html>, asi que el blanco se colaba
      // por detras y lavaba la imagen entera.
      function fondoReal() {
        var candidatos = [document.body, document.documentElement];
        for (var i = 0; i < candidatos.length; i++) {
          var c = getComputedStyle(candidatos[i]).backgroundColor;
          if (c && c !== 'transparent' && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(c)) return c;
        }
        return '#ffffff';
      }

      window.htmlToImage
        .toCanvas(document.body, {
          backgroundColor: fondoReal(),
          pixelRatio: 1,
          width: width,
          height: height,
          style: { margin: '0', width: width + 'px', height: height + 'px' },
        })
        .then(function (canvas) {
          var formato = opciones.formato === 'jpeg' ? 'image/jpeg' : 'image/webp';
          var calidad = typeof opciones.calidad === 'number' ? opciones.calidad : 0.85;
          var anchoObjetivo = opciones.anchoMax > 0 ? opciones.anchoMax : ${SNAPSHOT_WIDTH};

          function recortarYEscalar(sy, sh) {
            // Recorta del MISMO canvas ya renderizado (sin volver a pedirle
            // nada al DOM) y lo escala a 'anchoObjetivo' de ancho — pero
            // NUNCA para arriba (hallazgo de revisión, motor-claude,
            // pre-deploy): un recurso angosto (ej. pensado para celular)
            // tiene canvas.width < anchoObjetivo (1280 para el revisor), y
            // sin este tope la imagen salía estirada (borrosa, más pesada en
            // base64 para nada) en vez de mandarse a su resolución real.
            // Sólo esta rama (página completa, exclusiva del revisor) lo
            // necesita: la portada de galería (más abajo, sin
            // 'paginaCompleta') normaliza a propósito un recurso chico al
            // ancho fijo de la tarjeta, eso no cambia.
            var ratioEscala = canvas.width ? Math.min(1, anchoObjetivo / canvas.width) : 1;
            var target = document.createElement('canvas');
            target.width = Math.max(1, Math.round(canvas.width * ratioEscala));
            target.height = Math.max(1, Math.round(sh * ratioEscala));
            target
              .getContext('2d')
              .drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, target.width, target.height);
            return target.toDataURL(formato, calidad);
          }

          // T4 round 5: página completa — 1 imagen si entra en el tope de
          // alto, 2 ("arriba"/"abajo") si no, siempre como 'dataUrls'.
          if (opciones.paginaCompleta) {
            var tope = ${ALTO_TOPE_PAGINA_COMPLETA};
            if (canvas.height <= tope) {
              post({ type: '${CAPTURE_RESULT}', id: id, dataUrls: [recortarYEscalar(0, canvas.height)] });
              return;
            }
            var arriba = recortarYEscalar(0, tope);
            var abajo = recortarYEscalar(Math.max(0, canvas.height - tope), tope);
            post({ type: '${CAPTURE_RESULT}', id: id, dataUrls: [arriba, abajo] });
            return;
          }

          // T8: con altoMax puesto, el ancho NO se toca -- solo se achica
          // si hace falta para respetar el tope de ALTO (conservando la
          // proporcion). Sin altoMax (portada de galeria, de siempre), se
          // baja el ancho a SNAPSHOT_WIDTH, suba o baje el alto lo que de.
          var ratio;
          if (opciones.altoMax) {
            ratio = canvas.height > opciones.altoMax ? opciones.altoMax / canvas.height : 1;
          } else {
            ratio = canvas.width ? anchoObjetivo / canvas.width : 1;
          }

          var target = document.createElement('canvas');
          target.width = Math.max(1, Math.round(canvas.width * ratio));
          target.height = Math.max(1, Math.round(canvas.height * ratio));
          target.getContext('2d').drawImage(canvas, 0, 0, target.width, target.height);

          post({ type: '${CAPTURE_RESULT}', id: id, dataUrl: target.toDataURL(formato, calidad) });
        })
        .catch(function (error) {
          post({ type: '${CAPTURE_RESULT}', id: id, error: 'No se pudo generar la captura: ' + error });
        });
    });
  });

  post({ type: '${PREVIEW_READY}' });
})();
<\/script>`;

/**
 * T5 (motor-claude, revisor visual): un `<canvas>` WebGL puede capturar
 * negro con `html-to-image` (y con cualquier captura que lea su contenido
 * después del hecho) — por default el navegador puede limpiar el buffer de
 * dibujo apenas compone el frame, así que para cuando la captura corre ya
 * es tarde para pedir que no lo haga. La única forma real de evitarlo es
 * pedir `preserveDrawingBuffer: true` AL CREAR el contexto — así que este
 * parche tiene que correr ANTES que cualquier script propio del recurso
 * pueda llamar a `canvas.getContext('webgl'...)`, nunca en el momento de
 * capturar. Se inyecta lo más temprano posible (primer hijo de `<head>`, o
 * de `<body>` si no hay `<head>`) — sólo en la vista previa del editor,
 * nunca en `/p/[slug]` ni en el HTML que se guarda.
 *
 * Hallazgo de revisión (motor-claude, pre-deploy): además, SÓLO cuando
 * `buildPreviewDocument` recibe `conRevisor: true` (`PreviewPanel.tsx`, a
 * partir de si el proyecto tiene un motor verificador configurado) — antes
 * de esto se inyectaba en CUALQUIER vista previa del editor, aunque el
 * proyecto no tuviera ningún verificador y nunca se le fuera a pedir una
 * captura de revisor. "nunca en /p/[slug] ni en el HTML que se guarda"
 * (arriba) ya era cierto de antes: esto achica el alcance TODAVÍA más,
 * dentro de la vista previa misma.
 *
 * Límite conocido (documentado, no resuelto acá): si el recurso crea su
 * contexto WebGL desde una librería que no pasa por
 * `HTMLCanvasElement.prototype.getContext` (p. ej. una build que cachea el
 * contexto antes de que este script corra, caso de borde no visto en la
 * práctica), la captura puede seguir saliendo negra — este parche es la
 * mitigación práctica, no una garantía para cualquier librería.
 */
const WEBGL_PATCH = `<script data-kodu-webgl-patch>
(function () {
  if (!window.HTMLCanvasElement) return;
  var original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, options) {
    if (typeof type === 'string' && /^(webgl|webgl2|experimental-webgl)$/i.test(type)) {
      options = Object.assign({}, options || {}, { preserveDrawingBuffer: true });
    }
    return original.call(this, type, options);
  };
})();
<\/script>`;

function conParcheWebgl(html: string): string {
  if (html.includes('<head>')) return html.replace('<head>', `<head>${WEBGL_PATCH}`);
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${WEBGL_PATCH}`);
  if (/<body[\s>]/i.test(html)) return html.replace(/<body([^>]*)>/i, `<body$1>${WEBGL_PATCH}`);
  return WEBGL_PATCH + html;
}

export interface OpcionesPreviewDocument {
  /** Hallazgo de revisión (motor-claude, pre-deploy): `true` sólo cuando el
   *  proyecto tiene un motor verificador configurado — ver el comentario de
   *  `WEBGL_PATCH` arriba. Default `false`: un llamador que no lo pasa
   *  nunca paga el parche (nadie le va a pedir una captura de todos modos). */
  conRevisor?: boolean;
}

export function buildPreviewDocument(html: string, opciones?: OpcionesPreviewDocument): string {
  const conParche = opciones?.conRevisor ? conParcheWebgl(html) : html;
  if (conParche.includes('</body>')) {
    return conParche.replace('</body>', `${BRIDGE}</body>`);
  }
  return conParche + BRIDGE;
}
