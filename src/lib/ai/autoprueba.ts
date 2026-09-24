/**
 * Autoprueba + autocorrección (round 3 de `arnes-robustez`, T12). Sólo la
 * parte PURA compartida por cliente y servidor — mismo criterio que
 * `revision-visual.ts` (isomórfico a propósito: nada de Node, Prisma ni DOM
 * acá, para poder probarlo sin `.env` cargado y para que el cliente lo
 * importe sin arrastrar nada del servidor):
 *
 *  - los TIPOS del resultado que manda `SCRIPT_CENTINELA` (`kit.ts`) por
 *    `postMessage` — el cliente (`src/lib/client/autoprueba.ts`,
 *    Workspace.tsx) los usa para tipar lo que escucha del iframe oculto;
 *  - `necesitaCorreccion`: ¿este resultado amerita un turno de corrección?
 *  - `lineaFuente`/`construirMensajeCorreccion`: arman el mensaje de
 *    corrección citando la línea de origen EXACTA del HTML actual — el
 *    servidor (`api/chat/autocorreccion.ts`) los llama con
 *    `project.currentHtml` de verdad; el cliente nunca arma este mensaje
 *    (sólo manda el `informe` crudo), pero las dos puntas comparten el tipo
 *    `InformeAutoprueba` para que el body del POST y lo que lee el endpoint
 *    sean la misma forma.
 */

// ─────────────────────────────────────────────────────────────
// Tipos: mismo vocabulario que `autoprueba:resultado` en kit.ts
// (SCRIPT_CENTINELA) — ver ese comentario para el detalle de cada campo.
// ─────────────────────────────────────────────────────────────

export interface ErrorAutoprueba {
  tipo: 'error' | 'promesa' | 'consola';
  mensaje: string;
  linea: number | null;
  columna: number | null;
  accion: string;
}

export interface ControlDiff {
  etiqueta: string;
  antes: string | number | boolean | null;
  despues: string | number | boolean | null;
}

export interface DiferenciasAutoprueba {
  textoQueFalta: string[];
  textoQueSobra: string[];
  controles: ControlDiff[];
}

/** Lo que necesita `construirMensajeCorreccion`/`necesitaCorreccion` — un
 *  SUBCONJUNTO de lo que manda `SCRIPT_CENTINELA` (sin `botonesTocados`,
 *  `rangosMovidos`, `volatiles`, `duracionMs`, `incompleta`: nada de eso
 *  entra en el prompt de corrección, así que ni el cliente lo manda en el
 *  body ni el servidor lo valida — mismo criterio de "tope de lo que
 *  importa" que ya usa `revision-visual.ts` con la imagen). */
export interface InformeAutoprueba {
  errores: ErrorAutoprueba[];
  reinicioOk: boolean | null;
  exitoVisibleAlInicio: boolean;
  diferencias: DiferenciasAutoprueba;
}

/**
 * ¿Este informe amerita un turno de corrección? Errores reales de
 * ejecución, O un botón de reinicio que se probó y no volvió al estado
 * inicial. `reinicioOk === null` (no había botón de reinicio) NO cuenta —no
 * hay nada que corregir ahí, y forzar un turno de corrección sin nada
 * concreto que señalar sólo gastaría cupo del docente sin motivo.
 *
 * Toma sólo el subconjunto que necesita (no todo `InformeAutoprueba`): el
 * cliente la llama directo sobre el resultado CRUDO del iframe
 * (`ResultadoAutopruebaCliente`, que trae `diferencias` anidado adentro de
 * `detalles`, no al tope), y no tiene sentido reacomodar el objeto entero
 * sólo para esta pregunta.
 */
export function necesitaCorreccion(informe: { errores: ErrorAutoprueba[]; reinicioOk: boolean | null }): boolean {
  return informe.errores.length > 0 || informe.reinicioOk === false;
}

/**
 * Las líneas `linea` (1-based, tal como las reporta el navegador —
 * `ErrorEvent.lineno`) ± `contexto`, con el propio número de línea al
 * margen: el modelo recibe el HTML ya con el kit PLEGADO en el prompt
 * (`buildCurrentResourceBlock`), así que un número de línea solo no le dice
 * nada — tiene que ver el TEXTO real de esa línea para poder ubicarla y
 * corregirla. `null` si no hay línea (un error de promesa o de consola no
 * siempre trae una) o si el número quedó fuera de rango del HTML actual
 * (el recurso cambió entre que se armó el error y que se arma este mensaje
 * — no debería pasar dentro de un mismo turno de corrección, pero no hay
 * que tirar si pasa).
 */
export function lineaFuente(html: string, linea: number | null, contexto = 1): string | null {
  if (linea === null || !Number.isFinite(linea) || linea < 1) return null;
  const lineas = html.split('\n');
  if (linea > lineas.length) return null;

  const desde = Math.max(1, linea - contexto);
  const hasta = Math.min(lineas.length, linea + contexto);
  const extracto: string[] = [];
  for (let n = desde; n <= hasta; n++) {
    const marca = n === linea ? '>' : ' ';
    extracto.push(`${marca} ${n}: ${lineas[n - 1]}`);
  }
  return extracto.join('\n');
}

/**
 * Marcador ESTABLE al principio de todo mensaje de corrección: T13
 * (`e2e/mock-proveedor.ts`, `programarRespuestaCondicional`) lo usa para
 * elegir la respuesta "sana" del mock sin tener que matchear contra el
 * texto completo del error real, que cambia de test a test.
 */
export const MARCADOR_CORRECCION_AUTOPRUEBA = 'Autoprueba automática antes de entregarle el recurso al docente.';

/**
 * El único mensaje de usuario de la llamada de autocorrección (español,
 * voseo, mismo tono que `INSTRUCCION_REVISION_VISUAL`). Server-only en la
 * práctica (sólo lo llama el endpoint, con el `html` real del proyecto),
 * pero vive acá con el resto de la política de T12 — mismo criterio que
 * revision-visual.ts con su instrucción fija.
 */
export function construirMensajeCorreccion(args: {
  /** El HTML ACTUAL del proyecto (con el kit aplicado): de acá salen las
   *  líneas de origen citadas — nunca el HTML que mandó el cliente, que no
   *  es de confiar. */
  html: string;
  informe: InformeAutoprueba;
  ronda: 1 | 2;
}): string {
  const { html, informe, ronda } = args;

  const partes: string[] = [
    `${MARCADOR_CORRECCION_AUTOPRUEBA} Una autoprueba automática (un script que carga el recurso, mueve los controles y toca los botones) encontró problemas reales al usarlo (ronda ${ronda} de 2). Corregí SOLO esto, sin rediseñar ni tocar nada más del recurso:`,
  ];

  let indice = 1;
  for (const error of informe.errores) {
    const fuente = lineaFuente(html, error.linea);
    const ubicacion =
      error.linea !== null ? ` (línea ${error.linea}${error.columna !== null ? `, columna ${error.columna}` : ''})` : '';
    partes.push(`${indice}. Error de tipo "${error.tipo}"${ubicacion}, ${error.accion}: "${error.mensaje}"`);
    if (fuente) partes.push(`   Línea de origen:\n${fuente}`);
    indice++;
  }

  if (informe.reinicioOk === false) {
    const { textoQueFalta, textoQueSobra, controles } = informe.diferencias;
    partes.push(`${indice}. El botón de reiniciar no vuelve el recurso al estado inicial.`);
    if (textoQueFalta.length > 0) {
      partes.push(`   Falta después de reiniciar (estaba al principio): ${textoQueFalta.map((t) => `"${t}"`).join(', ')}.`);
    }
    if (textoQueSobra.length > 0) {
      partes.push(`   Sobra después de reiniciar (no debería seguir ahí): ${textoQueSobra.map((t) => `"${t}"`).join(', ')}.`);
    }
    if (controles.length > 0) {
      partes.push(
        `   Controles que quedaron distintos: ${controles
          .map((c) => `${c.etiqueta} (antes: ${JSON.stringify(c.antes)}, ahora: ${JSON.stringify(c.despues)})`)
          .join('; ')}.`,
      );
    }
    indice++;
  }

  if (informe.exitoVisibleAlInicio) {
    partes.push(
      'Nota: además, el recurso muestra un mensaje de "completado"/"logrado" visible ANTES de que el docente haga nada — ya que se está corrigiendo igual, fijate que el estado inicial no arranque resuelto.',
    );
  }

  return partes.join('\n');
}
