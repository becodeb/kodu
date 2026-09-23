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
- [x] **T2 — Reglas de diseño en el prompt y kit al guardar (para todos).** Sección del apéndice B en `BASE_PROMPT`, descripción de la herramienta, cdnjs fuera del prompt, `plegarKit` al armar el prompt y `aplicarKit` antes de guardar y de emitir `code`. Pruebas del prompt y del cableado.
- [x] **T3 — Vista previa que se arma mientras la IA escribe (para todos).** Deltas del tool call desde `provider.ts`, evento `code_delta` en el SSE, decodificador de JSON parcial en el cliente, iframe doble búfer que aplica el kit al HTML parcial. Pruebas del decodificador y chequeo en navegador.
- [x] **T4 — Deshacer cambios de la IA (para todos).** Tabla `ProjectSnapshot`, `ChatMessage.undoneAt`, instantánea por turno, `POST /api/projects/[id]/undo`, botón en el último mensaje que cambió el código, historial del modelo sin turnos deshechos, poda a 20 instantáneas por proyecto.
- [x] **T5 — Modo prime y funciones para todos (panel).** `AppSettings.primeEnabled`, `autoReviewForAll`, `deepModeForAll`, `versionsForAll`; `User.primeAccess`; `AiModel.primeOnly`; `resolverCapacidades()`; página `/admin/generacion`; interruptor en la ficha del usuario; casilla en el formulario de modelos; catálogo y `normalizarMotor` filtrando modelos prime en el servidor.
- [x] **T6 — Velocidad Rápido / A fondo.** Control discreto en el compositor sólo para quien lo tiene; `speed` validado en el servidor; razonamiento apagado en Rápido y al menos `high` en A fondo según el dialecto del modelo; fases en `AiStatus`.
- [x] **T7 — Revisión automática (lint + una corrección) y turnos progresivos.** `src/lib/ai/revision.ts`; política: A fondo o `autoReviewForAll`; el HTML de la primera pasada se guarda y se muestra antes de corregir; una sola corrección por turno; uso de tokens registrado por llamada.
- [x] **T8 — Revisión visual con captura (A fondo + modelo con visión).** Captura con el puente existente de `src/lib/preview.ts`, `POST /api/chat/visual-review` (SSE), llamada con la imagen, el resultado reemplaza la vista previa al llegar.
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

| T2 | `a232009`, `1c4c2b7` | `npm run check` OK; `npx tsx e2e/unidad-kit.ts` 24/24; `npx tsx e2e/unidad.ts` 27/27 (re-corrido por el orquestador: OK); migración aplicada en dev y regla verificada. **Pendiente:** generaciones reales — las keys de `.env` están vacías en dev | assess (desde `bcf2295`): **medium**, `under_budget`; verificación del escritor + control del orquestador (lectura del diff de `stream.ts`) |

| T3 | `db34ff1` | `npm run check` OK; `npx tsx e2e/unidad-html-parcial.ts` 15/15; `npx tsx e2e/unidad-kit.ts` 24/24; `npx tsx e2e/unidad.ts` 27/27; chequeo en navegador (`e2e/t3-vista-previa-progresiva.ts`, con `e2e/mock-proveedor.ts` propio): el `<title>`/`<h1>` del documento parcial (con el kit del tema `pizarron` ya aplicado) se ven ANTES del `code` final; a los ~7s ya había 7 tarjetas de pregunta renderizadas; el documento final muestra scripts corriendo (contador `data-tick` avanzando); `code_reset` viaja en el orden correcto al saltar al motor de respaldo. Capturas en `/tmp/kodu-t3/` (no versionadas) | verificación del escritor + control del orquestador |

Notas T3: el escritor probó server↔decodificador end-to-end contra el mock ANTES del chequeo de navegador (buffer real de 92–134 deltas, prefijo monótono en cada paso, decode final byte a byte igual al HTML real) — quedó fuera del repo por ser un script descartable. El `code_reset` de los 3 puntos nuevos (reintento por saturación, salto de motor, re-pedido forzado) es correcto pero HOY nunca tiene un parcial visible por delante para limpiar: bajo el control de flujo actual de `stream.ts`, `consumir()` (la única fuente de `code_delta`) arranca siempre DESPUÉS de que la selección/reintento de motor ya terminó, así que ninguno de los tres puntos puede ejecutarse con contenido ya streameado — el chequeo de navegador lo prueba a nivel de cableado (SSE crudo, motor roto → motor de respaldo), no como limpieza visual. Es la clase de caso que T7 (una corrección real después de una primera pasada) sí va a poder ejercitar en serio. Al chequear a mano, Playwright `locator.fill()` NO disparaba el `onChange` de React en este editor (el valor quedaba en el DOM pero `draft` seguía vacío y "Enviar" quedaba deshabilitado); `pressSequentially` (tecla por tecla) sí — vale para cualquier chequeo de navegador futuro que tipee en el compositor.

Motor mock para T4+: queda un `AiProvider` (`kind: "kodu-mock-t3"`) y un `AiModel` (`providerModel: "mock-t3"`, seleccionable) apuntando a `http://127.0.0.1:4790` en la base de desarrollo, para no tener que cargar una key real en cada chequeo de navegador. `e2e/mock-proveedor.ts` exporta `iniciarMockProveedor()` (arranca el server en ese puerto), `programarRespuesta()` (encola texto/html/status/cortes de red por llamada) y `llamadas` (lo que recibió, para asserts de prompt). `e2e/t3-vista-previa-progresiva.ts` es idempotente: si esas filas ya existen, las reusa en vez de duplicarlas.

| T4 | `91ef6ee`, `852a916` | `npm run check` OK; `npx tsx e2e/unidad.ts` 31/31 (re-corrido por el orquestador: OK); `e2e/unidad-kit.ts` 24/24; `e2e/unidad-html-parcial.ts` 15/15; `prisma migrate deploy` aplicado en dev; `npx tsx e2e/t4-deshacer.ts` (dev + mock + Chromium): botón sólo en el último mensaje de la IA, la vista previa vuelve a A y el par queda atenuado con "Deshecho"; el historial del turno 3 no contiene el pedido deshecho y sí el anterior; tres deshacer seguidos vuelven al HTML de arranque byte a byte; 409 sin nada para deshacer, 409 con un turno en curso (en cualquier hilo del proyecto), 404 para otro docente; la poda deja exactamente 20 instantáneas tras 25 turnos | assess (desde `db34ff1`): **medium**, `slice_budget_reached`; preflight → `stop rdd_disabled`. Verificación del escritor + control del orquestador (captura revisada; ícono corregido a la flecha `undo-2` en `852a916`) |

| T5 | `c72ffec`, `528ddda` | `npm run check` OK; `npx tsx e2e/unidad.ts` 40/40 (re-corrido por el orquestador: OK); `m1-admin-shell` 11/11 (7 pestañas), `m3-motores` 35/35, `m5-usuarios` 23/23, `m7-demo` 22/22; `npx tsx e2e/t5-modo-prime.ts` todas las escenas (re-corrido por el orquestador con la escena 1b nueva: OK) | assess (desde `f57cf11`): **high** (`hot_path` auth en `session.ts`); preflight → `stop rdd_disabled`. Verificador independiente (solo lectura): sin bloqueantes; un should-fix previo a T5 (el PATCH del recurso aceptaba cualquier `aiModelId`: sin riesgo real porque cada lectura normaliza, pero un id inválido daba 500) corregido en `528ddda` con 422 y cubierto por la escena 1b |

| T6 | `6e02636` | `npm run check` OK; `npx tsx e2e/unidad.ts` (+10 pruebas; re-corrido por el orquestador: OK); `npx tsx e2e/t6-velocidad.ts` 7 escenas: prime+Rápido → `reasoning_effort:"none"`, prime+A fondo → `"high"` (sube desde "low"), docente sin marcar mandando `speed:"deep"` → sigue "low", control ausente para él y sin "prime" en la página, presente para el marcado con "A fondo" por defecto y la elección sobrevive a recargar, el pie no se parte a 1024 px, con `deepModeForAll` el docente común lo ve con "Rápido" por defecto; regresión de t3, t4, t5 y m1: OK | assess (desde `06d6d99`): **medium**, `slice_budget_reached`; preflight → `stop rdd_disabled`. Verificación del escritor + control del orquestador (captura revisada) |

| T7 | `93d80ac` | `npm run check` OK (re-corrido por el orquestador); `npx tsx e2e/unidad-revision.ts` 34/34 (re-corrido: OK), con los falsos positivos (© ® ™, gradientes SVG, emojis en comentarios, el propio bloque del kit) y el diff "sólo lo que introdujo el turno"; `unidad.ts` 50/50, `unidad-kit.ts` 24/24, `unidad-html-parcial.ts` 15/15; `npx tsx e2e/t7-revision-automatica.ts` 6 escenas: A fondo → SSE `code → phase → code → done`, la corrección lleva sólo sistema + un mensaje sintético con tool forzada y razonamiento "none", queda persistida la corregida y un deshacer vuelve al arranque; Rápido → 1 llamada; docente común con `autoReviewForAll` → corrige; edición que no agrega emojis a un recurso que ya tenía → no corrige; corrección con 500 → queda el primer pase sin error visible; UI real: "Revisando detalles" con el primer pase visible y una segunda pestaña que ve el primer pase persistido; regresión t3–t6 OK | assess (desde `808ce05`): **medium**, `slice_budget_reached`; preflight → `stop rdd_disabled`. Verificación del escritor + control del orquestador (lectura del diff de `stream.ts`: la puerta sólo se abre con A fondo o `autoReviewForAll`) |

| T8 | `e85549f` | `npm run check` OK; `npx tsx e2e/unidad-revision-visual.ts` 19/19 (re-corrido por el orquestador: OK); `unidad.ts` 50/50 y demás suites unitarias OK; `npx tsx e2e/t8-revision-visual.ts` 8 escenas: el pedido lleva `image_url` `data:image/…`, la instrucción de crítica y `tool_choice: auto`; un HTML cambiado se aplica y persiste; "Sin cambios." no toca nada; Rápido y motor sin visión → `revisionVisualDisponible: false`; huella vieja → 409 sin llamar al motor; un resultado con emojis nuevos se descarta; "Detener" deja el HTML del turno; navegador real con "Mirando cómo quedó" y la imagen enviada guardada; regresión t3–t7 OK (t5 falló una vez por un timeout del diálogo de admin y pasó al reintentar) | assess (desde `dd16be5`): **medium**, `slice_budget_reached`; preflight → `stop rdd_disabled`. Verificación del escritor + control del orquestador (la imagen que recibe el modelo muestra el recurso con tipografía e íconos del kit) |

Notas T8: el servidor decide si corresponde (`revisionVisualDisponible` en el `done`) y el cliente sólo ejecuta: captura con el puente de `src/lib/preview.ts` (JPEG, alto acotado), `POST /api/chat/visual-review` `{ projectId, dataUrl, fingerprint }` con respuesta SSE `code?` + `done`. La imagen no se guarda. No crea mensajes de chat. La máquina de desarrollo estaba muy cargada (varias sesiones en paralelo): algunas escenas tardías de `m9` se colgaron por memoria, no por código.

Notas T7: la lista de CDN permitidos vive ahora en `src/lib/cdn-allowlist.ts` y la usan la CSP de `/p/` y el lint (misma CSP resultante). La corrección se registra como una fila de `TokenUsage` aparte del primer pase. No se probó de punta a punta el caso de corrección truncada (mismo camino de código que el 500).

Notas T6: el control son dos íconos en el pie del compositor (rayo = Rápido, lupa = A fondo) con `title` explicativo; el cliente recibe `velocidadPorDefecto` ('a_fondo' para prime, 'rapido' para quien lo tiene por "para todos"). En el cable: `speed: 'fast' | 'deep'`; override de razonamiento por dialecto en `razonamientoEfectivo()`.

Notas T5: `resolverCapacidades` devuelve `{ prime, puedeElegirVelocidad, puedePedirVersiones, autoReviewForAll, puedeUsarModelosPrime }`; el cliente sólo recibe `CapacidadesEditor { puedeElegirVelocidad, puedePedirVersiones }`, sin la palabra "prime". `primeAccess` nunca viaja en el JWT: se relee de la base en cada request con puerta, como `aiAccessOverride`. Los modelos exclusivos se saltean también como eslabones de la cadena de respaldo. Queda para T10: confirmar con un build de producción que ningún comentario con "prime" llega al bundle del cliente.

Notas T4: "turno en curso" usa el mismo criterio que el cliente y `/api/chat/cancel` (el mensaje más nuevo del hilo es del docente), generalizado a todos los hilos del proyecto porque `currentHtml` es por proyecto. El escritor encontró y arregló un defecto previo: la burbuja optimista del docente tenía un id local que nunca se reconciliaba con el de la base; ahora el evento `done` trae `userMessageId`. No se ejercitó el deshacer de un admin sobre un recurso ajeno.

Notas T2: `htmlEditedByTeacher` no compara contenido (lo marca sólo el editor de código del cliente), así que aplicar el kit no genera falsos "editado a mano". La regla global sembrada "Librerías permitidas por CDN" contradecía el kit (mandaba Tailwind y Lucide a mano y confetti en cada acierto): `1c4c2b7` actualiza el seed y agrega una migración de datos que la corrige en producción sólo si conserva el texto original.

Notas T1: `e2e/unidad-kit.ts` es una suite aparte porque `e2e/unidad.ts` necesita Postgres. `src/lib/ai/lucide-nombres.ts` es generado (2199 nombres; se regenera según su encabezado) y queda fuera del bundle del cliente.

## Próximo paso

T9. Para validar el prompt con modelos reales hace falta que el dueño cargue una key de DeepSeek en el `.env` de desarrollo (queda para T10 si no llega antes).

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
