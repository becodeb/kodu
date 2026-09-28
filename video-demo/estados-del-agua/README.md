# Demo de producto de Kodu · versión 3D «Estados del agua» (45 s)

Tiene la misma estructura que el demo del tiro oblicuo (`../`). El recurso de ejemplo es 3D, hecho
con three.js y el tema **Laboratorio** del kit de Kodu. El recurso en sí vive en
`public/demos/estados-del-agua.html`, anda solo en el navegador y el video lo muestra tal cual.

- `kodu-demo-3d.mp4`: el video. 1920×1080, 60 fps, H.264 con CRF 14, audio AAC estéreo, 45,0 s, en loop.
- `storyboard.md`: cada momento con su tiempo, lo que se ve, el cursor, la cámara y el copy.
- `speech.md`: el speech ajustado a este ejemplo.
- `qa/`: un cuadro por momento, sacados del MP4 final, y el checklist de QA.
- `fuente/`: el código que genera el video.

## Volver a generarlo

Correr desde `fuente/`, con `playwright`, `three@0.170.0`, `numpy`, `pillow` y `ffmpeg` instalados:

```sh
cp ../../../public/demos/estados-del-agua.html res/
python3 -m http.server 8765 &     # los iframes tienen que ser del mismo origen que la escena
node thumb.mjs                    # miniatura del recurso para la galería
node render.mjs events
node render.mjs frames 0 2700 frames    # unos 10 minutos: el WebGL corre por software
python3 audio.py events.json audio.wav 45
ffmpeg -framerate 60 -i frames/f_%05d.png -i audio.wav -c:v libx264 -preset slow -crf 14 \
  -pix_fmt yuv420p -c:a aac -b:a 256k -af loudnorm=I=-16:TP=-1.5 -movflags +faststart kodu-demo-3d.mp4
```

`common.mjs` sirve three.js y las fuentes desde el disco, así el render no depende de la red.
Con `?video`, el recurso deja de animarse solo y expone `window.__video.configurar(acciones)` y
`window.__video.cuadro(t)`. La simulación avanza con pasos fijos de 1/60 s, así que dos
grabaciones salen idénticas.
