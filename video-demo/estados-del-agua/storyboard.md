# Kodu · demo 3D «Estados del agua» · storyboard

Tiene la misma estructura, ritmo, copy, audio y dirección que el demo del tiro oblicuo
(`../storyboard.md`). Cambia el recurso: ahora es **«Estados del agua»**
(`public/demos/estados-del-agua.html`), un recurso 3D hecho con three.js y el tema **Laboratorio**
del kit de Kodu (blanco, naranja de seguridad y cobalto, IBM Plex Sans).

El video no muestra una réplica: carga ese mismo HTML en iframes, en el editor, en el celular y en
la miniatura de la galería. Lo maneja cuadro por cuadro con un modo video (`?video`) que avanza la
simulación con pasos fijos, así cada grabación sale idéntica.

**El recurso.** Es un frasco de vidrio con tapa, sobre un trípode, con 64 moléculas de agua: un
oxígeno cobalto y dos hidrógenos blancos, con el ángulo de 104,5°.

- **Sólido:** vibran en una red dentro de un bloque de hielo.
- **Líquido:** se mueven juntas en el fondo, con el agua tenue.
- **Gas:** rebotan por todo el frasco.

El frasco gira solo y se puede arrastrar. El panel tiene la temperatura, el estado (Sólido /
Líquido / Gas) y el movimiento de las partículas. La versión 2 suma un mechero Bunsen con llama y
un gráfico de la temperatura en el tiempo, donde se ven las mesetas de fusión (0 °C) y de
ebullición (100 °C).

| Tiempo | Qué se ve | Cursor | Cámara | Copy |
|---|---|---|---|---|
| 0,0–4,4 | Negro, sube la luz, la K y la estrella que titila. | — | Empuje lento | — |
| 4,4–8,0 | Libreta «Estados del agua · Ciencias · 2.º año». Renglones: «Que vean las partículas en 3D», «Sólido, líquido y gas según la temperatura», «¿Three.js? ¿WebGL? ¿cámara y luces??» y `new THREE.Scene( ) … ???`. Los dos de código se tachan; los pedagógicos quedan subrayados. | — | Fija | «Para crearlo, **hay que programar.**» → «Con Kodu, **se conversa.**» |
| 8,0–13,5 | La libreta se vuelve el editor. Se escribe: «Las partículas del agua en 3D, para 2.º año: que con la temperatura pasen de sólido a líquido y a gas.» Click en «Enviar». | Campo, click, Enviar | Zoom al chat | «Vos explicás. **Kodu programa.**» |
| 14,0–17,0 | «Pensando cómo resolverlo» → «Armando el recurso» → «Probando el recurso…». El recurso aparece por partes: título, frasco 3D girando y controles. | — | Contexto | «En **segundos.**» |
| 17,0–22,3 | La IA contesta. Zoom a la vista previa. El cursor arrastra la temperatura de 20 °C a 110 °C: el agua hierve, las moléculas salen volando y el estado pasa a «Gas». Después arrastra el frasco y lo hace girar. | Arrastra el slider, arrastra el 3D | Zoom 1,4× | «Lo **probás.**» |
| 22,3–25,0 | Se escribe «Sumá un mechero y un gráfico de la temperatura.» y click en «Enviar». | Click, escribe, Enviar | Zoom al chat | «Lo **ajustás.**» |
| 25,8–27,0 | El recurso se recarga: hielo a −20 °C, mechero y gráfico vacío. La IA explica las mesetas. | Va a «Encender mechero» | Vista previa entera | (sigue) |
| 27,0–30,2 | Click en «Encender mechero»: el botón pasa a «Apagar mechero», se prende la llama y la temperatura sube. El gráfico dibuja las dos mesetas mientras el hielo se derrite (0 °C) y el agua hierve (100 °C). | Click y se aparta | Vista previa entera | (sigue) |
| 30,0–31,5 | Click en «Código»: el código three.js y la lógica de las mesetas. | Click | Vista previa | «Sin tocar **el código.**» |
| 31,5–34,6 | «Copiar URL» → «¡Copiada!». Entra el celular con `kodu.becode.com.ar/p/estados-del-agua`: el mismo recurso en columna, girando, con el mechero encendido. | Click, se oculta | Ventana + celular | «Un link, **al aula.**» |
| 35,0–39,9 | «Publicar», después «Galería»: la galería institucional con «Estados del agua» (por Paula Gómez, 0) junto a los de colegas, entre ellos el «Tiro oblicuo». «Me gusta» en «Célula animal en 3D»: 23 → 24. | 3 clicks | Zoom a la tarjeta | «Compartido **entre colegas.**» |
| 40,0–45,0 | La galería se pliega en el ícono, sale la marca Kodu y la bajada «El docente aporta la pedagogía. **Kodu, el código.**» Baja a negro. | — | Empuje lento | — |

Los datos son ficticios: Paula Gómez, los colegas de la galería y la URL de ejemplo.
