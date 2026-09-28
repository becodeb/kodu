# QA del video final (Taller de ideas + 3D)

Los cuadros se sacaron del MP4 final, ya codificado. `00-hoja-de-contacto.jpg` los reúne a todos.

| Chequeo | Resultado |
|---|---|
| Duración | 56,00 s (debajo del minuto) |
| Formato | 1920×1080, 60 fps, H.264 High, yuv420p, CRF 14 |
| Audio | AAC estéreo 48 kHz, −16,3 LUFS |
| Loop | El primer y el último cuadro son negro puro (diferencia media de 0,0) |
| Clicks con resultado | Verifiqué recortando alrededor del cursor en el cuadro de cada click del Taller y de la galería: «Empezar por acá», campo, dos chips, «Enviar» (pasa a «Kodu está contestando…»), «Elegir esta idea», «Ya está, armá el pedido», «Crear mi recurso» (pasa a «Abriendo el editor…») y los dos corazones (23 → 24 y 13 → 14). |
| Error encontrado y corregido | La burbuja «Me quedo con la idea…» aparecía en el mismo cuadro del click y desplazaba el botón fuera del cursor. Ahora entra 0,3 s después. |
| Error encontrado y corregido | La galería entraba entera con una sola fila de scroll y el segundo tramo quedaba quieto. Pasó a 12 recursos en 4 filas; el recorrido termina en «Estados del agua». |
| Cuadros muertos | No hay. El único tramo de poco movimiento (47,4–48,4 s) es el cursor yendo al segundo corazón. |
