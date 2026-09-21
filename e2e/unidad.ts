import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../src/generated/prisma/client.ts';
import { prisma } from '../src/lib/db.ts';
import { cadenaDeMotores, invalidarCatalogo } from '../src/lib/ai/catalogo.ts';
import { ClaveInvalida, cifrar, descifrar } from '../src/lib/crypto/secretos.ts';
import { CONSUMO_ALTO, CONSUMO_MEDIO, calcularCostoTurno, nivelDeConsumo } from '../src/lib/ai/usage.ts';
import { formatearCostoUsd } from '../src/lib/format/costo.ts';
import { buildSystemPrompt } from '../src/lib/ai/prompt.ts';
import { pideCambio } from '../src/pages/api/chat/stream.ts';

/**
 * Pruebas unitarias sin test runner (no hay uno en este repo — ver context.md).
 * `node:assert/strict` + `tsx`, exit code no-cero si algo falla.
 *
 * Ejecutar con: npx tsx e2e/unidad.ts
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

// ─────────────────────────────────────────────────────────────
// Cifrado (src/lib/crypto/secretos.ts)
// ─────────────────────────────────────────────────────────────

await prueba('cifrar/descifrar: ida y vuelta con el mismo AAD', () => {
  const original = 'sk-una-clave-de-prueba-cualquiera';
  const aad = randomUUID();

  const cifrado = cifrar(original, aad);
  assert.match(cifrado, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'formato v1.<nonce>.<ct>.<tag>');
  assert.notEqual(cifrado, original, 'el valor guardado no puede ser el texto plano');

  const recuperado = descifrar(cifrado, aad);
  assert.equal(recuperado, original);
});

await prueba('descifrar: un AAD distinto (ciphertext copiado a otra fila) rechaza', () => {
  const aadOriginal = randomUUID();
  const aadDeOtraFila = randomUUID();
  const cifrado = cifrar('otra-clave-de-prueba', aadOriginal);

  assert.throws(() => descifrar(cifrado, aadDeOtraFila), ClaveInvalida);
});

// ─────────────────────────────────────────────────────────────
// Catálogo: caminata de la cadena de respaldo (src/lib/ai/catalogo.ts)
// ─────────────────────────────────────────────────────────────

const PROVEEDOR_ID_PRUEBA = 'e2e-unidad-provider';

/** Cuenta de proveedor fija para los motores de prueba de abajo (catalogo-de-proveedores). */
async function asegurarProveedorDePrueba(): Promise<void> {
  await prisma.aiProvider.upsert({
    where: { id: PROVEEDOR_ID_PRUEBA },
    update: { apiKeyCipher: cifrar('clave-de-prueba', PROVEEDOR_ID_PRUEBA), enabled: true },
    create: {
      id: PROVEEDOR_ID_PRUEBA,
      kind: 'test-unidad',
      label: 'test-unidad',
      baseUrl: 'http://localhost:0',
      apiKeyCipher: cifrar('clave-de-prueba', PROVEEDOR_ID_PRUEBA),
    },
  });
}

/** Fila mínima de AiModel para las pruebas de abajo, con clave utilizable (vía su cuenta de proveedor). */
async function crearMotorDePrueba(opts: {
  providerModel: string;
  fallbackModelId?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await prisma.aiModel.create({
    data: {
      id,
      providerId: PROVEEDOR_ID_PRUEBA,
      providerModel: opts.providerModel,
      displayName: `Prueba ${opts.providerModel}`,
      enabled: true,
      selectableByTeacher: false,
      isDefault: false,
      fallbackModelId: opts.fallbackModelId ?? null,
    },
  });
  return id;
}

async function limpiarMotoresDePrueba(): Promise<void> {
  // Primero se sueltan los fallbackModelId (la FK es ON DELETE SET NULL, pero
  // mejor no depender del orden de borrado entre filas que se referencian
  // entre sí).
  await prisma.aiModel.updateMany({ where: { providerId: PROVEEDOR_ID_PRUEBA }, data: { fallbackModelId: null } });
  await prisma.aiModel.deleteMany({ where: { providerId: PROVEEDOR_ID_PRUEBA } });
  invalidarCatalogo();
}

await asegurarProveedorDePrueba();

await prueba('cadenaDeMotores: un ciclo A→B→A no cuelga y corta en 2', async () => {
  await limpiarMotoresDePrueba();
  try {
    const idA = await crearMotorDePrueba({ providerModel: 'ciclo-a' });
    const idB = await crearMotorDePrueba({ providerModel: 'ciclo-b', fallbackModelId: idA });
    await prisma.aiModel.update({ where: { id: idA }, data: { fallbackModelId: idB } });
    invalidarCatalogo();

    const cadena = await cadenaDeMotores(idA);

    assert.equal(cadena.length, 2, 'el ciclo tiene que cortar apenas se repite un id, no seguir para siempre');
    assert.deepEqual(
      cadena.map((motor) => motor.id),
      [idA, idB],
    );
  } finally {
    await limpiarMotoresDePrueba();
  }
});

const PROVEEDOR_ID_PRUEBA_2 = 'e2e-unidad-provider-2';

/** Segunda cuenta de proveedor, distinta de `PROVEEDOR_ID_PRUEBA`, para probar que la cadena cruza cuentas. */
async function asegurarSegundaProveedorDePrueba(): Promise<void> {
  await prisma.aiProvider.upsert({
    where: { id: PROVEEDOR_ID_PRUEBA_2 },
    update: { apiKeyCipher: cifrar('clave-de-prueba-2', PROVEEDOR_ID_PRUEBA_2), enabled: true },
    create: {
      id: PROVEEDOR_ID_PRUEBA_2,
      kind: 'test-unidad-2',
      label: 'test-unidad-2',
      baseUrl: 'http://localhost:0',
      apiKeyCipher: cifrar('clave-de-prueba-2', PROVEEDOR_ID_PRUEBA_2),
    },
  });
}

/** Igual que `crearMotorDePrueba`, pero permite elegir en qué cuenta vive el motor. */
async function crearMotorDePruebaEnCuenta(opts: {
  providerId: string;
  providerModel: string;
  fallbackModelId?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await prisma.aiModel.create({
    data: {
      id,
      providerId: opts.providerId,
      providerModel: opts.providerModel,
      displayName: `Prueba ${opts.providerModel}`,
      enabled: true,
      selectableByTeacher: false,
      isDefault: false,
      fallbackModelId: opts.fallbackModelId ?? null,
    },
  });
  return id;
}

await prueba('cadenaDeMotores: la cadena puede cruzar dos cuentas de proveedor distintas', async () => {
  await limpiarMotoresDePrueba();
  await asegurarSegundaProveedorDePrueba();
  try {
    // A vive en PROVEEDOR_ID_PRUEBA, B vive en PROVEEDOR_ID_PRUEBA_2 — dos
    // cuentas (AiProvider) distintas, cada una con su propia clave.
    // "Model-level fallback chain may span providers" (ai-model-catalog spec):
    // la traversal en catalogo.ts es ciega a `providerId` por construcción,
    // pero hasta esta prueba ningún fixture había armado una cadena que de
    // verdad atravesara dos cuentas — todos compartían PROVEEDOR_ID_PRUEBA.
    const idB = await crearMotorDePruebaEnCuenta({ providerId: PROVEEDOR_ID_PRUEBA_2, providerModel: 'cruce-b' });
    const idA = await crearMotorDePruebaEnCuenta({
      providerId: PROVEEDOR_ID_PRUEBA,
      providerModel: 'cruce-a',
      fallbackModelId: idB,
    });
    invalidarCatalogo();

    const cadena = await cadenaDeMotores(idA);

    assert.equal(cadena.length, 2, `esperaba a A y B, los dos con clave utilizable, dio ${cadena.length}`);
    assert.deepEqual(
      cadena.map((motor) => motor.id),
      [idA, idB],
      'la cadena debe recorrer A (una cuenta) → B (otra cuenta) en orden',
    );
  } finally {
    await prisma.aiModel.updateMany({ where: { providerId: PROVEEDOR_ID_PRUEBA_2 }, data: { fallbackModelId: null } });
    await prisma.aiModel.deleteMany({ where: { providerId: PROVEEDOR_ID_PRUEBA_2 } });
    await prisma.aiProvider.delete({ where: { id: PROVEEDOR_ID_PRUEBA_2 } });
    await limpiarMotoresDePrueba();
  }
});

await prueba('cadenaDeMotores: el tope de 3 eslabones se respeta aunque la cadena siga', async () => {
  await limpiarMotoresDePrueba();
  try {
    const idE = await crearMotorDePrueba({ providerModel: 'cap-e' });
    const idD = await crearMotorDePrueba({ providerModel: 'cap-d', fallbackModelId: idE });
    const idC = await crearMotorDePrueba({ providerModel: 'cap-c', fallbackModelId: idD });
    const idB = await crearMotorDePrueba({ providerModel: 'cap-b', fallbackModelId: idC });
    const idA = await crearMotorDePrueba({ providerModel: 'cap-a', fallbackModelId: idB });
    invalidarCatalogo();

    const cadena = await cadenaDeMotores(idA);

    assert.equal(cadena.length, 3, 'la cadena tiene 5 eslabones posibles; el tope duro es 3');
    assert.deepEqual(
      cadena.map((motor) => motor.id),
      [idA, idB, idC],
    );
  } finally {
    await limpiarMotoresDePrueba();
  }
});

// ─────────────────────────────────────────────────────────────
// Costo por turno (src/lib/ai/usage.ts — M4, design.md §6)
// ─────────────────────────────────────────────────────────────

const precios = (input: string, output: string, cachedInput: string | null) => ({
  input: new Prisma.Decimal(input),
  output: new Prisma.Decimal(output),
  cachedInput: cachedInput === null ? null : new Prisma.Decimal(cachedInput),
});

await prueba('calcularCostoTurno: la resta de tokens cacheados NO duplica el cobro', () => {
  // Turno con un 90% del prompt cacheado: 10.000 prompt, 9.000 cacheados,
  // 1.000 de completion. Tarifas: entrada $1/M, salida $2/M, caché $0.02/M
  // (la caché cuesta bastante menos, como en el ejemplo real de DeepSeek).
  const resultado = calcularCostoTurno(10_000, 9_000, 1_000, precios('1', '2', '0.02'));

  // Correcto: SÓLO los 1.000 tokens no cacheados (10.000 − 9.000) se facturan
  // a la tarifa de entrada completa.
  //   facturables: 1.000 × 1 / 1e6   = 0.001
  //   cacheados:   9.000 × 0.02 / 1e6 = 0.00018
  //   salida:      1.000 × 2 / 1e6   = 0.002
  //   total: 0.00318
  const correcto = new Prisma.Decimal('0.00318');
  assert.ok(
    resultado.costUsd!.equals(correcto),
    `esperaba ${correcto.toString()}, dio ${resultado.costUsd!.toString()}`,
  );

  // La cuenta INCORRECTA (el bug que este cálculo existe para evitar) factura
  // los 10.000 prompt_tokens completos a tarifa de entrada Y ADEMÁS los 9.000
  // cacheados a su tarifa — duplicando el cobro de la porción cacheada.
  //   10.000 × 1/1e6 + 9.000 × 0.02/1e6 + 1.000 × 2/1e6 = 0.01218
  const infladoPorDobleCobro = new Prisma.Decimal('0.01218');
  assert.ok(
    !resultado.costUsd!.equals(infladoPorDobleCobro),
    'el resultado no debe coincidir con la cuenta que factura el prompt completo Y la caché encima (doble cobro)',
  );
});

await prueba('calcularCostoTurno: precio nulo nunca fabrica un costo', () => {
  const resultado = calcularCostoTurno(1_000, 0, 500, null);
  assert.equal(resultado.costUsd, null);
  assert.equal(resultado.priceInputSnapshot, null);
  assert.equal(resultado.priceOutputSnapshot, null);
  assert.equal(resultado.priceCachedInputSnapshot, null);
});

await prueba('calcularCostoTurno: un turno gratis da costo 0, no null', () => {
  const resultado = calcularCostoTurno(1_000, 0, 500, precios('0', '0', '0'));
  assert.ok(resultado.costUsd !== null, 'un motor con precios cargados en 0 tiene un costo CONOCIDO: cero');
  assert.ok(resultado.costUsd!.isZero());
});

await prueba('calcularCostoTurno: sin tarifa de caché propia, cae a la de entrada (y lo registra así)', () => {
  const resultado = calcularCostoTurno(1_000, 1_000, 0, precios('2', '5', null));
  // Los 1.000 tokens son todos cacheados y no hay tarifa de caché cargada:
  // se facturan a la tarifa de entrada (2), y el snapshot debe decir 2, no
  // null — si no, nadie podría recalcular el total desde los tres snapshots.
  assert.ok(resultado.priceCachedInputSnapshot!.equals(new Prisma.Decimal('2')));
  assert.ok(resultado.costUsd!.equals(new Prisma.Decimal('0.002')));
});

await prueba('calcularCostoTurno: Decimal(16,10) no pierde un costo de fracción de centavo', () => {
  // El ejemplo exacto de la migración: 200 tokens cacheados a $0.003/M,
  // nada más. A escala 6 esto redondea a 0.000000 — el bug que la escala 10
  // existe para evitar.
  const resultado = calcularCostoTurno(200, 200, 0, precios('0.003', '0.6', '0.003'));
  const esperado = new Prisma.Decimal('0.0000006');
  assert.ok(resultado.costUsd!.greaterThan(0), 'un costo real nunca debe redondear a cero antes de guardarse');
  assert.ok(
    resultado.costUsd!.equals(esperado),
    `esperaba ${esperado.toString()}, dio ${resultado.costUsd!.toString()}`,
  );
});

// ─────────────────────────────────────────────────────────────
// Redondeo para mostrar (src/lib/format/costo.ts — M4, design.md §2)
// ─────────────────────────────────────────────────────────────

await prueba('formatearCostoUsd: la tabla de redondeo completa', () => {
  assert.equal(formatearCostoUsd(null), '—', 'precio nunca cargado');
  assert.equal(formatearCostoUsd(0), 'US$ 0,00', 'costo cero con precios cargados: el motor gratuito sirvió el turno');
  assert.equal(formatearCostoUsd(3.174), 'US$ 3,17', '>= 0.01: dos decimales');
  assert.equal(formatearCostoUsd(0.0024), 'US$ 0,0024', '> 0 y < 0.01: cuatro decimales');

  const menorAUnDiezmilesimo = formatearCostoUsd(0.00004);
  assert.equal(menorAUnDiezmilesimo, 'menos de US$ 0,0001', 'redondea a 0,0000 pero es > 0: nunca "US$ 0,00"');
  assert.notEqual(menorAUnDiezmilesimo, 'US$ 0,00', 'un costo real jamás debe leerse como gratis');
});

// ─────────────────────────────────────────────────────────────
// Umbrales del indicador (src/lib/ai/usage.ts — M4, design.md, "The
// workspace cost indicator")
// ─────────────────────────────────────────────────────────────

await prueba('nivelDeConsumo: los tres cortes, con los bordes exactos', () => {
  assert.equal(nivelDeConsumo(0), 'bajo');
  assert.equal(nivelDeConsumo(CONSUMO_MEDIO - 1), 'bajo');
  assert.equal(nivelDeConsumo(CONSUMO_MEDIO), 'medio', 'el corte es inclusivo');
  assert.equal(nivelDeConsumo(CONSUMO_ALTO - 1), 'medio');
  assert.equal(nivelDeConsumo(CONSUMO_ALTO), 'alto', 'el corte es inclusivo');
  assert.equal(nivelDeConsumo(CONSUMO_ALTO * 10), 'alto');
});

// ─────────────────────────────────────────────────────────────
// pideCambio: consulta vs. pedido de cambio
// ─────────────────────────────────────────────────────────────

/**
 * Existe por un defecto concreto: los patrones terminaban en `\b`, que en
 * JavaScript sólo considera "palabra" a [A-Za-z0-9_]. Una vocal con tilde
 * queda afuera, así que "¿Qué hace este recurso?" NO cerraba la alternativa
 * `qu[eé]`, caía al default ("es un pedido") y la IA reescribía el recurso
 * entero cuando la docente sólo había preguntado. Andaba sin tilde y fallaba
 * con tilde, en una app enteramente en castellano.
 *
 * Las dos direcciones importan y por eso se prueban las dos: confundir un
 * pedido con una consulta hace que un cambio pedido no se aplique.
 */
await prueba('pideCambio: una pregunta con tilde NO dispara una reescritura', () => {
  for (const consulta of [
    '¿Qué hace este recurso?',
    '¿Por qué no anda el botón?',
    '¿Para qué sirve esto?',
    '¿Cómo funciona el quiz?',
    '¿Cuándo se corrige?',
    '¿Quién lo puede ver?',
    '¿Cuál es el límite?',
    '¿Cuántos intentos permite?',
    '¿Dónde se guarda?',
    '¿De qué color es el fondo?',
  ]) {
    assert.equal(pideCambio(consulta), false, `debería leerse como consulta: ${consulta}`);
  }
});

await prueba('pideCambio: sin tilde sigue andando, como se escribe al apuro', () => {
  assert.equal(pideCambio('que hace este recurso?'), false);
  assert.equal(pideCambio('como funciona el quiz?'), false);
});

await prueba('pideCambio: un pedido SIGUE siendo un pedido (la otra dirección)', () => {
  for (const pedido of [
    'cambiá el color a rojo',
    'Hacé que el botón sea más grande',
    'agregá una pregunta más',
    'poné el título en mayúsculas',
    'sacá la imagen de arriba',
    'corregí el error de ortografía',
    'quiero que tenga sonido',
    'mejoralo un poco',
    // Lleva signo de pregunta pero es un pedido: el caso que el comentario
    // de `stream.ts` marca como difícil desde antes de este arreglo.
    '¿podés hacerlo rojo?',
    '¿me lo hacés en dos columnas?',
  ]) {
    assert.equal(pideCambio(pedido), true, `debería leerse como pedido: ${pedido}`);
  }
});

// ── Preguntas de las primeras iteraciones (spec ai-authoring-dialogue) ──────
//
// `renderPreguntas` no se exporta: se prueba a través de `buildSystemPrompt`,
// que es lo que realmente viaja al modelo. Si la guía se arma bien pero no
// llega al prompt, el docente igual no la ve.

const MARCA_PREGUNTAS = '## Antes de construir: preguntá lo que no sabés';

function contextoDePrueba(turnosPrevios: number, herramientaForzada: boolean) {
  return {
    globalRules: [],
    userRules: [],
    assets: [],
    currentHtml: '<!DOCTYPE html><html><body></body></html>',
    projectTitle: 'Recurso de prueba',
    canSeeImages: false,
    htmlEditedByTeacher: false,
    turnosPrevios,
    herramientaForzada,
  };
}

await prueba('buildSystemPrompt: en el primer turno pide preguntar antes de construir', () => {
  const prompt = buildSystemPrompt(contextoDePrueba(0, false));
  assert.ok(
    prompt.includes(MARCA_PREGUNTAS),
    'el turno 1 tiene que llevar la guía de preguntas',
  );
  assert.ok(
    prompt.includes('NO ADIVINES'),
    'la guía tiene que decir explícitamente que no adivine',
  );
});

await prueba('buildSystemPrompt: el turno 2 sigue siendo temprano (el borde)', () => {
  const prompt = buildSystemPrompt(contextoDePrueba(1, false));
  assert.ok(
    prompt.includes(MARCA_PREGUNTAS),
    'turnosPrevios=1 es el último turno temprano: la guía tiene que estar',
  );
});

await prueba('buildSystemPrompt: del turno 3 en adelante ya no pregunta', () => {
  const prompt = buildSystemPrompt(contextoDePrueba(2, false));
  assert.ok(
    !prompt.includes(MARCA_PREGUNTAS),
    'con el recurso ya armado la guía sobra: el modelo tiene que editar, no interrogar',
  );
});

await prueba('buildSystemPrompt: la herramienta forzada gana sobre las preguntas', () => {
  // LA COLISIÓN. Forzar la herramienta le dice "escribí código ahora" y la
  // guía le dice "podés contestar sin código". Las dos juntas en un mismo
  // pedido son instrucciones contradictorias, así que la guía se omite.
  const prompt = buildSystemPrompt(contextoDePrueba(0, true));
  assert.ok(
    !prompt.includes(MARCA_PREGUNTAS),
    'con la herramienta forzada la guía de preguntas NO puede viajar',
  );

  // Y el turno tardío con herramienta forzada tampoco, obviamente: acá lo que
  // se comprueba es que las dos condiciones no se pisen entre sí.
  assert.ok(
    !buildSystemPrompt(contextoDePrueba(5, true)).includes(MARCA_PREGUNTAS),
    'turno tardío + herramienta forzada tampoco lleva la guía',
  );
});

await prisma.$disconnect();

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/unidad.ts: todas las pruebas pasaron');
}
