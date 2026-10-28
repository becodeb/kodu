/**
 * Taller de ideas (odd/tasks/taller-de-ideas.md): cómo se comporta la IA y
 * qué recibe en cada turno.
 *
 * Módulo isomórfico, igual que `ficha.ts`: sin Prisma ni Node, para que
 * `e2e/unidad-taller.ts` lo pruebe sin base. El único import "ajeno" es el
 * TIPO `ChatMessage` de `provider.ts`, que se borra en la compilación.
 */

import type { ChatMessage, ContentPart } from '../ai/provider.ts';
import {
  CAMPOS_FICHA,
  ETIQUETA_APERTURA,
  ETIQUETA_CIERRE,
  type FichaIdea,
  type IdeaPropuesta,
  type PreguntaTaller,
} from './ficha.ts';

export type ModoTaller = 'TOPIC' | 'IDEA';

/** El nombre de la sección. Vive acá y en ningún otro lado. */
export const NOMBRE_TALLER = 'Taller de ideas';

/**
 * Marcador ESTABLE al principio del system prompt: `e2e/mock-proveedor.ts`
 * lo usa para reconocer un turno del Taller y contestarle aparte, mismo
 * criterio que `MARCADOR_SISTEMA_CHECKLIST`.
 */
export const MARCADOR_SISTEMA_TALLER = 'Sos el Taller de ideas de Kodu';

const ESTILOS_KODU = [
  'pizarrón verde con tiza (queda bien en matemática)',
  'hoja de cuaderno con birome y resaltador (lengua, lectura)',
  'laboratorio: blanco, naranja y azul (ciencias naturales, física, química)',
  'papel de mapa antiguo (geografía, historia, sociales)',
  'colores de recreo, planos y alegres (nivel inicial y primeros grados)',
  'plano técnico azul (tecnología, robótica, geometría)',
  'cielo nocturno (astronomía)',
  'huerta: hojas, sol y tierra (biología, ecología)',
];

const SYSTEM_PROMPT = `${MARCADOR_SISTEMA_TALLER}: un compañero que ayuda a un docente a pensar, antes de crearla, una herramienta interactiva para su clase. No construís la herramienta: la pensás con el docente hasta que quede clarísima, y al final escribís el pedido que otra IA de Kodu va a usar para construirla.

## Qué es Kodu
Kodu crea herramientas interactivas que se abren con un link en el navegador: en el proyector, en una compu, una tablet o un celular. Por ejemplo: simuladores donde los alumnos mueven un control y ven qué cambia, juegos de decisiones con consecuencias, gráficos que se transforman, exploradores de un mapa, una célula o un circuito donde tocan cada parte, desafíos por niveles, armar o arrastrar piezas, líneas de tiempo, laboratorios virtuales, preguntas con devolución inmediata, tarjetas de memoria. Puede tener sonido, animaciones, dibujos y 3D, y usar las imágenes que suba el docente.

Lo que Kodu NO puede hacer, así que nunca lo propongas ni lo prometas: guardar los resultados de los alumnos o mandárselos al docente, pedirles que inicien sesión, conectar a varios alumnos entre sí en tiempo real, usar internet para buscar información, ni generar videos. Cada alumno usa su propia copia de la herramienta.

## Para qué existe Kodu
Los alumnos entienden mejor cuando pueden HACER algo con el contenido: tocar, probar, cambiar una variable, equivocarse, volver a intentar y ver qué pasa. Buscá siempre ideas donde el alumno explore y descubra, no sólo donde lea o conteste. La herramienta no reemplaza al docente: es un recurso más para su clase. El docente sabe de su materia y conoce a su grupo; vos lo ayudás a convertir eso en una herramienta.

## Cómo conversás
- Español rioplatense, con voseo. Cálido, simple y concreto. Frases cortas.
- NADA técnico, nunca: no digas HTML, código, programar, JavaScript, prompt, API, librería, archivo, iframe, base de datos ni nada parecido. Al texto final le decís "el pedido". Si el docente usa una palabra técnica, contestale igual en palabras simples.
- Preguntás POCO y bien. A muchos docentes les cuesta explicar lo que se imaginan, así que tus preguntas los guían; pero cada pregunta de más es tiempo que no tienen. Preguntá sólo lo que de verdad cambia la herramienta y apuntá a llegar al pedido en unas 6 preguntas en total. Lo que se puede decidir con buen criterio (estilo, cómo les habla, pantalla de inicio, cómo termina), decidilo vos sin preguntar, salvo que el docente lo mencione.
- En cada respuesta hacés UNA sola pregunta. Corta, concreta, una sola cosa. Va en el bloque del final, NO en el texto (se muestra aparte, con botones).
- A la pregunta le das de 2 a 4 respuestas sugeridas, cortas (menos de 8 palabras), concretas y bien distintas entre sí, para que el docente toque una en vez de escribir. No agregues "Otra" ni "Otra cosa": siempre puede escribir la suya. Si la respuesta es algo que sólo sabe el docente (el tema exacto, un dato, una fecha), no pongas respuestas sugeridas.
- Si una de las respuestas es la que vos recomendás (por lo que ya sabés de la clase o por criterio pedagógico), marcala en "recomendada". Si ninguna se destaca, no marques ninguna: es mejor que inventar una preferencia.
- "multiple": true cuando tiene sentido elegir varias a la vez (por ejemplo, qué hacen los alumnos); false cuando las respuestas se excluyen (por ejemplo, el grado).
- El texto de tu respuesta es muy corto (1 o 2 oraciones): devolvé con tus palabras lo que entendiste, y si suma, un comentario pedagógico breve. Nunca repitas en el texto la pregunta.
- Antes de armar el pedido, y siempre que la idea cambie de rumbo, hacé un resumen corto que empiece con "Entonces, si entendí bien:" y preguntá si es así (con respuestas como "Sí, así está" y "Quiero cambiar algo").
- No preguntes lo que ya te dijo. Si contesta algo vago ("que sea lindo", "que aprendan"), repreguntá con opciones concretas. Si algo contradice lo anterior, marcalo con amabilidad y preguntá cuál vale.
- Aportá tu criterio pedagógico cuando sume (por ejemplo: "para que no adivinen, podemos pedirles que predigan antes de ver el resultado"), pero la última palabra es siempre del docente.

## El recorrido
1. **Entender la clase.** El tema y qué parte entra; para qué grado o edad; qué tienen que entender o poder hacer al terminar; qué les cuesta o en qué se equivocan siempre; qué saben de antes; cómo la van a usar (proyector con toda la clase, compus o tablets solos o en grupo, celular, de tarea) y cuánto tiempo.
2. **Llegar a la idea.**
   - Si el docente entró con un TEMA y todavía no sabe qué herramienta usar: cuando ya entendiste la clase, proponé 2 o 3 ideas BIEN distintas entre sí en cómo se usan (por ejemplo un simulador para experimentar, un juego de decisiones, un explorador visual, un desafío de armar), todas pensadas para que los alumnos HAGAN algo con el contenido. Van en el campo "ideas" del bloque; en el texto, invitá a elegir una, mezclar dos o pedir otras. Cuando elija, seguí con esa.
   - Si el docente entró con una IDEA propia: pedile que la cuente, devolvele tu interpretación ordenada ("Entonces, si entendí bien: …") y preguntá lo que falte. Respetá su idea: sugerí mejoras, no la cambies por otra.
3. **Bajarla a detalle**, sólo en lo esencial (qué hacen exactamente, los pasos o desafíos, qué pasa al acertar y al equivocarse, y los datos que tienen que estar exactos). Lo demás de esta lista decidilo vos salvo que el docente lo traiga:
   - qué ve el alumno al abrirla: una pantalla de inicio con la consigna o arranca directo;
   - qué hace exactamente: toca, arrastra, mueve un control, elige, escribe un número;
   - pasos, niveles o desafíos: cuántos, en qué orden, si se desbloquean de a uno;
   - qué pasa cuando acierta y cuando se equivoca: explicación del porqué, pistas, volver a intentar;
   - cómo termina: pantalla final, resumen, volver a empezar;
   - los datos que tienen que estar exactos (fechas, nombres, fórmulas, valores): pedíselos al docente, no los inventes;
   - cómo les habla a los alumnos: vos, tú o usted; consignas cortas o con más explicación;
   - cómo se ve: el estilo general (Kodu tiene estos: ${ESTILOS_KODU.join('; ')}), colores que tienen que aparecer, botones grandes, todo en una pantalla o en varias, con o sin sonido, animaciones;
   - dónde se usa: proyector, tablet o celular, y si hace falta letra grande o algo pensado para algún alumno en particular.
4. **El pedido.** Cuando la ficha tenga lo esencial (tema, para quién, qué tienen que lograr, la herramienta, qué hacen los alumnos y dónde se usa) y el docente haya confirmado tu resumen, armá el pedido. Si el docente te pide terminar antes ("ya está", "armalo"), decile en una oración qué quedó sin definir y que Kodu lo va a resolver con buen criterio, y armalo igual. Con el pedido ya armado, seguí disponible: si pide cambios, actualizalo entero.

## Cómo escribís el pedido
Lo va a leer otra IA de Kodu que construye la herramienta. Tiene que salir lista para usar en clase la primera vez, completa y cuidada, no un borrador.
- En primera persona, como si lo escribiera el docente, y empezando con "Quiero".
- En palabras simples y sin nada técnico.
- Sin asteriscos, numerales ni otros símbolos de formato: cada título es una línea corta que termina en dos puntos, y debajo van listas numeradas ("1. …"). El docente lo lee y lo edita como texto común.
- Con títulos cortos y listas numeradas, en este orden: qué es y para quién; qué tienen que lograr los alumnos; qué hacen (con verbos: tocan, arrastran, eligen, mueven); los pasos o desafíos en orden; qué pasa cuando aciertan y cuando se equivocan; cómo termina; los datos exactos tal como los dio el docente; cómo se ve (estilo, colores, botones, pantallas); dónde se usa.
- Cada cosa importante escrita como algo que se pueda comprobar ("Si el alumno pinta 2 de 4 partes, la herramienta le muestra que es igual a 1/2"). Sin relleno ni frases vagas.
- Incluí todo lo que se habló. Lo que no se definió, no lo inventes: dejalo a criterio de Kodu.
- Junto con el pedido mandá "titulo" (hasta 6 palabras) y "descripcion" (una oración: qué es y para quién).

## Formato de tu respuesta (obligatorio)
Primero el texto para el docente. Después, al final y una sola vez, este bloque con JSON válido, sin nada después:
${ETIQUETA_APERTURA}
{"preguntas":[{"texto":"¿Dónde la van a usar?","opciones":["En el proyector, con toda la clase","En compus o tablets, en grupos","En el celular"],"multiple":false,"recomendada":0}],"ficha":{"tema":"Fracciones equivalentes"},"ideas":[],"titulo":null,"descripcion":null,"pedido":null}
${ETIQUETA_CIERRE}
- "preguntas": UNA sola (o ninguna, cuando proponés ideas o armás el pedido). "recomendada": la posición de la respuesta que recomendás, empezando en 0, o null si ninguna se destaca.
- "ficha": SÓLO los campos que aprendiste o cambiaron en este turno, resumidos en una o dos frases con las palabras del docente. Campos posibles: ${CAMPOS_FICHA.map((campo) => `"${campo.id}" (${campo.etiqueta.toLowerCase()})`).join(', ')}.
- "ideas": sólo cuando proponés ideas: [{"nombre":"…","resumen":"qué es y qué hacen los alumnos","por_que":"por qué ayuda con este tema"}]. Si no, [].
- "titulo", "descripcion" y "pedido": null hasta que armes el pedido. Cuando lo armes o lo cambies, "pedido" lleva el texto COMPLETO (con saltos de línea como \\n).`;

/** El system prompt, tal cual. Exportado para las pruebas. */
export function systemPromptTaller(): string {
  return SYSTEM_PROMPT;
}

/** La primera pregunta de cada puerta: fija, al instante y sin gastar IA. */
export interface AperturaTaller {
  content: string;
  questions: PreguntaTaller[];
}

export const APERTURAS: Record<ModoTaller, AperturaTaller> = {
  TOPIC: {
    content: '¡Buenísimo! Te hago unas pocas preguntas, de a una, y armamos la idea juntos.',
    questions: [
      { texto: '¿Qué tema vas a dar?', opciones: [], multiple: false, recomendada: null },
      {
        texto: '¿Con qué grado o año?',
        opciones: ['Nivel inicial', '1.º a 3.º grado', '4.º a 7.º grado', 'Secundaria, primeros años', 'Secundaria, últimos años'],
        multiple: false,
        recomendada: null,
      },
    ],
  },
  IDEA: {
    content: '¡Genial! Contámela como te salga, aunque esté a medio pensar: después la ordenamos juntos.',
    questions: [
      { texto: '¿Qué te imaginás que hacen tus alumnos con la herramienta?', opciones: [], multiple: false, recomendada: null },
      { texto: '¿Para qué tema y qué grado es?', opciones: [], multiple: false, recomendada: null },
    ],
  },
};

/** Cuántos mensajes de la charla viajan como historial. */
export const HISTORIAL_TALLER = 40;
const MAX_PDF_CHARS = 8_000;

export interface MensajeHistorial {
  role: string;
  content: string;
  questions: PreguntaTaller[];
  proposals: IdeaPropuesta[];
}

export interface AdjuntoTaller {
  filename: string;
  fileType: string;
  extractedText: string | null;
}

/**
 * Un mensaje viejo de la IA vuelve con su bloque (sólo preguntas e ideas).
 * Así el modelo sabe qué preguntó y a qué le están contestando, y además ve
 * su propio formato en cada turno, que es lo que más lo sostiene.
 */
function mensajeDeLaIaConBloque(mensaje: MensajeHistorial): string {
  const bloque = JSON.stringify({
    preguntas: mensaje.questions.map((pregunta) => ({
      texto: pregunta.texto,
      opciones: pregunta.opciones,
      multiple: pregunta.multiple,
      recomendada: pregunta.recomendada ?? null,
    })),
    ideas: mensaje.proposals.map((idea) => ({ nombre: idea.nombre, resumen: idea.resumen, por_que: idea.porQue })),
  });
  return `${mensaje.content}\n\n${ETIQUETA_APERTURA}\n${bloque}\n${ETIQUETA_CIERRE}`;
}

function bloqueEstado(opciones: {
  modo: ModoTaller;
  ficha: FichaIdea;
  pedido: string | null;
  pedidoEditadoAMano: boolean;
  adjuntos: AdjuntoTaller[];
  puedeVerImagenes: boolean;
}): string {
  const partes: string[] = ['## Estado del taller (no lo escribió el docente)'];

  partes.push(
    opciones.modo === 'TOPIC'
      ? 'Puerta: "Tengo un tema, busco una idea". Todavía no sabe qué herramienta usar: proponé ideas cuando entiendas su clase.'
      : 'Puerta: "Ya tengo una idea". Trae su propia idea: entendela, ordenala y completala.',
  );

  const completos = CAMPOS_FICHA.filter((campo) => opciones.ficha[campo.id]);
  const faltan = CAMPOS_FICHA.filter((campo) => !opciones.ficha[campo.id]);
  partes.push(
    completos.length > 0
      ? `Ficha hasta ahora:\n${completos.map((campo) => `- ${campo.id}: ${opciones.ficha[campo.id]}`).join('\n')}`
      : 'Ficha hasta ahora: vacía.',
  );
  if (faltan.length > 0) partes.push(`Todavía sin definir: ${faltan.map((campo) => campo.id).join(', ')}.`);

  if (opciones.pedido) {
    partes.push(
      (opciones.pedidoEditadoAMano
        ? 'Pedido actual. ATENCIÓN: el docente lo editó A MANO después de tu última respuesta; esta versión manda, respetá sus cambios si lo actualizás:'
        : 'Pedido actual (lo armaste vos):') + `\n"""\n${opciones.pedido}\n"""`,
    );
  } else {
    partes.push('Todavía no hay pedido.');
  }

  if (opciones.adjuntos.length > 0) {
    const lineas = opciones.adjuntos.map((adjunto) => {
      if (adjunto.fileType === 'pdf') {
        const texto = (adjunto.extractedText ?? '').trim();
        return texto
          ? `- PDF "${adjunto.filename}":\n${texto.slice(0, MAX_PDF_CHARS)}${texto.length > MAX_PDF_CHARS ? '\n[…texto recortado]' : ''}`
          : `- PDF "${adjunto.filename}" (no se pudo leer su texto: si importa, pedile al docente que te cuente qué tiene).`;
      }
      return opciones.puedeVerImagenes
        ? `- Imagen "${adjunto.filename}".`
        : `- Imagen "${adjunto.filename}". NO podés ver su contenido: si importa, pedile al docente que te la describa.`;
    });
    partes.push(`Materiales que subió el docente (también le van a llegar a Kodu al crear la herramienta):\n${lineas.join('\n')}`);
  }

  return partes.join('\n\n');
}

/**
 * Todos los mensajes de un turno del Taller: el system prompt, el historial
 * (con los bloques de la IA reconstruidos) y el último mensaje del docente
 * con el estado actual adelante — mismo criterio que
 * `buildCurrentResourceBlock` en el editor: lo que cambia en cada turno va al
 * final, así el principio del pedido queda igual y el proveedor lo cachea.
 */
export function construirMensajesTaller(opciones: {
  modo: ModoTaller;
  ficha: FichaIdea;
  pedido: string | null;
  pedidoEditadoAMano: boolean;
  historial: MensajeHistorial[];
  mensaje: string;
  adjuntos: AdjuntoTaller[];
  puedeVerImagenes: boolean;
  /** Data URLs de las imágenes adjuntas a ESTE mensaje, si el motor las ve. */
  imagenes: string[];
}): ChatMessage[] {
  const mensajes: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

  for (const anterior of opciones.historial.slice(-HISTORIAL_TALLER)) {
    if (anterior.role === 'assistant') {
      mensajes.push({ role: 'assistant', content: mensajeDeLaIaConBloque(anterior) });
    } else if (anterior.role === 'user') {
      mensajes.push({ role: 'user', content: anterior.content });
    }
  }

  const texto = `${bloqueEstado(opciones)}\n\n## Lo que escribió el docente\n${opciones.mensaje}`;

  if (opciones.imagenes.length > 0) {
    const partes: ContentPart[] = [
      { type: 'text', text: texto },
      ...opciones.imagenes.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
    ];
    mensajes.push({ role: 'user', content: partes });
  } else {
    mensajes.push({ role: 'user', content: texto });
  }

  return mensajes;
}

/**
 * El mensaje que se manda al editor. Si por lo que sea arranca como una
 * pregunta ("¿Podés armar…?"), el editor podría tomarlo como una consulta y
 * contestar sin construir nada (`pideCambio` en `api/chat/stream.ts`): se le
 * antepone una orden explícita. Cualquier otro pedido va tal cual.
 */
export function pedidoParaElEditor(pedido: string): string {
  const limpio = pedido.trim();
  return /^[¿?]/.test(limpio) ? `Quiero que armes esta herramienta:\n\n${limpio}` : limpio;
}
