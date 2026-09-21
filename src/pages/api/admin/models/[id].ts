import type { APIRoute } from 'astro';
import { z } from 'zod';
import { Prisma } from '../../../../generated/prisma/client.ts';
import { prisma } from '../../../../lib/db.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { invalidarCatalogo } from '../../../../lib/ai/catalogo.ts';
import { precioADecimal, serializarMotor } from '../../../../lib/admin/modelos.ts';

/**
 * PATCH /api/admin/models/:id — edición parcial de un motor (design.md §2, §3.1;
 * catalogo-de-proveedores design.md §6 para `providerId`).
 *
 * **No hay DELETE**: borrar un motor no está implementado a propósito — el FK
 * de `TokenUsage.aiModelId` es `onDelete: SetNull`, así que no rompería nada
 * técnicamente, pero borraría lo que significó cada fila histórica de
 * consumo. Apagar (`enabled=false`) es la única baja.
 */

const precioSchema = z
  .union([z.coerce.number().min(0, 'El precio no puede ser negativo').max(999_999, 'El precio es demasiado alto'), z.null()])
  .optional();

const actualizarMotorSchema = z.object({
  providerId: z.string().trim().min(1, 'Elegí una cuenta de proveedor').optional(),
  providerModel: z.string().trim().min(1).max(200).optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  adminNote: z.string().trim().max(1_000).nullable().optional(),
  priceInputPerMToken: precioSchema,
  priceCachedInputPerMToken: precioSchema,
  priceOutputPerMToken: precioSchema,
  enabled: z.boolean().optional(),
  selectableByTeacher: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  maxOutputTokens: z.coerce.number().int().positive().max(1_000_000).optional(),
  reasoningEffort: z.enum(['none', 'low', 'high', 'max']).nullable().optional(),
  maxInputChars: z.coerce.number().int().positive().max(2_000_000).optional(),
  userTokenLimit: z.coerce.number().int().min(0).optional(),
  fallbackModelId: z.string().trim().min(1).nullable().optional(),
});

export const PATCH: APIRoute = async ({ params, request }) => {
  const existente = await prisma.aiModel.findUnique({ where: { id: params.id! } });
  if (!existente) return fail('Ese motor no existe.', 404);

  const parsed = actualizarMotorSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }
  const datos = parsed.data;

  if (Object.keys(datos).length === 0) {
    return fail('No hay nada para actualizar.', 422);
  }

  if (datos.fallbackModelId === existente.id) {
    return fail('Un motor no puede ser su propio respaldo.', 422);
  }

  // Pre-check explícito: sin esto, repuntear a una cuenta inexistente caería
  // en el P2003/P2025 genérico que hoy sólo dice "el motor de respaldo no existe".
  if (datos.providerId !== undefined) {
    const proveedor = await prisma.aiProvider.findUnique({ where: { id: datos.providerId }, select: { id: true } });
    if (!proveedor) return fail('La cuenta de proveedor elegida no existe.', 422);
  }

  // Apagar el motor que hoy es el default está prohibido: primero hay que
  // elegir otro default (design.md §2). Si el mismo PATCH ya lo está sacando
  // de default (isDefault: false) no hace falta este freno.
  const quedaApagado = datos.enabled === false;
  const sigueSiendoDefault = datos.isDefault !== false && existente.isDefault;
  if (quedaApagado && sigueSiendoDefault) {
    return fail('Ese motor es el predeterminado. Elegí otro predeterminado antes de apagarlo.', 409);
  }

  const cambios: Prisma.AiModelUncheckedUpdateInput = {};
  if (datos.providerId !== undefined) cambios.providerId = datos.providerId;
  if (datos.providerModel !== undefined) cambios.providerModel = datos.providerModel;
  if (datos.displayName !== undefined) cambios.displayName = datos.displayName;
  if (datos.description !== undefined) cambios.description = datos.description;
  if (datos.adminNote !== undefined) cambios.adminNote = datos.adminNote;
  if (datos.enabled !== undefined) cambios.enabled = datos.enabled;
  if (datos.selectableByTeacher !== undefined) cambios.selectableByTeacher = datos.selectableByTeacher;
  if (datos.maxOutputTokens !== undefined) cambios.maxOutputTokens = datos.maxOutputTokens;
  if (datos.reasoningEffort !== undefined) cambios.reasoningEffort = datos.reasoningEffort;
  if (datos.maxInputChars !== undefined) cambios.maxInputChars = datos.maxInputChars;
  if (datos.supportsVision !== undefined) cambios.supportsVision = datos.supportsVision;
  if (datos.userTokenLimit !== undefined) cambios.userTokenLimit = datos.userTokenLimit;
  if (datos.fallbackModelId !== undefined) cambios.fallbackModelId = datos.fallbackModelId;
  if (datos.priceInputPerMToken !== undefined) {
    cambios.priceInputPerMToken = precioADecimal(datos.priceInputPerMToken);
  }
  if (datos.priceCachedInputPerMToken !== undefined) {
    cambios.priceCachedInputPerMToken = precioADecimal(datos.priceCachedInputPerMToken);
  }
  if (datos.priceOutputPerMToken !== undefined) {
    cambios.priceOutputPerMToken = precioADecimal(datos.priceOutputPerMToken);
  }

  try {
    const actualizado =
      datos.isDefault === true
        ? await prisma.$transaction(async (tx) => {
            // Bajar cualquier default anterior ANTES de subir este, en la
            // misma transacción: el índice único parcial (`AiModel_un_solo_default`)
            // rechazaría dos `true` a la vez si el orden fuera al revés.
            await tx.aiModel.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
            return tx.aiModel.update({
              where: { id: existente.id },
              data: { ...cambios, isDefault: true },
              include: { provider: true },
            });
          })
        : await prisma.aiModel.update({ where: { id: existente.id }, data: cambios, include: { provider: true } });

    invalidarCatalogo();
    return ok({ motor: serializarMotor(actualizado) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return fail('Ya existe un motor con ese identificador en esa cuenta.', 422);
      }
      if (error.code === 'P2003' || error.code === 'P2025') {
        return fail('El motor de respaldo elegido no existe.', 422);
      }
    }
    throw error;
  }
};
