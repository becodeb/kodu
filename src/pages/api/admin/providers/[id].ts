import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../../lib/db.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { ClaveNoConfigurada, cifrar, pistaDeClave } from '../../../../lib/crypto/secretos.ts';
import { invalidarCatalogo } from '../../../../lib/ai/catalogo.ts';
import { serializarProveedor } from '../../../../lib/admin/proveedores.ts';
import type { Prisma } from '../../../../generated/prisma/client.ts';

/**
 * PATCH /api/admin/providers/:id — edición parcial de una cuenta de proveedor
 * (catalogo-de-proveedores design.md §6).
 *
 * **No hay DELETE**: el FK de `AiModel.providerId` es `onDelete: Restrict`,
 * así que Postgres rechazaría borrar una cuenta en uso — y para una sin
 * motores igual tiraría la clave cargada. Apagar (`enabled=false`) es la
 * única baja, igual que en `models/[id].ts`.
 */

const actualizarProveedorSchema = z.object({
  kind: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'El tipo va en minúsculas, sin espacios (ej: "gmi").')
    .optional(),
  label: z.string().trim().min(1).max(120).optional(),
  baseUrl: z.string().trim().min(1).max(300).optional(),
  apiFormat: z.enum(['chat', 'responses']).optional(),
  /** `undefined` = dejar la clave como está, `null` = borrarla, string = reemplazarla. */
  apiKey: z.string().trim().min(1).max(500).nullable().optional(),
  enabled: z.boolean().optional(),
});

export const PATCH: APIRoute = async ({ params, request }) => {
  const existente = await prisma.aiProvider.findUnique({ where: { id: params.id! } });
  if (!existente) return fail('Esa cuenta no existe.', 404);

  const parsed = actualizarProveedorSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }
  const datos = parsed.data;

  if (Object.keys(datos).length === 0) {
    return fail('No hay nada para actualizar.', 422);
  }

  const cambios: Prisma.AiProviderUncheckedUpdateInput = {};
  if (datos.kind !== undefined) cambios.kind = datos.kind;
  if (datos.label !== undefined) cambios.label = datos.label;
  if (datos.baseUrl !== undefined) cambios.baseUrl = datos.baseUrl;
  if (datos.apiFormat !== undefined) cambios.apiFormat = datos.apiFormat;
  if (datos.enabled !== undefined) cambios.enabled = datos.enabled;

  if (datos.apiKey !== undefined) {
    if (datos.apiKey === null) {
      cambios.apiKeyCipher = null;
      cambios.apiKeyHint = null;
    } else {
      try {
        // El AAD es el id de la fila EXISTENTE, nunca uno nuevo: cambiar el
        // AAD volvería indescifrable cualquier clave que hubiera quedado
        // cifrada con el id viejo, y acá el id nunca cambia.
        cambios.apiKeyCipher = cifrar(datos.apiKey, existente.id);
      } catch (error) {
        if (error instanceof ClaveNoConfigurada) return fail(error.message, 503);
        throw error;
      }
      cambios.apiKeyHint = pistaDeClave(datos.apiKey);
    }
  }

  const actualizado = await prisma.aiProvider.update({ where: { id: existente.id }, data: cambios });
  invalidarCatalogo();
  return ok({ proveedor: serializarProveedor(actualizado) });
};
