/**
 * Decodificador de JSON parcial para la vista previa en vivo (T3,
 * "Progresivo"): mientras el
 * modelo todavía está escribiendo el tool call `update_resource_code`, el
 * servidor reenvía los fragmentos crudos del JSON de sus argumentos
 * (`{"html":"<!DOCTYPE ..."`) tal como llegan, sin esperar a que cierren.
 * Este módulo saca de ahí lo que ya se puede leer del valor de la clave
 * "html", para poder pintarlo apenas existe.
 *
 * Puro e isomórfico, como src/lib/ai/kit.ts: sin `window`/`document`, sin
 * estado de módulo, sin dependencias. Se llama de nuevo con el buffer
 * ACUMULADO completo en cada tanda (no incremental): así no hay estado que
 * arrastrar entre llamadas, y una tanda repetida o que llega de más no rompe
 * nada — el peor costo es volver a escanear unos pocos KB, que es barato.
 *
 * `JSON.parse` no sirve acá porque el documento todavía no cerró ni las
 * comillas ni las llaves, así que se decodifican a mano los siete escapes de
 * JSON (`\" \\ \/ \b \f \n \r \t` y `\uXXXX`) — incluidos los pares
 * subrogados que Unicode usa para los caracteres fuera del plano básico (un
 * emoji, por ejemplo: dos escapes `\uXXXX` seguidos), que pueden quedar
 * cortados justo entre dos tandas de red.
 */

/**
 * El valor decodificado de "html" hasta donde llegó `argumentosJson`, o
 * `null` si esa clave todavía no empezó (no llegó su nombre, o llegó pero
 * todavía no la comilla de apertura de su valor).
 */
export function htmlParcialDeArgumentos(argumentosJson: string): string | null {
  const inicio = inicioDelValorHtml(argumentosJson);
  if (inicio === -1) return null;
  return decodificarStringParcial(argumentosJson, inicio);
}

// ─────────────────────────────────────────────────────────────
// Ubicar dónde empieza el VALOR de "html" en el objeto de nivel superior.
// ─────────────────────────────────────────────────────────────

function saltarEspacios(s: string, desde: number): number {
  let i = desde;
  while (i < s.length && /\s/.test(s[i]!)) i++;
  return i;
}

/**
 * Índice del primer caracter DESPUÉS de la comilla de apertura del valor de
 * "html", o -1 si con lo que llegó hasta ahora no se puede saber todavía.
 *
 * No asume que "html" es la primera clave: la herramienta sólo declara esa
 * propiedad, pero nada impide que el modelo (o un proveedor con otro orden)
 * mande otras antes. Para eso hace falta poder SALTAR el valor de cada clave
 * que no es la buscada, sea del tipo JSON que sea.
 */
function inicioDelValorHtml(s: string): number {
  let i = saltarEspacios(s, 0);
  if (s[i] !== '{') return -1;
  i++;

  for (;;) {
    i = saltarEspacios(s, i);
    if (i >= s.length || s[i] === '}') return -1; // cortado, o cerró sin "html"
    if (s[i] !== '"') return -1; // JSON inválido: no hay nada rescatable

    const clave = leerStringCompleto(s, i);
    if (clave === null) return -1; // el nombre de la clave todavía no cerró

    i = saltarEspacios(s, clave.hasta);
    if (i >= s.length || s[i] !== ':') return -1;
    i = saltarEspacios(s, i + 1);
    if (i >= s.length) return -1;

    if (clave.valor === 'html') {
      return s[i] === '"' ? i + 1 : -1; // si el valor no es un string, no hay nada que decodificar
    }

    const finValor = saltarValor(s, i);
    if (finValor === -1) return -1; // el valor de esta OTRA clave está a medio llegar

    i = saltarEspacios(s, finValor);
    if (i >= s.length) return -1;
    if (s[i] === ',') {
      i++;
      continue;
    }
    return -1; // `}` sin "html" antes, o separador inesperado
  }
}

/**
 * Salta un valor JSON completo de cualquier tipo a partir de su primer
 * caracter. Devuelve el índice siguiente, o -1 si el buffer se corta antes
 * de que el valor termine.
 */
function saltarValor(s: string, desde: number): number {
  const c = s[desde];
  if (c === undefined) return -1;

  if (c === '"') {
    const leido = leerStringCompleto(s, desde);
    return leido === null ? -1 : leido.hasta;
  }

  if (c === '{' || c === '[') return saltarContenedor(s, desde, c === '{' ? '}' : ']');
  if (c === 't') return coincideLiteral(s, desde, 'true');
  if (c === 'f') return coincideLiteral(s, desde, 'false');
  if (c === 'n') return coincideLiteral(s, desde, 'null');

  if (c === '-' || (c >= '0' && c <= '9')) {
    const inicioDigitos = c === '-' ? desde + 1 : desde;
    let j = inicioDigitos;
    while (j < s.length && /[0-9.eE+-]/.test(s[j]!)) j++;
    // Sin un caracter DESPUÉS del número no se puede distinguir "el número
    // termina acá" de "todavía pueden llegar más dígitos".
    if (j >= s.length || j === inicioDigitos) return -1;
    return j;
  }

  return -1; // no es un valor JSON reconocible
}

function saltarContenedor(s: string, desde: number, cierre: '}' | ']'): number {
  let i = desde + 1;

  for (;;) {
    i = saltarEspacios(s, i);
    if (i >= s.length) return -1;
    if (s[i] === cierre) return i + 1;

    if (cierre === '}') {
      if (s[i] !== '"') return -1;
      const clave = leerStringCompleto(s, i);
      if (clave === null) return -1;
      i = saltarEspacios(s, clave.hasta);
      if (i >= s.length || s[i] !== ':') return -1;
      i = saltarEspacios(s, i + 1);
      if (i >= s.length) return -1;
    }

    const finValor = saltarValor(s, i);
    if (finValor === -1) return -1;
    i = saltarEspacios(s, finValor);

    if (i >= s.length) return -1;
    if (s[i] === ',') {
      i++;
      continue;
    }
    if (s[i] === cierre) return i + 1;
    return -1;
  }
}

function coincideLiteral(s: string, desde: number, literal: string): number {
  if (s.length - desde < literal.length) return -1; // todavía no llegaron todos los caracteres
  return s.startsWith(literal, desde) ? desde + literal.length : -1;
}

// ─────────────────────────────────────────────────────────────
// Strings de JSON: lectura completa (para claves) y parcial (para "html").
// ─────────────────────────────────────────────────────────────

interface StringLeido {
  valor: string;
  /** Índice siguiente a la comilla de cierre. */
  hasta: number;
}

/**
 * Lee un string de JSON que tiene que estar COMPLETO (con su comilla de
 * cierre adentro del buffer). Se usa para las claves: si el nombre de una
 * clave viene cortado, no hay forma de saber todavía si es "html" o no.
 */
function leerStringCompleto(s: string, desdeComillaApertura: number): StringLeido | null {
  let i = desdeComillaApertura + 1;
  let valor = '';

  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '"') return { valor, hasta: i + 1 };

    if (ch === '\\') {
      const escape = decodificarEscape(s, i);
      if (escape === null) return null; // escape a medio llegar
      valor += escape.caracter;
      i = escape.hasta;
      continue;
    }

    valor += ch;
    i++;
  }

  return null; // se acabó el buffer sin comilla de cierre
}

/**
 * Decodifica un string de JSON que puede estar A MEDIO LLEGAR: a diferencia
 * de `leerStringCompleto`, no exige la comilla de cierre — devuelve todo lo
 * que se pudo decodificar hasta donde alcanza el buffer (o hasta la comilla
 * de cierre, si ya llegó).
 */
function decodificarStringParcial(s: string, desdeContenido: number): string {
  let i = desdeContenido;
  let valor = '';

  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '"') break; // cerró: lo decodificado hasta acá es la versión final

    if (ch === '\\') {
      const escape = decodificarEscape(s, i);
      // Un escape a medio llegar (incluida una `\` sola al final del buffer)
      // se corta ACÁ: nunca se cuela un caracter a medio decodificar.
      if (escape === null) break;
      valor += escape.caracter;
      i = escape.hasta;
      continue;
    }

    valor += ch;
    i++;
  }

  return recortarSubrogadoSolitario(valor);
}

interface EscapeLeido {
  caracter: string;
  /** Índice siguiente al último caracter consumido por el escape. */
  hasta: number;
}

const ESCAPES_SIMPLES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/** `desdeBarra` apunta a la `\` que abre el escape. */
function decodificarEscape(s: string, desdeBarra: number): EscapeLeido | null {
  const marca = s[desdeBarra + 1];
  if (marca === undefined) return null; // el buffer termina justo en la barra

  const simple = ESCAPES_SIMPLES[marca];
  if (simple !== undefined) return { caracter: simple, hasta: desdeBarra + 2 };

  if (marca === 'u') {
    const desdeHex = desdeBarra + 2;
    const hex = s.slice(desdeHex, desdeHex + 4);
    if (hex.length < 4) return null; // todavía no llegaron los 4 dígitos

    if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
      // `\u` seguido de algo que no son 4 hex: JSON inválido. Se consume
      // igual para no quedar mirando para siempre el mismo caracter roto —
      // no hay nada rescatable de esa secuencia puntual.
      return { caracter: '', hasta: desdeHex + 4 };
    }

    // Un par subrogado (un caracter fuera del plano básico, como un emoji)
    // son DOS de estos escapes seguidos. Acá se decodifica cada mitad por
    // separado con `fromCharCode` (nunca `fromCodePoint`, que exige el par
    // completo): como los strings de JS ya son UTF-16, concatenar las dos
    // mitades en orden reconstruye el par automáticamente. Si a este buffer
    // sólo le llegó la primera mitad, `recortarSubrogadoSolitario` la recorta
    // al final en vez de dejarla colgando.
    return { caracter: String.fromCharCode(parseInt(hex, 16)), hasta: desdeHex + 4 };
  }

  // Escape desconocido: JSON inválido, pero se consume la barra sola y se
  // sigue en vez de tirar todo el string por una secuencia rota.
  return { caracter: '', hasta: desdeBarra + 2 };
}

/**
 * Si el texto termina en una mitad alta de un par subrogado (`\uD800`–
 * `\uDBFF`) sin su mitad baja, se la recorta: sola no representa ningún
 * caracter, y si su pareja está en camino, va a llegar completa en la
 * próxima tanda.
 */
function recortarSubrogadoSolitario(texto: string): string {
  if (texto.length === 0) return texto;
  const ultimo = texto.charCodeAt(texto.length - 1);
  return ultimo >= 0xd800 && ultimo <= 0xdbff ? texto.slice(0, -1) : texto;
}
