import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';
import { invalidarAppSettings, leerAppSettings } from '../../../lib/settings.ts';
import { asegurarCuentaDemo } from '../../../lib/demo.ts';
import { esClaveDeModoConocida } from '../../../lib/ai/modos-generacion.ts';

/**
 * PATCH /api/admin/settings — la fila única de `AppSettings` (design.md §9):
 * los dos campos de la demo (M7; specs/demo-mode/spec.md — "Global toggle"),
 * `versionsForAll` (odd/tasks/generacion-simple-y-reanudable.md, T1/T2), y
 * desde T7 (motor-claude) el modo de generación activo + los dos motores de
 * "personalizado" + las tres cifras de crédito. La autenticación y la
 * frescura ya las exige el middleware (`requireFreshAdmin` en toda mutación
 * de `/api/admin/*`).
 */

const schema = z
  .object({
    demoEnabled: z.boolean().optional(),
    demoTokenLimit: z.coerce.number().int().positive().max(100_000_000).optional(),
    versionsForAll: z.boolean().optional(),
    generationMode: z
      .string()
      .trim()
      .min(1)
      .refine(esClaveDeModoConocida, { message: 'Ese modo de generación no existe.' })
      .optional(),
    /** `null` = sin elegir (cae al modo base — ver `motorParaRol`). */
    creationModelId: z.string().min(1).nullable().optional(),
    adjustmentModelId: z.string().min(1).nullable().optional(),
    monthlyCreditUsd: z.coerce.number().min(0).max(100_000).optional(),
    premiumUntilUsd: z.coerce.number().min(0).max(100_000).optional(),
    billingCycleDay: z.coerce.number().int().min(1).max(28).optional(),
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

  // T7: sólo se guarda un motor que exista de verdad — un id inexistente
  // (typo, motor borrado entre que se abrió el panel y se guardó) daría un
  // error de FK (500) si no se valida acá antes.
  for (const campo of ['creationModelId', 'adjustmentModelId'] as const) {
    const id = datos[campo];
    if (id) {
      const existe = await prisma.aiModel.findUnique({ where: { id }, select: { id: true } });
      if (!existe) return fail('Ese motor no existe.', 422);
    }
  }

  await prisma.appSettings.update({ where: { id: 1 }, data: datos });
  invalidarAppSettings();

  return ok({ settings: await leerAppSettings() });
};
