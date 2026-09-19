import { prisma } from '../db.ts';
import { leerAppSettings } from '../settings.ts';
import { buscarCuentaDemo, consumoDeLaDemo } from '../demo.ts';

/**
 * Resumen server-side para `/admin/demo` (design.md §8). Todo ya convertido
 * a valores planos antes de cruzar a `DemoPanel.tsx` (una isla `client:load`
 * que nunca debe importar el cliente de Prisma generado) — mismo patrón que
 * `lib/admin/dominios.ts`/`modelos.ts`.
 */
export interface ResumenDemo {
  demoEnabled: boolean;
  demoTokenLimit: number;
  /** ISO, ya convertido — un `Date` crudo cruzando a la isla es el mismo
   *  tipo de trampa que `Prisma.Decimal`. */
  demoCycleStartedAt: string;
  consumoTokens: number;
  cantidadRecursos: number;
  cuentaExiste: boolean;
}

export async function resumenDemo(): Promise<ResumenDemo> {
  const [settings, cuenta] = await Promise.all([leerAppSettings(), buscarCuentaDemo()]);

  const [consumoTokens, cantidadRecursos] = await Promise.all([
    cuenta ? consumoDeLaDemo() : Promise.resolve(0),
    prisma.project.count({ where: { createdByDemo: true } }),
  ]);

  return {
    demoEnabled: settings.demoEnabled,
    demoTokenLimit: settings.demoTokenLimit,
    demoCycleStartedAt: settings.demoCycleStartedAt.toISOString(),
    consumoTokens,
    cantidadRecursos,
    cuentaExiste: cuenta !== null,
  };
}
