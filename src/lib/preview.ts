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
 * Ojo: esto se inyecta SÓLO en la vista previa del editor. La página pública
 * /p/[slug] sirve el HTML del docente tal cual, sin agregados.
 */

export const CAPTURE_REQUEST = '__kodu_capture_request__';
export const CAPTURE_RESULT = '__kodu_capture_result__';
export const PREVIEW_READY = '__kodu_preview_ready__';

const HTML_TO_IMAGE_CDN = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.js';

/** Ancho al que se normaliza la captura antes de guardarla. */
const SNAPSHOT_WIDTH = 900;

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

    withLibrary(function () {
      // Capturamos el alto de la ventana, no el del contenido: si el recurso es
      // corto, una imagen de 900x70 recortada en la tarjeta de la galería queda
      // con un zoom absurdo. Esto es "lo que se ve en pantalla".
      var width = document.documentElement.clientWidth || document.body.scrollWidth;
      var height = Math.max(document.documentElement.clientHeight || 0, 1);

      window.htmlToImage
        .toCanvas(document.body, {
          backgroundColor: '#ffffff',
          pixelRatio: 1,
          width: width,
          height: height,
          style: { margin: '0', width: width + 'px', height: height + 'px' },
        })
        .then(function (canvas) {
          var ratio = canvas.width ? ${SNAPSHOT_WIDTH} / canvas.width : 1;
          var target = document.createElement('canvas');
          target.width = ${SNAPSHOT_WIDTH};
          target.height = Math.max(1, Math.round(canvas.height * ratio));
          target.getContext('2d').drawImage(canvas, 0, 0, target.width, target.height);
          post({ type: '${CAPTURE_RESULT}', dataUrl: target.toDataURL('image/webp', 0.85) });
        })
        .catch(function (error) {
          post({ type: '${CAPTURE_RESULT}', error: 'No se pudo generar la captura: ' + error });
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
