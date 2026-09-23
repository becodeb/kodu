import assert from 'node:assert/strict';
import { revisarHtml, type Hallazgo } from '../src/lib/ai/revision.ts';
import { aplicarKit, bloqueKit } from '../src/lib/ai/kit.ts';

/**
 * Pruebas unitarias de la revisión automática (src/lib/ai/revision.ts) —
 * tarea T7 de odd/tasks/modo-prime.md.
 *
 * Archivo separado, sin base de datos, mismo patrón que e2e/unidad-kit.ts:
 * `revisarHtml` es un módulo puro (nada de Prisma, nada de red) y no hace
 * falta levantar nada para probarlo. `node:assert/strict` + `tsx`. Ejecutar
 * con:
 *   npx tsx e2e/unidad-revision.ts
 */

let fallas = 0;

async function prueba(nombre: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✔ ${nombre}`);
  } catch (error) {
    fallas++;
    console.error(`✖ ${nombre}`);
    console.error(`  ${(error as Error).message}`);
  }
}

function porCodigo(hallazgos: Hallazgo[], codigo: Hallazgo['codigo']): Hallazgo | undefined {
  return hallazgos.find((h) => h.codigo === codigo);
}

/** Un documento con el kit YA aplicado — así llega el HTML a `revisarHtml` en `stream.ts` (después de `aplicarKitAlTurno`). */
function documentoBase(cuerpo: string, tema = 'pizarron'): string {
  return aplicarKit(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="kodu-tema" content="${tema}">
</head>
<body>
${cuerpo}
</body>
</html>`);
}

// ─────────────────────────────────────────────────────────────
// emojis
// ─────────────────────────────────────────────────────────────

await prueba('emojis: cuenta ocurrencias y da los distintos como ejemplos', () => {
  const html = documentoBase('<p>Genial 🎉 mirá esto ✨ de nuevo 🎉</p>');
  const hallazgo = porCodigo(revisarHtml(html), 'emojis');
  assert.ok(hallazgo, 'debería reportar emojis');
  assert.equal(hallazgo!.ejemplos!.length, 2, 'sólo distintos, no cada ocurrencia (🎉 aparece dos veces)');
  assert.ok(hallazgo!.ejemplos!.includes('🎉'));
  assert.ok(hallazgo!.ejemplos!.includes('✨'));
});

await prueba('emojis: tope de 5 ejemplos distintos', () => {
  const emojis = ['🎉', '✨', '🚀', '🎊', '🔥', '🌟', '💡'];
  const html = documentoBase(`<p>${emojis.join(' ')}</p>`);
  const hallazgo = porCodigo(revisarHtml(html), 'emojis')!;
  assert.equal(hallazgo.ejemplos!.length, 5);
});

await prueba('emojis: falso positivo conocido — © ® ™ NO cuentan (Extended_Pictographic, pero son prosa legítima)', () => {
  const html = documentoBase('<p>Todos los derechos reservados © 2026. Marca registrada ® y ™.</p>');
  assert.equal(porCodigo(revisarHtml(html), 'emojis'), undefined);
});

await prueba('emojis: dígitos sueltos NO cuentan (base de secuencias "keycap")', () => {
  const html = documentoBase('<p>El triple de 3 es 9, y 2 más 2 es 4.</p>');
  assert.equal(porCodigo(revisarHtml(html), 'emojis'), undefined);
});

await prueba('emojis: falso positivo — dentro de un comentario HTML no cuentan', () => {
  const html = documentoBase('<p>Texto normal, sin nada raro.</p><!-- nota interna: agregar más ✨🎉 después -->');
  assert.equal(porCodigo(revisarHtml(html), 'emojis'), undefined);
});

await prueba('emojis: SÍ cuentan dentro de un <script> (BASE_PROMPT prohíbe emojis también en cadenas de JS)', () => {
  const html = documentoBase('<script>alert("🎉 ganaste");</script>');
  assert.ok(porCodigo(revisarHtml(html), 'emojis'));
});

// ─────────────────────────────────────────────────────────────
// degradados
// ─────────────────────────────────────────────────────────────

await prueba('degradados: función CSS en <style>', () => {
  const html = documentoBase('<style>.hero{background:linear-gradient(90deg,#111,#222)}</style><div class="hero"></div>');
  const hallazgo = porCodigo(revisarHtml(html), 'degradados');
  assert.ok(hallazgo);
  assert.ok(hallazgo!.ejemplos!.some((e) => e.includes('linear-gradient')));
});

await prueba('degradados: función CSS en style=""', () => {
  const html = documentoBase('<div style="background: radial-gradient(circle, red, blue)"></div>');
  assert.ok(porCodigo(revisarHtml(html), 'degradados'));
});

await prueba('degradados: clases de Tailwind bg-gradient-to-*, bg-linear-* y bg-radial*', () => {
  const html = documentoBase(
    '<div class="bg-gradient-to-r from-blue-500 to-purple-600"></div>' +
      '<div class="bg-linear-to-tr"></div>' +
      '<div class="bg-radial"></div>',
  );
  const hallazgo = porCodigo(revisarHtml(html), 'degradados')!;
  assert.ok(hallazgo);
  assert.ok(hallazgo.ejemplos!.includes('bg-gradient-to-r'));
  assert.ok(hallazgo.ejemplos!.includes('bg-linear-to-tr'));
  assert.ok(hallazgo.ejemplos!.includes('bg-radial'));
});

await prueba('degradados: falso positivo — <linearGradient>/<radialGradient> de SVG están permitidos (ilustración)', () => {
  const html = documentoBase(`
    <svg viewBox="0 0 100 100">
      <defs>
        <linearGradient id="cielo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#123"></stop>
          <stop offset="100%" stop-color="#456"></stop>
        </linearGradient>
        <radialGradient id="sol"><stop offset="0%" stop-color="#fff"></stop></radialGradient>
      </defs>
      <rect width="100" height="100" fill="url(#cielo)"></rect>
    </svg>`);
  assert.equal(porCodigo(revisarHtml(html), 'degradados'), undefined);
});

// ─────────────────────────────────────────────────────────────
// sin_tema
// ─────────────────────────────────────────────────────────────

await prueba('sin_tema: recurso nuevo sin <meta kodu-tema> válido', () => {
  const html = '<!DOCTYPE html><html><head></head><body><h1>Hola</h1></body></html>';
  assert.ok(porCodigo(revisarHtml(html), 'sin_tema'));
});

await prueba('sin_tema: recurso nuevo CON tema válido no se informa', () => {
  const html = documentoBase('<h1>Hola</h1>');
  assert.equal(porCodigo(revisarHtml(html), 'sin_tema'), undefined);
});

await prueba('sin_tema: un recurso EXISTENTE sin tema no se le exige (REGLA MÁS IMPORTANTE: no reescribir lo que ya hay)', () => {
  const previo = '<!DOCTYPE html><html><head></head><body><h1>Recurso viejo, de antes del kit</h1></body></html>';
  const actual = '<!DOCTYPE html><html><head></head><body><h1>Recurso viejo, con un cambio chico</h1></body></html>';
  assert.equal(porCodigo(revisarHtml(actual, { anterior: previo }), 'sin_tema'), undefined);
});

// ─────────────────────────────────────────────────────────────
// iconos_inexistentes
// ─────────────────────────────────────────────────────────────

await prueba('iconos_inexistentes: un nombre inventado se reporta, uno real no', () => {
  const html = documentoBase('<i data-lucide="check"></i><i data-lucide="banana-inventada-3000"></i>');
  const hallazgo = porCodigo(revisarHtml(html), 'iconos_inexistentes')!;
  assert.ok(hallazgo);
  assert.deepEqual(hallazgo.ejemplos, ['banana-inventada-3000']);
});

await prueba('iconos_inexistentes: un recurso sin data-lucide inválido no reporta nada', () => {
  const html = documentoBase('<i data-lucide="check"></i><i data-lucide="star"></i>');
  assert.equal(porCodigo(revisarHtml(html), 'iconos_inexistentes'), undefined);
});

// ─────────────────────────────────────────────────────────────
// kit_duplicado
// ─────────────────────────────────────────────────────────────

await prueba('kit_duplicado: tailwind.config, cdn.tailwindcss.com y Lucide declarados AFUERA del bloque se reportan', () => {
  const html = documentoBase(
    '<script>tailwind.config = {};</script>' +
      '<script src="https://cdn.tailwindcss.com"></script>' +
      '<script src="https://cdn.jsdelivr.net/npm/lucide@1.40.0/dist/umd/lucide.min.js"></script>',
  );
  const hallazgo = porCodigo(revisarHtml(html), 'kit_duplicado')!;
  assert.ok(hallazgo);
  assert.ok(hallazgo.ejemplos!.includes('tailwind.config'));
  assert.ok(hallazgo.ejemplos!.includes('script de cdn.tailwindcss.com'));
  assert.ok(hallazgo.ejemplos!.includes('script de Lucide'));
});

await prueba('kit_duplicado: falso positivo — el contenido DEL bloque del kit no se autodispara', () => {
  // El bloque canónico solo: tiene tailwind.config, cdn.tailwindcss.com y
  // Lucide adentro por definición — si esto disparara, la revisión se
  // pelearía consigo misma en CADA recurso.
  assert.equal(porCodigo(revisarHtml(bloqueKit('pizarron')), 'kit_duplicado'), undefined);
  // Un documento normal con el kit aplicado y nada más agregado, tampoco.
  const html = documentoBase('<h1>Hola</h1>');
  assert.equal(porCodigo(revisarHtml(html), 'kit_duplicado'), undefined);
});

// ─────────────────────────────────────────────────────────────
// origen_bloqueado
// ─────────────────────────────────────────────────────────────

await prueba('origen_bloqueado: script, hoja de estilos y @import de orígenes fuera de la lista', () => {
  const html = documentoBase(`
    <script src="https://cdnjs.cloudflare.com/ajax/libs/confetti/1.0/confetti.js"></script>
    <link rel="stylesheet" href="https://example.com/estilos.css">
    <style>@import url(https://otra-cdn.net/reset.css);</style>
  `);
  const hallazgo = porCodigo(revisarHtml(html), 'origen_bloqueado')!;
  assert.ok(hallazgo);
  assert.ok(hallazgo.ejemplos!.includes('https://cdnjs.cloudflare.com'));
  assert.ok(hallazgo.ejemplos!.includes('https://example.com'));
  assert.ok(hallazgo.ejemplos!.includes('https://otra-cdn.net'));
});

await prueba('origen_bloqueado: falso positivo — el kit (jsdelivr, tailwindcss, googleapis, gstatic) no se autodispara', () => {
  const html = documentoBase('<h1>Hola</h1>');
  assert.equal(porCodigo(revisarHtml(html), 'origen_bloqueado'), undefined);
});

await prueba('origen_bloqueado: compara por ORIGEN exacto, no por "empieza con" (host parecido pero ajeno)', () => {
  const html = documentoBase('<script src="https://cdn.jsdelivr.net.evil.com/malo.js"></script>');
  const hallazgo = porCodigo(revisarHtml(html), 'origen_bloqueado')!;
  assert.ok(hallazgo);
  assert.ok(hallazgo.ejemplos!.includes('https://cdn.jsdelivr.net.evil.com'));
});

await prueba('origen_bloqueado: un <link> que no es stylesheet (preconnect) no se revisa', () => {
  const html = documentoBase('<link rel="preconnect" href="https://ejemplo-ajeno.com">');
  assert.equal(porCodigo(revisarHtml(html), 'origen_bloqueado'), undefined);
});

// ─────────────────────────────────────────────────────────────
// texto_largo
// ─────────────────────────────────────────────────────────────

await prueba('texto_largo: más de 45 palabras en un bloque se reporta con un extracto corto', () => {
  const parrafo = Array.from({ length: 60 }, (_, i) => `palabra${i}`).join(' ');
  const html = documentoBase(`<p>${parrafo}</p>`);
  const hallazgo = porCodigo(revisarHtml(html), 'texto_largo')!;
  assert.ok(hallazgo);
  assert.equal(hallazgo.ejemplos!.length, 1);
  assert.ok(hallazgo.ejemplos![0]!.length < parrafo.length, 'el extracto tiene que ser corto, no el bloque entero');
});

await prueba('texto_largo: 45 palabras exactas no dispara (el borde: "over 45")', () => {
  const parrafo = Array.from({ length: 45 }, (_, i) => `p${i}`).join(' ');
  const html = documentoBase(`<p>${parrafo}</p>`);
  assert.equal(porCodigo(revisarHtml(html), 'texto_largo'), undefined);
});

await prueba('texto_largo: hasta 3 extractos, no más', () => {
  // Cuatro bloques con palabras DISTINTAS entre sí (no sólo un sufijo al
  // final): el extracto son las primeras 14 palabras, así que si sólo
  // cambiara el final los cuatro extractos serían idénticos y se
  // deduplicarían solos — eso probaría otra cosa (dedupe de repetidos), no
  // el tope de 3.
  const bloque = (letra: string) => Array.from({ length: 50 }, (_, i) => `${letra}${i}`).join(' ');
  const html = documentoBase(
    `<p>${bloque('a')}</p><p>${bloque('b')}</p><p>${bloque('c')}</p><p>${bloque('d')}</p>`,
  );
  const hallazgo = porCodigo(revisarHtml(html), 'texto_largo')!;
  assert.equal(hallazgo.ejemplos!.length, 3);
});

// ─────────────────────────────────────────────────────────────
// relleno
// ─────────────────────────────────────────────────────────────

await prueba('relleno: bienvenida, "Tip:", "Hecho con" y "¿Sabías que…?" se detectan', () => {
  const html = documentoBase(`
    <p>¡Bienvenidos a la clase de hoy!</p>
    <p>Tip: repasá la tabla del 7 antes de empezar.</p>
    <p>Hecho con mucho cariño para vos.</p>
    <p>¿Sabías que el agua se congela a 0°?</p>
  `);
  const hallazgo = porCodigo(revisarHtml(html), 'relleno')!;
  assert.ok(hallazgo);
  assert.equal(hallazgo.ejemplos!.length, 4);
});

await prueba('relleno: case-insensitive', () => {
  const html = documentoBase('<p>BIENVENIDOS al repaso. tip: prestá atención.</p>');
  assert.ok(porCodigo(revisarHtml(html), 'relleno'));
});

await prueba('relleno: el "Tip:" de un comentario de código no cuenta (no es texto visible)', () => {
  const html = documentoBase('<script>// Tip: esto es un comentario para otro programador\nconsole.log(1);</script>');
  assert.equal(porCodigo(revisarHtml(html), 'relleno'), undefined);
});

await prueba('un recurso limpio no reporta nada', () => {
  const html = documentoBase('<h1>Repasemos las fracciones</h1><p class="text-suave">Elegí la respuesta correcta.</p>');
  assert.deepEqual(revisarHtml(html), []);
});

// ─────────────────────────────────────────────────────────────
// "Sólo lo que este turno introdujo" (comportamiento de diff con `anterior`)
// ─────────────────────────────────────────────────────────────

await prueba('diff: un emoji que YA estaba no dispara una corrección nueva', () => {
  const previo = documentoBase('<p>Ya tenía un emoji 🎉 de antes.</p>');
  const actual = documentoBase('<p>Ya tenía un emoji 🎉 de antes. Y algo más de texto sin nada raro.</p>');
  assert.equal(porCodigo(revisarHtml(actual, { anterior: previo }), 'emojis'), undefined);
});

await prueba('diff: un emoji NUEVO sí se informa, aunque ya hubiera otro antes', () => {
  const previo = documentoBase('<p>Ya tenía un emoji 🎉 de antes.</p>');
  const actual = documentoBase('<p>Ya tenía un emoji 🎉 de antes. Y ahora ✨ también.</p>');
  const hallazgo = porCodigo(revisarHtml(actual, { anterior: previo }), 'emojis')!;
  assert.ok(hallazgo);
  assert.deepEqual(hallazgo.ejemplos, ['✨']);
});

await prueba('diff: un ícono inexistente que YA estaba no se repite; uno nuevo sí', () => {
  const previo = documentoBase('<i data-lucide="viejo-invalido"></i>');
  const actual = documentoBase('<i data-lucide="viejo-invalido"></i><i data-lucide="nuevo-invalido"></i>');
  const hallazgo = porCodigo(revisarHtml(actual, { anterior: previo }), 'iconos_inexistentes')!;
  assert.ok(hallazgo);
  assert.deepEqual(hallazgo.ejemplos, ['nuevo-invalido']);
});

await prueba('diff: un bloque de texto largo que YA estaba no se repite', () => {
  const bloque = Array.from({ length: 50 }, (_, i) => `w${i}`).join(' ');
  const previo = documentoBase(`<p>${bloque}</p>`);
  const actual = documentoBase(`<p>${bloque}</p><p>Corto.</p>`);
  assert.equal(porCodigo(revisarHtml(actual, { anterior: previo }), 'texto_largo'), undefined);
});

await prueba('diff: un origen bloqueado nuevo se informa aunque ya hubiera otro antes', () => {
  const previo = documentoBase('<script src="https://cdnjs.cloudflare.com/viejo.js"></script>');
  const actual = documentoBase(
    '<script src="https://cdnjs.cloudflare.com/viejo.js"></script><script src="https://otra.net/nuevo.js"></script>',
  );
  const hallazgo = porCodigo(revisarHtml(actual, { anterior: previo }), 'origen_bloqueado')!;
  assert.ok(hallazgo);
  assert.deepEqual(hallazgo.ejemplos, ['https://otra.net']);
});

await prueba('diff: `anterior` vacío o null se trata igual que recurso nuevo (se informa TODO)', () => {
  const html = documentoBase('<p>Con emoji 🎉.</p>');
  const sinAnterior = revisarHtml(html).map((h) => h.codigo);
  const anteriorVacio = revisarHtml(html, { anterior: '' }).map((h) => h.codigo);
  const anteriorNull = revisarHtml(html, { anterior: null }).map((h) => h.codigo);
  assert.deepEqual(sinAnterior, anteriorVacio);
  assert.deepEqual(sinAnterior, anteriorNull);
});

await prueba('revisarHtml no explota con HTML vacío: sólo informa sin_tema', () => {
  const hallazgos = revisarHtml('');
  assert.equal(hallazgos.length, 1);
  assert.equal(hallazgos[0]!.codigo, 'sin_tema');
});

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad-revision.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/unidad-revision.ts: todas las pruebas pasaron');
}
