# QA del video final

Los cuadros se sacaron del MP4 final, ya codificado (no de los PNG del render). Hay uno por
momento y `00-hoja-de-contacto.jpg` los reúne a todos.

| Chequeo | Resultado |
|---|---|
| Duración | 45,00 s (menos de 50 s) |
| Formato | 1920×1080, 60 fps, H.264 High, yuv420p, CRF 14, `faststart` |
| Audio | AAC estéreo 48 kHz, 256 kb/s, −16,1 LUFS integrados |
| Loop | El primer y el último cuadro son negro puro (diferencia media de 0,0) |
| Texto legible | Copy de 52 px. La UI va a escala 1,2× y los momentos que se leen tienen zoom de 1,4 a 1,6×: pedido, respuesta de la IA, controles y datos del recurso, código y tarjeta de la galería. |
| Tiempo en pantalla | El pedido, la respuesta, los datos del simulador y la galería quedan quietos 2 s o más |
| Clicks con resultado | Los 13 clicks cambian algo cerca del cursor: foco del campo, burbuja enviada, slider, parábola, botón «Luna», pestaña «Código», «¡Copiada!», interruptor «Publicar», link «Galería» y corazón 23 → 24. Ninguno solo descarga un archivo. |
| Superposiciones | La UI se desvanece bajo el copy con una máscara. El cursor se oculta mientras está el celular. |
| Cuadros muertos | No hay tramos quietos. Donde la imagen se detiene (intro, celular, galería, cierre) hay un empuje lento de cámara. |
| Zoom con texto cambiando | La cámara se mueve solo después de que termina de escribirse o de aparecer el texto |
| Promesas | Todo lo que se muestra existe en Kodu: chat, vista previa, «Código», «Deshacer», «Copiar URL», «Publicar», galería con «me gusta» y «Duplicar», página pública sin cuenta |
