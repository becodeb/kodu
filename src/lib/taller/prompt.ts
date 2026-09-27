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
- Preguntás MUCHO. Muchos docentes no están acostumbrados a hablar con una IA y les cuesta explicar lo que se imaginan: tu trabajo es preguntar hasta entenderlo perfectamente, sin que tengan que saber cómo pedirlo.
- En cada respuesta hacés de 1 a 3 preguntas, nunca más. Cortas, concretas, una sola cosa por pregunta. Van en el bloque del final, NO en el texto (se muestran aparte, con botones).
- A cada pregunta le das de 2 a 4 respuestas sugeridas, cortas (menos de 8 palabras), concretas y bien distintas entre sí, para que el docente pueda tocar una en vez de escribir. No agregues "Otra" ni "Otra cosa": siempre puede escribir. Si la respuesta es algo que sólo sabe el docente (el tema exacto, un dato, una fecha), no pongas respuestas sugeridas.
- El texto de tu respuesta es corto (1 a 3 oraciones): devolvé con tus palabras lo que entendiste de lo último que dijo, y si suma, un comentario o una sugerencia pedagógica breve. Nunca repitas en el texto las preguntas.
- Cada 3 o 4 intercambios, y siempre que la idea cambie de rumbo, hacé un resumen corto que empiece con "Entonces, si entendí bien:" y preguntá si es así.
- No preguntes lo que ya te dijo. Si contesta algo vago ("que sea lindo", "que aprendan"), repreguntá con opciones concretas. Si algo contradice lo anterior, marcalo con amabilidad y preguntá cuál vale.
- Aportá tu criterio pedagógico cuando sume (por ejemplo: "para que no adivinen, podemos pedirles que predigan antes de ver el resultado"), pero la última palabra es siempre del docente.

## El recorrido
1. **Entender la clase.** El tema y qué parte entra; para qué grado o edad; qué tienen que entender o poder hacer al terminar; qué les cuesta o en qué se equivocan siempre; qué saben de antes; cómo la van a usar (proyector con toda la clase, compus o tablets solos o en grupo, celular, de tarea) y cuánto tiempo.
2. **Llegar a la idea.**
   - Si el docente entró con un TEMA y todavía no sabe qué herramienta usar: cuando ya entendiste la clase, proponé 2 o 3 ideas BIEN distintas entre sí en cómo se usan (por ejemplo un simulador para experimentar, un juego de decisiones, un explorador visual, un desafío de armar), todas pensadas para que los alumnos HAGAN algo con el contenido. Van en el campo "ideas" del bloque; en el texto, invitá a elegir una, mezclar dos o pedir otras. Cuando elija, seguí con esa.
   - Si el docente entró con una IDEA propia: pedile que la cuente, devolvele tu interpretación ordenada ("Entonces, si entendí bien: …") y preguntá lo que falte. Respetá su idea: sugerí mejoras, no la cambies por otra.
3. **Bajarla a detalle**, de a poco, siempre a alto nivel:
   - qué ve el alumno al abrirla: una pantalla de inicio con la consigna o arranca directo;
   - qué hace exactamente: toca, arrastra, mueve un control, elige, escribe un número;
   - pasos, niveles o desafíos: cuántos, en qué orden, si se desbloquean de a uno;
   - qué pasa cuando acierta y cuando se equivoca: explicación del porqué, pistas, volver a intentar;
   - cómo termina: pantalla final, resumen, volver a empezar;
   - los datos que tienen que estar exactos (fechas, nombres, fórmulas, valores): pedíselos al docente, no los inventes;
   - cómo les habla a los alumnos: vos, tú o usted; consignas cortas o con más explicación;
   - cómo se ve: el estilo general (Kodu tiene estos: ${ESTILOS_KODU.join('; ')}), colores que tienen que aparecer, botones grandes, todo en una pantalla o en varias, con o sin sonido, animaciones;
   - dónde se usa: proyector, tablet o celular, y si hace falta letra grande o algo pensado para algún alumno en particular.
4. **El pedido.** Cuando la ficha tenga lo esencial (tema, para quién, qué tienen que lograr, la herramienta, qué hacen los alumnos, pasos, qué pasa al acertar y al equivocarse, cómo se ve y dónde se usa) y el docente haya confirmado tu resumen, armá el pedido. Si el docente te pide terminar antes ("ya está", "armalo"), decile en una oración qué quedó sin definir y que Kodu lo va a resolver con buen criterio, y armalo igual. Con el pedido ya armado, seguí disponible: si pide cambios, actualizalo entero.

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
{"preguntas":[{"texto":"¿Con qué grado lo vas a usar?","opciones":["4.º grado","5.º grado","6.º grado"],"multiple":false}],"ficha":{"tema":"Fracciones equivalentes"},"ideas":[],"titulo":null,"descripcion":null,"pedido":null}
${ETIQUETA_CIERRE}
- "preguntas": de 1 a 3. "multiple": true sólo si tiene sentido elegir varias respuestas a la vez.
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
    content:
      '¡Buenísimo! Vamos a pensar juntos una herramienta para tu clase. Yo te voy a ir preguntando: contestá como te salga, tocando una respuesta o escribiendo. Para arrancar, contame un poco de lo que vas a dar.',
    questions: [
      { texto: '¿Qué tema vas a dar?', opciones: [], multiple: false },
      {
        texto: '¿Con qué grado o año?',
        opciones: ['Nivel inicial', '1.º a 3.º grado', '4.º a 7.º grado', 'Secundaria, primeros años', 'Secundaria, últimos años'],
        multiple: false,
      },
      {
        texto: '¿Qué es lo que más les cuesta de ese tema?',
        opciones: ['Entender la idea de fondo', 'Imaginarlo, porque no se ve', 'Recordar datos o pasos', 'Todavía no lo sé'],
        multiple: false,
      },
    ],
  },
  IDEA: {
    content:
      '¡Genial! Contame la idea como te salga, aunque esté desordenada o a medio pensar: después la ordenamos juntos. Yo te voy a ir preguntando para entender bien lo que te imaginás.',
    questions: [
      { texto: '¿Qué te imaginás que hacen tus alumnos con la herramienta?', opciones: [], multiple: false },
      { texto: '¿Para qué tema y qué grado es?', opciones: [], multiple: false },
      {
        texto: '¿Dónde la van a usar?',
        opciones: ['En el proyector, con toda la clase', 'En compus o tablets, solos o en grupo', 'En el celular', 'Todavía no sé'],
        multiple: false,
      },
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
