import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '../../../../generated/prisma/client.ts';
import { prisma } from '../../../../lib/db.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { invalidarCatalogo } from '../../../../lib/ai/catalogo.ts';
import { precioADecimal, serializarMotor, type MotorAdmin } from '../../../../lib/admin/modelos.ts';

/**
 * `/api/admin/models` — listado y alta del catálogo de motores (design.md §2, §3.1;
 * catalogo-de-proveedores design.md §6 para el `providerId`).
 *
 * La autenticación y la frescura de la identidad ya las exige el middleware
 * (`requireAdmin` en GET, `requireFreshAdmin` en POST/PATCH — ver
 * `src/middleware.ts`); acá sólo queda la lógica de negocio.
 */

const precioSchema = z
  .union([z.coerce.number().min(0, 'El precio no puede ser negativo').max(999_999, 'El precio es demasiado alto'), z.null()])
  .optional();

const crearMotorSchema = z.object({
  providerId: z.string().trim().min(1, 'Elegí una cuenta de proveedor'),
  providerModel: z.string().trim().min(1, 'Falta el identificador del modelo').max(200),
  displayName: z.string().trim().min(1, 'Falta el nombre para el docente').max(120),
  description: z.string().trim().max(300).nullable().optional(),
  adminNote: z.string().trim().max(1_000).nullable().optional(),
  priceInputPerMToken: precioSchema,
  priceCachedInputPerMToken: precioSchema,
  priceOutputPerMToken: precioSchema,
  selectableByTeacher: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  maxOutputTokens: z.coerce.number().int().positive().max(1_000_000).optional(),
  reasoningEffort: z.enum(['none', 'low', 'high', 'max']).nullable().optional(),
  maxInputChars: z.coerce.number().int().positive().max(2_000_000).optional(),
  userTokenLimit: z.coerce.number().int().min(0).optional(),
  userTokenWindowHours: z.coerce.number().int().min(0).max(8_760).optional(),
  fallbackModelId: z.string().trim().min(1).nullable().optional(),
});

/** GET /api/admin/models — el listado completo, en el orden configurado. */
export const GET: APIRoute = async () => {
  const filas = await prisma.aiModel.findMany({ orderBy: { sortOrder: 'asc' }, include: { provider: true } });
  const motores: MotorAdmin[] = filas.map(serializarMotor);
  return ok({ motores });
};

/**
 * POST /api/admin/models — crea un motor nuevo.
 *
 * El motor nuevo entra al final del orden (mayor `sortOrder` + 1); el admin
 * lo reordena después desde el panel si hace falta. Ya no cifra nada acá: la
 * clave vive en la cuenta de proveedor (`providerId`), no en el motor.
 */
export const POST: APIRoute = async ({ request }) => {
  const parsed = crearMotorSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }
  const datos = parsed.data;

  // Pre-check explícito en vez de dejarle el error a Prisma: `AiModel` ahora
  // tiene DOS FKs (providerId y fallbackModelId), y sin esto un providerId
  // equivocado terminaría reportando "el motor de respaldo no existe".
  const proveedor = await prisma.aiProvider.findUnique({ where: { id: datos.providerId }, select: { id: true } });
  if (!proveedor) return fail('La cuenta de proveedor elegida no existe.', 422);

  const id = randomUUID();

  const ultimo = await prisma.aiModel.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
  const sortOrder = (ultimo?.sortOrder ?? -1) + 1;

  const data: Prisma.AiModelUncheckedCreateInput = {
    id,
    providerId: datos.providerId,
    providerModel: datos.providerModel,
    displayName: datos.displayName,
    description: datos.description ?? null,
    adminNote: datos.adminNote ?? null,
    priceInputPerMToken: precioADecimal(datos.priceInputPerMToken),
    priceCachedInputPerMToken: precioADecimal(datos.priceCachedInputPerMToken),
    priceOutputPerMToken: precioADecimal(datos.priceOutputPerMToken),
    selectableByTeacher: datos.selectableByTeacher ?? true,
    supportsVision: datos.supportsVision ?? false,
    maxOutputTokens: datos.maxOutputTokens ?? 131_072,
    reasoningEffort: datos.reasoningEffort ?? null,
    userTokenWindowHours: datos.userTokenWindowHours ?? 0,
    maxInputChars: datos.maxInputChars ?? 400_000,
    userTokenLimit: datos.userTokenLimit ?? 0,
    fallbackModelId: datos.fallbackModelId ?? null,
    sortOrder,
  };

  try {
    const creado = await prisma.aiModel.create({ data, include: { provider: true } });
    invalidarCatalogo();
    return ok({ motor: serializarMotor(creado) });
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
