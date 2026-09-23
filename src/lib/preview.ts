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
 * T8 ("Revisión visual con captura"): el mismo puente sirve la captura que
 * se le manda al modelo, con otras opciones (JPEG en vez de WebP, sin bajar
 * el ancho, con tope de ALTO en vez de tope de ancho). `CAPTURE_REQUEST`
 * ahora acepta `id` (para que quien pidió la captura reconozca SU respuesta
 * — dos pedidos pueden estar en el aire a la vez, por ejemplo "sacar
 * portada" y la revisión visual de un turno) y `opciones`; sin ninguno de
 * los dos, el resultado es BYTE A BYTE el de siempre (portada de galería).
 */

export const CAPTURE_REQUEST = '__kodu_capture_request__';
export const CAPTURE_RESULT = '__kodu_capture_result__';
export const PREVIEW_READY = '__kodu_preview_ready__';

const HTML_TO_IMAGE_CDN = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.js';

/** Ancho al que se normaliza la captura de portada antes de guardarla. */
const SNAPSHOT_WIDTH = 900;

/** Opciones de una captura pedida por `postMessage` (T8). Todas opcionales:
 *  sin ninguna, el resultado es el de siempre (portada de galería). */
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
}

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
      var width = document.documentElement.clientWidth || document.body.scrollWidth;
      var height = Math.max(document.documentElement.clientHeight || 0, 1);

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
          // T8: con altoMax puesto, el ancho NO se toca -- solo se achica
          // si hace falta para respetar el tope de ALTO (conservando la
          // proporcion). Sin altoMax (portada de galeria, de siempre), se
          // baja el ancho a SNAPSHOT_WIDTH, suba o baje el alto lo que de.
          var ratio;
          if (opciones.altoMax) {
            ratio = canvas.height > opciones.altoMax ? opciones.altoMax / canvas.height : 1;
          } else {
            ratio = canvas.width ? ${SNAPSHOT_WIDTH} / canvas.width : 1;
          }

          var target = document.createElement('canvas');
          target.width = Math.max(1, Math.round(canvas.width * ratio));
          target.height = Math.max(1, Math.round(canvas.height * ratio));
          target.getContext('2d').drawImage(canvas, 0, 0, target.width, target.height);

          var formato = opciones.formato === 'jpeg' ? 'image/jpeg' : 'image/webp';
          var calidad = typeof opciones.calidad === 'number' ? opciones.calidad : 0.85;
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

export function buildPreviewDocument(html: string): string {
  if (html.includes('</body>')) {
    return html.replace('</body>', `${BRIDGE}</body>`);
  }
  return html + BRIDGE;
}
