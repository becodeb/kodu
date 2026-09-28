# QA del video final (versión 3D)

Los cuadros se sacaron del MP4 final, ya codificado. `00-hoja-de-contacto.jpg` los reúne a todos.

| Chequeo | Resultado |
|---|---|
| Duración | 45,00 s |
| Formato | 1920×1080, 60 fps, H.264 High, yuv420p, CRF 14 |
| Audio | AAC estéreo 48 kHz, −16,1 LUFS |
| Loop | El primer y el último cuadro son negro puro (diferencia media de 0,0) |
| Recurso real | El editor, el celular y la miniatura muestran el mismo `public/demos/estados-del-agua.html`. No es una réplica. |
| Clicks con resultado | Los 12 clicks cambian algo cerca del cursor. Los 2 arrastres también: el slider a 110 °C hace hervir el agua y el frasco gira. «Encender mechero» pasa a «Apagar mechero», se prende la llama y arranca el gráfico. |
| Legibilidad | Temperatura en 38 px dentro del recurso (unos 64 px en pantalla con el zoom). Estados, botón y gráfico quedan en cuadro al menos 3 s. |
| Cuadros muertos | Ninguno fuera de la intro. En la intro hay un empuje lento de cámara y la estrella titila. |
| Error encontrado y corregido | En el celular se ocultaban los botones Sólido / Líquido / Gas y la página no se desplazaba. Se corrigió en el recurso y se volvió a renderizar ese tramo. |
