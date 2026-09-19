import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../../../lib/db.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { ClaveNoConfigurada, cifrar, pistaDeClave } from '../../../../lib/crypto/secretos.ts';
import { invalidarCatalogo } from '../../../../lib/ai/catalogo.ts';
import { serializarProveedor, type ProveedorAdmin } from '../../../../lib/admin/proveedores.ts';

/**
 * `/api/admin/providers` — listado y alta de cuentas de proveedor
 * (catalogo-de-proveedores design.md §6).
 *
 * La autenticación y la frescura de la identidad ya las exige el middleware
 * (`requireAdmin` en GET, `requireFreshAdmin` en POST — ver
 * `src/middleware.ts`); acá sólo queda la lógica de negocio.
 */

const crearProveedorSchema = z.object({
  kind: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'El tipo va en minúsculas, sin espacios (ej: "gmi").'),
  label: z.string().trim().min(1, 'Falta el nombre de la cuenta').max(120),
  baseUrl: z.string().trim().min(1, 'Falta la URL base').max(300),
  apiKey: z.string().trim().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
});

/** GET /api/admin/providers — el listado completo, con la cantidad de motores de cada cuenta. */
export const GET: APIRoute = async () => {
  const filas = await prisma.aiProvider.findMany({
    orderBy: [{ kind: 'asc' }, { label: 'asc' }],
    include: { _count: { select: { modelos: true } } },
  });
  const proveedores: ProveedorAdmin[] = filas.map(serializarProveedor);
  return ok({ proveedores });
};

/**
 * POST /api/admin/providers — crea una cuenta de proveedor nueva.
 *
 * El `id` se genera ACÁ, antes de cifrar la clave: es el AAD del cifrado
 * (design.md §4), así que tiene que existir antes de llamar a `cifrar()` —
 * mismo orden que `models/index.ts` seguía cuando la clave vivía ahí.
 */
export const POST: APIRoute = async ({ request }) => {
  const parsed = crearProveedorSchema.safeParse(await readBody(request));
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

  const creado = await prisma.aiProvider.create({
    data: {
      id,
      kind: datos.kind,
      label: datos.label,
      baseUrl: datos.baseUrl,
      apiKeyCipher,
      apiKeyHint,
      enabled: datos.enabled ?? true,
    },
  });

  invalidarCatalogo();
  return ok({ proveedor: serializarProveedor(creado) });
};
