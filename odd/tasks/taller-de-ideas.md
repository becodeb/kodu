# Taller de ideas

Documento vivo de la feature. Rama `feat/taller-de-ideas`, cortada de `main` en `759dd30`.

## Objetivo

Un lugar dentro de Kodu para pensar la herramienta ANTES de crearla. Un chat con la misma IA que genera los
recursos, entrenado para preguntar mucho y guiar al docente hasta un pedido final completo, que genere una primera
versión lista para usar en clase (no un borrador).

## Por qué

- Muchos docentes saben qué quieren enseñar pero no qué herramienta interactiva usar, y les cuesta explicarle a una
  IA lo que se imaginan.
- `docs/pedidos-que-funcionan.md` midió qué hace funcionar un pedido (nivel y tema, interacción central con verbos,
  objetivos numerados, metáfora visual como requisito, datos exactos, dispositivo) y dejó escrito el "modo ayudante".
  El Taller es ese modo.
- En el editor, la guía "preguntá lo que no sabés" casi nunca aparece: `pideCambio()` fuerza la herramienta ante casi
  cualquier mensaje y, con la herramienta forzada, la guía no existe. El Taller es donde se pregunta de verdad.

## Decisiones del dueño (no reabrir)

- **Nombre:** "Taller de ideas". Vive en un solo lugar: `NOMBRE_TALLER` en `src/lib/taller/prompt.ts`.
- **Dos puertas, bien explicadas:** "Tengo un tema, busco una idea" y "Ya tengo una idea". Cada una arranca con una
  primera pregunta útil, sin depender de que el docente sepa cómo hablarle a una IA.
- **La IA pregunta mucho**, siempre a alto nivel y sin nada técnico (incluye decisiones estéticas: estilo, colores,
  botones, una pantalla o varias).
- **Modo tema:** la IA propone 2 o 3 ideas bien distintas; el docente elige, mezcla o pide otras.
- **Pantalla:** chat + ficha "Tu idea" que se llena sola; en el celular, dos pestañas.
- **Preguntas:** de 1 a 3 por mensaje, con respuestas sugeridas para tocar, y siempre se puede escribir.
- **Pedido final:** visible y editable a mano (y por chat) antes de crear.
- **Guardado:** "Mis ideas", se retoma otro día; la idea queda vinculada al recurso que generó.
- **Paso a crear:** "Crear mi recurso" abre el editor limpio con el pedido como primer mensaje, que se manda solo. La
  IA que genera recibe sólo el pedido. El recurso tiene un link "Ver cómo pensamos esta idea".
- **Entradas:** menú de arriba, "Nuevo recurso" (ventana con "Pensar la idea primero · Recomendado" o "Ir directo a
  crear"), panel de mis recursos y la landing pública.

## Decisiones de diseño (tomadas en esta sesión)

- **Misma IA:** el motor predeterminado del catálogo (`motorPorDefecto`) con su cadena de respaldo. Sin selector.
- **Formato de la respuesta:** texto común (la burbuja, que se ve llegar en vivo) + un bloque
  `<taller>{json}</taller>` al final con preguntas, cambios de la ficha, ideas, título, descripción y pedido. Se pide
  SIN herramientas (`sinHerramientas`), así funciona con cualquier motor y no choca con los modelos de razonamiento
  que no aceptan forzar una herramienta. El servidor corta el bloque del stream (`prefijoVisible`) y lo manda
  estructurado en el evento `done`. La lectura es tolerante (cercas de código, coma de más, bloque sin cierre,
  `<think>`); si el bloque viene roto, el turno se guarda igual con el texto.
- **Primera pregunta fija por puerta** (`APERTURAS`): aparece al instante y no gasta IA.
- **Estado en el último mensaje:** la ficha, el pedido actual (con aviso si el docente lo editó a mano) y los
  adjuntos viajan en el último mensaje del usuario; el system prompt y el historial quedan iguales entre turnos (cache
  del proveedor), mismo criterio que `buildCurrentResourceBlock` en el editor.
- **Guardado atómico al final del turno:** el mensaje del docente y el de la IA se crean juntos en una transacción.
  Un turno que falla no deja un mensaje colgado; el docente reenvía. Cerrar la pestaña NO corta el turno: termina, se
  guarda, y al volver se ve (la página consulta hasta que termina).
- **Un turno a la vez por charla:** reclamo en memoria (`reclamarTurno`), el segundo recibe 409.
- **Consumo:** `UsagePurpose.IDEATION`, sin `projectId`, `forNewResource` en NULL. Aparece como "Taller de ideas" en
  "Costo por paso" de `/admin/metricas`. Cuenta para el tope del docente en ese motor y para el de la demo.
- **Acceso:** la misma regla que el editor (`puedeUsarLaIa` + interruptor de la demo). Una cuenta personal es
  redirigida a `/app`, que explica por qué.
- **Privacidad:** una charla sólo la ve su dueño. Ni un admin ve charlas ajenas (el link del recurso tampoco aparece
  cuando un admin abre un recurso ajeno).
- **Adjuntos:** imágenes (PNG, JPG, WEBP, GIF) y PDF, **sin SVG** (un SVG puede traer scripts y se sirve desde el mismo
  origen). Al crear el recurso se copian como `ProjectAsset` con la misma URL; las imágenes van adjuntas al primer
  mensaje del editor para los motores que ven imágenes.
- **Crear dos veces:** el vínculo se hace con `updateMany ... where projectId = null`; un doble clic no crea dos
  recursos (el de más se borra y se redirige al que ganó).
- **El pedido que manda el editor:** si arranca como pregunta ("¿Podés…?"), se le antepone una orden
  (`pedidoParaElEditor`) para que `pideCambio` no lo tome como consulta.
- **Después de crear:** la charla queda de sólo lectura. Si se borra el recurso, la charla vuelve a quedar en curso.

## Archivos

- Modelo: `prisma/schema.prisma` (`IdeaSession`, `IdeaMessage`, `IdeaAsset`, `IdeaMode`, `UsagePurpose.IDEATION`),
  migración `20261011000000_taller_de_ideas`.
- Lógica isomórfica: `src/lib/taller/ficha.ts` (ficha, bloque, stream), `src/lib/taller/prompt.ts` (system prompt,
  aperturas, armado de mensajes), `src/lib/taller/tipos.ts`.
- Servidor: `src/lib/taller/sesiones.ts`, `src/pages/api/taller/**` (crear charla, leer/editar/borrar, turno SSE,
  adjuntos, crear recurso).
- Interfaz: `src/pages/app/taller/index.astro` (puertas + Mis ideas), `src/pages/app/taller/[id].astro`,
  `src/components/taller/*`.
- Entradas: `BaseLayout.astro` (menú), `NewProjectButton.tsx` (ventana), `app/index.astro` (tarjeta), `index.astro`
  (landing).
- Paso al editor: `app/project/[id].astro` (`pedidoInicial`, link a la charla), `Workspace.tsx` (lo manda solo).

## Pruebas

- `npx tsx e2e/unidad-taller.ts`: 21 pruebas sin base (bloque, stream, ficha, armado de mensajes).
- `npx tsx e2e/taller-de-ideas.ts`: 15 pruebas de punta a punta contra el servidor y el proveedor simulado (acceso,
  puertas, bloque que nunca llega como texto, consumo, ideas, un turno a la vez, adjuntos, pedido, edición a mano,
  aislamiento entre cuentas, crear recurso, sólo lectura, pedido inicial del editor, Mis ideas).
- Recorrido manual en el navegador (escritorio y 375 px): puertas, respuestas para tocar, ideas, ficha, pedido, crear
  recurso, generación automática, recarga sin reenvío, sólo lectura, métricas.

## Pendiente

- **Probar con el motor real.** Todo se verificó con el proveedor simulado. Falta ver con DeepSeek/MiniMax reales que
  respeten el bloque `<taller>`, la cantidad de preguntas y el tono, y ajustar el prompt con esos resultados. Los
  avisos `[taller/turno] ... sin bloque <taller> legible` en el log del servidor cuentan cuántas veces falla el formato.
- Mostrar "Esto es lo que voy a probar" (el checklist) antes de crear, como propone `docs/pedidos-que-funcionan.md`.
- Crear otro recurso desde la misma idea (hoy, una charla da a lo sumo un recurso).
