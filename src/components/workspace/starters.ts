/**
 * Pedidos de ejemplo del estado vacío, con las preguntas que los vuelven
 * propios del docente que los toca.
 *
 * Cada uno es de un tipo de recurso distinto (evaluar / mostrar / memorizar).
 * Lo que se pregunta es sólo lo que cambia de verdad el resultado: el tema, el
 * nivel y el tamaño. Todo lo demás —corrección inmediata, accesibilidad, que se
 * vea bien proyectado— ya lo garantiza el system prompt, así que preguntarlo
 * sería hacerle llenar un formulario al pedo.
 */

export interface CampoStarter {
  id: string;
  etiqueta: string;
  placeholder?: string;
  ayuda?: string;
  requerido?: boolean;
  multilinea?: boolean;
  opciones?: string[];
  valorInicial?: string;
}

export interface Starter {
  id: string;
  label: string;
  campos: CampoStarter[];
  armarPrompt: (datos: Record<string, string>) => string;
}

const GRADOS = [
  '1.º grado',
  '2.º grado',
  '3.º grado',
  '4.º grado',
  '5.º grado',
  '6.º grado',
  '7.º grado',
  '1.º año',
  '2.º año',
  '3.º año',
  '4.º año',
  '5.º año',
];

export const STARTERS: Starter[] = [
  {
    id: 'quiz',
    label: 'Un quiz con corrección inmediata',
    campos: [
      {
        id: 'tema',
        etiqueta: '¿Sobre qué tema?',
        placeholder: 'Ej.: fracciones equivalentes',
        requerido: true,
      },
      { id: 'grado', etiqueta: '¿Para qué grado?', opciones: GRADOS, valorInicial: '5.º grado' },
      {
        id: 'cantidad',
        etiqueta: '¿Cuántas preguntas?',
        opciones: ['5', '8', '10', '15'],
        valorInicial: '5',
      },
      {
        id: 'extra',
        etiqueta: '¿Algo más que quieras pedirle?',
        placeholder: 'Ej.: que las preguntas usen situaciones del kiosco',
        multilinea: true,
      },
    ],
    armarPrompt: (d) =>
      [
        `Un quiz de ${d.cantidad} preguntas de opción múltiple sobre ${d.tema}, para ${d.grado}.`,
        'Después de cada respuesta mostrá si estuvo bien o mal con una explicación breve, y al final el puntaje.',
        d.extra,
      ]
        .filter(Boolean)
        .join(' '),
  },
  {
    id: 'simulador',
    label: 'Un simulador para explicar en clase',
    campos: [
      {
        id: 'tema',
        etiqueta: '¿Qué querés mostrar?',
        placeholder: 'Ej.: el ciclo del agua',
        requerido: true,
      },
      { id: 'grado', etiqueta: '¿Para qué grado?', opciones: GRADOS, valorInicial: '4.º grado' },
      {
        id: 'controles',
        etiqueta: '¿Qué debería poder cambiar el alumno?',
        placeholder: 'Ej.: la temperatura y la cantidad de agua',
        ayuda: 'Lo que se toca es lo que se entiende: si no se te ocurre nada, dejalo vacío.',
        multilinea: true,
      },
    ],
    armarPrompt: (d) =>
      [
        `Un simulador interactivo de ${d.tema} para ${d.grado}, para proyectar en clase.`,
        d.controles ? `Que se pueda cambiar ${d.controles} y ver el efecto al instante.` : '',
        'Que se vea grande y claro en el proyector, y que explique qué pasa en cada etapa.',
      ]
        .filter(Boolean)
        .join(' '),
  },
  {
    id: 'tarjetas',
    label: 'Tarjetas para repasar',
    campos: [
      {
        id: 'tema',
        etiqueta: '¿De qué son las tarjetas?',
        placeholder: 'Ej.: vocabulario inglés-español',
        requerido: true,
      },
      { id: 'grado', etiqueta: '¿Para qué grado?', opciones: GRADOS, valorInicial: '1.º año' },
      {
        id: 'contenido',
        etiqueta: '¿Tenés el listado? Pegalo acá',
        placeholder: 'Ej.: house = casa, tree = árbol, book = libro…',
        ayuda: 'Si lo dejás vacío, la IA propone un listado y después lo corregís.',
        multilinea: true,
      },
    ],
    armarPrompt: (d) =>
      [
        `Tarjetas de ${d.tema} para ${d.grado}: se ve un lado, el alumno piensa y toca la tarjeta para darla vuelta.`,
        'Que se puedan barajar y marcar las que costaron para repasarlas al final.',
        d.contenido ? `Usá este contenido: ${d.contenido}` : '',
      ]
        .filter(Boolean)
        .join(' '),
  },
];
