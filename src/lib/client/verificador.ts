import { htmlParaVerificador, type Problema } from '../ai/verificador.ts';

/**
 * Verificador (T4, `odd/tasks/verificador.md`): módulo del CLIENTE.
 *
 * Tres cosas, cada una testeable por separado sin DOM ni servidor (salvo
 * `verificarRecurso`, la única función de acá con `fetch`):
 *  - CUÁNDO corresponde llamar a `POST /api/chat/verificar`
 *    (`decidirTipoVerificacion`/`cambioElScriptPropio`);
 *  - la llamada en sí (`verificarRecurso`), con `AbortSignal` — Workspace.tsx
 *    la corre en segundo plano, sin bloquear el chat, y la corta si el HTML
 *    cambia mientras tanto;
 *  - qué le corresponde ver al panel (`separarProblemasParaPanel`,
 *    `EstadoPanelVerificador`): accionable vs. de contenido vs. `baja`
 *    (nunca se muestra).
 */

// ─────────────────────────────────────────────────────────────
// Cuándo corresponde verificar (item 1 de T4)
// ─────────────────────────────────────────────────────────────

export type TipoVerificacion = 'nuevo' | 'ajuste';

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/**
 * El código JS "propio" del recurso, normalizado para comparar: cada
 * `<script>` que NO sea el bloque del kit (ya plegado por
 * `htmlParaVerificador`, la MISMA función que usa el propio verificador —
 * `ai/verificador.ts`) ni un `<script data-kodu-pruebas>` (plegado al mismo
 * comentario ahí) ni un `<script src="…">` externo. Se saca TODO el espacio
 * en blanco antes de comparar: un cambio de indentación o de saltos de línea
 * no cuenta como "cambió el script" (T4: "whitespace-only changes
 * don't count").
 *
 * DECISIÓN: reusar `htmlParaVerificador` para el plegado (en vez de repetir
 * la lógica de "qué es el bloque del kit") es a propósito — es la MISMA
 * noción de "bloque del kit" que ya usa el resto del pipeline (el prompt del
 * generador, el propio verificador). Un bloque del kit editado a mano (no
 * canónico) queda, por ese mismo motivo, SIN plegar y por lo tanto cuenta
 * como "script propio" acá — caso de borde fuera del alcance de esta tarea,
 * mismo tratamiento que le da el resto del pipeline a un kit editado a mano.
 */
function scriptPropioNormalizado(html: string): string {
  const plegado = htmlParaVerificador(html);
  const piezas: string[] = [];

  SCRIPT_RE.lastIndex = 0;
  let coincidencia: RegExpExecArray | null;
  while ((coincidencia = SCRIPT_RE.exec(plegado)) !== null) {
    const atributos = coincidencia[1] ?? '';
    if (/\bsrc\s*=/i.test(atributos)) continue; // script externo: no hay contenido propio que comparar.
    piezas.push(coincidencia[2] ?? '');
  }

  // Se saca TODO el espacio en blanco (no se colapsa a uno solo): colapsar
  // dejaba un espacio donde antes no había ninguno (p. ej. `){return` vs.
  // `){\n  return`) y esos dos seguían comparando distinto — exactamente lo
  // que T4 pide que NO cuente ("whitespace-only changes don't count").
  return piezas.join('').replace(/\s+/g, '');
}

/**
 * `true` si el `<script>` propio del recurso (nunca el kit, nunca
 * `data-kodu-pruebas`) cambió entre dos HTML — la señal que decide un
 * `tipo:'ajuste'` (T4: sólo un ajuste que tocó lógica de verdad amerita
 * gastar una pasada del verificador; un cambio de texto, de estilos o sólo
 * del bloque de pruebas no).
 */
export function cambioElScriptPropio(htmlAntes: string, htmlDespues: string): boolean {
  return scriptPropioNormalizado(htmlAntes) !== scriptPropioNormalizado(htmlDespues);
}

/**
 * `null` = no corresponde llamar al verificador para este turno. `'nuevo'`
 * cuando el turno partió del recurso en blanco — la MISMA noción que ya usa
 * el servidor para el checklist (T16/T18: `esRecursoInicial(htmlAlInicioDelTurno)`
 * en `stream.ts`) — `'ajuste'` sólo cuando, además, el `<script>` propio
 * cambió de verdad.
 *
 * Pura a propósito: no sabe nada de turnos de "versiones" (T9) ni de si el
 * HTML cambió en absoluto — eso lo decide Workspace.tsx, que ya tiene esa
 * información antes de llamar (el mismo gate que ya usa para la autoprueba:
 * `cambioElHtml && !pedirVersiones`).
 */
export function decidirTipoVerificacion(args: {
  esRecursoInicialAlEmpezar: boolean;
  htmlAntes: string;
  htmlDespues: string;
}): TipoVerificacion | null {
  if (args.esRecursoInicialAlEmpezar) return 'nuevo';
  return cambioElScriptPropio(args.htmlAntes, args.htmlDespues) ? 'ajuste' : null;
}

// ─────────────────────────────────────────────────────────────
// La llamada al endpoint (item 1 de T4)
// ─────────────────────────────────────────────────────────────

export type ResultadoVerificar =
  | { estado: 'ok'; problemas: Problema[]; pasadas: number; fallidas: number }
  | { estado: 'desactivado' }
  | { estado: 'sin-cupo' }
  | { estado: 'error' };

/**
 * `POST /api/chat/verificar`. `null` = no se pudo completar (red, "Detener"
 * o un HTML que cambió mientras tanto vía `signal`, la huella vencida — 409
 * —, o cualquier respuesta que no tenga la forma esperada): quien llama lo
 * trata IGUAL que `'error'` — nunca hay nada que avisarle al docente por
 * esto, mismo criterio de diseño que el propio endpoint (ver el comentario
 * grande de `src/pages/api/chat/verificar.ts`).
 */
export async function verificarRecurso(
  payload: { projectId: string; fingerprint: string; tipo: TipoVerificacion },
  signal?: AbortSignal,
): Promise<ResultadoVerificar | null> {
  let response: Response;
  try {
    response = await fetch('/api/chat/verificar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch {
    return null; // red, o abort (AbortError) — mismo tratamiento.
  }

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data || data.ok !== true) return null;

  if (data.estado === 'desactivado' || data.estado === 'sin-cupo' || data.estado === 'error') {
    return { estado: data.estado };
  }
  if (data.estado === 'ok' && Array.isArray(data.problemas)) {
    return {
      estado: 'ok',
      problemas: data.problemas as Problema[],
      pasadas: typeof data.pasadas === 'number' ? data.pasadas : 0,
      fallidas: typeof data.fallidas === 'number' ? data.fallidas : 0,
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Qué le corresponde ver al panel (item 3 de T4)
// ─────────────────────────────────────────────────────────────

/**
 * `alta`/`media` de tipo distinto de `contenido` — los únicos que el panel
 * puede ofrecer arreglar con el botón "¿Las arreglo?" (T4). `baja`, de
 * cualquier tipo, nunca se muestra ("baja problems are not shown").
 */
export function problemasAccionablesParaPanel(problemas: Problema[]): Problema[] {
  return problemas.filter((problema) => problema.tipo !== 'contenido' && problema.gravedad !== 'baja');
}

/**
 * `alta`/`media` de tipo `contenido` — siempre informativos, nunca detrás
 * del botón ("Content problems ... are never auto-fixed").
 */
export function problemasDeContenidoParaPanel(problemas: Problema[]): Problema[] {
  return problemas.filter((problema) => problema.tipo === 'contenido' && problema.gravedad !== 'baja');
}

export interface ProblemasParaPanel {
  accionables: Problema[];
  contenido: Problema[];
}

/** Junta los dos filtros de arriba — lo único que Workspace.tsx necesita
 *  para armar `EstadoPanelVerificador` a partir de lo que devolvió el
 *  endpoint. */
export function separarProblemasParaPanel(problemas: Problema[]): ProblemasParaPanel {
  return {
    accionables: problemasAccionablesParaPanel(problemas),
    contenido: problemasDeContenidoParaPanel(problemas),
  };
}

/**
 * Estado del panel del verificador — Workspace.tsx lo guarda y lo pasa a
 * `PreviewPanel`, que sólo lo renderiza (nunca decide una transición por su
 * cuenta). `'resultado'` cubre TANTO "sin problemas" (los dos arrays vacíos)
 * como "con problemas": es `PreviewPanel` quien arma el mensaje distinto
 * para cada combinación (ver el comentario grande ahí).
 */
export type EstadoPanelVerificador =
  | { fase: 'inactivo' }
  | { fase: 'corriendo' }
  | { fase: 'resultado'; accionables: Problema[]; contenido: Problema[] }
  | { fase: 'arreglando' }
  | { fase: 'arreglado' }
  | { fase: 'fallo-arreglo' };

/** "1 cosa para mejorar" / "N cosas para mejorar" — para el encabezado
 *  "Revisé el recurso y encontré …:". */
export function textoCantidadProblemas(cantidad: number): string {
  return `${cantidad} ${cantidad === 1 ? 'cosa' : 'cosas'} para mejorar`;
}
