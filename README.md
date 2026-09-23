## Documento de Especificación: Plataforma Educativa de Creación Asistida por IA

---

### 1. Arquitectura General y Acceso

* **Autenticación restringida:** Registro e inicio de sesión condicionado por lista blanca de dominios de correo electrónico institucionales autorizados (ej. `@rededucativa.edu.ar`).
* **Seguridad de API Keys:** Las claves de cada proveedor viven exclusivamente en variables de entorno del backend; el navegador nunca las recibe.
* **Selector de Modelo:** Alpha, DeepSeek o MiniMax M3 (servido por GMI Cloud).



---

### 2. Espacio de Trabajo y Editor (Chat + Live Preview)

La vista principal de edición divide la pantalla en dos paneles sincronizados:

```
┌──────────────────────────────────────┬──────────────────────────────────────┐
│  PANEL IZQUIERDO: CHAT Y CONTROL     │  PANEL DERECHO: VISOR Y CÓDIGO       │
│                                      │                                      │
│  [ Historial ] [ Nuevo Chat ]        │  Tabs: [ Vista Previa ] [ Código ]   │
│  Modelo: Alpha / DeepSeek / MiniMax M3 │  URL Pública: red.edu/p/xyz123 [🔗] │
│ ──────────────────────────────────── │ ──────────────────────────────────── │
│  Mensajes del Docente / IA           │                                      │
│  (Solo explicaciones y cambios)      │  Iframe Sandbox                      │
│                                      │  (Renderizado reactivo               │
│  [ Escribe un cambio... ] [Enviar]   │   HTML + CSS + JS)                   │
└──────────────────────────────────────┴──────────────────────────────────────┘

```

* **Flujo de Generación:**
* El chat utiliza streaming (`AI SDK` o `EventSource`).
* Las explicaciones de la IA aparecen en el flujo conversacional, mientras que los bloques de código se interceptan por debajo para actualizar el visor sin inundar el chat de texto técnico.


* **Estructura del Proyecto:** Archivo único (`single-file` HTML/CSS/JS) inyectado dinámicamente en el iframe mediante `srcdoc`.
* **Pestaña de Código:** Editor integrado (Monaco Editor o CodeMirror) que permite inspección o edición manual directa si el docente lo desea.
* **Persistencia:** Historial de conversaciones y versiones del código asociadas al ID del proyecto en la base de datos.

---

### 3. Sistema de Reglas y Contexto Personalizable

* **Reglas Base del Sistema:**
* Inyección automática de Tailwind CSS por CDN.
* Inclusión de librerías didácticas estándar (KaTeX para matemáticas, Lucide Icons para iconografía, Canvas-Confetti, Chart.js).
* Instrucciones estrictas para no requerir instalación de módulos locales ni pasos de empaquetado.


* **Configuración por Usuario:**
* Panel de configuración de reglas y contexto accesible desde la cuenta del docente.
* Capacidad de crear, visualizar, editar y alternar (on/off) directivas personalizadas (ej. *"Usar siempre paleta de colores accesibles para primaria"*, *"Redactar consignas en tono lúdico"*).



---

### 4. Galería Pública y Previsualización Externa

* **Acceso Externo:** Cada proyecto dispone de un enlace permanente único (ej. `app.red.edu/p/[slug-o-id]`) optimizado para proyectar o compartir directamente con estudiantes.
* **Toggle de Publicación:** Switch dentro del proyecto: *"Mostrar en Galería Institucional"*.
* **Catálogo de Recursos:**
* Visualización en grilla interactiva.
* **Tarjeta de recurso:** Captura de pantalla generada automáticamente (o previsualización en miniatura), título, descripción funcional, materia sugerida y autor.
* Opción de abrir la herramienta en pantalla completa o duplicar el código a una cuenta propia para adaptarlo.



---

### 5. Pila Tecnológica Recomendada

| Componente | Herramientas Seleccionadas |
| --- | --- |
| **Frontend & UI** | Next.js / Astro con React, Tailwind CSS, Vercel AI SDK (o streaming hooks nativos). |
| **Editor de Código** | `@monaco-editor/react` o `@uiw/react-codemirror`. |
| **Backend & Base de Datos** | Node/Bun (Fastify o API Routes), PostgreSQL / SQLite con Drizzle u ORM equivalente para usuarios, proyectos y chats. |
| **Generación de Miniaturas** | Puppeteer o `@vercel/og` para captura automatizada de la pantalla del iframe al guardar. |
| **Motor de IA** | Proveedores OpenAI-compatible con streaming y tool calling: Alpha, DeepSeek y MiniMax M3 en GMI Cloud. |

---

### 6. Kit de diseño (para todos)

* **Temas:** 8 temas con paleta, tipografías (Google Fonts) y afinidad de materia/edad propias — `pizarron` (matemática), `cuaderno` (lengua), `laboratorio` (ciencias naturales), `atlas` (sociales), `recreo` (inicial/primer ciclo), `plano` (tecnología/robótica), `noche` (astronomía) y `huerta` (biología/ecología).
* **Declaración y aplicación:** el modelo sólo declara `<meta name="kodu-tema" content="ID">` en el HTML. El servidor inserta el bloque canónico (Tailwind configurado con la paleta del tema, tipografías, Lucide con dibujo automático) al guardar y al emitir el HTML final — el recurso publicado en `/p/[slug]` se ve igual que en el editor. Al armar el prompt, ese mismo bloque se pliega a un comentario corto, así el modelo no repite ~40 líneas en cada turno.
* **Íconos:** sólo Lucide (`<i data-lucide="nombre">`, se dibuja solo), sin otras librerías de íconos.
* **Reglas del prompt** (`src/lib/ai/prompt.ts`): prohibidos los emojis y los degradados en cualquier parte del recurso; nada de cdnjs (bloqueado por la CSP de `/p/`, sólo jsdelivr o unpkg).

---

### 7. Vista previa en vivo y Deshacer (para todos)

* **Progresiva:** la vista previa se arma mientras la IA todavía está escribiendo el HTML (deltas del tool call, decodificados en el cliente), no recién cuando termina el turno completo.
* **Deshacer:** el botón del mensaje de IA más nuevo restaura el HTML anterior a ese turno y lo saca del historial que ve el modelo. Admite varios niveles seguidos, no sólo el último cambio: se guarda una instantánea por turno con cambio real, podada a 20 por proyecto.

---

### 8. Revisión automática y revisión visual

* **Automática:** una pasada de lint (emojis, degradados, íconos de Lucide inexistentes, orígenes de CDN no permitidos) dispara UNA corrección antes de entregarle el recurso al docente. Corre con velocidad "A fondo" o si el admin prendió "Revisión automática para todos"; el primer pase ya se guarda y se muestra en la vista previa mientras corrige.
* **Visual:** una captura del recurso terminado se le manda al modelo para una crítica de diseño, y el resultado reemplaza la vista previa al llegar. Sólo se ofrece con velocidad "A fondo", si el motor está marcado como "Admite imágenes (multimodal)" en `/admin/motores` **y** `AI_VISION=true` en el entorno. Excluyente con varias versiones (con varias versiones no corre, para no triplicar costo y tiempo).

---

### 9. Modo prime

* **Quién lo tiene:** los admins, la cuenta demo, y las cuentas que un admin marque individualmente desde su ficha (`/admin/usuarios/[id]`, interruptor "Acceso prime") — siempre que el interruptor general también esté prendido en `/admin/generacion`.
* **Qué desbloquea:** elegir la velocidad de respuesta, pedir varias versiones al crear un recurso, y usar motores marcados como exclusivos de prime (casilla "Solo modo prime" en el formulario de `/admin/motores`; queda deshabilitada en el motor predeterminado, que nunca puede ser exclusivo).
* **Velocidad — Rápido / A fondo:** Rápido no suma pasadas extra. A fondo sube el razonamiento del modelo (si lo soporta), y suma revisión automática y revisión visual (si el motor ve imágenes). La elección de modelo es independiente de la velocidad: el motor más caro no es necesariamente el más lento.
* **Varias versiones:** hasta 3 generaciones en paralelo con enfoques distintos al crear un recurso (sólo si todavía es el HTML de arranque, no en una edición). La versión 1 se transmite en vivo; las demás aparecen a medida que terminan, como chips para elegir. Elegir una es un pedido aparte (`POST /api/projects/[id]/variant`), no reenvía el HTML por el chat.
* **Discreto:** sin prime, ningún control nuevo aparece en el editor, y la palabra "prime" no figura en ningún lado de la interfaz ni del código fuente que recibe el docente.
* **"Para todos" (capa 1, independiente del interruptor general):** lo que no encarece (el kit, la vista previa progresiva, Deshacer) va para todos sin interruptor. Lo que sí encarece tiene su propio interruptor en `/admin/generacion`, para prenderlo a medida que haya presupuesto de API: "Revisión automática para todos", `"A fondo" para todos` y "Varias versiones para todos".

---

### 10. Migraciones nuevas

SQL puro (producción corre `prisma migrate deploy`, sin `tsx`):

* `20260930000000_regla_librerias_kit` — corrige en datos la regla sembrada "Librerías permitidas por CDN" para que no contradiga al kit (Tailwind/Lucide/confetti a mano).
* `20261001000000_deshacer` — tabla `ProjectSnapshot` y columna `ChatMessage.undoneAt`.
* `20261002000000_modo_prime` — `AppSettings.primeEnabled` / `autoReviewForAll` / `deepModeForAll` / `versionsForAll`, `User.primeAccess`, `AiModel.primeOnly`.
* `20261003000000_versiones_de_recurso` — tabla `ResourceVariant` y columna `ChatMessage.chosenVariantIndex`.

---

### 11. Chequeos de punta a punta con proveedor simulado

* **Por qué:** el repo no tiene test runner, y en desarrollo no siempre hay una clave real de proveedor cargada. `e2e/mock-proveedor.ts` levanta un servidor HTTP liviano que habla el mismo dialecto SSE que un proveedor real (texto, tool call por chunks, cortes de red simulados), sin necesitar ninguna clave.
* **Cómo correrlos:** con la pila de desarrollo levantada (`docker compose up -d db`, `npm run dev` en el puerto 3000), `npx tsx e2e/<archivo>.ts`. Cada script deja o reusa su propio `AiProvider`/`AiModel` mock (`kind: "kodu-mock-t3"`) en la base de desarrollo, para no tener que cargar una key real en cada chequeo.
* **Qué cubren:** `e2e/unidad*.ts` (unitarias con `node:assert`, sin navegador), `e2e/m*.ts` (panel de administración y flujos generales de la plataforma) y `e2e/t3-*.ts` a `e2e/t10-*.ts` (kit, vista previa progresiva, Deshacer, modo prime, velocidad, revisión automática y visual, varias versiones, y la guardia de invariante de `e2e/t10-docente-comun.ts` que confirma que un docente sin marcar ve exactamente lo mismo con el interruptor general de prime apagado o prendido).
