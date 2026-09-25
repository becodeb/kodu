import type { DiferenciasAutoprueba, ErrorAutoprueba, ResultadoPrueba } from '../ai/autoprueba.ts';

/**
 * Cliente de la autoprueba (round 3, T12 de `arnes-robustez`): corre el
 * protocolo `kodu:'autoprueba'`/`kodu:'autoprueba:resultado'` que expone
 * `SCRIPT_CENTINELA` (`src/lib/ai/kit.ts`) en un iframe OCULTO, aparte del
 * iframe de vista previa de siempre (PreviewPanel) — Workspace.tsx lo llama
 * después de un turno que cambió el recurso (y después de la revisión
 * visual de T8, si corrió).
 *
 * Posición del iframe, MEDIDA y no asumida (T12: "measure, don't assume"):
 * `position:fixed; top:0; left:0; opacity:0; pointer-events:none; z-index:-1`
 * — DENTRO del viewport, sólo invisible. Se descartó "fuera de pantalla"
 * (`left:-9999px`): medido con un recurso que anima por
 * `requestAnimationFrame` durante 2 segundos reales, un iframe sandbox
 * cross-origin fuera del viewport nunca llegó a disparar UN SOLO frame de
 * rAF (Chromium lo trata como un iframe "no visible" a efectos de
 * scheduling, igual que un iframe de publicidad fuera de pantalla) mientras
 * que el mismo recurso con `opacity:0` PERO dentro del viewport dibujó
 * ~60fps, igual que si estuviera realmente a la vista — `setInterval` no se
 * vio afectado en ninguno de los dos casos, pero la autoprueba de T11
 * también depende de rAF indirectamente a través de cualquier recurso que
 * anime así, así que la posición fuera de pantalla podía hacer que un
 * recurso con animación nunca "se asiente" y la autoprueba viera un estado
 * a medio animar o directamente colgado.
 */

export interface ResultadoAutopruebaCliente {
  errores: ErrorAutoprueba[];
  reinicioOk: boolean | null;
  exitoVisibleAlInicio: boolean;
  /** T17 (round 4, "checklist del docente"): resultados de
   *  `window.__koduPruebas` (T14, `SCRIPT_CENTINELA`). `null` = el recurso
   *  no tiene `window.__koduPruebas` (viejo, o sin checklist) — nunca
   *  cuenta como "hay una prueba fallida" (`necesitaCorreccion`). */
  pruebas: ResultadoPrueba[] | null;
  detalles: {
    botonesTocados: string[];
    rangosMovidos: string[];
    reinicio: string;
    diferencias: DiferenciasAutoprueba;
    volatiles: { lineas: number; controles: number };
    duracionMs: number;
    incompleta: boolean;
  };
}

export interface OpcionesAutopruebaIframe {
  /** Para poder cortar la espera desde "Detener" — mismo `AbortController`
   *  que ya usa el resto del turno en Workspace.tsx. Al abortar se limpia el
   *  iframe y se resuelve `null` (mismo tratamiento que un timeout: "no se
   *  pudo probar", nunca un error visible). */
  signal?: AbortSignal;
  /** Cuántos botones like máximo toca la autoprueba (ver `SCRIPT_CENTINELA`,
   *  default 8 del lado del kit si se omite). */
  numBotones?: number;
  timeoutMs?: number;
}

/**
 * T17 (round 4): subido de 25s a 50s. `SCRIPT_CENTINELA` documenta un peor
 * caso de ~44s desde T14 (20s de verificaciones de base + hasta 8 pruebas de
 * `window.__koduPruebas` × 3s cada una) — 25s se quedaba corto ANTES de que
 * el iframe llegara a contestar, así que toda autoprueba con checklist
 * terminaba en "no se pudo probar" por timeout del lado del cliente, nunca
 * por lo que pasó adentro. 50s deja margen sobre esos ~44s más el viaje de
 * ida/vuelta del postMessage y la carga inicial del iframe.
 */
const TIMEOUT_MS_DEFECTO = 50_000;

/**
 * Corre la autoprueba sobre `html` en un iframe oculto, recién creado para
 * esta llamada y SIEMPRE desmontado al terminar (éxito, timeout o abort).
 * `null` = "no se pudo probar" (timeout, "Detener", o el iframe nunca
 * contestó) — nunca tira, y quien llama la trata igual que "no hay nada que
 * corregir todavía": ver el comentario grande de `ejecutarAutopruebaYCorreccion`
 * en Workspace.tsx.
 */
export function ejecutarAutopruebaEnIframe(
  html: string,
  opciones: OpcionesAutopruebaIframe = {},
): Promise<ResultadoAutopruebaCliente | null> {
  return new Promise((resolve) => {
    const id = `autoprueba-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts'); // SIN allow-same-origin: mismo motivo que PreviewPanel.
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    iframe.title = 'Autoprueba (no visible para el docente)';
    // Ver el comentario grande de arriba: medido contra "fuera de pantalla".
    iframe.style.position = 'fixed';
    iframe.style.top = '0';
    iframe.style.left = '0';
    iframe.style.width = '1280px';
    iframe.style.height = '800px';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.style.zIndex = '-1';
    iframe.srcdoc = html;

    let terminado = false;
    let timeoutId: number | null = null;
    // Objeto y no una función suelta: nada especial acá (esto no corre
    // adentro de un `page.evaluate`), es sólo para poder referenciar el
    // mismo listener desde `limpiar` antes de que `onMessage` termine de
    // declararse.
    const estado: { onMessage: ((evento: MessageEvent) => void) | null } = { onMessage: null };

    function limpiar() {
      if (terminado) return;
      terminado = true;
      if (estado.onMessage) window.removeEventListener('message', estado.onMessage);
      opciones.signal?.removeEventListener('abort', onAbort);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      iframe.remove();
    }

    function onAbort() {
      limpiar();
      resolve(null);
    }

    estado.onMessage = function (evento: MessageEvent) {
      if (evento.source !== iframe.contentWindow) return;
      const datos = evento.data;
      if (!datos || datos.kodu !== 'autoprueba:resultado' || datos.id !== id) return;
      const resultado = datos as ResultadoAutopruebaCliente;
      limpiar();
      resolve(resultado);
    };

    function onLoad() {
      try {
        iframe.contentWindow?.postMessage({ kodu: 'autoprueba', id, botones: opciones.numBotones }, '*');
      } catch {
        limpiar();
        resolve(null);
      }
    }

    if (opciones.signal?.aborted) {
      resolve(null);
      return;
    }

    window.addEventListener('message', estado.onMessage);
    opciones.signal?.addEventListener('abort', onAbort, { once: true });
    // Recién se manda el pedido DESPUÉS del "load" del iframe: un
    // `postMessage` mandado antes de que el navegador termine de navegar al
    // `srcdoc` puede perderse (va al `about:blank` inicial, no al documento
    // final) — el propio `SCRIPT_CENTINELA` ya espera `readyState ===
    // 'complete'` + ~800ms de asentado antes de arrancar la autoprueba en
    // sí, así que esperar el "load" acá no le suma latencia real.
    iframe.addEventListener('load', onLoad, { once: true });

    timeoutId = window.setTimeout(() => {
      limpiar();
      resolve(null);
    }, opciones.timeoutMs ?? TIMEOUT_MS_DEFECTO);

    document.body.appendChild(iframe);
  });
}
