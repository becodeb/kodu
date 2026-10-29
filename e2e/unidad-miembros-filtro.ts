import assert from 'node:assert/strict';
import { filtrarYOrdenar, normalizarBusqueda, sinActividadReciente, type ConsultaMiembros } from '../src/lib/orgs/filtrarMiembros.ts';
import type { MiembroOrganizacion } from '../src/lib/orgs/gestion.ts';

/**
 * Pruebas puras de la búsqueda / filtro / orden de la lista de docentes de
 * una sede (`MiembrosLista`). Fixtures en memoria, sin base ni navegador.
 *
 * Ejecutar con: npx tsx e2e/unidad-miembros-filtro.ts
 */

const AHORA = new Date('2026-10-29T12:00:00Z').getTime();
const haceDias = (dias: number) => new Date(AHORA - dias * 86_400_000).toISOString();

function miembro(id: string, name: string, extra: Partial<MiembroOrganizacion> = {}): MiembroOrganizacion {
  return {
    id,
    name,
    email: `${id}@colegio.test`,
    emailVerificationSource: 'EMAIL',
    createdAt: haceDias(400),
    esAdmin: false,
    facturacion: false,
    recursos: 0,
    ultimaActividad: null,
    ...extra,
  };
}

const MIEMBROS = [
  miembro('lucia', 'Lucía Fernández', { esAdmin: true, facturacion: true, recursos: 12, ultimaActividad: haceDias(1) }),
  miembro('ana', 'Ana María Pérez', { recursos: 3, ultimaActividad: haceDias(10) }),
  miembro('zoe', 'Zoe Álvarez', { recursos: 7, ultimaActividad: haceDias(45) }),
  miembro('bruno', 'bruno gómez', { esAdmin: true, recursos: 0, ultimaActividad: null }),
  miembro('carla', 'Carla Núñez', { recursos: 3, ultimaActividad: haceDias(30) }),
];

const base: ConsultaMiembros = { busqueda: '', filtro: 'todos', orden: 'nombre' };
const ids = (consulta: Partial<ConsultaMiembros>) =>
  filtrarYOrdenar(MIEMBROS, { ...base, ...consulta }, AHORA).map((m) => m.id);

let fallas = 0;
function prueba(nombre: string, fn: () => void): void {
  try {
    fn();
    console.log(`✔ ${nombre}`);
  } catch (error) {
    fallas++;
    console.error(`✖ ${nombre}`);
    console.error(`  ${(error as Error).message}`);
  }
}

prueba('normalizarBusqueda: minúsculas, sin acentos ni espacios de más', () => {
  assert.equal(normalizarBusqueda('  LUCÍA Fernández '), 'lucia fernandez');
  assert.equal(normalizarBusqueda('Núñez'), 'nunez');
});

prueba('orden por nombre ignora mayúsculas y acentos (A–Z)', () => {
  assert.deepEqual(ids({}), ['ana', 'bruno', 'carla', 'lucia', 'zoe']);
});

prueba('búsqueda por nombre sin acentos ni mayúsculas', () => {
  assert.deepEqual(ids({ busqueda: 'lucia' }), ['lucia']);
  assert.deepEqual(ids({ busqueda: 'ÁLVAREZ' }), ['zoe']);
  assert.deepEqual(ids({ busqueda: 'nunez' }), ['carla']);
});

prueba('búsqueda por email', () => {
  assert.deepEqual(ids({ busqueda: 'bruno@colegio' }), ['bruno']);
  assert.deepEqual(ids({ busqueda: '@colegio.test' }), ['ana', 'bruno', 'carla', 'lucia', 'zoe']);
});

prueba('cada palabra de la búsqueda tiene que aparecer (en cualquier orden)', () => {
  assert.deepEqual(ids({ busqueda: 'perez ana' }), ['ana']);
  assert.deepEqual(ids({ busqueda: 'ana zoe' }), []);
});

prueba('búsqueda vacía o de puro espacio no filtra', () => {
  assert.equal(ids({ busqueda: '   ' }).length, 5);
});

prueba('filtro Admins / Docentes', () => {
  assert.deepEqual(ids({ filtro: 'admins' }), ['bruno', 'lucia']);
  assert.deepEqual(ids({ filtro: 'docentes' }), ['ana', 'carla', 'zoe']);
});

prueba('filtro Sin actividad: nunca, o más de 30 días (30 justos todavía cuenta como reciente)', () => {
  assert.deepEqual(ids({ filtro: 'inactivos' }), ['bruno', 'zoe']);
  assert.equal(sinActividadReciente(MIEMBROS[4]!, AHORA), false, 'carla: exactamente 30 días');
});

prueba('orden Más recursos: descendente, empate por nombre', () => {
  assert.deepEqual(ids({ orden: 'recursos' }), ['lucia', 'zoe', 'ana', 'carla', 'bruno']);
});

prueba('orden Actividad más reciente: quien nunca hizo nada va al final', () => {
  assert.deepEqual(ids({ orden: 'actividad' }), ['lucia', 'ana', 'carla', 'zoe', 'bruno']);
});

prueba('búsqueda + filtro + orden se combinan', () => {
  assert.deepEqual(ids({ busqueda: 'a', filtro: 'docentes', orden: 'recursos' }), ['zoe', 'ana', 'carla']);
});

prueba('no muta la lista original', () => {
  const copia = MIEMBROS.map((m) => m.id);
  filtrarYOrdenar(MIEMBROS, { ...base, orden: 'recursos' }, AHORA);
  assert.deepEqual(MIEMBROS.map((m) => m.id), copia);
});

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('\nTodas las pruebas pasaron.');
