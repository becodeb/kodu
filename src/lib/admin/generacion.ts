import { leerAppSettings } from '../settings.ts';

export interface ResumenGeneracion {
  versionsForAll: boolean;
}

/**
 * `/admin/generacion` (odd/tasks/generacion-simple-y-reanudable.md, T1): tras
 * sacar el modo de calidad discreto y los interruptores nunca medidos con ganancia
 * real, queda un único interruptor. Valor plano antes de cruzar a
 * `GeneracionPanel.tsx` (una isla `client:load` que nunca debe importar el
 * cliente de Prisma generado) — mismo patrón que `lib/admin/demo.ts`.
 */
export async function resumenGeneracion(): Promise<ResumenGeneracion> {
  const settings = await leerAppSettings();
  return { versionsForAll: settings.versionsForAll };
}
