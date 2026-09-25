import { z } from 'zod';
import type { ChatMessage } from './provider.ts';

/**
 * Checklist del docente (round 4, `odd/tasks/arnes-robustez.md`, T16).
 *
 * Antes de generar un recurso NUEVO (nunca en un ajuste), un paso barato e
 * INDEPENDIENTE del generador le pide al modelo entre 3 y 6 comportamientos
 * observables a partir del pedido del docente — a propósito una llamada
 * aparte y no "parte del mismo pase": una prueba escrita en la misma pasada
 * que el código comparte la misma lectura equivocada del pedido, así que no
 * sirve de nada como red de seguridad (ver "Design decisions" de la tarea).
 *
 * Módulo isomórfico (sin Prisma, sin Node, sin `env.ts`): lo llama el
 * servidor (`stream.ts`, la única parte que de verdad pide el modelo), pero
 * `parsearChecklist`/`leerChecklist`/los dos bloques de texto son puros y
 * `e2e/unidad-checklist.ts` los prueba sin base de datos, mismo criterio que
 * `autoprueba.ts` y `versiones.ts`. El único import "ajeno" es el TIPO
 * `ChatMessage` de `provider.ts` (se borra en la compilación, no arrastra
 * `env.ts` a runtime).
 */

export interface ItemChecklist {
  id: string;
  texto: string;
}

/**
 * Marcador ESTABLE al principio del prompt de sistema de este paso:
 * `e2e/mock-proveedor.ts` lo usa para reconocer esta llamada puntual y
 * contestarle un checklist de mentira APARTE de las colas
 * FIFO/condicional — si no, se comería el próximo `programarRespuesta` de
 * cualquier script viejo (t7, t8, t11…) que no sabe que este pedido existe,
 * y el turno principal terminaría cayendo al HTML de ejemplo por defecto en
 * vez de lo que ese script programó. Mismo criterio que
 * `MARCADOR_CORRECCION_AUTOPRUEBA` en `autoprueba.ts`.
 */
export const MARCADOR_SISTEMA_CHECKLIST = 'Armá un checklist de comportamientos observables';

const SYSTEM_PROMPT_CHECKLIST = `${MARCADOR_SISTEMA_CHECKLIST} del recurso que va a construir KoduEdu, a partir de lo que pide el docente.

Entre 3 y 6 líneas, cada una un comportamiento CONCRETO y VERIFICABLE: una entrada puntual y el resultado visible que tiene que dar. Nada de diseño, estética ni requisitos vagos.

Una línea por ítem, que empiece con "- ". Sin numerar, sin título, sin texto antes ni después de la lista.

Ejemplos de línea: "- Si pinto 1/2 y 3/6, dice que son equivalentes.", "- Mover dos datos no cumple el desafío 1.", "- A 45° el alcance es máximo."`;

/** Los dos únicos mensajes de la llamada de checklist: sin historial, sin
 *  el estado actual del recurso (todavía no existe: sólo corre para un
 *  recurso NUEVO) — sólo el texto crudo del pedido del docente. */
export function construirMensajesChecklist(pedido: string): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT_CHECKLIST },
    { role: 'user', content: pedido },
  ];
}

const MAX_ITEMS = 6;
const MIN_ITEMS_VALIDOS = 2;
const MAX_LARGO_TEXTO = 200;

/** Acepta "- ", "* " o "1. " (cualquier número) al principio de la línea;
 *  cualquier otra línea (título, texto suelto, línea vacía) se descarta
 *  entera, no se le saca el prefijo a medias. */
const PREFIJO_ITEM = /^\s*(?:[-*]|\d+\.)\s+(.*)$/;

/**
 * De la respuesta cruda del modelo, hasta 6 ítems válidos con id `c1..cN`.
 * Con menos de 2 ítems válidos, `[]` entero: un checklist de un solo ítem
 * (o ninguno) no vale más que no tener checklist — mismo criterio que "sin
 * checklist" en el resto del flujo (T16, `stream.ts`: nunca bloquea el
 * turno).
 */
export function parsearChecklist(texto: string): ItemChecklist[] {
  const items: string[] = [];

  for (const lineaCruda of texto.split('\n')) {
    if (items.length >= MAX_ITEMS) break;
    const coincide = PREFIJO_ITEM.exec(lineaCruda);
    if (!coincide) continue;
    const contenido = coincide[1]!.trim();
    if (!contenido || contenido.length > MAX_LARGO_TEXTO) continue;
    items.push(contenido);
  }

  if (items.length < MIN_ITEMS_VALIDOS) return [];
  return items.map((texto, indice) => ({ id: `c${indice + 1}`, texto }));
}

/** Mismo criterio que `attachments` en `ChatMessage` (JSON crudo en una
 *  columna `String?`). */
export function serializarChecklist(items: ItemChecklist[]): string {
  return JSON.stringify(items);
}

const itemChecklistSchema = z.object({
  id: z.string().min(1).max(40),
  texto: z.string().min(1).max(MAX_LARGO_TEXTO),
});
const listaChecklistSchema = z.array(itemChecklistSchema).max(MAX_ITEMS);

/**
 * Lee `ChatMessage.checklist` de vuelta. Nunca tira: un valor corrupto,
 * viejo o con una forma que ya no coincide con el schema actual se trata
 * como "sin checklist" (`[]`), nunca como un error que tumbe el turno.
 */
export function leerChecklist(json: string | null): ItemChecklist[] {
  if (!json) return [];
  try {
    const parsed = listaChecklistSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/**
 * Se agrega al final del ÚLTIMO mensaje de usuario de la generación
 * principal (nunca al `ChatMessage.content` que se persiste del docente,
 * ver `stream.ts`): le pide al modelo un test por ítem, con el mismo id,
 * en `window.__koduPruebas` (el runner ya documentado en BASE_PROMPT, T15).
 */
export function bloqueChecklistParaGenerar(items: ItemChecklist[]): string {
  const ids = items.map((item) => item.id).join(', ');
  const lineas = items.map((item) => `${item.id}: ${item.texto}`).join('\n');
  return (
    'Checklist de comportamientos que el recurso tiene que cumplir. Agregá window.__koduPruebas con una ' +
    `prueba por ítem, con el mismo id. Usá exactamente estos ids: ${ids}; no inventes otros ni cambies el ` +
    `orden.\n${lineas}`
  );
}

/**
 * Se agrega al bloque del "estado actual del recurso" en un turno de
 * AJUSTE (nunca en uno de creación, ese usa `bloqueChecklistParaGenerar`):
 * el checklist ya existe, así que acá sólo se pide mantener
 * `window.__koduPruebas` alineado, no crearlo de cero.
 */
export function bloqueChecklistParaAjuste(items: ItemChecklist[]): string {
  const ids = items.map((item) => item.id).join(', ');
  const lineas = items.map((item) => `${item.id}: ${item.texto}`).join('\n');
  return (
    'Checklist vigente de este recurso: mantené window.__koduPruebas alineado con estos ítems (mismos ids). ' +
    `Usá exactamente estos ids: ${ids}; no inventes otros ni cambies el orden. ` +
    `Si este cambio modifica un comportamiento que ya se prueba, actualizá esa prueba:\n${lineas}`
  );
}
