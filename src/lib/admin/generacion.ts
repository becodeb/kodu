import { prisma } from '../db.ts';
import { leerAppSettings } from '../settings.ts';

/** Una cuenta marcada a mano, para la lista de `/admin/generacion`. */
export interface CuentaMarcada {
  id: string;
  name: string;
  email: string;
}

export interface ResumenGeneracion {
  primeEnabled: boolean;
  autoReviewForAll: boolean;
  deepModeForAll: boolean;
  versionsForAll: boolean;
  cuentasMarcadas: CuentaMarcada[];
}

/**
 * `/admin/generacion` (T5, odd/tasks/modo-prime.md — "Modo prime y funciones
 * para todos"). Todo ya convertido a valores planos antes de cruzar a
 * `GeneracionPanel.tsx` (una isla `client:load` que nunca debe importar el
 * cliente de Prisma generado) — mismo patrón que `lib/admin/demo.ts`.
 *
 * `cuentasMarcadas` excluye admins y la cuenta demo: los dos YA tienen prime
 * por otra vía (ver `resolverCapacidades`), así que listarlos acá
 * confundiría "a quién hay que desmarcar" (la tercera vía, la única que este
 * panel administra) con "quién lo tiene siempre" — mismo criterio que
 * excluye a la demo de `/admin/usuarios`.
 */
export async function resumenGeneracion(): Promise<ResumenGeneracion> {
  const [settings, cuentasMarcadas] = await Promise.all([
    leerAppSettings(),
    prisma.user.findMany({
      where: { primeAccess: true, isDemo: false, role: 'DOCENTE' },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return {
    primeEnabled: settings.primeEnabled,
    autoReviewForAll: settings.autoReviewForAll,
    deepModeForAll: settings.deepModeForAll,
    versionsForAll: settings.versionsForAll,
    cuentasMarcadas,
  };
}
