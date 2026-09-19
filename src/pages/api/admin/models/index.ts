import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '../../../../generated/prisma/client.ts';
import { prisma } from '../../../../lib/db.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { ClaveNoConfigurada, cifrar, pistaDeClave } from '../../../../lib/crypto/secretos.ts';
import { invalidarCatalogo } from '../../../../lib/ai/catalogo.ts';
import { precioADecimal, serializarMotor, type MotorAdmin } from '../../../../lib/admin/modelos.ts';

/**
 * `/api/admin/models` — listado y alta del catálogo de motores (design.md §2, §3.1).
 *
 * La autenticación y la frescura de la identidad ya las exige el middleware
 * (`requireAdmin` en GET, `requireFreshAdmin` en POST/PATCH — ver
 * `src/middleware.ts`); acá sólo queda la lógica de negocio.
 */

const precioSchema = z
  .union([z.coerce.number().min(0, 'El precio no puede ser negativo').max(999_999, 'El precio es demasiado alto'), z.null()])
  .optional();

const crearMotorSchema = z.object({
  provider: z.string().trim().min(1, 'Falta el proveedor').max(60),
  providerModel: z.string().trim().min(1, 'Falta el identificador del modelo').max(200),
  displayName: z.string().trim().min(1, 'Falta el nombre para el docente').max(120),
  description: z.string().trim().max(300).nullable().optional(),
  adminNote: z.string().trim().max(1_000).nullable().optional(),
  baseUrl: z.string().trim().min(1, 'Falta la URL base').max(300),
  apiKey: z.string().trim().min(1).max(500).optional(),
  priceInputPerMToken: precioSchema,
  priceCachedInputPerMToken: precioSchema,
  priceOutputPerMToken: precioSchema,
  selectableByTeacher: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  maxOutputTokens: z.coerce.number().int().positive().max(1_000_000).optional(),
  maxInputChars: z.coerce.number().int().positive().max(2_000_000).optional(),
  userTokenLimit: z.coerce.number().int().min(0).optional(),
  fallbackModelId: z.string().trim().min(1).nullable().optional(),
});

/** GET /api/admin/models — el listado completo, en el orden configurado. */
export const GET: APIRoute = async () => {
  const filas = await prisma.aiModel.findMany({ orderBy: { sortOrder: 'asc' } });
  const motores: MotorAdmin[] = filas.map(serializarMotor);
  return ok({ motores });
};

/**
 * POST /api/admin/models — crea un motor nuevo.
 *
 * El `id` se genera ACÁ, antes de cifrar la clave: es el AAD del cifrado
 * (design.md §4), así que tiene que existir antes de llamar a `cifrar()`.
 * El motor nuevo entra al final del orden (mayor `sortOrder` + 1); el admin
 * lo reordena después desde el panel si hace falta.
 */
export const POST: APIRoute = async ({ request }) => {
  const parsed = crearMotorSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }
  const datos = parsed.data;

  const id = randomUUID();

  let apiKeyCipher: string | null = null;
  let apiKeyHint: string | null = null;
  if (datos.apiKey) {
    try {
      apiKeyCipher = cifrar(datos.apiKey, id);
    } catch (error) {
      if (error instanceof ClaveNoConfigurada) return fail(error.message, 503);
      throw error;
    }
    apiKeyHint = pistaDeClave(datos.apiKey);
  }

  const ultimo = await prisma.aiModel.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
  const sortOrder = (ultimo?.sortOrder ?? -1) + 1;

  const data: Prisma.AiModelUncheckedCreateInput = {
    id,
    provider: datos.provider,
    providerModel: datos.providerModel,
    displayName: datos.displayName,
    description: datos.description ?? null,
    adminNote: datos.adminNote ?? null,
    baseUrl: datos.baseUrl,
    apiKeyCipher,
    apiKeyHint,
    priceInputPerMToken: precioADecimal(datos.priceInputPerMToken),
    priceCachedInputPerMToken: precioADecimal(datos.priceCachedInputPerMToken),
    priceOutputPerMToken: precioADecimal(datos.priceOutputPerMToken),
    selectableByTeacher: datos.selectableByTeacher ?? true,
    supportsVision: datos.supportsVision ?? false,
    maxOutputTokens: datos.maxOutputTokens ?? 65_536,
    maxInputChars: datos.maxInputChars ?? 400_000,
    userTokenLimit: datos.userTokenLimit ?? 0,
    fallbackModelId: datos.fallbackModelId ?? null,
    sortOrder,
  };

  try {
    const creado = await prisma.aiModel.create({ data });
    invalidarCatalogo();
    return ok({ motor: serializarMotor(creado) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return fail('Ya existe un motor con ese proveedor y ese identificador.', 422);
      }
      if (error.code === 'P2003' || error.code === 'P2025') {
        return fail('El motor de respaldo elegido no existe.', 422);
      }
    }
    throw error;
  }
};
