import 'dotenv/config';
import assert from 'node:assert/strict';
import { esTallerSinRazonamiento } from '../src/lib/taller/razonamiento.ts';

/**
 * Pruebas unitarias de odd/tasks/ahorro-tokens.md (T2):
 * src/lib/taller/razonamiento.ts#esTallerSinRazonamiento — la regla PURA de
 * si el Taller de ideas corre con razonamiento apagado. El resolver async
 * que pega contra la base (`debeTallerDesactivarRazonamiento`) se cubre en
 * el e2e de taller-de-ideas.ts, contra el proveedor simulado.
 *
 * Sin Prisma ni Node: módulo puro, mismo criterio que unidad-kit.ts.
 * Ejecutar con: npx tsx e2e/unidad-taller-razonamiento.ts
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

await prueba('esTallerSinRazonamiento: cuenta personal sin suscripción vigente (FREE) → true', () => {
  assert.equal(esTallerSinRazonamiento({ organizationId: null, tieneSuscripcionIndividualVigente: false }), true);
});

await prueba('esTallerSinRazonamiento: cuenta personal CON suscripción Individual vigente (paga) → false', () => {
  assert.equal(esTallerSinRazonamiento({ organizationId: null, tieneSuscripcionIndividualVigente: true }), false);
});

await prueba('esTallerSinRazonamiento: cuenta de organización → false, sin importar la suscripción individual', () => {
  assert.equal(esTallerSinRazonamiento({ organizationId: 'org-1', tieneSuscripcionIndividualVigente: false }), false);
  assert.equal(esTallerSinRazonamiento({ organizationId: 'org-1', tieneSuscripcionIndividualVigente: true }), false);
});

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('\nTodo OK.');
