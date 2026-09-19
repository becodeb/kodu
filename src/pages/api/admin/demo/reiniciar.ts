import type { APIRoute } from 'astro';
import { prisma } from '../../../../lib/db.ts';
import { ok } from '../../../../lib/http.ts';
import { invalidarAppSettings, leerAppSettings } from '../../../../lib/settings.ts';

/**
 * POST /api/admin/demo/reiniciar — mueve `demoCycleStartedAt` a "ahora"
 * (design.md §8): vuelve a habilitar el tope de tokens de la demo sin
 * borrar ninguna fila de `TokenUsage`. El historial de costo sobrevive; lo
 * único que cambia es desde cuándo se suma para el tope
 * (`consumoDeLaDemo()` en `lib/demo.ts`).
 */
export const POST: APIRoute = async () => {
  await prisma.appSettings.update({ where: { id: 1 }, data: { demoCycleStartedAt: new Date() } });
  invalidarAppSettings();

  return ok({ settings: await leerAppSettings() });
};
