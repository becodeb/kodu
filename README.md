## Documento de Especificación: Plataforma Educativa de Creación Asistida por IA

---

### 1. Arquitectura General y Acceso

* **Autenticación restringida:** Registro e inicio de sesión condicionado por lista blanca de dominios de correo electrónico institucionales autorizados (ej. `@rededucativa.edu.ar`).
* **Seguridad de API Keys:** Clave maestra de DeepSeek almacenada exclusivamente como variable de entorno en el backend (`DEEPSEEK_API_KEY`), actuando como proxy seguro.
* **Selector de Modelo:**
* **Default:** `deepseek-v4-flash` (mayor velocidad y menor consumo).
* **Opción avanzada:** Switch a `deepseek-v4-pro` para lógicas pedagógicas o simuladores que requieran mayor capacidad de razonamiento.



---

### 2. Espacio de Trabajo y Editor (Chat + Live Preview)

La vista principal de edición divide la pantalla en dos paneles sincronizados:

```
┌──────────────────────────────────────┬──────────────────────────────────────┐
│  PANEL IZQUIERDO: CHAT Y CONTROL     │  PANEL DERECHO: VISOR Y CÓDIGO       │
│                                      │                                      │
│  [ Historial ] [ Nuevo Chat ]        │  Tabs: [ Vista Previa ] [ Código ]   │
│  Selector: (o) Flash  ( ) Pro        │  URL Pública: red.edu/p/xyz123 [🔗]  │
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
| **Motor de IA** | API de DeepSeek (`/chat/completions` con streaming y context caching). |
