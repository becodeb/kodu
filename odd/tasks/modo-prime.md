# Modo prime y mejoras de calidad de los recursos

Documento vivo de la feature (flujo ODD). Espejo en Engram: proyecto `kodu`, tópico `odd/modo-prime/tasks`.

## Objetivo

Que los recursos que genera la IA dejen de verse "hechos por IA" para todos, y que para demos importantes exista un **modo prime** discreto: más calidad sin importar el costo, con un control de velocidad y la opción de pedir varias versiones.

## Problema (medido el 2026-09-22 sobre los 16 recursos de la galería pública)

- 13/16 usan emojis como íconos (511 en total); 0/16 usan una librería de íconos.
- 14/16 cargan Tailwind sin configuración: la paleta de fábrica es el "siempre los mismos colores". 56% de los colores de degradado son violeta o fucsia.
- 1/16 carga una tipografía; el resto usa la del sistema.
- El slop se concentra en el adorno (bienvenidas, XP, "Tip:", cadenas de "¡Excelente!", tarjetas dentro de tarjetas). Lo mejor de la galería es donde el dibujo es el contenido.
- Causa raíz: `BASE_PROMPT` (`src/lib/ai/prompt.ts`) no tiene reglas de diseño visual y sólo sugiere Tailwind por CDN.

## Decisiones del dueño (no reabrir)

- Prime alcanza a: la cuenta demo, los admins y las cuentas que un admin marque. Además hay un interruptor general de prime en el panel.
- Discreto: un usuario normal no nota nada. Sin avisos ni etiquetas "prime" en la interfaz del docente. Que el control de velocidad se vea está bien para quien lo tiene.
- Velocidad elegible por el usuario prime: **Rápido** o **A fondo**. El modelo caro no necesariamente es más lento: la elección de modelo es independiente de la velocidad.
- Lo que no encarece va para todos (capa 1). Lo que encarece es un interruptor del admin "para todos" (se va activando si hay más presupuesto de API).
- Varias versiones para elegir: sólo prime por ahora, como interruptor que el usuario puede prender o apagar.
- Deshacer: al menos el último cambio de la IA; como es barato, va para todos y con varios niveles.
- Progresivo: si un turno hace varios procesos (escritura, corrección, captura), cada resultado parcial se muestra apenas existe aunque el turno siga trabajando.

## Decisiones de diseño (tomadas en esta sesión)

- **Kit aplicado por el servidor.** El modelo sólo declara `<meta name="kodu-tema" content="ID">`. Al guardar, el servidor inserta el bloque canónico del tema (Tailwind configurado, tipografías de Google Fonts, Lucide con dibujo automático, estilos base). Al armar el prompt, el bloque canónico se pliega a un comentario. El HTML guardado sigue siendo autoportante. El modelo no copia 40 líneas en cada turno: menos tokens de salida para todos.
- **Paleta anclada, no borrada.** La config de Tailwind redefine las familias de fábrica (`blue`, `gray`, `purple`, etc.) como rampas calculadas desde los tokens del tema: el 50 queda cerca del fondo y el 950 cerca de la tinta. Así los hábitos del modelo (`bg-blue-600`, `text-gray-800`) caen en la paleta del tema y siguen siendo legibles en temas oscuros. `white` se mapea a `superficie` y `black` a `tinta`.
- **Iconify descartado.** La CSP de `/p/[slug].ts` bloquea su API en `connect-src`. Lucide 1.47.0 por jsdelivr sí está permitido.
- **cdnjs fuera del prompt.** El prompt lo ofrecía, pero la CSP de `/p/` no lo permite: un recurso con cdnjs anda en el editor y se rompe publicado. Ningún recurso de la galería lo usa hoy.
- **Revisión visual y versiones son excluyentes** en esta versión: con varias versiones no se corre la revisión visual (triplicaría costo y tiempo). La revisión automática por lint sí corre en paralelo sobre cada versión.
- **Entrega:** estrategia `exception-ok`. El dueño no usa PRs y pidió merge directo a `main` en features anteriores; el push a `main` dispara el deploy de Coolify, así que se mergea recién cuando el dueño lo aprueba.

## Alcance autorizado

Todo lo de las tareas T1–T10. Fuera de alcance: cambiar precios o topes cargados en producción, tocar la cuenta demo en producción, pushear o mergear sin aprobación.

## Restricciones

- TDD: **apagado** (fuente: `openspec/config.yaml`, `strict_tdd: false` y `tdd: false`). Checks funcionales por tarea: `npm run check` (tsc), `npx tsx e2e/unidad.ts` (unitarias con node:assert) y verificación en navegador cuando la tarea toca UI o el flujo de IA (lo exige `openspec/config.yaml`).
- Convenciones del repo: comentarios y textos de UI en español (voseo en la UI), campos de Prisma y props de React en inglés, identificadores de dominio como ya los usa el archivo que se toca. Endpoints nuevos que mutan: JSON (el CSRF propio exime JSON). Respuestas con `ok(data)`.
- Migraciones en SQL puro (producción corre `prisma migrate deploy` sin `tsx`). Nombres después de `20260929000000_topes_deepseek_por_cuenta`.
- `npm install` ensucia `package-lock.json`: revertir con `git checkout -- package-lock.json` antes de commitear, salvo que la tarea agregue una dependencia a propósito.
- Commits: Conventional Commits en español, como el historial. Sin `Co-Authored-By` ni atribución de IA.
- Tamaño: ~400 líneas por tarea es una heurística de planificación, no un tope.

## Tareas

Ruta por tarea: todas **delegadas** a un escritor (disparador: tocan 2+ archivos no triviales). El contenido de diseño (temas, texto del prompt) lo escribió el orquestador en los apéndices A y B.

- [x] **T1 — Kit de diseño (módulo puro).** `src/lib/ai/kit.ts`: los 8 temas del apéndice A, rampas oklab, bloque canónico, `aplicarKit`, `plegarKit`, `temaDe`, lista de nombres de Lucide 1.47.0. Pruebas unitarias: contraste de cada tema, ida y vuelta plegar/aplicar, cambio de tema, bloque editado a mano que se respeta, tema previo como respaldo.
- [ ] **T2 — Reglas de diseño en el prompt y kit al guardar (para todos).** Sección del apéndice B en `BASE_PROMPT`, descripción de la herramienta, cdnjs fuera del prompt, `plegarKit` al armar el prompt y `aplicarKit` antes de guardar y de emitir `code`. Pruebas del prompt y del cableado.
- [ ] **T3 — Vista previa que se arma mientras la IA escribe (para todos).** Deltas del tool call desde `provider.ts`, evento `code_delta` en el SSE, decodificador de JSON parcial en el cliente, iframe doble búfer que aplica el kit al HTML parcial. Pruebas del decodificador y chequeo en navegador.
- [ ] **T4 — Deshacer cambios de la IA (para todos).** Tabla `ProjectSnapshot`, `ChatMessage.undoneAt`, instantánea por turno, `POST /api/projects/[id]/undo`, botón en el último mensaje que cambió el código, historial del modelo sin turnos deshechos, poda a 20 instantáneas por proyecto.
- [ ] **T5 — Modo prime y funciones para todos (panel).** `AppSettings.primeEnabled`, `autoReviewForAll`, `deepModeForAll`, `versionsForAll`; `User.primeAccess`; `AiModel.primeOnly`; `resolverCapacidades()`; página `/admin/generacion`; interruptor en la ficha del usuario; casilla en el formulario de modelos; catálogo y `normalizarMotor` filtrando modelos prime en el servidor.
- [ ] **T6 — Velocidad Rápido / A fondo.** Control discreto en el compositor sólo para quien lo tiene; `speed` validado en el servidor; razonamiento apagado en Rápido y al menos `high` en A fondo según el dialecto del modelo; fases en `AiStatus`.
- [ ] **T7 — Revisión automática (lint + una corrección) y turnos progresivos.** `src/lib/ai/revision.ts`; política: A fondo o `autoReviewForAll`; el HTML de la primera pasada se guarda y se muestra antes de corregir; una sola corrección por turno; uso de tokens registrado por llamada.
- [ ] **T8 — Revisión visual con captura (A fondo + modelo con visión).** Captura con el puente existente de `src/lib/preview.ts`, `POST /api/chat/visual-review` (SSE), llamada con la imagen, el resultado reemplaza la vista previa al llegar.
- [ ] **T9 — Varias versiones al crear (prime o `versionsForAll`).** Hasta 3 generaciones en paralelo con enfoques distintos, la 1 se transmite en vivo, las demás aparecen al terminar, selector de versión en el mensaje, `POST /api/projects/[id]/variant`.
- [ ] **T10 — Verificación de punta a punta y documentación.** Recorrido en navegador del flujo completo en desarrollo, README actualizado, reporte final.

## Criterios de aceptación

- Un docente sin prime no ve ningún control nuevo salvo "Deshacer" y la vista previa en vivo, y no puede forzar por API ni velocidad, ni versiones, ni modelos prime.
- Un recurso nuevo declara tema y sale con el kit aplicado. Sin emojis ni degradados en la mayoría de los casos, y cuando aparecen, la revisión automática (si está activa) los corrige.
- Un recurso publicado con el kit se ve igual en `/p/[slug]` que en el editor (misma CSP permitida).
- Rápido no suma pasadas; A fondo suma razonamiento, revisión automática y revisión visual si el modelo ve imágenes. Cada resultado intermedio aparece en la vista previa apenas existe.
- Deshacer restaura el HTML previo al último turno de la IA y el modelo deja de ver ese turno.

## Checks

`npm run check`, `npx tsx e2e/unidad.ts`, suites e2e afectadas (`e2e/m1-admin-shell.ts` cuenta las pestañas del panel), chequeo en navegador con la pila de desarrollo (`docker compose up -d db`, `npm run dev`, puerto 3000).

## Revisión (RDD)

Encendida por defecto (`gentle-ai review mode status`). Primer límite revisado: el punto de ramificación `3c410df`. Después de cada commit de tarea: `gentle-ai review assess --cwd . --agent claude-code --base-ref <último límite> --committed-only --json`.

## Progreso y evidencia

| Tarea | Commit | Checks | Riesgo / revisión |
|---|---|---|---|
| T1 | `0485cc5` | `npm run check` OK; `npx tsx e2e/unidad-kit.ts` 24/24 (re-corrido por el orquestador: OK); `npx tsx e2e/unidad.ts` 22/22; Google Fonts de los 8 temas y Lucide UMD → 200; Chromium: en los 8 temas `bg-blue-600`→acento, `text-white`→superficie, fondo del body→fondo, íconos estáticos y dinámicos dibujados, `createIcons` una sola vez tras la inserción (sin bucle) | assess: **medium** (`executable_change`, `slice_budget_reached`). Preflight STATUS → `stop rdd_disabled` aunque `review mode status` dice "on (decided by default)". No se habilita RDD en nombre del usuario; verificación del escritor + control del orquestador |

Notas T1: `e2e/unidad-kit.ts` es una suite aparte porque `e2e/unidad.ts` necesita Postgres. `src/lib/ai/lucide-nombres.ts` es generado (2199 nombres; se regenera según su encabezado) y queda fuera del bundle del cliente.

## Próximo paso

T2.

---

## Apéndice A — Temas del kit

Tokens por tema: `fondo`, `superficie`, `tinta`, `suave`, `linea`, `acento`, `acento2`, `exito`, `error`. Umbrales que cada tema debe cumplir (si un par no llega, ajustar la luminosidad del token manteniendo el matiz, lo mínimo necesario, y anotarlo acá):

Ajustes hechos en T1 para cumplir los umbrales: `cuaderno.exito` #2f8f4e → #258747 (4,07 → 4,53) y `recreo.exito` #148a4c → #11884b (4,40 → 4,52), oscurecidos en OKLab con el mismo matiz. La tabla ya muestra los valores finales.

- tinta/fondo y tinta/superficie ≥ 7
- suave/fondo y suave/superficie ≥ 4.5
- superficie/acento ≥ 4.5 (texto sobre botones de acento)
- exito/superficie y error/superficie ≥ 4.5
- acento/fondo ≥ 3

| id | uso | esquema | fondo | superficie | tinta | suave | linea | acento | acento2 | exito | error | display | cuerpo |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `pizarron` | matemática, repaso, cálculo | oscuro | #1d2b25 | #24362e | #f1efe6 | #a9b8ad | #3a5046 | #f4c95d | #8ecae6 | #9bd89a | #f4978e | Kalam 700 | Atkinson Hyperlegible 400/700 |
| `cuaderno` | lengua, lectura, escritura | claro | #fbfaf5 | #ffffff | #1f2a44 | #5b6478 | #d9dff0 | #2446c7 | #f2c230 | #258747 | #c43c32 | Andika 700 | Andika 400/700 |
| `laboratorio` | ciencias naturales, física, química | claro | #f5f7f9 | #ffffff | #111b2b | #536175 | #d6dde6 | #c2410c | #1d5bd8 | #13865a | #b42318 | IBM Plex Sans 700 | IBM Plex Sans 400/600 |
| `atlas` | geografía, historia, sociales | claro | #eef0e6 | #f8f9f3 | #23291f | #56604e | #cdd4c1 | #0f7478 | #b8741a | #3a7f35 | #b3402c | Alegreya 800 | Alegreya Sans 400/700 |
| `recreo` | nivel inicial, primer ciclo | claro | #fffdf8 | #ffffff | #1b1d3a | #565a78 | #e7e4ef | #1f6fe5 | #ffc233 | #11884b | #d7263d | Baloo 2 800 | Andika 400/700 |
| `plano` | tecnología, robótica, programación, geometría | oscuro | #123a6b | #17467e | #f2f6ff | #b3c6e6 | #3a6aa6 | #7fe0d0 | #ffd166 | #93e6a8 | #ffa093 | Barlow Condensed 700 | Barlow 400/600 |
| `noche` | astronomía, espacio | oscuro | #0e1a33 | #172649 | #eef1fb | #a3aecb | #2b3b66 | #ff9f6e | #ffd76a | #82e3a5 | #ff8f8f | Unbounded 700 | Atkinson Hyperlegible 400/700 |
| `huerta` | biología, ecología, alimentación | claro | #f6f8ef | #ffffff | #1f2d1b | #56664e | #d6dfc9 | #b45309 | #3f8f3a | #2f7d4f | #b3261e | Bricolage Grotesque 700 | Atkinson Hyperlegible 400/700 |

Rampas: familias neutras (`slate`, `gray`, `zinc`, `neutral`, `stone`) mezclan `tinta` sobre `fondo` en oklab con 50→4%, 100→8%, 200→14%, 300→24%, 400→40%, 500→55%, 600→68%, 700→80%, 800→88%, 900→94%, 950→97%. Familias de color: 50–400 mezclan el token sobre `fondo` (10, 18, 32, 52, 76%), 500 y 600 son el token, 700–950 mezclan el token con `tinta` (82, 64, 48, 34% de token). Mapeo: `blue`, `indigo`, `violet`, `purple` → acento; `sky`, `cyan`, `teal`, `yellow`, `amber`, `orange`, `pink`, `rose`, `fuchsia` → acento2; `green`, `emerald`, `lime` → exito; `red` → error. Los valores se calculan en TypeScript y se embeben como hex (así funcionan los modificadores de opacidad de Tailwind).

Bloque canónico, en este orden, delimitado por `<!-- kodu-kit:v1:inicio tema=ID -->` y `<!-- kodu-kit:v1:fin -->`, insertado justo después del `<meta name="kodu-tema">`: preconnect y hoja de Google Fonts del tema (`display=swap`), `https://cdn.tailwindcss.com`, `tailwind.config` con `colors` (tokens + rampas + `white`/`black`/`transparent`/`current`/`inherit`), `fontFamily` (`display`, `body`, `sans` = cuerpo), `borderRadius` acotado (none 0, sm 4px, DEFAULT/md 8px, lg 12px, xl 14px, 2xl 16px, 3xl 18px, full) y `boxShadow` con dos niveles suaves teñidos con `tinta`; Lucide `https://cdn.jsdelivr.net/npm/lucide@1.47.0/dist/umd/lucide.min.js`; un script que llama `lucide.createIcons()` al cargar y, con un `MutationObserver` agrupado por `requestAnimationFrame`, cada vez que aparece un `i[data-lucide]` (sólo `i`, para no entrar en bucle con los `svg` que Lucide inserta); un `<style>` base con las variables CSS `--fondo`… `--error`, `color-scheme`, `html{font-size:clamp(16px,0.55vw + 11px,20px)}`, fondo y tinta en `html`/`body`, fuente de cuerpo, `h1,h2,h3` con la display, `text-wrap:balance` en títulos, `.lucide` a 1.15em alineado al texto, `:focus-visible` con el acento y `prefers-reduced-motion`.

Plegado para el prompt: el bloque canónico sin tocar se reemplaza por `<!-- kodu-kit:v1 tema=ID: acá va el bloque estándar del kit (Tailwind, tipografías, íconos). Lo agrega el sistema; dejá este comentario tal cual. -->`. Un bloque que no coincide byte a byte con el canónico de su tema se considera editado a mano y no se pliega ni se reemplaza.

## Apéndice B — Texto del prompt (sección nueva de `BASE_PROMPT`)

```
## Diseño visual (recursos nuevos y rediseños pedidos)
Estas reglas valen cuando creás un recurso desde el HTML de arranque o cuando el docente pide rediseñarlo. Si el recurso ya existe, manda la REGLA MÁS IMPORTANTE: respetá su estética tal como está.

### El kit de KoduEdu
- Elegí UN tema y declaralo en el <head>: <meta name="kodu-tema" content="ID">. El sistema agrega solo Tailwind configurado con la paleta del tema, las tipografías y los íconos. NO pegues scripts de Tailwind ni de Lucide, NO escribas tailwind.config y NO cargues otras tipografías.
- Temas (elegí por materia y edad, no por costumbre):
  - pizarron: pizarrón verde oscuro y tiza. Matemática, repaso, cálculo.
  - cuaderno: hoja clara, birome azul y resaltador. Lengua, lectura, escritura.
  - laboratorio: blanco, naranja de seguridad y cobalto. Ciencias naturales, física, química.
  - atlas: papel de mapa, mar y ocre. Geografía, historia, ciencias sociales.
  - recreo: colores primarios planos. Nivel inicial y primer ciclo.
  - plano: plano técnico azul. Tecnología, robótica, programación, geometría.
  - noche: cielo nocturno. Astronomía y espacio.
  - huerta: hojas, sol y tierra. Biología, ecología, alimentación.
- Colores: usá los del tema con estos nombres de Tailwind: fondo, superficie, tinta, suave, linea, acento, acento2, exito, error (por ejemplo bg-superficie text-tinta border-linea, o bg-acento text-superficie en un botón). En canvas o SVG leelos con getComputedStyle(document.documentElement).getPropertyValue('--acento').
- Tipografía: font-display sólo para títulos cortos. El cuerpo ya viene puesto.
- Íconos: SOLO Lucide, con <i data-lucide="nombre"></i>; se dibujan solos, también en lo que agregás con JavaScript. Nombres en inglés y en kebab-case, por ejemplo: check, x, lightbulb, rotate-ccw, play, pause, volume-2, timer, trophy, star, heart, arrow-left, arrow-right, chevron-right, info, circle-help, book-open, pencil, flask-conical, atom, globe, map, calculator, music, palette, puzzle, dice-5, target, flag, eye, shuffle, list-checks.
- PROHIBIDO usar emojis en cualquier parte del recurso: textos, botones, títulos, devoluciones y cadenas de JavaScript. Para un símbolo usá un ícono. Para mostrar un objeto (una manzana para contar), dibujalo en SVG simple.

### Qué evitar, porque hace que se vea hecho por IA
- Degradados en fondos o textos. Usá fondos lisos del tema.
- Meter todo en tarjetas. Agrupá con espacio y tipografía; usá una caja sólo si separa algo de verdad. Nunca borde, sombra y fondo de color juntos, y nunca cajas dentro de cajas.
- Grillas de tarjetas iguales como estructura por defecto.
- Etiquetas en MAYÚSCULAS arriba de los títulos, flechitas "→" pegadas a los botones, una palabra del título resaltada en otro color.
- Animaciones de entrada en cada sección. Animá sólo para responder a una acción: acierto, error, cambio de estado.

### Texto: sólo lo que el alumno necesita para actuar o aprender
- Título: 6 palabras como máximo, sin subtítulo que lo repita.
- Consigna: una oración de hasta 20 palabras.
- Devolución: hasta 12 palabras. Si explica, que explique el porqué del error; no felicites de más.
- Prohibido: párrafo de bienvenida, "¡Hola! Soy…", "Tip:", "¿Sabías que…?" de relleno, pie de página y felicitaciones repetidas.

### Estructuras que funcionan
Preguntas: una por pantalla.
  +------------------------------------------+
  | ========--------------          3 / 10   |  <- progreso fino
  |                                          |
  |  ¿Cuánto es 3/4 + 1/4?                   |  <- pregunta grande
  |                                          |
  |  [ 1 ]   [ 4/8 ]   [ 1/2 ]   [ 3/16 ]    |  <- opciones grandes
  |                                          |
  |  Correcto: tres cuartos y un cuarto…     |  <- devolución en el lugar
  +------------------------------------------+
Simulador: el dibujo manda.
  +----------------------------+-------------+
  |                            | Masa  --o-- |
  |   lienzo o SVG             | Fuerza -o-- |
  |   (70% del ancho)          |             |
  |                            | [Reiniciar] |
  +----------------------------+-------------+
Tarjetas de memoria: una tarjeta grande centrada que se da vuelta con clic o con la barra espaciadora.
Explorador (mapa, diagrama, línea de tiempo): la imagen ocupa la pantalla; tocar una parte muestra su información al costado.
Si el tema se puede dibujar (un circuito, una célula, una cancha, una fracción), dibujalo en SVG: que el dibujo sea el contenido y no una tarjeta con texto.

### Plan antes del código
Inmediatamente después de <!DOCTYPE html>, escribí un comentario con tu plan: <!-- plan: tema=… | estructura=… | lo central=… -->. Decidilo ANTES de escribir el resto, y en las ediciones siguientes respetalo.
```

Cambios en la sección "Con qué podés construirlo": los estilos salen del kit; Lucide ya viene en el kit; `canvas-confetti` sólo al terminar una actividad, no en cada acierto; librerías de otros CDN sólo desde jsdelivr o unpkg (otros quedan bloqueados en la versión publicada).
