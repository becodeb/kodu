import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';
import { invalidarAppSettings, leerAppSettings } from '../../../lib/settings.ts';
import { asegurarCuentaDemo } from '../../../lib/demo.ts';

/**
 * PATCH /api/admin/settings — la fila única de `AppSettings` (design.md §9):
 * los dos campos de la demo (M7; specs/demo-mode/spec.md — "Global toggle")
 * y `versionsForAll` (odd/tasks/generacion-simple-y-reanudable.md, T1/T2): el
 * único interruptor de calidad que sobrevivió a esa baja. La
 * autenticación y la frescura ya las exige el middleware (`requireFreshAdmin`
 * en toda mutación de `/api/admin/*`).
 */

const schema = z
  .object({
    demoEnabled: z.boolean().optional(),
    demoTokenLimit: z.coerce.number().int().positive().max(100_000_000).optional(),
    versionsForAll: z.boolean().optional(),
  })
  .refine((datos) => Object.keys(datos).length > 0, { message: 'No hay nada para actualizar.' });

export const PATCH: APIRoute = async ({ request }) => {
  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }
  const datos = parsed.data;

  // La cuenta se crea recién ACÁ, la primera vez que el interruptor pasa a
  // `true` — no en la migración — para que su `createdAt` signifique algo
  // real (design.md §8). Llamarlo en cada PATCH que prenda es idempotente:
  // si ya existe, `asegurarCuentaDemo` la devuelve tal cual.
  if (datos.demoEnabled === true) {
    await asegurarCuentaDemo();
  }

  await prisma.appSettings.update({ where: { id: 1 }, data: datos });
  invalidarAppSettings();

  return ok({ settings: await leerAppSettings() });
};
