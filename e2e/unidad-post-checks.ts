import assert from 'node:assert/strict';
import {
  decidirResumenChequeosPosteriores,
  POST_CHECKS_CLAIM_STALE_MS,
  type MensajeElegiblePostChequeos,
} from '../src/lib/ai/post-checks.ts';

/**
 * Pruebas unitarias de la parte pura de T5
 * (odd/tasks/generacion-simple-y-reanudable.md): "¿hace falta correr el
 * self-test/corrección/verificador del navegador para el turno más nuevo
 * que cambió el HTML?" (`decidirResumenChequeosPosteriores`).
 *
 * Archivo separado, DB-free, mismo patrón que `e2e/unidad-versiones.ts`:
 * `lib/ai/post-checks.ts` es puro (nada de Prisma, nada de `fetch`, nada de
 * DOM) y no hace falta levantar nada para probarlo.
 *
 * `node:assert/strict` + `tsx`. Ejecutar con:
 *   npx tsx e2e/unidad-post-checks.ts
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

const HUELLA_ACTUAL = 'aabbccdd';
const AHORA = Date.parse('2026-10-07T12:00:00Z');

function mensaje(overrides: Partial<MensajeElegiblePostChequeos>): MensajeElegiblePostChequeos {
  return {
    resultHtmlFingerprint: HUELLA_ACTUAL,
    postChecksAt: null,
    postChecksClaimedAt: null,
    ...overrides,
  };
}

await prueba('sin ningún turno candidato → saltar (sin-turno)', () => {
  const decision = decidirResumenChequeosPosteriores(null, HUELLA_ACTUAL, AHORA);
  assert.deepEqual(decision, { accion: 'saltar', motivo: 'sin-turno' });
});

await prueba('turno con HTML cambiado, marca vacía y huella que coincide → correr', () => {
  const decision = decidirResumenChequeosPosteriores(mensaje({}), HUELLA_ACTUAL, AHORA);
  assert.deepEqual(decision, { accion: 'correr' });
});

await prueba('marca puesta (ya se chequeó) → saltar (ya-marcado), sin importar la huella', () => {
  const decision = decidirResumenChequeosPosteriores(
    mensaje({ postChecksAt: new Date(AHORA - 60_000), resultHtmlFingerprint: 'otra-huella' }),
    HUELLA_ACTUAL,
    AHORA,
  );
  assert.deepEqual(decision, { accion: 'saltar', motivo: 'ya-marcado' });
});

await prueba('huella que no coincide (edición a mano, u otro turno más nuevo) → saltar (huella-no-coincide)', () => {
  const decision = decidirResumenChequeosPosteriores(
    mensaje({ resultHtmlFingerprint: 'huella-vieja' }),
    HUELLA_ACTUAL,
    AHORA,
  );
  assert.deepEqual(decision, { accion: 'saltar', motivo: 'huella-no-coincide' });
});

await prueba('fila "legacy" del backfill (marca fija no-null) → saltar (ya-marcado), como cualquier marca', () => {
  const decision = decidirResumenChequeosPosteriores(
    mensaje({ postChecksAt: new Date('2026-10-07T00:00:00Z') }),
    HUELLA_ACTUAL,
    AHORA,
  );
  assert.deepEqual(decision, { accion: 'saltar', motivo: 'ya-marcado' });
});

await prueba('reclamado hace poco por otra pestaña → saltar (reclamado-por-otra-pestana)', () => {
  const decision = decidirResumenChequeosPosteriores(
    mensaje({ postChecksClaimedAt: new Date(AHORA - 1_000) }),
    HUELLA_ACTUAL,
    AHORA,
  );
  assert.deepEqual(decision, { accion: 'saltar', motivo: 'reclamado-por-otra-pestana' });
});

await prueba('reclamo justo en el borde del tope (edad == tope) → ya cuenta como viejo, correr', () => {
  // `< STALE_MS` es la condición de "todavía reciente": a la edad EXACTA del
  // tope ya no entra ahí, así que cae al 'correr' de más abajo — el mismo
  // criterio con el que se elige el límite del reclamo en `post-checks-db.ts`.
  const decision = decidirResumenChequeosPosteriores(
    mensaje({ postChecksClaimedAt: new Date(AHORA - POST_CHECKS_CLAIM_STALE_MS) }),
    HUELLA_ACTUAL,
    AHORA,
  );
  assert.deepEqual(decision, { accion: 'correr' });
});

await prueba('reclamo viejo (pestaña que se cerró a mitad de camino) → correr', () => {
  const decision = decidirResumenChequeosPosteriores(
    mensaje({ postChecksClaimedAt: new Date(AHORA - POST_CHECKS_CLAIM_STALE_MS - 1) }),
    HUELLA_ACTUAL,
    AHORA,
  );
  assert.deepEqual(decision, { accion: 'correr' });
});

if (fallas > 0) {
  console.error(`\n✖ e2e/unidad-post-checks.ts: ${fallas} prueba(s) fallaron`);
  process.exitCode = 1;
} else {
  console.log('\n✔ e2e/unidad-post-checks.ts: todas las pruebas pasaron');
}
