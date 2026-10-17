# Recursos visuales de la landing

- `cell-3d/modelo-v1.glb`: modelo tridimensional propio, generado en Blender, con geometría independiente para las seis estructuras. Paleta lavanda, mitocondrias naranjas y Golgi azul. Incluye corte del núcleo y membranas con volumen.
- `cell-3d/visor-v1.js`: Three.js y visor compilados localmente. Cámara orbital, zoom, selección por geometría, etiquetas proyectadas, sombras y oclusión ambiental. No descarga código desde CDN.
- `celula.webp`: ilustración original de ImageGen (1100 × 1100), conservada como alternativa si falla el modelo o el dispositivo no admite WebGL 2.
- `*-preview.webp`: capturas de los recursos funcionando en un navegador, no imágenes de interfaces ficticias.
- La actividad vive en `public/demos/celula-3d.html`: seis estructuras, comparación y cuatro preguntas con pistas y devolución. No requiere llamadas de IA.

Referencias de contenido: [células eucariotas](https://openstax.org/books/biology-2e/pages/4-3-eukaryotic-cells) y [sistema de endomembranas](https://openstax.org/books/biology-2e/pages/4-4-the-endomembrane-system-and-proteins), OpenStax Biology 2e. Los textos son una adaptación propia para el ejemplo.

El recurso editorial está en `/p/kodu-ejemplo-celula`, la landing y la galería. La copia usa el flujo existente de duplicación, con un proyecto privado y un hilo nuevo. El HTML referencia los assets compartidos. No necesita una cuenta ficticia ni una migración.

## Reconstrucción del 3D

Fuente reproducible: `scripts/cell-3d/generate.py`, Blender 4.5 LTS, semilla fija. Ejecutar `blender --background --python scripts/cell-3d/generate.py` genera el GLB y el archivo editable `output/cell-3d/celula.blend`. El GLB exporta identificadores de organelos y puntos de anclaje como extras. Son formas didácticas, no una reconstrucción microscópica a escala.

El visor se edita en `scripts/cell-3d/viewer.js`. `npm run build:cell-viewer` lo compila; `npm run build` también ejecuta ese paso. Blender sólo es necesario al modificar el modelo, no para construir ni servir Kodu. Modelo: aproximadamente 3,4 MB; 20 mallas agrupadas por estructura/material.

Los assets se sirven mediante `/recursos/celula/`, con una lista cerrada de archivos y CORS público sin credenciales para el iframe aislado del editor. La CSP permite esa ruta para descargar el modelo; sigue bloqueando conexiones hacia la API de Kodu. Versionar nombres y referencias al cambiar assets ya publicados, porque se sirven con caché inmutable.

En desarrollo, `scripts/cell-3d/dev-assets.ts` sirve exclusivamente esos tres archivos mediante la misma lista, antes del bloqueo de peticiones entre orígenes de Astro. Las APIs, archivos de Vite y cualquier otra ruta conservan ese bloqueo. Si se agrega la integración con un servidor ya abierto, reiniciarlo.

El render se detiene en reposo, fuera de pantalla y con la pestaña oculta. Se limita la resolución en pantallas pequeñas. `prefers-reduced-motion` elimina la introducción y las transiciones de cámara. Hay controles de teclado y un selector de estructuras, incluso cuando una etiqueta queda oculta por geometría. La rueda conserva el desplazamiento de la página; el zoom usa botones. El canvas conserva el último frame para las capturas del editor.

## Prompt de la ilustración (ImageGen integrado)

Create a single scientific educational illustration asset for the Kodu website, using the animal-cell visual from the provided approved landing mockup as the visual reference ONLY. Output ONLY a large beautiful detailed 3D-rendered animal cell in cutaway view, no website, no panels, no lettering, no labels, no background objects. Square composition, pure very pale lavender #f4f3ff background (opaque). Whole cell fits with 6% margins. Smooth translucent purple/lilac plasma membrane and pale pink cytoplasm. Large violet spherical nucleus with dark round nucleolus centered at x=54%, y=37%. Orange bean-shaped mitochondrion with clearly visible folded inner cristae at x=27%, y=61%. Stacked blue/cyan curved flattened sacs of Golgi at x=65%, y=70%. Purple layered rough endoplasmic reticulum next to and around nucleus on upper-right x=72%, y=44%, dotted with small ribosomes. Golden lysosome sphere at x=40%, y=77%. Tiny ribosomes in cytoplasm. Scientifically recognizable organelles, no plant cell wall, no chloroplast, no giant central vacuole. Soft studio lighting, rendered tactile volume, lucid contours, refined educational illustration, detailed but not cluttered, match the approved Kodu color palette. No text or arrows. This is an illustrative 3D cutaway, not a microscope image.

## Verificación

`npm run check`, `npm run build`, `npx tsx e2e/landing.ts` y `npx tsx e2e/cell-3d.ts` con servidor de producción local y PostgreSQL. Variables opcionales: `KODU_BASE_URL` y `PLAYWRIGHT_CHANNEL` (por ejemplo, `msedge`). `KODU_CAPTURE_QA=1` comprueba también la captura real del editor y requiere acceso al CDN existente de html-to-image. El E2E de landing crea y elimina su propio usuario de prueba. El de 3D comprueba píxeles visibles, giro, selección geométrica, zoom, teclado, render en reposo, vistas móviles, CSP, sandbox y fallos de carga/WebGL. La emulación móvil no sustituye una medición de rendimiento en teléfonos físicos.
