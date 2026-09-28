# Demo de producto de Kodu · Taller de ideas + recurso 3D (56 s)

Es la versión más completa del demo:

1. **Taller de ideas.** Se eligen las puertas, se contestan las preguntas con chips y Kodu propone
   ideas. La ficha se completa sola hasta llegar a «Tu pedido».
2. **Editor.** El recurso 3D «Estados del agua» (`public/demos/estados-del-agua.html`): se prueba, se
   itera con un mechero y un gráfico, y se ve el código.
3. **Link y celular.** Se copia la URL y el recurso se abre en un celular.
4. **Galería.** Se publica el recurso, se recorre la galería con scroll y se dan dos «me gusta».

- `kodu-demo-taller.mp4`: el video. 1920×1080, 60 fps, H.264 con CRF 14, audio AAC estéreo, 56 s, en loop.
- `storyboard.md`, `speech.md`, `qa/`: storyboard, speech y cuadros de QA.
- `fuente/`: el código que genera el video. Se regenera igual que la versión 3D
  (`../estados-del-agua/README.md`), con 3360 cuadros y `python3 audio.py events.json audio.wav 56`.
