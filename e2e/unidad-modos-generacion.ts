import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/db.ts';
import { cifrar } from '../src/lib/crypto/secretos.ts';
import {
  MODES,
  MODO_PERSONALIZADO_KEY,
  modeByKey,
  esClaveDeModoConocida,
  modoEfectivo,
  inicioDelCiclo,
  finDelCiclo,
  proyeccionDeCierre,
} from '../src/lib/ai/modos-generacion.ts';
import { invalidarCatalogo, motorParaRol, motorDeGeneracion } from '../src/lib/ai/catalogo.ts';

/**
 * T7 (motor-claude): pruebas de `src/lib/ai/modos-generacion.ts` (puras,
 * sin base) y de la resolución modo→rol de `catalogo.ts` (contra la base
 * real — igual que `unidad-creditos.ts`, hace falta un `AiModel` de verdad
 * para probar el camino completo "preset → motor habilitado → esfuerzo del
 * modo", y el respaldo cuando el motor que pide el modo no existe).
 *
 * Ejecutar con: npx tsx e2e/unidad-modos-generacion.ts
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

// ---------------------------------------------------------------------------
// Puras: modos, clave efectiva, ventana del ciclo, proyección.
// ---------------------------------------------------------------------------

await prueba('MODES: las seis claves de preset, personalizado aparte', () => {
  assert.ok(MODES.base);
  assert.ok(MODES['revisor-sonnet']);
  assert.ok(MODES['crea-sonnet']);
  assert.ok(MODES['crea-opus']);
  assert.ok(MODES['todo-sonnet']);
  assert.ok(MODES['todo-opus']);
  assert.equal(MODES[MODO_PERSONALIZADO_KEY], undefined, 'personalizado no es un preset-mode');
});

await prueba('modeByKey/esClaveDeModoConocida: clave desconocida -> null, pero personalizado SÍ es conocida', () => {
  assert.equal(modeByKey('no-existe'), null);
  assert.equal(esClaveDeModoConocida('no-existe'), false);
  assert.equal(esClaveDeModoConocida(MODO_PERSONALIZADO_KEY), true);
  assert.equal(modeByKey(MODO_PERSONALIZADO_KEY), null, 'personalizado no vive en MODES');
});

await prueba('crea-sonnet: crea con Sonnet medium, ajusta con Haiku low (el revisor queda en Haiku)', () => {
  const modo = MODES['crea-sonnet']!;
  assert.deepEqual(modo.roles.creation, { presetKey: 'claude-sonnet-5-5', effort: 'medium' });
  assert.deepEqual(modo.roles.adjustment, { presetKey: 'claude-haiku-5-5', effort: 'low' });
  assert.deepEqual(modo.roles.reviewer, { presetKey: 'claude-haiku-5-5', effort: 'low' });
});

await prueba('revisor-sonnet: crea/ajusta igual que base, sólo cambia el revisor', () => {
  const modo = MODES['revisor-sonnet']!;
  assert.deepEqual(modo.roles.creation, MODES.base!.roles.creation);
  assert.deepEqual(modo.roles.adjustment, MODES.base!.roles.adjustment);
  assert.deepEqual(modo.roles.reviewer, { presetKey: 'claude-sonnet-5-5', effort: 'low' });
});

await prueba('todo-opus: crea Y ajusta con Opus medium', () => {
  const modo = MODES['todo-opus']!;
  assert.deepEqual(modo.roles.creation, { presetKey: 'claude-opus-5-5', effort: 'medium' });
  assert.deepEqual(modo.roles.adjustment, { presetKey: 'claude-opus-5-5', effort: 'medium' });
});

await prueba('modoEfectivo: "base" nunca cambia, pase lo que pase con el gasto', () => {
  assert.equal(modoEfectivo('base', 0, 100), 'base');
  assert.equal(modoEfectivo('base', 999, 100), 'base');
});

await prueba('modoEfectivo: clave desconocida (modo sacado del código) -> base, sin importar el gasto', () => {
  assert.equal(modoEfectivo('modo-que-ya-no-existe', 0, 100), 'base');
});

await prueba('modoEfectivo: por debajo del tope premium, se respeta el modo configurado', () => {
  assert.equal(modoEfectivo('crea-opus', 99.99, 100), 'crea-opus');
  assert.equal(modoEfectivo(MODO_PERSONALIZADO_KEY, 50, 100), MODO_PERSONALIZADO_KEY);
});

await prueba('modoEfectivo: en o por encima del tope premium, CUALQUIER modo (incluido personalizado) cae a base', () => {
  assert.equal(modoEfectivo('crea-opus', 100, 100), 'base', 'el límite es inclusive');
  assert.equal(modoEfectivo('todo-sonnet', 150, 100), 'base');
  assert.equal(modoEfectivo(MODO_PERSONALIZADO_KEY, 100, 100), 'base');
});

await prueba('inicioDelCiclo: el corte de este mes ya pasó -> arranca este mes', () => {
  const ahora = new Date('2026-03-15T12:00:00.000Z');
  const inicio = inicioDelCiclo(10, ahora);
  assert.equal(inicio.toISOString(), '2026-03-10T00:00:00.000Z');
});

await prueba('inicioDelCiclo: el corte de este mes todavía no llegó -> arranca el mes anterior', () => {
  const ahora = new Date('2026-03-05T12:00:00.000Z');
  const inicio = inicioDelCiclo(10, ahora);
  assert.equal(inicio.toISOString(), '2026-02-10T00:00:00.000Z');
});

await prueba('inicioDelCiclo: cruce de año (enero, corte todavía no llegó -> diciembre del año anterior)', () => {
  const ahora = new Date('2026-01-15T00:00:00.000Z');
  const inicio = inicioDelCiclo(20, ahora);
  assert.equal(inicio.toISOString(), '2025-12-20T00:00:00.000Z');
});

await prueba('inicioDelCiclo: billingCycleDay=28 en febrero (mes corto) no rompe nada', () => {
  const ahora = new Date('2026-02-27T00:00:00.000Z');
  const inicio = inicioDelCiclo(28, ahora);
  assert.equal(inicio.toISOString(), '2026-01-28T00:00:00.000Z');
});

await prueba('inicioDelCiclo: un día fuera de rango (31, "mes de 31 días") se recorta a 28, nunca NaN', () => {
  const ahora = new Date('2026-03-15T00:00:00.000Z');
  const inicio = inicioDelCiclo(31, ahora);
  assert.equal(Number.isNaN(inicio.getTime()), false);
  // Recortado a 28: el corte de marzo (28) todavía no llegó (estamos el 15),
  // así que el ciclo vigente arrancó en febrero.
  assert.equal(inicio.toISOString(), '2026-02-28T00:00:00.000Z');
});

await prueba('finDelCiclo: el próximo corte, mismo día, un mes después (cruzando a enero)', () => {
  const inicio = new Date('2025-12-20T00:00:00.000Z');
  const fin = finDelCiclo(20, inicio);
  assert.equal(fin.toISOString(), '2026-01-20T00:00:00.000Z');
});

await prueba('proyeccionDeCierre: gasto lineal simple (mitad del ciclo, mitad del gasto proyectado al doble)', () => {
  const inicio = new Date('2026-03-01T00:00:00.000Z');
  const fin = new Date('2026-04-01T00:00:00.000Z'); // 31 días
  const mitad = new Date('2026-03-16T00:00:00.000Z'); // ~15 días transcurridos
  const proyeccion = proyeccionDeCierre(50, inicio, fin, mitad);
  // 50 / 15 * 31 ≈ 103.3 — no exacto por los días reales, sólo un rango sano.
  assert.ok(proyeccion > 95 && proyeccion < 110, `proyección fuera de rango: ${proyeccion}`);
});

await prueba('proyeccionDeCierre: ciclo recién arrancado (ahora === inicio) nunca da Infinity/NaN', () => {
  const inicio = new Date('2026-03-01T00:00:00.000Z');
  const fin = new Date('2026-04-01T00:00:00.000Z');
  const proyeccion = proyeccionDeCierre(0.01, inicio, fin, inicio);
  assert.equal(Number.isFinite(proyeccion), true);
});

// ---------------------------------------------------------------------------
// Resolución modo→rol contra la base real (catalogo.ts#motorParaRol/motorDeGeneracion).
// ---------------------------------------------------------------------------

const SUFIJO = randomUUID().slice(0, 8);
let providerId: string | null = null;
let haikuId: string | null = null;
let sonnetId: string | null = null;
let personalizadoId: string | null = null;

async function limpiar(): Promise<void> {
  await prisma.aiModel.deleteMany({ where: { providerId: providerId ?? '__ninguno__' } });
  if (providerId) await prisma.aiProvider.delete({ where: { id: providerId } }).catch(() => {});
  invalidarCatalogo();
}

try {
  providerId = randomUUID();
  await prisma.aiProvider.create({
    data: {
      id: providerId,
      kind: `test-modos-${SUFIJO}`,
      label: `Cuenta de prueba modos-generacion ${SUFIJO}`,
      baseUrl: 'https://api.anthropic.com',
      apiFormat: 'anthropic',
      enabled: true,
      // Sin clave utilizable, `catalogo.ts#tieneClaveUtilizable` descarta
      // cualquier motor de esta cuenta — una clave de prueba (nunca se usa
      // para pegarle a una API real en este archivo) alcanza para probar la
      // resolución modo→rol.
      apiKeyCipher: cifrar('clave-de-prueba-unidad-modos-generacion', providerId),
    },
  });

  const haiku = await prisma.aiModel.create({
    data: {
      id: randomUUID(),
      providerId,
      providerModel: 'claude-haiku-5-5',
      displayName: `Haiku prueba ${SUFIJO}`,
      presetKey: 'claude-haiku-5-5',
      enabled: true,
      selectableByTeacher: true,
      reasoningEffort: 'low',
      reasoningParam: 'effort',
      sortOrder: 0,
    },
  });
  haikuId = haiku.id;

  const sonnet = await prisma.aiModel.create({
    data: {
      id: randomUUID(),
      providerId,
      providerModel: 'claude-sonnet-5-5',
      displayName: `Sonnet prueba ${SUFIJO}`,
      presetKey: 'claude-sonnet-5-5',
      enabled: true,
      selectableByTeacher: true,
      reasoningEffort: 'low', // el default guardado — el MODO tiene que pisarlo con "medium".
      reasoningParam: 'effort',
      sortOrder: 1,
    },
  });
  sonnetId = sonnet.id;

  // "Personalizado": un motor SIN presetKey, con un esfuerzo propio bien
  // distinto ("high") — sirve para confirmar que motorParaRol('personalizado', ...)
  // nunca pisa este campo (a diferencia de la rama por preset).
  const personalizado = await prisma.aiModel.create({
    data: {
      id: randomUUID(),
      providerId,
      providerModel: 'claude-personalizado-5-5',
      displayName: `Personalizado prueba ${SUFIJO}`,
      presetKey: null,
      enabled: true,
      selectableByTeacher: false,
      reasoningEffort: 'high',
      reasoningParam: 'effort',
      sortOrder: 2,
    },
  });
  personalizadoId = personalizado.id;

  invalidarCatalogo();

  await prueba('motorParaRol: "base"/creation resuelve al motor enlazado al preset de Haiku, esfuerzo "low"', async () => {
    const config = await motorParaRol('base', 'creation', { creationModelId: null, adjustmentModelId: null });
    assert.equal(config?.id, haikuId);
    assert.equal(config?.reasoningEffort, 'low');
  });

  await prueba('motorParaRol: "crea-sonnet"/creation resuelve a Sonnet con esfuerzo "medium" (pisa el default "low" guardado)', async () => {
    const config = await motorParaRol('crea-sonnet', 'creation', { creationModelId: null, adjustmentModelId: null });
    assert.equal(config?.id, sonnetId);
    assert.equal(config?.reasoningEffort, 'medium');
  });

  await prueba('motorParaRol: "crea-sonnet"/adjustment sigue en Haiku (el rol de ajuste no cambió)', async () => {
    const config = await motorParaRol('crea-sonnet', 'adjustment', { creationModelId: null, adjustmentModelId: null });
    assert.equal(config?.id, haikuId);
    assert.equal(config?.reasoningEffort, 'low');
  });

  await prueba('motorParaRol: modo desconocido (sacado del código) se trata como "base", nunca null', async () => {
    const config = await motorParaRol('modo-que-ya-no-existe', 'creation', { creationModelId: null, adjustmentModelId: null });
    assert.equal(config?.id, haikuId);
  });

  await prueba('motorParaRol: "todo-opus"/creation sin ningún motor de Opus habilitado cae a "base" (nunca null)', async () => {
    const config = await motorParaRol('todo-opus', 'creation', { creationModelId: null, adjustmentModelId: null });
    assert.equal(config?.id, haikuId, 'ningún motor con presetKey claude-opus-5-5 está habilitado en esta prueba');
  });

  await prueba('motorParaRol: "personalizado" con un motor elegido devuelve ESE motor tal cual (esfuerzo propio, sin pisar)', async () => {
    const config = await motorParaRol(MODO_PERSONALIZADO_KEY, 'creation', {
      creationModelId: personalizadoId,
      adjustmentModelId: null,
    });
    assert.equal(config?.id, personalizadoId);
    assert.equal(config?.reasoningEffort, 'high', 'personalizado nunca pisa el esfuerzo del motor elegido');
  });

  await prueba('motorParaRol: "personalizado" sin elegir nada cae a "base"', async () => {
    const config = await motorParaRol(MODO_PERSONALIZADO_KEY, 'adjustment', {
      creationModelId: null,
      adjustmentModelId: null,
    });
    assert.equal(config?.id, haikuId);
  });

  await prueba('motorDeGeneracion: con engineChosenByTeacher, el modo NUNCA se consulta — se respeta el motor explícito', async () => {
    const config = await motorDeGeneracion({
      modelIdExplicitoDelPedido: sonnetId,
      project: { aiModelId: haikuId, engineChosenByTeacher: true },
      esCreacion: true,
      settings: { generationMode: 'todo-opus', creationModelId: null, adjustmentModelId: null },
    });
    // El modo pedido ("todo-opus") habría resuelto a Sonnet/Opus con otro
    // esfuerzo — si esto devolviera el motor del MODO en vez del explícito,
    // el reasoningEffort sería "medium", no el "low" guardado en la fila.
    assert.equal(config?.id, sonnetId);
    assert.equal(config?.reasoningEffort, 'low', 'motor explícito: se usa tal cual, sin que el modo le pise el esfuerzo');
  });

  await prueba('motorDeGeneracion: sin motor explícito, el modo decide según el rol (creación vs. ajuste)', async () => {
    const creacion = await motorDeGeneracion({
      modelIdExplicitoDelPedido: null,
      project: { aiModelId: null, engineChosenByTeacher: false },
      esCreacion: true,
      settings: { generationMode: 'crea-sonnet', creationModelId: null, adjustmentModelId: null },
    });
    assert.equal(creacion?.id, sonnetId);

    const ajuste = await motorDeGeneracion({
      modelIdExplicitoDelPedido: null,
      project: { aiModelId: null, engineChosenByTeacher: false },
      esCreacion: false,
      settings: { generationMode: 'crea-sonnet', creationModelId: null, adjustmentModelId: null },
    });
    assert.equal(ajuste?.id, haikuId);
  });

  await prueba(
    'motorDeGeneracion: si NI el modo pedido NI "base" tienen su preset configurado, respeta el motor que YA tenía el proyecto (nunca el default global)',
    async () => {
      // "todo-opus" no tiene motor de Opus habilitado en esta prueba, y
      // tampoco hay NADA enlazado al preset de Haiku en este sub-catálogo
      // artificial (se simula apagando momentáneamente el único motor
      // Haiku de la prueba) — el respaldo tiene que ser el propio
      // `project.aiModelId` (el motor "personalizado", sin presetKey, que
      // representa cualquier proyecto ajeno al sistema de modos), nunca
      // `motorPorDefecto()` de toda la instalación.
      await prisma.aiModel.update({ where: { id: haikuId! }, data: { enabled: false } });
      invalidarCatalogo();
      try {
        const config = await motorDeGeneracion({
          modelIdExplicitoDelPedido: null,
          project: { aiModelId: personalizadoId, engineChosenByTeacher: false },
          esCreacion: true,
          settings: { generationMode: 'todo-opus', creationModelId: null, adjustmentModelId: null },
        });
        assert.equal(config?.id, personalizadoId);
        assert.equal(config?.reasoningEffort, 'high', 'el respaldo es normalizarMotor: no pisa el esfuerzo del motor');
      } finally {
        await prisma.aiModel.update({ where: { id: haikuId! }, data: { enabled: true } });
        invalidarCatalogo();
      }
    },
  );

  await prueba(
    'T11 Parte 0: una ronda de corrección (esCreacion: false) en un modo híbrido resuelve al motor de AJUSTE (Haiku), nunca al de creación (Sonnet) que haya quedado en project.aiModelId',
    async () => {
      // Reproduce el estado real tras un turno de creación en "crea-sonnet":
      // `stream.ts` ya reescribió `project.aiModelId` con el motor que
      // resolvió ESE turno de creación (Sonnet) — `autocorreccion.ts` recibe
      // el proyecto en ese mismo estado al pedir la corrección posterior.
      const proyectoTrasCreacion = { aiModelId: sonnetId, engineChosenByTeacher: false };

      const paraCorreccion = await motorDeGeneracion({
        modelIdExplicitoDelPedido: null,
        project: proyectoTrasCreacion,
        esCreacion: false, // la corrección es siempre un ajuste, nunca una creación
        settings: { generationMode: 'crea-sonnet', creationModelId: null, adjustmentModelId: null },
      });
      assert.equal(paraCorreccion?.id, haikuId, 'la corrección debe resolver al motor de AJUSTE del modo, no heredar el de creación');

      // El motor de CREACIÓN, para contraste directo: distinto del de
      // corrección, y es justo el que `project.aiModelId` tiene guardado —
      // confirma que el bug (reusar `project.aiModelId` tal cual) habría
      // devuelto Sonnet en vez de Haiku.
      const paraCreacion = await motorDeGeneracion({
        modelIdExplicitoDelPedido: null,
        project: proyectoTrasCreacion,
        esCreacion: true,
        settings: { generationMode: 'crea-sonnet', creationModelId: null, adjustmentModelId: null },
      });
      assert.equal(paraCreacion?.id, sonnetId);
      assert.notEqual(paraCorreccion?.id, paraCreacion?.id);
    },
  );

  await prueba('T11 Parte 0: en "crea-opus", la corrección también cae en Haiku (el modo "todo-*" sigue usando el mismo motor caro)', async () => {
    const paraCorreccion = await motorDeGeneracion({
      modelIdExplicitoDelPedido: null,
      project: { aiModelId: sonnetId, engineChosenByTeacher: false },
      esCreacion: false,
      settings: { generationMode: 'crea-opus', creationModelId: null, adjustmentModelId: null },
    });
    assert.equal(paraCorreccion?.id, haikuId);
  });
} finally {
  await limpiar();
}

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('\nTodo OK.');
