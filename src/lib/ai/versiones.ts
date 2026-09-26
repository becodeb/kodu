/**
 * Varias versiones al crear un recurso (T9; T2, odd/tasks/generacion-simple-y-reanudable.md,
 * las convierte en opt-in por proyecto). Partes puras: elegibilidad, las
 * directivas por versión que se suman al system prompt, y el texto fijo del
 * turno. Isomórfico a propósito, como kit.ts: lo importa el servidor
 * (stream.ts, para decidir cuántas versiones corren) Y el cliente
 * (Workspace.tsx, para saber si mostrar el interruptor sin esperar a mandar
 * el pedido) — nada de Prisma, nada de red, nada de `env.ts`.
 *
 * `DEFAULT_HTML` vive ACÁ y no en `lib/projects.ts` (que importa Prisma) por
 * la misma razón: el cliente necesita la MISMA constante para decidir si el
 * recurso "todavía es el de arranque" sin arrastrar el driver de Postgres al
 * bundle del navegador. `lib/projects.ts` re-exporta este valor, así que
 * cualquier import existente (`from '../projects.ts'`) sigue andando igual.
 */

export type IndiceVersion = 1 | 2 | 3;

/** Mismo HTML que `Project.currentHtml` trae por default en el schema
 *  (prisma/schema.prisma) — ver la nota de arriba sobre por qué se movió
 *  acá. */
export const DEFAULT_HTML =
  "<!DOCTYPE html><html><head><meta charset='UTF-8'><script src='https://cdn.tailwindcss.com'></script></head><body class='p-6 text-center text-gray-700 font-sans'><p>Tu recurso aparecerá acá...</p></body></html>";

/**
 * ¿Este recurso todavía es "el de arranque" — el HTML por default sin tocar,
 * o vacío? T9 lo necesita porque "varias versiones" sólo tiene sentido en un
 * turno de creación: con un recurso que ya existe, versionar significaría
 * tres ediciones divergentes del trabajo del docente, no tres propuestas
 * para elegir.
 */
export function esRecursoInicial(html: string): boolean {
  return html === DEFAULT_HTML || html.trim().length === 0;
}

export interface ElegibilidadVersionesInput {
  /** `Capacidades.puedePedirVersiones` (capacidades.ts, `versionsForAll`) Y
   *  `Project.versionsEnabled`, ya combinados por quien llama (stream.ts). */
  puedePedirVersiones: boolean;
  /** `esRecursoInicial(htmlAlInicioDelTurno)`. */
  esRecursoInicial: boolean;
  /** Lo que pidió el cliente en `variants` (zod ya lo acota a 1 | 3 |
   *  ausente en stream.ts). Cualquier valor que no sea exactamente `3` es
   *  "no lo pidió". */
  variantsPedidas: 1 | 3 | undefined;
}

/**
 * Cuántas versiones corresponden para ESTE turno. Pura: la llama SIEMPRE el
 * servidor (nunca confía en lo que mandó el cliente sin cruzarlo con sus
 * propios datos), y el cliente sólo la usa —con sus propias señales— para
 * decidir si mostrar el interruptor, nunca para forzar nada. Las tres
 * condiciones tienen que darse juntas: sin capacidad, sin recurso inicial, o
 * sin haberlo pedido, siempre 1 (el camino de siempre, como si T9 no
 * existiera).
 */
export function variantesEfectivas(input: ElegibilidadVersionesInput): 1 | 3 {
  if (!input.puedePedirVersiones) return 1;
  if (!input.esRecursoInicial) return 1;
  if (input.variantsPedidas !== 3) return 1;
  return 3;
}

/**
 * La directiva que se suma al system prompt de cada versión (Apéndice B
 * queda intacto: esto es una sección nueva y corta, no una reescritura de
 * las reglas de diseño). Las tres comparten la frase de "que se note
 * distinta"; la 2 y la 3 suman su propio enfoque; la 1 suma el pedido de una
 * frase de presentación para el chat — que igual se descarta al persistir
 * (ver `contenidoMensajeDeVersiones` más abajo), pero mientras la versión 1
 * se transmite en vivo el docente la ve escribirse de a poco, como cualquier
 * otro turno.
 */
export function directivaDeVersion(indice: IndiceVersion): string {
  const comun =
    `Esta es la versión ${indice} de 3 para que el docente elija: que se note distinta ` +
    '(otra estructura; otro tema del kit si hay más de uno razonable).';

  if (indice === 1) {
    return (
      `${comun} Además de construir el recurso, escribí en el chat una sola oración ` +
      'presentando que armaste tres versiones distintas para que el docente elija entre ellas.'
    );
  }

  const enfoque =
    indice === 2
      ? 'Priorizá lo visual: un dibujo o diagrama central que el alumno manipula.'
      : 'Priorizá el juego: un desafío con puntaje o tiempo, pensado para jugar en grupo.';

  return `${comun} ${enfoque}`;
}

/** El texto fijo y natural del turno de versiones (decisión del dueño:
 *  discreto y predecible — nunca lo que el modelo haya redactado, ver
 *  `directivaDeVersion(1)`). */
export const MENSAJE_VERSIONES_LISTAS =
  'Te armé tres versiones distintas: mirá cada una y quedate con la que más te guste.';

/**
 * Qué persistir como contenido del mensaje "assistant" de un turno de
 * versiones. `null` = no corresponde el texto fijo — la versión 1 (la única
 * que puede tumbar el turno entero) no llegó a generar nada, así que quien
 * llama cae al `finalText` de siempre, como si este turno nunca hubiese
 * pedido versiones.
 */
export function contenidoMensajeDeVersiones(huboVersionUno: boolean): string | null {
  return huboVersionUno ? MENSAJE_VERSIONES_LISTAS : null;
}
