/**
 * Kit de diseño de KoduEdu: temas, rampas de color y el bloque canónico que
 * el servidor inserta en cada recurso (ver odd/tasks/modo-prime.md,
 * "Decisiones de diseño" y "Apéndice A" — de ahí salen los 8 temas, las
 * fórmulas de rampa y el orden exacto del bloque).
 *
 * Módulo puro e isomórfico a propósito: lo importa tanto el servidor (para
 * plegar/aplicar el HTML guardado, T2) como el cliente en React (para pintar
 * la vista previa mientras la IA todavía está escribiendo, T3). Por eso:
 *   - nada de imports de Node ni de Prisma;
 *   - nada de efectos de tope de módulo (red, DOM, `window`/`document`,
 *     timers): sólo cálculo puro, para que evaluarlo en SSR sea seguro;
 *   - cero dependencias nuevas — la mezcla de color en OKLab está escrita a
 *     mano (`hexAOklab`/`oklabAHex`/`mezclarOklab`) siguiendo las fórmulas
 *     públicas de Björn Ottosson (https://bottosson.github.io/posts/oklab/).
 *
 * La lista de nombres válidos de íconos Lucide NO vive acá a propósito: ver
 * `lucide-nombres.ts` (es sólo del servidor, y ese Set es pesado — el
 * cliente que importa este módulo no tiene por qué cargarlo).
 */

// ─────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────

export type TemaId =
  | 'pizarron'
  | 'cuaderno'
  | 'laboratorio'
  | 'atlas'
  | 'recreo'
  | 'plano'
  | 'noche'
  | 'huerta';

export type Esquema = 'claro' | 'oscuro';

export interface TokensTema {
  fondo: string;
  superficie: string;
  tinta: string;
  suave: string;
  linea: string;
  acento: string;
  acento2: string;
  exito: string;
  error: string;
}

export interface FuenteDisplay {
  familia: string;
  peso: number;
}

export interface FuenteCuerpo {
  familia: string;
  /** Todos los pesos que en verdad se usan (el cuerpo lleva normal y negrita). */
  pesos: readonly number[];
}

export interface Tema {
  id: TemaId;
  /** Nombre para humanos (panel de admin, T5), no el id kebab-case. */
  nombre: string;
  /** Para qué materia/edad conviene, tal cual Apéndice A. */
  uso: string;
  esquema: Esquema;
  tokens: TokensTema;
  display: FuenteDisplay;
  cuerpo: FuenteCuerpo;
  /** URL de Google Fonts (css2, `display=swap`) con display + cuerpo en una sola hoja. */
  fontsUrl: string;
}

// ─────────────────────────────────────────────────────────────
// Color: hex → sRGB lineal → OKLab, mezcla, y vuelta a hex clampeado
// ─────────────────────────────────────────────────────────────

/** Un color en OKLab: L = luminosidad percibida, a/b = los dos ejes de matiz+cromaticidad. */
interface Oklab {
  L: number;
  a: number;
  b: number;
}

export function hexANumero(hex: string): readonly [number, number, number] {
  const limpio = hex.replace('#', '');
  return [
    parseInt(limpio.slice(0, 2), 16),
    parseInt(limpio.slice(2, 4), 16),
    parseInt(limpio.slice(4, 6), 16),
  ];
}

export function numeroAHex(rgb: readonly [number, number, number]): string {
  // El clamp vive acá, en el único lugar por el que pasa toda conversión de
  // vuelta a hex: mezclar en OKLab puede pisar apenas afuera de [0,255] aunque
  // las dos puntas de la mezcla estén adentro (el gamut de OKLab no es exacto
  // al de sRGB), y de acá también sale un hex prolijo para colores fuera de
  // rango si algún día se agrega un token a mano fuera de la tabla.
  const canal = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${canal(rgb[0])}${canal(rgb[1])}${canal(rgb[2])}`;
}

/**
 * sRGB → lineal con el umbral real de la curva (0.04045): es el que
 * corresponde para pasar a OKLab y mezclar colores como los percibe el ojo.
 * OJO: no es el mismo umbral que usa WCAG más abajo (ver el comentario de
 * `canalWcag`) — son dos cuentas distintas a propósito, cada una fiel a su
 * propia fórmula publicada.
 */
function canalALineal(canal255: number): number {
  const c = canal255 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linealACanal(lineal: number): number {
  const c = lineal <= 0.0031308 ? lineal * 12.92 : 1.055 * lineal ** (1 / 2.4) - 0.055;
  return c * 255;
}

/** sRGB (hex) → OKLab. Fórmulas de Björn Ottosson. */
export function hexAOklab(hex: string): Oklab {
  const [r255, g255, b255] = hexANumero(hex);
  const r = canalALineal(r255);
  const g = canalALineal(g255);
  const b = canalALineal(b255);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  // cbrt (no pow(x, 1/3)): a diferencia de pow, cbrt da la raíz cúbica real
  // también para negativos, que sí aparecen en pasos intermedios.
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

/** OKLab → sRGB (hex), clampeado (ver el comentario de `numeroAHex`). */
export function oklabAHex(color: Oklab): string {
  const { L, a, b } = color;
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLineal = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return numeroAHex([linealACanal(r), linealACanal(g), linealACanal(bLineal)]);
}

/**
 * Mezcla `hexSobre` sobre `hexBase` en espacio OKLab. `fraccion=0` da
 * `hexBase`, `fraccion=1` da `hexSobre`. Se mezcla en OKLab (no en sRGB
 * directo) porque una mezcla lineal de hex se ve más oscura/sucia a la mitad
 * del camino de lo que el ojo espera; OKLab es perceptualmente uniforme y
 * es justamente lo que hace que las rampas del Apéndice A se vean parejas.
 */
export function mezclarOklab(hexBase: string, hexSobre: string, fraccion: number): string {
  const base = hexAOklab(hexBase);
  const sobre = hexAOklab(hexSobre);
  return oklabAHex({
    L: base.L + (sobre.L - base.L) * fraccion,
    a: base.a + (sobre.a - base.a) * fraccion,
    b: base.b + (sobre.b - base.b) * fraccion,
  });
}

// ─────────────────────────────────────────────────────────────
// WCAG 2: luminancia relativa y razón de contraste
// ─────────────────────────────────────────────────────────────

/**
 * sRGB → lineal con el umbral 0.03928 que usa la fórmula de luminancia
 * relativa de WCAG 2 — a propósito DISTINTO del 0.04045 real de la curva
 * sRGB que usa `canalALineal` más arriba. Es una inconsistencia conocida del
 * propio estándar (así está publicado en la spec del W3C) y hay que
 * reproducirla tal cual para que el contraste que calculamos acá coincida
 * con cualquier checker de accesibilidad (WebAIM, Lighthouse, etc.) — si se
 * "corrige" para que use el mismo umbral que OKLab, los números dejan de
 * coincidir con lo que un auditor real reporta.
 */
function canalWcag(canal255: number): number {
  const c = canal255 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa WCAG 2 (0 = negro, 1 = blanco). */
export function luminanciaRelativa(hex: string): number {
  const [r, g, b] = hexANumero(hex);
  return 0.2126 * canalWcag(r) + 0.7152 * canalWcag(g) + 0.0722 * canalWcag(b);
}

/** Razón de contraste WCAG 2 entre dos colores: 1 (igual) a 21 (blanco/negro). */
export function contraste(hexA: string, hexB: string): number {
  const la = luminanciaRelativa(hexA);
  const lb = luminanciaRelativa(hexB);
  const claro = Math.max(la, lb);
  const oscuro = Math.min(la, lb);
  return (claro + 0.05) / (oscuro + 0.05);
}

// ─────────────────────────────────────────────────────────────
// Los 8 temas (Apéndice A)
// ─────────────────────────────────────────────────────────────

type TemaBase = Omit<Tema, 'fontsUrl'>;

const TEMAS_BASE: readonly TemaBase[] = [
  {
    id: 'pizarron',
    nombre: 'Pizarrón',
    uso: 'matemática, repaso, cálculo',
    esquema: 'oscuro',
    tokens: {
      fondo: '#1d2b25', superficie: '#24362e', tinta: '#f1efe6', suave: '#a9b8ad',
      linea: '#3a5046', acento: '#f4c95d', acento2: '#8ecae6', exito: '#9bd89a', error: '#f4978e',
    },
    display: { familia: 'Kalam', peso: 700 },
    cuerpo: { familia: 'Atkinson Hyperlegible', pesos: [400, 700] },
  },
  {
    id: 'cuaderno',
    nombre: 'Cuaderno',
    uso: 'lengua, lectura, escritura',
    esquema: 'claro',
    tokens: {
      fondo: '#fbfaf5', superficie: '#ffffff', tinta: '#1f2a44', suave: '#5b6478',
      linea: '#d9dff0', acento: '#2446c7', acento2: '#f2c230',
      // Apéndice A traía #2f8f4e (exito/superficie = 4.070, no llega a 4.5).
      // Ajustado a #258747 bajando SOLO la L en OKLab (mismo a/b hasta el
      // redondeo a hex) hasta el primer punto que cumple: contraste 4.531.
      // Ver el reporte de T1 para el detalle del ajuste.
      exito: '#258747',
      error: '#c43c32',
    },
    display: { familia: 'Andika', peso: 700 },
    cuerpo: { familia: 'Andika', pesos: [400, 700] },
  },
  {
    id: 'laboratorio',
    nombre: 'Laboratorio',
    uso: 'ciencias naturales, física, química',
    esquema: 'claro',
    tokens: {
      fondo: '#f5f7f9', superficie: '#ffffff', tinta: '#111b2b', suave: '#536175',
      linea: '#d6dde6', acento: '#c2410c', acento2: '#1d5bd8', exito: '#13865a', error: '#b42318',
    },
    display: { familia: 'IBM Plex Sans', peso: 700 },
    cuerpo: { familia: 'IBM Plex Sans', pesos: [400, 600] },
  },
  {
    id: 'atlas',
    nombre: 'Atlas',
    uso: 'geografía, historia, sociales',
    esquema: 'claro',
    tokens: {
      fondo: '#eef0e6', superficie: '#f8f9f3', tinta: '#23291f', suave: '#56604e',
      linea: '#cdd4c1', acento: '#0f7478', acento2: '#b8741a', exito: '#3a7f35', error: '#b3402c',
    },
    display: { familia: 'Alegreya', peso: 800 },
    cuerpo: { familia: 'Alegreya Sans', pesos: [400, 700] },
  },
  {
    id: 'recreo',
    nombre: 'Recreo',
    uso: 'nivel inicial, primer ciclo',
    esquema: 'claro',
    tokens: {
      fondo: '#fffdf8', superficie: '#ffffff', tinta: '#1b1d3a', suave: '#565a78',
      linea: '#e7e4ef', acento: '#1f6fe5', acento2: '#ffc233',
      // Apéndice A traía #148a4c (exito/superficie = 4.403, no llega a 4.5).
      // Ajustado a #11884b con el mismo método que en `cuaderno`: contraste 4.519.
      exito: '#11884b',
      error: '#d7263d',
    },
    display: { familia: 'Baloo 2', peso: 800 },
    cuerpo: { familia: 'Andika', pesos: [400, 700] },
  },
  {
    id: 'plano',
    nombre: 'Plano',
    uso: 'tecnología, robótica, programación, geometría',
    esquema: 'oscuro',
    tokens: {
      fondo: '#123a6b', superficie: '#17467e', tinta: '#f2f6ff', suave: '#b3c6e6',
      linea: '#3a6aa6', acento: '#7fe0d0', acento2: '#ffd166', exito: '#93e6a8', error: '#ffa093',
    },
    display: { familia: 'Barlow Condensed', peso: 700 },
    cuerpo: { familia: 'Barlow', pesos: [400, 600] },
  },
  {
    id: 'noche',
    nombre: 'Noche',
    uso: 'astronomía, espacio',
    esquema: 'oscuro',
    tokens: {
      fondo: '#0e1a33', superficie: '#172649', tinta: '#eef1fb', suave: '#a3aecb',
      linea: '#2b3b66', acento: '#ff9f6e', acento2: '#ffd76a', exito: '#82e3a5', error: '#ff8f8f',
    },
    display: { familia: 'Unbounded', peso: 700 },
    cuerpo: { familia: 'Atkinson Hyperlegible', pesos: [400, 700] },
  },
  {
    id: 'huerta',
    nombre: 'Huerta',
    uso: 'biología, ecología, alimentación',
    esquema: 'claro',
    tokens: {
      fondo: '#f6f8ef', superficie: '#ffffff', tinta: '#1f2d1b', suave: '#56664e',
      linea: '#d6dfc9', acento: '#b45309', acento2: '#3f8f3a', exito: '#2f7d4f', error: '#b3261e',
    },
    display: { familia: 'Bricolage Grotesque', peso: 700 },
    cuerpo: { familia: 'Atkinson Hyperlegible', pesos: [400, 700] },
  },
];

/**
 * URL de Google Fonts (css2) para un tema: junta display + cuerpo en UNA
 * sola hoja (un solo request), fusionando pesos cuando las dos usan la misma
 * familia (p. ej. `cuaderno`: Andika 700 de display + Andika 400/700 de
 * cuerpo → una sola entrada `Andika:wght@400;700`).
 */
function urlGoogleFonts(display: FuenteDisplay, cuerpo: FuenteCuerpo): string {
  const familias: { familia: string; pesos: number[] }[] = [
    { familia: display.familia, pesos: [display.peso] },
  ];

  if (cuerpo.familia === display.familia) {
    const pesos = new Set(familias[0].pesos);
    for (const peso of cuerpo.pesos) pesos.add(peso);
    familias[0].pesos = [...pesos].sort((x, y) => x - y);
  } else {
    familias.push({ familia: cuerpo.familia, pesos: [...cuerpo.pesos].sort((x, y) => x - y) });
  }

  const query = familias
    .map(({ familia, pesos }) => `family=${familia.replace(/ /g, '+')}:wght@${pesos.join(';')}`)
    .join('&');

  return `https://fonts.googleapis.com/css2?${query}&display=swap`;
}

/** Los 8 temas, en el mismo orden que Apéndice A y Apéndice B. */
export const TEMAS: readonly Tema[] = TEMAS_BASE.map((base) => ({
  ...base,
  fontsUrl: urlGoogleFonts(base.display, base.cuerpo),
}));

const TEMA_IDS: ReadonlySet<string> = new Set<string>(TEMAS.map((t) => t.id));

export function esTemaId(valor: string): valor is TemaId {
  return TEMA_IDS.has(valor);
}

const TEMAS_POR_ID = new Map<TemaId, Tema>(TEMAS.map((t) => [t.id, t]));

export function temaPorId(id: TemaId): Tema {
  const tema = TEMAS_POR_ID.get(id);
  if (!tema) throw new Error(`tema desconocido: ${id}`); // no debería pasar: TemaId ya lo garantiza en compilación
  return tema;
}

// ─────────────────────────────────────────────────────────────
// Rampas Tailwind (Apéndice A: "Rampas")
// ─────────────────────────────────────────────────────────────

export type Escalon = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
export type Rampa = Record<Escalon, string>;

export const ESCALONES: readonly Escalon[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** Familias neutras: mezclan `tinta` sobre `fondo`, sin token propio — las 5 comparten la misma rampa. */
export const FAMILIAS_NEUTRAS: readonly string[] = ['slate', 'gray', 'zinc', 'neutral', 'stone'];
export const FAMILIAS_ACENTO: readonly string[] = ['blue', 'indigo', 'violet', 'purple'];
export const FAMILIAS_ACENTO2: readonly string[] = [
  'sky', 'cyan', 'teal', 'yellow', 'amber', 'orange', 'pink', 'rose', 'fuchsia',
];
export const FAMILIAS_EXITO: readonly string[] = ['green', 'emerald', 'lime'];
export const FAMILIAS_ERROR: readonly string[] = ['red'];

// Fracción de `tinta` mezclada sobre `fondo`, un valor por escalón (los 11).
const FRACCION_NEUTRA: Record<Escalon, number> = {
  50: 0.04, 100: 0.08, 200: 0.14, 300: 0.24, 400: 0.4,
  500: 0.55, 600: 0.68, 700: 0.8, 800: 0.88, 900: 0.94, 950: 0.97,
};

// 50-400: fracción del TOKEN mezclada sobre `fondo`.
const FRACCION_CLARA: Record<50 | 100 | 200 | 300 | 400, number> = {
  50: 0.1, 100: 0.18, 200: 0.32, 300: 0.52, 400: 0.76,
};

// 700-950: fracción del TOKEN mezclado con `tinta` (el resto es tinta) —
// por eso BAJA al bajar el escalón: 950 es "casi tinta".
const FRACCION_OSCURA: Record<700 | 800 | 900 | 950, number> = {
  700: 0.82, 800: 0.64, 900: 0.48, 950: 0.34,
};

function rampaNeutra(tokens: TokensTema): Rampa {
  const salida = {} as Rampa;
  for (const escalon of ESCALONES) {
    salida[escalon] = mezclarOklab(tokens.fondo, tokens.tinta, FRACCION_NEUTRA[escalon]);
  }
  return salida;
}

/** 500 y 600 son el token EXACTO (sin mezclar): son los que el modelo va a usar más seguido. */
function rampaColor(tokens: TokensTema, token: string): Rampa {
  return {
    50: mezclarOklab(tokens.fondo, token, FRACCION_CLARA[50]),
    100: mezclarOklab(tokens.fondo, token, FRACCION_CLARA[100]),
    200: mezclarOklab(tokens.fondo, token, FRACCION_CLARA[200]),
    300: mezclarOklab(tokens.fondo, token, FRACCION_CLARA[300]),
    400: mezclarOklab(tokens.fondo, token, FRACCION_CLARA[400]),
    500: token,
    600: token,
    700: mezclarOklab(tokens.tinta, token, FRACCION_OSCURA[700]),
    800: mezclarOklab(tokens.tinta, token, FRACCION_OSCURA[800]),
    900: mezclarOklab(tokens.tinta, token, FRACCION_OSCURA[900]),
    950: mezclarOklab(tokens.tinta, token, FRACCION_OSCURA[950]),
  };
}

export type PaletaTailwind = Record<string, string | Rampa>;

/**
 * La paleta completa de un tema para `theme.colors` de Tailwind: los 9
 * tokens con su nombre, `white`/`black`/`transparent`/`current`/`inherit`, y
 * las 22 familias de fábrica ancladas a sus rampas (Apéndice A, "Mapeo").
 */
export function paletaDeTema(tema: Tema): PaletaTailwind {
  const neutra = rampaNeutra(tema.tokens);
  const rampaAcento = rampaColor(tema.tokens, tema.tokens.acento);
  const rampaAcento2 = rampaColor(tema.tokens, tema.tokens.acento2);
  const rampaExito = rampaColor(tema.tokens, tema.tokens.exito);
  const rampaError = rampaColor(tema.tokens, tema.tokens.error);

  const paleta: PaletaTailwind = {
    transparent: 'transparent',
    current: 'currentColor',
    inherit: 'inherit',
    white: tema.tokens.superficie,
    black: tema.tokens.tinta,
    fondo: tema.tokens.fondo,
    superficie: tema.tokens.superficie,
    tinta: tema.tokens.tinta,
    suave: tema.tokens.suave,
    linea: tema.tokens.linea,
    acento: tema.tokens.acento,
    acento2: tema.tokens.acento2,
    exito: tema.tokens.exito,
    error: tema.tokens.error,
  };

  for (const familia of FAMILIAS_NEUTRAS) paleta[familia] = neutra;
  for (const familia of FAMILIAS_ACENTO) paleta[familia] = rampaAcento;
  for (const familia of FAMILIAS_ACENTO2) paleta[familia] = rampaAcento2;
  for (const familia of FAMILIAS_EXITO) paleta[familia] = rampaExito;
  for (const familia of FAMILIAS_ERROR) paleta[familia] = rampaError;

  return paleta;
}

// ─────────────────────────────────────────────────────────────
// El bloque canónico (Apéndice A: "Bloque canónico")
// ─────────────────────────────────────────────────────────────

/** `"IBM Plex Sans"` entre comillas (lleva espacio), `Kalam` sin comillas — válido en CSS y en el array de Tailwind. */
function nombreFuenteCss(familia: string): string {
  return familia.includes(' ') ? `"${familia}"` : familia;
}

function pilaFuente(familiaPrincipal: string): string[] {
  return [nombreFuenteCss(familiaPrincipal), 'ui-sans-serif', 'system-ui', 'sans-serif'];
}

function hexARgba(hex: string, alfa: number): string {
  const [r, g, b] = hexANumero(hex);
  return `rgba(${r}, ${g}, ${b}, ${alfa})`;
}

interface ConfigTailwind {
  theme: {
    colors: PaletaTailwind;
    fontFamily: { display: string[]; body: string[]; sans: string[] };
    borderRadius: Record<string, string>;
    boxShadow: Record<string, string>;
  };
}

/**
 * `theme.colors`/`fontFamily`/`borderRadius`/`boxShadow` van DIRECTO (no en
 * `theme.extend`): las cuatro son escalas deliberadamente cerradas (Apéndice
 * A las describe como "acotado"/reemplazo completo), así que usar `extend`
 * dejaría colar valores de fábrica de Tailwind sin anclar al tema —
 * exactamente el problema que "paleta anclada" existe para evitar.
 */
function construirTailwindConfig(tema: Tema): ConfigTailwind {
  const cuerpo = pilaFuente(tema.cuerpo.familia);
  const display = pilaFuente(tema.display.familia);

  return {
    theme: {
      colors: paletaDeTema(tema),
      fontFamily: { display, body: cuerpo, sans: cuerpo },
      borderRadius: {
        none: '0px',
        sm: '4px',
        DEFAULT: '8px',
        md: '8px',
        lg: '12px',
        xl: '14px',
        '2xl': '16px',
        '3xl': '18px',
        full: '9999px',
      },
      boxShadow: {
        // Dos niveles nomás, a propósito (Apéndice A): sin `lg`/`xl`/`2xl`
        // de fábrica, para que no aparezca una sombra pesada sin teñir.
        sm: `0 1px 2px ${hexARgba(tema.tokens.tinta, 0.06)}, 0 1px 1px -1px ${hexARgba(tema.tokens.tinta, 0.04)}`,
        DEFAULT: `0 4px 10px ${hexARgba(tema.tokens.tinta, 0.1)}, 0 2px 4px -2px ${hexARgba(tema.tokens.tinta, 0.08)}`,
      },
    },
  };
}

/**
 * `lucide.createIcons()` busca CUALQUIER elemento con `data-lucide` (no sólo
 * `<i>`) y el propio Lucide arma sus `<svg>` con `data-lucide="<nombre>"`
 * (ver `replaceElement` en lucide@1.47.0/dist/umd/lucide.js): un ícono ya
 * dibujado tiene ese atributo. Si el observer reaccionara a `[data-lucide]`
 * en vez de a `i[data-lucide]`, cada `<svg>` que Lucide inserta dispararía
 * una nueva vuelta — bucle infinito. Filtrar por la etiqueta `i` (Lucide
 * nunca crea elementos `<i>`) corta la cadena ahí.
 *
 * Round 2 (`odd/tasks/arnes-robustez.md`, T5) encontró que ese filtro
 * alcanzaba para no entrar en loop, pero no para dos defectos más:
 *
 *  1. `dibujarIconos` de acá abajo llamaba a `lucide.createIcons()` A SECAS
 *     (`nameAttr` por defecto `data-lucide`), y esa llamada reemplaza
 *     CUALQUIER `[data-lucide]` bajo `root` — también los `<svg>` que YA
 *     estaban dibujados. Cualquier ícono nuevo en cualquier parte del
 *     documento disparaba una vuelta que volvía a reemplazar TODOS los
 *     íconos ya dibujados por nodos `<svg>` nuevos, dejando conectada
 *     cualquier referencia JS que el recurso guardara de un ícono anterior.
 *     Arreglo: `dibujarIconos(root)` marca cada `<i data-lucide>` pendiente
 *     con un atributo temporal propio (`data-kodu-dibujar`, mismo valor que
 *     `data-lucide`) y llama a `createIcons({ nameAttr: 'data-kodu-dibujar',
 *     root: root })` — así SÓLO toca esos `<i>` (un `<svg>` ya dibujado
 *     nunca tiene `data-kodu-dibujar`) y nunca puede volver a agarrar un
 *     ícono que ya estaba resuelto. El atributo temporal se saca de los
 *     `<svg>` resultantes apenas termina (Lucide copia todos los atributos
 *     del `<i>` original al `<svg>` nuevo, incluido éste).
 *  2. El dibujo esperaba al próximo frame (`requestAnimationFrame`): un
 *     script inline que el propio recurso pone justo después del markup del
 *     ícono (`<i data-lucide="play"></i><script>…</script>`) corría ANTES de
 *     ese frame y encontraba el `<i>` todavía sin reemplazar. Arreglo:
 *     dibuja EN EL ACTO dentro del callback del observer (sin rAF) — el
 *     callback de un `MutationObserver` corre como microtarea, y la spec de
 *     HTML hace un microtask checkpoint antes de ejecutar un `<script>`
 *     inline que sigue al markup, así que el `<svg>` ya está puesto cuando
 *     ese script corre. Se pierde el debounce entre inserciones separadas en
 *     el tiempo (antes juntaba varias en un solo frame), pero como
 *     `dibujarIconos` es barato y sólo toca lo pendiente, no hace falta.
 *
 * `dibujarIconos` se expone como global "privada" (`window.__koduDibujarIconos`,
 * fuera de `window.kodu`, la API pública) porque `SCRIPT_KODU` la necesita
 * también para `kodu.icono()` (mismo motivo: no volver a tocar un hermano ya
 * dibujado) y este script corre ANTES que `SCRIPT_KODU` en el bloque — no
 * hay forma de que `SCRIPT_KODU` la reciba salvo por una global compartida.
 */
const SCRIPT_ICONOS = `(function () {
  function dibujarIconos(root) {
    if (!window.lucide || !window.lucide.createIcons) return;
    var raiz = root || document;
    var pendientes = raiz.querySelectorAll('i[data-lucide]');
    if (!pendientes.length) return;
    for (var i = 0; i < pendientes.length; i++) {
      pendientes[i].setAttribute('data-kodu-dibujar', pendientes[i].getAttribute('data-lucide'));
    }
    try {
      lucide.createIcons({ nameAttr: 'data-kodu-dibujar', root: raiz });
    } catch (e) {}
    var dibujados = raiz.querySelectorAll('[data-kodu-dibujar]');
    for (var j = 0; j < dibujados.length; j++) dibujados[j].removeAttribute('data-kodu-dibujar');
  }
  window.__koduDibujarIconos = dibujarIconos;

  function traeIconoI(nodo) {
    if (nodo.nodeType !== 1) return false;
    if (nodo.tagName === 'I' && nodo.hasAttribute('data-lucide')) return true;
    return typeof nodo.querySelector === 'function' && !!nodo.querySelector('i[data-lucide]');
  }
  new MutationObserver(function (mutaciones) {
    for (var i = 0; i < mutaciones.length; i++) {
      var agregados = mutaciones[i].addedNodes;
      for (var j = 0; j < agregados.length; j++) {
        if (traeIconoI(agregados[j])) {
          // Sync, sin rAF: ver el punto 2 del comentario de arriba.
          dibujarIconos(document);
          return;
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { dibujarIconos(document); });
  } else {
    dibujarIconos(document);
  }
})();`;

/**
 * Texto EXACTO de `SCRIPT_ICONOS` previo a T5 de `arnes-robustez` (con el
 * debounce por `requestAnimationFrame`), preservado sólo para
 * `construirBloque(tema, { legado: true })` — igual que `BLOQUES_LEGADO_POR_ID`
 * más abajo, para que el bloque legado siga siendo byte a byte el mismo.
 */
const SCRIPT_ICONOS_LEGADO = `(function () {
  var dibujoPendiente = false;
  function dibujarIconos() {
    dibujoPendiente = false;
    lucide.createIcons();
  }
  function pedirDibujo() {
    if (dibujoPendiente) return;
    dibujoPendiente = true;
    requestAnimationFrame(dibujarIconos);
  }
  function traeIconoI(nodo) {
    if (nodo.nodeType !== 1) return false;
    if (nodo.tagName === 'I' && nodo.hasAttribute('data-lucide')) return true;
    return typeof nodo.querySelector === 'function' && !!nodo.querySelector('i[data-lucide]');
  }
  new MutationObserver(function (mutaciones) {
    for (var i = 0; i < mutaciones.length; i++) {
      var agregados = mutaciones[i].addedNodes;
      for (var j = 0; j < agregados.length; j++) {
        if (traeIconoI(agregados[j])) {
          pedirDibujo();
          return;
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { lucide.createIcons(); });
  } else {
    lucide.createIcons();
  }
})();`;

/**
 * Centinela + autoprueba (round 3, T11 de `arnes-robustez`). El editor NO
 * puede tocar el DOM del iframe donde corre el recurso generado (sandbox
 * `allow-scripts` SIN `allow-same-origin`, a propósito, para que el HTML
 * generado no pueda leer nada del resto de la app) — así que cualquier
 * chequeo automático tiene que correr DENTRO del propio recurso y contarle
 * al padre por `postMessage` lo que encontró. T12 (no esta tarea) usa esto
 * para pedir una autoprueba después de cada generación y, si algo falló,
 * armar un turno de corrección con el detalle exacto.
 *
 * Es el PRIMER script de TODO el bloque (antes que los `<script src>` de
 * Tailwind/Lucide y que cualquier contenido del propio recurso):
 * `aplicarKit` inserta el bloque completo justo después de `<head>` (o del
 * meta `kodu-tema`, si el modelo lo puso ahí), y SIEMPRE antes que el resto
 * del `<head>`/`<body>` que escribió el recurso — ver `construirBloque` más
 * abajo. Así un error que tira el propio `<script src>` de Tailwind/Lucide
 * cargando, o el script del recurso arrancando, queda registrado igual.
 *
 * Los temporizadores nativos se capturan en la primera línea, antes de que
 * CUALQUIER otro script (el del recurso incluido) tenga oportunidad de
 * pisar `window.setTimeout`/`clearTimeout` — la autoprueba usa sólo estas
 * referencias para sus propias esperas, así que `kodu.cancelarTemporizadores()`
 * (que sólo barre lo agendado con `kodu.despues`/`kodu.cada`, una lista
 * completamente distinta en `SCRIPT_KODU`) nunca puede cortarla a mitad de
 * camino, ni siquiera si el recurso bajo prueba llama a `reiniciar()` (que
 * BASE_PROMPT le pide llamar a `cancelarTemporizadores()`) durante la propia
 * autoprueba.
 *
 * Escrito con `Promise`/`.then()` (no sólo ES5 a mano como el resto del
 * archivo): esto NO es código que el modelo tenga que imitar ni que viaje
 * como ejemplo en el prompt, y encadenar pasos asíncronos (cargar, esperar,
 * mover, click, click, esperar, reiniciar, esperar, comparar) a mano con
 * callbacks anidados sería bastante menos legible sin ninguna ganancia real
 * de compatibilidad — `Promise` es soporte universal en cualquier Chromium
 * moderno.
 */
const SCRIPT_CENTINELA = `(function () {
  var setTimeoutNativo = window.setTimeout;

  // Alert/confirm/prompt bloqueantes no deberían aparecer nunca en un
  // recurso (y en un iframe sandbox sin allow-modals el navegador ya los
  // resuelve solo, sin bloquear), pero un no-op propio es una segunda red
  // de seguridad barata para que la autoprueba nunca quede colgada
  // esperando una interacción humana que no puede llegar.
  try {
    window.alert = function () {};
    window.confirm = function () { return false; };
    window.prompt = function () { return null; };
  } catch (e) {}

  function truncar(texto, n) {
    texto = String(texto == null ? '' : texto);
    return texto.length > n ? texto.slice(0, n) + '…' : texto;
  }

  // ── Centinela: onerror / unhandledrejection / console.error ──────────
  var accionActual = 'al cargar';
  var errores = [];
  var REENVIOS_MAXIMOS = 20;
  var reenviados = 0;

  function registrar(tipo, mensaje, linea, columna) {
    var entrada = {
      tipo: tipo,
      mensaje: truncar(mensaje, 300),
      linea: typeof linea === 'number' ? linea : null,
      columna: typeof columna === 'number' ? columna : null,
      accion: accionActual
    };
    errores.push(entrada);
    if (reenviados >= REENVIOS_MAXIMOS) return;
    if (window.parent === window) return;
    reenviados++;
    try {
      window.parent.postMessage({
        kodu: 'error', tipo: entrada.tipo, mensaje: entrada.mensaje,
        linea: entrada.linea, columna: entrada.columna, accion: entrada.accion
      }, '*');
    } catch (e) {}
  }

  // Sin capture: un listener de 'error' en window sin fase de captura SÓLO
  // recibe errores de ejecución de verdad (ErrorEvent con message/lineno/
  // colno), nunca el evento 'error' de un recurso que no cargó (script/img/
  // link) — ésos no burbujean, y sólo llegarían a window en captura. Así el
  // ruido de un CDN caído (Tailwind, Lucide, Google Fonts, canvas-confetti,
  // o una imagen rota del propio recurso) queda afuera solo, sin tener que
  // filtrar dominios a mano.
  window.addEventListener('error', function (evento) {
    try {
      var mensaje = evento.message || (evento.error && evento.error.message) || 'Error';
      registrar('error', mensaje, evento.lineno, evento.colno);
    } catch (e) {}
  });

  window.addEventListener('unhandledrejection', function (evento) {
    try {
      var razon = evento.reason;
      var mensaje = razon && razon.message ? razon.message : String(razon);
      registrar('promesa', mensaje, null, null);
    } catch (e) {}
  });

  var consoleErrorOriginal = console.error;
  console.error = function () {
    try {
      var partes = [];
      for (var i = 0; i < arguments.length; i++) {
        var arg = arguments[i];
        if (typeof arg === 'string') partes.push(arg);
        else if (arg instanceof Error) partes.push(arg.message);
        else { try { partes.push(JSON.stringify(arg)); } catch (e2) { partes.push(String(arg)); } }
      }
      registrar('consola', partes.join(' '), null, null);
    } catch (e) {}
    return consoleErrorOriginal.apply(console, arguments);
  };

  // ── Autoprueba: corre SÓLO si el padre la pide por postMessage ───────
  var RESET_RE = /reinici|empezar de nuevo|volver a empezar|jugar (de nuevo|otra vez)|play again|restart|start over/i;
  var EXITO_RE = /completaste|¡logrado|lo lograste|acertaste|¡correcto|you did it|well done/i;
  var ejecutadas = {};

  // ── T24 (round 6): bandera compartida "hay una autoprueba corriendo" ──
  // window.__koduAutoprobando es un contador (no un booleano: dos
  // autopruebas con id distinto pueden solaparse) expuesto como propiedad
  // de SÓLO LECTURA — sin setter, configurable:false — así un recurso no
  // puede pisarla ni por accidente (window.__koduAutoprobando = true es un
  // no-op silencioso) ni redefinirla. SCRIPT_KODU, que se inyecta DESPUÉS
  // de este script en el mismo documento (ver construirBloque), la lee
  // para que kodu.ocupado() devuelva false mientras esta corre: ver el
  // comentario sobre kodu.ocupado/pantalla para el motivo completo.
  var contadorAutoprueba = 0;
  try {
    Object.defineProperty(window, '__koduAutoprobando', {
      get: function () { return contadorAutoprueba > 0; },
      configurable: false
    });
  } catch (e) {}

  function esperarMs(ms) {
    return new Promise(function (resolve) { setTimeoutNativo(resolve, ms); });
  }

  function ahora() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function esVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var estilo = getComputedStyle(el);
    if (estilo.visibility === 'hidden' || estilo.display === 'none' || estilo.opacity === '0') return false;
    return true;
  }

  function textoDe(el) {
    return ((el.innerText != null ? el.innerText : el.textContent) || '').trim();
  }

  function etiquetaBoton(el) {
    var texto = textoDe(el);
    if (texto) return texto;
    var aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    var title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    return '(sin etiqueta)';
  }

  function etiquetaPorLabelFor(el) {
    if (!el.id) return null;
    var labels = document.getElementsByTagName('label');
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].htmlFor === el.id) { var t = textoDe(labels[i]); if (t) return t; }
    }
    return null;
  }

  function etiquetaControl(el, indice) {
    var aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    var porFor = etiquetaPorLabelFor(el);
    if (porFor) return porFor;
    var envolvente = el.closest ? el.closest('label') : null;
    if (envolvente) { var t = textoDe(envolvente); if (t) return t; }
    var placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();
    var name = el.getAttribute('name');
    if (name) return name;
    if (el.id) return el.id;
    return (el.tagName || 'control').toLowerCase() + ' #' + (indice + 1);
  }

  function tomarSnapshot() {
    var texto = document.body.innerText.replace(/\\d+[.,]?\\d*\\s*s\\b/g, '#s');
    var lineas = texto.split('\\n').map(function (l) { return l.trim(); }).filter(function (l) { return l !== ''; });
    var nodos = document.querySelectorAll('input,select,textarea');
    var controles = [];
    for (var i = 0; i < nodos.length; i++) {
      var el = nodos[i];
      var valor = el.type === 'checkbox' ? el.checked : el.value;
      controles.push({ etiqueta: etiquetaControl(el, i), valor: valor });
    }
    return { lineas: lineas, controles: controles };
  }

  function detectarExito() {
    var candidatos = document.querySelectorAll('body *');
    for (var i = 0; i < candidatos.length; i++) {
      var el = candidatos[i];
      if (el.children.length) continue;
      if (!EXITO_RE.test(el.textContent || '')) continue;
      if (esVisible(el)) return true;
    }
    return false;
  }

  function candidatosBoton() {
    return document.querySelectorAll("button, [role='button'], input[type='button']");
  }

  function textoBusquedaReset(el) {
    return textoDe(el) + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '');
  }

  function buscarBotonReinicio() {
    var candidatos = candidatosBoton();
    for (var i = 0; i < candidatos.length; i++) {
      var el = candidatos[i];
      if (!esVisible(el) || el.disabled) continue;
      if (RESET_RE.test(textoBusquedaReset(el))) return el;
    }
    return null;
  }

  function clicSecuencia(el) {
    try { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true })); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true })); } catch (e) {}
    try { el.click(); } catch (e) {}
  }

  function moverRangos() {
    var rangos = document.querySelectorAll('input[type=range]');
    var movidos = [];
    for (var i = 0; i < rangos.length; i++) {
      var el = rangos[i];
      if (!esVisible(el) || el.disabled) continue;
      accionActual = "al mover el control '" + etiquetaControl(el, i) + "'";
      try {
        el.value = el.max !== '' && el.max != null ? el.max : 100;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        movidos.push(etiquetaControl(el, i));
      } catch (e) {}
    }
    accionActual = 'al cargar';
    return movidos;
  }

  function clicarBotones(n) {
    var tocados = [];
    var clicados = [];
    function paso() {
      if (tocados.length >= n) return Promise.resolve(tocados);
      var candidatos = candidatosBoton();
      var elegido = null;
      for (var i = 0; i < candidatos.length; i++) {
        var el = candidatos[i];
        if (clicados.indexOf(el) !== -1) continue;
        if (!esVisible(el) || el.disabled) continue;
        if (RESET_RE.test(textoBusquedaReset(el))) continue;
        elegido = el;
        break;
      }
      if (!elegido) return Promise.resolve(tocados);
      clicados.push(elegido);
      var etiqueta = etiquetaBoton(elegido);
      accionActual = "al tocar el botón '" + etiqueta + "'";
      clicSecuencia(elegido);
      tocados.push(etiqueta);
      return esperarMs(150).then(paso);
    }
    return paso();
  }

  // Índices donde el valor difiere entre dos snapshots (mismo largo o no):
  // random content (un número al azar, opciones mezcladas) cambia SIEMPRE
  // de valor entre una carga y la siguiente, así que un índice que ya
  // cambió entre "recién cargado" y "recién reiniciado en limpio" (sin
  // ninguna interacción de por medio) es ruido, no un defecto — se excluye
  // de la comparación final pase lo que pase después.
  function indicesVolatiles(a, b) {
    var mapa = {};
    var n = Math.max(a.length, b.length);
    for (var i = 0; i < n; i++) {
      if (a[i] !== b[i]) mapa[i] = true;
    }
    return mapa;
  }

  function filtrarPorIndice(lista, volatiles) {
    var salida = [];
    for (var i = 0; i < lista.length; i++) {
      if (!volatiles[i]) salida.push(lista[i]);
    }
    return salida;
  }

  function diffConjuntos(a, b) {
    var enB = {};
    for (var i = 0; i < b.length; i++) enB[b[i]] = true;
    var enA = {};
    for (var j = 0; j < a.length; j++) enA[a[j]] = true;
    var faltan = [], sobran = [];
    for (var k = 0; k < a.length; k++) { if (!enB[a[k]] && faltan.indexOf(a[k]) === -1) faltan.push(a[k]); }
    for (var m = 0; m < b.length; m++) { if (!enA[b[m]] && sobran.indexOf(b[m]) === -1) sobran.push(b[m]); }
    return { faltan: faltan, sobran: sobran };
  }

  function capar(lista, tope) {
    return { items: lista.slice(0, tope), truncado: lista.length > tope };
  }

  // ── window.__koduPruebas (round 4, T14): checklist del docente ───────
  // El paso de checklist (T16, no esta tarea) le pide al modelo un test por
  // ítem del checklist, guardado en window.__koduPruebas. Corren DESPUÉS
  // de las verificaciones de base (después del reinicio final + diff), con
  // presupuesto propio: hasta 8 pruebas, 3s cada una, SIN contar contra el
  // tope de 20s de las verificaciones de base (ese tope sigue midiendo sólo
  // la carga + reinicio + diff, como antes de T14) — así una prueba lenta
  // nunca deja resultados de base a medio hacer, y las pruebas de base
  // nunca le roban tiempo al checklist. Peor caso total: ~20s (base) + 8×3s
  // = 44s (documentado en odd/tasks/arnes-robustez.md para que un trabajo
  // futuro suba el timeout del lado del cliente).
  var TOPE_PRUEBAS = 8;
  var TIEMPO_PRUEBA_MS = 3000;
  var TOPE_ESPERA_PRUEBA_MS = 2000;

  function crearAyudantePrueba() {
    return {
      esperar: function (ms) {
        var n = Number(ms);
        if (!isFinite(n) || n < 0) n = 0;
        if (n > TOPE_ESPERA_PRUEBA_MS) n = TOPE_ESPERA_PRUEBA_MS;
        return esperarMs(n);
      },
      clic: function (selectorOEl) {
        var el = typeof selectorOEl === 'string' ? document.querySelector(selectorOEl) : selectorOEl;
        if (!el || typeof el.click !== 'function') {
          throw new Error("t.clic: no se encontró el elemento ('" + String(selectorOEl) + "')");
        }
        el.click();
      },
      texto: function (selector) {
        var el = typeof selector === 'string' ? document.querySelector(selector) : selector;
        return el ? textoDe(el) : '';
      }
    };
  }

  function idDePrueba(entrada, indice) {
    var id = entrada && entrada.id != null ? String(entrada.id) : '';
    id = id.trim();
    if (!id) id = 'p' + (indice + 1);
    return truncar(id, 40);
  }

  function normalizarResultadoPrueba(r) {
    if (!r || typeof r !== 'object') {
      return { ok: false, detalle: truncar('la prueba no devolvió un resultado válido', 200) };
    }
    return { ok: !!r.ok, detalle: truncar(r.detalle == null ? '' : r.detalle, 200) };
  }

  function correrUnaPrueba(entrada, indice, t) {
    var id = idDePrueba(entrada, indice);
    if (!entrada || typeof entrada.prueba !== 'function') {
      return Promise.resolve({ id: id, ok: false, detalle: truncar('window.__koduPruebas: la entrada no tiene una función prueba', 200) });
    }

    var promesaPrueba = new Promise(function (resolve) {
      try {
        Promise.resolve(entrada.prueba(t)).then(
          function (r) { resolve(normalizarResultadoPrueba(r)); },
          function (err) { resolve({ ok: false, detalle: truncar('error: ' + (err && err.message ? err.message : String(err)), 200) }); }
        );
      } catch (err) {
        resolve({ ok: false, detalle: truncar('error: ' + (err && err.message ? err.message : String(err)), 200) });
      }
    });

    var promesaTimeout = new Promise(function (resolve) {
      setTimeoutNativo(function () { resolve({ agotada: true }); }, TIEMPO_PRUEBA_MS);
    });

    return Promise.race([promesaPrueba, promesaTimeout]).then(function (r) {
      var base = r && r.agotada ? { ok: false, detalle: 'la prueba tardó más de 3 s' } : r;
      return { id: id, ok: base.ok, detalle: base.detalle };
    });
  }

  function correrPruebas() {
    var lista = window.__koduPruebas;
    if (!Array.isArray(lista)) return Promise.resolve(null);
    var recortada = lista.slice(0, TOPE_PRUEBAS);
    var t = crearAyudantePrueba();
    var resultados = [];
    function paso(i) {
      if (i >= recortada.length) return Promise.resolve(resultados);
      accionActual = 'en window.__koduPruebas[' + i + ']';
      return correrUnaPrueba(recortada[i], i, t).then(function (r) {
        resultados.push(r);
        return paso(i + 1);
      });
    }
    return paso(0).then(function (r) { accionActual = 'al cargar'; return r; });
  }

  function compararSnapshots(referencia, actual, volLineas, volControles) {
    var dl = diffConjuntos(filtrarPorIndice(referencia.lineas, volLineas), filtrarPorIndice(actual.lineas, volLineas));

    var controlesDiff = [];
    var n = Math.max(referencia.controles.length, actual.controles.length);
    for (var i = 0; i < n; i++) {
      if (volControles[i]) continue;
      var antes = referencia.controles[i];
      var despues = actual.controles[i];
      var valorAntes = antes ? antes.valor : undefined;
      var valorDespues = despues ? despues.valor : undefined;
      if (valorAntes !== valorDespues) {
        controlesDiff.push({
          etiqueta: (despues && despues.etiqueta) || (antes && antes.etiqueta) || ('control #' + (i + 1)),
          antes: valorAntes === undefined ? null : valorAntes,
          despues: valorDespues === undefined ? null : valorDespues
        });
      }
    }

    var faltanCap = capar(dl.faltan, 5);
    var sobranCap = capar(dl.sobran, 5);
    var controlesCap = capar(controlesDiff, 5);

    return {
      igual: dl.faltan.length === 0 && dl.sobran.length === 0 && controlesDiff.length === 0,
      diferencias: {
        textoQueFalta: faltanCap.items,
        textoQueSobra: sobranCap.items,
        controles: controlesCap.items,
        truncado: { textoQueFalta: faltanCap.truncado, textoQueSobra: sobranCap.truncado, controles: controlesCap.truncado }
      }
    };
  }

  function finAutoprueba() {
    if (contadorAutoprueba > 0) contadorAutoprueba--;
  }

  function ejecutarAutoprueba(id, numBotones) {
    contadorAutoprueba++;
    var inicio = ahora();
    var incompleta = false;
    function tiempoAgotado() { return ahora() - inicio > 20000; }

    function esperarCarga() {
      if (document.readyState === 'complete') return Promise.resolve();
      return new Promise(function (resolve) {
        window.addEventListener('load', function () { resolve(); }, { once: true });
      });
    }

    var snapshotInicial, exitoInicial, botonReinicioInicial, snapshotBase;
    var volLineas = {}, volControles = {};
    var rangosMovidos = [], botonesTocados = [], reinicioOk = null, detalleReinicio = 'sin boton';
    var diferencias = { textoQueFalta: [], textoQueSobra: [], controles: [], truncado: { textoQueFalta: false, textoQueSobra: false, controles: false } };
    var pruebas = null;

    return esperarCarga()
      .then(function () { return esperarMs(800); })
      .then(function () {
        accionActual = 'al cargar';
        snapshotInicial = tomarSnapshot();
        exitoInicial = detectarExito();
        botonReinicioInicial = buscarBotonReinicio();
        if (!botonReinicioInicial) { snapshotBase = snapshotInicial; return; }
        accionActual = 'al reiniciar';
        clicSecuencia(botonReinicioInicial);
        return esperarMs(1200).then(function () {
          snapshotBase = tomarSnapshot();
          volLineas = indicesVolatiles(snapshotInicial.lineas, snapshotBase.lineas);
          volControles = indicesVolatiles(
            snapshotInicial.controles.map(function (c) { return c.valor; }),
            snapshotBase.controles.map(function (c) { return c.valor; })
          );
        });
      })
      .then(function () {
        accionActual = 'al cargar';
        if (tiempoAgotado()) { incompleta = true; return; }
        rangosMovidos = moverRangos();
      })
      .then(function () {
        if (incompleta || tiempoAgotado()) { incompleta = true; return; }
        return clicarBotones(numBotones).then(function (tocados) { botonesTocados = tocados; });
      })
      .then(function () {
        accionActual = 'al cargar';
        if (incompleta) return;
        return esperarMs(1200);
      })
      .then(function () {
        if (tiempoAgotado()) incompleta = true;
        var botonFinal = buscarBotonReinicio();
        if (!botonFinal) {
          if (botonReinicioInicial) { reinicioOk = false; detalleReinicio = 'quedan restos'; }
          else { reinicioOk = null; detalleReinicio = 'sin boton'; }
          return;
        }
        accionActual = 'al reiniciar';
        clicSecuencia(botonFinal);
        return esperarMs(1200).then(function () {
          accionActual = 'al cargar';
          var snapshotFinal = tomarSnapshot();
          var comparacion = compararSnapshots(snapshotBase, snapshotFinal, volLineas, volControles);
          diferencias = comparacion.diferencias;
          reinicioOk = comparacion.igual;
          detalleReinicio = comparacion.igual ? 'vuelve al inicio' : 'quedan restos';
        });
      })
      .then(function () {
        // Presupuesto propio (no cuenta contra tiempoAgotado(), que sigue
        // midiendo sólo las verificaciones de base): hasta 8 pruebas × 3s.
        return correrPruebas().then(function (r) { pruebas = r; });
      })
      .then(function () {
        // T24: se libera ANTES de postear el resultado — cualquier reacción
        // sincrónica al postMessage (el padre podría, por ejemplo, disparar
        // un clic real) ya encuentra kodu.ocupado() en su estado normal.
        finAutoprueba();
        var resultado = {
          kodu: 'autoprueba:resultado',
          id: id,
          errores: errores.slice(),
          reinicioOk: reinicioOk,
          exitoVisibleAlInicio: !!exitoInicial,
          pruebas: pruebas,
          detalles: {
            botonesTocados: botonesTocados,
            rangosMovidos: rangosMovidos,
            reinicio: detalleReinicio,
            diferencias: diferencias,
            volatiles: { lineas: Object.keys(volLineas).length, controles: Object.keys(volControles).length },
            duracionMs: Math.round(ahora() - inicio),
            incompleta: incompleta
          }
        };
        try { window.parent.postMessage(resultado, '*'); } catch (e) {}
      })
      .catch(function () {
        // T24: mismo motivo que arriba — también hay que liberarla si la
        // cadena falla (cualquier error no atrapado en algún paso).
        finAutoprueba();
        try {
          window.parent.postMessage({
            kodu: 'autoprueba:resultado', id: id, errores: errores.slice(),
            reinicioOk: null, exitoVisibleAlInicio: false,
            pruebas: pruebas,
            detalles: {
              botonesTocados: botonesTocados, rangosMovidos: rangosMovidos, reinicio: 'sin boton',
              diferencias: diferencias, volatiles: { lineas: 0, controles: 0 },
              duracionMs: Math.round(ahora() - inicio), incompleta: true
            }
          }, '*');
        } catch (e2) {}
      });
  }

  window.addEventListener('message', function (evento) {
    if (evento.source !== window.parent) return;
    var datos = evento.data;
    if (!datos || datos.kodu !== 'autoprueba') return;
    var id = datos.id;
    if (id === undefined || id === null || ejecutadas[id]) return;
    ejecutadas[id] = true;
    var n = typeof datos.botones === 'number' && datos.botones > 0 ? datos.botones : 8;
    ejecutarAutoprueba(id, n);
  });
})();`;

/**
 * `window.kodu`: helpers que el modelo puede llamar desde el JS que escribe
 * (T1, `arnes-robustez`) para no reintroducir los defectos que el blind test
 * de 22 generaciones (branch `exp/razonamiento-deepseek`,
 * `experimentos/razonamiento/RESULTADOS.md`) encontró repetidos entre temas
 * y niveles de razonamiento. Un helper por defecto, cada uno resuelve lo que
 * el prompt solo no puede garantizar:
 *
 *  - `icono(el, nombre)` — defecto 1: el código buscaba `<i>` después de que
 *    `lucide.createIcons()` YA lo había reemplazado por un `<svg>` (así se
 *    congelaba, por ejemplo, la simulación de ósmosis al pausar: el botón
 *    quedaba con el ícono de "play" para siempre). `el` puede ser el propio
 *    ícono (el `<i data-lucide>` sin dibujar o el `<svg data-lucide>` que
 *    Lucide ya dibujó) o un contenedor que lo tiene adentro (un botón); si el
 *    contenedor no tiene ícono, se le agrega uno. Siempre inserta un `<i>`
 *    fresco y lo dibuja EN EL ACTO llamando a `window.__koduDibujarIconos`
 *    (la misma rutina que usa el observer de `SCRIPT_ICONOS`, ver su
 *    comentario para el detalle de round 2/T5): así una secuencia
 *    play→pause→play en el mismo tick queda siempre en el ícono correcto, Y
 *    un hermano YA dibujado en el mismo contenedor nunca se vuelve a tocar
 *    (round 2, T5: antes llamaba directo a `lucide.createIcons({root:
 *    contenedor})`, que con el `nameAttr` por defecto reemplazaba también
 *    los `<svg>` hermanos ya dibujados).
 *  - `arrastrar(el, opciones)` — el defecto que más apareció en el blind
 *    test: arrastrar con el mouse funcionaba porque el modelo probó eso, y
 *    con el dedo o el teclado no, porque nunca lo probó. Un solo camino de
 *    Pointer Events (mouse, lápiz y touch son el mismo evento) más teclado
 *    (flechas), con `soltar` disparando UNA sola vez al terminar la acción
 *    — ahí, y no a mitad de camino, es donde el modelo tiene que evaluar la
 *    consigna (defecto 3: quedaba marcada como resuelta en un estado
 *    intermedio del arrastre y nunca se desmarcaba). `p.x`/`p.y` del
 *    teclado están en las MISMAS unidades de `area` que las del puntero
 *    (T4, `arnes-robustez`): se calculan desde el centro ACTUAL de `el`
 *    (`getBoundingClientRect` pasado por `coords`), no desde un acumulador
 *    propio — si no, un `mover` que hace `setAttribute('cx', p.x)` hacía
 *    saltar el punto a `(paso, 0)` en la primera flecha en vez de moverlo
 *    `paso` unidades desde donde estaba.
 *
 *    Round 2 (T6, blind test D3 y el defecto de puntos apilados) agregó un
 *    MODO UNIDAD además del modo bajo nivel de arriba, y volvió a la propia
 *    `arrastrar()` dueña de sus entradas para que un mal uso no la rompa:
 *      - `opciones.alCambiar` (o `min`/`max`) presente activa el modo
 *        unidad: `arrastrar(el, { area, eje, min, max, paso, valor,
 *        alCambiar, alSoltar })` reporta un ESCALAR en unidades del
 *        problema (no píxeles), ya snapeado a `paso` y sin ruido de punto
 *        flotante, con teclado (flechas + Home/End) y ARIA (`role="slider"`,
 *        `aria-valuemin/max/now`) de fábrica — así un `mover` que trataba el
 *        punto como si fuera directamente el valor (`NaN`) o un `paso` en
 *        píxeles demasiado chico para mover un valor redondeado deja de ser
 *        posible.
 *      - El teclado se escucha en captura y llama a
 *        `stopImmediatePropagation()`: un `keydown` que el propio recurso
 *        agrega encima (en el mismo elemento o en `document`) ya no puede
 *        duplicar el movimiento de cada flecha.
 *      - Con arrastrables superpuestos (puntos apilados), un registro
 *        compartido entre todas las llamadas a `arrastrar()` elige, en
 *        `pointerdown`, el de centro más cercano al puntero — no el primero
 *        del DOM ni el de más arriba en el z-index.
 *      - El arrastre en curso escucha `pointermove`/`pointerup`/
 *        `pointercancel` en `window` (no en `el`) mientras está activo: si
 *        el propio `alCambiar` reemplaza `el` por un clon a mitad de
 *        arrastre, el arrastre sigue entregando eventos a los MISMOS
 *        callbacks hasta soltar en vez de cortarse.
 *      - El modo bajo nivel (`mover`/`soltar` con `p.x`/`p.y` libres en 2D)
 *        sigue igual, más una red de seguridad: `p` tiene un `valueOf` que
 *        devuelve `p.x`, así un `mover: function (x) { ... }` que trata todo
 *        el punto como si fuera un número igual obtiene la coordenada `x`
 *        en cualquier cuenta aritmética.
 *
 *    Round 3 (T9, blind test: el valor cambiaba pero el punto se quedaba
 *    quieto) hizo que el modo unidad MUEVA el propio `el` — no sólo reporte
 *    el valor —, y agregó una zona mínima de agarre:
 *      - En cada emisión (agarrar, mover, soltar, tecla) se llama a
 *        `posicionarElemento(v)` DESPUÉS de `alCambiar`/`alSoltar`: si el
 *        recurso TAMBIÉN reposiciona `el` a mano en su callback (el patrón
 *        de antes de T9), el helper corre último y su posición manda —
 *        nunca al revés. `opciones.mover === false` desactiva esto por
 *        completo, para un recurso que dibuja el punto con su propio motor
 *        (canvas, D3).
 *      - Para SVG, un `<circle>`/`<ellipse>` recibe `cx`/`cy` directo (en
 *        unidades del `viewBox` de `area`, mismo sistema que ya usa el modo
 *        bajo nivel); cualquier otra forma recibe un `transform: translate`
 *        relativo a su centro original.
 *      - Para HTML, `left`/`top` en % de `area` (robusto a que `area`
 *        cambie de tamaño) más `transform: translateX/Y(-50%)` en el eje
 *        que se mueve, así el CENTRO del elemento —no su esquina— queda
 *        sobre el valor sin necesitar su ancho/alto.
 *      - `elegirArrastrable` gana una zona mínima de agarre de 44px (WCAG
 *        2.5.5) además del hit-test real: un arrastrable renderizado más
 *        chico en algún eje (un punto de 20px, el grosor de una barra) se
 *        puede agarrar hasta 22px del centro en ESE eje aunque el dedo caiga
 *        afuera de la forma dibujada — sin agregar ningún nodo al DOM. Sigue
 *        siendo "gana el más cercano" entre TODOS los candidatos (hit real o
 *        zona mínima), y nunca le roba el click a un control interactivo
 *        real fuera de esa zona (el handler de `pointerdown` decide por
 *        `evento.target`, no por esta selección).
 *  - `despues`/`cancelarTemporizadores` (y `cada`, de yapa) — defecto 4: un
 *    `setTimeout` para "la próxima ronda" que ya estaba pedido cuando el
 *    alumno disparó otra ronda encima, y las dos rondas se pisaban. Un solo
 *    `reiniciar()` que llama a `cancelarTemporizadores()` (regla que
 *    BASE_PROMPT agrega en T3) alcanza para limpiar todo lo pendiente.
 *  - `festejar(opciones)` (round 2, T7) — confetti al resolver, sin que el
 *    modelo tenga que pegar su propia lógica de canvas ni acordarse de
 *    cortarla. Usa `window.confetti` si ya está, si no inyecta UN solo
 *    `<script>` de canvas-confetti por CDN (versión fijada) y dispara ahí
 *    apenas carga; nunca tira si el CDN falla. `cancelarTemporizadores()`
 *    (defecto del blind test: confetti que seguía cayendo después de un
 *    reset, o que festejaba con 0 respuestas correctas) también corta los
 *    festejos — el ya animando (`confetti.reset()`) y el que todavía
 *    esperaba a que la librería terminara de cargar (contador de
 *    generación: un festejo pedido antes del cancelar nunca dispara,
 *    aunque el `<script>` recién resuelva después).
 *  - `mezclar(lista)` (round 2, T7) — Fisher-Yates sobre una COPIA (nunca
 *    toca `lista`), y si el azar da exactamente el mismo orden de entrada
 *    (longitud >= 2) fuerza un swap: la opción correcta ya no queda
 *    siempre en la misma posición del blind test.
 *
 * Escrito ES5-a-mano como `SCRIPT_ICONOS` de arriba (mismo motivo: viaja
 * embebido en TODOS los recursos guardados, no pasa por ningún bundler ni
 * transpilador — tiene que poder correr tal cual en el navegador del
 * alumno) y compacto a propósito, mismo motivo de peso.
 */
const SCRIPT_KODU = `(function () {
  if (window.kodu) return;

  var contadorSwap = 0;
  var ATRIBUTOS_PROPIOS_DE_LUCIDE = {
    'data-lucide': 1, xmlns: 1, width: 1, height: 1, viewbox: 1, fill: 1,
    stroke: 1, 'stroke-width': 1, 'stroke-linecap': 1, 'stroke-linejoin': 1,
    class: 1, 'aria-hidden': 1
  };

  function icono(el, nombre) {
    try {
      var nodoIcono = el && el.hasAttribute && el.hasAttribute('data-lucide')
        ? el
        : (el && el.querySelector ? el.querySelector('[data-lucide]') : null);
      var contenedor = nodoIcono ? nodoIcono.parentNode : el;
      if (!contenedor) return null;

      var nuevo = document.createElement('i');
      nuevo.setAttribute('data-lucide', nombre);

      if (nodoIcono) {
        var clases = [];
        for (var i = 0; i < nodoIcono.attributes.length; i++) {
          var attr = nodoIcono.attributes[i];
          if (ATRIBUTOS_PROPIOS_DE_LUCIDE[attr.name.toLowerCase()]) continue;
          nuevo.setAttribute(attr.name, attr.value);
        }
        var claseOriginal = (nodoIcono.getAttribute('class') || '').split(' ');
        for (var j = 0; j < claseOriginal.length; j++) {
          var token = claseOriginal[j];
          if (token && token !== 'lucide' && token.indexOf('lucide-') !== 0) clases.push(token);
        }
        if (clases.length) nuevo.setAttribute('class', clases.join(' '));
      }

      contadorSwap++;
      var marca = 'k' + contadorSwap;
      nuevo.setAttribute('data-kodu-swap', marca);

      if (nodoIcono) contenedor.replaceChild(nuevo, nodoIcono);
      else contenedor.appendChild(nuevo);

      // Dibuja YA a través de la MISMA rutina que usa el observer de
      // SCRIPT_ICONOS (T5, round 2 de arnes-robustez), acotada a
      // contenedor: así una llamada repetida en el mismo tick siempre ve
      // el resultado de la anterior, Y un hermano YA dibujado en el mismo
      // contenedor no se vuelve a tocar (antes llamaba directo a
      // lucide.createIcons({root: contenedor}) con el nameAttr por defecto
      // 'data-lucide', que agarraba también los <svg> hermanos ya
      // dibujados).
      if (window.__koduDibujarIconos) window.__koduDibujarIconos(contenedor);

      // Lucide reemplaza el <i> por un <svg> nuevo (otro nodo): la marca
      // viaja con él (createIcons copia los atributos del <i> original) y
      // así lo volvemos a encontrar sin asumir que "nuevo" sigue siendo el
      // nodo vivo. Si Lucide no cargó, la marca sigue en el propio <i>.
      var resultado = contenedor.querySelector('[data-kodu-swap="' + marca + '"]') || nuevo;
      resultado.removeAttribute('data-kodu-swap');
      return resultado;
    } catch (e) {
      return null;
    }
  }

  // ── kodu.arrastrar (round 2, T6) ─────────────────────────────────────
  //
  // Registro compartido de TODOS los elementos arrastrables activos (de
  // cualquier llamada a arrastrar()), para poder elegir UNO solo cuando dos
  // se superponen (round 2: con puntos apilados se movía el equivocado).
  var registroArrastre = [];

  function distanciaAlCentroCuadrado(rect, x, y) {
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var dx = cx - x;
    var dy = cy - y;
    return dx * dx + dy * dy;
  }

  var SELECTOR_CONTROL_INTERACTIVO = 'button, a[href], input, select, textarea, label, [contenteditable]';

  /**
   * getBoundingClientRect sólo, sin hit-test real, tenía dos fallas
   * (corrección post-review de T6): un button/input/link que cae
   * GEOMÉTRICAMENTE adentro del bbox de un arrastrable (pero no es
   * descendiente suyo) arrancaba un arrastre en vez de dejar pasar el click
   * — y encima setPointerCapture desviaba el pointerup, así que el click
   * del control nunca llegaba a dispararse. Y un arrastrable de bbox grande
   * (una line diagonal, un g, una barra ancha) arrancaba un arrastre con
   * sólo tocar el espacio vacío adentro de su bbox, lejos de la forma real.
   * document.elementsFromPoint es la forma correcta: hace hit-test de
   * verdad (preciso a la forma real en SVG), ya respeta pointer-events:none
   * por su cuenta, y devuelve TODA la pila de elementos en ese punto — no
   * sólo el de más arriba — así que un arrastrable debajo de una etiqueta
   * sin pointer-events:none sigue encontrándose.
   */
  function elementoFueGolpeado(el, golpeados) {
    for (var i = 0; i < golpeados.length; i++) {
      if (el === golpeados[i] || el.contains(golpeados[i])) return true;
    }
    return false;
  }

  // Round 3 (arnes-robustez, T9): 44px es el mínimo táctil recomendado
  // (WCAG 2.5.5/2.5.8); un punto dibujado más chico (un círculo de 8px de
  // radio, un handle de 20px) es difícil de agarrar con el dedo aunque el
  // hit-test de arriba sea preciso a la forma real. Esto NO agrega DOM (la
  // consigna prefería extender el hit-test existente): es una zona
  // invisible, sólo en la lógica de selección de elegirArrastrable, que
  // agranda cada EJE del rect real hasta 44px como mínimo, centrada en el
  // centro real del elemento — así un arrastrable ya grande en un eje (una
  // barra ancha, una línea) no gana un halo extra en ESE eje (seguiría
  // exigiendo el hit-test real ahí, T6 post-review), pero el eje angosto
  // (el grosor de la barra, el diámetro del punto) sí se agranda.
  var TAMANO_MINIMO_TOQUE = 44;

  function golpeaZonaMinima(rect, x, y) {
    if (rect.width >= TAMANO_MINIMO_TOQUE && rect.height >= TAMANO_MINIMO_TOQUE) return false;
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var mitadX = Math.max(rect.width, TAMANO_MINIMO_TOQUE) / 2;
    var mitadY = Math.max(rect.height, TAMANO_MINIMO_TOQUE) / 2;
    return x >= cx - mitadX && x <= cx + mitadX && y >= cy - mitadY && y <= cy + mitadY;
  }

  /**
   * Entre los arrastrables registrados, CONECTADOS y golpeados por el
   * puntero — hit-test real (ver el comentario de arriba) O, si no, dentro
   * de su zona mínima de 44px (T9, round 3) —, gana el de centro más
   * cercano al puntero — no el que aparece primero en el DOM ni el de más
   * arriba en el z-index (round 2: con puntos superpuestos, el arrastre
   * agarraba el equivocado). Empate: se prefiere el que de verdad recibió
   * el evento (evento.target cae adentro de su subárbol). La zona mínima
   * NUNCA cambia qué control interactivo gana el pointerdown (ver el
   * handler de abajo: eso se decide por evento.target real, no por esta
   * selección), así que un botón cercano a un arrastrable chico sigue
   * recibiendo su click con normalidad.
   */
  function elegirArrastrable(evento) {
    var golpeados = document.elementsFromPoint(evento.clientX, evento.clientY);
    var mejor = null;
    var mejorDist = Infinity;
    var empatados = [];
    for (var i = 0; i < registroArrastre.length; i++) {
      var entrada = registroArrastre[i];
      if (!entrada.el.isConnected) continue;
      var rect = entrada.el.getBoundingClientRect();
      var golpeado = elementoFueGolpeado(entrada.el, golpeados) || golpeaZonaMinima(rect, evento.clientX, evento.clientY);
      if (!golpeado) continue;
      var dist = distanciaAlCentroCuadrado(rect, evento.clientX, evento.clientY);
      if (dist < mejorDist) {
        mejorDist = dist;
        mejor = entrada;
        empatados = [entrada];
      } else if (dist === mejorDist) {
        empatados.push(entrada);
      }
    }
    if (empatados.length > 1) {
      for (var j = 0; j < empatados.length; j++) {
        if (empatados[j].el.contains(evento.target)) return empatados[j];
      }
    }
    return mejor;
  }

  // En document y en captura: llega ANTES que cualquier listener propio del
  // recurso (la captura va de document hacia el target) y elige un único
  // arrastrable aunque dos estén anidados o superpuestos, así un solo
  // pointerdown arranca exactamente un arrastre.
  document.addEventListener('pointerdown', function (evento) {
    if (evento.button > 0 || evento.isPrimary === false) return;

    // Si lo que de verdad se tocó es un control interactivo (botón, link,
    // input...) que no es parte de ningún arrastrable registrado, ese
    // control gana siempre: no arranca ningún arrastre y el click/foco
    // normal del control sigue su curso sin que setPointerCapture lo desvíe.
    var interactivo = evento.target && evento.target.closest
      ? evento.target.closest(SELECTOR_CONTROL_INTERACTIVO)
      : null;
    if (interactivo) {
      var dentroDeUnArrastrable = false;
      for (var k = 0; k < registroArrastre.length; k++) {
        if (registroArrastre[k].el.isConnected && registroArrastre[k].el.contains(interactivo)) {
          dentroDeUnArrastrable = true;
          break;
        }
      }
      if (!dentroDeUnArrastrable) return;
    }

    var candidato = elegirArrastrable(evento);
    if (candidato) candidato.iniciar(evento);
  }, true);

  function decimalesDe(numero) {
    var texto = String(numero);
    var punto = texto.indexOf('.');
    return punto === -1 ? 0 : texto.length - punto - 1;
  }

  function redondearA(valor, decimales) {
    var factor = Math.pow(10, decimales);
    return Math.round(valor * factor) / factor;
  }

  /**
   * Red de seguridad (round 2, T6, blind test D3): un recurso que usa mal la
   * firma y trata el punto entero como si fuera un número
   * (mover: function (x) { moverPunto(g, d, x) }, donde x en realidad es
   * el objeto p) igual obtiene p.x en cualquier contexto numérico
   * (aritmética, comparación) gracias a este valueOf.
   */
  function crearPuntoDrag(x, y, dx, dy, teclado) {
    return {
      x: x, y: y, dx: dx, dy: dy, teclado: teclado,
      valueOf: function () { return this.x; }
    };
  }

  function arrastrar(el, opciones) {
    opciones = opciones || {};
    var esSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
    // Modo unidad: opciones.alCambiar (o min/max) presente. Ver el
    // comentario grande de arriba de window.kodu para el resumen.
    var modoUnidad = typeof opciones.alCambiar === 'function' || opciones.min != null || opciones.max != null;

    el.style.touchAction = 'none';
    el.style.cursor = 'grab';
    el.style.userSelect = 'none';
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');

    var areaFija = opciones.area || null;
    function area() {
      if (areaFija) return areaFija;
      if (esSvg) return el.ownerSVGElement || (el.closest ? el.closest('svg') : null) || el.parentElement;
      return el.parentElement;
    }

    var activo = false;
    var idPuntero = null;

    // ── Modo bajo nivel: arrastre libre en 2D, p.x/p.y en coordenadas de
    // area (unidades de usuario del SVG si area tiene viewBox, vía
    // getScreenCTM — T4). Sin cambios de comportamiento en round 2.
    var mover = opciones.mover || function () {};
    var soltar = opciones.soltar || function () {};
    var pasoBajoNivel = opciones.paso || 10;
    var anterior = null;

    function coords(evento) {
      var a = area();
      if (a && a.createSVGPoint) {
        var ctm = a.getScreenCTM();
        if (ctm) {
          var punto = a.createSVGPoint();
          punto.x = evento.clientX;
          punto.y = evento.clientY;
          var local = punto.matrixTransform(ctm.inverse());
          return { x: local.x, y: local.y };
        }
      }
      var caja = (a || document.body).getBoundingClientRect();
      return { x: evento.clientX - caja.left, y: evento.clientY - caja.top };
    }

    function centroDeEl() {
      var caja = el.getBoundingClientRect();
      return coords({ clientX: caja.left + caja.width / 2, clientY: caja.top + caja.height / 2 });
    }

    // ── Modo unidad: valores de problema (no píxeles) sobre un eje de
    // area, en coordenadas de CLIENTE puras (getBoundingClientRect, robusto
    // a viewBox/escala CSS — a diferencia del modo bajo nivel, acá no hace
    // falta el CTM del SVG porque el resultado es un escalar, no un punto).
    var eje = opciones.eje === 'y' ? 'y' : 'x';
    var minU = typeof opciones.min === 'number' ? opciones.min : 0;
    var maxU = typeof opciones.max === 'number' ? opciones.max : 100;
    var pasoU = typeof opciones.paso === 'number' && opciones.paso > 0 ? opciones.paso : 1;
    var decimalesU = decimalesDe(pasoU);
    var obtenerValor = typeof opciones.valor === 'function' ? opciones.valor : null;
    var cbAlCambiar = typeof opciones.alCambiar === 'function' ? opciones.alCambiar : function () {};
    var cbAlSoltarU = typeof opciones.alSoltar === 'function' ? opciones.alSoltar : function () {};
    var ultimoValorEmitido = minU;
    var rectAreaInicial = null;
    var clientInicial = { x: 0, y: 0 };
    var valorInicialDrag = minU;

    function ajustarUnidad(v) {
      var pasosDesdeMin = Math.round((v - minU) / pasoU);
      var ajustado = minU + pasosDesdeMin * pasoU;
      if (ajustado < minU) ajustado = minU;
      if (ajustado > maxU) ajustado = maxU;
      return redondearA(ajustado, decimalesU);
    }

    function actualizarAria(v) {
      el.setAttribute('aria-valuenow', String(v));
    }

    function spanPixels(rect) {
      return eje === 'y' ? rect.height : rect.width;
    }

    function valorAbsolutoBajoPuntero(rect, clientX, clientY) {
      var span = spanPixels(rect);
      if (!span) return minU;
      var fraccion = eje === 'y'
        ? (rect.top + rect.height - clientY) / span
        : (clientX - rect.left) / span;
      return minU + fraccion * (maxU - minU);
    }

    // ── T9 (round 3): el modo unidad MUEVE el propio elemento ───────────
    //
    // El blind test de ronda 3 encontró recursos que actualizaban el valor
    // en alCambiar pero se olvidaban de mover el punto (defecto real, no
    // sólo hipotético). opciones.mover === false es el opt-out para un
    // recurso que dibuja el punto a mano (canvas, D3, o cualquier otra
    // librería con su propio render).
    var moverActivo = modoUnidad && opciones.mover !== false;
    // Sólo para la forma SVG genérica (sin cx/cy propio): el centro
    // ORIGINAL del elemento, capturado una única vez, en las mismas
    // unidades de area que medidasAreaLocal() — ver posicionarElemento.
    var origenTransformSvg = null;

    /**
     * Tamaño de area en su propio sistema de coordenadas: unidades de
     * usuario del viewBox para un svg con viewBox (las mismas que cx/cy),
     * o su tamaño renderizado en CSS px si no tiene viewBox — el mismo
     * fallback que usa coords() más arriba, por consistencia.
     */
    function medidasAreaLocal() {
      var a = area();
      if (esSvg && a && a.viewBox && a.viewBox.baseVal && (a.viewBox.baseVal.width || a.viewBox.baseVal.height)) {
        var vb = a.viewBox.baseVal;
        return { x0: vb.x, y0: vb.y, w: vb.width, h: vb.height };
      }
      var caja = (a || el).getBoundingClientRect();
      return { x0: 0, y0: 0, w: caja.width, h: caja.height };
    }

    // Fracción 0..1 a lo largo de eje, MISMA convención que
    // valorAbsolutoBajoPuntero: en eje:'y', min queda ABAJO (fracción 0 =
    // abajo, fracción 1 = arriba).
    function fraccionPosicion(v) {
      var rango = maxU - minU;
      var f = rango ? (v - minU) / rango : 0;
      return eje === 'y' ? (1 - f) : f;
    }

    /**
     * Mueve el propio elemento arrastrado a la posición que corresponde a
     * v dentro de area. Se llama DESPUÉS de alCambiar/alSoltar en todo
     * este archivo — a propósito: si el recurso TAMBIÉN reposiciona el
     * elemento a mano dentro de su alCambiar (compatibilidad con el patrón
     * de antes de T9), esta llamada corre ÚLTIMA y deja la posición
     * correcta pase lo que pase adentro del callback del recurso — el
     * helper manda sobre lo que haga el recurso, nunca al revés.
     */
    function posicionarElemento(v) {
      if (!moverActivo) return;
      var pos = fraccionPosicion(v);
      if (esSvg) {
        var tag = (el.tagName || '').toLowerCase();
        if (tag === 'circle' || tag === 'ellipse') {
          var m = medidasAreaLocal();
          var coordenada = eje === 'x' ? (m.x0 + pos * m.w) : (m.y0 + pos * m.h);
          el.setAttribute(eje === 'x' ? 'cx' : 'cy', String(coordenada));
          return;
        }
        // Forma SVG genérica (rect, g, path…): transform desde el centro
        // ORIGINAL del elemento (capturado la primera vez que se
        // posiciona). Pisa cualquier transform propio del elemento: si el
        // recurso necesita otro transform en el mismo nodo (por ejemplo un
        // rotate), conviene envolver el punto en un <g> aparte y arrastrar
        // ese <g>.
        if (!origenTransformSvg) origenTransformSvg = centroDeEl();
        var m2 = medidasAreaLocal();
        var destino = eje === 'x' ? (m2.x0 + pos * m2.w) : (m2.y0 + pos * m2.h);
        var delta = destino - (eje === 'x' ? origenTransformSvg.x : origenTransformSvg.y);
        el.setAttribute('transform', eje === 'x' ? ('translate(' + delta + ',0)') : ('translate(0,' + delta + ')'));
        return;
      }
      // HTML: posición en % de area (robusto a resize/responsive),
      // centrada con transform SOLO en el eje que se mueve — así no hace
      // falta conocer el tamaño propio del elemento. position:absolute
      // sólo si el autor no puso ya una posición (static es el default).
      if (getComputedStyle(el).position === 'static') el.style.position = 'absolute';
      var pct = redondearA(pos * 100, 4) + '%';
      if (eje === 'x') {
        el.style.left = pct;
        el.style.transform = 'translateX(-50%)';
      } else {
        el.style.top = pct;
        el.style.transform = 'translateY(-50%)';
      }
    }

    if (modoUnidad) {
      if (!el.hasAttribute('role')) el.setAttribute('role', 'slider');
      el.setAttribute('aria-valuemin', String(minU));
      el.setAttribute('aria-valuemax', String(maxU));
      var valorInicialAria = obtenerValor ? Number(obtenerValor()) : NaN;
      var valorInicialUnidad = ajustarUnidad(isFinite(valorInicialAria) ? valorInicialAria : minU);
      actualizarAria(valorInicialUnidad);
      posicionarElemento(valorInicialUnidad);
    }

    // ── Arranque, movimiento y fin de un arrastre por puntero. move/up/
    // cancel se escuchan en window (no en el) mientras el arrastre está
    // activo — no en el, para que sobreviva a un re-render (round 2, T6): si
    // el recurso reemplaza el elemento arrastrado a mitad de camino (por
    // ejemplo, desde el propio alCambiar), el arrastre sigue entregando
    // eventos a los MISMOS callbacks hasta soltar, sin importar si el nodo
    // original sigue conectado. setPointerCapture es sólo mejor esfuerzo:
    // no se usa lostpointercapture para terminar el arrastre (se pierde la
    // captura si el nodo se desconecta, pero eso solo no puede cortar el
    // arrastre).
    function alMoverPuntero(evento) {
      if (!activo || evento.pointerId !== idPuntero) return;
      if (modoUnidad) {
        var delta = eje === 'y' ? (clientInicial.y - evento.clientY) : (evento.clientX - clientInicial.x);
        var span = spanPixels(rectAreaInicial);
        var crudo = valorInicialDrag + (span ? (delta * (maxU - minU)) / span : 0);
        var ajustado = ajustarUnidad(crudo);
        if (ajustado !== ultimoValorEmitido) {
          ultimoValorEmitido = ajustado;
          cbAlCambiar(ajustado);
        }
        actualizarAria(ajustado);
        posicionarElemento(ajustado);
      } else {
        var actual = coords(evento);
        var dx = actual.x - anterior.x;
        var dy = actual.y - anterior.y;
        anterior = actual;
        mover(crearPuntoDrag(actual.x, actual.y, dx, dy, false));
      }
    }

    function terminarArrastre() {
      activo = false;
      el.style.cursor = 'grab';
      window.removeEventListener('pointermove', alMoverPuntero);
      window.removeEventListener('pointerup', alSoltarPuntero);
      window.removeEventListener('pointercancel', alSoltarPuntero);
      if (modoUnidad) {
        cbAlSoltarU(ultimoValorEmitido);
      } else {
        soltar(crearPuntoDrag(anterior.x, anterior.y, 0, 0, false));
      }
    }

    function alSoltarPuntero(evento) {
      if (!activo || evento.pointerId !== idPuntero) return;
      terminarArrastre();
    }

    function iniciarArrastre(evento) {
      activo = true;
      idPuntero = evento.pointerId;
      el.style.cursor = 'grabbing';
      try { el.setPointerCapture(idPuntero); } catch (e) {}
      window.addEventListener('pointermove', alMoverPuntero);
      window.addEventListener('pointerup', alSoltarPuntero);
      window.addEventListener('pointercancel', alSoltarPuntero);

      if (modoUnidad) {
        var rect = area().getBoundingClientRect();
        rectAreaInicial = rect;
        clientInicial = { x: evento.clientX, y: evento.clientY };
        // Sin salto al agarrar: v0 sale del valor ACTUAL del problema
        // (valor()), no de la posición absoluta del puntero.
        var base = obtenerValor ? Number(obtenerValor()) : NaN;
        if (!isFinite(base)) base = valorAbsolutoBajoPuntero(rect, evento.clientX, evento.clientY);
        valorInicialDrag = base;
        ultimoValorEmitido = ajustarUnidad(base);
        actualizarAria(ultimoValorEmitido);
        posicionarElemento(ultimoValorEmitido);
      } else {
        anterior = coords(evento);
      }
    }

    /**
     * arrastrar() es dueña de las flechas (y, en modo unidad, Home/End):
     * captura + stopImmediatePropagation para que un keydown propio del
     * recurso en el MISMO elemento (agregado después) o en un
     * ancestro/document en burbuja no vuelva a mover lo mismo (round 2, T6:
     * un recurso agregaba su propio keydown encima del de arrastrar y cada
     * flecha movía el punto dos veces).
     */
    function alTecla(evento) {
      if (modoUnidad) {
        var tecla = evento.key;
        if (
          tecla !== 'ArrowLeft' && tecla !== 'ArrowRight' && tecla !== 'ArrowUp' &&
          tecla !== 'ArrowDown' && tecla !== 'Home' && tecla !== 'End'
        ) return;
        evento.preventDefault();
        evento.stopImmediatePropagation();

        var base = obtenerValor ? Number(obtenerValor()) : NaN;
        if (!isFinite(base)) base = ultimoValorEmitido;
        var nuevo;
        if (tecla === 'Home') nuevo = minU;
        else if (tecla === 'End') nuevo = maxU;
        else if (tecla === 'ArrowRight' || tecla === 'ArrowUp') nuevo = base + pasoU;
        else nuevo = base - pasoU;

        var ajustado = ajustarUnidad(nuevo);
        if (ajustado !== ultimoValorEmitido) {
          ultimoValorEmitido = ajustado;
          cbAlCambiar(ajustado);
        }
        actualizarAria(ajustado);
        posicionarElemento(ajustado);
        cbAlSoltarU(ultimoValorEmitido);
      } else {
        var dx = 0, dy = 0;
        if (evento.key === 'ArrowLeft') dx = -pasoBajoNivel;
        else if (evento.key === 'ArrowRight') dx = pasoBajoNivel;
        else if (evento.key === 'ArrowUp') dy = -pasoBajoNivel;
        else if (evento.key === 'ArrowDown') dy = pasoBajoNivel;
        else return;
        if (evento.shiftKey) { dx = dx * 5; dy = dy * 5; }
        evento.preventDefault();
        evento.stopImmediatePropagation();
        // El centro ACTUAL del elemento, no un acumulador propio: así p.x/p.y
        // quedan en las mismas unidades de area que en el camino de puntero
        // (defecto de T4) y un mover() que hace setAttribute('cx', p.x) no
        // hace saltar el punto a (paso,0) en la primera flecha.
        var centro = centroDeEl();
        var p = crearPuntoDrag(centro.x + dx, centro.y + dy, dx, dy, true);
        mover(p);
        soltar(p);
      }
    }

    el.addEventListener('keydown', alTecla, true);
    var entradaRegistro = { el: el, iniciar: iniciarArrastre };
    registroArrastre.push(entradaRegistro);

    return function () {
      el.removeEventListener('keydown', alTecla, true);
      var pos = registroArrastre.indexOf(entradaRegistro);
      if (pos !== -1) registroArrastre.splice(pos, 1);
      if (activo) {
        activo = false;
        window.removeEventListener('pointermove', alMoverPuntero);
        window.removeEventListener('pointerup', alSoltarPuntero);
        window.removeEventListener('pointercancel', alSoltarPuntero);
      }
    };
  }

  var temporizadores = [];
  function quitarTemporizador(id) {
    var pos = temporizadores.indexOf(id);
    if (pos !== -1) temporizadores.splice(pos, 1);
  }
  function despues(ms, fn) {
    var id = setTimeout(function () {
      quitarTemporizador(id);
      fn();
    }, ms);
    temporizadores.push(id);
    return id;
  }
  function cada(ms, fn) {
    var id = setInterval(fn, ms);
    temporizadores.push(id);
    return id;
  }

  // ── kodu.festejar (round 2, T7) ──────────────────────────────────────
  // Generación: cancelarTemporizadores() la incrementa, y un festejo
  // pedido ANTES de eso (con la generación vieja) nunca dispara, ni
  // siquiera si la librería termina de cargar después del cancelarlo.
  var confettiGeneracion = 0;
  var confettiPendientes = [];
  var confettiScriptSolicitado = false;
  var CONFETTI_CDN = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.4/dist/confetti.browser.min.js';
  var CONFETTI_OPCIONES_BASE = { particleCount: 120, spread: 70, origin: { y: 0.6 }, disableForReducedMotion: true };

  function dispararConfetti(opciones) {
    if (!window.confetti) return;
    var finales = opciones ? assign(assign({}, CONFETTI_OPCIONES_BASE), opciones) : CONFETTI_OPCIONES_BASE;
    try { window.confetti(finales); } catch (e) {}
  }

  function assign(destino, origen) {
    for (var clave in origen) {
      if (Object.prototype.hasOwnProperty.call(origen, clave)) destino[clave] = origen[clave];
    }
    return destino;
  }

  function festejar(opciones) {
    if (window.confetti) {
      dispararConfetti(opciones);
      return;
    }
    confettiPendientes.push({ opciones: opciones, generacion: confettiGeneracion });
    if (confettiScriptSolicitado) return;
    confettiScriptSolicitado = true;
    try {
      var script = document.createElement('script');
      script.src = CONFETTI_CDN;
      script.onload = function () {
        var pendientes = confettiPendientes;
        confettiPendientes = [];
        for (var i = 0; i < pendientes.length; i++) {
          if (pendientes[i].generacion === confettiGeneracion) dispararConfetti(pendientes[i].opciones);
        }
      };
      // Si el CDN falla, no queda nada esperando un dibujo que nunca va a
      // llegar (festejar() no puede tirar ni dejar promesas colgadas).
      script.onerror = function () { confettiPendientes = []; };
      document.head.appendChild(script);
    } catch (e) {}
  }

  function cancelarTemporizadores() {
    for (var i = 0; i < temporizadores.length; i++) {
      clearTimeout(temporizadores[i]);
      clearInterval(temporizadores[i]);
    }
    temporizadores.length = 0;

    // Corta festejos: los que ya están animando (reset() de la librería) y
    // los que todavía estaban esperando a que canvas-confetti terminara de
    // cargar (la generación vieja nunca va a coincidir cuando el onload
    // finalmente los revise).
    confettiGeneracion++;
    confettiPendientes = [];
    if (window.confetti && typeof window.confetti.reset === 'function') {
      try { window.confetti.reset(); } catch (e) {}
    }
  }

  // ── kodu.mezclar (round 2, T7) ───────────────────────────────────────
  function mismoOrden(a, b) {
    if (!a || typeof a.length !== 'number' || a.length !== b.length) return false;
    for (var i = 0; i < b.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function mezclar(lista) {
    var copia;
    if (Array.isArray(lista)) {
      copia = lista.slice();
    } else {
      try { copia = Array.prototype.slice.call(lista); } catch (e) { copia = []; }
    }

    // Fisher-Yates: nunca muta lista (se trabaja siempre sobre copia).
    for (var i = copia.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copia[i];
      copia[i] = copia[j];
      copia[j] = tmp;
    }

    // Con longitud >= 2, nunca puede quedar en el mismo orden que la
    // entrada: si el azar dio exactamente eso, se fuerza un swap.
    if (copia.length >= 2 && mismoOrden(lista, copia)) {
      var otro = 1 + Math.floor(Math.random() * (copia.length - 1));
      var t = copia[0];
      copia[0] = copia[otro];
      copia[otro] = t;
    }

    return copia;
  }

  // ── kodu.pantalla / kodu.ocupado (round 4, T14) ───────────────────────
  // Round 4 del blind test: un doble click/toque cae sobre el botón de la
  // pantalla SIGUIENTE porque el navegador procesa el segundo evento antes
  // de que el recurso termine de reaccionar al primero. pantalla(nombre)
  // muestra [data-pantalla=nombre], esconde el resto, y abre una ventana
  // corta (CANDADO_MS) donde cualquier evento de interacción CONFIABLE
  // (pointerdown/mousedown/click/touchstart/keydown) se traga en fase de
  // captura sobre window — antes de que llegue a ningún listener propio del
  // recurso, incluido el pointerdown de captura de arrastrar() en document
  // (captura va de window hacia el target, así que este candado corre
  // primero). Un evento SINTÉTICO (evento.isTrusted === false, como el
  // el.click()/dispatchEvent que usan la autoprueba y window.__koduPruebas)
  // pasa siempre: el candado nunca frena un chequeo automático. No agrega
  // ningún listener a el ni toca registroArrastre/alTecla: un
  // arrastre YA EN CURSO cuando arranca el candado sigue recibiendo sus
  // propios pointermove/pointerup en window (esos dos tipos no están en la
  // lista bloqueada) hasta soltar — sólo un pointerdown NUEVO durante la
  // ventana queda afuera.
  //
  // T24 (round 6), EXCEPCIÓN a lo anterior: kodu.pantalla deja el candado
  // ARMADO igual que siempre (candadoPantallaHasta no cambia), pero la
  // función PÚBLICA kodu.ocupado() — la que un recurso consulta a mano con
  // 'if (kodu.ocupado()) return;' — devuelve false mientras una autoprueba
  // está corriendo (window.__koduAutoprobando, contador de sólo lectura
  // definido en SCRIPT_CENTINELA). Motivo: window.__koduPruebas hace
  // reiniciar() (que llama a kodu.pantalla('juego'), armando el candado)
  // y clickea de inmediato, SIN esperar los 400ms, incluso sin esperar
  // t.clic(...) o llamando al handler del recurso directo — ese clic caía
  // dentro de la ventana del candado, el propio 'if (kodu.ocupado()) return;'
  // del recurso lo descartaba, la prueba fallaba y el docente veía una
  // corrección disparada por una alarma falsa, no por un defecto real. La
  // protección de verdad contra el doble toque de un alumno es el candado de
  // eventos CONFIABLES de abajo (alEventoCandado): NO lee esta bandera —
  // usa el estado real del candado directo — así que sigue frenando esos
  // eventos exactamente igual que antes de T24, autoprueba o no.
  var CANDADO_PANTALLA_MS = 400;
  var candadoPantallaHasta = 0;

  function ahoraPantalla() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function candadoPantallaActivo() {
    return ahoraPantalla() < candadoPantallaHasta;
  }

  function ocupado() {
    if (window.__koduAutoprobando) return false;
    return candadoPantallaActivo();
  }

  function alEventoCandado(evento) {
    if (!evento.isTrusted) return;
    if (!candadoPantallaActivo()) return;
    evento.preventDefault();
    evento.stopImmediatePropagation();
  }

  var EVENTOS_CANDADO_PANTALLA = ['pointerdown', 'mousedown', 'click', 'touchstart', 'keydown'];
  for (var iEvtCandado = 0; iEvtCandado < EVENTOS_CANDADO_PANTALLA.length; iEvtCandado++) {
    window.addEventListener(EVENTOS_CANDADO_PANTALLA[iEvtCandado], alEventoCandado, true);
  }

  function pantalla(nombre) {
    var destino = document.querySelector('[data-pantalla="' + nombre + '"]');
    if (!destino) {
      console.warn("kodu.pantalla: no existe [data-pantalla='" + nombre + "']");
      return null;
    }
    var todas = document.querySelectorAll('[data-pantalla]');
    for (var i = 0; i < todas.length; i++) {
      if (todas[i] !== destino) todas[i].hidden = true;
    }
    destino.hidden = false;
    candadoPantallaHasta = ahoraPantalla() + CANDADO_PANTALLA_MS;
    return destino;
  }

  window.kodu = {
    icono: icono,
    arrastrar: arrastrar,
    despues: despues,
    cada: cada,
    cancelarTemporizadores: cancelarTemporizadores,
    festejar: festejar,
    mezclar: mezclar,
    pantalla: pantalla,
    ocupado: ocupado
  };
})();`;

/**
 * `opts.legado`: reproduce byte a byte el `<style>` ANTERIOR a T1 de
 * `arnes-robustez` (sin la regla `[hidden]`), para que
 * `construirBloque(tema, { legado: true })` reconstruya el bloque canónico
 * VIEJO — ver el comentario grande sobre `BLOQUES_LEGADO_POR_ID` más abajo.
 */
function construirEstiloBase(tema: Tema, opts?: { legado?: boolean }): string {
  const t = tema.tokens;
  const variables =
    `--fondo:${t.fondo};--superficie:${t.superficie};--tinta:${t.tinta};--suave:${t.suave};` +
    `--linea:${t.linea};--acento:${t.acento};--acento2:${t.acento2};--exito:${t.exito};--error:${t.error}`;
  const colorScheme = tema.esquema === 'oscuro' ? 'dark' : 'light';
  const cuerpo = pilaFuente(tema.cuerpo.familia).join(',');
  const display = pilaFuente(tema.display.familia).join(',');

  return [
    `:root{${variables};color-scheme:${colorScheme}}`,
    `html{font-size:clamp(16px,0.55vw + 11px,20px)}`,
    `html,body{background:var(--fondo);color:var(--tinta)}`,
    `body{font-family:${cuerpo}}`,
    `h1,h2,h3{font-family:${display};text-wrap:balance}`,
    // -0.2em es el offset clásico para que un SVG de 1.15em de alto quede
    // apoyado en la línea de base del texto y no "flotando" arriba de ella.
    `.lucide{width:1.15em;height:1.15em;vertical-align:-0.2em}`,
    `:focus-visible{outline:2px solid var(--acento);outline-offset:2px}`,
    `@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}`,
    // T1 (arnes-robustez), defecto 2 del blind test: el modelo esconde algo
    // con el atributo `hidden` (`<div hidden>`) pero también le puso una
    // clase de layout tipo `flex`/`grid`/`block` — Tailwind por CDN emite
    // esas utilidades con la MISMA especificidad que `[hidden]` de la hoja
    // por defecto del navegador, y en el CSS generado por el CDN quedan
    // DESPUÉS de esa hoja, así que ganan y el elemento se ve igual "oculto".
    // `!important` acá es la única forma de que `hidden` gane siempre,
    // sin pedirle al modelo que se acuerde de esto en cada recurso.
    ...(opts?.legado ? [] : ['[hidden]{display:none!important}']),
  ].join('\n');
}

const BLOQUE_PREFIJO = '<!-- kodu-kit:v1:inicio tema=';
const BLOQUE_INICIO_SUFIJO = ' -->';
const BLOQUE_FIN = '<!-- kodu-kit:v1:fin -->';

/**
 * `opts.legado`: reconstruye byte a byte el bloque canónico ANTERIOR a T1 de
 * `arnes-robustez` (sin `SCRIPT_KODU` ni la regla `[hidden]`), para que
 * `bloqueEsCanonico` siga reconociendo como canónico un bloque guardado con
 * el kit viejo. Ver el comentario de `BLOQUES_LEGADO_POR_ID` más abajo para
 * el motivo completo y cómo está fijado con un hash.
 */
function construirBloque(tema: Tema, opts?: { legado?: boolean }): string {
  const config = construirTailwindConfig(tema);
  const legado = opts?.legado === true;

  const partes = [
    `${BLOQUE_PREFIJO}${tema.id}${BLOQUE_INICIO_SUFIJO}`,
    // T11 (round 3): el centinela/autoprueba va PRIMERO de todo el bloque —
    // antes incluso de los <script src> de Tailwind/Lucide — para que quede
    // instalado antes que cualquier otro script del documento. Sólo en el
    // bloque actual: el legado tiene que seguir siendo byte a byte el de
    // antes de T11.
    ...(legado ? [] : [`<script>${SCRIPT_CENTINELA}</script>`]),
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${tema.fontsUrl}">`,
    '<script src="https://cdn.tailwindcss.com"></script>',
    // JSON.stringify sin indentar: el bloque va embebido en CADA recurso
    // guardado, no hace falta que sea lindo de leer, y así pesa menos.
    `<script>tailwind.config = ${JSON.stringify(config)};</script>`,
    '<script src="https://cdn.jsdelivr.net/npm/lucide@1.47.0/dist/umd/lucide.min.js"></script>',
    `<script>${legado ? SCRIPT_ICONOS_LEGADO : SCRIPT_ICONOS}</script>`,
    ...(legado ? [] : [`<script>${SCRIPT_KODU}</script>`]),
    `<style>${construirEstiloBase(tema, { legado })}</style>`,
    BLOQUE_FIN,
  ];

  return partes.join('\n');
}

// Precalculado una vez por tema: son sólo 8, y así `bloqueKit` es una
// consulta directa — determinista y estable byte a byte por construcción.
const BLOQUES_POR_ID = new Map<TemaId, string>(TEMAS.map((t) => [t.id, construirBloque(t)]));

/**
 * Bloque canónico ANTERIOR a T1 de `arnes-robustez`, uno por tema,
 * reconstruido con el MISMO `construirBloque`/`construirEstiloBase` de
 * arriba (rama `legado`) en vez de guardar 8 strings largos a mano: es
 * imposible que se desincronice byte a byte de lo que este archivo produce.
 * `bloqueEsCanonico` acepta este bloque como canónico ADEMÁS del actual para
 * que un recurso guardado con el kit viejo (`SCRIPT_KODU` no existía, y el
 * `<style>` no tenía `[hidden]{display:none!important}`) lo siga
 * reconociendo `aplicarKit`/`plegarKit` — si no, esos recursos viejos se
 * tratarían como "editados a mano" y nunca recibirían los helpers nuevos.
 *
 * Que la reconstrucción es EXACTA a lo que salía del código antes de T1 está
 * fijado por el hash de la prueba "bloqueKitLegado: pinned contra el
 * bloque canónico previo a T1" en `e2e/unidad-kit.ts` — ese hash se calculó
 * ANTES de este cambio, contra el `bloqueKit('pizarron')` del código en
 * `main` (commit 98fa485, previo a esta rama).
 */
const BLOQUES_LEGADO_POR_ID = new Map<TemaId, string>(
  TEMAS.map((t) => [t.id, construirBloque(t, { legado: true })]),
);

/** El bloque canónico completo de un tema, delimitado por los comentarios `kodu-kit:v1`. */
export function bloqueKit(temaId: TemaId): string {
  const bloque = BLOQUES_POR_ID.get(temaId);
  if (!bloque) throw new Error(`tema desconocido: ${temaId}`);
  return bloque;
}

/** El bloque canónico ANTERIOR a T1 de un tema — ver `BLOQUES_LEGADO_POR_ID`. */
export function bloqueKitLegado(temaId: TemaId): string {
  const bloque = BLOQUES_LEGADO_POR_ID.get(temaId);
  if (!bloque) throw new Error(`tema desconocido: ${temaId}`);
  return bloque;
}

// ─────────────────────────────────────────────────────────────
// Meta, aplicar y plegar
// ─────────────────────────────────────────────────────────────

/**
 * Valor de un atributo dentro del HTML crudo de una etiqueta, tolerando
 * comillas dobles, simples o ninguna. Exige un espacio (o el inicio de la
 * cadena) antes del nombre para no confundir, p. ej., `data-name` con `name`.
 */
function valorAtributo(etiquetaHtml: string, nombre: string): string | null {
  const re = new RegExp(`(?:^|\\s)${nombre}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = re.exec(etiquetaHtml);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

interface MetaEncontrado {
  id: TemaId;
  desde: number;
  hasta: number;
}

/**
 * Busca el PRIMER `<meta name="kodu-tema" content="...">`, tolerando orden
 * de atributos, comillas y mayúsculas/minúsculas (tanto del nombre de la
 * etiqueta/atributos como del valor de `content`, que se normaliza a
 * minúsculas antes de compararlo contra los 8 ids conocidos).
 */
function buscarMetaTema(html: string): MetaEncontrado | null {
  const metaRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html)) !== null) {
    const etiqueta = m[0];
    const nombre = valorAtributo(etiqueta, 'name');
    if (nombre === null || nombre.toLowerCase() !== 'kodu-tema') continue;

    const contenido = valorAtributo(etiqueta, 'content');
    if (contenido === null) return null;

    const id = contenido.trim().toLowerCase();
    if (!esTemaId(id)) return null; // el PRIMER meta manda: si su valor no es válido, no se sigue buscando otro

    return { id, desde: m.index, hasta: m.index + etiqueta.length };
  }
  return null;
}

/** El id de tema del primer `<meta name="kodu-tema">`, o `null` si no hay uno válido. */
export function temaDe(html: string): TemaId | null {
  return buscarMetaTema(html)?.id ?? null;
}

const PLACEHOLDER_PREFIJO = '<!-- kodu-kit:v1 tema=';
const PLACEHOLDER_SUFIJO =
  ': acá va el bloque estándar del kit (Tailwind, tipografías, íconos). Lo agrega el sistema; dejá este comentario tal cual. -->';

function marcadorPlegado(id: TemaId): string {
  return `${PLACEHOLDER_PREFIJO}${id}${PLACEHOLDER_SUFIJO}`;
}

interface RangoEnHtml {
  id: string;
  desde: number;
  hasta: number;
}

function buscarPlaceholder(html: string): RangoEnHtml | null {
  const desde = html.indexOf(PLACEHOLDER_PREFIJO);
  if (desde === -1) return null;
  const desdeId = desde + PLACEHOLDER_PREFIJO.length;
  const hastaSufijo = html.indexOf(PLACEHOLDER_SUFIJO, desdeId);
  if (hastaSufijo === -1) return null;
  const id = html.slice(desdeId, hastaSufijo);
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  return { id, desde, hasta: hastaSufijo + PLACEHOLDER_SUFIJO.length };
}

interface BloqueEncontrado extends RangoEnHtml {
  texto: string;
}

function buscarBloque(html: string): BloqueEncontrado | null {
  const desde = html.indexOf(BLOQUE_PREFIJO);
  if (desde === -1) return null;
  const desdeId = desde + BLOQUE_PREFIJO.length;
  const hastaId = html.indexOf(BLOQUE_INICIO_SUFIJO, desdeId);
  if (hastaId === -1) return null;
  const id = html.slice(desdeId, hastaId);
  if (!/^[a-z0-9-]+$/.test(id)) return null;

  const finDesde = html.indexOf(BLOQUE_FIN, hastaId);
  if (finDesde === -1) return null;
  const hasta = finDesde + BLOQUE_FIN.length;
  return { id, desde, hasta, texto: html.slice(desde, hasta) };
}

/** El bloque encontrado es EXACTAMENTE el canónico del tema que él mismo declara (nadie lo tocó a mano). */
function bloqueEsCanonico(bloque: BloqueEncontrado): boolean {
  if (!esTemaId(bloque.id)) return false;
  // El bloque ANTERIOR a T1 (arnes-robustez) cuenta como canónico también:
  // así aplicarKit lo actualiza al bloque actual (con los helpers nuevos) en
  // vez de tratarlo como editado a mano. Ver BLOQUES_LEGADO_POR_ID.
  return bloque.texto === bloqueKit(bloque.id) || bloque.texto === bloqueKitLegado(bloque.id);
}

/**
 * Inserta o actualiza el bloque canónico según el meta `kodu-tema` (Apéndice
 * A, "Bloque canónico" + "Plegado para el prompt"):
 *
 *  - meta válido + bloque existente BYTE-IDÉNTICO al canónico de SU PROPIO
 *    id → se reemplaza por el canónico del id del META (así se resuelve un
 *    cambio de tema: el bloque viejo desaparece, entra el nuevo);
 *  - meta válido + bloque existente que NO coincide con su propio canónico
 *    → se editó a mano: se deja tal cual;
 *  - meta válido + placeholder plegado → se expande al canónico del meta;
 *  - meta válido + ni bloque ni placeholder → se inserta el canónico justo
 *    después del meta;
 *  - sin meta válido pero con `temaPrevio` válido → se insertan meta Y
 *    bloque juntos, justo después de `<head…>` (o `<html…>`, o al principio);
 *  - en cualquier otro caso, el html vuelve sin tocar.
 *
 * Idempotente: aplicar dos veces seguidas da el mismo resultado que una vez.
 */
export function aplicarKit(html: string, opts?: { temaPrevio?: string | null }): string {
  const meta = buscarMetaTema(html);

  if (meta) {
    const bloque = buscarBloque(html);
    if (bloque) {
      if (!bloqueEsCanonico(bloque)) return html; // editado a mano: se respeta tal cual
      return html.slice(0, bloque.desde) + bloqueKit(meta.id) + html.slice(bloque.hasta);
    }

    const placeholder = buscarPlaceholder(html);
    if (placeholder) {
      return html.slice(0, placeholder.desde) + bloqueKit(meta.id) + html.slice(placeholder.hasta);
    }

    return html.slice(0, meta.hasta) + '\n' + bloqueKit(meta.id) + html.slice(meta.hasta);
  }

  if (opts?.temaPrevio != null && esTemaId(opts.temaPrevio)) {
    const id = opts.temaPrevio;
    const insertar = `<meta name="kodu-tema" content="${id}">\n${bloqueKit(id)}`;

    const headMatch = /<head[^>]*>/i.exec(html);
    if (headMatch) {
      const hasta = headMatch.index + headMatch[0].length;
      return html.slice(0, hasta) + '\n' + insertar + html.slice(hasta);
    }

    const htmlMatch = /<html[^>]*>/i.exec(html);
    if (htmlMatch) {
      const hasta = htmlMatch.index + htmlMatch[0].length;
      return html.slice(0, hasta) + '\n' + insertar + html.slice(hasta);
    }

    return insertar + '\n' + html;
  }

  return html;
}

/**
 * Pliega el bloque canónico a un comentario corto para el prompt (Apéndice
 * A, "Plegado para el prompt"). Un bloque editado a mano NO se pliega: se
 * deja tal cual, igual que en `aplicarKit`. Sin bloque, el html vuelve sin
 * tocar (plegar algo ya plegado, o sin kit, es un no-op).
 */
export function plegarKit(html: string): string {
  const bloque = buscarBloque(html);
  if (!bloque || !bloqueEsCanonico(bloque)) return html;

  // `bloqueEsCanonico` ya validó `esTemaId(bloque.id)`.
  const id = bloque.id as TemaId;
  return html.slice(0, bloque.desde) + marcadorPlegado(id) + html.slice(bloque.hasta);
}

// ─────────────────────────────────────────────────────────────
// T11: red de seguridad — tema por defecto si el modelo se olvidó del meta
// (odd/tasks/modo-prime.md, "T11 — Red de seguridad: tema por defecto")
// ─────────────────────────────────────────────────────────────

/**
 * Prefijos de variante de Tailwind (responsive: `sm/md/lg/xl/2xl`, o de
 * estado: `hover/focus/...`) que pueden anteponerse a una utilidad,
 * encadenados con `:` (p. ej. `md:hover:bg-acento`). No hace falta la lista
 * completa del framework: alcanza con las que de verdad aparecen en HTML
 * generado siguiendo el Apéndice B (no pide dark mode manual ni
 * pseudo-clases raras).
 */
const VARIANTE_TAILWIND_RE =
  '(?:sm|md|lg|xl|2xl|hover|focus|focus-visible|active|disabled|dark|group-hover|first|last|odd|even)';

/** Utilidades que SON la clase completa, sin `-valor` después. */
const UTILIDAD_TAILWIND_SOLA_RE =
  '(?:flex|inline-flex|grid|inline-grid|hidden|block|inline|inline-block|relative|absolute|fixed' +
  '|sticky|static|container|truncate|uppercase|lowercase|capitalize|italic|underline|shadow|border' +
  '|rounded|antialiased)';

/**
 * Raíces que siempre siguen con `-algo` (el Apéndice B las nombra como
 * ejemplo: "spacing, text-, bg-, flex, grid, rounded, gap-"). No es la
 * lista completa de Tailwind a propósito: cuanto más acotada, menos falsos
 * positivos con una clase propia que por casualidad empieza igual.
 */
const RAIZ_TAILWIND_CON_VALOR_RE =
  '(?:text|bg|border|rounded|ring|shadow|outline|divide|placeholder|from|via|to' +
  '|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y' +
  '|w|h|min-w|min-h|max-w|max-h|inset|top|right|bottom|left' +
  '|flex|grid-cols|grid-rows|col|row|items|justify|content|self|place' +
  '|font|leading|tracking|opacity|z|rotate|scale|translate|skew' +
  '|duration|delay|ease|cursor|overflow|object|aspect|basis|order)';

/**
 * Un token individual "parece" una utilidad de Tailwind: variantes
 * opcionales encadenadas con `:`, un `-` opcional antes de la raíz
 * (utilidades negativas, `-mt-4`), y una raíz reconocida — sola, o seguida
 * de `-` y un valor (letras, números y los símbolos que Tailwind usa en
 * valores arbitrarios: `. % _ / [ ] #`). Anclado en las dos puntas para que
 * una palabra que sólo CONTIENE una raíz (`flexible`, `bordereau`) no
 * cuente: tiene que tener la forma exacta de principio a fin.
 */
const TOKEN_TAILWIND_RE = new RegExp(
  `^(?:${VARIANTE_TAILWIND_RE}:)*-?(?:${RAIZ_TAILWIND_CON_VALOR_RE}-[a-z0-9.%_/\\[\\]#-]+|${UTILIDAD_TAILWIND_SOLA_RE})$`,
);

const ATRIBUTO_CLASE_RE = /\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
const SET_ATTRIBUTE_CLASE_RE = /\.setAttribute\(\s*['"]class(?:Name)?['"]\s*,\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
const CLASS_LIST_ADD_RE = /\bclassList\s*\.\s*add\(([^)]*)\)/g;
const TOKEN_ENTRE_COMILLAS_RE = /"([^"]*)"|'([^']*)'|`([^`]*)`/g;

/**
 * Junta todo el texto candidato a contener clases: el valor de cada
 * `class="…"`/`className="…"` (markup Y asignación en JS,
 * `elemento.className = "…"`), cada `setAttribute('class', '…')`, y cada
 * string suelto dentro de un `classList.add(…)` — frecuente en el JS que
 * arma el modelo para cambiar de estado (Apéndice B: devoluciones tipo
 * "Correcto: tres cuartos y un cuarto…" suelen ir con un cambio de clases).
 */
function extraerPoolsDeClases(html: string): string[] {
  const pools: string[] = [];

  for (const re of [ATRIBUTO_CLASE_RE, SET_ATTRIBUTE_CLASE_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) pools.push(m[1] ?? m[2] ?? m[3] ?? '');
  }

  CLASS_LIST_ADD_RE.lastIndex = 0;
  let llamada: RegExpExecArray | null;
  while ((llamada = CLASS_LIST_ADD_RE.exec(html)) !== null) {
    TOKEN_ENTRE_COMILLAS_RE.lastIndex = 0;
    let token: RegExpExecArray | null;
    while ((token = TOKEN_ENTRE_COMILLAS_RE.exec(llamada[1] ?? '')) !== null) {
      pools.push(token[1] ?? token[2] ?? token[3] ?? '');
    }
  }

  return pools;
}

/**
 * Mínimo de clases DISTINTAS con forma de utilidad de Tailwind para
 * considerar que el HTML "usa Tailwind". Bien por encima de un par de
 * falsos positivos sueltos (una clase propia que por casualidad tiene forma
 * de utilidad) y bien por debajo de lo que cualquier recurso que de verdad
 * usa el framework acumula: un solo elemento con
 * `class="flex items-center gap-4 p-6"` ya aporta 4.
 */
const MINIMO_CLASES_TAILWIND = 4;

/**
 * Detector puro de "este HTML usa clases de Tailwind" (T11): robusto (mira
 * markup y JS, con o sin prefijo de variante) pero conservador (forma
 * exacta por token, más un mínimo de coincidencias DISTINTAS para que una o
 * dos palabras sueltas con forma de clase no lo disparen).
 */
export function usaClasesDeTailwind(html: string): boolean {
  const encontradas = new Set<string>();
  for (const pool of extraerPoolsDeClases(html)) {
    for (const token of pool.split(/\s+/)) {
      if (token !== '' && TOKEN_TAILWIND_RE.test(token)) encontradas.add(token);
      if (encontradas.size >= MINIMO_CLASES_TAILWIND) return true; // ya alcanza, no hace falta seguir
    }
  }
  return false;
}

/**
 * El HTML carga su propio Tailwind por CDN (el modelo ignoró "NO pegues
 * scripts de Tailwind... el sistema agrega solo Tailwind configurado" del
 * Apéndice B): un `<script src="…cdn.tailwindcss.com…">` en cualquier parte
 * del documento. Mismo dominio que carga el propio bloque canónico
 * (`construirBloque` más arriba) — si ya aparece, el recurso tiene Tailwind
 * funcionando por su cuenta y la red de seguridad no tiene nada que arreglar.
 */
function cargaTailwindPorSuCuenta(html: string): boolean {
  const re = /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const src = (m[1] ?? m[2] ?? m[3] ?? '').toLowerCase();
    if (src.includes('cdn.tailwindcss.com')) return true;
  }
  return false;
}

/** Tema que aplica la red de seguridad: el más neutro de los 8 (Apéndice A). */
const TEMA_RED_DE_SEGURIDAD: TemaId = 'cuaderno';

/**
 * `aplicarKit` con la red de seguridad de T11 encima: si el HTML no declara
 * un `<meta name="kodu-tema">` válido, tampoco hay `temaPrevio` que lo
 * respalde, no carga Tailwind por su cuenta, Y usa clases de Tailwind →
 * aplica `cuaderno` exactamente por el mismo camino que el respaldo por
 * `temaPrevio` (meta + bloque canónico insertados después de `<head>`, o
 * `<html>`, o al principio). En cualquier otro caso el comportamiento es
 * IDÉNTICO a `aplicarKit` a secas.
 *
 * Función aparte y no una rama más de `aplicarKit` a propósito: así
 * `aplicarKit` (y las pruebas que ya existen contra ella) no cambian de
 * comportamiento para nadie que no pase por acá — el único lugar que decide
 * "cuándo corresponde el respaldo de la red de seguridad" es este.
 *
 * Se llama con el HTML tal cual salió del modelo, ANTES de cualquier otra
 * transformación: la detección de "carga su propio Tailwind" y "usa clases
 * de Tailwind" tiene que mirar el documento ORIGINAL, no uno que ya podría
 * tener el bloque canónico insertado (que por supuesto usa esos mismos
 * prefijos por su cuenta).
 *
 * Pura y barata (mismo motivo que el resto del módulo, ver el comentario de
 * arriba de todo): la usan tanto `aplicarKitAlTurno` en `stream.ts` (server,
 * antes de guardar) como `PreviewPanel.tsx` (cliente, sobre el HTML parcial
 * mientras la IA todavía escribe) — así la vista previa en vivo no muestra
 * un instante de clases de Tailwind sin estilos para después "saltar" al
 * tema por defecto recién cuando el turno termina y el servidor aplica el
 * mismo respaldo.
 */
export function aplicarKitConRedDeSeguridad(html: string, opts?: { temaPrevio?: string | null }): string {
  const yaTieneRespaldo = buscarMetaTema(html) !== null || (opts?.temaPrevio != null && esTemaId(opts.temaPrevio));
  const necesitaRedDeSeguridad =
    !yaTieneRespaldo && !cargaTailwindPorSuCuenta(html) && usaClasesDeTailwind(html);

  return aplicarKit(html, necesitaRedDeSeguridad ? { temaPrevio: TEMA_RED_DE_SEGURIDAD } : opts);
}
