import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Prisma } from '../src/generated/prisma/client.ts';
import { prisma } from '../src/lib/db.ts';
import { cadenaDeMotores, invalidarCatalogo, motoresParaDocente, normalizarMotor } from '../src/lib/ai/catalogo.ts';
import { resolverCapacidades, resolverVelocidadEfectiva } from '../src/lib/ai/capacidades.ts';
import type { SettingsParaCapacidades, UsuarioParaCapacidades } from '../src/lib/ai/capacidades.ts';
import { ClaveInvalida, cifrar, descifrar } from '../src/lib/crypto/secretos.ts';
import { CONSUMO_ALTO, CONSUMO_MEDIO, calcularCostoTurno, consumedTokens, nivelDeConsumo } from '../src/lib/ai/usage.ts';
import { formatearCostoUsd } from '../src/lib/format/costo.ts';
import { buildCurrentResourceBlock, buildSystemPrompt } from '../src/lib/ai/prompt.ts';
import { TEMAS, aplicarKit } from '../src/lib/ai/kit.ts';
import {
  razonamiento,
  razonamientoCorreccion,
  razonamientoEfectivo,
  requestCompletionStream,
  type ProviderConfig,
} from '../src/lib/ai/provider.ts';
import {
  construirMensajeCorreccion,
  lineaFuente,
  necesitaCorreccion,
  type ErrorAutoprueba,
  type ResultadoPrueba,
} from '../src/lib/ai/autoprueba.ts';
import type { ItemChecklist } from '../src/lib/ai/checklist.ts';
import { pideCambio, aplicarKitAlTurno } from '../src/pages/api/chat/stream.ts';
import { mensajeParaDeshacer } from '../src/lib/client/undo.ts';
import { esVelocidadValida } from '../src/lib/client/velocidad.ts';
import { contarChecklistOk, estadoDeChecklist } from '../src/lib/client/checklist.ts';
import type { WorkspaceMessage } from '../src/lib/workspace-types.ts';

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

    const cadena = await cadenaDeMotores(idA, false);

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

    const cadena = await cadenaDeMotores(idA, false);

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

    const cadena = await cadenaDeMotores(idA, false);

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
    canSeeImages: false,
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

// ── El tope por docente y su ventana móvil ─────────────────────────────────
//
// Acá un error no se ve: o el tope no corta nunca, o deja a un docente sin el
// motor para siempre. Se prueba contra filas reales con `createdAt` viejo,
// porque lo único que importa es el corte por fecha.

await prueba('consumedTokens: la ventana deja afuera lo viejo y el 0 suma todo', async () => {
  const usuario = await prisma.user.create({
    data: { email: `ventana-${randomUUID()}@test.local`, name: 'Prueba ventana' },
  });
  const motorId = await crearMotorDePrueba({ providerModel: `ventana-${randomUUID()}` });
  const hace = (horas: number) => new Date(Date.now() - horas * 60 * 60 * 1000);

  try {
    await prisma.tokenUsage.createMany({
      data: [
        // Dentro de una ventana de 5 h.
        { userId: usuario.id, aiModelId: motorId, model: 'x', promptTokens: 100, completionTokens: 50, createdAt: hace(1) },
        { userId: usuario.id, aiModelId: motorId, model: 'x', promptTokens: 200, completionTokens: 25, createdAt: hace(4) },
        // Afuera.
        { userId: usuario.id, aiModelId: motorId, model: 'x', promptTokens: 9_000, completionTokens: 9_000, createdAt: hace(6) },
        { userId: usuario.id, aiModelId: motorId, model: 'x', promptTokens: 7_000, completionTokens: 7_000, createdAt: hace(72) },
      ],
    });

    assert.equal(
      await consumedTokens(usuario.id, motorId, 5),
      375,
      'la ventana de 5 h sólo puede contar los dos turnos recientes (100+50+200+25)',
    );

    assert.equal(
      await consumedTokens(usuario.id, motorId, 0),
      32_375,
      '0 horas significa desde siempre: tiene que sumar los cuatro turnos',
    );

    assert.equal(
      await consumedTokens(usuario.id, motorId),
      32_375,
      'sin argumento se comporta como antes de este cambio, para no romper a nadie',
    );

    // El borde: un turno justo del otro lado de la ventana no entra.
    assert.equal(
      await consumedTokens(usuario.id, motorId, 5) < await consumedTokens(usuario.id, motorId, 7),
      true,
      'agrandar la ventana tiene que hacer entrar el turno de hace 6 h',
    );
  } finally {
    await prisma.tokenUsage.deleteMany({ where: { userId: usuario.id } });
    await prisma.user.delete({ where: { id: usuario.id } });
  }
});

await limpiarMotoresDePrueba();

// ── El razonamiento y su dialecto ──────────────────────────────────────────
//
// Cada proveedor le puso otro nombre al mismo parámetro. Mandarle el de uno al
// otro es un 400 y el turno se pierde, así que el mapeo se prueba.

function config(extra: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'x', label: 'x', apiKey: 'k', baseUrl: 'http://localhost:0', model: 'm',
    maxTokens: 1, userTokenLimit: 0, userTokenWindowHours: 0, maxInputChars: 1,
    supportsVision: false, reasoningEffort: null, reasoningParam: null,
    precios: null, ...extra,
  };
}

// ── sinHerramientas (T20, round 5) ─────────────────────────────────────────
//
// `intentarUna` (dentro de `provider.ts`, no exportada) arma el body real
// que se manda por HTTP: no hay forma de probarlo sin de verdad mandar un
// pedido. Un servidor HTTP efímero (mismo patrón que `e2e/mock-proveedor.ts`,
// pero mínimo — sólo lee el body y contesta un SSE vacío) alcanza para esto
// sin tocar ningún proveedor real ni la base de datos.

/** Manda UN pedido con `requestCompletionStream` contra un servidor propio
 *  que sólo devuelve el body que recibió (parseado). */
async function bodyDelPedido(extra: { sinHerramientas?: boolean; forzarHerramienta?: boolean }): Promise<Record<string, unknown>> {
  let capturado: Record<string, unknown> | null = null;

  const server = createServer((req, res) => {
    const trozos: Buffer[] = [];
    req.on('data', (trozo: Buffer) => trozos.push(trozo));
    req.on('end', () => {
      try {
        capturado = JSON.parse(Buffer.concat(trozos).toString('utf8')) as Record<string, unknown>;
      } catch {
        capturado = {};
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      res.write('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  try {
    const address = server.address();
    const puerto = address && typeof address === 'object' ? address.port : 0;
    const respuesta = await requestCompletionStream({
      messages: [{ role: 'user', content: 'hola' }],
      provider: config({ baseUrl: `http://127.0.0.1:${puerto}` }),
      ...extra,
    });
    // Se agota el body: si no, `server.close()` puede quedar esperando la
    // conexión keep-alive.
    for await (const _chunk of respuesta.body as any) void _chunk;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  assert.ok(capturado, 'el servidor de prueba tiene que haber recibido el pedido');
  return capturado!;
}

await prueba('requestCompletionStream: sinHerramientas OMITE "tools" y "tool_choice" enteras, no las vacía', async () => {
  const body = await bodyDelPedido({ sinHerramientas: true });
  assert.ok(!('tools' in body), 'la clave "tools" no tiene que existir en absoluto');
  assert.ok(!('tool_choice' in body), 'la clave "tool_choice" no tiene que existir en absoluto (no "none")');
});

await prueba('requestCompletionStream: sin sinHerramientas, el comportamiento de siempre (tools + tool_choice)', async () => {
  const body = await bodyDelPedido({});
  assert.ok(Array.isArray(body.tools) && (body.tools as unknown[]).length > 0);
  assert.equal(body.tool_choice, 'auto');
});

await prueba('requestCompletionStream: sinHerramientas gana por encima de forzarHerramienta', async () => {
  const body = await bodyDelPedido({ sinHerramientas: true, forzarHerramienta: true });
  assert.ok(!('tools' in body), 'sinHerramientas tiene que ignorar forzarHerramienta, no combinarlos');
  assert.ok(!('tool_choice' in body));
});

await prueba('razonamiento: sin nivel cargado no se manda NADA', () => {
  assert.deepEqual(razonamiento(config({})), {});
  // Ni siquiera con el dialecto elegido: sin nivel no hay nada que decir.
  assert.deepEqual(razonamiento(config({ reasoningParam: 'thinking' })), {});
});

await prueba('razonamiento: dialecto OpenAI manda el nivel tal cual', () => {
  assert.deepEqual(
    razonamiento(config({ reasoningEffort: 'none', reasoningParam: 'reasoning_effort' })),
    { reasoning_effort: 'none' },
  );
  assert.deepEqual(
    razonamiento(config({ reasoningEffort: 'high', reasoningParam: 'reasoning_effort' })),
    { reasoning_effort: 'high' },
  );
  // Sin dialecto explícito cae a este, que es el default histórico.
  assert.deepEqual(razonamiento(config({ reasoningEffort: 'max' })), { reasoning_effort: 'max' });
});

await prueba('razonamiento: MiniMax no tiene niveles, sólo prendido o apagado', () => {
  assert.deepEqual(
    razonamiento(config({ reasoningEffort: 'none', reasoningParam: 'thinking' })),
    { thinking: { type: 'disabled' } },
  );
  // Cualquier nivel que no sea "none" es prendido: MiniMax no distingue.
  for (const nivel of ['low', 'high', 'max']) {
    assert.deepEqual(
      razonamiento(config({ reasoningEffort: nivel, reasoningParam: 'thinking' })),
      { thinking: { type: 'enabled' } },
      `${nivel} tiene que mandar thinking enabled`,
    );
  }
  // Y nunca el nombre del otro dialecto, que es lo que devuelve el 400.
  assert.equal(
    'reasoning_effort' in razonamiento(config({ reasoningEffort: 'none', reasoningParam: 'thinking' })),
    false,
  );
});

// ── T2: reglas de diseño en el prompt y kit aplicado al guardar ────────────
// (odd/tasks/modo-prime.md — Apéndice B y "Kit aplicado por el servidor")

await prueba('buildSystemPrompt: lleva la sección de diseño visual y los 8 temas', () => {
  const prompt = buildSystemPrompt(contextoDePrueba(2, false));
  assert.ok(prompt.includes('## Diseño visual'), 'tiene que llevar la sección nueva del Apéndice B');
  for (const tema of TEMAS) {
    assert.ok(prompt.includes(tema.id), `el prompt tiene que listar el tema "${tema.id}"`);
  }
});

await prueba(
  'buildSystemPrompt: es idéntico byte a byte en dos armados seguidos (T1, cache de prefijo)',
  () => {
    // El cache de prefijo del proveedor (comentario en buildSystemPrompt, junto
    // a `renderPreguntas`) sólo pega mientras ese prefijo sea IDÉNTICO entre
    // pedidos: nada de fechas, Math.random ni orden de Set/Map inestable
    // colado ahí adentro. Desde T1 ("html-fuera-del-system") el HTML actual ya
    // no viaja acá — viaja en el último mensaje de usuario
    // (`buildCurrentResourceBlock`) — así que ahora el prompt ENTERO tiene que
    // salir byte a byte igual entre dos turnos del mismo hilo, no sólo "lo de
    // antes del estado del recurso".
    const ctx = contextoDePrueba(2, false); // turno tardío: sin guía de preguntas
    const primero = buildSystemPrompt(ctx);
    const segundo = buildSystemPrompt(ctx);
    assert.equal(primero, segundo, 'el system prompt entero tiene que salir byte a byte igual');
  },
);

await prueba('buildSystemPrompt: no lleva el HTML actual (T1, vive en el último mensaje)', () => {
  const prompt = buildSystemPrompt(contextoDePrueba(2, false));
  assert.ok(
    !prompt.includes('## Estado actual del recurso'),
    'el bloque del recurso actual ya no puede viajar en el system prompt',
  );
});

// ── T3 (arnes-robustez): "Que funcione de verdad" y los helpers de window.kodu ──
// (odd/tasks/arnes-robustez.md)

await prueba('buildSystemPrompt: lleva la sección "Que funcione de verdad" con las reglas de la vuelta 1', () => {
  const prompt = buildSystemPrompt(contextoDePrueba(2, false));
  assert.ok(prompt.includes('## Que funcione de verdad'), 'tiene que llevar la sección nueva de T3');

  const marcasDeLasSeisReglas = [
    'reiniciar()', // 1: un solo reiniciar() que vuelve todo al estado inicial
    'al soltar', // 2: se evalúa cuando la acción termina, no a mitad de arrastre
    'kodu.cancelarTemporizadores()', // 3: cancelar lo pendiente al empezar una acción nueva
    'pointer-events:none', // 4: toda capa decorativa/superpuesta
    'nunca arranca resuelto', // 5: el estado inicial
    'se declaran una sola vez', // 6: los datos del tema
  ];
  for (const marca of marcasDeLasSeisReglas) {
    assert.ok(prompt.includes(marca), `falta la marca de una de las 6 reglas: "${marca}"`);
  }
});

await prueba('buildSystemPrompt: documenta los cuatro helpers de window.kodu por nombre', () => {
  const prompt = buildSystemPrompt(contextoDePrueba(2, false));
  for (const helper of ['kodu.icono(', 'kodu.arrastrar(', 'kodu.despues(', 'kodu.cancelarTemporizadores(']) {
    assert.ok(prompt.includes(helper), `falta documentar el helper "${helper}"`);
  }
});

// ── Round 2 (arnes-robustez): reglas nuevas y helpers a prueba de mal uso ──

await prueba('buildSystemPrompt: lleva las reglas de la vuelta 2 del arnés', () => {
  const prompt = buildSystemPrompt(contextoDePrueba(2, false));
  const marcas = [
    'ESTADO_INICIAL', // reiniciar vuelve a un estado declarado una sola vez
    'Un LOGRO, una vez obtenido, queda hasta reiniciar', // logro contra condición
    'borrá el mensaje del intento anterior',
    'desde el primer cuadro', // estado inicial sincronizado
    'kodu.mezclar(', // orden de las opciones
    'nunca con 0 aciertos', // festejo sólo ante un logro real
    '820×1180', // controles visibles en escritorio y tablet
    'recién al resolver el anterior', // desafíos en orden
  ];
  for (const marca of marcas) {
    assert.ok(prompt.includes(marca), `falta la marca de una regla de la vuelta 2: "${marca}"`);
  }
  assert.ok(!prompt.includes('puede volver a "pendiente"'), 'la regla vieja de consignas en vivo tiene que haberse ido');
});

await prueba('buildSystemPrompt: documenta el arrastre en unidades y que el helper ya maneja el teclado', () => {
  const prompt = buildSystemPrompt(contextoDePrueba(2, false));
  for (const marca of ['alCambiar: (v) =>', 'valor: () =>', 'no agregues `pointerdown`', '`p` es un objeto', 'kodu.festejar()']) {
    assert.ok(prompt.includes(marca), `falta en la documentación de los helpers: "${marca}"`);
  }
  assert.ok(!prompt.includes('canvas-confetti'), 'el festejo pasa por kodu.festejar, no por cargar canvas-confetti a mano');
});

// ── Round 3, T10 (arnes-robustez): kodu.arrastrar ya mueve el punto, colores
// de interfaz vs. objetos del contenido, y tres reglas de una línea nuevas ──

await prueba('buildSystemPrompt: kodu.arrastrar documenta que YA mueve el punto en modo unidad y el opt-out mover:false', () => {
  const prompt = buildSystemPrompt(contextoDePrueba(2, false));
  for (const marca of ['YA MUEVE el punto', 'ni lo reposiciones en `alCambiar`', '`mover:false`']) {
    assert.ok(prompt.includes(marca), `falta la marca del posicionamiento de T9 en el prompt: "${marca}"`);
  }
});

await prueba('buildSystemPrompt: distingue colores de interfaz de los objetos del contenido', () => {
  const prompt = buildSystemPrompt(contextoDePrueba(2, false));
  assert.ok(
    prompt.includes('Son para la INTERFAZ; los OBJETOS del contenido'),
    'falta la aclaración de que los tokens del tema son para la interfaz, no para los objetos dibujados',
  );
});

await prueba('buildSystemPrompt: lleva las tres reglas nuevas de "Que funcione de verdad" (T10)', () => {
  const prompt = buildSystemPrompt(contextoDePrueba(2, false));
  const marcas = [
    'sólo para texto', // 11: textContent vs innerHTML
    'ganan a `:hover`', // 12: estilos de estado sobre hover
    'ramifican lo que sigue', // 13: "tomar decisiones" implica ramas
  ];
  for (const marca of marcas) {
    assert.ok(prompt.includes(marca), `falta la marca de una regla nueva de T10: "${marca}"`);
  }
});

// ── Round 4, T15 (arnes-robustez): window.__koduPruebas (Part A) y las
// cinco reglas/helpers de Part B (kodu.pantalla, progreso en ramas, festejar
// en finales negativos, atajos de teclado, evaluar al entrar) ──

await prueba('buildSystemPrompt: documenta window.__koduPruebas con un ejemplo corto (Part A, T15)', () => {
  const prompt = buildSystemPrompt(contextoDePrueba(2, false));
  assert.ok(prompt.includes('window.__koduPruebas'), 'falta mencionar window.__koduPruebas');
  assert.ok(prompt.includes('t.clic'), 'falta documentar el ayudante t.clic');
  assert.ok(prompt.includes('t.texto'), 'falta documentar el ayudante t.texto');
  assert.ok(prompt.includes('t.esperar'), 'falta documentar el ayudante t.esperar');
  assert.ok(prompt.includes('nunca debilites una prueba'), 'falta la advertencia de no debilitar una prueba para que pase');
  assert.ok(
    prompt.includes("window.__koduPruebas=[{id:'c1',prueba:async t=>"),
    'falta el ejemplo corto de window.__koduPruebas',
  );
});

await prueba('buildSystemPrompt: lleva las cinco reglas/helpers de Part B (T15)', () => {
  const prompt = buildSystemPrompt(contextoDePrueba(2, false));
  const marcas = [
    'kodu.pantalla(nombre)', // helper: pantallas + candado del doble toque
    'contador fijo tipo "3 de 10"', // 14: progreso en caminos ramificados
    'ni en un final negativo', // 8 (actualizada): festejar sólo en positivo
    'nada dispara con `kodu.ocupado()`', // 15: atajos de teclado respetan el mismo estado
    'evaluá al toque si ya está resuelto', // 16: evaluar al entrar a un paso/desafío
  ];
  for (const marca of marcas) {
    assert.ok(prompt.includes(marca), `falta la marca de una regla/helper de Part B (T15): "${marca}"`);
  }
});

await prueba('buildCurrentResourceBlock: el HTML actual viaja con el bloque del kit plegado', () => {
  // Marca del JSON embebido en `tailwind.config = {...}` (construirTailwindConfig):
  // NO se puede usar la cadena "tailwind.config" sola para probar el plegado,
  // porque la propia sección "Diseño visual" del system prompt la menciona en
  // prosa ("NO escribas tailwind.config…") — con o sin plegar, esa frase
  // siempre está ahí. `"borderRadius"` en cambio sólo puede salir del
  // JSON.stringify de adentro del bloque canónico.
  const MARCA_JSON_CONFIG = '"borderRadius"';

  const sinBloque =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="kodu-tema" content="pizarron"></head><body><h1>Hola</h1></body></html>';
  const conBloque = aplicarKit(sinBloque);
  assert.ok(
    conBloque.includes(MARCA_JSON_CONFIG),
    'la prueba no sirve si el bloque canónico no se insertó',
  );

  const bloque = buildCurrentResourceBlock(conBloque, 'Recurso de prueba', false);

  assert.ok(
    bloque.includes('<!-- kodu-kit:v1 tema=pizarron:'),
    'el bloque tiene que llegar plegado, como el placeholder de una línea',
  );
  assert.ok(!bloque.includes('kodu-kit:v1:inicio'), 'el bloque canónico completo NO tiene que viajar en el mensaje');
  assert.ok(!bloque.includes(MARCA_JSON_CONFIG), 'plegado, no puede quedar el JSON de adentro del bloque');
});

await prueba('aplicarKitAlTurno: aplica el kit y usa el tema previo como respaldo', () => {
  const sinMeta = '<!DOCTYPE html><html><head></head><body><h1>Hola</h1></body></html>';
  const resultado = aplicarKitAlTurno(sinMeta, 'cuaderno');

  assert.ok(
    resultado.includes('<meta name="kodu-tema" content="cuaderno">'),
    'sin meta propio, tiene que insertar el del tema previo',
  );
  assert.ok(resultado.includes('kodu-kit:v1:inicio tema=cuaderno'), 'tiene que insertar el bloque canónico de ese tema');

  // Sin tema previo y sin meta nuevo no hay de dónde sacar el tema: el HTML
  // vuelve sin tocar, igual que `aplicarKit` a secas.
  assert.equal(aplicarKitAlTurno(sinMeta, null), sinMeta);
});

// ── T4: deshacer cambios de la IA ───────────────────────────────────────
// (odd/tasks/modo-prime.md — "Deshacer cambios de la IA")

function mensajeDePrueba(
  overrides: Partial<WorkspaceMessage> & Pick<WorkspaceMessage, 'id' | 'role'>,
): WorkspaceMessage {
  return { content: '', attachments: [], ...overrides };
}

await prueba('mensajeParaDeshacer: sin ningún mensaje deshacible, no ofrece nada', () => {
  assert.equal(mensajeParaDeshacer([]), null);
  assert.equal(
    mensajeParaDeshacer([
      mensajeDePrueba({ id: 'u1', role: 'user' }),
      mensajeDePrueba({ id: 'a1', role: 'assistant' }), // sin canUndo: no cambió el recurso
    ]),
    null,
  );
});

await prueba('mensajeParaDeshacer: elige el más nuevo con canUndo, no el primero que aparece', () => {
  const mensajes = [
    mensajeDePrueba({ id: 'u1', role: 'user' }),
    mensajeDePrueba({ id: 'a1', role: 'assistant', canUndo: true }),
    mensajeDePrueba({ id: 'u2', role: 'user' }),
    mensajeDePrueba({ id: 'a2', role: 'assistant', canUndo: true }),
  ];
  assert.equal(mensajeParaDeshacer(mensajes), 'a2');
});

await prueba('mensajeParaDeshacer: deshecho el más nuevo, el turno anterior pasa a ser el candidato solo', () => {
  // Así es como queda la lista justo después de deshacer "a2" (Workspace.tsx
  // marca `canUndo: false` a la vez que pone `undoneAt`): sin ninguna regla
  // nueva, el escaneo tiene que encontrar "a1" solo.
  const mensajes = [
    mensajeDePrueba({ id: 'u1', role: 'user' }),
    mensajeDePrueba({ id: 'a1', role: 'assistant', canUndo: true }),
    mensajeDePrueba({ id: 'u2', role: 'user', undoneAt: Date.now() }),
    mensajeDePrueba({ id: 'a2', role: 'assistant', canUndo: false, undoneAt: Date.now() }),
  ];
  assert.equal(mensajeParaDeshacer(mensajes), 'a1');
});

await prueba('mensajeParaDeshacer: nunca ofrece deshacer un mensaje "user"', () => {
  // No debería pasar en la práctica (el servidor sólo marca `canUndo` en
  // mensajes "assistant"), pero la función no tiene que confiar en eso.
  assert.equal(mensajeParaDeshacer([mensajeDePrueba({ id: 'u1', role: 'user', canUndo: true })]), null);
});

// ── T5: resolverCapacidades (odd/tasks/modo-prime.md — "Modo prime y
// funciones para todos") ────────────────────────────────────────────────

function usuarioDePrueba(overrides: Partial<UsuarioParaCapacidades> = {}): UsuarioParaCapacidades {
  return { role: 'DOCENTE', isDemo: false, primeAccess: false, ...overrides };
}

function settingsDePrueba(overrides: Partial<SettingsParaCapacidades> = {}): SettingsParaCapacidades {
  return { primeEnabled: false, autoReviewForAll: false, deepModeForAll: false, versionsForAll: false, ...overrides };
}

await prueba('resolverCapacidades: tabla de verdad completa de `prime`', () => {
  // Interruptor general apagado: nadie tiene prime, ni siquiera un admin.
  assert.equal(
    resolverCapacidades(usuarioDePrueba({ role: 'ADMIN' }), settingsDePrueba({ primeEnabled: false })).prime,
    false,
    'admin, interruptor apagado',
  );
  assert.equal(
    resolverCapacidades(usuarioDePrueba({ isDemo: true }), settingsDePrueba({ primeEnabled: false })).prime,
    false,
    'demo, interruptor apagado',
  );
  assert.equal(
    resolverCapacidades(usuarioDePrueba({ primeAccess: true }), settingsDePrueba({ primeEnabled: false })).prime,
    false,
    'marcado, interruptor apagado',
  );

  // Prendido: los tres caminos lo dan, cada uno solo (sin que hagan falta los otros dos).
  assert.equal(
    resolverCapacidades(usuarioDePrueba({ role: 'ADMIN' }), settingsDePrueba({ primeEnabled: true })).prime,
    true,
    'admin, interruptor prendido',
  );
  assert.equal(
    resolverCapacidades(usuarioDePrueba({ isDemo: true }), settingsDePrueba({ primeEnabled: true })).prime,
    true,
    'demo, interruptor prendido',
  );
  assert.equal(
    resolverCapacidades(usuarioDePrueba({ primeAccess: true }), settingsDePrueba({ primeEnabled: true })).prime,
    true,
    'marcado, interruptor prendido',
  );

  // Prendido pero ninguno de los tres caminos: sin prime.
  assert.equal(
    resolverCapacidades(usuarioDePrueba(), settingsDePrueba({ primeEnabled: true })).prime,
    false,
    'docente común, interruptor prendido',
  );
});

await prueba('resolverCapacidades: puedeElegirVelocidad = prime OR deepModeForAll', () => {
  assert.equal(
    resolverCapacidades(usuarioDePrueba({ role: 'ADMIN' }), settingsDePrueba({ primeEnabled: true }))
      .puedeElegirVelocidad,
    true,
    'prime solo ya alcanza',
  );
  assert.equal(
    resolverCapacidades(usuarioDePrueba(), settingsDePrueba({ primeEnabled: true, deepModeForAll: true }))
      .puedeElegirVelocidad,
    true,
    'deepModeForAll solo alcanza, sin prime',
  );
  assert.equal(
    resolverCapacidades(usuarioDePrueba(), settingsDePrueba({ primeEnabled: true })).puedeElegirVelocidad,
    false,
    'ninguno de los dos: no',
  );
});

await prueba('resolverCapacidades: puedePedirVersiones = prime OR versionsForAll', () => {
  assert.equal(
    resolverCapacidades(usuarioDePrueba({ isDemo: true }), settingsDePrueba({ primeEnabled: true }))
      .puedePedirVersiones,
    true,
    'prime solo ya alcanza',
  );
  assert.equal(
    resolverCapacidades(usuarioDePrueba(), settingsDePrueba({ primeEnabled: true, versionsForAll: true }))
      .puedePedirVersiones,
    true,
    'versionsForAll solo alcanza, sin prime',
  );
  assert.equal(
    resolverCapacidades(usuarioDePrueba(), settingsDePrueba({ primeEnabled: true })).puedePedirVersiones,
    false,
    'ninguno de los dos: no',
  );
});

await prueba('resolverCapacidades: autoReviewForAll viaja crudo, sin mezclarse con prime', () => {
  assert.equal(
    resolverCapacidades(usuarioDePrueba({ role: 'ADMIN' }), settingsDePrueba({ primeEnabled: true, autoReviewForAll: false }))
      .autoReviewForAll,
    false,
    'ni un admin con prime lo prende solo',
  );
  assert.equal(
    resolverCapacidades(usuarioDePrueba(), settingsDePrueba({ autoReviewForAll: true })).autoReviewForAll,
    true,
    'la bandera sola alcanza, sin prime ni interruptor general',
  );
});

await prueba('resolverCapacidades: puedeUsarModelosPrime es siempre igual a `prime`', () => {
  const casos: Array<[UsuarioParaCapacidades, SettingsParaCapacidades]> = [
    [usuarioDePrueba({ role: 'ADMIN' }), settingsDePrueba({ primeEnabled: true })],
    [usuarioDePrueba(), settingsDePrueba({ primeEnabled: true })],
    [usuarioDePrueba({ primeAccess: true }), settingsDePrueba({ primeEnabled: false })],
  ];
  for (const [usuario, settings] of casos) {
    const capacidades = resolverCapacidades(usuario, settings);
    assert.equal(capacidades.puedeUsarModelosPrime, capacidades.prime);
  }
});

// ── T5: el catálogo filtra motores `primeOnly` (odd/tasks/modo-prime.md) ──

await prueba('motoresParaDocente: un motor primeOnly se oculta sin prime y aparece con prime', async () => {
  await limpiarMotoresDePrueba();
  try {
    const idNormal = await crearMotorDePrueba({ providerModel: 'prime-normal' });
    await prisma.aiModel.update({ where: { id: idNormal }, data: { selectableByTeacher: true } });
    const idPrime = await crearMotorDePrueba({ providerModel: 'prime-solo' });
    await prisma.aiModel.update({ where: { id: idPrime }, data: { selectableByTeacher: true, primeOnly: true } });
    invalidarCatalogo();

    const sinPrime = await motoresParaDocente(false);
    assert.ok(sinPrime.some((m) => m.id === idNormal), 'el motor normal tiene que verse sin prime');
    assert.ok(!sinPrime.some((m) => m.id === idPrime), 'el motor prime-only NO tiene que verse sin prime');

    const conPrime = await motoresParaDocente(true);
    assert.ok(conPrime.some((m) => m.id === idPrime), 'el motor prime-only tiene que verse con prime');
  } finally {
    await limpiarMotoresDePrueba();
  }
});

await prueba('normalizarMotor: un motor primeOnly guardado cae al default cuando el pedido no tiene prime', async () => {
  await limpiarMotoresDePrueba();
  // El índice único parcial de `isDefault` permite CERO o UNA fila en true
  // en TODA la tabla (no sólo entre las de prueba): hay que soltar el
  // default real que dejó la semilla antes de poder poner el propio acá, y
  // devolverlo en el `finally` — mismo cuidado que ya toma e2e/m3-motores.ts.
  const defaultOriginal = await prisma.aiModel.findFirst({ where: { isDefault: true }, select: { id: true } });
  try {
    const idDefault = await crearMotorDePrueba({ providerModel: 'prime-default' });
    if (defaultOriginal) {
      await prisma.aiModel.update({ where: { id: defaultOriginal.id }, data: { isDefault: false } });
    }
    await prisma.aiModel.update({ where: { id: idDefault }, data: { isDefault: true } });
    const idPrime = await crearMotorDePrueba({ providerModel: 'prime-guardado' });
    await prisma.aiModel.update({ where: { id: idPrime }, data: { primeOnly: true } });
    invalidarCatalogo();

    const sinPrime = await normalizarMotor(idPrime, false);
    assert.equal(sinPrime?.id, idDefault, 'sin prime, el motor guardado cae al default, igual que uno apagado');

    const conPrime = await normalizarMotor(idPrime, true);
    assert.equal(conPrime?.id, idPrime, 'con prime, el motor prime-only guardado se usa tal cual');
  } finally {
    await limpiarMotoresDePrueba();
    if (defaultOriginal) {
      await prisma.aiModel.update({ where: { id: defaultOriginal.id }, data: { isDefault: true } });
    }
    invalidarCatalogo();
  }
});

await prueba('cadenaDeMotores: un eslabón primeOnly se saltea sin prime, pero la cadena sigue', async () => {
  await limpiarMotoresDePrueba();
  try {
    const idC = await crearMotorDePrueba({ providerModel: 'cadena-c' });
    const idB = await crearMotorDePrueba({ providerModel: 'cadena-b-prime', fallbackModelId: idC });
    await prisma.aiModel.update({ where: { id: idB }, data: { primeOnly: true } });
    const idA = await crearMotorDePrueba({ providerModel: 'cadena-a', fallbackModelId: idB });
    invalidarCatalogo();

    const sinPrime = await cadenaDeMotores(idA, false);
    assert.deepEqual(
      sinPrime.map((m) => m.id),
      [idA, idC],
      'sin prime, B se saltea pero la cadena sigue hasta C',
    );

    const conPrime = await cadenaDeMotores(idA, true);
    assert.deepEqual(
      conPrime.map((m) => m.id),
      [idA, idB, idC],
      'con prime, la cadena completa entra',
    );
  } finally {
    await limpiarMotoresDePrueba();
  }
});

// ── T6: velocidad Rápido / A fondo (odd/tasks/modo-prime.md — "Velocidad
// Rápido / A fondo") ────────────────────────────────────────────────────

await prueba('resolverCapacidades: velocidadPorDefecto es "a_fondo" con prime y "rapido" sin prime', () => {
  assert.equal(
    resolverCapacidades(usuarioDePrueba({ role: 'ADMIN' }), settingsDePrueba({ primeEnabled: true }))
      .velocidadPorDefecto,
    'a_fondo',
  );
  assert.equal(
    resolverCapacidades(usuarioDePrueba({ isDemo: true }), settingsDePrueba({ primeEnabled: true }))
      .velocidadPorDefecto,
    'a_fondo',
  );
  assert.equal(
    resolverCapacidades(usuarioDePrueba(), settingsDePrueba({ primeEnabled: true, deepModeForAll: true }))
      .velocidadPorDefecto,
    'rapido',
    'deepModeForAll da el CONTROL pero el default sigue siendo "rapido": A fondo encarece, y ese interruptor no es prime',
  );
  assert.equal(
    resolverCapacidades(usuarioDePrueba(), settingsDePrueba()).velocidadPorDefecto,
    'rapido',
    'sin nada prendido el default también es "rapido" (aunque acá ni siquiera hay control para mostrarlo)',
  );
});

await prueba('resolverVelocidadEfectiva: sin el permiso, la pedida se IGNORA — nunca fuerza nada', () => {
  assert.equal(resolverVelocidadEfectiva(false, 'deep', 'a_fondo'), null);
  assert.equal(resolverVelocidadEfectiva(false, 'fast', 'rapido'), null);
  assert.equal(
    resolverVelocidadEfectiva(false, undefined, 'a_fondo'),
    null,
    'sin permiso y sin pedido tampoco cae a un default: null es "no pisar nada"',
  );
});

await prueba('resolverVelocidadEfectiva: con el permiso, la pedida manda si vino', () => {
  assert.equal(resolverVelocidadEfectiva(true, 'fast', 'a_fondo'), 'fast');
  assert.equal(resolverVelocidadEfectiva(true, 'deep', 'rapido'), 'deep');
});

await prueba('resolverVelocidadEfectiva: con el permiso y sin pedido, manda el default de la cuenta', () => {
  assert.equal(resolverVelocidadEfectiva(true, undefined, 'a_fondo'), 'deep');
  assert.equal(resolverVelocidadEfectiva(true, undefined, 'rapido'), 'fast');
});

await prueba('razonamientoEfectivo: sin velocidad (null) es EXACTAMENTE razonamiento(provider)', () => {
  // Ningún permiso, o nada que resolver: ni fuerza "none" en Rápido ni "high"
  // en A fondo — manda tal cual lo que ya tenía configurado el motor, el
  // comportamiento de siempre para quien no tiene puedeElegirVelocidad.
  for (const extra of [
    {},
    { reasoningEffort: 'low', reasoningParam: 'reasoning_effort' },
    { reasoningEffort: 'none', reasoningParam: 'thinking' },
  ]) {
    const provider = config(extra);
    assert.deepEqual(razonamientoEfectivo(provider, null), razonamiento(provider));
  }
});

await prueba('razonamientoEfectivo: dialecto desconocido no manda nada en ninguna velocidad', () => {
  const provider = config({}); // reasoningEffort null: dialecto desconocido
  assert.deepEqual(razonamientoEfectivo(provider, 'fast'), {});
  assert.deepEqual(razonamientoEfectivo(provider, 'deep'), {});
});

await prueba('razonamientoEfectivo: reasoning_effort, Rápido siempre "none" sin importar lo configurado', () => {
  for (const nivel of ['none', 'low', 'high', 'max']) {
    assert.deepEqual(
      razonamientoEfectivo(config({ reasoningEffort: nivel, reasoningParam: 'reasoning_effort' }), 'fast'),
      { reasoning_effort: 'none' },
      `configurado en "${nivel}", Rápido tiene que mandar "none"`,
    );
  }
});

await prueba('razonamientoEfectivo: reasoning_effort, A fondo al menos "high" sin bajar un nivel más alto', () => {
  const casos: Array<[string, string]> = [
    ['none', 'high'],
    ['low', 'high'],
    ['high', 'high'],
    ['max', 'max'], // ya estaba más alto que "high": A fondo no lo achica
  ];
  for (const [configurado, esperado] of casos) {
    assert.deepEqual(
      razonamientoEfectivo(config({ reasoningEffort: configurado, reasoningParam: 'reasoning_effort' }), 'deep'),
      { reasoning_effort: esperado },
      `configurado en "${configurado}", A fondo tiene que dar "${esperado}"`,
    );
  }
});

await prueba('razonamientoEfectivo: thinking, Rápido apaga y A fondo prende sin importar el nivel', () => {
  for (const nivel of ['none', 'low', 'high', 'max']) {
    assert.deepEqual(
      razonamientoEfectivo(config({ reasoningEffort: nivel, reasoningParam: 'thinking' }), 'fast'),
      { thinking: { type: 'disabled' } },
      `configurado en "${nivel}", Rápido tiene que apagar el thinking`,
    );
    assert.deepEqual(
      razonamientoEfectivo(config({ reasoningEffort: nivel, reasoningParam: 'thinking' }), 'deep'),
      { thinking: { type: 'enabled' } },
      `configurado en "${nivel}", A fondo tiene que prender el thinking`,
    );
  }
});

await prueba('razonamientoCorreccion: dialecto desconocido no manda nada', () => {
  assert.deepEqual(razonamientoCorreccion(config({})), {});
});

await prueba('razonamientoCorreccion: reasoning_effort siempre "low", sin importar lo configurado', () => {
  for (const nivel of ['none', 'low', 'high', 'max']) {
    assert.deepEqual(
      razonamientoCorreccion(config({ reasoningEffort: nivel, reasoningParam: 'reasoning_effort' })),
      { reasoning_effort: 'low' },
      `configurado en "${nivel}", la corrección tiene que pedir "low"`,
    );
  }
});

await prueba('razonamientoCorreccion: thinking siempre prendido, sin importar el nivel', () => {
  for (const nivel of ['none', 'low', 'high', 'max']) {
    assert.deepEqual(
      razonamientoCorreccion(config({ reasoningEffort: nivel, reasoningParam: 'thinking' })),
      { thinking: { type: 'enabled' } },
      `configurado en "${nivel}", la corrección tiene que prender el thinking`,
    );
  }
});

// ─────────────────────────────────────────────────────────────
// Autoprueba + autocorrección (T12, round 3 de arnes-robustez)
// ─────────────────────────────────────────────────────────────

function errorDePrueba(extra: Partial<ErrorAutoprueba> = {}): ErrorAutoprueba {
  return { tipo: 'error', mensaje: 'algo explotó', linea: 5, columna: 3, accion: 'al cargar', ...extra };
}

await prueba('necesitaCorreccion: con errores, aunque reinicioOk sea true', () => {
  assert.equal(necesitaCorreccion({ errores: [errorDePrueba()], reinicioOk: true }), true);
});

await prueba('necesitaCorreccion: reinicioOk === false, aunque no haya errores', () => {
  assert.equal(necesitaCorreccion({ errores: [], reinicioOk: false }), true);
});

await prueba('necesitaCorreccion: reinicioOk === null (sin botón de reinicio) NO cuenta solo', () => {
  assert.equal(necesitaCorreccion({ errores: [], reinicioOk: null }), false);
});

await prueba('necesitaCorreccion: sin errores y reinicioOk true, todo sano', () => {
  assert.equal(necesitaCorreccion({ errores: [], reinicioOk: true }), false);
});

await prueba('lineaFuente: línea válida con contexto 1 marca la línea pedida y trae sus vecinas', () => {
  const html = 'a\nb\nc\nd\ne';
  const resultado = lineaFuente(html, 3);
  assert.ok(resultado, 'tiene que devolver algo');
  assert.equal(resultado, '  2: b\n> 3: c\n  4: d');
});

await prueba('lineaFuente: la primera línea no se sale del rango hacia arriba', () => {
  const html = 'a\nb\nc';
  const resultado = lineaFuente(html, 1);
  assert.equal(resultado, '> 1: a\n  2: b');
});

await prueba('lineaFuente: null si no hay número de línea', () => {
  assert.equal(lineaFuente('a\nb\nc', null), null);
});

await prueba('lineaFuente: null si el número está fuera de rango del HTML actual', () => {
  assert.equal(lineaFuente('a\nb\nc', 9999), null);
});

await prueba('construirMensajeCorreccion: cita el mensaje, la acción y la línea de origen EXACTA', () => {
  const html = Array.from({ length: 10 }, (_, i) => (i === 4 ? 'boton.onclick = funcionQueNoExiste;' : `linea${i}`)).join(
    '\n',
  );
  const mensaje = construirMensajeCorreccion({
    html,
    informe: {
      errores: [errorDePrueba({ mensaje: 'funcionQueNoExiste is not defined', linea: 5, accion: "al tocar el botón 'Feo'" })],
      reinicioOk: null,
      exitoVisibleAlInicio: false,
      diferencias: { textoQueFalta: [], textoQueSobra: [], controles: [] },
    },
    ronda: 1,
  });

  assert.ok(mensaje.includes('Autoprueba automática antes de entregarle el recurso al docente.'), 'lleva el marcador estable (T13 lo usa para el mock)');
  assert.ok(mensaje.includes('ronda 1 de 2'));
  assert.ok(mensaje.includes('funcionQueNoExiste is not defined'), 'tiene que citar el mensaje EXACTO del error');
  assert.ok(mensaje.includes("al tocar el botón 'Feo'"), 'tiene que citar la acción');
  assert.ok(mensaje.includes('boton.onclick = funcionQueNoExiste;'), 'tiene que citar el TEXTO de la línea de origen');
  assert.ok(mensaje.includes('línea 5'));
});

await prueba('construirMensajeCorreccion: reinicioOk false cita lo que falta, lo que sobra y los controles', () => {
  const mensaje = construirMensajeCorreccion({
    html: 'x',
    informe: {
      errores: [],
      reinicioOk: false,
      exitoVisibleAlInicio: false,
      diferencias: {
        textoQueFalta: ['Puntaje: 0'],
        textoQueSobra: ['Intentaste 3 veces'],
        controles: [{ etiqueta: 'Nivel', antes: 1, despues: 3 }],
      },
    },
    ronda: 2,
  });

  assert.ok(mensaje.includes('no vuelve el recurso al estado inicial'));
  assert.ok(mensaje.includes('Puntaje: 0'));
  assert.ok(mensaje.includes('Intentaste 3 veces'));
  assert.ok(mensaje.includes('Nivel') && mensaje.includes('antes: 1') && mensaje.includes('ahora: 3'));
  assert.ok(mensaje.includes('ronda 2 de 2'));
});

await prueba('construirMensajeCorreccion: exitoVisibleAlInicio agrega la nota, sólo cuando ya se está corrigiendo', () => {
  const conExito = construirMensajeCorreccion({
    html: 'x',
    informe: {
      errores: [errorDePrueba()],
      reinicioOk: null,
      exitoVisibleAlInicio: true,
      diferencias: { textoQueFalta: [], textoQueSobra: [], controles: [] },
    },
    ronda: 1,
  });
  assert.ok(/completado|logrado/i.test(conExito), 'tiene que mencionar el mensaje de éxito visible al inicio');

  const sinExito = construirMensajeCorreccion({
    html: 'x',
    informe: {
      errores: [errorDePrueba()],
      reinicioOk: null,
      exitoVisibleAlInicio: false,
      diferencias: { textoQueFalta: [], textoQueSobra: [], controles: [] },
    },
    ronda: 1,
  });
  assert.ok(!/completado|logrado/i.test(sinExito), 'sin exitoVisibleAlInicio no tiene que aparecer la nota');
});

// ─────────────────────────────────────────────────────────────
// Checklist del docente + pruebas fallidas (T17, round 4 de arnes-robustez)
// ─────────────────────────────────────────────────────────────

function pruebaDePrueba(extra: Partial<ResultadoPrueba> = {}): ResultadoPrueba {
  return { id: 'c1', ok: false, detalle: 'el veredicto no dice "equivalentes"', ...extra };
}

await prueba('necesitaCorreccion: una prueba de window.__koduPruebas con ok:false dispara igual que un error', () => {
  assert.equal(
    necesitaCorreccion({ errores: [], reinicioOk: true, pruebas: [pruebaDePrueba()] }),
    true,
  );
});

await prueba('necesitaCorreccion: pruebas todas ok:true no dispara nada por sí solas', () => {
  assert.equal(
    necesitaCorreccion({ errores: [], reinicioOk: true, pruebas: [pruebaDePrueba({ ok: true, detalle: 'ok' })] }),
    false,
  );
});

await prueba('necesitaCorreccion: pruebas ausentes o null se tratan igual que "sin checklist"', () => {
  assert.equal(necesitaCorreccion({ errores: [], reinicioOk: true }), false);
  assert.equal(necesitaCorreccion({ errores: [], reinicioOk: true, pruebas: null }), false);
});

await prueba(
  'construirMensajeCorreccion: cita el id, el TEXTO del ítem (por checklist) y el detalle de cada prueba fallida',
  () => {
    const checklist: ItemChecklist[] = [
      { id: 'c1', texto: 'Si pinto 1/2 y 3/6, dice que son equivalentes' },
      { id: 'c2', texto: 'Mover dos datos no cumple el desafío 1' },
    ];
    const mensaje = construirMensajeCorreccion({
      html: 'x',
      informe: {
        errores: [],
        reinicioOk: null,
        exitoVisibleAlInicio: false,
        diferencias: { textoQueFalta: [], textoQueSobra: [], controles: [] },
        pruebas: [
          pruebaDePrueba({ id: 'c1', ok: false, detalle: 'el veredicto no dice "equivalentes"' }),
          pruebaDePrueba({ id: 'c2', ok: true, detalle: 'todo bien' }),
        ],
      },
      ronda: 1,
      checklist,
    });

    assert.ok(mensaje.includes('c1'), 'tiene que citar el id de la prueba fallida');
    assert.ok(
      mensaje.includes('Si pinto 1/2 y 3/6, dice que son equivalentes'),
      'tiene que citar el TEXTO del ítem, no sólo el id',
    );
    assert.ok(
      mensaje.includes('el veredicto no dice "equivalentes"'),
      'tiene que citar el detalle exacto que devolvió la prueba',
    );
    assert.ok(!mensaje.includes('c2'), 'una prueba con ok:true no se cita');
    assert.ok(
      /nunca debilites|nunca.*borres/i.test(mensaje),
      'tiene que instruir a no debilitar ni borrar una prueba para que pase',
    );
    assert.ok(
      /RECURSO.*PRUEBA|recurso.*prueba/i.test(mensaje),
      'tiene que pedir decidir primero cuál de los dos (recurso o prueba) está mal',
    );
  },
);

await prueba('construirMensajeCorreccion: sin checklist, cita igual el id y el detalle (sin el texto del ítem)', () => {
  const mensaje = construirMensajeCorreccion({
    html: 'x',
    informe: {
      errores: [],
      reinicioOk: null,
      exitoVisibleAlInicio: false,
      diferencias: { textoQueFalta: [], textoQueSobra: [], controles: [] },
      pruebas: [pruebaDePrueba({ id: 'c9', detalle: 'no coincide' })],
    },
    ronda: 1,
  });

  assert.ok(mensaje.includes('c9'));
  assert.ok(mensaje.includes('no coincide'));
});

await prueba('construirMensajeCorreccion: sin pruebas fallidas, no aparece ninguna sección de checklist', () => {
  const mensaje = construirMensajeCorreccion({
    html: 'x',
    informe: {
      errores: [errorDePrueba()],
      reinicioOk: null,
      exitoVisibleAlInicio: false,
      diferencias: { textoQueFalta: [], textoQueSobra: [], controles: [] },
      pruebas: [pruebaDePrueba({ ok: true })],
    },
    ronda: 1,
  });

  assert.ok(!/checklist/i.test(mensaje));
});

await prueba('esVelocidadValida: sólo "fast"/"deep" (el vocabulario del wire) son válidas', () => {
  assert.equal(esVelocidadValida('fast'), true);
  assert.equal(esVelocidadValida('deep'), true);
  assert.equal(esVelocidadValida('rapido'), false, 'ese es el vocabulario de Capacidades, no el de localStorage');
  assert.equal(esVelocidadValida('a_fondo'), false);
  assert.equal(esVelocidadValida(null), false);
  assert.equal(esVelocidadValida(''), false);
});

// ─────────────────────────────────────────────────────────────
// estadoDeChecklist / contarChecklistOk (T18, "Esto es lo que probé")
// ─────────────────────────────────────────────────────────────

const ITEMS_CHECKLIST_UI: ItemChecklist[] = [
  { id: 'c1', texto: 'Si arrastro el punto a 3/4, el texto muestra 3/4.' },
  { id: 'c2', texto: 'Tocar "Reiniciar" borra el mensaje de la ronda anterior.' },
  { id: 'c3', texto: 'Con 0 aciertos no aparece el festejo.' },
];

await prueba('estadoDeChecklist: sin ninguna corrida todavía (undefined), todos "sinProbar"', () => {
  const resultado = estadoDeChecklist(ITEMS_CHECKLIST_UI, undefined);
  assert.equal(resultado.length, 3);
  assert.ok(resultado.every((item) => item.estado === 'sinProbar'));
  assert.ok(resultado.every((item) => item.detalle === null));
  assert.equal(contarChecklistOk(resultado), 0);
});

await prueba('estadoDeChecklist: corrida sin window.__koduPruebas (null), todos "sinPrueba"', () => {
  const resultado = estadoDeChecklist(ITEMS_CHECKLIST_UI, null);
  assert.ok(resultado.every((item) => item.estado === 'sinPrueba'));
  assert.equal(contarChecklistOk(resultado), 0);
});

await prueba('estadoDeChecklist: cruza por id — ok/falla/sin prueba propia, nunca por posición', () => {
  const pruebas: ResultadoPrueba[] = [
    { id: 'c1', ok: true, detalle: '' },
    { id: 'c3', ok: false, detalle: 'sigue apareciendo el festejo con 0 aciertos' },
    // c2 sin entrada: el modelo no escribió una prueba para ese ítem.
  ];
  const resultado = estadoDeChecklist(ITEMS_CHECKLIST_UI, pruebas);

  const porId = Object.fromEntries(resultado.map((item) => [item.id, item]));
  assert.equal(porId.c1!.estado, 'ok');
  assert.equal(porId.c1!.detalle, null, 'una prueba que pasó no lleva detalle');
  assert.equal(porId.c2!.estado, 'sinPrueba', 'sin entrada con ese id, aunque SÍ corrieron pruebas');
  assert.equal(porId.c3!.estado, 'falla');
  assert.equal(porId.c3!.detalle, 'sigue apareciendo el festejo con 0 aciertos');
  assert.equal(contarChecklistOk(resultado), 1, 'sólo c1 cuenta para el resumen "N de TOTAL"');
});

await prueba(
  'estadoDeChecklist (T23): un recurso que probó con ids propios (no c1..cN) deja TODO el checklist "sinPrueba"',
  () => {
    // Reproduce el defecto real: sin la instrucción explícita de ids, el
    // modelo escribió `window.__koduPruebas` con sus propios ids en vez de
    // los del checklist — el cruce por id no encuentra ninguno.
    const pruebasConIdsPropios: ResultadoPrueba[] = [
      { id: 'prueba-reinicio', ok: true, detalle: '' },
      { id: 'prueba-festejo', ok: false, detalle: 'no debería aparecer' },
      { id: 'prueba-arrastre', ok: true, detalle: '' },
    ];
    const resultado = estadoDeChecklist(ITEMS_CHECKLIST_UI, pruebasConIdsPropios);
    assert.ok(
      resultado.every((item) => item.estado === 'sinPrueba'),
      'ningún id propio coincide con c1/c2/c3, así que ningún ítem se puede dar por probado',
    );
    assert.equal(contarChecklistOk(resultado), 0);
  },
);

await prueba('estadoDeChecklist: [] de checklist da [] de resultado (nunca revienta con corrida vacía)', () => {
  assert.deepEqual(estadoDeChecklist([], undefined), []);
  assert.deepEqual(estadoDeChecklist([], []), []);
});

await prisma.$disconnect();

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/unidad.ts: todas las pruebas pasaron');
}
