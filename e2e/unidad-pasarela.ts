import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/db.ts';
import { esCuitValido, formatearCuit } from '../src/lib/billing/cuit.ts';
import { GatewayMercadoPago } from '../src/lib/billing/pasarela/mercadopago.ts';
import { GatewaySimulado } from '../src/lib/billing/pasarela/simulado.ts';
import { procesarNotificacion } from '../src/lib/billing/aplicar.ts';
import { estimarCostoConservador } from '../src/lib/ai/usage.ts';

/**
 * odd/tasks/planes-y-cobros.md (T4): pruebas unitarias de
 * `src/lib/billing/pasarela/` y `src/lib/billing/cuit.ts`. La validación de
 * `x-signature` es pura (no pega a la red) y corre sin base; el mismatch de
 * monto y el replay idempotente corren contra la base real
 * (`koduedu_planes`), mismo criterio que `e2e/unidad-creditos.ts`.
 *
 * Ejecutar con: npx tsx e2e/unidad-pasarela.ts
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
// cuit.ts
// ─────────────────────────────────────────────────────────────

await prueba('esCuitValido: acepta un CUIT con dígito verificador correcto', () => {
  assert.equal(esCuitValido('20-12345678-6'), true);
  assert.equal(esCuitValido('20123456786'), true);
});

await prueba('esCuitValido: rechaza el mismo CUIT con el dígito verificador cambiado', () => {
  assert.equal(esCuitValido('20-12345678-7'), false);
});

await prueba('esCuitValido: rechaza largos distintos de 11 dígitos', () => {
  assert.equal(esCuitValido('123'), false);
  assert.equal(esCuitValido(''), false);
});

await prueba('formatearCuit: normaliza a XX-XXXXXXXX-X', () => {
  assert.equal(formatearCuit('20123456786'), '20-12345678-6');
});

// ─────────────────────────────────────────────────────────────
// mercadopago.ts — verifyNotification (x-signature), sin red.
// ─────────────────────────────────────────────────────────────

function armarXSignature(secret: string, dataId: string, requestId: string, ts: string): string {
  const manifiesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac('sha256', secret).update(manifiesto).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

await prueba('verifyNotification: firma válida se acepta', () => {
  const secret = 'clave-secreta-de-prueba';
  const gateway = new GatewayMercadoPago('token-no-usado', secret);
  const ts = '1700000000';
  const xSignature = armarXSignature(secret, 'pago123', 'req-abc', ts);
  const headers = new Headers({ 'x-signature': xSignature, 'x-request-id': 'req-abc' });
  const query = new URLSearchParams({ 'data.id': 'pago123' });
  assert.equal(gateway.verifyNotification(headers, query), true);
});

await prueba('verifyNotification: firma inválida (secreto distinto) se rechaza', () => {
  const gateway = new GatewayMercadoPago('token-no-usado', 'clave-secreta-de-prueba');
  const ts = '1700000000';
  const xSignature = armarXSignature('otra-clave', 'pago123', 'req-abc', ts);
  const headers = new Headers({ 'x-signature': xSignature, 'x-request-id': 'req-abc' });
  const query = new URLSearchParams({ 'data.id': 'pago123' });
  assert.equal(gateway.verifyNotification(headers, query), false);
});

await prueba('verifyNotification: header x-signature faltante se rechaza', () => {
  const gateway = new GatewayMercadoPago('token-no-usado', 'clave-secreta-de-prueba');
  const headers = new Headers();
  const query = new URLSearchParams({ 'data.id': 'pago123' });
  assert.equal(gateway.verifyNotification(headers, query), false);
});

await prueba('verifyNotification: sin MP_WEBHOOK_SECRET configurado, no hay nada que validar (true)', () => {
  const gateway = new GatewayMercadoPago('token-no-usado', '');
  const headers = new Headers();
  const query = new URLSearchParams();
  assert.equal(gateway.verifyNotification(headers, query), true);
});

// ─────────────────────────────────────────────────────────────
// mercadopago.ts — createSubscriptionCheckout: colchón de start_date.
// ─────────────────────────────────────────────────────────────

await prueba(
  'createSubscriptionCheckout: auto_recurring.start_date sale en el futuro aunque startDate sea "ahora" (T4c, sandbox real)',
  async () => {
    // Bug real encontrado probando contra el sandbox: Mercado Pago rechaza
    // `start_date` con "cannot be a past date" si se manda el instante EXACTO
    // de `billingNow()` — para cuando el request le llega, ya es pasado para
    // su reloj. Este test stubea `fetch` (sin red) y verifica que el body
    // mandado SIEMPRE queda estrictamente en el futuro respecto del
    // `startDate` pedido.
    const fetchOriginal = globalThis.fetch;
    let bodyEnviado: any;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodyEnviado = JSON.parse(init.body as string);
      return {
        ok: true,
        json: async () => ({ id: 'preapproval-fake', init_point: 'https://mp.example/x' }),
      } as Response;
    }) as typeof fetch;

    try {
      const gateway = new GatewayMercadoPago('token-no-usado', '');
      const ahora = new Date();
      await gateway.createSubscriptionCheckout({
        externalReference: 'pago-fake',
        reason: 'prueba',
        amountArs: 1000,
        frequency: 1,
        frequencyType: 'months',
        startDate: ahora,
        backUrl: 'https://kodu.example/back',
        payerEmail: 'buyer@testuser.com',
      });
      const startDateEnviado = new Date(bodyEnviado.auto_recurring.start_date);
      assert.ok(
        startDateEnviado.getTime() > ahora.getTime(),
        `start_date enviado (${bodyEnviado.auto_recurring.start_date}) debe quedar estrictamente en el futuro respecto de ${ahora.toISOString()}`,
      );
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  },
);

// ─────────────────────────────────────────────────────────────
// aplicar.ts — monto que no coincide, y replay idempotente (con base real).
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// usage.ts — estimarCostoConservador (T2b).
// ─────────────────────────────────────────────────────────────

await prueba('estimarCostoConservador: sin motor default con precio, usa el precio fijo conservador', async () => {
  // Baja temporalmente el default del seed (si tiene precio) para probar la
  // rama de fallback de verdad — se restaura en el `finally`.
  const defaultPrevio = await prisma.aiModel.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (defaultPrevio) await prisma.aiModel.update({ where: { id: defaultPrevio.id }, data: { isDefault: false } });

  try {
    const estimado = await estimarCostoConservador(1_000_000, 0, 1_000_000);
    // 1M de entrada + 1M de salida, al precio fijo (5 + 15 USD/M) = 20 USD.
    assert.equal(estimado.toNumber(), 20);
  } finally {
    if (defaultPrevio) await prisma.aiModel.update({ where: { id: defaultPrevio.id }, data: { isDefault: true } });
  }
});

await prueba('estimarCostoConservador: 0 tokens da 0 (nunca inventa un costo de la nada)', async () => {
  const estimado = await estimarCostoConservador(0, 0, 0);
  assert.equal(estimado.toNumber(), 0);
});

await prueba('estimarCostoConservador: con un motor default con precio cargado, usa ESE precio', async () => {
  // El índice único parcial de `AiModel.isDefault` (a lo sumo un `true` en
  // toda la tabla) obliga a bajar el default que ya trae el seed ANTES de
  // crear el temporal — se restaura en el `finally`.
  const defaultPrevio = await prisma.aiModel.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (defaultPrevio) await prisma.aiModel.update({ where: { id: defaultPrevio.id }, data: { isDefault: false } });

  const providerId = randomUUID();
  const modelId = randomUUID();
  await prisma.aiProvider.create({
    data: { id: providerId, kind: 'kodu-mock-pasarela-e2e', label: 'Mock pasarela e2e', baseUrl: 'http://localhost:0' },
  });
  await prisma.aiModel.create({
    data: {
      id: modelId,
      providerId,
      providerModel: 'mock-pasarela-e2e',
      displayName: 'Mock pasarela e2e',
      isDefault: true,
      priceInputPerMToken: 1,
      priceOutputPerMToken: 2,
    },
  });

  try {
    const estimado = await estimarCostoConservador(1_000_000, 0, 1_000_000);
    // 1M de entrada a 1 USD/M + 1M de salida a 2 USD/M = 3 USD (bien por
    // debajo de lo que daría el fallback fijo de 20 USD): confirma que usó
    // el precio del motor default, no el fallback.
    assert.equal(estimado.toNumber(), 3);
  } finally {
    await prisma.aiModel.delete({ where: { id: modelId } });
    await prisma.aiProvider.delete({ where: { id: providerId } });
    if (defaultPrevio) await prisma.aiModel.update({ where: { id: defaultPrevio.id }, data: { isDefault: true } });
  }
});

const SUFIJO = randomUUID().slice(0, 8);
const organizacionesCreadas: string[] = [];

async function crearOrgConLicenciaTrial(declaredStudents: number): Promise<{ orgId: string; licenseId: string }> {
  const org = await prisma.organization.create({
    data: { name: `Org pasarela E2E ${SUFIJO}-${randomUUID().slice(0, 4)}`, kind: 'CAMPUS' },
    select: { id: true },
  });
  organizacionesCreadas.push(org.id);
  const license = await prisma.organizationLicense.create({
    data: { organizationId: org.id, status: 'TRIAL', declaredStudents, trialEndsAt: new Date(Date.now() + 30 * 86_400_000) },
  });
  return { orgId: org.id, licenseId: license.id };
}

async function limpiar(): Promise<void> {
  for (const id of organizacionesCreadas) {
    await prisma.payment.deleteMany({ where: { organizationId: id } });
    await prisma.organization.deleteMany({ where: { id } });
  }
}

try {
  const gateway = new GatewaySimulado();

  await prueba('aplicar.ts: un monto que no coincide con lo esperado se loguea y NO se aplica', async () => {
    const { orgId, licenseId } = await crearOrgConLicenciaTrial(100);
    const checkout = await prisma.payment.create({
      data: {
        organizationId: orgId,
        organizationLicenseId: licenseId,
        amountArs: 10_000,
        status: 'PENDING',
        provider: 'SIMULADO',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 86_400_000),
        intervalSnapshot: 'MONTHLY',
      },
    });

    // Se simula un webhook que reporta un monto DISTINTO al del checkout —
    // el proveedor simulado lo permite creando la fila de PagoSimulado a
    // mano, con un monto que no coincide con `checkout.amountArs`.
    const pagoAjeno = await prisma.pagoSimulado.create({
      data: {
        kind: 'SUBSCRIPTION',
        externalReference: checkout.id,
        concept: 'monto adulterado',
        amountArs: 1, // muy distinto de los 10.000 esperados
        status: 'APPROVED',
        payerEmail: 'nadie@ejemplo.com',
        backUrl: '/org/plan',
      },
    });

    const resultado = await procesarNotificacion(gateway, { kind: 'payment', id: pagoAjeno.id });
    assert.equal(resultado.applied, false);
    assert.equal(resultado.reason, 'monto_no_coincide');

    const licenciaDespues = await prisma.organizationLicense.findUniqueOrThrow({ where: { id: licenseId } });
    assert.equal(licenciaDespues.status, 'TRIAL', 'la licencia no debe activarse con un monto que no coincide');
  });

  await prueba('aplicar.ts: un webhook repetido (replay) nunca aplica el efecto dos veces', async () => {
    const { orgId, licenseId } = await crearOrgConLicenciaTrial(100);
    const checkout = await prisma.payment.create({
      data: {
        organizationId: orgId,
        organizationLicenseId: licenseId,
        amountArs: 5_000,
        status: 'PENDING',
        provider: 'SIMULADO',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 86_400_000),
        intervalSnapshot: 'MONTHLY',
      },
    });
    const pagoSimulado = await prisma.pagoSimulado.create({
      data: {
        kind: 'SUBSCRIPTION',
        externalReference: checkout.id,
        concept: 'primer cobro',
        amountArs: 5_000,
        status: 'APPROVED',
        payerEmail: 'admin@ejemplo.com',
        backUrl: '/org/plan',
      },
    });

    const primeraVez = await procesarNotificacion(gateway, { kind: 'payment', id: pagoSimulado.id });
    assert.equal(primeraVez.applied, true);

    const licenciaTrasPrimeraVez = await prisma.organizationLicense.findUniqueOrThrow({ where: { id: licenseId } });
    assert.equal(licenciaTrasPrimeraVez.status, 'ACTIVE');

    // Replay: la MISMA notificación, otra vez.
    const segundaVez = await procesarNotificacion(gateway, { kind: 'payment', id: pagoSimulado.id });
    assert.equal(segundaVez.applied, false);
    assert.equal(segundaVez.reason, 'ya_aplicado');

    // La licencia sigue con el MISMO período (no se extendió dos veces).
    const licenciaTrasReplay = await prisma.organizationLicense.findUniqueOrThrow({ where: { id: licenseId } });
    assert.equal(licenciaTrasReplay.currentPeriodEnd?.getTime(), licenciaTrasPrimeraVez.currentPeriodEnd?.getTime());

    const pagos = await prisma.payment.findMany({ where: { organizationId: orgId } });
    assert.equal(pagos.length, 1, 'el replay no debe crear un segundo Payment');
  });
} finally {
  await limpiar();
  await prisma.$disconnect();
}

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad-pasarela.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/unidad-pasarela.ts: todas las pruebas pasaron');
}
