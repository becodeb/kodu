# SPEC.md - KoduEdu / Plataforma de Creación Asistida por IA para Docentes

## 1. Visión del Proyecto
Plataforma web donde docentes sin conocimientos técnicos pueden crear recursos didácticos interactivos (quizzes, simuladores, calculadoras, flashcards) mediante un chat con IA (DeepSeek). El sistema genera aplicaciones web autoportantes (Single-File HTML/CSS/JS) con renderizado en tiempo real dentro de un iframe aislado, permitiendo publicación inmediata y visualización en una galería comunitaria.

---

## 2. Stack Tecnológico
* **Framework:** Astro (Modo SSR: `output: 'server'`) con componentes interactivos en **React** y **Tailwind CSS**.
* **Base de Datos & ORM:** PostgreSQL / SQLite gestionado con **Prisma ORM**.
* **Autenticación:** Sistema de sesiones basado en cookies/JWT con validación estricta de dominios de email institucionales autorizados (lista blanca configurable por ENV).
* **Motor de IA:** API de DeepSeek (`deepseek-v4-flash` por defecto y switch a `deepseek-v4-pro`).
* **Protocolo de Streaming:** Estándar OpenAI-compatible SSE (`Server-Sent Events`) con **Tool Calling (`update_resource_code`)** para separar limpiamente la conversación del código generado.
* **Almacenamiento de Archivos:** Carpeta pública local (`/uploads`) servida estáticamente o volumen de Docker montado.

---

## 3. Arquitectura del Modelo de Datos (Prisma Schema)

```prisma
datasource db {
  provider = "postgresql" // o "sqlite"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  DOCENTE
  ADMIN
}

enum ModelChoice {
  FLASH
  PRO
}

model User {
  id            String         @id @default(uuid())
  email         String         @unique
  passwordHash  String
  name          String
  role          Role           @default(DOCENTE)
  createdAt     DateTime       @default(now())
  projects      Project[]
  rules         CustomRule[]
}

model Project {
  id             String         @id @default(uuid())
  title          String         @default("Nuevo Recurso")
  description    String?
  slug           String         @unique
  currentHtml    String         @default("<!DOCTYPE html><html><head><meta charset='UTF-8'><script src='[https://cdn.tailwindcss.com](https://cdn.tailwindcss.com)'></script></head><body class='p-6 text-center text-gray-700 font-sans'><p>Tu recurso aparecerá acá...</p></body></html>")
  screenshotUrl  String?
  isInGallery    Boolean        @default(false)
  selectedModel  ModelChoice    @default(FLASH)
  userId         String
  user           User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  threads        ChatThread[]
  assets         ProjectAsset[]
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
}

model ChatThread {
  id          String        @id @default(uuid())
  title       String        @default("Conversación")
  projectId   String
  project     Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  messages    ChatMessage[]
  createdAt   DateTime      @default(now())
}

model ChatMessage {
  id          String      @id @default(uuid())
  threadId    String
  thread      ChatThread  @relation(fields: [threadId], references: [id], onDelete: Cascade)
  role        String      // "user" | "assistant" | "system"
  content     String
  attachments String?     // URLs de archivos o PDFs parseados
  createdAt   DateTime    @default(now())
}

model CustomRule {
  id          String   @id @default(uuid())
  title       String
  content     String
  isGlobal    Boolean  @default(false) // Solo admins crean reglas globales base
  isActive    Boolean  @default(true)
  userId      String?  // Null si es global
  user        User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())
}

model ProjectAsset {
  id        String   @id @default(uuid())
  projectId String
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  filename  String
  url       String
  fileType  String   // "image" | "pdf"
  createdAt DateTime @default(now())
}

```

---

## 4. Protocolo de Comunicación con la IA

### 4.1. Tool Calling para Separación de Código y Chat

Para evitar que el código se muestre en el flujo de texto del chat, la API de DeepSeek utiliza una definición de función estructurada:

```json
{
  "name": "update_resource_code",
  "description": "Actualiza el código HTML completo autoportante del recurso interactivo que se muestra en el iframe.",
  "parameters": {
    "type": "object",
    "properties": {
      "html": {
        "type": "string",
        "description": "El documento HTML5 completo autoportante con CSS (Tailwind CDN) y JS embebido."
      }
    },
    "required": ["html"]
  }
}

```

### 4.2. Flujo de Inyección de Contexto y Reglas

En cada llamada a la API, el backend concatena:

1. **System Prompt Base del Sistema:** Instrucciones de formato, librerías permitidas por CDN (Tailwind, KaTeX, Canvas-Confetti, Chart.js, Lucide Icons) y manejo seguro de scripts.
2. **Reglas Globales Activas (Configuradas por Admins):** Directivas para evitar errores comunes, fijar estándares pedagógicos y asegurar accesibilidad.
3. **Reglas del Docente Activas (User Rules):** Preferencias personales togglables desde su perfil.
4. **Contexto de Archivos/Assets:** Lista de imágenes subidas con su URL pública (`/uploads/assets/...`) para que la IA sepa usarlas en etiquetas `<img src="...">`, y texto extraído de PDFs adjuntos.
5. **Historial de la conversación activa (`ChatThread`).**

---

## 5. Módulos y Flujos de la Aplicación

### 5.1. Editor / Workspace (`/app/project/[id]`)

* **Panel Izquierdo:**
* Selector de Modelo (`Flash` / `Pro`).
* Selector / Creador de hilos de chat (`ChatThread`) para reiniciar conversaciones sin perder el código del proyecto.
* Input de chat con soporte para arrastrar o adjuntar archivos (Imágenes y PDFs).
* Mensajes de la IA mostrados en streaming limpio (solo explicaciones textuales).


* **Panel Derecho:**
* Tabs: **[Vista Previa]** e **[Inspeccionar/Editar Código]** (con Monaco Editor o CodeMirror).
* Renderizador reactivo: `iframe` aislado que actualiza su `srcdoc` cada vez que el tool call finaliza o se edita manualmente.
* Botón para abrir la URL pública en pestaña nueva.



### 5.2. Panel de Publicación y Capturas

* Botón para alternar visibilidad: **"Publicar en Galería"**.
* Módulo de captura manual: Botón **"Tomar Captura"** que usa `html-to-image` o `html2canvas` sobre el iframe para generar un snapshot WebP/PNG, previsualizarlo, borrarlo o actualizarlo a demanda antes de listar el recurso en la galería.

### 5.3. Galería Comunitaria (`/gallery`)

* Grilla de recursos con switch público activo.
* Tarjetas con captura de pantalla, título, autor, descripción corta y botón para probar a pantalla completa o duplicar el recurso.

### 5.4. Visualización Pública (`/p/[slug]`)

* Ruta ligera y responsive que sirve directamente el código HTML almacenado sin barras de navegación ni paneles de edición, pensada para proyectores o dispositivos de alumnos.

---

## 6. Docker & Despliegue

### `docker-compose.yml` (Entorno de Desarrollo)

* Mapea puertos al host (`3000:3000`, `5432:5432`).
* Monta volúmenes para hot-reloading de código y persistencia local de `/uploads`.

### `docker-compose.prod.yml` (Producción)

* **No expone puertos directamente al host exterior**; se conecta a una red interna de Docker (`reverse_proxy_network`) para ser servido a través de Nginx/Traefik.
* Variables de entorno inyectadas de forma segura.
* Volumen persistente montado en `/app/uploads` y base de datos.
