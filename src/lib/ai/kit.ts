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
 *  - `despues`/`cancelarTemporizadores` (y `cada`, de yapa) — defecto 4: un
 *    `setTimeout` para "la próxima ronda" que ya estaba pedido cuando el
 *    alumno disparó otra ronda encima, y las dos rondas se pisaban. Un solo
 *    `reiniciar()` que llama a `cancelarTemporizadores()` (regla que
 *    BASE_PROMPT agrega en T3) alcanza para limpiar todo lo pendiente.
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

  function arrastrar(el, opciones) {
    opciones = opciones || {};
    var mover = opciones.mover || function () {};
    var soltar = opciones.soltar || function () {};
    var areaFija = opciones.area || null;
    var paso = opciones.paso || 10;
    var esSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';

    el.style.touchAction = 'none';
    el.style.cursor = 'grab';
    el.style.userSelect = 'none';
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');

    var activo = false;
    var idPuntero = null;
    var anterior = null;

    function area() {
      if (areaFija) return areaFija;
      if (esSvg) return el.ownerSVGElement || (el.closest ? el.closest('svg') : null) || el.parentElement;
      return el.parentElement;
    }

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

    function alBajar(evento) {
      if (evento.button > 0 || evento.isPrimary === false) return;
      activo = true;
      idPuntero = evento.pointerId;
      anterior = coords(evento);
      el.style.cursor = 'grabbing';
      try { el.setPointerCapture(idPuntero); } catch (e) {}
    }

    function alMover(evento) {
      if (!activo || evento.pointerId !== idPuntero) return;
      var actual = coords(evento);
      var dx = actual.x - anterior.x;
      var dy = actual.y - anterior.y;
      anterior = actual;
      mover({ x: actual.x, y: actual.y, dx: dx, dy: dy, teclado: false });
    }

    function alSoltar(evento) {
      if (!activo || evento.pointerId !== idPuntero) return;
      activo = false;
      el.style.cursor = 'grab';
      soltar({ x: anterior.x, y: anterior.y, dx: 0, dy: 0, teclado: false });
    }

    function centroDeEl() {
      var caja = el.getBoundingClientRect();
      return coords({ clientX: caja.left + caja.width / 2, clientY: caja.top + caja.height / 2 });
    }

    function alTecla(evento) {
      var dx = 0, dy = 0;
      if (evento.key === 'ArrowLeft') dx = -paso;
      else if (evento.key === 'ArrowRight') dx = paso;
      else if (evento.key === 'ArrowUp') dy = -paso;
      else if (evento.key === 'ArrowDown') dy = paso;
      else return;
      if (evento.shiftKey) { dx = dx * 5; dy = dy * 5; }
      evento.preventDefault();
      // El centro ACTUAL del elemento, no un acumulador propio: así p.x/p.y
      // quedan en las mismas unidades de area que en el camino de puntero
      // (defecto de T4) y un mover() que hace setAttribute('cx', p.x) no
      // hace saltar el punto a (paso,0) en la primera flecha.
      var centro = centroDeEl();
      var p = { x: centro.x + dx, y: centro.y + dy, dx: dx, dy: dy, teclado: true };
      mover(p);
      soltar(p);
    }

    el.addEventListener('pointerdown', alBajar);
    el.addEventListener('pointermove', alMover);
    el.addEventListener('pointerup', alSoltar);
    el.addEventListener('pointercancel', alSoltar);
    el.addEventListener('lostpointercapture', alSoltar);
    el.addEventListener('keydown', alTecla);

    return function () {
      el.removeEventListener('pointerdown', alBajar);
      el.removeEventListener('pointermove', alMover);
      el.removeEventListener('pointerup', alSoltar);
      el.removeEventListener('pointercancel', alSoltar);
      el.removeEventListener('lostpointercapture', alSoltar);
      el.removeEventListener('keydown', alTecla);
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
  function cancelarTemporizadores() {
    for (var i = 0; i < temporizadores.length; i++) {
      clearTimeout(temporizadores[i]);
      clearInterval(temporizadores[i]);
    }
    temporizadores.length = 0;
  }

  window.kodu = {
    icono: icono,
    arrastrar: arrastrar,
    despues: despues,
    cada: cada,
    cancelarTemporizadores: cancelarTemporizadores
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
