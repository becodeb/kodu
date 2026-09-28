# Demo de producto de Kodu (45 s)

- `kodu-demo.mp4`: el video. 1920×1080, 60 fps, H.264 con CRF 14, audio AAC estéreo, 45,0 s, en loop.
- `storyboard.md`: cada momento con su tiempo, lo que se ve, el cursor, la cámara y el copy.
- `speech.md`: el speech adaptado a los tiempos del video.
- `qa/`: un cuadro por momento, sacados del MP4 final, y el checklist de QA.
- `fuente/`: el código que genera el video.
  - `scene.html` y `scene.js`: la escena. Es una función pura del tiempo, `render(t)`.
  - `render.mjs`: la captura con Playwright.
  - `audio.py`: la música a 120 BPM y los efectos, sincronizados con los eventos de la escena.

## Volver a generarlo

Correr desde `fuente/`, con `playwright`, `numpy`, `pillow` y `ffmpeg` instalados:

```sh
node render.mjs events                      # exporta events.json (clicks, teclas, tics, soplos)
node render.mjs frames 0 2700 frames        # 2700 PNG, unos 3 minutos con 4 páginas en paralelo
python3 audio.py events.json audio.wav 45
ffmpeg -framerate 60 -i frames/f_%05d.png -i audio.wav -c:v libx264 -preset slow -crf 14 \
  -pix_fmt yuv420p -c:a aac -b:a 256k -af loudnorm=I=-16:TP=-1.5 -movflags +faststart kodu-demo.mp4
```

`render.mjs` apunta al Chromium de `/opt/pw-browsers`. Si se corre en otra máquina, cambiá
`executablePath`. Las fuentes (Archivo, Archivo Black, JetBrains Mono y Caveat) son OFL y están en
`fuente/fonts/`.
