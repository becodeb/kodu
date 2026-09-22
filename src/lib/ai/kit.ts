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
 */
const SCRIPT_ICONOS = `(function () {
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

function construirEstiloBase(tema: Tema): string {
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
  ].join('\n');
}

const BLOQUE_PREFIJO = '<!-- kodu-kit:v1:inicio tema=';
const BLOQUE_INICIO_SUFIJO = ' -->';
const BLOQUE_FIN = '<!-- kodu-kit:v1:fin -->';

function construirBloque(tema: Tema): string {
  const config = construirTailwindConfig(tema);

  const partes = [
    `${BLOQUE_PREFIJO}${tema.id}${BLOQUE_INICIO_SUFIJO}`,
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${tema.fontsUrl}">`,
    '<script src="https://cdn.tailwindcss.com"></script>',
    // JSON.stringify sin indentar: el bloque va embebido en CADA recurso
    // guardado, no hace falta que sea lindo de leer, y así pesa menos.
    `<script>tailwind.config = ${JSON.stringify(config)};</script>`,
    '<script src="https://cdn.jsdelivr.net/npm/lucide@1.47.0/dist/umd/lucide.min.js"></script>',
    `<script>${SCRIPT_ICONOS}</script>`,
    `<style>${construirEstiloBase(tema)}</style>`,
    BLOQUE_FIN,
  ];

  return partes.join('\n');
}

// Precalculado una vez por tema: son sólo 8, y así `bloqueKit` es una
// consulta directa — determinista y estable byte a byte por construcción.
const BLOQUES_POR_ID = new Map<TemaId, string>(TEMAS.map((t) => [t.id, construirBloque(t)]));

/** El bloque canónico completo de un tema, delimitado por los comentarios `kodu-kit:v1`. */
export function bloqueKit(temaId: TemaId): string {
  const bloque = BLOQUES_POR_ID.get(temaId);
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
  return esTemaId(bloque.id) && bloque.texto === bloqueKit(bloque.id);
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
