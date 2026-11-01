# Colección Misiones 3D — brief común (3.er año de Secundaria, Argentina)

Seis videojuegos matemáticos independientes para la docente **vgerstner** (Kodu). Cada uno es
**un único archivo HTML autocontenido** que se va a guardar como recurso de Kodu y se muestra dentro de
un iframe `sandbox="allow-scripts"` (sin allow-same-origin). Tomamos como referencia "Misión Thales"
(escenarios 3D, interacción con estructuras, cartel de fundamentación en papel), sin repetir su contexto
del puente de Thales.

## Archivos

- `base.html` — motor común YA PROBADO. **Copialo** a `<tu-juego>.html` y reemplazá sólo el bloque
  `const JUEGO = {...}` del final (y las variables CSS `--acento`, `--acento-2` en `:root` para darle
  identidad propia). No edites `base.html`. Si encontrás un bug del motor, arreglalo en tu copia y
  contalo en tu informe final.
- `probar.mjs` — prueba automática con Playwright. Ya hay un servidor estático corriendo en
  `http://127.0.0.1:8765` sirviendo esta carpeta. Desde `C:\Users\gonib\Downloads\Kodu`:
  `node experimentos/juegos-3ro/probar.mjs <tu-juego>.html` → capturas en
  `experimentos/juegos-3ro/capturas/<tu-juego>/` (miralas con Read: son tu forma de ver el juego).
  Tiene que terminar en `TODO OK`, sin errores de consola.

## Restricciones técnicas

- Three.js 0.170 por import map desde jsdelivr (ya está en la base). Sólo CDNs permitidos:
  `cdn.jsdelivr.net`, `unpkg.com`, Google Fonts. Nada de imágenes externas: todo modelado con primitivas
  low-poly, canvas o SVG.
- `localStorage` tira excepción en el iframe: usá sólo `guardar/leer` de la base (ya tienen try/catch).
- Tamaño: el HTML entero tiene que quedar **por debajo de 250 000 caracteres** (Kodu corta en 400 000).
- Sin Tailwind ni `<meta name="kodu-tema">` (si no, Kodu le inyecta su kit de estilos).
- Debe verse completo, sin scroll de página, en 1280×800, y usarse en celular (la base ya pone el panel abajo).
- Español rioplatense con voseo ("registrá", "arrastrá", "usá"), tono para chicos de 14-15 años.

## API del motor (lo que usa `JUEGO`)

```js
const JUEGO = {
  id: 'slug-unico', titulo, subtitulo, icono: 'R',  // icono: 1 carácter en la barra
  kicker, portada /* html */, contenidos: ['...'], final: { titulo, texto },
  escenaBase(K) { /* cielo, suelo, decorado permanente: se llama una vez */ },
  niveles: [{
    titulo, relato /* html */, objetivo /* html */,
    tituloMat, subMat,              // cabecera de la vista matemática
    textoComprobar,                 // opcional, texto del botón (por defecto "Comprobar")
    armar(K) { /* crea objetos con K.agregar, controles en el panel, cámara; guardá estado en this */ },
    comprobar(K) { return { ok, msg } },          // o { parcial:true, ok, msg } para pasos intermedios
    alResolver(K) { /* animación de éxito; devolvé ms antes de abrir la bitácora */ },
    pistas: ['...', '...', '...'],  // html o (K)=>html; graduales
    bitacora: ['...', '...', '...'],// preguntas de fundamentación
    resumenBitacora(K) { return 'html con lo que resolvió' },
    mat(K, el) { /* dibuja la representación matemática en el div el (SVG, fórmulas) */ },
    alCambiarModo(K, esMat) {},     // opcional: p. ej. mostrar ejes/grilla en la escena 3D
    prueba: { mal: [K=>{...}, ...], bien(K){...} }, // para probar.mjs: setean el estado/inputs
  }],
};
```

Dentro de `armar/comprobar/mat/prueba`, `this` es el nivel: guardá ahí refs a objetos e inputs.
Helpers de `K`: `agregar, tic(dt,t), alLimpiar, camara(pos, mira, {min,max}), etiqueta(html, pos, clase, padre)`,
`mat(color), caja, cilindro, esfera, linea, barra(a,b,radio,color), arbol, roca, persona, suelo, cielo`,
`arrastrable(obj, {ejes:'xz', snap, limites:{x:[a,b]}, alMover, alSoltar, activo})`, `clicable(obj, fn)`,
panel: `campoNumero, deslizador, opciones, datos, html, mensaje(txt,'ok'|'error'|'info'), toast`,
vista matemática: `refrescarMat()` (llamalo cuando cambie el estado), `planoCartesiano({...}) → {svg,X,Y,g}`,
exactos: `frac, leerFrac('3/4'|'1,5'), igualFrac, num(input), fmt`. `K.THREE`, `K.scene`, `K.camera`,
`K.controls`, `K.h` (crear DOM), `K.s` (crear SVG). Todo lo que cuelga de `K.agregar` se limpia solo al
cambiar de nivel. El motor maneja niveles, desbloqueo, pistas, intentos, bitácora, portada y final;
`#docente` en la URL abre todos los niveles (para que la docente revise).

## Requisitos pedagógicos (obligatorios en los seis)

1. Escenario tridimensional real con Three.js: cámara, iluminación, objetos, animaciones. Que se vea
   lindo y con identidad propia (paleta, cielo, decorado) — no un cubo en un plano verde.
2. Cuatro niveles con dificultad progresiva y problemas matemáticos contextualizados, con **datos
   numéricos concretos y coherentes** que inventás vos. Verificá a mano cada cuenta.
3. Interacción auténtica: arrastrar, construir, ubicar, comparar, corregir, medir o ajustar objetos en
   la escena 3D. No alcanza con un formulario: lo que el alumno decide se ve y tiene consecuencias.
4. Validación matemática real y exacta: nada de aceptar aproximaciones arbitrarias ni de pasar por
   completar una animación. Usá grillas con imán, enteros o fracciones exactas. Los mensajes de error
   diagnostican el error típico (p. ej. "repartiste en partes iguales, no en proporción a…") sin dar
   el resultado.
5. Pistas graduales (3 por nivel): de orientación general → estrategia → paso concreto. Ninguna dice
   la respuesta final.
6. Pantalla final obligatoria en cada nivel = la **bitácora** de la base. 3 preguntas de fundamentación
   propias del nivel (procedimiento, conceptos y por qué, cómo comprobar), **sin respuestas modelo
   visibles**.
7. El siguiente nivel se desbloquea sólo después de resolver y confirmar el registro escrito (ya lo hace
   la base; la confirmación no evalúa la justificación).
8. Modo **aventura** y modo **matemático**: el matemático muestra, sincronizado en vivo con lo que pasa
   en la escena, la representación geométrica o algebraica (plano cartesiano, triángulos con medidas,
   tablas, ecuaciones). Es la conexión entre el mundo y la matemática: cuidalo tanto como la escena.
9. No se puede superar un nivel sin usar el conocimiento previsto: evitá que se gane probando al azar
   (espacio de respuestas grande, varias condiciones a la vez, o pedir el valor además de construirlo).

## Criterios de calidad antes de darlo por terminado

- Se juega de verdad en 3D (miralo en las capturas: si algo se ve vacío, tapado o feo, arreglalo).
- Cada nivel es matemáticamente correcto y resoluble; `prueba.bien` lo resuelve y cada `prueba.mal`
  (al menos 2 por nivel, errores típicos) es rechazado.
- La matemática es la herramienta que el alumno necesita para transformar lo que pasa en el escenario,
  no un obstáculo entre dos escenas lindas.
- `probar.mjs` da `TODO OK` y sin errores de consola.

## Informe final (tu respuesta)

Corto: archivo, tamaño, los datos y la respuesta de cada nivel (para la docente), qué se arregló del
motor si algo, y cualquier cosa que no hayas podido verificar.
